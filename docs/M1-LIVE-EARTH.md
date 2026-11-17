# M1: live Earth design note

Started 30 October 2026, on the M0 field seam. This note fixes the formats and the
division of work so that the Rust core, the WGSL field and the browser workers agree.
It is design until the [progress file](REAL-EARTH-PROGRESS.md) records evidence.
Gates are those of [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md), section 10, unchanged.

## Division of work

| Owner | Does | Never does |
|---|---|---|
| Rust core (`solar-core`) | Chart math, wanted page set, admission, priorities, residency, f64 page reader | Touch a GPU or a network |
| Rust GPU (`solar-explorer`) | Atlases, clip table, bounded upload, staleness signal | Wait for a page |
| WGSL (`surface_field.wgsl`) | Field reads with band complements, node staleness, regeneration | Read back to the CPU |
| JS workers (`web/field/`) | Fetch, abort, decode, resample into pages, per-source adapters | Decide what is wanted, or touch WebGPU |

The render worker owns the engine. The field worker owns the network. They talk over
one `MessagePort`: page requests and cancellations one way, finished pages (transferred)
the other. Nothing on the render path awaits that port, so **no frame waits for the
network** by construction. The gate still measures it.

## Coordinates

- Body frame: +Y north, longitude 0 on +Z, east on +X:
  `n = (cos(lat) sin(lon), sin(lat), cos(lat) cos(lon))`. Viewed from outside with north up,
  `cross(forward, up)` is east, so the map is not mirrored. Tested against known towns.
- Geodetic latitude maps directly to spherical latitude, and heights are above the geoid
  (plan, section 4). Explicit approximation; up to about 0.56% north-south scale error.
- Cube faces follow `cube_key` in `terrain_gpu.wgsl`, with chart coordinates u, v in [-1, 1]:
  0: (1, v, -u), 1: (-1, v, u), 2: (u, 1, -v), 3: (u, -1, v), 4: (u, v, 1), 5: (-u, v, -1).
  This is the gnomonic chart of the terrain patches. Pages share its exact integer grid.
- Page `(face, D, x, y)` has x, y in [0, 2^D) and covers chart
  `u in [-1 + 2x/2^D, -1 + 2(x+1)/2^D]`, same for v. A patch at level L lies inside one page at
  `D = max(L - 4, 0)`.
- Cell width at a face centre: `R/128 / 2^D` metres (49.77 km at D0, 24.3 m at D11).

## Page formats

Both channels are 264 x 264 texels, packed 15 x 15 per 4096-square atlas layer (225 slots).

**Height: vertex-aligned.** Texel `(i, j)` is the grid point `(i - 3, j - 3)`, so grid 0..=256
of the page sits at texels 3..=259, with gutters of 3 below and 4 above. Grid point `g` of
page `x` lies at chart `u = -1 + 2(x + g/256)/2^D`. Gutters hold the true field at the extended
chart position, even past a cube edge; they are never copied from a neighbour's chart. Stored
as `R16Uint` with a per-page offset and scale, so that `height = offset + scale * value`.

**Albedo: cell-centred.** Texel `(i, j)` is the centre of cell `(i - 4, j - 4)`, with gutters of 4.
Cell `c` of page `x` lies at `u = -1 + 2(x + (c + 0.5)/256)/2^D`. Stored as `Rgba8UnormSrgb`.
Resampled in linear light, then encoded, so the hardware filter gets gamma-correct input.
Alpha is coverage, reserved for the overlay.

Worker-to-render-worker message for one finished page:
`{face, level, x, y, channel, source, offset, scale, bytes: ArrayBuffer}` (transferred). Height `bytes`
are 264 x 264 little-endian u16 (139,392 bytes). Albedo `bytes` are 264 x 264 RGBA8 (278,784 bytes).

## The interpolant

Height uses a **quadratic B-spline**: at x in grid units with `i = floor(x + 0.5)`, `s = x - i`,
weights `0.5(0.5-s)^2, 0.75-s^2, 0.5(0.5+s)^2` on `i-1, i, i+1` per axis. It is C1, so normals are
continuous; the weights are non-negative, so it never leaves the local sample range and page min and
max bound it exactly; and it needs 9 loads where a bicubic needs 16. It smooths stored samples by
(1/8, 6/8, 1/8), so a mesh vertex does not reproduce its stored sample exactly. The f64 reader uses
the same formula, and that is what the height gate compares. Height errors against lidar are
reported for this interpolant.

The gradient comes from the same spline, in grid units, converted to the sphere with the chart's
metric. Normals therefore come from the one height definition. There is no normal atlas at M1, which
leaves the plan's 64 MiB unallocated. Add one only if timing requires it.

## Levels

- A mesh vertex at patch level L reads page `D = max(L-4, 0)` with no blend.
- Shading reads at a footprint f in metres. The wanted level is
  `Dw = log2(cell0 * scale(u,v) / f)`, with `scale` the local chart metric at `(u, v)`. It blends the pages at
  `floor(Dw)` and `floor(Dw)+1`, so level changes are continuous over footprint.
- Each of those reads fades toward a coarser page in two cases: across a page's last 32 cells where the neighbour is
  served coarser, and for 20 frames after the page came on screen. Without these, shading and the shoreline changed in one
  frame when a page arrived, even though the mesh morphed. The f64 reader mirrors the border fade. It leaves out the arrival
  fade, which is over in a third of a second. Anything that caches a field read beyond a frame reads the final field
  (`field_final`): sun clipmaps, the coastal bed chart and scenery placement.
- Where f exceeds the coarsest page spacing (patch levels under 4, or views from beyond about 46,000 km),
  the read clamps to D0. It can alias there. This was planned as a 4 x 4 tap average and left out, because
  those cases are a tiny part of the image from any view the app offers. Revisit if it shows.

## The field

`H_data + sum_k rho * max(w_k(f) - w_k(s), 0) * band_k(n)`

- `H_data` is the spline read above, `s` the spacing of the page that served it, and `w_k` the
  existing `filter_weight`. **Changed.** Old: `w_k(f) * (1 - w_k(s))`. New: `max(w_k(f) - w_k(s), 0)`. Why: the old form
  did not vanish when the footprint equals the data's own cell. A 4 km band at 1.5 km cells kept a quarter of its amplitude, tens
  of metres of synthesized noise at wavelengths the data resolves, against the rule that synthesis only fills what is unresolved.
  Now a read at the data's level is exactly the data, and the height audit's error fell to 0.0003 m.
- `rho` is local roughness, from the data's own slope, `max(clamp(|grad H| / 0.5, 0, 1), 0.25 * dry)`, with `dry` a
  smoothstep of slope from 0.0005 to 0.003. Gentle ground keeps a floor of relief, and only water-flat data has none. Above slope
  0.35 the bands turn ridged, for crags, keeping about zero mean. Non-conservative heuristic, and the gradient of `rho` is ignored
  in the normal.
- The amplitude table is the existing `band()` table with mean-zero value noise only (ridge bands are
  all coarser than any complement in use).
- Selection keeps the same `band()` table for `error_for_level` as a **scheduling estimate**. On a measured
  body it is not a bound, and stats say so. Unknown bounds of unloaded descendants stay unknown.

Synthesized content is labelled: the provenance overlay reports served level against wanted level.

## Ground material

Close up, imagery alone is a blur: a 10 m pixel fills the screen from eye height. `measured_surface_albedo` multiplies it by
detail whose mean is about one, so filtering the result to the image's cell returns about the image. All of it is synthesized.

- Classes come from the image's own colour until land cover exists (M3, M6): vegetation, bare ground, rock by slope, snow, sand
  and sediment under water. A heuristic, with the failures that implies.
- Continuous noise from 8 m to 3 cm, faded by what the pixel can show and what the image already resolves. Hard thresholds on noise
  were tried first and read as camouflage.
- Sparse elements on the integer chart lattice, which is exact at any distance: stones with contact shadows, and blades. Blades are
  painted flat, so they read as grass from above and at a moderate angle, but not at a grazing one. Standing grass is M6.
- A shading normal of the material's own. No mesh, shadow or collision reads it, so it is not part of the field.
- The image is read through a small warp, so that an edge between two colours is ragged instead of a long blur. It moves content by
  about a quarter of the warp's scale, inside what a cell can say.

Canopy takes its colour from the imagery under it, so that a forest matches its own photograph.

`ground_detail` turns all of this off, leaving the image and the bed's colour. It is on except at the minimal preset, and has its own checkbox.

## Page lookup on the GPU

`clip_table`: `texture_2d_array<u32>`, `R32Uint`, 32 x 32 entries, `2 * 21 * 6` layers, one per channel,
level and face. 1 MiB. Entry bits: 0..12 atlas slot, 12..17 served level, bit 31 valid. An entry always points
at the page itself or its nearest resident ancestor, so there is no chain walk.

`clip_origin`: for each channel, level and face, the window's page origin, in a small storage buffer. A
page `(x, y)` inside `[origin, origin + 32)` indexes entry `(x mod 32, y mod 32)`. Outside the window,
the lookup steps to the next coarser level, which terminates by D5 because the 32 x 32 window covers
a whole face there. No search beyond that bounded integer step.

`page_params`: `(offset, scale, min, max)` per height slot in a storage buffer.

Pixel-to-page addressing extends `eye_key` with a fractional part, in double-single, on each query.

## Residency and scheduling (Rust, unit tested natively)

Each channel keeps, for each level, a ring 8 pages wide on each face around the point under the
camera. Levels run from the finest admitted down to D4. D0 to D3 are pinned. Imagery also wants its pinned D2 and D3 pages from the live source, every one above the
horizon and not only those in the rings: a live page replaces the pack's in its one slot and stays, so what is visible has to have been refreshed on every route.

Finest admitted level = min(source maximum, altitude limit, speed limit), where:
- altitude limit: the level whose cell is about one pixel at the camera's clearance. Clearance is read from the coarsest level that asks for nothing finer, walking up from the pinned pages.
  Read from whatever is served, it depended on the set it decides, and near a level's limit both sets held themselves up, so that the way the camera came would choose,
- speed limit: the plan's invariant, `v / S <= c`, with S the page's world size. c starts at 1.2/s
  and adapts to measured throughput. **Speed limits fetching only.** A page speed holds back stays on screen if resident and stays in
  flight if asked for. Before this, each burst of speed took fine pages off the screen, and each pause brought them back. The owner
  saw this as detail popping back and forth while zooming, and `tools/Test-Earth-Zoom.mjs` measured it (below).

Priority, **changed from the plan by measurement**. Old (plan, section 5): "coarse before fine, then
time-to-arrival along the velocity, then view direction". New, four tiers:

1. Pages in view at the level matching their pixels (the floor of the wanted level at the page's near and far
   distance), largest on screen first. Each spot on the ground has one such level.
2. Other pages in view, coarse to fine, up to the level above the first pass, which is what those pixels finally read.
3. Pages in view and finer than that. Nothing on screen reads them until the camera comes closer.
4. Pages out of view, coarse to fine.

Why: with coarse-first order, a cut at Lausanne reached only 14% of pixels within one level by 1 s, because imagery walks
through 13 levels there. With this order it reaches 98%. The cost is that distant parts of a cold view sharpen after near parts, not
before. Order only: the wanted set, and therefore what is settled, is unchanged, and a turn never changes the terrain cut.

The third tier **was added by measurement**. Old: those pages sat in the second tier by level, so 9.6% of the image waited one level soft behind them for 5 s or more. Ranking the level above the first pass ahead of everything coarser was tried first: it reached 99.8% at the exact level by 2 s, but fell from 98% to 91% within one level at 1 s, as far pixels were left waiting on coarser pages. So the second tier keeps its order, and only the finer pages move. See "After a cut".

Cancellation drops work no longer wanted. The request scheduler's design follows CesiumJS's `RequestScheduler` (per-host limit, priority
heap); the code is our own.

**The table serves the pages this position and altitude can use, plus the pinned levels.** At rest that is exactly the wanted set. Other
resident pages are only a cache, unmapped at once and remapped at once. Without this the settled image depended on the route: a page
left behind by an earlier stop served sharper detail than the camera asked for. Measured as a failure of the route gate before this
change. The f64 reader follows the same mapping, and holds every page the GPU pool holds, because a reader holding less answered tens
of metres off the mesh.

Evicting: a page outside every current ring may be replaced, least recently wanted first. D0 to D3 never. A pool too small for the wanted set, as on the reduced and minimal tiers, holds what ranks highest by camera
and key alone. The rest are not wanted, so they are not fetched, and `pages_over_pool` counts them. Before this such pages were first come first served, and the losers were fetched again every 120 updates for ever.

The f64 reader's copy of the pages costs about 157 MB of WASM memory at the full tier (1,125 height slots), and the water and parameter rows of `page_meta` about 4.7 MB of GPU memory. Both are arithmetic from the formats, not measured.

Height pages read source tiles one zoom coarser than imagery (`zoomBias -1`): over 247 recorded pages this cut 52.3 MB to 19.6 MB. Against lidar
at Lausanne, z12 and z13 RMSE are equal, so nothing measurable is lost there. In the USA, where Terrain Tiles carry 3DEP, z13 is better
(forest RMSE 0.98 m against 1.23 m at Enumclaw), so a later milestone should raise this where finer sources exist.

Pages are built in a pool of up to four decode workers, at about 2.3 ms for height and 3.1 ms for imagery per page in Node, measured on recorded tiles.

Preparing a tile for water runs in the same pool, as pure steps (`web/field/water-steps.js`), about 10 ms a tile. The field worker only orders them and fetches what they ask for. **Changed by measurement:** on the field worker's own thread that work held up the fetches behind it. A cut at 100 Mbit and 40 ms reached 88.9% of pixels within one level by 1 s, with only 7.7 MB of the 12.5 MB the link could carry. Two theories failed first: water's extra fetches (8 images by 1 s) and the limit of 6 connections per host. Switching water off reached 97.3%, which pointed at its CPU. A tile has one attempt at a time; whoever asks meanwhile waits for it, and makes its own if it fails or lost a tile, as a failure, a loss or a cancel belongs to whoever ran it.

What water fetches ranks just behind the first pass, in the page's own order (`waterRank`). **Changed by measurement.** At the page's own rank it waited in the imagery queue behind pages that were only sharpening, holding one of the height channel's slots all the while: in one traced cut no height tile arrived for 1.6 s. Height tiles now finish by about 6 s after a cut, against about 9. In that cut it costs about 100 more imagery requests and 1.8 MB, which looks like tiles fetched sooner and evicted from the tile cache before a page reads them. That explanation is an inference.

Uploads are bounded per frame by count and by bytes. Unused budget does not accumulate. `upload_deferred_frames`
counts frames that left arrived pages waiting.

**No height page waits on a host that is holding back.** **Changed by measurement.** Old: a height page near a coast waited for the image its shore comes from, so the ground stayed coarse for as long as the imagery host held back. At the Somme against a refusing host it stayed 7 levels behind, and with every request refused, six pages arrived in 8 minutes over two views. New: if that image's request is still queued and the host is stalled (paused, probing or out of budget), the page goes up at once with the shore its heights give, marked provisional (source bit 128). The renderer asks for it again after about a second (`REFRESH_AFTER_TICKS`), at most four at a time (`REFRESHES_IN_FLIGHT`), and that job waits as long as it takes. If it fails the page stays up, is not counted as failed, and comes round again. A tile that kept failing used to stay degraded until evicted; now it too is provisional. Waiting on an image happens only on a limited host that is holding back, so a test of the settled image with `?limits=off` never meets it, unless it injects failures. Asked for again, the page has the same bytes as a run with no budget (`tools/Test-Field-Logic.mjs`).

## Asking less of free services

EOX publishes no numeric limits. Its FAQ says its servers "automatically slow down or temporarily block sudden traffic spikes" and advises caching and spreading requests out (ledger, section 2). A session flying a lot had tiles refused: a 403 with no CORS header, which a browser shows as a CORS failure with status 0. **Added at the owner's request**, in this order: ask for less, then limit what is left.

- Pages nothing on screen reads (tiers 3 and 4 above) go out a few at a time, at most 16 height and 2 imagery in flight, and only while the eye moves under 1 m/s. So a page that can show never waits behind one.
- Each limited host has a budget (`limits` in `web/field/sources.js`): EOX 20 tiles/s with a burst of 300, SWISSIMAGE 20 and 200. What nothing on screen reads gets 4 tiles/s, and never takes the bucket below half. Terrain Tiles have none. **These figures are a judgement, not the services'.** Nothing can promise never to reach a limit that is not published.
- A host that keeps refusing is left alone for 4 to 30 s with its rate and burst halved, then asked one request at a time. A tile keeps its place meanwhile and spends none of its retries, up to five pauses. While a source is refusing a notice shows with the panel closed, and the data panel shows each source's budget.

`?limits=off` lifts all of this, for tests of the settled image on replayed tiles, which otherwise wait minutes for pages nothing on screen reads.

`tools/Test-Earth-Limits.mjs`, replayed tiles, 100 Mbit and 40 ms, requests to EOX, source `eff8186`:

| Scene | No budget | Budget |
|---|---|---|
| Cold jump, 20 s | 1,304 | 312 |
| Six jumps, 36 s | 4,017 | 899 |
| Steady flight, 60 s | 510 | 519 |
| Server limit 30/s, burst 400, 10 s block: refused, pages failed, requests during the block | 3,270, 707, 1,237 | 0, 0, 0 |
| Server limit 5/s, burst 60, 15 s block: refused, pages failed, requests during the block | | 12, 0, 11 |

This shows our side. It says nothing about EOX's real limit. An on-screen burst of about 120 tiles/s for about 2 s remains, which the gate of 90% of pixels within one level by 1 s needs. The settled image takes minutes with the budgets on.

Tiles are also kept on the user's machine (`web/field/tile-store.js`): raw bytes in the browser's Cache Storage, up to 2 GiB or a fifth of the browser's quota, whichever is less. Over that, what goes first is far from where the camera has been, long unused and fine. A failure of any of this is only a tile asked for again, and the data panel shows what it holds and can clear it. Going back to the same view in a new session, replayed tiles: 611 requests against 98 in 20 s, and EOX asked for 253 tiles against 15 in the first 5 s, with a page from the disk the same bytes as one from the network. Its cost in frame time is not measured.

## Regeneration

A node records what served its four corners, in the high bits of `Node.ready` (its existing users only test
zero): six bits each, the level plus one and whether the page is provisional. A GPU pass compares that with the clip table; a mismatch queues the node under the existing job
limits, and a new flag bit keeps `gpu_morph_vertices` from reusing the old trajectory for an unchanged leaf.

**Changed by measurement.** The token must be built from the reads it summarises. Old: it read each corner on the node's own face. On a cube edge a tie sends a vertex's read to the neighbouring face, so that page arriving changed no token, and the row kept the heights of its last generation for good. In the height audit straight from orbit, 402 samples were over tolerance, up to 509 m, with the same point cached at two heights in 1,764 pairs, and 2,400 more frames changed nothing. It depends on arrival order, so the gate's old route, Lausanne, Dents, edge-cross, read 17 samples and 19 m, and earlier 0. New: corners are read as a vertex reads them, through `face_chart`. A patch is a sixteenth of its page, so a corner off a low edge still reads the page of its interior. A root is the exception. Its corners are all cube corners, so on faces 2 to 5 they read neither its own page nor two of its neighbours', and with corner tokens alone those roots stayed at height 0, up to 5,625 m off, on 12 samples. A root's token is instead which of the six root pages are up. A provisional page replaced by its final form keeps its slot and level, so the table entry carries a bit that clears (`ENTRY_PROVISIONAL`), or the mesh would keep the provisional heights. The audit now names the samples over tolerance, counts unequal copies as a failure, and runs three routes, each in its own browser.
Vertices then continue through the existing trajectories. On a measured body a morph takes time in proportion to how far it goes, 60 m/s
between 0.14 s and 0.6 s, because new data can move a vertex tens of metres. The refinement is real motion and is reported as data lag;
it is not concealed. A table change wakes regeneration when the layer reaches the GPU, which can be frames after the change that dirtied it.

Scenery identity and sun clipmaps move from the one global revision to per-page state, so a page arrival does
not invalidate 884,736 records or every clipmap level.

## Water

Each height page carries a water level per cell, 32 x 32, in a row of `page_meta`, since the water program has no binding to spare. A level
says what water stands here, or `WATER_NONE`. The shore is where the bed crosses the level, so the grid can be coarse. Each cell takes the
commonest level under it, then cells grow by one so that a shore inside a cell has water to meet it, unless most of the cell lies more than 2 m under
that level, the far side of a dam or an outlet. The pinned pack has no grid and means sea level everywhere. Pages without water send one value.

Levels are coarse, so nothing may depend on where a cell ends. Dry ground is held above the water (below), waves stop on dry ground, and whatever a level
colours fades out toward a cell with none, over half a cell (`page_water_near`).

The water mesh is the terrain mesh at the vertex's level, kept in `Morph.key.w`. A vertex with no water sits 80 m under the ground, so
that triangles leading away from a shore slope out of sight. A fragment more than 46 m over its ground is dropped where the water stands 8 m or more above the sea, which covers
ground far below an outlet or a dam. Lake beds reach 46 m at most, and no such limit applies to the sea or to the Caspian, whose deep water an earlier version of the test cut away. That test reads the level carried from the vertices, not the fragment's height: a fragment lies on a chord, about 50 m
under the sphere on a 50 km triangle, and testing its height cut a lattice of holes in the far sea (below). Camera-relative effects use the level under the
eye, in the water chart's `lo.w` (the ripple chart until 16 November 2026). Lakes have a fifth of the sea's wave height. Water coming to ground that had none fades in over 40 frames, so a lake does
not appear in one frame.

A coarse triangle crosses the level anywhere between its vertices, so the mesh can stand above water that is there, and lie under ground it never sampled. It also reads a page matched to its vertices, coarser than a pixel's beyond a few hundred metres, and later to arrive. The owner saw this as a dark band along the far shore of Lake Geneva, as coasts turned to textured ground at low levels of detail, and, while pages arrived, as bare sand in square blocks with trees in the shallows.

**Changed by measurement: one answer at every footprint.** Old: the mesh, the bed's colour and the trees each read water from their own page, and the field's answer reached the water pass only from a 1 m footprint out, weighted by the image's share. So a bed could be drawn with no water over it, cut along the cells of the mesh's page. New: the surface pass reads whether water stands at a pixel once, at a page three levels finer than the footprint picks, and sends it on in the alpha of the shaded image, widened from afar by what one pixel spans of the ground's rise (`field_water_here`). Three levels, as a coarse tile cannot hold a lake: Lake Geneva reads a flat 371 m down to z9, 369 to 372 at z7 and 323 to 386 at z6. The rings keep such pages far past where any pixel needs them. The bed's colour takes this same answer. In the water pass a pixel the mesh left dry is water at the ground's own distance wherever the field says so, at any range (`claimed`). Beyond a footprint of about 1 m (`measured_water_trust`, from 0.5 m to 1 m) the field also decides where the mesh's water ends, and how deep the water is (`field_water_bed`), a read of the page in place of a screen-space ray down to the mesh's ground. Close up the mesh keeps what it knows and the field does not: its waves. Foam at the edge of the mesh's water shows only where the field says that is a shore. Trees wait for height pages at level 11 as they wait for imagery, and read the finest water there is. A level cell reaching past a dam does not count as water standing on the dry ground below it.

From a distance the image is the water: measured colour, with the surface's reflection and glint over it, in place of a computed bed (`measured_water_image`, from a 1 m
footprint to 6 m). It shows what a pixel of that size can of the real sea: turbidity, shoals, tidal channels. Up close it is a blur, and the synthesized bed takes over. Where it
is all image no bed is computed, which takes the most expensive part of this pass off the far sea; the cost is not yet measured against M0. Over deep water, fading in from 30 m to 200 m of clearance, it leans 70% on one deep sea colour (sRGB 12, 18, 30, within the range of recorded sea), since there it shows little but the straight seams between its source
scenes. A read at a 20 km footprint was tried first: it took in the land's colour and a different image tone, and left a dark halo around every coast. Seams remain, at full contrast, over shallows.

Finding water, in `web/field/water.js`, once per height tile, before any page reads it:

- Sea (`web/field/seabed.js`). **Changed.** Old: at z10 and under, whatever was not above zero; from z11, near-zero pixels confirmed from z10 and spread inside one tile. New: below.
  Why: the old rule came from one recorded place, Portofino. Terrain Tiles come in two kinds side by side, by whichever source covered the place: sea is a flat zero with rounding
  noise (Portofino, Tokyo, the Mekong), or it keeps real depths at every zoom (the Somme, Flanders, the Waddenzee, Baffin). Where it keeps depths the old rule found no sea at all. Of
  6,849,517 recorded pixels 10 m or more under sea level from z11 up, outside the basins below, it left 100% dry, and showed the image's sea on dry ground. The owner saw squares of it.
  The new rule leaves 2,528 of 8,966,609 dry (0.03%), counted over a wider sample; `tools/Test-Sea-Mask.mjs` fails above 0.1%.
- The new rule: a pixel at or under sea level is sea if at least half of a 9 x 9 window around it is smooth, or if it lies 10 m under. Sea here is interpolated from coarse data, so it is smooth
  however steep; land carries pixel noise however flat. Smooth means a second difference within a limit per zoom: 2 cm from z12, 4 cm at z11, 8 cm at z10, 16 cm at z9, 64 cm at z8, 1.28 m at z7, doubling
  below. Each is the highest found to keep Flevoland dry. At z12 and 2 cm, 82 to 100% of sea passes and 7% of Flevoland does. Then small patches inside a tile are dropped (under 40 ha), sea
  reaches 400 m along low ground to take in rough pixels at its own shore, and a patch of up to 16 km2 closed in by sea is sea. All of it is local, so a shared border mostly agrees: over 862 recorded tiles with low ground,
  the two sides of a border differ on 0.19% of low pixels at z11, 0.38% at z12, 2.1 to 2.6% at z8 to z10, the worst of those on Dutch and Flemish polders. A tile and the one above it differ on 0% (p50) and
  3% (p95) at z12, 9% (p95) at z11, 18 to 20% (p95) at z9 and z10, where the height data's coast itself moves. A heuristic, tuned on a sample of 25 places: it is evidence for those places, not a guarantee.
- Some low ground is not the sea, and is listed by hand in `INLAND_BASINS`: the Caspian and its lowland, the Salton Sink, the Jordan valley, Death Valley, Qattara, Fayum, Turpan, Danakil, Assal, Eyre, the
  Chotts, Enriquillo, San Julian. Inside them nothing is sea for being low, tested pixel by pixel, so a tile the Caspian's box touches still finds its shore outside it. The Caspian and Salton stand at their own levels (-28 m, -72 m), since their data does not read as flat water.
- Where the height data's coast is wrong the shore follows the imagery. **Added.** The coast in the height data can lie hundreds of metres out from the real one, with the image's sea on dry land between
  them, real water stopping short of the beach and trees standing on it: the owner's report. From z10 up, sea grows from known sea through ground up to 80 m high, up to 2 km, pixel to pixel, while the
  colour stays water-like and changes by at most 4 of 255 in any channel (3 when dark). Water-like is blue enough in itself, or close to the local sea, read from this tile or the z10 tile above. Colour alone is not enough:
  an early version took 73% of a tile of Flevoland's fields as water, and with the edge test and tighter colour limits it takes 0.46%. Fine tiles start from the z10 tile's sea, since a tile can lie wholly in the strip and would otherwise stay a dry square.
  This runs from z3 up, since a far coast showed the same strip, with the terrain's relief running out over the image's sea. Coarser than z10, a tile starts from its own sea, or from the tile above where it holds none, and ground may read higher and still be sea, half a pixel's width, as a coarse pixel averages the shore with the
  land behind it. The ground meets the water low on both sides, at a 2% slope scaled to the pixel, so that the waterline is a contour and not a staircase hugging the water pixels: land next to water stands at most 2% of a pixel's width over the level, and the bed falls from half that. This holds only for low ground and within reach of the shore, so that it cannot flatten a cliff. On a coarse tile this lowers a coast's
  first pixel by what a coarse pixel can say. This costs one more image per coastal tile, and two per z10 tile, and 3.7 ms per tile (p50; p95 11.7 ms, in Node). On 35 recorded places it adds 6.7% of the Tel Aviv tile at z13, 5.1% at Oman, 7.9% at Dakar.
  Each was checked by eye against the image, not against ground truth. Known failure: dark, low-contrast land beside a real lagoon, 28% of one Nile delta tile.
- Ground that stays dry is held above the water by a smooth step, at least 0.5 m over sea level. **This moves measured heights**, by what a polder lies under the sea plus 0.5 m, and on land above sea
  level by at most 0.53 m at the water's edge, 0.17 m at 0.5 m up, nothing from 3.5 m up. Without it, ground under the level in a cell with water floods in the cell's square. The f64 reader reads the same pages. Listed basins with no level keep their heights.
- Lakes: Terrain Tiles flatten water to one value (Lake Geneva reads 371.000 across whole tiles). A flat region of at least 2 ha, or 25 ha within 10 m of sea level since low land in whole-metre data holds flat patches
  by the hundred, counts as a lake if it lies in a basin, 70% of its surroundings not lower, and imagery over it looks like water: at least half its pixels dark, bluer than red, and not much greener than blue, or just
  dark and bluer than red above 10 ha, since forest is not flat to the centimetre over that area. Imagery is read at z12 or the tile's own zoom, one fetch per tile with a candidate. Sea is left out first: the flat terraces of real sea floor
  data pass all of this, and the old rule accepted about 2,000 of them per 25 tiles at the Somme and in Flanders, as lakes at -19 m and -23 m. Ground under a lake's level joined to it counts as the lake, up to 200 m, as coarse tiles ring beside a steep shore.
- A survey before those changes, over 1,588 recorded tiles at z11 to z13: 948 flat regions above the area limit, 770 rejected as not in a basin, 62 by colour, 116 accepted.
  Accepted levels are consistent with Geneva at 371, Neuchatel and Morat near 429, Bret at 672 and Emosson near 1918, names inferred from elevation and place. This is a survey, not a validation: there is
  no water ground truth here, and the plan's land cover pack is the proper test (M3).
- Beds are synthesized: the DEM has no lake depth. The bed falls away from the shore to a plateau near 32 m with a slow undulation, measuring distance inside the tile. It once read neighbouring
  tiles for the shore, and then a page depended on which had arrived. Levels are measured, beds are not.
- Preparing a tile is a pure function of what it reads. Raw heights are never changed, the prepared result is kept beside them, and a tile lost in transit is retried up to three times and otherwise counted as `waterDegraded`
  and its page goes up provisional (see Residency). Whichever page asks first gets the same final answer.

Limits: rivers are not flat in this data, and muddy lakes fail the colour test, so neither is water, and trees can stand in a river narrower than the 48 m footprint they read: rivers need a river map. The pinned pack (D0 to D3) keeps the height
data's coast and means sea level everywhere, so low land under it floods at orbit. While its imagery has not come, a tile keeps the height data's shore and lakes, in steps on a flat coast, and its page is asked for again until it does. A bed measures distance inside one tile, so it can step by up to 2.5 m at a tile border where a shore lies just across it. Two lakes at different levels in one cell lose the smaller one's water, leaving a pit. Vertical steps such as dams are not modelled.

Holes in the far sea, `tools/Test-Earth-Sea-Cover.mjs`: pixels with ground 100 m or more under sea level and no water fragment, replayed tiles, 1280 x 720.

| View | Before | After |
|---|---|---|
| Western Mediterranean, 5,000 km | 99.3% | 0.04% |
| Western Mediterranean, 1,500 km | 49.4% | 0 |
| Western Mediterranean, 600 km | 2.8% | 0 |
| Atlantic, 1,500 km | 72.0% | 0 |
| Pacific, whole disc | 99.9% | 0.01% |
| 200 km down to 10 m | at most 0.002% | 0 |

The limit is 0.1%, not zero: from far away the ground under a pixel comes from the field, and the water mesh, coarser than the pixel, can miss an inlet narrower than its cells. Such a pixel shows the image, as the water there would.

Water short of the shore, `tools/Test-Earth-Shore.mjs`: pixels the field calls water that the water pass left unchanged, over 14 settled views at 1280 x 720, replayed tiles. It counted only footprints of 6 m or more until the owner saw bare sand closer in than that. Before the field's answer reached the water pass, at 6 m or more: 36,794. On `676e232`, at every footprint: 2. It also reads places known to be open water from where they are, not from the field: at 15 km over Lake Geneva, 435 of 2,797 such pixels were dry when the field read the footprint's own page, and none are now. From about 400 km the lake is some 33 pixels and past any ring that knows it, so it shows as its image: 33 of 33 dry there, reported and not failed.

Water while pages arrive, `tools/Test-Earth-Water-Arrival.mjs`. A settled view shows almost none of the fault below, so this reads the image 2, 4, 8 and 15 s after a jump to a low view, with the budgets on, at 100 Mbit and 40 ms, replayed tiles. The host either answers, or allows 5 tiles/s with a burst of 60 and a 15 s block. At the Somme from 700 m, against that host:

| | Build before, `f1e09e2` | `676e232` |
|---|---|---|
| Field water left bare (colour changed by under 3%) | 114,281 pixels, 29% | 0 |
| Tree pixels over water | 25,288 | 0 |
| Height levels behind under the camera, from 4 s | 7 | 0 |
| Colour across the edge of the mesh's water, against neighbours inside water the field says goes on | 2.06 x | 0.69 x |

On `676e232` five views against both hosts leave 0 bare and 0 tree pixels, with the edge at 0.69 x at worst. On `7326500`, the Somme and Geneva against both hosts: 0 bare, 0 tree pixels, and the edge at 1.17 x, up from 0.69 x, after a claimed pixel's reflection stopped marching from its own bed. Limits: 0.2%, 1.5 x, 50 pixels, one level. One level, as with the budgets on the finest page right under a camera looking away is one nothing on screen reads: Geneva at 700 m reads 0 with budgets off and 1 with them on. The test's first version passed on the old build for two of these, reading a half-float target as floats and counting only water left wholly unchanged, so it was run on the build with the fault until it failed there. This measures the image and the field, not frame time. The places are recorded ones, not the owner's. Its colour threshold and limits are judgements.

With every image request refused, heights are current within 3 s at 700 m, at 17 requests to that host in a minute. The coast is then the height data's own, in steps, until images come.

The owner flew `676e232` on live services on 31 October 2026 and called it "awesome". That is the owner's verdict on this water, and not yet the M1 verdict on imagery.

## Detail must not pop

`tools/Test-Earth-Zoom.mjs`, replayed tiles at 100 Mbit and 40 ms, 640 x 360. Share of the image losing served level from one frame to the next during a
descent in wheel-like pulses, and share of pixels jumping visibly in one frame with the camera held after a cut, past the cut's own first twelve frames.

| | Lost level per frame, p95 / max | Held camera, jump share p99 / max |
|---|---|---|
| Portofino, before | 12.0% / 69.8% | 0.024% / 0.75% |
| Portofino, now | 0.21% / 0.29% | 0.056% / 0.088% |
| Dents, before | 5.5% / 7.0% | 0.26% / 9.8% |
| Dents, now | 5.5% / 6.9% | 0.23% / 0.36% |
| Lake, now | 0 / 0.0015% | 0.023% / 0.19% |

Now means source `cc54403`, run `gates-5`, with the settled cut and the page fades in place. "Before" was the build the owner reported popping on. Dents did not change in the first column, which
fits ground moving under fixed pixels over rough terrain, but that explanation is an inference. No threshold is set yet: this is a comparison, and the owner's eye is the judge.

## The settled image

The route gate asks for matching captures after different approaches. On `cf63d2e` display differed on 16.1% and 23.0% of pixels. On `cc54403` it gives the same bytes, for display, shaded, normal and position, on every route tried.

Each of these made the image depend on how the camera got there, and each was found by comparing captures, one after another:

| What differed | What now decides it |
|---|---|
| The cut saturates its patch cap near the ground (2238 of 2240), and kept patches around earlier stops | At rest it settles to one cut, ranked by score and key alone (`cut_settled`, `node_rank`). The procedural body keeps its path. Rest begins 30 frames after the eye stops. A page arriving wakes selection and starts its passes again, without starting that wait over |
| The table served whatever was resident | It serves the wanted set; everything else is a cache (see Residency) |
| Tile preparation depended on arrival order | It is a pure function of its reads, raw heights are immutable, and lake beds read no neighbour tile |
| A page's place in the atlas changed the rounding of its filter weights, by one half-float step | Imagery is read on a 1/4096 grid, where twelve bits above and twelve below the point fit a float exactly |
| A scenery record kept a placement decided by an earlier stop | Its token is built from the reads the placement itself makes, at the prop's own jittered position, including neighbours through `page_soft`. A record placed again measures its support again |
| Pinned imagery was refreshed only where a ring had reached | Every pinned imagery page above the horizon is wanted, on every route |
| A small pool held what came first | It holds what ranks highest by camera and key alone, and counts the rest (`pages_over_pool`) |
| Clearance read the set it decides, so near a level's limit both sets held themselves up | It walks up from the pinned levels and stops at the first level that asks for nothing finer |
| The cloud terrain mask was baked from whichever pages were there | It reads the final field, and is baked again once the height table has been quiet for 120 frames |

The first guess at the scenery difference was deferred re-placement. Widening the window from 64 to 600 frames changed nothing, so that was dropped. Slot collisions and the work cycle were ruled out by reading the code. Listing what a placement reads, instead of what it might touch, is what fixed it: the old token missed imagery across a near page border, and the prop's own position.

Evidence, source `cc54403`, WASM `287641b92fa7`, run `gates-5`, private headless browser, replayed tiles, 1280 x 720, clouds off, time frozen. Compared by SHA-256 of the raw buffers:

| Stop | Routes | Result |
|---|---|---|
| lausanne-north | from orbit; via Dents and Lavaux; across a cube edge and out to orbit | Same bytes, all four kinds |
| ouchy | the same three | Same bytes, all four kinds |
| portofino | the same three | Same bytes, all four kinds |
| germany-far, 5,000 km | from orbit; from Lisbon | Same bytes, all four kinds. The Lisbon leg recorded only up to the recorder's cap of 900 requests, so replay misses read as missing |
| orbit | from orbit; via Dents and Lavaux | Display, shaded and normal the same bytes. Position xyz the same, and its fourth channel differs |
| lausanne-north, reduced tier | from orbit; via Dents and Lavaux | Same bytes, all four kinds, with `pages_over_pool` 439 on both |

Residuals, all stated rather than removed:

- At orbit, the position buffer's fourth channel differs by one float step (139 of 921,600 pixels, at most 0.37 mm, in an earlier run of the same build). No colour moves. Cause not found.
- With clouds on, which the gate does not ask for, lausanne-north differs on 187 display pixels by one code, while shaded, normal and position match. Cause not investigated; frame phase of the cloud refresh is a guess.
- The evidence is for the full tier, plus one run at the reduced tier. Nothing has been run at the minimal tier, or on a phone.
- The near-plane crossing pass in `renderer.rs` runs only when the eye is close to the sea setting, so over a lake or the Caspian a wave crossing the near plane is left to the water program's own per-ray test. The effect is small, and a proper fix needs a water reader on the CPU.

## After a cut

`tools/Test-Earth-Cut.mjs`, Lausanne, replayed tiles, 100 Mbit and 40 ms, 1,516,068 pixels. The plan's gate is 90% of pixels within one level of final by 1 s, and 100% by 5 s. Source `f1e09e2`, budgets on, run `gates-8`, three runs on a quiet machine:

| | 1 s | 2 s | 3 s | 5 s |
|---|---|---|---|---|
| Within one level | 91.2, 91.2, 89.5% | 99.91, 99.87, 99.87% | 99.993, 99.993, 99.992% | 100%, no late pixel, all three |
| At the exact level | 75.8, 75.0, 75.0% | 90.6, 90.3, 90.5% | 99.99% | 100% |

So 5 s passes in all three and 1 s in two of three, one run at 89.5%. Later builds, one run each: with the mesh token fixed and before the review's fixes, 89.5% at 1 s and 9 late pixels at 5 s, all in by 10 s. On `7326500`, 91.2% at 1 s, 99.84% at 2 s, 99.97% at 3 s and 100% at 5 s, passing both. One run is not evidence either way, and the 1 s figure sits on the gate's edge in every set above. A first run after a pause can read lower at 1 s, which may be a cold OS cache on the fixture's disk; that is not proven.

The test's threshold was 99.99% from when it was written (49331e8), where the plan says 100%. Found on 31 October 2026 and made strict.

The last late pixels, on the far skyline, took three changes, each of which looked useless or harmful alone: a height page arriving started the cut's wait for rest over, so far ridges waited for the last height page in the rings; water's fetches ranked behind pages only sharpening; and pages nothing on screen reads sat in the second tier. With an earlier cap of 8 height pages nothing on screen reads, 64 of the 1,516,068 stayed late at 5 s and at 20 s, and with 16 none do. Why the smaller cap left those is an inference: the settled cut shares its patch budget over the whole planet, so they wait on every height page.

## Frame cost

Measured before the water, order and limit changes, so this needs running again. Source `9472293`, run `gates-7`, private headless browser, RTX 3080, replayed tiles, same cameras on both bodies, interleaved, quality high, GPU stage sum in ms, p50 / p95 / p99. `test=1` selects ultra; the owner's default on this machine is high.

| View | Procedural | Earth |
|---|---|---|
| Dents du Midi | 25.31 / 26.71 / 27.49 | 16.73 / 17.63 / 18.29 |
| Orbit | 17.61 / 21.26 / 21.86 | 17.36 / 21.07 / 22.00 |
| Genoa | 38.76 / 41.35 / 42.21 | 28.73 / 31.11 / 31.93 |
| Lausanne | 26.60 / 27.98 / 28.49 | 22.62 / 23.94 / 24.55 |
| Ouchy | 31.85 / 33.59 / 34.37 | 27.96 / 29.45 / 30.50 |

The plan's limit is 1.5 ms p50 for page lookups in shading, net of the bands removed. With the material off, medians: Dents +1.49 (one round 2.22), orbit +0.29, Genoa +0.61, Lausanne +1.19, Ouchy -0.10. With the material: +1.88, +0.41, +0.93, +1.68, +0.68. Dents is at the limit. The procedural body against M0 at ultra gives forest 27.86 to 28.56, coast 28.34 to 29.01, clouds 47.29 to 48.51, with identical images.

Since then the surface pass reads water once at every footprint where it read twice in the middle distance, and the water pass reads a page per covered pixel beyond 1 m in place of a screen-space ray. Which way that moves the figures above is not known until it is measured.

## Pinned pack

D0 to D3, 510 pages per channel. **Changed from the plan:** heights come from NOAA ETOPO 2022, not low-zoom Terrain
Tiles, because nothing confirms that the compiled tiles may be redistributed (see
[REAL-EARTH-SOURCES.md](REAL-EARTH-SOURCES.md), 11b), and ETOPO covers the poles, which Web Mercator tiles do not. Old:
"from NASA Blue Marble and Terrain Tiles". New: "from NASA Blue Marble Next Generation and ETOPO 2022". ETOPO's terms were read in its primary metadata record: CC0-1.0 worldwide
(ledger, 11c). Albedo stays Blue Marble Next Generation, without baked relief shading.

Poles above about 85 degrees have no live source, so the pinned pack serves them. That limit is visible in provenance.

## Sources (default manifest)

Terrain Tiles for height and EOX Sentinel-2 cloudless for imagery, with SWISSIMAGE as the sharp overlay in the test region.
Attribution strings come from the ledger. Tests only ever replay recorded tiles.

## What this note does not settle

- Worker against GPU resampling: the plan asks M1 to compare them. The worker path is built and
  its cost measured. The GPU arm has not been built, so the comparison has not been made. CesiumJS's GPU reprojection is the reference for the other arm.
- The mesh's pages come in the second tier, behind the pixels' pages, though they are few and everything reads coarse ground until they come. Moving them first was not tried, since it moves the cut gate.
- Whether 10 m imagery holds up low down is the owner's verdict, not a measurement.
- Bare-earth error: the height gate measures it against lidar, split by forest, urban and open land.

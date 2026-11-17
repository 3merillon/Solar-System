# Water as its own layer

Started 3 November 2026 from checkpoint `b648539`, following
`docs/NEXT-CONTEXT-WATER.txt` (development repository only). The decision and what it supersedes are in
[DECISION.md](DECISION.md#water-as-its-own-layer-3-november-2026). Evidence lives under
`$SOLAR_DATA/water-layer-2026-11-03/` (baseline worktree, phase folders), development machine only.

Status: phases 0 (baseline), 1 (canonical description and water pages) and 2 (terrain from the same data) done on
the CPU; phase 3a (the layer on the GPU, every water reader switched) and 3b (the water's own mesh within 12 km; the
lifted ocean still draws beyond) built and measured on the fixtures. Since 4 November 2026 (owner's request, after part
2) the explorer runs the layer by default: `?water=old` starts the field worker without `waterLayer` for the old path,
until phase 6 removes it (`?water=layer` still works and is now the same as no switch). `Test-River-Overflow` keeps its
own `--layer` switch. Part 2 (4 November 2026) found and fixed the owner's
darker ring (a sea bed that depended on the page level), the holes under the camera and the far field's gaps, and
measured the rest of the hand-off's list: see "Part 2". Next steps at the end.

## Phase 0: today's water, measured

Baseline build: commit `dddb6a7` (water code identical to `b648539`), checked out at
`$SOLAR_DATA/water-layer-2026-11-03/baseline` with the WASM built from the same sources (manifest: 102
sources, 0 differ; shader provenance verified), served on port 5201 (`node tools/serve.mjs --port 5201 --root
$SOLAR_DATA/water-layer-2026-11-03/baseline/web`). Every later phase runs the same suite against it, so
before and after are the same cases and the baseline can be re-measured for a new gate at any time.

Suite: `tools/Run-Water-Suite.mjs` runs `tools/Test-River-Overflow.mjs` serially over the four recorded fixtures
(Wupper, Rhine at Düsseldorf, Douro mouth, Leixões harbour) and their views (bank, near, mid, far, junction, steep,
coast, under), at wave height 0 and 8, with flicker (still and moving 3 cm a frame), shadow-only flicker at a 12
degree sun, and GPU timing. New options in Test-River-Overflow: `--timing N` (GPU timestamps of a settled view:
p50/p95/p99 of the water stage, which holds simulation, ocean raster, near-plane crossing and water shading, and of
the whole GPU span), `--sea` (prepare a fixture's sea as the worker does), and the judge: water is now classified
against the canonical union of the current tree's `water-layer.js` (ocean included), injected into the page as blob
modules, so every served build is judged by the same map (`--truth legacy` keeps the old rule).

GPU timing, baseline, 1920 x 1080, 300 frames after settling, quiet GPU (no process above 0.5% of the 3D engine
before the run), ms:

| Fixture, view | Water stage p50 / p95 / p99 | Whole GPU span p50 / p95 / p99 |
|---|---:|---:|
| Wupper near / mid / far | 3.90 / 4.04 / 4.62, 1.87 / 2.12 / 2.19, 1.34 / 1.38 / 1.58 | 10.39 / 11.02 / 11.23, 8.27 / 8.52 / 8.67, 7.71 / 7.96 / 8.02 |
| Rhine near / mid / far | 7.06 / 7.33 / 7.41, 2.18 / 2.47 / 2.52, 1.51 / 1.55 / 1.77 | 13.07 / 13.35 / 13.43, 8.71 / 12.79 / 13.64, 7.59 / 7.84 / 7.88 |
| Douro coast / under / far | 5.75 / 6.48 / 6.66, 2.18 / 2.20 / 2.44, 1.24 / 1.25 / 1.49 | 11.82 / 12.65 / 12.84, 7.79 / 8.03 / 8.07, 8.54 / 9.17 / 9.27 |
| Leixões coast / mid | 6.84 / 7.26 / 7.33, 1.68 / 1.72 / 1.93 | 13.00 / 13.56 / 13.65, 7.67 / 7.92 / 7.99 |

These runs disable clouds, trees, rocks, buildings and the atmosphere (the harness's settings), so the span is not a
playing frame; the water stage is what the new path must match. Flicker (pixels changing over 6/255 in 3 frames of
12 still / 24 moving): Wupper near 0 still, 63 moving; Douro coast 0 / 3; Douro under 0 / 12,673 (the moving eye
makes ripples on purpose). Shadow-only flicker at a 12 degree sun: Wupper near 152 moving, bank 94. Coverage classes
by the canonical union: see the phase 0 table in [the report folder](#evidence-index) (`phase0/base-truth`).

## Phase 1: one description, water pages

### Design

`web/field/water-layer.js`.

- **Bodies** (`waterBodies`, cached per tile set): every polygon of the map's water layer (ocean, lake, pond, dock,
  river; intermittent water and swimming pools left out), with an even-odd containment test per tile (still water
  before rivers before the sea where they overlap), still levels one per OSM id as before (`map-water.js`
  pieceLevel), still water sharing an edge with an ocean polygon held at sea level (`openToSea`), the sea at 0.
- **Union** (`waterUnion`): bodies plus the river network's channels where no polygon holds the reach (unmapped
  segments, `rivers.js`), and the network's level field. The network is the page's own from z14 lines from level
  12 and, new, from the lines of the coarse page's own tiles below it, so coarse pages carry the same rivers' levels
  and thin channels.
- **Level field for rivers** (`rivers.js levelAt`): the levels of the nearest centrelines at their nearest points,
  blended over max(6 m, half the distance), within 1.5 km. A function of position alone: one answer for a polygon
  river's far bank, a basin beside its river, or two pages sharing a texel. Evaluated on a grid of every fourth texel
  and interpolated only in cells where the field is linear (the network at the cell's middle within 1 cm of the
  bilinear estimate); elsewhere (steep streams, where two rivers' levels meet, coarse pages' wide cells) per texel.
  Cells fall on texels neighbouring pages share, so pages agree.
- **Coarse networks** are solved on the DEM one zoom under their vector tiles (z11 under z12 lines, at most z13;
  `resample.js coarseRiverDemZoom`), so a coarse network is complete, cached (`rivers.js` keeps fields by their
  tiles' signatures) and position-only. The worker does not yet fetch these DEM tiles (phase 3); the fixture
  harnesses build them by box-averaging the recorded z13 tiles (`tools/Fixture-Dem.mjs`).
- **Shore pieces**: every non-clip polygon edge in its own tile proper and every channel outline, split into pieces
  of a quarter texel; a piece is a shore when the point 0.1 m (or a quarter piece) outward holds no water. Where an
  edge changes from shore to water, the change is placed by bisection to 1/64 piece. Consecutive shore pieces of an
  edge merge back into one segment (same distances, fewer segments).
- **Distance**: per texel, the exact distance to the nearest shore piece within four texels (pieces binned in four
  texel bins), then three sweeps of 8-neighbour propagation (each candidate an exact distance to a real piece) over
  the page grid extended by the band, so a shore just beyond a page is found by every page that shares texels with
  it. Sign from containment. Clamped at the band (32 texels): a code at the band means "at least".
- **Coverage**: 4 x 4 samples of the texel square where the shore passes within 0.75 texel, else 0 or 1.
- **Levels outside water** (within the band): the level of the nearest shore's body at that shore, so a filter
  across the shore reads one level on both sides.
- **Page format** (Uint16Array, 264 x 264 x 4, RGBA16Uint on the GPU): distance (1/512 texel), level (page offset +
  scale), coverage | kind << 8 | fetch << 10, flow (two signed bytes, 4/127 m/s, along the page's texel axes). A
  page whose texels all lie at least the band inside one body at one level is `uniform`.

Bounds and counters: `overBudget` (edges, pieces, bin references past `WATER_LIMITS`), `unresolved` (texels with no
shore in reach, reported at the band), `fallbackLevel` (river texels with no centreline within reach: lowest ground
of their own polygon within three texels, smoothed), `wetPieces`, `channelPieces`, `openToSea`, `disagreeing` (an OSM
id whose pieces' levels spread over 0.5 m).

### Gates

`tools/Measure-Water-Pages.mjs` builds 3 x 3 pages per level with both the old excess plane and the layer and
measures them against a brute-force reference: containment by even-odd over every ring of the point's tile and every
channel (no bins, bands or orientation), and the union's edge found by sampling every polygon edge and channel
outline every 1/16 texel and keeping the samples where water changes across them (no shore-piece rules). Texels
within 8 texels of the fixture's vector tiles' border are left out (beyond it a fixture has no map).
`tools/Test-Water-Layer-Logic.mjs`: 8 synthetic cases, one per shortcut (bin-constant containment, distance by bins
and propagation, seams between touching lakes, a channel into a lake, a dock open to the sea, a zero-width channel,
coverage at a straight shore, shared page texels). 8/8 pass; `Test-Field-Logic` 80/80 and
`Test-Earth-Structures-Logic` pass with the `rivers.js` changes (river answers checked identical to the baseline at
1.08 million points over three fixtures).

Results, all four fixtures, levels 10 to 15 (old excess plane -> water layer):

| Gate | Old | Layer |
|---|---|---|
| Shore crossings vs the map, p99 (texels) | 0.31 - 10.8 | 0.03 - 0.34 |
| Crossings over half a texel | 8 - 1,791 per level | 0 at every level but Leixões 11 and 12: 1 each (0.517, 0.527) |
| Wet/dry wrong farther than half a texel from the map's shore | 0 - 31,473 texels | 0 |
| Distance error near the shore (within 4 texels), max | - | 0.04 - 0.24 texel |
| Shared page edges, distance, max | - | 0.002 - 0.029 texel |
| Wet neighbours whose level step exceeds the map's own by 5 cm | 0 - 1,590 per level | 0 - 41 (max 0.24 m, level 12) |
| Wet texels over 10 cm under the reference level (trench) | 0 - 6,443 | 0 - 6 |
| Seam texel pairs (wet beside wet of another body) left dry | up to 293 of 650 | 0 - 1 |
| Coarse vs fine (same vector zoom): distance p99, level p99 | - | 0.001 - 0.01 texel, 0 - 6 cm (max 0.29 m) |

Not met:

- *Coarse vs fine across a vector zoom change.* Rhine level 11 (z12 tiles) against 12 (z14): distance p99 29.7
  texels, level p99 0.41 m, coverage max 0.63. OpenMapTiles leaves streams out below z13 and generalizes lines, so a
  level 11 page lacks channels its level 12 children have. Polygon shores alone agree within 0.1 texel at p99 (z10
  and z12 against z14: 10 m and 2.7 m). Reading z(level + 2) for lines would ask about four times the tiles; not
  done. (The Rhine fixture holds z10, z12 and z14 vector tiles: level 10 reads z14 there, level 11 z12.)
- *Rhine level 11 in the fixture*: its z11 river DEM is incomplete (the fixture's z13 tiles cover a fifth of the z12
  vector tiles), so the coarse network loses reaches, falls back to ground levels (10,617 texels) and is solved
  again for every page (125 ms). Not representative of a live page, which will fetch those tiles.
- *Coverage quantization.* 16 samples: coverage against the 2 x 2 tent of the finer page differs by p99 0.09-0.15,
  max 0.29.
- *Levels at shared edges* where both pages read them (wet or within two texels of a shore): see the evidence; a dry
  texel between two bodies at different levels takes either body's level by the nearer shore, and ties can fall
  differently on two pages (level used only within two texels of a shore).
- *Build cost*: see below.

### Requests

Vector tiles a 5 x 5 block of pages asks for (old margins -> the band, 32 texels and 4 more): levels 7 to 11 +0 to
+46% (mostly about 10%), level 12 +0 to +6%, levels 13 and finer unchanged (Rhine, Lausanne, Porto). The layer reads
the same tiles' `water` and `waterway` layers the old path already decodes.

### Build cost

`tools/Bench-Water-Pages.mjs`, serial, Node on the owner's machine, 3 x 3 pages per level, 5 warm repeats: see the
table under phase 2 (the layer alone, and the whole new pipeline against the old path).

## Phase 2: terrain from the same data

`water-layer.js shapeTerrain`, run in the same page build (`buildHeightPage(..., {water:true, terrain:true})`), in
place of the old rules (map water beds, river channels, source beaches, the excess plane), which are not run then.

- The ground starts from the raw DEM on land; inside water the prepared seabed (`seabed.js`) stays where deeper.
  Before, a prepared tile's sea dug a seabed into every pixel the DEM called sea, the beaches, piers and breakwaters
  the map calls land included (Leixões: 52% of the dry ground beside the water was a pit before this).
- Wet target: no higher than the level less a bed falling from the shore at 0.25 toward the body's depth (ocean 10
  m, lake 6, dock 4, pond 1.5, rivers the network's), never deeper than 0.3 per metre from the shore in the sea (a
  prepared seabed is a fill, not a depth; standing deep at the coastline it was a step there).
- Dry target: ground beside the water raised to the level and a little over within 12 m (at most 2 m); beside a
  river high ground cut to a bank (the old rule: at least 31 degrees, steep enough to meet its hillside, faded over
  the last quarter of the bank zone), never under the bank's top: the old smooth minimum dipped up to 0.75 m under
  both its arguments and dug pits beside the water. The sea's and lakes' high shores are not cut.
- A texel: coverage times the wet target plus the rest times the dry one (a box filter: a coarse texel over a thin
  river carves its share).

Gates (CPU, same fixtures and levels; old = the old path's ground against the layer's water):

| Gate | Old | New |
|---|---|---|
| Wholly wet texels with the ground at or over the water | 0 - 12,593 per level | 0 |
| Wholly dry texels within 1.5 texels of the shore over 10 cm under the water | Wupper 259-896, Rhine 26-1,012, Douro 125-799, Leixões 125-1,992 | Wupper 41-345, Rhine 0-845, Douro 0-290, Leixões 0-241 (0 at levels 14-15 but Wupper 132, 41) |
| Ground over 35 degrees within 45 m outside water | 0 - 1.7% | 0 - 1.8% (higher than old at Wupper 14: 1.7 vs 1.3%, Leixões 14: 0.8 vs 0.2%) |

Page build cost (`tools/Bench-Water-Pages.mjs`, serial, warm, ms p50 / p95 over 3 x 3 pages x 5 repeats; "new
pipeline" builds the water layer and the terrain from it and skips the old water rules; the old path's own water
rules are still in it until phase 6):

| Fixture, levels | Old path | New pipeline | Water layer alone |
|---|---|---|---|
| Wupper 13 / 14 / 15 | 10.6 / 19.9, 16.6 / 26.9, 15.1 / 29.0 | 21.6 / 43.8, 25.3 / 40.8, 24.1 / 42.7 | 16.6 / 33.7, 18.8 / 31.2, 17.9 / 34.2 |
| Rhine 12 / 13 / 14 / 15 | 19.4 / 37.9, 16.8 / 40.7, 15.4 / 48.1, 10.6 / 40.1 | 23.2 / 45.5, 18.5 / 41.2, 17.5 / 40.4, 5.8 / 33.8 | 17.8 / 40.2, 13.1 / 35.3, 15.4 / 39.5, 15.1 / 29.3 |
| Douro 12 / 13 / 14 / 15 | 13.1 / 32.9, 14.4 / 63.6, 19.2 / 69.0, 15.0 / 48.8 | 24.0 / 43.4, 24.6 / 70.3, 26.9 / 80.4, 19.8 / 62.6 | 16.3 / 35.6, 19.7 / 57.0, 19.3 / 70.7, 14.0 / 54.4 |
| Leixões 11 / 12 / 13 / 14 / 15 | 13.9 / 18.9, 14.9 / 31.1, 24.0 / 40.5, 22.4 / 61.7, 19.5 / 57.1 | 17.5 / 39.9, 21.0 / 42.8, 28.4 / 44.6, 24.0 / 59.6, 19.5 / 52.9 | 12.1 / 33.5, 13.4 / 34.3, 20.5 / 38.0, 26.0 / 49.2, 23.6 / 41.0 |

The new pipeline is 1.0 to 2.0 times the old at p50 (Wupper the most) and about the same at p95. Cold builds (first
page over new tiles) add the bodies' solve: Wupper 13 40 ms p50. Rhine 11 is left out (fixture, above).

The earlier "5.4% within 60 m" Wupper figure counted only ground beside the river channels; this measure counts all
ground within 45 m of any water (the band at level 15 is 48 m), so the figures are not comparable.

Not established: the GPU height audit (`Test-Earth-Height-Audit`) runs once the worker builds pages this way (phase
3). Remaining pits at levels 11-13 are mostly floodplain lower than its river within one coarse texel.

## Phase 3a: the water layer on the GPU (lifted ocean still drawn)

Phase 3 is split. 3a puts the water pages on the GPU and makes every water reader use them; the ocean surface is
still the terrain's triangles lifted to the water's level (now the layer's), clipped at the layer's shore. 3b
replaces that surface with a dedicated camera-centred water mesh. Both run only when pages carry the layer.

- **Worker** (`field-worker.js`, opt-in `waterLayer` in the init message): height pages are built with the layer and
  the terrain from it; vector tiles reach a band beyond the page (`riverTilePlan({band})`); coarse pages fetch the
  DEM one zoom under their vector tiles for their network; the page message carries `waterLayer` (texels, or a
  uniform body, or dry). `field-decoder.js` strips the float planes before posting. The render worker forwards it with
  `engine.water_page_arrived` (new, `browser.rs`).
- **Residency** (`pages.rs`): an RGBA16Uint atlas of one layer (225 water pages, 134 MB at 4096 x 4096) with its own
  slots, given out per height page; past them the slot given out longest ago is taken and its page reads a coarser
  page's water (counted: `stats().water_layer.evicted`). Per height slot, `page_meta` column 256 of rows 0-4 holds
  the water slot and level offset and scale, or dry, uniform (kind, level), unknown (old reads stand) or evicted. The
  height atlas is unchanged (R32, its excess bits zero on these pages) until phase 6.
- **Shaders** (`surface_field.wgsl` binding 115 `water_atlas`, `water_layer_read`, `water_layer_entry`,
  `water_layer_coverage`): bilinear distance, level (wet texels only), coverage, kind and flow. Readers switched where
  the layer answers: mesh vertices carry the layer's level within two texels or two vertex spacings of water
  (`terrain_gpu.wgsl measured_mesh`); the ocean fragment is clipped at the shore plus one pixel's footprint
  (`explorer.wgsl`); water coverage in the water pass is the distance's sharp edge where a pixel is smaller than a
  texel and the texel's box-filtered coverage where larger (`water.wgsl`); material water (`field_water_here`), bed
  depth, ripples' level, bank detail and tree placement read the layer; river ripples ride the layer's flow, white
  water from speeds over 3.3 m/s. The water pass now uses all 16 sampled-texture bindings WebGPU guarantees.
- **Flow**: Manning's formula (n = 0.05) on the reach's slope over 250 m either way, capped at 3.5 m/s, and for
  rivers 8 m wide or more on a slope of at most 0.2%: the network's fitted levels on the z13 DEM fall several percent
  where the river falls tenths (Wupper fixture: median segment slope 1.6%, p90 4.6%), and first renders showed the
  Wupper white from bank to bank. **Open:** those levels themselves (steps along a river's surface).
- **Test harness**: `Test-River-Overflow --layer` builds fixture pages with the layer and uploads them through
  `water_page_arrived`; coarser DEM zooms are box-averaged in the page (`Fixture-Dem.mjs`).

Gates (`Run-Water-Suite --extra --layer` against the same fixtures and views, judged by the same canonical union,
against the baseline on :5201): see `phase3/layer/summary.json` (results below when the run ends).

## Phase 3b: the water's own mesh

`explorer.wgsl water_mesh_surface` (vertex entries `water_mesh_vertex`, `water_mesh_cap_vertex`; fragments shared with
the ocean, so the ocean and near-plane targets and everything reading them stay as they are).

- Twelve camera-centred rings of 48 x 48 cells on the cube face chart under the eye (key units: 16 at ring 0, about
  0.38 m at a face centre, doubling per ring; the gnomonic chart carries rings past the face edge). Each ring is
  snapped to twice its step, so vertices are fixed in the world and never slide under the water; its middle is left
  to the finer ring; over its outer six cells odd vertices move onto their even neighbours by the eye's distance, so
  at its border it is the coarser ring's grid and the two meet without cracks. Positions come from integer cube keys
  through the terrain's double-single `base_position`, so they hold to the millimetre at any distance on the planet.
- Generated from the vertex index alone (165,888 vertices, no buffers); a cell is dropped (degenerate) when the layer
  puts no water within half its diagonal and two texels of its middle, when its page carries no layer, or past 12 km.
  Vertices take the layer's level (also past the shore, within the band, so a cell across a shore is flat at the
  water's level) and the waves (`sea_wave`, footprint the cell's size); the fragment clips at the shore.
- The lifted ocean yields within 12 km wherever a page carries the layer (`lifted_ocean_yields`, both passes); beyond
  that it still draws far water, clipped at the layer's shore: open, to be replaced by coarser rings or a far-field
  mesh once the near field passes.
- An interim fix in 3a stays for the far field: a dry vertex of the lifted ocean never holds water over its own
  ground (a coarse triangle across a steep stream stood up over the bank in teeth).

Results, the same fixtures and views as phase 0, both builds judged by the canonical union with water placed by its
own surface (`phase3/judge2-base`, `phase3/judge2-mesh`; the new build with the layer, the terrain from it and the
mesh). Spill: water over 3 m outside the map's water, and (in brackets) farther out than one pixel's ground spacing,
which an antialiased shore never reaches; dry: ground 6 m or more inside the map's water showing none.

| Fixture, view | Spill old -> new | Dry old -> new |
|---|---|---|
| Wupper bank / near / mid / far / junction / steep | 4 (4) / 0 / 22 (22) / 0 / 0 / 3 (1) -> 0 / 1 (1) / 50 (50) / 3 (0) / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 -> 32 / 22 / 1 / 0 / 0 / 114 |
| Rhine bank / near / mid / far / steep | 0 / 1 (1) / 8 (8) / 770 (758) / 8 (8) -> 131 (3) / 149 (5) / 181 (7) / 1,172 (952) / 172 (51) | 2 / 88 / 221 / 17 / 29 -> 0 / 88 / 34 / 19 / 116 |
| Douro coast / near / far | 0 / 0 / 811 (770) -> 0 / 4 (4) / 94 (5) | 22,988 / 17,073 / 82 -> 0 / 1,173 / 0 |
| Leixões coast / near / mid / far | 3 (1) / 2,291 (2,057) / 2,097 (1,857) / 4,703 (4,655) -> 42 (17) / 330 (9) / 311 (8) / 141 (6) | 6,096 / 550 / 499 / 15 -> 111 / 0 / 12 / 0 |
| Wave height 8: Wupper bank / near, Douro coast, Leixões coast | 4 / 0 / 0 / 3 -> 0 / 1 / 0 / 41 (17) | 0 / 0 / 24,756 / 6,387 -> 34 / 20 / 3,320 / 112 |

Arrival (spill while pages arrive, from the third sample): Leixões 14,526 -> 57 px, the others 0-18. Flicker (moving 3
cm a frame): Wupper near 63 -> 52, Douro coast 3 -> 3, Douro under 12,673 -> 14,301 (the moving eye's ripples, on
purpose). Shadow-only flicker at a 12 degree sun, moving: Wupper near 152 -> 368, bank 94 -> 165: worse, along
shorelines (the water's edge, a pixel wide); **open**. Rhine far's spill lies past the fixture's z14 tiles (the judge
has no map there, as in phase 0). The rivers' new dry pixels are far, shallow water over coarse pages' box-filtered
beds within centimetres of the level, which shows little; open, low.

GPU timing, 1920 x 1080, quiet GPU (no other process on the 3D engine before each run), 300 frames, ms p50 / p95 /
p99 (`phase3/mesh-timing`, and the coasts again after 300 more settling frames):

| Fixture, view | Water stage old -> new | Whole GPU span old -> new |
|---|---|---|
| Wupper near / mid / far | 3.90 / 4.04 / 4.62 -> 3.42 / 3.79 / 3.85; 1.87 / 2.12 / 2.19 -> 1.70 / 1.99 / 2.01; 1.34 / 1.38 / 1.58 -> 1.27 / 1.52 / 1.54 | 10.39 -> 9.62; 8.27 -> 7.84; 7.71 -> 7.36 (p50) |
| Rhine near / mid / far | 7.06 / 7.33 / 7.41 -> 5.97 / 6.10 / 6.14; 2.18 / 2.47 / 2.52 -> 1.90 / 2.18 / 2.25; 1.51 / 1.55 / 1.77 -> 1.42 / 1.68 / 1.68 | 13.07 -> 11.50; 8.71 -> 7.68; 7.59 -> 7.17 (p50) |
| Douro coast, settled | 5.90 / 6.02 / 6.06 -> 5.71 / 5.86 / 5.94 | 12.05 / 12.28 / 12.32 -> 11.60 / 11.85 / 11.89 |
| Leixões coast, settled | 7.16 / 7.33 / 7.38 -> 6.52 / 6.72 / 6.77 | 13.47 / 13.72 / 13.77 -> 12.07 / 12.40 / 12.48 |

The water stage now holds the water mesh too. Two costs:

- *Settling after arrival.* With the layer and the terrain from it, terrain regeneration after the last page runs
  about 270 frames in the coastal views (scheduling over 1 ms a frame), against under 150 in the baseline: the first
  coastal timing window caught it as a p95 of 16-17 ms (`gpu_scheduling` p95 4.6 ms). Not yet found whether the
  layer reads per mesh vertex or more refinement along the new banks costs it; open.
- *The default path.* With the layer off (the explorer's default, the old reads standing), this build costs 0.24 ms
  more in the water stage at the Douro coast (5.92 -> 6.16 ms p50): the layer checks added to the old path's pixels
  and fragments. It goes when the layer becomes the default and the old path is removed (phase 6). The mesh itself is
  drawn only once a page has come with a layer.

Also: `tools/Check.ps1`, the native Vulkan probe (`--view ground --frames 30 --warmup 60 --frozen --audit`, every
program compiled, the procedural body draws its ocean as before: the mesh skips bodies without pages),
`Test-Water-Layer-Logic` 8/8, `Test-Field-Logic` 80/80, `Test-Earth-Structures-Logic` pass. Not run: the Earth tour
replay coasts and the height audit with the layer on (the worker flag has no switch in the explorer yet).

The judge in `Test-River-Overflow` now places water by its own surface (the ocean target's distance along the
pixel's ray): water that rightly hides lower ground behind it, looking down a valley, had counted as spill by that
ground's place. Both builds are re-judged this way (`phase3/judge2-*`).

## Owner's first look with the layer on (3 November 2026, evening)

"Miles better", with these reports, each traced and fixed:

- *Water climbing steep walls at banks and shores, texture changing midway above the water.* Two causes. The water
  shading on ground (`field_water_here`, and the bed's sediment) came from the horizontal distance to the shore alone,
  so a wall's face, at the shore horizontally but metres over the water, was shaded as water (the scalloped band and a
  white "curtain" reflecting the sky). It now also needs the ground at or under the level, within a tolerance that
  widens with the pixel's footprint, as the old texels' did. And beside lakes and the sea the high ground was left
  uncut while the bed inside was cut straight down: where the DEM put land over the map's water, a vertical wall stood
  at the shore. Every shore now has a bank: a line rising from just over the level at 31 degrees at least, or 1.5
  times the hillside's own slope where steeper (cliffs stay as steep as the ground has them), cut only where the ground
  stands over it, never under the bank's top, fading out over the band's last quarter. It replaces the river rule's
  fixed bank zone, which could end in a ledge. Ground over 35 degrees within 45 m of water (old -> layer before ->
  now): Wupper 14 1.29 -> 1.74 -> 1.13%, Rhine 13 0.48 -> 0.38 -> 0.01%, Douro 12 1.66 -> 1.67 -> 1.21%, Douro 14
  0.17 -> 0.45 -> 0.33%; the other gates unchanged.
- *Sea tiles turning to grass while parked.* A page reads the vector tiles it got; one that failed (the page is then
  provisional and asked again) left its part of the page with no sea, and the sea floor was drawn as dry ground. The
  source's water now stands in wherever no vector tile covers a point (missing, failed, or below level 7), sea and
  lakes alike, each at its own level (`sourceSea` levelAt).
- *Darker page-shaped patches on the open sea.* The sea floor's limit near the shore (0.3 m per metre) used the
  distance clamped at the band, which is 77 m on a fine page and 384 m on a coarse one, so open-sea floors stood at 23
  or 115 m by page level and the water's colour followed. The limit now holds only within 12 m of the shore.
- *(test)* Far water: the water mesh was taken to the horizon (eighteen rings, about 1,100 km at a face centre), then
  back to twelve (about 16 km): a flat cell sags under the sphere by its size squared over 8R, about 100 m for the
  70 km cells of the outer rings, and over shallow shelves the sea floor stood over it and hid the water (bands at 60
  to 200 km). The lifted ocean, whose triangles are the terrain's own and sag alike, draws beyond; curvature-aware far
  cells are open. The two split the screen by one test (Chebyshev distance in the eye's face chart), at the outer
  ring's reach less two cells: a ring snapped to twice its step reaches only n/2 - 2 steps past the eye on its far
  side, and one cell's gap was a light stripe across the sea at 5 km. A coarse cell's page was a pinned one (levels 0-2, no layer) where the
  lifted ocean's finer fragment found the layer, so neither drew a surface (Test-Earth-Sea-Cover: 439,203 of 443,506
  deep-sea pixels at 200 km had none). `water_layer_entry` now asks the finest resident page when a pinned page has no
  layer, for every caller.

Earth tour replay (`SOLAR_QUERY=&water=layer`, `SOLAR_TILES_PORT=5210`: the tile server takes its port and the next,
and 5201 is the baseline's; the tour holds one OSM tile, so most coasts take the source's water): height audit passes
with the layer (0 samples over tolerance at Lausanne, Dents-du-Midi and the cube edge, as without). Sea cover (deep sea
with no water surface over it; `phase3/earth3/layer-Sea-Cover-2`), old -> layer: passes, total holes 39,932 -> 618;
200 km 33,159 -> 7, 60 km 3,787 -> 11, 20 km 2,700 -> 1, 5 km 0 -> 0, 1 km 0 -> 3, 100 m 0 -> 175, 10 m 0 -> 348 (open:
a few hundred pixels under the camera). Shore: Lake Geneva's known water drawn dry 34 -> 108 of 17,389 (before the
lakes joined the fallback: 17,391); water over ground the field calls dry is 0-195 per view except Flanders at 6 km,
5,373 of 619,000 (old 12; open: polders behind the coast inside the source's sea contour, the tour having no map
there); `phase3/earth3/layer-Shore`.

Fixture classes after these fixes (`phase3/earth3/rivers`, the judge now counting dry only where the ground lies within
2 m of the map's level, and ground standing over it apart): spill beyond one pixel 0-3 in every view of the four
fixtures; dry Wupper 0-113, Rhine 0-759, Douro 0-2,945 (near view, at the placeholder wall), Leixões 0-771. Ground over
the map's water is the fixtures' placeholder ground: pages coarser than level 8 are a flat 400 m in the harness, so
every far pixel stands on that plateau (Douro near 148,646, Rhine far 13,026, Leixões near and mid 21,096 and 23,156).

## Part 2 (4 November 2026, NEXT-CONTEXT-WATER-2.txt)

Evidence under `$SOLAR_DATA/water-layer-2026-11-03/part2/`. "Before" is the committed build (151b89a's WASM and
`web/field`, served from `part2/web-head`); "after" is the working tree.

### 1. The owner's darker ring over the sea: found, reproduced, fixed

*Search.* The ring did not reproduce on the Earth tour replay: the Somme (50 m to 2 km, 19 and 35 degrees down, sun 8
degrees ahead), Tel Aviv with the afternoon's sea-floor rule put back (`part2/web-prefloor`). Both show smooth water.
The tour holds no height tiles finer than its 6 km stops need, so its pages stop at coarse levels, and on those the sea
floor read 10 m everywhere (depth diagnostic, below). The Tel Aviv run with the old floor rule showed the mechanism:
the depth the water read under the camera ramped from 17 m at 800 m to 34 m past 1.1 km, nearer reads using finer
pages.

*Cause.* `shapeTerrain` shaped the sea bed from the page's own shore distance, which stops at the band, 32 texels: 15.6 m
on a level 16 page, 250 m on a level 12 one (Leixões). A bed falling toward 10 m from the shore is then a property of
the page level: one open-sea point off Leixões built to 10.0 m (level 12), 9.6 (13), 7.9 (14), 5.4 (15), 3.2 m (16).
Every reader picks its page level by distance or pixel footprint from the eye (the terrain mesh's LOD, the water
mesh's rings, the field reads), so the sea floor rose toward the camera in steps: a bright shallow disc of visible bed
under the camera, a darker band where the floor fell away, then the reflection growing with distance. The evening fix
of 3 November (the floor limit only within 12 m of the shore) removed one instance of this (page-shaped patches); the
bed curve itself kept it.

*Reproduction* on the Leixões fixture (all levels built), `Test-River-Overflow --layer --profile` with new open-sea
views (`--open-at lon,lat,heading`, views `open<height>`: over the open sea, looking 35 degrees down toward a low sun).
The water's depth under the camera (the ocean target's clearance) ran from 5.4 m near to 10 m beyond about a kilometre;
from 400 m up the water's brightness fell from 82.6 to 77.6 between 680 m and 1,075 m and then rose with the
reflection: the band (`part2/ring/leixoes-open400-before-after.png`, top before, bottom after).

*Fix* (`water-layer.js`, `resample.js referenceGrid`): the bed reads a shore distance every page level agrees on. Within
9 m of the shore, the page's own exact distance (every level's band holds 15 m); past 15 m, the *reference* distance:
exact at the texels of the level 11 ancestor page (`WATER_REFERENCE_LEVEL`, 15.6 m nodes), out to `WATER_FAR_REACH` =
200 m, bilinear between nodes; blended between 9 and 15 m. Any page computes a node from the same positions (the
ancestor's own mapper and integer texels) and the same pieces (cut at a quarter node), so pages agree. Pages of level 11
and coarser use their own exact distance (their band is 500 m or more). The source sea's box reaches 200 m beyond fine
pages so the reference finds the same shores. The bed curve is unchanged (`SHORE_SLOPE`, the body's depth); its input
no longer depends on the level. The reference grid is built only on a page with water more than 9 m from its shore.

*Gates.*

| Gate | Before | After |
|---|---|---|
| `Test-Water-Bed-Levels` (new): depth spread over levels 12-16 along 2 km from the shore, Leixões | 6.75 m | 0.009 m |
| same, Douro mouth | 6.75 m | 0 m |
| Drawn depth (ocean clearance) over the open sea, every view (Leixões x 5, Douro x 2) | 3.6-5.4 m near, 10 m far | 9.93 m flat |
| Brightness dip outward (`worstDip`, limit 4 codes): Leixões 1 at 100 / 200 / 400 m | 2.0 / 7.0 / 5.2 | 1.8 / 1.6 / 0.8 |
| same, Leixões 2 at 150 / 300 m | 56 (at the fixture's placeholder) / 3.2 | 0.9 / 0.9 |
| same, Douro central columns at 200 / 400 m (coast at 600 m: the ramp barely shows) | 1.8 / 1.0 | 1.1 / 0.8 |
| CPU terrain gates, 4 fixtures (ground over water, pits beside water, steep ground near water) | 0, 1-345, 0-1.2% | unchanged (pits within 2) |
| `Test-Water-Layer-Logic`, `Test-Field-Logic`, `Test-Earth-Structures-Logic` | pass | pass |

Not reproduced: the owner's exact picture (live data, unrecorded place). Whether its sharp outer edge was a page
level switch in the bed or the other hard switch on this path (the bed model at 0.5 m footprint, `water.wgsl`: the
procedural refracted bed below, the shaded ground pixel above) is not known; with one depth both read alike and the
profiles show no step over 2 codes there. The tour replay cannot show fine pages; a fixture with recorded imagery
cannot be made (no imagery requests from tools).

*Tools.* `tools/Test-Water-Ring.mjs` (Earth tour: heights x views, brightness against the eye's distance, step and dip),
`tools/Water-Ring-Lib.mjs` (shared profile), `Test-River-Overflow --profile [--profile-columns a,b] --open-at`,
`tools/Test-Water-Bed-Levels.mjs`, and private diagnostic bits in the existing `cloud_diagnostic` word (now up to 2^24):
65536 bed trust x4 farther, 131072 image x4, 262144 surface bed's unseen x4, 524288 no relief clearance, 1048576
water pages one level finer, 2097152 the water pass's surface footprint / 4, 4194304 no caustic focus, 8388608 the
depths the water pass used painted into the water target (`water.wgsl`).

### 2. Shoreline flicker while moving: partly

Shadow-only flicker (Wupper, 12 degree sun, `--shadow-diagnostic 1 --flicker`, moving 3 cm a frame), moving pixels near /
bank: baseline (old path) 152 / 94; committed layer 389 / 171; with the fixes above 409 / 170; with the swash band in
the layer's coverage 403 / 146 (`part2/flicker/`). The extra pixels over the baseline lie along a pond's shore at the
frame's left edge (138) and a terrain shadow edge on the far bank (107 -> 173).

- *Kept:* `water_layer_coverage` never draws an edge narrower than `WATER_SWASH` (0.25 m): a water's edge is a swash
  zone, and a one-pixel edge close up crawls; the water fragment is clipped half that band past the shore, not one
  pixel. Small gain (bank 170 -> 146).
- *Tried and rejected:* the same band on the edge where the water's surface meets the ground inside the map's water,
  from the clearance and its change toward neighbours: 409 -> 1,516 pixels. The clearance under a moving eye is not
  stable at a waterline: it is the water mesh's surface against the terrain mesh, two meshes morphing with the eye's
  position, and beside still water the ground is filled to 0.1-0.2 m over the level for several metres, so a centimetre
  of either mesh's morph moves their intersection by decimetres.
- *Open:* that intersection decides the visible waterline close up wherever the terrain mesh, at its LOD, stands over
  the water surface inside the map's water. The map's distance is stable; the meshes' crossing is not. A waterline from
  the layer (claim water where the layer says wet and the ground lies within the terrain's LOD error of the level) is
  the next thing to try; it must keep the owner's "water climbing walls" fixed.

### 3. Settling after arrival: not reproduced; now as the baseline

The `--settle-trace` of 3 November counted telemetry rows, not frames, and started after the whole arrival loop: a batch
of buffered rows ended it at once. It now follows every frame by id from the start of arrival. 1920 x 1080, coast views
(`part2/settle/*-u-*`): frames with scheduling over 1 ms after the last page upload, and over the whole arrival:

| Build | Douro after last / whole arrival | Leixões after last / whole arrival |
|---|---|---|
| Baseline (old path, :5201) | 2 / 158 frames, 853 ms | 27 / 247 frames, 1,380 ms |
| Committed layer | 25 / 186 frames, 1,027 ms | 16 / 235 frames, 1,314 ms |
| Layer now | 2 / 159 frames, 851 ms | 16 / 237 frames, 1,318 ms |

The "about 270 frames against under 150" was the row count. The committed layer's extra 28 busy frames at the Douro are
gone with the fixes above (one bed at every level, crack-free rings).

### 5. Flanders at 6 km: cause found (water atlas eviction), not fixed

`Test-Earth-Shore` flanders-6km, water over ground the field calls dry, depends on the views before it: alone or after
Geneva, Levant and Crete 234-316 pixels; right after somme-6km (the full run's order) 5,370 on the committed layer and
4,068 now (old path 12; the test's limit is 0.3% of the image). The marks (`part2/shore-marks2/flanders-6km-marks.png`)
lie on the polders near the French-Belgian border, where the water hardly shows (it lies at the polders' own level).
The water atlas holds 225 pages; after the Somme, 467 pages want a water layer and 175 have lost their slot (first come,
oldest out). A page that lost it reads a coarser page's water, and with no map in the tour that is the source's sea,
whose contour at the coarse page's DEM zoom takes in the low polders; the surface pass, reading a finer page that kept
its slot, says dry. In live use the map's ocean polygon leaves the polders out. The general fault stays: what a page
shows depends on which pages kept a water slot. Next: give water slots by need (the pages the view reads at their own
footprint before coarser ones, and a page whose coarser fallback agrees with it last), size the atlas per tier (item 8),
and build the source sea from one DEM zoom at every page level where it stands in for the map.

### 6. Far field: the water mesh to about 1,100 km; the lifted ocean only fills what it leaves

- *Eighteen rings* (`WATER_RINGS`, `renderer.rs WATER_MESH_VERTICES` 248,832, from 165,888): the mesh reaches about
  1,100 km at a face centre. Rings past one and a half horizons are dropped before any page is read, as before.
- *Large cells on the sphere* (`ocean_fragment`): a fragment of a cell whose chord sags more than 2 cm (cells over about
  1.4 km) moves along its ray onto the sphere at the cell's level, before the shore clip (at a grazing angle the chord's
  point lies kilometres farther along the ray, past a far coast). The cell decides where water is drawn, the sphere where
  it lies. This is what failed with eighteen rings on 3 November: the sea floor over shelves stood over the chords.
- *The hand-over* (`lifted_ocean_yields`, `water_mesh_cell_of`): close up (cells under 1.4 km) the lifted ocean yields
  exactly where the mesh keeps the cell holding the fragment, by the same test (`water_mesh_cell`) of the same cell; it
  asked before whether its own, finer page carried the layer, and where the cell's coarser page had none neither drew.
  Farther, a cell's triangles and its fragments' places along the ray fall in different cells at a grazing angle, so no
  test of the place can say what the mesh drew: both draw there, the lifted ocean pushed back by a hundred-thousandth of
  its depth, and the mesh, on the sphere and nearer than any chord, wins wherever it drew.
- *One answer about the layer* (`water_layer_entry`): where neither a page nor the coarser pages walked on eviction
  answer, the finest page resident at the point does, for every caller (it did only for pinned pages). Over the morph to
  the coarser ring a vertex reads a page one level coarser than its cell's test, and a vertex that found no layer had
  collapsed its triangles (a whole ring of sea without a surface).

`Test-Earth-Sea-Cover` (deep sea with no water surface; `part2/sea-cover-far5`, holes in red with `--overlay`):

| View | Old path | Committed layer | Now (two runs) |
|---|---:|---:|---:|
| med-5000km / 1500km / 600km / 200km | | 34 / 25 / 5 / 7 | 34 / 20-62 / 1 / 1-6 |
| med-60km / 20km / 5km / 1km / 100m / 10m | | 11 / 1 / 0 / 3 / 175 / 348 | 7-10 / 1 / 0 / 0 / 0 / 0 |
| atlantic-1500km / pacific-disc | | 0 / 9 | 0-32 / 9-13 |
| Total (pass) | 39,932 (fail) | 618 (pass) | 113-117 (pass) |

With the mesh alone past 16 km (before the lifted ocean filled behind it) the holes were 1,309 at 200 km and 804 at 60
km, slivers on the sea side of far coasts: the mesh draws all but 0.2-0.3% of the far deep sea. Atlantic-1500km's 32
lie in one small patch (922-939, 536-539).

`Test-Earth-Shore`, all views in order (`part2/shore-all-*`), committed -> now: water left dry 55 -> 76 pixels in total
(limit 0.1% per view; most at Flanders 40 -> 44 and Crete 11 -> 13); Lake Geneva's known water drawn dry 108 -> 84 of
17,389; water over ground the field calls dry rises at the far lake views (geneva-along-15km 0 -> 296, 30km 0 -> 280,
tel-aviv-20km 128 -> 270; 0.03% of the image, under the 0.3% limit) where the mesh now draws far lakes, and falls at
Flanders (5,370 -> 4,068, item 5). The two Geneva pictures differ in 150 pixels by more than 12 codes. Both builds fail
the test as a whole, as the committed one did: Flanders' water over dry ground (item 5) and geneva-along-15km's known
water drawn dry (74 -> 50 of 2,799, limit 1%).

*Cost.* GPU water stage, 1920 x 1080, 300 frames after 300 settling frames, quiet GPU (no other process on the 3D
engine before or after), interleaved rounds, ms p50 / p95 / p99 (`part2/timing*`):

| View | Committed layer | Now | Old path (phase 0, settled) |
|---|---|---|---|
| Douro coast | 5.72-5.93 / 6.01-6.08 / 6.06-6.14 | 6.74-6.78 / 6.85-6.91 / 6.87-6.97 | 5.90 / 6.02 / 6.06 |
| Douro far | 1.20 / 1.23-1.45 / 1.44-1.46 | 1.33-1.34 / 1.58 / 1.60-1.61 | 1.24 / 1.25 / 1.49 |
| Leixões coast | 6.69 / 6.85-6.86 / 6.90-6.91 | 6.94-6.95 / 7.11 / 7.14-7.16 | 7.16 / 7.33 / 7.38 |

Bisected at the Douro coast: the committed WASM with today's page builder already costs 6.67-6.70 ms, and today's
shaders with the committed beds 5.97. The water stage's extra time comes from the sea bed itself: 10 m deep under the
camera now, 3 to 5 m on the committed build's finest pages (the ring's cause). Not the eighteen rings, not the far
overdraw (attribution bits 131072 and 2097152 in one build: 6.72-6.75 ms in all four combinations), not the caustics
(0.14 ms with either bed), not more terrain (1,145,856 triangles, 2,238 patches in both). Terrain shading also rises
(3.41 -> 3.59 ms p50). Open: which per-pixel work grows with the depth under a pixel (the refracted screen march runs
longer before it meets a deeper bed; the light shafts' samples). The Leixões coast stays faster than the old path; the
Douro coast is 14% slower than it.

Not done: the lifted ocean, the sea index list and `WATER_EXCESS_FLAG` stay. They draw past the mesh's reach (from
orbit the eye's face chart cannot hold the visible disc) and fill its slivers. Removing them needs a far surface that
is not a mesh: the sphere at the layer's level per pixel, with coverage from the coarse pages, in the water pass.

### 7. River levels: steps removed, the fall still too steep; flow cap kept

`rivers.js`: after the isotonic fit, smoothing and bank limit, each reach between its fixed nodes (confluences, ends,
tile edges) falls no faster than `RIVER_SLOPE_LIMIT` for its class (river 0.4%, canal 0.1%, stream, drain and ditch 3%):
every level is held in the band its ends allow, then a pass from the upper end keeps each step within the limit; a
reach whose ends fall faster than that over its whole length falls evenly between them (`evenReaches`). Segment slopes
of rivers 8 m and wider (`scratchpad river-slopes`, the fixtures' networks):

| Fixture | Segment slope p50 / p90 / p99 | Reach slope p50 / max |
|---|---|---|
| Wupper, before | 1.55 / 4.56 / 10.4% | 2.03 / 4.10% |
| Wupper, after | 2.14 / 2.35 / 3.79% | 2.14 / 2.35% |
| Rhine, before | 0.01 / 0.83 / 3.98% | 0.01 / 2.89% |
| Rhine, after | 0.01 / 0.91 / 1.81% | 0.01 / 2.89% |

The steps are gone (p99 10.4 -> 3.8% on the Wupper), but 21 of the Wupper's 28 reaches fall faster than 0.4% between
their fixed ends, so they now fall evenly at about 2%, where the Wupper falls a few tenths. The fixed nodes' levels come
from probes of the z13 DEM at the node (mean of seven along the source segment at a tile edge, of four along the reach at
a confluence), which in a narrow valley read the valley's sides. So the flow cap (`RIVER_FLOW_SLOPE` 0.2% for rivers 8 m
and wider) stays: at 2% a river would run white from bank to bank. Next: the fixed nodes from a longer reach (the lowest
water-like DEM along the line over a few hundred metres, the same points from every tile), then the cap can go.
Gates: `Test-Earth-Structures-Logic` (fixed endpoints, monotonic reaches, tile and page continuity), `Test-Field-Logic`
80/80, `Test-Water-Layer-Logic` 8/8 pass.

### 8. Costs

- *Page builds:* the reference distance (item 1) costs 0-18% more at p50 per page with water past 9 m from its shore
  (`Bench-Water-Pages --modules`, serial, warm; e.g. Leixões 12: 31.6 -> 37.1 ms, Douro 12: 29.7 -> 34.5 ms, Wupper 14:
  24.9 -> 29.9 ms; the old path in the same runs moved by up to 30%, `part2/bench`). The new pipeline was 1.0-2.0x the old
  path before; with this it is up to 2.2x. Not optimised: a page at level 12 builds a 166 x 166 node grid; nodes could be
  shared by the pages of one level 11 area.
- *Water stage:* see the timing table under item 6 (`part2/timing*`).
- *Water atlas per tier* (`pages.rs water_slots`): 225 pages (about 128 MB) on the full and reduced tiers, 120 (eight rows,
  about 69 MB) on the minimal tier, whose height pool holds 675 pages. Too few slots is item 5's fault; the memory the
  height atlas recovers in phase 6 (R32 back to R16, about 160 MB on the full tier) would pay for a second water layer.
- *The default path* (layer off) still pays the layer's checks (0.24 ms at the Douro coast); it goes in phase 6.

### 9. Coarse pages without the map's streams: keep z(level + 1)

OpenMapTiles leaves streams, drains and ditches out below z13, so a level 11 page (z12 lines) lacks the streams its
level 12 children (z14) have. Reading z(level + 2) would ask four times the vector tiles at levels 7-11. A level 11 texel
is 15.6 m at a face centre and a stream is drawn 3 m wide (`rivers.js` class widths: stream 3, drain and ditch 1.5): its
box-filtered coverage is at most 0.19 of a level 11 texel, 0.1 for a drain, and the pixels that read level 11 pages are
about that size. Rivers and canals are in the z12 tiles. The difference shows when the level 12 page arrives: a stream
fades in over 40 frames (`measured_water_fade`), not a pop. Decision: keep z(level + 1); the four-fold requests buy lines
a fifth of a pixel wide.

### 4. Deep sea with no surface under the camera at 10-100 m: fixed

The water mesh's ring borders cracked. A ring snapped to twice its step reaches only n/2 - 2 steps past the eye on its
far side, but its morph toward the coarser ring finished at n/2; and each vertex read its waves and its page at its own
cell's spacing, so two rings (or two cells of one ring) sharing a vertex placed it differently. Now the morph completes
at n/2 - 2, and a vertex's spacing is a function of its key and the ring's step alone (`water_mesh_point(face, key,
step)`), blended to the coarser ring's 2 x step over the morph, so at a border both rings compute the same point bit
for bit. `Test-Earth-Sea-Cover` med-1km / 100m / 10m: 3 / 175 / 348 -> 0 / 0 / 0 deep-sea pixels without water. The
scattered dark dashes on the sea in the Somme captures at 50 m (`part2/ring/somme-layer/h50.png`) were these cracks.

## Part 3 (4 November 2026): the owner's first flight with the layer on by default

At the owner's request the explorer now opens the solar system with the water layer (`?water=old`, `?body=earth`,
`?body=procedural` for the rest; DECISION.md). Their first flight reported water through hills, sudden deep shelves in
bays with a hard edge, wet-looking terrain and distorted terrain over water from altitude that never resolved
("everywhere, as if some stale cache"), and a polygonal water edge close up. Evidence under
`$SOLAR_DATA/water-layer-2026-11-03/part3/`.

*The solar path is not the cause.* `tools/Test-Solar-Water-Match.mjs` renders one Earth-fixed camera through the
solar path and through `?body=earth` (same sun, clouds off, solar clock stopped): mean differences 0.16-1.33 levels of
255 at five water views (`solar-match1`). Its `--earth-only` mode renders low cameras, which the solar craft does not
hold (one asked for 30 m over the sea ended 1.3 km under it). The dev server sends `no-store` and the tile store holds
raw tiles, not built pages: no stale cache either.

*Water through hills, slivers over the sea's horizon: fixed.* Far cells of the water mesh are flat chords whose
fragments `ocean_fragment` moves onto the sphere; a cell just past the horizon is seen from under its own chord, and
its back face was shaded as water seen from below: dark slivers along the sea's horizon (Lisbon and Somme at 6 km), a
light band of water over the foot of hills beyond the sea (Liguria at 30 m: 429 pixels; the owner's first picture).
Shown by the G-buffer at those pixels (back faces at 250 km with 3.5 km of sea under them) and by capping the mesh at
twelve rings (attribution bit 131072), which removed them. A fragment moved onto the sphere now takes the sphere's
facing (the eye above or below its level). Before / after: `horizon-before-after2.png`,
`ligulow-horizon-before-after.png`. Also fixed in passing: a mesh vertex whose page carried no layer stood at the eye
(a zero position), so its cell's triangles ran from the camera to the cell; it now stands at the level its cell's middle
found.

*Sudden deep shelves in bays: one cause found and fixed.* `tools/Test-Water-Bed-Seams.mjs` builds a block of pages
of one level and compares the eight texels each pair of neighbours shares (same ground on both): the ground under water
must agree within 0.1 m. In the Douro estuary two neighbours disagreed by 2.5 m: same point, same shore distance, same
body, but the bed's depth came from the nearest network segment, and each page builds its network from the features
near it, so one page read the Douro (485 m wide, 3 m deep) and its neighbour a 1.5 m stream running into it (0.45 m):
a straight underwater wall along the page border, and the same switch inside pages wherever another segment became the
nearest. A mapped river's bed now falls as deep as its shore distance allows (half its width at most) to 3 m
(`RIVER_POLY_DEPTH`), never by segment; a channel with no polygon keeps its segment's depth. The river level's node grid
now ends one texel past the page, where the neighbour's node stands (its last node was clamped to the last texel, not
shared). Ground under water across page borders, worst of levels 13-16, before -> after: Douro mouth 2.55 -> 0.001 m
(pass), Douro upstream 2.49 -> 0.28 m, Leixões harbour and shore 0.001-0.005 m both (pass). The 0.28 m left is the
bed following a 0.3 m step in the river's level between pages (each page fits its own network's levels: the open river
level item). `Test-Water-Bed-Levels` still passes (spread across levels 0.016 m).

Not fixed, found at Emosson (tour stop): a bright rim where the reservoir's map outline borders ground lower than the
lake outside it; the water stands over it as a wall (`emosson-depth/crop.png`, depths painted with bit 8388608). The
old path softened it with its water texels.

*Water that never resolved: the water atlas gave its slots first in, first out.* At a shore 6 m above Lake Geneva 233
pages carried water for 225 slots; the slot taken was the oldest, usually a page under the camera, and a harbour 46 m
away drew water on some runs and none on others. A page that loses its slot keeps reading coarser water until its
height page reloads. Now (`pages.rs write_water`) the slot taken is the one the view needs least: a page no longer
wanted, else the least urgent wanted page in the stream's own order (`Stream::wanted`), and never one more urgent than
the page asking, which then goes without. `Test-Earth-Shore` in its full order: Flanders' water over dry ground 4,068
-> 197 pixels, under the limit (item 5 of part 2); the test still fails on geneva-along-15km's known water drawn dry (74 of 2,797; 50 to 74 across part 2's runs and the committed build).

*Wet-looking terrain from altitude: not reproduced.* The tour replay holds one map tile, so its valleys carry no mapped
streams; the Rhône from 8 km is a light line because it is 80 m wide. The owner's place is needed.

*The water's edge close up: the shore's own variation.* The map's coastlines are straight segments. Within 5 m of the
shore the page's signed distance now moves by two octaves of value noise anchored to the ground (about 17 m and 5 m
wavelengths at 45 degrees, up to 1.8 m and 0.6 m; `water-layer.js shoreWiggle`), each faded out where a page's texel
is too coarse for it, a quarter as far on rivers. It is in the page, so the bed and banks follow it and the GPU's clip
and coverage read it: a GPU-only version tried first could only cut into the water, as the bank stood over the water
where it moved out. Before / after: `edge2-edgedown-before-after.png`. `Test-Water-Layer-Logic` accounts for it (8/8).

*Gates and cost (final build).* Sea cover passes (71 holes over the twelve views; 115 after part 2). Douro coast water stage, 1920 x 1080, 300 frames, quiet GPU, ms
p50 / p95 / p99: before this round's changes (same session) 6.76-6.78 / 7.64-7.65 / 7.72, now 6.48 / 7.38-7.44 / 7.44-7.47 (the shore variation is built into the pages, the GPU reads nothing more; the river beds changed under the camera). The native Vulkan probe passes (ground view, audit balanced, no excess).
`Check.ps1` passes.

## Next steps

After part 2 (4 November 2026; the next session's prompt is `docs/NEXT-CONTEXT-WATER-3.txt` (development repository only), the
original order and traps are in `docs/NEXT-CONTEXT-WATER-2.txt` (development repository only)). First, the water stage's cost under
deeper water (item 6's timing); then:

0. *From part 3:* the owner's places for the wet-looking terrain from altitude and the shelves (a fixture there with
   `Record-Water-Fixture.mjs`: map and DEM only, never imagery); the river level step between pages (0.3 m in the Douro
   estuary, `Test-Water-Bed-Seams`), which is item 3 below; the rim where a lake's outline borders lower ground
   (Emosson); an evicted page asking for its water again when a slot frees (it reads coarser water until its height
   page reloads).
1. *Water slots by need* (item 5): part 3 takes the least needed slot (`Test-Earth-Shore` full order: Flanders under
   the limit). Still to do: a page whose coarser fallback agrees with it gives way first; the source sea from one DEM
   zoom at every page level where it stands in for the map.
2. *The waterline close up* (item 2): decide it from the layer, not from the water and terrain meshes' crossing; keep
   the walls fixed (owner's report of 3 November). Gate: shadow-only flicker against the baseline's 152 / 94.
3. *River levels* (item 7): fixed nodes from a longer reach, then drop `RIVER_FLOW_SLOPE`. Gate: Wupper reach slopes
   under 0.5%, no white water in the fixture views at the default flow.
4. *The far field without the lifted ocean* (item 6): the sphere at the layer's level per pixel in the water pass, with
   coverage from the coarse pages, past the mesh's reach and from orbit; then the lifted ocean, the sea index list and
   `WATER_EXCESS_FLAG` go (phase 6).
5. *Page build cost* (item 8): share the reference grid between the pages of one level 11 area.
6. Phases 4 to 6 as in the hand-off: spectral waves with shoaling (the layer now gives one depth at every level: the
   bed is the same function of the true shore distance on every page), close-up water, then removal of the old path and
   the height atlas back to R16 (which pays for a second water layer).
7. Owner-side: the layer is on by default since 4 November 2026 (`?water=old` for the old path); the owner's own look
   at the ring fix on live data is the test the replay cannot give (fine height pages near a coast). Earth tests now run
   the layer without `SOLAR_QUERY`; the old path takes `SOLAR_QUERY=&water=old`.

## Evidence index

- `$SOLAR_DATA/water-layer-2026-11-03/phase0/base/` baseline suite (legacy judge), `summary.json`, images
- `$SOLAR_DATA/water-layer-2026-11-03/phase0/base-truth/` baseline coverage classes, canonical judge
- `$SOLAR_DATA/water-layer-2026-11-03/phase1/measure/<fixture>/report.json` page gates
- `$SOLAR_DATA/water-layer-2026-11-03/phase1/render/*.png` CPU top-down, old | layer
- `$SOLAR_DATA/water-layer-2026-11-03/part3/` part 3: `solar-match*` (solar against Earth path), `low-*`,
  `edge*`, `seams/` (before / after per place), `sea-cover2`, `shore2`, `timing/`, `web-before` (the build before part 3,
  pack linked)
- `$SOLAR_DATA/water-layer-2026-11-03/part2/` part 2: `ring/` (Earth tour and fixture ring profiles, before /
  after images), `sea-cover-*` (with `-holes.png` overlays), `shore-*` (`-marks.png`), `flicker/`, `settle/`, `timing*/`,
  `bench/`, `measure-banks/`; `web-head` (the committed build, serve with `node tools/serve.mjs --port 5212 --root ...`)
  and `web-prefloor` (the afternoon's sea-floor rule, for the ring search)

## River skins at the Wupper (5 November 2026, open)

Owner's report: a river shows two water skins, one standing above the other, and from the side a water wall at the first LOD transition. Reproduced with live data at the Wupper bookmark (`tools/Inspect-River-Skins.mjs --live`, views `low-15-west` and `low-6`, camera 6-12 m over the south bank looking north). Findings, with the depth paint (`cloud_diagnostic` 8388608) read back raw at river pixels:

- **Two surfaces, one per mesh ring band.** The river is drawn by the water mesh only (forcing every lifted-ocean fragment to discard changes no pixel). Its outer rings draw the far half of the river with 3.3-5 m of clearance above their ground; inside a ring boundary (the diagonal seen on screen) no mesh fragment survives and the water pass shades the terrain under it as water. The near water stands about 0.1 m over the rendered terrain while the page's bed is 4.5 m lower: the rendered terrain there is not carved to the bed the water layer assumes.
- **Levels differ with the page that answers.** Bed plus depth gives about 105.4 m for the near river and 108.4 m for its far half: a 3 m step across one river. Pages at level 13 and finer fit river levels on the fixed z13 DEM; a level-12 page reads z13 lines and so fits on z12 (`coarseRiverDemZoom`), coarser pages coarser still; and every page fits only the nodes inside its own tiles. The same river therefore stands at different levels on different page levels.
- **Ruled out:** the finest page has the layer and the river at these pixels (slot present, shore distance -4 to -13 m); the cell keep test and the fragment shore clip are not what removes the near mesh (disabling either changes no near pixel); per-ring page choice for vertex levels alone (finest resident page) changed no pixel; water slot eviction (0 evicted with 450 slots, same image); the relief clearance override.
- **Changed anyway:** the full tier now holds 450 water pages (two atlas layers, +125 MB) instead of 225. At the Wupper the live view wanted 300-630 water pages and evicted 91-403; an evicted page reads a coarser page's water, which is the same cross-level mismatch. With 450 slots the same views evict 0-3.

Next: make a river's level a function of position, not of the page answering (one network solve per region on the z13 DEM, sampled by every page level, or the mesh and the water pass reading levels from one page), and find which terrain LOD under the near rings is left uncarved. `Inspect-River-Skins.mjs` with `PROBE` and `CONFIG` reproduces the numbers above.

## River levels under their banks (5 November 2026, evening)

Owner's report after the section above: the rivers and streams next to the spawn still fly (doubled up, walls from the
side, stepped sheets at a confluence). Reproduced live at the spawn (`Inspect-River-Skins.mjs --live`, view `a-w`:
`VIEWS='[["a-w",7.1284,51.1396,"+120",270,-0.3]]'`; `QUERY=` now replaces the whole page query, e.g. the default page
`test=1&view=wupper&quality=high`). The probes found the cause, and it is not the LOD hand-over: **the river's level
stood 4-5 m over its own floodplain** (water 101.5 m, bed 99.3 m, grass on the near bank 96.7-97.3 m), and the terrain
was *filled* up to it (`shapeTerrain`, up to `FILL_LIMIT` 2 m beside the water): a raised channel with walls.

The old fit had two ways over the banks: a level was clamped only 1.5 m over a bank probe (`RIVER_CAP_SLACK`), and a
reach whose fixed ends fell faster than its class limit fell in a straight line between them whatever the ground did
(`evenReaches`, 21 of the Wupper fixture's 28 reaches). Fixed nodes took the *mean* of their probes.

`rivers.js` now (header comment and `riverProfile`):

- **Profile:** between fixed nodes, the running minimum of the targets (lowest centre probe, lower bank probe less
  `RIVER_FREEBOARD`) from the upper end, held at the lower end; then the mean over a window reaching only downstream
  (`RIVER_SMOOTHING` metres). For a profile that never rises, that mean can only lower it: never above a target, never
  rising, both ends kept. Checked on 20,000 random profiles (excess 0, rise 0, ends exact). `RIVER_CAP_SLACK`,
  `RIVER_SLOPE_LIMIT` and the even fall are gone; `RIVER_FLOW_SLOPE` (water-layer.js flow) stays.
- **Fixed nodes:** the lowest of their probes, not the mean (tile-edge nodes: the same seven points from both tiles).
  A confluence in the middle of a line (a tributary ending on a river's line) now reads both ways along it; and a
  confluence or free end is no higher than the targets within `JUNCTION_REACH` (250 m) along each reach it is the
  lower end of. Not along reaches running out of it: on a steep stream that took a confluence 12 m under its ground.
- **Streams entering a river polygon:** a node is bisected where the line enters it, and the stream's nodes inside
  stand at the confluence's level; `levelAt` prefers any other line over a stream's segment inside a river polygon
  (`inRiver`). Before, the stream's own falling level and its steep reach slope (white water) filled a wedge of the
  river up to 0.7 m over it (live, a confluence at 7.1240, 51.1400).
- **Counted, not hidden:** `heldOver` / `heldOverMax` (a level over its target where the ground dips under the lower
  fixed end), `inRiver`. Wupper fixture: 3 nodes, at most 0.91 m (a canal between two tile-edge nodes; was 20 and 1.76 m
  with three-node junctions).

Evidence (`$SOLAR_DATA/river-rework-2026-11-05/`; old = this morning's `rivers.js`, `web-before/`):

| Wupper fixture, 3 x 3 pages (`Measure-Water-Pages`, `measure/old`, `measure/final2`) | L12 | L13 | L14 | L15 |
|---|---|---|---|---|
| Dry texels filled up to the water (new counter), texels / metres | 1,124 / 1,195 -> 150 / 47 | 4,694 / 4,978 -> 677 / 189 | 15,217 / 16,464 -> 1,673 / 470 | 14,621 / 16,495 -> 2,836 / 746 |
| Bank texels under the level (pits) | 261 -> 39 | 455 -> 25 | 480 -> 4 | 282 -> 0 |
| Ground at or over full water | 0 -> 0 | 0 -> 0 | 0 -> 0 | 0 -> 0 |
| Level steps over the reference, p95 / p99 m | 0.11 / 0.11 -> - | 1.59 / 2.36 -> 1.69 / 1.94 | 1.91 / 3.48 -> 2.02 / 3.86 | 1.25 / 1.77 -> 1.61 / 2.70 |

Wet/dry classes (0 / 0 / 71 / 432) and page-level agreement (level p95 1-1.3 cm) are as before. Steps are a little
larger at L14-15: the level now falls where the ground falls. `Test-River-Overflow --layer` (Wupper, `overflow-old`,
`overflow-final`): the wide reach's level 102.60 -> 97.83 m; spill 1/0/0/0/0 -> 2/1/0/0/0 px; dry 10/10/5/63/13 ->
2/2/17/0/0 (far view worse by 12 px); arrival spill max 32,385 -> 35,654. Live at the spawn (`nocar/`, `final/`): the
raised ribbon, its walls and the confluence wedge are gone; the river at `a-w` stands at 97.0 m under 97.3-98.0 m banks.
`Test-Earth-Structures-Logic`, `Test-Water-Layer-Logic` 8/8, `Test-Field-Logic` 80/80, `tools/Check.ps1` pass.

Open:

- **Hillside streams** (35% slope, 3 m wide) still show as white pieces with gaps from 60-120 m, unchanged from the old
  levels (`old-gully`, `new2/gully-60`): the terrain mesh there is coarser than the channel. Letting the shading claim
  the terrain as water inside the shore (`field_water_here` with the shore distance as allowance) changed no pixel,
  so it was reverted; not found yet.
- A capture of the confluence view in a sequence of views showed teal bands on both banks (`final/down-c`) that a
  fresh capture does not (`final-rerun/down-c`): pages still arriving (the view hit the 3,000-frame cap); not chased.
- The live z12-DEM step between page levels (section above) is not reproducible on the fixture (its coarse DEM is a
  box filter of z13); the levels on every page level now stand under that page's own ground, which bounds the step to
  the DEMs' disagreement.
- Shallow rivers read beige (the bed's sand through 1-1.5 m of clear water): shading, not levels.

## Terrain-owned river rendering (9 November 2026)

The owner still observed an elevated duplicate and chose to keep the working terrain-based river appearance.
Mapped rivers (`kind == 3`) now discard in both independent ocean/water-mesh surface entry points and their
near-plane cap. The terrain water pass remains responsible for river coverage at every LOD. Lakes and oceans
retain their independent surfaces. This removes the duplicate surface rather than solving the remaining
cross-page river level differences; the river profile and bed work above remains intact.

Live browser captures at the Wupper spawn, 120 m and 300 m above terrain looking west, are in
`evidence/local/river-flight-fix-2026-11-09/{before,after}/live/`. These are two inspected poses, not exhaustive
LOD/streaming coverage. Thin hillside channels can still break up when their width is below the displayed terrain
resolution. See `docs/DECISION.md` for the deliberate river surface ownership choice.

## Interactive ripples removed (16 November 2026)

The owner removed the interactive ripple simulation: the 512 x 512 wave-equation chart, its pressure sources (camera
contact within 2.5 m of the surface, the R key, the "Disturb water" button) and the "Physical ripples" setting.
Nothing pushes water since the car went. The chart itself stays (`WaterChart` in `water.wgsl`, `water_chart_prepare`):
it follows the eye, keeps the water level under it in `lo.w`, and keys the wave cache, the advected foam
(`water_foam_step`) and the coastal bed. River ripples (flow-mapped noise in `sea_wave`) are a different feature and
are unchanged. Numbers and evidence: [FRAME-COST-PASS-2.md](FRAME-COST-PASS-2.md) "Changes kept".

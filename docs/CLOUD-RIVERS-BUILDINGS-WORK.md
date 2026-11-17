# Clouds, rivers and buildings — local rework

## Water seams and underwater light (3 November 2026, fourth pass)

Owner: where two bodies of water meet the water goes down in a trench at the
seam; underwater the sun rays move with the camera and look like a wall of
caustics, and caustics jitter while the camera moves; some shadow flicker left.

**Seams: causes and fixes.**

- A map polygon's bed rose to the surface at every edge, including edges shared
  with other water. Shore edges with water on their other side (another polygon,
  or the source's sea: a point 1.5 m out, on the side the polygon does not hold)
  are now wet edges (`map-water.js`): distances for beds and banks are to dry
  edges only, and a texel just outside a polygon within `gap` (3 m, or 1.5
  texels) of its wet edge takes that polygon's water, so the seam is wet on both
  sides. Logic test: two lakes sharing an edge, 2 units apart.
- The source sea's beach shaping ran under map water too, and stood up as a
  ridge to the surface where a lagoon, estuary or harbour polygon reaches past
  the source's shoreline. It now leaves texels the map's water owns alone.
- On the GPU the water level read height plus excess through the spline over
  every texel, dry ones included; a dry texel's excess is held under its ground,
  and where that ground lies low (two carved beds at a seam) the surface sank
  into a trench toward the shore. The level now comes from the wet texels alone,
  weights renormalised (`page_water_read`); the excess still decides where water
  is. A first version of the gap rule took a polygon's water anywhere within a
  bin of its wet edge (a 200 m rectangle at the Leça mouth, Leixões fixture);
  it is now limited to `gap`.

**Underwater.** The fine wave cache's 64 m window followed the eye exactly, so
its grid slid under the water and every frame resampled the waves at shifted
points; caustics, a reciprocal of the sampled curvature, shimmered. The centre is
now snapped to the window's own texels (`fine_center`). The chart itself still
re-anchors on the eye every 32 m (unchanged). Light shafts integrated the focus
field at three points along the view ray, three slices of the caustic pattern
moving with the camera; they now take ten samples, offset per pixel by a fixed
dither, of the coarser level-2 field with a wider focus width, which integrate into
shafts. Evidence is weak: in a headless underwater view at the Douro fixture the
shafts are faint in both builds, the old build shows a sharper band near the
horizon, and frame-to-frame differences while moving are dominated by the
ripples the moving eye makes on purpose (about 349,000 px in both builds).

**Shadow flicker.** Not changed in this pass; the owner's remaining cases need a
place to replay.

## Valley conflation and shadows on steep ground (3 November 2026, third pass)

Owner: shadows flicker at river edges and on steep walls away from water. The
diagnosis (second pass, below): the walls were mostly this rework's cut banks
where the mapped river lies up the DEM's valley side, and terrain shadow edges
step and crawl on steep receivers. The owner asked for both fixes, valley
conflation first.

**Valley conflation** (`rivers.js`, `resample.js`). Instead of cutting the DEM
down to a mapped line that runs up its valley side, the DEM's valley is moved
under the line.

- *Floor search.* At each node the raw z13 DEM is read up to 80 m either side
  in 4 m steps (at least 32 m; 4 x the class width + 20 m). Walking out from the
  line, the floor on a side is the first point where the ground stops falling
  (the next two steps no more than 0.5 m lower, so under 6.25 cm a metre). It is
  taken when its depth under the line exceeds 0.08 m per metre of shift (net gain),
  the larger side winning, faded in over 0.2 to 1 m of net gain. A slope that
  keeps falling, however it eases, has no floor in reach and is not shifted along;
  a search stops halfway to other mapped water (a lake, or a river polygon the
  line is not in). Measured case: in the Wupper fixture the DEM's floor lies 52 m
  off the mapped line at the deepest cut (104.4 m at the line, 97.6 m on the floor).
  An earlier cost-minimum rule also shifted the Südliche Düssel 67 m along the
  Rhine's bank slope in the Rhine fixture; the floor rule shifts it 0.
- *Smoothing and agreement.* Shifts are 2D offsets per node, smoothed along each
  run over 80 m. Nodes where runs meet or end keep the mean of their runs' raw
  floors; a tile-edge node averages seven searches along its source segment,
  so both tiles agree.
- *Warp.* A page from level 12 reads its DEM (and the DEM-derived sea and
  lakes) at `x + warp(x)`: nearby segments' offsets averaged by closeness and
  scaled by the nearest one's falloff (60 m, or four times its shift). The map,
  polygons, rivers and imagery are not moved, so the DEM moves to the map, which
  the imagery agrees with. Folds (Jacobian under a quarter of the plain map's)
  are counted per page (`rivers.warpFolds`): 0 in both fixtures. Height pages
  from level 12 ask for DEM tiles 82 m around, river DEM tiles about 150 m.
  Coarser pages carry no warp: at the level 11 to 12 hand-over the valley
  shifts by up to the offset, as the channel itself appears there.
- *Levels and banks* read the warped DEM, so the channel sits on the floor.
  Cut banks rise at 0.6 (31 degrees) at least, steeply enough to meet their
  hillside, continued at its slope, before the bank zone's fade begins; a bank
  that had not met its hillside there was lifted back in a few metres, a ledge
  striped by each segment's zone width.
- *Bed.* Inside a river polygon the bed takes one profile, so there is no seam
  where the polygon and a centreline channel meet (straight-edged triangles in
  the Rhine's bed before).

Evidence, ground within 60 m outside the channels (CPU, Wupper 25 pages at
level 15; the raw DEM has no slope over 35 degrees there):

| Build | Over 35 degrees | Over 45 degrees | Largest shift |
|---|---:|---:|---:|
| before conflation (45 degree cut banks) | 13.0% | 3.8% | - |
| conflation, 31 degree banks | 5.4% | 1.0% | 49 m |

Page builds, warm (p50 / p95 ms): Rhine levels 12/14/15 11.4-24.7 / 28-54 (9.6-21.9 /
25-48 without conflation), Wupper 9.8-11.7 / 19-41 (6.9-8.6 / 14-30). Segments that
do not shift add no warp work.

**Shadows on steep receivers** (`sun_visibility.wgsl`). A ground receiver's
slope tangent (from its normal, `sunlight_ground`; 0 for leaves, water and
audits) widens the terrain shadow edge by half its height span across one
texel of the finest resident level (or its footprint), at most 4 m, in both the
candidate band and the refined samples. Level ground is unchanged. Prop shadow
maps widen their filter where light grazes the receiver, by 0.45 / cos of the
incidence (clamped as before to 2 texels), as one map texel stretches across
it. Shadow-only flicker of the near view while the camera moves 3 cm a frame
at a 12 degree sun: 1,751 px before, 1,266 with conflation, 742 with both.
Test-Shadow-Stability, Test-Terrain-Shadow-Stability, Test-Shadow-Approach,
Test-Shadow-Orbit and Test-Shadow-Dusk all pass with the change.

**Not established.** The owner's own walls (no locations); trees were off in
these tests, so tree shadows on walls are covered only by the grazing filter's
reasoning. Floors farther than 80 m are not found. The shadow softening widens
edges on steep slopes by design: a sharp crest's shadow on a cliff is softer.

## Map water and smooth shores (3 November 2026, second pass)

Owner report after the first pass: square tiles hovering over the sea along
coasts and casting shadows; circle-arc cutouts in river beds; large rivers that
do not keep their width; many lakes and rivers drawn as grass with trees on them.
This section supersedes the first pass where they differ.

**Causes found.**

- *Coast squares.* The source's sea (seabed.js, water.js) is wet or dry per DEM
  pixel (15 to 40 m), with the seabed lowered and dry land lifted per pixel. The
  shore was drawn where the bilinear heights cross the level, so it followed the
  pixel staircase; on pages without rivers the water was also cut along 8 x 8
  texel cells. Reproduced on the Douro mouth fixture prepared with the worker's
  own sea steps (`tools/Render-Water-Pages.mjs --sea`).
- *Circle arcs.* A centreline channel took a left and a right width per node from
  one normal ray into the river polygon, so a segment's end cap was two half
  disks of different radii, and a node whose ray ran out along a basin made a
  disk: 600 m half widths and a 1 km disk on the Rhine at Düsseldorf (z14
  8500/5468), reproduced in `Render-Water-Pages`.
- *Width.* Polygons only set per-node widths; wherever a ray failed, the class
  estimate (16 m for a river) took over. Pages coarser than level 12 had no
  river water at all.
- *Lakes as grass.* Lakes came only from water.js (a flat DEM region with water
  coloured imagery), which misses most lakes; trees grow wherever no water is
  known.
- Also found: on a page with water texels, still water deeper than 32 m
  saturated the u16 excess, putting the surface at the bed plus 32 m. And the
  white water on narrow channels came from the surface-slope spline mixing in
  dry bank texels, whose excess is held under the ground by design.

**Design.**

- *Map water* (`web/field/map-water.js`). The OSM water polygons of the vector
  tiles a page already reads: lake, pond and dock as still water, and river.
  River pages (level 12 and finer) read z14; levels 7 to 11 read z(level + 1),
  about two pages across (`riverTilePlan`). z(level + 2) matched a page better
  but asked four times the tiles: 1,175 coarse tiles against 296 in the same
  replay visit (below). Per texel: the polygon holding it
  (even-odd over the edges of the texel's own tile, clip edges included so rings
  close) and the distance to the nearest real shore edge (clip edges of a tile's
  buffer excluded), within a reach of max(60 m, 3 texels). Intermittent water and
  swimming pools are left out. A still polygon takes one level per OSM id, the
  weighted median of its pieces: source water levels inside it if water.js found
  them, else the DEM's interior median if its 20-80% spread is under 0.5 m
  (lakes the DEM flattens), else the 15th percentile of its shore heights minus
  0.2 m. River pages estimate on the fixed z13 DEM, coarser pages on their own
  source. The bed falls from the shore at 0.25 toward 6 m (lake), 1.5 m (pond)
  or 4 m (dock); ground under level + 0.2 m just outside is raised to it over
  12 m (limit 2 m). A polygon fades in by its size (twice area over perimeter)
  in texels as a channel does, and a partly shown one keeps water only deeper
  inside than its missing share of a texel, so it shrinks away rather than
  spreading.
- *Rivers.* The channel is the union of the river polygon and centreline
  channels. A segment whose nodes lie in a polygon gives only the level there;
  its extent is the polygon's. Centreline widths are symmetric (the narrower
  ray), a node over twice its neighbours' median is cut to it, widths taper over
  150 m to the class estimate where mapping stops, are smoothed over 40 m and
  never exceed 60 m either side. A free line end (not a tile edge, confluence or
  outlet) closes over six half widths instead of ending in a round pit. Levels,
  depths and bank zones blend over 6 m from the nearest channel edge, so they
  are continuous across reaches, bends tighter than the channel and confluences.
  A node inside a mapped lake stands at the lake's level, as at the sea. Below
  level 12 a river polygon follows the lowest ground of its own within two
  texels: a coarse texel averages the banks with the water and stands over it.
- *Every page with water carries water texels,* the sea and source lakes
  included. The source shore is where a Gaussian blur (sigma 0.6 pixel) of the
  source's wet mask crosses zero: a function of position alone, so pages and
  levels agree. Within the blur's band the ground is drawn to a beach through
  the level (slope 0.1, at least 0.02 on the right side), so the water stays
  flat. Source lakes yield to map polygons inside them and within two texels;
  the sea never does.
- *Deep water.* An excess of 31.98 m or more is coded 65535. Where any texel of
  the spline's footprint holds it, the GPU reads the level of the cell instead
  (`page_water_read`); the page's cell grid holds the commonest still level of
  its wet texels.
- *White water* reads the surface slope of wet texels only (`page_water_surface`,
  spline weights renormalised over them).

**Evidence** (`evidence/local/river-rework/`). Settled spill, water pixels whose
ground lies outside every channel and polygon (a centreline channel x 1.25 + 3 m,
or 3 m from a polygon), in `Test-River-Overflow.mjs` at 960 x 640:

| Fixture, view | Water px | Spill px | Dry channel centre px |
|---|---:|---:|---:|
| Wupper near / mid / far | 154,054 / 34,113 / 7,005 | 6 / 1 / 0 | 5 / 0 / 10 |
| Wupper junction / steep | 68,026 / 16,232 | 0 / 0 | 0 / 0 |
| Rhine near / mid / far | 285,901 / 89,266 / 41,645 | 0 / 1 / 755 | 107 / 221 / 108 |
| Rhine steep | 204,617 | 0 | 127 |
| Douro coast (new view) | 307,391 | 0 | 0 |

Final runs: `after-12` and `rhine-after-12` (z(level + 1) coarse tiles, free-end
taper, a polygon-aware channel-centre test), `douro-after-11`. The Rhine far
view's 755 px lie on the horizon beyond the fixture's z14 tiles, where level-11
pages show the river from the recorded z12 tiles and the test has no z14
polygon to judge them by. The Rhine junction pick found none in these runs. The
Douro near view's 15,009 dry pixels lie on the fixture's placeholder wall.

Arrival, from the third sample on (the first is always flooded: the camera
starts under the fixture's 400 m placeholder roots), final runs: Wupper at most
374 px in one sample, median 3 px; Rhine at most 604 px in one sample, along the
placeholder spikes at the fixture's edge, median 0. The Rhine
fixture (`$SOLAR_DATA/water-fixtures/rhine`, 9 + 9 + 9 OpenFreeMap tiles
at z14, z12 and z10, 25 Terrain Tiles at z13) was recorded with the new
`tools/Record-Water-Fixture.mjs`, which asks only those two public hosts, one
request at a time, within a budget, never imagery. The GPU coast view
(`douro-after-10/coast.png`) shows a smooth curved shore where the CPU render of
the previous build shows the pixel staircase (`$SOLAR_DATA/river-rework-2026-11-02/pages/`).

**Costs.** Page builds, warm, Node, 25 pages per level (p50 / p95 ms, before ->
after): Rhine levels 12-15 4.6-17.3 / 16-50 -> 9.5-21.1 / 25-46; Wupper levels
13-15 3.7-5.8 / 8-17 -> 7.0-7.9 / 14-31; Douro coast 6.3-6.6 / 7.6-44 ->
8.2-9.3 / 10.5-77. GPU memory is unchanged (the atlas was already R32), but
every water page now uploads 279 KB instead of 140 KB. Pages at levels 6 to 11
now ask for z8 to z12 vector tiles too: a replay visit to three Lausanne stops
(6 km, 1.4 km and 120 m up, `requests-polygons-z1`) asked 296 coarse tiles and
165 at z14, where the same visit asked 185 at z14 alone before (run-to-run
variation of z14 about 10%). All are kept on disk. Frame cost is unmeasured.

Also: `Test-Earth-Structures-Logic.mjs`, 80/80 field logic tests (the water-grid
test now checks texels: dry inside 0, wet outside 0, surface within 1 cm of
the level), `tools/Check.ps1`, Naga validation, the native Vulkan explorer, and
the Earth height audit on the Lausanne, Dents-du-Midi and cube-edge route (0
samples over tolerance, 0 served-level disagreements, worst 0.26 mm).

**Follow-up: strong waves and shadows at river edges.** The owner saw water
"flying" near shores at a high wave height, and shadows flickering at river
edges and on steep walls.

- *Waves.* Wave displacement had no depth limit: full height wherever a vertex
  was wet, so at wave height 8 (about 5 m crests) water stood metres over a beach
  or a river covered by centimetres. Waves now shrink toward the shore, full only
  deeper than 1.2 x the wave height setting (`water_wave_on_ground`), in the mesh
  and, by the same rule on the pixel's depth, in the water pass. River ripples
  scaled with the sea's wave height too (0.8 m, up to 2.4 m in rapids, at 8);
  they now take the setting only up to its default. Map still water open to the
  sea (a dock, a lagoon) takes the sea's level, and never stands over the sea
  where the source has it (`pieceLevel`; a logic test holds a dock on 5 m quays
  at sea level). Not reproduced in the owner's place; at the Wupper bank and near
  views at wave height 8 the river stays flat.
- *Shadows: diagnosis, not fixed.* With a 12 degree sun, the shadow-only
  diagnostic (`--shadow-diagnostic 1 --flicker` in `Test-River-Overflow.mjs`)
  flickers along silhouettes and along the shadow boundary on the cut bank of the
  near view while the camera moves 3 cm a frame (1,751 px); the speckle on flat
  ground near the camera (3,796 px) is the same with shadows off, so it is
  material detail, not shadow. Terrain shadows come from sun horizon maps over
  camera-centred height clipmaps (1 m, 4 m, 16 m ... spacing); a receiver on a
  steep wall changes its clearing height by up to a texel's rise when the window
  moves, which on a 45 degree wall is metres: the blocky, crawling edges. The
  steep walls are largely this rework's: where the mapped river lies up the DEM's
  valley side, the channel is cut down and the bank cut at 1:1. Over 1.5 km of
  the Wupper fixture, 2,905 texels are cut 10 to 20 m and 11,168 by 5 to 10 m.
  Candidate fixes: move the DEM's valley to the mapped river instead of cutting
  walls (conflation), and soften the shadow test on steep receivers by the
  texel's height uncertainty. Neither is done.

**Not established.** The owner's own places (no locations given). Live network
behaviour and imagery. Intermittent lakes (OSM salt lakes, many in Australia)
stay dry by design. Lake levels where the DEM does not flatten the lake are
estimates. Polygon generalization at z(level + 2) moves shores slightly at the
level 11 to 12 hand-over. Frame cost on a quiet GPU.

## River rework: water per texel, one network (3 November 2026)

Owner report: rivers overflow in staircase blocks on dry banks, steep reaches and
waterfalls are wrong, some junctions are wrong, distant water stands above the
ground while terrain morphs, and river terrain arrives late and changes shape
several times. This section supersedes the river geometry described under
"Rivers" below; levels, widths and the source data are as described there
unless stated here.

**Causes found.** River water was one affine plane per 8 x 8-texel cell
(32 x 32 per page). Wherever a plane stood over lower ground inside its cell,
water showed there and stopped at the cell edge: the blocks. Distant pixels
counted as water up to 8 m above the level on slopes, also cut at cells. A
water-mesh vertex took its target level at once while the terrain under it
still morphed, so water stood over ground on its way down. Dry vertices took
their triangle's wet average, which made the sawtooth sheets. River lines came
from a different zoom per page level (simplified at low zoom), so every level
carved a different channel. A height page with a river fetched its height
tiles, then the river tiles, then a z13 DEM, one after another.

**Design.**

- *Water texels.* A river page carries a second u16 plane after its heights:
  the water's excess over the ground, `e = level - height`, in 1/1024 m steps
  (`resample.js`). The height atlas is R32Uint, height in the low 16 bits and
  excess in the high 16, so one load serves both. The GPU reads `e` through the
  heights' own B-spline. The water surface is `height + e` and the shore is
  where `e` crosses zero, at texel resolution, with no cells. Mesh vertices,
  shading, the water pass's bed depth and coverage, ripple flow, trees and the
  camera's water all read it. Lakes and the sea keep their cell levels and enter
  `e` as `level - height` on river pages. Pages without rivers are unchanged.
- *Containment by construction.* Outside a channel, `e` is held below -3 cm and
  sinks 0.5 m per metre from the bank, so no water stands on ground the map does
  not put it on, however low that ground lies. A node's level is the lowest DEM
  probe at the centreline, at most 0.3 m under the lower bank probe; an isotonic
  fit may stand up to 1.5 m over one probe, which the bank fill (2 m) holds.
- *The map wins over the DEM.* Mapped channels often lie partly up the DEM's
  valley wall. Inside the channel the ground is cut to the bed (limit 30 m);
  outside, high ground is cut to a 1:1 bank joined to the hillside with a smooth
  minimum. The bank zone is sized per reach to the cut its higher bank needs
  (8 to 120 m), and the cut fades back over its outer quarter, so it never ends
  in a step. Low banks are filled to 0.1 m over the water across a fill shoulder
  (limit 2 m). Limit hits are counted (`terrainLimited`).
- *One network.* Every page from level 12 (`RIVER_MIN_LEVEL`, 12 m texels) reads
  the z14 lines, up to 36 tiles; coarser pages carry no rivers. Each z14 tile is
  solved alone (lines, bank polygons, its own ocean polygons, z13 DEM) and
  cached per worker by content signature, so every page and level gets the same
  course, width and level. Pages fade carving and water in with how many texels
  a channel spans (none below 0.75, all from 2), and convolve the channel with
  the texel (wider by half a texel, shallower in proportion), so finer levels
  deepen one channel rather than move it. Levels 13 to 15 agree on the water
  level within 2 cm in the logic test.
- *Profiles.* OSM ways run downstream; only a clear DEM contradiction reverses
  that. Fits stop at confluences, as before. A reach that ends at a confluence
  no longer limits the confluence's level, since its bank probes lie along the
  other channel. Fixed nodes take the mean of probes along their reaches; a tile
  edge node probes along its source segment on both sides, so both tiles agree.
  The isotonic staircase is smoothed with a positive kernel over a class length
  (river 120 m, canal 200 m, stream 30 m, drain and ditch 20 m), which keeps it
  monotone and its ends fixed. Steep reaches keep their slope; waterfalls are
  ramps at DEM resolution.
- *Morph and water.* A vertex reading a river page keeps its water as an excess
  over its own height (coded 20000 + metres), so the water rides on the terrain
  while it morphs and lands on its final depth. Close up, field water needs both
  the shown ground and the page to put a point under water.
- *Flow and white water.* River ripples are two flow-mapped layers (1.6 s
  period, restarts jittered) driven by velocity blended over the four nearest
  river cells, so reaches of different speed never tear the pattern. Water
  surface slope from the texels above 6% turns to white water, full by 25%.
- *Fetching.* River tiles are asked for beside the page's own height tiles, kept
  in memory (64 tiles, 32 MiB) and on disk. A 404 or 204 is an empty tile (no
  rivers), not a failure that re-asks the page forever.

**Evidence** (`evidence/local/river-rework/`). `tools/Test-River-Overflow.mjs`
replays the recorded Wupper fixture (one OSM z14 tile, nine z13 DEM tiles)
through the served page builder into the served engine, at 960 x 640, and
classifies every water pixel's ground against the canonical channel map. Spill:
water pixels whose ground lies outside every channel (half-width x 1.25 + 3 m).
The baseline is the code before this rework, rebuilt from git HEAD plus the
saved diff in `$SOLAR_DATA/river-rework-2026-11-02/baseline`.

| View | Spill before | Spill after | Dry channel centre after |
|---|---:|---:|---:|
| near, 70 m back, 22 m up | 28.3% (64,509 px) | 0 | 0 |
| mid, 420 m back, 140 m up | 19.2% | 0 | 0 |
| far, 1.6 km back, 520 m up | 35.0% | 0.01% (1 px) | 0 |
| junction | 15.1% | 0.006% (4 px) | 6 px |
| steep stream (32%) | 12.7% | 0 | 0 |

While the near view's pages arrive, spill is 0 from the second sample on in
every sample but one (41 px when a late batch landed); before, it stayed at
about 64,000 px. The first sample is a fixture artefact (the camera starts
inside the fixture's 400 m placeholder roots). The Douro mouth fixture was also
run, but the same placeholder roots stand as walls around a sea-level fixture
and dominate both builds' numbers, so it qualifies nothing.

Also: `Test-Earth-Structures-Logic.mjs` (new checks: no water outside the
channel on a 30% hillside, no level above a bank limit, shared page-edge water
surface within 0.03 mm, one level at page levels 13 to 15), 80/80 field logic
tests, `tools/Check.ps1`, Naga validation, the native Vulkan explorer
(procedural ground), and the Earth height audit on the Lausanne, Dents-du-Midi
and cube-edge route (0 samples over tolerance, 0 unequal shared samples, worst
0.26 mm).

**Costs.** The height atlas doubles: 335.5 MB at the full tier (was 167.8 MB),
268 MB reduced, 201 MB minimal, each page uploads 279 KB. A separate, smaller
pool for water texels could take most of that back; not done. River pages build
in 4 to 15 ms (2 ms without rivers; 42 ms the first time a tile is solved) on
this machine in Node. Frame cost is unmeasured: the GPU was shared with the
owner's other projects throughout, and the water pass, ocean raster and shading
now read the texel spline where they read cell planes before.

**Not established.** Live network behaviour (no live host was contacted from
tools). Real imagery over a river (the recorded tour holds one OSM tile, with
culverted streams). Real waterfalls, dams, braids and islands: river polygons
still guide widths only. Junction squares at estuaries: not re-tested. The
owner's cliff screenshot (a straight-edged step along page edges): not
reproduced; the height audit finds no stale mesh rows in replay, and its cause
is open. Rivers on pages coarser than level 12 show only in the imagery.
`Capture-River-Replay.mjs` and `Test-Earth-Near-Morph.mjs` are new diagnostics.

## Water coverage correction (2 November 2026)

The owner reported widespread water near rivers that vanished on approach.
The page-support flood recursively copied river/lake levels into neighbouring
low terrain. Its minimum-height test crossed unresolved banks in coarse pages:
a source strip of 32 river cells expanded to all 1,024 cells. Finer pages could
resolve the bank and stop the spread, producing the apparent disappearing lakes.

`extendWaterSupport` now reads only original source cells. It adds at most one
adjacent cell, and only where the maximum fitted water plane is below every
sampled terrain vertex in that cell. Lower unmapped ground stays dry. Shore
source sampling covers every height texel instead of every second texel. This
keeps explicit source water without inferring new lakes from terrain elevation.
Work remains bounded by 1,024 support cells, four neighbours and 81 height
samples per cell; no new GPU allocations or shader changes are required.

`Test-Water-Approach.mjs` replays a river between lower dry valleys using the
production page builder and browser GPU. At 1,500 m, the old builder produces
64,571 spurious water hits outside the river; at 500 m and 120 m they disappear.
The corrected builder produces zero such hits at all three distances and after
returning to 1,500 m. The river remains visible in every view. Evidence and the
before/after source are under `evidence/local/water-source-support/`.

Validation: build, `Check.ps1`, all 80 field logic tests and river/building
logic pass. Seven browser shoreline views report zero missing-water rays and
zero towers; stationary head turns preserve the terrain epoch.

## Current state: original clouds restored (2 November 2026)

At the owner's request, the complete cloud implementation from **before this
conversation** has been restored from the immutable start snapshot:
`$SOLAR_DATA/cloud-river-buildings-2026-11-02/baseline/source`.
This restores the procedural cloud shape, weather/advection, local density and
lighting cache, ray integration, far Earth clouds, original planet cloud
eligibility, and quality presets (64 cloud steps on High). The experimental
shared cloud model and its noise-texture module are removed from the build.

Rivers, water geometry/shading, buildings and their shadows, tree refresh,
terrain selection, local-time controls and camera fixes are retained. Mixed
renderer files were edited only at cloud integration points. Exact source
matches, file hashes and browser/native evidence are recorded under
`evidence/local/cloud-rollback-2026-11-02/`. The earlier 18:12 candidate tried
first during rollback was rejected by the owner and is **not** the restored
version.

Validation: `Build-Explorer.ps1`, `Check.ps1`, shader provenance verification,
the native GPU probe, five browser cloud views, far/near solar Earth views,
controlled building facade rendering, and river/building source logic pass.
The preservation report records 805 files unchanged by this rollback.

All cloud-rework descriptions and performance results below are historical;
they do not describe the currently served clouds. Remaining river limitations
recorded below are unchanged by this rollback.

## Historical rework notes

**In progress; visual acceptance failed.** Owner screenshots show repeating cloud
carpets, a camera-following dark cloud square, water towers/curtains and square
shorelines at river junctions and estuaries, shadow/texture flicker, and geometry
moving during head turns. Earlier sampled/offline passes did not cover these
failures. The performance table below describes a superseded cloud candidate.
Buildings are confirmed by the owner in Los Angeles; live Lausanne source loads
also succeed (7,662 footprints, nine tiles, no vector request failures).

## Latest follow-up: motion, geometry and cloud integration

This is still an in-progress candidate, not a completed visual/performance
acceptance. The recent owner screenshots are regression cases, not examples
of acceptable results.

- A tree refresh constructor swapped `support` and `contact`. The interleaved
  page checks consequently reset existing tree fades in scanning bands.
  `Test-Tree-Refresh.mjs` reproduces the failure before the repair (4,060
  refreshed trees; 85,877 failing frame observations). Afterward, all 4,091
  refreshed trees retain full appearance in the same test.
- Water support now extends across connected submerged source cells and one
  bank cell, rather than explicitly rejecting submerged growth. Four affine
  river-plane evaluations are blended; the single-corridor coverage cut and
  bilinear wet-cell colour mask were removed. The actual terrain/depth
  intersection owns the bank. The bounded source flood visits at most 1,024
  cells per page; this is not a global hydraulic/topology guarantee.
- Generic unresolved terrain noise is suppressed under prepared water beds
  and smoothly restored on dry banks. The mapped 3 m tributary test improved
  from two missing rays to one, but **still fails**: one displayed terrain
  point is 1.65 cm above the water inside the stream. The close, far and
  tributary views pass. Do not characterize river junctions as fully fixed.
- Water refraction uses the same canonical bed shading on either side of the
  screen boundary; screen hits supplement explicit props. This addresses the
  bottom-screen shading discontinuity. Live Douro captures execute the path;
  shallow/deep source bathymetry bands still need visual qualification.
- Buildings use complete storeys and bays sized to each wall, frames, plinth
  and cornice material bands. Shadow raster slope/constant bias agrees between
  native pipeline creation and browser precompilation. These remain simple
  flat-roof prisms; a controlled close view with 5.7, 9.8 and 18.2 m source heights now shows complete window rows and no visible facade/roof acne (`final-facades`). Actual complex city support and distant aliasing still need qualification.

Cloud motion now uses a common transform through the whole column. Weather is
cached before wind, with wind applied continuously at lookup. The far Earth
column atlas follows the same policy instead of baking moving rows. Animated
lighting always uses the direct field, even when one frame repeats its clock;
only explicitly disabled animation permits the local static lighting cache.
The upper ice mask must satisfy its parent cloud's mass threshold. It is a
connected synthetic anvil model, not a simulated water/ice transfer solver.

Nonperiodic hashed simplex masses organize the local shape; the small texture
only contributes billows, warps and erosion. Weather changes cloud probability
rather than clipping the entire cloud body at a coverage contour. Isolated
clouds can remain in low-coverage regions. Global aesthetic acceptance is open.

The reproducible cumulus-wall comb was a view-quadrature error, visible with
both cached and direct lighting. Linear extinction/source interpolation trials
failed to remove it and were discarded. The current outer logarithmic march
checks endpoints/midpoint, then refines occupied bins with four subintervals.
Refinement fades continuously with coarse optical support and interval length.
At most eight density queries per outer bin (including three search queries),
plus at most three shadow queries per lit integration sample; early opacity
termination reduces typical work. Empty-bin detection is a heuristic, not a
conservative absence certificate. Diagnostic bit 16384 retains the former
quadrature for positive-control comparisons.

The earlier eight-subinterval `qualified-Integration` compares the production path with the former quadrature
at 1,024 outer steps: cloud-buffer RMSE 0.00403 versus 0.01545 before, p99 error
0.01465 versus 0.0625. `qualified-Motion` repeats twelve fast-wind epochs with a
fixed eye: every duplicate cloud buffer is bit-identical; per-frame p99 change
is at most 0.0044. These tests do not prove all camera/distance transitions.
The added refinement costs time: the last serial 960x540 test measured about
24.8 ms total GPU versus 13.5 ms for the striping version and 38.6 ms for the
dense reference. These are local test timings, not a performance win or a
controlled comparison against the original branch. Performance remains open. A four-subinterval follow-up (`four-integration`) passes at RMSE 0.00627, p99 0.02393, and 20.75 ms total GPU in the same view. Four-sample motion also repeats identical epochs exactly. The material-coordinate lighting-cache trial was rejected: RMSE 0.01268 and p99 0.05225 failed the image gate, for only a small timing gain. Its shader changes were removed; animated clouds retain direct lighting.

The GPU coverage-edge check initially failed a 0.0002 raw-difference gate because a half-float ULP at dense samples is 0.000488. The corrected test accounts for both readbacks' rounding errors while retaining a 0.0001 bound on physical density change: excess above rounding was 0.0000153, with 23,231 occupied samples. No production density discontinuity was hidden by this correction.

The 79 field-logic tests pass after updating the obsolete assertion that
required holes in submerged cells. Full check/build, browser cloud/planet/shore
regressions and the native shader probe are recorded separately under
`evidence/local/cloud-rework/`. The original starting build remains immutable. Seven planet cases execute without device errors, but their inside-deck captures do not qualify planetary appearance. The shoreline rerun has zero towers/missing expected water in all seven views, and settled head turns keep epoch 145 unchanged. The narrow-confluence failure above remains open.

Final served follow-up: `tools/Check.ps1` passes
(`check-final-followup.log`), the Vulkan shader probe executes successfully
(`final-native-followup`), and the browser integration and motion tests pass
again (`final-integration`, `final-motion`). Final integration RMSE is 0.00627
versus 0.01545 for the striping control, with p99 0.02393; duplicate epochs are
bit-identical. The served WASM provenance key is
`585c40b432b62b6943f9e65060afaf930e1e66564f89b2eda770a1bcec7b5d91`.
The dev server responds on port 5198. Reload the page for the new WASM/shaders.
No commit or push was made. Performance and the documented narrow-river case
remain unresolved.

## Earlier observations

Current corrective work: water now reads its GPU triangle stream explicitly so
dry corners can share the neighboring water plane instead of connecting water
to terrain-minus-80m. Bank clipping happens in the depth pass. River plane
gradients use fitted reach derivatives rather than finite differences that can
cross two unrelated reaches. The measured analytic shoreline GPU test now reads
123k–197k surface points per heading at 400 m: no towers, worst height error
6.5 mm, and no terrain epoch change across five head turns. Approaches from
100 m to 3 m above water also pass: no missing open-water hits or off-level
surfaces. Real confluence and
estuary validation remains open. Overlapping ocean polygon buffers now form a
union instead of cancelling each other by XOR; a duplicate-source regression
checks that mouths remain at sea level. Cloud morphology/lighting is being
revised again; neither the v2 nor v3 visual/performance candidate is accepted.
The v3 near portraits mostly show clear weather and terrain, so those portraits
cannot qualify close cloud shape. Cloud-only coverage must be checked too.
The current `organized-clouds` candidate puts broad mass before cellular edge
noise, reducing the isolated repeating dots in a deliberately covered region.
It still needs orbit/cache-boundary comparisons and controlled performance
measurement; the broad cloud goal remains open.

A new small-pool regression reproduced view-dependent height/imagery residency.
Admission now uses position/footprint rank before view-dependent fetch ordering;
the same-position opposite-heading test passes after failing before the fix.
The old sun probe tool also exposed duplicate cloud-noise and missing imagery
bindings, now corrected. A moving-sun regression failed: after only 1/60 second
of Earth rotation, mean visibility changes reached 0.127 in the far cascade.
The light-grid phase now rotates about the eye while fixed-sun translation
still traverses a world lattice. Both fixed-sun translations and moving-sun
probes pass after the change: worst cascade p99 below 0.0014 over five frames,
no receiver changed by more than 0.05. Near/far foliage raster aliasing outside
this frozen-wind probe remains a visual qualification item.

Solar mode retains Earth destinations. The elevation slider was replaced by
UTC date/time, mean local solar time on Earth, and Local noon. Manual date edits
preserve body-fixed pose and ground-relative velocity in Rust; destinations
start with the body's surface velocity. The paused-clock branch had skipped
the -1x rotation correction, producing 4,008 m of drift in ten seconds. That
failing regression passes after the fix. Browser/WASM checks preserve pose to
nanometre rounding on time edits, hover within 2.1 cm over ten seconds, and
match surface flight displacement within 0.8 mm at rates 0, 1 and 60, including
a six-hour date change. `tools/Test-Solar-Time-Camera.mjs` records the evidence.

Validation for the camera/shore/shadow fixes: `tools/Check.ps1` passed, the
native Vulkan probe ran, and browser tests above ran separately. The field
logic suite passes 79/79; its DEM/imagery-only fixtures now inject no vector
source, so unrelated missing hydrography metadata cannot mark every fixture
provisional. MVT and Earth-structure logic suites also pass. The Douro source
fixture runs on GPU (267 uploaded pages) but its screenshot primarily sees
open water and does not yet qualify natural banks or the real sea transition.

Owner request, 2 November 2026: rework clouds for Earth-like structure, close detail, performance and continuous distance filtering; support relevant planets; integrate rivers and buildings. Follow-up: riverbeds must follow real courses, have natural banks and detail, and meet smoothly at tributaries.

Preview: http://127.0.0.1:5198/?body=earth and `?body=solar`. Starting commit `79d3e26`. Existing uncommitted solar-transition work was preserved. Original source, dirty diff and browser build are at `$SOLAR_DATA/cloud-river-buildings-2026-11-02/baseline`; port 5201 serves that immutable browser baseline. Nothing was committed or pushed.

## Clouds

- Shared density, weather, extinction and kinematics in `shaders/cloud_model.wgsl`, consumed by surface, sunlight, distant Earth and other planets. One immutable GPU-generated 64³ RGBA8 shape basis costs 1 MiB.
- Flat lower bases, convective billows, tapered tops, fine edge erosion and a separate thin upper ice component. Whole-column latitude winds and evolution use bounded deformation. This is a synthetic kinematic appearance model, not observed weather or a numerical atmosphere solver.
- The former rolling density volume now contains lighting only. Moving its window cannot replace cloud shape. Continuous footprint filtering uses the lateral pixel footprint. Sun maps have wide continuous hand-overs, including the old camera-local boundary. No density mesh/volume LOD swap.
- A logarithmic shell march subtracts the empty inner interval. Occupied bins receive continuous, bounded subinterval refinement; the old Gauss rule remains a diagnostic reference. Analytic empty-height rejection avoids shape fetches where the vertical envelopes are zero. High quality uses 128 bins at half resolution. No new temporal-history dependency.
- Body descriptors configure Venus acid decks, thin Martian ice, sparse Titan methane and giant-planet decks. Giants remain in the space pass and now use the shared volume there. Earth owns an independent far-weather atlas, preventing another active planet from overwriting it.
- Shader provenance includes the shared cloud model, buildings and space shaders.

### Browser timing

RTX 3080, private headless Edge, 1280×720, high preset, deterministic procedural views, 120 GPU samples per view after warm-up. All deferred features were ready. Screenshot readback is outside timing. Baseline and candidate ran serially after the unrelated Pinionfall GPU load ended. Earlier contended measurements are retained as experiments and are not evidence of speedup.

| View | Baseline total GPU ms | Reworked total GPU ms | Reduction |
|---|---:|---:|---:|
| Orbit | 16.66 | 12.87 | 23% |
| Above layer | 17.02 | 15.90 | 7% |
| Inside layer | 16.60 | 11.83 | 29% |
| Below layer | 13.05 | 12.40 | 5% |
| Horizon | 13.54 | 13.05 | 4% |

Evidence: `evidence/local/cloud-rework/final-baseline/report.json` and `gauss/report.json`. These are total-frame medians on this machine, not a universal FPS guarantee. Geometry changed, so equal settings do not imply equal cloud coverage. The candidate's finer primary bin budget was retained for image quality.

### Continuity evidence

- Height precision audit passed: stable relative radial-height error stayed below 8 mm in the sampled views.
- Fixed-point density is identical across camera windows, cube edges, pole, antipode and return; sampled periodic-basis seam error is zero. Evolution changes the field and replay restores it.
- Long-epoch wind tests bound sampled metric distortion; the new shear intentionally is not a rigid isometry.
- Pointwise GPU sun-map sweep: 0.9→0.1 hand-over is 47 texels versus 13 for the former narrow profile, at ground, in-layer and above. The old ray-averaged diagnostic was unsuitable for measuring width because it combines different edges along a ray; its failed experiment is retained under `crossfade-final`.
- Earth solar hand-over, 240 frames each way: largest mean brightness step 0.61/255, peak change relative to neighbouring frames 1.16, full transition covered. Both directions passed the existing limits (`solar-transition/`).

## Rivers

`web/field/rivers.js` consumes z14 OpenStreetMap centerlines and river polygons. Mapped banks supply asymmetric widths for main rivers/canals; missing widths use explicit class estimates. Tributaries do not inherit a main river's wide polygon. Course coordinates are never displaced by random meanders.

A fixed z13 raw DEM supplies small symmetric valley probes. Each complete source-tile network is reconstructed independently of requested terrain pages. Shared junction nodes are fixed elevation constraints; monotone fits stop at them. Overlapping reaches blend levels around confluences. Local flow direction and slope drive small advected water ripples. This is a local hydrographic reconstruction, not a catchment-scale water-volume or flood simulation.

Terrain pages reach D15 for channel resolution without claiming new source DEM detail. Beds have a rounded profile and deterministic 24 m / 6 m roughness bounded by 15% of inferred depth, vanishing at banks. Broad shoulders meet the existing terrain; edits are limited to 8 m of cutting and 2 m of filling per texel. Limit hits are counted. River cells carry level/slope/flow planes. The former bank-corridor clipping was removed: support continues behind the bank and the terrain intersects the water geometrically. Existing flat lake/sea metadata remains supported.

Bounds: at most 16 source tiles per page request, 8,192 segments, 65,536 index bins, 262,144 references and 128 candidates per bin. Each source tile has at most 8,192 bank edges, and each width query admits at most 1,024 nearby candidates. The river cache has 32 tiles / 16 MiB estimated decoded size. Fetches share the existing scheduler and replay proxy. Failed sources mark pages provisional for retry. Complexity omissions, missing endpoint heights and terrain-limit hits are exposed in field statistics.

Tests cover monotonic fixed endpoints, shared source boundaries, tributary junction levels, excluded bridges/tunnels, finite planes, roughness bounds and shared terrain-page edges (last manufactured edge error below 0.00003 m). `Test-River-Gpu.mjs` has a deliberately straight synthetic channel and a `--real` Wupper fixture. The latter uses one recorded OSM tile and nine recorded DEM tiles; captures use neutral terrain to expose shape and coverage. The source polygon/centerline comparison is `wupper-source.png`. Earlier captures showing spill or raised banks are superseded by subsequent repairs.

Limits: source elevations, inferred beds and missing widths are not surveys. Dams, waterfalls, disconnected/missing map reaches, complex braid topology and global discharge remain unresolved. Terrain-limit hits can leave imperfect channels. River polygons guide local widths rather than reconstructing every island as full polygon topology.

## Buildings

Real map footprints are normalized/clipped as source records, including holes and multipolygons. The CPU uploads no meshes or instance lists. Compute generates bounded support data and vertex references; raster builds facades, flat roofs and courtyard holes. Buildings contribute to all six sun-shadow cascades. Arrival/range coverage is gradual, with one geometry representation across the visible range. The UI includes a Buildings switch.

Bounds: four cancellable requests, nine wanted z14 tiles, sixteen cached tiles / 32 MiB estimated decoded budget; metadata timeout 15 seconds. Source caps are 16,384 footprints, 131,072 vertices and 256 vertices per footprint. GPU allocation is approximately 10.75 MiB. Over-budget/complex omissions are reported. Terrain foundations use the centre and eight source vertices: an explicit sampled approximation, not a conservative support proof.

Offline Lausanne replay renders 2,670 buildings / 16,006 points in city and street views, without GPU errors or upstream requests. Source tests cover holes, stable identities, clipping, heights and adversarial overflow. The fixture covers one tile; its sharp data-availability edge is not the live residency policy.

Limits: heights are source estimates; roofs are flat; facade detail is procedural. Landmarks, complete building parts, collision/navigation and the entire future M7 roadmap are not included. Vegetation can still intersect some footprints.

## Validation and reproduction

- `tools/Check.ps1`: workspace tests, format, Clippy with warnings denied, WASM checks and Naga validation passed.
- `node tools/Test-Field-Logic.mjs`: 79/79 existing field tests passed.
- `node tools/Test-Vector-Tile.mjs`: bounded MVT parsing/identity/geometry checks passed.
- `node tools/Test-Earth-Structures-Logic.mjs`: river/building source and continuity checks passed.
- Browser tests and native GPU probes are recorded separately under `evidence/local/cloud-rework/`; native timings are not used as browser evidence.
- `tools/Verify-Explorer-Build.mjs` verifies the served WASM/shader provenance. Dev server remains port 5198.

Fixtures and experiment outputs are local evidence, not shipped source assets. `Test-River-Gpu.mjs --real` currently expects the local Wupper fixture under the data directory ($SOLAR_DATA). No source code or visual assets were copied from graphics references.

## Sources

[WMO cumulus definition](https://cloudatlas.wmo.int/en/definition-cumulus-cu.html), [Guerrilla Nubis, Evolved](https://www.guerrilla-games.com/read/nubis-evolved), [NASA Venus](https://science.nasa.gov/asset/hubble/venus-cloud-tops/), [NASA Titan](https://science.nasa.gov/saturn/moons/titan/facts/).

[OpenFreeMap](https://openfreemap.org/quick_start/), [OpenMapTiles building schema](https://raw.githubusercontent.com/openmaptiles/openmaptiles/master/layers/building/building.yaml), [waterway schema](https://raw.githubusercontent.com/openmaptiles/openmaptiles/master/layers/waterway/waterway.yaml). TileJSON is resolved at runtime; no dated provider URL is hardcoded in production. Map attribution is visible in the application.

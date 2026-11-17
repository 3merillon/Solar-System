# Whole-renderer performance pass, quality presets, allocation tiers and deferred startup

Work started 27 October 2026 on the single-skin explorer, from
`65a33791351f4ae0dc7d566956ad15c92c8d6168` (the published integrated pass).
The owner asked for a complete optimization pass of the high-quality renderer
(which must still look like the published checkpoint), medium and low presets
with comprehensive per-feature settings, a configuration that runs on phones
and other weak devices (the published build lost its device on mobile), and a
faster planet initialization. Everything below is measured on the shared
RTX 3080 workstation in private headless Edge (BrowserWebGpu); native wgpu is a
validation backend. Frame numbers are p50 of 120 measured frames after a 240
frame warm-up and a 60 frame settle, 1920x1080, animated weather, default
settings unless a row says otherwise. Measurements are finite observations on
a shared machine, not guarantees; the final tables are in the evidence section.

## Baseline attribution first

`tools/Measure-Matrix.mjs` runs one private browser through a list of settings
patches and prints per-stage GPU medians. On the starting build the forest
frame (45.7 ms) was dominated by sun shadows (24 ms, almost all of it terrain
march work in the two shading passes) and clouds (13.4 ms), with surface-detail
relief (4 ms) and the water pass (3.2 ms with no water visible) behind them.
Reducing the shadow march from 64 to 16 steps removed only 1.4 ms, so the cost
sat in the first metres of every ray.

A second tool, `tools/Measure-Compile.mjs`, times browser shader compilation
of the concatenated WGSL per entry point without a WASM build, and accepts a
directory of modified sources for bisection. It attributed the 12.5 s `water`
pipeline compile to four inlined copies of the direct-light query (about 2.3 s
each). A later bisection with stubbed functions showed that the cost of a
program is set by how many copies of loops and cache lookups the driver inlines,
not by the arithmetic inside them: stubbing the noise function changed nothing,
while the sun query was 56% of the water compile, the shadow cache lookup and
the exact band loops about 1.3 s each, and the wave noise 0.9 s. The tool
compiles the full module, so a few scheduling kernels (`gpu_select`) report far
more than the worker's pruned per-entry sources; use `tools/Test-Startup.mjs`
for shipped numbers.

## Changes kept

Compile time

- One direct-light query, one bottom-light evaluation and one underwater
  medium integration per water pixel. The refracted bed and underwater sun
  beams reuse the surface visibility; their receivers were projected back to
  that surface anyway, offset laterally by at most the depth. The bed
  continuation evaluates its field in one loop body instead of four copies.
- One evaluator for the shadow march: the receiver estimate (prop and water
  receivers) and every march step share a single copy of the clipmap lookup
  and a single copy of the live band loop, with the exact canonical fallback
  expressed as the same loop started at band zero. The decisions are
  unchanged (terrain-shadow stability 7/7, prop shadows, independent
  reference audits all pass); the serial water compile fell from 5.7 s to
  4.5 s and `shade` from 3.2 s to 2.4 s.
- One copy of the cloud profile knot interpolation serving both maps, one
  call site for the cloud interval quadrature, and the composite fallback
  shares the marcher.

Startup (details and the measured table are in `docs/STARTUP.md`)

- Compile lanes scale with reported threads (two, four, or half the threads
  up to eight). The longest programs are scheduled first.
- Deferred features. Programs that only the ocean, the clouds, the scenery
  culling and shading, the shadows and the diagnostics need are compiled after
  everything the first image needs. The renderer starts without those features
  and shades the first image with `shade_initial` (the terrain shading minus
  the sunlight query, 0.8 s to compile instead of 2.3 s), then creates each
  feature as soon as its programs exist. The frame uniform reports the ocean
  and clouds as disabled until then, the composite reads the shaded surface
  directly and draws a flat sea placeholder over the submerged bed, prop and
  sun-caster culling wait for the scenery programs. `window.explorerReady`
  still means the complete renderer; `window.solarFirstImage` is the first
  image time. Cold first image 4.6 s, complete renderer 8.7 s, from 11.7 s.
- Browsers keep a disk shader cache keyed by source text; identical builds
  start much faster the second time, and the startup report records whether
  the run looked warm. Native builds load and persist a Vulkan pipeline cache
  under `target/pipeline-cache/` (wgpu exposes caches on Vulkan only).

Sun shadows

- Terrain height clipmaps: nine 512x512 levels at x4 spacing (1 m to 65 km),
  stored as rg32float with a full filtered height and a coarse height that
  omits the level's live bands. The producer evaluates texel positions from
  exact integer chart cells in double-single precision, so the former 2 m
  position guard (9.3 m of height envelope at every level) is gone.
- A candidate blocker is refined with the cached coarse bands plus live
  evaluation of the level's fine bands at the receiver footprint (five to
  fifteen bands instead of twenty-four), and only when that estimate still
  lies inside its own envelope around the penumbra is the full spectrum
  evaluated. Decisions at shadow edges therefore remain exact and independent
  of the covering level; the terrain-shadow stability test passes 7/7 with
  maximum drift 0.018 as before.
- The receiver's filtered spectrum is bounded per receiver on the GPU instead
  of assuming the coarsest footprint of the level; the march stops once a
  rising ray clears the highest cached height (GPU-produced ceiling, no
  readback); shading reuses the pixel's canonical height; back-facing bare
  ground and back-facing prop surfaces skip the query (exact: every direct
  term is multiplied by zero). Value-only noise evaluation and a shared hash
  prefix tree (14 hashes per lattice cell instead of 24) serve all consumers.

Clouds

- Weather atlas in rgba16float with one hardware bilinear fetch (base stored
  relative to 1550 m; 0.25 m precision).
- The local cloud volume is a world-anchored lattice on the camera's cube
  chart (toroidal storage, 96 m radial slices from 1024 m). Each voxel packs
  density with the sun-ray optical depth and planet occlusion; per-column
  weather (kind, base, thickness) lives in a 512x512 texture instead of three
  wasted channels per voxel, so a sample is one trilinear and one bilinear
  fetch. Optical depth interpolates far better than transmittance across the
  256 m cells. Retained voxels are never regenerated; animation refreshes one
  row set in `cloud_refresh` (default 4) per frame; parameter changes and time
  jumps larger than one long frame refresh everything, so repeated epochs
  still reproduce exactly (formation regression: repeat and pause differences
  zero).
- Empty-space skipping without a second structure: a voxel is non-zero only
  inside its own column's layer plus one slice and a trilinear read reaches one
  more, so the union of the four columns a bilinear footprint reads (two
  gathers) bounds every contributing voxel. Samples outside it are exactly
  empty and skip the volume fetch, which is most of a march below or above a
  deck. Inside the volume the field is already band-limited to its voxels, so
  the subsample count of long bins follows the voxel scale instead of a fixed
  eight.
- Local sun-ray profile maps are toroidal and world-anchored, so camera
  motion regenerates only entering columns instead of both maps every frame;
  animation refreshes interleaved rows. Refresh decisions are uniform per
  64-wide workgroup row: skipping individual threads left their warps running.
- The cloud march breaks out past the opaque limit instead of iterating empty
  bins, and an optional far-field pass integrates bins beyond
  `cloud_far_distance` at reduced resolution (`cloud_far_scale`), composed with
  the depth-guided validity test and an exact per-pixel fallback. It is off
  in the high preset because it visibly softens the horizon band; medium and
  low use it.

Water and terrain

- Ocean draw list. The sea sphere is drawn with the terrain's conforming
  triangles, so inland frames paid the whole wave vertex evaluation for
  triangles hidden under the terrain. `gpu_bounds_finish` now marks the union
  patches whose world box, lowered by the level's published height error, can
  reach the highest sea surface (sea level plus twice the wave amplitude plus
  8 m), `gpu_indices` copies only those patches into an ocean region of the
  index bank, and both sea draws use that list. A patch left out cannot show
  any sea surface, so the image is unchanged.
- The sea sphere under land ran its full coastal evaluation for every hidden
  fragment because the fragment writes its own depth. It now compares against
  the opaque position first and returns its proxy depth when it cannot win.
  The ocean vertex carries its spacing so that test stays conservative by the
  triangle's chord sag.
- Terrain depth pre-pass. Relief refinement writes fragment depth, which
  disables early depth rejection, so every hidden terrain fragment refined
  its relief. A pre-pass records each pixel's nearest unrefined forward
  distance and trust radius (refinement moves a hit along its ray by at most
  that radius); the main pass skips refinement for fragments that cannot win.
  Fragments the distant shoreline refinement may touch are excluded, because
  that refinement is a sphere intersection with no such bound (the first
  version without this exclusion moved isolated silhouette pixels by
  kilometres, caught by the image comparison).
- Without the water pass (disabled, or still compiling) the composite reads
  the shaded surface directly instead of a full-screen pass-through dispatch.

Frame pipelining and host work

- The render worker answers a frame request when the previous frame has
  completed (queue depth two), so the page encodes the next frame while the
  GPU works; at queue depth one it waits for its own frame, which the timing
  harness relies on. A synchronous completion promise replaces an async
  wasm-bindgen borrow that tripped the aliasing guard.
- Stats JSON is refreshed at most every 100 ms instead of every frame.
- The scenery placement budget per frame is a preset value (4096 on high,
  down to 512 on minimal; validation accepts up to 8192), so forests fill
  faster after camera cuts on strong devices.

Presets, settings and allocation tiers

- `web/quality.js` defines ultra, high, medium, low and minimal presets as plain
  settings patches; the UI shows a Quality select plus a Quality details
  section (render scale, far clouds, cloud refresh, shadows, terrain shadow
  steps, prop shadow cascades, cloud light samples, aerial steps, wave bands,
  reflections, relief steps) alongside the existing cloud, terrain, scenery
  and ocean controls. Changing any control makes the preset Custom. The
  choice persists in localStorage; `?quality=` and `?tier=` override it and
  `?test=1` pins ultra (full-size 128-sample clouds, the former high) for the
  regression tools. Since the evening of 27 October the high preset renders
  clouds at half size with 64 samples; the composite's depth-guided bilinear
  upsample keeps terrain silhouettes, and the far-field filter below removes
  the sampling moire the owner saw on distant decks. Cloud stage p50 at
  1920x1080 (30 frames after 90 settle frames, same build, same views):

  | View | Ultra (full, 128) | High (half, 64) |
  |---|---:|---:|
  | clouds | 29.0 ms | 4.1 ms |
  | horizon | 29.0 ms | 3.9 ms |
  | canopy | 20.7 ms | 2.9 ms |
  | forest | 11.8 ms | 1.9 ms |
  | coast | 12.8 ms | 1.9 ms |

  The "little squares" on distant decks were aliasing, not upsampling: beyond
  the 15 km voxel cache the procedural field was sampled every 1 to 2 km
  along the logarithmic bins while its finest puff band is 1 km, and
  neighbouring pixels sample the same depths, so the sampling lattice showed
  as blocky moire. `cloud_interval_radiance` now uses each sample's own
  longitudinal spacing as the field's filter footprint beyond the pixel
  footprint (bands enter the filter at a footprint above a quarter of their
  scale, so bins up to 512 m, every near and cached bin, are unchanged);
  detail the samples cannot integrate becomes the statistical coverage term
  instead of moire.
- Terrain shadows (same evening): the per-pixel sun march was replaced by
  per-frame sun horizon maps swept over the height clipmaps; the query is a
  few bilinear fetches plus 4 to 7 canonical samples, and the sweep is a
  fixed 2.4 Mtexel pass per frame on the full tier. Design, evidence and the
  measured residual are in [SUN-SHADOWS.md](SUN-SHADOWS.md). A matrix run
  on the final build (1920x1080, 120 frames, high preset) put the shading
  stage at 4.5 ms in the forest and the `sun_height_cache` stage (height
  refill plus the sweep) at 3.5 ms in every view; those two together are
  the shadow cost, against 4.5 ms of shading-stage shadow work before. The
  run is not a clean measurement: another process held the GPU at 12-37%
  utilization throughout the evening (the explorer page open in a browser
  on this machine), so every frame time of that run reads 20-40% high and
  is not tabulated here. The sweep then became incremental (a level
  re-sweeps only when its window recentred, its texels refilled or the sun
  changed): under the same external load the stage left the top stages
  entirely and the forest and coast high-preset frames fell from 26.3 and
  26.8 ms to 23.5 and 23.2 ms.
- A stale `reference` flag could force full-size clouds back: the page merges
  patches into its own settings copy, the renderer derives `reference` from
  `cloud_scale`, and the renderer's `configure` then used the mismatch to
  reset `cloud_scale` to 1 on the next unrelated change (measured as 4.1 ms
  becoming 15.9 ms with identical settings). `reference` is now derived only.
- Below full cloud resolution the opaque limit of a cloud texel's ray is the
  bilinear interpolation of the limits of the four pixels around the ray
  (`cloud_limit`), not the limit of the pixel to its lower right: that pixel's
  terrain is half a pixel nearer, tens of km nearer toward the limb from
  orbit, and the march ended before the clouds over the upper-left of the
  planet (28 October, `SUN-SHADOWS.md`, "Clouds missing over one side of the
  screen").
- Regression of this pass, found 28 October: the wave cache was sized for its
  four coarse levels only (`wave_entries` counted B*B/64 * 85 entries, the
  offset of the fine level, not the B*B/64 * 149 of the whole layout), so
  the fine level, which supplies every wave within 24 m of the eye and the
  caustic integration below 23 m, wrote out of bounds and read back empty
  on every tier: flat water near the camera (perfect reflections, no foam
  detail), a round Snell's window from below, blurred near caustics. Fixed
  by deriving the entry count from the level sizes; `audit_water` reports
  each level's population and mean slope, `tools/Test-Water-Near.mjs` gates
  the near-field detail against the far field and `Test-Explorer-Water.mjs`
  gates the audit. The fine level costs 32 MB on the full tier, as before
  the pass.
- Cloud sunlight gained a third local profile map (1024 m texels between the
  256 m and 4096 m ones, 4.3 MB more) and the fine and middle maps hand over
  from 48 to 126 texels instead of 104 to 126: 0.1 to 0.25 ms more on the
  clouds stage at 1080p on the high preset (`SUN-SHADOWS.md`, "Cloud
  self-shadowing hand-over").
- New renderer settings: `render_scale`, `cloud_far_scale`,
  `cloud_far_distance`, `cloud_refresh`, `shadow_cascades`,
  `profile_quality`, `atmosphere_steps`, `water_bands`, `water_reflections`,
  `relief_steps`, `scenery_budget` range. Presentation is a bilinear resolve,
  exact at scale 1.
- Resident caches come in three allocation tiers fixed at startup
  (`crates/solar-explorer/src/tier.rs`): full, reduced and minimal. Sizes
  reach shaders through the frame uniform, never as compile-time constants.
  Device detection (mobile class, adapter limits, thread count) picks the
  starting preset and tier and sizes the canvas to the phone screen (capped at
  1280 px); desktops keep the fixed 1920x1080 canvas. The minimal tier with
  the minimal preset uses about 225 MiB of controlled GPU memory against 974
  MiB for full/high.

## Measured approximations and limits

- The cached sunlight volume interpolates optical depth trilinearly at 256 m
  cells; the static-scene comparison against the published build shows
  differences in cloud regions (ring-shaped patterns in the amplified
  difference images), with display p99 of a few codes in the tall-cumulus and
  cloud-deck views. Terrain, props and water regions match within the exact
  gates except where the far-field split is enabled, and except for isolated
  coastal pixels at orbit where the bed and beam receivers now share the
  surface visibility (display p99 1, a few pixels up to 86 codes).
- Two-part shadow refinement is exact at shadow edges but the cheap test and
  the two-part estimate use conservative envelopes computed on the CPU; they
  are still sampled visibility along a geometric progression, not a
  certificate.
- Interleaved refresh means an animated texel can be up to `cloud_refresh - 1`
  frames old; at 8 m/s wind that is centimetres per frame.
- The far-field cloud pass changes the horizon band visibly and is a preset
  choice, not a hidden default; it is disabled above 20 km altitude.
- Reduced and minimal tiers lower patch counts, scenery windows, shadow and
  profile map sizes and cloud volume sizes; those are capacity reductions,
  documented in the stats `tier` object, not free speedups.
- The first image shows terrain without shadows, sea, clouds or props for a
  few seconds; those features appear as their programs compile. This is an
  explicit loading state with a placeholder sea, not a quality mode.
- Mobile hardware was not available in this pass. Device detection, the
  minimal tier (225 MiB) and the minimal preset were validated on the desktop
  GPU only; whether a given phone's driver survives the remaining allocations
  and compile times is unverified.
- The ocean draw list depends on the per-level height error bound being a
  bound on the canonical field; the image comparison against the previous
  build (every view, exact gates) is the evidence that no visible sea was
  removed, not a proof for every camera.

## Evidence and reproduction

All numbers: RTX 3080 workstation, private headless Edge (BrowserWebGpu),
serial runs, 27 October 2026. Raw reports are under `evidence/local/perf-pass/`
(not committed). The baseline is the published checkpoint package copied to
`evidence/local/perf-pass/baseline-web`.

Startup, cold profile, 1920x1080 canvas, full tier, high preset
(`node tools/Test-Startup.mjs <dir>`; the device-loss variant adds `--loss`):

| Build | First image | Complete renderer | Water program (concurrent) | Lanes |
|---|---:|---:|---:|---:|
| Published checkpoint (26 Oct) | 28.7 s | 28.7 s | 22.5 s | 2 |
| Compile cuts | 10.7 s | 10.7 s | 6.3 s | 4 |
| Final build | 4.7 s | 8.7 s | 7.8 s | 8 + 3 |

Frame times, 1920x1080, animated weather, p50 / p95 of 120 frames after
240 warm-up and 60 settle frames (`node tools/Measure-Matrix.mjs --views
forest,coast,clouds --matrix <patches.json> --capture`). "Baseline" is the
same patch on the published checkpoint. Controlled GPU bytes are reported by
the renderer for the full tier (presets change work, not allocations; the
minimal tier with the minimal preset allocates about 225 MiB).

| View | Patch | Final p50 / p95 | Baseline p50 | Largest stages (ms) |
|---|---|---:|---:|---|
| forest | default (high) | 32.4 / 33.2 | 45.7 | clouds 11.1, shading 6.5, raster 4.3, scenery shading 2.5, water 1.9 |
| forest | no water | 30.4 / 31.0 | 42.5 | clouds 11.0, shading 6.4, raster 4.3 |
| forest | no clouds | 18.6 / 18.8 | 26.1 | shading 6.4, raster 4.4, scenery shading 2.5 |
| forest | no shadows | 19.7 / 20.3 | 21.6 | clouds 9.5, raster 4.3, water 1.9 |
| forest | far clouds at half resolution | 29.8 / 30.5 | - | clouds 8.6, shading 6.4, raster 4.3 |
| forest | clouds at half resolution | 24.9 / 25.7 | 36.7 | shading 6.4, raster 4.3, clouds 3.7 |
| forest | medium preset | 22.1 / 22.6 | - | shading 6.4, raster 4.2, clouds 2.6 |
| forest | low preset | 10.2 / 10.5 | - | shading 3.0, raster 1.5, water 1.3 |
| forest | minimal preset | 2.9 / 3.2 | 2.6 | water 1.0, clouds 0.4, raster 0.3 |
| coast | default (high) | 31.9 / 32.4 | 42.8 | clouds 12.6, shading 7.6, raster 3.5, water 2.3 |
| coast | no water | 29.7 / 30.5 | 39.6 | clouds 12.6, shading 7.6, raster 3.5 |
| coast | no clouds | 16.4 / 16.7 | 23.1 | shading 7.6, raster 3.5, water 2.3 |
| coast | no shadows | 21.2 / 21.8 | 21.7 | clouds 12.2, raster 3.5, water 2.3 |
| coast | clouds at half resolution | 22.9 / 23.6 | 33.2 | shading 7.6, clouds 3.8, raster 3.4 |
| coast | medium preset | 19.8 / 20.1 | - | shading 7.5, raster 3.4, clouds 2.4 |
| coast | low preset | 9.3 / 9.6 | - | shading 3.3, water 1.6, raster 1.4 |
| clouds | default (high) | 44.5 / 45.6 | 60.6 | clouds 28.9, raster 5.3, shading 5.0 |
| clouds | no clouds | 12.4 / 12.7 | 18.2 | raster 5.2, shading 4.7, water 1.2 |
| clouds | no shadows | 34.3 / 35.0 | 40.7 | clouds 25.7, raster 5.3, water 1.0 |
| clouds | far clouds at half resolution | 35.9 / 36.6 | - | clouds 20.3, raster 5.2, shading 5.0 |
| clouds | clouds at half resolution | 22.8 / 23.4 | 34.2 | clouds 7.4, raster 5.2, shading 4.9 |
| clouds | medium preset | 17.3 / 17.7 | - | shading 4.9, raster 4.7, clouds 3.7 |
| clouds | low preset | 7.7 / 7.9 | - | shading 2.4, raster 1.9, water 0.9 |
| clouds | minimal preset | 2.1 / 2.3 | 2.0 | water 0.5, clouds 0.3, raster 0.3 |

Interleaved confirmation, 1920x1080, animated weather, two rounds of 300
measured frames per arm after 360 warm-up frames (`node
tools/Measure-Integrated.mjs --rounds 2 --warmup 360 --frames 300 --views
forest,coast,clouds,orbit --modes animated`, summarized by
`tools/Summarize-Integrated.py`):

| View | Checkpoint p50 / p95 / p99 | Final p50 / p95 / p99 | Change at p50 |
|---|---:|---:|---:|
| forest | 45.4 / 46.4 / 47.1 | 32.0 / 32.6 / 33.8 | -29.5% |
| coast | 42.6 / 43.5 / 44.2 | 31.5 / 32.3 / 33.4 | -25.9% |
| clouds | 60.2 / 61.4 / 62.0 | 44.0 / 44.8 / 45.3 | -27.0% |
| orbit | 47.5 / 54.2 / 55.1 | 41.0 / 47.7 / 49.1 | -13.7% |

The high preset is 29% (forest), 26% (coast) and 27% (clouds view) faster
than the checkpoint at the same settings; 60 fps at 1080p on this GPU needs
the medium preset in the cloud view and the medium or low preset elsewhere.
The minimal preset is slightly slower than the checkpoint's minimal row
because its water stage now evaluates the cheap sea at every pixel instead of
skipping the pass; it runs a few hundred frames per second either way.

Static image comparison against the published checkpoint, 640x360, frozen
weather, every default view (`node tools/Measure-Integrated.mjs --baseline
evidence/local/perf-pass/baseline-web --candidate web --modes frozen
--capture`, then `python tools/Compare-Integrated.py <dir> --approximate`):

| View | Result | Worst region |
|---|---|---|
| forest, conifers, clouds, terminator-night | pass | display p99 1 code |
| coast | fail (cloud edges) | display p99 1, max 1; cloud relative RMSE 0.107 at cloud edges |
| inside | fail (cloud regions) | display p99 3, max 6; cloud relative RMSE 0.021 |
| rough | fail (cloud regions) | display p99 3, max 5; cloud relative RMSE 0.017 |
| tall | fail (cloud regions, cloud shadows) | display p99 6, max 8 in thin cloud; terrain cloud-shadow transmittance p99 0.013 |
| orbit | fail (isolated water pixels) | display p99 1, max 86; water relative RMSE 0.022 |

Terrain positions, normals and materials are identical in every view
(position difference 0 m), so the pre-pass, the ocean draw list and the
single-evaluator shadows are exact; the remaining differences are the
cached cloud light (optical depth at 256 m cells), the toroidal sun cloud
profiles under terrain, and the shared water surface visibility.

New tools: `tools/Measure-Matrix.mjs` (settings-patch attribution matrix),
`tools/Measure-Compile.mjs` (per-entry browser compile timing, with `--dir`
for bisection on modified sources), `tools/Probe-Pipelining.mjs` (frame queue
behaviour) and `tools/Probe-Features.mjs` (deferred-feature state and
captures after startup). `tools/Explorer-Test-Lib.mjs` captures the internal
target size when a preset renders below scale one.

Native (validation backend only, Vulkan, same GPU): `solar-gpu-probe`
passes; the explorer binary reaches its first image in 9.0 s cold and 0.5 s
with the persisted pipeline cache (`target/pipeline-cache/`, 2.8 MB). The
packaged static site (`node tools/Package-Explorer.mjs`, then `node
tools/Test-Explorer-Deployment.mjs --local`) starts, renders and keeps every
default and control the deployment test checks. `tools/Test-Reconstruction.mjs`
targets the old field-lab page (`web/field.html`) at the root URL and has
timed out since the explorer became the root page before this pass; it is
not a renderer check.

Regression tests on the final build (all pass): terrain shadow stability
(7/7, max drift 0.018), integrated reuse (18 gates, rewritten for the
toroidal profiles), cloud shell, scenery validate and controls, prop shadow
stability, cloud formations (repeat and pause differences zero), water at
night, water, shore, water interface, scenery water edges, water motion, LOD
control, startup with device loss and recovery, and `tools/Check.ps1`
(format, tests, clippy with denied warnings, WASM checks, Naga validation).

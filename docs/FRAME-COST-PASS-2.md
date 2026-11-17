# Frame cost, pass 2 (14-15 November 2026)

Step 3 of [SOLAR-SYSTEM-V2-PLAN.md](SOLAR-SYSTEM-V2-PLAN.md), after
[FRAME-COST-SUN-DRIFT.md](FRAME-COST-SUN-DRIFT.md) and the car's removal (72199fd). Target:
GPU frame at or under 16.7 ms p95 on the RTX 3080 at 1920 x 1080 High, in motion.
**Not reached.** Earth hover settles at about 47 ms p50 once the water layer has arrived
(see "Steady state"), and the cloud dive spends 30-33 ms in the view clouds alone. Bodies
without Earth's data (procedural worlds, Mars) are already at the owner's target.

## How it was measured

- `tools/Trace-Flight.mjs`, free camera, real-time solar clock, 1920 x 1080 High, 8 s per
  scene after warm-up (14 s, summarised after 8 s, from 15 November: see "Steady state"), scenes `earth-hover`, `earth-low`, `earth-dive` (and `moon-descent`
  for the scheduler). The whole-frame timeline (`timing.rs` `Marker`) partitions the frame,
  so stage values are per-stage medians of intervals that add up to the GPU span.
- Builds are immutable snapshots on the data disk (`tools/Snapshot-To.mjs`) served with
  `tools/serve.mjs --root`, so no run reads files that change while it runs.
- Baseline and candidate alternate (A B A B). Only interleaved pairs are compared.
- Contamination monitor: other processes on the GPU inflated every stage 2-3x in some
  early runs. Each run now samples, every 2 s, the 3D-engine use of every process whose
  command line is not a headless browser, and records the maximum. The owner's launcher
  and desktop apps hold this at 12-21% around the clock, so a 5% gate never opened
  (10 hours waiting on 15 November); the gate is now 25% with the measured maximum
  reported, and both sides of a pair see the same background. Absolute values therefore
  read roughly 10% high on both sides.
- Image evidence: `tools/Compare-Builds.mjs` (paused clock, 6 procedural views x display,
  shaded and water buffers). A paused clock does not exercise the sun-drift paths; those
  rest on the stated bounds, not on an image test.

## Changes kept

| Commit | Change | Measured (p50 unless noted) | Images |
| --- | --- | --- | --- |
| 95fd9ff | Terrain scheduler kernels (`gpu_select`, `gpu_reclaim`, `gpu_union_collect`) run one 256-lane workgroup with the exact serial order (lowest-index argmax, prefix-sum appends, lane-0 mutation) | Earth hover GPU p50/p95 33.2/39.0 -> 28.6/33.1 ms; `gpu_select` 4.16 -> 0.08 ms | identical |
| e449292 | Horizon maps re-sweep for sun drift every third frame, staggered by level | sun system 7.89 -> 7.23 ms | identical (not exercised) |
| 52642ba | Timeline marks inside the sun system and scenery | attribution only | - |
| a887e2c | Cloud shadow bake skips the noise for sun-ray samples whose vertical span is outside the deck (the profile is exactly zero there) | `sun_cloud_global` 1.51-1.73 -> 1.26-1.27 ms; `sun_cloud_local` 3.14-3.31 -> 2.33-2.36 ms | identical |
| 36f10a6 | Horizon sweep: one 64-lane workgroup per pencil line (fetches and geometry in parallel, the suffix recurrence on lane 0 in the serial order) | `sun_horizon_sweep` 2.9-3.1 -> 0.55-0.69 ms | identical |
| bd22c7a | Timeline marks: lifted ocean and water mesh timed apart | attribution only | - |
| 4edc8a6 | Terrain shadows: an exact march of the sun ray over the cached heights, with terrain-only block maxima, replaces the horizon maps and their sun re-sweeps (a correctness fix for the owner's Matterhorn shards and flicker; [SUN-SHADOWS.md](SUN-SHADOWS.md), 15 November) | GPU p50, two interleaved pairs: Matterhorn 42.0, 42.6 -> 41.8, 42.0 ms; mountain flight 36.5, 37.2 -> 38.8, 38.3 ms; Mars 12.0, 11.6 -> 11.2, 11.3 ms; Lavaux hover 51.7, 50.8 -> 49.5, 48.7 ms | not identical: shards and drift flicker gone, edges match a brute-force march |
| (this commit) | Water: the interactive ripple simulation removed (owner's decision, 16 November: nothing pushes water since the car went). Gone: the 512 x 512 wave-equation chart, its camera-contact and R-key sources, the "Disturb water" button and the "Physical ripples" setting. Kept: chart relocation, coastal bed, procedural wave cache, foam advection. Timeline marks now split the old `water_simulation` into `water_chart`, `water_bed`, `water_waves`, `water_foam` | Attribution (earth-hover, two runs, p50): chart 0.017 ms, bed 0.006, wave cache 1.33-1.56, ripple+foam step 0.071, of which the idle ripple write 0.005. The 1.4 ms mark is the wave cache, which stays: no frame-time gain is claimed. Bought: 8 MiB of buffers (water state 88,867,008 -> 80,478,368 bytes on the full tier) and storage bindings 34/35 freed in the five water pipelines (the water pass was at the 8-per-stage limit). Interleaved frame timing and compile time before/after: not measured | identical: Compare-Builds 18 of 18 captures (6 views x display, shaded, water) against 50a1e5b; in motion, 400 frames at 0.5 m a frame along a coast (chart relocating, foam history advecting), display, water buffer and foam mean/peak identical at 3 points |

## Publish cleanup check (16 November)

The publish cleanup (3162415 to fec3e84: dead Rust items and WGSL functions removed, comments
reworded, notices and docs) is meant to change nothing. Evidence, baseline 0a580da against the
cleaned build:

- All 91 specialized shader programs that `build.rs` emits are byte-identical, so the browser
  compiles the same GPU code (checked again from a clean clone of the public snapshot; an older
  target directory also holds 22 stale programs of removed features, which the build no longer
  emits).
- `tools/Compare-Builds.mjs`: 18 of 18 captures identical (6 views x display, shaded, water).
- One interleaved run pair on `earth-hover` (14 s, summarised after 8 s, GPU span p50 / p95 ms,
  background GPU about 15%): A 46.5 / 49.7, B 47.3 / 50.6, A 48.8 / 51.2, B 49.4 / 51.8. B reads
  0.6-0.8 ms higher in both pairs, against a 2.3 ms drift between the two A runs; with identical
  GPU programs, that is read as run-to-run variation, not a change.

## Negative results (measured, reverted)

- **Cloud shadow lag setting.** Rebuilding the cloud shadow profiles less often while the
  sun drifts (divisor 4) measured no gain: the profile maps are rebuilt for the cloud
  animation anyway, and cloud features move about 50 m/s at real time (travel, evolution
  and wind), so the maps cannot lag the clouds without visible error.
- **View-march empty-bin skip.** An exact test (`cloud_segment_empty`) that skips whole
  log-depth bins of the view march whose weather texels bound the cloud to zero. A GPU
  audit compared the skip against the full march: 0 wrong of 39 M skipped bins (144 M
  bins audited). On Earth it
  gained nothing (dive clouds 30.6 vs 30.9 ms; low flight 6.0 -> 6.8 ms, the test cost
  more than it saved): Earth's weather leaves almost no bin empty along a view ray.

- **Horizon re-sweep schedule.** Sweeping at most one drifting level per frame (plus any at a
  quarter-texel tolerance, with receivers widening their test by the remaining lag) cut the
  sweep only 3.1 -> 2.5 ms: the kernel was one thread per line walking up to 2n dependent
  steps, so its cost was one walk, not the number of levels. 36f10a6 fixed the kernel; the
  schedule (and its first-order bound) was dropped.
- **Water screen march from a 4-byte depth.** The reflection and refraction marches read the
  16-byte position target at scattered texels. A 4-byte view-depth copy with an exact
  fallback near zero gap (pixel-identical), then prefetching all 14 steps' depths, both
  measured no change (water pass 8.4-9.0 ms either way). A second attribution showed the
  marches cost under 0.3 ms: switching reflections off saves nothing. The single earlier run
  that read 8.3 -> 2.35 ms was one run of a streaming-dependent state and was not repeated
  before acting on it. Also learnt: the water pass is at WebGPU's default limits (16 sampled
  textures, 8 storage buffers per stage); a new binding there needs one freed first.

## Steady state

The 8 s traces ended about when the Earth water layer arrives (5.5-7 s into the hover and
low-flight scenes), so they mostly measured the frame without it. From then on the frame is
about 47 ms p50 at Lavaux (1080p High): water mesh 7 ms, lifted ocean 4-5 ms, water pass
8-9 ms, water simulation 1.4 ms (almost all of it the procedural wave cache, see the ripple removal row), near-plane water 0.7 ms: about 21 ms of water. Traces now
run 14 s and are summarised after 8 s.

## Where the frame goes now (Earth hover, 1080p High, before the water layer)

| Stage | p50 |
| --- | --- |
| clouds (view march) | 5.2-6.5 ms |
| shade | 4.6-5.2 ms |
| water (all passes) | ~3.7 ms |
| sun horizon sweep (0.04 ms with the clock stopped) | 0.55-0.69 ms |
| sun cloud shadow local / global | 2.3-2.9 / 1.2 ms |
| terrain raster | 2.5-2.9 ms |
| scenery encode | 1.55 ms (about 1.3 ms of it after the generation mark, not yet attributed) |
| space | 0.74 ms |

In the cloud dive the view clouds take 30-33 ms alone: inside the deck each log bin
takes up to 9 samples. Fewer samples change the image, so that is not a free
optimization; the candidates are temporal reconstruction or render scale, each as an
explicit setting.

## Next

1. Water, per pixel: the mesh and lifted-ocean fragments (ocean_fragment writes depth, so no
   early depth rejection; its occlusion early-out comes after the inland level refinement)
   and the water pass's own per-pixel cost, attributed by repeated runs, not single ones.
2. Dive clouds: explicit temporal cloud reconstruction setting, measured against the
   full march with image error reported.
3. Shade.
4. Scenery encode residue.
5. An explicit render-scale / upscaler setting for the High and Medium tiers and mobile.

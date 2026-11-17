# Solar-System v2 — rework plan (14 November 2026)

Owner decision, 14 November 2026: the research engine becomes **Solar-System v2**, the open-source follow-up to
`3merillon/Solar-System` (MIT). Code is MIT; data sources keep their own licences, listed separately.
The goal is to explore the universe in a browser: Rust → WASM → WebGPU / WGSL stays.
The engine must handle physics and high-speed flight into planets with **no holds, waits or hitches**.
Nothing is pushed or published without the owner's instruction.

The plan was written for the flying car (Halley). On the evening of 14 November 2026 the owner removed the
car; the viewer is a free-flying camera. Steps 1 and 2 below describe the car's physics, kept for their
measurements ([VEHICLE.md](VEHICLE.md), [PHYSICS-NO-HOLDS.md](PHYSICS-NO-HOLDS.md)).

## Baseline: real-time hitch trace

`tools/Trace-Hitches.mjs` (removed with the car; `tools/Trace-Flight.mjs` traces the free camera) ran the unpaused game loop (two frames in flight, wall-clock dt, 1920×1080 High)
and records one row per presented frame: rAF interval, GPU span, worker CPU, physics hold/coverage-wait/
discarded time, and distance moved against speed × interval. Profiling is on (diagnostic only).
The existing stepped tests (`runFrames`) wait for every frame to drain, so readbacks always land in time
and they cannot see this failure.

Results, 14 November 2026, commit 45d7eab plus the uncommitted `build.rs` loop-bound change:

| Scene | Frames | GPU p50 / p99 | Long frames | Held frames | Outcome |
| --- | ---: | --- | --- | ---: | --- |
| Lunar descent, 9 km/s from 30 km | 1,441 | 2.4 / 10.7 ms | none > 20 ms | 944 (65%) | Orbital path to ~2 km, then held for the remaining 8 s at 9 km/s, mid-air. Stream idle, 16,641 of 16,641 terrain samples unresolved, collision grid 129 m wide at 1 m spacing. Deadlock. |
| Procedural arrival, ~1.2–1.9 km/s | 422 | 94 / 152 ms | 131 > 50 ms, 39 > 100 ms | 133 (32%) | Three holds (0.3 s, 1.6 s, 2.6 s), then runs. 0.13 s discarded; physics step p99 106 ms. |
| Earth low flight, ~500 m/s | 438 | 88 / 127 ms | 157 > 50 ms, 23 > 100 ms | 41 (9%) | Eight short holds of 0.1–0.2 s in 15 s, still holding at the end (9,144 samples unresolved). 0.25 s discarded. |

GPU span is the time from the first to the last GPU timestamp of each frame. On 10 November, static low
flight measured 39 ms and static terrain-only scenes 23–26 ms (serial, one frame in flight). Moving through
streamed terrain costs more than twice that. So "blocky, stuttery" has **two causes**: frames at about
10 fps while moving, and physics holds on top of that.

Raw data: `evidence/local/hitch-trace-2026-11-14/`.

## Why the car is held

1. **Collision is read back from the GPU's rendered surface** (`physics_stream.rs`). Physics may not
   advance where readback coverage is missing (`VEHICLE.md` §Local collision world). Required coverage
   grows with speed while readback latency stays the same, so the faster the craft, the more it is held.
   At orbital-entry speeds this deadlocks.
2. **Physics only advances inside render frames.** Frame time above 0.1 s is discarded
   (`vehicle_physics.rs`), and the page clamps its own dt to 50 ms, so a heavy frame turns into slow motion
   or a jump instead of smooth motion.

3. **The GPU frame is 5× over budget while moving** (88–94 ms p50 against 16.7 ms). Physics on its own
   clock cannot fix what the eye sees at 10 fps; the frame cost has to fall too.

## Plan

Steps 1 and 3 go together: step 1 makes motion continuous, step 3 makes it visible at 60 fps.

### 1. Physics that never waits
- Collide against the CPU height data the engine already holds: `PageField` (solar-core) mirrors
  measured height pages, and procedural bodies have a CPU height function. Use the finest resident level
  with a declared per-level error bound. Coarser data widens the contact margin; it never pauses the
  simulation. When finer data arrives, correct gradually, with the correction size reported.
- Port the GPU surface refinement to a renderer-independent CPU reference (the project's research rules), so the craft
  touches the surface it sees. Bounds per operation: unknown bounds remain unknown, and a fallback is
  documented rather than hidden.
- Objects (buildings, rocks, trees): CPU placement from the same rules (`scenery_reference.rs` is a start)
  instead of GPU readback.
- Physics on its own fixed clock, decoupled from render frames; rendering interpolates between steps.
  No silent time discard: any cap is a reported setting.
- Swept, speed-aware collision at any speed: conservative min/max height pyramid for CCD at kilometres per
  second, exact contact near the ground.
- Gates: the real-time trace must show zero held frames, zero coverage waits and no frozen or jump frames
  on lunar descent, procedural arrival and Earth flight, cold cache and camera cut included.

### 2. Arrival streaming
- Prefetch along the predicted trajectory; bounded uploads per frame; every pipeline a destination needs
  compiled before arrival; nothing first-used on the arrival frame.
- Gate: p99 / max frame interval during descent and cut, with the worst frames attributed.

### 3. Frame cost while moving (runs alongside step 1)
Stage medians from a second real-time run (ms, p50; medians do not add up to the span):

| Stage | Earth flight (span 90) | Procedural arrival (span 56) |
| --- | ---: | ---: |
| water | 14.8 | 9.9 |
| sun_cloud_local | 13.4 | 6.6 |
| sun_cloud_global | 5.4 | 7.0 |
| sun_height_cache | 3.4 | 4.8 |
| clouds | 7.3 | 0.9 |
| gpu_scheduling | 5.9 | 4.5 |
| raster + shading | 4.6 | 0.7 |

Procedural arrival measured 94 ms in the first run and 56 ms in the second, so run-to-run variation is
large; final claims need interleaved quiet runs. Sun and cloud shadowing (about 22 ms) and water (about
15 ms) dominate; terrain raster and shading are small. Sun shadowing every frame is the owner's
requirement, so the work is to make it cheaper or incremental while the craft moves, not to skip it.
- Then remove per-frame JSON stats from the hot path, report p50/p95/p99 under the measurement rules,
  and add explicit quality tiers for mobile.

### 4. Startup
- Finish and measure the shader-compile work (`docs/STARTUP.md`, 13 November: loop bounds still
  uncommitted, frame cost unmeasured).

### 5. Rebrand and publish audit (before any upload)
- Name: Solar-System v2. New name for the car. Remove the research codename and the original model's name from public
  surfaces.
- MIT `LICENSE`; `THIRD-PARTY-NOTICES` for data (EOX and FABDEM are CC BY-NC-SA, plus NASA/USGS, BSC5,
  SBDB terms) and the car model (CC-BY 3.0, natman).
- Scrub private paths (local bakes, local evidence), internal hand-off files, and large binaries; decide
  pack hosting.
- Merge layout over `3merillon/Solar-System`: v2 replaces the Vite/WebGL2 app; the old app's history
  is kept.

## Status, 17 November 2026 (published)

Published as version 2 of the Solar-System repository. What changed against the table of 16 November below:

| Step | State | Evidence |
| --- | --- | --- |
| 3. Frame cost | Not worked on since pass 2. Measured again for the README on 17 November (one run per scene, 1920 x 1080 High, RTX 3080, GPU p50 / p95 / p99): Earth hover 42.0 / 44.3 / 45.3 ms, Mars arrival 9.8 / 11.6 / 11.9 ms, a procedural world of another star 11.8 / 14.8 / 14.9 ms, the Sun from two radii 2.6 / 2.8 / 2.9 ms. Earth near the ground is still not at 60 frames per second. | README, "Measured" |
| 4. Startup | Measured for the README: new browser profile, first picture 13 s, ready 35 s; second start 11 s and 27 s; 87 programs. The driver cache was warm, so this is not a first-ever start (see STARTUP.md). | README, "Measured"; [STARTUP.md](STARTUP.md) |
| 5. Rebrand and audit | Final pass: notices rewritten to what is used (the tone curve's licences, every pack's products and credits); development branch names and the pack host's address out of the tree; the pack host named by the deployment's environment; a local build downloads the packs from the repository's `packs-v1` release (`tools/Fetch-Packs.mjs`); slider labels and hint contrast fixed; links to the repository and to the author in the panel. | README, [../THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) |
| Not done | The options of each body's bake are not recorded, so a rebake from sources is not turnkey. Phones, integrated graphics and Apple frame times are not measured. The panel's buttons cannot be pressed from the keyboard alone. No continuous integration. | README |

## Status, 16 November 2026

| Step | State | Evidence |
| --- | --- | --- |
| 1. Physics that never waits | Closed with the car's removal (14 November): the free camera has no collision physics. The no-hold terrain contact below was done and measured before that. | [PHYSICS-NO-HOLDS.md](PHYSICS-NO-HOLDS.md) |
| 2. Arrival streaming | Measured on 14 November, nothing changed (see the row of that date). Trajectory prefetch not implemented. | this section |
| 3. Frame cost | Pass 2 done (14-15 November), each kept change pixel-identical or a stated correctness fix: parallel terrain scheduler (Earth hover 33.2 -> 28.6 ms p50 before the water layer), one workgroup per horizon line, cloud-shadow bake skip; then terrain shadows moved from horizon maps to an exact cached march (4edc8a6, a correctness fix at equal or lower cost except mountain flight, +1.1 and +2.3 ms in two pairs); the interactive ripple simulation removed (16 November, no frame gain claimed). Earth hover settles at about 47 ms p50 at 1080p High once the water layer arrives (about 21 ms of it water); the cloud dive spends 30-33 ms in view clouds. Mars 11-12 ms p50; procedural worlds and Mars within the target. Not done: water per-pixel cost, dive clouds, mobile tiers. | [FRAME-COST-PASS-2.md](FRAME-COST-PASS-2.md), [SUN-SHADOWS.md](SUN-SHADOWS.md) |
| 4. Startup | Unchanged since 14 November: constant loop bounds by default, cold compile near 75 s wall. The exact march's (`sun_terrain`) compile time is not measured. | [STARTUP.md](STARTUP.md) |
| 5. Rebrand and audit | Done, with the publish cleanup of 16 November: dead code, the old field lab and research scripts out of the public tree (`tools/research/` stays in the development repository), notices for the 51 Rust crates in the WASM, crate licence metadata, README and [docs index](README.md). Data packs: every pack served from the owner's pack host (named by `SOLAR_PACK_BASE` in the deployment's environment, which `tools/Build-Vercel.sh` passes on), read through `web/pack-base.js`; no data repository (owner, 16 November). Tested headless against a second local origin with CORS: fine Moon (levels 4-6) and Mars (4-5) pages, sky and pinned Earth all arrive (README, "Data packs"). | `README.md`, `THIRD-PARTY-NOTICES.md` |
| Beyond the plan | Stellar travel from the free camera (five star systems, 23 synthetic worlds); the IAU's named features on the nearest body (N); Saturn's ring rocks in the same oblate shadow as the ring sheet. All 15 November. | [SOLAR-SYSTEM.md](SOLAR-SYSTEM.md) |

### Status, 14 November 2026 (end of day)

| Step | State | Evidence |
| --- | --- | --- |
| 1. Physics that never waits | Done for terrain. Held frames 944 / 133 / 41 -> 0 on lunar descent, procedural arrival and Earth flight; coverage waits 0; motion continuous (distance / speed x simulated time 0.98-1.00 median). Objects (trees, rocks, buildings) still come from the GPU snapshot without holds: gaps are counted, a fast craft can pass through an object whose collider has not arrived. CPU object placement not written. Physics still shares the render worker's thread (0.25 s catch-up cap, reported). | [PHYSICS-NO-HOLDS.md](PHYSICS-NO-HOLDS.md) |
| 2. Arrival streaming | Measured, nothing changed. The worst arrival frames are GPU-bound (water, raster, scheduling), the same as cruise; no compile or upload spike found in these runs. Trajectory prefetch not implemented (priority already looks 1 s ahead). | this section |
| 3. Frame cost | Partly done (15 November). Car removed; terrain scheduler, horizon sweep and cloud-shadow bake parallelised or trimmed, each pixel-identical. Earth hover settles at about 47 ms p50 at 1080p High once the water layer arrives (about 21 ms of it water); the cloud dive spends 30-33 ms in view clouds. Procedural worlds and Mars meet the owner's target. Mobile tiers not done. | [FRAME-COST-SUN-DRIFT.md](FRAME-COST-SUN-DRIFT.md), [FRAME-COST-PASS-2.md](FRAME-COST-PASS-2.md) |
| 4. Startup | Measured: the opaque loop bounds that cut cold compile by ~25 s cost frame time in every pair, so constant bounds are the default again (`SOLAR_OPAQUE_LOOPS=1` opts in). Cold compile is therefore back near 75 s wall. | [STARTUP.md](STARTUP.md) |
| 5. Rebrand and audit | Done: names, MIT `LICENSE`, `THIRD-PARTY-NOTICES.md`, car renamed Halley with credit, machine paths scrubbed. The published tree leaves out `evidence/`, hand-off and agent-context files. Data packs are not in the repository; hosting them is still to be decided (GitHub release assets or a CDN, with `web/pack` pointing at them). | `README.md`, `THIRD-PARTY-NOTICES.md` |

14 November 2026, evening: owner decision — the car is removed; the viewer uses the free-flying camera.

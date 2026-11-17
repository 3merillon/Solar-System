# Game optimization — detailed evidence

This is a local Rust/WASM/WebGPU optimization of the game at `69dcc13`, not a quality-preset change. The existing server on port 5198 was reused for measurements and final validation; all browsers were new private headless instances. An initial invocation of the legacy input test started its built-in fixture server before failing on obsolete UI selectors; the repaired test uses 5198 directly and always closes its private browser. Nothing was pushed or deployed.

## Retained changes and their validity

The baseline's largest named interval in flight/cockpit was water plus exhaust (13.08 / 14.23 ms). Terrain rasterization cost 4.25–4.75 ms in forest/flight, while clouds, local light profiles and scheduling each cost roughly 2–3 ms. Opaque vehicle draws sit between named stage intervals, so their contribution was investigated with a depth-only build and whole-frame measurements. On the CPU/streaming side, unchanged urban publications caused ten unnecessary collision holds per ten refreshes, alongside the approximately 8.2 MB urban-index upload; vehicle hierarchy traversal and allocation were recurring worker work. These identified exact work-elimination opportunities ahead of riskier changes to terrain, lighting or collision algorithms.

1. **Opaque vehicle depth.** The imported rigid triangles already project to reversed depth `0.1 / forward`. They do not perform the terrain shader's fragment displacement. Removing their redundant fragment-depth output permits early rejection before material and sunlight evaluation. Alpha tests, geometry, materials, glass ordering and all shadow draws remain. Paired exterior/cockpit camera motion qualifies the depth-equivalence assumption, including open doors and deployed mechanisms.
2. **Empty exhaust samples.** The 64-step fluid ray march skips noise and lighting work when the sampled density is exactly zero, and skips lighting when computed opacity is exactly zero. These samples contribute exactly zero to colour, opacity and distance. No threshold, sample count, pressure iteration, fluid-grid size or artistic density changes. The water timing interval also contains exhaust: it is not an isolated water speedup.
3. **Vehicle CPU work.** Reuse the pose hierarchy and matrix staging allocation. Reset every animated transform from its rest pose each frame, then run all channels, physics collider updates and world transforms. Build immutable opaque/glass draw membership once per loaded LOD, in original draw order; glass still sorts by current distance. Construct each animation clip name once per group member instead of inside every channel predicate. LOD replacement replaces these buffers/lists; they cache no camera, body, origin, light, physics or animation result.
4. **Urban source publications.** The field worker remembers the selected tile addresses and fetch generations, not another copy of the map. Reordering the same complete, admitted tile set avoids normalization and transfer. Membership changes, empty/out-of-range selection, eviction and refetch invalidate it. Capacity-limited selections continue to follow priority and publish their overflow. Each field worker/body owns its own state. Rust independently compares bounded, validated raw source bytes before adding arrival stamps. Exact repeats skip the urban index rebuild/upload and collision-source invalidation. Changed inputs retain validation, arrival identity and coverage guards; body reset clears the cache. No global terrain revision change was added.

## Measurement contract

The controlled browser runs use 1920×1080, desktop **High**, render scale 1, unchanged shadows, vegetation density/reach, water and clouds. `?test=1` alone selects Ultra, so the measurement URLs explicitly request High. Regression suites retain their original settings. CPU and GPU times are reported separately. Native GPU execution validates shaders; it is not browser performance evidence.

The serial harness uses one in-flight frame to associate work and completion. Its wall intervals include JavaScript polling/timer overhead and are not display FPS. A separate requestAnimationFrame run uses the existing default queue of two; the product queue and input scheduling were not increased. Cold/cut samples are retained separately from warmed samples. Capture/readback frames are outside the timed window. Live-map observations are not causal A/B claims because network content and arrival timing vary.

The machine is an i7-12700F (12 cores / 20 threads), 64 GB RAM, and RTX 3080 (10 GB), NVIDIA 621.14. Every compared run uses headless Edge 157.0.4341.42, V8 15.7.11.4. Other GPU work was present and was left alone. Repeated, serial comparisons and reversed arm order reduce but cannot remove that shared-machine uncertainty. Raw settings, browser version, source state, telemetry, memory and manifests are retained in `evidence/local/optimization-2026-11-10/`; a compact reviewable summary is committed separately.

### Corrected telemetry

The existing stage named `scenery_atlas_clear` actually brackets ground-cover placement/admission/emission. It is now named `ground_cover`; no atlas-clear optimization is claimed. The former whole-frame interval began at surface scheduling and omitted earlier Solar System work. Two timestamps now bracket the complete encoded frame through presentation; space-only frames no longer present stale surface stage values. The existing four 512-byte readback slots suffice. The diagnostic HUD uses the whole-frame span and includes road omissions in its urban omission count. Controlled procedural/urban comparisons execute no solar prefix and remain comparable. Old solar totals are unsuitable for whole-game before/after claims.

The first baseline run completed all seven timed cases but failed while collecting the final long-task list because the test had not enabled Page instrumentation. Those case samples remain valid; the repeated run fixes that harness error. An initial startup experiment used a paused test URL and delayed the car upload queue; its car/ready times are excluded. Corrected cold/warm startup runs use the playing page. An initial paired-image invocation used a directory URL unsupported by the existing server; the successful run uses explicit `index.html` and is stored as `visuals-fixed`.

## Controlled browser results

Each vehicle scene has 240 warm-up and 300 measured frames per run. The first and repeated baseline are compared with the first combined candidate and final instrumented candidate; the depth-only arm separates the first shader change. These are whole-frame GPU intervals, not the sum of selected passes.

| Vehicle scene | Baseline p50, runs 0 / 1 | Candidate p50, runs 0 / 1 | Final run baseline → candidate p95 | Final run baseline → candidate p99 |
|---|---:|---:|---:|---:|
| Forest, parked | 32.54 / 33.01 | 31.26 / 31.58 | 34.41 → 33.34 | 35.11 → 33.97 |
| Low flight | 43.04 / 43.35 | 39.44 / 39.30 | 45.86 → 40.90 | 46.27 → 41.30 |
| Airborne cockpit | 40.58 / 41.45 | 34.37 / 34.62 | 43.26 → 36.18 | 44.29 → 36.94 |

The median reductions repeat at **4%, 8–9%, and 15–16%** respectively. In the repeated run, serial completion pacing changes from 42.9 / 53.4 / 51.4 ms to 40.4 / 48.4 / 43.7 ms. Vehicle-worker CPU medians fall from 1.8–1.9 to 1.2–1.3 ms, and pose work from 0.5 to 0.2 ms. All settings, final patch counts and final tree counts match in the paired seven-scene repeat. The memory ledger shows identical controlled GPU allocation.

The depth-only arm repeats at 31.40 / 31.59 ms forest, 42.55 / 42.56 ms low flight and 36.95 / 37.15 ms cockpit. Adding the exhaust/CPU work brings low flight to 39.44 / 39.30 ms and cockpit to 34.37 / 34.62 ms. In the repeated low-flight run the interval containing water plus exhaust falls from 13.06 to 8.77 ms; the whole-frame gain is 3.26 ms, not the larger isolated interval difference.

The repeat's cold/camera-cut maximum serial intervals are 48.2 → 46.7 ms in the forest, 65.9 → 59.3 in low flight and 57.0 → 51.6 in the cockpit. The remaining controls stay around 44–58 ms at their worst cold interval. Page long-task logs also include the harness's expensive full-resolution capture/encoding work outside the measured windows; those diagnostic tasks are not treated as gameplay stalls.

A separate 180-frame rAF observation, candidate first then baseline, retains the default two-frame queue. Accepted-frame intervals (p50 / p95 / p99) are forest 33.3 / 49.8 / 52.6 → 32.9 / 38.4 / 50.8 ms, low flight 45.3 / 51.5 / 53.5 → 37.0 / 51.3 / 52.9, and cockpit 42.3 / 50.1 / 52.2 → 34.5 / 45.6 / 47.2. This single cadence pair supports the repeated GPU measurements but does not establish a general tail-latency improvement: low-flight intervals above 50 ms increase from 14 to 23 of 179. Headless rAF admissions are not physical-display presentation or input-to-photon measurements.

The terrain-viewer controls show no benefit worth claiming: fast-stop GPU p50 25.75 → 25.80 ms, coast 23.27 → 23.19, clouds 25.87 → 26.03, and procedural orbit 22.70 → 22.86. Cloud/orbit serial pacing is slightly worse in that run (32.2 → 33.4 and 28.4 → 29.7 ms), while GPU differences are below 1%. These workloads do not run the optimized vehicle and remain within the observed shared-machine variation; they are retained as neutral controls, not presented as wins. The fast-stop/turn p95 remains about 41.2 ms GPU.

**Stable 60 fps at 1080p is not achieved in these controlled scenarios.** Every warmed measured GPU frame exceeds 16.67 ms, including the final candidate. Reducing queue depth or changing quality to force a headline was not used. Complete per-run p50/p95/p99 tables, cold/cut distributions, long-stall counts and stage/memory evidence are in the measurement artifact (`evidence/optimization-2026-11-10/measurements.md`, development repository only) and summary JSON (`evidence/optimization-2026-11-10/summary.json`, development repository only).

## Dense urban source fixture

The final fixture has 384 buildings, 84 road segments and 1,704 source points on controlled measured terrain with full scenery and real vehicle physics. Each case has 120 warm-up and 300 measured frames. Round 2 runs baseline then candidate; round 3 reverses that order. The earlier `urban-before` / `urban-after-0` / `urban-after-1` cases contained buildings but no admitted roads because the fixture used an unsupported road class. They are retained as building-only diagnostics and are **not** paired with the corrected `urban-before-1` case. The following table uses only the matched `urban-roads-*-2/3` runs.

| Urban case | Baseline GPU p50, rounds 2 / 3 | Candidate GPU p50, rounds 2 / 3 | Round 3 baseline → candidate GPU p95 / p99 |
|---|---:|---:|---:|
| Steady | 26.17 / 25.54 | 23.65 / 23.68 | 27.63 / 30.16 → 26.03 / 27.50 |
| Same sources every 30 frames | 25.35 / 26.00 | 23.72 / 23.60 | 27.77 / 30.80 → 26.13 / 28.73 |
| Driving between buildings | 31.89 / 31.96 | 29.81 / 29.93 | 35.58 / 37.40 → 33.68 / 35.19 |

Driving improves about **6.4–6.5%** at the median. In both rounds ten unchanged refreshes cause ten baseline physics holds and **zero** candidate holds. Median refresh RPC completion falls from 1.8–1.9 to 0.6 ms. The lower GPU cost is the combined vehicle optimization; the source optimization's distinct benefit is avoiding the unnecessary rebuild, transfer and invalidation. The independent vector fixture reproduces 20 unchanged publications in the old implementation and suppresses all 20 in the candidate, while testing source membership, out-of-range clearing, eviction/refetch and both admission caps.

Round 3 serial driving p50 is 47.3 → 45.1 ms, p95 56.5 → 54.9, but p99 60.3 → 60.7: collision/streaming spikes remain. Controlled GPU memory stays 2,521,879,664 bytes. The actual raw-source cache is 79,680 bytes. WASM reserved high-water marks vary by run (baseline 190.2–198.5 MB, candidate 187.6–190.7 MB) and remain flat across each run's three measured cases; those variable allocator peaks are not claimed as a memory reduction.

!Candidate driving in the controlled urban grid (`evidence/optimization-2026-11-10/images/urban-driving.png`, development repository only)

## Startup and worker diagnostics

Fresh browser profiles are cold browser starts, not a reset of the shared operating-system/driver caches. The second navigation in the same profile is the warm observation. These numbers do **not** support a startup gain:

| Startup milestone | Baseline cold / warm | Candidate cold / warm |
|---|---:|---:|
| First image | 11.87 / 11.84 s | 11.87 / 12.07 s |
| First car LOD observed | 24.72 / 25.76 s | 24.29 / 25.08 s |
| All shaders ready | 50.13 / 50.25 s | 49.92 / 49.98 s |

The eight existing compiler lanes and 106-program registry remain. Water is the longest compiler job, roughly 48–49 s while concurrent jobs run; initial shading is about 7.6–8.1 s. These asynchronous durations overlap and must not be summed. Startup styling and procedural audio are qualified by the existing flight-deck suite.

`Profile-Game.mjs` recursively attaches the page, renderer, field worker, four field decoders and vehicle decoder. The `workers-before` / `workers-after` runs record 360 accepted frames with rAF pacing, 1 ms CPU sampling, 64 KiB sampled surviving JS allocations, heap/backing-store snapshots, JSON work, message-size estimates, GPU writes and asynchronous maps. They include diagnostic overhead and live-network variability and are excluded from causal frame-time claims. The earlier `profile-*` runs captured only the page and are not worker evidence. Captures occur after profiling. Message-byte estimates traverse bounded object depth/key counts; they are not wire bytes, and transferred buffers are counted at each message boundary.

Over roughly 31–33 seconds, the renderer writes about 47.4 MB of buffers and 182–184 MB of textures and requests 992.7 MB across 564 asynchronous buffer maps in each arm. Summed map-wait time overlaps across requests; it is not CPU blocking time. Main-thread JSON parse plus stringify totals about 0.22 s, with roughly 25 MB of strings in each direction; the diagnostic still calls the stats API more than ordinary UI refresh. Baseline worker sampling places immutable vehicle shadow traversal among its top costs; after the change the prominent work is terrain streaming, terrain-mesh normal construction and collision queries. Field decoders spend time in river widths, water containment and water-page construction, with roughly 74–93 MB used JS heap per decoder in the baseline observation. The vehicle decoder is idle once loaded.

The live route's vector report contains 7,590 buildings and 2,048 admitted roads, with **14,930 road segments omitted** by the existing cap. The complete-source shortcut correctly remains disabled there (`unchanged: 0`); the overflow is not hidden. Streaming/cache limits, missing pages, terrain deferrals and physics coverage waits are retained in the compact state snapshots. These observations do not establish a memory leak or a memory reduction: JS collection timing and source arrivals differ.

## Bounds and memory

GPU content allocations, draw budgets, collision geometry, readback cadence and queue depth are unchanged. The new urban raw-source cache has at most 16,384 × 112 + 131,072 × 16 = **3,932,160 bytes (3.75 MiB)**, exposed as `urban_source_cache_bytes`. Raw-source allocations use the exact input lengths rather than geometric growth. Clearing a body empties validity while permitting bounded allocation retention. The field identity contains at most nine selected tile IDs/generations and no additional tile data. Existing map cache/backpressure limits remain 16 tiles / 32 MiB.

Vehicle reuse retains one pose-node copy and a 32-float-per-node matrix staging vector (75,904 bytes for 593 nodes), plus bounded draw-index lists. The hierarchy already existed transiently each frame; reuse trades retained CPU storage for less allocation/churn. Asset reload replaces it. Existing GPU and WASM ledgers, heap observations and diagnostic allocation samples are recorded alongside the measurements; reserved WASM pages are not equivalent to live object bytes.

In the paired procedural repeat, controlled GPU memory is unchanged at 1,410,086,036 bytes; WASM reserved memory increases from 90,767,360 to 91,029,504 bytes (**256 KiB**). This is an observed whole-module allocation delta, not a claim that all retained CPU storage is exactly that size. Driver/browser allocations and temporary resize overlap are outside the controlled GPU ledger.

## Visual and functional qualification

The paired 960×540 High sequence contains 12 exterior and six cockpit views with fixed vehicle pose/time, open doors and mechanism overrides. Across all 18 images, only three display pixels differ (maximum differences 29, 23 and 4 codes in their respective frames); the 99th-percentile display difference is zero. Vehicle silhouette coverage changes are zero, and the largest shared-pixel position difference is 0.0000288 m. Representative triptychs show baseline, candidate and an 8× amplified difference. This is a rigid-pose camera-motion comparison; real movement, collision, smoke and water use the integration suites rather than being inferred from these images.

!Exterior: baseline, candidate, amplified difference (`evidence/optimization-2026-11-10/images/exterior-compare.png`, development repository only)

!Cockpit: baseline, candidate, amplified difference (`evidence/optimization-2026-11-10/images/cockpit-compare.png`, development repository only)

The initial 24-case serial qualification recorded 19 successes and five failures; the raw report remains unchanged. Follow-up runs distinguish test-fixture defects from surviving collision-streaming limits rather than replacing the failed evidence with an all-green claim.

| Qualification | Result and evidence |
|---|---|
| `tools/Check.ps1` | Passed: 173 tests, formatting, Clippy with warnings denied, WASM checks and CPU Naga validation. Includes camera obstruction and physics coverage tests. |
| Native GPU | The GPU probe and native explorer completed. Native explorer compiled the production pipelines; its car asset was not loaded, so browser tests supply actual vehicle evidence. Native timings are not browser-performance claims. |
| Terrain and urban arrival | Stable terrain refinement/morph history during stationary and moving source add/remove; road joins, terrain following, arrival fades and reordered refreshes passed. Delayed-footprint cover overlap fell from 1,015 to zero and prop overlap from three to zero. |
| Source invalidation | Urban, vector decoding, field streaming and water logic passed. New repeated-publication tests cover membership changes, empty selections, eviction/refetch, building pressure and independent road-cap pressure. |
| Vehicle and collisions | The revised vehicle suite passed drive/flight, landing, all three LODs, mechanisms, rebasing, pause, spawn recovery, and tree/rock contact. The old obstacle search depended on the preceding flight/impact footprint; each object test now resets to its known forest fixture and still requires contact. The original unmodified suite passed on the baseline build. |
| Buildings and water | Roof support changed from 8.007 to 6.007 m after a source edit; the high-speed wall test stopped at 11.862 m, before the 14 m wall. Impact waves, sinking, swimming, dive/exit and underwater cockpit passed. Lake above/crossing/below and seven water-interface cases plus rebase passed, with finite outputs. |
| Exhaust | The old unpowered-coast fixture failed its 2% visibility gate on both builds. Sustained thrust preserves the same strict checks: 523 clear-sky and 543 over-cloud pixels, no composition failures, maximum one display-code error, finite buffers and valid near-smoke depth. Production-lighting images were inspected. |
| Flight deck and audio | Initialization styling, three tabs, six systems, five procedural-system jumps plus Earth return, four surface-family approaches, cancellation and mobile layout passed. Offline music output was finite, RMS 0.0190 and peak 0.1724. |
| Flight-deck input | All 68 real protocol-input checks passed after replacing obsolete selectors with visible tabs, destination, volume and orbit controls. Focus, shortcuts, context menus, wheel/drag, fullscreen and back/forward behavior remain checked. |
| Full-quality travel | All eight final travel cases completed, including underwater lake arrival, Moon, Saturn and procedural hyperdrive/surface approach. The space-only HUD showed complete GPU timing. |

The fast lunar descent makes terrain contact without an approach hold in both builds, then records **two** coverage holds during the 30-frame rebound/lateral follow-through in both. The original zero-hold assertion therefore still fails; it was not weakened. Collision guards, momentum and incomplete-work reporting remain intact. The initial optimized orbit run had one hold at first contact; two optimized repeats had zero. Two original-build runs had zero and one, reproducing the same failing impact position and velocity. The unchanged zero-hold assertion therefore remains intermittent on both builds. Extending those repeats for 30 rebound frames reported cumulative waits of 13 on the baseline and 14 / 16 on the candidate, with unresolved geometry still reported (maxima 12 versus 175 / 132; overflow 7 versus zero in these particular paths). These variable trajectories are not a collision-streaming speedup claim. Both optimized extensions resumed by their final sample; the baseline extension was holding at its final sample. The guards were retained, and high-speed rebound coverage remains a limitation.

## Experiments not retained or not claimed

The earlier guided 64-step cloud-filter and scalar-noise experiments documented in `INTEGRATED-PERFORMANCE.md` were reviewed, not repeated without new evidence. No resolution, density, shadow, cloud or collision quality reduction was tried. The depth-only build is retained as local experimental evidence to separate its effect from exhaust/CPU changes. No startup speedup, exact frame-latency reduction or isolated pass improvement is promoted to a whole-game claim without matching evidence.

## Remaining limits

Terrain selection, rasterization, cloud/light construction, scenery and moving collision-mesh preparation remain substantial. The existing collision snapshot copies 5,513,264 bytes per readback even when its active terrain grid is smaller; narrowing that payload is a possible next experiment, but was not changed without a separate coverage/invalidation qualification. Fast movement can still exhaust finite terrain/source budgets, and unknown support still holds the craft. Preserving that explicit safety behavior takes precedence over concealing a wait. Startup remains dominated by browser shader compilation and deferred feature/asset readiness.

The complete `travel-fixed` route uses High at 1920×1080, 60 settling frames and 300 measured frames at each stop. These are final-build observations, not controlled speedup comparisons:

| Live/travel scene | GPU p50 / p95 / p99 | Serial pacing p50 / p95 / p99 |
|---|---:|---:|
| Live Earth driving | 84.77 / 90.43 / 92.60 | 101.3 / 109.3 / 111.3 |
| Ascent | 88.25 / 103.58 / 106.53 | 104.1 / 123.7 / 129.4 |
| Descent | 81.29 / 85.33 / 87.02 | 95.9 / 108.8 / 118.3 |
| Lake arrival and sinking | 79.24 / 90.48 / 94.26 | 94.1 / 121.4 / 129.0 |
| Lunar approach | 46.77 / 61.76 / 63.55 | 82.2 / 133.9 / 147.7 |
| Saturn, space only | 2.75 / 10.75 / 10.96 | 17.3 / 24.7 / 27.3 |
| Procedural hyperdrive arrival | 39.32 / 42.16 / 45.78 | 49.2 / 53.8 / 55.4 |
| Procedural surface approach | 58.41 / 66.55 / 67.50 | 67.1 / 77.2 / 79.1 |

Only the space-only Saturn observation stays below 16.67 ms GPU for all 300 samples. That establishes GPU headroom, not stable physical-display presentation: the serial harness includes polling overhead and no display/input-latency instrument. Every surface scene misses the target. The live route retains missing-page reports (two at the Earth stops), bounded-pool pressure and coverage waits; cumulative coverage waits increase from 280 after driving to 345 after lake arrival. They are not concealed by the performance summary. The restored normal animation loop also verifies a numeric whole-frame GPU HUD in space, with no stale surface timing rows or runtime error.

The first valid live driving observation was 84.33 / 90.96 / 93.30 ms GPU, with median water/effects 16.08 ms, shading 12.06, local sun-cloud profiles 10.93, scenery shading 7.32 and global sun-cloud profiles 5.38. The sun direction participates in the profile cache keys; a moving solar light invalidates these results, whereas the fixed-light procedural control can reuse them. Reusing a different sun's lighting was not accepted as an optimization. The original travel harness lost its Solar System journey when it respawned at the lake; the repaired harness explicitly restores that journey before continuing. The incomplete earlier run is retained and is not presented as successful travel qualification.

## Rebuilt artifacts and reproduction

`web/pkg` and the local `dist/` package were rebuilt and shader provenance was checked from the programs embedded in WASM. The rebuild is byte-identical to the measured candidate:

- WASM: 14,206,658 bytes, SHA-256 `6f9eebc48bf404ea3d13d913aa555c108a84e1ca1d6b52fbcc0cef450b4d6b42`.
- Shader source key: `3440f0cbd10095a7d4e0e8368204d0d999557409b5a6330ccc7a44e543a919e0`.
- 106 embedded programs, registry SHA-256 `95e7c526489ef1fc176debc058cafb32b8547969803211e177c5282919049f99`.
- Baseline WASM: `5602f8ddd5195033894fd537128d40fe3a7a4456bb55a130ab5ec1ba0cf39cab`.

The package manifest records runtime commit `1b544dc`; subsequent commits contain qualification tools and this evidence. The package browser test passed through `http://127.0.0.1:5198/__optimization_package/index.html`, checking asset/MIME responses, WASM validity, WebGPU rendering, shipped settings, scenery and nonblank captures. The ordinary game remains at `http://127.0.0.1:5198/`. Packaging retains its existing allowlist and existing omission of the optional local Solar System pack; local development still has that pack. Nothing was pushed or deployed.

Local implementation checkpoints are `a7edf64` (core optimization and telemetry), `4586d2d` (measurement probes), `1b544dc` (HUD and vehicle/travel fixtures) and `e167b6b` (qualification and input/exhaust fixtures). The final evidence commit follows these. Baseline/depth/final snapshots and raw reports remain under `evidence/local/optimization-2026-11-10`; the source-summary artifact includes raw-report SHA-256 digests. Do not overwrite those historical directories when repeating measurements.

With the retained baseline snapshot served by the existing 5198 process, examples from the repository root are:

```powershell
node tools/Measure-Game.mjs --base http://127.0.0.1:5198/__optimization_baseline/ --manifest evidence/local/optimization-2026-11-10/baseline-web/pkg/explorer-manifest.json --output evidence/local/recheck-before
node tools/Measure-Game.mjs --output evidence/local/recheck-after
node tools/Measure-Urban.mjs --base http://127.0.0.1:5198/__optimization_baseline/ --output evidence/local/recheck-urban-before
node tools/Measure-Urban.mjs --output evidence/local/recheck-urban-after
node tools/Test-Vector-Refresh.mjs
node tools/Verify-Explorer-Build.mjs dist/pkg/solar_explorer_bg.wasm
```

Reverse the A/B order for a repeat, keep GPU workloads serial and retain source/settings state. `Run-Game-Qualification.mjs` records individual exit codes and intentionally does not suppress the strict collision-stress failures described above. `Summarize-Game-Optimization.mjs` regenerates the compact tables and evidence from the retained raw runs.

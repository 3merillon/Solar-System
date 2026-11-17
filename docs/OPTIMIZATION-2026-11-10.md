# Game optimization — 10 November 2026

Implemented and rebuilt locally from `69dcc13`, preserving Rust/WASM/WebGPU, current defaults, content density and collision guards. Repeated whole-frame GPU measurements improve the vehicle scenarios by **4–16%**, and unchanged urban refreshes stop forcing collision holds. **Stable 60 fps at 1080p remains unmet in surface scenes; startup is essentially unchanged.** Nothing was pushed or deployed.

## Comparable results

Hardware: i7-12700F, 64 GB RAM, RTX 3080 10 GB, NVIDIA 621.14. Browser: private headless Edge 157.0.4341.42. Controlled runs use **1920×1080 High**, render scale 1, unchanged quality/features and two serial A/B rounds. Other GPU work on the shared machine was left alone. Values below are whole-frame GPU milliseconds; the p95/p99 columns use the final matched repeat.

| Scene | Baseline p50, two runs | Optimized p50, two runs | p95 before → after | p99 before → after |
|---|---:|---:|---:|---:|
| Forest, parked | 32.54 / 33.01 | 31.26 / 31.58 | 34.41 → 33.34 | 35.11 → 33.97 |
| Low flight | 43.04 / 43.35 | 39.44 / 39.30 | 45.86 → 40.90 | 46.27 → 41.30 |
| Airborne cockpit | 40.58 / 41.45 | 34.37 / 34.62 | 43.26 → 36.18 | 44.29 → 36.94 |
| Urban driving | 31.89 / 31.96 | 29.81 / 29.93 | 35.58 → 33.68 | 37.40 → 35.19 |

The urban fixture contains 384 buildings, 84 road segments and 1,704 points. Run order reverses for its repeat. In both rounds, ten unchanged source refreshes cause **ten baseline physics holds and zero optimized holds**; median refresh completion falls from 1.8–1.9 to 0.6 ms. Vehicle-worker CPU medians fall from 1.8–1.9 to 1.2–1.3 ms, with pose work falling from 0.5 to 0.2 ms.

Serial completion pacing improves in the vehicle scenes, but tails are mixed: urban-driving p99 is 60.3 → 60.7 ms. A separate rAF pair retains the default two-frame queue and supports the median gains, but low-flight intervals above 50 ms increase from 14 to 23 of 179. No general input-latency or display-presentation claim is made. The serial harness uses one in-flight frame for attribution; product queue depth remains unchanged.

Terrain-only fast-stop, coast, cloud and procedural-orbit controls remain essentially neutral, at 22.9–26.0 ms optimized median GPU. Every warmed frame in these controlled surface scenarios exceeds the 16.67 ms budget. Cold/cut distributions, raw settings and full p50/p95/p99 tables are in the measurement artifact (`evidence/optimization-2026-11-10/measurements.md`, development repository only).

## Changes retained

- **Rigid vehicle depth:** remove redundant fragment-depth output to permit early rejection, retaining geometry, material/alpha tests, glass sorting and shadows. A depth-only ablation and paired camera sequence establish the benefit and visual equivalence.
- **Exhaust:** skip noise/lighting only for exactly zero density or opacity. All 64 samples, fluid resolution, pressure iterations and artistic density remain. The largest flight interval includes water and exhaust; its isolated improvement is not substituted for whole-frame measurements.
- **Vehicle CPU:** reuse pose-node and matrix storage and immutable draw membership. Every frame still resets animated transforms and updates channels, colliders and world matrices; each LOD replaces the retained structures.
- **Urban sources:** suppress repeated complete tile sets by address/fetch generation, then independently compare validated raw bytes in Rust. Changed membership, eviction/refetch, empty selections and body changes invalidate reuse. Capacity-limited sets still republish by priority. Changed sources still invalidate collision coverage without resetting terrain refinement.

GPU timing now includes the Solar System prefix through presentation and omits stale surface-stage values in space. The mislabeled ground-cover stage and diagnostic urban omission count are corrected. Profiling remains opt-in.

## Startup, memory and live travel

Cold/warm first-image times are 11.87/11.84 s before and 11.87/12.07 s after. First car appearance remains about 24–26 s; all shaders finish around 50 s. **No startup gain is claimed.** Browser profiles show terrain/collision construction, field water decoding, uploads/readbacks and lighting as substantial remaining work.

Controlled GPU allocation is unchanged: 1.410 GB in the procedural fixture and 2.522 GB in urban driving. Procedural WASM reserved memory rises **256 KiB**. The raw urban cache is bounded to **3.75 MiB**, using 79,680 bytes in the controlled fixture. Pose reuse retains bounded per-asset storage, including a 75,904-byte matrix staging vector for the hero. Variable JS/WASM allocator peaks are not presented as memory savings.

Final-build live-map/travel observations, all High at 1080p with 300 measured frames per stop:

| Scene | GPU p50 / p95 / p99, ms |
|---|---:|
| Live Earth driving | 84.77 / 90.43 / 92.60 |
| Ascent / descent | 88.25 / 103.58 / 106.53 · 81.29 / 85.33 / 87.02 |
| Lake arrival and sinking | 79.24 / 90.48 / 94.26 |
| Lunar approach | 46.77 / 61.76 / 63.55 |
| Saturn, space only | 2.75 / 10.75 / 10.96 |
| Procedural hyperdrive / surface approach | 39.32 / 42.16 / 45.78 · 58.41 / 66.55 / 67.50 |

Only Saturn stays within the GPU budget for every sample; this is GPU headroom, not verified 60 fps display presentation. Live surface scenes remain far above budget. Moving solar lighting repeatedly invalidates light profiles. Live vector pressure reaches 2,048 admitted roads with 14,930 omissions; deduplication correctly stays disabled there. Missing pages, pool pressure, unresolved geometry and coverage waits remain visible. These live observations are not controlled A/B speedup claims.

## Validation and remaining failures

`tools/Check.ps1` passed **173 tests**, formatting, Clippy, WASM checks and CPU shader validation. Native GPU probe and explorer validation passed; native results are kept separate from browser evidence. Browser checks passed terrain/morph stability, road arrival/joins/fades, footprint exclusion, edited roof and high-speed wall collision, water impact/sinking/swimming, lake interfaces/rebase, vehicle LODs/mechanisms, cockpit visibility, travel, initialization, procedural systems and music. All **68** current flight-deck input checks passed.

The 18-frame exterior/cockpit camera sequence changes only three display pixels, with zero silhouette-coverage changes and at most 0.0000288 m shared-position difference. [Detailed evidence](OPTIMIZATION-2026-11-10-DETAILS.md) includes representative comparison images and test details. Powered exhaust matches an independent alpha-over reference within one display code across 523 clear-sky and 543 over-cloud pixels.

The original qualification had five failures; none were erased. Vehicle obstacle setup, decayed-smoke setup and obsolete input selectors were repaired without weakening assertions, then passed. The strict collision stress tests still expose existing limits:

- Fast lunar impact has zero approach holds, then **two rebound holds on both original and optimized builds**.
- Orbit arrival records one hold in one of two original runs and one of three optimized runs. The same failing impact state reproduces on the original build. Two optimized repeats pass the unchanged zero-hold assertion.
- Extended orbit rebounds still encounter incomplete geometry and coverage holds: cumulative waits of 13 on the baseline and 14/16 on optimized repeats. Overflow/unresolved reports are retained. No collision guard was bypassed.

Earlier rejected cloud approximations were reviewed, not reintroduced. No resolution, density, shadow, cloud or collision-quality reduction was used. Startup, readback payload size, solar lighting and high-speed rebound coverage remain opportunities for further measured work.

## Local delivery

The game is rebuilt at [localhost:5198](http://127.0.0.1:5198/), with an updated `dist/` static package. Its private browser smoke test passed via the same server, including asset/MIME checks, settings, hero loading, scenery and nonblank rendering. The existing optional local Solar System pack remains excluded from the static package by its unchanged packaging policy.

The rebuilt WASM is byte-identical to the measured candidate: **14,206,658 bytes**, SHA-256 `6f9eebc48bf404ea3d13d913aa555c108a84e1ca1d6b52fbcc0cef450b4d6b42`. All **106 embedded shader programs** match current source provenance. The package manifest records runtime commit `1b544dc`; later commits add qualification tools and evidence.

Local checkpoints: `a7edf64` (optimization), `4586d2d` (measurement probes), `1b544dc` (diagnostics/travel), and `e167b6b` (qualification), followed by the evidence commit. [Detailed methods and reproduction commands](OPTIMIZATION-2026-11-10-DETAILS.md) and hashed compact evidence (`evidence/optimization-2026-11-10/summary.json`, development repository only) accompany this report. Raw runs and baseline snapshots remain under `evidence/local/optimization-2026-11-10/`.

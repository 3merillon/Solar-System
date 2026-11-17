# Falsification plan

Proposed targets below are not achieved claims. Start geometry-only and add optical transport only after visibility is understood. Pick a production representation by evidence, not by a more impressive screenshot.

| Gate | Experiment | Reject / revise when |
| --- | --- | --- |
| 0 — residual primitive | Analytic bounded bands, exact address phases, roughness sweep | Bounds fail or become unusably loose; note height/normal distinction |
| 1 — first intersection | Interval-isolated nearest roots against f64 analytic references; tangent rays and thin shelves | Missed roots, false hits, unresolved rays silently treated as background |
| 2 — adversarial topology | Cave mouths, tunnels, arches, stacked thin sheets, disconnected rocks, porous solids | Bounds only work on smooth single-valued terrain or query count explodes |
| 3 — real scale precision | Earth radius through millimetres; sector crossing; origin rebasing; repeat visits | Seed, location, intersection or normal changes with camera origin |
| 4 — cold travel | Empty-cache cuts orbit-to-ground, ground-to-orbit, antipodal and interplanetary cuts | Unbounded work/memory or correctness depends on a warm cache/history |
| 5 — silhouette and filtering | Long horizons, sharp ridges, grazing caves; supersampled reference; continuous zoom | Holes, missed occlusion, visible discontinuity above tolerance; unresolved-detail statistics change the realization |
| 6 — GPU/backend contest | Same field through bounded marching and procedural micromesh baseline | The novel backend consistently loses its hard cases without an identifiable improvement path |
| 7 — material library | Thousands of global IDs; varied simultaneous visible material counts | Dispatch count or hot memory scales with the whole registry; fine material boundaries alias |
| 8 — geology | Deterministic drainage across boundaries and basin-level erosion state | Repeated visits change geology, streams disconnect, or local patterns are misrepresented as simulation |
| 9 — shared optical fields | Tunnel + water + cloud + atmosphere; compare shared and separate traversal | Interface order or transport differs; joint bounds cost more than they save |

## Measurement protocol

- Record commit, compiler, browser, OS, adapter, backend, resolution, tolerance, seed and camera path.
- Measure total frame time plus per-pass timestamps when supported; distinguish GPU timestamps from CPU submission/readback.
- Separate field evaluations, bound evaluations, compilation/startup, allocations, upload/readback and transport rays.
- Report distributions (p50/p95/p99 and worst), overflow, unresolved work and memory high-water marks.
- Compare at identical geometry/image error, not merely identical pixel resolution or nominal LOD.
- Reset caches and temporal history for cold cases. Report first-frame error and time-to-requested-quality separately.
- Compare actual browser WebGPU runs with native runs; native RTX measurements cannot stand in for a browser or integrated GPU.

Initial exploration target: 1080p, 0.5 px geometric coverage tolerance, a fixed explicit resident-memory cap and a declared per-frame query budget. The correct cap and time target must be chosen after the first GPU visibility prototype; no hardware-independent 60 fps claim is made.

## Current checkpoint and next experiments

The original five implementation experiments above have run: GPU interval queries, local/directional bounds, anchored precision, a finite CPU micromesh baseline and sparse convolution. The experimental browser engine is now operational. See [the decision history](DECISION.md), [engine contract](ENGINE.md) and evidence (`evidence/ENGINE.md`, development repository only).

Remaining gates are substantial: complete 1080p visibility at interactive speed, a matched-quality GPU raster/cache competitor, supersampled geometric coverage and temporal aliasing comparisons, formal floating-point envelopes, and scalable connected hydrology. The current finite tests and working UI do not close those gates.

Water regression coverage now includes 576 rays crossing ±0.1 mm through ±1 m, Fresnel samples straddling the critical angle, upward underwater captures, two-sided surface captures, distant-water captures, and deterministic moving/static channel checks. Wave filtering must account for the projected interface footprint at grazing angles; a distance-only filter and hard distant-shader switch were rejected after visual inspection.

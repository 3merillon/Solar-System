# Game optimization — 13 November 2026

Implemented locally from the clean `59545e7` checkpoint, preserving Rust → WASM → WebGPU, shipped quality settings, content density and collision guards. This pass reduces collision readback payloads, river decoding work, shader preparation complexity and vehicle upload overhead, and replaces the long attribution strip with a compact credits disclosure. Nothing was pushed or deployed.

## Retained changes

- **Collision snapshots:** pack only the requested terrain grid before the object records. Read the object count from the same completed mapping and copy only populated records into WASM. There is no extra GPU round trip or additional queued frame. Stale epochs, overflow, unresolved work and coverage holds remain enforced.
- **River widths:** exact bounds for groups of 32 bank edges reject impossible candidates while preserving original edge order, arithmetic and the 1,024-candidate limit. Eight alternating browser rounds check exact results and counters. Four recorded river/coast fixtures compare complete terrain/water outputs with fresh workers for every arm.
- **Shader preparation:** remove a redundant read-only lookup and prepare four diagnostic-only programs only on explicit audit requests; all 106 shader sources remain embedded. The original measured-field call structure and compiler concurrency policy are retained after rejecting slower experiments.
- **Vehicle streaming:** begin decoding while the renderer prepares. Bounded primitive batches use the existing eight message credits, and uploads drain progressively under soft time/byte budgets. All vertex/index/image hashes, materials, animation data and LOD order are preserved.
- **Credits:** provider names remain visible in an 11 px desktop / readable mobile treatment. The expandable panel retains full source strings, links and licences, supports keyboard focus and Escape, and keeps touch scrolling separate from game input. HUD/touch/audio clearance is verified without changing the flight-deck design.

## Measurement scope

Hardware: i7-12700F, 64 GB RAM, RTX 3080 10 GB, NVIDIA 621.24; private headless Edge 157.0.4341.46. Matched gameplay uses 1920×1080 High, render scale 1. Serial attribution runs use one in-flight frame; rAF and first-use probes retain the default two-frame limit. Cold startup means a new private browser profile, not cleared operating-system or driver caches.

The baseline served artifact was preserved before edits, with zero source/build mismatches and all 106 embedded shader programs verified. Early measurements overlapped another application's GPU load. They are retained separately; later quiet repeats provide the comparable results. No native timing is used as browser performance evidence.

## Memory and bounds

The maximum collision staging allocation remains **5,513,264 bytes**. A 129² terrain request transfers 4,722,736 bytes instead of 5,513,264; object-only transfer is 4,456,480. The consumed payload is much smaller when few objects are present: 129² plus 53 records is **496,944 bytes**, and object-only plus 53 records is **230,688 bytes**. Encoded GPU transfers, accepted WASM payloads and resident allocations are reported separately.

The river index adds at most **8 KiB of transient bounds** at the existing 8,192-edge cap. It is rebuilt per solve and introduces no persistent cache. Worst-case work still visits every edge. Batching can retain more decoded geometry per outstanding message; its queue peaks are reported. The 2 ms / 6 MiB upload budgets are soft because an indivisible primitive can exceed them. The largest observed single upload is about **21.9 MB**.

## Visual evidence

Fixed-time lake captures above, near and below water are pixel-identical. Matched urban façade and shadow captures are also pixel-identical, with the existing terrain refinement/morph stability assertions intact. The 18-frame exterior/cockpit sequence changes ten display pixels across 9.33 million compared pixels, with **zero silhouette-coverage changes**. Fifteen frames are pixel-identical. Three frames have sparse position-buffer ownership differences at layer edges, including a two-pixel maximum of 0.742 m; rendered position-buffer identity is not claimed. Uploaded asset geometry is hash-identical. An unchanged-baseline repeat is pixel-identical.

!Exterior and cockpit comparison sequence (`evidence/optimization-2026-11-13/images/car-comparison.gif`, development repository only)

The preview is reduced for size; measurements use original PNG and float buffers. [Detailed methods](OPTIMIZATION-2026-11-13-DETAILS.md) explain matching, bounds, harness repairs and reproduction. Raw runs remain under `evidence/local/optimization-2026-11-13/`; compact hashed evidence (`evidence/optimization-2026-11-13/summary.json`, not kept) retains summaries and provenance.

## Rejected experiments and remaining work

Reducing compiler concurrency to three lanes delayed complete readiness in quieter repeats (54.82/56.50 s versus 38.79/40.86 s with the original scheduler), despite an encouraging early contended run. It was rejected. Earlier rejected cloud approximations were reviewed and not reintroduced.

Sharing measured-field spline calls through loops improved isolated compilation but increased complete GPU-frame medians by 2.5–4.1% in the three vehicle scenes. Those loops were reverted. Their measurements and immutable artifact are preserved separately from the retained build.

Initialization still includes expensive water/shadow compilation, live field decoding and collision preparation. Surface rendering remains substantially GPU-bound. Whole-frame, tail-latency, first-use, live-travel and regression results below determine the practical outcome; isolated subsystem speedups are not promoted to whole-game claims.

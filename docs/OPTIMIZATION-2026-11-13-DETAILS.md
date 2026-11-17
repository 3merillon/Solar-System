# Optimization methods — 13 November 2026

This pass starts at `59545e7`. The initial working tree was clean. The served artifact was copied before edits to `evidence/local/optimization-2026-11-13/baseline-web`, with a file inventory and SHA-256 hashes in `provenance.json`. Its build manifest had **zero source mismatches**. Its 106 embedded shader programs matched the source build key. Baseline WASM: 14,206,658 bytes, SHA-256 `6f9eebc48bf404ea3d13d913aa555c108a84e1ca1d6b52fbcc0cef450b4d6b42`.

Port 5198 was not listening at the initial check. One hidden instance of the existing `tools/serve.mjs` was started there. Every browser test uses that server, including the baseline and package junctions. No desktop or personal browser was controlled. No repository content was pushed or deployed.

## Measurement boundaries

- Browser execution uses private headless Edge, real WebGPU and the WASM entry point. Native Vulkan/wgpu results are validation only.
- A cold run uses a new private browser profile. A warm run reloads within that profile. The operating-system file cache and driver caches were not cleared; “cold” does not mean a physically cold machine or empty driver cache.
- The unchanged development server gives `/assets/car-047c2dd/` immutable caching, while the baseline's prefixed snapshot URLs receive `no-store`. Cold profiles transfer both copies. Warm vehicle-download comparisons therefore have a small HTTP-cache-policy difference; resource transfers remain in the reports and warm wall-time differences are not attributed solely to code.
- Desktop timing runs use 1920×1080 High, render scale 1. Product quality settings and the two-frame submission limit are retained. Serial timing uses one in-flight frame to attribute complete GPU frames; separate rAF measurements use the product's two-frame limit.
- GPU spans include the complete submitted frame. Summing selected pass times is not substituted for that span. Serial pacing includes harness polling. rAF cadence is not measured display presentation or physical input latency.
- Reports retain camera, time, settings, build provenance, source state, raw samples, cold camera cuts, p50/p95/p99, and long tails. Live travel is observational: changing source availability and moving solar lighting prevent a controlled A/B speedup claim.
- Other GPU work was observed on the shared machine and left alone. Early runs include an external game's load. Those runs and the quieter repeats are reported separately; their difference is not an optimization gain.

Startup records distinguish first image, first loaded car LOD, hero LOD, first observed non-held physics advancement, one second of continuing non-held advancement, and full feature readiness. A missing milestone remains null. `--playable` observes for up to 240 seconds. The first-use probe sends browser key events for driving, cockpit, and flight/exhaust as soon as the first car LOD exists, while other features may still be compiling.

Resource timing records compressed transfer and decoded sizes. The WASM loading/initialized marks bound fetch, streaming compilation and instantiation together; they do not isolate browser-internal decompression or overlapping compiler CPU time. Per-program module/pipeline elapsed times include browser and driver scheduling under the declared concurrency. They are not additive CPU costs. Renderer-construction marks, decoder metrics, upload peaks, UI heartbeat gaps and sampled worker stacks complete the observable critical path.

## Collision snapshot packing

The storage layout and collision queries are unchanged. A snapshot retains its original 32-byte header, including overflow and unresolved-work counters. Each object still occupies 272 rows of 16 bytes, with capacity 1,024. Terrain queries still use the requested 129² or 257² grid.

The staging copy contains the header, the terrain rows actually requested, then the complete object-capacity region. After that **same mapping** completes, the header determines how many object records enter the WASM-owned result. No extra GPU round trip, submission, coverage reuse, or frame-queue slot is added. Reset and source epochs still reject stale results; incomplete geometry still holds the vehicle.

| Quantity | Bytes |
|---|---:|
| Existing maximum staging allocation | 5,513,264 |
| GPU copy with a 129² terrain request | 4,722,736 |
| GPU copy with no terrain request | 4,456,480 |
| Consumed 129² terrain plus 53 object records | 496,944 |
| Consumed object-only snapshot with 53 records | 230,688 |

The fixed GPU allocation does **not** shrink. The object-capacity transfer also remains because its count is produced by the GPU. `staging_bytes` counts encoded staging transfers; `snapshots` counts scheduled snapshots; `readback_bytes` counts accepted payloads consumed by physics. These are different quantities. Allocator high-water observations are not a guaranteed memory reduction for every route.

The focused Rust test covers both grid sizes, terrain omission, zero objects, one object, 53 objects, capacity, and capacity overflow. Browser collision tests exercise the actual mapping and consumption paths.

## River width queries

The new temporary index groups 32 consecutive bank edges. Each group's bounds are the exact minima and maxima of its line-segment endpoints. A group can be skipped only when it cannot cross the parity ray's latitude, or every edge fails the existing 2,048 m width box. Multiplication by the positive local metric preserves the latter ordering.

Surviving edges are visited in their original order. The 1,024-candidate admission limit, overflow counter, intersection arithmetic, fallback widths, and width smoothing remain the same. The worst case still visits every edge; this is not a constant-work claim. At the existing 8,192-edge cap, the temporary bounds occupy 8 KiB. They are not retained in a new cache.

The browser test checks exact results and counters across edge-group boundaries, endpoints, degenerate tangents, box boundaries, and overflow, then runs eight alternating timing rounds. Recorded Wupper, Rhine, Douro and Leixões fixtures compare the complete quantized terrain and water outputs. Each fixture arm/repeat runs in a fresh worker: cloning tile objects alone would leave the existing content-keyed river cache warm. Timing fields are excluded from equality; geometry, water arrays, scalar results and work counters are compared.

The isolated browser query batch falls from a median 37.8 to 6.7 ms across eight rounds. This does **not** translate into the same full-page speedup: three cold Node fixture solves have medians of 186.9 → 187.1 ms (Wupper), 80.9 → 76.7 ms (Rhine), 185.4 → 185.1 ms (Douro) and 167.4 → 170.9 ms (Leixões). Those end-to-end decoder timings are largely neutral and are not browser FPS evidence.

## Shader preparation and asset streaming

`water_layer_entry` no longer repeats a finest-page lookup whose read-only answer was checked at entry. The original measured-height and footprint call structure is retained after the loop-sharing experiment described below was rejected. No procedural model, detail level, distance, tolerance or precision format changes.

Four diagnostic programs already owned by Rust `OnceLock`s are excluded from eager browser compilation: morph, contact, footprint and cover audits. Their sources remain among the 106 embedded programs. Gameplay precompiles 102 programs; explicit audits create their pipelines and reuse them on the same renderer/device. A new device creates a new cache. Gameplay's initial movement, water, clouds and vehicle effects retain their prepared pipelines.

Car decoding begins during renderer preparation when the page actually requests a default vehicle. The decoder groups at most 32 small primitives into a message with a 1 MiB target. An oversized primitive travels alone. The existing eight credits bound outstanding messages; partially consumed batches retain their credit. Uploads have a **soft** 2 ms CPU budget, 6 MiB byte budget and 64-operation limit per frame. One indivisible image/primitive upload can exceed the soft budgets; this remains visible in upload telemetry.

No vertex, index, material, image, mip or LOD is removed. The real-asset browser check hashes every uploaded buffer and checks call order for LODs 2, 0 and 1. Its mock upload receiver measures transfer pacing, not actual GPU upload time or game FPS. Actual startup and first-use measurements cover the production receiver. A batch can retain more small primitives than an old single-primitive message; observed queue peaks and the largest indivisible upload are reported rather than calling batching free.

## Credits and visual comparisons

The disclosure keeps provider names visible, with full source strings and links in the panel. Native summary semantics provide keyboard activation; Escape closes and restores focus. Source updates retain the open state and the focused link. Pointer, wheel and touch scrolling stay inside the credits instead of controlling the game. Touch controls and audio have clearance above the bar. A conflicting inherited top anchor on the mobile flight-deck HUD is reset so the existing bottom placement keeps its intended height.

The credits harness covers 1920×1080, 390×844, 320×568 and 844×390, including actual emulated touch scrolling, Space, Tab, Escape, focus retention, provider lists, full text, links, readable font sizes, wrapping, overflow and HUD/control clearance. It is a layout and interaction test, not mobile GPU performance evidence.

Visual captures are separate from timing. The 18-view car sequence fixes pose, mechanisms, time and lighting while changing exterior/cockpit cameras; it also retains raw position and normal buffers. An unchanged-baseline control repeats the same sequence. Urban captures restore a common animation state after the existing moving-source assertions: otherwise different compilation durations create different foliage phases. Lake comparisons cover above, near and below the interface. Raw PNG/float data, rather than reduced preview animations, supply the difference measurements.

## Rejected scheduling experiment and harness repairs

Sharing the measured-height and footprint spline calls through bounded two-phase loops reduced isolated browser preparation time, but increased complete gameplay GPU time in the quieter matched pair: forest 28.94 → 30.12 ms, low flight 36.00 → 36.91 ms and cockpit 31.59 → 32.52 ms (medians). Shading and scenery stages became slower. That restructuring was reverted; its WASM, source provenance, compile timings and complete gameplay reports remain available. The first qualification plan was stopped after that completed comparison, and the retained build receives a separate full run. Visual results from the rejected candidate are kept distinct from final-build captures.

Three compiler lanes without a dedicated water lane helped an early contended trial, but quieter baseline repeats delayed full readiness to 54.82/56.50 s versus 38.79/40.86 s with the existing scheduler. That scheduling change is **not retained**. Shader and asset changes are evaluated separately under matching schedules. Earlier rejected cloud approximations were not reintroduced.

The original run failures remain in the serial-run reports. One build invocation selected Windows PowerShell, whose inherited module path did not expose `Get-FileHash`; compilation and shader verification succeeded but manifest writing failed. The complete build is rerun with the configured `pwsh`. The recorded-water comparator initially compared absolute phase timestamps; its repair excludes those timings while retaining output and work-counter equality. A second attempt passed all twelve fixture comparisons but exceeded JavaScript's JSON string limit when expanding repeated polygon references. The final report hashes complete arrays incrementally and memoizes shared objects, without sampling values. The urban capture repair fixes animation state only after the original stability assertions. No collision assertion or coverage guard is relaxed.

## Reproduction

Use the existing port-5198 preview. Plans under `evidence/local/optimization-2026-11-13/` retain exact commands and output locations. Local raw profiles and snapshots are intentionally ignored by Git; compact summaries and representative images are committed with the main report.

```powershell
pwsh -NoProfile -File tools/Check.ps1
cargo +1.87.0 run -p solar-probe --bin solar-gpu-probe --release --locked
pwsh -NoProfile -File tools/Build-Explorer.ps1
node tools/Verify-Explorer-Build.mjs web/pkg/solar_explorer_bg.wasm
node tools/Package-Explorer.mjs
node tools/Summarize-Optimization-Pass.mjs evidence/local/optimization-2026-11-13 evidence/optimization-2026-11-13
```

The package smoke test receives its URL on the existing server, **not** `--local` (which would create another server). The optional local Solar System bake remains outside the static package under the existing packaging policy.

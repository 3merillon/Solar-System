# Worker startup and asynchronous shader compilation

The [13 November optimization pass](OPTIMIZATION-2026-11-13.md) retains the
existing compiler-lane policy and overlaps bounded vehicle decoding with renderer
preparation. Of the 106 embedded
programs, 102 are prepared for gameplay; the four diagnostic audits compile only
on an explicit audit request and remain cached on that renderer/device. Startup
telemetry separates module and pipeline preparation and records individual asset
upload peaks. The pass measures first image, first/hero car LOD, sustained physics
advancement and full feature readiness separately.

The renderer, its GPU device, shader compilation, allocations, procedural planet
generation and frame submission now live in `web/render-worker.js` using an
OffscreenCanvas. The page retains controls and the existing small canonical
camera-height queries; it never creates a GPU device or compiles a GPU pipeline.

`build.rs` validates the full WGSL, retains each pipeline's entry points, removes
unreachable functions/resources with Naga, emits WGSL, and validates that emitted
source. This is build-time module pruning, not reduced scene quality. It keeps
the same 128 cloud samples and shadow/terrain budgets. Identical atlas mip
pipelines are shared. Common cloud illumination and grazing-ray calculations
have one call site instead of repeated copies after driver inlining.

The worker precompiles exact pipeline descriptors with WebGPU's asynchronous
APIs, with two to eight compiler lanes by reported core count (see the 27
October section below). wgpu 30 has no public asynchronous
pipeline constructor, so a device-local bridge supplies those completed handles
to its immediate constructors. Module source and full normalized descriptors
must match; a missing startup pipeline is an error. There is no global prototype
patch, disabled validation, or browser optimization flag. Diagnostics may still
compile their own shaders when explicitly requested, inside the worker.

Startup shows adapter setup, shader names, completed/total pipelines, elapsed
time, resource allocation, and the first GPU-generated frame. It does not claim
time remaining from an arbitrary percentage. Pipeline timings and compiler
messages are retained at `solarExplorer.startup()`. Device loss is observed
before compilation starts and during rendering. A failed worker clears pending
requests and exposes an explicit retry; it does not endlessly restart. GPU loss
is checked before the frame-queue capacity check, preventing a dead queue from
silently swallowing the error.

Private Edge 156 / local RTX 3080 measurements on 26 October 2026:

| Revision experiment | Ready | Maximum UI heartbeat gap |
|---|---:|---:|
| Original immediate batch, 63 requests | 90.72 s | 89.66 s |
| Worker + pruned modules, serial async compilation | 64.17 s | 56.2 ms |
| Shared cloud-light call sites | 38.14 s | 58.6 ms |
| Bounded two-job compilation | 20.83 s | 59.9 ms |

The final recorded run reused 60 completed pipeline handles and made zero main
thread GPU calls. Water remained the slowest compilation at 17.57 s with another
job active; cloud compilation took 3.66 s. A uniform-loop-bound experiment did
not improve compilation and was removed. These are cold private browser profiles,
not a promise for mobile hardware or all drivers. A startup panel does not solve
the remaining renderer memory/performance cost. A forced device loss stopped
rendering, cleared pending frames and showed the retry button.

The original error text, “A valid external Instance reference no longer exists”,
is emitted by [Dawn's device-loss shutdown path](https://dawn.googlesource.com/dawn.git/+/refs/heads/chromium/7945/src/dawn/native/Device.cpp).
It is not sufficient evidence of a dropped Rust instance: Solar-System v2 retains its
instance in `Gpu`. Long immediate pipeline compilation blocked the browser and
was a reproducible startup defect; the user's exact GPU-process failure was not
independently reproduced. The [WebGPU specification](https://www.w3.org/TR/webgpu/#async-pipeline-creation)
recommends asynchronous pipeline creation to avoid blocking the device timeline.

Reproduce with `tools/Build-Explorer.ps1`, then
`node tools/Test-Startup.mjs evidence/local/startup/final --loss`.
Raw before/after traces are in `evidence/local/startup/`. Run GPU tests sequentially.


The subsequent six-cascade/terrain-validation build measured 28.68 s to ready,
59.8 ms maximum UI heartbeat gap, 60 reused async pipeline handles and zero
main-thread GPU calls or unexpected startup compiles. Water compiled in 22.47 s.
This run overlapped CPU-only repository checks; it is a responsiveness/recovery
check, not an isolated compiler benchmark. Forced device destruction exposed the
error and retry button with zero queued frames. Reload created a fresh device
and recovered in 6.11 s with the browser's warm shader cache.

## 27 October 2026: deferred features and a first image before the ocean

The whole-renderer performance pass (`docs/PERFORMANCE-PASS-2026-10-27.md`)
changed startup in three ways.

- Compilation cost was cut at the source: one direct-light query per water
  pixel instead of four, one cache lookup and one live band loop per shadow
  query instead of six copies, and shared cloud call sites. The compile cost of
  a program is dominated by such inlined copies, not by the arithmetic inside
  them (stubbing the noise function changed nothing).
- Lanes: two on four threads or fewer, four up to eight threads, otherwise
  half the threads up to eight. Four lanes ran at 3.9x effective parallelism
  on the RTX 3080 workstation; eight lanes cut the cold compile from 10.6 s to
  7.7 s with the water program alone on the critical path.
- Deferred features. `web/gpu-startup.js` lists the programs only the ocean
  (`water`, `ocean_vertex`, `ocean_cap_vertex`), the clouds (`cloud_pass`,
  `cloud_far_pass`, both sun cloud profile generators),
  the scenery (`scenery_cull`, `scenery_shade`), the shadows (`shade`) and
  diagnostics need. The bridge resolves once every other program exists; the
  renderer starts with those features absent (`renderer::Pipelines` keeps
  them as options) and shades the first image with `shade_initial`, the same
  shading minus the sunlight query. The longest deferred programs start at
  once in extra lanes on machines with twelve or more threads. Each frame the
  renderer asks `solarPipelineReady` for its missing programs and creates a
  feature as soon as all of its programs have compiled (a cache hit, no second
  compilation); the frame uniform reports the ocean and clouds as disabled
  until then, the composite reads the shaded surface directly, and a flat sea
  placeholder covers the submerged bed. `window.explorerReady` still means the
  complete renderer, which the regression tools wait for; the page exposes the
  first image time as `window.solarFirstImage` and `Test-Startup.mjs` reports
  both. Native builds create every program at construction.

Cold private Edge, RTX 3080, 1920x1080 canvas, full tier, high preset
(`node tools/Test-Startup.mjs`, serial runs):

| Build | First image | Complete | Water compile | Lanes |
|---|---:|---:|---:|---:|
| Published checkpoint (26 Oct) | 28.7 s | 28.7 s | 22.5 s | 2 |
| Compile cuts (group 1) | 10.7 s | 10.7 s | 6.3 s | 4 |
| Shadow clipmap, caches, presets (group 5) | 11.7 s | 11.7 s | 8.0 s | 4 |
| Single-evaluator shadows, eight lanes | 8.7 s | 8.7 s | 7.6 s | 8 |
| Deferred ocean, clouds, scenery shading | 6.2 s | 8.1 s | 7.6 s | 8 + 2 |
| Deferred shadows and scenery culling | 4.6 s | 8.7 s | 7.8 s | 8 + 3 |

Per-program times are measured under that concurrency; the serial compile of
the water program is 4.5 s (`tools/Measure-Compile.mjs`). The first image is
terrain, sky, atmosphere and water-free coasts without shadows; shadows arrive
with the `shade` program, props with the scenery programs, the sea and clouds
last. The device-loss test (`--loss`) still exposes the retry button and
recovers after reload. These are cold-profile observations on one machine.
Natively (validation backend, Vulkan) the persisted pipeline cache takes the
explorer binary from 9.0 s to 0.5 s to its first image on the second run.

## 5 November 2026: the car, the first image and the compile queue

The default page (solar system, Halley, Earth) had regressed to 31.2 s to the first image and 66.8 s to the last program on the
cold private Edge profile (i7-12700F 12 cores / 20 threads, RTX 3080); the car appeared only after every program had
compiled, about 70 s. A warm reload of the same profile still took 45 s. `tools/Profile-Startup.mjs` (stages, per-program
times, `solarStartupMark` renderer marks, car arrival with `--car`) and `tools/Measure-Pipelines.mjs` (serial compile of
the exact emitted programs, cold profile per run) measured it; `tools/Inline-Cost.mjs` gives a program's fully inlined size.

- **Serial compile was 183 s** over 106 programs, water 38 s alone. Compilers inline every call, so cost follows the inlined
  size: water expanded to 68,000 lines, `sunlight()` alone 26,000 and present in water, shade, scenery shading and every
  car program. The measured-Earth page path is about 60% of a lit program (stubbing it: shade_initial 8.6 -> 3.2 s).
- **The GPU process runs about three compilations at once**: 183 s serial in 67 s wall with 11 lanes. Eleven jobs at t=0
  queued the first image behind the ocean and clouds; four lanes alone ended 15 s later. Lanes are now phased: four
  lanes plus the water program (the longest) until the first image's programs exist, then the car's programs at the head
  of the queue, then all lanes and the remaining heavy programs (`gpu-startup.js`). `?lanes=N&heavy=M` overrides for
  experiments.
- **The car no longer waits for every program.** Its 16 programs (car, glass, shadow, space, overlay, collision snapshot,
  exhaust, debug lines) left the first-image set; the worker answers `vehicle_load` once they exist (`whenReady`), off its
  call chain so frames keep rendering, and the decoder and first LOD download meanwhile.
- **5.2 s of blocked worker after compilation** was `enable_space`: 32 grey placeholder maps, each mip chain built with
  four `powf` per channel and texel in WASM. Constant levels are now computed once on a 2 x 2 tile with the same
  arithmetic (a test checks equality with halving the full image), one layer is uploaded and copied on the GPU to the
  others, and `halved` reads sRGB->linear from a 256-entry table (exact). 5.2 s -> 6 ms.
- **Programs cut at the source, same arithmetic:** the space car pass never asks for sun visibility (always 1 there),
  8.0 -> 0.1 s; three placement programs differing only in a band constant are one program with a band uniform per
  dispatch, 16.3 -> 5.4 s; `sun_cloud_receiver` has one lookup call site, the refracted bed's first evaluation joins its
  Newton loop, a terrain-shadow march point computes its surface address once, `sc_eco` finds its chart position once.
  Water 38.0 -> 32.6 s, car 8.0 / 7.9 -> 7.3 / 6.8 s. The `rounded()` guard costs about 25% of a lit program's compile
  (an identity there: 8.6 -> 6.5 s) but it protects double-single arithmetic from fast-math reassociation; kept.

Cold results, serial runs, same machine (first image / car on screen / last program): 31.2 / about 70 / 66.8 s before,
16.5 / 27.9 / 63.0 s after. Warm reloads recompile about half of each program in this browser (same source on a second
page load: shade_initial 8.6 -> 4.5 s); the browser's cache is not under the page's control. One machine and one browser;
not a mobile or cross-driver claim.

## 13 November 2026: where compile time goes, loop bounds, the browser's cache limit

Measured with Dawn's own trace events (`gpu.dawn` category in a private headless Edge 157, RTX 3080, D3D12), one
program at a time. For the water program, cold: Tint (WGSL -> HLSL) 0.2 s, DXC (HLSL -> DXIL, `OPTIMIZATION_LEVEL3`,
IEEE strictness) 23.9 s, the NVIDIA driver (DXIL -> machine code, inside `CreateComputePipelineState`) 27.3 s. Nothing
is baked. DXIL has no calls, so every helper is inlined at every call site into one function (shade_initial: 4.3k HLSL
lines -> 32k DXIL instructions). Both compilers are superlinear in that size. `--enable-dawn-features=dump_shaders`
prints the HLSL, DXC flags and DXIL to the page console.

- **The driver unrolled our constant-count loops** together with the page lookups and noise inlined into them. The
  build (`build.rs` `opaque_loop_bounds`) now gives every counted loop of a program that binds the frame uniform the
  bound `N + f.numeric.x`; the host always writes 0 there, so iteration counts are unchanged, but no compiler sees a
  constant trip count. 817 loops in 106 programs. Water cold: driver 27.3 -> 9.2 s, DXC 23.9 -> 21.1 s, total
  51.1 -> 30.3 s. Whole registry, cold, every program forced past the driver's cache, four lanes: 75.7 -> 51.1 s wall,
  286 -> 193 s summed. `SOLAR_OPAQUE_LOOPS=1` builds the opaque bounds (no longer the default, see below). `tools/Compare-Builds.mjs` (six views, ultra,
  display, shaded and water buffers): all 18 captures byte-identical to the constant-loop build. Frame-time cost of
  the lost unrolling is not yet measured.
- **The NVIDIA driver caches machine code system-wide**, keyed by DXIL, across browser profiles. A "cold profile"
  benchmark is therefore only driver-cold for DXIL the machine never compiled; perturb a constant to force it.
- **The browser cache holds only 6 MiB per origin.** Chromium keeps Dawn's WebGPU blob cache as an in-memory LRU sized
  by `GetDefaultGpuDiskCacheSize()` (6 MiB on desktop, `gpu/config/gpu_preferences.h`); the disk copy only refills it at
  startup. Our compiled programs need more than 25 MB, so a relaunch recompiled 96-109 of 130 shader stages with DXC
  (warm wall 28 s, water alone 28 s). Water compiled alone does hit (24 s -> 67 ms). Raising
  `--gpu-disk-cache-size-kb` / `--gpu-program-cache-size-kb` in headless runs did not change the hit set. WebGPU gives a
  page no compiled binaries, so IndexedDB cannot hold them; the only route to "compile once" is smaller compiled output.
- Three fragment programs compile twice (ocean_fragment via ocean_vertex and water_mesh_vertex, ocean_cap_fragment,
  scenery_mesh_fragment); both water paths draw, so both pipelines are needed.

Next levers, in order: fewer inlined copies of the page lookup path (`page_entry` x158 and `rounded` x4748 in water),
which shrinks DXC time, driver time and cache footprint at once; sharing one module between pipelines with a common
fragment so the second hits the in-memory cache.

## 14 November 2026: the opaque loop bounds cost frame time; constant bounds are the default again

The frame-time cost of the lost unrolling, left open above, measured with
`tools/Measure-Integrated.mjs` (private headless Edge, RTX 3080, 1920 x 1080, procedural
body, animated, 240 warm-up and 300 measured frames, fresh browser per arm; both builds from the
same source apart from the loop bounds). GPU span p50, ms:

| View | Constant bounds | Opaque bounds | Order |
| --- | ---: | ---: | --- |
| forest | 47.1 | 103.2 | sequential, constant first |
| coast | 47.0 | 58.6 | sequential |
| forest | 75.9 | 107.8 | interleaved round 0 |
| forest | 47.7 | 51.6 | interleaved round 1 (opaque first) |

Run-to-run variation is large (the same constant build measured 47 and 76 ms), but the opaque
build was slower in every pair, by 8% to 2x. Faster cold compile (about 25 s) does not pay for
slower frames, so `build.rs` keeps constant bounds unless `SOLAR_OPAQUE_LOOPS=1`. A selective
version (opaque bounds only in programs whose frame cost does not depend on unrolling, the
water program being the largest compile) needs per-program measurement and is not done.
Raw reports: `evidence/local/loop-bounds-frame-cost*`.

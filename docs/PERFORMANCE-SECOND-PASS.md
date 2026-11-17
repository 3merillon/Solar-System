# Second measured performance pass — 25 October 2026

This pass starts at `85d538b` and retains Rust/WASM/BrowserWebGpu, the canonical
solid, native input/output dimensions, the 2048-query visibility budget and
64-step medium integration. The original 16.67 ms objective is still the target,
not an achieved claim. The first pass remains archived in [PERFORMANCE.md](PERFORMANCE.md).

## Accepted exact work reductions

`exact_work` selects a package of exact changes. Geological proxies can be read through a fixed
24-element uniform array. The same 1,920-byte allocation is also exposed through
the original storage binding for paired controls; coefficients, arithmetic and
resident payload are unchanged. Cloud density returns immediately when its
vertical support is exactly zero. The remaining factors are finite and cannot
change that zero. The outside-cloud solar path also checks the existing planetary
occlusion condition before doing its extinction samples. The inside-cloud
quadrature, including its existing lighting limitations, is unchanged.

`noise_cache` memoizes the eight cloud noise bands' **integer lattice values**,
not density, lighting, transmittance or the rendered image. Eight 64³ windows
occupy 8 MiB in the optional cache allocation. The original cubic interpolation,
world coordinates, integer seed, wind offset and footprint filtering remain in
the consuming shader. A query whose complete eight-corner neighborhood is not
resident uses the original hash. No interpolation across different noise cells
or approximation of a filtered lighting signal is introduced.

Each submitted frame rebuilds these bounded windows from its own body/seed,
origin and animation epoch. Construction is included in transport timestamps,
including cold cuts; there is no warm-history requirement. This deliberately
simple policy avoids stale keys. No cloud build is issued when clouds are off.
The older experimental solar grid bypasses this cache and uses its own smaller
allocation. Disable returns to the 16-byte placeholder. Both resource admission
and the resident ledger account for the full allocation.

The paired control switches remain available for reproducibility. They are
evaluation settings, not new quality presets. Pipeline variants now defer their
diagnostic counterparts until an instrumented submission needs them. The variant
cache preserves each pair's readiness state; default and nondefault variants
follow the same rule. Construction compiles the requested production variant
directly rather than first compiling an unused default pair.

The planetary production variant also specializes away the unrelated small-solid
vocabulary. Generic scenes keep their own path. Fixed solar quadrature counts
(12 plus 4 inside the layer; 6 outside) are supplied through unused uniform lanes
to discourage compiler unrolling; these counts are not user quality controls.
The paired `exact_work=false` control retains the original dynamic scene path
and literal loop counts. Their individual causal timing effects are not isolated
from the rest of this exact package.

## Ray-local prefix experiment

`prefix_cache` is an off-by-default research candidate. It stores the first 16
bands' value difference, directional derivative, curvature bound, valid reach and
numerical allowance at a ray-local center. For a subsequent interval, with
`r = abs(midpoint - center) + half_width`, the additional enclosure is
`0.5 * H * r² + 1e-5 * r + anchor_numerical_allowance`. Fine bands, erosion and
CSG composition remain explicit. Ridge terms constrain the reach so that an
absolute-value sign cannot change. Every primary or secondary trace resets the
certificate; it is never carried between distinct rays, bodies or epochs.

The first audit exposed an older support shortcut: outside the coastal feature
box, omitting CSG preserves the intended sign but does not reproduce the full
CSG scalar value. Narrower certificates must not be called full-field enclosures
on that basis. The candidate now encloses both the existing shader field and the
independent untruncated CSG oracle, using analytic primitive ranges and the full
coastal displacement residual outside the box. The f64 test was not weakened.

An initial 640×360 pilot increased rough-terrain primary unknowns from 107 to
6,931 and total time from 202 to 355 ms. It failed. A revised candidate retries
the original bound at the same interval whenever a reused certificate remains
uncertain; this extra work is counted. Numerical tests are finite engineering
audits, not directed-rounding proofs. Its final acceptance is recorded with the
measurements below.

The retry also fails the performance gate. Ground was 90.44 → 122.28 ms, rough
194.15 → 307.70 ms and cave 18.44 → 33.66 ms at 640×360 (one short pilot round).
Primary/secondary unknown counts returned exactly to 10/11, 107/2 and 0/1,
respectively. The duplicate work increased evaluated bands. Keep this candidate
off; do not repeat it as an accepted acceleration structure. The independent
bound audit exercised 6,528 cached-prefix samples, including 141 reused regions,
with zero observed enclosure violations after the CSG correction.

This is local bound reuse, not a new algorithm claim. Related prior art includes
[Segment Tracing](https://aparis69.github.io/public_html/projects/galin2020_Segment.html).
The resource layout follows the [WGSL uniform rules](https://gpuweb.github.io/gpuweb/wgsl/#address-space-layout-constraints).

## Measurement and gates

Runs use immutable directories under `evidence/local/performance`, source and WASM
hashes, exact settings/cameras/epochs, GPU timestamps and hardware-state samples.
Timing contains no full-image/counter readback. Compilation and first submissions
are separately recorded before steady samples. An early run stalled in cold
variant compilation and is excluded from performance conclusions.

Exact changes must preserve the captured HDR, display and primary validity.
The prefix experiment uses the existing 0.5% per-ROI relative HDR RMS and two
display-code p99 limits, with unchanged primary validity, plus visual inspection.
Unresolved rays are never masked out of the validity gate. Neither gate certifies
pixel coverage or fixes the original image-quality limits.

Reproduction:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/Check.ps1 -Gpu
powershell -NoProfile -ExecutionPolicy Bypass -File tools/Build-Web.ps1
node tools/Performance.mjs --experiment second-pass --frames 12 --rounds 3 --frozen --quality
node tools/Performance.mjs --experiment noise --views clouds --frames 300 --rounds 3 --fixed-step 0.1 --path flight --quality --quality-end
node tools/Test-Performance-Pairs.mjs --experiment exact-work
node tools/Test-Performance-Pairs.mjs --experiment noise
node tools/Performance.mjs --experiment prefix --width 640 --height 360 --frames 4 --rounds 1 --frozen --quality --views ground,rough,cave
node tools/Test-Lifecycle.mjs
```

Use the existing localhost:5198 preview server. All regression browsers are
private headless instances; the owner's preview stays open. No upload or
deployment is part of this pass.

## Final matched 1080p result

RTX 3080, driver 621.01, Windows, Edge 156.0.4314.42, BrowserWebGpu. Native
1920×1080 input and output, spatial reconstruction, 2048 primary queries and
64 medium samples. Three alternating-order rounds contain 12 steady frames per
arm/view (36 per arm/view). The table uses the median of the three round medians.
These short runs do not establish reliable tail latency. The preview remained
available on the shared workstation, so this is not exclusive-device throughput.

| View | Control GPU ms | Accepted GPU ms | Reduction |
|---|---:|---:|---:|
| Ground | 615.30 | 461.94 | 24.9% |
| Rough ground | 1434.04 | 1204.31 | 16.0% |
| Clouds | 223.39 | 133.53 | 40.2% |

Raw compact distributions, stage timings and preflights (`evidence/performance-second-final.json`, development repository only)
identify the immutable run `2026-10-25T09-58-55-273Z-pass2-accepted-36412`.
The paired control disables `exact_work` and `noise_cache`; the candidate enables
both. All other settings, cameras and epochs match. This is the combined package
effect, not the sum of independent component improvements. Earlier isolation
runs are retained in `performance-second-exact.json` and
`performance-second-noise.json`; subsequent loop/specialization stages are in
`performance-second-unrolled.json` and `performance-second-rolled.json`.

Whole-frame display pixels, the complete saved 768×432 HDR crop, and its raw
primary validity mask are byte-identical in all three views. Primary/secondary
unresolved counts remain 258/230 for ground, 1757/57 for rough terrain and 0/0
for clouds. All primary and secondary bound/band counts also match. This does
not qualify silhouette coverage or remove existing amber failures, aliasing,
cloud banding or finite lighting approximations.

The final browser's first completed 1080p submission took **42.63 seconds**;
JavaScript readiness took 0.65 seconds. Earlier second-pass launches took 47–52
seconds. Pipeline construction remains a major unresolved cost. These are
observations with an uncontrolled driver cache, not a startup speedup claim.

The 8 MiB cache raises default 1080p controlled steady payload to **108,460,260
bytes**, and experimental native AA to **241,170,744 bytes**. GPU driver,
pipeline, swapchain, transient resize and capture allocations are additional.
The existing 256 MiB admission limit applies to controlled steady payload only.

The pass accepts `exact_work=true` and `noise_cache=true`, keeps
`prefix_cache=false`, and leaves the earlier approximation experiments off.
The requested **16.67 ms frame time is still unmet**. Rough terrain spends most
of its time in canonical visibility; it needs a different successful strategy
for amortizing field evaluation. The retained changes improve the current
renderer without changing its scene, sample budget or failure semantics.

## Sustained moving-cloud result

The exact lattice cache also ran for three alternating rounds of 300 steady
frames per arm at native 1080p: **1,800 measured frames**, with a fixed 0.1 second
animation step and 10 m/s camera translation. Both arms enable `exact_work`;
only `noise_cache` differs. Thus these numbers isolate the cache on this path,
not the entire package or real-time simulation pacing.

| Pooled GPU time, 900 samples/arm | No lattice cache | Lattice cache |
|---|---:|---:|
| p50 | 180.67 ms | 132.37 ms |
| p95 | 184.85 ms | 135.22 ms |
| p99 | 199.88 ms | 136.58 ms |
| Worst | 203.67 ms | 137.49 ms |

The median of round medians is 180.30 → 132.38 ms (26.6% lower). Final matched
camera/time display and saved HDR/validity crops are identical. This does not
compare every intermediate frame pixel by pixel. All cache builds are included;
there is no amortized hidden warm cache. Distributions and endpoint comparison (`evidence/performance-second-cloud-motion.json`, development repository only).

## Final validation

Validation for the committed implementation passed 30 Rust tests, formatting,
Clippy, WASM checks and five CPU Naga modules. The native GPU suite includes
6,618 small-solid rays, planetary and cached-prefix queries, precision/rebasing,
region/ball/prefix bounds, 765 normal checks, 32 temporal cases, 576 water rays,
and five shared/separate medium comparisons. Actual BrowserWebGpu repeated the
numerical suite, fourteen 1080p views with three frozen frames each, animation
repeatability, water views, snapshot roundtrip, flight controls and device loss.

Each accepted component passed twenty full-image 640×360 comparisons with
byte-identical HDR and display, unchanged validity, and finite HDR. Lifecycle
checks passed ten size/scale/history configurations, lattice enable/disable,
solar bypass/restore, rejected allocation without mutation, capture, backpressure,
suspension, and device recreation followed by successful rendering. Native AA
resize overlap conservatively reached **482,599,536 bytes**, double-counting
shared objects; this is not measured driver VRAM. The endpoint validation (`evidence/performance-second-validation.json`, development repository only)
ties these results to implementation `d3435da`, the tested WASM/native binaries
and their Rust/WGSL source hashes.

A final 640×360 temporal smoke covers eight paths in spatial, native AA and
67% TSR modes: 384 submissions and 144 saved captures, no nonfinite HDR and no
encoded history age over 250 ms. It is a lifecycle/regression check, not renewed
general temporal quality qualification. The 16-frame run stops before the
`ground-cut` path's scheduled frame-17 cut; it must not be reported as testing
that transition. Cold body/seed/camera changes are covered separately by the
paired exact-image suite. The earlier larger temporal experiments remain
historical evidence for unchanged reconstruction code.

## Next architecture decision

After this pass, the owner explicitly permitted a single radial terrain surface
and requested a playable explorer architecture. The proposed next experiment is
a deterministic radial heightfield with a bounded adaptive rasterized mesh.
The field renderer stays archived on its branch; no further ray-marching
experiment is requested. This changes the geometry
contract; it is not implemented or claimed as a performance win in this pass.
The copy-paste implementation brief (`docs/NEXT-CONTEXT-SINGLE-SKIN.txt`, development repository only) preserves the
current renderer for comparison, specifies shared-edge continuity and continuous
LOD morphing, and separately budgets cloud/atmosphere cost. Native hardware ray
tracing over cached triangles remains a possible later lighting experiment.

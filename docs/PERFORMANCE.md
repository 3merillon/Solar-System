# Performance pass: measured foundation and experiments

**Historical first-pass report.** The subsequent [second performance pass](PERFORMANCE-SECOND-PASS.md) accepts exact work elimination and cloud lattice memoization, with new default timings and resource accounting. The results below describe the earlier endpoint and its rejected approximation experiments.

25 October 2026. **Bounded performance and reconstruction experiment completed; performance and quality acceptance failed.** Browser Rust/WASM/WebGPU remains the product path, as the owner reaffirmed. Native hardware ray tracing is not a dependency. Final browser production measurements at native 1920×1080 are about 566 ms ground, 1450 ms rough ground and 224 ms clouds. The 16.67 ms target remains unmet. The derived GPU surface comparison, temporal matrices, real-time queue experiment and lifecycle regressions are complete at the scope documented below; they do not qualify a shipping quality preset.

## Contracts now implemented

The canonical field, identity, ordered visibility and durable erosion remain separate from shading approximations and image reconstruction. Default experimental switches are off. Unknown primary rays still have raw records and a validity mask; unresolved secondary work remains counted.

`shade_pixel` writes **unexposed linear HDR** to RGBA16Float. Reconstruction alone applies exposure, the existing display curve and gamma 2.2 to RGBA8Unorm. Presentation samples the display image. Spatial mode uses bilinear HDR reconstruction and nearest diagnostic reconstruction. The DOM/UI never enters history. A pre/post HDR pilot changed displayed channels by at most one code value in ground, rough and clouds; half-float rounding is not claimed to be bit-identical.

Production shader variants remove diagnostic atomics. The diagnostic path preserves rendering decisions and paired low/high 64-bit work counts. Eight added shading counters count calls to normals, materials, cloud density, direct solar attenuation, air density, shading-depth refinement, water interfaces and medium integration. These are work counters, not independent GPU timings. Solar cache construction is included in transport timing but its diagnostic calls are not accumulated into the per-pixel call counters.

Four asynchronous timestamp slots return eight timestamps per sampled frame. The stages are visibility (including an enabled region build), transport (including an enabled solar build), reconstruction and presentation commands. Missing timestamps are unavailable, not zero. Mapping errors, skipped profiling slots and overwritten completed records are explicit. There are at most 512 completed records. Mapping callbacks measure callback availability, including readback latency; they are not scanout timestamps. The API distinguishes accepted submissions, completed submissions and skipped attempts. Presented/scanout counts are unavailable.

Normal rendering defaults to one pending frame; the harness can compare one and two. History advances only after accepted submission. Exact repeated camera/target frames reuse geological proxies while wave/cloud time continues to update. Configuration, erosion changes and resize invalidate the cache. This is exact-position reuse, not a region cache or a claim of negligible flight-time proxy work.

Reconstruction pipelines survive resize/disable cycles. Scene shader variants are specialized for diagnostic mode, workgroup dimensions, normal filtering and solar caching; their cache holds at most six inactive variant sets. Driver/pipeline memory is not included in the controlled buffer/texture ledger.

## Temporal adaptation and its limits

The implementation reads/adapts TMT revision `d6f7dac838b46678ab3c0b1503b54fdea8321fbd`, including the later controlled performance comparison and tests. MIT and AMD notices are in the distributed `web/THIRD-PARTY-NOTICES.txt`. This is a custom WGSL adaptation, not the official AMD FSR SDK.

Native AA and below-native TSR use submission-owned Halton(2,3) jitter. Motion is **previous unjittered UV minus current unjittered UV**. CPU f64 differences put previous/current cameras in a common local frame; planet-sized f32 positions are never subtracted for reprojection. Sky reprojects direction. Explicit cuts/configuration/resize clear history; long frame gaps reject it.

Each input guide is 24 bytes: f32 two-component motion, current ray distance, expected previous ray distance, octahedral snorm16 normal packed into u32, and full integer material/surface identity. Sky, opaque solid, water and invalid are distinct. The independent finite surface audit found maximum normal packing vector error `0.000050624` over 765 tested points. This is an error audit, not a precision guarantee over every input.

TSR adapts jitter-aware Lanczos2 reconstruction, same-surface nearest-depth motion dilation, previous-position depth scatter, depth/normal/identity rejection, YCoCg clipping and reactive thin-feature locks. Depth scatter orders positive f32 ray-distance bits; it does not copy TMT's reversed-Z or 1000 m far limit. Solar-System v2 supplies reactivity directly, avoiding backdrop/veil difference copies. Native AA uses the cheaper current-image interpolation path. Catmull-Rom history reconstruction and RCAS sharpening have not been adopted or qualified.

Every participating bilinear history tap must have compatible previous guides. Water is fully reactive because its mean-surface motion cannot describe its reflection. Cloud influence conservatively rejects affected history; there is no volumetric-advection history pretending to be surface motion. Component denoising is not added to the current deterministic estimator.

History alpha packs sample count (at most 15) and **oldest contributing age**, rounded upward in 1/64-second increments. Both are exactly representable in binary16. The oldest tap age is propagated across interpolation and accumulation is rejected above 250 ms. Age is relative to the current submitted frame's sampling time; queue/completion/presentation latency is additional. This is a contribution-age limit, not merely an EMA time constant or a guarantee about the age of displayed photons. It necessarily prevents useful accumulation at current full-resolution frame times exceeding 250 ms. It cannot repair that throughput deficit.

The synthetic GPU audit checks constant HDR, native/50% reconstruction, static accumulation, variable frame intervals, age expiration, unknown exclusion/recovery, depth/identity/reactive rejection and cuts. Its 32 cases pass in native Vulkan and BrowserWebGpu. The browser additionally completed 21 scene/mode execution cases at 640×360, 32 frames each, with temporal resources released after each case. This does **not** qualify scene motion, glints, disocclusion coverage, thin-feature locks or a shipping preset. An initial native-only success missed Tint's stricter boolean-expression grammar; actual browser execution caught it and the expression is now explicitly grouped.

## Footprints and analytic normal experiment

Output-pixel spacing, internal sample spacing, query tolerance and temporal support are distinct quantities. Primary ray-depth tolerance uses output spacing. The reference sampler can reduce shading footprints independently while integrating subpixel positions. Material grain, wave filtering and cloud footprint selection share the corresponding scale functions. These remain cone/projection estimates rather than exact ray differentials or coverage certificates.

`normal_filter=1` evaluates cubic-noise derivatives, radial geometry, bilinear erosion and supported coastal CSG branches analytically. Seams and degenerate derivatives retain the four-value fallback. `normal_filter=2` additionally attenuates octave derivatives smoothly, using a projected footprint estimate and a slope-variance roughness candidate. It does not remove any band or numerical envelope from canonical visibility.

The variance model assumes independent uniform lattice values. For cubic interpolation, each gradient component has second moment `(2/3)*(6/5)*(26/35)^2`; the two tangent components yield `0.8829387755*(amplitude/scale)^2`. Discarded variance uses `1-weight^2`, divided by squared retained gradient magnitude. Adding that estimate to the fourth power of material roughness is a statistical BRDF approximation requiring image evidence; it is not a bound, an exact GGX integral or a topology model.

An initial off-surface normal comparison failed: outside supported CSG regions, the existing GPU field can return a different positive value from the oracle's unculled CSG. Surface normals must be compared at actual field zeros. A subsequent independent f64 bisection corpus tests the exact quantized points supplied to the GPU, including canonical value agreement. Across 765 stable points / three seeds, maximum normal-vector error was `0.000031580` and maximum surface-value discrepancy `0.000820208 m`; three seam/unstable-reference points are reported separately. The later image comparisons rejected both normal alternatives, as recorded below.

## Rejected and retained-for-evaluation candidates

Three interleaved short browser rounds at 1920×1080 produced these **pilot** median-of-round-medians results. The workstation was shared. Full distributions/pass medians, WASM hashes and limitations are in `evidence/performance-pilots.json`.

| Candidate / view | Baseline ms | Candidate ms | Decision |
|---|---:|---:|---|
| Remove diagnostic atomics / ground | 573.30 | 590.05 | No demonstrated speedup; retain clean production instrumentation contract |
| Remove diagnostic atomics / rough | 1467.34 | 1480.64 | No demonstrated speedup |
| Region certificates / rough | 1446.14 | 1459.83 | Reject as a performance solution; same 7,366,319,538 band evaluations |
| Solar volume / clouds | 231.22 | 186.73 | Initial timing candidate; subsequently rejected by the HDR quality gate |
| Solar volume / ground | 624.07 | 613.59 | Within variable baseline; no strong claim |
| Solar volume + clear-air table / clouds | 233.87 | 192.35 | No established advantage over solar-only candidate |
| Solar volume + clear-air table / ground | 609.47 | 625.03 | No benefit established |

The region candidate stores analytic enclosing-ball intervals, not sampled min/max, in 32³ camera-local cells. All original residual/numerical/erosion envelopes remain. It failed to reduce evaluated bands in the tested ground views and remains off.

The solar candidate rebuilds a bounded 64×32×64 attenuation grid over the current local cloud layer at the current animation epoch. It blends to direct evaluation at its boundaries and uses direct evaluation outside its support. It does not cache primary visibility or cloud density. Whole-frame cloud display difference reached three channel codes (p99 one, RMSE 0.203 codes); this is insufficient to certify silver linings, motion or HDR error. The earlier additional 128² clear-air table represented the existing finite six-sample solar integral and was subsequently removed. It was **not** a Hillaire ground-to-space atmosphere, a multiple-scattering solution or a sky-view LUT.

Workgroup experiments initially stalled private-page rAF during variant setup/warm-up. Those runs are failed harness/cold-start investigations, not throughput measurements. Completed three-round browser comparisons are in `evidence/performance-workgroups.json`: 4×8 ground was 565.95 → 632.75 ms; 16×4 ground 583.72 → 588.77 ms, rough 1442.93 → 1446.69 ms, clouds 226.23 → 225.20 ms. Images were byte-identical. Keep 8×8: neither alternative established a useful win.

## Bounded derived GPU surface experiment

`surface_cache.rs` / `surface_cache.wgsl` implement GPU octree frontier pruning with the analytic enclosing-ball field bounds, bounded ping-pong queues (65,536 cells each), at most 393,216 vertices, conforming Freudenthal tetrahedra at a common terminal surface depth, and hardware rasterization to an R32 ray-distance proposal. This is space-adaptive empty-region pruning, **not** an error-adaptive guarantee for terminal surface cells. Opposite corner signs and edge bisection do not certify interior topology. Same-sign uncertain leaves, queue overflow and triangle overflow remain explicit.

The raster hint only splits the ordered canonical search. It never authorizes skipping the prefix or turns missing cache coverage into sky. The total primary query budget is unchanged. A probe owns one local cube, rebuilds on every invocation (including camera/seed/cut changes), and drops it on completion. No whole-planet expansion or authoritative mesh is introduced. Timing separates extraction, rasterization, canonical validation, transport and reconstruction; temporary audit readbacks are separately counted.

Browser results at 640×360, a 128 m cube, and three warm pairs are recorded in `evidence/performance-surface.json`. At 2 m terminal width, ground dropped 13,656 nodes and covered 8,031 of 230,400 pixels; rough dropped 19,728 and covered 7,035. Ground maximum display difference was nine codes, failing the exact-candidate gate; rough and cave reached one code. Warm differences were small and inconsistent. At 0.9765625 mm terminal width, ground/cave dropped 2,573,048 / 2,219,640 nodes and produced **zero raster coverage**. Full canonical fallback yielded byte-identical output and no useful acceleration. The five 35-ray independent f64 audits observed no false misses or invalid brackets; some f64 references remained unknown. These finite checks do not establish cache topology.

**Reject this bounded cache as a performance solution.** Its proof bounds retain too much uncertain volume for the frontier budget, and prefix certification still performs almost all original work. This is a completed GPU extraction/raster feasibility trial with explicit failure, not evidence of a shippable hybrid backend. Camera-prioritized refinement and stronger local certificates would require another experiment.

The independent-media audit pipeline now compiles only when explicitly selected. Its private sample arrays are isolated in `media_audit.wgsl`; production `media.wgsl` contains only the shared walk. Default diagnostic pipelines also compile on demand. This removes audit source from the production compilation path; no register/spill reduction is claimed without compiler evidence. Final startup observations are below. The unsuccessful clear-air table has been removed from the solar candidate; solar-only volume reuse remains experimental and off by default. Temporal depth clearing is inside the measured reconstruction interval.

## Memory and reproduction

The ledger counts owned buffers, explicit texture formats, reserved capture storage, timestamp payload/ring capacity and CPU basin arrays. It excludes driver compilation, swapchain/private allocations, allocator overhead and temporary capture copies. Per-frame `resource_bytes()` reports actual configured extents; old checkpoint memory figures no longer apply.

| Resource | Controlled payload |
|---|---:|
| Primary records + HDR | 40 bytes/internal pixel |
| Display + reserved capture | 8 bytes/output pixel, plus capture row padding |
| Optional AA/TSR guides | 48 bytes/internal pixel |
| Optional HDR history pair | 16 bytes/output pixel |
| Below-native scatter | 4 bytes/internal pixel |
| Below-native lock pair | 16 bytes/output pixel |
| Spatial-only guide / native scatter and locks | Small dummy bindings |
| Optional solar volume | 2,097,152 bytes |
| Experimental region certificates | 262,144 bytes |

Configuration and resize check the prospective controlled steady payload against a provisional 256 MiB limit **before allocating or mutating settings**. This rejects near-native TSR configurations whose combined full-sized histories exceed that budget. Old submitted resources, transient resize overlap, captures and driver allocations are outside this steady limit. A byte ledger does not bound extraction work.

The final lifecycle run exercised fourteen resizes with one frame pending, including odd dimensions and 1920×1080 → 1800×1152. The largest conservative old-plus-new payload was 465,822,352 bytes. It double-counts shared objects and is an accounting bound for the two generations, not measured driver residency. A native-AA 1080p HDR capture returned 16,588,800 host bytes and used another 16,588,800 bytes of row-padded GPU staging, on top of the 232,782,152-byte steady ledger. CPU conversion and WASM/JS serialization may add copies; driver lifetime and allocator high-water memory remain unavailable. All ten enable/disable cases returned to their matching spatial ledger. Device recreation was followed by successful rendering and a 921,600-byte RGBA8 capture, not merely a ready flag. See endpoint audits (`evidence/performance-endpoint-audits.json`, development repository only).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/Check.ps1 -Gpu
powershell -NoProfile -ExecutionPolicy Bypass -File tools/Build-Web.ps1
node tools/Performance.mjs --experiment instrumentation --frames 6 --rounds 3 --quality
node tools/Performance.mjs --experiment solar --views clouds,ground,shore --frames 4 --rounds 3 --quality
node tools/Performance.mjs --experiment normals --normal-filter 2 --views ground,rough,cave --frames 4 --rounds 3 --quality
node tools/Performance.mjs --mode realtime --path flight --pending 1 --scale 0.5 --temporal 2
node tools/Reference-Corpus.mjs
node tools/Test-Reconstruction.mjs
node tools/Test-Surface.mjs --depth 6 --extent 128 --frames 4
node tools/Test-Surface.mjs --depth 17 --extent 128 --frames 3 --views ground,cave
node tools/Test-Lifecycle.mjs
node tools/Quality-Timeline.mjs --width 1920 --height 1080
node tools/Performance.mjs --experiment solar --views clouds --frames 300 --rounds 3 --fixed-step 0.1 --path flight --quality --quality-end
node tools/Performance.mjs --experiment queue --views ground,clouds --frames 60 --rounds 3 --mode realtime --path flight --scale 0.5 --temporal 2
```

Each new run gets a separate ignored directory. The build now records hashes of compiled Rust/WGSL sources alongside the WASM hash. Timed runs do not read images or diagnostic counters per frame. Quality runs do. Early pilot source trees were not fully archived; their binary hashes identify observations but are not a substitute for a committed final-build rerun.

The initial reference pass integrates 16/64/256 subpixel samples at a frozen epoch, with 128 medium steps and a primary-validity intersection. Its stopping gates are 0.5% relative linear-HDR RMS and two display codes at p99. Nonconverged views remain labeled nonconverged. The mask proves only sampled primary validity; it does not certify secondary transport or pixel coverage. The later cropped references and temporal ROI comparisons are recorded below; convergence to physical transport remains unestablished.

The later cropped pass covers pixels (128,72) through a 64×36 region of 320×180 output. Shore converged at 4,096 samples/pixel (relative HDR RMS 0.228%, display p99 one code, 2,292/2,304 valid pixels); underwater at 4,096 (0.340%, one code, 2,139 valid); clouds at 256 (0.133%, one code, 1,358 valid); orbit at 1,024 (0.442%, one code, all valid). Ground did not converge at 4,096 (1.22%, three codes, 1,369 valid). Rough hit its 120-second budget after the completed 1,024-sample grid (1.38%, four codes, 1,847 valid). Increasing subpixel samples exposes more canonical unknowns in the all-samples-valid mask; these are excluded explicitly, never averaged into a purportedly certified reference. This establishes convergence only between the tested spatial grids with the existing 128-step transport model.

The follow-up native suite and browser lifecycle audit are in `evidence/performance-followup-audits.json`. All 30 CPU tests and the existing numerical audits pass. Browser allocation checks passed odd dimensions, non-square aspect, native AA, 77/67/50% TSR, disable, bounded submissions, suspension and device loss/recreation. At 1080p, controlled steady payload was 232,782,152 bytes for native AA; 196,614,964 / 169,140,820 / 131,175,732 for 77/67/50% TSR. Disable returned exactly to each matching spatial baseline. A 99% TSR allocation was rejected before mutation at 270,388,464 bytes. This does not measure transient overlap or total VRAM.

The `water_rate` 2×2/4×4 candidate keeps canonical primary visibility at full resolution. A block shares current-frame water radiance only when every primary sample is resolved water and the distance/normal/glint guards pass. Those guards cannot bound reflected terrain or cloud edges. The 2×2 experiment is rejected: shore timing was 439.90 → 403.21 ms, but reflected terrain became visibly blocky and maximum display error reached 140 codes. The central HDR crop showed zero error because it missed the damaged region; the report now also saves the worst-difference crop. Ground was slower (579.74 → 586.46 ms, maximum 52 codes); underwater sharing was inactive and byte-identical. See `evidence/performance-water-rate.json`. The candidate remains off by default and unavailable with temporal history. It does not change the interface, Fresnel formula or mean surface. No 4×4 qualification is justified after the 2×2 failure.

The normal alternatives also fail acceptance. Analytic point normals agree closely with the independent derivative oracle but differ from the existing finite-width shading stencil. Their central HDR errors against that control were 17.1% on ground and 21.0% on rough terrain. The filtered derivative/variance candidate changed ground/rough HDR by 16.9%/32.6%, visibly smoothing the terrain, for timings of 572.52 → 554.65 ms and 1458.82 → 1438.41 ms. Cave and shore did not improve reliably. These are approximation failures, not exact optimization wins. Both modes remain off; correctness of a point derivative does not establish a suitable filtered BRDF. See `evidence/performance-analytic-normals.json` and `evidence/performance-filtered-normals.json`.

## Converged-reference reconstruction comparison

The six-view, six-mode 320×180 timeline completed 32 submitted frames per case with no nonfinite HDR channels in the ten saved captures per case. Oldest encoded contribution age in those captures never exceeded 250 ms. The saved 64×36 reference crops support the following frame-32 comparisons on their all-samples-primary-valid mask:

| Crop | Native point sample HDR RMS | Native AA | Spatial 67% | TSR 77% | TSR 67% | TSR 50% |
|---|---:|---:|---:|---:|---:|---:|
| Shore | 7.33% | 7.77% | 7.80% | 7.98% | 7.90% | 9.24% |
| Underwater | 6.49% | 5.07% | 5.48% | 6.37% | 6.32% | 6.29% |
| Clouds, coastal sea level | 0.97% | 2.18% | 1.91% | 1.73% | 1.54% | 2.81% |

These compare 64-step production transport with converged spatial integration of the 128-step reference model; they include existing quadrature and sampling error. They are neither physical-lighting truth nor isolated TSR error. Ground and rough references did not converge and are not silently promoted to truth. Candidate unknowns are still scored. Numerical stability and bounded history pass, but the results do not establish a general image-quality improvement or qualify Quality/Balanced presets. See `evidence/performance-temporal-reference.json` and its actual-size comparison crops.

The timeline/reference tools deliberately apply the coastal sea level to every view, including clouds and orbit. This reveals more solid terrain than the default-sea-level clouds performance bookmark, and its GPU costs must not be compared directly with the transport-only pilot. Every run saves the actual settings/camera. Quality captures also introduce elapsed-time gaps; their timings describe the quality run and are not throughput measurements.

The subsequent 1920×1080 matrix completed 60 scene/mode cases and 1,920 submissions: frozen ground/rough terrain, cave creep, animated shoreline/clouds, nine underwater crossing heights (including ±0.1 mm and ±1 mm), rotation, a cave cut, a 4096 m rebase, and exposure/light/seed/body/extreme-sector changes. The ten saved captures per case contained no nonfinite HDR channels or encoded contribution ages over 250 ms. The first frame after each explicit cut/configuration change had no history. Existing primary unknowns remain: for example, the native shoreline sequence reached 46 unresolved input rays, and the underwater crossing reached 44. Lower input counts are not proof of better coverage.

`evidence/performance-temporal-1080.json` includes native/TAA/spatial67/TSR77/TSR67/TSR50 settings, sampled ages, stage medians, first/cut/last display PSNR/SSIM, central HDR differences and actual-size crops. At frame 32, ground TSR67 and all rough-terrain history modes had zero retained history. Ground TSR50 retained history in 45,645 of 2,073,600 output pixels. The measured reconstruction dispatches were roughly 0.23 ms for native AA and 0.26–0.33 ms for TSR in these quality runs; the hundreds of milliseconds of visibility/transport dominate. Captures introduce additional time gaps, so use the separate throughput runs for frame-rate claims.

The cropped images show loss of fine terrain contrast and stepped cave boundaries at reduced scale. The native point control itself aliases, so its pixel differences are not an AA truth test; the converged crops above also fail to show a general TSR improvement. No fixed temporal mode is promoted to a shipping quality preset. Static crop variance is recorded, but these captures do not provide a complete reprojected moving-image error or subpixel silhouette-coverage certificate.

## Solar image gate and rejected memory expansion

Before the larger quality comparison, the lighting cache was assigned the reference corpus's conservative convergence thresholds: each ROI must have at most 0.5% relative linear-HDR RMS and two display codes at p99, with unchanged primary validity. Visual boundary/glint review can still reject a numerical pass. At 640×360, 16 cases cover frozen/later epochs, low sun, thin/dense clouds, fast wind, coastal and orbital views, horizon, water, terrain shadows, body/seed cuts and a return visit.

The 64×32×64 / 2 MiB cache failed nine cases, with a worst ROI error of 3.01%. A 128³ / 32 MiB cache reduced that to 0.83%, passing fifteen cases but still failing the body-cut ROI. Its memory expansion is rejected; it did not satisfy the declared gate. The current smaller table uses the inside-cloud quadrature consistently at endpoint nodes, avoiding a branch mismatch at exactly 4400/7200 m. A fresh repeat found that correction did not materially reduce the error: the dominant approximation remains unresolved. The small cache stays off by default; an observed speedup is a speed/quality tradeoff, not a matched-quality win. See the three `performance-solar-*-quality.json` reports and crops.

The final 1080p moving-cloud comparison used three interleaved rounds of 300 steady frames per arm, with 0.1-second fixed epochs and a 10 m/s camera translation. The 900-sample pooled direct/cached GPU p50 was 232.05 / 189.19 ms; p95 236.43 / 208.64 ms; p99 257.69 / 212.14 ms; worst 262.57 / 213.62 ms. Round medians were 232.08/232.13/231.97 versus 191.10/189.27/187.59 ms. The roughly 19% reduction includes rebuilding the cache each frame. The endpoint image still had 0.602% central HDR error, above the 0.5% gate, with maximum display error three codes. No quality threshold was relaxed to accept the speedup. Its first cold activation took 91.37 seconds; subsequent preflight frames took about 188–190 ms. See `evidence/performance-solar-long.json`.

## Real-time queue comparison

`evidence/performance-realtime-queue.json` records three interleaved rounds of 60 frames for each pending-frame limit, at 1920×1080 output / 960×540 input with experimental TSR and direct lighting. Camera translation is 10 m/s with wall-clock animation. Lazy compilation finishes before each flight clock starts. The path is the same real-time rule, but faster completion samples different positions, so this is an interaction/queue comparison, not an exactly paired image-performance experiment.

| View | Pending limit | GPU pooled p50 | Median input-to-completion across rounds | Median submission cadence across rounds |
|---|---:|---:|---:|---:|
| Ground | 1 | 176.09 ms | 176.8 ms | 183.1 ms |
| Ground | 2 | 168.69 ms | 331.5 ms | 168.4 ms |
| Clouds | 1 | 61.32 ms | 63.1 ms | 67.2 ms |
| Clouds | 2 | 61.86 ms | 116.3 ms | 65.2 ms |

Each cell has 180 GPU samples; all timestamp samples were recovered. The 2,238/1,973 ground and 755/605 cloud skipped attempts are refused rAF submissions, not lost completed frames or observed dropped presentations. The input timestamp is the harness's current synthetic camera sample, not a physical keyboard/mouse event. GPU completion callbacks include mapping/callback latency; compositor scanout remains unavailable. Keep one pending frame by default: the modest cadence difference did not justify almost doubling sample-to-completion latency. These modes still miss 16.67 ms and have not passed the image-quality gate.

## Final source, matched-image stage comparison

Final production evidence (`evidence/performance-final-production.json`, development repository only) uses three interleaved rounds of four steady frames per arm/view on the final source. Both arms have 1920×1080 input/output, frozen epoch, direct lighting, original normals, full-rate water and spatial reconstruction. Only diagnostic instrumentation differs. The captured display images and HDR crops are identical. Values below are medians of the three round medians; **stage medians do not sum to the total median**.

| View / arm | Visibility ms | Transport ms | Resolve ms | Present commands ms | Total GPU ms |
|---|---:|---:|---:|---:|---:|
| Ground / diagnostic | 197.268 | 386.945 | 0.041 | 0.020 | 585.99 |
| Ground / production | 184.225 | 386.693 | 0.040 | 0.019 | 565.70 |
| Rough / diagnostic | 1287.890 | 165.730 | 0.040 | 0.022 | 1454.13 |
| Rough / production | 1277.219 | 164.048 | 0.040 | 0.022 | 1450.33 |
| Clouds / diagnostic | 1.960 | 228.017 | 0.041 | 0.019 | 230.38 |
| Clouds / production | 0.197 | 224.093 | 0.041 | 0.019 | 224.35 |

The small difference is workload-dependent; twelve samples per arm do not establish reliable tails or a general speedup. Ground production round medians ranged from 565.15 to 587.19 ms. Retain the clean production path for its instrumentation contract. The historical pre-pass browser totals were 651.46 / 1545.77 / 223.02 ms for ground/rough/clouds. Those earlier captures used the old output path and a different run on the shared workstation: they are context, not a controlled causal comparison. The original stage figures were first-frame observations, so they must not be relabeled as stage medians.

The final source also matches earlier direct-path images and primary/secondary counts exactly in the three selected views; see source equivalence (`evidence/performance-source-equivalence.json`, development repository only). Primary/secondary unknowns remain 258/230 on ground and 1757/57 on rough terrain; clouds has zero in this sample. The source split and lazy compilation did not quietly change those queries.

Two final 1080p launches reached JS readiness in 0.60–0.63 seconds and first completed image in 31.72–31.90 seconds. Earlier launches with only the independent-audit pipeline deferred took 65.65–67.41 seconds to complete the first image. These are observed launches, not a controlled cold driver-cache A/B; no guaranteed startup ratio is claimed. The final renderer still has an unacceptable first-image delay, and there is no separate fast coarse first-image tier. Experimental variant activation can be worse, as the 91.37-second solar preflight shows.

## Final regressions and remaining frontier

Endpoint audits (`evidence/performance-endpoint-audits.json`, development repository only) tie the final source hashes to the actual WASM and native executable. `Check.ps1 -Gpu` passed 30 Rust tests, formatting, Clippy, WASM checks, five Naga shader modules and the native numerical suites. These include 6618 small-solid rays (zero observed false misses/invalid hits, 24 unresolved), 140 planetary rays, bounds/precision/rebase, 765 surface normals, 32 synthetic temporal cases, 576 water-interface rays and five byte-identical shared/separate medium comparisons. They remain finite audits.

The final actual-browser regression passed all fourteen 1080p views with three frozen captures each, motion/epoch repetition, water views, snapshot roundtrip, full-width sector storage, invalid-setting rejection and flight controls. Within-case hashes and the orbit return matched. The forced eight-query case retained 1,374,422 unknown primary rays. Lifecycle tests passed backpressure, suspension, resource rejection before mutation, resize overlap and actual rendering after device loss/reload. The capture regression is not a throughput benchmark.

An additional 640×360 matrix covered a 1 mm slab, creeping arch, rotating porous solid, orbit-to-ground descent, sunset, cloud-base/interior views and erosion edit/import/restore: sixteen native/TSR67 cases, 512 submissions, with zero nonfinite HDR channels or encoded history ages above 250 ms in the ten saved captures per case. Erosion changes at frames 9/17/25 cleared history. The slab is infinite, so this is not a finite thin-sheet coverage certificate. Crops show existing orange unresolved regions at arch edges and lost surface contrast under TSR. See adversarial results (`evidence/performance-adversarial-timeline.json`, development repository only) and capture guide (`evidence/performance-captures/README.md`, development repository only).

| Milestone | Endpoint and acceptance |
|---|---|
| M0 — measurement | Async stage timings, manifests, term counters, fixed/moving paths, reference crops and queue latency implemented. No independent per-term GPU timings or physical scanout measurement. |
| M1 — contracts / cheap work | Linear HDR, spatial resolve, production specialization, lazy audits, exact-camera proxy reuse and allocation ledger retained. Large startup delay remains. |
| M2 — footprints / visibility | Shared scale contracts, analytic/filtered derivatives and analytic region certificates evaluated. Normal appearance and rough/grazing acceleration goals failed; rigorous coverage filtering remains open. |
| M3 — transport | Clear-air table, solar grid and coarse water shading evaluated. All failed benefit or quality gates; no stochastic estimator or component denoiser added. |
| M4 — temporal | Native AA and TMT-derived TSR implemented and tested at 77/67/50%. Bounded history and execution pass; general quality improvement fails. |
| M5 — dominant gap | Bounded GPU extraction/raster/canonical-fallback trial completed and rejected. Visibility and transport still dominate. |
| M6 — runtime / delivery | Browser/native regressions, real-time queues, lifecycle, crops and evidence delivered. Automatic quality and named presets withheld because fixed modes failed qualification. |

No matched-quality large speedup or 1080p/60 fps mode resulted. At native 1080p the three final totals are approximately 34×, 87× and 13× the 16.67 ms budget. Even the experimental half-width/half-height flight paths remain roughly 176 ms ground and 61 ms clouds. A 250 ms contribution-age cap leaves little or no usable history on the slowest paths, and extending it would add stale imagery rather than solve visibility cost.

The next useful experiment needs stronger local empty-space/topology certificates or a derived representation that actually amortizes field evaluation; the rejected frontier/raster hint does not. Transport needs a better controlled integration/lighting representation. Converged ground/rough references, reprojected moving-image error, finite thin-feature coverage and physically converged atmosphere/glint energy remain unqualified. Subgroups, f16, packet compaction and richer lighting caches were not implemented or credited as wins. Preserve WebGPU, the canonical solid and explicit unknowns while selecting that next bounded experiment.

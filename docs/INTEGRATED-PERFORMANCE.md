# Integrated renderer performance qualification

## Qualification complete — 26 October 2026

The implemented performance pass and its required validation are complete.
The owner authorized committing and pushing this qualified pass on 26 October
2026. The shutdown pause is resolved; completed timings were not rerun on resume.
Concurrent work on another project remains an explicit measurement caveat.

Passed: `tools/Check.ps1`, verified WASM build and provenance, performance/cadence
runs, twelve exact static scenes, cloud-motion and non-cold forest-motion
comparisons, 18 cache-validity gates, 13 arrival/prepared-morph gates, three
head-turn/contact gates, water visibility/weather, cloud shell, grazing sun,
terminator diagnostics, prop/terrain shadow stability, night water, native GPU
and native explorer checks, and the actual packaged-site browser test.
The additional cold-cut recovery check also passed all eight recovery gates.
Transient prop-arrival/dither differences remain recorded and accepted per the
owner's clarification; they are not labeled exact frame matches.

This qualification covers the documented finite tests, not universal visual
equivalence or a 60-fps guarantee. See the machine-readable status (`evidence/integrated-performance/validation-status.json`, development repository only),
reference-error limits, measurements and reproduction commands below.

Work based on `ce588cc2d52589b495ae5068e0450714445a3a71` (the single-skin
explorer). The initial checkout was clean. BrowserWebGpu is
the product measurement; native results are checks.

## Baseline identity discovery

The initial `web/pkg/solar_explorer_bg.wasm` SHA-256 was
`ae3bd14413ecea4b1cd2471701f3c56a97d00b1f9baf36461f7548c58d8c1ea5`.
Every source hash in its manifest matched the checkout. Nevertheless, extracting
its embedded pipeline registry exposed the rejected 32-knot cloud shaders:
17 height boundaries, 32 profile intervals, and 16-layer local offsets. The
current source and Rust allocations use 9 boundaries, 16 intervals and 8-layer
offsets. A source manifest written after compilation did not catch stale
build-script output. The original binary remains in the ignored immutable
`evidence/local/performance-integrated/baseline-web/` snapshot.

The first binary measurements and scalar-helper pilot are **not** a source-matched
optimization comparison. They are retained as discovery evidence. The user's
follow-up permits visual improvements rather than literal baseline matching.
In this case a pristine rebuild of the starting commit reproduced the brighter
candidate's tall-cloud HDR buffer exactly. This lighting repair is accounted for
separately from performance changes.

`rebuilt-baseline-web/` contains the pristine source rebuild. `source-baseline-web/`
adds only a CPU-side timing report derived from the already-recorded first and
last GPU timestamps; it adds no GPU query or rendering work. Its manifest records
both changed Rust source hashes. Reference and candidate browser assets are served
from immutable snapshots on a private loopback port. The owner's preview and
visible browser remain available throughout.

## Method and acceptance rules

Solar-System v2 GPU experiments run serially on this shared workstation. No exclusive-device
performance floor is claimed. Each arm opens a new private headless browser.
On resuming, the owner confirmed that another project is also using this
computer. Cross-run shifts can therefore include concurrent CPU/GPU load;
paired/interleaved results support the reported gains, while isolated faster
or slower repeats are not attributed to this change alone.
Comparison manifests include commit, WASM, source and embedded shader identities,
dimensions, full settings, camera, weather phase, commands, adapter and driver.

Final timings use interleaved baseline/candidate and candidate/baseline rounds,
360 warmup and 300 measured frames per arm. Frozen, animated weather, moving
camera and moving sun are separate workloads. Warmup rows retain cold cuts,
generation bursts, queues, denied work, overflow and first-frame costs.

`gpu_span_ms` spans scheduling start through presentation end, including copies
and gaps between passes. The stage sum is reported separately. Fence pacing
includes worker completion and the UI metadata round trip. Neither GPU completion
nor headless rAF measures physical input-to-scanout. p50/p95/p99 distributions,
sample counts, missed budgets and startup compilation are retained in raw JSON.

Quality captures are outside timing runs. `Compare-Integrated.py` compares
linear HDR shaded/water/cloud components, display output, cloud transmission,
position and normal/material buffers, and opaque coverage. Regions include props, opaque surfaces, sky, occupied clouds,
thin clouds, gaps, dilated cloud/opaque boundaries and twelve spatial tiles.
Empty regions do not count as evidence. Full images and worst-difference close
crops accompany metrics. The intended exact-work gate is no pixel/component
change. Approximate trials must pass **every occupied region**: relative HDR
RMSE <=1%, display p99 <=2 codes, transmittance p99 <=0.01, and no opaque coverage,
position or normal/material change. Visual and motion review can reject a numerical pass. These are finite
acceptance tests, not universal accuracy guarantees.

The unfiltered full-size 128-step path remains the reference and default. The
rejected a-trous trial used two 5x5 B3 iterations at strides 1 and 2, raw first-cloud depth,
opaque depth/class, clipped shell endpoint, transmittance and radiance guides.
It reused the two existing cloud buffers with history disabled. Both dispatches,
their storage traffic, and 32 stride-uniform bytes were counted. No temporal cloud
reuse is added, so there is no new history rejection/reset policy to qualify.

## Implemented work and bounds

Cloud optical depth and solid occlusion have independent exact-input validity.
Weather changes invalidate optical profiles. Sun or terrain changes invalidate
both components. Any change to the GPU-projected camera (including its terrain
safety lift and origin tail) invalidates local profiles. Camera movement keeps
the complete original integration work; no stale chart is accepted for a limited
age. Global reuse retains the existing world-anchored projection. Rebuild counts
are GPU-owned and read only by the explicit shadow audit.

The same two local light-chart centers are now computed once per frame on the
GPU and copied into the sun uniform. Consumers retain the compensated address
math. Already-read profile channels supply slope neighbors when they share a
texel. Optical accumulation stops only after the existing stored tau clamp is
saturated; solid work stops only after its monotone maximum reaches one.

Prepared prop support has one 32-bit stamp per existing record plus 96 metadata
bytes: 3,539,040 bytes. It becomes reusable only after every published 0.14-second
morph has completed. The first completed frame recomputes support; intermediate
morph values are never cached as final. Camera translation/rebase, support-detail
settings, viewport, terrain revision or publication invalidate it. Camera turning
still prepares and draws the full retained window. Missing support is retried.
Appearance/fade advancement and view-dependent mesh/card compaction run every
frame. Support reuse and refresh counts are exposed in existing scenery counters.
After its serial saturates at u32::MAX, reuse disables rather than risking an old
stamp match. No geometry, placement list or indirect draw moves to the CPU.

The six shadow maps, scenery capacities, density, detail range, shadow range,
material definitions, cloud heights and view sampling defaults are unchanged.
Full-window scans remain bounded by 884,736 records. Cold height refill remains
458,752 texels; profile bounds remain 262,144 global and 133,128 local rays,
at most 80/320 medium and solid samples per ray when both components rebuild.
These finite capacities do not imply constant cost or a frame-time guarantee.

The final controlled 1080p payload is 978,175,776 bytes (932.86 MiB), versus
974,636,576 bytes for the source baseline: +3,539,200 bytes. This comprises
3,539,040 support-cache bytes and 160 sunlight validity/center/counter bytes.
Scenery now accounts for 199,688,800 bytes; sunlight for 68,289,856 bytes.
Existing timestamp resolve/read buffers remain four pairs of 512 bytes. Driver,
pipeline/compiler, swapchain, explicit audit/capture staging and host copies
are additional. No total-process/VRAM cap is claimed.

The final cache-validity regression passed 18/18 gates, including a complete
458,752-texel refill after an edit and zero settled refills. At 640x360 the settled forest
retains 46,393 props (40,918 trees and 5,475 rocks): 46,361 support records reused,
32 incomplete footprints retried, zero draw overflow. The independent sampled
center-support error is 0.779 mm maximum; footprint extrema remain sampled.
Stationary rotations reuse light profiles; translations of 0.01, 512 and 32,768 m
rebuild both local components. Weather rebuilds optical components only; sun,
edits and cloud/shadow toggles rebuild all four. Rebases invalidate local keys.

## Rejected experiments

The 64-step guided a-trous trial passed only 3/8 approximate scene gates at
640x360 (120 measured frames after 180 warmup). Forest, thin stratus and in-cloud
views passed, but coast, cloud edges, tall cumulus, orbit and nightward terminator
failed. Worst-crop inspection showed softened structure and displaced cloud
boundaries. The terminator is especially sensitive to finite view quadrature;
spatial smoothing does not recover the missing ray samples.

| View | Full/128 whole GPU p50 ms | 64 + filter p50 ms | Filter alone p50 ms | Quality |
|---|---:|---:|---:|---|
| Forest | 21.62 | 19.85 | 0.04 | pass |
| Coast | 20.37 | 18.21 | 0.04 | fail |
| Clouds | 20.69 | 17.49 | 0.06 | fail |
| Tall cumulus | 33.09 | 25.55 | 0.07 | fail |
| Thin stratus | 24.84 | 21.55 | 0.06 | pass |
| In cloud | 26.64 | 22.07 | 0.08 | pass |
| Orbit | 23.23 | 17.77 | 0.04 | fail |
| Nightward terminator | 51.32 | 34.35 | 0.06 | fail |

These are exploratory single-round results, not the final interleaved 1080p
qualification. The trial's shader, pipelines, uniforms and diagnostic option
were removed from the retained implementation. Its immutable browser snapshot,
source patch, raw timing and HDR/display comparisons remain under
`evidence/local/performance-integrated/atrous64/`, `candidate-filter-web/` and
`atrous-trial.patch`. No motion pass is claimed for this already-rejected trial.

A scalar-only terrain-noise helper/hoisted hash pilot did not establish a
consistent benefit and was removed. Its early comparison also used the stale
starting binary, so no performance conclusion is drawn from that comparison.
Shared light evaluation and exact cache reuse are the retained alternatives.

## Animated 1080p measurements

RTX 3080, driver 621.01, private headless Edge/BrowserWebGpu, full/128 clouds,
history off, scenery/shadows on, original density/ranges/materials. Two rounds
in baseline/candidate then candidate/baseline order; 360 warmup + 300 measured
frames per scene and arm (600 measured samples pooled). Source identities,
settings, per-stage/CPU distributions, startup pipelines, work counters and
per-round GPU telemetry are in
`evidence/integrated-performance/animated-1080.json` (development repository only).

| Scene | Source baseline GPU span p50/p95/p99 ms | Retained candidate p50/p95/p99 ms |
|---|---:|---:|
| Forest | 74.29 / 78.86 / 85.62 | 62.97 / 69.92 / 70.58 |
| Coast | 66.15 / 72.63 / 73.69 | 57.79 / 65.76 / 66.60 |
| Clouds | 92.25 / 96.23 / 97.63 | 84.15 / 90.98 / 92.35 |

Both arms became faster in the second round. Pooled quantiles of these separate
distributions are not a substitute for the paired results:

| Scene | Round 0 baseline → candidate p50 ms | Round 1 baseline → candidate p50 ms | Paired reduction |
|---|---:|---:|---:|
| Forest | 76.92 → 68.33 | 68.91 → 60.14 | 11.2–12.7% |
| Coast | 70.97 → 64.07 | 63.24 → 55.56 | 9.7–12.1% |
| Clouds | 94.30 → 89.03 | 85.44 → 79.57 | 5.6–6.9% |

Every measured GPU frame remains over 16.67 ms. CPU encoding is about
0.20/0.30/0.40 ms p50/p95/p99 in both arms; scheduling is GPU-owned (the separate
CPU scheduling field is zero). Fence-paced completion intervals, including the
test harness metadata round trip, are:

| Scene | Baseline pacing p50/p95/p99 ms | Candidate pacing p50/p95/p99 ms |
|---|---:|---:|
| Forest | 79.0 / 85.4 / 91.6 | 69.9 / 76.5 / 77.8 |
| Coast | 72.8 / 79.9 / 81.1 | 64.4 / 72.3 / 73.4 |
| Clouds | 97.4 / 102.6 / 105.3 | 90.2 / 97.7 / 99.7 |

Browser readiness was 27.17/28.34 seconds for the baseline and 26.25/28.13 for
the candidate. No meaningful startup gain is claimed. Per-pipeline asynchronous
compile durations overlap and must not be summed into wall time. Coast cold-cut
warmup maxima were 158.9/183.6 ms baseline and 140.4/170.4 ms candidate; bounded
generation and height-cache refill spikes are still visible. Warmup is recorded,
not discarded as a nonexistent product cost.

In round 0 forest, combined height/profile/caster selection fell from 14.54 ms
to about 8.4 ms, and support preparation from 2.14 to 0.57 ms. All 46,920 caster
stream entries and all twelve mesh/card draw counts matched. Six-cascade raster
work is now separately timed; it is not a leading cost in these scenes, and no
cascade, caster window, alpha material or dither sampling was removed. Small
changes in unrelated stages are not attributed to the implementation.

The remaining candidate pooled stage medians illustrate the limit: cloud view
integration costs 21.66 ms forest, 20.35 coast and 50.38 clouds; terrain shading
costs 13.84/16.65/12.07 ms. Forest prop shading costs 6.60 ms. Global/local animated
light profiles still cost roughly 2.5–2.7/5.3–5.5 ms, and world rasterization,
water, terrain scheduling and full-window prop/caster scans remain present.
Independent stage medians do not add to a whole-frame percentile. Reducing those
remaining costs requires more work without hiding density, silhouette or lighting
error; this pass does not establish a 60-fps renderer.

## Frozen, moving-camera and moving-sun work

Separate 1080p workload runs use 240 warmup and 300 measured frames per arm.
The first table reports baseline → candidate GPU-span p50/p95/p99, all in ms.
Complete first-order results (`evidence/integrated-performance/workloads-1080.json`, development repository only)
include work counters and settings.

| Workload | Baseline p50/p95/p99 | Candidate p50/p95/p99 |
|---|---:|---:|
| Frozen forest | 64.50 / 67.51 / 69.09 | 55.64 / 57.66 / 58.57 |
| Frozen clouds | 78.29 / 82.46 / 89.75 | 74.54 / 76.57 / 77.13 |
| Moving forest, 50 m/s | 77.26 / 82.27 / 86.14 | 75.46 / 79.34 / 82.48 |
| Moving clouds, 50 m/s | 87.84 / 90.67 / 92.31 | 86.89 / 88.93 / 89.87 |
| Moving sun, forest | 68.90 / 71.56 / 73.25 | 67.78 / 69.82 / 70.19 |
| Moving sun, clouds | 85.42 / 87.95 / 89.19 | 87.05 / 89.26 / 90.37 |

The small moving-camera gains and moving-sun cloud regression in that run are
not hidden. The later reversed-order run (`evidence/integrated-performance/workloads-reversed-1080.json`, development repository only)
gave moving forest 79.62 → 58.65, moving clouds 94.07 → 67.19, moving-sun forest
71.89 → 50.84 and moving-sun clouds 92.73 → 66.54 ms p50. However, unchanged
raster/shading stages accelerated too and total reported VRAM differed by about
250 MiB. Those larger differences cannot be attributed cleanly to this patch.
These measurements do not establish a reliable general moving-workload speedup
or an isolated moving-sun regression. Raw distributions remain available; an
uncontended dedicated run would be needed for a narrower causal estimate.

The measured work explains why movement cannot inherit the frozen saving:
translation rebuilds both local light components and all required prop support.
The last 50 m/s frame refilled 256 height texels; frozen frames refilled zero.
Moving sun rebuilt all four profile components. All audited scenery/caster
overflow counts were zero. The first forest case reused 46,361 support records;
the moving forest case refreshed all 45,839 eligible records instead. Nothing
was hidden to preserve a stationary benchmark gain.

## Browser cadence at the shipped queue depth

The application buffers two UI frame requests by default. A separate rAF loop
uses that unchanged queue depth, 180 warmup and 180 accepted measured frames
per round/scene, with baseline/candidate then candidate/baseline ordering.
There are 360 GPU samples and 358 consecutive accepted-frame intervals per arm
and scene. Default-queue results (`evidence/integrated-performance/default-pacing-1080.json`, development repository only)
include every attempt, worker completion and GPU stage; the additional
queue-one control (`evidence/integrated-performance/pacing-1080.json`, development repository only) is kept
separate from product-default cadence.

| Moving scene | Baseline accepted interval p50/p95/p99 ms | Candidate p50/p95/p99 ms |
|---|---:|---:|
| Forest | 83.3 / 91.8 / 100.0 | 75.1 / 83.4 / 91.7 |
| Clouds | 91.7 / 108.2 / 108.4 | 91.7 / 100.0 / 100.1 |

Animation callbacks arrive at roughly 8.3 ms on this setup, but most attempts
meet backpressure. They are not new rendered frames. Forest cadence improved
in this finite run; the cloud median did not. Queue-one cloud results varied
in the opposite direction in one round, reinforcing the shared-device caveat.
Worker submit-to-completion medians at queue two were 81.5 → 77.2 ms forest and
91.2 → 92.4 ms clouds. Those worker durations exclude time waiting in the UI
request queue and are not input latency or physical scanout measurements.

## Build provenance

The build script emits the exact source bytes it compiled; a separate compile-time
byte comparison against `include_str!` sources rejects stale generated WGSL.
The Windows and Vercel build entry points provide a SHA-256 key over shader inputs
and the build script as an explicit Cargo environment dependency. The key is
embedded in the actual WASM pipeline registry. `Verify-Explorer-Build.mjs` checks
it against current inputs before a build manifest is written or a site packaged,
and records the registry's own SHA-256. Packaging an old/unversioned or mismatched
binary fails instead of writing fresh source hashes around it.

The identity record (`evidence/integrated-performance/build-identities.json`, development repository only)
contains all three manifests and extracted height-boundary declarations. The
provenance regression (`evidence/integrated-performance/provenance-test.json`, development repository only)
accepts the current binary, rejects the original unversioned binary, and rejects
changed source content even after restoring its timestamp. The source-baseline
timing-only patch (`evidence/integrated-performance/baseline-timing.patch`, development repository only)
records the complete deviation from the starting commit used for timing.

## Static quality evidence

The final build passes 12/12 exact comparisons at 640x360 after 240 warmup frames:
forest, conifers, canopy, rocky ground, coast, rough ground, clouds, tall cumulus,
thin stratus, in-cloud, orbit and nightward terminator. Every occupied region has
zero HDR/display, transmission, position and normal/material difference, with
unchanged opaque coverage. Full region metrics (`evidence/integrated-performance/static-quality.json`, development repository only)
and failed a-trous metrics (`evidence/integrated-performance/atrous-quality.json`, development repository only)
are retained. This proves those finite comparisons, not universal equivalence.

Each image below is source baseline / retained candidate / absolute difference ×8.
The original mismatched binary is not used in these quality comparisons.

!Forest exact comparison (`evidence/integrated-performance/images/forest-exact.png`, development repository only)
!Tall cloud exact comparison (`evidence/integrated-performance/images/tall-exact.png`, development repository only)
!Nightward terminator exact comparison (`evidence/integrated-performance/images/terminator-night-exact.png`, development repository only)

The rejected 64-step/filter crops use the same ordering. The right-hand difference
is deliberately amplified; it is not a rendered lighting result.

!Rejected tall-cloud filter crop (`evidence/integrated-performance/images/tall-atrous-rejected.png`, development repository only)
!Rejected terminator filter crop (`evidence/integrated-performance/images/terminator-night-atrous-rejected.png`, development repository only)

## Motion and cold arrivals

Matched 480x270 sequences record 24 consecutive frames per path, with all six
buffers read after each frame. These captures are quality evidence, **not timed
performance runs**. Motion metrics and cold-arrival classification (`evidence/integrated-performance/motion-quality.json`, development repository only)
retain every exact failure rather than relabeling it as a pixel match.

| Sequence | Exact frames / compared |
|---|---:|
| Slow translation (0.05 m/frame) | 24/24 |
| Rapid translation (150 m/frame) | 24/24 |
| Full rotation | 24/24 |
| Translation then stop | 24/24 |
| 5-fps elapsed-time stepping and translation | 24/24 |
| Origin rebase | 24/24 |
| 1,600 m/frame cache-border jumps | 13/24 |
| Cold forest → coast cut | 14/24 |
| Descent through clouds / tall clouds / nightward orbit | 72/72 |
| Moving sun in clouds / tall clouds / nightward orbit | 72/72 |

The owner explicitly clarified that late-arriving dithered trees can vary; cold
admission is not required to be pixel-identical. All changed geometry pixels in
the border/cut exceptions belong to a prop in at least one arm: **zero terrain
geometry differences outside props**. The largest one-frame border difference
contains 4,722 changed prop pixels (2,825 opaque-coverage changes); cold-cut
differences after first admission are tens of prop pixels. Several other exact
failures are one half-float lighting unit with zero or one display-code change.
These are retained as visible arrival/dither variation, assessed with population,
contact, elapsed fade, recovery and overflow regressions instead of relaxing
the settled-image or cloud-structure gates. No claim of exact cold admission
ordering is made. The unchanged GPU placement budget uses atomic tickets.

No reconstruction/history is retained, and all 144 cloud-motion frames match.
Inspection of stops, turns, descent, low sun and the terminator found no new
blur/trail or boundary bleed in these sequences. This is finite evidence;
existing impostor depth, sampled footprint and finite cloud quadrature limits
still apply. UI statistics are asynchronously sampled; sequence snapshots from
the original capture run must not be treated as fresh per-frame GPU counters.
The harness now also reads explicit `audit_progress` in sequence mode.

!Stopped forest comparison (`evidence/integrated-performance/images/stop-exact.png`, development repository only)
!Cold border arrival variation (`evidence/integrated-performance/images/border-arrival-variation.png`, development repository only)
!Cold cut arrival variation (`evidence/integrated-performance/images/cut-arrival-variation.png`, development repository only)
!Moving low-sun cloud comparison (`evidence/integrated-performance/images/low-sun-exact.png`, development repository only)

## Resumed regression checks

The resumed validation record (`evidence/integrated-performance/resumed-validation.json`, development repository only)
keeps commands, tool hashes, the tested build identity, raw-report hashes and
compact results. These are correctness checks, not additional performance runs.

All six analytic cloud-shell poses pass, including 11,973 two-interval rays
just inside the shell. Across 5,529,600 pixels, none exceeds the existing 0.002
transmittance-error threshold; the maximum is 0.000557. The default LOD and
shoreline-detail gates also pass. The grazing-sun sweep passes 21/21 gates,
exercising 470 partially shadowed reference samples. Its largest p99 excess
change over the reference is 0.05785 against the existing 0.12 limit.

The three dayward and three nightward terminator poses finish with finite cloud
values in normal, unlit and dense-view-quadrature diagnostics. These diagnostics
do not imply an exact lighting solution. Separate 160x90 direct-sun comparisons
preserve cloud transmittance exactly in all three nightward poses. Occupied-pixel
HDR mean/p99 errors are 0.05285/0.26852 (nightward), 0.02558/0.21241 (cumulus),
and 0.01598/0.14369 (low orbit). Filtered profiles, terrain occlusion and finite
quadrature remain approximations; the direct-sun diagnostic omits terrain
occlusion. These are reference errors, distinct from the exact source-baseline
comparisons above. Normal/unlit and density-reference captures were inspected.

!Retained profiles versus direct sunlight reference (`evidence/integrated-performance/images/terminator-sun-reference.png`, development repository only)

Prop-shadow stability passes 8/8 translation cases and terrain-shadow stability
passes 7/7 altitude/translation cases using the existing tolerances. The terrain
test retains 109 shadowed receivers and zero unresolved queries in every pose;
its largest single visibility deviation is 0.01808, below the 0.025 limit.
The eight clear/cloudy night-water cases all produce black output (maximum
display code zero). These are finite regression gates, not exact world-space
visibility guarantees.

Native Vulkan validation passes on the RTX 3080: 4,096 toy-bound samples, zero
bound violation after the declared numerical allowance, and 6,618 visibility
rays with zero false misses, invalid hits or overflow. The 24 unresolved rays
remain explicitly reported. The current native explorer also compiles and
renders 30 warmup plus five checked frames with no timing errors or topology/
scenery overflow. Its short run validates the backend and shader/resource
compatibility; it is not evidence of browser throughput or full settling.

The local packaged-site browser test passes all ten HTTP/MIME/WASM asset checks,
renders through BrowserWebGpu, and verifies the shipped quality controls and
defaults. Its forest contains 40,918 trees and 5,475 rocks with zero overflow.
The package embeds the same final WASM SHA-256 recorded in the build identities.
Native and packaged images were inspected; no source rebuild was needed during
this resumed validation.

The cold-cut recovery run (`evidence/integrated-performance/cold-recovery.json`, development repository only)
compares 24 consecutive frames plus a recovered endpoint after 240 further
frames. Fifteen sequence frames and the endpoint match exactly across all six
buffers; nine transient frames differ. At most 56 geometry pixels differ, all
on props, with zero changed terrain pixels outside props. Fresh GPU progress
advances once per captured frame in both arms. Both recover to 2,238 fully
morphed patches, no pending samples/catch-up/overflow, and the same 25,308 trees
and 7,277 rocks. Sampled center-support error is at most 0.898 mm in each arm.
All eight recovery gates pass; these explicit readbacks are excluded from timing
claims. The scene and close differences were inspected.

!Cold-cut recovered endpoint, exact (`evidence/integrated-performance/images/cold-cut-recovered.png`, development repository only)

## Reproduction

Run from `<repo>`. Keep GPU runs serial. The two
immutable web snapshots named below are local evidence, not live deployments.
The source baseline is the starting commit plus only the linked three-line
CPU timing patch. When rebuilding that archived source, use a fresh Cargo target
directory; reusing `target/` between restored source copies reproduced the stale
build-script problem. The retained build wrapper supplies its content key.

```powershell
./tools/Check.ps1
./tools/Build-Explorer.ps1
node tools/Verify-Explorer-Build.mjs
node tools/Measure-Integrated.mjs --output evidence/local/performance-repeat --baseline evidence/local/performance-integrated/source-baseline-web --candidate evidence/local/performance-integrated/final-web --rounds 2 --warmup 360 --frames 300 --audit
python tools/Summarize-Integrated.py evidence/local/performance-repeat/report.json
node tools/Measure-Integrated.mjs --output evidence/local/quality-repeat --baseline evidence/local/performance-integrated/source-baseline-web --candidate evidence/local/performance-integrated/final-web --rounds 1 --width 640 --height 360 --warmup 240 --frames 1 --views forest,conifers,canopy,rocky,coast,rough,clouds,tall,thin,inside,orbit,terminator-night --modes frozen --capture
python tools/Compare-Integrated.py evidence/local/quality-repeat
node tools/Test-Integrated-Reuse.mjs evidence/local/reuse-repeat
node tools/Test-Arrival-Timing.mjs evidence/local/arrival-repeat
node tools/Test-Scenery-Turn.mjs evidence/local/turn-repeat
node tools/Test-Visibility-Weather.mjs evidence/local/visibility-repeat
node tools/Test-Cloud-Shell.mjs evidence/local/shell-repeat
node tools/Test-Cloud-Sun-Grazing.mjs evidence/local/grazing-repeat
$env:SOLAR_TERM_WIDTH = '640'
node tools/Test-Cloud-Terminator.mjs evidence/local/terminator-day-repeat
node tools/Test-Cloud-Terminator.mjs evidence/local/terminator-night-repeat --nightward
$env:SOLAR_TERM_WIDTH = '160'
node tools/Test-Cloud-Terminator.mjs evidence/local/sun-reference-repeat --nightward --sun-reference
node tools/Test-Shadow-Stability.mjs evidence/local/prop-shadow-repeat
node tools/Test-Terrain-Shadow-Stability.mjs evidence/local/terrain-shadow-repeat
node tools/Test-Explorer-Water-Night.mjs evidence/local/night-repeat
cargo +1.87.0 run -p solar-probe --bin solar-gpu-probe --release --locked
cargo +1.87.0 run -p solar-explorer --release --locked -- --view clouds --width 640 --height 360 --frames 5 --warmup 30 --output evidence/local/native-repeat
node tools/Package-Explorer.mjs
node tools/Test-Explorer-Deployment.mjs --local evidence/local/package-repeat
```

Each measurement JSON saves its exact command. Motion uses `--sequence` with
`slow,fast,turn,stop,lowfps,border,rebase,cut,descent,sun`; optional `--settle 240`
adds recovered endpoint captures/audits. Sequence captures include explicit
terrain-progress readbacks; ordinary timed frames do not. rAF runs use `--raf`
and `--queue-depth 2` for the shipped worker queue (or `1` for the isolated
comparison). Sampled UI statistics and fresh audit counters are distinct.

To repeat the exact rejected-filter measurement, use the saved
`candidate-filter-web/` as both `--baseline` and `--candidate`, with
`--candidate-settings '{"cloud_steps":64,"cloud_diagnostic":512}'`. Its manifest
records the actual experimental binary and inputs. The diagnostic does not exist
in the retained build. The archived trial patch (`evidence/integrated-performance/atrous-trial.patch`, development repository only)
shows the implementation against the starting commit and includes subsequent
height-refill instrumentation; rebuilding that patch is not a byte-identical
recreation of the earlier trial binary. All raw HDR buffers,
per-frame rows, startup logs and private browser profiles remain under
`evidence/local/performance-integrated/`; compact review evidence is under
`evidence/integrated-performance/`. Qualification was completed locally before
the owner authorized committing and pushing this pass.

# Water, clouds and terrain transition checkpoint

25 October 2026, on the single-skin explorer; the field renderer remains
archived at `fe0c78a`. This checkpoint implements the water and cloud controls
and corrects night-water emission. It does **not** complete the expanded scenery
request or certify one-pixel silhouettes at arbitrary travel speeds.

## Water interface and night lighting

The geometric ocean and near-plane cap classify each pixel's starting medium.
Reflection, transmission, bottom lighting, foam, underwater scattering and cloud
fill now respond to the same daylight function as the sky. Previously some
fallback blue colours were independent of incident light: the submerged view
brightened around Snell's window even when the above-water sky was black.

`Test-Explorer-Water-Night.mjs` renders six camera heights from −8 to +8 metres,
including ±3 cm, with the sun behind the planet, then repeats ±1 metre with
clouds enabled. All eight captures contain zero nonblack RGB display codes.
This tests this no-moon/no-artificial-light scene, not a general illumination
model. Daylight interface tests cover flat water, roll, four wave epochs and
rebasing. Flat-water classification has zero disagreements with the independent
f64 sphere/near-plane reference. Wave front/back/cap classification is consistent
and finite. Rebasing changes mean display codes by 0.0264; isolated boundary
pixels differ by up to 141 codes, so this is not bit-identical image stability.

Water remains bounded GPU compute: aperiodic wave synthesis/cache, a damped
ripple PDE, advected foam and local bed sampling. The wider foam history blend
uses a radial 20–88 m interval and initializes entering cells to the global
equilibrium, avoiding a square patch appearing empty and then filling in.
Details, finite capacities and approximation limits are in [SINGLE-SKIN.md](SINGLE-SKIN.md).

!Daylight per-pixel water interface (`evidence/single-skin-water-clouds/water-interface-day.png`, development repository only)

## Cloud controls and measurements

The collapsible Clouds & weather section controls coverage, cloud-type mix,
wind, advection speed, evolution, turbulence, render dimensions and sample count.
Default: **full resolution, 64 samples, no cloud history**. Full/half/quarter
allocation changes passed the actual browser UI handlers. Rate changes and
pausing preserve phase; snapshot restoration preserves the saved phase as well.
The three fixed-camera image comparisons were byte-identical.

A guttered six-face weather atlas and a nearby 3D density/light cache are built
on the GPU. Their construction is included in cloud timings. Distinct thin
stratus and taller cumulus profiles use broad cluster variation and restrained
internal warping. Ray bins follow the cloud shell and are truncated at geometry;
changing terrain depth no longer redistributes every cloud sample along a ray.

RTX 3080, driver 621.01, Windows, Edge 156.0.4314.42, BrowserWebGpu,
1920×1080, 300 measured frames per arm, frozen camera/epoch, history off:

| View | 64: total p50/p95/p99 ms | 128: total p50/p95/p99 ms | 64 vs 128 mean / p99 display codes |
|---|---:|---:|---:|
| Mid-distance natural mix | 11.54 / 19.90 / 22.11 | 27.39 / 32.80 / 35.53 | 0.192 / 2 |
| Above cumulus | 11.85 / 13.26 / 13.73 | 12.89 / 20.55 / 23.32 | 0.283 / 3 |
| Above stratus | 4.54 / 9.94 / 10.09 | 7.89 / 11.59 / 11.80 | 0.110 / 1 |
| Inside cumulus | 5.65 / 10.60 / 10.87 | 10.90 / 12.91 / 13.21 | 0.145 / 3 |

The corresponding 64-sample cloud-stage medians are 7.99, 4.96, 1.80 and
2.68 ms. These comparisons pass the existing aggregate display-difference gate,
but **do not pass a general visual-quality claim**. Near clouds still show
coherent integration bands; mid/far weather structure can remain too apparent.
128 reduces some banding and is selectable, but is too costly as a universal
default in this measured matrix. Workstation GPU contention can affect tails.
No unconditional 1080p/60 fps claim is made.

!Current middle-distance distribution (`evidence/single-skin-water-clouds/clouds-mid.png`, development repository only)

The near-cloud capture (`evidence/single-skin-water-clouds/clouds-near-banding-limit.png`, development repository only)
deliberately preserves the remaining banding as evidence, rather than hiding it
with temporal accumulation. Cloud history remains experimental and its old wind
reprojection is not qualified for the new shear/evolution model. Reactive flight
wakes and more realistic cloud lighting remain outstanding.

## Terrain retargeting and finite resources

The terrain now limits carried morph velocity to a monotone cubic segment.
When a new target reverses direction, the prior velocity is discarded instead
of producing a hill that rises past the target and then falls. The position at
retarget remains the actual rendered position; velocity continuity is not
claimed when the derivative is clamped. Parent interpolation spreads the
coarse/fine residual across six edge cells. Shared vertices still have one
owner and conforming indices. This changes the filtered approximation, not the
canonical radial heightfield. Offscreen boxes include the parent quadrant hull.

Fast-stop probes retain closed topology and concurrent publications. At a fixed
stopped camera, p99 view-ray depth change within 100 metres was:

| Motion | First eight frames | Next eight | Later comparisons |
|---|---:|---:|---:|
| 400 m travel | 1.10 projected px | 0 | 0 |
| 100 km in five seconds | 63.43 projected px | 4.14 | 0 |
| 2 Mm rapid descent | 1.29 projected px | 0 | 0 |

These are ray-depth changes, not silhouette displacement certificates. The
extreme flight still visibly refines. The 20-case stress suite passed face
boundaries/corners, poles, grazing views, cold teleports, descent, rebasing,
seed/body/sector/edit cuts and six-patch/zero-optional-generation exhaustion.
Settled 360-degree head turns at ground, highlands and coast produced zero new publications. The fixed-camera 4096 m origin shift had zero changed coverage and zero position difference among 1,134,655 sampled pixels within 500 m. Forward/reverse travel, face crossing and descent were recorded without terrain TAA or cloud history. Invalid settings left the prior state unchanged; device recreation rendered
again. The rAF test submitted 199 of 300 callbacks in 3.44 seconds; callback
frequency and queued completion are not physical display scanout measurements.

Two stationary cold-cut traces with only eight generation jobs per frame each
recorded 240 frames and 64 nearby morph probes per frame. They observed zero
endpoint-box overshoot and no reappearing target patch keys (55 and 58
publications). These sample traces are not an exhaustive motion proof.
Saved motion: forward/reverse (`evidence/single-skin-water-clouds/ground-forward-reverse.webm`, development repository only)
and full-frame descent (`evidence/single-skin-water-clouds/descent-full.webm`, development repository only).

Controlled GPU payload at full 1080p is **685,217,568 bytes**, fixed independently
of distance travelled. Driver memory, pipeline compilation and capture staging
are additional. The six roots retain complete coverage under exhaustion.

## Native validation and reproduction

`tools/Check.ps1` passed 38 tests, formatting, Clippy, both WASM targets and Naga
validation. The native **Vulkan** rough-view probe, 360 warmup plus 300 measured
full frames, measured p50/p95/p99 **9.759 / 12.664 / 13.003 ms**. First completed
image was 3.97 seconds with an uncontrolled driver cache. Native results are
separate from the browser measurements above. Native geometry was complete,
balanced and closed with no unequal shared samples or overflow; maximum sampled
height error against the independent filtered f64 reference was 0.00199 m.
This does not establish dense silhouette accuracy; the conservative scheduling
bound shortfall is still about 170 pixels.

```powershell
./tools/Build-Explorer.ps1
./tools/Check.ps1
node tools/Test-Explorer-Water-Night.mjs evidence/local/water-night-final
node tools/Test-Explorer-Water-Interface.mjs evidence/local/water-interface-night-light
node tools/Test-Explorer-Cloud-Quality.mjs evidence/local/cloud-controls-final
node tools/Test-Explorer-Concurrent.mjs evidence/local/morph-monotone-final
node tools/Test-Explorer-Stress.mjs evidence/local/water-cloud-stress-final
node tools/Test-Explorer-Head-Turn.mjs evidence/local/water-cloud-head-turn-final
node tools/Test-Explorer-Motion.mjs evidence/local/water-cloud-motion-final
node tools/Test-Explorer-Lod-Trace.mjs evidence/local/morph-trace-final
cargo +1.87.0 run --release -p solar-explorer -- --view rough --frames 300 --warmup 360 --frozen --audit --output evidence/local/water-cloud-native-final
node tools/Summarize-Explorer-Water-Clouds.mjs
```

Reuse the preview on port 5198; all test browsers are private. Run GPU probes
sequentially. Compact source-labelled evidence (`evidence/single-skin-water-clouds.json`, development repository only)
retains stage distributions, settings, audits and raw-report hashes. The water
interface report predates the cloud-clock/terrain-bound additions and is labelled
accordingly; its water/lighting source is unchanged.
The publication build only trims trailing blank lines after validation; run
manifests retain the exact tested source and binary identities.

Outstanding expanded work: varied geology/materials, GPU-procedural trees and
rocks/impostors, Rapier player physics, cloud flight response, dense silhouette
qualification and the remaining cloud appearance defects. Astronomical data
integration remains a future source bridge. All shadows stay deferred to the
next pass. Nothing was pushed or deployed.

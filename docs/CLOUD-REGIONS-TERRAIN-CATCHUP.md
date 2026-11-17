# Regional clouds and terrain catch-up

Local follow-up to `8455fc9`, 25 October 2026. The single-skin explorer remains
the active line of work; the archived field renderer is untouched.

## Changes

Clouds now default to full resolution and 128 ray samples. A single cloud body
combines planetary weather, mesoscale dry slots and smaller cloud groups;
independently blended stratus no longer fills every cumulus gap. A separate
393 km procedural activity field controls both broad weather warp and regional
cloud warp. Its smooth threshold includes exactly zero, so calm regions really
have no domain warp. The activity is stored in the existing weather atlas;
cloud tops are derived after interpolation. There is no new texture allocation.
Wind and evolution still animate the field continuously and pause/restore exactly.

The vertical envelope is analytically averaged across each ray bin. This reduces
thin-envelope undersampling; density shape and illumination still use finite
quadrature. Cloud history stays off. The 128/256 comparison is a convergence
check, not proof of an exact radiance solution or a claim that all grazing
banding has disappeared. The local density volume remains a finite 256 m by
128 m approximation. Some close cloud formations still look too smooth.

Terrain detail has a **LOD distance** slider from 0.5x to 4x, default **2x**.
It scales projected-error selection distance, the stable near region and
horizontal prediction reach. Changing it wakes the GPU selector without
discarding terrain caches. Snapshots include it; older snapshots receive the
new default. Resource pools and per-frame generation limits are unchanged.
Consequently 2x requests twice the detail range, but cannot guarantee that range
when the fixed patch pool is exhausted.

Terrain shading now evaluates the heightfield gradient at the pixel footprint,
independent of patch LOD or its normal blend. A compensated radial projection
keeps the procedural coordinates on the canonical sphere; subtracting an
interpolated height omitted coarse-triangle chord sag and moved the texture
coordinates. Actual geometry movement remains visible and separately captured.

Ridge filtering now retains an estimated mean of 0.25 instead of dropping the
whole positive-mean ridge band. For ridge value r in [-0.45, 0.55], the filtered
value is w*r + (1-w)*0.25. Its range stays within the original range and the
omitted error is at most 0.70*(1-w)*amplitude, inside the existing looser bound.
Spatial derivatives are unchanged. The fully resolved heightfield is unchanged.
This is a declared mean estimate, not an exact statistical integration. In 8192
equal-area sample directions, the level 2 mean refinement lift falls from
184.88 m to 0.70 m; at level 7 it falls from 83.00 m to -0.23 m. Local residuals
and curvature still require genuine geometry movement.

Descent prediction now applies the flight controller's ground clamp. The old
70%-of-altitude travel cap prevented prediction from reaching the ground until
the final approach. At extreme frame-to-frame travel, up to four desired-cut
generations can be prepared before one publication. The previous complete
surface remains active and the new morph samples that actual source. Cumulative
union growth is reserved across the group; admission, generation, memory and
the 0.14 second morph remain bounded. This reduces intermediate publications;
it does not make arbitrary cold cuts instantly detailed.
Trajectory reuse also requires membership in the actual published cut. A
cached desired leaf that has not been displayed must sample its current source
surface instead of reusing a coincident key's older coarse trajectory.

## Evidence and limitations

Raw BrowserWebGpu reports, source/WASM manifests and captures are under
`evidence/local/`. The compact report is `evidence/cloud-terrain-followup.json`.
Native Vulkan timing is separate from browser timing. All captures use native
1080p, no terrain temporal AA and no cloud history. The workstation is shared.

The independent normal audit uses f64 central differences of `Skin::height`,
not the shader derivative implementation. Across ground/rough and four stages
of cold refinement, p99 angular error is below 0.063 degrees; maximum is below
0.074 degrees. This validates the shading calculation, not geometry silhouettes.

The abrupt descent fixture travels about 807 km/s from 1600 km altitude, then
stops 12 m over canonical terrain. With a fresh controlled cache, the first
stopped interval changes from p99 330.81 projected depth pixels to zero; a small
fraction of pixels still change (maximum 3.55 m). A mixed-history run has later
residual movement. The sideways 807 km/s stop still has substantial catch-up,
including GPU camera safety lift. It is NOT qualified as imperceptible, nor is
the pillar issue declared universally solved. The reported depth deltas compare
fixed input cameras; safety lift can move the rendered camera and contributes
to those deltas. They are not silhouette displacement certificates.

The one-pixel dense geometry objective and universal 1080p/60 fps remain unmet.
Cloud cost at 128 samples can exceed the whole frame budget in mid-distance
views. No automatic downsampling has been introduced. All planetary/terrain/
tree/rock/cloud shadows remain deferred to the next pass.

### Measurements

RTX 3080, BrowserWebGpu, 1920 x 1080, full-resolution 128-sample clouds,
240 warmup plus 300 measured frames per view. Entries are p50 / p95 / p99
milliseconds. GPU workloads ran sequentially on the shared workstation.

| View | Whole GPU frame | Cloud pass |
| --- | --- | --- |
| Orbit | 11.642 / 14.523 / 14.893 | 10.197 / 12.997 / 13.536 |
| Mid distance | 27.435 / 35.172 / 37.091 | 23.157 / 30.561 / 31.641 |
| Cumulus | 11.095 / 23.412 / 24.928 | 7.620 / 17.341 / 18.132 |
| Stratus | 5.691 / 6.952 / 7.332 | 2.854 / 4.387 / 4.636 |
| Inside | 7.695 / 8.871 / 9.201 | 5.498 / 6.972 / 7.214 |

The compact JSON separates scheduling, generation, topology, rasterization,
shading, water, clouds, atmosphere and presentation. The cloud qualification
predates the final terrain trajectory-reuse guard; its exact source manifest
is retained. That guard does not change cloud code. Final terrain stress,
extreme motion and native qualification have their own manifests/results.
The final native Vulkan rough view (driver 621.01), 360 warmup plus 300 measured
frames, is **24.711 / 27.945 / 51.548 ms** for the whole GPU frame. It retains
2238 patches, has zero topology overflow/boundary edges, and reports a
110.64-pixel conservative error-bound shortfall. Native results are not used
as browser performance evidence.

The DOM LOD slider test increases settled orbit patches from 192 at 1x to 246
at 2x and 417 at 4x. Terrain-only whole-frame medians are 0.681, 0.692 and
0.705 ms, respectively. These orbit costs do not predict near-ground costs.
Controlled GPU payload stays 685,217,568 bytes at every setting, excluding
driver and diagnostic staging. Returning to 1x retains 246 patches because of
hysteresis. Invalid values are rejected without changing the setting.

The regional cloud mask has exactly zero warp in 40.10% of weather atlas
texels and activity above 0.8 in 28.72%. These are cube texel fractions, not
equal-area coverage. Pause and fixed-epoch repeat captures match bit for bit;
120 seconds of evolution changes the image. All captured cloud transmittance
values are finite. The 128/256 image difference has p99 at most three display
codes across these views, with localized larger differences; the shared finite
cache and coherent banding remain limitations of both evaluations.

`tools/Check.ps1` passes all 38 Rust tests, formatting, Clippy, both WASM target
checks and shader validation. Browser stress covers 20 cases including cold
cuts, face edges/corners, forward/reverse LOD, origin rebasing, teleports,
exhausted six-patch/zero-generation pools and device destruction/recreation.
Night underwater captures at eight poses remain black with a black unlit sky.
Real-time extreme-stop clips are saved alongside the still evidence; they use
requestAnimationFrame without temporal AA/history. Their recording and capture
overhead is excluded from the fixed-frame GPU tables above.

Final mixed-history stop intervals at frames 8/16/32/64/120 have projected
depth p99 values **741.09 / 4343.17 / 54.55 / 7.51 / 0 pixels** for sideways
travel and **0 / 0 / 12.56 / 0 / 0** for descent. Sideways safety lift falls
from 206.14 m at the stop to 20.12 m at frame 8 and zero at frame 16. The
half-second settling gate fails; closed topology and concurrent publication
gates pass. These failures are preserved in the compact report.

View the sideways stop recording (`evidence/cloud-terrain-followup/sideways.webm`, development repository only),
descent recording (`evidence/cloud-terrain-followup/descent.webm`, development repository only),
orbit clouds (`evidence/cloud-terrain-followup/orbit.png`, development repository only) and
near cloud sample, including residual bands (`evidence/cloud-terrain-followup/cumulus.png`, development repository only).
Recordings include still-capture pauses between 60-frame blocks; the clip
duration is not a frame-time benchmark.

## Reproduce

```powershell
./tools/Build-Explorer.ps1
./tools/Check.ps1
node tools/Test-Explorer-Concurrent.mjs evidence/local/terrain-catchup-reuse-final
node tools/Test-Explorer-Extreme-Motion.mjs evidence/local/extreme-motion-reuse-final
node tools/Test-Explorer-Lod-Control.mjs evidence/local/lod-control-final
node tools/Test-Explorer-Cloud-Formations.mjs evidence/local/cloud-regions-final
node tools/Test-Explorer-Stress.mjs evidence/local/catchup-stress-reuse-final
node tools/Test-Explorer-Shading.mjs evidence/local/shading-final
cargo +1.87.0 run --release -p solar-explorer --example normal_reference -- evidence/local/shading-final
cargo +1.87.0 run --release -p solar-explorer --example filter_reference
cargo +1.87.0 run --release -p solar-explorer -- --view rough --frames 300 --warmup 360 --frozen --audit --output evidence/local/catchup-native-reuse-final
node tools/Test-Explorer-Water-Night.mjs evidence/local/catchup-night-final
node tools/Summarize-Explorer-Cloud-Terrain.mjs
```

Run GPU tools sequentially. `SOLAR_EXTREME_ONLY=1` restricts the concurrent
test to sideways/vertical extreme stops; a comma-separated case name list is
also accepted. `SOLAR_CLOUD_FRAMES=1` is a visual pilot only, not timing evidence.

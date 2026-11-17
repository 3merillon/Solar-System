# Cloud lighting at the day/night boundary

The owner reported repeated streaks across orbital clouds near night. Private
browser captures separated visible density, denser view quadrature and direct
illumination. Increasing view samples retained the lighting pattern; bypassing
cloud attenuation removed it.

Two weaknesses were involved. The global orthographic sun disk stretches radial
texels without bound as the sun cosine approaches zero. In addition, receivers
near a tangent or on the far half of a chord switched to a uniform 128-step
procedural sun integral. Long intervals missed cloud puffs and generated coherent
light-space patterns. Running that integral inside every occupied cloud view
sample also caused extreme GPU cost. A high-sample nightward diagnostic triggered
a Windows GPU timeout during qualification; it is not a valid benchmark result.

The global map used a Lambert equal-area hemisphere from this qualification
until 28 October 2026: its radial/tangential scale factors are bounded between
1 and 2, and density filtering follows the local texel footprint. Because the
exit point of a grazing ray barely moves as its ground point moves, that chart
spent 0.6 texels per degree of ground elevation at the terminator against 2.3
five degrees up, and dusk shadows seen from altitude were stretched fourfold
along the sun; the chart radius is now uniform in the ray's ground elevation
with an outer ring for rays above the ground (see SUN-SHADOWS.md, "Dusk from
altitude and the cloud maps"). Resolution remains 512x512. Local maps retain
their world-anchored 256 m and 4096 m chart spacing (a 1024 m level sits
between them since 28 October, see SUN-SHADOWS.md).

Profiles now store the entire sun ray: eight intervals descending through the
cloud layer and eight ascending on its far side. The inner empty shell is
excluded. Rays crossing the guaranteed opaque planetary core skip far-side
baking and remain blocked at receivers. Interpolation uses distance along each
ray interval; height fractions alone do not converge to the correct accumulated
value where two halves meet at a tangent. Zero-length intervals retain the same
prefix value. Both sides therefore meet continuously without a separate march
or temporal history. Direct-light consumers no longer bind weather merely to
perform a grazing fallback.

This adds 12,648,704 bytes (12.06 MiB) to the controlled GPU payload. Each global
ray performs at most 80 medium evaluations and each local ray at most 320;
empty intervals and opaque far halves skip work. Most view/terrain/water light
queries now perform bounded profile interpolation even at the terminator.
These allocation and loop bounds are not a frame-time guarantee.

Qualification includes three dayward and three nightward orbital poses, direct
sun and density diagnostics, low-sun motion, foreground water, 40,501 analytic
annular-chord cases, WASM/browser execution, native Vulkan and the packaged
site. The geometry reference checks both sides of tangency and the inner gap;
maximum f64 occupied-length disagreement is below 6e-8 m. These mathematical
checks validate addressing, not arbitrary cloud or terrain image accuracy.

Private diagnostic bit 256 renders direct 256-step cloud sun quadrature with
the same visible density. It omits terrain occlusion and retains the planet,
so it is useful for isolating profiles but is not a full-lighting ground truth.
The 320x180 nightward-cumulus comparison has nonzero reference differences:
occupied-pixel HDR mean 0.0241 and p99 0.2094 (the preceding direct-fallback
candidate was 0.0129 / 0.1162). Spatially filtered profiles and terrain occlusion
contribute to this difference. Do not claim universal point-reference accuracy
or pixel-identical illumination. Cloud transmittance/shape is unchanged exactly.
A 32-knot experiment used more memory and did not improve this reference
comparison, so it was rejected. The retained design uses 16 knots.

Compact results and before/after captures are in
`evidence/cloud-terminator.json` (development repository only). Per-run build
manifests and raw HDR buffers remain under ignored `evidence/local/`.

Reproduce GPU runs serially:

```powershell
./tools/Check.ps1
./tools/Build-Explorer.ps1
node tools/Test-Cloud-Sun-Geometry.mjs
node tools/Test-Cloud-Terminator.mjs evidence/local/cloud-terminator-final --nightward --quick
node tools/Test-Cloud-Sun-Grazing.mjs evidence/local/cloud-sun-full-chord
node tools/Test-Visibility-Weather.mjs evidence/local/visibility-weather-terminator-final
node tools/Measure-Weather-Visibility.mjs evidence/local/weather-terminator-cost
node tools/Package-Explorer.mjs
node tools/Test-Explorer-Deployment.mjs --local evidence/local/cloud-terminator-package
cargo +1.87.0 run --release -p solar-explorer -- --view clouds --width 640 --height 360 --frames 3 --warmup 30 --frozen --output evidence/local/cloud-terminator-native
```

The subsequent performance task is scoped in
`docs/NEXT-PERFORMANCE-PASS.txt` (development repository only). It must preserve the new
visibility, geometry and timing fixes and measure animated cache costs.

# Continuous surface detail and cloud coverage edges

26 October 2026, follow-up to `825c728`. The owner identified an altitude-driven
"accordion": distant detail disappeared on descent, while nearby mesh
refinements introduced visible shape changes. They also reported straight,
clipped boundaries around large cloud systems.

## Surface and LOD handoff

The fixed-target descent reproduced the coastline's view-angle fade: it began
at radial cosines 0.25-0.50, so lowering altitude removed the correction even
without increasing distance. That transition now occupies cosines 0.01-0.04,
next to the extreme grazing region.

The saturated allocator was also investigated because its priority-based
coarsening can trade distant patches for nearby ones. However, the fixed-target
run did not lose mesh LOD at its 256 sampled world addresses. An experimental
absolute coarsening ceiling prevented useful refinement and was rejected. The
original allocator is retained; the 2240-leaf, 2560-transition and generation
limits remain unchanged. Stable per-pixel field detail bridges those mesh LODs,
without claiming that a finite pool can preserve arbitrary geometry detail.

Inside 30 km, terrain fragments refine their proxy hit against the same
footprint-filtered canonical field used for shading and shoreline detail.
The correction tapers out over 30-60 km and overlaps the distant coastline
representation. Its residual naturally decreases as geometry catches up,
instead of dropping a band of visible detail at a mesh LOD boundary.

Each fragment uses at most five field evaluations, with an analytic-gradient
Newton step constrained to a local ray interval of at most +/-512 m (also
limited by mesh spacing). Failed convergence and near-tangent surfaces retain
the proxy. This changes interior position and depth, not just color. It adds no
triangles, temporal terrain history or persistent GPU allocation; pixel work
does increase. The mesh still owns coverage, silhouettes and the initial local
root. This is not a complete heightfield first-hit solver and cannot expose
terrain outside proxy raster coverage.

Terrain-field noise uses a canonical split coordinate rather than a camera-
anchor-relative float. The camera high, low and tail components are added in
compensated arithmetic before radial projection. This avoids losing height
precision when the render origin changes.

Trees and rocks use the same filtered canonical field for radial support in
the correction domain. Their identities remain unchanged; anchors do not slide
along the viewing ray. Shore foam and refraction receive the corresponding bed
clearance while nearby geometric water waves retain their actual displacement.
The independent prop audit evaluates the field in f64 with finite-difference
slopes in addition to its published-triangle intersection. Footprint extrema
remain sampled, and terrain collision is still the existing canonical query.

## Cloud regional boundaries

`cloud_body` previously returned zero whenever interpolated regional coverage
was below 0.005. The finer cloud system could still have density one immediately
above that cutoff, producing a hard weather-contour wall. Regional coverage is
now a smooth envelope from 0 to 0.12; only exactly zero coverage takes the early
exit. Weather motion, cloud shell intervals and local cache layout are unchanged.

Private diagnostic bit 32 exercises the production body over all six planet
faces at regional amounts 0.00499 and 0.00501. It does not replace ordinary cloud
rendering or supply a radiance reference. Across 442368 samples the old maximum
density jump was 1; the new maximum is 0.000041962. More than 63000 occupied
samples remain, so the test cannot pass by simply removing the clouds.

## Qualification

`Test-Surface-Continuity.mjs` captures fixed near/intermediate views with mesh
and corrected depth. `surface_detail_reference` checks against independent f64
heightfield evaluations at the captured pixel footprint. `Test-Surface-Horizon`
looks at the same coast 50 km ahead while lowering altitude; its baseline uses
the previously packaged `825c728` build. These coast checks are sea-point
classification/clearance tests, not proofs of first-visible coastline.

Raw reports, source hashes and captures are under ignored `evidence/local/`.
Compact results are in `evidence/surface-continuity.json`. Existing extreme
travel catch-up, silhouette and foliage edge/depth limits are not erased.

Final 960x540 browser captures, 3108 independent terrain samples per view:

| Height above local ground | Previous height residual p99 | Corrected residual p99 |
| --- | ---: | ---: |
| 4000 m | 20.760 m | 0.254 m |
| 800 m | 17.942 m | 0.050 m |
| 160 m | 1.173 m | 0.0124 m |
| 32 m | 1.219 m | 0.00272 m |

The 16x near setting also remains within 0.0124 m at p99. These are radial
height residuals at the rendered pixel footprint, not screen-space silhouette
errors. In this run, detail adds 2.1-2.4 ms to terrain-only whole-frame medians at
960x540; controlled allocation stays at 717555072 bytes. Other views, higher
resolutions, clouds and props have different costs. The surface is more stable,
but the feature is not free and does not establish 60 fps.

For the same coast 50 km ahead, the 10 km-altitude view improves from 44/578
sea-point classification mismatches to 11/578; coastal clearance p99 improves
from 58.97 m to 0.098 m. At 3 km altitude, mismatches improve from 30/286 to
14/286 and clearance p99 from 53.08 m to 10.04 m: the extreme grazing handoff
remains approximate. Matched 10 km captures are in `evidence/surface-continuity/`.

Cloud motion/rebase/night, coastline motion/viewport and all seven water
interface cases pass their existing gates. The water image-rebase comparison
still contains sparse differences (mean 0.0272 codes, maximum 142), consistent
with the previously recorded limitation. The full scenery suite passes with
the new field/support implementation; its explicit 4096 m origin-split test has
identical captured positions and coverage. The final allocator retains the
original behavior. Its final 360-degree turn run checks 3149 first-visible
objects with no appearance fade, zero placement generation, and 1600 independent
surface-contact comparisons (maximum 0.001367 m, no missing support).

`Check.ps1` passes 41 Rust tests, formatting, Clippy, both WASM targets and Naga.
The native 4096-sample probe and native explorer pipeline execution also pass.
The browser and native evidence remain separate.

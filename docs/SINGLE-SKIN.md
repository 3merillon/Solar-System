# Single-skin explorer contract and predeclared gates

The owner authorized one radial surface on 25 October 2026. Commit `fe0c78a`
of the development repository remains the archived field renderer. The new production crate is
`solar-explorer`, independent of the field renderer. Rust/WASM/BrowserWebGpu is
the product path; native Vulkan results are recorded separately. No hardware
ray tracing, CSG, caves, overhangs or disconnected terrain are used.

## Surface and precision

The canonical surface is `P(n) = (R + geology(R*n) + edits(n)) * n` for unit n.
It reuses the 24 finite geological bands, continental and absolute ridge terms,
integer body/sector seed mixing, and material colors. It deliberately changes
the old implicit radial equation and removes the coastal CSG primitives.
Every evaluation of the surface goes through one module, `shaders/surface_field.wgsl`,
and one Rust trait, `solar_core::surface::SurfaceSource`; on a measured body the
field is defined in [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md), section 6. Old
visual targets/settings remain in `evidence/performance-second-captures/final/`,
`final-exact-quality/` and `evidence/performance-second-final.json`.

The independent f64 reference is `solar-core::skin`. Every band is low-pass
weighted by smoothstep(1,4,wavelength/grid-spacing). Its omitted amplitude sum
is an explicit bound. Linear interpolation combines cubic Hessian bounds,
Lipschitz bounds across absolute ridges, and spherical chord error. Bounds are
real-arithmetic engineering bounds; f32 roundoff needs a separate allowance.
Screen projection of these bounds uses a scheduling distance estimate and is
not a visibility/silhouette certificate. Resource deferrals remain visible.

GPU compute constructs canonical integer cube vertices and compensated split positions. CPU f64 math is an independent audit/reference, not an uploaded mesh. Opaque rounding barriers preserve compensated normalization/subtraction under WGSL optimization. The camera has a 4096 m anchor and low-word residual. Reversed infinite depth uses a 0.1 m near plane. Maximum quadtree depth is 24; this is finite resolution.

## Bounded topology, cache and continuous updates

All selection, balancing, allocation, generation, conformity, morph trajectories and indirect draws are GPU-owned. Normal play writes one frame uniform and, on a measured body, source pages; optional profiling/audits perform bounded asynchronous readbacks. The CPU uploads source pages within a bounded budget, and never a cut, mesh, instance list or generated vertex.

Six roots always supply a complete planet, including at zero optional generation budget. At most 2240 configured leaves (2238 for a complete quadtree cut) use 16x16 diamond grids and sixteen conforming edge patterns. Exact integer cube triples identify shared vertices on every face edge/corner. Coarsest incident filtering and actual shared indexed vertices prevent independently moving boundary copies. Maximum transition union is 2560 patches; admission reserves headroom at 2528. A failed publication restores the prior desired cut and displayed cut separately.

Each shared vertex carries a 0.14 second cubic Hermite trajectory with its source, destination and incoming velocity. New publications sample the actual currently rendered triangles. Compatible derivatives are carried, with each component limited to 3 times its remaining displacement divided by duration; reversed derivatives are discarded to prevent overshoot. Position is continuous, but clamped retargets do not claim C1 velocity continuity; generation does not wait for a global fade. Completed trajectories are parked. Coarsening retains the common refinement until local trajectories finish. Offscreen transitions can snap only if their entire trajectory envelope and all incident boundary patches are outside the frustum. Fine targets blend the actual parent diamond interpolant over six cells beside a coarser neighbor. Conservative boxes include carried velocity, the parent quadrant vertex hull and filter differences. The canonical heightfield is unchanged; this is its rendered approximation. There are no terrain skirts, dither fades, overlapping terrain shells or temporal terrain AA.

The resident cut is based on position, including predicted motion and all viewing directions. Turning the camera alone does not request terrain. Selection sleeps after settling and wakes on position/budget/resolution changes. Bounded coarse subtree eviction reclaims old regions; pending generation chooses the most useful current jobs. At most eight split transactions and eight bounded merge groups run per frame; merges visit at most 129 nodes. Generation has 64 jobs near ground / 24 far away, 289 samples per job, bounded by the configured limit of 18496 samples; six root jobs are reserved on cold reset.

Local residual/curvature and grazing estimates prioritize the cut. They are explicitly heuristics, separate from the conservative omitted/interpolation height bounds. Bounded resources can leave a large declared bound shortfall; this implementation has not established a one-pixel silhouette guarantee.

Fixed pools: 4096 nodes and 4096x289 cached 48-byte samples; two 1048576-entry 112-byte shared trajectory banks; two 3932160-index banks; a bounded ownership hash, union map and 1 MiB scheduler state. Each trajectory storage binding stays below 128 MiB. Controlled GPU allocation at native 1080p with full-resolution clouds, weather/density caches and the water simulation is 685217568 bytes, excluding browser/driver overhead and capture staging. It does not grow with distance travelled.

LOD distance is user-adjustable from 0.5x to 16x, default 4x, within the fixed pools. Extreme motion can batch up to four desired-cut generations with cumulative union admission. Descent prediction clamps at the ground. Ridge bands retain a 0.25 mean estimate while filtering residuals; their fully resolved heightfield and conservative amplitude bounds are unchanged. Surface normals use the canonical gradient filtered at pixel footprint, independent of patch LOD. See [the follow-up](CLOUD-REGIONS-TERRAIN-CATCHUP.md) for evidence and limits.

## Transport and exploration

The raster pass writes position and filtered normals. Surface lighting, ocean,
clouds, atmosphere/reconstruction, and presentation are distinct timed passes.
Clouds default to **native resolution and 128 samples**, with UI controls for
full/half/quarter dimensions, 32–256 samples, coverage, stratus/cumulus mix,
wind, travel, evolution and large-scale turbulence. Animation integrates phase;
changing speed or pausing preserves the current weather. Snapshots save this
state. Weather is generated on the GPU in a six-face 512² atlas with gutters
(25,362,816 bytes). A 128×128×64 RGBA16F local density/light cache adds
8,388,608 bytes and blends to the same analytic field outside 12–15 km. It is
regenerated per frame; its cost is inside cloud timings. Both are finite
approximations, not radiance-error certificates. Ray bins follow the cloud shell
and clip at terrain instead of redistributing all samples when terrain depth
changes. Cloud history remains off by default and is not qualified for the new
wind/shear/evolution model. Thin-layer and grazing banding remains a limitation.
The 256×64 atmosphere LUT stores bounded 64-sample optical depth.

The ocean is displaced conforming geometry driven by ten aperiodic simplex wave
bands with analytic slopes/curvature. A 512² advected foam field (0.5 m texels) on
a 256 m chart that follows the eye receives crest and shore sources. Newly
exposed cells initialize to the same equilibrium used outside the chart; the
local history contribution fades continuously from 20–88 m around the player.
Foam uses overlapping round bubbles, not Voronoi edges. The interactive ripple
PDE (512² wave equation pushed by camera contact and the R key) was removed on
16 November 2026 (FRAME-COST-PASS-2.md). Wave tiles, foam banks, bed samples and
chart metadata total 80,478,368 (88,867,008 with the ripple fields) bytes on the full tier. No CPU-generated wave or foam textures are uploaded.

Water optics use exact dielectric Fresnel/TIR, bounded screen-space reflection
and refraction, a sky fallback, absorption, curvature-driven caustics, shafts and
filtered sun glitter. The actual front/back ocean raster and a near-plane cap
classify the medium per pixel where waves cross the screen. No screen-wide
underwater toggle substitutes for that interface. Night scattering, fallback
reflection/refraction, foam, floor lighting and cloud fill share daylight with
the sky; absent light does not create a luminous blue underwater environment.
Screen-space rays cannot reveal offscreen terrain or props. The transmitted sky
does not yet include cloud refraction. Caustics/light shafts are bounded
approximations, not a complete photon transport solution. Wave displacement is
bounded by 1.0357 times the wave-height setting (the ±1 m ripple clamp went with the ripple chart);
filtering and interpolation are not independent silhouette proofs.

Ground controls query the same canonical f64 radial surface. Mesh approximation
and canonical collision are separate; safety and readiness must be checked in
the final validation. Radial edits are finite smooth brushes stored in versioned
snapshots (16 maximum). Old CSG edits do not have a radial interpretation. The
historical erosion snapshot format remains on the archived branch; direct
automatic migration must not be claimed.

## Gates declared before approximation comparisons

- Topology: every closed-planet undirected edge has exactly two incident triangles;
  every transition pattern has positive triangles and exact square coverage;
  shared identities agree on all face edges/corners. Complete area is six faces.
- Morphs: endpoint agreement with actual parent triangles within 1e-6 of local
  patch coordinates, and no topology-induced discontinuity in either direction.
- Height generation: GPU samples against independent f64 filtered height within
  0.02 m + 2e-6 × absolute height, with rebase deltas below 0.002 m near ground.
- Dense geometric reference: compare the same heightfield with four times the
  triangle density per axis and canonical unfiltered samples. Aim for p99 depth
  error below one projected pixel and silhouettes within one pixel. Missing hits
  are counted, never masked out. Separate normal and display differences.
- Clouds: matched epoch/camera native 256-step reference, mean absolute display
  difference below 4/255 and p99 below 20/255, with separate horizon/occlusion ROIs.
  Reject optional history if its motion adds persistent trails or cross-cut reuse.
- Whole frame: native 1920×1080, 300 steady frames per selected browser path,
  p50/p95/p99 GPU totals and stages, CPU scheduling, cold cut cost, memory and
  actual pacing. Target 16.67 ms total and roughly 4 ms visibility. A fast GPU
  sum is insufficient if CPU scheduling or presentation stalls the explorer.

Motion qualification includes LOD thresholds in both directions, cube edges and
corners, grazing ridges, poles, rapid descent, 4096 m origin changes, teleports,
seed/body/edit changes, eviction, exhausted pools, resize and device recreation.
Terrain temporal AA and cloud history stay disabled for initial inspection.

The regular-patch design adapts established work: GPU Gems 2, chapter 2 by
Asirvatham/Hoppe (cached terrain and continuous transitions), and Benyoub/Dupuy's
2024 *Concurrent Binary Trees for Large-Scale Game Components* (bounded planetary
adaptivity). No novelty claim is made. The latter is prior art, not a second
implemented topology system.

## Reproduce

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/Build-Explorer.ps1
# Reuse http://127.0.0.1:5198/explorer.html
node tools/Test-Explorer.mjs --frames 300 --warmup 480 --depth
cargo +1.87.0 run -p solar-explorer --release -- --frames 300 --view ground
```

The [latest follow-up](CLOUD-REGIONS-TERRAIN-CATCHUP.md) and [water/cloud checkpoint](WATER-CLOUD-CHECKPOINT.md) record evidence and remaining limits. These gates are targets, not claims of passing.


## Procedural props contract

Trees and rocks are separate bounded meshes above the single radial terrain.
Their geometry/materials/placements/LOD/compaction/indirect arguments and captured
impostors are GPU-owned. The CPU uploads no generated mesh, instance or atlas
arrays. Canonical source IDs survive eviction; support follows the actual
published terrain triangles and shared morphs. Statistical distant canopy and
rock cover persist beyond individual residency without enumerating the planet.
Explicit prop tags/materials keep geological terrain shading off prop pixels.
Water/cloud transport consumes their real depth, normal and radial height.

See [SCENERY.md](SCENERY.md) for finite capacities, timings and quality failures.
Center support tests use independent f64 intersections of published triangles;
footprint extrema remain sampled. Generated vertex bounds cover each linear mesh,
with separate wind reserve. Layered foliage impostors and distant aggregate
silhouettes do not pass a universal visibility or depth-error certificate.
Fixed allocation is not a frame-time claim.

Trees/rocks/density/detail/wind and generator version participate in snapshots.
Scenery remains GPU-generated; on a measured body its placement depends on imported data.
Stable keys, parameters and bounds are the future physics/shadow source interface.
Rapier, astronomical import and planetary-to-ground shadows remain separate work.

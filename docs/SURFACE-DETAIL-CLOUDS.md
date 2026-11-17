# Distant shoreline experiment and cloud layer repair

A local experiment on shared surface detail, based on `b27a62e`.
The robust checkpoint was committed, pushed, and verified live on the
research deployment before this work. These follow-ups are local.
The archived field branch and the read-only Planets references are unchanged.

This records the initial experiment, subsequently published in `825c728`.
The later [surface continuity repair](SURFACE-CONTINUITY.md) supersedes the
original near-range and view-angle handoff described below.

## Cloud repair

The old local volume stored density already averaged across a 128 m vertical
cell, plus sunlight computed from that density. The ray marcher interpolated
these values even when its ray segment had a different span. This baked thin
layer edges and their nonlinear lighting into the cache. Increasing ray samples
to 256 did not repair that input.

The same 128 x 128 x 64 RGBA16F allocation now stores smooth shape, cloud type,
base and top. The analytic envelope is evaluated at the ray's actual span after
interpolation. Internal light attenuation integrates the envelope above the
sample, rather than multiplying point density by distance to the top. It no
longer becomes unshadowed at a thin boundary or changes with the view ray bin.
This remains a local vertical-column approximation, **not** sun-ray self-shadow
marching or a planetary shadow implementation. No extra texture, history blur,
sample-count increase, or terrain temporal AA was introduced. Defaults remain
full resolution, 128 steps, history off.

For diagnosis, `cloud_diagnostic` is a private bounded setting: bit 0 disables
attenuation, bit 1 bypasses the local cache, bit 2 quadruples march samples.
Bit 2048 stores the view march trace instead of the colour (bins integrated,
path integrated, opaque limit minus shell entry, transmittance); see
`SUN-SHADOWS.md`, "Clouds missing over one side of the screen". Bit 4096
stores the density-weighted local-volume weight, fine sun-profile-map weight
and fine-map edge coordinate (texels from the map centre) of the march with
its opacity; 8192 restores the former 104-texel map hand-over, 16384 drops
the fine sun-profile map and 32768 the fine and middle maps (see
`SUN-SHADOWS.md`, "Cloud self-shadowing hand-over").
Production defaults to zero. Later shell/height diagnostics and continuity fixes are documented in `CLOUD-SHELL-CONTINUITY.md`. Dense references are convergence checks of this
cloud model, not an independent physical radiance solution.

`Test-Cloud-Banding.mjs` captures six frozen configurations at 1280 x 720:
grazing stratus/cumulus, backlit cumulus, above stratus/cumulus and orbit, with
normal 128/256, unattenuated 256, uncached 256 and uncached 1024 sample modes.
The grazing cumulus mean display error against the dense reference falls from
2.568 to 0.585 RGB code values at 128 steps; stratus falls from 1.001 to 0.339.
The reproduced fine layered stripes disappear in the inspected images.
Other cases improve too, but isolated edge pixels still differ substantially:
the backlit 128-step maximum is 35.3 codes. This is not proof of smoothness for
every weather, lighting condition, or grazing view.

The full-resolution motion check uses a frozen field and 128 steps. Small camera
motion has p99 error 0.333 codes and exact return to the initial image; rebasing
by [4096,-4096,4096] m has p99 zero. The night cloud buffer emits exactly zero.
On this shared RTX 3080 workstation, the 120-frame browser sample has whole-frame
p50/p95/p99 11.48/18.45/19.57 ms; cloud stage median 6.97 ms. Water and scenery
were disabled in this isolated cloud view. These are not universal frame rates.

Planets `14516cd611b3686f147c4454f01a2ecd883bac7f` and planets-physics
`70df527ae8235f1b3f2377d52742bffc98e38c22` were inspected read-only, particularly
`core/shaders/clouds/march/build-cloud-raymarch-shader-3.wgsl` and the shell marcher.
Their entry integration and sampling work informed the investigation. This
cache/profile repair is authored for Solar-System v2, not a port of that renderer.

## Shared shoreline detail

The owner's fine coast is real canonical terrain: the smooth distant outline
previously morphed into inlets and islands on approach. `surface_detail.wgsl`
now provides one compensated, footprint-filtered canonical height, normal,
grain and address query. Terrain shading and offscreen refraction use it.
Distant forest and rock cover still uses the existing canonical ecology,
cell identities and projected coverage in `scenery_common.wgsl`, consuming the
same displayed surface height and footprint. No new ecology or placement
generator, cache, texture asset or prop LOD system was added.

**Distant shoreline detail (experimental)** in Terrain detail enables
`surface_detail`. It was initially off; the owner subsequently requested it on
by default (see `CLOUD-SHELL-CONTINUITY.md`). Snapshots save it. The existing terrain and
ocean polygons become coverage proxies near mean sea level. Both passes query
the same sea-ray address and filtered height, then use corresponding radial
layers for their depth and clearance. The compositor filters signed land/water
coverage over a pixel. Refraction and foam receive that same clearance.

The trial uses no additional triangles, allocation or history. It is restricted
to above-water cameras, distance 8-16 km, pixel span 8-24 m, and radial view cosine
0.25-0.50, all with smooth ramps. Full correction applies within 300 m of sea
level and fades out by 600 m. Grazing rays, the planetary limb, near props and
their support, and relief away from the coast retain mesh geometry. This is a
radial coverage approximation: it does not certify first hits, relief parallax,
silhouettes, shadows, collision, or exact subpixel coverage integrals.

The first trial used four field queries to refine a ray intersection. It produced
good distant classification but cost too much and allowed independent land/water
acceptance. The retained common layer uses one query per eligible fragment in
each pass, keeping their ordering coherent and reducing cost. The first trial
and failed diagnostic harness runs remain in ignored raw evidence.

Independent f64 canonical reference, 5544 sampled rays per view at 1280 x 720:

| Height above sea | Coastal samples | Mesh classification mismatches | Detail mismatches |
| --- | ---: | ---: | ---: |
| 1500 km | 178 | 50 | 0 |
| 300 km | 523 | 178 | 1 |
| 30 km | 1657 | 277 | 0 |
| 12 km, transition | 1598 | 245 | 38 |

Coastal means canonical height within 100 m of sea level. The reference tests
the sea-point sign and captured depths; it is not a first-visibility oracle for
occluding ridges. At full correction, coastal clearance p99 error is
0.405/0.141/0.019 m respectively. At the 12 km handoff it is still 36.8 m because
the published geometry remains part of the blend. **The handoff is improved,
not solved.** The owner chose to enable the experiment by default after trying it; near
geometry/detail agreement and broader motion paths remain qualification limits. No polygon budget increase is hidden.

Triangle counts are identical with the option on/off in each view:
175104, 576000, 1145856, 1145856. The 30-frame 720p browser sample adds roughly
1.7-3.5 ms at the median, depending on view and shared GPU contention. A separate
1080p orbital detail run (120 frames) records 11.16/15.21/16.21 ms whole-frame
p50/p95/p99 with clouds/scenery disabled. The small-motion p99 is at most 1.67
codes and returning the camera restores the exact image. Matched rays at a
wide viewport's center versus a narrow viewport's edges have mean 0.00056 codes
and p99 zero; maximum 10.3. Near-water and existing scenery qualification limits
are not erased by these distant checks.

## Reproduction and evidence

Use the existing preview at http://127.0.0.1:5198/ and private headless browsers.
GPU tests run sequentially. Raw source hashes, timings and captures are under
ignored `evidence/local/`; compact results and selected private captures are
in `evidence/surface-clouds.json` and `evidence/surface-clouds/`.

```powershell
./tools/Build-Explorer.ps1
./tools/Check.ps1
node tools/Test-Cloud-Banding.mjs evidence/local/cloud-banding-after
node tools/Test-Surface-Detail.mjs evidence/local/surface-coverage-trial
cargo +1.87.0 run --release -p solar-explorer --example surface_detail_reference -- evidence/local/surface-coverage-trial
node tools/Test-Surface-Cloud-Stability.mjs evidence/local/surface-cloud-stability-r2
node tools/Test-Explorer-Water-Interface.mjs evidence/local/surface-cloud-interface --surface-detail
```

The surface and stability scripts use tracked frozen fixtures in
`tools/fixtures/surface-cloud-views.json`, derived from the captured cases. Compilation, Naga and browser execution are separate
checks. Native GPU evidence does not establish browser performance.

Validation completed: `Check.ps1` passes (41 Rust tests, fmt, Clippy, both WASM
targets and Naga); the native GPU probe passes and the native explorer executes
all current pipelines. Private browser WebGPU runs pass the five stability
checks above and all seven near-water interface cases with the experimental
option enabled, including zero flat-water medium mismatches and no nonfinite
outputs. The near-water rebase image retains the previously recorded sparse
maximum 142-code difference (mean 0.0273, fraction over three codes 0.000392),
inside the existing gate; it is not a claim of bit-exact water rendering.

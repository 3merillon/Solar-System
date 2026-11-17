# Cloud wrap, height precision, and 4x terrain default

Follow-up to `12e0d25` on the local shared-surface-detail branch. The owner
reported that the cloud layer beyond the horizon disappeared when crossing
into the cloud band, with some layering still visible. The owner also requested
4x terrain LOD as the default. The owner subsequently requested distant shoreline detail on by default too.

## Two visible cloud intervals

The previous marcher shortened its entire ray at the first intersection with
the 1300 m inner cloud sphere when the camera was inside/above it. A ray can dip
below that sphere, miss the actual planet, and enter the cloud band again on
the far side. That second interval was lost. Below the inner sphere, the old
branch started at the far inner intersection instead, so crossing 1300 m
changed the visible cloud set abruptly.

The marcher now intersects the 7500 m outer sphere and subtracts the empty
inner interval. Both remaining intervals contribute in depth order, with
transmittance carried between them. Actual terrain/water ray depth still clips
the march; clouds behind opaque ground are not exposed. The 1300/7500 m shell
bounds enclose the weather model's physical vertical support (base at least
1320 m; top at most 6980 m).

A single logarithmic sample budget spans occupied intervals. The one bin that
straddles the empty gap splits into two pieces. Thus the usual 128-step setting
uses at most 129 medium evaluations, not 128 for each interval. No integer
near/far step allocation switches at the crossing. The spatial quadrature and
profile averaging remain finite approximations; history remains off by default.

An independent f64 test intersects spheres analytically, clips them using the
captured terrain/water depths, and checks exp(-0.00001 * occupied length) against
a uniform-medium GPU diagnostic. It checks every pixel of five 1280 x 720
views: below, just below, just inside, inside and above the shell.

Before the fix, the just-inside view loses 11973 far intervals, with maximum
transmittance error 0.928. Inside and above lose another 3068 and 36 respectively.
Afterward all five cases have zero pixels exceeding the 0.002 tolerance; maximum
error is 0.000674, including RGBA16F storage and the early transmittance cutoff.
The diagnostic counts rays with two visible intervals explicitly, so the pass
cannot be obtained merely by choosing views with no far shell.

Natural-weather views use full-resolution 128 and 256 samples, plus a 1024-sample
uncached convergence reference. The 1299-to-1301 m camera crossing's p99 display
difference drops from 16.67 to 1 RGB code. Some image change remains because the
camera actually moves and terrain pixels shift. This is not a claim of exact
continuity for every weather or terrain configuration.

## Height precision

Cloud body/profile heights previously used `length(world_position)-radius`.
Earth-sized f32 positions quantize this into roughly half-metre layers before
the profile and light attenuation run. The local cache coordinate calculation
also subtracted two such large positions. More ray samples cannot remove that
quantization.

Ray samples now retain camera-relative coordinates. Heights use the existing
stable radial-difference helper shared with terrain/water; local-volume queries
project the relative offset and add the precise eye height. Cache generation
computes height from the tangent-plane coordinates with a stable difference of
radii. Broad procedural weather/noise still uses its existing world coordinates;
the thin vertical envelope and column lighting no longer do the large subtraction.

`Test-Cloud-Height.mjs` compares the production GPU height helper and the old
calculation against independent f64 geometry at 32 m ray points. It uses three
fractional camera heights, 518400 points each. The RGBA16F diagnostic output adds
its own small quantization, which is included in the error gate (max 0.02 m and
p99 less than one tenth of the legacy p99). Measured p99 error is 0.0074-0.0076 m, versus 0.676-0.716 m with the legacy
calculation; maxima are below 0.0078 m versus up to 1.002 m. This directly verifies the repaired
height path; it does not prove that every visible cloud band has this cause.

The private diagnostic mask now additionally supports bit 3 for the constant
shell and bit 4 for the height comparison. Default remains zero, with full
resolution, 128 samples and cloud history off. No textures or allocations were
added. Planets' split-shell work was inspected read-only at the revisions already
recorded in `SURFACE-DETAIL-CLOUDS.md`; this interval implementation is authored
for Solar-System v2's bounded logarithmic integration.

The later [surface continuity repair](SURFACE-CONTINUITY.md) adds private bit 5
for cloud regional-coverage continuity and repairs the hard weather cutoff.

## Terrain setting and reproduction

`Settings::default`, both HTML entry points, and the existing LOD-control test
now use 4x. Distant shoreline detail defaults on in both Rust settings and the
HTML controls, following the owner's explicit preference. Its near-handoff
approximation remains documented. Explicit settings in imported snapshots are retained. The fixed
patch/work/memory budgets remain the same; 4x requests greater detail range,
without guaranteeing it when the patch budget is exhausted.

On 26 October 2026, the owner requested more range and publication of this
follow-up. The terrain slider and settings validator now accept 0.5x-16x,
while the default stays 4x and distant shoreline detail stays on. Selection
already consumes this multiplier directly; no shader or allocation change was
needed. Higher values request finer terrain farther away but still share the
2240-patch cap and the existing generation limit. This is not a guaranteed
16-fold detail range in a saturated view.

`tools/Test-Explorer-Lod-Control.mjs` exercises the DOM slider at 1x, 2x, 4x,
8x, 16x and back to 1x, checks closed manifold topology, bounded patch count,
identical controlled GPU allocation and rejected out-of-range settings. The
deployment check also verifies 4x/on defaults and the 16x UI maximum.

The 1080p orbit run used 417 patches at 4x, 1173 at 8x and 2238 at 16x.
All six settings/cycle cases had zero boundary edges, nonmanifold edges or
topology overflows, and the same 897958272-byte controlled GPU allocation.
The 16x view nearly fills the patch cap, so further visual gains depend on the
view. These counts are not near-ground frame-time measurements. Compact source
hashes and results are in `evidence/terrain-detail-range.json`.

Use the existing preview and private headless browsers, with GPU runs sequential:

```powershell
./tools/Build-Explorer.ps1
./tools/Check.ps1
node tools/Test-Cloud-Shell.mjs evidence/local/cloud-shell-final
node tools/Test-Cloud-Height.mjs evidence/local/cloud-height-final
node tools/Test-Surface-Cloud-Stability.mjs evidence/local/cloud-wrap-stability
```

Compact evidence and selected private captures are in `evidence/cloud-wrap.json`
and `evidence/cloud-wrap/`. Per-run source hashes and full reports remain under
ignored `evidence/local/`. Browser execution, Naga/WASM compilation and native GPU
checks are reported separately. Earlier shoreline handoff and other known
qualification limits still apply.

The existing browser stability suite passes cloud small-motion, exact camera
return, alternate origin split and zero night emission checks. The shoreline
motion/viewport checks also pass. `Check.ps1` passes all 41 Rust tests, formatting,
Clippy, both WASM targets and Naga. No independent physical-radiance ground truth
or universal band-free guarantee is claimed.

The native 4096-sample GPU probe and current native explorer pipeline execution
also pass. These are native validation, not browser-performance evidence.

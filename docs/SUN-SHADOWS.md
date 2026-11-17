# Sun visibility in the single-skin explorer

This implementation targets Solar-System v2's adopted radial-heightfield renderer, not
the archived arbitrary-solid experiment. Shadows are enabled by default. The
4x terrain setting, canonical surface detail, scenery density, and full-size
128-sample clouds are unchanged. Production selection and generation run on
the GPU; only fixed-size light parameters and input state come from the CPU.

## Decision and reference investigation

Read-only references were `planets/src/gpu/shadow-pipeline.ts`, its cloud shadow
pipeline/shader/sampler, `planets/docs/csm-caster-consistency-findings.md`, and
the referenced `planets-physics` cloud bake/sample WGSL. Their useful principles
are stable light projections, selecting casters beyond the camera frustum,
matching caster/support detail, and addressing clouds with the receiver's sun
ray. A camera-facing impostor or camera-frustum terrain cut is not a suitable
general shadow caster. No reference repository was modified.

| Approach | Advantage | Reason for decision |
|---|---|---|
| Raster terrain and prop cascades | Simple, sharp nearby geometry | Coarse terrain triangles miss displayed procedural relief and shoreline detail; do not use them as the sole terrain occluder. |
| Per-receiver canonical height queries | Same field and edits as displayed detail, works beyond residency | Too much repeated procedural work without caching; sampled stepping is not an occlusion certificate. |
| Conservative height hierarchy | Can skip certified empty ray segments | Needs valid cell extrema and filtering/error bounds. Ordinary sampled mip maxima cannot supply these guarantees. Deferred rather than mislabeled conservative. |
| Radial cache + sampled terrain query + stabilized prop maps + cloud profiles | Preserves canonical terrain, detailed objects, global cloud registration | Selected, with explicit work limits and measured approximation errors. |

## Lighting contract

`sunlight(position, normal, footprint)` returns solid visibility, cloud
transmittance, and unresolved-work status. Positions are the actual corrected
camera-relative receivers. Terrain diffuse, vegetation, rocks, their specular
terms, water highlights, foam, refracted bed continuation, and underwater sun
beams use this contract. Ambient skylight remains separate. Water reflection
attenuates the reflected sun disk while retaining ambient sky. Already-lit bed
color is not multiplied by visibility a second time.

Cloud scattering uses the same sun-ray profiles and planet/terrain occlusion.
Cloud transmittance and opaque visibility are stored separately. The planet's
inner sphere is an exact conservative occluder; mountains outside it are sampled.
The existing approximate atmosphere and indirect lighting are not promoted to
multiple-scattering or general secondary-ray solutions.

## Terrain representation and precision

Nine toroidal 512x512 caches (at the full tier; smaller tiers shrink them) store
canonical radial height at 1, 4, 16, ... 65536 metre chart spacing. Each entry has an exact integer
address, face, and world revision. Recentered and edited entries regenerate;
matching entries survive indefinitely because their field has not changed.
Keys and the packed height texture use integer storage, so negative coordinates
and revision bits cannot be canonicalized as floating-point NaNs. Face and
revision are separate fields in the producer key; the whole current face is
prepared before lighting consumers run.
Both coarse/fine and cache-border transitions blend occluding height, not light.
Queries outside valid cached coverage evaluate the canonical field directly and
mark that fallback. This cache is a filtered reconstruction, not a min/max tree.

Sun rays use up to 64 height tests with geometric step growth. A local receiver
residual accounts for the difference between published/displayed geometry and
the canonical surface, decaying within two receiver footprints. Ground queries
start on the canonical height used for their normals, even when the displayed
coarse proxy lies below it. Prop/cloud receivers retain displayed positions. It is not a constant
large bias on every remote caster. A 25 mm precision allowance and the sun's
0.00465-radian angular radius define the terrain transition. The geometric
progression can miss narrow occluders: zero unresolved work means the loop
finished, not that visibility was mathematically certified.

Compensated chart addressing and camera-relative subtraction retain Solar-System v2's
origin conventions. Light centers are snapped in f64 world coordinates; the
shader compensates the GPU terrain safety lift. No shadow identity uses camera
rotation, terrain allocator IDs, or screen pixels.

## Trees and rocks

Six 1024x1024 depth maps have half-extents 8, 32, 96, 384, 1536, and 6144 m.
The nearest map therefore has 1.5625 cm texels. A fixed 65536 m depth interval
avoids changing precision with camera pitch or scene bounds. Neighboring maps
overlap; coverage continues through their outer region into canonical distant
scenery coverage. Sun basis changes parallel-transport the previous basis.

GPU culling considers the complete prepared scenery window, independently of
the view frustum. Near casters use the generated geometry, material foliage
cutouts, support offset, burial, and wind deformation. Distant casters select
and interpolate the existing atlas along the **sun direction**. Coverage is
filtered/dithered; the card rectangle is never an opaque caster. Geometry/card
selection uses projected light texels (24–42 px), not camera distance or view.
PCF is limited to nine comparison taps; its radius responds to central blocker
separation and sun angular radius. This is a small contact-hardening estimate,
not full PCSS. Normal offsets stay below 8 cm and shrink with the near texel.

Each mesh/card stream has 65536 IDs. An initial 32768-ID stream overflowed by
5695 in a real forest test; doubling streams cost 1 MiB for four maps. The fifth,
32 m map was added after close captures showed coarse foliage edges; it retains
the previous far extent and adds about 4.5 MiB including its ID streams.
Overflow is copied into the lighting uniform on the GPU, activates approximate
canonical coverage and marks unresolved lighting. It never triggers a CPU scene
readback. Cold/unprepared scenery likewise retains its existing canonical
footprint representation, with its statistical rather than geometric limits.
Pending placement, missing support, and unbuilt variants are exposed as
`incomplete_casters` and contribute to the unresolved-lighting diagnostic.

## Clouds and the reported artifacts

Wind advection now uses rigid rotations on the sphere. Accumulated Cartesian,
height-scaled drift previously changed the noise metric with latitude and time.
Optional vertical shear is bounded to 300 m. The density noise remains the same
shared three-dimensional field for visible clouds and shadows.

Ray step length is longitudinal quadrature, not a lateral noise-filter size.
The visible ray marcher now filters using its pixel footprint alone. Previously,
clipping a final bin at terrain could also change the density spectrum. Cached
density blends out continuously at all local-volume faces and over the 18–20 km
camera-altitude interval. Existing smooth regional coverage, accurate relative
height, and occupied-shell integration repairs are preserved.

Sun visibility uses a 512x512 global map (azimuth about the sun, radius
uniform in the ground elevation of the ray with an outer ring for rays that
stay above the ground, see the 28 October evening section) and three 258x258
local maps at 256 m, 1024 m and 4096 m chart spacing (the middle one since the
28 October night section). Each stores sixteen cumulative transmittance and
sixteen solid-occlusion values, in eight RGBA16F layers. The nine radial boundaries
are 12500, 9500, 6500, 4500, 3500, 2500, 2000, 1700 and 1300 m, retaining
samples around thin low clouds while enclosing taller cumulus. Local intervals
use 16 density evaluations (32 in the two upper intervals); global intervals
use 4/8. Both halves of the chord are baked, skipping the empty inner-shell gap
and the far half when the ray crosses the opaque planetary core. The vertical
envelope is integrated over each sample span.
The entire receiver sun ray, not a vertical column, addresses
the shell exit. Lateral interpolation acts on transmittance; along-ray
interpolation uses monotone cubic optical depth and metric interval lengths.
Both sides meet at the same accumulated value at the tangent. Local maps cross chart boundaries with
gutters and blend into the wider representation.
Sampling reads adjacent radial endpoints and their slope neighbors and skips
wider maps when local coverage is complete. Terrain lookups
likewise share compensated chart coordinates across their interpolated levels.

The first global cube-map prototype produced visible grid patterns and poor
orbital point-reference error. Its orthographic disk successor stretched texels
by 1/cos(sun) near the terminator. The equal-area chart bounded tangent
stretch between one and two shell radii per unit disk coordinate but, since
the exit point of a grazing ray barely moves as its ground point moves, spent
0.6 texels per degree of ground elevation at the terminator against 2.3 five
degrees up; the elevation-uniform chart replaced it on 28 October. The old
per-receiver
128-step grazing integral also imprinted missed puffs into light-space streaks
and multiplied work at every cloud view sample. Complete chord profiles replace
that fallback. This remains filtered, finite-resolution lighting, not exact
fine-scale optical depth. See [terminator qualification](CLOUD-TERMINATOR.md).

All cloud maps share weather, seed, regional envelope, wind, phase, and settings
with visible clouds. The [integrated performance pass](INTEGRATED-PERFORMANCE.md)
separates optical and solid validity. Local profiles reuse only an exactly
unchanged GPU-projected camera and inputs; translation or rebase rebuilds them.
Weather invalidates optical profiles; sun/terrain changes invalidate both.
There is no shadow temporal history to hide disocclusion or leave trails.

## Budgets and diagnostics

Controlled incremental shadow payload is **68,289,856 bytes (65.13 MiB)**:
14,680,064 height/key bytes; 25,165,824 prop depth bytes; 3,145,728 caster ID
bytes; 16,777,216 global-cloud bytes; 8,520,192 local-cloud bytes; 832 uniform and
state bytes, including exact validity, chart centers and refill counters.
These exclude driver allocations, shader binaries, audit buffers,
and readback staging. Allocation caps do not guarantee frame time.

Worst cold height refill is 2,359,296 texels (nine 512x512 levels, full and
coarse channels; `stats().sun.height_texels`). Cloud baking covers 262144 global
and 133128 local rays, with at most 80 and 320 density/terrain evaluations respectively. Frozen
global and local maps skip their bake, so frozen timings alone cannot price normal play.
Selection scans the existing 884736 scenery records and emits bounded indirect
draws. Height sampling, PCF, card filtering, and participating-media queries add
work to existing shading passes as well as the named shadow passes.

Developer API (kept separate from normal player controls):

```js
solarExplorer.configure({ shadows: true, shadow_steps: 64 });
// 0 beauty, 1 solid visibility, 2 cloud transmission, 3 unresolved, 4 RGB channels,
// 7 terrain march work (red: steps / 384, green: block jumps / 128)
solarExplorer.configure({ shadow_diagnostic: 3 });
await solarExplorer.engine.audit_shadows();
```

`profile_rebuild_frames` and `profile_rebuild_flags` separate global optical,
global solid, local optical and local solid work. Height-refill instrumentation
runs only on frames with profiling/query slots enabled; enable
`solarExplorer.engine.profiling(true)` before measuring those counters. The
profiled total excludes any earlier unprofiled startup frame. Counts come from
GPU work, not an inferred cache age. Six prop raster stages and height/global/
local/caster-selection stages are separately timed. `gpu_span_ms` also includes
copies and gaps between stages; explicit audits stay outside timed captures.

The explicit audit returns 2048 screen probes, 1024 camera-centered canonical
world probes, per-map mesh/card draw counts, overflow, and resource bytes. Each
probe separates terrain, props, far coverage, clouds, a 256-sample cloud-ray
reference, and height-cache spacing. Audits allocate/read back only when called.
Exact input validity replaces a heuristic cache-age expiry; no stale map is
accepted merely because it is young. Timestamp stages include cloud-field
generation, sun cache/selection, and prop shadow raster, in addition to shading.

## Reproduction and evidence

Run GPU commands sequentially. `tools/Check.ps1` covers formatting, 41 Rust
tests, Clippy, WASM checks, and Naga validation. Browser shader execution and
native GPU execution are separate evidence. Local raw captures and logs are
under `evidence/local/sun-shadows/`; the compact committed report records their
manifest hashes and final measurements.

```powershell
./tools/Build-Explorer.ps1
node tools/Test-Cloud-Coordinates.mjs evidence/local/sun-shadows/coordinates-final
node tools/Test-Sun-Shadows.mjs --views forest,coast,orbit,rough,ground --terrain-stress --frames 12 --warmup 240 --output evidence/local/sun-shadows/optimized
node tools/Test-Sun-Motion.mjs evidence/local/sun-shadows/motion-final
cargo +1.87.0 run --release -p solar-explorer --example sun_reference -- evidence/local/sun-shadows/optimized
node tools/Test-Explorer.mjs --width 1920 --height 1080 --frames 300 --warmup 360 --views forest,coast,orbit,clouds --output evidence/local/sun-shadows/performance-optimized
node tools/Package-Explorer.mjs
node tools/Test-Explorer-Deployment.mjs --local evidence/local/sun-shadows/package-final
```

The independent f64 terrain check uses dense physical ray intervals rather
than the production cache/step progression. It reports actual displayed
receivers, their residual against canonical height, and a separately projected
canonical receiver. Large far-field mesh residuals must not be hidden by
discarding the actual-receiver result. Cloud comparison uses direct 256-sample
quadrature without light-map addressing, local density cache, or temporal reuse;
it shares the canonical density definition, not the production representation.
Orbital point samples do not constitute an area-filtered pixel reference.

The submitted screenshots do not include an exact camera/settings snapshot.
The fixes cover demonstrated coordinate and cache-boundary mechanisms, and the
deterministic captures exercise grazing views and multiple chart directions.
They do not establish that every possible source of the pictured artifacts has
been reproduced. Existing terrain silhouette/coarse-proxy limitations, sampled
terrain ray misses, statistical far-forest coverage, and approximate layered
foliage impostors remain explicit. No universal artifact-free or 60 fps claim is
made.

## Measured checkpoint: 26 October 2026

BrowserWebGpu on the local RTX 3080 machine, private Edge 156, 1920x1080,
300 measured frames after 360 warmup frames per view. Clouds animate normally;
the default full-size/128 steps, 4x terrain and surface detail remain enabled.
GPU timestamps below exclude browser presentation and CPU scheduling.

| View | GPU p50 | GPU p95 | GPU p99 |
|---|---:|---:|---:|
| Forest | 34.304 ms | 35.447 ms | 35.707 ms |
| Coast | 31.974 ms | 33.073 ms | 33.336 ms |
| Orbit | 28.202 ms | 30.434 ms | 33.702 ms |
| Cloud-heavy | 46.606 ms | 48.004 ms | 48.509 ms |

**The 1080p/60 fps target is not met.** Removing redundant cloud profile and
terrain-cache reads reduced forest median GPU time from 43.126 ms and the
cloud-heavy median from 70.092 ms. The latter frozen capture is pixel-identical
before/after this optimization. The whole renderer reports 948,880,400 controlled
GPU bytes (904.92 MiB), including the 48.56 MiB shadow resources. These figures
exclude driver/staging allocation. Fresh private-browser readiness took 89.26 s;
the first forest warmup frame took 467.4 ms wall time and the maximum cold GPU
frame was 192.00 ms. Warmed frame time does not describe startup or cold cuts.
Per-run source/WASM hashes, stage timings, pacing and cold measurements are in
`evidence/sun-shadows.json` (development repository only).

Validation completed:

- `Check.ps1`: formatting, all 41 Rust tests, Clippy, WASM and Naga passed.
  Native GPU field probes reported zero false misses/invalid hits/overflow in
  their 6618-ray set; 24 unresolved queries remain explicit. This is separate
  from the new sampled sunlight query and does not certify it.
- Final coordinate checks passed 8/8 gates: spherical tangent metric error was
  below 0.0044 through 999999 seconds of animation. Two occupied cache-boundary
  probes had maximum density differences of 0.00611 in the test's scaled units
  across one metre; three other boundary poses were empty, not coverage proof.
- Final motion checks passed 16/16 gates. All 1024 fixed world probes retained
  identical terrain/prop/cloud visibility through a 360-degree turn and 4096 m
  rebase. Edits invalidated cached heights. An eight-step budget exposed
  exhaustion at 1024/1024 probes. Seven cold cuts were finite with no caster
  overflow. The final five settled views had zero overflow and zero incomplete
  casters; their image rebase error had p99 zero and maximum 1/3 display code.
- Cloud shell (7/7), coverage-edge, height precision (3/3), surface/cloud
  stability (5/5), scenery (57/57), surface, water interface and black-night
  regressions passed. Six cloud banding poses were compared against 1024-step
  captures; normal128 p99 differences ranged from 0.33 to 3.33 display codes.
  Native full-cloud and final clouds-disabled shader executions also passed.
- The final static package loaded all seven browser assets and executed WebGPU
  with default shadows enabled. This local check did not publish a deployment.

Independent reference errors remain material, especially in low sun and orbit.
Thresholded terrain visibility disagreed at 2/152 actual forest receivers,
0/183 coast, 66/68 orbit, 10/156 rough low-sun, and 0/149 ground low-sun probes.
Projecting those receivers to canonical height changed the disagreements to
0, 0, 0, 12, and 0 respectively. Orbital displayed-proxy height residual averaged
159 m (max 485 m); the rough low-sun canonical comparison still disagreed at
7.7% of probes. Therefore this implementation does **not** establish exact
terrain shadows or fix the existing coarse terrain proxy. Fixed ground probes
at orbital coordinates also exceed the useful precision regime: 55/128 raw
disagreements are retained in the report.

Cloud transmission versus independent point-ray quadrature had mean/p99 absolute
errors of 0.00523/0.00667 in the forest and 0.0675/0.656 at orbit. The distant map
filters a large footprint whereas the reference is a point ray; that difference
explains part of the discrepancy but does not validate orbital image accuracy.
Future work should improve terrain interval bounds and distant filtered cloud
references before claiming tighter guarantees. The final metadata changes
(exact integer height keys and empty-stage timestamps) preserve the production
sampling algorithm; their native execution and the packaged browser are checked
separately from the recorded full-quality timing run.

Selected visual evidence:

- Forest shadows (`evidence/sun-shadows/forest.png`, development repository only), close tree (`evidence/sun-shadows/contact-tree.png`, development repository only),
  and rock contact (`evidence/sun-shadows/contact-rock.png`, development repository only) with shadows off (`evidence/sun-shadows/contact-rock-off.png`, development repository only).
- Grazing cumulus (`evidence/sun-shadows/cumulus-grazing.png`, development repository only) and
  stratus from above (`evidence/sun-shadows/stratus-above.png`, development repository only).
- Full camera turn (`evidence/sun-shadows/turn.mp4`, development repository only) and
  cloud-layer descent with changing sun and wind (`evidence/sun-shadows/descent.mp4`, development repository only).
  These are deterministic frame sequences, encoded at 24 fps for inspection;
  their playback speed is not a performance measurement.


## Camera translation and mountain follow-up, 26 October

The owner's moving-camera jitter was reproducible. XY centers were already
snapped, but foliage coverage and mesh/card selection hashed viewport pixels.
Every integer recenter therefore changed the shadow's dither pattern. Both
passes now hash the absolute integer light texel and canonical object cell.
The CPU computes wrapping integer viewport origins in f64; no Earth-sized f32
coordinate enters the hash. Unchanged sunlight retains exactly the same basis.
The depth origin also uses a world grid (64 m), with the same fixed 65536 m span.
Camera rotation, translation and rebase do not resize cascade texels. A sixth
8 m half-extent map improves close detail by four times on each axis, for an
additional 4,718,864 bytes including its ID streams and expanded uniforms.

`Test-Shadow-Stability.mjs` uses 4096 identical canonical world receivers and
frozen wind/sun, translates by 0.01, 0.1, 1, 6, 12 and 24 m, then returns home.
Per-cascade comparisons exclude points outside the common interior coverage;
clamped out-of-map samples are not stability evidence. All eight gates passed.
Across overlapping maps, the largest p99 change was 0.0004341. The nearest
map's overlapping probes were identical. Rare individual changes remain as
published terrain support changes; maximum single-map deviations reached 0.4
at a few receivers. Selected visibility also changes continuously through the
cascade blend, so these results do not claim identical shadows at all distances.
The farthest map's maximum drift was 0.001302 versus 0.8043 before the fix.

Terrain cache heights are no longer accepted directly as blockers. A candidate
is checked against the receiver's canonical filtered field. Candidate selection
includes an interpolation/spectral envelope: cubic-noise Hessian bounds, ridge
Lipschitz bounds, omitted source/receiver bands, radial edit bounds, and a 2 m
coordinate guard multiplied by the field gradient bound. Blended cache samples
use the coarser envelope. The analytic terms follow the independent scalar
field's declared bounds; the numeric guard is for this Earth-scale f32 cache,
not a proof for arbitrary radii or all floating-point implementations. Ray
spacing is still sampled and can miss narrow blockers between queries.

A coarse opaque-terrain mask stored in cloud-volume profiles is used only for
cloud illumination. Applying it again to surface light could project radial
profile bins onto mountain tops. Surface light now uses its own terrain query;
cloud transmittance still attenuates it normally. Genuine terrain shadows remain.

`Test-Terrain-Shadow-Stability.mjs` adds a 900 m radial mountain and checks 576
fixed world points through 500/2000/8000/20000 m camera altitudes and +/-2048 m
sideways cuts. All seven cuts retained 109 shadowed points, zero unresolved
queries, mean visibility drift <=0.000049 and p99 <=0.000040. Maximum drift was
0.01808. Without the candidate envelope, several points flipped by 1.0 when a
cache recentered; that failed experiment is retained only in local evidence.

The independent dense f64 ray reference at low sun now disagrees at 2/156
canonical rough-terrain receivers (previously 12/156), and 0/149 ground receivers.
Both sets of 128 fixed ground receivers agree. The displayed coarse proxy still
differs from the canonical field, and thin-occluder misses remain possible. These
are measured approximations, not an exact-visibility claim.

Reproduction (GPU runs sequentially):

```powershell
node tools/Test-Shadow-Stability.mjs evidence/local/shadow-stability-final
node tools/Test-Terrain-Shadow-Stability.mjs evidence/local/terrain-shadow-stability-bounded
node tools/Test-Sun-Shadows.mjs --output evidence/local/shadow-final-reference --views rough,ground --terrain-stress --warmup 180 --frames 30
cargo +1.87.0 run --release -p solar-explorer --example sun_reference -- evidence/local/shadow-final-reference
node tools/Test-Sun-Motion.mjs evidence/local/shadow-final-contact --contact-only
```

The startup worker and shader compilation changes are documented in
[STARTUP.md](STARTUP.md). The initial checkpoint timings above predate this
follow-up; they must not be presented as measurements of these stricter queries.


Current animated BrowserWebGpu costs at 1920x1080 (300 frames after 360 warmup,
RTX 3080, shared workstation): forest p50/p95/p99 106.59/118.19/122.32 ms;
coast 95.46/101.29/103.96 ms; clouds 40.02/41.27/42.01 ms. Controlled payload
is 953,599,264 bytes (909.42 MiB). These are significant performance costs,
especially canonical terrain confirmation; the 60 fps objective is not met.
The owner tested and accepted the improved stability and explicitly deferred
optimization until after further cloud work, requesting this checkpoint pushed.

Final validation passed `Check.ps1` (41 tests, fmt, Clippy, WASM and Naga), native
explorer GPU execution, the independent native field probe, all translation and
mountain gates, startup/loss/recovery, water interfaces, black-night lighting,
cloud/shore motion and cloud coverage edges. Compact evidence is in
`evidence/shadow-stability.json` (development repository only), with close
shadow and mountain captures in `evidence/shadow-stability/`.

## Camera-independent terrain march, 27 October (evening)

The owner saw terrain shadows creep and flicker while flying. The earlier
stability tests audit fixed world receivers with a fixed 0.25 m probe
footprint, and under that condition the shadows were stable (maximum drift
0.015 over a 3 km approach). The shading pass, however, queries each receiver
with its pixel footprint, and the former march started at
`t = max(0.5, footprint)` with steps `1.25 t + 0.5 footprint`: every sample
position along the sun ray scaled with the footprint, so moving the camera
slid the samples along the ray and whichever crest happened to fall between
them changed. Measured on the same 1024 receivers in the rough view at a 17
degree sun: a footprint change from 1.0 to 1.1 m (samples shifted by 10%)
moved individual receivers by up to 0.52 visibility; across 0.25 to 4 m ten
receivers flipped by more than 0.5; and at the footprints of terrain 6 to 12
km away (13 to 27 m at 540p) three quarters of the shadowed receivers lost
their shadow because the sparse near samples missed nearby blockers. The
published checkpoint package produced bit-identical audits, so this was the
sampling design, not a regression of the performance pass.

The march is gone. Terrain visibility now comes from **sun horizon maps**
(superseded on 15 November by an exact march over the cached heights; see
"Exact cached march replaces the horizon maps" below):

- Every frame, after the height clipmaps refill, `sun_horizon_generate`
  scans each level along the chart images of the sun rays. All sun rays
  project to straight chart lines through the sun's vanishing point V, so
  the scan lines are a pencil about V at a fixed angular spacing (one texel
  apart at the window corner farthest from V, so no window texel lies more
  than half a texel from its line): a lattice that depends on the sun and
  the face alone, never on the camera, in which every window texel belongs
  to exactly one line (texels are owned by the line whose angle their own
  angle about V rounds to, a half-open interval per major coordinate). Beyond a
  million texels V is far enough that parallel lines along the sun's chart
  direction deviate by under a quarter texel across any window, and f32
  angles about V would not resolve the lattice, so the same scan then runs on
  parallel lines indexed by their absolute intercept. One thread per line
  walks from the window's sunward end back to its far side keeping a suffix
  maximum of the impact parameter `rho = (R + H) cos e` of the ray that
  grazes each texel (`e` the sun's elevation at the texel): every ray in the
  plane of a line is a straight line at some distance `rho` from the
  planet's centre, a point at radius `r` where the sun stands `e` above the
  horizon lies on the ray with `rho = r cos e`, and a receiver clears a
  texel ahead iff its `rho` exceeds the texel's, so planet curvature is
  exact at any elevation and on both sides of the terminator without a
  reference ray. The elevation grows along the line by exactly the signed
  arc swept toward the sun, so `rho` is formed relative to the elevation at
  one end of the line from small, exactly known chart differences, which
  keeps millimetre precision at the metre levels where a plain
  `(R + H) cos e` would round to half a metre. A window that contains V (the
  65 km level nearly always, the 16 km level when the sun is within about 33
  degrees of the zenith at the eye's sub-point, the 4 km level within 9
  degrees, finer levels only at the moment of local noon) splits every line
  at V into two half-lines whose rays all head toward V or all away from it;
  each half is swept from its own sunward end, and at V itself (`cos e = 0`)
  a texel records no occluder. Heights and horizons are addressed by the
  absolute texel index modulo the map size, like the height producer and
  every consumer. The cached height is sampled bilinearly on the line and
  one texel to either side perpendicular to it (continuous and isotropic in
  the line position). Each texel stores the lowest height a ray toward the
  sun must have at that texel to clear every cached texel ahead of it
  (`max_ahead(rho) / cos e - R`), plus the distance to the texel that
  binds, and the same pair for the highest texel
  at least two texels away from the first (a coarse level that smooths a
  near ridge below a far mountain still reports the ridge). A level's map
  depends only on its window, its texels and the sun, so the pass re-sweeps
  a level only when its window recentred, any of its texels refilled, the
  sun moved or shadows were switched on (per-level flags kept on the GPU);
  in flight the fine levels recentre every few frames and the coarse ones
  rarely. A full rebuild is 2.4 Mtexels on the full tier (38 MB of
  rgba32float, 9.4 MB on the minimal tier).
- A receiver reads the horizon of every resident level at its own chart
  position (bilinear over texels that have an occluder, the binding
  distances from the highest of the four), so each level offers two
  candidates. Coarser levels hold the terrain beyond the
  finer windows at their own resolution, so the highest horizon binds. Its
  canonical height minus the horizon, normalized by the penumbra at the
  binding distance, is the cached clearance; receivers whose clearance lies
  above the penumbra band widened by the level's sub-texel crest margin
  (`height_errors.w`: how far a band's crest can rise above the texel-centre
  sample within one texel, about 0.3 m on the 1 m level, 6.5 m on 16 m, 28 m
  on 64 m) are lit with no further work. The margin is what keeps the result
  camera-independent across level transitions: a crest the coarser level
  smooths still produces a candidate, and the refinement decides at the
  canonical field.

  Why a pencil: parallel scan lines must take their direction somewhere, and
  wherever that anchor is snapped (eight texels, a quarter window, a full
  window), re-anchoring shifts the lattice phase by a fraction of a texel and
  can swap the band's major axis; with the intercept taken at the chart
  origin a 1e-4 radian direction change even moved every line at the window
  by forty texels. Each variant flipped a few per cent of the receivers near
  shadow edges in the single frame of a snap at a grazing sun (51 of 57
  flips in one approach run happened in that frame). The pencil has no
  anchor to snap.

- The two lowest distinct candidates (a mountain appears in every coarser
  level, so candidates closer than two texels apart are merged) are refined
  at the canonical field. No sample lies nearer the receiver than its own
  footprint: a crest inside one footprint belongs to the filtered receiver
  surface and casts no shadow at that filter scale (the former march began
  at the footprint for the same reason), and at camera distances where
  camera-relative f32 positions resolve metres a nearer sample would compare
  rounding against a centimetre penumbra, so the floor also carries a
  4096-ulp term (see the 28 October section). First a cheap scan of the cached field of the
  finest level resident at the binding distance, half a texel of that level
  apart across one texel of the candidate's level to either side (at most
  33 lookups),
  locates the crest; then three canonical samples half a fine texel apart
  around it, with the existing two-stage live evaluation (cached coarse
  bands plus the level's live bands, then the full spectrum when the
  estimate lies inside its envelope around the penumbra band), decide. The
  decision at the shadow edge is therefore canonical, and because the crest
  is located at the finest resident resolution it does not depend on which
  level produced the candidate: a ridge that crosses a finer window's far
  edge as the camera advances is refined the same way from either side
  (refining five samples at the candidate level's own spacing left crests
  tens of metres off and flipped receivers at every window step).
- Nothing depends on the camera: horizon texels are world texels, the
  binding distance is a property of the terrain and the sun, and the only
  footprint-dependent quantity is the occluder filter spacing within four
  receiver footprints of the receiver (`sun_sample_spacing`), which keeps the
  receiver's own neighbourhood filtered like the displayed receiver.
- Receivers without a canonical height (props, water) estimate it with one
  refined sample at their own point first; receivers no level covers march
  the canonical field with the former geometric progression from the sample
  floor (sixteen samples) and stay flagged unresolved. `shadow_steps` (1 to 64) bounds the
  canonical samples of a query (seven for two refined candidates); a smaller
  budget leaves candidates unrefined and raises the unresolved flag. Lit
  receivers need no samples at all, so `Test-Sun-Motion`'s former
  "exhausted work" gate became "work bounded by the budget" (a budget of one
  caps every receiver's work at one sample).

Declared approximations: an occluder lower than both candidates of every
level at the cached resolution is never refined; texels are owned by the
nearest lattice line, so a receiver's actual ray lies up to half a line
spacing beside the scanned line, inside the one-texel perpendicular band;
and the elevation along a parallel scan line (V beyond a million texels)
is taken as the arc from the line's end, exact up to the quarter-texel
deviation of those lines from the ray images. Two earlier attempts of this evening are recorded only here: a
hierarchical block walk that skipped blocks once the ray cleared the level's
full envelope (envelopes of 120 m at the 64 m level and 500 m at the 256 m
level made it sample every block near terrain and exhaust its budget), and
a search formulation of that walk (exact skips without envelopes, but a
mountain anywhere inside a coarse block kept every coarse test failing, so
rays crawled through 350-500 fine blocks). The sweep costs the same whether
the terrain is rough or flat.

`tools/Test-Shadow-Approach.mjs` is the regression test: a 3 km approach in
the rough view under an 8.6 degree sun, audited every frame with fixed and
pixel footprints, followed by a static footprint sweep (0.25 to 4 m) and a
phase sweep (1.0 to 1.1 m). Measured on the final build (1024 receivers, 225
to 234 of them shadowed): the phase sweep moves no receiver by more than
0.056 and the footprint sweep flips 3 (its smooth movers are the
receiver-footprint filter within four footprints, by design); over the
approach 34 receivers (3.3%) with the fixed footprint and 40 (3.9%) with the
pixel footprint changed by more than 0.5 at some frame, none unresolved.
Those are receivers near a shadow edge whose binding ridge crossed a
clipmap window edge as the camera advanced (the ridge changes resolution
and the refined candidates can differ); the gate bounds them at 5%. For
comparison the former march lost three quarters of the distant shadows at
pixel footprints and flipped receivers on a 10% footprint change. The
mountain test (`Test-Terrain-Shadow-Stability`, 576 receivers, 104
shadowed) passes every gate: altitude cuts reproduce the shadows to a mean
drift below 3e-5, and the sideways 2 km cuts (windows move) change under 1%
of the receivers and the shadowed count by at most 3. `Test-Shadow-Stability`
(translations up to 24 m) and `Test-Sun-Motion` (turn, rebase, edits, cold
cuts, contact) pass unchanged. Per query the final build evaluates 4 to 7
canonical samples (one estimate for receivers without a height, three per
refined candidate) plus 5 to 33 cached scan lookups.

## Far receivers, 28 October

The owner reported, after the horizon-map build: little dark dots on all the
land seen from orbit, whole window-shaped blocks of the disc changing as the
camera moved, and at medium distance a square patch of denser dots. Close
up the shadows were right. The solid-visibility diagnostic from the orbit
bookmark showed the land covered in per-pixel shadow noise except inside two
clean rectangles (clipmap windows), and the screen audit put 7 to 10% of the
terrain pixels in full shadow under a 67 degree sun.

The world audit gained a per-query trace (`sun_dbg`, slots 5 to 8 of each
row; a negative probe footprint selects the shading pass's contract, the
receiver lifted to its canonical height at that footprint and that height
passed as the start hint). It showed two defects that compounded:

- Every receiver carried a candidate from the 65 km level with a binding
  distance of 941 m, impossible for a level whose texels are 65 km apart.
  The pencil sweep assumed each line crosses the window on one side of the
  sun's vanishing point V, but the 65 km window contains V nearly always,
  the 16 km window whenever the sun is within about 33 degrees of the zenith
  at the eye's sub-point and the 4 km window within 9 degrees; with V
  inside, one half of every line was swept backwards (its suffix held the
  terrain behind the receiver) and the other half inherited the occluders
  beyond V. The crest margin of the coarse levels (about 3 km on the 65 km
  level: everything finer than a texel) then let those horizons pass as
  candidates at every receiver.
- The refinement sampled the canonical field as close as 0.5 m from the
  receiver. 9000 km from the camera a camera-relative f32 position resolves
  one metre, so the sample point rounded to a lattice point up to a metre
  off, its ray height differed from the receiver's by -2 to +2 m (the trace
  shows integer ray rises) and the field at the rounded point by as much,
  against a 5 cm penumbra: at the sub-point 26 of 128 receivers with a
  0.25 m footprint and 16 of 128 with the pixel footprint came out shadowed.
  The former march never saw this because it began a footprint away (16 km
  at that altitude).

Fixes (`sun_horizon_generate`, `sun_terrain`):

- A pencil line is split at V into two half-lines, each swept from its own
  sunward end (the reference ray through the far-from-V end and the
  three-texel exclusion around V that this fix introduced gave way the same
  evening to the exact impact-parameter sweep, see the next section). The
  angular spacing of the lines is one texel at the
  window corner farthest from V (before: at the chart origin's distance to
  V, which could leave lines tens of texels apart near a face edge at noon),
  a half circle of angles covers a window that contains V, and the dispatch
  allows 12 window widths of lines (the bound is 2 pi sqrt 2 widths).
- No sample lies nearer the receiver than `t_min = max(0.5, footprint,
  4096 ulp(|p|))` (the ulp term became a continuous ramp from 21 km the
  same evening, see the next section): scan and canonical samples below it
  are skipped at no
  cost, the scan minimum starts at `max(binding distance, t_min)`, and the
  off-cache march starts there. A crest inside one footprint belongs to the
  filtered receiver surface, so skipping it keeps shadow and terrain
  consistent at every distance; the ulp term (one metre at 9000 km, a
  millimetre at 10 km) only matters for callers with fixed small footprints,
  since pixel footprints exceed it at any resolution.

Evidence (`tools/Test-Shadow-Orbit.mjs`, evidence/local/shadow-orbit/v15b,
not committed): from the orbit bookmark 0 of 562 terrain pixels are
shadowed (30 unresolved: the limb beyond the eye's face chart, by design);
1536 world receivers at the sub-point and 1000, 2000 and 3000 km from it,
with 0.25 m estimated, 0.25 m hinted and pixel-footprint hinted contracts,
are all lit (0 shadowed, 0 partial, 0 unresolved, at most 7 canonical
samples); all 768 coarse-level candidates bind at least half a texel away;
and lowering the camera from 9000 to 7000 km (every window and footprint
changes) flips 0 of 512 receivers. The close-range tests are unchanged:
`Test-Shadow-Approach` passes with 31 fixed-footprint and 27
pixel-footprint receivers (3.0% and 2.6%) over 0.5 along the approach (34
and 40 before), the mountain, translation and sun-motion tests pass, and
the solid diagnostic captures at the orbit, horizon and cloud bookmarks are
clean (evidence/local/dots).

## Dusk from altitude and the cloud maps, 28 October (evening)

With the orbit fix on the published page the owner reported, from altitude
at dusk: cloud shadows streaking, a square where shadows were missing
(suspecting the cascades), and clouds getting darker or lighter while
orbiting with the sun fixed, also when zooming out.

Reproduction: orbit mode 3500 km above a point where the sun stands 10
degrees up, the terminator in view (`tools/Test-Shadow-Dusk.mjs` keeps this
view). The solid diagnostic showed straight-edged regions at the terminator;
the cloud-transmittance diagnostic showed blocky stretched columns there and
long smears. The world-audit trace, extended with the per-level horizon
clearances (slots 9 to 13 of a row; `audit_shadow_points` rows are now 14
vec4), found two defects in the sweep:

- The sweep read cached heights and wrote horizons at the window-relative
  texel index (`texel - low` mod n) while the height producer and every
  consumer use the absolute index mod n. Each horizon was therefore
  computed with the right terrain line but with the sun geometry
  (elevation, rise, vanishing point) of a place displaced by the window
  origin modulo the map size, toroidally: a few hundred metres at the metre
  levels, harmless, thousands of km at the 16 and 65 km levels. At the dusk
  receivers the 16 km level reported clearances of +13 to +17 km at 24 km
  binding and the 65 km level +40 to +65 km, so receivers whose only
  resident levels were those two (beyond the 4 km level's window, 1050 km
  from the sub-point) never had a candidate: ground with the sun up to 3
  degrees below its horizon stayed lit with zero samples. That lit edge was
  the square, and the cloud lookup of those receivers, whose ray dives
  underground and exits the cloud shell on the day side hundreds of km
  away, painted stretched global texels across them (the blocky columns).
- The rise of a line's reference ray, shifted radially to each receiver, is
  exact only while the reference ray stays near the ground: the error is
  `(start - rise_here) (cos e_i / cos e_b - 1)`, kilometres across a window
  spanning tens of degrees. The impact-parameter sweep described in the
  camera-independent march section replaces it: exact at all elevations,
  no reference ray, no singularity at V.

The numerical sample floor of the far-receiver fix (4096 ulps of the
camera distance) also changed: twenty ulps are a twentieth of the penumbra
4300 ulps out and reach the 5 cm penumbra floor 21 km from the camera, so
the floor is now zero nearer than that and ramps in as `0.00049 |p|`
between 21 and 42 km instead of stepping with the ulp at every power of
two. The step had moved across a mountain-test receiver's crest 3.6 m away
between 2 and 8 km camera distance (the exact sweep surfaced it by binding
that crest), flipping the receiver with the altitude.

After the fix, at the same receivers: with the sun 4 degrees up the 16 km
level clears by 1.2 km at 17 km and the 65 km level by 5.2 km at 67 km (the
ray's rise plus curvature), with the sun 0.3 to 2.8 degrees down the
clearances are -0.3 to -8 km at 49 to 320 km, and every such receiver is
shadowed with one sample. The terminator band keeps a speckle of lit and
shadowed pixels where the sun is within a degree of the horizon: the
occluder field is a point sample at a fraction of the penumbra, far finer
than the 3.7 km pixel, and whether the ray clears a hill is decided per
pixel. Keeping the occluder filter at the receiver footprint instead was
tried and reverted: it did not remove the speckle and it let the camera
distance move shadow edges (one receiver in a hundred flipped on altitude
changes in the mountain and approach tests, whose gates encode that
invariance).

Clouds. The sun cloud transmittance at fixed world points (ground and
3000 m) differed by 0.14 on average, and by 0.05 in the mean over a 300 km
patch, between the camera above them and 2000 km away with the sun fixed,
while terrain visibility did not change at all: inside the camera-following
local windows the clouds and their shadows come from puff-resolving maps,
outside from the global map, whose mean-density integration is biased dark
(the exponential of the mean against the mean of the exponentials). The
same bias made far decks opaque and dark as the view footprint grew, which
is the darkening on zooming out. `cloud_body` now returns, beside the body,
the correlation length of the octaves the filter dropped into the coverage
term (a quarter of each scale, amplitude weighted), and `cloud_medium`
treats such a path as a mixture of cells that are cloud with the body's
probability: effective extinction `-ln(1 - c (1 - exp(-sigma l))) / l`,
the plain density when nothing is unresolved. The view march and all three
bakes share it; the local volume cache is resolved and unchanged, and the
point quadrature of `sun_reference_cloud` stays independent. The local
bakes also filter at their own sample spacing (`max(footprint, ds)`, as the
view march does) instead of a quarter of it. After the change the patch
means agree between the two cameras within 0.03 (the sampling noise of 256
bimodal points), the global map's bias against the point quadrature on
cloudy terrain pixels went from -0.085 and -0.054 in two views to +0.016
and balanced counts, and the brightness of a 600 km square at the
sub-point varies by 0.01 between 1500 and 24000 km (0.330 to 0.323; the
whole disc darkens with altitude because more limb and terminator enter
it). The far decks look the same at the orbit bookmark, slightly whiter in
the mottled regions.

The global chart: the exit point of a grazing ray barely moves as its
ground point moves, so the Lambert equal-area chart spent 0.6 texels per
degree of ground elevation at the terminator against 2.3 at 5 degrees up,
and dusk shadows were stretched fourfold along the sun. The chart radius is
now uniform in the ground elevation of the ray (one texel about 0.35
degrees, 40 km along the sun at every distance from the terminator), with
an outer ring, uniform in perigee height, for the rays that pass above the
ground inside the shell; `Test-Cloud-Sun-Geometry` checks the round trip
and the continuity at the ring. Dusk shadows are still 40 km smears along
the sun near the terminator: that is the map's resolution, and a terminator
strip map (azimuth by perigee height) would be the next step.

Far receivers march the cloud field themselves. With the maps statistically
consistent the owner still saw decks darken while orbiting: the view
resolves a deck at its 10 to 20 km pixel footprint, but its shadow came from
the global map's 40 km texels (or, inside the camera-following 1057 km
window, from 4 km texels), so the ground around every resolved deck carried
a smeared shadow, the deck's own darkness showed through where the view
thinned it, and both changed as the window moved with the camera. The map
resolution cannot follow the view (a 1024 texel global map would cost 67 MB
and four times the bake), so `sun_cloud_receiver` marches the sun ray of
any receiver with a footprint beyond a kilometre (a thousand kilometres from
the camera) through the eight knot shells with the receiver's own footprint,
one `cloud_field` evaluation per shell segment while the segment is shorter
than the footprint and up to eight along the hundreds of km of a grazing
ray's segments (a single midpoint made the shadow jump as the sun moved:
the grazing-sun sweep's jump excess rose to 0.26 at its 99th percentile
against a 0.12 gate, and is 0.05 or less with the subsamples), the same
filtered field and mixture statistics the view integrates, blended in over
footprints of 1 to 2 km; cloud samples and near receivers keep the maps. The sun transmittance
of 256 ground receivers at the pixel footprint is then identical from a
camera above them and from 2000 km aside (it differed by 0.15 on average),
and the screen audit's map-versus-point-quadrature difference on terrain
fell from 0.095 and 0.108 (two views) to 0.045 and 0.053. Against the point
quadrature the march keeps a net bias of +0.06 on cloudy pixels (476 of two
views): +0.15 where the reference is dark, since the coverage term saturates
slowly under dense decks, and -0.24 where the reference sees no cloud; that
is the field model's statistics, shared with the view, and the dusk test's
gate allows 0.08 (the former mean-density map sat at -0.085). From orbit at
1080p the shading, water and scenery stages together cost about 1.1 ms
more.

Orbit zoom now stops at 200 Mm from the planet's centre: the renderer's
bounded body-local camera rejects coordinates beyond 250 Mm, and zooming
past it failed the page with "invalid bounded body-local camera".

Cost: a full horizon sweep rose from about 3.0 to 3.5 ms (per-texel arc
geometry), static frames stay at 0.13 ms; the cloud bakes are unchanged.

Evidence (evidence/local/shadow-dusk/v19 and the v19 runs of the other
tests, not committed): `Test-Shadow-Dusk` passes its five gates (68
night-side receivers all dark, 141 coarse horizons all with negative
clearance, 320 receivers where the 4 and 16 km levels agree, 4 of 512
receivers changing from a camera 700 km aside, cloud-map bias +0.042 over
541 cloudy pixels); `Test-Shadow-Orbit` is unchanged (0 of 562 pixels and
0 of 1536 receivers shadowed, 0 altitude flips); `Test-Shadow-Approach`
passes with 32 fixed-footprint and 25 pixel-footprint receivers changing by
more than 0.5 along the approach (31 and 27 before) and no footprint-phase
change; the mountain test's altitude cases change by at most 0.023 (one
receiver had flipped by 0.9 until the sample floor ramp) and its shifts,
the translation and the sun-motion tests pass. The cloud tests (sun
grazing, terminator, shell, surface stability, visibility weather, coverage
edge, banding, explorer clouds, sun geometry) pass with the mixture
statistics and the new chart. Two paths were tried and rejected on the way:
an unsigned arc in the sweep (right for pencil halves, which start at their
far-from-sun end, wrong for the parallel lines of the fine levels at low
sun, which start at their sunward end: the approach and mountain tests
caught it), and the occluder filter at the receiver footprint at every
distance (above).

## Clouds missing over one side of the screen, 28 October (night)

The owner's recording of an orbit in a 738 x 588 window (the high preset,
clouds at half resolution) showed decks fading out while their shadows
stayed on the ground, always over the same part of the planet as seen on
the screen, and more cloud samples did not help. The previous fixes of this
evening (the cloud maps, the far-receiver march) had changed the shadows,
not this.

Reproduced headlessly with the same window: four rolls of one camera
16.5 Mm from the centre (the same rays, the screen rotated by 90 degrees),
the cloud buffer binned by the terrain cell under each pixel. Across rolls
21 to 23% of the planet's pixels were drawn clear where another roll drew
an opaque deck, 37 to 50% in the left screen sectors against 8 to 13% on
the right, the same screen sectors in every roll; at full cloud resolution
the differences were 0.1 to 8% and rotated with the roll (partially cloudy
cells, the metric's own noise). The march trace (`cloud_diagnostic` 2048:
bins integrated, path integrated, opaque limit minus shell entry,
transmittance) showed the cause: toward the upper left of the planet the
march integrated 0 bins, then 10, 23, 32, 40 and 49 along the diagonal to
the centre (50 at the centre, 11.2 km of path), because the opaque limit
the texel read was below its own cloud-shell entry: 36.6 km below at 0.98
of the disc radius, 3.2 km below at 0.74, 6.5 km above (of 13 km) at 0.49.

Below full resolution a cloud texel's ray passes through the corner shared
by the four full-resolution pixels around the texel centre, and the pass
read the opaque limit of one of them, the pixel to the lower right of the
ray: the terrain under a ray half a pixel away. From orbit the terrain
distance changes by about 12 km per pixel at half the disc radius and by
over 100 km per pixel near the limb (in a 738 x 588 window; the gradient
per pixel halves when the window doubles), so for every ray on the
upper-left side of the planet the limit fell short of the shell entry by
more than the slant crossing, the march ended before the clouds and the
texel kept its shadow alone. On the lower-right side the limit was too far
and the march overshot harmlessly into the ground. The minimal preset
(render scale 0.5, clouds at a non-integer ratio of the render size) put
the pixel centre before the ray and lost clouds on the right instead.

`cloud_limit` now interpolates the limits of the four pixels around the
ray (bilinear at the ray's own pixel coordinate; at full resolution the
weights select the pixel itself, so nothing changes there), leaving sky
pixels out so that terrain pixels keep a terrain limit and the composite's
validity test sends the sky pixels to their own march as before. The far
pass keeps the farthest limit of its block, its documented contract.

Evidence (`tools/Test-Cloud-Orbit-Limit.mjs`, 738 x 588, high and minimal
presets, `evidence/local/cloud-orbit-limit`): with the fix 0 of 32,202
(high) and 0 of 2,011 (minimal) cloud texels inside 95% of the disc radius
integrate under 8 km of the crossing and none has a limit before its shell
entry; the left-minus-right missing fraction over four rolls is 0.0002 and
0.0039, and roll 0 against roll 180 shifted by half a turn differs by
0.0003 and 0.012 (the remaining 9.4% and 14% is the world-fixed residual
of the metric). The same test on the previous limit fails: 9,038 of 32,202
texels short with 2,384 limits before the entry (80 to 84% of the left
sectors), left-minus-right 0.27 at the high preset; 341 short and 160
before the entry at the minimal preset. The fix costs four position and
sea reads per cloud texel instead of one at reduced resolution: the cloud
stage from orbit at 1080p on the high preset measured 13.2 ms static and
13.0 ms nudged in this chain against about 12 ms the previous evening (same
script, serial runs; a single-run figure, not a percentile). The shader
check, the native probe with its nine audits, the terminator, coverage-edge,
shell, height, weather-visibility and shadow-orbit tests, packaging and the
deployment test passed in the same chain.

## Cloud self-shadowing hand-over, 28 October (night)

The owner reported a seam that advanced with the camera: the cloud detail
level changed at a fixed distance, self-shadowing appearing on the near side.
Widening the hand-over alone turned the seam into a greyer zone near the
camera with a band of deeper cloud shadows on the ground at the hand-over
distance, which the owner also rejected.

Cause. Cloud sunlight came from two nested local profile maps, 256 m and
4096 m chart spacing, and the fine map handed over to the coarse one between
104 and 126 texels from its centre (27 to 32 km): a x16 resolution step in
5.6 km. In a 4 km texel a cumulus is one texel and its light is the regional
mean, brighter inside a puff than the resolved light of the fine map, so the
two maps differ in mean brightness and no crossfade between them is
invisible. Measured against the reference sun quadrature (`cloud_diagnostic`
256) on the same cloud texels, in a cumulus field (`cloud_type` 1,
`cloud_cover` 0.55) from 20 and 22 km altitude with the view reading the maps
directly (above the local volume): fine map 0.960 and 0.982 of the reference
luminance, coarse map 1.060 and 1.035 (scratch `cloud_truth.mjs`,
evidence/local/cloud-crossfade/truth3). The local volume's own edge is not
the seam: with the cache bypassed the image differs by 0.003 in luminance.

Fix. A third local map at 1024 m spacing sits between the two (x4 steps,
like the height clipmaps; 258x258 texels in 24 RGBA16F layers, 12.8 MB in
all, 4.3 MB more), and the fine and middle maps hand over from 48 to 126
texels (12 to 32 km and 49 to 129 km) instead of 104 to 126. The middle map
measures 0.972 and 0.999 of the reference on the same texels, so the step the
camera carries with it is 1 to 2% of luminance spread over 20 km, and the
remaining 3 to 6% step to the coarse map is spread over 80 km. The coarse
map keeps its narrow band to the global chart (426 to 516 km). The fine map
reads 2 to 4% darker than the reference everywhere, a constant offset, not a
transition; its knot interpolation is the suspect and remains open.

Evidence. `tools/Test-Cloud-Crossfade.mjs`, on the new `cloud_diagnostic`
4096 (the density-weighted local-volume weight, fine-map weight and fine-map
edge coordinate of the march, with its opacity): at a ground, an in-layer and
a 15 km view the fine weight falls from 0.9 to 0.1 over 47 to 54 texels (a
smoothstep falls over 0.61 of its 78-texel width), against 14 to 29 texels
with bit 8192 (the former hand-over). Cost, back to back in one session at
1080p on the high preset (p50 of 160 frames each, scratch `ab_timing.mjs`,
evidence/local/cloud-crossfade/ab-timing-3levels): clouds stage 1.86 against
1.74 ms (forest), 6.03 against 5.80 (forest looking up), 4.87 against 4.65
(in the layer), 5.34 against 5.14 (15 km); shading within 0.05 ms; the
middle map's sweep is inside the 0.014 ms `sun_cloud_local` stage. Frame
spans were 13.5 to 16.3 ms; earlier runs the same evening measured 43 to 65 ms
for every stage alike while the owner's own session shared the GPU, which is
why the cost is only reported from the back-to-back run. Diagnostics: 4096 as
above, 8192 the former hand-over, 16384 no fine map, 32768 no fine or middle
map. The shader check, the unit tests, the native probe with its nine audits,
the near-water, explorer-water, cloud crossfade, orbit-limit, terminator,
coverage-edge, shell, height, weather-visibility, integrated-reuse and
shadow-orbit tests, packaging and the deployment test passed in one chain
after these changes.

## Exact cached march replaces the horizon maps, 15 November

The owner reported terrain shadows at the Matterhorn that flickered with the
camera still and showed lit, straight-edged shards inside the mountain's
shadow. 08e71c0 had widened the refinement scan and cut the oscillating
pixels from 0.5% to about 0.05% at a pinned 13:10 UTC sun, but the shards
remained in single frames, so the cause was not only drift.

Diagnosis (temporary shadow diagnostics, Matterhorn, sun pinned at 13:10 UTC,
the page loop recorded with `Page.startScreencast`):

- With the canonical refinement switched off, the horizon maps alone put the
  sunlit north-east face in deep shadow, and their verdict changed from frame
  to frame. The maps were not a usable occluder model near steep ground: a
  texel's horizon took the highest of three samples one texel either side of
  its scan line, so on a cross-slope the uphill sample one texel ahead became
  an occluder for almost every receiver.
- Those near false crests have tiny penumbrae, so they always ranked as the
  best candidates and pushed the real binding crest (the summit, kilometres
  away) out of the two that were refined. The refinement then cleared the
  false crest and the receiver came out lit: the shards. Their straight edges
  are texel and scan-line boundaries.
- As the sun drifts, each re-sweep moves the pencil about its vanishing point
  by a fraction of a texel, so which crest a texel bound changed between
  sweeps: the flicker.

No margin on the horizon maps fixes this; the candidate list was the wrong
structure. Terrain visibility is now an exact march of the sun ray over the
cached height clipmaps (`sun_terrain` in `sun_visibility.wgsl`):

- **Samples on a world-fixed lattice.** Distances from the receiver every
  0.25 m out to 208 m, then 0.12% of the distance (a fixed part of the
  penumbra), at a power-of-two stride that reads each level about twice per
  texel. The camera moves only the sample floor (the receiver footprint) and,
  through the camera-centred windows, the level; it never slides a sample
  along the ray, the defect of the march of 27 October. Nothing nearer than
  the first stride multiple is sampled: inside half a texel of the level read
  there, a coarse level only interpolates around the receiver. Sampling that
  near field anyway (at powers of two, and again with the coarse surface
  re-anchored to the receiver's height) made 27 to 35 of 1024 receivers flip
  with the footprint in `Test-Shadow-Approach`, for no information the level
  holds.
- **Level by spacing.** A sample reads the finest level whose texel is at
  least its spacing (1 m to 833 m, 4 m to 3.3 km, 16 m to 13 km, ...), or the
  finest resident one beyond that level's window, blended toward the next
  coarser level across a window's last 32 texels, so a sample's height never
  jumps when a window boundary crosses it.
- **Continuity.** Every quantity is a continuous function of the receiver,
  the sun and the cached heights, and nothing cached depends on the sun.
  The visibility is the minimum over samples of
  `smoothstep(-penumbra, penumbra, clearance)`, so a drifting sun moves edges
  continuously.
- **Block maxima, not horizons.** Per level and texel, the highest cached full
  height in its 4, 16, 64 and 256-texel blocks (aligned to absolute texel
  multiples, each over the block and one texel past its high edges, so it
  bounds the bilinear height at every point of the block).
  `sun_height_blocks` reduces each 16-block, `sun_height_maxima` writes every
  texel's four maxima; both run only for a level whose texels changed (a
  window scroll, a refill, a reset or the shadow switch), never for the sun.
  They replace the horizon sweep and its sun re-sweeps. Same texture, same
  bindings (95, 96), plus a 16-block buffer of 39 KB (binding 97).
- **Exact skipping.** The march jumps a block only when its maximum stays
  below the ray, over the whole block, by more than the penumbra plus the
  level's sub-texel crest margin (`height_errors.w`). Such a block holds no
  sample that could be refined or become a minimum, so the jump changes
  nothing. A jump stops where the level's blend band begins and where the
  level changes; inside a blend band it uses the larger of both levels'
  blocks and the coarser level's margin. The march ends when the rising ray
  is above every cached height (`sf.ceilings`) by the penumbra and margin
  while climbing faster than the penumbra widens.
- **Canonical samples after the march.** The lowest minimum of the normalized
  cached clearance, when its clearance is within the penumbra plus the crest
  margin, is evaluated on the canonical field at its lattice point and its
  two neighbours. The runner-up (a distinct crest) keeps its cached
  visibility. A sample deeper than that band is confirmed with one canonical
  sample: shadow if it holds, otherwise the march resumes past it (at most
  three times). These canonical samples run in a short loop after the
  march, not inside it: inside, each lane of a workgroup reached its
  canonical samples on a different iteration and the GPU ran the expensive
  evaluation once per distinct iteration (17.7 ms of shading at the
  Matterhorn against 11.4 ms with the same samples after the march).

The two block walks recorded under 27 October failed for reasons this design
avoids. One skipped on the full envelope (120 m at the 64 m level); this one
skips on the crest margin, consistent with the band it refines. The other
crawled through hundreds of fine blocks around a mountain; here a sample
reads the level its spacing calls for, so far samples meet coarse blocks.

Declared approximations: apart from the lowest minimum and the confirmed
samples, the cached field is the occluder model, so a crest the cache misses
by more than the level's crest margin (a spectral estimate, not a bound, on
measured bodies) is missed. A crest within half a texel of the level resident
at the receiver is not seen; that distance depends on the camera-centred
windows (about 2 to 8 pixel footprints for receivers beyond the finest
window at 1080p). Receivers no level covers march the canonical
field as before and stay flagged unresolved, as do receivers whose march
exceeds `SUN_MARCH_LIMIT` (384) steps. Terrain on another cube face than the
eye's is not cached, as before.

Evidence:

- **Brute-force reference.** A temporary mode with no block skipping and a
  20000-step limit, at the Matterhorn at 13:10 UTC. The final build matches it
  by eye on the whole view: no shards, and the same edges. One intermediate
  build showed a lit tongue below the lit face that the reference did not; it
  came from receivers hitting the step limit before reaching their crest, and
  disappeared once jumps were allowed inside blend bands (exact with the
  larger of the two levels' maxima).
- **Temporal stability, camera still.** The share of oscillating pixels over
  2.5 s of real-time frames (total variation minus net change above 0.3), at
  1280 x 720 High:
  - before: 0.054% at 13:10 UTC, 0.005% at 14:40 UTC;
  - after: 0.002% and 0.000%.
  The 0.002% is one sampled pixel, the HUD clock's digits; no terrain pixel
  oscillates.
- **Regression tests**, on the final build:
  - `Test-Shadow-Approach` passes. The footprint sweep flips 0 receivers and
    the phase sweep moves none (27 October: 3 flips and 0.056); over the
    approach 8 fixed and 11 pixel-footprint receivers change by more than 0.5
    (horizon maps as recorded on 27 October: 34 and 40; the audit could not
    run on the horizon-map build of this date).
  - `Test-Terrain-Shadow-Stability` passes. Altitude cuts drift by at most
    6e-4. The +2 km sideways cut moves 4 of 106 shadowed receivers one way,
    each shadowed by a crest 8 m away at the test's 0.25 m footprint, 7 to
    9 km from the camera, where the resident level coarsens from 16 to 64 m.
    The pixel footprint there is about 8 m. Its net-count gate was 3% of the
    shadowed count (3.2) for the horizon maps; it is now the same 1% of
    receivers as its flip gate.
  - `Test-Shadow-Orbit`, `Test-Shadow-Dusk` and `Test-Sun-Motion` pass. Their
    gates on horizon binding distances and clearances, which read trace
    slots that no longer exist, became gates that every probe resolves (the
    march finishes): 0 of 1536 at orbit, and 0 of 76 under a grazing sun at
    dusk.
  - The shadow audits these tests use failed to compile before this change
    (the audit modules took a partial shader source without the buildings
    file). They now use the build's specialized `sun_audit` and
    `sun_world_audit` programs, like every pass, compiled only when an audit
    runs.
- **Cost.** Interleaved base and march runs (`tools/Trace-Flight.mjs`,
  1920 x 1080 High, 14 s per scene summarised after 8 s, immutable
  snapshots). The base is 08e71c0 with its horizon maps. Background GPU from
  other processes read 15% before the runs (not logged per run). GPU frame
  p50 / p95 and the
  shade stage p50, base -> march, two pairs each on the final build:

  | Scene | GPU p50 | GPU p95 | Shade |
  | --- | --- | --- | --- |
  | `earth-matterhorn` | 42.0, 42.6 -> 41.8, 42.0 ms | 46.0, 45.7 -> 45.4, 45.5 ms | 10.6, 10.8 -> 11.7, 11.6 ms |
  | `earth-mountain` | 36.5, 37.2 -> 38.8, 38.3 ms | 40.7, 41.3 -> 42.0, 41.8 ms | 6.1, 6.3 -> 8.7, 8.7 ms |
  | `mars-arrival` | 12.0, 11.6 -> 11.2, 11.3 ms | 13.7, 13.3 -> 13.7, 13.3 ms | 5.8, 5.6 -> 5.9, 6.0 ms |
  | `earth-hover` (build before the last test fixes) | 51.7, 50.8 -> 49.5, 48.7 ms | 54.8, 53.6 -> 52.4, 51.5 ms | 5.7, 5.8 -> 5.3, 5.1 ms |

  The march costs more in the shade pass than the horizon lookup did, and
  the frame gains the horizon sweep back (0.5 to 0.7 ms, re-run every third
  frame while the sun drifts; the block maxima cost 0.05 ms and run only when
  terrain changes). Mountain flight is the one scene that got slower:
  +1.2 ms of frame p50, +2.5 ms of shading. The development steps, Matterhorn
  shade p50:
  - first march, blocks up to 16 texels and canonical samples inside the
    march: 29 ms;
  - blocks to 256 texels, incremental level state, closed-form ray height:
    18 ms;
  - the same with every canonical sample switched off: 10.3 ms;
  - canonical samples after the march: 11.4 ms.
- **Diagnostic:** `shadow_diagnostic` 7 shows the march's work: red is steps
  over `SUN_MARCH_LIMIT`, green is block jumps over 128.

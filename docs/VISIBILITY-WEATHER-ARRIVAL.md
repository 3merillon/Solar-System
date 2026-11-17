# Visibility, tall cumulus and arrival timing — 26 October 2026

## Opaque depth takes precedence

The distant shoreline proxy wrote reverse depth `1`, so it won against nearer
terrain and props and could select overlapping ocean fragments by draw order.
The water compositor then blended shoreline coverage back in even when the
metric water hit was behind the first opaque surface. Both overrides are gone:
the ocean writes its actual reverse depth, and shoreline filtering can only
reduce coverage of an already visible water interface. Foam shares that result.

The private browser baseline reproduced 4,520 contaminated foreground pixels
in the rough view. The corrected same-frame shaded/water comparison tested
444,824 forest, 407,551 coast and 322,727 rough foreground pixels with zero
differences; 10,733 visible water pixels remain in the rough view. Tests use
the rendered depth and HDR buffers, not a screenshot classifier.

## Cloud height and horizon integration

Cumulus weather thickness increases from at most 5.2 km to 10 km. The base is
bounded by 1,320–1,780 m, giving a weather ceiling of at most 11,780 m. The
shared ray/shadow shell ends at 12,500 m. Stratus retains its 650 m thickness.
This is a change to the procedural weather model, not a terrain change.

Upper cumulus mass erodes into rounded summits and adds a filtered 1,024 m puff
band instead of remaining opaque up to a flat layer ceiling. The extra band's
bounded amplitude is included in the empty-density early-out. For pure cumulus,
the maximum remaining mass is already below the density threshold by normalized
height 0.9; the weather roof cannot slice an occupied cap there. Intermediate
weather still blends with the flatter stratus regime.

The local volume doubles from 64 to 128 vertical slices, preserving 128 m
vertical spacing and reaching 16,384 m. Its additional owned payload is exactly
8,388,608 bytes. All upper cache faces still blend to the canonical field. The
allocation ledger includes the increase. Cloud optical-profile integration is
clamped to its compact support to avoid cancellation outside the layer.

Long view-ray intervals integrate density **and** incident lighting at eight
subintervals. Their contribution blends continuously into the original midpoint
estimate over 128–512 m interval lengths. Averaging only density left lighting
stripes. Pixel-frequency filtering remains independent of interval length and
opaque-depth truncation. A nominal step can now perform up to nine field queries
in the transition range; this costs work rather than hiding undersampling with
history. The maximum remains bounded by the selected step budget.

Sun maps use boundaries 12,500, 9,500, 6,500, 4,500, 3,500, 2,500, 2,000,
1,700 and 1,300 m. Local intervals use 16 samples, doubled in the two broad
upper intervals; the global disk uses 4/8 at its coarser footprint. Both
average the thin vertical envelope over each sample span. Radial optical depth
uses monotone cubic interpolation; lateral filtering still averages transmitted
light. Grazing nonmonotone chords use 128 samples. All use the same weather,
puff density and expanded shell. No stochastic sample phase or shadow history
is introduced.

## Time and camera motion

The UI now accumulates elapsed presentation time until a render submission is
accepted, separately from the bounded movement and wave-simulation steps.
Previously the busy worker rejected most UI frames and lost their time; shaders
also clamped fade/morph progression to 50 ms. Presentation backlog is capped at
one second, already longer than any visual fade, and reset when paused.

New props start faint when support actually becomes available. Their normal
fade lasts 120–650 ms depending on distance. Translation and camera turning
shorten that duration to a minimum of 80 ms based on expected view transit.
Progress is monotone and measured in elapsed seconds; speed never bypasses the
initial fade or resets an already visible object. Meshes and impostors use the
same appearance value and stable dither masks. Generation and support remain
prerequisites; these changes do not fabricate an unavailable tree or rock.

Terrain advances one shared morph clock up to 32 times faster according to
metric travel speed and clearance. An 80 ms exponential speed memory carries
acceleration through a stop. Shared vertices, monotone cubic endpoints, carried
derivatives and endpoint bounds are unchanged. Finished geometry cannot revert
to an earlier morph phase when the camera slows. This addresses pending
transitions; it cannot finish work still in the bounded generation queue.

## Reproduction and limits

The compact evidence report (`evidence/visibility-weather-arrival.json`, development repository only) records
per-run build identities, assertions, reference errors and measured costs.
The water before (`evidence/visibility-weather-arrival/water-before.png`, development repository only),
water after (`evidence/visibility-weather-arrival/water-after.png`, development repository only) and
tall cumulus (`evidence/visibility-weather-arrival/tall-cumulus.png`, development repository only) captures
are retained with it.

Prepared terrain had a 2,923.65 m endpoint gap in the deliberately cold,
coarse test. With new generation frozen, fast travel finished that prepared
shape exactly (zero remaining gap), retaining closed shared topology. At the
0.1-second checkpoint, all 238 matched distant props faded faster during fast
travel. Both 5 FPS and 60 FPS cases finished available props within 0.8 seconds.

Eight view subintervals reduced the tall-cap HDR mean error against the direct
reference from 0.00541 to 0.00307 and p99 from 0.07096 to 0.03890. Other poses
retain cache/density approximation error; local edge outliers are larger. The
partial-shadow sweep's worst p99 discrepancy in a small sun-motion increment
was 0.05785. Absolute shadow-reference error is still material in some regions
(worst tested p99 0.289); smoother motion is not exact shadow reconstruction.

Serial BrowserWebGpu measurements on this machine at 1920x1080, full/128 cloud
settings and animated weather used 180 warmup and 120 measured frames per view:

| View | Whole-frame GPU p50 / p99 | Cloud-ray GPU p50 |
|---|---:|---:|
| Forest | 74.80 / 78.81 ms | 24.14 ms |
| Coast | 69.23 / 72.26 ms | 22.80 ms |
| Clouds | 91.93 / 93.23 ms | 51.59 ms |

Controlled GPU payload at that resolution is 961,987,872 bytes. These results
do not meet 60 FPS. They quantify the current quality setting, not a controlled
performance comparison with the preceding weather model.

Run GPU checks serially using the existing local server:

```powershell
./tools/Check.ps1
./tools/Build-Explorer.ps1
node tools/Test-Flight.mjs
node tools/Test-Visibility-Weather.mjs evidence/local/visibility-weather-final-eight
node tools/Test-Arrival-Timing.mjs evidence/local/arrival-timing-prepared
node tools/Test-Cloud-Sun-Grazing.mjs evidence/local/cloud-sun-grazing-partial
node tools/Test-Cloud-Shell.mjs evidence/local/cloud-shell-tall
node tools/Test-Explorer-Water-Interface.mjs evidence/local/water-interface-visibility
node tools/Package-Explorer.mjs
node tools/Test-Explorer-Deployment.mjs --local evidence/local/visibility-weather-package
node tools/Measure-Weather-Visibility.mjs evidence/local/weather-visibility-cost
cargo +1.87.0 run --release -p solar-explorer -- --view clouds --width 640 --height 360 --frames 3 --warmup 30 --frozen --output evidence/local/visibility-weather-native-eight
```

Tests exercise equal elapsed time at 5/60 FPS, blocked submissions at 5–144 FPS,
late availability, fast transit, stopping, shared topology, analytic shell
length, tall caps, and a moving low sun against independent 256-step quadrature.
Raw captures and source/binary manifests live under ignored `evidence/local/`.
These finite cases do not certify every silhouette or low-angle light path.
Coarse shadow maps, finite cloud quadrature and the experimental shoreline
geometry approximation retain sampling error. Higher caps and denser integration
cost GPU work; this pass makes no frame-time improvement claim.

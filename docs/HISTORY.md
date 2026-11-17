# Development history (research phase)

This is the log of the research phase that preceded Solar-System v2, kept for its measurements
and decisions. Paths under `evidence/` refer to raw captures and reports kept in the private
development repository; they are not part of the published source.

The approved [Halley player vehicle](VEHICLE.md) is the default game at `http://127.0.0.1:5198/`. Its full interior and mechanisms stream through compressed Draco LODs, with Rust/WASM Rapier terrain/scenery/building collision. **X** changes drive/flight, **F** brakes, **B** changes cockpit/orbit camera. Flight and swimming use camera-relative WASD, Space/C and Q/E; W turns toward the view. The game includes bounded fluid thruster smoke, tire tracks and grass compression, procedural audio, and continuous local/solar-system flight. Ground cover reaches 220 m on High / 260 m on Ultra and scenery appears through pixel dithering. See the vehicle contract for controls, bounds, tests and measured limitations. `?vehicle=0` retains the terrain viewer.

The local [10 November game optimization](OPTIMIZATION-2026-11-10.md) removes
redundant vehicle shading, animation allocations and unchanged urban uploads.
Repeated 1080p High measurements improve median GPU time about 4% in the parked
forest, 8–9% in low flight and 15–16% in the airborne cockpit, with defaults and
content unchanged. Unchanged source refreshes no longer invalidate collision
coverage. Stable 60 fps and faster startup remain unmet; live Solar System costs,
memory tradeoffs and regression evidence are reported separately.

The second scenery pass (4 November 2026; [SCENERY.md](SCENERY.md) "Second pass") grows
fifteen tree species at three ages on the GPU (trunk, limbs, branches, twigs, a procedural twig-and-leaf card atlas,
bark per fragment, translucent leaves, layered wind), six rock families from pebbles to 36 m boulders with footprint
support, a ground-cover layer of grass, reeds, pebbles, ferns and bushes placed on the water layer, climate biomes, and
rocks on the Moon, Mars and other solid bodies. Trees and rocks cost about 9% more GPU time than the first pass at the
same density in the original measured view (the "at least as fast" target was missed by about 0.25 ms); the original short-reach ground cover added 0.84 ms;
rock impostors pass their gate, tree impostors do not. Next steps: `docs/NEXT-CONTEXT-TREES-ROCKS-3.txt` (development repository only).

The local [whole-renderer performance pass](PERFORMANCE-PASS-2026-10-27.md)
(27 October 2026) adds quality presets (ultra, high, medium, low, minimal) with
per-feature settings, allocation tiers for weak devices, and a deferred
startup that shows the first image at about 4.7 s cold instead of 11.7 s
([startup notes](STARTUP.md)). The high preset renders the forest, coast
and cloud views 25-29% faster than the previous checkpoint at the same
settings; cloud regions differ from it by a few display codes because sunlight
is cached per voxel, everything else matches exactly. Mobile hardware was not
available; device detection and the minimal tier were validated on the desktop
GPU only. The same evening replaced the terrain shadow march with per-frame
sun horizon maps swept over the height clipmaps (the former march scaled its
sample positions with the pixel footprint, so shadows crept as the camera
moved; see [SUN-SHADOWS.md](SUN-SHADOWS.md)), made half-size
64-sample clouds the high preset with ultra keeping the full-size 128-sample
reference, and filtered the procedural far clouds at their sample spacing.

The local [integrated performance pass](INTEGRATED-PERFORMANCE.md) reuses
unchanged sun profiles and completed prop support, shares light-chart setup,
and records whole-frame and individual cascade costs. Matched animated 1080p
rounds improve 6–13%; moving workloads benefit less and 60 fps remains unmet.
Full/128 cloud defaults remain. A guided 64-step a-trous trial was rejected.
The pass also found stale 32-knot shaders inside the starting WASM despite its
source manifest; builds and packaging now verify embedded shader provenance.
The owner approved committing and publishing this qualified pass on 26 October 2026.

The [terminator repair](CLOUD-TERMINATOR.md) removes the per-sample grazing
shadow march and replaces the distorted global projection. The original task
brief is preserved in this performance-pass prompt (`docs/NEXT-PERFORMANCE-PASS.txt`, development repository only).

The latest local [visibility, weather and arrival repair](VISIBILITY-WEATHER-ARRIVAL.md)
fixes distant water painting over foreground terrain/props, extends cumulus
headroom, improves horizon and low-sun integration, and makes prop fades and
terrain morph timing respond to elapsed time and camera travel.

A playable Earth-sized procedural planet in **Rust -> WASM -> WebGPU/WGSL**, with a separate native wgpu validation backend. The active implementation uses one radial terrain surface, adaptive conforming triangle patches, cached GPU generation, water, clouds, atmosphere and GPU-procedural trees/rocks. Selection, balancing, allocation, generation, shared topology, morphing and indirect draw commands stay on the GPU.

The archived field-ray renderer is preserved at commit `fe0c78a` of the development repository. Work continues on the single-skin explorer. Geometric waves, GPU ripples/foam, underwater optics and cloud controls are implemented. Procedural conifers, broadleaf forests, geological rocks and runtime impostors are implemented. Scenery quality/performance limits remain explicit in [SCENERY.md](SCENERY.md), `HANDOFF.md` (development repository only) and the [contract](SINGLE-SKIN.md).

The shared-surface-detail follow-up repairs cloud layer caching and adds **Distant shoreline detail (experimental)**, now enabled by default at the owner's request. See [qualification and limits](SURFACE-DETAIL-CLOUDS.md). Cloud wrap/precision fixes and the new 4x terrain default are documented [here](CLOUD-SHELL-CONTINUITY.md). The owner approved publishing that follow-up on 26 October 2026. The subsequent local [surface continuity and cloud-edge repair](SURFACE-CONTINUITY.md) carries the same field into nearby terrain and protects distant detail during descent.

The local [sun-shadow implementation](SUN-SHADOWS.md) adds canonical terrain
visibility, six stabilized tree/rock shadow maps, registered cloud shadows and
cloud self-shadowing, and shared direct sunlight for water and scenery. It also
replaces stretching cloud advection with spherical motion and removes hard
local-cache transitions. Shadows default on; quality, budgets, reference errors,
motion evidence, and browser costs are documented separately from guarantees.

## Play

The existing preview is [localhost:5198](http://127.0.0.1:5198/). Reuse the running server. Since 4 November 2026 it opens on the solar system at real Earth, with water as its own layer ([WATER-LAYER.md](WATER-LAYER.md)); `?body=earth` gives real Earth only, `?body=procedural` the procedural planet, and `?water=old` the earlier water path. To build the current source without starting another server:

```powershell
./tools/Build-Explorer.ps1
```

For a fresh checkout, `tools/Run.ps1` builds and serves it. Required tools are Rust 1.87.0 with the wasm32 target, wasm-bindgen-cli 0.2.128 and Node. The browser needs WebGPU. Terrain renders at the displayed native resolution; terrain temporal AA is absent.

Planets-style flight uses right mouse look, WASD movement, Space/C camera-local ascend/descend, Q/E roll, and Shift for 3x speed. On touch devices (`web/touch.js`) a left thumb stick feeds the same displacement vector with analog deflection, hold buttons ascend, descend and boost, a vertical throttle (and − / + buttons that repeat while held) sets the travel speed, a one-finger drag looks (orbits in orbit mode), a two-finger pinch zooms the orbit or scales the travel speed, a two-finger twist rolls in flight, and the page itself never zooms or scrolls under a gesture. The controls panel starts collapsed on phones. To reach a phone on the Wi-Fi, serve over https (WebGPU needs a secure context): `node tools/serve.mjs --host 0.0.0.0 --port 5199 --https <dir with cert.pem and key.pem>`; plain http on that port redirects. Wheel changes speed or orbit zoom. F selects flight, O orbit, G walking, H hides the UI. Position uses f64 and orientation uses a quaternion. R disturbs nearby water. The Ocean section controls sea level, waves, clarity and foam; Clouds & weather controls resolution, sample count and animation. Full-resolution 128-sample clouds are the default. Terrain detail has a LOD distance slider (0.5x-16x, default 4x), within the fixed resource budget. Scenery controls change tree/rock visibility, density, detail range and wind; Forest, Conifers, Canopy, Rocky and Coast are useful destinations. Walking is currently canonical-height constrained; the requested Rapier controller is still pending.

The [cloud and terrain follow-up](CLOUD-REGIONS-TERRAIN-CATCHUP.md) records regional cloud warp, terrain filtering, extreme-stop tests and current limits.

## Deploy to Vercel

Use the repository root as **Root Directory** and **Other** as the framework
preset. `vercel.json` builds `solar-explorer` for WASM using the pinned Rust and
wasm-bindgen versions, then publishes only the browser files in `dist/`.
Rendering runs on the visitor's WebGPU adapter; there are no server functions. Live
data sources need no server of ours either, except any optional proxy for a source without CORS.
Do not select the Rust server preset or `crates/solar-probe` as the project root:
that starts a native graphics diagnostic on a server with no GPU.

At the time, Git deployments of the research repository were the production source of
its preview site.
To inspect a local static package after the normal Windows WASM build, run
`node tools/Package-Explorer.mjs`; the Linux build entry point is
`bash tools/Build-Vercel.sh`. The deployed `pkg/explorer-manifest.json` identifies
the source commit and WASM hash. HTML, loader and WASM revalidate together to
avoid retaining incompatible files across deployments.

## Validate and measure

```powershell
./tools/Check.ps1
node tools/Test-Scenery.mjs --mode validate
node tools/Test-Scenery.mjs --mode bench --frames 300
node tools/Test-Scenery-Motion.mjs
node tools/Test-Flight.mjs
node tools/Test-Explorer.mjs --frames 300 --warmup 360 --frozen --audit --depth --output evidence/local/explorer
node tools/Test-Explorer-Stress.mjs evidence/local/explorer-stress
node tools/Test-Explorer-Head-Turn.mjs evidence/local/explorer-head-turn
node tools/Test-Explorer-Concurrent.mjs evidence/local/explorer-concurrent
node tools/Test-Explorer-Motion.mjs evidence/local/explorer-motion
cargo +1.87.0 run --release -p solar-explorer -- --view ground --frames 300 --warmup 360 --frozen --audit --output evidence/local/explorer-native
```

Browser tools launch private headless sessions; they do not attach to the owner's browser. Do not run GPU benchmarks concurrently. Opening diagnostics enables bounded asynchronous timing/counter readbacks; normal play uploads one camera/settings uniform and performs no terrain readbacks. Raw reports contain source/binary hashes, per-frame timings and captures under ignored `evidence/local/`.

The full frame includes separate GPU scheduling, cached generation, topology, raster, shading, water, clouds, atmosphere/reconstruction and presentation measurements. Native Vulkan and browser results are separate evidence. Existing preview/other GPU work can affect timing tails. Fixed memory and work budgets do not guarantee an image-error or frame-time target.

## Source map

- `crates/solar-explorer`: production browser renderer and native validation backend.
- `shaders/terrain_gpu.wgsl`: GPU scheduler, cache, conformity and continuous vertex trajectories.
- `shaders/explorer.wgsl`: raster, surface lighting and atmosphere.
- `shaders/scenery.wgsl`, `scenery_common.wgsl`, `src/scenery.rs`: GPU geometry, ecology, support, atlases, LOD and explicit prop shading.
- `crates/solar-explorer/src/scenery_reference.rs`: independent placement/frame/contact math and future collision source contract.
- `shaders/water.wgsl`, `clouds.wgsl`: procedural water/foam simulation and cloud transport.
- `crates/solar-core/src/skin.rs`, `patches.rs`: independent f64 reference and topology tests.
- `web/explorer.js`, `flight.js`: UI, controls and diagnostic API.
- `crates/solar-explorer/examples/dense_reference.rs`: offline dense comparison with the same canonical heightfield.

The old lab remains at `web/field.html`; its historical performance reports are not measurements of this mesh renderer. No DXR, native-only ray tracing, imported scene assets, caves or terrain overhangs are required by the new path.

## From the research phase to Solar-System v2 (November 2026)

What changed between the log above and the app as published, in order. Each has its own document.

- 14 November: the project became Solar-System v2, open source under MIT. The flying car and its physics were removed the same
  evening: the app is a viewer with a free-flying camera ([VEHICLE.md](VEHICLE.md), [PHYSICS-NO-HOLDS.md](PHYSICS-NO-HOLDS.md)).
- 15 November: stellar travel (five star systems), the IAU's named features, exact cached sun shadows on terrain
  ([SOLAR-SYSTEM.md](SOLAR-SYSTEM.md), [SUN-SHADOWS.md](SUN-SHADOWS.md)).
- 16 November: the interactive water ripple simulation was removed, since nothing pushes the water any more
  ([WATER-LAYER.md](WATER-LAYER.md)). The orbit camera and walking were removed from every page: flight only, with Face,
  Autopilot, Go and Land. The 3× boost and the + and − speed buttons left the touch controls: the throttle bar sets the speed, and
  Shift still boosts on a keyboard. One panel and one dock replaced the earlier interface; the star model, the HDR finish and
  the fixes for Apple devices followed ([HDR-FINISH.md](HDR-FINISH.md), [VERTEX-TABLE.md](VERTEX-TABLE.md)). The data packs moved
  to one bundle file per face and level, read by byte range.
- 17 November: the Sun's spots, flares and relief; the composed score ([MUSIC.md](MUSIC.md)); the soundtrack first in the
  panel and a Support group at its foot; published as version 2 of the Solar-System repository.

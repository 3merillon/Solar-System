# Halley player vehicle

> **Removed, kept as history.** On the evening of 14 November 2026 the owner decided to remove the car and its physics entirely: the project is a solar system viewer with a flying camera. The Halley, its Rust modules (`vehicle_*.rs`, `physics_stream.rs`, `physics_debug.rs`, `terrain_contact.rs`), shaders, assets, page controls, flight deck panel and tools are gone; bare `index.html` starts the free-flying solar camera (`crates/solar-core/src/flight.rs`, `crates/solar-explorer/src/solar.rs`) and `?vehicle=` no longer exists. What follows describes the system as it was.

Preview: `http://127.0.0.1:5198/` (Halley and Earth/solar journey by default; `?vehicle=0` opts into the legacy viewer). Based on `06236f1`.

## Controls

- **V:** leave/enter. Drive **W/S:** throttle, brake against motion, then reverse. **A/D:** steer. **X:** drive/flight. **F:** brake. **Shift:** boost.
- Flight/swim **WASD:** movement in camera axes. **Space/C:** rise/dive. **Q/E:** roll the car. **Up/Down:** pitch. W turns the nose toward the view while preserving bank; release input to hold attitude. Ground impact enables temporary upright recovery.
- **B:** cockpit/orbit camera. Right drag orbits independently of the car in third person; cockpit drag turns the vehicle in flight. Wheel: flight thrust / driving camera distance. **P:** pause. **R:** upright recovery thrust. Reset explicitly searches for a safe spawn.
- Navigation: Face target, Fly there (continuous), Jump to orbit (explicit shortcut), Stop autopilot. Speed is shown in m/s or km/s in flight; flight preserves momentum, with gravity and atmospheric drag; F applies braking thrust. The wing automatically deploys above 35 m/s and retracts below 25 m/s, preserving the hatch interlock and manual overrides.
- Water automatically enables fan-assisted swimming, using the existing rear fan cover and rotor mechanisms. C dives, Space surfaces, X enables flight out of the water. Mean-water buoyancy and drag blend continuously; waves remain the renderer's surface model.
- Sound begins on a user gesture. Volume/mute controls are in the Halley panel. Engine, tires, skids, suspension, wind and spatial thruster sounds are synthesized from physics; no audio files are downloaded.
- Inspect mechanisms exposes the supplied manifest's independent controls, including six tail lights, doors, bonnet, hatch, linkage, pedals, levers, wipers, fans and wing stages. Restore automatic mechanisms returns control to the vehicle.
- Show collision shapes draws actual Rapier geometry and contacts: cyan car, green world, at most 60,000 line vertices, terrain within 12 m and other colliders within 40 m.

Drive is deliberately forgiving: four swept spherical tires, gravity preload retained through suspension droop, anti-roll transfer, grip near the centre of mass, speed-sensitive steering and bounded tilt assistance. Rounded chassis skids prevent thin splitter geometry hooking edges. These gameplay proxies do not alter the approved visible body. Recovery applies forces/torque; driving never rewrites the body's position.

## Asset and renderer contract

`web/assets/car-047c2dd` contains the approved compressed delivery and its attribution, source restrictions, manifest and decoder licence. Binaries remain byte-identical. Hero: 2,332,593 triangles; LOD 1: 1,133,220; LOD 2: 563,402. Each has 264 primitives, 34 materials, 593 exported nodes (429 original nodes plus geometry nodes), 98 clips / 102 channels. The two flat rear-steering clips remain intentionally unbound, as supplied.

Load LOD 2 alone, then hero below 22 m after a 1.2 s dwell. Hero downgrades beyond 45 m; LOD 2 upgrades below 100 m; LOD 2 is selected beyond 140 m. A pending asset replaces the active one only when complete. Live mechanism state belongs to the entity and survives swaps. Download size, decoded geometry, upload queue and GPU residency are separate quantities.

Draco decoding, image decoding and mip generation run in a dedicated worker. Discrete palettes retain nearest samples; other colour mips average in linear light. Upload exchange is bounded to 8 messages / approximately 6 MiB per frame (one message can exceed the byte target). GLBs are SHA-256 checked. The server negotiates Brotli/gzip/identity, correct MIME, encoded content length and `Vary: Accept-Encoding`, and caches the revisioned directory for a year. The build also generates Brotli/gzip sidecars for the engine WASM and loader (3.62 MB Brotli for the 13.57 MB WASM in this build). A production host must preserve these rules; copying sidecars alone is insufficient.

Rendering stays inside Rust/WASM/WebGPU: full original hierarchy including non-unit VEHICLE_ROOT, PBR base/MR/emission textures, clearcoat, sheen, glass, shared depth, cascaded shadows, water and atmosphere. Chrome uses analytical sky/ground reflection and direct light, not captured reflection probes. Glass sorts by part origin; intersecting transparent parts are not an order-independent transparency solution. No Three.js overlay exists.

Each wheel receives its suspension offset and individual spin. Mechanisms sample their supplied clip ranges independently. The hatch closes before either direction of the 0–35% wing sweep; pitch stays neutral below 50%. Power drives fans, accelerator emission and Tesla arcs; braking drives brake emission. Every supplied interior part remains resident.

## Local collision world

**Superseded on 14 November 2026** by [PHYSICS-NO-HOLDS.md](PHYSICS-NO-HOLDS.md): terrain contact now comes from the CPU surface and nothing below holds the simulation any more, except an explicit spawn (at most 1.5 s for objects). The GPU terrain snapshot is an audit only; objects and water still come from the GPU snapshot, without holds. The rest of this section is the earlier contract, kept for its measurements.

Rapier 0.26.1 runs at 1/120 s, up to 12 substeps per frame, with discarded-time accounting and CCD in every mode. Global positions/origins are f64; Rapier coordinates are f32 relative to an origin rebased beyond 512 m. Bodies, static colliders, interpolation endpoints and wheel contacts shift together. Rapier proxy ownership is preserved. Gravity is radial. The physics camera bypasses the free-camera GPU terrain lift, keeping mesh and snapshot coordinates identical.

An asynchronous GPU snapshot samples the canonical surface and production scenery records. Terrain: 129×129 points, 1 m spacing, 2 m above 22 m/s, 4 m above 50 m/s; refreshed after 8 m movement, spacing change or height revision. This is a finite collision approximation, not a centimetre error guarantee or arbitrary-topology solver. It can differ from a transient visual terrain morph. It uses the already approved radial surface, not another terrain generator.

Capacity: 512 nearby objects; 2,494,512 bytes per snapshot; one pending asynchronous readback, at most every 160 ms wall time; 24 additions and 24 retirements per frame. Coverage depends on speed, with up to 0.5 s look-ahead, a travel safety margin and 50 m retirement hysteresis. Under capacity pressure a complete snapshot may retire obsolete colliders immediately, within the same 24-per-frame budget, to make room for required contacts; it never evicts a collider still required by that snapshot. Cached shapes/handles survive visual LOD changes. A removed source inside the covered patch retires only after three complete snapshots omit it. Support translations update without recreating unchanged shapes. An exact comparison of the bounded source geometry updates changed shapes under their existing handles; the source-byte cache is replaced by each complete snapshot and is bounded to 512 objects. CPU code never uploads generated terrain, tree or rock meshes.

Tree capsules follow actual generated trunks and substantial limbs; leaves/twigs do not form rigid canopies. Rocks use 54 points from their exact variant, seeded tilt/stretch and footprint support. Convexification fills concavities and is not a certified tight hull. Buildings use the same normalized source footprint, seed, eight support samples, height and minimum height as rendering. Walls and triangulated roofs retain supplied courtyard rings and raised openings. Decorative windows are not source openings.

Unknown support, missing terrain, overflow, pending activation or insufficient coverage holds simulation at its last physical pose/velocity. Existing colliders remain. The HUD/stats expose age, wait, capacity, queue and unresolved counts. This prevents silent tunnelling but can pause movement while sources catch up. Safe spawn tries 49 positions within 18 m, checking slope and the full chassis compound. Failure remains pending rather than forcing an overlap.

Mean water level comes from the procedural sea or measured water-layer query. Submersion adds bounded buoyancy/drag; the existing renderer owns waves and underwater appearance. Fan wash is a local volumetric effect, without a displaced water-surface wake. Assisted flight has bounded lift/thrust, drag and pitch/yaw/roll torque; mode blending takes about 1.25 s. The soft speed limiter follows the active collision radius, with a ceiling of 150 m/s; densely populated local regions use a smaller radius. This is a fictional assisted vehicle.

## Verification

- `tools/Test-Car-Assets.mjs`: asset hashes/structure/tracks, HTTP representations, q=0 rejection and decoded equality.
- `tools/Test-Car-Steering.mjs`: actual A/D and Q/E browser key events, checked against camera forward cross up. The +Z-facing model has +X on the driver's left; steering, air yaw and roll use that convention. This replaces the original direction assertion that incorrectly treated model +X as screen right.
- `cargo test -p solar-explorer vehicle_`: bumps/steering, acceleration/braking, hover/landing, thin-wall CCD, pause bounds, rebases including stream churn, stable identities, activation budget, unknown-data holds, safe spawn and wing interlock.
- `tools/Test-Car.mjs`: actual browser/WebGPU close-up/cockpit, drive, takeoff/flight/landing, debug shapes, rebase, mechanisms, all LODs, warm downloads, pause, tree/rock impacts and bad-spawn recovery. Unrelated world quality remains unchanged.
- `tools/Test-Car-Buildings.mjs`: controlled source footprints and measured terrain through the production browser paths: wall impact, roof landing, live source-height changes, courtyard, raised underpass and water buoyancy. These fixtures do not certify all OSM data.
- `tools/Check.ps1`, native GPU probe, native explorer `--vehicle`, WASM build, shader provenance and static packaging.

## Measured handoff — 4 November 2026

Actual private Edge 156 / browser WebGPU on this Windows RTX 3080 host, 1280×720, full allocation tier and unchanged ultra world settings (128 cloud steps, six shadow cascades, full scenery density). `Bench-Car.mjs` measures 180 settled frames with the hero, then 180 with the vehicle disabled at exactly the same camera. Neither segment lowers world quality; neither has a GPU camera lift. CPU values cover renderer-worker frame preparation/physics/pose/submission, excluding the asynchronous GPU wait and UI-thread work.

| Measurement | Hero Halley p50 / p95 | Same camera, world only p50 / p95 |
| --- | --- | --- |
| Whole GPU timestamp span | 22.78 / 23.49 ms | 16.57 / 17.19 ms |
| Whole worker CPU frame | 1.80 / 2.00 ms | 0.30 / 0.40 ms |
| Serial browser frame completion | 23.40 / 26.20 ms | 17.30 / 20.00 ms |
| Physics, two 120 Hz steps | 0.20 / 0.40 ms | disabled |
| Pose evaluation/upload | 0.50 / 0.60 ms | disabled |
| Snapshot CPU consumption | 0.10 / 0.10 ms | disabled |

Hero rendering, shadows, animation and collision add about 6.21 ms median GPU and 1.5 ms worker CPU in this view. This is not 60 fps. These are one desktop, one settled view and a sequential comparison, not a cross-device or moving-scene performance guarantee. The earlier pre-change forest baseline was 21.18 / 23.15 ms GPU at a different camera; it is not a matched timing comparison.

Tracked GPU allocations rise from the original baseline's 1,083,360,476 bytes to 1,205,563,100 (+122,202,624). The hero itself accounts for 115,773,520 bytes including geometry, indices, images/mips and instance/material data. The renderer WASM heap was 69,664,768 bytes settled, reaching 91,619,328 after all LOD swaps in functional QA. These are allocation ledgers/linear memory, not total browser process or driver residency. Disabling the car retains its assets, so the world-only timing segment is not a memory baseline. Swaps temporarily retain both meshes while bounded uploads complete.

The settled run has 46 colliders, 35 trees and one rock, plus the terrain and car parts. The longer functional route reaches 231 active colliders, 207 trees, 60 rocks (separate maxima), 100.40 m/s and two automatic origin shifts plus one explicit shift. It lands with four suspension contacts. It ends with zero overflow/unresolved work; 83 cumulative coverage-wait frames include startup, streaming and explicit resets. The matched settled benchmark has no waiting frames. Waiting is a visible safe fallback, not time hidden by teleporting.

Cold local HTTP transfers/decode from the isolated benchmark:

| Asset | Brotli body | Download | Worker decode | Decode/upload wall |
| --- | --- | --- | --- | --- |
| LOD 2 | 2,768,265 B | 31.1 ms | 259.8 ms | 1298.1 ms |
| Hero | 5,552,029 B | 60.3 ms | 633.3 ms | 1205.4 ms |

Decoder initialization is 7.0 ms; wrapper/WASM bodies are 9,994 / 48,729 bytes. LOD 1 in the functional run transfers 4,296,575 bytes and decodes in 366.4 ms. Warm revisits report zero network transfer bytes; LOD 2 / hero still require 218.3 / 604.6 ms decoding and 899.9 / 1142.6 ms decode/upload wall time. Values are localhost measurements, not internet latency estimates. The world continues rendering while the dedicated decoder and bounded uploads run.

Required repository checks pass: formatting, workspace tests, Clippy with warnings denied, both WASM checks and Naga validation. Fifteen targeted vehicle tests cover 0.48 m rounded bumps, full steering, braking, recovery, water, origin changes, CCD and interlocks. The native GPU probe and native explorer pipeline probe pass separately; native execution is not browser evidence. Actual browser QA verifies the full interior/cockpit, daylight/low sun, independent mechanisms, preserved poses across all three LODs, pause/resume, tree/boulder collisions, 100 m/s flight, origin shifts, four-wheel landing, safe spawn and low flight. Building fixtures use the production source normalization, measured-page, renderer and collider paths; they verify walls, roofs, courtyard holes, raised underpasses and a >25 m/s wall impact. Lowering a roof from 8 m to 6 m retains its stable identity and the car settles onto the updated surface with four wheel contacts. The flooded measured-page fixture floats at 0.726 submerged fraction with no wheel support, using the production water-level query.

Raw images/reports live under `evidence/local/rover-browser`, `car-buildings`, `car-performance` and `car-baseline`; compact timings are in `evidence/local/rover-measurements.json`. Tests use their own headless browser and never drive the owner's desktop. Source assets are committed separately as `d67b8b3`.

Remaining limits: finite terrain/proxy approximation and explicit streaming holds; analytical reflections and part-sorted glass; no vehicle wake/spray or deformation/destruction; no interior collision for seats/dashboard; no mobile-hardware qualification, live OSM-wide data certification, or universal anti-rollover guarantee. The original geometry/materials/hierarchy/interior are preserved, but this renderer is not a pixel-identical Blender lighting reproduction. Captured environment reflections, more sophisticated glass and hero draw/shadow optimization remain quality/performance work.

## Flight, effects and scenery revision

One player switches from local Rapier to the existing sector-addressed solar integrator above 4 km over the CPU terrain estimate, and back below 2.5 km on a solid body. Position, orientation, linear velocity, angular velocity and the independent camera frame transform with the body's rotation. The near-flight force/drag model blends over the next 12 km. The thresholds are operational hysteresis, not a proven conservative terrain envelope. Entry holds physical motion until the canonical collision snapshot is ready. Explicit orbit/near shortcuts remain distinct from continuous travel. Gas giants have no solid landing surface. Earth starts at local noon for a visible initial car.

The reverse-depth target now declares both render-attachment and texture-binding usage. Smoke samples it for occlusion. This fixes the WebGPU validation failure that stopped the renderer on X. Resize recreates the same target with the correct usage; the far-car frame buffer also declares copy-destination usage.

Exhaust is a **32 x 32 x 48** car-local fluid grid, 0.25 m cells over **8 x 8 x 12 m**. Semi-Lagrangian advection, buoyancy/curl forcing, divergence, eight Jacobi pressure iterations and projection transport one shared density/velocity field. The renderer ray-marches 64 samples through this merged volume, with procedural density detail, sunlight attenuation and scene-depth clipping. Narrow 24-sample analytic nozzle cores replace the old spherical cores. Fluid buffers/parameters cost 2,360,416 bytes; no smoke texture download. Simulation is deliberately co-moving, with capped relative wind and a soft one-metre boundary sink: smoke stays close even at interplanetary speed. This is an artistic incompressible-flow approximation, not physically correct vacuum exhaust, compressible combustion or obstacle-resolved aerodynamics. Depth occludes smoke; the grid does not resolve the chassis or terrain as fluid obstacles.

A bounded 24-iteration nonnegative wrench allocator drives 18 animated jet outlets from requested force/torque, including damping and opposing roll jets. Three fans use the approved fan-housing outlets in water. Jet/fan authority crossfades with immersion. The controller's forces remain authoritative: the visual allocator does not prove physical wrench feasibility for every orientation. Rest positions come from the approved source/GLB; no approved geometry, interior or mechanism was changed.

Tire tracks use actual wheel contacts, load and slip: 4,096 ribbon segments, 300 m draw range, 180 s retention, no tracks in air or water. Sliding smears the tread. A 256-square rolling 64 m surface-memory texture flattens grass by up to 92%, relaxing over 45 s; a height gate prevents tracks under a bridge flattening cover above it. Storage is bounded (about 1.3 MB); long travel evicts old marks, reported in stats. Grass deformation affects cover geometry, not terrain height or physics.

Ground cover retains full geometry size and dithers pixel coverage for range, density thinning and new support publication. High reach is 220 m, Ultra 260 m, UI maximum 280 m; actual coverage also depends on the fixed 512-square candidate window per cube face and body lattice spacing. Placement scans at most 1,572,864 candidates, keeps the existing 61,440 total draw records partitioned by class and exposes overflow. A 24 MiB toroidal appearance history is fixed with travel, identifies lattice cells/seed and stores wrapped birth/last-seen times. Appearance uses the render/morph clock independently of frozen weather. Grass fades over 0.7 s; new trees/rocks over 0.55-1 s, with existing complementary mesh/impostor and residency-edge dithering. This increases reach, not a promise that every distant blade is individually visible or that overflow is impossible.

Additional verification tools: `Test-Car-Effects.mjs` (real keys, orbit independence, bank, view-directed thrust, side jets, tracks, fluid readback and audio); `Test-Car-Journey.mjs` (default Earth, Moon/Saturn, continuous approach/landing/departure); `Test-Car-Scenery.mjs` (extended reach and gradual cover visibility with weather frozen). `Test-Car-Buildings.mjs` includes rendered swimming/diving/water exit. Native vehicle tests include bank retention, impact recovery, opposite roll jets, body-frame handoffs and fan swimming.

The earlier performance table is historical for the earlier vehicle build. Expanded effects and increased ground-cover reach change the workload; current measurements and any test limitations are recorded with the revision evidence.

Collision approach follow-up: props are limited to an 80 m horizontal query around the look-ahead point and culled vertically against their scale envelope plus travel margin; terrain still uses the 129-square 1/2/4 m grid. Reported safe coverage is the smaller region. Look-ahead is clamped to leave the current car inside the velocity-dependent admission margin (including a 150 m/s handoff), preventing a snapshot from refusing its own car forever. Height readiness follows the stream's requested level, capped at the active baked pack's declared finest level (Moon v1: D6); pending/failed required pages still hold. This uses the engine's available canonical field and its procedural complement; it is not higher-resolution measured lunar terrain.


### Revision browser evidence

The final private browser run passes Effects, Scenery, Buildings and Journey. Effects uses real X/W/A/F/Q/E/Space key events, confirms independent chase orbit and bank retention, and verifies the combined animated nozzle roll wrench (isolated left/right allocation is a native test). GPU fluid readback is finite; projection reduces divergence RMS from 0.01964 to 0.01317 in the sampled takeoff frame. The route creates 1,049 tire segments, including 147 sliding segments, with grass compression recorded. Live audio starts after a gesture; offline idle/drive/slip/flight renders remain finite and below clipping. Audio has automated validation, not a listening certification.

The cover test finds 10,882 draw records, a farthest root at 221.15 m and zero overflow at High. After a cold appearance reset, mean pixel visibility progresses 0 → 0.378 → 0.795 while the weather clock remains frozen; the final mean includes distance/density thinning. Captures show full-size geometry revealed through pixel dithering. The controlled flooded-building fixture swims at 7.44 m/s without wheel support, drives the rear fan outlets, dives, and exits into flight. It also passes wall/roof/source-edit/courtyard/underpass cases.

Journey starts in the default Earth Halley, renders Moon and Saturn flight, then continuously descends through the space/local handoff and lands on the Moon with four suspension contacts, 512 resident rock proxies, zero overflow/unresolved work and no spawn reset. It climbs continuously back into sector flight. The run reports 320 cumulative coverage-wait frames, including 301 during initial Earth startup; holds remain explicit rather than bypassing missing collisions. The cache pressure regression and high-speed look-ahead regression are included in the 23 passing native vehicle tests. Full repository checks, native GPU probe, the 80 field-logic checks, asset byte/transport validation and static package provenance pass separately.


### Revision performance

`Bench-Car-Flight.mjs`, private Edge/WebGPU on the RTX 3080, 1280×720 Ultra, 180 measured frames per segment. All captures report zero GPU camera lift; the world-only segment uses the preceding car segment's camera. Values are p50 / p95 milliseconds. The separate 90 m reach comparison keeps the same ground camera and other settings.

| Segment | Whole GPU span | Worker CPU | Physics | Serial frame completion |
| --- | --- | --- | --- | --- |
| Grounded hero, 260 m cover | 23.14 / 25.01 | 1.70 / 2.00 | 0.30 / 0.30 | 24.00 / 27.60 |
| Matched ground world only | 16.78 / 18.56 | 0.30 / 0.40 | disabled | 17.60 / 20.00 |
| Same world, 90 m cover | 16.54 / 18.06 | 0.30 / 1.60 | disabled | 17.50 / 19.30 |
| Hovering hero with fluid | 27.89 / 31.38 | 1.60 / 2.20 | 0.10 / 0.20 | 27.80 / 32.20 |
| Matched flight world only | 20.78 / 22.64 | 0.30 / 1.90 | disabled | 21.90 / 24.30 |

The complete car adds 6.36 ms median GPU in the ground view and 7.11 ms with fluid in the flight view. Those different views do not isolate fluid cost. Extending cover from 90 to 260 m adds 0.24 ms median in this one matched view, with 15,012 versus 1,989 cover instances and zero overflow. These results do not establish 60 fps or cross-device performance. The final allocation ledger is 1,234,400,124 GPU bytes, including the retained hero's 115,773,520 bytes; settled WASM memory is 72,548,352 bytes. World-only measurements retain vehicle allocations, while render/physics execution is disabled. Neither ledger is total browser/driver residency.

All six final browser suites/benchmarks pass, including actual steering/yaw/roll direction. The final workspace run has 146 passing tests; the targeted vehicle subset has 23. Compact measurements, build identity, explicit bounds and limits are in `evidence/car-flight-2026-11-04.json`; raw logs and images remain in `evidence/local`. The approved car geometry, materials, interior and mechanism channels are byte-identical to the imported delivery.

## Pinionfall flight and the throttle (5 November 2026)

The owner asked for Pinionfall's flight feel and a throttle. Pinionfall (`planets/src/character/character-controller.ts`, flight block) flies a "superman" six-axis thrust model: thrust along the camera's axes, linear drag that sets the terminal speed, gravity cancelled in level flight and let through by a dive, and the body's nose slerped toward the velocity at 6/s with the body's up taken from the view. Pinionfall has no throttle; the Halley now has one.

Local (Rapier) flight, `vehicle_physics.rs`:

- **Thrust and drag:** thrust `FLIGHT_DRAG x throttle` along the view (W/S, A/D, Space/C), linear drag `FLIGHT_DRAG = 3/s`. The throttle is therefore the cruise speed: the terminal speed of full thrust in level flight (time constant 0.33 s). Releasing the keys coasts to rest the same way.
- **Gravity and dive:** gravity is held in level flight. C, or thrust steeper than about 20 degrees below the horizon, is a dive: up to 70% less drag and gravity let through (smoothed over about 150 ms). Pinionfall counts every downward degree; the dead zone keeps a camera tilted below the horizon from flying faster than the throttle.
- **Attitude (third person):** the heading follows the horizontal velocity once the car moves. S reverses without turning the car round (velocity backing away from the view keeps the heading). The nose pitches with the climb in proportion to forward speed, at most 70 degrees, so a slow vertical lift stays level. The body's up is the orbit frame's up, which keeps level with the planet under it, rolled by the held Q/E roll (2 rad/s, held when released) and a bank into the turn (`atan(v x turn rate / g)`, at most 0.7 rad). A torque controller tracks that attitude at `FLIGHT_ATTITUDE_RATE = 6/s`; driving never sets the body's pose. Cockpit view keeps rate control by the pointer.
- **Coverage:** thrust never asks for more than 0.65 of the safe collision coverage (`speed_limit`, at most 150 m/s), so the car does not outrun its own collision data. The object query around the look-ahead point grows with speed from 80 m to 240 m while snapshots come back complete; an enlarged snapshot that overflows or meets unplaced scenery is discarded (the last safe patch stays in force) and the reach falls back. In the forest test the local ceiling rose from a fixed 48.75 m/s to 99-121 m/s.

Handoff and speed above the ground (`vehicle_journey.rs`, `solar-core/src/flight.rs`): the sector integrator takes the car above 600 m over the ground estimate (was 4 km) and gives it back below 400 m (was 2.5 km). Its near-ground speed limit is `150 m/s + 0.5/s x (height - 400 m)` (was a flat 100 m/s below 20 km and `140 + (height - 5000)`), and its near-ground drag/thrust blend matches the local model. A climb is no longer minutes at 100 m/s; a dive from 20 km reaches the handoff in about eight seconds at the local ceiling. Above 400 m nothing is collided with: towers taller than that are a known limit of the handoff height.

Controls: `+`/`-` (also numpad and PageUp/PageDown) raise and lower the throttle continuously (x2.7 per second held), the wheel steps it, the panel's slider sets it. Range 1 m/s to 100,000 km/s on a log scale. The HUD (bottom centre) shows mode, speed, the throttle against the actual speed, the local ceiling when it caps the throttle, altitude and body. The panel is reorganised: Drive / Fly, throttle, camera and reset, travel, keys, sound, inspection.

Evidence: `cargo test -p solar-explorer vehicle_` (25 tests, including throttle terminal speed, coasting, nose following a strafe, reverse keeping the heading, held bank); `tools/Test-Car-Pinionfall.mjs` (actual key events in the browser: cruise 59.4 m/s at a 60 m/s throttle, held + raised it to 163 m/s, 103 m/s against a 121 m/s ceiling in the forest, nose/velocity dot 0.99999 in a strafe, coasted to 0.02 m/s).

Thrust in chase view follows the orbit measured from its resting pitch (`CHASE_PITCH`, 0.24 rad below the horizon,
`aim_rotation`): Pinionfall's thrust along the camera's own axis sank the car at every cruise, because the chase camera
rests looking down at it (the first browser run skimmed the grass on four wheels at 102 m/s). At the default framing W now
flies level; tilting the view lower dives. Final browser run: cruise 59.4 m/s at 60, airborne (0 wheels), 148 m/s against
the 150 m/s ceiling with the raised throttle, coasting to 0.02 m/s. `Test-Car-Steering` and `Test-Car-Effects` pass.

## Momentum, rear mirror jets and flight cutoff (9 November 2026)

The owner requested more inertia in flight turns, rearward-only mirror exhaust, and gravity when
switching back to drive at altitude. Flight drag is now 0.75/s, shared by local Rapier and the near-ground
sector controller, with thrust scaled by the same factor to retain the throttle's terminal speed.
The attitude response is 2.4/s and its angular velocity correction uses a gain of 6 instead of 16.
Releasing thrust coasts; the brake remains available for an active stop. This is tuned game handling.

Drive mode immediately disables hover and flight thrust even while the mechanisms fold. Above the
local handoff it also cancels autopilot and hover assistance, retains linear/angular momentum, and
uses passive atmospheric drag (0.03/s at Earth sea level) rather than the explorer's flight damping.
The normal collision-coverage gate still applies after returning to local physics. Re-engaging flight
can catch the fall. Mirror jets use the rear opening of each source pod (rest z=0.975) and exert +Z
force, so exhaust travels toward the back of the car.

Regression entry points: `cargo test -p solar-explorer vehicle_` (including a one-second free fall
in both integrators, retained momentum through a turn and rear mirror nozzles) and
`node tools/Test-Car-Inertia.mjs` (browser movement, flight cutoff and recovery).

## Exhaust/cloud composition and collision recovery (9 November 2026)

Exhaust previously blended into opaque surface lighting. Sky replacement discarded it on sky rays, and
clouds treated it as if it were at the terrain depth. Smoke and jet cores now render to two RGBA16F layers
of one texture array: premultiplied radiance/opacity and an opacity-weighted distance moment. Composition
uses the finished background and the air/cloud interval in front of that distance. The volume's overlap
with clouds is approximated by one representative depth across the existing 8 x 8 x 12 m volume; this is
not a joint cloud/exhaust density solve. Opaque terrain, car and water visibility still clip the ray march.
The additional viewport storage is 16 bytes/pixel (31.64 MiB at 1080p), counted in resource bytes and resize
overlap, with one sampled binding so the baseline WebGPU texture limit is retained.

`Test-Car-Cloud-Exhaust.mjs` checks actual browser display pixels against an independent alpha-over
reference with distant clouds both enabled and disabled. Both cases pass, with over 2,400 smoke pixels
against sky and maximum error one display code. Raw layers and production captures are retained under
`evidence/local/river-flight-fix-2026-11-09/after/cloud-exhaust/`.

The collision activation queue could churn forever when a required building's origin was below a flying
car and outside the CPU retention sphere. Current-snapshot membership now takes precedence over distance
eviction; absent objects still retire under the existing bounded mutation budget. The Rust slow-frame
regression and `Test-Car-Resume.mjs` cover repeated full snapshots and a frozen/thawed browser. In the
browser's 96-building fixture, the queue drained, holding cleared, and a flight cut after thaw produced
a 38.74 m fall over the slow-frame sequence. Unknown collision regions still cause a safe hold.

## Planet handoff follow-up (9 November 2026)

The craft and its offset chase camera now use one render-frame selection per frame. A camera offset at
the full-detail boundary cannot choose different planetary axes from the car. Explicit orbit/near
shortcuts reset the chase frame toward the destination and clear inherited angular motion.
During navigation tracking, the chase frame follows the craft's smooth target turn while retaining
the user's camera orbit offsets, so the destination stays in view.

External steering uses the thrust/view frame rather than a render-origin radial or orbital-frame velocity.
Q/E roll remains active outside Rapier, coasting does not steer toward orbital motion, and the Halley's
assisted drag stays consistent through the local/sector handoff. The generic explorer flight model is
unchanged. Sector addressing and body-relative velocity conversion remain the existing integrators.

The car uses the same tone curve in surface and space views. Planetary ambient light fades with altitude,
and space rendering updates one existing shadow cascade around the car so self-shadowing continues
without running terrain/cloud cache work. Nearby geometry and exhaust are excluded from the distant
planet's representation dissolve. The fallback disk beneath an active Earth surface no longer draws
a second cloud layer; Earth far-cloud refresh also remains active while another planet is in full detail.
The active-planet fade target is cleared even when that planet is behind the camera. The continuous
transfer capture caught the old Earth disk/cloud image surviving in this target during lunar arrival.
Space car lighting now includes planetary occultation before the surface pass starts, using the same
conservative solid core as the terrain shadow margin and an angular solar disk for penumbra. This adds
one bounded calculation per catalogued body in the existing packet loop and no GPU allocation. Partial
coverage uses planar angular-disk overlap; giant oblateness, rings, and overlapping partial eclipses
are not solved by this car-light approximation (the minimum visibility of individual bodies is used).

Dense rock fields reconstruct camera-relative support from body-fixed roots and contact offsets on every
draw frame, even when the bounded support refresh queue is full. Refresh admission rotates through the
instance table, preventing the same records from starving continuously. This keeps the existing
65,536-refresh budget and allocations. `Test-Car-Journey.mjs` includes orbit shortcuts, continuous lunar
approach/landing/departure and a camera-orbit rock-position comparison.

Measured scenery reserves the low sixteen placement-key bits for page tokens. World revisions now occupy
the upper sixteen bits: previously a revision increment disappeared inside the token mask, leaving
placements current when other identity fields stayed the same. Reusing support also requires the current world revision.
This retains the existing 16-bit placement generation space (wrap after 65,536 revisions), without
clearing or reallocating the full instance table. The audit ranks records against the actual projected
camera and checks destination radius before comparing retained visible rocks. It also reads the rendered
sea-level sentinel for airless bodies; using the UI's zero sea level had incorrectly selected dormant
Earth records instead of the Moon's rendered rocks in the first audit runs.

Browser evidence under `evidence/local/river-flight-fix-2026-11-09/after/journey-audit/`:
continuous lunar landing and departure passed; 1,651 retained visible rocks had p95 lateral motion
0.119 mm and maximum 0.171 mm during the camera orbit, with 121,767 queued support candidates.
The separate transfer test follows the production autopilot from Earth orbit to the Moon and checks
the Earth/cloud disk during an off-camera lunar representation handoff.
The final transfer run (`after/transfer-verified/`) passed with no collision hold, reaching 50.90 km
above the lunar reference radius at 175 m/s while slowing toward its 50 km destination. The off-camera
handoff pixel check passed. `tools/Check.ps1` passed after these changes, including 34 vehicle regressions
and shader validation; the browser checks above exercise actual WebGPU separately.
The final native Vulkan GPU probe also completed (640 x 360, 45 warmup and 20 measured frames with
audit) under `after/native-release/`. These functional runs do not establish a frame-time guarantee.


## Exhaust occlusion, coverage braking and navigation display (9 November 2026)

The water near-plane pass clears the opaque depth buffer. Exhaust now renders immediately after
main ocean geometry and before that clear, retaining car, terrain and main water occlusion while
keeping the separate cloud/exhaust composition. This reorders existing passes without allocating
another target. The original lunar browser capture had 2,039 car pixels whose exhaust mean distance
was behind the opaque body; the repaired capture has zero (5 cm tolerance for half-float moments),
with 490 legitimate near-side smoke pixels retained. Evidence: `vehicle-regressions-2026-11-09`
under `evidence/local/`, including raw position, normal, exhaust and distance buffers.

A high-speed handoff could require a look-ahead margin larger than any bounded collision snapshot.
The coverage hold prevented all physics, including braking, so fresh snapshots could never release
it. With a fresh, complete snapshot covering the held position, safety braking now reduces velocity
while holding position until the look-ahead fits. Unknown terrain, pending objects, old data and
unresolved queries still hold. This is collision safety braking, not a physical force integration
outside known coverage. The 900 m/s regression checks release without movement while held.

Halley Travel now exposes **Planet indicators (L)** and **Planet orbits (O)**, both enabled initially.
The marker canvas is shared with the standalone solar viewer. Orbit points and markers use the same
camera offset, planetary axes and render extent as the car's packet. Orbit off clears the draw stream
and skips point generation. Existing catalogue, sample counts and GPU trail buffer caps are retained;
there is no extra orbit GPU allocation. The overlay is one viewport-sized browser canvas. Selecting
an indicator changes the destination without starting travel. **H** restores the left control panel.


Stopping navigation, switching to drive/free fall, and returning from sector flight to local collision
now clear both the autopilot and its planet-centre look target. Previously the latter survived arrival
or X, continuing to steer the car downward after the pilot had disengaged. Existing fall and handoff
regressions now explicitly assert that steering assistance also ends, across Earth, Moon, Mars and Titan.


Final evidence: `evidence/local/vehicle-regressions-2026-11-09/after/vehicle-final/` passes
manual lift after Stop, unpowered upward coasting under gravity, zero behind-body exhaust pixels,
and checked/default-on plus L/O toggled orbit and indicator states (792 visible indicator pixels).
The native cancellation assertions cover X and handoff; the browser's recorded case uses Stop.
`after/planet-lods-complete/` contains paired caster/shadow-range images on Moon, Mars and Europa.
`after/native-verified/` completes the Vulkan audit with zero nonfinite samples, unequal shared
samples or topology overflow. `check-final.log` records the full repository check, including 52
explorer tests, clippy, WASM checks and shader validation. Browser execution is separate evidence
from native validation; these runs make no frame-time or exhaustive planet/view guarantee.

## Inertial spacecraft flight — 9 November 2026

This supersedes the earlier Pinionfall cruise-speed/hover/approach-limit sections for the Halley.
Normal Fly mode uses camera-relative thrust, gravity, and quadratic drag relative to the rotating
atmosphere. Releasing thrust in vacuum preserves velocity. The nose follows commanded thrust
rather than falling velocity, so turning the vehicle does not erase sideways momentum. Precision
hover (internal mode 1), driving and fan-assisted swimming retain their separate controllers.

The throttle's displayed unit is m/s²: 0.75 times the stored setting, doubled by Shift. F directs
that bounded thrust opposite surface-relative velocity; there is no near-ground 150 m/s ceiling,
altitude-based approach brake, gravity cancellation, or vacuum damping. Manual thrust does not
increase automatically with distance. Fly there remains an explicitly assisted navigation mode.
The legacy `?vehicle=0` viewer retains its prior assisted travel controls.

Atmosphere density comes from each body's existing exponential profile; no atmosphere means no
drag. Both integrators use Cd A / mass = 0.0015 m²/kg and the analytic drag-only speed ratio
`1 / (1 + 0.5 rho Cd A/m |v| dt)`. This is a simple ballistic approximation: no lift, heating,
compressibility, fuel depletion or damage model is claimed. A fast surface arrival produces a
Rapier impact and can bounce; it does not receive an automatic landing burn.

Departure hands over above 600 m while moving outward. Arrival hands back below 400 m plus 0.2 s
of closing travel, preserving position, attitude and velocity. Local steps are at most 1/120 s,
shortened to fit travel and acceleration inside known collision coverage, with at most 48 substeps
per display update. The fixed 80–240 m object reach and 129² terrain grid remain bounded. Each
substep checks its swept margin. Missing coverage pauses simulation and reports `holding` without
changing velocity; rapid travel can still wait for streaming. `contact_steps` records transient
impacts even when contact has ended by the next displayed frame. Excess elapsed time remains
bounded and reported. Terrain sampling and finite collision reach are approximations, not a
conservative collision guarantee for every speed or terrain feature.

Validation and captures: `evidence/local/rock-spaceflight-2026-11-09/`; browser reproduction:
`node tools/Test-Car-Spaceflight.mjs`. Core tests include a 1500 m/s lunar approach that accelerates
under gravity, low lunar orbit energy, atmosphere-dependent drag, vacuum thrust/coasting/braking,
and a fast collision-data wait that preserves 8000 m/s until coverage resumes.

Final browser qualification: the lunar burn reached 903 m/s, release retained 906 m/s under gravity,
and one second of manual braking reduced it to 466 m/s. A separate approach entered local physics
at 756 m/s, registered a transient CCD contact, remained above the surface, and departed again under
thrust. Six sampled collision-coverage waits occurred during that fast approach; velocity was retained.
The full repository check, final WASM build/provenance and native GPU audit passed.


## Collision preparation and cockpit steering - 9 November 2026

This supersedes the earlier 24-object activation budget, one-second snapshot expiry,
three-dimensional coverage check and cold local handoff. The terrain grid covers radial
surface directions: a descent through the same footprint no longer runs into an invisible
sphere around the previous car position. Terrain and object snapshots retain independent
footprints. Object queries include the whole vertical column, so a preloaded ground object
cannot be omitted just because the car was higher when the query ran.

The GPU bridge starts preparing collision data during external flight within 6 km of the
terrain estimate, while scenery support is within its existing 6.5 km range. Completed
snapshots are installed before physics, with at most 512 object admissions/removals per
update for this one car. A same-body handoff retains terrain, object handles and readbacks;
external pose changes rebase static geometry as well as the chassis. Body changes and
explicit navigation jumps invalidate the old collision epoch. Static geometry does not
expire just because a second passed. Failed replacement queries retain the previous complete
patch, without extending its coverage or hiding overflow/unresolved counters.

Readback scheduling follows lateral speed (up to one request per completed frame), instead
of a mandatory 160 ms interval while moving quickly. Lead, terrain spacing and requested
object reach use lateral speed; vertical speed still controls CCD substeps. This avoids
coarsening a ground patch or querying a huge object disk just because the car is falling fast.
The 129x129 terrain grid, 512-object cap, visual-source dependency and finite support range
remain. The swept footprint guard remains for genuinely absent collision coverage. These
changes remove the demonstrated false midair holds; they do not prove unlimited-speed,
cold-source or arbitrary lateral-flight coverage. No lower-detail collision fallback, speed
clamp, teleport, invisible wall or automatic braking has been substituted for missing data.

The imported cockpit steering-wheel and shaft rotations are reversed about their neutral
poses. Physical steering, front-wheel/rack/track-rod animation and approved asset bytes are
unchanged. Private browser captures in `steering-final/` cover neutral, partial and full
left/right cockpit views; the partial views visibly confirm the direction.

Evidence: `evidence/local/collision-streaming-2026-11-09/`. `flight-first/report.json`
records zero coverage waits through the 756 m/s lunar handoff, impact, coast and departure.
`fast-arrival/report.json` records a fresh-footprint lunar approach, 9006 m/s at handoff,
zero waits and a CCD ground impact. The initial post-impact continuation exposed five waits when a circular query overflowed
and the car acquired over 2 km/s of lateral velocity (`fast-continuation/report.json`).
That failure motivated the capsule query and wider pre-impact terrain preparation.
`corridor-continuation/report.json` passes the same approach, impact and subsequent
fast lateral motion with zero waits, including the former failure interval.
Native regression descents at 900, 8000 and 30000 m/s
also hit the ground without coverage holds, and external rebasing preserves collider world
positions. `check-final.log` records the full repository check on the corridor implementation. Browser and native execution
are separate evidence; no universal frame-time or unlimited-speed claim follows from them.


## Orbit-descent collision deadlock - 9 November 2026

The Orbit shortcut was a missing regression case: it starts with lateral orbital momentum,
whereas the earlier near-surface shortcut tests began with surface-relative velocity zero.
A cold lunar Orbit descent at about 66 km/s entered local physics at a HUD altitude of
14.4 km (above the reference radius). Collision preparation started only below 6 km and
visual rock support stopped at 6.5 km. The local guard then prevented the descent needed
to make that support available. The HUD correctly reported waiting for collision data.

Preparation now starts at 6 km plus 0.75 seconds of radial closing travel, before the
400 m plus 0.2 seconds handoff threshold. A 1024 m surface column admits support work beyond
the visual draw distance; visible rock reach and fade behavior are unchanged. The car's
swept corridor also receives the highest placement priority, so unrelated middle/far
visual records cannot spend the whole generation budget first. At lateral speed above
100 m/s this priority uses a 32 m half-width along the velocity axis, with a cell-jitter
margin; slow movement uses a 300 m disk. This schedules the existing work, rather than
inventing colliders for ungenerated records. Far prepared collider roots reconstruct
body-fixed support offsets instead of reusing stale camera-relative draw coordinates.

The early handoff band now waits for a snapshot that actually covers the current position
while sector flight continues. By 400 m plus 0.1 seconds of closing travel, entry into local
physics is mandatory even if preparation failed; its unknown-data guard still protects the
remaining approach. This reserves the existing maximum 0.1-second update plus the 400 m
operational margin. It does not promise collision with structures above that margin.

Query lead can use half the smaller terrain/object radius, retaining room for the current
car. Only actual object overflow reduces query reach; temporary missing records or source
pages no longer impose a two-second reduced-reach penalty. Geometry/support readiness
flags distinguish those causes from other unresolved work. The maximum object-query reach
grows from 240 to 400 m. Above 1000 m/s lateral speed, the terrain grid expands from
129 square to 257 square without changing its 1/2/4 m spacing rules. Slower movement
retains the 129-square workload. The object cap grows from 512 to 1024. The maximum
GPU snapshot/readback allocation increases by 5.758 MiB; each readback is 5,513,264 bytes.
The wider grid has 131,072 triangles versus 32,768, and its measured snapshot decode/mesh
construction cost in the 66 km/s test was about 68-77 ms near impact. This is a material
CPU cost, not a frame-rate improvement. Prop queries scan a bounded 512-square window
on each cube face. Two additional frame vectors describe the priority region. Generation
budgets and unknown-coverage guards remain. Finite chart windows on small bodies and
arbitrary-speed cold-source readiness are not proven by the lunar tests.

Evidence and reproducible command: evidence/local/moon-orbit-stall-2026-11-09/ and
Test-Car-Orbit-Descent.mjs (default thrust 600; --thrust=2000 for the 66 km/s case).
The --dt argument controls far-flight simulation submissions;
the product animation loop caps them at 0.05 seconds. The optional 0.1-second stress case
is intentionally harsher and remains recorded separately from product timing.

Qualification of this checkpoint: tools/Check.ps1 passed (workspace tests, Clippy, WASM
checks and shader validation). The native Vulkan forest probe completed with vehicle
queries and zero bridge errors; it validates GPU execution, not a loaded Halley driving
route. Browser fixtures on the source-matched WASM 7bbc191bcb24814be7d1f6f254b667d86b52cc8356b92bb20eef234c3a266950
passed the 36.3 km/s Orbit descent with zero waits, and the 9.0 km/s near-surface approach
including 30 post-impact submissions with zero waits.

The 66.0 km/s stress descent reaches the ground without a pre-contact wait, but its
strict zero-wait assertion still FAILS at impact. A separate recovery run accumulated
four guard waits after a sideways rebound, then resumed and stayed moving through
the remaining samples. This is a remaining finite-corridor limitation, not another
permanent midair deadlock. Run the stress case with --thrust=2000 --after-impact.
Final browser snapshot decode medians were approximately 56 ms (36 km/s) and 69 ms
(66 km/s), with a 142 ms maximum in the latter run. These fast-grid costs are recorded
explicitly; ordinary driving retains the smaller grid. Full results, including the
failed stress assertions, are in evidence/local/moon-orbit-stall-2026-11-09/summary.json.

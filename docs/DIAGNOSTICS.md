# Render diagnostics

Every diagnostic switch the renderer has, in one place. None ships enabled. They are settings of
the explorer, set from the browser console or a tool through the page's engine handle, for
example:

```js
solarExplorer.configure({shadow_diagnostic: 3})      // sun visibility: unresolved receivers
solarExplorer.configure({cloud_diagnostic: 128})     // compare cloud densities one metre apart
solarExplorer.configure({debug: 1})                  // surface normals
```

`configure` rejects unknown keys and values out of range (`crates/solar-explorer/src/renderer.rs`,
`Settings::validate`). The shader sites are named below so that a reader can check what a value
does; this table was taken from the code on 16 November 2026.

## `debug` (0 to 5): what the shaded world shows

Also offered in the page under *Render diagnostics* (values 0 to 4).

| Value | Shows | Site |
| --- | --- | --- |
| 0 | The shaded world | |
| 1 | Surface normals | `explorer.wgsl` shade, `scenery_common.wgsl` |
| 2 | Geometry spacing (cached mesh spacing); scenery: leaf or rock colour | same |
| 3 | Log distance | same |
| 4 | Data lag and synthesis on measured bodies (level deficit green to red, blue where detail is synthesized) | `measured_diagnostic` in `surface_field.wgsl` |
| 5 | Raw served and wanted page levels | `surface_field.wgsl` |

## `shadow_diagnostic` (0 to 7): sun visibility

Any value above 0 forces the sun query on every pixel (`explorer.wgsl`, `scenery_common.wgsl`).

| Value | Shows or changes | Site |
| --- | --- | --- |
| 1 | Solid (terrain and object) visibility, grey | `sun_diagnostic` in `sun_visibility.wgsl` |
| 2 | Cloud transmittance, grey | same |
| 3 | Unresolved receivers | same |
| 4 | Solid, cloud, unresolved as red, green, blue | same |
| 5 | No colour: restores the coarse rock caster class near the eye (paired-capture comparison, [SCENERY.md](SCENERY.md)) | `sun_casters.wgsl` |
| 6 | No colour: turns off the soft fade at the edge of the last prop cascade (paired-capture comparison, [SCENERY.md](SCENERY.md)) | `sun_visibility.wgsl` |
| 7 | Terrain march work: red = cached steps / `SUN_MARCH_LIMIT`, green = block jumps / 128 ([SUN-SHADOWS.md](SUN-SHADOWS.md)) | `sun_terrain`, `sunlight` |

## `cloud_diagnostic` (bit mask, 0 to 2^24 - 1)

One word (`f.cloud_drift.z`) carries cloud, sun and water switches; bits combine. Bits 512 to
8192 are cost-attribution switches: each removes one component so that its cost can be measured;
they change the image.

| Bit | Effect | Site |
| --- | --- | --- |
| 1 | Clouds lit by the planet's shadow only, no terrain or cloud self-shadow | `clouds.wgsl` `sampled_cloud` |
| 2 | Reserved for compatibility with saved diagnostic settings | |
| 4 | Four times the view-march samples | `cloud_march` |
| 8 | No refinement of long horizon bins | `cloud_march` |
| 16 | Test output: production relative height against a rounded world-height subtraction at 32 m ray points | `cloud_pass` |
| 32 | Test output: the production cloud body over all six faces, weather either side of the early-out cutoff | `cloud_pass` |
| 64 | Test output: spherical-advection metric (tangent lengths and angle) on all faces | `cloud_pass` |
| 128 | Test output: production densities 1 m apart | `cloud_pass` |
| any of 16-128 | The far cloud pass writes empty | `cloud_far_pass` |
| 256 | Sun light in clouds from an independent 256-step quadrature instead of the profile maps | `sampled_cloud` |
| 512 | Sun visibility: skip the terrain march | `sun_visibility.wgsl` `sunlight` |
| 1024 | Sun visibility: skip cloud shadow | same |
| 2048 | Sun visibility: skip prop shadows. Also, in the cloud pass, outputs the view-march trace (bins, path, opaque limit minus shell entry, transmittance) | same; `cloud_pass` |
| 4096 | Skips ground-cover shadows. The cloud pass writes zero, fine sunlight-map weight, map-edge coordinate and opacity into RGBA | `sunlight`, `sampled_cloud`, `cloud_pass` |
| 8192 | Restores the single 104-texel hand-over between cloud shadow maps, and skips the terrain march's refinement (cost attribution) | `sun_clouds.wgsl`; `sun_terrain` |
| 16384 | Drop the fine cloud-shadow profile map | `sun_clouds.wgsl` |
| 32768 | Drop the fine and middle cloud-shadow profile maps | same |
| 65536 | Water: bed trust from four times farther | `water.wgsl` |
| 131072 | Water mesh limited to its first twelve rings | `explorer.wgsl` `water_mesh_limit` |
| 262144 | Water bed "unseen" fade from four times farther | `surface_field.wgsl` |
| 524288 | No relief clearance on the water surface | `explorer.wgsl` |
| 1048576 | Water pages one level finer | `measured_water_entry` |
| 2097152 | The lifted ocean also yields to the far water mesh | `lifted_ocean_yields` |
| 4194304 | No caustic focusing | `water_focus` |
| 8388608 | Water pass output: mesh clearance, page depth, bed-path depth (each / 20 m) as colour | `water.wgsl` |

Bits 2048, 4096 and 8192 each have two effects (listed); a measurement that sets one of them gets
both. Older dated docs number some bits differently (from zero, or by position); this table is
the reference.

## Other diagnostic settings

Set only by tools: `scenery_isolate`, `scenery_showcase`, `scenery_draw_limit`,
`scenery_variant_limit`, `scenery_lod`, `cover_density`, `patch_cap`, `generation_limit`
([SCENERY.md](SCENERY.md) describes the scenery ones). The audit methods of the engine handle
(`audit_shadows`, `audit_water`, `audit_lod` and others) read GPU state back for the gates in
`tools/`; they are not used by the page.

Star model switches (16 November 2026, panel Display section; `SolarFlight.set_star_options(adapt, detail)`): **Meter on a
star's disk** off draws the photosphere at exposure 1, so a near star clips to white as before; **Synthetic star surface** off
removes granulation, faculae and sunspots, leaving the colour, limb darkening, glare and corona. Both are remembered in
localStorage (`solar-star-adapt`, `solar-star-detail`), as is the time line's zone (`solar.time-zone`). `SolarFlight.star_exposure()`
returns the last exposure, `SolarFlight.star_info(id)` a star's record and derived numbers as JSON. See
[SOLAR-SYSTEM.md](SOLAR-SYSTEM.md), "The star model".

**Stars** (Display, 16 November 2026; `SolarFlight.set_star_view(0 | 1)`, remembered as `solar-star-view`): 1, the default, is
the familiar composite (filtered views in false colour, the corona compressed as eclipse pictures are, stated on screen); 0 is
true colour. Synthetic star surface off also removes the active regions' spots and flare ribbons; the atmosphere stays.

**Bloom**, **Lens flare** and **Auto exposure** (16 and 17 November 2026; Display on the solar page, Quality details elsewhere;
settings `bloom`, `lens_flare`, `auto_exposure`
and the preset key `bloom_levels`, 1 to 6): the picture's finish, [HDR-FINISH.md](HDR-FINISH.md). Off, each is
simply not drawn. `solarExplorer.capture('hdr')` returns the frame in linear light before exposure (RGBA half floats), the
input of `tools/Tone-Curves.mjs`; `tools/Capture-HDR.mjs --configure '{"bloom":false}'` captures with a settings patch.

Trips (animated travel): `SolarFlight.go_to(id)`, `go_over(id, lat, lon, height)`, `land_at(id, lat, lon, height)`, `stop_trip()`,
`trip_state()` (active, fraction, target, detours, body still in the way), `trip_place()`, `body_clearance()` (the least height
over any body's reference sphere and that body) and `probe(id)` (the craft against a body: inertial position, view direction,
body-fixed position). `tools/Trace-Trip.mjs` traces trips frame by frame; `tools/serve.mjs --log FILE` writes one line per request
so its `--serverlog` can count pack requests per second at the server.

The time line folds with ▾ (remembered as `solar.timeline-collapsed`); on touch screens the HUD button beside the stick does the same.

The score ([MUSIC.md](MUSIC.md)): `window.solarMusic` is the soundtrack's handle. `solarMusic.report()` returns what is playing
(`line`, `zone`, `mood`, `bar`, `length`), the voice units in use against the `budget`, notes `spawned`, `dropped`, `late` and
`retimed`, `stalls`, the look-ahead, and the main-thread time spent (`tickMs` composing and scheduling, `stepMs` asking the
flight and the director) with the last actions of the director in `log`. `solarMusic.next()` asks for another piece in the same
place; `solarMusic.module(bars)` returns the opening of the piece as a Relative Music Theory module (JSON for rmt.world);
`solarMusic.context` is the audio context, for tests that suspend it. `tools/Test-Music.mjs` checks composer, harmony and
director in Node; `tools/Render-Music.mjs` renders pieces offline on `web/music-lab.html`; `tools/Test-Music-Live.mjs` measures
the page with the music off and on and checks hidden tabs, interruptions and trips.

The native probe (`crates/solar-probe`) has its own pipeline override `DIAGNOSTICS` (counters
only; [PERFORMANCE.md](PERFORMANCE.md)).


## Flight rendering checks

Run the interactive regression scripts with Node and a Chromium browser with WebGPU. Local outputs go under
`evidence/local`. The Earth tests use the pinned pack and the replay fixture used by the existing Earth tests.

| Script in `tools/` | What it measures |
| --- | --- |
| `Test-Cloud-Horizon.mjs`, `Test-Cloud-Stability.mjs` | A rolled cloud-bank descent against supersampling, then frame differences above and inside a stationary or evolving bank |
| `Test-Skyline-AA.mjs`, `Test-Temporal-AA.mjs` | Ground/sky coverage and HDR edge stability, camera cuts, resize and the space renderer |
| `Test-Water-Horizon.mjs`, `Test-Lake-Surface.mjs` | Dry ridge colours with water toggled and lake level, facing and immersion |
| `Test-Rock-Receiver.mjs`, `Test-Rock-Streaming.mjs` | Lit-face self-shadowing and cast shadows over a rock LOD sweep, lunar reach and residency |
| `Test-Scenery-Appearance.mjs`, `Test-Near-Terrain-Arrival.mjs` | Published building identity and first-frame near-terrain corrections |
| `Test-Selection-Hud.mjs`, `Test-Viewport-Resize.mjs` | Click-through selection, desktop travel and viewport coverage |

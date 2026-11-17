# M0: field seam and body descriptor

30 October 2026, on source commit `9d91e2e` (renderer code of
`0fcba90`). Nothing here changes what the procedural planet looks like. It makes the later
milestones possible by giving the surface one definition and a body its own description.

## What changed

**One field module.** `shaders/surface_field.wgsl` is now the only code that knows what height
is. The ten sites that evaluated the 24-band spectrum call it: mesh generation (`radial_sample`),
camera height, the level error, the node metrics, surface detail, height-only queries, the sun
clipmap split and its live bands, the receiver spectrum, the dropped spectrum, and the foam bed.
The variants differ in skip threshold, ridge mean and what they accumulate. Each keeps the exact
arithmetic of the site it replaced, on purpose, because the gate is exact.
`crates/solar-explorer/tests/shader_guard.rs` fails if any other shader calls `band()` again.

**One Rust trait.** `solar_core::surface::SurfaceSource` is the surface as the CPU sees it. A query
answers at once and says what served it. `Skin` is the procedural implementation. Bounds are `Option`,
so a measured source can say "unknown" instead of inheriting a number that would not hold. Bookmarks,
camera constraints and the geometry audit go through the trait. `scenery_reference.rs` still takes `Skin`,
because its ecology noise is procedural; it moves when ecology does (M6).

**One body descriptor.** `solar_core::body::BodyDescriptor` holds radius, sea, atmosphere, cloud shell,
rotation and surface kind. `PROCEDURAL_EARTH` is the regression baseline. The duplicate radius constants now
derive from it. The WGSL literals for the 100 km shell, the 8000 m and 1500 m scale heights, the 55 km sky
fade, the Rayleigh coefficients and the 12.5 km cloud shell top moved into three new frame vectors. `Rotation`
has no consumer yet.

**Tile server.** `tools/Serve-Tiles.mjs` records and replays public tile services with bandwidth, latency,
failure and 404 injection, and with a required host allow list and request budget when recording.
`tools/Test-Serve-Tiles.mjs` checks it against local stubs (43 checks). It never touches a live host in tests.

**Data-lag counters.** `stats().data_lag` reports page traffic from CPU state, and a counter of GPU readback
requests. An analytic body reports zero page traffic. `tools/Test-Data-Lag.mjs` checks that normal play
requests no readback and that the counter does see profiling readbacks.

**Contract.** The section 13 changes are recorded in [DECISION.md](DECISION.md) and
[SINGLE-SKIN.md](SINGLE-SKIN.md). Three stale doc statements were corrected.

## Limits

- Cloud cache constants (`CLOUD_CACHE_BOTTOM`, `CLOUD_CACHE_SLICE`) and the weather envelope still assume an
  Earth-like body. They were not moved, because no second body needs them yet; M9 must.
- The surface's scattering colours in `aerial` remain literals. They are appearance choices today, not fitted
  to a body, and each new atmosphere needs its own evidence anyway (plan, section 12).
- A body with no atmosphere keeps the baseline's words in the uniform, and the pass stays off through its own
  setting. M2 tests that path for real.
- The controlled GPU payload grows by nothing significant: 48 bytes of uniform.

## Evidence

See [REAL-EARTH-PROGRESS.md](REAL-EARTH-PROGRESS.md) for the gate results and evidence paths.

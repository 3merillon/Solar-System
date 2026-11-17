# Physics that never waits (14 November 2026)

> **Removed, kept as history.** On the evening of 14 November 2026 the owner decided to remove
> the car and all of its physics: the project is a solar system viewer with a flying camera.
> The CPU terrain contact, collision streaming, Rapier integration and the modules this note
> describes (`terrain_contact.rs`, `physics_stream.rs`, `vehicle_*.rs`, `solar-core`
> `contact.rs`) no longer exist in the code. The free camera is `crates/solar-core/src/flight.rs`
> driven by `crates/solar-explorer/src/solar.rs`. What follows records the work as it was.

Step 1 of [SOLAR-SYSTEM-V2-PLAN.md](SOLAR-SYSTEM-V2-PLAN.md). Before this change the car
collided with terrain read back from the GPU's rendered surface, and physics stopped
("held") wherever that readback did not yet cover the car's path. Coverage needed grows
with speed while readback latency does not, so a 9 km/s lunar descent deadlocked mid-air
(944 of 1,441 frames held). Physics also dropped any frame time above 0.1 s.

## What changed

**Terrain contact comes from the CPU surface** (`crates/solar-explorer/src/terrain_contact.rs`).
The engine already mirrors the served surface on the CPU: `PageField` (measured pages, the
same pool the GPU table serves) or `Skin` (the procedural field), both behind
`solar_core::surface::SurfaceSource`. The craft's terrain collider is that surface
sampled at footprint 0 (as the GPU snapshot sampled it) on a 65 x 65 tangent lattice and
installed as a Rapier height field. Nothing waits for it:

- A new patch is built under a per-frame budget (2,048 samples) while the previous one
  stays active. If the craft could leave the active patch before the new one is complete,
  the remaining samples are evaluated at once: a *forced* build, counted and timed
  (`contact.forced_builds`, `forced_ms`). On entry to local physics from orbit the first
  patch is always forced.
- Spacing follows speed: a power of two at least `speed x (0.5 s + build time) / 16`, so the
  inner part of the patch holds the travel of the next build. 1 m when driving, 16 m at
  400 m/s, 128 m at 2 km/s, 512 m at 9 km/s.
- Radial projection moves a sample sideways from its lattice point by at most
  |h - datum| r / R; the largest value in the active patch is reported (`sideways_m`).
- When a new patch replaces the old one under the craft (new data, new spacing, new
  place), the shown surface blends from the old shape to the new at 2 m/s or less, and the
  height change under the car is reported (`last_correction_m`, `max_correction_m`,
  `blend_seconds`). Finer data therefore corrects the surface gradually; it never pauses
  the simulation.

**A conservative bound decides whether any patch is needed** (`solar_core::contact`).
`SurfaceSource::region_bounds(n, r)` returns an interval that contains the served height
everywhere within r metres of arc of n, or `None` if no bound is known:

- `Skin`: h_s(n) +- (residual(s) + L_s r) with s = r. |h_0 - h_s| <= residual(s) holds at every
  point (existing test); h_s moves at most L_s per metre of chord, where L_s sums each
  band's noise derivative bound 3 sqrt(3) / scale times its filter weight, plus edits.
- `PageField`: a min/max pyramid. Each page stores the texel min/max of 8 x 8 blocks of the
  3 x 3 spline stencil (a quadratic B-spline read is a convex combination of it), each key
  the union over its subtree. A region takes the blocks of every resident ancestor over
  it, the subtree of the keys under it, and adds the largest complement the coarsest
  level any read there can blend with can add. It bounds the served surface, not the truth.
- `contact::sweep` bisects a segment, inflated by a radius, against those bounds. `Clear`
  is a guarantee relative to the bound; `Unknown` (no bound) is treated as possible contact.

Each frame the craft's horizon (0.5 s plus build time of travel, inflated by 8 m and by
what thrust can add) is swept; when it is clear no patch is built. Each step, the craft
must stay inside the swept tube or inside the active patch with a margin of one step's
travel plus 6 m, else a forced build happens before the step. Tests: dense samples of
caps of 1 m to 20 km stay inside the bounds for `Skin` (with and without edits) and for
measured pages across levels, fades and removals; 300 random segments that touch the
surface are never cleared.

**Swept contact at any speed.** Rapier 0.26 / parry 0.21 nonlinear CCD misses a height
field at speed (a 2 km/s descent passed straight through it), although wheel shape casts
against it work. A triangle mesh of the same lattice holds under Rapier CCD, but costs
2 ms to build and 0.5 ms per step natively (about 2 ms per step in the browser, 20-35 ms
per frame at 10 fps), so it is kept only behind `terrain_mesh` for comparison. Instead,
every step that moves the chassis more than 0.8 m is swept with a linear cast of the body
box against the patch; on a hit the body is put back just short of the surface and the
velocity component into it is removed (an inelastic impact; tangential motion and spin
are kept). A hit at the very start of the step (the box already touching, a skid) is left
to Rapier's contacts: the first version clamped those too and pinned a car that hit the
Moon at 9 km/s in place while it still reported 733 m/s (browser trace, fixed, regression
test `vehicle_high_speed_skid_keeps_moving`). If a step instead ends more than 0.5 m
inside the patch, the body returns to its start and loses the velocity into the surface.
Counted in `terrain_clamps`, largest removed speed `terrain_impact_speed`.

**Physics has its own fixed clock.** Steps are exactly 1/120 s in f64 (STEP as f32 is 1e-7
long and lost a step every few frames). Real elapsed time is simulated up to
`max_catch_up` = 0.25 s per frame, a reported setting; anything beyond is counted in
`discarded_seconds`. The worker no longer drops the time of frames it skips under GPU
backpressure; it carries it into the next drawn frame. The sector flight integrator uses
the same cap. Rendering interpolates between steps as before. Physics still runs in the
render worker's thread, so a long frame delays steps but no longer loses their time.

**Objects never hold.** Trees, rocks, buildings and the water level still come from the
GPU snapshot (CPU placement of the GPU-grown trees is not written). An incomplete,
overflowing or not-yet-covering snapshot keeps the last complete object set and is
counted per frame (`object_gaps`); simulation continues. This is a weaker guarantee than
the old hold: a fast craft can pass through a tree or building whose collider has not
arrived. Terrain cannot be missed this way. The GPU terrain grid is read back only when
`audit` is on, to compare it with the CPU surface (`physics_stream.audit`).

**Only an explicit spawn or reset holds**, while it searches for a clear pose. It waits
at most 1.5 s for objects, then spawns on terrain alone (`spawn_without_objects`).

## Native results

`cargo test -p solar-explorer vehicle_` (46 tests). New:

| Case | Result |
| --- | --- |
| Spawn, settle and drive on the procedural skin with no GPU snapshot | 4 wheels down, no hold after spawn |
| Orbital descent 9 km/s at 20 degrees | never held; transient 3.35 m into the 512 m patch on a 2.4 km/s normal impact, pushed out in 3 frames; never ends inside |
| Descent 2 km/s / 400 m/s | 0.72 m / 0.07 m into the patch at most; against the unfiltered field 3.33 m / 0.37 m (the patch's interpolation error at 64 m / 16 m spacing) |
| Ten 0.2 s frames | 240 steps, nothing discarded |
| Finer data raises the ground 0.6 m under a parked car | 0.6 m correction blended over 0.3 s, car stays on 4 wheels |
| Native cost, skid at 300-800 m/s | 0.04-0.08 ms per frame, worst frame 5 ms (a forced build) |

The old tests that asserted holds now assert the new contract: object gaps are counted
and time runs on; overflow keeps the resident set; 8 km/s arrival keeps its momentum.

## Browser results

`tools/Trace-Hitches.mjs`: unpaused game loop, two frames in flight, 1920 x 1080 High,
private headless Edge, RTX 3080, profiling on (diagnostic). One run per build, not
interleaved; GPU values move by tens of milliseconds between runs. Summary:
`evidence/v2-physics-trace-2026-11-14.json`; raw rows `evidence/local/hitch-trace-2026-11-14/`.

| Scene | Held frames before -> after | Coverage waits | Discarded | Physics p50 / p99 | Continuity (distance / speed x simulated time), p50 / p95 |
| --- | --- | --- | --- | --- | --- |
| Lunar descent, 9 km/s from 30 km | 944 of 1,441 -> 0 | 939 -> 0 | 0 s | 2.6 / 16.8 ms | 1.000 / 1.000; 1 frozen, 1 jump of 1,141 presented |
| Procedural arrival | 133 of 422 -> 0 | 50 -> 0 | 0.13 -> 0 s | 1.2 / 7.3 ms | 0.98 / 1.03; 2 frozen, 3 jump of 210 |
| Earth low flight, ~500 m/s | 41 of 438 -> 0 | 16 -> 0 | 0.25 -> 0.42 s | 3.2 / 21 ms | 1.00 / 1.00; 0 frozen, 2 jump of 97 |
| Earth parked (new reference) | -> 0 | 0 | 0 s | 0.5 / 4.4 ms | - |

The lunar descent no longer deadlocks: it enters local physics at 2.5 km, strikes the
surface and slides on. The Earth flight's discarded 0.42 s are display frames longer than the
0.25 s catch-up cap (GPU up to 241 ms during the low dive over water, see
[FRAME-COST-SUN-DRIFT.md](FRAME-COST-SUN-DRIFT.md)); physics did not wait, the frames were
slower than the cap. The before columns use the original trace; its frozen/jump counts were
computed per rAF callback and are not comparable, so they are omitted.

The gate in the plan asks for zero held frames, zero coverage waits and no frozen or jump
frames. Held frames and waits are zero in every scene. A handful of frozen/jump frames remain
(1-3 per scene, under 2% of presented frames); not yet attributed. Object gaps (frames whose
object snapshot was incomplete while physics ran on) are 33-745 per scene and are the price
of not holding: a tree or building can be missed at speed until its collider arrives.

Two problems found by these runs and fixed: a triangle-mesh terrain cost 20-35 ms of worker
time per frame at 10 fps (now a height field plus motion clamping, 0.5-3 ms); and the first
clamp pinned a car skidding on the Moon (see above). Earth pages arriving anywhere used to
rebuild the patch every frame; a 9 x 9 probe now lets an unchanged patch adopt the new
revision (`revisions_adopted`).

## Limits

- The collision surface is the served surface at the patch's spacing. At 512 m spacing
  (9 km/s) the patch can sit tens of metres from the fine field; it converges to 1 m
  spacing as the craft slows. Patch error relative to the fine field is not bounded.
- `PageField` bounds are relative to resident data and the f64 reader; the GPU's f32
  arithmetic differs by millimetres (audit in `physics_stream.audit`).
- Objects can be missed at speed while their snapshot is incomplete (counted, not held).
- Physics is not on its own thread; a 0.25 s or longer stall is still cut at the cap.
- The impact response at orbital speed is a clamp plus Rapier's penetration recovery, not
  a physical crash model.

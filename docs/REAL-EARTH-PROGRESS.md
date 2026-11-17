# Real Earth progress

Resume from this file. Plan: [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md). Brief:
`docs/NEXT-CONTEXT-REAL-EARTH.txt` (development repository only).
Started 30 October 2026.

**Owner instructions added on 30 October 2026:** spend credits carefully, sending menial work to lesser models
even under ultracode; large datasets go on the data disk, not the system disk. `evidence/local/real-earth/` is a junction to
`$SOLAR_DATA`, so the paths in the brief still resolve. The owner also asked about CesiumJS, and about
porting it or writing our own in Rust; the answer is recorded in the plan, section 13: our own engine, taking
named designs from Cesium, with a private control page.

## State

| Milestone | State |
|---|---|
| M0 field seam and body descriptor | Implemented. See "M0 gate" below for the state of the gate |
| M1 live Earth | In progress, gates not all passing or not rerun: see "M1 gates" below. Design in [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md) |
| M2 onward | Not started. M1 is the go/no-go gate |

## M0 gate

Design note: [M0-FIELD-SEAM.md](M0-FIELD-SEAM.md). Baseline: source `9d91e2e`, WASM `eefb8f1bb587`, snapshot in
`$SOLAR_DATA\baseline\web`. Evidence under `$SOLAR_DATA\baseline` and `$SOLAR_DATA\m0`.

**Passed.** Candidate WASM `fe867033c2d1` against baseline `eefb8f1bb587`, RTX 3080, private headless BrowserWebGpu.

- **Static scenes exact:** 12 of 12 at 640 x 360, display, HDR components, position and normal, in `m0/candidate-1`. The
  A/A control (baseline against itself) also gives 12 of 12, in `m0/control-aa` and `baseline/static-aa`.
- **Timing, 1080p, 4 interleaved rounds, 360 warmup, 300 frames, in `m0/timing`.** Median of rounds, GPU stage sum, ms:

  | View | Baseline p50 / p95 / p99 | M0 p50 / p95 / p99 | Paired p50 ratio per round |
  |---|---|---|---|
  | forest | 27.55 / 30.88 / 31.54 | 28.77 / 31.76 / 32.69 | 0.997, 0.996, 1.010, 1.121 |
  | coast | 28.72 / 31.14 / 31.86 | 29.33 / 31.79 / 32.86 | 0.994, 0.926, 1.000, 1.132 |
  | clouds | 47.13 / 50.23 / 51.82 | 46.40 / 51.56 / 52.63 | 0.987, 0.977, 0.994, 1.004 |

  The ratio's median is about 1.00 in each view. The last round's forest and coast ratios are 12-13% high, in one arm, with clouds
  unaffected. The two arms' shaders differ only by the same arithmetic reached through function calls, so this looks like outside
  load on the shared workstation, but that is an inference, not a measurement. The medians above include that round.
- **Payload:** 1,136,810,832 bytes against 1,136,810,736, the added frame uniform.
- `tools/Check.ps1 -Gpu` passes (log: `m0/check.log`). `tools/Test-Data-Lag.mjs` passes. `tools/Test-Serve-Tiles.mjs` passes 43 of 43.

**Failure kept on record:** with an agent's Node tests loading the CPU, the same candidate scored only 3 of 12 "exact" (`m0/static-under-agent-load`):
at most 1 display code, p99 zero, and one half-float unit in cloud buffers. Rerun without that load, both A/A and candidate pass 12 of
12. The likely cause is deferred pipeline compilation finishing at a different frame, which changes the order of cloud cache refreshes;
that cause is not proven. **Limit: exact comparisons are only valid on an otherwise quiet machine. Run them with no agents working.**
The first timing run under the same load is in `m0/timing-under-agent-load`, and is not used above.

## M1 state

Design: [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md). Open it with `?body=earth`. Procedural stays the default body.

Built: page reader and streaming core in `solar-core` (`pages.rs`, `streaming.rs`), atlases and clip table in
`solar-explorer/src/pages.rs`, measured branch of `shaders/surface_field.wgsl`, field worker and decode pool in `web/field/`, pinned pack
(`crates/solar-bake`, 28.8 MB, ETOPO 2022 CC0 plus Blue Marble Next Generation, in `$SOLAR_DATA\bake\pack-earth-v1`, served through the ignored
junction `web/pack`, not in git), interface and attribution, height validation ([M1-HEIGHT-VALIDATION.md](M1-HEIGHT-VALIDATION.md)), private CesiumJS control
(`tools/Cesium-Control.mjs`, Cesium 1.146.0 installed under $SOLAR_DATA only, captures in `$SOLAR_DATA\cesium-control\captures`).

Fixture: `$SOLAR_DATA\fixtures\tour`, 475 MB, recorded once through the bounded recorder (`tools/Record-Earth-Tour.mjs`). Tests replay it.

Owner's preview: `node tools/serve.mjs --root $SOLAR_DATA/preview --port 5198`, refreshed from the build by `$SOLAR_DATA\scripts\preview-snapshot.sh` (copies `web/*`, `web/field`, `web/pkg` and the pack into that directory). The gate chain, its probes and `stop-tests.ps1` are in the same scripts directory. Its link is http://127.0.0.1:5198/explorer.html?body=earth.

Gate results are recorded below as they arrive. **Do not run timing or exact comparisons while agents are working.**

Added at the owner's request while viewing, ahead of the plan's order: human-scale ground material and sea floors (start of M4), and lakes (part of M3 and M5), both in
[M1-LIVE-EARTH.md](M1-LIVE-EARTH.md). Rivers narrower than the DEM can show, roads and buildings are not done: they need vector data, and contacting OpenFreeMap needs the owner's approval.

Bugs found by looking at captures from a true eye height, each of which measurements had missed or misread:
- The height audit compared the mesh with the procedural body, so its 11,808 m error was meaningless. Against the f64 page reader it passed all three stops at `9472293`, largest error 0.0003 m, with no served-level disagreements. It has failed at the cube edge since at least `f1e09e2`: see "M1 gates".
- The f64 reader kept only the last 128 arrived pages, so the camera stood tens of metres above the mesh, which made every close capture look far blurrier than it was.
- The reader synthesized detail with the default noise seed, not the world's: up to 88 m of disagreement.
- A record's key held the imagery token where the cull expected the revision, so every tree and rock on the measured body vanished.
- Speed took pages off the screen, which the owner saw as detail popping back and forth while zooming.

Found by the owner looking at coasts away from the recorded stops, after a69ce99, each missed because the evidence came from one place:
- Far sea: a lattice of white dots. Water was dropped by a test on the fragment's height, which sags with the triangle. Holes fell from 99% of deep sea at 5,000 km to 0.04%.
- Shallow coasts: squares of dark and pale. The sea rule was written from Portofino, where sea reads zero; at the Somme and in Flanders it keeps real depths, so all of it read as dry land, and its terraces passed as thousands of lakes.
- Far and steep coasts: the image's sea on dry ground between the real water and the beach, with trees on it. The height data's coast can be hundreds of metres out; the shore now follows the imagery.

Found by the owner flying on live services, on 31 October 2026:
- A dark band across far water, and water through hills: a coarse tile cannot hold a lake, and the field read the footprint's own page. It now reads three levels finer.
- CORS errors when flying a lot: EOX refusing, 403 with no CORS header. Led to the limiter and the disk cache, in [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md), "Asking less of free services".
- Bare sand in square blocks, trees in the shallows, coarse ground: while pages arrived, mesh, bed and trees each read their own page, and height pages waited on images from a host holding back. I had filed the owner's earlier sighting of a hard tan edge as an imagery seam, which was wrong. My shore test skipped footprints under 6 m and looked only at settled views, so it could not see it. Fixed in `676e232`, with a test of what shows while pages arrive.

## M1 gates

The plan's gates, section "M1", and where each stands. Native and browser are kept apart: all of these are in a private headless browser on replayed tiles unless stated. A run is valid only on a quiet machine, which is why the `gates-8` timing below is thrown away: the chain started by itself on an idle timer, and the owner came back to the preview during it.

| Gate | State | Evidence |
|---|---|---|
| Zero frames block on data | Passed at `9472293`. To rerun | `gates-7`: blocked 0 |
| Network load does not affect frame time, at 5, 20, 100 Mbit and 20 to 300 ms | **Not settled.** To rerun | `gates-7`: 5 of 6 cases at most 1.5 ms worst. 5 Mbit and 20 ms 8.2 ms, failing. Other software held 4 to 5% of the GPU during that case only, so load may be why. That is an inference |
| Height error against lidar, split by land cover | Measured | [M1-HEIGHT-VALIDATION.md](M1-HEIGHT-VALIDATION.md) |
| Human verdict on 10 m imagery low down, and on the swisstopo overlay and its border with EOX | **Pending, the owner's** | The owner called the water on `676e232` "awesome". That is not this verdict |
| Camera cuts, cold cache, reverse flight, page failure, with counters exposed | Passed at `9472293`. To rerun | `gates-7`: motion 6 of 6, longest frame 33.4 ms, topology 0. Face cross: GPU 1.74 ms, sun 1.80 ms |
| Interleaved p50/p95/p99 within budget against M0 | **Not settled.** To rerun | `gates-7`, in [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md), "Frame cost". Dents at +1.49 ms against the 1.5 ms limit, and the shaders have changed since |
| GPU heights match the f64 reader | Passed at `7326500`, three routes, 5 stops | See below |
| Route independence | Passed at `f1e09e2`. Two stops passed again with the mesh token fixed. Rerun in full | `gates-8`: same bytes on every route tried, before the owner's browser started |
| After a cut, 90% within one level by 1 s and 100% by 5 s | **On the edge.** 5 s in 3 of 3 and 1 s in 2 of 3 at `f1e09e2`, budgets on. Two single runs since: one missed both, narrowly, and `7326500` passed both. Needs three runs | [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md), "After a cut" |
| Procedural body exact against M0 | Passed at `f1e09e2`. To rerun | `gates-8`: 12 of 12 |
| Gentle live smoke test | Passed at `9472293`. Automated runs stopped | 227 tiles, 13 MB, none failed. EOX then refused this machine, so no tool contacts it until the owner decides. The owner's own browser session is the live test |

**The height gate.** Failed at the cube edge, `tools/Test-Earth-Height-Audit.mjs`, stop `edge-cross`. At `9472293`, route Lausanne, Dents, edge-cross: 0 samples over tolerance. At `f1e09e2` on that route: 17, up to 19.3 m. Straight from orbit, a route the gate did not run: 378 at `f1e09e2`, 402 at `676e232`, up to 509 m, unequal shared samples 1,764. 2,400 further frames changed nothing, so this was no settling time. Cause and fix in [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md), "Regeneration": a node's token watched its own face where its edge vertices read the neighbour's page. Whether `ef4a442` caused the failure or only exposed a hole older than it (the token is from `49331e8` and `a69ce99`) is an inference, and was not run. Now: Lausanne, Dents, edge-cross; edge-cross from orbit; corner from orbit: 0 over tolerance, largest error 0.00026 m, 0 unequal, 0 served-level disagreements, topology clean.

Review of `676e232`, read-only, by separate agents, each finding then checked by another trying to refute it. Fixed: a page built from a provisional tile could be marked final if a refresh finished during its build, and then never be asked for again; a pixel claimed as water marched its reflection from its own bed. Left open, all low and not measured: a refresh re-stamps its page's arrival, so a page already shown dips toward its parent for 20 frames, and dropping the stamp would trade that for a pop of new shore; a request given up on stays queued until its job ends, so it can be sent and aborted, spending a token; the fetch made after a pool decode failure is not visible to the late check; the level-cell dam clause applies to shading and not to the tree gate or the water level under the eye (which predates this); with failures injected, as in `tools/Test-Earth-Motion.mjs`, a settled capture can land before a refresh does, so that capture depends on timing.

Failures kept on record: the cut test's threshold was looser than the plan's from when it was written; static compare once compared nothing and looked like a pass; `TaskStop` on the background shell left the gate chain running through the owner's flight and two of my probes, so the chain's scripts must be killed by name.

## Sources

[REAL-EARTH-SOURCES.md](REAL-EARTH-SOURCES.md) is the terms ledger. It differs from the plan's assumptions on: IGN and PDOK
(licence unconfirmed, test only), Trek (no terms found, test only), OpenFreeMap (terms prohibit automated collection, test
only until the operator confirms in writing, which needs the owner's approval), and low-zoom Terrain Tiles in the pack
(redistribution unconfirmed, so the pack takes heights from ETOPO 2022 instead, CC0-1.0 as read in its primary record).

## Next

The owner has chosen the next work, on 31 October 2026: the entire solar system, ahead of M2 to M8. `docs/NEXT-CONTEXT-SOLAR-SYSTEM.txt` (development repository only). In progress, flyable at `?body=solar`: [SOLAR-SYSTEM.md](SOLAR-SYSTEM.md).

Still owed on M1, not blocking that by the owner's choice: all gates on one final commit, on a quiet machine, started only when the owner says they are done, with `$SOLAR_DATA\scripts\m1-gates.sh` and `STEPS` leaving out `live-smoke`. Then report M1 plainly and ask for the owner's verdict on imagery, on hosting, and on the rivers pack.

Later, the M1 suggested order in the brief. Prior-art review: [PRIOR-ART-STREAMING.md](PRIOR-ART-STREAMING.md).

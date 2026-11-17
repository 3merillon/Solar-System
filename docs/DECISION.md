# Current decision: GPU-resident single radial surface

On 25 October 2026 the owner explicitly authorized the radial heightfield fallback and the complete adaptive mesh explorer. This supersedes the field-first recommendations below. The field renderer is archived at commit `fe0c78a` of the development repository; the single-skin explorer is the active line of work. Rust/WASM/WebGPU is the product path. Native wgpu is a separate test backend, with no hardware-ray-tracing requirement.

Terrain selection, balancing, generation, cache allocation, topology and morphing must be GPU compute work. CPU code owns input, independent references, later physics, and the bounded upload of source pages. The CPU uploads source pages within a bounded budget, and never a cut, mesh, instance list or generated vertex. The owner subsequently requested entirely GPU-procedural trees/rocks, richer geological forms/materials, Planets-style flight, water/underwater effects, evolving/reactive clouds and a Rapier human controller. Earth and astronomical data integration follows [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md) (contract changes recorded 30 October 2026). Measured geodata is imported, while authored model and texture assets remain excluded unless separately approved. The owner subsequently requested planetary-to-ground shadows and responsive shader/planet initialization. These are implemented locally; see SUN-SHADOWS.md and STARTUP.md for the current design, measured quality and remaining performance limits.

## Water as its own layer (3 November 2026)

The owner rejected the water path built up through October and November ("nothing is working properly everywhere")
and asked for water correct at every distance, shores and rivers meeting seamlessly, larger waves and close-up water
(`docs/NEXT-CONTEXT-WATER.txt` (development repository only)). Decision, recorded before replacing the path:

- **One canonical water description, independent of the terrain's heights** (`web/field/water-layer.js`): the union
  of the map's water polygons (OpenMapTiles ocean, lake, pond, dock, river) and the river network's centreline
  channels (`rivers.js`). Edges between touching bodies are inside the union, never shores. A point query gives
  containment, the signed distance to the union's edge (exact, from map edges, not texels), level, flow and kind.
  Levels: the sea at sea level, still water one level per OSM id (estimate, as before), rivers the network's
  position-only level field (`rivers.js levelAt`).
- **Water pages, a channel of their own** beside each height page (same 264 x 264 texel grid and positions): signed
  distance, level, coverage (box-filtered share of the texel), kind and fetch, flow. Built in the worker from the
  canonical description at every page level from the map's tiles at z(level + 1) (z14 from level 12), so a coarse
  page is a filtered fine page up to the map's own generalization. The CPU uploads these pages; it never uploads a
  mesh, cut or vertex.
- **Terrain from the same data** (phase 2): beds and banks are a function of the water page's distance and level.
- **A dedicated water surface on the GPU** (phase 3): its own mesh, displaced by the level field and waves and
  clipped by the distance with footprint antialiasing. No terrain triangle is lifted to a water level.
- **Spectral waves** (phase 4), close-up water and shadows (phase 5), as in the hand-off.

This supersedes, once each phase passes its gates (docs/WATER-LAYER.md): the water excess plane in the high 16 bits
of the height atlas and its rules (`resample.js` buildHeightPage, `surface_field.wgsl` page_water_read,
page_surface_read, page_water_surface), the 32 x 32 water cell grid per height page (`page_meta` WATER_ROW), the
source sea and lakes as the shore (`water.js`, `seabed.js` stay only as the fallback where no map is read), map
water as rules inside the height build (`map-water.js`), and the ocean raster that lifts terrain triangles
(`explorer.wgsl` ocean_surface, `terrain_gpu.wgsl` WATER_EXCESS_FLAG). Until 4 November 2026 the old path stayed the
one drawn. At the owner's request, after part 2 of the work (docs/WATER-LAYER.md "Part 2"), the explorer now starts
the field worker with the water layer by default; `?water=old` keeps the old path for comparison until phase 6
removes it. Known costs of the default at that date: the water stage at the Douro fixture's coast is 6.75 ms p50
against the old path's 5.90 (Leixões: 6.95 against 7.16), and page builds cost 0-18% more; both are open in
WATER-LAYER.md "Next steps".

Not claimed: novelty (the parts are known: polygon signed distance fields, box-filtered coverage, clipmap or
projected water grids, spectral waves); exact levels for still water (estimates); coarse pages carrying features the
map's coarser tiles omit (OpenMapTiles drops streams below z13).

## River surface ownership (9 November 2026)

The owner reported doubled, elevated rivers at coarser LODs and requested keeping the terrain-based
river while removing the separate surface. Mapped rivers now use the displayed terrain's water
coverage in the water pass. Both independent water-mesh and lifted-terrain water fragments reject
river-kind samples, including their near-plane medium caps. Oceans and still water keep their
existing surfaces. River map data, bed shaping, flow and coverage are retained. Rivers therefore
have no separately displaced wave surface; coarse water-ring interpolation cannot create a second
level above the displayed channel where the water layer identifies a river.

## Grown trees, geological rocks and ground cover (4 November 2026)

The owner asked for trees grown from branches and twigs instead of one leaf grid repeated on cluster quads, many more
species, rocks from pebbles to very large boulders, grass, reeds and riverbank placement, on the procedural planet and the
solar bodies (`docs/NEXT-CONTEXT-TREES-ROCKS-2.txt` (development repository only)). Decisions, recorded with the
implementation ([SCENERY.md](SCENERY.md), "Second pass"):

- **Trees are generated per variant on the GPU from a species table**: a skeleton pass grows up to 1 trunk, 48 limbs,
  192 branches and 768 twigs (phyllotaxis or whorls, crown envelope, tropisms as bends) and 2048 leaf cards; a vertex pass
  turns it into three levels of detail on **fixed template topologies**: every class is a list of grid patches (tubes,
  cards, cube-sphere faces), its index buffer is shared by all variants, and an index carries its class in the top byte.
  One draw per class (five record classes, cards, six ground-cover draws), no per-variant draw calls, no first-instance.
  Unused slots of a template collapse to degenerate triangles; that is the cost of the shared topology.
- **Leaves come from a procedural twig-and-leaf card atlas**, one layer per species (four card variants), drawn
  analytically on the GPU from stems and leaf outlines (lobed, palmate, ovate, lanceolate, deltoid, needle sprays, bundles,
  tufts, fronds, bipinnate), never one grid repeated. Bark is evaluated per fragment in branch coordinates.
- **Rocks stay props, also the 20-40 m boulders**: six families, sizes from truncated power laws (records hold the tail a
  cell can carry; pebbles are ground cover), support compared with the rock's own generated bottom over its footprint.
  At distance they keep the octahedral impostor and, beyond the record window, the terrain's footprint cover; a giant
  boulder is not moved into the terrain.
- **Ground cover is a separate, stateless layer** rebuilt every frame from sub-cells of the record lattice within a reach
  (90 m on high), placed on the displayed surface and on the water layer's answer; no queue or record grows with travel.
- **Plants only where the body is Earth-like; rocks on every solid body of at least 150 km radius** (the earthlike gate in
  renderer.rs no longer removes rocks), with their own ecology: crater ejecta and power laws on regolith bodies, the
  Golombek & Rapp exponential model on dusty bodies.
- No new data source: real Earth still reads imagery colour, now with the water layer, slope, altitude and a latitude-
  dependent temperature; land cover waits for M6 (REAL-EARTH-PLAN.md).

Not claimed: novelty (the parts are known: parametric trees after Weber & Penn, card-based foliage as in production tree
tools, octahedral impostors, power-law rock populations); botanical accuracy of any species; that the shared template's
degenerate geometry is free.

The active engineering contract and unresolved quality gates are in [SINGLE-SKIN.md](SINGLE-SKIN.md). Frame-rate stability takes precedence over blindly increasing detail. A complete coarse planet remains available during cold cuts and resource exhaustion. Neither conservative height bounds nor heuristic local curvature priorities certify silhouettes.

## Halley player and local physics (4 November 2026)

The owner explicitly approved importing the Halley package at source checkpoint `047c2dd`, including its original textures,
full hierarchy and mechanisms. This is an exception to the earlier authored-asset exclusion. Its source licence and
Draco notice travel with the revisioned assets. Rust/WASM owns dynamics, animation and WebGPU drawing; a dedicated
JavaScript worker only fetches and decodes glTF/Draco. No second rendering engine is introduced.

Rapier is the local collision solver. A fixed 120 Hz step and bounded catch-up, swept wheels, CCD chassis, a floating
translation frame and bounded resident collider queues implement the player. Following the owner's TMT steering,
contact loads, compliant suspension, force-based upright assistance and a rounded low-friction belly favor forgiving
bump traversal and rollover resistance. This is game handling, not a certified vehicle model.

The terrain is still the approved radial surface. Collision samples the canonical GPU field in a finite patch; scenery
proxies are extracted from the same admitted GPU records and model/support transforms. Sampling is an approximation,
not an interval proof of terrain extrema. Finite look-ahead, queue overflow, stale data and coverage are observable;
movement waits when the covered region cannot safely contain the next step. Visual LOD does not own collider lifetime.

---

## Inertial Halley and unresolved rock shadows (9 November 2026)

At the owner's request, Halley Fly mode now preserves inertia with gravity and density-dependent
quadratic atmospheric drag. Automatic surface braking and vacuum damping are removed. Collision
coverage suspends time without deleting velocity; adaptive bounded Rapier substeps and predictive
handoff handle fast approaches. The legacy viewer and explicit navigation assistance remain separate.
See VEHICLE.md for units, bounds and aerodynamic limitations.

Rock visibility and caster coverage share a projected-size fade. Airless/dust/ice ground receives
a bounded population-area estimate for unresolved rock shadows, smoothly complemented by resolved
casters. This replaces the absent far-rock estimate, without restoring the rejected displaced disks
or overflow-driven lighting changes. See SCENERY.md for approximation limits and validation evidence.

## Archived field-renderer decision history

# Decision 001: choose the representation before the renderer

**Second performance-pass update:** WebGPU remains the product path by the owner's explicit preference. Canonical arbitrary-topology fields and durable edits remain authoritative. Exact proxy access/work elimination and an 8 MiB cloud lattice-value cache are now default after matched-image gains of 25% ground, 16% rough terrain and 40% clouds. The ray-local prefix certificate trial failed its performance gate and remains off. Solar lighting reuse, temporal reconstruction and the completed bounded GPU surface experiment remain unqualified. See [the second-pass measurements](PERFORMANCE-SECOND-PASS.md) and [the first-pass archive](PERFORMANCE.md); the 16.67 ms objective remains unmet.

Status: **bounded ray marching is the primary research track; production backend unproven**. 25 October 2026.

## Intent

Real-scale planets, a universe that is not pre-expanded into cells, coherent geological forms, controllable generation, a large material library, and continuous travel from space to a rocky streambed. Overhangs, caves, disconnected pieces and convoluted geometry are preferred. A heightfield is a fallback, not the current architectural assumption.

The owner has already built TMT, Pinionfall Planets and an adaptive Solar-System renderer. Repeating a familiar patch/voxel system with nicer blending would not answer this project.

## Recommendation

The initial recommendation was to prototype a **bounded procedural field oracle** and select from evidence before expanding it. The owner's implementation brief subsequently authorized the complete experimental engine. Ordered interval visibility, planetary precision, geology/materials, durable erosion, unified optics and the browser laboratory are now implemented; production performance remains unproven. The comparison baseline is a finite CPU micromesh over the same small solid, not a completed GPU raster competitor.

The owner also identified shared terrain/cloud/atmosphere/water rendering as a central opportunity. See [the unified field design](UNIFIED-FIELDS.md). The interface must allow both surface events and participating media; it must not bake in a terrain-only distance query.

The world is a deterministic program and sparse durable changes. A view owns a bounded working set. A surface mesh, acceleration structure, cache entry or texture page is disposable derived data. No whole-planet volume tree is authoritative.

The distinction is not trees versus no trees: a small hierarchy over the resident working set may be useful. The allocation must not scale with the finest possible resolution of unvisited space.

## The useful research bet

Ordinary procedural shaders return a value, leaving the renderer to guess how much geometry is enough. Our restricted generator should also supply:

1. Region intervals for solid/empty/unknown classification.
2. Approximation error envelopes, including omitted spectral residuals.
3. Derivative/curvature bounds where available, with numerical error tracked separately.
4. Eventually, a footprint-dependent description of unresolved geometric and material variation.

This makes the generator and renderer a co-design. A smaller set of operations with useful bounds may beat an unrestricted noise graph that cannot say what is hidden between samples. Domain warps need Jacobian bounds; CSG operations need valid interval composition; displacement does not turn an arbitrary field into an SDF.

The potentially valuable extension is **integrating the fine remainder**, rather than materializing all of it: preserve the deterministic realized surface at resolvable scales, and investigate coverage/normal/transport statistics for unresolved structure. This is inspired by recent implicit microgeometry research, not a claim of new theory. Preserving the same realization during zoom, its silhouette, and its correlation with the visible geology are open problems.

An important possible optimization is compiling accumulated coarse bands into local polynomial proxies with remainder bounds, then evaluating only nearby scale bands. It could reduce repeated prefix evaluation. Proxy construction, invalidation and cold-cache cost must be counted; this is not a constant-time theorem.

## Geometry choice

| Representation | What it admits | Main risk | Role |
| --- | --- | --- | --- |
| Spherical heightfield | One radial surface per direction | Cannot express general topology | Performance/quality baseline and explicit fallback |
| Displaced surface atlas | Overhangs present in the base atlas | Displacement cannot freely create handles or disconnected components; atlas generation is work | Candidate derived surface representation |
| Bounded implicit solid | Caves, arches, holes, disconnected components | Expensive visibility and bounds; robust extraction is difficult | Preferred canonical geometry interface |
| Dense or globally expanded voxel hierarchy | General geometry at a chosen resolution | Storage tied to world volume or maximum subdivision | Excluded as world representation |

"Supports arbitrary topology" does not mean constant-cost rendering of arbitrary complexity. Infinitely nested opaque sheets are an adversarial counterexample. A production generator must bound program complexity and offer a meaningful approximation policy.

## Rendering candidates

**Procedural micromesh:** find relevant regions, generate a bounded amount of locally adapted surface geometry, rasterize visibility, then shade visible samples. This amortizes field work between neighboring pixels and suits opaque terrain. Remaining difficulties include topology extraction, shared boundary identity, rapid cold-cache jumps, and browser scheduling. Connectivity must conform by construction; skirts or fading cannot be the correctness argument. Conforming meshes alone do not prove temporal continuity.

**Direct implicit visibility:** query regions/ray segments, reject certified empty space, refine uncertain intersections. This preserves the canonical field and avoids mesh transitions. The failure mode is large query counts at grazing angles or in convoluted porous solids. Global sphere tracing is a baseline to beat, not the chosen solution. A fixed iteration cap bounds runtime by returning unresolved work; it does not certify a correct image.

**Stochastic microgeometry:** investigate filtering the unresolved remainder for either candidate. This is not a substitute for resolved caves and cannot quietly replace deterministic topology with a different random scene.

The comparison will decide whether one backend suffices. Backend switching is not currently the architecture or a hidden transition plan.

## Meaning of constant cost

Aim for bounded resident resources and approximately stable cost **at a fixed viewport, image tolerance, generator complexity and visible-scene complexity**, independent of total universe size and potential finest detail.

For fixed queue capacity B, explicit queue storage is O(B). Addressing needs O(log(range/detail)) bits. Neither proves constant query cost. The current spectrum experiment explicitly evaluates O(number of requested bands), and rough cases already fail to meet a tolerance within its address budget.

A useful cost model is pixels times visibility-query cost plus visible shading work plus bounded generation work. The visibility-query term, proxy-building cost, topology complexity, overdraw, cold-cache misses and material diversity must be measured. They cannot be declared constant.

Arbitrary-speed travel must distinguish a correct coarse first image from full-detail readiness. Measure camera cuts without relying on temporal history. If the requested error cannot be met inside the budget, report the shortfall rather than silently claim seamless correctness.

## Precision and identity

Universe addresses use integer sectors/body identifiers and bounded local frames. Do not put a universe-sized Cartesian position in f64 and expect tiny details to survive. Shader coordinates use integer dyadic identity plus local offsets or compensated arithmetic. Rebasing must not change seeds, geometry or materials.

The current Q0.64 reference only demonstrates a finite address space on one periodic chart. It does not solve chart seams, arbitrary body placement, GPU projection or millimetre displacement accumulation. Those need separate tests.

## Materials and erosion

A large global material registry can use virtual pages and one parameterized evaluation model. Resident pages, contributing layers per sample and program complexity remain bounded. Unlimited distinct arbitrary shader programs in a single image do not come at constant cost. Filter unresolved material mixtures with an explicit error policy.

Geological structure is a different problem from rendering. River catchments and sediment transfer are nonlocal. Independently eroding disposable tiles will not produce a coherent planet. Investigate a deterministic drainage skeleton, basin boundary conditions and multiscale simulation/amplification. Store authored or simulated durable state separately from disposable render caches. Procedural erosion-like patterns must not be presented as a physical erosion simulation.

## Selection gates

Use docs/EXPERIMENTS.md. Select a backend only after cold-cache, silhouette, precision, overhang, queue exhaustion and generation-bound tests. Keep a rasterized heightfield baseline and an f64 reference query. Prefer the simplest candidate that actually survives these tests; stop pursuing a novel branch when its expensive cases remain worse.

## Implementation decisions — 25 October 2026

- Retain the arbitrary-topology canonical solid and ordered interval backend as the experimental implementation. A finite cap returns unresolved work. Local signed directional/Taylor bounds reduced spectrum work in the matched small-solid suite; they do not establish a completed-image speedup on every planetary view.
- Use camera-local cubic differences and integer band identity. The original centimetre-scale scalar probe is retained as historical evidence, while separate planetary and rebase audits now exercise submillimetre error envelopes.
- Retain cubic lattice noise. The bounded 27-cell sparse-convolution candidate cost more in the focused CPU test and did not justify replacing it. This is not a universal rejection of sparse convolution.
- Reject the tested uniform marching-tetrahedra/BVH resolutions as a matched 1 mm baseline: their measured geometry error remains too large, including a missed small feature. The later bounded GPU extraction/raster experiment below also failed its acceptance gate.
- Keep shared medium sample positions: shared and independent air/cloud walks agree at the same settings. Finite quadrature and diffuse multiple-scattering fill remain explicit approximations.
- Reject the hard 20 m ocean footprint switch: it made a visible arc between two shading models. Use one water model and continuously filter wave frequencies. Replace Schlick's approximation at the water-to-air critical angle with exact dielectric reflectance; the approximation jumped abruptly into total reflection.
- Carry the interface footprint into secondary visibility. Resetting far-water rays to a 2 mm floor over-refined below the visible pixel and numerical envelope. A 640×360 distant-water comparison reduced secondary spectrum work by about 89% and secondary unresolved rays from 15,447 to 51 with identical primary counts. This adopts the intended pixel tolerance rather than claiming equal internal 2 mm query precision.
- Preserve a finite 512 m erosion basin as durable state. Do not claim planet-wide simulated drainage from this experiment.
- The 1080p/60 fps target has failed so far. No heightfield fallback has been adopted. The later performance pass tested a bounded surface cache; its rejection leaves a demonstrably cheaper interval workload or a better derived representation as open work, with cold-cut costs included.
# Performance experiment follow-up — 25 October 2026

Keep WebGPU as requested by the owner. Completed bounded GPU surface extraction/raster trials over the same field did not establish useful acceleration. The 1 mm local frontier overflowed and yielded no visible proposals; coarser hints still required almost all canonical work and failed the ground exact-image gate. It remains an explicit off-by-default research probe, never authoritative geometry. See [performance contracts and evidence](PERFORMANCE.md#bounded-derived-gpu-surface-experiment).

Keep 8×8 workgroups; 4×8 lost the ground comparison and 16×4 did not exceed baseline variation. Remove the unsuccessful clear-air solar table from the experimental solar path. Compile independent-media audit shaders on demand. The performance objective remains unmet; no Quality/Balanced mode or automatic scaling policy is accepted by these changes.

## Final performance-pass decisions

- Retain linear unexposed RGBA16F, one display transform, independent input/output dimensions, the spatial control, async bounded timestamps and the controlled allocation ledger. Keep diagnostic atomics out of production and compile default diagnostics on demand. Final diagnostic/production images and HDR samples match exactly in the three paired views. The measured timing difference is small and workload-dependent; this is not a large speedup claim.
- Keep exact-camera geological proxy reuse while animated water/cloud epochs update separately. Do not extend that cache to moving regions without a validity argument.
- Reject both analytic point normals and filtered-gradient/slope-variance normals as shipping replacements. Point derivatives pass the independent numerical audit but change the finite-width shading model. The filtered candidate removes substantial terrain contrast for small or negative timing gains. Derivative correctness is not filtered-radiance correctness.
- Reject the guarded 2×2 water-radiance sharing candidate: shoreline reflections became blocky, with maximum display error 140 codes. The central ROI missed this defect; retain worst-difference crops alongside fixed ROIs. Do not promote the unqualified 4×4 setting after that failure.
- Leave the 2 MiB solar cache disabled. A 900-sample-per-arm moving-cloud run reduced pooled GPU p50 from 232.05 to 189.19 ms, but the matched endpoint failed the predeclared 0.5% HDR gate at 0.602%. Nine of sixteen broader quality cases failed. Reject the 32 MiB denser expansion too: it still failed a body-cut ROI. Consistent boundary-node quadrature did not materially solve the error. Cold activation took 91.37 seconds.
- Retain native AA and TMT-derived TSR as experimental evaluation paths only. Their age, validity, reset and resource contracts pass finite tests, but native/77/67/50% comparisons do not establish a general quality improvement. Water and affected cloud pixels reject history; the 250 ms oldest-contribution cap also prevents useful accumulation on very slow terrain frames. No component denoiser is warranted without a beneficial stochastic estimator.
- Keep one pending frame. In the half-resolution real-time experiment, two pending frames nearly doubled synthetic camera-sample-to-completion latency (ground 176.8 → 331.5 ms, clouds 63.1 → 116.3 ms), with little cadence benefit. This is not physical input-to-scanout measurement.
- Do not add automatic quality or named Quality/Balanced controls: the prerequisite fixed modes failed qualification. Keep all approximation switches off by default, including the unsuccessful region and surface candidates.

The bounded pass is delivered with its failures. It has not fulfilled the original 1080p/60 fps or stable fine-detail ambition. The next representation experiment must reduce repeated field/transport work while preserving the canonical solid and explicit unknowns. WebGPU remains the requested product target; a native API port or hardware RT dependency has not been selected. See [the stage table, acceptance matrix and remaining frontier](PERFORMANCE.md#final-source-matched-image-stage-comparison).


## Halley game integration — 4 November 2026

The approved Halley is the default Rust/WASM/WebGPU player. Keep local Rapier collision authoritative near terrain and the existing sector-addressed solar integrator for travel; handoffs preserve motion and wait explicitly for collision coverage. Keep the orbital camera independent of car attitude, with camera-relative thrust and view-directed W steering. Water uses bounded fan-assisted buoyancy/drag, without changing the canonical water surface.

Replace the unsatisfactory individually ray-marched smoke spheres with one bounded co-moving fluid grid (advection, eight-step pressure projection, volume rendering). Its deliberate speed-independent confinement is an artistic choice requested by the owner; it is not a physical vacuum or obstacle-resolved fluid claim. Use actual wheel contacts for bounded tire ribbons and rolling grass compression memory. Increase ground-cover reach with fixed candidate/history/draw bounds and explicit overflow, full-sized geometry and pixel coverage fades. Approved compressed Halley assets remain byte-identical. See VEHICLE.md for exact bounds and evidence.


## Halley collision preparation follow-up - 9 November 2026

The owner requested removal of high-speed midair streaming stalls. Replace spherical car-centred
coverage with the radial footprint actually sampled by the terrain grid, keep terrain and object
coverage separate, prepare GPU-derived collision snapshots before the local handoff, and preserve
those colliders across same-body transitions. Publish the bounded 512-object set in one update for
the single car instead of suspending it through 24-object activation batches. Static snapshots
remain useful while their footprint covers the swept path; failed updates cannot extend that
footprint. Readback scheduling responds to lateral travel. Fast object queries cover a narrow capsule along
velocity instead of a dense circular disk; total speed sizes terrain coverage ahead of an impact.
Unknown source coverage still remains
unknown and retains its guard. This does not claim arbitrary-speed readiness with finite buffers
or remove the existing sampled-heightfield/proxy approximation. Evidence and remaining bounds
are in VEHICLE.md under Collision preparation and cockpit steering.


## Stable cover admission and road imagery - 9 November 2026

Reproduced ground-cover overflow after Lausanne travel, including repeated replacement of plants
with a stationary camera. Use deterministic whole-hash-bucket admission before compaction rather
than allowing GPU atomic arrival order to select survivors. Increase the fixed draw capacity to
155,648 entries and retain root support, species and birth maturity in the bounded cell cache.
This costs 50.881 MiB more fixed GPU memory plus bounded admission/emission work; no performance
improvement is claimed. Missing support can retain an existing root but cannot create a new one.

For measured Earth, use fine root-scale imagery to exclude nongreen ground from grass/bush/reed/fern
placement; retain the prior decision during page loss or coarser fallback, and fade source refinement.
This is an explicit imagery heuristic, not a vector-road exclusion guarantee. Keep rejected draw
counts observable and test deliberately undersized lists. See SCENERY.md for capacities, limits
and browser/native evidence, including forward/reverse views and non-Earth cover.


## Prepare the orbit arrival corridor before local physics - 9 November 2026

A real Orbit-to-Moon descent exposed a permanent wait above visual support range. Scale
collision preparation by closing travel and permit bounded support work below the car
independently of visual draw reach. Give the car's swept corridor first placement priority
within the existing generation budget; local collision cannot wait behind unrelated visual
rings. Keep all source/overflow guards and incoming momentum. Retain a failed replacement's
last valid patch, but shrink its requested reach only for capacity overflow, not temporary
missing input. No speed clamp, gravity cancellation or position correction is added.
Bounds and qualification are in VEHICLE.md, Orbit-descent collision deadlock.

The early handoff band also waits for coverage while sector motion continues, with a
mandatory local-physics deadline at 400 m plus 0.1 seconds of closing travel. Widen the
fast corridor from 16 to 32 m, increase its object cap from 512 to 1024, and extend its
maximum reach from 240 to 400 m. Above 1000 m/s lateral travel only, use a 257-square
terrain grid instead of 129 square at the existing sample spacing. The fixed snapshot
and readback allocations grow by 5.758 MiB. The larger fast-travel mesh costs more CPU
work; this is a readiness repair, not a frame-rate claim. The deadline retains
the unknown-data guard rather than allowing an unprepared craft through the surface.


## 10 November 2026 — mapped water, urban sources and interstellar destinations

The explorer again draws an actual river interface. The previous bed-colour substitution left the car above the displayed water and did not support convincing immersion. Inland water proxies now resolve to the finest resident water level along the view ray; the mapped-bed colour fallback is removed, and elevated lakes participate in the near-plane crossing pass. MVT lake identity includes feature IDs. Three projection iterations bound work; source-level accuracy and pathological discontinuities remain explicit limitations. Controlled lake tests reconstruct surface heights independently above and below water.

Roads use mapped centreline/width records to shade the displayed terrain directly. This makes their visible depth identical to the terrain through refinement and morphs. It adapts roads to the terrain rather than changing terrain topology; engineered bridges/tunnels remain outside that model. A bounded raw-source spatial index excludes props/ground cover from roads and buildings, with conservative scenery exclusion in saturated cells and an overflow counter. CPU code uploads source data and constructs the existing physics shapes; GPU code generates visible geometry and materials.

Five named stellar destinations extend the hierarchical local-frame system with deterministic synthetic planets. Their surfaces and circular orbital models are game content, not measured exoplanet reconstructions. Procedural destinations explicitly disable mapped-page streaming. See [EXPLORER-OVERHAUL.md](EXPLORER-OVERHAUL.md) for controls, limits and validation commands.

## 10 November 2026 — eliminate redundant game work

Keep quality, content, collision guards and the Rust/WASM/WebGPU architecture unchanged. Imported rigid vehicle triangles use their existing raster depth; only exactly zero-contribution exhaust samples skip shading. Reuse immutable hierarchy storage and draw membership while recalculating poses, colliders and glass order every frame. These changes have repeated browser whole-frame evidence, not just isolated-pass timings.

Deduplicate complete selected vector sets by tile address and fetch generation, retaining priority-sensitive admission when either feature/point or road limits overflow. Independently compare validated raw urban bytes in Rust before rebuilding the source index or invalidating collision coverage. This cache depends on absolute source data, not the view or settings; body reset clears its validity, while changed sources still invalidate coverage. Preserve terrain refinement and arrival history. The additional raw-source storage is capped at 3.75 MiB and reported.

Bracket the entire encoded GPU frame, including Solar System work, and report no stale surface stages on space-only frames. The former `scenery_atlas_clear` label actually measured ground cover. Controlled vehicle cases improve, but 60 fps at 1080p and startup improvements remain unmet. See [OPTIMIZATION-2026-11-10.md](OPTIMIZATION-2026-11-10.md) for qualifications and remaining costs.

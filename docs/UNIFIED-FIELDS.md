# A common field system for terrain, clouds, atmosphere and water

Original research direction, now exercised by the Rust/WASM/WebGPU engine. See [implemented contracts](ENGINE.md) and measurements (`evidence/ENGINE.md`, development repository only). The shared coordinates, surface events and shell-partitioned optical walks are implemented. The proposed fully certified optical error allocator and unrestricted field graph remain research directions; the renderer uses finite quadrature and a restricted compiled vocabulary.

## The opportunity

A ray should not need four unrelated spatial worlds, four unrelated coordinate systems and unrelated procedural detail policies. Use one deterministic world address and one bound-aware field program, queried by a common traversal.

The region query should return different kinds of evidence together:

| Channel | Meaning | Useful bound |
| --- | --- | --- |
| Solid/interface | Terrain, cavities, water boundaries | Signed-field interval, derivative bounds, unresolved displacement envelope |
| Extinction | Clouds, atmospheric gases, suspended water particles | Nonnegative density/extinction majorant and optional minorant |
| Scattering/emission | How occupied media interact with light | Albedo, phase-function family, emission range, integration-error bounds |
| Material state | Rock, soil, liquid, ice, mixtures | IDs/parameters, mixture bounds and unresolved normal statistics |
| Refractive state | Which optical medium a ray occupies | Interface identity, orientation and index of refraction |

A joint empty-region test can skip a segment when no relevant surface can intersect it and the upper bound on its optical contribution fits the error allocation. Bound bookkeeping may be shared; geometric distance bounds and extinction majorants are not interchangeable.

For a homogeneous upper extinction bound M over segment length d, optical depth is at most M*d. Its maximum removed transmittance is 1-exp(-M*d). This alone does **not** bound in-scattered or emitted radiance: incoming illumination, phase behavior and emission need their own bounds or a declared approximation. A thin-looking cloud under a bright sun is a useful failure case.

The shared traversal can emit a nearest interface event, an integration segment, or an unresolved interval. Integration and specialized shading may run in separate wavefront passes to control GPU divergence. This is still one representation/traversal system, not a demand for one enormous shader.

## Why arbitrary topology matters here

An implicit solid describes terrain overhangs. Another interface can describe a water body. Density fields describe fog and clouds. Their boundaries can meet and overlap without introducing a separate terrain mesh world whose seams need independent repair. A physically meaningful medium-composition policy is still required: add participating coefficients for real mixtures, exclude air from solid rock, track inside/outside at refractive interfaces, and define priority for incompatible solids.

Water cannot be represented solely as a translucent density blob. Reflection/refraction, total internal reflection and repeated interface crossings create additional rays and costs. Cloud and atmosphere multiple scattering introduces light-transport work as well. A common query system removes duplicated spatial work; it does not remove the underlying transport problem.

## The unusual branch worth testing

Can unresolved porous rock, mist and thin water features have a common footprint representation that preserves both surface coverage and optical thickness? Can scale changes expose the same deterministic realization rather than resample a new one? Could their contribution bounds share a cheap region description?

This is related to [Gaussian-process implicit surfaces](https://cs.dartmouth.edu/~wjarosz/publications/xu25practical.html), which explicitly study a continuum between surfaces and volumes. [Bounded GPIS marching](https://cchen-77.github.io/projects/bounded-gpis/) is an acceleration lead. Those results do not establish a unified real-time planetary renderer. Probabilistic empty-space claims must be labeled separately from deterministic conservative bounds.

## First test

Use a solid with an arch or bored tunnel, a water interface crossing its entrance, a bounded cloud field behind it, and a thin analytic atmosphere. Compare a shared traversal with separately traversed fields under identical lighting and query accounting. Include a camera cut into the tunnel, a grazing wet shoreline, cloud silhouettes against the sun, and a camera crossing the water boundary.

Record field evaluations, bounds evaluations, transmittance error, unresolved intervals, interface ordering, queue occupancy, and total GPU time. A shared system that only saves a few dispatches while increasing divergent field work is not a success.

This rendering design does not simulate weather, fluid flow, hydrology or erosion. Shared physical state is a future separate decision.

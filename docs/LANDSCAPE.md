# Prior art and competitive review

Reviewed 25 October 2026. This is a source-based shortlist, not a claim that these projects were benchmarked locally. Visual quality rankings need matched captures; public demos and native games are not controlled performance comparisons.

## Browser projects

| Project | Public evidence | Relevance / what remains unestablished |
| --- | --- | --- |
| [The owner's linked WebGPU post](https://www.reddit.com/r/webgpu/comments/1uj4iti/working_on_a_realtime_procedural_planet_generator/) | Author SaabiMeister describes compute/vertex/fragment rendering, a graph shader tool, and orbit-to-surface LOD; comments discuss future vegetation and erosion | A useful interactive control and visual reference. A video and author claim do not establish real planetary units, arbitrary topology, conservative error, memory scaling or cold-cache performance. |
| [saabi/virtual_planet](https://github.com/saabi/virtual_planet) | README describes instanced spherical patches, GPU terrain, erosion and water; this repository is described as WebGL/SvelteKit | Related prior-art lead; identity/version equivalence to the linked WebGPU demonstration is **not verified**. Do not conflate the two. |
| [False Earth](https://github.com/momentchan/false-earth) | Public browser project with WebGPU terrain, vegetation and character interaction | Attractive near-ground environment/art-direction reference; no reviewed evidence here for Earth-radius geometry or generic solid topology. |
| [Goldberg Planet](https://github.com/matthew-kissinger/goldberg-planet) | Reports streamed terrain and editable columns allowing tunnels/overhangs, with published browser measurements at radius 900 | Strong interaction/persistence reference. Its small test radius and finite tile topology are not evidence for millimetres on an Earth-sized body. Measurements are the author's, not ours. |
| [Procedural Planet — Ciarán McCormack](https://www.ciaranmccormack.com/labs/procedural-planet) | Describes floating origins, WebGPU, multiple WASM cores, visual checks and per-pass measurement | Valuable verification-workflow reference. Public architecture description does not by itself demonstrate our full topology/detail/cold-cache requirements. |
| [jo56/procedural-terrain](https://github.com/jo56/procedural-terrain) | Rust/WASM/WGSL compute heightmaps and a recycled chunk pool | Direct stack baseline, rather than a new answer to surface representation. |

The owner's local TMT, Planets and Solar-System README/source entry points were inspected. TMT already has a substantial custom WebGPU renderer and Rust terrain core; Planets documents voxel terrain, workers and LOD transitions. They are experience to build on, not copied dependencies.

## Production-game references

**Star Citizen:** use it as a visual benchmark for geology, material coherence and ground/orbit composition, not as proof of a single magic terrain representation. CIG's [March 2025 technical report](https://robertsspaceindustries.com/en/comm-link/transmission/20537-Star-Citizen-Monthly-Report-March-2025) discusses denser rock placement, shading, a virtual terrain system and runtime compression work. The [3.10 postmortem](https://robertsspaceindustries.com/en/comm-link/transmission/17787-Alpha-310-Postmortem) documents re-authored heightmaps. The [3.11 postmortem](https://robertsspaceindustries.com/en/comm-link/transmission/17887-Alpha-311-Postmortem) describes scanned material data and tessellated geology assets. These are dated evidence of their pipeline, not a statement of every current subsystem or native/browser parity.

**No Man's Sky:** the [Hello Games GDC presentation](https://www.gdcvault.com/play/1024265/Continuous_World_Generation_in__No_Man_s_Sky_) explicitly covers voxel generation, polygonization, texturing, population and simulation. [Worlds Part II](https://www.nomanssky.com/worlds-part-ii-update/) is a more recent visual/content reference with varied terrain, deep oceans and floating islands. This is the useful reference for topological freedom and coherent interactive worlds. Neither source supplies a controlled benchmark against our proposed algorithm.

## Research that changes the shortlist

**Bounded active topology is already possible.** [Benyoub and Dupuy, 2024](https://arxiv.org/html/2407.02215v1) decouple subdivision depth from a fixed-capacity allocation pool. Their reported planetary topology storage is about 7 MiB. This directly counters allocating a full structure to maximum subdivision depth. [Reference code](https://github.com/AnisB/large_cbt). Its topology-update timings must not be quoted as total terrain-generation, shading or browser frame time. This is the strongest established GPU triangulation baseline, not a novelty claim for Solar-System v2.

**Amplification is not identical to prebuilt Nanite.** Brian Karis's [approaches discussion](https://graphicrants.blogspot.com/2026/02/possible-approaches-for-tessellation.html) explains the difficulty of content-adaptive runtime tessellation when the displacement signal is unknown. [Nanite + Reyes](https://graphicrants.blogspot.com/2026/02/nanite-reyes.html) describes splitting/dicing, displacement bounds and queue scheduling. [Edge factors](https://graphicrants.blogspot.com/2026/02/how-to-tessellate.html) show why matching boundary evaluation is a construction requirement. These motivate giving our generator a bounds interface rather than relying only on triangle size.

**Implicit bounds can avoid many field evaluations.** [Segment Tracing](https://aparis69.github.io/public_html/projects/galin2020_Segment.html) uses local bounds along ray segments. [Generalized Lipschitz Tracing](https://onlinelibrary.wiley.com/doi/10.1111/cgf.15202) investigates directional local bounds with preprocessing. These are alternatives to naive global sphere tracing; they do not establish cheap evaluation for arbitrary planetary fields.

**The most unusual lead is unresolved geometry.** [Xu et al., 2025](https://cs.dartmouth.edu/~wjarosz/publications/xu25practical.html) reformulate Gaussian-process implicit surfaces with sparse convolution noise. [Chen et al., 2026](https://cchen-77.github.io/projects/bounded-gpis/) introduce point and region bounds to reduce full evaluations; their acceleration includes probabilistic empty-region reasoning. Deterministic conservativeness and probabilistic bounds are different contracts. Explore these ideas for subpixel geometry and appearance, while explicitly testing realization consistency and avoiding a claim that either paper solves planetary navigation.

**Additional generation leads:** [procedural resurfacing, 2025](https://diglib.eg.org/items/0460b6c6-1216-4bf2-b6ac-14db88c65c45) generates surface geometry with mesh shaders, so its performance cannot be assumed for a WGSL compute implementation. [Multi-scale erosion](https://h-schott.github.io/p/mserosion/) amplifies hydrologically coherent terrain through erosion/deposition approximations. [Controlled procedural erosion patterns](https://onlinelibrary.wiley.com/doi/full/10.1111/cgf.14992) are an alternative for oriented fine detail. Neither makes independently generated tiles globally hydrologically consistent for free.

## What could actually give Solar-System v2 an edge

Our hypothesis is that co-designing the geometry program, its approximation bounds and unresolved-detail filtering can eliminate substantially more work than improving a generic LOD scheduler. This is an inference and a testable research direction. Prior art already covers individual pieces; novelty, if any, would need to be established for a specific algorithm and measured result.

The first competitive target is stable geometry-only frames on hostile camera paths. Lighting, atmosphere and scanned materials should be compared later on the same geometry and exposure. A cinematic screenshot is not the selection gate.

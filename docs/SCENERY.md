# Procedural scenery implementation and qualification

Trees, forests and rocks run in the existing Rust/WASM/WebGPU explorer. Use the
Forest, Conifers, Canopy, Rocky and Coast bookmarks and the collapsible Scenery
controls. This is a working implementation with qualified limits, not a claim
that every image-quality target passed. Compact measurements are in
`evidence/scenery.json` (development repository only); stills and motion are in
`evidence/scenery/` (`evidence/scenery`, development repository only).

## Second pass: grown trees, geological rocks, ground cover (4 November 2026)

Brief: `docs/NEXT-CONTEXT-TREES-ROCKS-2.txt` (development repository only). This section supersedes the first pass's
"Geometry, materials, wind and distance" where they differ; the contract (GPU-owned generation, persistent identities,
displayed contact, fixed capacities, no imported assets) is unchanged.

### Prior art and licences (reviewed before design)

| Source | Licence | Use here |
|---|---|---|
| Weber & Penn, *Creation and Rendering of Realistic Trees* (SIGGRAPH 1995) | paper | ideas: per-order parameters, crown shape ratios (conical, spherical, hemispherical, cylindrical, tapered, flame, inverse), attachment along parents |
| Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* (1990) | book | ideas: phyllotaxis (137.5 degree divergence), whorls |
| Palubicki et al., *Self-organizing tree models* (SIGGRAPH 2009) | paper | ideas: tropisms (gravitropism, phototropism) and apical control as bends; no space competition is simulated |
| Runions, Lane & Prusinkiewicz, space colonization (2007) | paper | considered, not used: needs iterative growth per tree, which the bounded one-job-per-frame generator does not afford |
| Billboard clouds (Décoret et al. 2003), octahedral impostors | papers | the impostor stays octahedral (first pass); see "Distance" |
| ez-tree (github.com/dgreenheck/ez-tree) | MIT, Copyright (c) 2024 Daniel Greenheck (checked 4 Nov 2026) | reviewed; no code adapted |
| proctree.js (github.com/supereggbert/proctree.js) | no licence stated in the repository (checked 4 Nov 2026) | ideas only, no code |
| Arbaro, Blender Sapling, Blender rock generators | GPL | not read for code; ideas only through the papers above |
| SpeedTree | proprietary | quality bar only |
| Golombek & Rapp (1997), JGR 102(E2) 4117-4129; Golombek et al. (2003), LPSC XXXIV | papers | Mars rock model: cumulative fractional area F_k(D) = k exp(-q(k) D), q(k) = 1.79 + 0.152/k |
| Pajola et al. (2019), Planetary and Space Science (Linné crater boulders, LROC NAC) | paper | lunar ejecta boulders: cumulative power-law index -4.03 (+0.09/-0.10) for blocks over 4.4 m |
| Ruesch et al. (2022), EGU22-13240 | abstract | young boulder populations follow power laws, older ones exponentials |

No novelty is claimed. Everything is procedural; compact parameter tables only.

### Trees

**Species model** (`scenery_common.wgsl` `sc_species_base`): fifteen growth forms, each a row of parameters in
fractions of the tree's height: spruce (conical, whorled, drooping), pine (high crown, umbrella when old, orange upper
bark), larch (conical, soft tufts), oak (decurrent, spreading, gnarled), beech (dome, smooth grey bark), maple (dome,
palmate leaves), birch (slender, white papery bark, pendulous twigs), poplar (columnar), willow (weeping whips, by still
water), alder (by water), palm (curved ringed trunk, fronds), acacia (flat umbrella, arid), shrub (multi-stem), dead
snag, fallen log. Age classes (young, mature, old; per tier 3, 2 or 1) change limb count, crown width, crown base, gnarl,
trunk radius and dead limbs; an old pine flattens into an umbrella.

**Growth** (`scenery_trees.wgsl` `scenery_tree_skeleton`, one workgroup per variant job): the trunk (or a log's length,
a shrub's stub, a palm's curved stem); up to 48 limbs placed in whorls or by the 137.5 degree divergence, at angles that
move from the crown base to the top, long enough to reach the crown envelope (Weber & Penn's shape ratios); decurrent
crowns end the trunk in leaders; conifers drop dead stubs below the living crown. Branches (192) and twigs (768) are a
fixed budget spread over the living parents by length, alternating sides in the plane facing the light, shorter toward
the tip. Tropisms are bends: rise (phototropism, apical control), sag growing with length (gravity), weeping whips.
Leaf cards (2048) go where twigs carry them, more on the outer crown; conifer sprays lie along limbs and the leader.

**Geometry** (`scenery_tree_vertices`): three levels on fixed templates. LOD0: trunk 12 x 20 sides x rings, limbs
7 x 8, branches 5 x 4, twigs 3 x 1, 2048 cards: 23,825 vertices, 11,120 quads. LOD1: 8 x 10, 5 x 4, 3 x 2 and 512 cards
(each the area of four): 5,891 vertices. LOD2: 5 x 5, 3 x 1 limbs and 128 cards (each sixteen): 932 vertices. Vertices are
packed in 32 bytes (position 3 x 21 bits, octahedral normal and tangent, coordinates, material, order, occlusion, limb
phase, species and card quadrant, wind weights, radius). Occlusion comes from depth in the crown envelope.

**Leaves** (`scenery_leaf_atlas`): one 512 x 512 layer per species (four 256 x 256 card variants; 256 on the minimal
tier), drawn analytically: a main twig and alternating side twigs with their leaves or needles, 2 x 2 supersampled.
Outlines: ovate, lobed (oak), palmate (maple), lanceolate (willow), deltoid (poplar, birch), round (alder), small (shrub),
bipinnate leaflets (acacia), needle sprays (spruce), long needle bundles (pine), soft tufts (larch), pinnate fronds (palm),
fern fronds. Per leaf: size, angle and colour variation, a pale midrib, veins, an occasional old leaf, roll and midrib
fold in the normal, translucency (blades 1, needles 0.45, stems 0) and height in the card. Colour is sqrt-encoded albedo;
mips keep coverage toward the larger of mean and maximum so needles survive the alpha test.

**Bark** (`sc_bark`), per fragment, in metres around and along each branch: scaly (spruce), plated with an orange upper
trunk (pine), furrowed with breaks (oak, larch, poplar, willow, acacia), smooth with faint marks (beech, maple, alder),
papery with lenticels and dark patches (birch), ringed with fibres (palm), weathered and cracked (snags, logs, dead
limbs). Thin wood is smooth whatever the species. Normals from the pattern's finite differences, faded with the pixel
footprint.

**Lighting**: leaves take wrapped diffuse light on the sun's side and transmitted light (tinted) when the sun is behind
them, weighted by the card's translucency carried in the G-buffer tag (-102 less half the translucency; reeds -102.4375,
grass -102.375). The underside of a leaf is paler. Neither glows at night.

**Wind** (`sc_wind_model`), three bounded layers: sway of the whole tree (quadratic in height), each limb with its phase
bending its branches, twigs and cards, and card flutter along the normal. Bound in model units at full controls:
0.018 x 1.69 x 3 + 0.02 x 3 + 0.006 x 3 < 0.2, the culling margin.

### Rocks

Six families on cube-sphere grids (LOD0 6 x 16 x 16, LOD1 6 x 6 x 6), four seeded variants each: fractured blocks (plane
cuts of a superellipsoid, chips), bedded slabs (strata set back as ledges along a dipping plane), river cobbles, exfoliated
granite boulders (shells and crack grooves), talus and scree (platy, sharp cuts), regolith blocks (pitted). Each instance
adds a yaw, a tilt of up to 11 degrees and a stretch of 0.85-1.15 per axis. Material in the rock's own frame (metres,
offset by the instance's seed): granite speckle, grit, strata bands per rock, quartz veins of one plane family,
bleaching on exposed tops, lichen rosettes and moss on moist upper sides (Earth-like bodies), desert varnish where dry,
darkening near water, dust mantles on airless bodies, ice tint on icy ones.

Sizes: records hold the upper tail a cell can carry, as a truncated power law (cumulative index 2.4 on Earth-like bodies)
from 0.44 m to the family's largest (cobbles 1.1 m, talus 5 m, slabs 9 m, blocks 10 m, granite 18 m). Giant boulders and
glacial erratics (10-36 m) claim their neighbours' cells, decided from hashes alone so that neighbours agree. Pebbles and
small stones (3-14 cm, six to a cluster) are ground cover.

**Footprint support**: every rock variant records its lowest point over an 8 x 8 grid of its footprint at generation.
Support samples the displayed surface under 2 x 2, 3 x 3 or 5 x 5 cells by size and puts the origin as high as the
lowest clearance allows, so that no part of the base floats; it then sinks by a settling fraction (6% of the size, 25% on
airless bodies). An independent f64 check (`scenery_reference::inspect_footprints`) intersects 7 x 7 radial columns with
the published terrain triangles and with the rock's own generated mesh.

### Ground cover

Draw lists rebuilt each frame from a persistent root/species cache (`scenery_cover.wgsl`): sub-cells of the record lattice
of about 1.5 m on any body within the reach (220 m high, 260 ultra, 140 medium, 70 low, off minimal), keyed by body, face
and sub-cell, so the same clump returns at the same place. Grass clumps use near and far meshes with a 23–27 m hysteresis band. Half carry flowers. Other classes include
reeds with cattails, pebble clusters, ferns from the fern layer of the leaf atlas, and small bushes from the shrub layer.
Stable per-clump thresholds thin the population with distance. Admission and retirement take 0.55 seconds and settle at full or zero coverage.
Placement reads the displayed surface (`sc_support`) and the water layer: nothing but reeds where
the water layer says water or the ground lies under the water level; reeds only at still or slow water and under 0.8 m.

### Placement

`sc_eco`: a mean annual temperature from latitude and altitude (lapse 6.5 K/km; procedural planet 29 - 0.0052 lat^2,
real Earth 27 - 0.0062 lat^2) and moisture from 8 km and 600 km noise. Species weights by temperature, moisture,
distance to water (willow and alder near still water, poplar by water), coast (palms in warm climates) and aridity
(acacia), with stands favouring a few species; ages from a 1.4 km age field, younger at clearing edges; snags and logs
more in old stands. Real Earth: imagery colour still says where trees stand (no land cover yet), now also the water
layer (no tree within 2-5 m of water), slope and temperature (a treeline that falls with latitude: about 0 C mean, near
2,100 m at 46 N, 900 m at 60 N); darker canopies lean to conifers. Rock families from water (cobbles), slope (talus and
blocks) and a 2 km geology field (slabs, granite).

### Bodies without plants

Trees only on Earth-like bodies; rocks on every solid body of at least 150 km radius. Regolith bodies (Moon, Mercury,
Io, Ganymede and the like): blocks near the fresh craters of the material's own crater lattice (same hash and sizes as
`measured_craters`), their ejecta blankets and rims weighted by freshness cubed, plus steep ground and a sparse
background; a power law whose index steepens from 2.5 to 3.5 in fresh ejecta (Pajola et al. 2019 measured 4.0 at Linné
for blocks over 4.4 m), the largest block growing with the crater (0.25 D^(2/3), an assumption of this implementation).
Dusty bodies (Mars, Venus, Titan): the Golombek & Rapp (1997) model, rock area fraction k from 0.01 to 0.3 by ejecta,
slope and noise, q(k) = 1.79 + 0.152/k, counts per cell by numerical integration and Pareto sampling with exponential
acceptance. Each cell carries at most one rock: the tail of the distribution the cell area can hold.

### Draw path and generation

Template indices carry their class in the top byte, so one indexed indirect draw per class serves every variant: six
record classes (three tree and three rock meshes), tree impostor cards, and six ground-cover draws (grass near and far, reeds,
pebbles, ferns, bushes). Each shadow cascade has four streams for tree meshes, rock meshes, tree cards and far rock hulls.
Each rock shares nested 16-, 8- and 2-cell cube faces. Vertices move onto the parent triangles through a transition, and
the shadow caster uses the same surface. Far rocks use 48 triangles and keep their individual material and sun depth. Projected size and the detail control select one target representation per object. Each LOD transition advances one level in
0.22 seconds. Adjacent tree mesh and impostor draws share a rotating complementary mask during the transition. A small hysteresis band keeps a settled level stable.

Generation is one job per frame, chosen on the GPU by `scenery_begin` (first what visible records asked for, then the
rest in order): templates and ground-cover meshes once; a species' leaf layer; a variant's skeleton and vertices; or a
tree variant's 64-view impostor capture into a scratch target, copied and mip-filtered into its layer. Every job pass is
gated by indirect arguments (copied out of the state buffer, since a dispatch may not read its arguments from a buffer
it binds for writing) or an early exit. Records of a variant not yet generated are not drawn; one not yet captured draws
its coarsest mesh instead of a card. Rock variants are ready when their meshes are generated. Trees appear species by species, wanted ones first.

Culling runs as three passes: classify (which records need their support measured again), refresh (only those, at most
65,536 a frame, with the heavy support and footprint code), and the light pass that fades, chooses the level and fills
the draw lists. Footprint sampling scales with what a gap could show: 5 x 5 for rocks over 6 m within 250 m, 3 x 3 for
rocks over 1.5 m and logs within 400 m, 2 x 2 within 600 m, the centre beyond. A record whose footprint the published
surface cannot fully answer is still marked current and waits for a change of the terrain. The first version ran every
refresh in the single culling pass; its slowest threads (up to 26 sequential support lookups) cost 2.8 ms a frame in a
still view and 4.7 ms moving.

### Capacities and memory ledger (bytes, `Scenery::bytes`)

| Tier | Records | Geometry | Impostor atlas | Leaf atlas | Other | Total |
|---|---:|---:|---:|---:|---:|---:|
| full (384 cells, 3 ages, 48 px views, 512 leaf layers) | 99.1 M | 45.9 M | 108.4 M | 44.7 M | 10.4 M | 308,496,712 (measured) |
| reduced (288, 2 ages, 32 px, 512) | 55.7 M | 31.1 M | 37.7 M | 44.7 M | 7.4 M | about 176.6 M |
| minimal (192, 1 age, 24 px, 256) | 24.8 M | 16.5 M | 15.3 M | 11.2 M | 5.4 M | about 73.2 M |

The first pass's scenery total was 199,688,800 bytes on the full tier: the second pass adds 109 MB there (the impostor
atlas holds 69 variants instead of 16, though at 8 bits a channel and 48-pixel views; the leaf atlas and the larger
geometry are new). Reduced and minimal tiers are smaller than before. "Other": support stamps, template indices
(388,968), skeleton scratch (162,880), ground cover instances (1,966,080), draw lists (299,008), refresh queue (262,144),
capture scratch, state and diagnostics. Shadow caster lists grow from 2 to 3 streams per cascade (4.7 MB on full).

### Measured (4 November 2026, RTX 3080, BrowserWebGpu, 1920 x 1080, ultra test settings)

Performance, forest bookmark, clouds, atmosphere and water off ("isolated"), one browser session with the variants
interleaved over two rounds and no other process on the GPU (watcher log), GPU frame p50:

| Configuration | p50 ms |
|---|---:|
| scenery off | 8.43 |
| rocks only | 9.08 |
| trees only | 11.33 |
| trees and rocks (no ground cover) | 11.35 |
| trees, rocks and ground cover (default) | 12.19 |
| first pass, same bookmark (baseline run of the same tool) | 10.84 (off 8.16) |

Trees and rocks at the first pass's density cost 2.9 ms over scenery off against 2.7 ms before (about 9% more); the
target "at least as fast" is **missed by about 0.25 ms** in this view. Ground cover adds 0.84 ms (0.27 ms placement, the
rest raster and lighting of its pixels). Stage medians with ground cover: culling 0.19 ms (first pass 0.33), raster
1.70 (1.34), prop lighting 1.31 (1.03), ground cover 0.27, shadow casters about 0.6 (0.56). Moving at 50 m/s: culling
0.94 ms (first pass 1.74). The raster cost comes from coverage-preserving coarse levels: LOD1 and LOD2 cards keep the
leaf area of the cards they replace, so a mid-distance crown is drawn about fifteen times over with alpha tests.

The production-settings benchmark (`Test-Scenery --mode bench`, clouds and water on) was run twice but another
process's headless Chrome took 60-90% of the GPU in bursts during both runs (several "scenery off" cases measured 2.5-10
times their baseline); only the forest isolated, forest production and canopy isolated cases were clean, and they agree
with the table above. The medium and low presets were **not measured**. Both remain for the next session, on a quiet GPU
with the watcher.

Impostor gate (`Test-Scenery-Impostors`, same object forced to its finest mesh and to its card; ground cover off):
**10 of 20 pass, against 4-5 of 20 before.** All ten rock cases pass (IoU 0.88-1.00, depth p95 0.08-0.46 m). Trees still
fail: IoU 0.83-0.91 (before 0.82-0.87), depth p95 1.5-2.7 m (before 3.2-5.0 m), normal p95 62-133 degrees (before
73-104): one depth per view cannot hold layered foliage, and per-pixel leaf normals of a mesh and of a filtered atlas
disagree. More views, layered depth and billboard clouds were not tried in this session.

Water gate (`Test-River-Overflow --layer --scenery`, the canonical water union on the CPU): Wupper fixture 418 cover
instances and Douro 3,045 checked over bank, near and mid views, **none on water** (no reeds formed: both reaches flow).
Sampled cover roots lie 0.4-6.7 mm from the published triangles at the banks, up to 6.5 cm in the near views, where the
support follows the relief-refined surface the fragments show and the CPU check (published triangles only) does not.
The fixtures have no imagery, so no trees or rocks grow there; trees in water on real Earth are checked only by the
placement rule (no tree within 2-5 m of water), not by an independent test.

The footprint check, the full species sheet, leaf repetition and the airless bodies: see "Evidence" below.

### Limits and open work

- Trees fail the strict impostor gate; distant forests beyond the record window are the terrain's footprint cover with
  the climate's leaf colour (no crown texture or per-species density beyond it).
- Performance target missed by about 0.25 ms in the isolated forest; production presets unmeasured on a quiet GPU.
- Template topologies cost degenerate geometry for simple forms (a palm leaves 192 branch and 768 twig slots empty).
- Leaves are cards: four card images per species, repeated over a crown with rotation, scale, tint and occlusion.
- No seasons, no flowers on trees, no forest litter beyond logs, ferns and bushes; no shadows from ground cover.
- Real Earth: imagery colour and the water layer only; no land cover (M6), towns excluded only by colour.
- Airless bodies: blocks follow the material's own lattice craters, not the measured craters of the height data, whose
  freshness is unknown; the coefficient of the largest block per crater is an assumption.
- The independent placement reference (`examples/scenery_reference.rs`) checks keys, positions, sizes and the climate
  gate; species choice itself is not re-derived on the CPU.

### Evidence

All under $SOLAR_DATA/trees-rocks-2-2026-11-04/ (large evidence stays off the system disk).

| Run | Where | Result |
|---|---|---|
| First pass baseline: bench, impostors, before stills | evidence/baseline | forest isolated 8.16 off / 10.84 on ms; impostors 4/20 |
| Interleaved timing (`Inspect-Scenery --ab`, watcher) | evidence/dev/split-ab, cull-ab4, cull-move2 | table above |
| Production bench, ground cover on and off | evidence/pass2/bench-cover, bench-nocover | contaminated by another process in parts (see above) |
| Impostor gate | evidence/pass2/impostors-3 | 10/20 (rocks 10/10, trees 0/10) |
| Water gate | evidence/dev/water-wupper, water-douro | 0 cover on water |
| Species stills (oak, spruce, palm, birch, pine, larch; rock families) | evidence/dev/species1-3 | sheets; spruce still airy |
| Airless bodies (`Test-Scenery-Bodies`) | evidence/pass2/bodies | **inconclusive**: the run returned no scenery statistics and the Moon stop showed only coarse pages; rocks on airless bodies are implemented but not yet seen in the browser |
| Footprint check, leaf repetition, full species sheet, lifecycle suite, flicker | not run to completion | stopped at the owner's request to wrap up; next session |

Checks: tools/Check.ps1 steps (formatting, 128 Rust tests including the class-table test, Clippy with warnings as errors,
both WASM targets, explorer and probe shader validation) pass; the native GPU probe passes. The CPU reference test found a
real bug (warm-coast palms below sea level), fixed in the shader and the reference.

---

## First pass (October 2026)

### Ownership, capacities and work

Compute generates geometry, material parameters, placement, support, culling,
LOD, compacted lists and indirect arguments. Raster capture reads generated
vertices directly into GPU atlases. Production CPU code initializes resources,
submits bounded passes and supplies compact inputs. It never uploads generated
vertices, terrain-following instance lists or impostor pixels. Readbacks are
optional asynchronous profiling or explicit diagnostics.

| Resource | Fixed capacity / controlled payload |
|---|---:|
| Canonical toroidal face records | 6 × 384² × 112 bytes = 99,090,432 bytes |
| Generated variants | 16 × 6,144 vertices × 64 bytes = 6,291,456 bytes |
| Compact mesh and card lists | 2 × 32,768 × 4 bytes = 262,144 bytes |
| Material/coverage and normal/depth atlases | Two RGBA16F 512² × 16 layers, five mip levels = 89,391,104 bytes |
| Shared capture depth | 512² Depth32Float = 1,048,576 bytes |
| State and optional counter read | 256 bytes each |
| Contact diagnostic scratch | 64 × 64 vec4 = 65,536 bytes |
| Exact prepared-support stamps and metadata | 884,736 × 4 + 96 = 3,539,040 bytes |
| Scenery resources total | 199,688,800 bytes |
| Prop material attachment at 1080p | RGBA16F = 16,588,800 bytes |
| Entire explorer controlled payload at 1080p | See current integrated ledger in [INTEGRATED-PERFORMANCE.md](INTEGRATED-PERFORMANCE.md); earlier figures below predate shadows/cloud expansion |

The [integrated performance pass](INTEGRATED-PERFORMANCE.md) adds exact support
reuse after all published morphs complete. Translation/rebase, viewport, field
settings, terrain publication or revision invalidate it. The whole retained
window is still scanned and appearance/LOD/indirect compaction still advance on
every frame; missing footprint support is retried. This does not reduce density
or make hidden props wait for visibility. `support_reused`/`support_refreshed`
count that work in the existing scenery audit.

The original pilot budget was 98,304 records and 36 views per variant. Visual
inspection justified increasing the cache first to 393,216, then 884,736 records and 64 directions.
Identity resolution and per-frame caps did not increase. At most `scenery_budget` cells (default 4096, range to 8192) and
one geometry variant/capture are admitted each frame. The final wider window addresses the owner's distance-continuity report. Sixteen variants generate
incrementally. Empty cells are cached too. Near, middle and outer priority bands,
16-cell center snapping and at most eight cells of prediction prioritize travel.
All scans/queues have fixed capacities. Residency is omnidirectional; view
rotation does not determine placement. Travel cannot grow allocations.

Eight scenery timestamp stages separate placement, geometry, capture, support/
culling, raster, shading, atlas filtering and clear. The 17-stage resolve/read
pairs are 512 bytes each in four bounded slots. The ledger includes them.
Driver allocation, pipelines, staging/captures and browser overhead are excluded.
Resize overlap is reported separately; previous targets can remain alive until
prior GPU work completes. Bounded allocation does not imply bounded frame time.

## Canonical identity and displayed contact

Body/sector-derived seed, generator version and a fine face-cell key identify
objects independently of patch IDs, allocation sequence and camera direction.
Even integer cube coordinates agree with terrain's half-key lattice. Jitter
stays within cell interiors, avoiding duplicate face ownership. Cube-map area
compensation avoids sampling bias at edges/corners; statistical uniformity is
not a measured guarantee. Ecology combines 8 km moisture, 512 m stands, 64 m
clearings, 2 km geology, elevation and slope. Trees reject sea, shore and steep
slopes; geological exposure concentrates rocks. Sea, seed and durable edits
invalidate generation tokens. Revisiting cells reproduces canonical parameters.

Props translate rigidly onto actual published triangles using their shared morph
trajectories. They never stretch to hide canonical/display differences. Large
disagreement defers publication while the complete coarse planet remains visible.
Four extra support samples cover trunk bases or boulder footprints. Burial handles
the sampled downhill side; steep boulder footprints are rejected. These samples
are not a conservative certificate over every point under an irregular rock.

Independent diagnostics gather triangles from the actual published index stream
and intersect radial lines using f64 plane/barycentric math, without reusing the
shader's support lookup. Occupied final cases have maximum center-contact error
below 0.00058 m before intentional burial. The pole scene admits no objects, so
it provides no contact evidence. An independent 4,096-object CPU reference found
zero duplicate/key mismatches, maximum canonical position error 0.00142 m and no
sea trees. This does not certify footprint extrema or every possible seed.

## Geometry, materials, wind and distance

Four conifer and four broadleaf variants have tapered trunks, 31 branches and
768 procedural cutout leaf clusters. Eight rock variants cover fractured blocks,
sedimentary beds and rounded weathered stones. Seeded dimensions, branch layout,
crown spread, foliage color, size and yaw vary. Bark grooves, leaf coverage/veins,
rock grain, roughness and dampness are procedural.

Every generated vertex contributes to a GPU maximum-radius reduction. Capture
extent includes 0.02 model units; triangles lie within their vertex hull. Culling
reserves 0.15 more units for wind. Root sway is zero, growing quadratically with
height. Weather direction/shared phase combine with a small stable instance phase.
Maximum controls bound lateral displacement by 0.054 × model-height² × scale.
Normals are not fully deformed with wind. Cards share center sway, but cannot
reproduce every bending leaf.

Full-sphere octahedral capture has 8 × 8 directions, each 64² pixels. Capture and
runtime share the same upright model frame, linear model normals and signed depth
toward the capture eye. Four neighboring views use coverage-weighted filtering
and bounded parallax correction. Cell-local clamping/mips prevent atlas bleed.
Full-sphere views avoid an invalid hemisphere clamp below the object. The mesh/card switch falls within the 24–42 projected pixel band, scaled by the detail control.

Individual records occupy a bounded face window of 384 cells per side on the full tier. Its ground footprint varies with body radius and cube projection.
Within that window the same rule on every body selects rocks by estimated silhouette width and trees by projected height. Support preparation starts at 0.28 pixels.
The visibility threshold varies by object across the 0.38–1.45 pixel band and the population tapers near the residency edge.
Newly ready objects acquire full coverage in 0.48 seconds. Terrain readiness thresholds apply to new admission;
already-admitted props remain present while support refines. Missing support
retains the last radial support offset until the published surface is available.
Support and appearance are prepared throughout the entire retained window,
independent of the viewing direction. Frustum culling only controls drawing.
The dedicated stationary turn audit found 3,149 newly visible nearby objects
already at full readiness, zero fading newcomers and zero placement generation.

The owner's screenshot exposed a real distribution error: thresholded ecological
stands created nearly solid green and blue/tan surface patches. Those raised
aggregate passes were removed. Terrain shading now queries crown/stone-sized
footprints at the same canonical cell keys, jitter, density threshold and size
rules. Resident cells supply exact occupancy/parameters; unresolved cells use the
same hash and local ecological approximation. Individual coverage has a
complementary handoff to these footprints. Subpixel footprints integrate to the
expected crown/stone area per square metre, rather than filling a whole stand.
The same cube Jacobian cancels in physical area density. No view-dependent
material polygons or finite-distance-only disappearance substitute for cover.

The distant representation is still filtered terrain material: it does not
preserve crown depth, exact rock silhouettes or all small-field variation outside
residency. Canopy projection assumes an 8.5 m mean height; local occupancy is
approximate where a record has not been generated. Those are explicit limits,
not a claim that every distant tree is individually retained.

## Integration and future interfaces

Props write real depth, radial height, normal and an explicit material attachment
before lighting and transport. Tags below -100 distinguish bark, leaves, rock and
canopy from terrain's negative spacing tags. Terrain geology shading skips props;
a separate scenery pass lights them. Two-sided foliage responds to daylight,
including black night. Water/cloud transport reads the combined surface buffers. The owner found duplicate submerged rocks: low-confidence refraction blended the original undistorted screen pixel back into the bent-ray image. That fallback was removed. A second coastal screenshot exposed the screen-edge fade/deep-water rectangle. Refracted continuation now evaluates the canonical terrain field and shared terrain material along the bent ray; the screen-edge confidence ramp is removed. Offscreen props and bounded field-intersection error remain limitations; this is not complete secondary visibility.

Snapshots include toggles, density, detail, wind, generator version, time and
weather phase. Diagnostics expose counts, deferred work/support, overflow and
bytes. Validated debug caps and forced mesh/card isolation support exhaustion
and image comparisons without adding implementation controls to normal play.
`scenery_reference::ObjectKey` defines stable object IDs from which generation
parameters, canonical positions and bounds can be recomputed. No collision consumer
exists (the camera has no collision since the car's removal).
Geometry/material/bounds are available for the following shadow pass. All
planetary/terrain/tree/rock/cloud shadows and astronomy remain separate work.

## Qualification and failed gates

The final contact/lifecycle suite passed occupied contact checks, finite geometry,
capture bounds, settled 360-degree rotation with zero new placements, exact near
rebase captures, eviction/revisit identity, zero-work retention, draw/variant
exhaustion, seed/sea/edit changes, black night, fixed memory over 24 travel cuts,
resize, rejected invalid settings and device recreation. Empty pole contact is
explicitly untested. Independent math and actual browser execution are separate.

Twenty dense comparisons force the SAME generated object into mesh/card modes
across azimuth, elevation and 100/300/650 m distances. The strict silhouette IoU
≥ 0.85 and p95 depth ≤ 0.5 m gate passed 5/20 cases. Trees have IoU 0.816–0.873,
depth p95 3.15–4.98 m and normal p95 73–104 degrees. Rocks have IoU 0.919–0.975,
depth p95 0.177–0.614 m and normal p95 24–51 degrees. Close forced cards exceed
production LOD, but even the 650 m tree fails. Single-depth views cannot preserve
all layered foliage occlusion. Angular shading, thin overlaps and view-cell
transitions remain unqualified; no TAA or fog is used to claim a pass.

Failed pilots are retained: missing root-page controls; invalid timestamp
writes producing misleading zero timings; undersized fixed capture bounds; and
odd cube coordinates producing centimetre contact error. Those defects were
repaired. Invalid timings are excluded from performance claims. Isolated card comparisons predate the distribution and water follow-ups; generated geometry and atlas math are unchanged, while card bark/leaf lighting now distinguishes the captured colors. They remain evidence of the unresolved layered-depth limitation, not a fresh qualification of all subsequent rendering changes.

Existing cloud banding and extreme ~800 km/s sideways terrain/camera catch-up
remain. The prior demanding mid-cloud scene costs about 27.4 ms median with
full-resolution 128-step clouds. Universal 60 fps is not achieved; fast scenery
bookmarks cannot override that result. Final sequential performance measurements
are appended below and retained with hashes in the compact evidence.

## Reproduce

Run GPU workloads sequentially. Reuse http://127.0.0.1:5198/; browser tools launch
private headless profiles and never attach to the owner's visible browser.

```powershell
./tools/Check.ps1
./tools/Build-Explorer.ps1
node tools/Test-Scenery.mjs --mode validate --output evidence/local/scenery-validation-final
node tools/Test-Scenery.mjs --mode bench --frames 300 --output evidence/local/scenery-bench-final
node tools/Test-Scenery-Impostors.mjs evidence/local/scenery-impostors-final
node tools/Test-Scenery-Controls.mjs evidence/local/scenery-controls-final
node tools/Test-Scenery-Motion.mjs evidence/local/scenery-motion-accepted
node tools/Test-Scenery-Followup.mjs evidence/local/scenery-followup-r2
node tools/Test-Scenery-Water-Edges.mjs evidence/local/scenery-water-edges-release
node tools/Test-Scenery-Foam.mjs evidence/local/scenery-foam
node tools/Test-Scenery-Turn.mjs evidence/local/scenery-turn
node tools/Test-Scenery-Shore-Motion.mjs evidence/local/scenery-shore-motion
node tools/Test-Explorer-Stress.mjs evidence/local/scenery-terrain-stress
node tools/Test-Explorer-Extreme-Motion.mjs evidence/local/scenery-extreme-motion
cargo +1.87.0 run -p solar-explorer --example scenery_reference -- evidence/local/scenery-validation-final/forest-objects.json
cargo +1.87.0 run --release -p solar-explorer -- --view forest --frames 300 --warmup 360 --frozen --audit --output evidence/local/scenery-native-final
cargo +1.87.0 run --release -p solar-probe --bin solar-gpu-probe --locked
node tools/Package-Explorer.mjs
node tools/Test-Explorer-Deployment.mjs --local
```

## Provenance

Read-only references: Planets `14516cd611b3686f147c4454f01a2ecd883bac7f` and
planets-physics `70df527ae8235f1b3f2377d52742bffc98e38c22`. Pinionfall's tree/hemi/
spherical impostor frames, capture, ecology, geology and wind implementations
informed frame/depth conventions and coverage filtering. Copyright (c) 2026
Pinionfall; sources use LICENSE-PINIONFALL. Solar-System v2's bounded generators and
placement are new code. No reference asset, worker, CPU generator or renderer
dependency is imported. See web/THIRD-PARTY-NOTICES.txt.

## Owner-reported regressions

The first flyover audit could not read its compact draw list because the explicit
diagnostic buffer lacked COPY_SRC. That run correctly failed with zero checked
objects; it is not evidence of continuity. After repairing the diagnostic, the
forward/reverse path checked 7,506 admitted interior-tree transitions with zero
disappearances. It covers this path, not arbitrary speed or camera cuts. Initial
water captures showed one refracted rock and black night, but did not detect the
owner's wider coastal screen-edge seam. The dedicated wide/narrow-viewport
comparison was added for that separate regression; its measured results govern
any claim that the rectangular seam is fixed.

The final rolled shoreline and grazing screenshots were inspected with foam,
caustics and ripples enabled. They do not show the owner's broad rectangular
pale/noisy block or repeated shoreline contour bands. Same-world-ray viewport
comparisons measured mean edge errors of 0.005, 0.031 and 0.049 display codes
for the elevated coastal, rolled shore and grazing poses (p95 0, 0.33 and 0 codes). The close
water pose fails the strict absolute-image gate: edge mean/p95 7.22/25 codes,
interior mean/p95 5.99/23.67. Fine water detail is not viewport-invariant in this
case; this failure remains visible. It is not evidence of a passing universal
refraction/foam test. The initial foam/caustics A/B at the elevated coast changed
only a narrow shoreline strip (foam mean 0.012 codes; caustics 0.007 codes).

Refracted offscreen continuation uses four bounded Newton steps plus a final
canonical-field/material sample, anchored to the displayed bed depth. It never
uses an undistorted primary pixel.
It does not intersect offscreen scenery, certify a first intersection for all
terrain, or reproduce every offscreen published triangle. Its vertical offset
anchors the field to the current published bed at the water fragment.
The 180 m limit saturates absorption on long paths. These costs are included in
the final production benchmark, with all existing water effects enabled.

Controlled resize overlap reached 924,684,672 bytes in the lifecycle run.
This excludes driver allocations, compilation, readback staging and browser
memory. The measured steady 1080p payload is 897,958,272 bytes. Resource bounds
are separate from frame-time and image-quality bounds.

## Final shoreline regression repair

The owner's distant foam-like lace was reproduced with foam OFF. Detailed
canonical refraction was intersecting a different bed from the coarse displayed
mesh. The water raster now interpolates bed clearance from the same shared
vertices and morph used by the land. This uses the previously unused second
RG32F ocean channel, replacing its mesh-spacing diagnostic, with no allocation
increase. The fallback offsets its local canonical bed to this displayed depth.
Orbital and 12 km captures remove the detail mismatch while keeping a coherent
coast. The fine inlets are real procedural detail; they are not yet represented
in the coarse terrain geometry. The following experiment should preserve that
pattern in the distant image with a shared, filtered detail representation. This intentionally does not paint unrepresented coastline geometry.

Shore foam also uses that clearance, rather than subtracting two large view-ray
distances or sampling a different bed behind the water pixel. A box integral of
the compact swash profile filters the foam coverage using the depth variation
across a pixel. Canonical local foam history contributes only where its bed
agrees with the displayed bed. The near foam A/B still changes 15,624 pixels by
more than three codes; the orbital foam contribution is below display-code
resolution, and the 12 km view changes no pixels by more than three codes.
These are measured poses, not a universal temporal aliasing guarantee.

The owner authorized pushing this robust checkpoint before experimenting with
additional distant coastline detail. A shared procedural coastline coverage
representation is a separate experiment; merely increasing texture detail in
one water pass would recreate the mismatch. Terrain geometry budgets and the
terrain selection algorithm are unchanged by this checkpoint.

## Final sequential performance and checks

These are actual BrowserWebGpu measurements at 1920 x 1080, 300 measured frames
per arm after 240 warmup frames, with FULL/128/history-OFF production clouds.
The owner's preview and other graphics applications remained available on the
shared RTX 3080. Tests ran sequentially; timings can include GPU preemption.
The 16.67 ms target is not met by these production runs.

| View / path | Off p50 / p95 / p99 ms | On p50 / p95 / p99 ms |
|---|---:|---:|
| forest / isolated | 6.93 / 9.61 / 10.06 | 13.69 / 23.43 / 24.19 |
| forest / production | 17.61 / 20.62 / 21.22 | 26.61 / 32.06 / 34.48 |
| canopy / isolated | 6.22 / 8.44 / 11.35 | 10.84 / 13.54 / 20.09 |
| canopy / production | 17.99 / 21.06 / 27.27 | 27.72 / 32.55 / 33.99 |
| rocky / isolated | 7.66 / 13.79 / 15.03 | 10.41 / 17.24 / 18.85 |
| rocky / production | 22.35 / 24.95 / 27.14 | 26.19 / 32.07 / 34.61 |

Moving isolated path p50/p95/p99: 20.09 / 33.37 / 40.08 ms. See the JSON for all stage, cold, CPU and pacing distributions.

Forest production CPU encoding p50/p95/p99 was 0.10/0.20/0.30 ms; fence-paced
browser wall time was 32.5/37.8/41.3 ms. Its scenery placement, support/culling,
raster and shading stage medians were 0.049/3.775/4.733/0.828 ms. Individual
stage quantiles do not sum to the total-frame quantile. Geometry and capture
are incremental cold work, not a perpetual regeneration of populated scenes.
All stages and cold distributions are retained in the JSON.

Browser readiness took 35.45 seconds in this run. After initialization, the cold
forest first reported objects at frame 32 (1.08 seconds; counter reporting is
asynchronous), all 16 variants were ready, and 46,393 retained objects were
reported by frame 240 (6.40 seconds). Native Vulkan is separate evidence:
300 forest samples after 360 warmup gave p50/p95/p99 29.30/34.60/67.19 ms;
ready/first-image times were 2.59/2.64 seconds. These shared-workstation values
do not establish an uncontended performance floor.

Final checks: 41 Rust tests, formatting, Clippy, both WASM targets, Naga shader
validation, the native numerical GPU probe and actual browser WASM execution.
The seven flat/wavy water-interface poses passed, including mixed near-plane
media and zero flat-water classification mismatches. Rebase mean image error
was 0.027 display codes; eight above/below-water black-night captures were zero.
The scenery lifecycle suite has 57 passing gates, and UI/snapshot/wind tests
pass. The 15 strict impostor failures and one close-water viewport comparison
failure remain explicit. No universal image-quality or 60 fps pass is claimed.

The static package at implementation commit `eb32a61` passed the private-browser
HTTP/MIME/WASM/controls/populated-forest smoke test. `37ad35e` introduces scenery;
`eb32a61` contains the final shared-bed/foam repair. The following documentation
commit does not change production rendering code.


## Halley reach and appearance follow-up — 4 November 2026

High ground-cover reach is now 220 m, Ultra 260 m (slider maximum 280 m). Full-size grass, reeds, pebbles, ferns and bushes fade by per-pixel dithering across range, thinning and candidate-window boundaries. A 0.7 s birth fade also handles late support publication and re-entry into view. A fixed six-face 512-square history (24 MiB) stores cell identity, seed and short wrapped timestamps; time follows the morph/render clock, even with weather animation disabled. The candidate scan is bounded to 1,572,864 invocations; the 61,440 draw slots and reported overflow remain unchanged. Actual reach depends on chart metric and the finite candidate window.

New trees and rocks fade over 0.55-1 s, retaining the complementary mesh/impostor LOD dither and residency-edge fades. Previous near/fast-motion fades could complete in 80-120 ms and looked like popping. Vehicle tire contact now writes a bounded surface-memory patch that bends/compresses cover and recovers gradually; it does not alter the canonical terrain. See VEHICLE.md for bounds and updated evidence. Earlier short-reach performance numbers above are historical, not measurements of this expanded coverage.

## Stationary ground-cover flicker (9 November 2026)

The owner identified grass and small plants disappearing while stationary. A live Wupper ground-level browser
capture reproduced this at 0.25-second frame intervals: the old 0.2-second last-seen timeout reset every visible
clump's birth fade, leaving mean visibility zero. Presence now uses a wrapped rendered-frame counter, with twelve
absent frames allowed, rather than elapsed time between submissions. Birth time uses floor-quantized 1/1024-second
ticks instead of packed half floats; mature births stay two seconds behind the clock across its wrap.
The history remains the same 32-bit word per cell, with no capacity or memory increase.

`tools/Test-Stationary-Cover.mjs --earth` (pass an output directory before `--earth`) exercises stationary frames
at 30/60/120/240 Hz, zero time advance and 0.25-second intervals. The Wupper before/after evidence is under
`evidence/local/river-flight-fix-2026-11-09/`: before visibility ranged from 0 to 0.775704; after it stays at
0.775704 within 0.000001, with 9,096 instances and zero overflow. This is a stationary temporal regression,
not a claim that all camera movement, placement or LOD transitions are artifact-free.


## Near lunar rock shadow geometry (9 November 2026)

The 8, 32 and 96 m sun cascades now draw the same rock mesh morph as the visible surface.
Near rocks collapse their 16x16 face grid continuously onto the 6x6 grid instead of drawing two
different surfaces with complementary dithering. At the coarse endpoint duplicate vertices collapse
to zero-area triangles and surviving triangles reproduce the coarse grid. Shared vertex evaluation
and LOD selection keep near shadow casters on this same surface during the transition. A first trial
using fine casters alone was rejected because it shadowed visible coarse rocks with fine geometry.

The 384/1536/6144 m cascades keep coarse meshes and sun-facing cards. Tree casters, stream caps and
allocation sizes are unchanged. Near caster index work is 3,072 triangles rather than 432 per rock,
including degenerate triangles at the coarse endpoint: index count grows by 7.12x per mesh rock,
and morph evaluation reads both meshes. Fixed buffers do not imply constant render cost. Far LOD mismatch and atlas
approximation remain limitations. Private `shadow_diagnostic` value 5 restores coarse near rock
casters for paired attribution captures only.

The final active prop-shadow cascade now fades within an inscribed circular region (normalized
radius 0.65 to 0.97). Previously its square edge changed straight from detailed shadowing to full
sunlight. This applies to every body and every quality tier, including the short three-cascade tier.
It adds no coverage, maps, or geometry and does not remove terrain/planet/cloud occlusion. It is a
smooth termination of finite prop-shadow detail, not a claim of exact distant shadows.

Private `shadow_diagnostic` value 6 restores the hard final-cascade edge for paired captures.

## Planetary detail and detached shadows — 9 November 2026

The preceding cascade-edge repair did not address the owner's square lunar detail patch or the
detached round rock shadows. Paired browser captures isolate those to `sc_sun_cover`: any caster
overflow enabled projected statistical disks throughout the scene, including near receivers. The
projection used an 8.5 m tree height for rocks too; valid resident lunar records produced disks,
while the Earth-only occupancy fallback outside their square table produced none. Thus the table's
residency boundary became a visible boundary in both darkness and apparent surface detail.

Resolved rock shadows now come from the shadow maps. Overflow remains reported as unresolved work;
it no longer switches the lighting model. Airless/dust/ice bodies do not use the uncalibrated disk
estimate. Earth's far statistical canopy estimate is restricted to unresolved footprints, smoothly
introduced over 8–24 m, and does not draw individual near disks. This does not supply exact shadows
outside the finite caster maps.

Rock casters blend from mesh to sun-facing atlas over 8–4 shadow texels in radius, rather than the
tree threshold of 42–24. The atlas mip footprint uses the allocation tier's actual cell resolution,
shared with visual impostors. Sub-texel casters retire over 0.6–0.2 texels before compaction; distant
overflow cannot randomly replace resolved nearby casters. Memory caps are unchanged, while more
resolved rock casters use meshes, so this is not a claim of unchanged GPU cost. Far atlas silhouettes
and penumbrae remain approximations. A newly arrived height page also rebases each retained record's
support offset from its old canonical height to its new one, preserving its world position until the
bounded support refresh catches up.

Pebble clusters also fade by their individual stones' projected size (0.35–1.25 pixels), in addition
to ground-distance reach. Otherwise a high camera still submitted centimetre stones directly below
it, producing aliased pixels and overflowing the pebble list. The filtered material remains underneath;
the geometry's fixed buffer and ground reach do not increase.

Evidence: `evidence/local/lunar-shadow-boundary-2026-11-09/`. The matched close lunar view and the
large-rock view are pixel-identical across 30 stationary frames. The large-rock paired capture with
prop shadows disabled changes 38,360 pixels, confirming that real shadows remain enabled. A settled
lunar shadow audit reports zero caster overflow (30,407 caster submissions). Wide and close captures
cover the baked surface bodies; source availability and limitations are described in SOLAR-SYSTEM.md.
These are bounded fixtures, not a proof of artifact-free rendering at every coordinate or sun angle.

## Size-based rock streaming and far shadows — 9 November 2026

Record rocks now share a screen-size fade between their visible geometry, impostors and shadow
casters: smoothstep over 0.6–2.4 projected pixels in the existing LOD size convention. Larger rocks
therefore appear farther away; tiny rocks stop producing isolated full-contrast raster pixels.
Publication and residency fades still apply, and fully invisible records do not consume draw slots.
Geometry is never shrunk. Existing 0.35–1.25 pixel pebble fades and fixed allocation budgets remain.

Non-Earth ground also receives statistical unresolved rock shadows. Eight fixed size quantiles
estimate projected area from the same regolith/ice truncated power-law parameters, or eight
integration bins for dusty bodies' exponential area law. Exposed area includes a bounded low-sun
projection. Its complement uses rock screen coverage, residency-window weight and the exact
shadow-cascade resolution/edge fades, handing ground darkness to resolved casters continuously.
The estimator never draws individual disks, projects rocks at tree height, or switches on in
response to global overflow. Earth canopy shading is unchanged.

This is an area approximation, not an exact distant silhouette or calibrated observational
photometry. The exposed-side coefficient is heuristic; giant-boulder exclusions, per-rock support
rejection and the dusty sampler's finite rejection attempts are not individually integrated.
Unresolved ground-cover pebbles add a mean dark-area term from the second moments of their generated radius and scale distributions, complemented by their pixel/reach fade. Its 0.5 dark fraction is heuristic; no individual pebble shadow pass is added. Caster
capacity and missing work remain observable; the estimate is not a repair for arbitrary overflow.

Evidence: `evidence/local/rock-spaceflight-2026-11-09/`. Reproduction tools:
`Test-Car-Rock-Shadows.mjs` (Moon/Mars/Europa and close geometry),
`Test-Rock-Streaming.mjs` (1200–35 m approach, far-shadow attribution, stationary and moving views).

Final qualification: 30 stationary browser captures are pixel-identical, and returning after the
60-frame moving-camera loop reproduces the same image exactly. The five-height lunar sweep
(1200, 600, 200, 80, 35 m) has zero rock draw overflow. Paired attribution shows statistical ground
shade before nearby geometry resolves; Moon, Mars and Europa close/shadow captures pass. Native
GPU topology/contact inputs remain valid. Numeric results and binary identity are in
`evidence/local/rock-spaceflight-2026-11-09/summary.json`. No startup or sustained-FPS gain is claimed.


## Ground-cover admission and retained support - 9 November 2026

Lausanne travel reproduced a real draw-list overflow: the 280 m, double-density view rejected
11,890 entries and repeatedly exchanged visible plants while the camera was stationary. Atomic
append order chose the survivors. Increasing capacity alone would only postpone that failure.

The six draw lists now hold 155,648 entries (16,384 near grass; 65,536 far grass; 8,192 reeds;
32,768 pebbles; 16,384 ferns; 16,384 bushes), up from 61,440. Before appending, a 256-bin stable
cell-hash histogram per class admits only complete buckets whose sum fits the list. A retained
cutoff and 15% headroom under pressure prevent continual threshold adjustment. Atomic scheduling
can reorder admitted entries but cannot choose their membership. Overflow still reports rejected
entries. The existing scenery_draw_limit diagnostic proportionally scales cover capacity too.
At a deliberately tiny budget, this degrades density; it does not promise every plant survives.

The six-face 512-square cache now stores a 48-byte identity and instance record per cell, including
world-frame root offset, species, habitat opacity, source level and birth maturity. Temporary
support lookup misses reuse the retained root; fresh cells require valid support. Frustum culling
uses that displayed root, not a different canonical height. Camera turns preserve species and
maturity, and mature plants cannot restart fading when the 64-second birth clock wraps. Wind
phase uses the stable cell seed instead of camera-relative coordinates. This supersedes the
12-absent-frame reset and the earlier history layout described above.

Measured-Earth vegetation also requires green imagery at its root, instead of relying solely on
the 48 m ecology average that mixed roads into gardens. Unavailable fine imagery admits no new
vegetation; retained plants hold their mask when a page disappears or falls back to a coarser
level. A finer source can change the habitat mask through a 0.35-second fade. Pebbles are excluded
from this vegetation mask. This is a color heuristic, not authoritative road geometry: low-resolution
or misleading imagery can still misclassify a narrow road, and trees retain their separate ecology.

Bounds: history grows from 24 to 72 MiB, draw storage from 1.875 to 4.75 MiB, and admission adds
6,168 bytes, for 50.881 MiB additional fixed GPU allocation. Both candidate placement and emission
are capped at 1,572,864 invocations; selection inspects six 256-bin histograms. Inactive faces exit
before reading cached instances. Finite cache reuse, chart metric and candidate-window edges still
limit reach. Increased allocation and extra passes are not a constant-cost or frame-rate claim.

Evidence lives in evidence/local/cover-stability-2026-11-09/. Test-Cover-Churn.mjs records exact
plant identities during travel, fixed front/rear views, camera returns and forced overflow;
a one-time source-refinement fade is recorded separately from repeated departures and returns.
Test-Car-Scenery.mjs checks first-arrival fading and retained maturity after hiding the layer.
Test-Stationary-Cover.mjs exercises different frame intervals and clock wrap independently,
and asserts vegetation is present as well as pebbles. An initial level-13 imagery requirement
failed that presence check outside Switzerland: global base imagery stops at level 12. The
qualified mask accepts level 12, with regional finer sources refining the same retained decision.


Final qualification: the source-matched browser build records zero plant identity swaps across
180 post-travel front/rear samples on Earth and 180 on the Moon, including forced rejection of
18,960 and 4,983 draw entries respectively. Normal budgets have zero overflow in these fixtures.
Wupper retains 7,407 vegetation draw entries plus pebbles; mean visibility varies by less than
0.000002 across frame intervals and clock wrap. First-arrival visibility rises from zero through
0.372 to 0.802; hiding/returning and a further 65 seconds preserve mature visibility. The final
native GPU audit has balanced topology, no nonfinite samples, no unequal shared samples and no
cover overflow. Full repository checks, final WGSL validation and WASM provenance checks pass.
Exact binary identity and fixture results are recorded in the evidence directory's summary.json.

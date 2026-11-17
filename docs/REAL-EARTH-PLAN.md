# Real Earth and solar system plan

30 October 2026. This is a plan: nothing here is implemented or measured. Sizes,
rates and budgets are design arithmetic until a milestone replaces them with
evidence. It builds on [DECISION.md](DECISION.md) and
[SINGLE-SKIN.md](SINGLE-SKIN.md) and needs the contract changes in section 13.

## 1. Summary

Turn Solar-System v2 into a playable Earth by replacing the source of its canonical
surface, not its renderer. Keep the GPU-owned cut, generation budget, morphs,
water, clouds, sun horizon maps and scenery. Feed them a **measured field**:
height, albedo, land cover, canopy, water level, roads and buildings, delivered as
pages on the same integer cube grid as the terrain patches.

**Live first.** The project is free and possibly open source, and should avoid
hosting terabytes. So the browser converts public tile services into those pages at
runtime, and the project stores only a small pinned pack. A global bake (section 4)
becomes an optional upgrade, used only where evidence shows live data is not enough.
Google's services cannot fill this role (section 3).

The rule that preserves free movement is that **no frame ever waits for the
network**. Every query is answered at once from whatever is resident. A complete
coarse planet is always in memory. Better pages arrive later and continue through
the existing vertex trajectories.

What this can and cannot deliver:

- **Frame rate at any speed: achievable.** Network latency never reaches the
  render loop. Section 5 shows that network load can stay roughly constant with
  speed if the finest admitted level depends on speed.
- **"As fast as now": true for geometry response, not for measured detail.**
  Procedural terrain is computed locally and has no fetch delay. Real data must
  travel. After a cold cut, the image is complete immediately but sharpens over
  roughly 0.3 to 5 s, depending on the link. Revisited areas come from the local
  cache.
- **Better than Google Earth: achievable in lighting, atmosphere, water, weather,
  ground-level detail, motion and interaction. Not achievable everywhere in
  imagery sharpness or exact city geometry using open data alone.** Google's data
  is proprietary, and its terms prohibit the use we would need (section 3).
  With free sources, the measured base is about 10 m per pixel, sharper only where
  a national aerial service exists. Everything finer is synthesized and labelled as
  such. Section 11 gives the honest scoreboard.

The biggest engineering risk is frame budget, not streaming. The high preset was
already about 32 ms at 1080p on the RTX 3080 on 27 October, before adding
buildings, grass and roads.

## 2. Design rules

1. **Total queries.** Every field query returns a value and the level that served
   it. A missing page means a coarser answer and a counter, never a stall.
2. **Pinned root.** Page levels D0 to D3 stay resident (6 × (1+4+16+64) = 510
   pages, 6.2 km spacing at a face centre). D0 ships beside the WASM.
3. **Data is source, not output.** The CPU may upload source pages. It still never
   uploads a cut, mesh, instance list or generated vertex. Selection, generation,
   balancing, morphing and indirect draws stay on the GPU.
4. **No GPU feedback for streaming.** The fetch set comes from the f64 camera,
   velocity and field of view, computed in a worker. Normal play keeps its
   zero-readback property.
5. **Synthesis complements measurement.** Procedural detail is limited to
   wavelengths the data does not resolve, and it must preserve the measured local
   mean. Filtering a synthesized view back to data resolution must reproduce the
   data.
6. **One canonical field.** Mesh, shading, shadows, water depth, scenery support,
   collision and the f64 reference all read the same definition.
7. **Determinism.** With the same source data and camera, the settled image is
   independent of the route taken to get there. Live services can change without
   notice, so this gate runs against a recorded fixture (section 10).
8. **Provenance is visible.** Each pixel can report measured or synthesized, the
   source, and the level deficit. Licence attribution is generated from the data
   in view.

```text
                                               browser
 public tile services ----------------------------------------> fetch worker
 optional baked archives (later) ------> CDN/Cache API ------------> |
                                                                     | decode, convert
                                                                     v
 f64 camera + velocity --> desired page set --> render worker --> bounded upload
                                                                        |
        +---------------------------------------------------------------+
        v
 GPU atlases + clip table --> canonical field --> same cut / generation / morph
                                    ^                      |
             pinned D0-D3 always ---+                      v
                                                raster, shading, water, clouds
```

## 3. Data stack

### Why not Google directly

Using Google would avoid storage, but its [Maps Platform terms](https://cloud.google.com/maps-platform/terms)
rule it out as the data source, whether or not the project is free. Section 3.2.3 says:

- **Heights:** customers will not "build terrain models based on elevation values
  from the Elevation API". They also may not bulk download elevation values or
  cache them.
- **Imagery and meshes:** no scraping, pre-fetching or storing, and no creating
  content based on Google Maps Content. The Map Tiles policies add that reading
  heights or other measurements from 3D imagery is derivative and prohibited, and
  that overlaid objects cannot be derived from the tiles. Trees or roads fitted to
  Google's mesh would fall under this.
- **Mixing:** no use "with or near a non-Google Map". Blending Google tiles into a
  planet built on other data is at least a serious conflict.
- **Re-creation:** no product substantially similar to another Google product
  without substantial independent value.

The numbers also fail. The Elevation API allows 512 points per request, so one 256²
page takes 128 requests. The 5,000 free monthly events cover 39 pages. After that,
at $5 per 1,000, a page costs $0.64, and a 400-page cold cut about $256. Photorealistic
3D Tiles has 1,000 free events per month, then $6 per 1,000, all billed to the app's
owner.

Rendering Photorealistic 3D Tiles is allowed as a display, with Google's logo,
attribution and cache rules. It could be a separate, clearly marked viewing mode,
but it would not be the field. It has baked lighting and could not feed collision,
props or enhancement, so that mode would look like Google Earth with our sky around
it. It is not planned.

**Mars and the Moon:** no public Google API for them was found. Google's planetary
views use NASA and ESA data, which we can use from the source.

### Live sources (default)

Tested 30 October 2026 from this machine with an `Origin` header. This shows the hosts
answer as browsers need; no real browser run or sustained load has been tried yet.

| Layer | Source | Browser access | Size of one tile tested | Terms |
|---|---|---|---:|---|
| Height | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNG) | Works: `*` CORS, range, no key | 137 KB, z10 in the Alps | Free, per-source [attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). About 30 m globally, finer in some countries (UK 2 m, Australia 5 m, Norway 10 m) |
| Imagery | [EOX Sentinel-2 cloudless](https://cloudless.eox.at/documentation/license) WMTS | Works: origin echoed, no key | 16 KB, z10 | CC BY-NC-SA, acceptable while non-commercial. About 10 m. Service limits not found: **check, and ask EOX before public launch** |
| Sharp imagery, Switzerland | swisstopo SWISSIMAGE WMTS | Works: `*` CORS, no key | 21 KB, z18 | Free with mandatory attribution, per secondary sources. Infrastructure terms: **check** |
| Sharp imagery, USA | USGS National Map `USGSImageryOnly` | Works: `*` CORS, no key | 28 KB, z16 | USGS data is generally public domain; this service and its maximum zoom: **check** |
| Sharp imagery, France | IGN Géoplateforme orthophotos | Works: `*` CORS, no key | 16 KB, z16 | **Check** licence |
| Sharp imagery, Netherlands | PDOK aerial photo | Works: `*` CORS, no key | 23 KB, z16 | **Check** licence |
| Night lights, low-zoom Earth | NASA GIBS (Black Marble, Blue Marble) | Works: `*` CORS, no key | 19-111 KB, z4 | NASA data is CC0 unless marked; acknowledgement requested. Coarse, so useful for the far view and pinned pack |
| Roads, buildings | [OpenFreeMap](https://openfreemap.org/) vector tiles (OSM) | Works: `*` CORS, no key | Not sampled | States free with no request limits. ODbL data. OpenMapTiles schema: **check height and road attributes**. OSM footprints only, so coverage is uneven |
| Moon, Mars imagery | [NASA Trek WMTS](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) | Works: `*` CORS, range | 49-63 KB | No terms stated on the API page: **check** |

**National imagery has borders.** Each source differs in colour, date and sun angle, so a sharp
source contributes only its detail over a colour base matched to EOX, in keeping with design rule
5. This should reduce visible seams at national borders. How far is unmeasured.

**NASA does not provide sharper Earth imagery than Sentinel-2 in these services.** Its strengths
here are night lights, far views and the rest of the solar system.

Tested and not usable directly:

- **Esri World Imagery (rejected, owner decision: no data that may cost money).** Its tile host
  answers browsers, but [Esri's pricing](https://location.arcgis.com/pricing/) lists 2M tiles or 1,000
  sessions free per month, then $0.15 per 1,000 tiles or $4 per 1,000 sessions. At the 30 tiles/s
  estimated for fast flight, 2M tiles is about 18 hours of flight per month across all users. The OSM
  wiki's older free conditions add no revenue, under 1M tiles a month and attribution. Caching and
  custom-renderer rights were not confirmed.
- **Copernicus DEM on S3:** range reads work, but the CORS preflight returns 403. It needs a
  small proxy or a bake.
- **Overture PMTiles:** the guessed URLs returned 403. The correct location is untested.
- **Numeric Moon and Mars DEM tiles:** the guessed Trek DEM URL returned 404. The tiles may also
  be visual, not numeric. Find out at M2.

**What live data gives up:**

| Lost or weakened | Consequence | Response |
|---|---|---|
| Bake-time correction (delighting, hydro-enforcement, road conformation) | Baked-in lighting, lakes and coasts that disagree with imagery | Run simplified versions at page arrival, on the GPU or in a worker. Use hosted correction pages only if needed |
| Bare-earth certainty | The registry says "bare-earth", but its global SRTM base is radar and can include canopy and buildings | Test against lidar at M1 |
| Subtree error bounds | Bounds for a page's unloaded descendants stay **unknown** | Treat them as unknown. Selection stays heuristic, and any baked page regains them |
| Seasons | EOX cloudless is one composite | Baked Sentinel-2 quarterly mosaics are the upgrade |
| Land cover and canopy | No live tile source was found | A small hosted pack at reduced resolution, or estimate from imagery colour at first |
| Polar coverage | Web Mercator stops near 85° | Pinned pack, later ArcticDEM and REMA |
| Stable versions | Services can change or disappear | Sources sit behind a manifest, so one can be replaced without a client change. The coarse planet stays available |
| Provider goodwill | Heavy free traffic could get us blocked | Local caching where permitted, attribution, contact providers before launch, and no stress tests against live services |

### Licensing for a free, possibly open-source project

- **Non-commercial, confirmed by the owner on 30 October 2026:** no ads, paid tiers or sponsorship
  tied to the app. That allows EOX's CC BY-NC-SA imagery and FABDEM. Revenue later would require
  replacing those layers.
- **Open-source code is fine.** Choose any licence for code. Data keeps its own terms and is not
  relicensed with the repository, so a forker selling the app must swap NC sources. Keep data out
  of the repository and describe it in a manifest.
- **Never commit API keys.** Anything keyed uses the viewer's or an optional deployer's key.
- **ODbL:** see "Licensing obligations" below.

### Baked upgrade sources

"Check" means the source found was secondary, conflicting, or not specific to the product.

#### Earth

| Layer | Default source | Resolution | Licence | Status |
|---|---|---|---|---|
| Height, land | Copernicus GLO-30 | 30 m | Copernicus licence, free | Confirmed. It is a surface model (includes trees and buildings); EGM2008 datum; a small subset of tiles is withheld, so fill those from GLO-90 |
| Height, seabed | GEBCO_2025 | 15 arc-seconds | Public domain, with acknowledgement | Confirmed; not for navigation |
| Height, hero regions | USGS 3DEP; swissALTI3D | 1 m; 0.5 m | Public domain; Swiss open data with attribution | swissALTI3D product terms: check |
| Height, polar | ArcticDEM, REMA | about 2 m | Check | Not researched in this pass |
| Global imagery | Copernicus Sentinel-2 Global Mosaics | 10 m, quarterly, B/G/R/NIR | Copernicus Sentinel legal notice | Confirmed product; L3 first-quartile composite from 2020; can contain empty pixels |
| Imagery fallback | ESA WorldCover S2 composite | 10 m, 2020 and 2021 | CC BY 4.0 | Confirmed |
| Hero imagery | NAIP; SWISSIMAGE | about 60 cm; 10 cm | Public domain; Swiss open data | Both: check current terms |
| Land cover | ESA WorldCover | 10 m, 11 classes | CC BY 4.0 | Confirmed; about 74-77% accuracy |
| Canopy height | Meta/WRI CHM v1 | 1 m nominal | CC BY 4.0 | v1 confirmed. v2 is conflicting: AWS says CC BY 4.0, its paper says the DINOv3 licence. Do not adopt v2 until resolved |
| Roads, rail | Overture transportation | Vector | ODbL | Confirmed |
| Buildings | Overture buildings | Vector, with height where known | ODbL | Confirmed. Roof and facade fields: check schema. One secondary source gives about 2.8 billion footprints |
| Place names | Overture places, divisions | Vector | Mixed, per source | Confirmed; carry per-source credit |

**Do not bake from, extract from, or train on Google data.** Google Earth is used only
as a human visual comparison.

FABDEM (CC BY-NC-SA) is now the first choice for a baked bare-earth upgrade, ahead of the
correction in section 4, as long as the project stays non-commercial.

Licensed sub-metre imagery is the only route to real sharpness everywhere. It is a
procurement decision, not an engineering one, so the page format accepts it as just
another source.

### Licensing obligations

ODbL allows a rendered output to be a Produced Work with terms of our choosing, but we
must offer the underlying derived database on request and attribute OpenStreetMap
publicly. Keep vector pages as a separate database from raster pages, publish the
recipe, and get legal review before any commercial release. The OSM guidance found here
is partly a community wiki, so it is a starting point, not legal advice.

## 4. Bake pipeline (small at first, global only if earned)

Add a native crate, `crates/solar-bake`. It is never compiled to WASM and produces
versioned, immutable datasets. At first it builds only the pinned pack (about 25 MB, served
with the app, from NASA Blue Marble and Terrain Tiles, whose terms allow shipping it) and any
small correction layers. The rest of this section describes the full
pipeline for regions, or eventually the planet, where live data fails its gates.

**Changed at M1.** Old: the sentence above, "about 25 MB [...] from NASA Blue Marble and Terrain Tiles, whose terms allow
shipping it". New: 28.8 MB as built (D0 0.42 MB, D1 1.50 MB, D2 5.65 MB, D3 21.25 MB), from NASA Blue Marble Next Generation
and NOAA ETOPO 2022. Why: nothing read confirms that the compiled low-zoom Terrain Tiles may be redistributed, ETOPO is CC0-1.0,
and it covers the poles, which Web Mercator tiles do not. See [REAL-EARTH-SOURCES.md](REAL-EARTH-SOURCES.md), 11b and 11c.

1. **Fetch and pin** source versions, with checksums and a licence ledger.
2. **Reproject** to the cube grid. Page level D has 256 cells per page, so a terrain
   patch at level L sits inside exactly one page at D = L − 4.
3. **Make a bare-earth surface.** Copernicus includes trees and buildings. Without
   correcting this, procedural trees and extruded buildings would stand on already
   raised ground. Subtract canopy using CHM and land cover, and flatten building
   footprints with a local-minimum filter. Validate against lidar ground models from
   3DEP and swissALTI3D, with error reported separately for forest, urban and open land.
4. **Hydro-enforce** water surfaces: flat lakes, monotonic rivers, and a coast that
   agrees with the imagery.
5. **Conform to roads.** Bake a target height and weight near roads for cut and fill.
6. **Delight imagery** (section 7).
7. **Build the pyramid and bounds.** Each page stores min and max height, its maximum
   deviation from the parent's interpolant, and the maximum deviation of its whole
   subtree.
8. **Pack** pages into block archives, addressed by range requests with an internal
   directory, in the style of PMTiles. Individual objects would mean tens of millions
   of writes; packing also allows cheap whole-dataset replacement.

### Chart and scale

| D | Spacing at face centre | Used for |
|---:|---:|---|
| 0 | 49.8 km | Shipped with the WASM |
| 3 | 6.2 km | Top of the pinned pack |
| 8 | 194 m | Mid-range |
| 11 | 24.3 m | Global height |
| 12 | 12.2 m | Global imagery, land cover, canopy |
| 16 | 0.76 m | NAIP class data |
| 19 | 9.5 cm | Finest hero imagery |
| 20 | 4.75 cm | Limit of the current patch depth 24 |

The cube chart is gnomonic ([terrain_gpu.wgsl:67](../shaders/terrain_gpu.wgsl#L67)), so
spacing tightens from the face centre to about one third at the corners. That is
roughly 1.9 times the ideal sample count. **Decision: use the same exact integer grid
for pages anyway.** A tangent warp would save about 38%, but it would lose exact
co-registration with patches and need a double-single `atan`. Stop depth per region
where the source is already oversampled. Revisit only if M3 shows storage is the
binding cost.

**Decision: map geodetic latitude directly to spherical latitude and store height above
the geoid.** The sphere normal then matches the true vertical, sun elevation stays
correct, sea level stays a constant radius, and water, clouds, atmosphere and the
horizon maps keep their spherical assumptions. North-south scale error is up to about
0.56%. Displayed distances use an exact ellipsoid calculation from the stored
coordinates. This is an explicit approximation.

### Estimated size if fully baked (design arithmetic, Earth land)

| Layer | Basis | Size |
|---|---|---:|
| Height | D11, about 4.8e11 samples plus pyramid, 4-8 bits | 0.3-0.6 TB |
| Imagery | D12, about 2.5e12 pixels with pyramid, 1-2 bits per pixel | 0.3-0.7 TB |
| Seasonal deltas | Three, at D10 | about 0.06 TB |
| Land cover, masks, water | D12, strongly compressible | about 0.06 TB |
| Canopy | D12 | 0.1-0.3 TB |
| Buildings | About 2.8e9 × 60 bytes | about 0.17 TB |
| Roads and rail | Vector pages | 0.05-0.15 TB |
| **Global base** | | **about 1-2 TB** |
| Lower 48 NAIP | Optional | about 5 TB |
| All Switzerland at 10 cm | Optional | about 1 TB |

Storage at Cloudflare R2's reported $0.015 per GB-month with no egress fee would be about
$15 per TB-month; confirm on Cloudflare's price page. Open-data hosts such as Source
Cooperative and Hugging Face are candidates to explore, with terms unchecked. Bake compute
is not estimated: measure it on a 1° × 1° sample before committing. Vercel keeps serving the
app and pinned pack only.

**Local limit:** the development machine had 139 GB free on its system disk. Test fixtures and small bakes stay within
a budget of 60 GB outside the repository. A global Earth bake would run in the cloud next to
the source buckets.

## 5. Runtime streaming

### Source adapters

Everything above the fetch worker is a replaceable adapter that answers: "give me page
(face, D, x, y) of this channel". A manifest names the adapters per body, with their
attribution and cache permission.

- **Live raster adapter:** fetch the Web Mercator or equirectangular tiles that overlap the
  cube page, decode, resample to the cube grid in linear colour, then write the gutters. A
  small source-tile LRU avoids refetching, since tile and page grids do not align. M1 compares
  worker and GPU compute resampling.
- **Live vector adapter:** decode MVT in the worker, then quantize polylines and footprints to
  vector pages. Road conformation runs when a page arrives, and must feed the same height in
  every consumer, including collision.
- **Baked adapter:** read a range from a packed archive. Same output, plus subtree bounds.

Source differences stay inside adapters: datum, encoding, and missing tiles. A 404 becomes
"this level does not exist here", cached so it is not requested again, and the parent serves.

### Page lookup

Fixed-size atlases hold pages. A **clip table** stores, for each level around the camera,
a small toroidal window of entries on each cube face. An entry holds the atlas slot and
UV transform of the page, or of its nearest resident ancestor. Lookup is O(1), with no
chain walk, and costs memory independent of planet size: 20 levels × 6 faces × 32² × 4
bytes is about 460 KB. Pixel addresses reuse the compensated integer key construction
from [`eye_key`](../shaders/terrain_gpu.wgsl#L66), extended with a fractional part.

| Channel | Format | Filtering | Full-tier allocation (estimate) |
|---|---|---|---:|
| Albedo | BC7 / ASTC, RGBA8 fallback | Hardware | 4096 pages, 256 MiB |
| Normal | BC5 / ASTC | Hardware | 1024 pages, 64 MiB |
| Height | R16 with per-page offset and scale | Manual, 4 to 16 loads | 1024 pages, 128 MiB |
| Land class, canopy, water | RG8 + R8 | Mixed | 1024 pages, about 100 MiB |
| Vector pages | Storage buffer | n/a | 32-64 MiB |

That is roughly **+500 MiB** on today's 974 MiB full tier, sized at 15 × 15 pages per
4096² layer (264 texels with gutters, BC-aligned). BC and ASTC are optional WebGPU
features and need runtime detection. Weaker tiers shrink the pools; the planet remains
complete.

### Why any speed works

Each level keeps a ring about 8 pages wide. A camera at speed v crosses new pages at
about 8v / S per level, where S is the page's world size. The levels form a geometric
series, so the total is about twice the finest level's rate.

**Invariant: admit the finest level only while v / S ≤ c.** Page demand then does not
depend on speed. Moving faster simply excludes the finest levels:

| Speed | Finest admitted cell (c = 1.2/s) | Pages/s | Estimated bandwidth |
|---:|---:|---:|---:|
| 300 m/s | 1 m | about 19 | about 8 Mbit/s |
| 3 km/s | 10 m | about 19 | about 8 Mbit/s |
| 30 km/s | 100 m | about 19 | about 8 Mbit/s |
| 800 km/s | about 2.6 km | about 19 | about 8 Mbit/s |

The estimate assumes about 50 KB per page group, which suits a baked format. Live tiles are
larger: the single samples tested suggest about 137 KB for height and 16-24 KB for imagery, so
**live flight at this rate needs about 25 Mbit/s**. That is a rough figure from one mountain
tile, which M1 replaces. Slower flight needs far less, because sources stop at their native
level.

c adapts to measured throughput, so a slow link means less fine detail in motion, not stalls. A
faster link raises c, making fine levels available at higher speed. **Fine detail during very
fast flight is physically unavailable on any link**, and that limit is shown rather than hidden.

### Scheduling

- Priority is coarse before fine, then time-to-arrival along the velocity, then view
  direction. View direction affects fetch order only; it does not change the terrain
  cut, which stays omnidirectional.
- Requests are abortable. A direction change cancels unstarted and now-useless work.
- A cold cut needs about 400 page groups: about 20 MB baked (1.6 s at 100 Mbit) and up to about
  60 MB live (about 5 s), with the centre of view arriving first.
- Decode runs in separate workers, without requiring WASM threads or COOP/COEP.
  Transferable buffers go to the existing render worker
  ([render-worker.js](../web/render-worker.js)), which performs bounded uploads. Cache
  API or OPFS keeps visited pages only where the manifest says the source permits it.

### Refinement without stalls

When a page lands, the clip table updates and a revision counter advances. Affected
resident nodes re-enter generation under the existing limit of 64 jobs and 18,496
samples per frame. They then retarget through the existing 0.14 s Hermite trajectories,
so geometry refinement reuses the machinery the renderer already trusts. Shading blends
to the new page over a similar time. A refinement is a visible, continuous change; it is
not concealed and the data-lag overlay reports it.

### Compression bake-off (only for baked data)

Live pages arrive as JPEG or PNG and are uploaded uncompressed or GPU-encoded. If baking starts,
compare UASTC-RDO + zstd (transcodes quickly to BC7 and ASTC) against AVIF or similar
with a GPU compute BC encoder. Measure bytes per page, image error, decode and transcode
time in a worker, and VRAM. Imagery is the centrepiece, so low-quality ETC1S is
expected to fail, but it should be measured.

## 6. The canonical field

The current height spectrum is duplicated, not centralized. `radial_sample`,
`surface_detail_sample`, `surface_height_only`, `sun_cache_heights`,
`sun_visibility.wgsl`, `water.wgsl`, `camera_height`, `error_for_level`, `gpu_metrics` and
CPU `Skin::height` each evaluate it. Replacing it is the first milestone.

```text
h(n, f) = conform( H_data(n, f) + Σ_k a_k(class, roughness) · w_k(f, D_served) · band_k(n) )
```

- `H_data` is the filtered measured height at footprint f.
- `w_k` is the existing low-pass weight at
  [surface_detail.wgsl:7](../shaders/surface_detail.wgsl#L7), multiplied by a new high-pass
  term that disables any band the served page already resolves.
- `a_k` continues the measured spectrum: the bake fits local roughness and slope per page.
  Land class sets the character (rock, soil, sand, snow, urban, farmland).
- `conform` applies road and water constraints. Synthesis is suppressed under them.

When a finer page arrives, data replaces bands of the same scale and similar amplitude.
**Amplitude matches, but phase does not, so a real and visible height change remains.** It
travels through the morph. Measure it and report it per metre of height.

### Bounds

| Term | Bound | Strength |
|---|---|---|
| Measured interpolation, baked | Baked per-page and subtree maximum deviation | Exact for stored samples and the stated interpolant. Does not cover measurement error, which uses the source's published accuracy |
| Measured interpolation, live | Per-page deviation, computed on arrival | Known for a resident page. **Unknown for its unloaded descendants**, and reported as unknown |
| Synthesized bands | Existing amplitude accounting | Same engineering bound as today |
| Road and water conformation | Baked target and weight, with interval | Conservative for the baked data |
| f32 evaluation | Separate allowance, as now | Audited, not proven |
| Silhouette, normal, visibility | None | Remains unclaimed. Height bounds do not certify them |

Subtree bounds help because a non-resident child still has a known interval. Where available,
they replace spectrum-based assumptions in `error_for_level`, `LIVE_START` and the CPU sun
envelopes. Live data needs a measured, explicitly non-conservative estimate instead. Selection
stays heuristic where it is heuristic now.

## 7. Imagery that looks better, not just sharper

Ordinary globes look wrong because their imagery has sun and atmosphere baked in. Solar-System v2's
dynamic light would double-count both.

1. **Linear albedo.** Live EOX tiles are display-graded imagery, so fit a colour transform
   towards reference albedo per land class, run in the shader. Baked Sentinel-2 L3 is already
   atmospherically corrected, though first-quartile compositing is biased dark and needs
   calibration too.
2. **Delight.** Divide out modelled illumination using the DEM and the approximate overpass sun,
   on page arrival for live data. For aerial imagery, use a learned model. Gate: after delighting,
   correlation of albedo with hillshade at the source sun must fall, and rendering under the
   source sun must reproduce the original within a declared tolerance. Mosaics mix dates, so
   live correction will be imperfect, and that limit is measured.
3. **Seasons (baked upgrade).** Store quarterly deltas so date changes foliage and snow. Snow, ice
   and dead-leaf fallbacks use land class and latitude where observations are missing.
4. **Use NIR (baked upgrade).** NDVI drives vegetation density, grass tint and tree colour. Live
   RGB tiles have no NIR, so those start from a colour-based estimate.
5. **Super-resolution (optional, bake time only).** Train 10 m to about 2.5 m on open
   Sentinel/aerial pairs such as Sentinel-2 with NAIP or SWISSIMAGE. It costs nothing at
   runtime. Output is plausible, not measured, and is tagged in provenance. A prior-art
   review precedes training.
6. **Ground detail.** Below the data level, GPU-generated material textures add
   mean-preserving detail by class in log space. Gate: box-filtering the result to data
   resolution returns the source within a declared tolerance.

## 8. Missing systems

Sizes are relative effort. Each new GPU feature has its own timestamp stage, overflow
counter, quality setting and motion test.

### Water bodies (L)

Today there is one sea: depth is `planet.y - height` at
[water.wgsl:386](../shaders/water.wgsl#L386). Add a per-page water level so lakes and
rivers can sit at any elevation, with flow direction from vector data driving wave
transport. Keep the existing ocean optics. Include bathymetry from GEBCO. Vertical steps,
such as dams and waterfalls, are not modelled at first and are reported as a limit.

### Roads and rail (L)

- **Source:** vector pages hold quantized polylines with class, and width, lanes, surface and
  bridge or tunnel flags where the source provides them. Live OSM tiles may carry only part of
  this, so width and lanes are estimated by class and marked as estimated.
- **Far:** already visible in imagery; no extra work.
- **Near:** a GPU pass rasterizes nearby segments into a camera-centred surface layer of
  signed distance and attributes, from about 2 m down to 5 cm per texel. Markings,
  shoulders, wear and intersections are procedural from those attributes. Crisp at any
  distance, with a small data footprint.
- **Surface:** conformation, computed on page arrival or baked, keeps terrain, shading, collision
  and props in agreement.
- **Bridges:** a separate GPU-generated ribbon mesh, because a radial surface cannot pass
  under itself. **Tunnels:** the road is not drawn, and the surface stays closed. Portals
  are dressing only, and tunnels cannot be entered.

### Vegetation (L)

- Replace `sc_ecology` noise with measured class, canopy cover, canopy height, NDVI and
  biome, while keeping stable source IDs and ticket budgets.
- **Redesign the cell scheme.** There is at most one object per 24.3 m cell, which is too
  sparse for real forest. Use two or three nested cell scales, with a finer scale kept
  close to the camera, within a fixed record budget.
- Exclude props from road, building and water footprints.
- Keep the existing distant-canopy statistics, now driven by measured cover.
- Trees currently encode a global revision in their identity
  ([scenery.wgsl:98](../shaders/scenery.wgsl#L98)). Use per-page revisions, otherwise each
  data arrival would invalidate up to 884,736 records.

### Grass and ground cover (L, new)

Three continuous representations, with density and tint from class, NDVI and season:

| Range (approximate) | Representation | Budget (high) |
|---|---|---|
| 0-40 m | Individual GPU blades from a camera-centred grid, using compute and indirect draw (WebGPU has no mesh shaders) | Up to 1M blades |
| 40-200 m | Tuft cards generated on the GPU | Bounded list |
| Beyond | Shading only: anisotropic response, fuzz, micro-shadow | No geometry |

Each range must match the next in mean colour and coverage; this is a gate, not a fade.
Ghost of Tsushima's GPU blade approach is the main prior art.

### Buildings (XL, new)

| Range (approximate) | Representation |
|---|---|
| 0-500 m | Full GPU mesh: storeys, recesses, roof forms, parapets, with windows and interiors by parallax |
| 500 m-6 km | Extruded prism with roof, using a procedural facade shader |
| 6-30 km | Merged block hulls, baked hierarchically from footprints |
| Beyond | Shading only, with urban albedo, height-derived shadowing and night lights |

- **Identity:** the stable source ID seeds all procedural choices.
- **Height:** Overture or OSM where known, then a regional estimate. The source is
  recorded, because many footprints lack height.
- **Style:** region, climate, density, building type and roof colour sampled from imagery.
- **Budgets:** fixed instance and triangle pools, GPU culling, and overflow counters.
  Dense downtowns are the adversarial test.
- **Shadows:** extend the existing six-cascade caster streams.
- **Limits:** buildings are plausible, not accurate. A typical house will not match the real
  one. Landmarks need `building_part` geometry or a curated, licensed mesh pack.

Open city models could add accurate LOD2 roofs in hero regions; their licences are not yet
checked.

### City and street dressing (M, after buildings)

Street lights, crossings, fences, walls, power lines, ports, runway markings, parked cars
and street trees, generated from OSM tags with bounded lists. Then road and air traffic
as animated agents.

### Night and atmosphere (M)

- Far night lights from NASA Black Marble; near lights per building by time of day.
- Atmosphere, cloud-shell and scale-height literals move to the body descriptor. Real
  terrain reaches 8.8 km, which enters the cloud shell, so that interaction needs testing.
- Clouds stay procedural at first. Conditioning them on climatology or live weather is an
  optional later feature.
- Real date and time drive the sun from an ephemeris.

### Product (M)

- Labels (GPU text, placed from `places` and `divisions`).
- Serverless search: a static prefix index in range-addressable files.
- Bookmarks and shareable URLs carrying camera, date and dataset version.
- Provenance, data-lag and attribution views.
- Rapier walking and collision. Collision uses a small CPU-side copy of the same height
  pages near the player, without GPU readback. Vehicles build on it.

### Existing limits to carry forward

- **Clipmaps:** they cover a single cube face, and a face change resets everything
  ([sun_clouds.wgsl:199](../shaders/sun_clouds.wgsl#L199)). Filling from pages may be
  cheaper, but the face-crossing stall must be tested and fixed.
- **Fast stops:** the 100 km in 5 s ground flight showed 63.4 px p99 depth change in the
  first eight stopped frames when measured. Data does not fix this, and real mountains may
  make it worse. Re-measure on real terrain.
- **Refinement rate:** only ready leaves split, so depth advances one level per cycle.
- **Topology:** the radial skin rules out caves, overhangs, real tunnels and non-star-shaped
  bodies.

## 9. Frame budget

Baseline, RTX 3080, 1080p, 27 October figures (re-baseline at M0 because later passes
changed shadows and clouds): high preset, forest 32.4 ms, coast 31.9 ms, clouds 44.5 ms;
medium 17-22 ms; low 8-10 ms; minimal 2-3 ms.

Predeclared additions to the high preset:

| Stage | Budget p50 |
|---|---:|
| Page lookups in shading, net of bands removed | ≤ 1.5 ms |
| Upload and bookkeeping (CPU) | ≤ 2 ms, in the worker |
| Road surface layer | ≤ 1 ms |
| Grass | ≤ 3 ms |
| Buildings raster and shade, dense city | ≤ 4 ms |
| **Total new GPU work** | **≤ 9.5 ms** |

Removing most procedural bands from shading could partly pay for this, as could cheaper
clipmap fills; this is a hypothesis to measure. 60 fps at high remains unmet today and this
plan does not claim it. **Default target: high holds its current frame time in forest and
coast views at M6, and medium reaches 16.67 ms p95 outside dense downtowns.** Anything over
budget moves to a lower default, explicitly, with evidence. Per the existing rules, nothing
reduces quality silently.

## 10. Milestones

Each milestone ends with a local commit and evidence. Exit gates are predeclared and may
fail; a failure changes the plan instead of being reworded.

### M0: Field seam and body descriptor (M)

Create one WGSL field module and one Rust `SurfaceSource`. Route all ten height sites through
it. Introduce `BodyDescriptor` for radius, atmosphere, water and rotation, removing
`EARTH_RADIUS` duplicates. Build the throttled test server from
[serve.mjs](../tools/serve.mjs) (bandwidth, latency, failures, 404s). Add a data-lag counter.
**Gate:** static scenes exactly match the pre-refactor build, and browser timing shows no
regression.

### M1: Live Earth, height and imagery (L)

The whole planet, with no bake beyond the pinned pack: Terrain Tiles and EOX through source
adapters, atlases, clip table, fetch worker and bounded upload, plus swisstopo imagery to test the
sharp-source overlay in the test region. This is the first time the app shows real Earth.

Tests never load live services. Record the tiles for a fixed tour, including Lausanne to the Dents
du Midi (city, lake, vineyards, steep Alps), under ignored local storage within the 60 GB budget,
as both licences allow. Replay them through the throttled server. A separate gentle live smoke
test checks real browser access, because the host checks in section 3 were not made from a browser.

**Gates:**
- Zero frames block on data. Network load is shown not to affect frame time at 5, 20 and 100
  Mbit, and 20 to 300 ms.
- Height error against swissALTI3D and 3DEP, split into forest, urban and open land.
- A human verdict on 10 m imagery at low altitude, and on the swisstopo overlay and its border with
  EOX, which decides how much to invest in synthesis and in more national sources.
- Camera cuts, cold cache, reverse flight, and page-failure runs complete, with counters
  exposed.
- Interleaved browser p50/p95/p99 is within budget against M0.
- GPU heights match the f64 reader within the existing tolerance.
- Route independence: matching settled captures after different approaches.
- After a cut at 100 Mbit and 40 ms, 90% of pixels are within one level of final by 1 s, and
  100% by 5 s.

**This is the go/no-go gate for everything that follows.**

### M2: The Moon, second body (M)

NASA Trek imagery, with numeric height from Trek if available, otherwise a local bake of SLDEM2015
and polar LOLA, which is on the order of tens of GB. It proves the body descriptor and exercises the
baked adapter on a whole body, with poles and no water or atmosphere to entangle.
**Gate:** closed-planet seam audit, pole tests, and the M1 motion suite on a complete body.

### M3: Correct the live Earth (L)

Water levels, simplified hydro-enforcement and delighting on page arrival, plus a small hosted pack
for land cover and canopy. Bake a 1° × 1° sample of the full pipeline to compare quality and extrapolate
cost. A global bake happens only if the comparison justifies it and the owner approves the cost.
**Gates:** coast and lake agreement; live versus baked sample comparison; a seven-city and
seven-wilderness browser tour.

### M4: Better than a globe (M)

Complement bands, mean-preserving ground detail, real date and time, and the provenance view.
**Gates:** those in sections 6 and 7, and a side-by-side human comparison with Google Earth at a
fixed set of views.

### M5: Roads and water life (L)

Live OSM vector adapter, road layer, conformation, bridges, rail, rivers and lakes. **Gates:** no
visible road and terrain disagreement at declared heights; adversarial interchange; within the road
budget in section 9.

### M6: Vegetation and grass (L)

Measured placement, nested cells, the grass stack. **Gates:** agreement with the canopy map;
matched colour and coverage across ranges; budget.

### M7: Buildings (XL)

Prisms, then full meshes, then block hulls, night lights. **Gates:** Manhattan and Tokyo as
adversarial budgets; pool overflow is reported; continuity across ranges; downtown motion tests.

### M8: Playable product (M)

Labels, search, walking, vehicles, dressing, traffic and attribution review.

### M9: Solar system (L, then per body)

See section 12.

More national aerial services can be added at any point after M1 as further adapters, once their
terms are checked. M1 can begin right after M0.

## 11. Scoreboard against Google Earth

Expected results, to be checked at the M4 and M7 comparisons:

| Aspect | Expected | Why |
|---|---|---|
| Lighting, time of day, seasons | Solar-System v2 wins | Dynamic sun, delighted albedo |
| Atmosphere, clouds, water | Solar-System v2 wins | Existing renderer strength |
| Ground-level view, outside photogrammetry cities | Solar-System v2 wins | Terrain, vegetation and grass, instead of a draped photo |
| Motion | Solar-System v2 wins, if M1 passes | Never blocks; continuous from orbit to ground |
| Playability | Solar-System v2 wins | Physics, vehicles, walking |
| Imagery sharpness, countries with a free national service | Roughly even, to be compared | Switzerland, USA, France and the Netherlands tested so far |
| Imagery sharpness, everywhere else | **Google wins** | 10 m open base versus proprietary sub-metre imagery. Synthesis adds plausibility, not truth |
| Exact city geometry and landmarks | **Google wins** | Photogrammetry versus plausible generation |
| Recency and coverage depth | **Google wins** | Investment and data ownership |

Closing the "Google wins" rows takes paid imagery and a city-model acquisition programme. They
do not yield to rendering technique alone.

## 12. Solar system

One pipeline, one renderer, and a catalogue per body. [NASA Trek](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)
gives live Moon and Mars imagery without hosting (a Moon WAC and a Mars MOLA shaded-relief tile both
loaded in testing). Numeric height access is not yet confirmed. Figures from this pass:

| Body | Best global data found | Notes |
|---|---|---|
| Moon | SLDEM2015, 512 ppd (about 59 m), ±60° latitude; LOLA 5 m polar | Imagery resolution and WAC details to confirm |
| Mars | CTX mosaic, 5 m per pixel, 5.7 terapixels, 99.5% coverage | Mosaic licence unconfirmed (the paper's licence is not the data's). DEM not confirmed in this pass; candidates are MOLA and HRSC blends |
| Mercury | MDIS, 250 m per pixel | |
| Venus | Magellan radar, about 75 m per pixel | Radar brightness is not visual colour. Must be labelled as such |
| Other moons, Pluto, Ceres, Vesta | Not researched | Mostly much coarser and with coverage gaps |

Requirements beyond Earth:

- **Body descriptor:** radius, rotation model, atmosphere, surface water, clouds, data catalogue,
  licence ledger.
- **Absolute coordinates:** per the decision record, use integer body and sector addresses with
  bounded local frames, never a single f64 solar-system position.
- **Ephemeris:** JPL/SPICE data, compressed to polynomial segments. One body has full detail at a
  time; others are bounded impostors with their own pinned pages.
- **Atmosphere models:** Mars dust, Titan haze and Venus's opaque deck do not fit Earth's scale
  heights. Each needs its own evidence.
- **New renderers:** gas giants have no surface, and Saturn needs rings.
- **Radial skin limit:** a star-shaped surface fails for irregular bodies such as comet 67P. They
  need a separately documented decision.
- **Honesty matters more here:** synthesized detail on Mars or the Moon can look like discovery.
  Provenance stays visible, and images from low-coverage areas are labelled.

## 13. Decisions

Defaults this plan proceeds under. Changing any of them later affects the listed work.

| Decision | Default | Changing it |
|---|---|---|
| Project status (owner confirmed, 30 October 2026) | Free, with no ads, paid tiers or sponsorship. Open source possible | Revenue would require replacing EOX and FABDEM |
| Data cost (owner confirmed, 30 October 2026) | Only free, open sources: open data, NASA, national services. Nothing that may cost money | Reopening this means revisiting Esri or licensed imagery |
| Data delivery | Live public sources, plus a small pinned pack | A global bake costs about 1-2 TB of hosting, and regains seasons, stable versions and bounds |
| Google | Not used as a data source; no Google mode planned | A separately labelled 3D Tiles mode is possible, billed to the owner or the viewer's key |
| Learned super-resolution | Bake time only, and labelled. Requires hosting, so it follows any bake | Otherwise imagery stays at source resolution plus procedural detail |
| Test region | Lausanne to Dents du Midi | Any region with open lidar for checking |
| Engine base (reviewed at the owner's question, 30 October 2026) | Our own Rust/WGSL engine, not CesiumJS or a port of it. The February 2026 CesiumJS release still builds on WebGL2 and no WebGPU renderer or roadmap was found (forum threads undated, GitHub tracker not checked). Its surface tile provider does visibility on the CPU, defaults to skirts, and shows no level-of-detail morphing. Those are what the contract rejects, and a port would not bring this renderer's atmosphere, clouds, water, shadows or scenery | Would reopen the Rust -> WASM -> WebGPU decision, which is the owner's alone. Reconsider only if M1 fails, using the control below to separate data limits from renderer limits |

**Designs taken from CesiumJS, with credit, not its engine:** `RequestScheduler` (per-server limit, global limit, priority heap that cancels the lowest request when full) for the fetch scheduler; GPU imagery reprojection (`reprojectToGeographic`) as the GPU arm of M1's resampling comparison; `getLevelWithMaximumTexelSpacing` for source zoom selection; 3D Tiles as a possible input format for open city models at M7, without Cesium ion. **Private control, never shipped:** a CesiumJS page reading the same recorded fixtures through `CustomHeightmapTerrainProvider`, as a baseline for the M1 imagery verdict and the M4 comparison. Its licence (Apache 2.0, from memory) is confirmed before any code is copied.

Contract changes to record in [DECISION.md](DECISION.md) and [SINGLE-SKIN.md](SINGLE-SKIN.md) at M0,
replacing existing text:

- "The CPU never uploads a … height tile" becomes: the CPU uploads source pages within a bounded
  budget, and never a cut, mesh, instance list or generated vertex.
- "Imported model/texture assets are excluded" becomes: measured geodata is imported, while
  authored assets remain excluded unless separately approved.
- "Astronomical data integration is a future source bridge" becomes this plan.
- "There are no server functions" stays true: live sources need no server of ours, except any
  optional proxy for sources without CORS.
- Generated scenery remains GPU-generated, but its placement now depends on imported data.

## 14. Risks

| Risk | Consequence | Response |
|---|---|---|
| New stages exceed the frame budget | Features move to lower defaults | Per-stage gates; M1 measures lookup costs first |
| Refinement is visibly distracting | Sharpening feels like popping | Measure amplitude; tune speed admission; keep the change continuous; the owner judges M1 motion |
| Live service limits, blocks or shuts down | Detail loss, or a source change | Manifest-swappable adapters, permitted caching, contact providers before launch, baked fallback |
| Bare-earth error in live heights | Floating trees or buried buildings | Lidar validation at M1; FABDEM is the baked fallback |
| Delighting damages albedo | Muddy or false colours | Per-class gates; keep the option of lightly delit imagery |
| 10 m imagery looks poor at low altitude | Most of the world disappoints near ground | Detail and SR gates at M4; paid imagery option |
| Too few building heights | Flat or wrong skylines | Regional estimates, with provenance; add height datasets (GHSL, Open Buildings) after a licence check |
| Licence or attribution mistake | Forced takedown or rebake | Per-source ledger, generated attribution, review before release |
| Bake cost overruns | Delay or expense | 1° sample before commitment; immutable versioned datasets |
| Mobile memory | Tiers may not survive | Mobile survival is still unverified; test on real hardware before claiming support |

Prior art is real, and **this plan claims no novelty**. Outerra pairs a seamless planetary engine with
real-world coordinates. Microsoft Flight Simulator 2024 mixes streamed aerial imagery, elevation,
procedural scenery and selected photogrammetry. Blackshark.ai reconstructs semantic 3D from imagery.
Google Earth, Cesium and OpenSpace are direct references as well. A prior-art review for the streaming
and enhancement approach belongs in M1, before any claim that it differs from existing work.

## Sources

Data: [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/) ·
[Sentinel-2 Global Mosaics](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics) ·
[ESA WorldCover access](https://esa-worldcover.org/en/data-access) ·
[EOxCloudless licence](https://cloudless.eox.at/documentation/license) ·
[FABDEM, GEE community catalog](https://gee-community-catalog.org/projects/fabdem/) ·
[Meta canopy v1](https://registry.opendata.aws/dataforgood-fb-forests/) ·
[Meta canopy v2](https://registry.opendata.aws/dataforgood-fb-forestsv2) ·
[CHMv2 paper](https://arxiv.org/pdf/2603.06382) ·
[GEBCO_2025](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2025-grid) ·
[USGS 3DEP 1 m](https://developers.google.com/earth-engine/datasets/catalog/USGS_3DEP_1m?hl=fr) ·
[swisstopo terms](https://www.swisstopo.admin.ch/en/terms-and-conditions) ·
[NAIP](https://developers.google.com/earth-engine/datasets/catalog/USDA_NAIP_DOQQ?hl=fr)

Vector and legal: [Overture attribution](https://docs.overturemaps.org/attribution/) ·
[Overture buildings](https://docs.overturemaps.org/guides/buildings/) ·
[Overture 2026-01 notes](https://docs.overturemaps.org/blog/2026/01/21/release-notes/) ·
[OSM Produced Work guideline](https://wiki.openstreetmap.org/wiki/Open_Data_License/Produced_Work_-_Guideline) ·
[OSMF legal FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ) ·
[Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies) ·
[Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) ·
[Google Elevation policies](https://developers.google.com/maps/documentation/elevation/policies) ·
[Google Elevation requests](https://developers.google.com/maps/documentation/elevation/requests-elevation) ·
[Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing) ·
[NASA data use policy](https://www.earthdata.nasa.gov/learn/use-data/data-use-policy) ·
[NASA Black Marble](https://www.earthdata.nasa.gov/data/projects/black-marble) ·
[SWISSIMAGE terms summary](https://developers.google.com/earth-engine/datasets/catalog/Switzerland_SWISSIMAGE_orthos_10cm) ·
[Esri on the OSM wiki](https://wiki.openstreetmap.org/wiki/Esri) ·
[Esri basemap sessions](https://www.esri.com/arcgis-blog/products/platform/announcements/basemap-sessions) ·
[Esri pricing](https://location.arcgis.com/pricing/) ·
[Google 3D Tiles FAQ](https://mapsplatform.google.com/intl/en_in/resources/blog/commonly-asked-questions-about-our-recently-launched-photorealistic-3d-tiles/)

Bodies: [SLDEM2015](https://pgda.gsfc.nasa.gov/products/54) ·
[LOLA archive](https://imbrium.mit.edu/) ·
[Global CTX Mosaic](https://murray-lab.caltech.edu/CTX/) ·
[Mercury MDIS 250 m](https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_mosaic_250m) ·
[Magellan FMAP](https://ntrs.nasa.gov/api/citations/19940011846/downloads/19940011846.pdf)

Techniques and prior art: [Basis Universal](https://github.com/binomialllc/basis_universal) ·
[WebGPU features](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures) ·
[3D Tiles implicit tiling](https://research.geodan.nl/3d-tiles-1-1-implicit-tiling/) ·
[Procedural Grass in Ghost of Tsushima](https://gdcvault.com/play/1027214/Advanced-Graphics-Summit-Procedural-Grass) ·
[Outerra](https://www.gamedeveloper.com/business/-i-outerra-i-a-seamless-planet-rendering-engine) ·
[MSFS 2024 world](https://flyawaysimulation.com/ask/answers/msfs-2024-whole-world-accuracy/) ·
[Blackshark.ai](https://people.blackshark.ai/?p=2206) ·
[R2 pricing, third party](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/)

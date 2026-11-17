# Prior art: streaming field, level admission, detail synthesis

A short review for M1 of [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md). Solar-System v2 claims no novelty. Marks: **[read]** means I
read it in this review. **[search]** means only a search-result summary. **[recall]** means memory, unchecked.
Several primary sources (Hoppe's PDF, Mittring's slides, Unreal docs) could not be read, so the notes on them are weaker.

## Virtual texturing and clip tables

- **Barrett, sparse virtual textures [read, partial].** A pixel shader maps virtual to physical coordinates through a page
  table; only needed data is downloaded; pages are evicted and refetched. The page does not cover feedback or mip fallback.
  Overlap: indirection plus a physical page cache. Difference: SVT usually decides what is needed from the rendered frame
  (feedback) [recall]; Solar-System v2's rule 4 uses the f64 camera instead.
- **Mittring, Advanced Virtual Texture Topics [search].** One unfiltered indirection lookup, then one filtered cache lookup.
  Same shape as Solar-System v2's clip table and atlas.
- **Tanner et al., clipmaps [read, Wikipedia only].** Each mip level is clipped to a window around the viewpoint; the finest
  levels are small. This is the closest ancestor of Solar-System v2's per-level ring. Solar-System v2's table is a clipmap of page entries.
- **Carmack/MegaTexture, id Tech 5 [search].** Sources disagree on whether it is clipmap-like or full virtual texturing.
  Not resolved.
- **Unreal virtual texturing [not read; 403].** Recollection: page table, GPU feedback, tile cache, coarser mip while
  tiles load. The same pattern.

Taking: the "nearest resident ancestor" entry, so a lookup never chains, is standard practice as far as I recall, not Solar-System v2's
invention. Solar-System v2 is ordinary here. Mittring and Unreal should be read in full before the clip table is described as anything
but conventional.

## Geometry clipmaps (Losasso and Hoppe)

Read through the GPU Gems 2 chapter [read]. Nested n by n windows around the viewer, toroidal incremental update, geometry and
normals blended toward the coarser level near each window edge, and a residual added to the upsampled coarser level. The
residual can be decompressed data or tiled procedural noise.

Overlap: nested levels, toroidal windows, finer levels as residual over coarser ones. Different: Solar-System v2's mesh is a GPU-selected
cut with morph trajectories, not fixed rings, and its windows are per cube face. Better in clipmaps: simple watertight
rings and proven incremental update cost. The chapter also records that vertex texture reads were costly, which is worth
re-measuring for the 9-load spline read. The synthesis-over-data idea is the same family as Solar-System v2's complement bands.

## Planetary streaming

- **Cesium / 3D Tiles [read].** Screen-space-error refinement; a tile is not refined until its children load; urgent, normal
  and preload groups; priority by distance and view centre. Fast movement: parents render in place of unready descendants
  ("kicking"), and a subtree's queue is dropped past `loadingDescendantLimit`. An option, `forbidHoles`, trades holes for latency.
  Overlap: coarse fallback, cancellation, priority. Different: Cesium's priority uses view direction; Solar-System v2's cut ignores it.
  Worth taking: the load-limit idea for dropping a subtree's pending requests.
- **OpenSpace [read, home page only; thesis TOC [search]].** The home page says nothing on streaming. A Linköping thesis
  lists chunked LOD, multi-stage texture caching, replacement policies and a caching tile provider. Not read in body. Overlap
  likely, unverified.
- **Outerra [search].** Real elevation data refined by fractal algorithms down to under-foot scale; progressive download;
  mostly GPU. Closest to "measured plus procedural complement". Whether it constrains synthesis to unresolved wavelengths or
  preserves local means: not found in the material I saw. I did not read Outerra's own blog.
- **Microsoft Flight Simulator [read, one trade article].** Bing data streamed from Azure; a few hundred cities have
  photogrammetry, elsewhere "just a height field"; ML and OpenStreetMap add buildings, trees, grass. No LOD or admission
  detail. MSFS 2024 specifics were not read.
- **Blackshark.ai [search, MSFS context only].** Semantic 3D from imagery. Not a field-streaming system.
- **Google Earth [not reviewed].** No source consulted.

Better elsewhere: all of these ship, with real content, worldwide, and years of hardening. Solar-System v2 has no equivalent scale yet.

## Speed- or motion-dependent admission

Not searched in a targeted way. Cesium's kicking and ancestor-meets-SSE [read] react to movement but do not cap the finest
level by speed. Solar-System v2's rule (admit a level only while v/S is at most c) and its constant-demand table: **not found in this
review.** Searched: Cesium selection docs, general virtual texturing and clipmap queries. Searches for speed-limited
level admission specifically were not run, so absence here is very weak evidence. Expect it to be a plain bandwidth
throttle with a derivation, and look for "bandwidth-limited LOD" and "prefetch by velocity" before saying more.

## Procedural detail complementing measured elevation

Terrain amplification is a large literature [search]: learned super-resolution (Argudo et al., AFN), GAN methods (GATA),
StyleDEM (histogram matching of patch range), multi-scale erosion (Schott et al., SIGGRAPH 2024). Clipmaps and Outerra
add noise or fractals over data [read/search]. Solar-System v2's twist is a high-pass term that disables bands the served page
resolves, scaled by local slope.

## Mean-preserving detail

No method found that preserves coarse-cell means exactly. StyleDEM restores patch elevation distributions, which is
weaker. Zero-mean noise per band is the obvious construction and is what Solar-System v2 does. "Not found in this review" as a
published, tested guarantee. Searched: "terrain amplification mean-preserving", "constrained to coarse heights". One query;
weak evidence. Note also that Solar-System v2's mean-zero value noise preserves the mean only in expectation unless measured,
and the plan already says the resulting phase change is visible.

## Implications

1. Treat the clip table, atlas and ancestor fallback as conventional; budget time for reading Mittring and Unreal.
2. Revisit vertex-texture cost against Hoppe's report.
3. Consider a pending-request cap per subtree, as in Cesium.
4. Run the targeted searches above before any sentence says admission or mean-preservation is distinctive.

## Sources

Read:
- https://silverspaceship.com/src/svt/
- https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry
- https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html
- https://en.wikipedia.org/wiki/Clipmap
- https://www.openspaceproject.com/
- https://www.gamedeveloper.com/game-platforms/head-in-the-cloud-i-flight-simulator-i-s-cutting-edge-tech-today-and-tomorrow

Search results only (not read in full):
- https://www.advances.realtimerendering.com/s2008/SIGGRAPH%202008%20-%20Advanced%20virtual%20texture%20topics.pdf
- https://www.gamedeveloper.com/business/-i-outerra-i-a-seamless-planet-rendering-engine
- https://www.itn.liu.se/~nikro27/tnm107-2022/reading/bladin_broberg.pdf
- https://arxiv.org/pdf/2304.09626
- https://arxiv.org/pdf/2010.01626
- https://en.wikipedia.org/wiki/Id_Tech_5

Failed: hhoppe.com/geomclipmap.pdf (binary), Unreal docs (403).

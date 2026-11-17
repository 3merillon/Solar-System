# Explorer overhaul — 10 November 2026

The flight deck exposes HELM, NAV and SYSTEMS. J charges the selected destination's hyperdrive, Escape cancels during charge, B changes cockpit/chase view, and H hides panels. The soundtrack starts after a user gesture, remembers its volume, and can be paused in Celestial Radio. Initialization uses the same styling and hides the unreorganized controls until the deck is installed.

## Water and vehicle

Four oriented hull samples estimate submerged volume. Buoyancy supports 72% of the car's weight at full immersion, so an unpowered car sinks. Implicit quadratic drag dissipates motion without reversing velocity; water also damps rotation. Powered fans can swim, dive and leave the water. Hull movement and entry velocity drive the existing GPU wave/foam field. This is a bounded game model, not a fluid solver for the entire car.

Water layers own the actual interface. All surface readers prefer the finest resident water description at a world address. Inland raster proxies are projected along the view ray onto that level plus waves in three bounded iterations, then clipped against the shore. A mapped bed is no longer painted as a second water interface. MVT feature IDs are retained when assigning one level to pieces of the same lake. The near-plane crossing pass runs for elevated mapped lakes too. Source DEM lake elevations remain estimates; the change does not establish globally surveyed lake levels or convergence at every possible source discontinuity.

The cockpit eye moved from local `[-.36, 1, -.16]` to `[-.36, 1.12, .05]`, with a resting downward angle of 0.08 radians. The chase camera casts a 0.30 m sphere against the collision world. Building-source updates invalidate pending physics snapshots by epoch, and local collision remains active to 1,600 m altitude (returning from external flight below 1,200 m). CCD regression cases cover thin imported walls at 150–8,000 m/s. These checks apply where source data is resident; unresolved coverage still holds vehicle motion.

## Mapped scenery

Building footprints and courtyards remain source geometry. Height/levels, material, colour and roof tags select the GPU facade and roof model. Missing values are estimates. Pitched collision roofs use the same roof divisions as the visual mesh; courtyard holes remain open. This improves mapped correspondence without claiming surveyed facade reconstruction.

Mapped transportation centrelines and widths shade the displayed terrain directly. Road depth therefore follows terrain refinement and morphs exactly, with no separate ribbon to intersect a hillside. Widths without source metadata use class estimates. Bridges and tunnels are excluded from this terrain treatment; engineered spans need their own source elevations and geometry.

Road kerbs and edge markings follow the union of the resident spans, so internal rounded segment ends do not leave circular outlines across adjoining roads. Centre-line dash phase follows distance along each source path, including clipped starts. New roads blend into the terrain over 45 rendered frames; shared birth stamps survive source reordering and refresh. The stamp identity includes both halves of the source anchor so nearby roads do not inherit one another's arrival. The spatial index and its 64-reference query bound are unchanged; the bounded arrival map retains at most 16,384 seven-word keys.

The road regression reproduced 532 bright cap-line pixels inside 36,588 independently classified interior pixels before the repair, and zero afterward. Measured appearance progressed from 0% on the first frame to 15%, 52% and 100% at frames 12, 24 and 48. Reordering and re-uploading the sources changed no shaded pixels. Captures and reports are under `evidence/local/road-surface-before/` and `evidence/local/road-surface-fixed/`.

A shared raw-source spatial index excludes trees, rocks and ground cover from roads and building footprints. Visible props are checked every frame, so later map arrivals also remove existing overlaps. Physics uses the same mask. Earth rock sizes are capped at 3 m; procedural off-world rocks retain their own scale. The index is 128 × 128 cells with 64 source references per cell, about 8.2 MB including packed source records and points. Saturated cells conservatively exclude scenery; overflow is reported in `urban_index_overflow`. Source capacities remain 16,384 features, 131,072 points and 2,048 road segments. These are resource bounds, not a constant-time or scene-completeness claim.

Urban source uploads update the masks and invalidate collision snapshots without changing the world revision. Bumping that revision on each vector update caused the entire terrain quadtree to restart during flight: the regression fixture reproduced a collapse from 2,238 displayed patches to six, and terrain epoch 143 to one, after a single upload. Terrain refinement and morph history now survive urban source arrival; the existing per-frame masks handle vegetation exclusion.

The repair passed `tools/Check.ps1` and the combined headless `--scenery --stability` run. All twelve source updates preserved the current terrain epoch and displayed patch count across the upload, including six ascending-camera cases. Delayed source arrival removed all 924 measured scenery overlaps while retaining 1,056 other drawn props. Reports are in `evidence/local/urban-terrain-before/` and `evidence/local/urban-terrain-fixed/`.

## Space and sound

Sol retains its planets, dwarf planets and supported moons. Five named stellar destinations add 23 deterministic procedural worlds: Proxima Centauri, TRAPPIST-1, Tau Ceti, Epsilon Eridani and Kepler-186. Their approximate stellar positions establish destinations; their planet surfaces, sizes and circular orbits are synthetic game content, explicitly labelled in NAV. Local reference frames preserve precision after an interstellar jump. Measured and procedural source modes are switched explicitly so arriving at a procedural world does not wait for nonexistent map packs.

The WebAudio score synthesizes pads, arpeggios, bass and electronic drums at 112 BPM, with a 32-bar arrangement, seeded motifs, delay/reverb and a live voice cap. Speed changes the arrangement's energy; immersion filters the sound. No downloaded music assets are required.

## Validation

Native checks: `tools/Check.ps1` (workspace tests, Clippy, WASM compilation, Naga validation), plus the native GPU probe. Browser checks are separate and use private headless Edge with WebGPU:

- `tools/Test-Explorer-Overhaul.mjs`: pre-initialization controls, flight-deck navigation, all five system jumps, cancellation, procedural surface selection, responsive layout and an offline audio render.
- `tools/Inspect-Building-Facades.mjs`: controlled brick, stone and glass facades, roofs and roads. `--scenery` checks vegetation after delayed source arrival; `--stability` checks twelve repeated, removed and restored source uploads while stationary and ascending in flight. The flags can be combined.
- `tools/Test-Road-Surface.mjs`: independently classified road interiors, delayed appearance, persistent arrival on source reorder, and terrain continuity across uploads, with top-down WebGPU captures.
- `tools/Test-Car-Buildings.mjs`: walls, roofs, courtyard, underpass, source edits, water entry, sinking, powered swimming and cockpit captures.
- `tools/Test-Lake-Surface.mjs`: contradictory coarse/fine lake levels, independently reconstructed pixel heights above, near and below the surface.
- `tools/Test-Explorer-Water-Interface.mjs`: near-plane medium classification, waves, camera roll and origin rebasing.
- `tools/Test-Water-Layer-Logic.mjs`, `tools/Test-Urban-Sources.mjs`, `tools/Test-Vector-Tile.mjs`: source identity, bounded decoding, lake pieces, road clipping and metadata.

Local reports and images live under `evidence/local/`; generated WASM is under `web/pkg/`. The GPU probe checks its declared toy-field bounds and does not establish browser frame rate or universal renderer correctness.

The vehicle-water regression advances the animation clock with physics and requires a nonzero wave displacement and moving water cells at impact. The recorded entry produced a 0.739 m peak, 5,717 moving cells and nonzero foam, with no nonfinite values.

Recorded results: workspace checks and the native GPU probe passed. The browser lake test found zero wrong-height or wrong-facing pixels in all three views (maximum reconstructed height error under 0.7 mm in this flat fixture). Near-plane tests passed flat, wave and rolled-camera cases with no nonfinite values; rebasing changed mean image code by 0.027. Delayed urban arrival on sloped ground reduced 986 overlaps, including three drawn props, to zero; 1,056 other props remained drawn. Five system jumps, cancellation and 3 km approaches to all four procedural surface families passed. The eight-second offline score render was finite, RMS 0.019 and peak 0.173. These are controlled regression results, not guarantees for every live map tile.

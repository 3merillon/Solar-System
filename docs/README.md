# Documentation

**Current** documents describe the code as it is and are kept up to date. **Dated** documents
are research and measurement logs: their numbers were true for the build they name, and later
work may have changed them. **Superseded** documents describe a structure that has since been
replaced or removed; they are kept for their measurements and reasoning.

Paths under `evidence/`, `tools/research/` and `docs/NEXT-*.txt`, and the files `HANDOFF.md` and
`AGENTS.md`, refer to raw data, scripts and prompts kept in the development repository; they are
not part of the published source. Dated documents name tools at their path of the time: a
`tools/` script they mention that is not in this tree has since moved to `tools/research/` or
been removed (the car's tests went with the car).

## Start here

| Document | Status | About |
| --- | --- | --- |
| [../README.md](../README.md) | Current | What the app is, how to build, run and check it, what was measured |
| [../THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) | Current | Every data source and piece of adapted code, with credits and terms |
| [SOLAR-SYSTEM-V2-PLAN.md](SOLAR-SYSTEM-V2-PLAN.md) | Current (status table) | The v2 plan and where each step stands |
| [DECISION.md](DECISION.md) | Current | The architecture decision: a GPU-resident single radial surface |
| [SINGLE-SKIN.md](SINGLE-SKIN.md) | Current | The explorer's contract and its predeclared gates |
| [DIAGNOSTICS.md](DIAGNOSTICS.md) | Current | Every render diagnostic switch and what it shows |
| [HISTORY.md](HISTORY.md) | Dated log | The research phase before v2, in order, and what changed on the way to the published app |

## Engine and method

| Document | Status | About |
| --- | --- | --- |
| [EXPERIMENTS.md](EXPERIMENTS.md) | Current | Falsification plan: proposals and the gates that would refute them |
| [PRIOR-ART-STREAMING.md](PRIOR-ART-STREAMING.md) | Current | Prior art for the streaming field, level admission and detail synthesis |
| [LANDSCAPE.md](LANDSCAPE.md) | Dated (25 Oct 2026) | Prior art and competitive review |
| [EXPERIMENT-001.md](EXPERIMENT-001.md) | Dated | Bounds on detail that was never evaluated |
| [UNIFIED-FIELDS.md](UNIFIED-FIELDS.md) | Superseded | The original common-field research direction |
| [ENGINE.md](ENGINE.md) | Superseded | The field-ray engine, archived before the single-skin explorer |

## Terrain and surface detail

| Document | Status | About |
| --- | --- | --- |
| [SURFACE-CONTINUITY.md](SURFACE-CONTINUITY.md) | Dated (26 Oct 2026) | Continuous surface detail and cloud coverage edges |
| [SURFACE-DETAIL-CLOUDS.md](SURFACE-DETAIL-CLOUDS.md) | Dated (Oct 2026) | Distant shoreline detail and a cloud layer repair |

## Water

| Document | Status | About |
| --- | --- | --- |
| [WATER-LAYER.md](WATER-LAYER.md) | Current (with dated sections) | Water as its own layer: mesh, lifted ocean, bed, waves, foam; the ripple simulation's removal (16 Nov 2026) |
| [CLOUD-RIVERS-BUILDINGS-WORK.md](CLOUD-RIVERS-BUILDINGS-WORK.md) | Superseded | The river path before the water layer |
| [WATER-CLOUD-CHECKPOINT.md](WATER-CLOUD-CHECKPOINT.md) | Superseded | The per-pixel water interface before the water layer |

## Clouds and atmosphere

| Document | Status | About |
| --- | --- | --- |
| [CLOUD-TERMINATOR.md](CLOUD-TERMINATOR.md) | Dated | Cloud lighting at the day/night boundary |
| [CLOUD-SHELL-CONTINUITY.md](CLOUD-SHELL-CONTINUITY.md) | Dated | Cloud wrap and height precision |
| [CLOUD-REGIONS-TERRAIN-CATCHUP.md](CLOUD-REGIONS-TERRAIN-CATCHUP.md) | Dated (25 Oct 2026) | Regional clouds and terrain catch-up |
| [VISIBILITY-WEATHER-ARRIVAL.md](VISIBILITY-WEATHER-ARRIVAL.md) | Dated (26 Oct 2026) | Visibility, tall cumulus and arrival timing |

## Shadows and sunlight

| Document | Status | About |
| --- | --- | --- |
| [SUN-SHADOWS.md](SUN-SHADOWS.md) | Current from "Exact cached march" (15 Nov 2026); earlier sections dated | Sun visibility: terrain march, cloud shadow maps, prop cascades |
| [FRAME-COST-SUN-DRIFT.md](FRAME-COST-SUN-DRIFT.md) | Dated (14 Nov 2026) | Cloud shadows rebuilt every frame as the sun moved, and the fix |

## Scenery

| Document | Status | About |
| --- | --- | --- |
| [SCENERY.md](SCENERY.md) | Current | Procedural trees, rocks, ground cover and buildings: implementation and qualification |

## Earth data

| Document | Status | About |
| --- | --- | --- |
| [M1-LIVE-EARTH.md](M1-LIVE-EARTH.md) | Current | Live Earth design: page formats, levels, streaming, the division of work |
| [REAL-EARTH-SOURCES.md](REAL-EARTH-SOURCES.md) | Current | Terms ledger of every Earth data source |
| [REAL-EARTH-PLAN.md](REAL-EARTH-PLAN.md) | Dated (30 Oct 2026) | The plan for a real Earth and the solar system, written before it was built |
| [REAL-EARTH-PROGRESS.md](REAL-EARTH-PROGRESS.md) | Dated | Progress log of the real-Earth milestones |
| [M0-FIELD-SEAM.md](M0-FIELD-SEAM.md) | Dated (30 Oct 2026) | Field seam and body descriptor |
| [M1-HEIGHT-VALIDATION.md](M1-HEIGHT-VALIDATION.md) | Dated (30 Oct 2026) | Height validation against lidar |

## Solar system and space

| Document | Status | About |
| --- | --- | --- |
| [SOLAR-SYSTEM.md](SOLAR-SYSTEM.md) | Current | Bodies, catalogues, ephemeris, travel, landmarks, stellar travel |
| [BAKING.md](BAKING.md) | Current | Rebuilding the data packs from their public sources with one command (`tools/Rebake-Packs.mjs`): cost, what matches byte for byte, the recovered options, pack versions (version 2 of 14 body packs corrects no-data and Mercury's height scale) |
| [HDR-FINISH.md](HDR-FINISH.md) | Current (16 Nov 2026) | The picture's finish: the linear frame, the AgX tone curve and how it was chosen, bloom, the lens flare |
| [MUSIC.md](MUSIC.md) | Current (17 Nov 2026) | The score: composed as it plays, tonal harmony in exact fractions of one note (Relative Music Theory), what plays where, how it is made, what was measured |
| [SOLAR-SYSTEM-SOURCES-DRAFT.md](SOLAR-SYSTEM-SOURCES-DRAFT.md) | Draft (31 Oct 2026) | The survey of candidate solar-system sources made before the packs were baked. What is used, and its terms as recorded, is in [../THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) |

## Performance and startup

| Document | Status | About |
| --- | --- | --- |
| [FRAME-COST-PASS-2.md](FRAME-COST-PASS-2.md) | Current measurement (14-15 Nov 2026) | Frame cost now, how it is measured, what was kept and reverted |
| [STARTUP.md](STARTUP.md) | Current (with dated passes) | Worker startup and asynchronous shader compilation |
| [VERTEX-TABLE.md](VERTEX-TABLE.md) | Dated (16 Nov 2026) | Apple devices did not start (WebKit cannot compile compare-exchange); the shared vertex table without it, evidence and cost |
| [OPTIMIZATION-2026-11-13.md](OPTIMIZATION-2026-11-13.md), [details](OPTIMIZATION-2026-11-13-DETAILS.md) | Dated | Optimization pass, 13 Nov 2026 (car-era scenes) |
| [OPTIMIZATION-2026-11-10.md](OPTIMIZATION-2026-11-10.md), [details](OPTIMIZATION-2026-11-10-DETAILS.md) | Superseded | Optimization pass, 10 Nov 2026 (vehicle scenes) |
| [PERFORMANCE-PASS-2026-10-27.md](PERFORMANCE-PASS-2026-10-27.md) | Dated | Presets, allocation tiers and deferred startup |
| [INTEGRATED-PERFORMANCE.md](INTEGRATED-PERFORMANCE.md) | Dated (26 Oct 2026) | Integrated renderer qualification |
| [PERFORMANCE-SECOND-PASS.md](PERFORMANCE-SECOND-PASS.md) | Dated (25 Oct 2026) | Second measured performance pass |
| [PERFORMANCE.md](PERFORMANCE.md) | Dated (25 Oct 2026) | First performance pass |

## Removed features

| Document | Status | About |
| --- | --- | --- |
| [VEHICLE.md](VEHICLE.md) | Superseded | The Halley flying car, removed 14 Nov 2026 |
| [PHYSICS-NO-HOLDS.md](PHYSICS-NO-HOLDS.md) | Superseded | Its no-hold terrain physics, removed with it |
| [EXPLORER-OVERHAUL.md](EXPLORER-OVERHAUL.md) | Superseded | The car-era flight deck and HUD, 10 Nov 2026 |

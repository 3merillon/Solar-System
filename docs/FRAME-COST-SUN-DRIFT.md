# Cloud shadows followed the sun by rebuilding every frame (14 November 2026)

Step 3 of [SOLAR-SYSTEM-V2-PLAN.md](SOLAR-SYSTEM-V2-PLAN.md). The real-time trace measured
a moving 1080p High frame at 88-94 ms of GPU time and blamed motion. A parked car at the
same place measured the same: 95 ms, with `sun_cloud_local` 18.2 ms, `clouds` 11.1 ms and
`sun_cloud_global` 8.0 ms. The cost was not motion.

## Cause

The solar system clock turns the sun in a body's frame every frame (Earth: 0.004 degrees per
second at rate 1). Two caches keyed on the exact sun direction:

- `sun.rs` `cloud_key` / `solid_key`: any change rebuilds every cloud shadow profile, the
  optical depth and the terrain mask, of the global map and the three local levels.
- `renderer.rs` cloud field `signature`: any change is a "parameter change" and refreshes
  every cloud field texel; it also raises the jump flag that forces the profile rebuild.

So every frame of every scene with the clock running rebuilt both completely.

## Change

Below `SUN_REBAKE_ANGLE` (0.05 degrees) of sun turn since the last complete bake, the sun's
drift is handled like cloud animation already was: each frame refreshes an interleaved
1/`cloud_refresh` of the rows (default 4), optical depth and terrain mask together
(`cache_control.w` in the shader). Every row follows the sun within 4 frames; a turn past
0.05 degrees (a time jump, another body, settings) rebuilds everything as before. The sun is
still applied every frame; only the cached integrals along it lag by at most 4 frames.

Staleness bound: at rate 1 the sun turns 0.004 degrees per second, so four frames at 10-60 fps
leave a row at most 0.0017 degrees behind, against the 0.05 degree rebake limit. At high
time rates the full rebuild returns whenever the 0.05 degrees are crossed.

## Evidence

- Paused-clock captures (`tools/Compare-Builds.mjs`, procedural coast and forest views,
  display, shaded and water buffers, ultra, 960 x 540): all six byte-identical to the build
  before the change. The clouds view was not captured on the candidate side (run cut off by a
  time limit). A paused clock does not move the sun, so this shows only that nothing else
  changed; the drift path itself is bounded by the argument above, not by an image test.
- Real-time trace (`tools/Trace-Hitches.mjs`, 1080p High, single runs, not interleaved):

| Scene | GPU span p50 before -> after | sun_cloud_local | sun_cloud_global | clouds |
| --- | --- | --- | --- | --- |
| Earth parked | 95.2 -> 71.5 ms | 18.2 -> 6.1 | 8.0 -> 3.1 | 11.1 -> 13.7 |
| Procedural arrival | 82.6 -> 69.2 ms | 8.6 -> 3.0 | 10.8 -> 3.7 | - |
| Earth low flight | 120.7 -> 110.9 ms | 18.3 -> 7.4 | 7.8 -> 4.1 | 11.9 -> 13.5 |

Stage values are per-stage medians and do not add to the span. The two cloud-shadow stages
fall by 17 ms (parked) and 13 ms (arrival). The view clouds (`clouds`) are not affected.

## What is still over budget

A 60 fps frame is 16.7 ms; these frames are 70-110 ms at 1080p High. After this change the
largest stages are water (9-16 ms median, 25-31 ms in the low dive over the sea), the view
clouds (13-20 ms), gpu_scheduling (6-9 ms), topology and raster/shading (4-15 ms in the dive)
and the sun height cache (4-5 ms). None of these was changed here. Each needs its own
measured pass; claims of 60 fps would need interleaved quiet runs.

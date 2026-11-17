# The shared vertex table without compare-exchange (16 November 2026)

The app did not start on Apple devices: Safari on an iPad (and Chrome there, which is
WebKit too) stopped at startup with a page of generated Metal source. Android and desktop
Chromium were not affected.

## Cause

A check page compiled every program of the build on the iPad (Safari 27.0.1, Apple GPU),
one at a time, and kept the end of each error. Of 92 programs, 91 compiled. `gpu_hash`
failed, and so did every test shader that calls `atomicCompareExchangeWeak`, down to a
five-line one:

```
program_source:29:7: error: field may not be qualified with an address space
    T old_value;
note: in instantiation of template class '__atomic_compare_exchange_result<thread unsigned int>'
    return __atomic_compare_exchange_result<decltype(compare)> { innerCompare, exchanged };
```

The helper is WebKit's own (`MetalFunctionWriter.cpp`). WebKit corrected it on
13 September 2026 (commit 4f56cc248e, `decltype(compare)` became the template parameter);
Safari 27.0.1 does not carry the correction. No spelling of the call in WGSL avoids the
helper. `gpu_hash` was the only program of the build that used the call. The same
program with the call replaced by `atomicMax` compiled on the iPad.

## Change

`gpu_hash` claimed a slot of the build bank's table for each shared vertex with a
compare-exchange against zero. It now uses `atomicMax` only, and the vertex map is written
by a pass of its own (`shaders/terrain_gpu.wgsl`):

- `gpu_hash`: a sample offers its number (index + 1) to the slot at the hash of its cube
  key. `atomicMax` leaves the higher number in the slot and returns the previous one. The
  lower of the two, whether it lost or was pushed out, goes on to the next slot, carried by
  the same invocation. Two samples of one key meeting in a slot end there: the higher
  holds the slot, the lower is dropped.
- `gpu_hash_resolve` (new, same dispatch as `gpu_hash`): from the key's home, the first
  slot whose owner has the key is the vertex's slot. It writes the vertex map and the
  `vertices` and `hash_probe_max` counters.
- `gpu_clear` also gives every slot of the build bank a key no vertex has.

One code path for every browser. There is no capability test and no second variant: the
measured cost is below (Cost), and a path that only Apple devices would run would be a
path this workstation never tests.

## Why it is one table whatever the order of execution

Bounds story, by construction and not by sampling:

- A slot's value only rises, and a sample moves on from a slot only after that slot holds
  a higher number. So every slot from a sample's home to its place holds a higher number
  than the sample: the invariant of linear probing by priority. `lookup_morph` and
  `gpu_hash_resolve`, which stop at the first empty slot, never stop before a key that is
  in the table.
- The highest sample of a key is never dropped (only a lower duplicate is) and, by the
  invariant, no lower sample of its key lies between the key's home and it. The first slot
  holding the key is therefore the highest sample's. Every sample of the key maps to that
  slot, so a shared vertex has one slot and one owner, and the owner no longer depends on
  which invocation ran first (with compare-exchange it did).
- A sample is placed at most `HASH_REACH` (128) slots from its home, the reach of both
  lookups; one invocation walks at most `HASH_WALK` (1024) slots. Past either, the build
  raises `overflow` and is denied as before: the previous surface stays.

What is not guaranteed: that a lower duplicate never stays in the table. If another key
pushes it past its key's home before the highest sample arrives, the two never meet and
the lower one keeps a slot. Such a slot is harmless and bounded by construction: the
resolve pass maps nothing to it, so no index refers to it and `gpu_morph_vertices` (which
writes only through the map) never writes it; and since `gpu_clear` reset its key, the
`lookup_morph` of the next build cannot match what the slot held two builds ago. It
costs one of the table's slots for one build. How often it happens is not measured.

## Evidence

Baseline is the build of 62dd4a3, candidate this change; immutable snapshots of both, private
headless Chromium (BrowserWebGpu, RTX 3080), one browser at a time, GPU otherwise idle
(0% of the 3D engine before each run). The figures below are the whole record: the raw
captures and reports stay with the development data.

- `tools/Compare-Builds.mjs`, six procedural views, display, shaded and water captures:
  18 of 18 identical.
- Geometry audit (`audit_geometry`) on four procedural views at Ultra, both builds: the
  same vertex count in each view (577,266 / 577,586 / 577,522 / 576,642), the same triangle
  and edge counts, 0 boundary edges, 0 non-manifold edges, 0 unequal shared samples,
  0 overflow. `hash_probe_max` 44 / 74 / 44 / 52 before, 48 / 70 / 42 / 50 after.
- `tools/Check.ps1` and `tools/Check.ps1 -Gpu` pass.

Browser execution on WebKit is recorded separately from compilation: see the last section.

## Cost

`tools/Trace-Flight.mjs`, 1080p High, 14 s per scene, three interleaved rounds per build
with the timeline marks on. The table passes (`gpu_clear` + `gpu_hash` + `gpu_hash_resolve`)
on a frame that rebuilds the mesh, p50 over the trace, the same in every round to 0.02 ms:

| | before | after |
|---|---|---|
| `gpu_clear` | 0.03 ms | 0.11 ms |
| `gpu_hash` | 0.12 ms | 0.10 ms |
| `gpu_hash_resolve` | none | 0.21 ms |
| sum | 0.15 ms | 0.42 ms |

GPU frame span, p50 / p95 / p99 in ms, rounds 1 to 3:

| scene (frames that rebuild) | before | after |
|---|---|---|
| Earth low flight, 300 m/s (80%) | 31.9 / 38.0 / 43.4, 31.6 / 38.3 / 42.8, 32.2 / 40.1 / 45.6 | 31.8 / 38.6 / 43.8, 31.8 / 38.2 / 41.5, 31.5 / 38.8 / 41.7 |
| Earth dive (33%) | 42.4 / 49.8 / 50.5, 41.7 / 49.8 / 51.4, 42.5 / 49.8 / 50.7 | 42.4 / 49.5 / 50.3, 43.5 / 51.0 / 54.3, 42.6 / 49.7 / 50.7 |
| Mars arrival (6%) | 8.55 / 11.31 / 11.51, 8.57 / 11.29 / 11.59, 8.54 / 11.28 / 11.52 | 8.55 / 11.19 / 11.36, 8.60 / 11.30 / 11.52, 8.65 / 11.32 / 11.69 |

The 0.27 ms per rebuild is real and repeatable at the level of the passes. In the whole
frame it is inside the spread between rounds of one build: no percentile separates the two
builds. That is why there is one path and no capability test. Not measured: any GPU other
than the RTX 3080, and the mobile tiers.

The production frame (no timestamp queries, rAF interval, two runs per build): Earth low
flight p50 8.4 ms, p95 25.1 ms, p99 33.4 ms in all four runs; Mars arrival p50 8.3 ms,
p95 8.4 ms, p99 8.4 to 8.5 ms in all four. The intervals are multiples of the display's
8.3 ms, so this shows no frame moved to a later refresh, not a finer difference.

## Browser execution

- Chromium (headless, Windows, RTX 3080): the build runs; everything under Evidence and
  Cost was measured there.
- WebKit, compilation: the previous build's 92 programs on an iPad, Safari 27.0.1: 91
  compile, `gpu_hash` does not (above). The previous `gpu_hash` with `atomicMax` in place of
  the call compiled there. This build has no `atomicCompareExchangeWeak` in any of its 93
  programs.
- WebKit, this build (iPad, Chrome on WebKit, 16 November 2026, the owner's report and
  screenshot): the app starts, shows Mars from orbit with its labels, and flies. Frame time
  there is not measured.
- The same run showed the world image at half size, top-centred: WebKit does not scale a
  canvas drawn by a worker when its CSS `object-fit` is `contain`. The image now takes the
  window's shape and its bars, when it has any, are padding (`web/explorer.css` `#world`,
  `web/quality.js` `canvasSize`); with that the image filled the window on the iPad.

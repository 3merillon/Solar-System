# The picture's finish

16 November 2026. Every frame is made in linear light and becomes the display image in one place, `shaders/finish.wgsl`
(`crates/solar-explorer/src/finish.rs`): bloom, the lens flare, exposure, the tone curve, the display's power of 2.2. Before
this the composite wrote the display image itself (exposure, `c / (1 + c)` per channel, gamma), the space layer carried a copy
of the same curve for frames with no surface pass, and there was no bloom and no lens flare.

Nothing here is new as a technique: the tone curve is AgX, the bloom is Jimenez's, lens flares drawn in screen space are as
old as real-time 3D. The sources are named where each is used.

## The frame in linear light

A frame is made one of two ways, and both end at the finish:
- With a surface pass, `composite` (`shaders/explorer.wgsl`) writes the frame before exposure into a half-float target
  (`hdr`, the internal size, 8 bytes a pixel).
- With the space layer alone (far from every body), the layer's own half-float colour target is the frame. The space layer's
  copy of the tone curve and its `space_present` program are gone.

The finish is a small module of its own with four programs (`finish`, `bloom down`, `bloom up`, `exposure meter`), created with
the renderer,
outside the asynchronous program registry (`web/gpu-startup.js` lets them through by name).

`solarExplorer.capture('hdr')` returns the linear frame (RGBA, half floats, rows top to bottom), whichever way it was made.

## The tone curve

**AgX with half of the "punchy" look**, chosen by the owner on 16 November 2026 from sheets of their own scenes.

How it was chosen. `tools/Capture-HDR.mjs` saves the linear frame of a fixed set of scenes (Earth by day, at dusk, over the
sea, from orbit; the Moon; Saturn; the Sun from four distances; a red dwarf; two procedural views). `tools/Tone-Curves.mjs`
applies each candidate to those same pixels, with the exposure of each set so that scene mid grey (0.18) lands where the
former curve put it, so the sheets differ in contrast, highlights and hue, not in brightness; and to a chart no scene gives
(every hue, fully and half saturated, from 0.02 to 60). Candidates, with what was seen:

| Curve | Source | Seen on the sheets |
| --- | --- | --- |
| `c / (1 + c)` per channel (before) | Reinhard et al. 2002 | Natural but flat. On the chart a bright saturated colour slides to the nearest of cyan, magenta and yellow. |
| ACES, Narkowicz's fit | K. Narkowicz, "ACES Filmic Tone Mapping Curve", 6 January 2016 (CC0 or MIT) | Contrasty, heavy shadows; the same slide of hue (it too works per channel on the display's primaries). |
| ACES, Hill's RRT and ODT fit | S. Hill, in BakingLab's `ACES.hlsl` (MIT, MJP and D. Neubelt) | Film-like; brights pale to white; the dusk sea and under water go dark navy. |
| AgX | T. Sobotka; the Rec.2020 form three.js (MIT) and Filament take from Blender; B. Wrensch's polynomial sigmoid (MIT) | The former curve's tone without the slide of hue; a little flatter. |
| AgX with Wrensch's "punchy" look (power 1.35, saturation 1.4) | as above | Contrast and colour back; strong on the sea. |
| Khronos PBR Neutral | Khronos ToneMapping repository (Apache-2.0) | True colours in the middle; snow and Saturn's disk blow out to a flat cream (it compresses only the top fifth of the range). |
| Tony McMapface | T. Stachowiak (MIT or Apache-2.0), a 48^3 table | Well behaved, more muted than the former curve; needs a table shipped. |

The owner had found the former curve "quite realistic (slightly washed out)" and wanted realism over a film look. AgX at half
the punchy look (power 1.18, saturation 1.2) keeps that natural tone, removes the wash, and takes bright colours to white
without changing their hue.

What is in the shader: linear sRGB to Rec.2020, the AgX inset matrix, log2 over 16.5 stops (2^-10 to 2^6.5 times 0.18),
Wrensch's sixth-order sigmoid fit, the look (a power, then saturation about the luminance), the outset matrix, the power 2.2
back to light, Rec.2020 to linear sRGB, a clamp; then the display's power 1 / 2.2. A gain of 0.910 on the frame's exposure
keeps scene mid grey where the former curve put it at the default exposure (0.190 in display light). The live image is within
1/255 of the offline curve on the coast view and on the Sun at 2 radii (bloom off).

Consequences. Every view differs from every earlier build: `tools/Compare-Builds.mjs` against a build before 16 November 2026
is different everywhere, by design. The familiar Sun's palette had been pushed to a deep red in linear light to come out
orange through a curve that pales bright colours; it is now the orange itself, solved so the disk shows what it showed (within
5/255 at the quiet disk's levels).

## Bloom

After J. Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014, Advances in Real-Time
Rendering course), slides 144 to 170: no threshold; the frame is filtered and halved down a chain, each step 13 bilinear taps
over 36 texels (a centre box of four taps at half the weight and four corner boxes sharing the other half); the chain is then
summed on the way back up with a 3 by 3 tent, one texel of the smaller level in radius.

Every filter's weights sum to one, so each level holds the frame's light and so does the mean of the levels. The display
shows 96% of the frame and 4% of that mean (his "about 0.04"): light is moved about, none is added. The edge of the frame
clamps, which is the one place the sum is not exact.

Levels (each half the one before, the first half the frame), a preset key `bloom_levels`: six on Ultra and High, five on
Medium, four on Low, three on Minimal. Fewer levels make a narrower halo, not a dimmer one. Half-float targets, 8 bytes a
pixel: a third of the frame's size in all.

His partial Karis average (a weighting against single very bright pixels on the first step down) is not applied: nothing in
the captures so far needed it. It has not been judged in motion over glittering water; if it flickers there, that is the fix.

A diagnostic view is shown without bloom or flare.

## The lens flare

A photograph's flare, quiet (the owner's choice): six ghosts on the line from the source through the frame's centre (images
of the iris, a little larger in blue than in red), a faint coloured halo 0.42 of the half height from the source, and the
fourteen spikes of a seven-bladed iris. It is the lens's light. The eye's glare is elsewhere: the star's own skirt
(`space.wgsl` `star`, an inverse square of the angle from the disk) and the bloom.

**What drives it is the light the frame really holds of the source.** The renderer hands the finish the stars in front of
the eye (up to four; on a world of its own, the sky's sun), each as a place and an angular radius. Where the finish works out
its triangle's corners (three times a frame, not per pixel) it reads the frame at 24 points spread over the star's disk, never
under a pixel and a half in radius, a point off the frame counting as dark. The mean of those is the flare's light. So whatever
stands in front of the star in the picture (a planet, a ridge, a cloud, Saturn's rings, the air at sunset) dims the flare by as
much as it dims the star, and there is no second occlusion model to disagree with the picture. Captured over the Moon's
horizon (`tools/Capture-HDR.mjs`, scenes `moon-sun-*`): full with the Sun clear, less with it on the horizon, almost none with
a sliver left, none once it has set.

Two rules are choices for a display, not a lens's measured reflectances, and are stated in the shader:
- The flux is compressed: flux / (1 + flux / 0.01), where the Sun from 1 au gives 0.0025 (radiance times solid angle in the
  frame's units). From Mercury's distance inward the flare stops growing.
- It fades out as the source's mean luminance in the frame falls from 6 to 1.5, which is a star whose disk is resolved and
  metered (see "Exposure"): a camera stopped down for the disk shows no flare.

The flare is seven parts white to three of the source's colour: a source that far over the frame's range shows as white on
screen whatever its colour. The shares of the ghosts, halo and spikes were set by eye against a Sun the renderer holds to 15
units, thousands of times under its true ratio to sunlit ground.

Limits. A star just outside the frame gives no flare (a real lens would still show some). The field of view is taken as the
renderer's fixed 60 degrees. A bright thing that is not the star but lies over its place (a sunlit cloud bank hiding the Sun)
lends the flare its own, lesser, light. A fully eclipsed star (the eye's view of the disk, already computed for eclipses, is
zero) is not handed over at all.

## Exposure

The frame's exposure setting is a constant (1.3). Two things move on top of it.

A star whose disk is resolved is metered on its own (`star_exposure`, docs/SOLAR-SYSTEM.md, "The star model"): only the
star's light is scaled, before anything here.

**Auto exposure** (17 November 2026; the owner: "it would help going to very bright sun") adapts the whole frame, slowly and
in part, as an eye or a camera does. A display model, not a measurement:
- The meter reads the bloom chain's smallest level (the frame averaged over blocks of 64 pixels at 1080p) at 16 by 9 points and
  takes the mean luminance weighted by the luminance itself (sum of squares over sum): the brightness of the light in the
  frame. Black sky does not drag it down, so a planet in a black frame is not blown out. With auto exposure on the chain is
  always six levels long and runs even with bloom off.
- The goal is the square root of 0.4 over that value: half of a full adaptation, where 0.4 is a sunlit landscape on this
  renderer's own scenes (the coast view measures 0.39 as a plain mean, the mountain 0.54, the Sun from 1.01 radii 0.69).
  It is held between 1.5 stops down and 0.7 up, and is never raised so far that the brightest block passes 3.
- The exposure moves toward the goal with a time constant of one second, in stops; the first frame takes the goal at once.
  The state is one texel kept on the GPU; the page does not read it back, so the panel does not state its value.

Seen in captures (`tools/Capture-HDR.mjs`): the coast unchanged, the snow mountain a little darker with detail held in the
snow, the Moon from 2,500 km a little brighter. Because the star's own metering already brings a near disk to 1.3, the two do
not fight: near the Sun the frame goes about a third of a stop darker again. With "Meter on a star's disk" off, this is what
stops the picture down (to its limit of 1.5 stops).

A build with auto exposure differs from one without wherever the frame is not at the reference brightness. Runs with a fixed
number of frames and time step adapt identically, so comparisons between builds stay exact.

## Controls

"Bloom", "Lens flare" and "Auto exposure", all on by default: under Display on the solar page, under Quality details
elsewhere. Settings `bloom`, `bloom_levels` (a preset key), `lens_flare` and `auto_exposure`. Nothing was removed or renamed.

## Cost

RTX 3080, 1080p, High, private headless browser, `tools/Trace-Flight.mjs` 14 s, rows after 2 s, two interleaved rounds of the
build before, the new build, and the new build with bloom off (16 November 2026, before the lens flare was added):

| Scene | Before, frame GPU p50 / p95 / p99 (ms) | With bloom | Bloom off | `bloom` mark p50 | `finish` mark p50 |
| --- | --- | --- | --- | --- | --- |
| Sun at 2 radii | 2.47 / 2.53 / 2.85 and 2.42 / 2.45 / 2.45 | 2.52 / 2.60 / 2.93 and 2.40 / 2.72 / 2.82 | 2.49 / 2.55 / 2.85 and 2.56 / 2.59 / 2.60 | 0.11 | 0.08 |
| Earth hover | 40.12 / 43.15 / 44.04 and 40.64 / 43.14 / 44.58 | 40.37 / 43.12 / 44.02 and 39.51 / 41.74 / 43.68 | 39.41 / 44.40 / 46.68 and 39.66 / 43.27 / 44.59 | 0.08 | 0.06 |

The whole frame's change is inside the run-to-run spread. The `bloom` mark's p95 near the Sun was 0.33 and 0.48 ms in the two
rounds (not explained).

With the lens flare and auto exposure (17 November 2026, same method, 12 s, two interleaved rounds): the `finish` mark 0.06 ms
over Earth and close to the Sun, 0.08 at 2 radii, 0.11 from 10 radii (the flare is drawn there); the `bloom` mark, which now
holds the chain's six levels and the meter, 0.08 to 0.14 ms in most runs and 0.37 in others (two values, not a spread; not
explained). Earth hover, whole frame p50 / p95 / p99: 38.96 / 41.75 / 43.06 before the finish existed, 39.41 / 42.36 / 43.50
with all of it. The cold compile of the four programs is not measured.

## Not done

The finish's own cost per preset and its cold compile; a look at bloom in motion over water; a flare from a star just off the
frame; the adapted exposure stated in the panel.

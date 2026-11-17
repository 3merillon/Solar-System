# The solar system

Started 31 October 2026, ahead of M2 to M8 at the owner's request. Brief:
`docs/NEXT-CONTEXT-SOLAR-SYSTEM.txt` (development repository only). Terms and catalogue:
[SOLAR-SYSTEM-SOURCES-DRAFT.md](SOLAR-SYSTEM-SOURCES-DRAFT.md), read before anything ships.

Open it: `?body=solar`. Earth (`?body=earth`) and the procedural body keep their own paths.

## Time, positions and frames

**Clock.** TDB seconds past J2000, kept as a whole part and a fraction (`ephemeris::SimTime`), so a frame's step
is exact at any date and rate.

**Positions** come from one 2.4 MB table baked by `solar-bake solar` from JPL kernels (DE440s, and the satellite
kernels `mar099s`, `jup365`, `sat441`, `ura184`, `nep097`, `plu060`; kept locally, not in git). The table is embedded in
the WASM, so a position query answers at once. Three forms:

- Chebyshev segments for planets' barycentres and the Moon, 1900 to 2100. Segment ends share a sample, so a
  position has no jump at a join beyond the rounding of the stored coefficients.
- Harmonic series for regular moons, fitted over 1995 to 2050 by matching pursuit. About 2 to 5 KB each, with no
  joins, and they degrade slowly outside the fit instead of ending. Outside that span their error is not measured.
- A planet's centre, from its barycentre less the mass-weighted positions of its moons. This costs no storage and
  keeps Earth's 4,670 km monthly wobble exact to the Moon's position.

Three things this bake got wrong first, all caught by comparing with Horizons:

- Thinning the fit's rows on a regular stride aliased two frequencies into one column, and the solve answered with
  cancelling amplitudes of billions of km. Rows are now on an irrational stride.
- Satellite kernels carry their own copies of planets from older integrations, so DE440 must load last.
- A fit's own error, measured against the kernel, cannot see either of those.

**Measured error** against values recorded once from JPL Horizons (`tools/Record-Horizons.mjs`, one request per
body; `crates/solar-core/tests/data/horizons-v1.json`), at epochs the fit did not use. Worst over 1900 to 2100 for
planets and the Moon, 1995 to 2050 for moons, in km:

| Body | km | Body | km | Body | km |
|---|---|---|---|---|---|
| Mercury | 5 | Io | 12 | Titan | 12 |
| Venus | 0.03 | Europa | 55 | Iapetus | 114 |
| Earth | 0.04 | Ganymede | 42 | Mimas | 106 |
| Moon | 1.6 | Callisto | 34 | Enceladus | 18 |
| Mars | 0.06 | Phobos | 1.6 | Tethys | 36 |
| Jupiter | 3.6 | Deimos | 11 | Dione | 24 |
| Saturn | 21 | Ariel | 27 | Rhea | 15 |
| Uranus | **4,855** | Umbriel | 59 | Triton | 369 |
| Neptune | **2,202** | Titania | 38 | Miranda | 113 |
| Pluto | 25 | Oberon | 48 | Charon | 0.03 |

Uranus and Neptune stand out, while the fit to DE440 itself is 31 km. So this looks like Horizons using other
integrations for those two. That is an inference, and it was not confirmed. It is under a millionth of a radian seen
from the Sun, and nothing flown in those planets' frames reads it.

**Rotation** is the IAU model from `pck00011`. Body-fixed axes are the renderer's: +Y the IAU north pole, +Z longitude
zero, +X longitude 90 east. A moon's quadratic phase terms in Mars's system are dropped, which moves an angle far
under a bit of Phobos's map.

**Precision.** A frame is a body's centre with ICRF axes. Position in a frame is an integer sector plus a bounded
offset (`celestial::Address`), so nothing near a body depends on how far that body is from the Sun. Two bodies'
separation is walked only as far up the tree as they share. Test: two crafts 1 mm apart near Neptune at a clock rate
of 1e7 stay 1 mm apart within 0.1 mm over ten seconds.

## Flight

Clock edits now preserve the craft's surface-relative position, orientation,
and velocity while it is in a body's gravity band. A destination initializes
velocity against the turning surface. Pausing time still applies the inverse
true-spin correction; omitting it had dragged a hovering camera kilometres
across stationary terrain. Date/time and mean local solar time controls replace
the solar-mode sun-elevation slider. `Test-Solar-Time-Camera.mjs` exercises the
actual browser controls and WASM flight at paused, real-time and accelerated
rates; native regressions cover time edits on Earth, the Moon and Mars.

`solar_core::flight`, in Rust and tested without a GPU. The shape is from the Planets repository; its numbers are not.

- **Thrust** along camera axes. Below a height-scaled rule it is the speed setting times the drag at Earth's sea level,
  so the setting is the terminal speed there, as in Planets. It then grows with distance from the nearest surface, so
  one setting serves a hover and a trip to Neptune: h'' = 0.01 h, an e-fold of 10 s. **This scaling is a rule of
  thumb for playability, not physics.**
- **Drag** is linear, as in Planets, with a coefficient from real air: 8/s at Earth's sea level, in proportion to density
  (an exponential with the body's scale height, ending at its shell). So real density drives where the craft is fast:
  terminal speed rises by e per scale height. Owner to judge the feel; Mars at 1.6% of Earth's density is quick.
  A dive drops drag to 30%, as in Planets.
- **Gravity** is GM/r^2 of the frame's body, in patched conics. The hover assist cancels only gravity beyond v^2/r,
  as in Planets: it holds height at rest, follows the surface at speed, cancels nothing at orbital speed.
  Its blend rides real gravity (Planets' `groundednessBlend`).
- **Approach limit:** closing speed on the nearest surface is limited to half the clearance per second, so a fast
  arrival cannot pass through a surface in one step. **Assistance, not physics.** Key `Z` turns it and the hover off.
- **Autopilot** (`Fly to`): the same thrust and physics, only steered. It skips nothing.

**Time.** The craft flies on real seconds, and bodies move on the clock, `rate` times faster. In a body's frame none of
the body's motion reaches the craft. At a hand-over a body's velocity enters at `rate` times its true value, because
that is how fast it crosses the sky, so what the eye sees does not jump. Air and ground turn at the body's true rate,
and the spin the clock adds beyond that carries the craft rigidly in proportion to how grounded it is. At rate 1 this is
plain mechanics. At any rate the ground under a craft in the air holds still, where real air at clock rate 1e5 would
arrive at hundreds of km/s. Landed with no input, a craft is held through the orientation itself, so that periodic
terms in the Moon's prime meridian cannot slide it.

**Tested numerically** (`crates/solar-core/tests/flight.rs`): terminal speed against height; drag fading to zero at the
shell; two coasting orbits with energy drift under 0.1%; escape with no velocity jump at the hand-over; hand-overs
at clock rates up to 1e6 exact to rounding; re-entry at 12 km/s; landing and holding still on Mars, the Moon and Earth at
rates to 1e5; a giant's floor; Earth to Mars at rates 1 and 1e4, in about 4 minutes, through frames Earth, Sun, Mars.

**Decisions.** A giant has no surface: the craft may fly in, the air thickens and closes the view, and 150 km under the
1 bar level is as far as the model goes. Phobos and Deimos are not spheres. They are drawn as one for now, which is a
known fault of the radial skin, and need the decision the brief asks for.

## Rendering

One renderer, one body in full detail. **The renderer's camera is always in the fixed axes of the body in full detail**, or
inertial axes with none, so the existing passes never learn that the body moves or turns.

- **Space pass** (`shaders/space.wgsl`, `crates/solar-explorer/src/space.rs`): its own small module, off and one
  texel in size on `?body=earth`. Stars, the diffuse sky, the Sun, and every other body as an analytic ellipsoid over a
  1024 x 512 map. With no surface pass in the frame, it is the image.
- **Depth across the range.** The old Solar-System repository used camera-relative positions and a logarithmic depth
  buffer. Here nothing that far shares a depth buffer: bodies draw far to near by the CPU's sort, and only the surface pass
  has depth. Ordering against the surface takes a distance per pixel.
- **Full detail** is chosen by a disk's angular size: half-angle 0.087 rad on every body, with 20% hysteresis. The surface pass
  then comes in over the disk's growth to 0.139 rad, as a dissolve against the far version in its own target, set by distance and so
  the same both ways, and changing by at most 1/30 a frame. It has no share for its first 8 frames, and is off altogether with no share.
  These thresholds are a judgement.
- **Earth's far clouds** are a map of the whole planet, 1024 x 512 on the higher tiers, each texel a column of the surface pass's own
  weather and `cloud_body` at the map's footprint, so the far planet's clouds are the ones the surface pass goes on to march. All of it is
  made at start, then 8 rows a frame while Earth covers a pixel and the surface alone is not showing it. The sunlit fraction of a column
  (a gain of 0.85 and a ramp on the Sun's height) is a fit by eye and mean colour to that pass at one date, and clouds cast no shadow here.
  The map stays true while another body is in full detail, as it has its own frame uniform. These clouds, like the surface's, are synthesized, not observed.
- **Body change** needs no reload and no new program. Atlases stay allocated, the clip table is cleared in one bounded
  write, the field worker moves to the body's pack, and the surface stays off until D0 to D2 have come in. Until then
  the impostor stands, and no frame waits. Its upload budget is the same 4 pages per frame.
- **Sun.** The direction moves in steps of 0.1 degree, more at high rates, because each change rebuilds shadow maps. The
  step is visible at sunset. **Its cost has not been measured.**
- **Light.** Eyes are taken as fully adapted to the light where they are: a surface looks as bright at Neptune as at Earth,
  and a far body's light is against that.

**The sky is where it is on the date.** NASA's Deep Star Maps 2020, 8K, sharpened with an unsharp mask in linear light, on a cube of 2048 per face with one reduced level: about 23 texels a degree against 18 pixels on a 1080p screen. The first version used a 2048 x 1024 equirectangular map, which the owner saw as blurred, with a pinch at the celestial pole. A cube has no pole. I then tried replacing the map's stars with Tycho-2 points, and stopped at the owner's word: it is the map's look they want, the Milky Way above all. The 906 stars brighter than magnitude 4.5 from the Bright Star Catalogue (FK5 J2000, within a pixel of ICRF) are also drawn as points on top, moved by proper motion to the clock's date; the rest are the map's, fixed at its epoch. All of it is in inertial axes and turns only as the eye's axes do, so from a body's surface the sky wheels at the body's real rate times the clock rate. Parallax from the Sun to Neptune is at most 22 arcseconds on the nearest star, under a pixel, and is left out. The map's orientation was checked against the catalogue when baked: the mean peak at 106 bright stars is far higher as stated than under the three wrong orientations tried. Star brightness is compressed as a long exposure compresses it: an appearance choice. Positions are the catalogue's.

**Finding things.** Corner brackets with a leader and name on a canvas over the image (`L`): planets always, moons when the eye is in their system, and a chevron at the screen's edge for an off-screen target. A click on one sets the target. They are depth tested against the bodies, analytically and not with a depth buffer, since nothing here shares one: a body whose centre lies behind another is not drawn, and each nearer disk is cut out of what a marker can draw on. On screen a disk is taken as a circle, which is near right unless a body fills much of the view, and rings do not hide a marker. The planet menu goes to any body at once.

**Orbits** (`O`): a thin line round each planet's orbit, and each moon's when the eye is in its system, fading as in the Solar-System repository: all of the orbit faintly, and a sharp cubic rise over the last 30% behind the body. They come from the real table, not a circle, one period back from the clock's date, so they are the real path. A planet's position only holds before 1900, so Neptune's line is about three quarters of its orbit and Pluto's about half. Each fragment compares the line's distance with every body along its ray, so a line passes in front of a body or behind it correctly, **except** the body in the surface pass, which hides any line in front of it: a limit of how the composite takes this layer. Look (`T`) turns to it and keeps following it, Fly (`Y`) is the autopilot, Go (`G`) is a shortcut, instantly into a circular orbit. **Go is a teleport, as the owner asked**, alongside the flight, which still skips nothing. `tools/Test-Solar-Markers.mjs` checks these: Look puts the Moon at the exact centre, and Go arrives in the body's frame at orbital speed for six bodies tried.

**Atmospheres** are a first appearance model, chosen by eye, with scale heights from the fact sheets. **None has evidence
yet against images of the body.** Venus and Titan do not fit one exponential, as the plan warned. Venus's clear air under
its cloud deck is not modelled.

**Refinement on every body: the owner's decision, 31 October 2026.** This reverses my first choice of no synthesized detail off Earth, which left the Moon smooth up close. Synthesis fills only what the data does not resolve, as on Earth: heights in the complement bands, the same one field for mesh, shadows and the f64 reader, and ground in the material, for shading alone. Each body has a kind of ground (`body::Ground`): regolith with a power law of mostly worn small craters, dust with rock on steep ground, or ice with fractures across all of it. **All of this is synthesized, and could be taken for discovery**, so the display says so for the body in view, and the Ground detail switch turns it off. Bodies with no height data get relief from this alone (`NO_HEIGHTS_RELIEF`), and the display says that too. These are appearance choices, not checked against images of each body.

**Provenance.** Venus's map is radar brightness, and the display and the pack's manifest say so. Saturn, Uranus and Neptune have only a colour by latitude from `solar-bake schematic`, because no free global map was found: **these three are not measurements**. Saturn's ring boundaries and rough optical depths are published values, and its fine ringlets are synthesized.

Faults the owner found on the Moon, and what they were: a flat grey band above the horizon was the impostor showing where terrain lies lower than the reference radius, so it now sits below all terrain. A body with no sea still had sea level at height zero, which darkened every contour through it as a wet shore: it now has no level. Shadows had a blue cast, from Earth's sky light. Pure black shadows now have a small ambient, chosen by eye. A hard dark trapezoid seen once in a shadow, soon after a jump, did not come back: it may be stale shadow maps after a jump, and is **not understood**.

## Belts and rings

**Asteroids are real.** 99,999 numbered bodies from JPL's Small-Body Database, the brightest by H, recorded once with one
request at full precision (`tools/Bake-Asteroids.mjs`, 4.8 MB): main belt, Trojans, centaurs and trans-Neptunian objects.
37,115 have no catalogued diameter, so their radius comes from H with an assumed albedo of 0.14. Position is a two-body
orbit from a single epoch, solved in the vertex shader for points and in f64 on the page for what is near. **Secular
perturbations are left out, and this has not been measured against Horizons:** it is right for where the belt is and
wrong by growing amounts for a given rock away from its epoch. All other asteroids in reality are not drawn.

Three ranges, each from the same orbits, with no switch in where anything is:

1. **Far: a band.** A glow integrated along the ray through each belt, of the real extent and thickness. What the points
   cannot show. Its brightness is a choice, not a measurement.
2. **Middle: points.** Each asteroid at its place for the date, in the standard reduction V = H + 5 log10(r d) + phase,
   in the same flux as the stars. One pixel each.
3. **Near: rocks.** The page scans 2,000 orbits a frame, so all of them in under half a second, and the up to 8 largest on
   screen become bodies, ray marched. The orbit and size are real, **the shape is synthesized**, as almost none has been
   measured. They have no collision: the craft passes through.

**True brightness shows nothing.** From outside, a real asteroid belt cannot be seen, and at true light (slider at 0) this
one cannot either. The default raises it by 8 magnitudes, 1,585 times, and **the display says by how much.** This is the one
place light is exaggerated, at the owner's request for a belt that renders from far.

**Saturn's rings** take the planet's shadow, cast a soft shadow on it across the width of the Sun as seen from there, are
dimmer from the side away from the Sun, and are nearly edge-on in early 2027, as in reality. Ring particles at close range
were added next: see below. The Planets repository's octahedral atlas of baked rocks was not needed for this count of near rocks,
so it was not ported.

**Inside Saturn's rings** the sheet gives way, between about 70 and 20 km, to rocks. Five nested shells around the eye, each a lattice in
the ring's own frame with cells from 4 m to 1 km, 9,409 cells a shell, each holding at most one rock by the published optical depth at that
radius. A coarse shell's rocks fade before the shell ends, as the next finer one has already taken over; what shows a shape is ray marched, and
the rest are broken disks. They have a depth buffer of their own, in a pass of their own, and take Saturn's shadow. **All of them are synthesized,
their sizes reach about 80 m where real ring particles are mostly under 10 m, they lie in a sheet about 40 m thick, and they do not orbit:** real
ones move at about 20 km/s. Nothing collides with them.

**Seen from inside.** The owner flew through both and saw nothing. The real asteroids lie millions of km apart, which is true and is why a real belt looks empty, and flight crossed the rings' field of rocks in under a second. So a belt now has, around the eye, a synthesized field in three dimensions: five nested shells of cells from 300 m to 1,200 km, by the belt's extent, with rocks to about 110 km, **not any real object**, and the display says so while it is on. The slider at 0 removes it. The ring's own field, also synthesized, reaches about 790 km along the plane and comes on below 780 km over it, so that a pilot sees rocks all the way in; its two far shells hold rocks far bigger than any real ring particle (up to about 1.7 km against the true metres), a choice for visibility. And the rings now count as a surface for flight, with assistance on and no autopilot: thrust and the approach limit go by the height over them, so a pilot flying at them slows among them, and gets through (`a_pilot_flying_at_the_rings...`, a test that flies, where the first test only placed a camera).

**Inside a body's band.** The owner: "when inside a planet (as in the planets repo) we should slow to a hovering stop". The first version read drag from the true density alone, which is not what Planets does and gave Mars 0.13 per second at its surface and almost nothing above it, so a craft curved round a planet like a marble. Now, with assistance on, drag is `8 (1 - free)` per second on every body with or without air, where `free` is the same gravity band as the hover assist, as in Planets' `flyDragBase * (1 - tau)`, unless the true air's is greater. This is assistance and not physics: on the Moon it is no real force. Inside a band, thrust also pays for that drag at 0.1 metres per second per metre of height, so a band does not trap a climb. Also with assistance on, speed against the nearest surface in any direction is held to 1 per second per metre of height over the ground, or the pilot's own setting if greater, so a near miss from any speed still ends inside the band's reach. With assistance off (Z) there is only real air, and a low orbit is a real one. Go places a craft just past the band, where an orbit stays an orbit: 3.1 radii at Earth, 1.9 at Mars, 5 at Jupiter.

**Entering a frame under a fast clock.** Hand-overs keep what the eye sees, which at rate 3600 meant a craft reached by a planet kept the planet's apparent 107,000 km/s and went straight through. With assistance on, going down into a frame now takes the slower of the velocity against the body as seen and as it truly is, so the craft comes into sync with it (`entering_a_planets_frame_under_a_fast_clock...`). This one step changes the velocity the eye sees: the planet stops rushing past, which is the point. With assistance off, and going up to a parent, nothing changes and the hand-over stays continuous.

**Coming back to Earth.** A body's overrides went into the renderer's settings, so one visit to an airless body left Earth with no water, clouds, trees or rocks, and with that body's relief and sea, for the rest of the session: the seabed drawn bare. The renderer now keeps what the page asked for apart from what a body overrides (`Test-Solar-Earth-Return`, which reads the renderer's state, since the page's copy says Earth whatever the body is).

**Orbit lines up close.** Three faults the owner found in turn. A cut at a near plane alone, with the cut point then projected, moved by tens of km of rounding on points 1e11 m away: clipping is now homogeneous, against five planes. The width interpolated with perspective across depths of up to 1e8 to 1 broke up into dots: it now goes in screen space. And 256 straight pieces show their corners close by: a piece now bisects on the true orbit until its bend from the eye is under about a third of a pixel, or a limit on depth or points is met (`no_bend_shows_in_an_orbit_line_from_close_by`).

**Holes in the height data.** Pluto's, Charon's and Venus's height files mark what was never measured with -32768. The bake only skipped no-data when told to, so Pluto had a chasm 32 km deep with cliffs round it, seen from space as a rift. The bake now reads the file's own no-data tag, and fills a hole from what is around it (push-pull down a pyramid, wrapping in longitude). **Filled heights are interpolated, not measured**, and the fraction is in each pack's manifest as `height_filled_fraction`.

**The Sun every frame.** `packet()` had held the Sun still between steps, to save rebuilding the shadow caches, so at rate 3600 a planet's shading changed one frame in five. It now goes every frame, at the owner's word, since a moving Sun rebuilds the horizon and cloud caches. Frame to finished, 1080p, high preset, RTX 3080, browser on a quiet machine, p50/p95/p99 ms: 300 km over Earth, clock stopped 90.7/96.4/102.6, rate 1 105.0/110.9/111.6, rate 3600 109.8/116.5/119.1; on the ground at 500 m, clock stopped 31.2/33.0/34.7, rate 1 46.0/48.1/49.7, rate 3600 39.0/42.9/45.6. So about 15 ms a frame, at any rate of the clock above zero. The stopped runs drifted between 23 and 31 ms on the ground and 91 and 98 ms in the air, so differences under that mean little. The 91 ms over Earth is not from this and is not explained here.

**The browser stays out of the game.** The owner ended a right-drag look over a menu and got Chrome's menu with Google Lens: only the canvas refused it, and Chrome opens the menu on the release, over whatever is under the cursor by then. `web/game-input.js` refuses it everywhere, with the browser's shortcuts, Ctrl+wheel zoom, middle-click autoscroll, the mouse's back and forward buttons, and dragged files. Keys go to the craft whichever control was last touched, except in a number box; a chord is never a game key. Left alone on purpose: reload, developer tools, changing tab, Alt+F4, Tab into the panel. Ctrl+W, Ctrl+T and Ctrl+N cannot be refused by a page outside full screen, so F11 goes through the page to hold them with the Keyboard Lock API (Chromium, secure pages). `tools/Test-Game-Input.mjs`: 46 of 64 checks failed before the fix, 68 of 68 pass after. Headless shows no menus, so it proves the page refused each default, not what a visible browser draws, and the keyboard lock's effect on Ctrl+W is untested. No pointer lock: Chrome would show its notice on each look, so a look still stops when the cursor reaches the screen's edge.

**The far planet and the surface.** The owner: the switch "is pretty harsh, especially when flying away, especially because of the clouds popping in". `tools/Test-Solar-Transition.mjs` flies in and out through the hand-over with the disk's mean colour and each frame's change against its neighbours. At half-angle 0.044 rad Earth's mean brightness stepped from 77 to 58 in one frame (jump 4.2), and the clouds there were blocks: half-size cloud pixels on a disk 41 pixels in radius. Mars 2.4, the Moon 1.6. After: Earth 1.11, Mars 1.10, the Moon 1.10, largest brightness step 0.61 of 255. Same camera at half-angle 0.087 and 0.14, far against surface on Earth: mean colour within about 5 of 255 before the last trim, and the same clouds in the same places. The sea's glint on the surface pass is not on the far planet.

Frame to finished, browser, 1080p, high preset, RTX 3080, machine not known to be quiet, p50/p95/p99 ms: far Earth at 0.07 rad 4.0/5.5/5.8, where the surface pass used to run; dissolving at 0.11 rad 14.4/16.4/18.1, clock running 37.5/39.3/40.1; surface at 0.2 rad 15.7/18.2/20.0. A running clock costs more because a moved Sun marks all cloud fields dirty.

## The whole flight

`tools/Test-Solar-Flight.mjs`, in a private headless browser with recorded tiles. Earth's surface at 2 km, autopilot to Mars at
clock rate 3600, down to the ground, held. On `abcc5d1` plus the fixes after it, 1280 x 720, high preset, **machine not quiet**:

- Frames Earth, Sun, Mars. Surface off at frame 4429, Mars's surface on at frame 9103, 156 frames after its pack was asked
  for. Landed at 1.8 m and held with 0 speed against the ground. 0 pages failed, device not lost.
- Submit time per frame: p50 10.7, p95 28.1, p99 39.4, largest 568 ms. **The largest six are all in the first frames or at
  Earth's first surface frame.** The frames at the body change took 6.5 and 11.1 ms to submit. These are CPU-side intervals in
  a browser with other work on the machine. GPU time per stage has not been measured.

The Earth path matches `?body=earth`: `tools/Test-Solar-Earth-Match.mjs`, same camera and sun, clouds off at 600 km, 0 difference
in every display channel. With the sun moved 0.05, the same test reads 0.62 mean and 2 peak, so it can fail. Only that one view.

## Rock on Earth

The owner saw thin closed loops on hills. They were the zero lines of a smooth noise, drawn as "joints". Joints are now planes in
three scales with a slow wander, each ended by a gate (`joint_family`, `shaders/surface_field.wgsl`), and lichen is a soft stain.
On `3bd2f6e` the loops show at `tools/Test-Rock-Joints.mjs --sites swiss` site 0, and on this build they are gone. In Switzerland
the sharp imagery leaves only the finest set, and the sites tried outside it were snow or plain, so **how the new cracks look
on bare rock under 10 m imagery has not been judged.** The owner's eye is that test.

## Landmarks

Added 15 November 2026 (`56e20cb`). The IAU Gazetteer of Planetary Nomenclature (IAU WGPSN,
USGS Astrogeology; public domain per its metadata) gives 15,544 adopted names with coordinates on the 25 bodies the
explorer draws (Moon 9,087, Mars 2,055, Venus 1,985, Mercury 621, ...). `tools/Bake-Landmarks.mjs`
bakes the per-body centre-point downloads into `web/landmarks/<naif>.json` (1.5 MB in all; a
body's file loads when the eye is near it). Coordinates are planetocentric latitude and east
longitude, as the source metadata states for every body and as the maps and `jump_over` use.

- `SolarFlight.surface_markers` projects latitude/longitude pairs on the body's reference sphere
  with the indicators' camera: screen position, distance, and whether the point is in front, on
  screen and facing the eye. Relief is not considered: a label stands on the sphere.
- `web/landmarks.js` labels the nearest body's features (the Landmarks checkbox, or N) by
  prominence (size weighted by kind), only features over 22 px, within a screen-area budget
  (about 25 at 1280 x 720), without overlap. A click opens the gazetteer entry (type, size,
  coordinates, origin of the name, official link) with *Go there*.
- Checked headless at the time: Mars from 3,200 km and the Moon from 1,500 km; over Olympus Mons
  the 610 km gazetteer outline lies on the volcano's scarp in the Mars mosaic.

## Stellar travel

Five nearby star systems (Proxima Centauri, TRAPPIST-1, Tau Ceti, Epsilon Eridani, Kepler-186)
with 23 procedural worlds, defined in `crates/solar-core/src/galaxy.rs`. Their surfaces, sizes and
orbits are **synthetic** and the stars' distances approximate; the HUD says so for an exo world.
The panel's Star systems buttons, and its Views and worlds and Target lists (grouped by star), reach them. Go (or Fly) to a body around
another star is a hyperdrive jump into its orbit behind a short status overlay, which Escape or
Cancel stops before the jump; within a system Go is immediate (`77b7980`, 15 November 2026).

## The interface

16 November 2026, from the owner's brief ("We have 2 windows currently. The top right one is hiding the buttons to close the
left menu. I want to merge everything."). Before: a left panel and a separate solar HUD at the top right, which covered the
panel's Hide button at every desktop size (the layout check below found it at 1920 x 1080 and 1280 x 720), a header with a
tag line, a footer, and a soundtrack box at the top right. After:

- **One panel**, top left (`#explorer-controls`), with its collapse button in its own header (H still toggles; the choice is
  remembered). Sections by use: a link to the source repository, then the Soundtrack (Play / Pause, volume and what is
  playing, always in view at the top since 17 November 2026), Position (system, nearest body, height, frame, the notes on what is measured and what is
  not), Navigate (target; Face, Autopilot, Go, Land, Stop; Look and Fly until 16 November 2026), the landmark
  entry when one is open, Display (labels, orbits, landmarks, the two star switches, the asteroid belts' brightness), More
  places (the former Planet list, now "Views and worlds", and "Places on Earth"), then Quality, the detail sections folded
  away, Keys and gestures, and Support (a donation link and the Pinionfall engine source, then the author's X account
  and site, each opening its own tab).
- **One dock**, bottom centre (`#dock`): the time line, the flight readout and the credits. On wide screens it is narrowed
  so it never shares a column with the panel; where it must (narrow windows, touch layouts), the panel stops above it
  (`layout()` in `web/explorer.js`, measured on resize, on collapse and when the dock changes size, never per frame). On a
  touch screen where that would leave the panel under 300 px tall (a phone held sideways), the open panel is a sheet: the
  dock and the touch controls step aside until it closes, and a tap on the world closes it.
- **The time line**: the date and time (ISO 8601) in UTC or this device's zone (button; remembered), the Julian Date in TDB, the
  rate in words ("1 day per second", "paused", "real time"), and a strip centred on the clock with ticks that move with it.
  The strip spans 24 seconds of the clock (at least 20 minutes), with minor ticks at most 40 and labelled ticks at most 7
  across it, from seconds to centuries, and a dashed mark at the real present when it is in view. Dragging it moves the clock
  (held still while dragged, then running on at its rate); arrow keys on it step. Step buttons move by an hour, a day, a month
  or a year according to the rate; [ and ] do the same. Set... opens the date and time, local mean solar time on Earth and
  Local noon. Events (oppositions, eclipses) are left out: none is computed from the ephemeris yet, and none is hard-coded.
- **The flight readout**: throttle (the setting is the terminal speed at Earth's sea level on that thrust; the wheel changes it),
  speed against the nearest body, speed against its ground, height over its surface, the thrust's acceleration, Assist (Z) and a
  hold-to-brake button (X), and drag when there is any (free-flight share in its tooltip).
- **Numbers**: SI digit groups with a narrow no-break space; m, km, then au (the IAU 2012 B2 symbol) from 0.1 au, light-years
  from 0.1 ly; m/s, km/s, then fractions of c; m/s², km/s². The labels on the world use the same.
- **Touch**: on the solar page the stick, the up/down and boost buttons, the throttle bar, drag-to-look and twist-to-roll now
  reach the craft; before, only the mouse path did, so a phone could not look or thrust. The local explorer's mode button is
  hidden there (its Orbit mode hid the stick).
- **Text updates**: the position text and flight readout twice a second (with the page's existing stats tick), the clock's text
  at most four times a second, each as a text node rewritten only when it changes; the strip is a canvas redrawn per frame from
  the clock alone (its size from a ResizeObserver, so no layout is read per frame), and only when it would move by a fifth of a
  pixel.
- **Removed copy** (the owner's request): "Find your horizon.", "EXPLORER / 01", the introduction and the tag line. Renamed: Hide
  controls to the panel's own Hide/Panel button, Planet to Views and worlds, Destination to Places on Earth in the solar page,
  Begin descent to Descend to the ground, the soundtrack's buttons to Play / Pause. No control was removed.
- **Flight only** (owner, 16 November 2026: "we only want flight, I don't care about orbital camera"; then: drop Orbit and Walk
  everywhere). Removed: the Orbit / Fly / Walk buttons and their keys O, F, G on the local pages, the touch mode button, and
  Descend to the ground (it ended in Walk). Those controls are no longer in the page at all, so none shows during startup
  (before, the solar page hid them only once its own code had run). Save place and Saved places, the geological seed, body
  identity, the ground brush and Save / Load world are local-page controls, hidden in the page and shown only there. Renamed:
  Look to Face (T) and Fly to Autopilot (Y). Removed from the solar page: the Go to at once and Star systems chips, which
  repeated the Views and worlds list.
- **The opening view** (owner, 16 November 2026: "position us over wherever that person is opening the website from") is
  600 km over the main city of the visitor's time zone, as the browser reports it (`Intl`), from a table of about 90 zones in
  `web/home-zone.js`; a zone not listed falls back to the longitude of its UTC offset at 30 degrees north. No location
  permission is asked and no request is made: the time zone is all it reads. `?at=` and `?view=` keep their own starts.
  `tools/Test-Home-Place.mjs` (time zone overridden in a private headless browser): Sydney, Lisbon, Los Angeles and Tokyo start
  over their cities to 0.1 degree, an unlisted zone (Chatham) at its offset's longitude. The startup panel also says that the
  first launch compiles the GPU programs and can take a minute or more.
- **A tighter time line** (owner, 16 November 2026: it "could be tighter (smaller), it's taking up a lot of space", and on a
  phone "it is literally in the center of the screen blocking our whole view"). One line where it fits: the date, time and
  zone, slower / pause / faster, the rate in words, the strip (24 px, was 34), Now, ⋯ and ▾; the step buttons, the zone
  switch, the Julian Date and Set fold behind ⋯ (More), whose panel also holds the date and time of day. About 38 px tall at
  1920 x 1080, against about 130 before. ▾ folds it to a chip at the top right with the clock and rate (remembered); on touch
  screens the HUD button does that instead, and there is no chip. Touch targets are 44 px. On touch, the button grid beside the
  stick is now up, down, Go (to the target; tap a label to pick one) and HUD, and the throttle bar is the stick's height
  (128 px, was 188): the boost (3×, a 16× thrust while held) and the + and − buttons went, the owner's choice, so the touch
  controls take the stick's height and the dock sits just above them in portrait (156 px from the bottom, was 232).

## The star model

16 November 2026. Every star is drawn by one shader function (`star` in `shaders/space.wgsl`) from numbers
`crates/solar-core/src/stars.rs` derives from a record; nothing star-specific is in the shader. Before this, every star was
a disk of one colour (18, 15, 10 in HDR units, quite orange), limb darkening 0.3 + 0.7 mu, and a fixed glare.

**Records.** One per star: spectral and luminosity class, effective temperature, radius and luminosity, each with its
source; a field the source does not give is absent, never filled. `RECORDS` in `stars.rs` (the Sun) and
`galaxy::STAR_RECORDS` (the five others). The panel says, for each star, whether its temperature is a catalogue value, derived
from its spectral class (Mamajek's mean dwarf sequence, version 2022.04.16, after Pecaut & Mamajek 2013), or a fallback (the
Sun's) when neither exists. Values were read from the sources named, on 16 November 2026.

| Star | Class | Teff | Radius (R☉) | Luminosity (L☉) | Source |
| --- | --- | --- | --- | --- | --- |
| Sun | G2V | 5772 K | 1 | 1 | IAU 2015 Resolution B3 (nominal values) |
| Proxima Centauri | M5.5Ve (Bessell 1991) | 2900 K | 0.141 | 0.00151 | Suárez Mascareño et al. 2025, A&A 700, A11, via the NASA Exoplanet Archive |
| TRAPPIST-1 | M7.5e (Gizis et al. 2000; no luminosity class given) | 2566 K | 0.1192 | 5.53e-4 | Agol et al. 2021, PSJ 2, 1, via the Archive |
| Tau Ceti | G8V (Keenan & McNeil 1989) | 5320 K | 0.793 | 0.45 | Korolik et al. 2023, AJ 166, 123 |
| Epsilon Eridani | K2V (Keenan & McNeil 1989) | 5039 K | 0.74 | not given | Baines & Armstrong 2012, ApJ 744, 138, as quoted by MacGregor et al. 2015 |
| Kepler-186 | M1V (Muirhead et al. 2012) | 3755 K | 0.523 | 0.055 | Torres et al. 2015, ApJ 800, 99, via the Archive |

Proxima's temperature in the Archive's composite (2900 K) is lower than older values (about 3050 K); Kepler-186's radius
differs by 10% between Torres et al. 2015 and Quintana et al. 2014. The drawn radii now follow the records: Proxima 0.154 to
0.141, TRAPPIST-1 0.119 to 0.1192, Tau Ceti 0.79 to 0.793 solar radii (a stated change of size). Distances are unchanged and
remain approximate.

**Colour.** Planck's law at the photosphere's temperature, integrated 360 to 830 nm against the CIE 1931 2° colour-matching
functions (the multi-lobe fit of Wyman, Sloan and Shirley 2013), then the XYZ to linear sRGB matrix (IEC 61966-2-1), the
display's primaries. A test holds the fit to the Planckian locus at 2856 K (CIE illuminant A, x 0.4476, y 0.4075) and 6500 K
(0.3135, 0.3237), both within 0.003. Surface brightness follows from the same integral, so a red dwarf is dim per unit area:
the Sun's disk centre keeps the former disk's luminance, 15.28 in the renderer's units, and every other star is scaled from it.

| Star | Teff | Centre, linear sRGB (HDR) | Luminance | Light on its planets, against the Sun's |
| --- | --- | --- | --- | --- |
| TRAPPIST-1 | 2566 K | 0.153, 0.065, 0.016 | 0.080 | 1.80, 0.81, 0.17 |
| Proxima Centauri | 2900 K | 0.405, 0.201, 0.068 | 0.235 | 1.63, 0.86, 0.27 |
| Kepler-186 | 3755 K | 2.21, 1.45, 0.82 | 1.56 | 1.33, 0.94, 0.52 |
| Epsilon Eridani | 5039 K | 9.52, 7.94, 6.78 | 8.19 | 1.08, 0.99, 0.84 |
| Tau Ceti | 5320 K | 11.95, 10.33, 9.39 | 10.61 | 1.05, 0.99, 0.91 |
| Sun | 5772 K (x 0.326, y 0.336) | 16.45, 14.98, 14.82 | 15.28 | 1, 1, 1 |

The light a star sheds on its planets takes its colour at equal luminance (the eye adapts to the brightness, not the hue): the
tint multiplies the direct light in the surface pass (terrain, scenery, water, clouds), the sky's colours, and the space pass
(bodies, rings, rocks). In Sol the tint is exactly 1.

**Limb darkening.** The quadratic law I(mu)/I(1) = 1 - a (1 - mu) - b (1 - mu)^2, per display channel:
- The Sun takes its measured profile: Neckel and Labs (1994, Solar Physics 153, 91), table I, rows 640.97 nm (red), the mean
  of 541.76 and 559.95 nm (green) and 457.345 nm (blue), fitted for mu from 0.12 to 1 (their fit leaves out the extreme limb).
  a = 0.401, 0.481, 0.610; b = 0.214, 0.211, 0.182; within 0.03 of their polynomials over that range (a test).
- Every other star takes a model: Eddington-Barbier on a grey atmosphere (T^4 = 3/4 Teff^4 (tau + 2/3); the intensity at mu
  is the Planck function where tau = mu), integrated per channel and fitted the same way (within 0.03 of the model). On the
  Sun the model is within 0.07 of Neckel and Labs, and darker at mid disk: at mu = 0.5 it gives 0.70, 0.67, 0.61 (red, green,
  blue) against the measured 0.75, 0.71, 0.65; at mu = 0.1, 0.45, 0.39, 0.32 against 0.45, 0.38, 0.29.

Neckel and Labs at mu = 0.1, 0.3, 0.5, 0.8: 457 nm 0.291, 0.488, 0.651, 0.868; 560 nm 0.389, 0.571, 0.713, 0.893; 641 nm
0.451, 0.619, 0.748, 0.907.

**Exposure.** From far away the disk is a bright point at the renderer's own scale. Once it is resolved, a camera metering on
it: below 0.5 degrees of angular radius the exposure E is 1; by 5 degrees E sets the disk centre's luminance to 1.3 (HDR
units, before the frame's exposure of 1.3), and log E ramps smoothly between (`star_exposure` in
`crates/solar-explorer/src/solar.rs`). E is never above 1, so a dim star stays dim. Only the star's own light takes it (disk,
glare, corona): no other body is darkened. The panel states the exposure in EV whenever it applies, and Display has a switch
("Meter on a star's disk") that turns it off, when the disk clips to white as before. A display model, not a measurement. A
first version adapted as the square root of the disk's share of the view; at 10 solar radii that still left the disk white.

**Glare and corona.** The glare is the eye's and the camera's: the former glow, now in the star's colour, the Sun's at its
former luminance, and reduced in proportion as another body hides the disk (the eye's view of the disk, already computed for
eclipses). The corona is the Sun's alone (no other star's is known): Baumbach's (1937) mean K and F corona,
I(rho) / I(centre) = 1e-6 (0.0532 rho^-2.5 + 1.425 rho^-7 + 2.565 rho^-17), in the form Allen (1947, MNRAS 107, 426, eq. 1)
gives, optically thin and as seen from far away. At about a millionth of the disk it shows only when the disk is covered. The
chromosphere and prominences are left out: in white light they do not show against the disk, and no honest model of their
shapes is at hand.

**Synthetic surface (labelled, switchable).** "Synthetic star surface" in Display, on by default; the panel's note for every
star says what it is. All of it is invented detail with measured statistics, not today's Sun:
- Granulation: 3D Worley cells of 1 Mm (Rincon and Rieutord 2018: "granulation (1 Mm)"), two generations each living one
  lifetime and crossfading. Lifetime 10 minutes (commonly given as 5 to 10; not checked against a primary source here). rms
  contrast 8 to 11.5% over a lifetime at disk centre (computed from the shader's pattern), against 7% observed at 630 nm
  through Hinode's optics and 14% unsmeared in simulations (Danilovic et al. 2008, A&A 484, L17); weaker toward the limb.
  Drawn only when a cell spans pixels: on a 1080p screen that is within about 0.1 solar radii of the surface. At a clock rate
  that runs a lifetime in a frame the pattern averages out to an even disk: strength 1 / sqrt(1 + (rate / 60 / 600)^2).
- Supergranular network: cells 30 granules across (30 Mm), bright faculae on their edges, seen toward the limb.
- Sunspots: a seeded set in the active latitudes (5 to 35 degrees), umbra 25% and penumbra 80% of the quiet photosphere in
  every channel, the umbra 0.42 of the spot's radius (Solanki 2003, A&ARv 11, 153: 20-30% and 75-85% of the quiet Sun's flux,
  wavelength-integrated, and r_u / r_p = 0.4-0.5). They turn with the star. There is no live sunspot feed.
- Other stars: the same model by temperature, radius and mass. Granule size scales with the pressure scale height, H ~ T / g,
  so as a fraction of the radius as Teff R / M (Proxima's are about 0.6 of the Sun's, as a fraction of its radius). The brief
  suggested larger granules for M dwarfs; the scale height says smaller, and that is what is drawn. Activity: M dwarfs (below
  3900 K) get three times the Sun's spot count, K dwarfs 1.5 times: a choice, labelled.

**Point stars.** The 906 Bright Star Catalogue points take their colour by the same rule (`tools/Bake-Stars.mjs`): the class
letter and subclass give a temperature by the dwarf sequence (the binary catalogue has no luminosity class, so a K0 giant is
read as a K0 dwarf, about 500 K too hot), and the blackbody at that temperature gives the colour, scaled so its largest
channel is 1 as before. Positions and magnitudes are unchanged bit for bit. `pack/solar/stars.bin` changed (same format and
size). The deployment's copy was uploaded again and is byte for byte this bake (checked over HTTPS on 16 November 2026).

### The Sun reworked: views, atmosphere, active regions (16 November 2026, later)

The owner: the Sun "looks absolute trash", no flares, circular spots, a hard cut flying at its surface with no corona; wanted the
familiar look with coronas "when we get closer", the far-to-near transition unnoticeable. Before: `docs/images/sun-2r.jpg`; the
captures of this rework and real SDO images from 16 November 2026 for comparison are kept on the development machine.

- **A bug, found first.** Granules were never drawn at any distance: `star()` gave the detail a pixel's footprint as the pixel's
  angle over the disk's angular radius, right only from far away; at 1.1 radii it overstated the footprint about tenfold, at 1.01
  radii a hundredfold, so cells never spanned the pixels the fade asks for. Now the footprint is the distance to the hit point
  times the pixel's angle. Granules show from about 1.2 radii in.
- **Two views** (Display, Stars). Familiar, the default (owner's choice): the disk as filtered pictures show it (an orange to
  gold ramp on brightness, in the manner of SDO/HMI continuum and solar-filter photographs), the chromosphere and prominences in
  H-alpha red, coronal loops in 171 Å gold, the corona compressed as eclipse pictures are (half the disk centre's light at 1.05
  radii, the 0.85 power of its brightness beyond) and not drawn over the disk; the panel says it is false colour. True colour: as
  before for the disk, and everything above it at its own level (the corona Baumbach's, chromosphere and prominences about 3e-5 and
  1e-5 of the disk centre, a choice of the order of eclipse photographs; loops not seen), so it shows only with the disk covered.
- **Corona**, every star (before: the Sun's only, analytic): a march along the ray in the angle from its point of closest approach,
  14 samples, through an electron density whose line integral is Baumbach's brightness, I/I0 = 1e-6 (0.0532 rho^-2.5 + 1.425
  rho^-7 + 2.565 rho^-17) (Allen 1947, eq. 1): 1e-6 (0.03043 r^-3.5 + 1.4514 r^-8 + 4.158 r^-18) per radius, each coefficient
  over sqrt(pi) Gamma((k-1)/2) / Gamma(k/2). So it is the cited profile from far away and correct from inside the corona, and the
  surface has no hard cut. Structure (synthetic, on the direction only, so every feature is radial): helmet streamers over active
  regions narrowing outward, dark polar holes with thin plumes, fine rays. Drawn to 28 radii, faded from 16 to 26; within 28 radii
  the star covers the screen.
- **Chromosphere**: an emission layer with a 1.5 Mm scale height (a choice in the range of the quiet chromosphere's), integrated
  analytically along the ray ahead of the eye (the grazing path sqrt(2 pi H) at the limb, H / mu over the disk), never thinner
  than half a pixel's footprint, so the rim does not alias; spicules as radial jets 0.5 Mm wide and 3 to 9 Mm tall, a direction
  noise that fades under a pixel. Not checked against a primary source: sizes are commonly quoted ones.
- **Active regions** drive the spots, plage, loops, filaments and flares: up to 12 seeded slots (7 times the star's activity),
  each a region living 20 to 60 days in the active latitudes (5 to 35 degrees), a bipolar pair tilted by a Joy's-law-like rule
  (half the latitude: a choice, not a fit), leader toward the equator. Spots: an irregular umbra (three harmonics), a penumbra of
  radial filaments (18 to 90 round the spot, averaged out under two pixels apart), a light bridge in a quarter of them, the umbra
  shifted toward the disk centre near the limb (the Wilson depression, by a quarter of the radius times the sine of the view angle,
  a choice); the umbra 25% and penumbra 80% on average (Solanki 2003). A leader, a follower and three pores per region. Plage round
  each, brighter toward the limb. They turn with the star; differential rotation is not modelled.
- **Prominences** are thin sheets in planes through the star's centre, found by intersecting the ray: one along each region's line
  between its polarities, three quiescent ones at 40 to 60 degrees; a ragged arched top, threads about 2 Mm apart that average out
  under three pixels, brighter seen edge-on (an optically thin sheet, capped at 12 times). Against the disk they dim it (filaments)
  and add a tenth of their light. **Loops**: an arcade of four tubes over each region, semicircles standing across the line
  between the polarities and spaced along it, found by the ray's closest approach to each (eight samples, then six round the
  nearest), never narrower than two pixels' footprint, their light kept as they widen and longer where the ray runs along a tube;
  at 30% against the disk. (A first version painted them where the ray crossed one plane: the owner saw flat 2D cards.)
- **Flares**: up to three in a region's first 20 days, each rising in about 6 minutes of clock and decaying with a 25-minute
  time constant; they brighten the region's loops 26 times and draw two bright ribbons either side of the polarity line (in
  true colour at 5%, a rare white-light flare). A fast clock flickers through them. Computed only where a pixel is near the
  region or its loops, for the frame cost.
- **At the surface.** The owner saw concentric rings at zero height: the eye's distance from the centre came from the
  eye-relative centre in metres (7e8 m, held to 64 m in single precision), and |o|^2 - 1 by subtraction collapsed. Now the eye's
  height and the hit come from the star's angular radius (computed in double precision on the CPU): c = cot^2(alpha), the hit by
  the stable root c / (b + sqrt(b^2 - c)), the limb's mu from the normal at the point met. From inside the chromosphere a ray
  looking up has the path H over the cosine to the zenith, not a grazing line; the corona's compressed light is held to 12% for
  rays heading straight out from the star (the owner: a grey sky "out of place"), and spicules are sparser and fainter (they
  showed as pink speckle along the horizon). Captured at 200 km and 20 m along the horizon and at 200
  m looking down: no rings.
- **Boiling.** A granule lives ten minutes, so at real time the surface hardly moves: the familiar view time-lapses granulation
  15 times (a granule lives 40 s; stated on screen; true colour keeps real time), the cells' warp drifts with that clock so they
  flow and split, and a finer octave (granules fragmenting, bright points in the lanes) shows where it spans four pixels. The
  familiar view also draws a mottle of 20 to 60 Mm cells drifting slowly (the network and plage as H-alpha and 304 A pictures
  show them), so the disk is not a smooth ball at any range. Its hue turns hot only well above the quiet disk, so detail
  changes brightness, not colour.
- **Cost** (RTX 3080, 1080p, High, `space` mark p50, interleaved runs against the start-of-session build, `tools/Trace-Flight.mjs`
  14 s, rows after 2 s): Sun at 2 radii 3.30 / 3.31 ms after against 1.42 / 1.41 before; 10 radii 3.00 / 3.01 against 1.45 /
  1.42; 1.01 radii (granules) 3.99 / 4.00 against 1.91 / 1.89. Whole frame there 3.35 to 4.05 ms GPU p50, far under 16.7. Earth
  hover: `space` 0.45 against 0.44, frame 41.0 ms p50 (40.9 to 45.2 across today's runs, noise). An earlier version cost 5.5 ms
  near the Sun; the corona's structure is now shaped at three points per ray instead of every sample, rays that pass above 1.2
  radii skip the prominences and loops, flares are computed only where used. The budget agreed was about 3 ms for the star and
  its atmosphere on High near the Sun: the star now costs about 1.6 to 2.1 ms more than before, so about 2.5 to 3 ms in all.
  After the last changes (surface geometry, time-lapse, finer octave, mottle), one run: `space` 3.38 ms at 2 radii, 3.08 at
  10, 4.30 at 1.01 (the finer octave, about +0.3 ms there); frame GPU p50 / p95 / p99 3.87 / 3.94 / 4.22, 3.57 / 3.64 / 3.78 and
  4.83 / 5.41 / 9.19 ms. With the loops as tubes, the darker sky and sparser spicules (the final state of this commit), on a
  quiet machine, interleaved new / before / new: `space` 4.33 / 1.43 / 4.33 ms at 2 radii, 4.01 / 1.42 / 4.00 at 10, 5.13 / 1.98
  / 5.12 at 1.01; frame GPU p50 4.38, 4.06 and 5.18 ms (p99 under 5.6). The tubes added about 1 ms even at 10 radii, where hardly
  a ray reaches them: most likely register pressure (each pixel holds 12 regions, about 156 floats, in a private array), not the
  work. **Over the agreed 3 ms budget by 1 to 2 ms.** The next step is to compute the active regions once per frame on the CPU
  and pass them in a buffer, which removes that array and the per-pixel hashing; not done yet.
- **Compile, cold** (body program, fresh profile each, `tools/Measure-Space-Compile.mjs`, three alternating rounds): 269 to
  574 ms before, 441 to 959 ms after; within that measurement's noise or slightly more.
- **Colour check** (true colour, `tools/Capture-Stars.mjs --view 0`): every star's disk centre within 1/255 of the model, as
  before.
- **Second pass (owner: "a really small scale bubbling lava like animated texture when very close to surface ... continually
  morphing (without creating repetitiveness)", and the cost).**
  - *Regions on the CPU.* The active regions are computed once a frame by the render worker (`space.rs` `star_regions`, the
    same model the shader had) for the star with the largest disk and read from a uniform (binding 15), instead of each pixel
    hashing twelve into a private array (most likely spilled: the cost had risen even where no ray reached the loops). Another
    star drawn at the same time gets no regions. `space` mark p50 after this pass, with everything below added: 2.33 ms at 2
    radii, 1.96 at 10, 2.64 at 1.01 (frame GPU p50 2.42, 2.12, 2.70; p99 2.72 at most), against 4.33, 4.01 and 5.13 before
    it and 1.43, 1.42 and 1.98 for the star before the rework. Within the agreed 3 ms.
  - *Boiling that follows the zoom.* Octaves below the granules, each a fifth the size of the one above, from 200 km down to
    metres: bright cells with dark rims, each crossfading through its own generations; drawn only from where its cells span a
    few pixels to where one fills the screen, so three or four are evaluated at any height and finer ones keep appearing on the
    way down. Smaller eddies turn over faster (the 2/3 power of size, capped at 1.6 s a turnover in the familiar view).
  - *Precision.* A single-precision point on the unit sphere resolves about 6e-8 of the radius (40 m on the Sun), so the fine
    octaves are counted from an anchor near the eye: the worker sends, from double precision, the eye's offset from a lattice
    point (1e-4 radii) and each octave's place in its cells modulo 4096; the shader adds the hit vector (small, precise) and
    uses a value noise that repeats every 4096 cells, so the pattern does not jump when the anchor steps.
  - *Lava.* In the familiar view, a domain-warped noise (a noise displaced by noises that drift with the clock) adds bright
    molten veins on and inside the granules, folding and never repeating. A display choice, labelled.
  - *Flares, time-lapsed in the familiar view* with the granulation: every region has a chance at a flare in each window of six
    granule lifetimes (4 min of real time), so somewhere one goes off every minute or two, rising in a few seconds and fading
    over about half a minute; the region's loop tubes brighten and its filament lifts as an eruption (to three times its
    height, three times brighter). True colour keeps the physical schedule.
- **Not done**: today's Sun. SDO and Helioviewer send no CORS headers (checked 16 November 2026), so a page cannot read their
  pixels into a texture: a live photosphere needs a proxy (a serverless function on the deployment or the owner's server) or a
  baked image in the pack, the owner's choice. Filters as separate views (H-alpha, EUV 304, 171) are folded into the familiar
  composite rather than offered one by one. The granulation's rms contrast was not re-measured after its rework.

### The Sun, third pass: spots, flares, relief (17 November 2026)

The owner, of the build above: "the sun spots look weird as well as the solar flares"; "I'm wondering if we couldn't just use
the 'water' sphere as a lava giving the surface of the sun actual geometric lava waves etc. to make it more believable". In
captures: each penumbra a fan of even stripes with a hard edge (a sticker); loop tubes as pale concentric arcs; a filament
sheet seen edge-on as a dead straight bright line; the corona from inside it a grid of blocks and right angles; a flat
surface with a perfect sphere for a horizon. Everything here is synthetic detail with cited sizes, labelled on screen with
the rest of the synthetic surface; none of it is today's Sun. Nothing here is new as a technique (see "Prior art" below).

- **Noise.** The star's smooth noise was a value noise, whose lattice showed wherever it was stretched: that was the grid in
  the corona. It is a gradient noise with a quintic blend now. Everything that used it shifts a little in texture.
- **Sunspots** (`sunspot`, `penumbra` in `shaders/space.wgsl`).
  - The penumbra is short fibres, not spokes: about 0.3 Mm across and 2.6 Mm long (Borrero and Ichimoto 2011, Living Rev.
    Solar Phys. 8, 4: filaments 0.2 to 0.3 arcsec wide in continuum images; Solanki 2003, A&ARv 11, 153: 0.3 to 0.6 arcsec
    wide, 0.5 to 2 arcsec long "or longer"; 1 arcsec is 0.725 Mm), each with its own length, width and brightness, a bright
    head at its inner end (the penumbral grains) and a dark core along its axis where it is wide enough on screen (Scharmer
    et al. 2002, Nature 420, 151; its widths could not be read, the paper being closed). They are laid out by sector round the
    spot, each sector with its own starting places, so no two neighbours end together (a first layout on rings drew arcs), and
    the whole is swirled a little. Bright fibres 0.78 to 1.05 of the photosphere, 0.52 between them, 0.80 on average and
    under a pixel (Solanki 2003: bright filaments 0.7 to 1.0, dark 0.3 to 0.7, penumbrae 75 to 85% of the quiet Sun).
  - Outlines are closed curves that wander (a noise taken round a circle), not circles with harmonics. The outer edge frays at
    a granule's scale; the umbra's edge is ragged at a fibre's.
  - The umbra is 20% of the photosphere in a large spot and up to 42% in a pore (Solanki 2003: 20 to 30%), with umbral dots
    (one to a cell of 0.55 Mm in four cells of ten, fewer toward the middle; estimates of their size run from 80 to 650 km in
    Solanki 2003) and, in a quarter of the spots over 4 Mm in radius, a curved, grained light bridge with a dark central
    line (Borrero and Ichimoto 2011, section 3.1.4). The bridge's width, 0.7 Mm, is a choice: no figure was found.
  - A life. A spot under about 3.5 Mm across is a pore and has no penumbra ("a pore usually starts to show penumbral
    structure once its diameter exceeds roughly 3.5 Mm", Solanki 2003: a rule of thumb from the 1960s, as he says); a young
    region's spots have not grown one yet; an old one's lose it in sectors. The region's age reaches the shader for this. The
    follower has a fragment beside it; five pores a region.
  - The umbra is still shifted toward the disk centre near the limb for its depression (the Wilson effect, 400 to 800 km in
    mature spots, Solanki 2003); the spots are not in the relief below.
- **Loops** (`region_loops`). Fourteen over a quiet region, each a curve in a plane of its own in the shape of a dipole's
  field line (r = L sin^2, cut 35 degrees from each end), with its own place along and across the line between the
  polarities, reach, height (most low, a few tall), lean, thickness (0.7 to 2.3 Mm: wider than the loops the sharpest
  extreme ultraviolet images resolve, most often about 0.55 Mm, Aschwanden and Peter 2017; a choice, so they span pixels)
  and brightness; brightest at the top, fainter the higher they reach. A model in the manner of a field, not a field
  extrapolation. Found by the ray's closest approach to each curve, as before.
- **A flare has a course**, timed by a phase (time since onset in decay times: 36 s of real time in the familiar view's
  time-lapse, 25 minutes in true colour) that the CPU works out with the regions (`space.rs` `region_flare`), so no pixel
  hashes for it. The standard two-ribbon picture (Carmichael 1964, Sturrock 1966, Hirayama 1974, Kopp and Pneuman 1976, as
  reviewed by Benz 2017, Living Rev. Solar Phys. 14, 2, who calls it "an oversimplification in most cases"):
  - the flash; two wavy ribbons with brighter kernels either side of the line between the polarities, which move apart;
  - an arcade of twenty-four hot loops whose feet are the ribbons, packed closer than they are thick so it reads as one
    corrugated arcade (eight even loops read as rungs), growing and then fading;
  - the filament over the region lifting to four times its height and thinning away, to form again later;
  - from the larger regions, an ejection: a ragged shell that leaves the surface small and grows through the corona (60
    degrees across at last; mean widths in coronagraphs are 41 to 47 degrees, about 60 with halo events, Webb and Howard
    2012, Living Rev. Solar Phys. 9, 3), full ahead and fading behind, with a dense core low inside it: the bright front and
    core of the three-part form (Illing and Hundhausen 1985, as reviewed there). The cavity is not drawn. Its top climbs 1.2
    radii a decay time and its density falls as the square of its distance: choices, set so it shows in the familiar
    view's compressed corona out to about ten radii. Measured ribbon speeds (3 to 15 km/s, Li and Zhang 2009) and ejection
    speeds (a mean near 490 km/s in LASCO, Webb and Howard 2012) are not what the time-lapse runs at.
- **Prominences are slabs.** A sheet with no thickness, seen edge-on, was a bright line across the disk. Each is now a slab
  4 Mm through (a choice) that wanders either side of its plane; the ray's stretch inside it is sampled at five points, so
  edge-on it is a soft dark band on the disk and from the side a sheet as before.
- **Relief** (`star_depth`, and the search in `star`). The owner approved relief inside the impostor over giving the Sun a
  surface pass and the water layer (16 November 2026): that would have needed the Sun as a paged body, rings reaching a
  horizon 16,700 km away, a wave source other than the repeating ocean cache, a hand-over from the impostor, and new
  programs to compile.
  - *What it is.* How far the surface lies below the sphere, as a function of the place on the sphere: a heightfield along
    the radius, with no overhangs (the decision AGENTS.md asks to be written down: prominences, loops and spicules are
    separate volumes over it; a heightfield is enough for a convecting surface seen from above it). The sphere is the level
    of the highest crests, so the eye is never under the ground it flies over. A granule is a dome that falls into a valley
    along its edge, of the same cells as its brightness, so a bright granule is a raised one; under the granules the
    boiling's cells sink at their dark rims.
  - *How deep.* The owner: "it should look cool yet fairly realistic". In the familiar view each scale sinks by a quarter of
    its own size: valleys 250 km deep between granules 1 Mm across, said on screen. True colour takes 0.4 of that, 100 km,
    the order of what is measured (the surface of unit optical depth is corrugated by about 35 km rms in granulation:
    Nordlund, Stein and Asplund 2009, Living Rev. Solar Phys. 6, 2).
  - *Its bound.* Every term is a clamped share of a fixed amplitude, so the depth lies between 0 and 0.3125 of a granule's
    width times the view's share: a bound by construction, and the floor of the layer the search works in.
  - *The search.* Each look at the depth costs about a quarter of a millisecond over a full screen (see the cost below), so
    they are few: where the ray enters, where it would land if the ground were level at the depth found there, then the
    crossing by their gaps; where the ray grazes, up to five more (the preset's `relief_steps`), spread toward the far end,
    shifted from pixel to pixel on the screen's own grid so the steps do not line up into terraces, and one more look at the
    crossing. **Not a conservative march**: a crest narrower than a step can be passed over, and the error is at most one
    step of the ray. A grazing ray that reaches the far side of the sphere still above the ground has passed over it, and
    sees past the star: the horizon has the relief's shape. None of it runs where the granules are under a pixel or the
    relief would move the picture by under half a pixel: on the Sun, beyond about 0.35 radii from the surface.
  - *Shading.* The slope along the ray's track tilts the surface toward or away from the eye, and the limb darkening is
    taken at the tilted surface's own angle: ground rising away from the eye is brighter, ground falling away darker.
    Looking straight down there is no such slope, as a glowing surface seen square-on shows none.
  - *Two things it needed.* The granules' cells are found among eight cells, not twenty-seven (each cell's point is held to
    the middle half of the cell, so the nearest is always among the eight); the pattern's mean stays 0.68 (measured on
    400,000 places). And near the eye a place is carried as whole cells plus the rest, from the CPU's double-precision
    anchor, because a single float's place on the sphere is good to 40 m on the Sun and the slope showed that as rings on the
    ground.
  - *Not in it.* Spots (their depression is still the umbra's shift); the flight's clearance, which is against the sphere;
    a conservative bound on what a step can miss.
- **Cost** (RTX 3080, 1080p, private headless browser, `tools/Trace-Flight.mjs` 12 s, rows after 2 s, two interleaved rounds of
  the build before this session and this one; `space` mark p50, then the whole frame's GPU p50 / p95 / p99 of the second
  round; High unless said):

  | Scene | `space` before | `space` now | Frame before | Frame now |
  | --- | --- | --- | --- | --- |
  | Sun from 10 radii | 2.02, 1.93 | 2.15, 2.20 | 2.09 / 2.31 / 3.60 | 2.49 / 2.55 / 2.61 |
  | Sun from 2 radii | 2.21, 2.38 | 2.65, 2.66 | 2.88 / 2.94 / 2.95 | 2.87 / 2.89 / 2.90 |
  | Sun from 1.01 radii, looking down | 2.83, 2.83 | 4.17, 4.14 | 2.90 / 2.92 / 3.16 | 4.32 / 4.64 / 4.72 |
  | 200 km over the Sun, looking along it (`sun-skim`) | 2.53, 2.58 | 5.83, 5.79 | 2.65 / 2.71 / 2.81 | 5.98 / 6.22 / 6.36 |
  | Earth hover | 0.45, 0.45 | 0.45, 0.45 | 38.96 / 41.75 / 43.06 | 39.41 / 42.36 / 43.50 |

  The frame "now" includes the picture's finish (bloom, lens flare, auto exposure: [HDR-FINISH.md](HDR-FINISH.md)). Presets, this
  build, one run each, `space` p50 at 1.01 radii and skimming: Ultra 4.15 and 5.81 ms, Medium (three more looks where the
  ray grazes instead of five) 4.16 and 5.32, Low (one more look, at three quarters of the resolution) 2.73 and 2.74.
  The owner had accepted 4 to 5 ms for the star near the Sun; skimming the surface is over that by about a millisecond.
  A first version of the relief looked at the depth a dozen times a pixel and cost 15.6 ms at 1.01 radii; measured with the
  preset's steps set to 0 and to 2, one look costs between a quarter and one millisecond over a full screen, which is why
  the search is as short as it is. With the relief off the star costs 3.05 ms there, half a millisecond less than before the
  cells went from twenty-seven to eight.
- **Compile, cold** (the body program, a fresh profile each, `tools/Measure-Space-Compile.mjs`, three alternating rounds): 1073,
  480 and 513 ms before this session; 2776, 1144 and 1131 ms now. About twice as long, on the first launch only.
- **Prior art.** Procedural star surfaces in real time are not new: SpaceEngine has drawn a procedural star surface since
  2011 and suppresses its granulation with distance (its devlogs of 4 March 2011 and 20 April 2017); Celestia uses image
  textures; noise-layered sun shaders are common on Shadertoy and in three.js tutorials. Relief found by a short search
  along the ray is parallax and relief mapping (Kaneko et al., ICAT 2001; Policarpo, Oliveira and Comba, I3D 2005;
  Tatarchuk, I3D 2006, with the survey of Szirmay-Kalos and Umenhoffer, Computer Graphics Forum 2008). No peer-reviewed paper on a real-time procedural Sun was found in a web search on 16 November 2026, which
  is an absence of search hits and nothing stronger. Nothing here is claimed as new.
- **Not done**: the spots are not in the relief; the flight's clearance is against the sphere, the crests' level, so the eye
  cannot go down into a valley; the ejection's cavity; a loop model from a field
  extrapolation; differential rotation; today's Sun (as above). The relief's search is not conservative. The granulation's
  rms contrast was computed for the pattern (0.33 times 0.30) but not measured on screen. Not timed on a phone.

### Evidence (16 November 2026)

Private headless Edge on the RTX 3080; base = 6c234ab served from an immutable snapshot, after = the snapshot of this work;
evidence kept on the development machine (not in the repository).

- **Layout** (`tools/Capture-UI.mjs`): before, the solar HUD covered `#toggle-ui` at every desktop size, and at phone sizes the
  HUD covered the panel's controls and the touch buttons (5 of 24 phone layouts clean). After: no overlap, every control on
  screen and hit at its own centre, at 2560 x 1440, 1920 x 1080 and 1280 x 720 (solar near Earth, at the Moon, during a
  hyperdrive jump, at 1 day per second, near the Sun, local Earth, procedural; panel open and collapsed) and at 390 x 844,
  844 x 390, 360 x 640 and 640 x 360 with touch emulation (portrait and landscape, panel open and collapsed).
- **Input** (`tools/Test-Game-Input.mjs`): 69 of 69 checks pass.
- **Canvas unchanged** (`tools/Compare-Builds.mjs`, paused clock, procedural views coast, forest, rocky, ground, clouds,
  horizon; display, shaded and water targets): identical, including the starlight tint (exactly 1 in Sol). The canvas size
  does not depend on the panel.
- **Frame cost** (`tools/Trace-Flight.mjs`, 14 s, rows t > 8 s, interleaved base, after, base, after):
  Earth hover GPU p50 46.7 / 44.5 ms before, 44.7 / 44.6 ms after (noise); the `space` mark 0.436 ms in all four.
  Sun filling the view (2 solar radii): `space` p50 / p95 / p99 0.92 / 0.95 / 0.96 and 0.98 / 1.07 / 1.07 ms before,
  1.22 / 1.26 / 1.26 and 1.27 / 1.32 / 1.32 ms after: the star model costs about 0.3 ms there. Sun at 10 radii: about 1.0 ms
  both (one base run read 0.48). Measured before two last changes (the metering target 0.7 to 1.3, the sunspot seed per
  star), neither of which changes the work per pixel. The interface's text changes at most four times a second; no per-frame
  layout read.
- **Compile, cold** (body program of `space.wgsl`, fresh profile each, `createRenderPipelineAsync`, three alternating rounds):
  255 to 554 ms before (median 492), 279 to 627 ms after (median 294): no change beyond the noise.
- **Colour check** (`tools/Capture-Stars.mjs`, disk centre against the model's centre radiance times the stated exposure,
  through the frame's tone curve, 0-255): Sun 209, 206, 205 against 209, 206, 205; Tau Ceti 210, 205, 202 against 210, 206,
  202; Epsilon Eridani 211, 205, 200 against 212, 205, 200; Kepler-186 217, 204, 181 against 218, 204, 181; Proxima 157,
  125, 81 against 157, 125, 81; TRAPPIST-1 113, 80, 43 against 113, 80, 43. A world of Proxima Centauri is lit by its
  star's tint (1.63, 0.86, 0.27 against the Sun's light): `docs/images/proxima-world.jpg`.
- **Exposure** as stated by the page: 1 at 1 au, 0.31 (1.7 EV) at 0.1 au, 0.085 (3.6 EV) from 10 and 2 radii.
- On screen, the frame's own tone curve (per-channel Reinhard, then gamma) compresses the limb's contrast.
- Checks: `tools/Check.ps1` and `tools/Check.ps1 -Gpu` pass.

## Animated travel

16 November 2026, the owner's brief: Go animates in about five seconds however far, ends where the jump ended (just past the
body's hover band, facing it) or over a landmark, Land at a landmark ends just over its ground, never through a body, smooth, on a
log scale, any flight input or Esc cancels. `crates/solar-core/src/trip.rs` (reference math, no renderer), driven by `SolarWorld`
(`start_trip`, `step_trip`) and the page's Go, Land, the Views and worlds menu and the landmark panel's Go there and Land. The
hyperdrive to other stars is unchanged.

- **Path.** A cubic Hermite spline through anchors that move with their bodies: the start (turning with its body when the craft was
  held in its band, else drifting at the craft's velocity and settling within a second), detour points, and the end (a circular
  orbit just past the hover band, sunlit side, as the jump; or a point on the turning body). The start's tangent leans out of its
  body by how near the craft is to it against the trip's length; the end comes in from straight above. Between two places on one
  body the path is a great circle with a climb of half the ground distance at its top, moving across by a smoothstep of the
  spline parameter: it rises before it moves off and stops moving across well before the end of the descent (a test: under 2 km
  over the end point, what is left across is under half the height), so a landing comes in from above, not across a slope. A
  first version moved across and down together and flew into the Matterhorn's flank when a finer page raised the ground.
- **Speed.** u(s) from psi(u) = ln(1 + alpha u) - ln(1 + beta (1 - u)), alpha and beta the spline's speed at its ends over the
  start's and the end's heights, stepped by a quintic smoothstep of real time and inverted in closed form: the distance covered
  grows and shrinks geometrically near the ends, with zero velocity and acceleration at both. The idea is van Wijk and Nuij's
  (2003, "Smooth and efficient zooming and panning"), simplified; their optimal path is not used.
- **Real and clock time.** The craft flies on real seconds in its frame (flight.rs), so the orbit anchor and the drift go by real
  time; anchors on a turning body and every body's place go by the clock. A first version ran the orbit anchor on the clock: at a
  week per second it arrived at the orbit speed times the rate and was flung out (found by the trace below; a test now holds the
  arrival speed to the circular speed within 1% at 1 and 604 800 s per second).
- **Bodies in the way.** The planner flies the trip at 96 points in time against every body of the system as a sphere: radius plus
  its air's top, Saturn's main rings' outer edge (136,775 km) for Saturn, shrunk within 2% of the start and the end. A sample inside
  one adds a detour point beside the body at 1.6 of that radius, perpendicular to the path, up to four times; what is still blocked
  is reported (`trip_state`), not hidden. 96 samples are not a proof: a body small enough to fall between two could be missed, so
  the trace measures the clearance actually flown. Tests: Earth orbit to Mars, Jupiter, Saturn, Neptune, Mercury, the Sun and the
  Moon at 1 and 86 400 s per second; from behind Mars to its sunlit orbit; from behind Jupiter to the point of Io facing it (one
  detour, never inside Jupiter's sphere and air); Earth to its far side.
- **Ground.** For a landmark, the page asks its terrain for the height at the place each frame once that body is the one in full
  detail (render-worker `probe`, the finest page there so far), and the end height follows it with a quarter-second time constant;
  before that, the ground under the eye weighted by exp(-distance / height). The craft is held 2 m over the ground under it whatever
  the path says. Land ends 30 m over the ground, Go over a landmark at its former jump height. Over the second half of a
  landmark trip, while that ground estimate still moves faster than 20 m/s (finer pages arriving), the trip slows to 15% of its
  pace, eased, for at most 4 s in all, so the end point settles before the eye gets there: on a cold cache the Matterhorn
  landing takes about 8 s.
- **Stop.** Any thrust, brake, roll or mouse look, Esc, Face, Autopilot or a jump ends the trip where it is, at rest against the
  nearest frame's body (turning with it inside its band).
- **Moving targets** are reached where they are at arrival at any clock rate. At a fast clock a start held by a turning body turns
  with it during the trip (once a second at a day per second), as a craft held there does: smoothness is the trip's own only at
  real time. Seen once at a week per second near Saturn: after a trip had ended in orbit, the craft was flung out (1e9 m/s) a
  few seconds later, which looks like the flight model's hand-over into a moon's frame at that clock rate (moons' apparent
  speeds are their true ones times the rate) rather than the trip; the same run before had stayed in orbit. Not investigated.

## Saturn's ring shadow

The ring sheet and the ring rocks both test the ray toward the Sun against the oblate spheroid
with Saturn's table radii (60,268 / 54,364 km, the figure the body pass draws): `oblate_shadow`
in `shaders/space.wgsl` (`bfe0edc`, 15 November 2026). Before, the sheet used a sphere and the
rocks a 58,000 km cylinder, which left a band about 2,000 km wide where the sheet was dark and the
rocks lit. The Sun's disk (a penumbra of tens of kilometres there) is not modelled.

## Not done

Exposed here rather than hidden. Listed so that no one has to discover them.

- The time line shows no events (oppositions, conjunctions, eclipses, transits): none is computed from the ephemeris yet,
  and none is hard-coded.
- Stars: the Bright Star Catalogue points read a giant as a dwarf of its class (no luminosity class in the binary); Epsilon
  Eridani's luminosity is not in its source and stays unknown; every star's spots, loops, flares, prominences and relief
  are a synthetic model, not today's Sun or any observed star ("The Sun, third pass").
- Eclipses and shadows between bodies, other than Saturn and its rings.
- Saturn, Uranus and Neptune have no real map. Deimos and Uranus's moons have no map. Mimas has none baked: its folder held
  no global mosaic that this listing could find.
- Giants have only their 1024 x 512 map close up, so Jupiter blurs near the cloud tops.
- No measured heights on Io, Europa, Ganymede, Callisto, Saturn's moons or Triton. Titan's topography is not used. All the relief
  on these is synthesized.
- Mars imagery is the 925 m colour mosaic and the Moon stops at level 6, about 212 m: a 232 m and a 100 m source are on hand or
  known.
- Ceres and Vesta are not bodies yet, though both have data and both are drawn as asteroids.
- A faint ring shows inside one lunar crater at 20 km, not looked into.
- The autopilot aims at the body, not along any particular path, and the autopilot's Land (on the nearest body, no landmark open) does not avoid a moon on the way. Go and Land at a landmark are animated trips that do ("Animated travel").
- **Packs are not in this repository**: 2.4 GB in 170 files as baked (Moon 1.7 GB, Mars 426 MB, Mercury
  127 MB), from 22 GB of source mosaics. The deployed app reads them from the owner's pack host (since 16 November 2026); a
  local build downloads them from the repository's release with `tools/Fetch-Packs.mjs` (README, "Data packs"). The pack
  host is a small shared server: one player's fine-page bursts reach 75-120 requests per second
  (measured against a local stand-in), and nothing yet limits them. Sources marked UNCONFIRMED in the ledger are not cleared to ship.
- **Not measured on a quiet machine: frame cost, p50/p95/p99 by stage, and the procedural static compare since these shaders
  changed.** The M1 gates remain to be rerun, with the owner's say-so.
## Per-body source ceilings — 9 November 2026

The baked manifest's `finest_level` now controls the visual streamer, CPU height field, shader
height/imagery filtering, and vehicle collision ceiling together. Previously it only reached the
collision path; rendering inherited Earth's source limits and Swiss imagery region. A newly selected
baked body starts with its guaranteed pinned levels (0–3), then learns its own ceiling before finer
demand. This preserves resident ancestor pages and cancels demand outside the source limits. Returning
to Earth restores its live-source limits and regional imagery. `stats().source_levels` exposes the
active limits and whether measured heights exist.

The imagery coordinate warp now follows the same page-border and arrival fade as the imagery read.
Procedural detail complements the served page spacing; the number of available source levels is not
treated as an Earth constant. The existing body-radius metric and material families remain in use.

`node tools/research/Audit-Planet-Data.mjs <report.json>` (development repository only) checks all 31 descriptors against local packs, pinned
file sizes/page counts and every finer level's six-face page inventory. At this checkpoint all 19
surface packs pass. Moon supplies level 6; Mars 5; Mercury and Europa 4; the other 14 baked packs stop
at 3. Earth additionally streams its live sources. A pack without measured heights still has
synthesized relief, not newly discovered topography. Seven solid bodies without packs (Deimos,
Mimas, Ariel, Umbriel, Titania, Oberon and Miranda) keep their existing orbital representations;
the Sun and four gas giants do not have terrain surface LODs.

Local evidence is under `evidence/local/lunar-shadow-boundary-2026-11-09/`: availability inventory,
stream cancellation/ancestor regression, 81 field-logic checks, native GPU audit, and private WebGPU
wide/close/stationary captures of all 18 baked non-Earth bodies. In those final fixtures every body
has zero failed/missing pages, zero outstanding requests, zero height-level deficit and pixel-identical
close images across 30 frozen stationary frames. These checks cover the data ceilings and stationary
stability, not every terrain coordinate or illumination angle. See SCENERY.md for the separately
attributed rock-shadow repair.

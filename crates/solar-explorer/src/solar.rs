//! The running solar system: clock, craft, frame hand-overs, and what each frame needs to draw. No
//! GPU here, so all of it runs natively under test. The page calls this every frame and hands the
//! packet to the render worker.
use solar_core::{
    body::{BodyDescriptor, BodyKind},
    celestial::{apply, orientation, system, Mat3},
    ephemeris::{SimTime, SUN},
    field::{add, dot, length, mul, normalized, sub, V3},
    flight::{advance, view_of, Controls, Craft, Ground, Report},
    galaxy::system_id,
};

/// A body gets the full surface pass when its disk is this wide, half-angle in radians. The far planet draws
/// clouds as well, so the surface pass need not start farther out for them. Between this and the renderer's own
/// 250 Mm camera bound, this is a judgement.
const FULL_DETAIL: f64 = 0.087;
/// The surface pass comes in over the disk's growth from FULL_DETAIL to this many times that: the same place on the way in and on the
/// way out, so the far planet and the surface are one thing at a given distance. A judgement, like FULL_DETAIL.
const BLEND_OVER: f64 = 1.6;
/// Left again at this fraction of the angle above: no flicker on the boundary.
const LEAVE_AT: f64 = 0.8;
const CAMERA_BOUND: f64 = 240e6;
/// A star's corona and glare are drawn out to this many radii (space.wgsl fades the corona out from 16 to 26).
const STAR_REACH: f64 = 28.0;
/// Packet layout. Fields, then a fixed number of doubles per body.
/// 33..36: the colour of the system star's light against the Sun's (stars.rs `tint`).
/// 36 and 37 carry incident daylight relative to Earth and the resolved-star display exposure.
pub const HEADER: usize = 38;
/// 36..39 per body carry the stellar view, clock and seed, or the two wind phase components
/// and body ID for giant atmospheres. The shader reads the w of its three axes rows.
pub const PER_BODY: usize = 39;
/// With the eye near Saturn's ring plane, these follow the bodies: the ring's axes in render axes (9), the eye in the ring's frame
/// (3, metres from Saturn), the Sun's direction in the ring's frame (3), and Saturn's equatorial and polar radii (2), so that
/// the rocks fall into the same oblate shadow as the sheet.
pub const RING_WORDS: usize = 17;
/// Rocks are drawn with the eye this close to the plane, and between these radii of it.
const RING_NEAR: f64 = 800e3;
const RING_RADII: [f64; 2] = [70e6, 140e6];

/// Project the two tangent lines of a bounding sphere on each view axis.
/// A sphere off axis projects to an offset ellipse, even with a circular orbit-facing disk.
fn body_rect(view: V3, radius: f64, aspect: f64, tan: f64) -> Option<[f64; 4]> {
    let [x, y, z] = view;
    if z + radius <= 0.0 {
        return None;
    }
    if z <= radius {
        // When the sphere crosses the eye plane the tangent interval is unbounded.
        // Reject it against the side planes before falling back to the full screen.
        let sx = tan * aspect;
        if x.abs() - z * sx > radius * sx.hypot(1.0) || y.abs() - z * tan > radius * tan.hypot(1.0)
        {
            return None;
        }
        return Some([4.0; 4]);
    }
    let denom = (z - radius) * (z + radius);
    let interval = |axis: f64, scale: f64| {
        let centre = axis * z;
        let span = radius * (axis * axis + denom).sqrt();
        let divisor = denom * scale;
        (
            ((centre - span) / divisor).max(-1.0),
            ((centre + span) / divisor).min(1.0),
        )
    };
    let (left, right) = interval(x, tan * aspect);
    let (bottom, top) = interval(y, tan);
    (left < right && bottom < top).then_some([
        (left + right) * 0.5,
        (bottom + top) * 0.5,
        (right - left) * 0.5,
        (top - bottom) * 0.5,
    ])
}

// Visible solar disk against one spherical body's angular disk. The partial
// phase uses planar circle overlap; full light/umbra are exact for these spheres.
use solar_core::stars::Photosphere;
fn sun_disk_visibility(separation: f64, radius: f64, sun: f64) -> f64 {
    if separation >= radius + sun {
        return 1.;
    }
    if radius >= separation + sun {
        return 0.;
    }
    if sun >= separation + radius {
        return 1. - (radius / sun).powi(2);
    }
    let d = separation;
    let a = ((d * d + sun * sun - radius * radius) / (2. * d * sun))
        .clamp(-1., 1.)
        .acos();
    let b = ((d * d + radius * radius - sun * sun) / (2. * d * radius))
        .clamp(-1., 1.)
        .acos();
    let lens = ((-d + sun + radius) * (d + sun - radius) * (d - sun + radius) * (d + sun + radius))
        .max(0.)
        .sqrt();
    (1. - (sun * sun * a + radius * radius * b - 0.5 * lens) / (std::f64::consts::PI * sun * sun))
        .clamp(0., 1.)
}

pub struct SolarWorld {
    pub craft: Craft,
    pub time: SimTime,
    pub rate: f64,
    /// The body in full detail, or zero. Follows the craft, not the renderer's state.
    pub wanted: i32,
    pub report: Report,
    pub ground: f64,
    /// A body the view is turning toward, or zero.
    pub looking_at: i32,
    sun_sent: V3,
    /// Magnitudes the belts are drawn above their true brightness. Zero is true, and shows nothing.
    pub belt_gain: f64,
    /// Real orbits, as Bake-Asteroids writes them, and those near enough to draw as rocks.
    asteroids: Vec<f32>,
    near: Vec<(usize, f64)>,
    scan: usize,
    trails: Vec<Trail>,
    /// The star model (crates/solar-core/src/stars.rs), once per star.
    photospheres: Vec<(i32, Photosphere)>,
    /// The photosphere's exposure, metered on a resolved star disk (`star_exposure`). Off: 1.
    pub star_adapt: bool,
    /// The synthetic granulation, network and sunspot layer, labelled on screen.
    pub star_detail: bool,
    /// The last exposure given to the system star's disk, for the display to state.
    pub star_exposure: f64,
    /// How stars are drawn: 0 visible continuum (default), 1 the composite of filtered views in false colour.
    pub star_view: u8,
    /// An animated trip under way (solar-core trip.rs): the craft is placed on its path, not flown.
    pub trip: Option<solar_core::trip::Trip>,
}
/// The photosphere's exposure: a camera metering on a star once its disk is resolved. Below STAR_METER_FROM of angular
/// radius the disk is a bright point at the renderer's own scale (E = 1); by STAR_METER_FULL, E sets the disk centre's
/// luminance to STAR_METER_TARGET (HDR units, before the frame's exposure); between, log E ramps smoothly. E never exceeds 1,
/// so a dim star stays dim per unit area. Only the star's own light (disk, glare, corona) takes it: no other body is darkened.
/// A display model, not a measurement; the page states the exposure whenever it applies.
pub const STAR_METER_FROM: f64 = 0.5 * std::f64::consts::PI / 180.0;
pub const STAR_METER_FULL: f64 = 5.0 * std::f64::consts::PI / 180.0;
pub const STAR_METER_TARGET: f64 = 1.3;
pub fn star_exposure(angular_radius: f64, centre_luminance: f64) -> f64 {
    let t =
        ((angular_radius - STAR_METER_FROM) / (STAR_METER_FULL - STAR_METER_FROM)).clamp(0.0, 1.0);
    let ramp = t * t * (3.0 - 2.0 * t);
    let full = (STAR_METER_TARGET / centre_luminance.max(1e-30)).min(1.0);
    full.powf(ramp)
}
/// A granule's lifetime, seconds. Commonly given as 5 to 10 minutes; ten is used, and was not checked against a primary
/// source here. The same for every star: no other star's is measured.
pub const GRANULE_LIFETIME: f64 = 600.0;
/// How much faster the familiar view runs the granulation than the clock: a granule lives 40 s at real time there.
pub const GRANULE_LAPSE: f64 = 15.0;
/// Samples of one orbit in a trail. A moon's cost more each, and it is seldom seen at a scale that shows the difference.
const TRAIL_PLANET: usize = 256;
const TRAIL_MOON: usize = 96;
/// One orbit's stored samples, against its parent, on a grid of whole steps, so that moving on costs only the new ones.
struct Trail {
    id: i32,
    parent: i32,
    step: f64,
    samples: std::collections::VecDeque<V3>,
    newest: i64,
    count: usize,
}
/// How a trail fades, from the Solar-System repository: all of the orbit faintly, and a sharp cubic rise over the last 30% of it.
/// How far a piece of orbit line may bend from straight, seen from the eye, in radians: about a third of a pixel.
const TRAIL_BEND: f64 = 3e-4;
const TRAIL_DEPTH: u32 = 14;
/// Stops refining here, short of what `space::MAX_TRAIL_POINTS` can hold, so that no whole line is ever dropped for it.
const TRAIL_REFINED_POINTS: usize = 10_000;
fn trail_alpha(age: f64) -> f64 {
    const TRAIL: f64 = 0.3;
    const BASE: f64 = 0.1;
    const PEAK: f64 = 0.9;
    if age >= TRAIL {
        return BASE;
    }
    let f = 1.0 - age / TRAIL;
    BASE + (PEAK - BASE) * f * f * f
}
/// The view closes this fraction of the angle to its target per second, and at least this many radians.
const TURN_RATE: f64 = 3.0;
const TURN_FLOOR: f64 = 0.05;
/// Scanned per frame, so a full pass of the catalogue takes under half a second at 60 Hz.
const ASTEROID_SCAN: usize = 2_000;
/// Rocks drawn as bodies. Nearest first.
const NEAR_ROCKS: usize = 8;
const AU: f64 = 1.495_978_707e11;
const GAUSS_CENTURY: f64 = 0.017_202_098_95 * 36_525.0;
impl SolarWorld {
    /// On a body's surface, or above it, looking along the horizon.
    pub fn new(start: SimTime, body: i32, height: f64) -> Self {
        let s = system();
        let radius = s.radius(body);
        let e = s.ephemeris.body(body).expect("a body in the table");
        let up = normalized(solar_core::celestial::apply_transpose(
            &orientation(&e.rotation, start),
            normalized([0.3, 0.6, 0.7]),
        ));
        let pole = solar_core::celestial::apply_transpose(
            &orientation(&e.rotation, start),
            [0.0, 1.0, 0.0],
        );
        let east = normalized(solar_core::celestial::cross(pole, up));
        let position = mul(up, radius + height);
        let velocity =
            solar_core::celestial::cross(solar_core::celestial::spin(&e.rotation, start), position);
        Self {
            craft: Craft::new(body, position, velocity, east, up),
            time: start,
            rate: 1.0,
            wanted: 0,
            report: Report::default(),
            ground: 0.0,
            looking_at: 0,
            sun_sent: [0.0; 3],
            belt_gain: 8.0,
            asteroids: Vec::new(),
            near: Vec::new(),
            scan: 0,
            trails: Vec::new(),
            photospheres: Vec::new(),
            star_adapt: true,
            star_detail: true,
            star_exposure: 1.0,
            star_view: 0,
            trip: None,
        }
    }
    fn trail_wanted(&self, id: i32, parent: i32, target: i32) -> bool {
        if system_id(id) != system_id(self.craft.frame) || id == system_id(id) {
            return false;
        }
        if parent == system_id(self.craft.frame) || id == target {
            return true;
        }
        // A moon's orbit shows when the eye is in its planet's system, as its indicator does.
        let frame = self.craft.frame;
        let frame_parent = system().ephemeris.body(frame).map_or(0, |b| b.parent);
        frame == parent || frame == id || frame_parent == parent
    }
    /// Orbit trails for this frame, in the same axes as the packet: four floats a point, eye-relative metres, then the kind in
    /// the whole part of the last (0 planet, 1 moon, 2 target) and how strongly it shows in the fraction. A last float of -1 ends a line.
    pub fn trail_points(&mut self, target: i32) -> Vec<f32> {
        let s = system();
        let e = &s.ephemeris;
        let t = self.time;
        let axes = if self.wanted != 0 {
            orientation(&e.body(self.wanted).expect("in table").rotation, t)
        } else {
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        };
        let mut out = Vec::new();
        let mut trails = std::mem::take(&mut self.trails);
        for b in e
            .bodies
            .iter()
            .filter(|b| system_id(b.id) == system_id(self.craft.frame))
        {
            if b.parent == b.id {
                continue;
            }
            if !self.trail_wanted(b.id, b.parent, target) {
                continue;
            }
            let at = match trails.iter().position(|r| r.id == b.id) {
                Some(i) => i,
                None => {
                    // The period from the orbit's size by vis-viva: its distance on one date would leave an eccentric orbit's line short or long.
                    let (r, v) = e.relative_state(b.id, b.parent, SimTime::default());
                    let gm = e.body(b.parent).map_or(1.0, |p| p.gm + b.gm);
                    let a = 1.0 / (2.0 / length(r) - dot(v, v) / gm);
                    let period = std::f64::consts::TAU * (a.powi(3) / gm).sqrt();
                    let count = if b.parent == system_id(self.craft.frame) {
                        TRAIL_PLANET
                    } else {
                        TRAIL_MOON
                    };
                    trails.push(Trail {
                        id: b.id,
                        parent: b.parent,
                        step: period / count as f64,
                        samples: Default::default(),
                        newest: i64::MIN,
                        count,
                    });
                    trails.len() - 1
                }
            };
            let trail = &mut trails[at];
            let k = (t.seconds() / trail.step).floor() as i64;
            // Going forward keeps what it has. A jump in time, or the clock moved back, starts over.
            let behind = k.saturating_sub(trail.newest);
            if trail.newest == i64::MIN || !(0..=trail.count as i64).contains(&behind) {
                trail.samples.clear();
                // One over: a whole orbit, or the line stops a piece short of its own body.
                trail.newest = k - trail.count as i64 - 1;
            }
            while trail.newest < k {
                trail.newest += 1;
                let when = SimTime::from_seconds(trail.newest as f64 * trail.step);
                // Before the table starts a planet's position only holds, so its line stops there. For Neptune and Pluto, that is short of a whole orbit.
                if b.parent != SUN || when.seconds() >= e.covered[0] {
                    trail.samples.push_back(e.smooth_position(b.id, when));
                } else {
                    trail.samples.push_back([f64::NAN; 3]);
                }
                if trail.samples.len() > trail.count + 1 {
                    trail.samples.pop_front();
                }
            }
            // Against the parent where it is now. The wobble left out of the samples is restored at the moving end, for the whole line.
            let (parent, _) = e.relative_state(trail.parent, self.craft.frame, t);
            let wobble = sub(e.local_state(b.id, t).0, e.smooth_position(b.id, t));
            let kind = if b.id == target {
                2.0
            } else if b.parent == system_id(self.craft.frame) {
                0.0
            } else {
                1.0
            };
            let total = trail.samples.len() as f64;
            let put = |point: V3, age: f64, out: &mut Vec<f32>| {
                let world = add(add(point, wobble), parent);
                let eye_relative = apply(&axes, mul(self.craft.position.minus(world), -1.0));
                out.extend_from_slice(&[
                    eye_relative[0] as f32,
                    eye_relative[1] as f32,
                    eye_relative[2] as f32,
                    (kind + trail_alpha(age) * 0.99) as f32,
                ]);
            };
            // One piece of line, from `a` to `b`, without `a`: bisected on the true orbit until no bend in it shows from the eye. The
            // cheap estimate from the orbit's curve keeps this from asking for positions anywhere the bend is already too small to see.
            let body_id = b.id;
            let radius = |p: V3| length(p).max(1.0);
            let eye_from = |p: V3| length(self.craft.position.minus(add(add(p, wobble), parent)));
            let piece = |from: (f64, V3, f64), to: (f64, V3, f64), out: &mut Vec<f32>| {
                let mut stack = vec![(from, to, 0u32)];
                while let Some((a, b, depth)) = stack.pop() {
                    let chord = length(sub(b.1, a.1));
                    let bend = chord * chord / (8.0 * radius(b.1));
                    let near = eye_from(b.1).min(eye_from(a.1)).max(1.0);
                    let refine = depth < TRAIL_DEPTH
                        && out.len() / 4 < TRAIL_REFINED_POINTS
                        && bend > TRAIL_BEND * near.min(eye_from(mul(add(a.1, b.1), 0.5)).max(1.0));
                    if refine {
                        let when = (a.0 + b.0) * 0.5;
                        let m = (
                            when,
                            e.smooth_position(body_id, SimTime::from_seconds(when)),
                            (a.2 + b.2) * 0.5,
                        );
                        stack.push((m, b, depth + 1));
                        stack.push((a, m, depth + 1));
                    } else {
                        put(b.1, b.2, out);
                    }
                }
            };
            let mut last: Option<(f64, V3, f64)> = None;
            for (i, point) in trail.samples.iter().enumerate() {
                if point[0].is_nan() {
                    continue;
                }
                let when =
                    (trail.newest - (trail.samples.len() - 1 - i) as i64) as f64 * trail.step;
                let here = (when, *point, 1.0 - i as f64 / total);
                match last {
                    Some(before) => piece(before, here, &mut out),
                    None => put(*point, here.2, &mut out),
                }
                last = Some(here);
            }
            let now = (t.seconds(), e.smooth_position(b.id, t), 0.0);
            match last {
                Some(before) => piece(before, now, &mut out),
                None => put(now.1, 0.0, &mut out),
            }
            out.extend_from_slice(&[0.0, 0.0, 0.0, -1.0]);
        }
        self.trails = trails;
        out
    }
    pub fn load_asteroids(&mut self, data: &[f32]) {
        self.asteroids = data.to_vec();
    }
    /// Stand off from a catalogued asteroid in the Sun's frame, on its sunlit side.
    pub fn jump_near_asteroid(&mut self, i: usize, standoff: f64) {
        if (i + 1) * 12 > self.asteroids.len() {
            return;
        }
        let centuries = self.time.seconds() / (36_525.0 * 86_400.0);
        let at = self.asteroid_at(i, centuries);
        let radius = f64::from(self.asteroids[i * 12 + 11].abs()) * 1000.0;
        let toward_sun = normalized(mul(at, -1.0));
        let side = normalized(add(toward_sun, [0.3, 0.4, 0.2]));
        let eye = add(at, mul(side, radius + standoff));
        self.craft = Craft::new(SUN, eye, [0.0; 3], mul(side, -1.0), [0.0, 0.0, 1.0]);
        self.near.clear();
        self.scan = i;
    }
    /// One asteroid's place against the Sun, ICRF, metres: the same two-body orbit the shader solves.
    fn asteroid_at(&self, i: usize, centuries: f64) -> V3 {
        let r = &self.asteroids[i * 12..i * 12 + 12];
        let (a, e, m0) = (f64::from(r[0]) * AU, f64::from(r[1]), f64::from(r[2]));
        // From a, not the stored rate: full precision for a rock the eye is close to.
        let n = GAUSS_CENTURY / f64::from(r[0]).powf(1.5);
        let m = (m0 + n * centuries) % std::f64::consts::TAU;
        let mut ea = m + e * m.sin();
        for _ in 0..6 {
            ea -= (ea - e * ea.sin() - m) / (1.0 - e * ea.cos());
        }
        let (x, y) = (a * (ea.cos() - e), a * (1.0 - e * e).sqrt() * ea.sin());
        std::array::from_fn(|k| f64::from(r[4 + k]) * x + f64::from(r[8 + k]) * y)
    }
    /// A slice of the catalogue each frame: rocks that would show a shape go on the near list.
    fn scan_asteroids(&mut self, eye: V3, centuries: f64) {
        let count = self.asteroids.len() / 12;
        if count == 0 {
            return;
        }
        for _ in 0..ASTEROID_SCAN.min(count) {
            let i = self.scan;
            self.scan = (self.scan + 1) % count;
            self.near.retain(|n| n.0 != i);
            let d = length(sub(self.asteroid_at(i, centuries), eye));
            let radius = f64::from(self.asteroids[i * 12 + 11].abs()) * 1000.0;
            // Angular size is what earns a place. A small rock passed close beats a big one far away.
            let size = radius / d.max(1.0);
            if size > 2e-5 {
                self.near.push((i, size));
            }
        }
        self.near.sort_by(|a, b| b.1.total_cmp(&a.1));
        self.near.truncate(NEAR_ROCKS * 2);
    }
    pub fn step(&mut self, controls: &Controls, dt: f64) {
        if self.trip.is_some() {
            self.step_trip(dt);
            return;
        }
        let s = system();
        let (t, report) = advance(
            s,
            &mut self.craft,
            controls,
            Ground {
                height: self.ground,
            },
            self.time,
            self.rate,
            dt,
        );
        self.time = t;
        self.report = report;
        self.turn_toward(dt);
    }
    /// A clock edit preserves the surface-relative pose and flight velocity.
    /// In free space the craft keeps its inertial state in its current frame.
    pub fn set_time(&mut self, time: SimTime) {
        let s = system();
        let body = s
            .ephemeris
            .body(self.craft.frame)
            .expect("craft frame in table");
        let position = self.craft.position.metres();
        if solar_core::flight::free_blend(length(position), s.radius(body.id), body.gm) < 1.0 {
            let before = orientation(&body.rotation, self.time);
            let after = orientation(&body.rotation, time);
            let carry = |v| solar_core::celestial::apply_transpose(&after, apply(&before, v));
            let ground_velocity = solar_core::celestial::cross(
                solar_core::celestial::spin(&body.rotation, self.time),
                position,
            );
            let next = carry(position);
            self.craft.velocity = add(
                carry(sub(self.craft.velocity, ground_velocity)),
                solar_core::celestial::cross(
                    solar_core::celestial::spin(&body.rotation, time),
                    next,
                ),
            );
            self.craft.attitude = solar_core::flight::look_rotation(
                carry(self.craft.forward()),
                carry(self.craft.up()),
            );
            self.craft.position = solar_core::celestial::Address::from_metres(next);
        }
        self.time = time;
    }
    /// The target's direction against the view, closed at a steady rate. It keeps following a moving body until
    /// the mouse takes over; the roll stays as it was.
    fn turn_toward(&mut self, dt: f64) {
        if self.looking_at == 0 {
            return;
        }
        let s = system();
        let (p, _) = s
            .ephemeris
            .relative_state(self.looking_at, self.craft.frame, self.time);
        let to = self.craft.position.minus(p);
        if length(to) < 1.0 {
            return;
        }
        let want = mul(normalized(to), -1.0);
        let forward = self.craft.forward();
        let axis = solar_core::celestial::cross(forward, want);
        let sin = length(axis);
        let angle = sin.atan2(dot(forward, want));
        if sin < 1e-9 {
            return;
        }
        let step = (angle * (TURN_RATE * dt).min(1.0)).max((TURN_FLOOR * dt).min(angle));
        let q = solar_core::flight::about(mul(axis, 1.0 / sin), step);
        self.craft.attitude =
            solar_core::flight::unit(solar_core::flight::product(q, self.craft.attitude));
    }
    /// Indicators: see `SolarFlight::markers`.
    pub fn markers(&self, width: f64, height: f64) -> Vec<f64> {
        let s = system();
        let e = &s.ephemeris;
        let tan = 30.0_f64.to_radians().tan();
        let aspect = width / height;
        let forward = self.craft.forward();
        let up = self.craft.up();
        let right = normalized(solar_core::celestial::cross(forward, up));
        let up = solar_core::celestial::cross(right, forward);
        let mut out = Vec::with_capacity(e.bodies.len() * 6);
        // Bodies that could hide another: what the eye is nearest to, as a sphere.
        let places: Vec<(i32, V3, f64)> = e
            .bodies
            .iter()
            .filter(|b| system_id(b.id) == system_id(self.craft.frame))
            .map(|b| {
                let (p, _) = e.relative_state(b.id, self.craft.frame, self.time);
                (
                    b.id,
                    mul(self.craft.position.minus(p), -1.0),
                    s.radius(b.id),
                )
            })
            .collect();
        for &(id, offset, radius) in &places {
            let distance = length(offset);
            let along = dot(offset, forward);
            let mut flags = 0.0;
            let (x, y) = if along > 0.0 {
                flags += 1.0;
                let x = (dot(offset, right) / along / (aspect * tan) + 1.0) * 0.5 * width;
                let y = (1.0 - dot(offset, up) / along / tan) * 0.5 * height;
                if (0.0..=width).contains(&x) && (0.0..=height).contains(&y) {
                    flags += 2.0;
                }
                (x, y)
            } else {
                // Behind the eye: the direction to turn, for an indicator at the screen's edge.
                (dot(offset, right), -dot(offset, up))
            };
            let dir = mul(offset, 1.0 / distance.max(1.0));
            let hidden = places.iter().any(|&(other, o, r)| {
                let t = dot(o, dir);
                other != id && t > 0.0 && t < distance && length(sub(o, mul(dir, t))) < r
            });
            if hidden {
                flags += 4.0;
            }
            let pixels = (radius / distance.max(radius)).asin().tan() / (2.0 * tan) * height;
            out.extend_from_slice(&[f64::from(id), x, y, pixels, distance, flags]);
        }
        out
    }
    /// Where named surface features fall on screen. `points` holds planetocentric latitude and east longitude in degrees,
    /// in pairs, on the body's reference sphere (s.radius: the same sphere and the same latitude and longitude axes as the
    /// body's map, jump_over). Per point: x, y (pixels), distance (metres), and flags: 1 in front of the eye, 2 on screen,
    /// 4 on the hemisphere facing the eye (above its horizon on the sphere; relief is not considered).
    pub fn surface_markers(&self, id: i32, points: &[f64], width: f64, height: f64) -> Vec<f64> {
        let s = system();
        let Some(body) = s.ephemeris.body(id) else {
            return Vec::new();
        };
        // Once per call, not per point: fixed_to_inertial's rotation.
        let rotation = orientation(&body.rotation, self.time);
        let tan = 30.0_f64.to_radians().tan();
        let aspect = width / height;
        let forward = self.craft.forward();
        let up = self.craft.up();
        let right = normalized(solar_core::celestial::cross(forward, up));
        let up = solar_core::celestial::cross(right, forward);
        let (p, _) = s.ephemeris.relative_state(id, self.craft.frame, self.time);
        let centre = mul(self.craft.position.minus(p), -1.0);
        let radius = s.radius(id);
        let mut out = Vec::with_capacity(points.len() * 2);
        for pair in points.chunks_exact(2) {
            let (lat, lon) = (pair[0].to_radians(), pair[1].to_radians());
            let fixed = [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()];
            let n = solar_core::celestial::apply_transpose(&rotation, fixed);
            let offset = add(centre, mul(n, radius));
            let along = dot(offset, forward);
            let mut flags = 0.0;
            let (mut x, mut y) = (0.0, 0.0);
            if along > 0.0 {
                flags += 1.0;
                x = (dot(offset, right) / along / (aspect * tan) + 1.0) * 0.5 * width;
                y = (1.0 - dot(offset, up) / along / tan) * 0.5 * height;
                if (0.0..=width).contains(&x) && (0.0..=height).contains(&y) {
                    flags += 2.0;
                }
            }
            if dot(n, offset) < 0.0 {
                flags += 4.0;
            }
            out.extend_from_slice(&[x, y, length(offset), flags]);
        }
        out
    }
    fn distance_to(&self, id: i32) -> f64 {
        let s = system();
        let (p, _) = s.ephemeris.relative_state(id, self.craft.frame, self.time);
        length(self.craft.position.minus(p))
    }
    /// The body to draw in full detail: the largest solid disk over its threshold, or the current
    /// one until it falls under its own, lower threshold.
    fn choose(&mut self) -> i32 {
        let s = system();
        let mut best = (0, 0.0);
        for b in s
            .ephemeris
            .bodies
            .iter()
            .filter(|b| system_id(b.id) == system_id(self.craft.frame))
        {
            let Some(d) = BodyDescriptor::of_naif(b.id) else {
                continue;
            };
            if d.kind != BodyKind::Solid {
                continue;
            }
            let distance = self.distance_to(b.id);
            if distance > CAMERA_BOUND {
                continue;
            }
            let angle = (d.radius / distance.max(d.radius)).asin();
            let threshold = if b.id == self.wanted {
                FULL_DETAIL * LEAVE_AT
            } else {
                FULL_DETAIL
            };
            if angle >= threshold && angle > best.1 {
                best = (b.id, angle);
            }
        }
        // Stay on the current body while another is only slightly larger.
        if self.wanted != 0 && best.0 != self.wanted && best.0 != 0 {
            let current = self.distance_to(self.wanted);
            if let Some(d) = BodyDescriptor::of_naif(self.wanted) {
                let angle = (d.radius / current.max(d.radius)).asin();
                if angle >= FULL_DETAIL * LEAVE_AT && best.1 < angle * 1.1 {
                    return self.wanted;
                }
            }
        }
        best.0
    }
    /// How much of the picture should be the surface pass, by how large the wanted body's disk is.
    fn surface_share(&self) -> f64 {
        let Some(d) = BodyDescriptor::of_naif(self.wanted) else {
            return 0.0;
        };
        let angle = (d.radius / self.distance_to(self.wanted).max(d.radius)).asin();
        let t = ((angle - FULL_DETAIL) / (FULL_DETAIL * (BLEND_OVER - 1.0))).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }
    /// The frame's packet, in the axes of the wanted body, or inertial axes with none.
    pub fn packet(&mut self, width: f64, height: f64) -> Vec<f64> {
        let wanted = self.choose();
        self.packet_in_frame(width, height, wanted)
    }
    /// A chase-camera offset must use the same render frame as the craft pose.
    /// Select once per frame, then build the offset camera's packet in those axes.
    pub fn packet_in_frame(&mut self, width: f64, height: f64, wanted: i32) -> Vec<f64> {
        let sun_id = system_id(self.craft.frame);
        let s = system();
        let e = &s.ephemeris;
        self.wanted = wanted;
        let identity: Mat3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        let axes = if self.wanted != 0 {
            orientation(&e.body(self.wanted).expect("in table").rotation, self.time)
        } else {
            identity
        };
        let eye = if self.wanted != 0 {
            view_of(s, &self.craft, self.wanted, self.time).eye
        } else {
            [0.0; 3]
        };
        let forward = apply(&axes, self.craft.forward());
        let up = apply(&axes, self.craft.up());
        // Toward the Sun from the body in full detail, every frame: holding it between steps would save rebuilding the shadow caches, but shows as the shading of a planet moving in jumps under a fast clock.
        let from = if self.wanted != 0 {
            self.wanted
        } else {
            self.craft.frame
        };
        let (to_sun, _) = e.relative_state(sun_id, from, self.time);
        let sun = apply(&axes, normalized(to_sun));
        self.sun_sent = sun;
        let mut out = vec![0.0; HEADER];
        out[32] = self.surface_share();
        out[0..3].copy_from_slice(&eye);
        out[3..6].copy_from_slice(&forward);
        out[6..9].copy_from_slice(&up);
        out[9] = f64::from(self.wanted);
        out[11..14].copy_from_slice(&self.sun_sent);
        for (i, row) in axes.iter().enumerate() {
            out[14 + 3 * i..17 + 3 * i].copy_from_slice(row);
        }
        out[23] = self.time.seconds();
        out[24] = width;
        out[25] = height;
        let tan = 30.0_f64.to_radians().tan();
        let aspect = width / height;
        let right = normalized(solar_core::celestial::cross(forward, up));
        let up_true = solar_core::celestial::cross(right, forward);
        let pixel = 2.0 * tan / height;
        // The eye's distance from the Sun, for what a far body's light is against adapted eyes.
        let eye_sun = self.distance_to(sun_id).max(1e6);
        let (sun_position, _) = e.relative_state(sun_id, self.craft.frame, self.time);
        let toward_sun = apply(
            &axes,
            normalized(mul(self.craft.position.minus(sun_position), -1.)),
        );
        let sun_angle = (s.radius(sun_id) / eye_sun).min(1.).asin();
        out[10] = 1.;
        let star = self.photosphere(sun_id);
        // Illumination relative to Earth under the Sun before photographic metering.
        out[36] = ((s.radius(sun_id) / 695_700_000.).powi(2)
            * (star.teff / 5772.).powi(4)
            * (149_597_870_700. / eye_sun).powi(2))
        .clamp(0.0001, 10000.);
        out[37] = 1.;
        out[33..36].copy_from_slice(&star.tint);
        let mut star_row = None;
        let mut rows: Vec<(f64, Vec<f64>)> = Vec::new();
        for b in e
            .bodies
            .iter()
            .filter(|b| system_id(b.id) == system_id(self.craft.frame))
        {
            let Some(d) = BodyDescriptor::of_naif(b.id) else {
                continue;
            };
            let (p, _) = e.relative_state(b.id, self.craft.frame, self.time);
            let offset = apply(&axes, mul(self.craft.position.minus(p), -1.0));
            let distance = length(offset);
            let figure = if d.kind == BodyKind::Giant {
                b.radii[0]
            } else {
                d.radius
            };
            let polar = if d.kind == BodyKind::Giant {
                b.radii[2]
            } else {
                d.radius
            };
            // Include bodies outside the view: their shadows still reach the eye.
            // Use the conservative solid core, matching surface shadowing's relief margin.
            if b.id != sun_id && distance > 0. && distance < eye_sun {
                let radius = (figure - d.relief_limit).max(1.);
                let angle = (radius / distance).min(1.).asin();
                let separation = (dot(offset, toward_sun) / distance).clamp(-1., 1.).acos();
                out[10] = out[10].min(sun_disk_visibility(separation, angle, sun_angle));
            }
            let is_star = d.kind == BodyKind::Star;
            let air = if is_star { None } else { d.atmosphere };
            let shell = air.map_or(0.0, |a| a.shell_height);
            let ring = if b.id == 699 {
                [74_658_000.0, 136_775_000.0]
            } else {
                [0.0, 0.0]
            };
            let bound = if is_star {
                figure * STAR_REACH
            } else {
                (figure + shell).max(ring[1])
            };
            let along = dot(offset, forward);
            let mut body_sun = [0.0; 3];
            let m = orientation(&b.rotation, self.time);
            let (sun_pos, _) = e.relative_state(sun_id, b.id, self.time);
            if b.id != sun_id {
                body_sun = apply(&m, normalized(sun_pos));
            }
            // A star's row carries its photosphere instead (space.wgsl `star`): the synthetic layer's strength, its activity
            // (negative: no corona model), the eye's view of the disk (filled in below), the granules' clock.
            if is_star {
                // A granule lives ten minutes: a clock that runs a lifetime in a frame shows their average, an even disk.
                let blur = 1.0
                    / (1.0
                        + (self.rate.abs() * self.granule_lapse() / 60.0 / GRANULE_LIFETIME)
                            .powi(2))
                    .sqrt();
                body_sun = [
                    if self.star_detail { blur } else { 0.0 },
                    if b.id == SUN {
                        star.activity
                    } else {
                        -star.activity
                    },
                    1.0,
                ];
            }
            let light = if is_star {
                (self.time.seconds() * self.granule_lapse() / GRANULE_LIFETIME).rem_euclid(4096.0)
            } else if b.id == sun_id {
                1.0
            } else {
                (eye_sun / length(sun_pos).max(1e6)).powi(2).min(32_768.0)
            };
            // Clip rectangle around the bound, with the Sun's glow and the point floor.
            let flag = match d.kind {
                BodyKind::Star => 1.0,
                BodyKind::Giant => 4.0,
                BodyKind::Solid => 0.0,
            };
            let pixel_floor = if is_star { 64.0 } else { 3.0 };
            let radius = bound.max(distance * (pixel_floor * pixel).min(1.57).sin());
            let Some(rect) = body_rect(
                [dot(offset, right), dot(offset, up_true), along],
                radius,
                aspect,
                tan,
            ) else {
                continue;
            };
            let mut row = Vec::with_capacity(PER_BODY);
            row.extend_from_slice(&rect);
            row.extend_from_slice(&offset);
            row.push(figure);
            row.push(polar);
            row.push(layer_of(b.id) as f64);
            row.push(flag);
            row.push((figure / distance.max(figure)).asin());
            row.extend_from_slice(&body_sun);
            row.push(light);
            // Fixed from render: body's fixed axes applied after undoing the render axes.
            for r in &m {
                let inverse = apply(&axes, *r);
                row.extend_from_slice(&inverse);
            }
            let exposure = if is_star && self.star_adapt {
                let angle = (figure / distance.max(figure)).asin();
                let centre =
                    0.2126 * star.centre[0] + 0.7152 * star.centre[1] + 0.0722 * star.centre[2];
                star_exposure(angle, centre)
            } else {
                1.0
            };
            if is_star {
                self.star_exposure = exposure;
                out[37] = exposure;
            }
            let none = ([0.0; 3], 0.0, [0.0; 3], 0.0);
            let star_air = (
                star.centre.map(|c| c * exposure),
                0.0,
                star.linear,
                star.granule,
            );
            let (scatter, h, beta, top) = air.map_or(if is_star { star_air } else { none }, |a| {
                (
                    a.scatter,
                    a.rayleigh_scale_height,
                    a.rayleigh_beta,
                    a.shell_height,
                )
            });
            row.extend_from_slice(&scatter);
            row.push(h);
            row.extend_from_slice(&beta);
            row.push(top);
            if is_star {
                row.extend_from_slice(&star.quadratic);
                star_row = Some(rows.len());
            } else {
                row.extend_from_slice(&ring);
                // The Sun's angular radius from this body, for the softness of what its rings cast.
                row.push(s.radius(sun_id) / length(sun_pos).max(1e9));
            }
            if is_star {
                row.extend_from_slice(&[
                    f64::from(self.star_view),
                    (self.time.seconds() / 86_400.0).rem_euclid(1000.0),
                    f64::from(b.id),
                ]);
            } else if d.kind == BodyKind::Giant {
                let phase =
                    (self.time.seconds() / (8.0 * 86_400.)).rem_euclid(1.) * std::f64::consts::TAU;
                row.extend_from_slice(&[phase.sin(), phase.cos(), f64::from(b.id)]);
            } else {
                row.extend_from_slice(&[0.0; 3]);
            }
            rows.push((distance, row));
        }
        // The glare goes with the share of the disk the eye sees: none in a total eclipse, where the corona shows.
        if let Some(i) = star_row {
            rows[i].1[14] = out[10];
        }
        // Rocks near enough to be more than points, in real places, as bodies with a synthesized shape.
        let (craft_sun, _) = e.relative_state(self.craft.frame, SUN, self.time);
        let eye_sun = self.craft.position.metres();
        let eye_sun = add(eye_sun, craft_sun);
        let centuries = self.time.seconds() / (36_525.0 * 86_400.0);
        self.scan_asteroids(eye_sun, centuries);
        let list: Vec<usize> = self.near.iter().take(NEAR_ROCKS).map(|n| n.0).collect();
        for i in list {
            let at = self.asteroid_at(i, centuries);
            let offset = apply(&axes, sub(at, eye_sun));
            let distance = length(offset);
            let radius = f64::from(self.asteroids[i * 12 + 11].abs()) * 1000.0;
            let along = dot(offset, forward);
            let angular = (radius / distance.max(radius)).asin();
            let Some(rect) = body_rect(
                [dot(offset, right), dot(offset, up_true), along],
                radius.max(distance * (3.0 * pixel).min(1.57).sin()),
                aspect,
                tan,
            ) else {
                continue;
            };
            let mut row = Vec::with_capacity(PER_BODY);
            row.extend_from_slice(&rect);
            row.extend_from_slice(&offset);
            row.push(radius);
            row.push(radius);
            row.push(i as f64 % 997.0);
            row.push(8.0);
            row.push(angular);
            // An inertial rock: its own axes are render axes, undone, and it does not turn yet.
            let sun_here = normalized(mul(at, -1.0));
            row.extend_from_slice(&apply(&axes, sun_here));
            row.push(
                (length(eye_sun).max(1e6) / length(at).max(1e6))
                    .powi(2)
                    .min(4.0),
            );
            for r in &identity {
                row.extend_from_slice(r);
            }
            row.extend_from_slice(&[0.0; 3]);
            row.push(0.0);
            row.extend_from_slice(&[0.0; 3]);
            row.push(0.0);
            row.extend_from_slice(&[0.0, 0.0, 0.0]);
            row.extend_from_slice(&[0.0; 3]);
            rows.push((distance, row));
        }
        out[27..30].copy_from_slice(&eye_sun);
        out[30] = self.belt_gain;
        let ring = self.ring_words(&axes);
        out[31] = ring.len() as f64;
        // Far to near: the layer's blend order.
        rows.sort_by(|a, b| b.0.total_cmp(&a.0));
        out[26] = rows.len() as f64;
        for (_, row) in rows {
            out.extend_from_slice(&row);
        }
        out.extend_from_slice(&ring);
        out
    }
    /// The familiar view time-lapses the granulation (a granule lives ten minutes, so at real time the surface hardly moves):
    /// stated on screen. True colour keeps real time.
    pub fn granule_lapse(&self) -> f64 {
        if self.star_view == 1 {
            GRANULE_LAPSE
        } else {
            1.0
        }
    }
    /// The star model for a star, computed once (it integrates Planck's law over the spectrum).
    pub fn photosphere(&mut self, id: i32) -> Photosphere {
        if let Some((_, p)) = self.photospheres.iter().find(|(i, _)| *i == id) {
            return *p;
        }
        let p = solar_core::stars::photosphere(id);
        self.photospheres.push((id, p));
        p
    }
    pub fn altitude_over(&self, id: i32) -> f64 {
        self.distance_to(id) - system().radius(id)
    }
    /// Speed against the frame's turning air or ground, m/s.
    pub fn ground_speed(&self) -> f64 {
        let s = system();
        let Some(b) = s.ephemeris.body(self.craft.frame) else {
            return 0.0;
        };
        let omega = solar_core::celestial::spin(&b.rotation, self.time);
        let v = solar_core::celestial::cross(omega, self.craft.position.metres());
        length(sub(self.craft.velocity, v))
    }
    /// Start an animated trip from where the craft is (see solar-core trip.rs). Replaces any trip under way.
    pub fn start_trip(&mut self, target: i32, end: solar_core::trip::End) {
        let s = system();
        if s.ephemeris.body(target).is_none() {
            return;
        }
        let body = s.ephemeris.body(self.craft.frame).expect("frame in table");
        let position = self.craft.position.metres();
        let held =
            solar_core::flight::free_blend(length(position), s.radius(body.id), body.gm) < 0.5;
        let clearance = if self.report.nearest == self.craft.frame {
            self.report.clearance
        } else {
            self.altitude_over(self.craft.frame)
        };
        self.trip = Some(solar_core::trip::Trip::new(
            s,
            target,
            end,
            self.time,
            self.rate,
            self.craft.frame,
            position,
            self.craft.velocity,
            self.craft.attitude,
            held,
            clearance,
        ));
        self.looking_at = 0;
        self.craft.landed = false;
    }
    /// The ground at a trip's end place, measured by the page's terrain for that direction.
    pub fn measure_trip_place(&mut self, ground: f64, dt: f64) {
        if let Some(trip) = self.trip.as_mut() {
            trip.measure_place(ground, dt);
        }
    }
    /// Stop a trip where it is: the craft at rest against its frame's body (turning with it inside its band).
    pub fn stop_trip(&mut self) {
        if self.trip.take().is_none() {
            return;
        }
        let s = system();
        let body = s.ephemeris.body(self.craft.frame).expect("frame in table");
        let position = self.craft.position.metres();
        let free = solar_core::flight::free_blend(length(position), s.radius(body.id), body.gm);
        let spin = solar_core::celestial::cross(
            solar_core::celestial::spin(&body.rotation, self.time),
            position,
        );
        self.craft.velocity = mul(spin, 1.0 - free);
    }
    /// The craft on the trip's path at its time: position, velocity (a 1/240 s difference along the path and the clock), attitude.
    /// Held at least 2 m over the ground the page reports under it on the body in full detail, whatever the path says.
    fn place_on_trip(&mut self, s_now: f64) {
        let sys = system();
        let Some(trip) = self.trip.as_ref() else {
            return;
        };
        const H: f64 = 1.0 / 240.0;
        let t = self.time;
        let real = trip.elapsed.min(trip.duration);
        let k = trip.time_scale();
        let p = trip.point_at(sys, s_now, t, real);
        let ahead = trip.point_at(
            sys,
            (s_now + k * H / trip.duration).min(1.0),
            t.advanced(self.rate * H),
            real + k * H,
        );
        let velocity = mul(sub(ahead, p), 1.0 / H);
        let attitude = trip.attitude(sys, s_now, t, p);
        let target = trip.target;
        let mut craft = Craft::new(target, p, velocity, [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]);
        craft.attitude = attitude;
        // Into the frame of the body the craft is near, as flight would have it.
        solar_core::flight::hand_over(sys, &mut craft, t, self.rate);
        if self.wanted != 0 && craft.frame == self.wanted && deepest_level_none(craft.frame) {
            let offset = craft.position.metres();
            let r = length(offset).max(1.0);
            let floor = sys.radius(craft.frame) + self.ground + 2.0;
            if r < floor {
                craft.position =
                    solar_core::celestial::Address::from_metres(mul(offset, floor / r));
            }
        }
        self.craft = craft;
    }
    fn step_trip(&mut self, dt: f64) {
        let s = system();
        self.time = self.time.advanced(self.rate * dt);
        let ground = self.ground;
        let wanted = self.wanted;
        let frame = self.craft.frame;
        let time = self.time;
        if let Some(trip) = self.trip.as_mut() {
            trip.advance(dt);
            if wanted != 0 && frame == wanted && frame == trip.target {
                let (p, _) = s.ephemeris.relative_state(frame, trip.target, time);
                let at = sub(self.craft.position.metres(), p);
                trip.observe_ground(s, at, ground, time, dt);
            }
        }
        let (fraction, done) = self
            .trip
            .as_ref()
            .map_or((1.0, true), |t| (t.fraction(), t.done()));
        self.place_on_trip(fraction);
        if done {
            self.trip = None;
        }
        self.report = solar_core::flight::survey(
            s,
            &self.craft,
            Ground {
                height: self.ground,
            },
            self.time,
            self.rate,
        );
    }
    /// The opening view moved over a place (degrees north and east): the same height and the same look along the horizon to the
    /// east as the default start, turning with the body.
    pub fn start_over(&mut self, id: i32, latitude: f64, longitude: f64, height: f64) {
        let s = system();
        let Some(e) = s.ephemeris.body(id) else {
            return;
        };
        let (lat, lon) = (latitude.to_radians(), longitude.to_radians());
        let m = orientation(&e.rotation, self.time);
        let up = normalized(solar_core::celestial::apply_transpose(
            &m,
            [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()],
        ));
        let pole = solar_core::celestial::apply_transpose(&m, [0.0, 1.0, 0.0]);
        let east = normalized(solar_core::celestial::cross(pole, up));
        let position = mul(
            up,
            solar_core::flight::flight_radius(s, id, up, self.time) + height,
        );
        let velocity = solar_core::celestial::cross(
            solar_core::celestial::spin(&e.rotation, self.time),
            position,
        );
        self.craft = Craft::new(id, position, velocity, east, up);
        self.trip = None;
        self.looking_at = 0;
    }
    /// Stand above a body with the Sun this many degrees over the horizon, looking along the ground toward it. For a look at
    /// shadows and horizons, where they are at their hardest.
    pub fn jump_low_sun(&mut self, id: i32, height: f64, elevation: f64) {
        let s = system();
        let body = s.ephemeris.body(id).expect("a body in the table");
        let (to_sun, _) = s.ephemeris.relative_state(system_id(id), id, self.time);
        let toward = solar_core::celestial::unit_or(to_sun, [1.0, 0.0, 0.0]);
        let side = normalized(solar_core::celestial::cross(toward, [0.2, 0.3, 0.9]));
        let (sin, cos) = elevation.to_radians().sin_cos();
        // The point whose zenith is `elevation` above the Sun's side of the horizon.
        let zenith = add(mul(toward, sin), mul(side, cos));
        let position = mul(
            zenith,
            solar_core::flight::flight_radius(s, id, zenith, self.time) + height,
        );
        let along = normalized(sub(toward, mul(zenith, dot(toward, zenith))));
        let view = normalized(add(along, mul(zenith, -0.12)));
        self.craft = Craft::new(
            id,
            position,
            solar_core::celestial::cross(
                solar_core::celestial::spin(&body.rotation, self.time),
                position,
            ),
            view,
            zenith,
        );
    }
    /// The ring's own axes in inertial space: its pole, and two that stay still while Saturn turns underneath. A rock's
    /// place is fixed in them, so that the field does not turn with the planet.
    fn ring_axes(&self) -> Mat3 {
        let s = system();
        let m = orientation(&s.ephemeris.body(699).expect("Saturn").rotation, self.time);
        let pole = m[1];
        let x = normalized(solar_core::celestial::cross(pole, [0.0, 0.0, 1.0]));
        let y = solar_core::celestial::cross(pole, x);
        [x, y, pole]
    }
    fn ring_words(&self, axes: &Mat3) -> Vec<f64> {
        let s = system();
        let (saturn, _) = s.ephemeris.relative_state(699, self.craft.frame, self.time);
        let ring = self.ring_axes();
        let eye = apply(&ring, self.craft.position.minus(saturn));
        let radius = (eye[0] * eye[0] + eye[1] * eye[1]).sqrt();
        if eye[2].abs() > RING_NEAR || !(RING_RADII[0]..=RING_RADII[1]).contains(&radius) {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(RING_WORDS);
        for row in &ring {
            out.extend_from_slice(&apply(axes, *row));
        }
        out.extend_from_slice(&eye);
        let (sun, _) = s.ephemeris.relative_state(SUN, 699, self.time);
        out.extend_from_slice(&apply(&ring, normalized(sun)));
        let radii = s.ephemeris.body(699).expect("Saturn").radii;
        out.extend_from_slice(&[radii[0], radii[2]]);
        out
    }
    /// Over a place on a body, latitude and longitude in degrees, looking north and down.
    pub fn jump_camera(&mut self, id: i32, eye: V3, forward: V3, up: V3) {
        let s = system();
        let inertial = |v: V3| solar_core::flight::fixed_to_inertial(s, id, v, self.time);
        let position = inertial(eye);
        let rotation = &s.ephemeris.body(id).expect("destination in table").rotation;
        let velocity = solar_core::celestial::cross(
            solar_core::celestial::spin(rotation, self.time),
            position,
        );
        self.craft = Craft::new(id, position, velocity, inertial(forward), inertial(up));
        self.looking_at = 0;
    }
    pub fn jump_over(&mut self, id: i32, latitude: f64, longitude: f64, height: f64) {
        let s = system();
        let (lat, lon) = (latitude.to_radians(), longitude.to_radians());
        let up = [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()];
        let north = [-lat.sin() * lon.sin(), lat.cos(), -lat.sin() * lon.cos()];
        let inertial = |v: V3| solar_core::flight::fixed_to_inertial(s, id, v, self.time);
        let (up, north) = (inertial(up), inertial(north));
        let forward = normalized(add(north, mul(up, -1.2)));
        self.craft = Craft::new(
            id,
            mul(
                up,
                solar_core::flight::flight_radius(s, id, up, self.time) + height,
            ),
            [0.0; 3],
            forward,
            up,
        );
        self.looking_at = 0;
    }
    /// Over a place on a body, facing its centre with north up: to see a whole disk at a known height.
    pub fn jump_facing(&mut self, id: i32, latitude: f64, longitude: f64, height: f64) {
        let s = system();
        let (lat, lon) = (latitude.to_radians(), longitude.to_radians());
        let up = [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()];
        let north = [-lat.sin() * lon.sin(), lat.cos(), -lat.sin() * lon.cos()];
        let inertial = |v: V3| solar_core::flight::fixed_to_inertial(s, id, v, self.time);
        let (up, north) = (inertial(up), inertial(north));
        self.craft = Craft::new(
            id,
            mul(
                up,
                solar_core::flight::flight_radius(s, id, up, self.time) + height,
            ),
            [0.0; 3],
            mul(up, -1.0),
            north,
        );
        self.looking_at = 0;
    }
    /// In the middle of the main belt, at rest against the Sun, looking along it.
    pub fn jump_belt(&mut self) {
        let pole = [0.0, -0.397_777_16, 0.917_482_06];
        let along = [0.0, 0.917_482_06, 0.397_777_16];
        self.craft = Craft::new(SUN, [2.75 * AU, 0.0, 0.0], [0.0; 3], along, pole);
        self.looking_at = 0;
    }
    /// Inside Saturn's rings, a little above the B ring, on the sunlit side, looking along them.
    pub fn jump_rings(&mut self, height: f64) {
        let s = system();
        let (sun, _) = s.ephemeris.relative_state(SUN, 699, self.time);
        let ring = self.ring_axes();
        let toward = apply(&ring, normalized(sun));
        let flat = normalized([toward[0], toward[1], 0.0]);
        let at = [flat[0] * 105e6, flat[1] * 105e6, height];
        let forward = normalized([-flat[1], flat[0], -0.06]);
        let back = |v: V3| solar_core::celestial::apply_transpose(&ring, v);
        self.craft = Craft::new(699, back(at), [0.0; 3], back(forward), ring[2]);
        self.looking_at = 0;
    }
    /// High above the plane of the planets, looking down at the Sun, for the shape of the system.
    pub fn jump_overview(&mut self, distance: f64) {
        // The pole of the ecliptic, in ICRF.
        let pole = [0.0, -0.397_777_16, 0.917_482_06];
        self.craft = Craft::new(
            SUN,
            mul(pole, distance),
            [0.0; 3],
            mul(pole, -1.0),
            [1.0, 0.0, 0.0],
        );
        self.looking_at = 0;
    }
    /// A circular orbit, over the sunlit side, facing the body with north up.
    pub fn jump_orbit(&mut self, id: i32) {
        let s = system();
        let body = s.ephemeris.body(id).expect("a body in the table");
        let radius = s.radius(id);
        let (to_sun, _) = s.ephemeris.relative_state(system_id(id), id, self.time);
        let toward = solar_core::celestial::unit_or(to_sun, [1.0, 0.0, 0.0]);
        let day = normalized(add(toward, [0.25, 0.3, 0.15]));
        // Just past the band: inside it the body holds a craft still, which is not an orbit.
        let position = mul(day, solar_core::flight::free_radius(radius, body.gm) * 1.01);
        let pole = solar_core::celestial::apply_transpose(
            &orientation(&body.rotation, self.time),
            [0.0, 1.0, 0.0],
        );
        let along = normalized(solar_core::celestial::cross(pole, day));
        let speed = (body.gm / length(position)).sqrt();
        self.craft = Craft::new(id, position, mul(along, speed), mul(day, -1.0), pole);
    }
    /// Fly with a location given as the eye's position on the frame body, keeping a bearing.
    pub fn jump_near(&mut self, id: i32, height: f64) {
        let s = system();
        let body = s.ephemeris.body(id).expect("a body in the table");
        let (to_sun, _) = s.ephemeris.relative_state(system_id(id), id, self.time);
        let toward = solar_core::celestial::unit_or(to_sun, [1.0, 0.0, 0.0]);
        let day = normalized(add(toward, [0.2, 0.3, 0.1]));
        let position = mul(
            day,
            solar_core::flight::flight_radius(s, id, day, self.time) + height,
        );
        self.craft = Craft::new(
            id,
            position,
            solar_core::celestial::cross(
                solar_core::celestial::spin(&body.rotation, self.time),
                position,
            ),
            mul(day, -1.0),
            solar_core::celestial::apply_transpose(
                &orientation(&body.rotation, self.time),
                [0.0, 1.0, 0.0],
            ),
        );
    }
}
fn deepest_level_none(id: i32) -> bool {
    solar_core::flight::deepest_level(id).is_none()
}
/// A body's layer in the map array: its order in the catalogue.
pub fn layer_of(id: i32) -> usize {
    solar_core::body::BODIES
        .iter()
        .position(|b| b.naif == id)
        .unwrap_or_else(|| {
            if id >= 10000 {
                32 + (id - 10000) as usize
            } else {
                0
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projected_body_bounds_contain_every_visible_ray_hit() {
        let tan = 30_f64.to_radians().tan();
        for aspect in [0.54, 1.0, 1.89, 4.5] {
            for (centre, radius) in [
                ([0.95, -0.85, 1.0], 0.64), // Mars partly below the viewport
                ([1.5, 0.2, 1.0], 0.85),    // ring extends past the right edge
                ([-0.65, 0.5, 0.2], 0.72),  // crosses the eye plane
                ([0.1, 0.4, -2.0], 0.5),
            ] {
                let rect = body_rect(centre, radius, aspect, tan);
                for row in 0..80 {
                    for col in 0..120 {
                        let x = (col as f64 + 0.5) / 60.0 - 1.0;
                        let y = (row as f64 + 0.5) / 40.0 - 1.0;
                        let ray = normalized([x * aspect * tan, y * tan, 1.0]);
                        let t = dot(centre, ray).max(0.0);
                        if length(sub(centre, mul(ray, t))) <= radius {
                            let [cx, cy, hx, hy] = rect.expect("visible body was culled");
                            assert!(hx >= 4.0 || ((x - cx).abs() <= hx && (y - cy).abs() <= hy));
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn eye_sunlight_covers_lit_umbra_and_penumbra() {
        assert_eq!(sun_disk_visibility(0., 0.1, 0.00465), 0.);
        assert_eq!(sun_disk_visibility(0.2, 0.1, 0.00465), 1.);
        assert!((0.49..0.51).contains(&sun_disk_visibility(0.1, 0.1, 0.00465)));
        let time = SimTime::from_seconds(847000000.);
        let (sun, _) = system().ephemeris.relative_state(SUN, 399, time);
        let axis = normalized(sun);
        for (side, expected) in [(1., 1.), (-1., 0.)] {
            let mut world = SolarWorld::new(time, 399, 0.);
            world.craft = Craft::new(
                399,
                mul(axis, side * 100e6),
                [0.; 3],
                [0., 0., 1.],
                [0., 1., 0.],
            );
            assert_eq!(world.packet(640., 360.)[10], expected);
        }
    }
    #[test]
    fn editing_time_preserves_surface_pose_and_velocity() {
        let s = system();
        for id in [399, 301, 499] {
            let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), id, 100.0);
            let up = normalized([0.3, 0.6, 0.7]);
            let forward = normalized(solar_core::celestial::cross(up, [0.0, 1.0, 0.0]));
            w.jump_camera(id, mul(up, s.radius(id) + 100.0), forward, up);
            w.craft.velocity = add(
                w.craft.velocity,
                solar_core::flight::fixed_to_inertial(s, id, mul(forward, 25.0), w.time),
            );
            let original = view_of(s, &w.craft, id, w.time);
            let relative = |w: &SolarWorld| {
                let rotation = &s.ephemeris.body(id).unwrap().rotation;
                apply(
                    &orientation(rotation, w.time),
                    sub(
                        w.craft.velocity,
                        solar_core::celestial::cross(
                            solar_core::celestial::spin(rotation, w.time),
                            w.craft.position.metres(),
                        ),
                    ),
                )
            };
            let velocity = relative(&w);
            for delta in [21600.0, -43200.0, 86400.0 * 180.0] {
                w.set_time(w.time.advanced(delta));
                let view = view_of(s, &w.craft, id, w.time);
                assert!(
                    length(sub(original.eye, view.eye)) < 1e-7,
                    "{id}: position changed"
                );
                assert!(
                    length(sub(original.forward, view.forward)) < 1e-12,
                    "{id}: heading changed"
                );
                assert!(
                    length(sub(original.up, view.up)) < 1e-12,
                    "{id}: roll changed"
                );
                assert!(
                    length(sub(velocity, relative(&w))) < 1e-9,
                    "{id}: flight velocity changed"
                );
            }
        }
    }
    #[test]
    fn a_surface_destination_starts_at_rest_against_its_ground() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 100.0);
        let up = normalized([0.3, 0.6, 0.7]);
        w.jump_camera(399, mul(up, 6_371_100.0), [1.0, 0.0, 0.0], up);
        let before = view_of(system(), &w.craft, 399, w.time);
        w.rate = 0.0;
        for _ in 0..600 {
            w.step(&Controls::default(), 1.0 / 60.0);
        }
        let after = view_of(system(), &w.craft, 399, w.time);
        assert!(
            length(sub(before.eye, after.eye)) < 0.05,
            "{} m drift",
            length(sub(before.eye, after.eye))
        );
    }
    #[test]
    fn near_a_body_it_is_wanted_and_far_away_nothing_is() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 400_000.0);
        let packet = w.packet(1920.0, 1080.0);
        assert_eq!(packet[9] as i32, 399);
        let eye = [packet[0], packet[1], packet[2]];
        assert!((length(eye) - 6_771_000.0).abs() < 1.0);
        w.jump_near(499, 300_000_000.0);
        let packet = w.packet(1920.0, 1080.0);
        assert_eq!(packet[9] as i32, 0);
        // Far from a body the eye is the origin of inertial axes.
        assert_eq!([packet[0], packet[1], packet[2]], [0.0, 0.0, 0.0]);
        w.jump_near(301, 500_000.0);
        let packet = w.packet(1920.0, 1080.0);
        assert_eq!(packet[9] as i32, 301);
        assert!(packet[26] >= 1.0);
    }
    #[test]
    fn the_rock_field_is_on_only_near_the_ring_plane() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 400_000.0);
        assert_eq!(w.packet(1920.0, 1080.0)[31] as usize, 0);
        w.jump_rings(150.0);
        let packet = w.packet(1920.0, 1080.0);
        assert_eq!(packet[31] as usize, RING_WORDS);
        let ring = &packet[packet.len() - RING_WORDS..];
        // The eye in the ring's frame: where it was put.
        assert!((ring[9].hypot(ring[10]) - 105e6).abs() < 1.0, "{ring:?}");
        assert!((ring[11] - 150.0).abs() < 1e-3);
        // Saturn's ground turning under it does not move the eye in this frame.
        w.rate = 1e5;
        w.time = w.time.advanced(1000.0);
        let later = w.packet(1920.0, 1080.0);
        let moved = &later[later.len() - RING_WORDS..];
        assert!(
            (moved[9] - ring[9]).abs() < 1000.0,
            "{} {}",
            moved[9],
            ring[9]
        );
    }
    #[test]
    fn a_trail_ends_on_its_body_and_goes_round_its_orbit() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 400_000.0);
        w.jump_near(499, 300_000_000.0);
        w.packet(1920.0, 1080.0);
        let points = w.trail_points(0);
        // Lines end with -1. Find Earth's, the third planet from the Sun in the table's order.
        let lines: Vec<&[f32]> = points.split_inclusive(|v| *v == -1.0).collect();
        assert!(lines.len() >= 9, "{}", lines.len());
        let line = lines[2];
        let last = &line[line.len() - 8..line.len() - 4];
        let (earth, _) = system().ephemeris.relative_state(399, 499, w.time);
        let eye = w.craft.position.metres();
        let expected = sub(earth, eye);
        let error = length(sub(
            [f64::from(last[0]), f64::from(last[1]), f64::from(last[2])],
            expected,
        ));
        assert!(
            error < 1e5 + expected[0].abs() * 1e-5,
            "Earth's line ends {error} m from Earth"
        );
        // Brightest at the body, faint at the far end, and about a full circle away from where it ends.
        assert!(last[3].fract() > 0.8);
        assert!(line[3].fract() < 0.15);
        let first = [f64::from(line[0]), f64::from(line[1]), f64::from(line[2])];
        let around = length(sub(first, expected));
        assert!(around < 1.5e10, "{around}");
        let positions = line.len() / 4 - 1;
        assert!(positions > 200, "{positions}");
        // A second call moves on from what it has, and gives the same line.
        let again = w.trail_points(0);
        assert_eq!(points.len(), again.len());
    }
    #[test]
    fn a_body_behind_another_is_marked_hidden() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 400_000.0);
        // Look from the far side of Earth from the Moon, near the ground: the Moon is under the horizon.
        let (moon, _) = system().ephemeris.relative_state(301, 399, w.time);
        let away = normalized(mul(moon, -1.0));
        let eye = mul(away, 6_371_000.0 + 1_000.0);
        w.craft = Craft::new(399, eye, [0.0; 3], moon, [0.0, 0.0, 1.0]);
        let m = w.markers(1920.0, 1080.0);
        let row = m.chunks(6).find(|r| r[0] == 301.0).unwrap();
        assert_eq!(row[5] as u32 & 4, 4, "{row:?}");
        // Straight above it, the Moon is in the clear.
        let eye = mul(normalized(moon), 6_371_000.0 + 1_000.0);
        w.craft = Craft::new(399, eye, [0.0; 3], moon, [0.0, 0.0, 1.0]);
        let m = w.markers(1920.0, 1080.0);
        let row = m.chunks(6).find(|r| r[0] == 301.0).unwrap();
        assert_eq!(row[5] as u32 & 4, 0, "{row:?}");
    }
    #[test]
    fn a_giant_or_the_sun_never_goes_to_the_surface_pass() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 599, 1_000_000.0);
        assert_eq!(w.packet(1920.0, 1080.0)[9] as i32, 0);
        w.jump_near(10, 2e9);
        assert_eq!(w.packet(1920.0, 1080.0)[9] as i32, 0);
    }
    #[test]
    fn a_star_is_metered_only_once_its_disk_is_resolved() {
        assert_eq!(star_exposure(0.00465, 15.28), 1.0);
        let close = star_exposure(0.1, 15.28);
        assert!((close * 15.28 - STAR_METER_TARGET).abs() < 1e-9);
        assert!(star_exposure(0.03, 15.28) < 1.0 && star_exposure(0.03, 15.28) > close);
        // A dim star is never brightened.
        assert_eq!(star_exposure(0.5, 0.235), 1.0);
    }
    #[test]
    fn the_packet_keeps_its_layout() {
        let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 400_000.0);
        let packet = w.packet(1920.0, 1080.0);
        let n = packet[26] as usize;
        assert_eq!(packet.len(), HEADER + n * PER_BODY + packet[31] as usize);
    }
    /// The owner saw the straight pieces of an orbit up close. From just over Earth, with its own line passing the eye, every point
    /// on a line must lie close to straight between its neighbours, as seen from the eye.
    #[test]
    fn no_bend_shows_in_an_orbit_line_from_close_by() {
        for height in [3e6, 1e8, 5e9] {
            let mut w = SolarWorld::new(SimTime::from_seconds(8.5e8), 399, 400_000.0);
            w.jump_near(399, height);
            let _ = w.packet(1920.0, 1080.0);
            let points = w.trail_points(0);
            assert!(
                points.len() / 4 < crate::space::MAX_TRAIL_POINTS,
                "{} points",
                points.len() / 4
            );
            let mut worst = 0.0_f64;
            for q in points.chunks_exact(4).collect::<Vec<_>>().windows(3) {
                if q.iter().any(|p| p[3] < 0.0) {
                    continue;
                }
                let v = |p: &[f32]| [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])];
                let (a, b, c) = (v(q[0]), v(q[1]), v(q[2]));
                // Where the middle one would be on the straight line from a to c, and the angle at the eye to where it is.
                let (la, lc) = (length(sub(b, a)), length(sub(c, b)));
                let straight = add(a, mul(sub(c, a), la / (la + lc)));
                let (x, y) = (normalized(b), normalized(straight));
                worst = worst.max(length(sub(x, y)));
            }
            println!(
                "from {height} m: {} points, worst bend {worst} rad",
                points.len() / 4
            );
            assert!(worst < 2e-3, "from {height} m: {worst} rad");
        }
    }
}

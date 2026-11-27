//! Flight in a frame that hands over to the next body: thrust, drag, gravity with a hover assist,
//! coasting in space. With assistance on, every body holds a craft inside its gravity band as in
//! Planets, with or without air; with it off only real air drags. The shape is from the owner's Planets repository
//! (src/character/character-controller.ts); the numbers are not, since these bodies are true size.
//! What each term is, and which parts are assistance rather than physics: docs/SOLAR-SYSTEM.md.
//!
//! Time. The craft flies on real seconds. Bodies move on the clock, `rate` times faster. In a
//! body's frame nothing about the body's motion reaches the craft, so that frame holds at any rate.
//! A hand-over keeps what the eye sees: a body's velocity enters at `rate` times its true value,
//! because that is how fast it is crossing the sky. Air and ground turn with the body at its true
//! rate, and the spin the clock adds beyond that carries the craft rigidly in proportion to how
//! grounded it is. So at rate 1 this is plain mechanics, and at any rate the ground below a craft in
//! the air holds still instead of arriving as a wall of air at hundreds of km/s.
use crate::{
    celestial::{apply_transpose, cross, orientation, spin, Address, System},
    ephemeris::SimTime,
    field::{add, dot, length, mul, normalized, sub, V3},
};

/// Air as far as flight needs it. `None` on an airless body.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Air {
    /// Density at the reference radius, kg/m^3.
    pub density: f64,
    pub scale_height: f64,
    /// Above this the shell ends and the drag with it, metres.
    pub top: f64,
}
/// Sea-level density of Earth: the air the drag coefficient below is stated for.
pub const EARTH_DENSITY: f64 = 1.225;
/// Linear drag at Earth's sea level, per second. With thrust from the speed setting, a craft's
/// terminal speed at sea level is that setting, and it rises as the air thins.
pub const DRAG_AT_EARTH_SEA: f64 = 8.0;
impl Air {
    pub fn density_at(&self, height: f64) -> f64 {
        if height >= self.top {
            return 0.0;
        }
        let fade = ((self.top - height) / (0.2 * self.top)).clamp(0.0, 1.0);
        let fade = fade * fade * (3.0 - 2.0 * fade);
        self.density * (-height.max(0.0) / self.scale_height).exp() * fade
    }
    pub fn drag(&self, height: f64) -> f64 {
        DRAG_AT_EARTH_SEA * self.density_at(height) / EARTH_DENSITY
    }
}
/// Cloud-top numbers from the fact sheets, in docs/SOLAR-SYSTEM.md. `density` is at the reference
/// radius of the renderer's model of the body, which for a giant is the 1 bar level.
pub fn air_of(id: i32) -> Option<Air> {
    let air = |density, scale_height, top| {
        Some(Air {
            density,
            scale_height,
            top,
        })
    };
    match id {
        399 => air(EARTH_DENSITY, 8_000.0, 100_000.0),
        499 => air(0.020, 11_100.0, 125_000.0),
        299 => air(65.0, 15_900.0, 250_000.0),
        606 => air(5.3, 21_000.0, 600_000.0),
        999 => air(5.0e-5, 50_000.0, 400_000.0),
        599 => air(0.16, 27_000.0, 450_000.0),
        699 => air(0.19, 59_500.0, 900_000.0),
        799 => air(0.42, 27_700.0, 400_000.0),
        899 => air(0.45, 19_700.0, 300_000.0),
        _ => crate::galaxy::descriptor(id).and_then(|b| {
            b.atmosphere.map(|a| Air {
                density: EARTH_DENSITY,
                scale_height: a.rayleigh_scale_height,
                top: a.shell_height,
            })
        }),
    }
}
/// Bodies with no ground. The craft may fly in: the air thickens and the view closes, and this
/// depth below the reference level is as far as the model goes.
pub fn deepest_level(id: i32) -> Option<f64> {
    match id {
        10 | 10000 | 10100 | 10200 | 10300 | 10400 => Some(0.0),
        599 | 699 | 799 | 899 => Some(-150_000.0),
        _ => None,
    }
}
/// Decoupling begins at this fraction of surface gravity: r/R = 1.29 on every body (Planets).
const GROUNDED_BELOW: f64 = 0.6;
/// Fully free once gravity is this weak, m/s^2 (Planets `_flyFreeG`).
const FREE_BELOW: f64 = 1.0;
/// Groundedness: 0 grounded, 1 free. Rides real gravity, so it scales with mass and radius.
pub fn free_blend(r: f64, radius: f64, gm: f64) -> f64 {
    if radius <= 0.0 || gm <= 0.0 {
        return 1.0;
    }
    let surface = gm / (radius * radius);
    let here = gm / (r * r).max(1e-6);
    let start = GROUNDED_BELOW * surface;
    let free = FREE_BELOW.min(start * 0.5);
    if here >= start {
        return 0.0;
    }
    if here <= free {
        return 1.0;
    }
    let t = (here - free) / (start - free);
    1.0 - t * t * (3.0 - 2.0 * t)
}
/// Where a body's band ends and the craft is free: past this radius `free_blend` is 1.
pub fn free_radius(radius: f64, gm: f64) -> f64 {
    let start = GROUNDED_BELOW * gm / (radius * radius);
    (gm / FREE_BELOW.min(start * 0.5)).sqrt()
}
pub type Quat = [f64; 4];
pub fn rotate(q: Quat, v: V3) -> V3 {
    let u = [q[0], q[1], q[2]];
    let t = mul(cross(u, v), 2.0);
    add(add(v, mul(t, q[3])), cross(u, t))
}
pub fn product(a: Quat, b: Quat) -> Quat {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}
pub fn about(axis: V3, angle: f64) -> Quat {
    let (s, c) = (angle * 0.5).sin_cos();
    [axis[0] * s, axis[1] * s, axis[2] * s, c]
}
pub fn unit(q: Quat) -> Quat {
    let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}
/// A camera basis as a quaternion: -Z forward, +Y up.
pub fn look_rotation(forward: V3, up: V3) -> Quat {
    let z = mul(normalized(forward), -1.0);
    let x = normalized(cross(up, z));
    let y = cross(z, x);
    let (m00, m11, m22) = (x[0], y[1], z[2]);
    let trace = m00 + m11 + m22;
    let q = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        [
            (y[2] - z[1]) / s,
            (z[0] - x[2]) / s,
            (x[1] - y[0]) / s,
            s / 4.0,
        ]
    } else if m00 > m11 && m00 > m22 {
        let s = (1.0 + m00 - m11 - m22).sqrt() * 2.0;
        [
            s / 4.0,
            (y[0] + x[1]) / s,
            (z[0] + x[2]) / s,
            (y[2] - z[1]) / s,
        ]
    } else if m11 > m22 {
        let s = (1.0 + m11 - m00 - m22).sqrt() * 2.0;
        [
            (y[0] + x[1]) / s,
            s / 4.0,
            (z[1] + y[2]) / s,
            (z[0] - x[2]) / s,
        ]
    } else {
        let s = (1.0 + m22 - m00 - m11).sqrt() * 2.0;
        [
            (z[0] + x[2]) / s,
            (z[1] + y[2]) / s,
            s / 4.0,
            (x[1] - y[0]) / s,
        ]
    };
    unit(q)
}
#[derive(Clone, Copy, Debug)]
pub struct Craft {
    /// NAIF code of the body whose frame this is.
    pub frame: i32,
    pub position: Address,
    /// Against the frame's centre, inertial axes, metres per real second.
    pub velocity: V3,
    /// Camera to inertial.
    pub attitude: Quat,
    pub landed: bool,
    dive: f64,
}
impl Craft {
    pub fn new(frame: i32, position: V3, velocity: V3, forward: V3, up: V3) -> Self {
        Self {
            frame,
            position: Address::from_metres(position),
            velocity,
            attitude: look_rotation(forward, up),
            landed: false,
            dive: 0.0,
        }
    }
    pub fn forward(&self) -> V3 {
        rotate(self.attitude, [0.0, 0.0, -1.0])
    }
    pub fn up(&self) -> V3 {
        rotate(self.attitude, [0.0, 1.0, 0.0])
    }
    pub fn right(&self) -> V3 {
        rotate(self.attitude, [1.0, 0.0, 0.0])
    }
    /// Camera-local turn, as in web/flight.js.
    pub fn turn(&mut self, local_axis: V3, angle: f64) {
        self.attitude = unit(product(self.attitude, about(local_axis, angle)));
    }
    pub fn look(&mut self, dx: f64, dy: f64) {
        self.turn([0.0, 1.0, 0.0], -dx * 0.002);
        self.turn([1.0, 0.0, 0.0], -dy * 0.002);
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Controls {
    /// Camera axes: right, up, forward. Each in -1..=1.
    pub thrust: V3,
    /// The speed setting, m/s: terminal speed at Earth's sea level on that thrust.
    pub setting: f64,
    /// The boost key.
    pub boost: bool,
    /// Descend: drag down to 30%, hover assist off (Planets, C held).
    pub dive: bool,
    /// Thrust against the velocity relative to the body in view.
    pub brake: bool,
    pub roll: f64,
    /// Hover assist and approach limit. Off is plain mechanics.
    pub assist: bool,
    /// Fly to this body and stop this far above its reference radius: the same thrust and the same
    /// physics as a pilot has, only steered. No part of a trip is skipped.
    pub autopilot: Option<(i32, f64)>,
}
impl Default for Controls {
    fn default() -> Self {
        Self {
            thrust: [0.0; 3],
            setting: 100.0,
            boost: false,
            dive: false,
            brake: false,
            roll: 0.0,
            assist: true,
            autopilot: None,
        }
    }
}
/// What the world gives one step: the ground under the craft, from whichever field holds it.
#[derive(Clone, Copy, Debug, Default)]
pub struct Ground {
    /// Height above the reference radius at the craft's direction, metres. A coarser page answers
    /// until a finer one comes, as everywhere else in this renderer.
    pub height: f64,
}
/// Thrust grows with distance from the nearest surface, so one setting serves a hover and a trip to
/// Neptune. A pure rule of thumb: h'' = BETA h is an exponential with an e-fold of 1 / sqrt(BETA).
const THRUST_PER_METRE: f64 = 0.01;
const BOOST_THRUST: f64 = 16.0;
const THRUST_DISTANCE_LIMIT: f64 = 1e12;
/// No faster than this against the Sun with assistance on: 330 times light, which crosses to Neptune in under a minute.
const TOP_SPEED: f64 = 1e11;
/// Assistance turns back a craft this far out: 670 au, well past everything drawn.
const FARTHEST: f64 = 1e14;
/// Inside a band, thrust also pays for the drag up to this speed per metre of height, the same rate as out in space, or a craft
/// would take hours to climb out of a band that reaches several radii.
const BAND_CLIMB_PER_METRE: f64 = 0.1;
/// Speed against the nearest surface in any direction, per metre of height, with assistance on. A near miss at speed otherwise
/// leaves a craft curving round a marble, and crosses a band too fast for its drag to act.
const SPEED_PER_METRE: f64 = 1.0;
/// Approach limit: closing speed on the nearest surface in metres per second, per metre of height.
const CLOSING_PER_METRE: f64 = 0.5;
const CLOSING_FLOOR: f64 = 4.0;
/// How firmly the limit brakes, per second.
const CLOSING_FIRMNESS: f64 = 6.0;
const EYE_HEIGHT: f64 = 1.8;
/// Autopilot: wanted speed against the target per metre still to go, and how quickly it matches it.
const PILOT_SPEED_PER_METRE: f64 = 0.12;
const PILOT_RESPONSE: f64 = 0.5;
const LANDING_SPEED: f64 = 3.0;
const GROUND_FRICTION: f64 = 2.0;
const SETTLE_SPEED: f64 = 2.0;
/// How far past a frame's edge before the frame is handed up.
const HAND_UP: f64 = 1.02;
const STEP: f64 = 1.0 / 240.0;
#[derive(Clone, Copy, Debug, Default)]
pub struct Report {
    pub hand_overs: u32,
    /// Nearest surface.
    pub nearest: i32,
    pub clearance: f64,
    /// Velocity against the nearest body, as the eye sees it, metres per second.
    pub relative_speed: f64,
    pub free: f64,
    pub drag: f64,
    pub thrust: f64,
    pub landed: bool,
    pub touched: bool,
    pub substeps: u32,
}
/// `id` against `frame`, at the apparent velocity of this clock rate.
fn apparent(system: &System, id: i32, frame: i32, t: SimTime, rate: f64) -> (V3, V3) {
    let (p, v) = system.ephemeris.relative_state(id, frame, t);
    (p, mul(v, rate))
}
/// One-bar figure in this direction for the giants, reference sphere elsewhere.
pub fn flight_radius(system: &System, id: i32, direction: V3, t: SimTime) -> f64 {
    if matches!(id, 599 | 699 | 799 | 899) {
        system.figure_radius(id, direction, t)
    } else {
        system.radius(id)
    }
}

/// Nearest surface among the frame's body, its parent and its children.
fn nearest_body(system: &System, craft: &Craft, t: SimTime, rate: f64) -> (i32, V3, V3, f64) {
    let e = &system.ephemeris;
    let mut best = (
        craft.frame,
        craft.position.metres(),
        craft.velocity,
        f64::MAX,
    );
    let mut consider = |id: i32| {
        let (p, v) = apparent(system, id, craft.frame, t, rate);
        let offset = craft.position.minus(p);
        let clearance = length(offset) - flight_radius(system, id, offset, t);
        if clearance < best.3 {
            best = (id, offset, sub(craft.velocity, v), clearance);
        }
    };
    consider(craft.frame);
    let Some(i) = e.index(craft.frame) else {
        return best;
    };
    for &c in &system.children[i] {
        consider(e.bodies[c].id);
    }
    if e.bodies[i].parent != craft.frame {
        consider(e.bodies[i].parent);
    }
    best
}
fn reach_of(controls: &Controls) -> f64 {
    length(controls.thrust) + if controls.brake { 1.0 } else { 0.0 }
}
/// Above the main rings: the offset from their plane, the velocity against it, and the height over it.
fn ring_plane(system: &System, craft: &Craft, t: SimTime, rate: f64) -> Option<(V3, V3, f64)> {
    const RINGS: std::ops::Range<f64> = 74.6e6..136.8e6;
    let (place, velocity) = apparent(system, 699, craft.frame, t, rate);
    let offset = craft.position.minus(place);
    let distance = length(offset);
    if distance > RINGS.end * 2.0 {
        return None;
    }
    let body = system.ephemeris.body(699)?;
    let pole = orientation(&body.rotation, t)[1];
    let over = dot(offset, pole);
    let flat = (distance * distance - over * over).max(0.0).sqrt();
    RINGS
        .contains(&flat)
        .then(|| (mul(pole, over), sub(craft.velocity, velocity), over.abs()))
}
/// Advance real seconds `dt`, while the clock moves `rate * dt`. Returns the time reached.
pub fn advance(
    system: &System,
    craft: &mut Craft,
    controls: &Controls,
    ground: Ground,
    t: SimTime,
    rate: f64,
    dt: f64,
) -> (SimTime, Report) {
    let mut report = Report::default();
    let steps = ((dt / STEP).ceil() as u32).clamp(1, 16);
    let h = dt / f64::from(steps);
    let mut now = t;
    for _ in 0..steps {
        step(system, craft, controls, ground, now, rate, h, &mut report);
        now = now.advanced(rate * h);
        report.hand_overs += hand_over_as(system, craft, now, rate, controls.assist);
    }
    report.substeps = steps;
    report.landed = craft.landed;
    (now, report)
}
#[allow(clippy::too_many_arguments)]
fn step(
    system: &System,
    craft: &mut Craft,
    controls: &Controls,
    ground: Ground,
    t: SimTime,
    rate: f64,
    h: f64,
    report: &mut Report,
) {
    let e = &system.ephemeris;
    let body = e
        .body(craft.frame)
        .expect("the craft's frame is in the table");
    let offset = craft.position.metres();
    let r = length(offset).max(1.0);
    let up = mul(offset, 1.0 / r);
    let radius = if deepest_level(craft.frame).is_some() {
        system.figure_radius(craft.frame, offset, t)
    } else {
        system.radius(craft.frame)
    };
    let (near, mut near_offset, mut near_velocity, mut near_clearance) =
        nearest_body(system, craft, t, rate);
    // Height over the ground under the craft, not over the reference radius, which can be kilometres off on either side.
    if near == craft.frame && deepest_level(craft.frame).is_none() {
        near_clearance -= ground.height;
    }
    let mut over_rings = false;
    // Saturn's rings count as a surface: thrust and the approach limit go by the height over them, so that flying in slows the
    // craft enough for it to see them. Without this it crossed the whole field of rocks in under a second. The autopilot, going
    // through to somewhere else, is not held back, and with the assistance off nothing is.
    if controls.assist && controls.autopilot.is_none() {
        if let Some((over, velocity, height)) = ring_plane(system, craft, t, rate) {
            if height < near_clearance {
                near_offset = over;
                near_velocity = velocity;
                near_clearance = height;
                over_rings = true;
            }
        }
    }
    let free = free_blend(r, radius, body.gm);
    let height = r - radius;
    let surface_height = if deepest_level(craft.frame).is_some() {
        deepest_level(craft.frame).unwrap_or(0.0)
    } else {
        ground.height
    };
    let clearance = height - surface_height;

    // On the ground with no input the craft is part of the ground: held in the body's own frame,
    // so standing still on it cannot drift, at any clock rate.
    if craft.landed && reach_of(controls) == 0.0 && controls.autopilot.is_none() {
        // Through the orientation itself, not the spin: the Moon's prime meridian has periodic terms
        // of degrees, which a rate would slide the craft across.
        let before = orientation(&body.rotation, t);
        let after = orientation(&body.rotation, t.advanced(rate * h));
        let carry = |v: V3| apply_transpose(&after, crate::celestial::apply(&before, v));
        let n = crate::celestial::unit_or(carry(offset), up);
        let floor = radius + surface_height + EYE_HEIGHT;
        craft.position = Address::from_metres(mul(n, floor));
        craft.velocity = cross(spin(&body.rotation, t), mul(n, floor));
        craft.attitude = look_rotation(carry(craft.forward()), carry(craft.up()));
        report.nearest = craft.frame;
        report.clearance = EYE_HEIGHT;
        report.free = free;
        return;
    }
    // The roll key turns about the view axis.
    if controls.roll != 0.0 {
        craft.turn([0.0, 0.0, 1.0], -controls.roll * h);
    }
    // Thrust along camera axes.
    let (right, top, forward) = (craft.right(), craft.up(), craft.forward());
    let mut direction = add(
        add(mul(right, controls.thrust[0]), mul(top, controls.thrust[1])),
        mul(forward, controls.thrust[2]),
    );
    let reach = length(direction);
    if reach > 1.0 {
        direction = mul(direction, 1.0 / reach);
    }
    let base = controls.setting * DRAG_AT_EARTH_SEA;
    // The band's hold, as in Planets: all of it where gravity is at its surface strength, none where the craft is free. Assistance
    // only: the autopilot is steered with its own stop, and with assistance off a low orbit is a real one.
    let held = if controls.assist && controls.autopilot.is_none() {
        DRAG_AT_EARTH_SEA * (1.0 - free)
    } else {
        0.0
    };
    // Held down in deep space this rule alone is an exponential with no end, so the distance it reads stops growing.
    let scaled = (THRUST_PER_METRE + held * BAND_CLIMB_PER_METRE)
        * near_clearance.clamp(0.0, THRUST_DISTANCE_LIMIT);
    let mut force = base.max(scaled) * if controls.boost { BOOST_THRUST } else { 1.0 };
    if controls.brake {
        let relative = length(near_velocity);
        if relative > 0.0 {
            // Enough to stop this step at most, so a brake settles instead of ringing.
            force = force.min(relative / h);
            direction = mul(near_velocity, -1.0 / relative);
        }
    }
    let mut velocity = craft.velocity;
    if let Some((target, stop)) = controls.autopilot {
        // Steer on the velocity against the target. A wanted speed in proportion to the distance
        // left makes the approach an exponential, which cannot overshoot on a bounded thrust.
        let (place, target_velocity) = apparent(system, target, craft.frame, t, rate);
        let to = craft.position.minus(place);
        let distance = length(to);
        let target_radius = system.radius(target);
        let surface = if target == craft.frame {
            ground.height
        } else {
            0.0
        };
        let left = (distance - target_radius - surface - stop).max(0.0);
        let along = crate::celestial::unit_or(to, up);
        // With no stop height the pilot lands: it keeps a walking pace to the ground instead of slowing for ever.
        let floor = if stop <= 0.0 { LANDING_SPEED } else { 0.0 };
        let mut wanted = mul(along, -(PILOT_SPEED_PER_METRE * left).max(floor));
        // Climb out first when the way there lies through the body the craft is at.
        if craft.frame != target {
            let toward = mul(along, -1.0);
            let blocked = dot(toward, up) < 0.3;
            let close = (radius * 3.0 / r).powi(2).min(1.0);
            if blocked {
                let speed = length(wanted);
                wanted = mul(
                    crate::celestial::unit_or(add(mul(toward, 1.0 - close), mul(up, close)), up),
                    speed,
                );
            }
        }
        let relative = sub(craft.velocity, target_velocity);
        let need = sub(wanted, relative);
        let size = length(need);
        let limit = force.max(THRUST_PER_METRE * BOOST_THRUST * near_clearance.max(1000.0));
        if size > 0.0 {
            direction = mul(need, 1.0 / size);
            force = (size / PILOT_RESPONSE).min(limit);
        } else {
            force = 0.0;
        }
    }
    velocity = add(
        velocity,
        mul(direction, force * h * length(direction).min(1.0)),
    );

    // Dive intent, smoothed over about 150 ms (Planets).
    let down = (-dot(direction, up)).max(0.0);
    let target = if controls.dive { 1.0 } else { down };
    craft.dive += (target - craft.dive) * (4.0 * h).min(1.0);
    let dive = craft.dive;

    // The air turns with the body at its true rate: the drag is on velocity against it.
    let omega = spin(&body.rotation, t);
    let air_velocity = cross(omega, offset);
    let drag = air_of(craft.frame)
        .map_or(0.0, |a| a.drag(height.max(0.0)))
        .max(held);
    let drag_now = drag * (1.0 - 0.7 * dive);
    let fade = (-drag_now * h).exp();
    velocity = add(air_velocity, mul(sub(velocity, air_velocity), fade));

    // Gravity, and the hover assist that cancels only what the path's curve does not need: all of
    // it at rest, none of it at orbital speed. A giant's gravity holds under its reference level.
    let gravity = body.gm / r.max(radius).powi(2);
    let vertical = dot(velocity, up);
    let tangential = sub(velocity, mul(up, vertical));
    let centripetal = dot(tangential, tangential) / r;
    let hover = if controls.assist {
        (1.0 - dive) * (1.0 - free)
    } else {
        0.0
    };
    let effective = gravity - (gravity - centripetal).max(0.0) * hover;
    velocity = sub(velocity, mul(up, effective * h));

    // The approach limit: closing speed is bounded by height, so a fast arrival cannot pass through a surface in one step, and the
    // pilot sees it coming. It slows the whole velocity and keeps its direction, against the turning surface: taking off only the part
    // toward the surface left the rest to turn the course away, so a craft aimed at a planet slid round it. Speed in any direction
    // is bounded as well, or the pilot's own setting if that is more. Assistance, not physics.
    if controls.assist {
        let near_up = crate::celestial::unit_or(near_offset, up);
        let surface = if over_rings {
            [0.0; 3]
        } else {
            let rotation = &e
                .body(near)
                .expect("the nearest body is in the table")
                .rotation;
            cross(spin(rotation, t), near_offset)
        };
        let relative = sub(add(near_velocity, sub(velocity, craft.velocity)), surface);
        let height_left = near_clearance.max(0.0);
        let closing = -dot(relative, near_up);
        let closing_limit = (CLOSING_PER_METRE * height_left).max(CLOSING_FLOOR);
        let mut allowed = if closing > closing_limit {
            closing_limit / closing
        } else {
            1.0
        };
        if controls.autopilot.is_none() {
            let speed = length(relative);
            let boost = if controls.boost { BOOST_THRUST } else { 1.0 };
            let limit = (SPEED_PER_METRE * height_left).max(controls.setting * boost);
            if speed > limit {
                allowed = allowed.min(limit / speed);
            }
        }
        // A small moon that the clock rate carries past faster than this cannot be matched and must not drag the craft along.
        let carried = length(sub(craft.velocity, near_velocity));
        if allowed < 1.0 && (over_rings || near == craft.frame || carried <= closing_limit) {
            let cut = (1.0 - allowed) * (1.0 - (-CLOSING_FIRMNESS * h).exp());
            velocity = sub(velocity, mul(relative, cut));
        }
    }

    if controls.assist {
        let speed = length(velocity);
        if speed > TOP_SPEED {
            velocity = mul(velocity, TOP_SPEED / speed);
        }
        if craft.frame == crate::ephemeris::SUN && r > FARTHEST && dot(velocity, up) > 0.0 {
            velocity = sub(velocity, mul(up, dot(velocity, up)));
        }
    }
    // The spin the clock adds beyond the true one carries the craft rigidly, as far as it is
    // grounded; the attitude follows the whole spin that far, so the horizon holds.
    let extra = (rate - 1.0) * h * (1.0 - free);
    let spin_rate = length(omega);
    let mut position = craft.position;
    // A paused clock still needs the -1x correction: the velocity integrator
    // contains the body's true surface velocity even when its date is frozen.
    if spin_rate > 0.0 && h * (1.0 - free) != 0.0 {
        let axis = mul(omega, 1.0 / spin_rate);
        if extra != 0.0 {
            let q = about(axis, spin_rate * extra);
            let moved = rotate(q, offset);
            position = position.moved(sub(moved, offset));
            velocity = rotate(q, velocity);
        }
        let whole = about(axis, spin_rate * rate * h * (1.0 - free));
        craft.attitude = unit(product(whole, craft.attitude));
    }
    position = position.moved(mul(velocity, h));

    // Ground contact: the surface in its own turning frame. Slow enough, and it holds.
    craft.landed = false;
    let new_offset = position.metres();
    let new_r = length(new_offset).max(1.0);
    let floor = radius + surface_height + EYE_HEIGHT;
    if new_r < floor {
        let n = mul(new_offset, 1.0 / new_r);
        position = position.moved(mul(n, floor - new_r));
        let surface_velocity = cross(omega, mul(n, floor));
        let relative = sub(velocity, surface_velocity);
        let outward = dot(relative, n).max(0.0);
        let along = sub(relative, mul(n, dot(relative, n)));
        velocity = add(
            add(surface_velocity, mul(n, outward)),
            mul(along, (-GROUND_FRICTION * h).exp()),
        );
        craft.landed = outward == 0.0 && length(along) < SETTLE_SPEED;
        report.touched = true;
    }
    craft.position = position;
    craft.velocity = velocity;

    report.nearest = near;
    report.clearance = near_clearance.min(clearance);
    report.relative_speed = length(near_velocity);
    report.free = free;
    report.drag = if h > 0.0 { -fade.ln() / h } else { 0.0 };
    report.thrust = force * length(direction).min(1.0);
}
/// What the readout says about a craft placed by hand rather than flown (an animated trip): the nearest surface, the height over it
/// (over the ground under the craft on the frame's body) and the speed against it, as `advance` reports them.
pub fn survey(system: &System, craft: &Craft, ground: Ground, t: SimTime, rate: f64) -> Report {
    let (near, _, velocity, mut clearance) = nearest_body(system, craft, t, rate);
    if near == craft.frame && deepest_level(craft.frame).is_none() {
        clearance -= ground.height;
    }
    let body = system
        .ephemeris
        .body(craft.frame)
        .expect("the craft's frame is in the table");
    let r = length(craft.position.metres()).max(1.0);
    Report {
        nearest: near,
        clearance,
        relative_speed: length(velocity),
        free: free_blend(r, system.radius(craft.frame), body.gm),
        ..Report::default()
    }
}
/// Change frame where the craft has crossed a frame's edge. Position and the velocity the eye sees
/// are the same before and after, to the rounding of the numbers involved.
pub fn hand_over(system: &System, craft: &mut Craft, t: SimTime, rate: f64) -> u32 {
    hand_over_as(system, craft, t, rate, false)
}
/// With `sync`, as with assistance on, entering a body's frame also takes off what the clock alone was adding to the speed against it:
/// at rate 3600 a planet sweeps past at a hundred thousand km/s, and a craft it reaches would otherwise keep all of that, and be
/// through and gone. It takes whichever is the slower of the velocity against the body as the eye sees it and as it truly is. So a
/// craft sitting in space becomes one in the planet's frame at its true relative speed, a craft already moving with the planet keeps
/// that, and at rate 1 the two are the same. Position never changes. Going up to the parent stays continuous for the eye.
fn hand_over_as(system: &System, craft: &mut Craft, t: SimTime, rate: f64, sync: bool) -> u32 {
    let e = &system.ephemeris;
    let mut changes = 0;
    // At most a couple of levels can change in one step.
    for _ in 0..3 {
        let Some(i) = e.index(craft.frame) else {
            break;
        };
        let body = &e.bodies[i];
        let distance = length(craft.position.metres());
        if body.parent != body.id && distance > system.influence[i] * HAND_UP {
            let (p, v) = apparent(system, body.id, body.parent, t, rate);
            craft.position = Address {
                sector: craft.position.sector,
                offset: craft.position.offset,
            }
            .moved(p);
            craft.velocity = add(craft.velocity, v);
            craft.frame = body.parent;
            changes += 1;
            continue;
        }
        let mut entered = None;
        for &c in &system.children[i] {
            let child = &e.bodies[c];
            let (p, _) = apparent(system, child.id, craft.frame, t, rate);
            if length(craft.position.minus(p)) < system.influence[c] {
                entered = Some(child.id);
                break;
            }
        }
        let Some(child) = entered else {
            break;
        };
        let (p, v) = apparent(system, child, craft.frame, t, rate);
        craft.position = Address::from_metres(craft.position.minus(p));
        let seen = sub(craft.velocity, v);
        let (_, true_velocity) = apparent(system, child, craft.frame, t, 1.0);
        let truly = sub(craft.velocity, true_velocity);
        craft.velocity = if sync && length(truly) < length(seen) {
            truly
        } else {
            seen
        };
        craft.frame = child;
        changes += 1;
    }
    changes
}
/// What the renderer wants from the craft against one body, all in that body's fixed axes.
#[derive(Clone, Copy, Debug)]
pub struct View {
    pub eye: V3,
    pub forward: V3,
    pub up: V3,
    pub sun: V3,
}
pub fn view_of(system: &System, craft: &Craft, id: i32, t: SimTime) -> View {
    let e = &system.ephemeris;
    let body = e.body(id).expect("a body in the table");
    let m = orientation(&body.rotation, t);
    let (p, _) = e.relative_state(id, craft.frame, t);
    let eye = apply_m(&m, craft.position.minus(p));
    let (sun, _) = e.relative_state(crate::ephemeris::SUN, id, t);
    View {
        eye,
        forward: apply_m(&m, craft.forward()),
        up: apply_m(&m, craft.up()),
        sun: apply_m(&m, normalized_or(sun)),
    }
}
fn apply_m(m: &crate::celestial::Mat3, v: V3) -> V3 {
    crate::celestial::apply(m, v)
}
fn normalized_or(v: V3) -> V3 {
    crate::celestial::unit_or(v, [0.0, 1.0, 0.0])
}
/// A point on a body, its fixed axes, as an inertial offset from its centre.
pub fn fixed_to_inertial(system: &System, id: i32, fixed: V3, t: SimTime) -> V3 {
    let body = system.ephemeris.body(id).expect("a body in the table");
    apply_transpose(&orientation(&body.rotation, t), fixed)
}

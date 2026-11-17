//! An animated trip to a body or a place on it: about five seconds however far, on any clock rate, never through a body.
//! The owner's brief (16 November 2026): Go animates instead of jumping, ends where the jump ended (just past the body's hover
//! band, facing it) or over a landmark, or lands at one; smooth start and end; distance on a log scale; around anything in the way.
//!
//! The path is a cubic Hermite spline through anchors that move with their bodies: the start (carried with the start body: turning
//! with it when the craft was held by it, else drifting as the craft was moving, then settling), detour points beside a body that
//! would be in the way, and the end (a circular orbit, or a point fixed on the turning body). Every anchor is re-evaluated at the
//! clock's time each frame, so a moving target is reached where it is at arrival, and the craft leaves the trip with the velocity of
//! the end anchor (the orbit's, or the ground's), with no jolt. The start's tangent points out from its body when the craft is near
//! it, and the end's comes in from above the end point, so neither end body is crossed. Between two places on one body, the path is
//! a great circle with a climb over it.
//!
//! Speed. The spline parameter u follows psi(u) = ln(1 + alpha u) - ln(1 + beta (1 - u)), alpha = |P'(0)| / eps_a, beta = |P'(1)| /
//! eps_b, with eps the start's and the end's heights over their surfaces: near either end the distance covered then grows and
//! shrinks geometrically, one e-fold per equal step of psi. psi is stepped from psi(0) to psi(1) by a quintic smoothstep of real
//! time (zero velocity and acceleration at both ends), and inverted in closed form. This is the idea of van Wijk and Nuij (2003,
//! "Smooth and efficient zooming and panning", IEEE InfoVis), simplified: their optimal path is not used.
//!
//! Bounds. The planner checks the path it will fly, at 96 points in time, against every body of the system as a sphere: its radius,
//! plus its air's top where it has air, and for Saturn its main rings' outer edge (136,775 km) as a sphere. Within 2% of the start or
//! the end point that sphere is shrunk to let the craft leave or arrive. A sample inside a sphere adds a detour point beside the body,
//! at 1.6 of that radius, perpendicular to the path, up to four times; what is still blocked after that is reported, not hidden. The
//! samples are 96, so a body small enough to fall between two of them could be missed: that is not a proof of clearance, and the
//! page measures the clearance it actually flew (`clearance_to_bodies`).
use crate::{
    celestial::{apply_transpose, cross, orientation, unit_or, System},
    ephemeris::SimTime,
    field::{add, dot, length, mul, normalized, sub, V3},
    flight::{fixed_to_inertial, look_rotation, Quat},
};

/// How long a trip takes, real seconds.
pub const TRIP_SECONDS: f64 = 5.0;
/// Planning samples along the trip.
const SAMPLES: usize = 96;
const DETOURS: usize = 4;
/// A start anchor that was drifting settles over this many real seconds.
const SETTLE: f64 = 1.0;
/// Saturn's main rings' outer edge (the A ring, NSSDC ring fact sheet), metres.
const SATURN_RINGS: f64 = 136_775e3;

/// Where a trip ends.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum End {
    /// A circular orbit just past the body's hover band, over its sunlit side, facing it with north up (as the jump did).
    Orbit,
    /// Over a place on the body, `height` metres above its ground, looking straight down with north up.
    Over {
        latitude: f64,
        longitude: f64,
        height: f64,
    },
    /// Hovering `height` metres above the ground at a place, looking north over the horizon.
    Land {
        latitude: f64,
        longitude: f64,
        height: f64,
    },
}
#[derive(Clone, Copy, Debug)]
enum Anchor {
    /// A point fixed on a turning body, body-fixed axes.
    Fixed { body: i32, point: V3 },
    /// An inertial offset from a body's centre, drifting at `drift` m per real second and settling. The craft flies on real
    /// seconds in its frame (flight.rs), so this and the orbit go by real time, not the clock.
    Drifting { body: i32, offset: V3, drift: V3 },
    /// A circular orbit: radius times (cos w t + sin w t along), t in real seconds from the trip's start.
    Orbit {
        body: i32,
        radius: f64,
        day: V3,
        along: V3,
        omega: f64,
    },
    /// A landmark's ground point plus a height that follows the measured ground (`Trip::ground`).
    Place { body: i32, up: V3 },
}
fn body_of(a: &Anchor) -> i32 {
    match *a {
        Anchor::Fixed { body, .. }
        | Anchor::Drifting { body, .. }
        | Anchor::Orbit { body, .. }
        | Anchor::Place { body, .. } => body,
    }
}
fn smoother(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    x * x * x * (x * (x * 6.0 - 15.0) + 10.0)
}
/// Spherical interpolation of two unit vectors; falls back to a normalized lerp when they are nearly parallel.
fn slerp_v(a: V3, b: V3, t: f64) -> V3 {
    let c = dot(a, b).clamp(-1.0, 1.0);
    let angle = c.acos();
    if angle < 1e-6 {
        return unit_or(add(mul(a, 1.0 - t), mul(b, t)), a);
    }
    if std::f64::consts::PI - angle < 1e-6 {
        // Opposite: through any perpendicular.
        let p = unit_or(cross(a, [0.0, 0.0, 1.0]), [1.0, 0.0, 0.0]);
        let q = unit_or(cross(p, a), p);
        return add(mul(a, (angle * t).cos()), mul(q, (angle * t).sin()));
    }
    let s = angle.sin();
    add(
        mul(a, ((1.0 - t) * angle).sin() / s),
        mul(b, (t * angle).sin() / s),
    )
}
/// Quaternion slerp, the shorter way round.
pub fn slerp_q(a: Quat, b: Quat, t: f64) -> Quat {
    let mut d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let mut b = b;
    if d < 0.0 {
        b = [-b[0], -b[1], -b[2], -b[3]];
        d = -d;
    }
    if d > 0.9995 {
        let q = [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t,
            a[3] + (b[3] - a[3]) * t,
        ];
        return crate::flight::unit(q);
    }
    let angle = d.clamp(-1.0, 1.0).acos();
    let s = angle.sin();
    let (wa, wb) = (((1.0 - t) * angle).sin() / s, (t * angle).sin() / s);
    crate::flight::unit([
        a[0] * wa + b[0] * wb,
        a[1] * wa + b[1] * wb,
        a[2] * wa + b[2] * wb,
        a[3] * wa + b[3] * wb,
    ])
}
fn lat_lon(latitude: f64, longitude: f64) -> (V3, V3) {
    let (lat, lon) = (latitude.to_radians(), longitude.to_radians());
    (
        [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()],
        [-lat.sin() * lon.sin(), lat.cos(), -lat.sin() * lon.cos()],
    )
}
/// A body as the planner sees it: the sphere the path must stay out of.
pub fn keep_out(system: &System, id: i32) -> f64 {
    let r = system.radius(id) + crate::flight::air_of(id).map_or(0.0, |a| a.top);
    if id == 699 {
        r.max(SATURN_RINGS)
    } else {
        r
    }
}
#[derive(Clone, Debug)]
pub struct Trip {
    pub target: i32,
    pub end: End,
    /// Real seconds since the start.
    pub elapsed: f64,
    pub duration: f64,
    start_attitude: Quat,
    start_up: V3,
    /// Start, detours, end.
    knots: Vec<Anchor>,
    /// One place on one body: a great circle instead of the spline.
    sphere: bool,
    eps_start: f64,
    eps_end: f64,
    /// The ground under the end place, metres above the reference radius, smoothed (landmark trips).
    pub ground: f64,
    ground_known: bool,
    /// The ground at the place itself, as the page's terrain answers for that direction: preferred over what it reports under the eye.
    place_ground: bool,
    /// How fast the ground estimate is moving, metres per second (smoothed), the trip's own time scale, and the real seconds it
    /// has been held back waiting for the ground.
    ground_rate: f64,
    time_scale: f64,
    pub held: f64,
    /// Planning: detours added, and whether a sample still lay inside a body after them (with that body's id).
    pub detours: usize,
    pub blocked: Option<i32>,
}
impl Trip {
    /// `frame`, `position`, `velocity`, `attitude`: the craft now. `held`: whether the start body was holding it (in its band), so
    /// the start turns with that body. `clearance`: the craft's height over the surface it is nearest to. `rate`: the clock rate.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        system: &System,
        target: i32,
        end: End,
        t: SimTime,
        rate: f64,
        frame: i32,
        position: V3,
        velocity: V3,
        attitude: Quat,
        held: bool,
        clearance: f64,
    ) -> Self {
        let e = &system.ephemeris;
        let body = e.body(target).expect("a target in the table");
        let radius = system.radius(target);
        let start = if held {
            let m = orientation(&e.body(frame).expect("frame in table").rotation, t);
            Anchor::Fixed {
                body: frame,
                point: crate::celestial::apply(&m, position),
            }
        } else {
            Anchor::Drifting {
                body: frame,
                offset: position,
                drift: velocity,
            }
        };
        let finish = match end {
            End::Orbit => {
                let (to_sun, _) = e.relative_state(crate::galaxy::system_id(target), target, t);
                let toward = unit_or(to_sun, [1.0, 0.0, 0.0]);
                let day = normalized(add(toward, [0.25, 0.3, 0.15]));
                let r = crate::flight::free_radius(radius, body.gm) * 1.01;
                let pole = apply_transpose(&orientation(&body.rotation, t), [0.0, 1.0, 0.0]);
                let along = normalized(cross(pole, day));
                let day = normalized(sub(day, mul(along, dot(day, along))));
                Anchor::Orbit {
                    body: target,
                    radius: r,
                    day,
                    along,
                    omega: (body.gm / r).sqrt() / r,
                }
            }
            End::Over {
                latitude,
                longitude,
                ..
            }
            | End::Land {
                latitude,
                longitude,
                ..
            } => {
                let (up, _) = lat_lon(latitude, longitude);
                Anchor::Place { body: target, up }
            }
        };
        let end_height = match end {
            End::Orbit => crate::flight::free_radius(radius, body.gm) * 1.01 - radius,
            End::Over { height, .. } | End::Land { height, .. } => height,
        };
        let start_up = crate::flight::rotate(attitude, [0.0, 1.0, 0.0]);
        let mut trip = Self {
            target,
            end,
            elapsed: 0.0,
            duration: TRIP_SECONDS,
            start_attitude: attitude,
            start_up,
            knots: vec![start, finish],
            sphere: false,
            eps_start: clearance.max(10.0),
            eps_end: end_height.max(10.0),
            ground: 0.0,
            ground_known: false,
            place_ground: false,
            ground_rate: 0.0,
            time_scale: 1.0,
            held: 0.0,
            detours: 0,
            blocked: None,
        };
        // One body: a great circle, when both ends are close to it.
        let a = trip.anchor(system, 0, t, 0.0);
        let b = trip.anchor(system, 1, t, 0.0);
        trip.sphere = body_of(&trip.knots[0]) == target
            && length(a) < 8.0 * radius
            && length(b) < 8.0 * radius;
        if !trip.sphere {
            trip.plan(system, t, rate);
        }
        trip
    }
    /// An anchor's place against the target's centre at clock time `t`, `real` seconds into the trip, inertial axes.
    fn anchor(&self, system: &System, i: usize, t: SimTime, real: f64) -> V3 {
        let e = &system.ephemeris;
        let k = &self.knots[i];
        let body = body_of(k);
        let (centre, _) = e.relative_state(body, self.target, t);
        let offset = match *k {
            Anchor::Fixed { body, point } => fixed_to_inertial(system, body, point, t),
            Anchor::Drifting { offset, drift, .. } => add(
                offset,
                mul(drift, SETTLE * (1.0 - (-real.max(0.0) / SETTLE).exp())),
            ),
            Anchor::Orbit {
                radius,
                day,
                along,
                omega,
                ..
            } => {
                let a = omega * real;
                mul(add(mul(day, a.cos()), mul(along, a.sin())), radius)
            }
            Anchor::Place { body, up } => {
                let r = system.radius(body) + self.ground + self.end_height();
                fixed_to_inertial(system, body, mul(up, r), t)
            }
        };
        add(centre, offset)
    }
    fn end_height(&self) -> f64 {
        match self.end {
            End::Orbit => 0.0,
            End::Over { height, .. } | End::Land { height, .. } => height,
        }
    }
    /// The radial direction of an anchor from its own body's centre.
    fn outward(&self, system: &System, i: usize, t: SimTime, at: V3) -> V3 {
        let body = body_of(&self.knots[i]);
        let (centre, _) = system.ephemeris.relative_state(body, self.target, t);
        unit_or(sub(at, centre), [0.0, 1.0, 0.0])
    }
    /// Real-time fraction to the spline parameter.
    fn parameter(s: f64, alpha: f64, beta: f64) -> f64 {
        let (psi0, psi1) = (-(1.0 + beta).ln(), (1.0 + alpha).ln());
        let c = psi0 + (psi1 - psi0) * smoother(s);
        let e = c.exp();
        ((e * (1.0 + beta) - 1.0) / (alpha + e * beta)).clamp(0.0, 1.0)
    }
    /// The craft's place at fraction `s` of the trip and clock time `t`, against the target's centre, inertial axes.
    pub fn point(&self, system: &System, s: f64, t: SimTime) -> V3 {
        self.point_at(system, s, t, s * self.duration)
    }
    /// The same, with the real time into the trip given apart (past the end, the orbit and the drift keep moving).
    pub fn point_at(&self, system: &System, s: f64, t: SimTime, real: f64) -> V3 {
        let n = self.knots.len();
        let k: Vec<V3> = (0..n).map(|i| self.anchor(system, i, t, real)).collect();
        if self.sphere {
            return self.sphere_point(system, &k, s);
        }
        let lengths: Vec<f64> = (0..n - 1)
            .map(|i| length(sub(k[i + 1], k[i])).max(1e-3))
            .collect();
        let total: f64 = lengths.iter().sum();
        // Tangents per unit of u. The start's leans out of its body as much as the craft is near it against the trip's length;
        // the end comes in from straight above the end point.
        let chord = unit_or(sub(k[n - 1], k[0]), [1.0, 0.0, 0.0]);
        let out = self.outward(system, 0, t, k[0]);
        let near = (self.eps_start / total).clamp(0.0, 1.0);
        let lean = smoother((near.log10() + 3.0) / 3.0);
        let start_dir = unit_or(add(mul(out, 1.0 - lean), mul(chord, lean)), chord);
        let end_dir = mul(self.outward(system, n - 1, t, k[n - 1]), -1.0);
        let tangent = |i: usize| -> V3 {
            if i == 0 {
                start_dir
            } else if i == n - 1 {
                end_dir
            } else {
                unit_or(sub(k[i + 1], k[i - 1]), chord)
            }
        };
        let alpha = total / self.eps_start;
        let beta = total / self.eps_end;
        let u = Self::parameter(s, alpha, beta);
        let mut from = 0.0;
        for j in 0..n - 1 {
            let span = lengths[j] / total;
            if u <= from + span || j == n - 2 {
                let v = ((u - from) / span).clamp(0.0, 1.0);
                let (m0, m1) = (
                    mul(tangent(j), total * span),
                    mul(tangent(j + 1), total * span),
                );
                let (v2, v3) = (v * v, v * v * v);
                let h00 = 2.0 * v3 - 3.0 * v2 + 1.0;
                let h10 = v3 - 2.0 * v2 + v;
                let h01 = -2.0 * v3 + 3.0 * v2;
                let h11 = v3 - v2;
                return add(
                    add(mul(k[j], h00), mul(m0, h10)),
                    add(mul(k[j + 1], h01), mul(m1, h11)),
                );
            }
            from += span;
        }
        k[n - 1]
    }
    fn sphere_point(&self, system: &System, k: &[V3], s: f64) -> V3 {
        let radius = system.radius(self.target);
        let (a, b) = (k[0], k[k.len() - 1]);
        let (na, nb) = (unit_or(a, [0.0, 1.0, 0.0]), unit_or(b, [0.0, 1.0, 0.0]));
        let (ha, hb) = ((length(a) - radius).max(1.0), (length(b) - radius).max(1.0));
        let arc = radius * dot(na, nb).clamp(-1.0, 1.0).acos();
        // The climb: half the ground distance at its top, over the straight log blend of the end heights.
        let climb = 0.5 * arc;
        let speed = arc + 4.0 * climb;
        let u = Self::parameter(s, speed / self.eps_start, speed / self.eps_end);
        let h = ((1.0 - u) * ha.ln() + u * hb.ln()).exp() + climb * 4.0 * u * (1.0 - u);
        // Across the ground by a smoothstep of u: it rises before it moves off and stops moving across well before the last of the
        // descent (what is left across goes as the square of what is left), so the end is reached from above, not across a slope.
        let across = u * u * (3.0 - 2.0 * u);
        mul(slerp_v(na, nb, across), radius + h)
    }
    /// Plan the detours: fly the trip in time at `SAMPLES` points and move it off any body it would cross.
    fn plan(&mut self, system: &System, t0: SimTime, rate: f64) {
        let e = &system.ephemeris;
        let here = crate::galaxy::system_id(self.target);
        let bodies: Vec<i32> = e
            .bodies
            .iter()
            .map(|b| b.id)
            .filter(|&id| crate::galaxy::system_id(id) == here)
            .collect();
        for _ in 0..=DETOURS {
            let mut worst: Option<(usize, i32, f64, V3, usize)> = None;
            let a0 = self.anchor(system, 0, t0, 0.0);
            let t_end = t0.advanced(rate * self.duration);
            let b1 = self.anchor(system, self.knots.len() - 1, t_end, self.duration);
            for i in 1..SAMPLES {
                let s = i as f64 / SAMPLES as f64;
                let t = t0.advanced(rate * self.duration * s);
                let p = self.point(system, s, t);
                for &id in &bodies {
                    let (o, _) = e.relative_state(id, self.target, t);
                    let (o0, _) = e.relative_state(id, self.target, t0);
                    let (o1, _) = e.relative_state(id, self.target, t_end);
                    let r = keep_out(system, id)
                        .min(0.98 * length(sub(a0, o0)))
                        .min(0.98 * length(sub(b1, o1)));
                    let d = length(sub(p, o));
                    if d < r {
                        let depth = (r - d) / r;
                        if worst.is_none_or(|w| depth > w.2) {
                            worst = Some((i, id, depth, sub(p, o), self.segment_at(system, s, t)));
                        }
                    }
                }
            }
            let Some((i, id, _, off, seg)) = worst else {
                self.blocked = None;
                return;
            };
            if self.detours == DETOURS {
                self.blocked = Some(id);
                return;
            }
            let s = i as f64 / SAMPLES as f64;
            let t = t0.advanced(rate * self.duration * s);
            let real = s * self.duration;
            let chord = unit_or(
                sub(
                    self.anchor(system, seg + 1, t, real),
                    self.anchor(system, seg, t, real),
                ),
                [1.0, 0.0, 0.0],
            );
            let mut side = sub(off, mul(chord, dot(off, chord)));
            if length(side) < 1e-6 * length(off).max(1.0) {
                side = cross(chord, [0.0, -0.397_777_16, 0.917_482_06]);
            }
            let offset = mul(unit_or(side, [0.0, 0.0, 1.0]), keep_out(system, id) * 1.6);
            self.knots.insert(
                seg + 1,
                Anchor::Drifting {
                    body: id,
                    offset,
                    drift: [0.0; 3],
                },
            );
            self.detours += 1;
        }
    }
    /// Which spline segment fraction `s` falls in.
    fn segment_at(&self, system: &System, s: f64, t: SimTime) -> usize {
        let n = self.knots.len();
        let k: Vec<V3> = (0..n)
            .map(|i| self.anchor(system, i, t, s * self.duration))
            .collect();
        let lengths: Vec<f64> = (0..n - 1)
            .map(|i| length(sub(k[i + 1], k[i])).max(1e-3))
            .collect();
        let total: f64 = lengths.iter().sum();
        let u = Self::parameter(s, total / self.eps_start, total / self.eps_end);
        let mut from = 0.0;
        for (j, l) in lengths.iter().enumerate() {
            from += l / total;
            if u <= from {
                return j;
            }
        }
        n - 2
    }
    /// Where the eye looks during the trip: the target's centre, or the place on it.
    pub fn aim(&self, system: &System, t: SimTime) -> V3 {
        match self.knots.last() {
            Some(Anchor::Place { body, up }) => fixed_to_inertial(
                system,
                *body,
                mul(*up, system.radius(*body) + self.ground),
                t,
            ),
            _ => [0.0; 3],
        }
    }
    /// The attitude at the end, at time `t`, against inertial axes.
    pub fn end_attitude(&self, system: &System, t: SimTime) -> Quat {
        let e = &system.ephemeris;
        let body = e.body(self.target).expect("target in table");
        match self.end {
            End::Orbit => {
                let at = self.anchor(system, self.knots.len() - 1, t, self.elapsed);
                let pole = apply_transpose(&orientation(&body.rotation, t), [0.0, 1.0, 0.0]);
                look_rotation(mul(unit_or(at, [1.0, 0.0, 0.0]), -1.0), pole)
            }
            End::Over {
                latitude,
                longitude,
                ..
            } => {
                let (up, north) = lat_lon(latitude, longitude);
                look_rotation(
                    mul(fixed_to_inertial(system, self.target, up, t), -1.0),
                    fixed_to_inertial(system, self.target, north, t),
                )
            }
            End::Land {
                latitude,
                longitude,
                ..
            } => {
                let (up, north) = lat_lon(latitude, longitude);
                let (up, north) = (
                    fixed_to_inertial(system, self.target, up, t),
                    fixed_to_inertial(system, self.target, north, t),
                );
                look_rotation(normalized(sub(north, mul(up, 0.25))), up)
            }
        }
    }
    /// The attitude at fraction `s`, from where the eye is: turning from the start's view to face the aim over the first 30% of the
    /// trip, then into the end's view over the last 25%.
    pub fn attitude(&self, system: &System, s: f64, t: SimTime, at: V3) -> Quat {
        let end = self.end_attitude(system, t);
        let end_up = crate::flight::rotate(end, [0.0, 1.0, 0.0]);
        // Between two places on one body the place is behind the planet for much of the way: look ahead along the path first, and
        // turn onto the place over the last 40%, or the view whips round as the place comes over the horizon.
        let aim = if self.sphere {
            let ahead = self.point(system, (s + 0.2).min(1.0), t);
            let w = smoother((s - 0.6) / 0.4);
            add(mul(ahead, 1.0 - w), mul(self.aim(system, t), w))
        } else {
            self.aim(system, t)
        };
        let to = sub(aim, at);
        let up = unit_or(slerp_v(self.start_up, end_up, smoother(s)), end_up);
        let facing = if length(to) > 1e-3 {
            look_rotation(normalized(to), up)
        } else {
            end
        };
        let q = slerp_q(self.start_attitude, facing, smoother(s / 0.3));
        slerp_q(q, end, smoother((s - 0.75) / 0.25))
    }
    /// Learn the ground under the end place from the ground the page reports under the craft, so the end height follows it
    /// (landmark trips). The page knows the ground only under the eye, so the estimate blends toward it with a weight that grows as
    /// the eye comes over the place: exp(-d / h), with d the distance to the place along the ground and h the height over it, and
    /// a quarter-second time constant, so a finer page that raises the ground does not throw the end point. It starts from the first
    /// ground seen. The page also holds the craft above the raw ground under it, whatever the estimate.
    pub fn observe_ground(&mut self, system: &System, at: V3, ground: f64, t: SimTime, dt: f64) {
        let Some(Anchor::Place { body, up }) = self.knots.last().copied() else {
            return;
        };
        let radius = system.radius(body);
        let height = (length(at) - radius - ground).max(1.0);
        let place = fixed_to_inertial(system, body, up, t);
        let along = radius * dot(unit_or(at, place), place).clamp(-1.0, 1.0).acos();
        if self.place_ground {
            return;
        }
        if !self.ground_known {
            self.ground = ground;
            self.ground_known = true;
            return;
        }
        let weight = (-along / height.max(1000.0)).exp();
        let before = self.ground;
        self.ground += (ground - self.ground) * weight * (1.0 - (-dt / 0.25).exp());
        self.note_rate(before, dt);
    }
    /// The ground at the end place, as the page's terrain answers for that direction (its finest page there so far): blended in with
    /// the same quarter-second time constant, and from then on preferred to the ground under the eye.
    pub fn measure_place(&mut self, ground: f64, dt: f64) {
        if !ground.is_finite() {
            return;
        }
        let before = self.ground;
        if self.place_ground {
            self.ground += (ground - self.ground) * (1.0 - (-dt / 0.25).exp());
            self.note_rate(before, dt);
        } else {
            self.ground = if self.ground_known {
                self.ground + (ground - self.ground) * (1.0 - (-dt / 0.25).exp())
            } else {
                ground
            };
            self.ground_known = true;
            self.place_ground = true;
        }
    }
    fn note_rate(&mut self, before: f64, dt: f64) {
        if dt > 0.0 {
            let rate = (self.ground - before).abs() / dt;
            self.ground_rate += (rate - self.ground_rate) * (1.0 - (-dt / 0.2).exp());
        }
    }
    /// Advance the trip by `dt` real seconds. Over the second half of a landmark trip, while the ground estimate is still moving
    /// faster than 20 m/s (finer pages arriving at the place), the trip slows to 15% of its pace, eased over 0.2 s, for at most
    /// 4 s in all, so the end point settles before the eye gets there. Returns the trip's own time step.
    pub fn advance(&mut self, dt: f64) -> f64 {
        let waiting = self.place().is_some()
            && self.fraction() > 0.5
            && self.ground_rate > 20.0
            && self.held < 4.0;
        let target = if waiting { 0.15 } else { 1.0 };
        self.time_scale += (target - self.time_scale) * (1.0 - (-dt / 0.2).exp());
        let step = dt * self.time_scale;
        self.held += dt - step;
        self.elapsed += step;
        step
    }
    pub fn time_scale(&self) -> f64 {
        self.time_scale
    }
    /// The end place's direction in its body's fixed axes, for the page to ask its terrain about. None for an orbit.
    pub fn place(&self) -> Option<(i32, V3)> {
        match self.knots.last() {
            Some(Anchor::Place { body, up }) => Some((*body, *up)),
            _ => None,
        }
    }
    pub fn fraction(&self) -> f64 {
        (self.elapsed / self.duration).clamp(0.0, 1.0)
    }
    pub fn done(&self) -> bool {
        self.elapsed >= self.duration
    }
}
/// The least clearance from a point (against `frame`'s centre) to the keep-out sphere of every body of the frame's system, and
/// the body it is to. For the trip's evidence: how close a trip came to anything.
pub fn clearance_to_bodies(system: &System, frame: i32, position: V3, t: SimTime) -> (f64, i32) {
    let e = &system.ephemeris;
    let here = crate::galaxy::system_id(frame);
    let mut best = (f64::INFINITY, 0);
    for b in &e.bodies {
        if crate::galaxy::system_id(b.id) != here {
            continue;
        }
        let (o, _) = e.relative_state(b.id, frame, t);
        let d = length(sub(position, o)) - system.radius(b.id);
        if d < best.0 {
            best = (d, b.id);
        }
    }
    best
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::celestial::system;
    const T: f64 = 852_076_800.0;
    fn craft_over(id: i32, up: V3, height: f64, t: SimTime) -> (V3, Quat) {
        let s = system();
        let p = mul(normalized(up), s.radius(id) + height);
        let q = look_rotation(normalized(cross(up, [0.0, 0.0, 1.0])), normalized(up));
        let _ = t;
        (p, q)
    }
    /// Fly a trip at 60 Hz: the least clearance to any body's surface, the largest jump in position against the eye's distance to
    /// the nearest surface, and the end point's distance from the end anchor.
    fn fly(trip: &Trip, t0: SimTime, rate: f64) -> (f64, i32, f64, f64) {
        let s = system();
        let steps = (trip.duration * 60.0) as usize;
        let (mut least, mut at, mut jump) = (f64::INFINITY, 0, 0.0f64);
        let mut last: Option<V3> = None;
        let mut before: Option<V3> = None;
        for i in 0..=steps {
            let f = i as f64 / steps as f64;
            let t = t0.advanced(rate * trip.duration * f);
            let p = trip.point(s, f, t);
            let (c, id) = clearance_to_bodies(s, trip.target, p, t);
            if c < least {
                least = c;
                at = id;
            }
            // Second difference against the distance to the nearest surface: a kink or a jump the eye would see.
            if let (Some(a), Some(b)) = (before, last) {
                let bend = length(add(sub(p, mul(b, 2.0)), a));
                jump = jump.max(bend / c.max(1.0));
            }
            before = last;
            last = Some(p);
        }
        let t_end = t0.advanced(rate * trip.duration);
        let end = trip.anchor(s, trip.knots.len() - 1, t_end, trip.duration);
        (least, at, jump, length(sub(trip.point(s, 1.0, t_end), end)))
    }
    fn orbit_trip(from: i32, up: V3, height: f64, to: i32, rate: f64) -> (Trip, SimTime) {
        let t = SimTime::from_seconds(T);
        let (p, q) = craft_over(from, up, height, t);
        let trip = Trip::new(
            system(),
            to,
            End::Orbit,
            t,
            rate,
            from,
            p,
            [0.0; 3],
            q,
            true,
            height,
        );
        (trip, t)
    }
    #[test]
    fn earth_to_planets_clears_every_body_and_arrives() {
        for to in [499, 599, 699, 899, 199, 10, 301] {
            for rate in [1.0, 86_400.0] {
                let (trip, t) = orbit_trip(399, [0.3, 0.6, 0.7], 600e3, to, rate);
                let (least, id, jump, miss) = fly(&trip, t, rate);
                eprintln!("to {to} rate {rate}: least {least:.3e} m ({id}), detours {}, bend {jump:.3}, miss {miss:.2e}", trip.detours);
                assert!(
                    least > 0.0,
                    "to {to} at rate {rate}: {least} m from {id}, detours {}",
                    trip.detours
                );
                assert!(
                    trip.blocked.is_none(),
                    "to {to}: still blocked by {:?}",
                    trip.blocked
                );
                assert!(miss < 1.0, "to {to}: ends {miss} m from the end");
                // At a fast clock the start turns with Earth once a second, as a craft held over it does: smoothness is the
                // trip's own only at rate 1.
                if rate == 1.0 {
                    assert!(jump < 0.5, "to {to}: a step bends {jump} of the height");
                }
            }
        }
    }
    #[test]
    fn from_behind_a_planet_goes_round_it() {
        // From the night side of Mars, 30 000 km out, to its sunlit orbit: the straight way is through Mars.
        let s = system();
        let t = SimTime::from_seconds(T);
        let (to_sun, _) = s.ephemeris.relative_state(10, 499, t);
        let night = mul(normalized(to_sun), -1.0);
        let (trip, t) = orbit_trip(499, night, 30_000e3, 499, 1.0);
        let (least, id, _, miss) = fly(&trip, t, 1.0);
        eprintln!(
            "behind Mars: least {least:.3e} m ({id}), detours {}",
            trip.detours
        );
        assert!(least > 0.0, "{least} m from {id}");
        assert!(miss < 1.0);
    }
    #[test]
    fn a_planet_in_the_way_is_flown_round() {
        // From 2 million km behind Jupiter to Io on its other side: the straight way is through Jupiter's air.
        let s = system();
        let t = SimTime::from_seconds(T);
        let (io, _) = s.ephemeris.relative_state(501, 599, t);
        let start = mul(normalized(io), -2e9);
        let q = look_rotation(normalized(io), [0.0, 0.0, 1.0]);
        // Over the point of Io that faces Jupiter: the end comes in along the same line, so the spline alone would go through.
        let m = orientation(&s.ephemeris.body(501).unwrap().rotation, t);
        let f = crate::celestial::apply(&m, mul(normalized(io), -1.0));
        let (lat, lon) = (f[1].asin().to_degrees(), f[0].atan2(f[2]).to_degrees());
        let end = End::Over {
            latitude: lat,
            longitude: lon,
            height: 50e3,
        };
        let trip = Trip::new(
            s,
            501,
            end,
            t,
            1.0,
            599,
            start,
            [0.0; 3],
            q,
            false,
            2e9 - s.radius(599),
        );
        let (least, id, jump, miss) = fly(&trip, t, 1.0);
        eprintln!(
            "round Jupiter: least {least:.3e} m ({id}), detours {}, bend {jump:.3}",
            trip.detours
        );
        assert!(trip.detours >= 1, "no detour planned");
        assert!(
            trip.blocked.is_none(),
            "still blocked by {:?}",
            trip.blocked
        );
        assert!(least > 0.0, "{least} m from {id}");
        // Jupiter's keep-out sphere: its radius and its air's top.
        let (j, _) = s.ephemeris.relative_state(599, 501, t);
        let mut nearest = f64::INFINITY;
        for i in 0..=600 {
            let p = trip.point(s, i as f64 / 600.0, t.advanced(5.0 * i as f64 / 600.0));
            nearest = nearest.min(length(sub(p, j)) - keep_out(s, 599));
        }
        assert!(nearest > 0.0, "inside Jupiter's keep-out by {} m", -nearest);
        assert!(miss < 1.0);
        assert!(jump < 0.5, "{jump}");
    }
    #[test]
    fn to_the_far_side_of_earth_stays_above_it() {
        let s = system();
        let t = SimTime::from_seconds(T);
        let (p, q) = craft_over(399, [0.0, 0.0, 1.0], 1000.0, t);
        // Held: the anchor turns with Earth, so give it Earth-fixed coordinates.
        let m = orientation(&s.ephemeris.body(399).unwrap().rotation, t);
        let fixed = crate::celestial::apply(&m, p);
        let inertial = fixed_to_inertial(s, 399, fixed, t);
        let end = End::Land {
            latitude: -10.0,
            longitude: 170.0,
            height: 30.0,
        };
        let trip = Trip::new(
            s, 399, end, t, 1.0, 399, inertial, [0.0; 3], q, true, 1000.0,
        );
        assert!(trip.sphere);
        // The end is reached from above: under 2 km over the end point, what is left across is under half the height.
        for i in 0..=3000 {
            let f = i as f64 / 3000.0;
            // Where the place is at that moment: it turns with Earth.
            let end = trip.anchor(s, 1, t.advanced(5.0 * f), 5.0 * f);
            let p = trip.point(s, f, t.advanced(5.0 * f));
            let height = length(p) - length(end);
            let across = length(end) * dot(normalized(p), normalized(end)).clamp(-1.0, 1.0).acos();
            if f > 0.5 && height > 1.0 && height < 2000.0 {
                assert!(
                    across < 0.5 * height,
                    "at {f}: {across} m across at {height} m up"
                );
            }
        }
        let (least, _, jump, miss) = fly(&trip, t, 1.0);
        assert!(least > 25.0, "dips to {least} m");
        assert!(miss < 1.0);
        assert!(jump < 0.5, "{jump}");
    }
    #[test]
    fn arrival_speed_is_the_orbit_speed_at_any_clock_rate() {
        // The craft flies on real seconds in its frame, so the end anchor's orbit must too: at a week per second the arrival
        // velocity is the circular speed, not the circular speed times the rate (which flung the craft out, 16 November 2026).
        let s = system();
        for rate in [1.0, 604_800.0] {
            let (trip, t) = orbit_trip(399, [0.3, 0.6, 0.7], 600e3, 699, rate);
            let h = 1.0 / 240.0;
            let t1 = t.advanced(rate * trip.duration);
            let a = trip.point_at(s, 1.0, t1, trip.duration);
            let b = trip.point_at(s, 1.0, t1.advanced(rate * h), trip.duration + h);
            let v = length(sub(b, a)) / h;
            let body = s.ephemeris.body(699).unwrap();
            let r = length(a);
            let circular = (body.gm / r).sqrt();
            assert!(
                (v / circular - 1.0).abs() < 0.01,
                "rate {rate}: {v} m/s against {circular}"
            );
        }
    }
    #[test]
    fn parameter_runs_from_zero_to_one_smoothly() {
        for (a, b) in [(1e8, 1e3), (1.0, 1.0), (1e-3, 1e9)] {
            let mut last = 0.0;
            for i in 0..=1000 {
                let u = Trip::parameter(i as f64 / 1000.0, a, b);
                assert!(u >= last - 1e-12);
                last = u;
            }
            assert!(Trip::parameter(0.0, a, b).abs() < 1e-12);
            assert!((Trip::parameter(1.0, a, b) - 1.0).abs() < 1e-9);
        }
    }
}

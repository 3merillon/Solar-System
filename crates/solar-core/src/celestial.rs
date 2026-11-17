//! The solar system as a tree of frames. Body-fixed axes are this renderer's: +Y the north pole of
//! the IAU model, +Z longitude zero, +X longitude 90 east. Inertial axes are ICRF. A frame is a
//! body's centre with ICRF axes: bounded around the body, so nothing near a body depends on how far
//! that body is from the Sun (docs/DECISION.md, "Precision and identity").
use crate::{
    ephemeris::{Ephemeris, Rotation, SimTime, SECONDS_PER_DAY},
    field::{add, dot, length, mul, normalized, sub, V3},
};
use std::sync::OnceLock;

/// The table baked by `solar-bake solar` from JPL's public kernels.
const TABLE: &[u8] = include_bytes!("../data/solar-v1.bin");

/// A 3x3 rotation, rows first.
pub type Mat3 = [[f64; 3]; 3];
pub fn apply(m: &Mat3, v: V3) -> V3 {
    [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}
pub fn apply_transpose(m: &Mat3, v: V3) -> V3 {
    [
        m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
        m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
        m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
    ]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
/// Reduce a product of a rate and a day count modulo 360, keeping the bits a plain product loses.
/// One bit of a W near 1e7 degrees is 0.2 mm on Earth's surface; this stays well under that.
fn product_mod_360(rate: f64, days: f64) -> f64 {
    let p = rate * days;
    let e = rate.mul_add(days, -p);
    p.rem_euclid(360.0) + e
}
/// Inertial to body-fixed, in the IAU model of pole and prime meridian.
pub fn orientation(rotation: &Rotation, t: SimTime) -> Mat3 {
    let whole_days = t.whole.div_euclid(86_400);
    let day = (t.whole.rem_euclid(86_400) as f64 + t.frac) / SECONDS_PER_DAY;
    let days = whole_days as f64 + day;
    let century = days / 36_525.0;
    let mut ra =
        rotation.pole_ra[0] + century * (rotation.pole_ra[1] + century * rotation.pole_ra[2]);
    let mut dec =
        rotation.pole_dec[0] + century * (rotation.pole_dec[1] + century * rotation.pole_dec[2]);
    let mut w = rotation.prime[0]
        + product_mod_360(rotation.prime[1], whole_days as f64)
        + rotation.prime[1] * day
        + (rotation.prime[2] * days * days).rem_euclid(360.0);
    for term in &rotation.nutation {
        let angle = (term[0] + term[1] * century).to_radians();
        let (s, c) = angle.sin_cos();
        ra += term[2] * s;
        dec += term[3] * c;
        w += term[4] * s;
    }
    let (ra, dec, w) = (ra.to_radians(), dec.to_radians(), w.to_radians());
    let pole = [dec.cos() * ra.cos(), dec.cos() * ra.sin(), dec.sin()];
    let node = [-ra.sin(), ra.cos(), 0.0];
    let beyond = cross(pole, node);
    let (s, c) = w.sin_cos();
    let x = add(mul(node, c), mul(beyond, s));
    let y = cross(pole, x);
    // IAU (x, y, z) become this renderer's (+Z, +X, +Y).
    [y, pole, x]
}
/// The spin vector in inertial axes, radians per second of simulation time.
pub fn spin(rotation: &Rotation, t: SimTime) -> V3 {
    let m = orientation(rotation, t);
    let days = t.seconds() / SECONDS_PER_DAY;
    let rate = rotation.prime[1] + 2.0 * rotation.prime[2] * days;
    mul(m[1], rate.to_radians() / SECONDS_PER_DAY)
}
pub struct System {
    pub ephemeris: Ephemeris,
    /// Radius of each body's frame, metres; infinite for the Sun.
    pub influence: Vec<f64>,
    /// Indices of the bodies whose parent each is.
    pub children: Vec<Vec<usize>>,
}
pub fn system() -> &'static System {
    static SYSTEM: OnceLock<System> = OnceLock::new();
    SYSTEM.get_or_init(|| {
        let mut e = Ephemeris::parse(TABLE).expect("the embedded solar table reads");
        crate::galaxy::append(&mut e);
        System::new(e)
    })
}
/// Sphere of influence, a(m/M)^(2/5), floored at three body radii: a small moon's own is under
/// its surface. Its gravity is then still its own, and no real orbit depends on this floor.
const SMALL_BODY_FRAME: f64 = 3.0;
impl System {
    pub fn new(ephemeris: Ephemeris) -> Self {
        let n = ephemeris.bodies.len();
        let mut influence = vec![f64::INFINITY; n];
        let mut children = vec![Vec::new(); n];
        let epoch = SimTime::default();
        for (i, b) in ephemeris.bodies.iter().enumerate() {
            if b.parent == b.id {
                continue;
            }
            let p = ephemeris.index(b.parent).expect("parent in table");
            children[p].push(i);
            let (r, _) = ephemeris.relative_state(b.id, b.parent, epoch);
            let parent_gm = ephemeris.bodies[p].gm;
            let soi = length(r) * (b.gm / parent_gm).max(0.0).powf(0.4);
            influence[i] = if b.id >= 10000 && b.id % 100 == 0 {
                0.3 * crate::galaxy::LIGHT_YEAR
            } else {
                soi.max(SMALL_BODY_FRAME * b.radii[0])
            };
        }
        Self {
            ephemeris,
            influence,
            children,
        }
    }
    /// The reference radius the renderer's model of a body uses: one sphere for the whole body, as
    /// the height data expects. The PCK's triaxial figure stays with the table for a giant's shape.
    pub fn radius(&self, id: i32) -> f64 {
        crate::body::BodyDescriptor::of_naif(id)
            .map(|b| b.radius)
            .or_else(|| self.ephemeris.body(id).map(|b| b.radii[0]))
            .unwrap_or(1.0)
    }
    /// A giant's cloud tops at an inertial direction: its oblate figure, not a sphere.
    pub fn figure_radius(&self, id: i32, direction: V3, t: SimTime) -> f64 {
        let Some(body) = self.ephemeris.body(id) else {
            return 1.0;
        };
        let m = orientation(&body.rotation, t);
        let sin_lat = dot(m[1], direction) / length(direction).max(1e-30);
        let (a, c) = (body.radii[0], body.radii[2]);
        let cos2 = 1.0 - sin_lat * sin_lat;
        a * c / (c * c * cos2 + a * a * sin_lat * sin_lat).sqrt()
    }
}

/// A position in a body's frame: an integer sector and a bounded offset. Nothing near a body uses a
/// sector at all, and far from every body the offset stays near a micrometre.
pub const SECTOR: f64 = 4_294_967_296.0;
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Address {
    pub sector: [i64; 3],
    pub offset: V3,
}
impl Address {
    pub fn from_metres(v: V3) -> Self {
        let mut a = Self {
            sector: [0; 3],
            offset: v,
        };
        a.normalize();
        a
    }
    pub fn normalize(&mut self) {
        for i in 0..3 {
            let s = (self.offset[i] / SECTOR).round();
            if s != 0.0 {
                self.sector[i] += s as i64;
                self.offset[i] -= s * SECTOR;
            }
        }
    }
    pub fn moved(mut self, d: V3) -> Self {
        self.offset = add(self.offset, d);
        self.normalize();
        self
    }
    /// As metres from the frame's centre. Only for a frame the eye is close to, or a direction.
    pub fn metres(&self) -> V3 {
        std::array::from_fn(|i| self.sector[i] as f64 * SECTOR + self.offset[i])
    }
    /// `self - point`, where `point` is in metres from the same centre.
    pub fn minus(&self, point: V3) -> V3 {
        std::array::from_fn(|i| {
            let s = (point[i] / SECTOR).round();
            let rest = point[i] - s * SECTOR;
            (self.sector[i] as f64 - s) * SECTOR + (self.offset[i] - rest)
        })
    }
}
pub fn unit_or(v: V3, fallback: V3) -> V3 {
    if length(v) > 0.0 {
        normalized(v)
    } else {
        fallback
    }
}
pub fn difference(a: V3, b: V3) -> V3 {
    sub(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn near(a: f64, b: f64, tolerance: f64) {
        assert!((a - b).abs() <= tolerance, "{a} against {b}");
    }
    #[test]
    fn an_orientation_is_a_rotation_and_north_is_the_iau_pole() {
        let s = system();
        for b in &s.ephemeris.bodies {
            let m = orientation(&b.rotation, SimTime::from_seconds(1.0e8));
            for i in 0..3 {
                near(dot(m[i], m[i]), 1.0, 1e-12);
                near(dot(m[i], m[(i + 1) % 3]), 0.0, 1e-12);
            }
            // Right handed, or the images would come out mirrored.
            let c = cross(m[0], m[1]);
            near(dot(c, m[2]), 1.0, 1e-12);
        }
    }
    #[test]
    fn a_body_turns_through_its_sidereal_period() {
        let s = system();
        let earth = s.ephemeris.body(399).unwrap();
        let t0 = SimTime::from_seconds(7.0e8);
        // A sidereal day as the model gives it: 360 / 360.9856235 days.
        let period = 360.0 / 360.985_623_5 * SECONDS_PER_DAY;
        let a = orientation(&earth.rotation, t0);
        let b = orientation(&earth.rotation, t0.advanced(period));
        for i in 0..3 {
            near(dot(a[i], b[i]), 1.0, 1e-9);
        }
        // Venus's rate is negative in the model: it turns backward.
        let venus = s.ephemeris.body(299).unwrap();
        assert!(venus.rotation.prime[1] < 0.0);
    }
    #[test]
    fn spin_moves_a_fixed_point_as_the_orientation_does() {
        let s = system();
        let mars = s.ephemeris.body(499).unwrap();
        let t = SimTime::from_seconds(3.0e8);
        let h = 1.0;
        let fixed = [1.0, 0.2, -0.4];
        let at = |t: SimTime| apply_transpose(&orientation(&mars.rotation, t), fixed);
        let numeric = mul(sub(at(t.advanced(h)), at(t.advanced(-h))), 0.5 / h);
        let analytic = cross(spin(&mars.rotation, t), at(t));
        for i in 0..3 {
            near(numeric[i], analytic[i], 1e-9);
        }
    }
    #[test]
    fn an_address_keeps_a_micrometre_at_neptune() {
        // Neptune's distance, and a step of a micrometre on the bounded offset.
        let far = Address::from_metres([4.5e12, -1.3e12, 7.7e11]);
        let moved = far.moved([1e-6, 0.0, 0.0]);
        let d = moved.minus(far.metres());
        // Rounded in the metres() conversion by its own millimetre: the offset itself kept it.
        let step = moved.offset[0] - far.offset[0];
        near(step, 1e-6, 2e-7);
        assert!(length(d) < 0.01);
    }
    #[test]
    fn frames_nest_and_a_moons_frame_lies_outside_it() {
        let s = system();
        let moon = s.ephemeris.index(301).unwrap();
        let earth = s.ephemeris.index(399).unwrap();
        // Laplace: Moon about 66,000 km, Earth about 925,000 km.
        assert!(
            (5.5e7..7.5e7).contains(&s.influence[moon]),
            "{}",
            s.influence[moon]
        );
        assert!(
            (8.5e8..1.0e9).contains(&s.influence[earth]),
            "{}",
            s.influence[earth]
        );
        for (i, b) in s.ephemeris.bodies.iter().enumerate() {
            assert!(s.influence[i] > b.radii[0], "{}", b.id);
        }
    }
}

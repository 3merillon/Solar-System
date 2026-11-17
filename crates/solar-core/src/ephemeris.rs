//! Compressed positions of the solar system, read from one small table: where each body is
//! against its parent, in ICRF axes, metres and TDB. No renderer, no network, no allocation per
//! query. Fit errors are measured by the bake against JPL's kernels and by a test against recorded
//! Horizons values (docs/SOLAR-SYSTEM.md); nothing here claims more than those numbers.
//!
//! Three forms, chosen by what compresses a body at its tolerance:
//! - Chebyshev segments for a planet's system barycentre and for the Moon. Segment ends share their
//!   sample, so a position has no jump at a join, beyond the rounding of the stored coefficients.
//! - A harmonic series for regular moons, whose motion is a few discrete frequencies: small, with
//!   no joins at any time rate, and it degrades slowly instead of ending outside its fitted span.
//! - A planet's centre comes from its barycentre less the mass-weighted positions of its moons.
use crate::field::{add, mul, sub, V3};

pub const SECONDS_PER_DAY: f64 = 86_400.0;

/// Simulation time: TDB seconds past J2000, as a whole part and a fraction. A single f64 would
/// quantize to half a microsecond by 2100; this keeps a frame's step exact at every date and rate.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SimTime {
    pub whole: i64,
    pub frac: f64,
}
impl SimTime {
    pub fn from_seconds(s: f64) -> Self {
        let whole = s.floor();
        Self {
            whole: whole as i64,
            frac: s - whole,
        }
    }
    pub fn seconds(self) -> f64 {
        self.whole as f64 + self.frac
    }
    pub fn advanced(self, dt: f64) -> Self {
        let f = self.frac + dt;
        let whole = f.floor();
        Self {
            whole: self.whole + whole as i64,
            frac: f - whole,
        }
    }
    /// Seconds from `earlier`, exact for nearby times at any date.
    pub fn since(self, earlier: Self) -> f64 {
        (self.whole - earlier.whole) as f64 + (self.frac - earlier.frac)
    }
}

/// NAIF codes, in the order of the bodies this project knows.
pub const SUN: i32 = 10;
pub const EARTH: i32 = 399;
pub const MOON: i32 = 301;

/// Unit: metres of position, days of time inside the series and segments.
#[derive(Clone, Debug)]
pub struct Chebyshev {
    /// First segment's start, TDB seconds past J2000, and a segment's length, seconds.
    pub start: f64,
    pub span: f64,
    pub order: usize,
    /// `segments * order * 3` coefficients, metres.
    pub coefficients: Vec<f64>,
}
impl Chebyshev {
    pub fn segments(&self) -> usize {
        self.coefficients.len() / (self.order * 3).max(1)
    }
    /// Position and velocity. Times outside the table clamp to its ends, with zero velocity beyond
    /// them: a held position, which `Ephemeris::covered` reports.
    pub fn state(&self, t: f64) -> (V3, V3) {
        let n = self.segments();
        let x = (t - self.start) / self.span;
        if !(0.0..n as f64).contains(&x) {
            let (seg, s) = if x < 0.0 { (0, -1.0) } else { (n - 1, 1.0) };
            let (p, _) = self.eval(seg, s);
            return (p, [0.0; 3]);
        }
        let seg = x as usize;
        let s = 2.0 * (x - seg as f64) - 1.0;
        let (p, d) = self.eval(seg, s);
        (p, mul(d, 2.0 / self.span))
    }
    fn eval(&self, seg: usize, s: f64) -> (V3, V3) {
        let c = &self.coefficients[seg * self.order * 3..(seg + 1) * self.order * 3];
        let mut p = [0.0; 3];
        let mut d = [0.0; 3];
        for axis in 0..3 {
            let k = &c[axis * self.order..(axis + 1) * self.order];
            let (mut t0, mut t1) = (1.0, s);
            let (mut d0, mut d1) = (0.0, 1.0);
            let mut sum = k[0];
            let mut dsum = 0.0;
            for &coefficient in &k[1..] {
                sum += coefficient * t1;
                dsum += coefficient * d1;
                let t2 = 2.0 * s * t1 - t0;
                let d2 = 2.0 * t1 + 2.0 * s * d1 - d0;
                (t0, t1) = (t1, t2);
                (d0, d1) = (d1, d2);
            }
            p[axis] = sum;
            d[axis] = dsum;
        }
        (p, d)
    }
}
/// One axis: polynomial in centuries plus cosines and sines of discrete frequencies.
#[derive(Clone, Debug, Default)]
pub struct Series {
    /// Metres; metres per century; metres per century squared.
    pub polynomial: [f64; 3],
    /// (radians per day, cosine metres, sine metres).
    pub terms: Vec<[f64; 3]>,
}
impl Series {
    pub fn state(&self, days: f64) -> (f64, f64) {
        let t = days / 36_525.0;
        let mut p = self.polynomial[0] + t * (self.polynomial[1] + t * self.polynomial[2]);
        let mut v = (self.polynomial[1] + 2.0 * t * self.polynomial[2]) / 36_525.0;
        for &[w, a, b] in &self.terms {
            let (s, c) = (w * days).sin_cos();
            p += a * c + b * s;
            v += w * (b * c - a * s);
        }
        (p, v / SECONDS_PER_DAY)
    }
}
#[derive(Clone, Debug)]
pub enum Motion {
    /// The Sun: the origin of everything here.
    Origin,
    Chebyshev(Chebyshev),
    Series(Box<[Series; 3]>),
    /// The table holds this planet's system barycentre against the parent. The planet itself is
    /// found from it and from the moons listed with their mass ratios to the planet.
    Barycentric {
        barycentre: Chebyshev,
        moons: Vec<(i32, f64)>,
    },
}
#[derive(Clone, Debug)]
pub struct Rotation {
    /// Degrees and degrees per Julian century, and per century squared.
    pub pole_ra: [f64; 3],
    pub pole_dec: [f64; 3],
    /// Degrees, degrees per day, per day squared.
    pub prime: [f64; 3],
    /// Periodic terms with their angles: [theta0 deg, theta1 deg/century, ra deg, dec deg, w deg].
    pub nutation: Vec<[f64; 5]>,
}
#[derive(Clone, Debug)]
pub struct Entry {
    pub id: i32,
    pub parent: i32,
    /// m^3/s^2.
    pub gm: f64,
    /// Equatorial a, equatorial b, polar: metres.
    pub radii: [f64; 3],
    pub rotation: Rotation,
    pub motion: Motion,
    /// Largest fit error found by the bake against the kernels, metres: what was measured.
    pub fit_error: f64,
}
/// Depth of a body below the Sun. The tree is shallow: Sun, planet, moon.
const MAX_DEPTH: usize = 3;
pub struct Ephemeris {
    pub bodies: Vec<Entry>,
    /// The span the tables were fitted over, TDB seconds past J2000.
    pub covered: [f64; 2],
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self.at + n;
        let out = self
            .bytes
            .get(self.at..end)
            .ok_or("truncated ephemeris table")?;
        self.at = end;
        Ok(out)
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(self.u32()? as i32)
    }
    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn f64s<const N: usize>(&mut self) -> Result<[f64; N], String> {
        let mut out = [0.0; N];
        for v in &mut out {
            *v = self.f64()?;
        }
        Ok(out)
    }
    /// Coefficients: the three lowest orders of an axis in full, the rest in f32.
    fn chebyshev(&mut self) -> Result<Chebyshev, String> {
        let start = self.f64()?;
        let span = self.f64()?;
        let order = self.u32()? as usize;
        let segments = self.u32()? as usize;
        let mut coefficients = Vec::with_capacity(segments * order * 3);
        for _ in 0..segments * 3 {
            for k in 0..order {
                coefficients.push(if k < 3 {
                    self.f64()?
                } else {
                    f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64
                });
            }
        }
        Ok(Chebyshev {
            start,
            span,
            order,
            coefficients,
        })
    }
}
pub const MAGIC: &[u8; 8] = b"STSOLAR1";
impl Ephemeris {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let mut r = Reader { bytes, at: 0 };
        if r.take(8)? != MAGIC {
            return Err("not a solar table".into());
        }
        let covered = r.f64s::<2>()?;
        let count = r.u32()? as usize;
        let mut bodies = Vec::with_capacity(count);
        for _ in 0..count {
            let id = r.i32()?;
            let parent = r.i32()?;
            let gm = r.f64()?;
            let radii = r.f64s::<3>()?;
            let fit_error = r.f64()?;
            let pole_ra = r.f64s::<3>()?;
            let pole_dec = r.f64s::<3>()?;
            let prime = r.f64s::<3>()?;
            let terms = r.u32()? as usize;
            let mut nutation = Vec::with_capacity(terms);
            for _ in 0..terms {
                nutation.push(r.f64s::<5>()?);
            }
            let kind = r.u32()?;
            let motion = match kind {
                0 => Motion::Origin,
                1 => Motion::Chebyshev(r.chebyshev()?),
                2 => {
                    let mut axes: [Series; 3] = Default::default();
                    for axis in &mut axes {
                        axis.polynomial = r.f64s::<3>()?;
                        let n = r.u32()? as usize;
                        axis.terms = Vec::with_capacity(n);
                        for _ in 0..n {
                            axis.terms.push(r.f64s::<3>()?);
                        }
                    }
                    Motion::Series(Box::new(axes))
                }
                3 => {
                    let barycentre = r.chebyshev()?;
                    let n = r.u32()? as usize;
                    let mut moons = Vec::with_capacity(n);
                    for _ in 0..n {
                        let id = r.i32()?;
                        moons.push((id, r.f64()?));
                    }
                    Motion::Barycentric { barycentre, moons }
                }
                _ => return Err("unknown motion kind".into()),
            };
            bodies.push(Entry {
                id,
                parent,
                gm,
                radii,
                rotation: Rotation {
                    pole_ra,
                    pole_dec,
                    prime,
                    nutation,
                },
                motion,
                fit_error,
            });
        }
        Ok(Self { bodies, covered })
    }
    pub fn index(&self, id: i32) -> Option<usize> {
        self.bodies.iter().position(|b| b.id == id)
    }
    pub fn body(&self, id: i32) -> Option<&Entry> {
        self.index(id).map(|i| &self.bodies[i])
    }
    /// A body against its own parent: metres and metres per second of TDB.
    pub fn local_state(&self, id: i32, t: SimTime) -> (V3, V3) {
        let Some(body) = self.body(id) else {
            return ([0.0; 3], [0.0; 3]);
        };
        let seconds = t.seconds();
        match &body.motion {
            Motion::Origin => ([0.0; 3], [0.0; 3]),
            Motion::Chebyshev(c) => c.state(seconds),
            Motion::Series(axes) => {
                let days = seconds / SECONDS_PER_DAY;
                let (x, vx) = axes[0].state(days);
                let (y, vy) = axes[1].state(days);
                let (z, vz) = axes[2].state(days);
                ([x, y, z], [vx, vy, vz])
            }
            Motion::Barycentric { barycentre, moons } => {
                let (mut p, mut v) = barycentre.state(seconds);
                // barycentre - planet = sum(mu r) / (1 + sum(mu)), r the moons against the planet.
                let total: f64 = 1.0 + moons.iter().map(|m| m.1).sum::<f64>();
                for &(moon, mu) in moons {
                    let (r, w) = self.local_state(moon, t);
                    p = sub(p, mul(r, mu / total));
                    v = sub(v, mul(w, mu / total));
                }
                (p, v)
            }
        }
    }
    /// As `local_state`'s position, leaving out the wobble of a planet about its system's barycentre. For drawing a long
    /// orbit quickly: the wobble costs a moon series per sample, and no one can see it on an orbit's scale.
    pub fn smooth_position(&self, id: i32, t: SimTime) -> V3 {
        match self.body(id).map(|b| &b.motion) {
            Some(Motion::Barycentric { barycentre, .. }) => barycentre.state(t.seconds()).0,
            _ => self.local_state(id, t).0,
        }
    }
    /// `id` against `against`, walking only as far up the tree as the two share. Near bodies never
    /// pass through a heliocentric number, so their separation keeps its full precision.
    pub fn relative_state(&self, id: i32, against: i32, t: SimTime) -> (V3, V3) {
        if id == against {
            return ([0.0; 3], [0.0; 3]);
        }
        let chain = |mut b: i32| {
            let mut out = [b; MAX_DEPTH + 1];
            let mut n = 1;
            while let Some(entry) = self.body(b) {
                if entry.parent == b || n > MAX_DEPTH {
                    break;
                }
                b = entry.parent;
                out[n] = b;
                n += 1;
            }
            (out, n)
        };
        let (a, na) = chain(id);
        let (b, nb) = chain(against);
        // The lowest shared ancestor: the last pair that matches, reading from the root.
        let mut ia = na;
        let mut ib = nb;
        while ia > 1 && ib > 1 && a[ia - 2] == b[ib - 2] {
            ia -= 1;
            ib -= 1;
        }
        let mut position = [0.0; 3];
        let mut velocity = [0.0; 3];
        for body in a.iter().take(ia - 1) {
            let (p, v) = self.local_state(*body, t);
            position = add(position, p);
            velocity = add(velocity, v);
        }
        for body in b.iter().take(ib - 1) {
            let (p, v) = self.local_state(*body, t);
            position = sub(position, p);
            velocity = sub(velocity, v);
        }
        (position, velocity)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn time_keeps_its_step_at_any_date() {
        let mut t = SimTime::from_seconds(3.2e9);
        for _ in 0..3600 {
            t = t.advanced(1.0 / 60.0);
        }
        assert!((t.since(SimTime::from_seconds(3.2e9)) - 60.0).abs() < 1e-9);
    }
    #[test]
    fn a_chebyshev_table_has_velocity_and_holds_outside_its_span() {
        // x = 3 + 2s on two one-second segments from 0.
        let c = Chebyshev {
            start: 0.0,
            span: 1.0,
            order: 2,
            coefficients: vec![3.0, 2.0, 0.0, 0.0, 0.0, 0.0, 7.0, 2.0, 0.0, 0.0, 0.0, 0.0],
        };
        let (p, v) = c.state(0.5);
        assert_eq!(p[0], 3.0);
        assert_eq!(v[0], 4.0);
        let (p, v) = c.state(1.25);
        assert_eq!(p[0], 6.0);
        assert_eq!(v[0], 4.0);
        let (p, v) = c.state(9.0);
        assert_eq!(p[0], 9.0);
        assert_eq!(v[0], 0.0);
    }
    #[test]
    fn a_series_velocity_is_the_derivative_of_its_position() {
        let s = Series {
            polynomial: [10.0, 36_525.0, 0.0],
            terms: vec![[2.0, 5.0, -3.0], [0.7, 1.0, 1.0]],
        };
        let (_, v) = s.state(40.0);
        let h = 1e-4;
        let numeric = (s.state(40.0 + h).0 - s.state(40.0 - h).0) / (2.0 * h * SECONDS_PER_DAY);
        assert!((v - numeric).abs() < 1e-9, "{v} {numeric}");
    }
}

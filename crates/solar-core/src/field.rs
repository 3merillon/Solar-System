//! Finite, deterministic solid programs and ordered interval visibility.
//! An interval containing zero is evidence of uncertainty, not of a root.
use crate::hash;

pub type V3 = [f64; 3];
pub fn add(a: V3, b: V3) -> V3 {
    std::array::from_fn(|i| a[i] + b[i])
}
pub fn sub(a: V3, b: V3) -> V3 {
    std::array::from_fn(|i| a[i] - b[i])
}
pub fn mul(a: V3, b: f64) -> V3 {
    a.map(|x| x * b)
}
pub fn dot(a: V3, b: V3) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
pub fn length(a: V3) -> f64 {
    dot(a, a).sqrt()
}
pub fn normalized(a: V3) -> V3 {
    mul(a, 1.0 / length(a))
}

#[derive(Clone, Copy, Debug)]
pub struct Range {
    pub lo: f64,
    pub hi: f64,
}
impl Range {
    pub fn around(v: f64, e: f64) -> Self {
        Self {
            lo: v - e,
            hi: v + e,
        }
    }
    pub fn union(self, b: Self) -> Self {
        Self {
            lo: self.lo.min(b.lo),
            hi: self.hi.min(b.hi),
        }
    }
    pub fn intersect(self, b: Self) -> Self {
        Self {
            lo: self.lo.max(b.lo),
            hi: self.hi.max(b.hi),
        }
    }
    pub fn negate(self) -> Self {
        Self {
            lo: -self.hi,
            hi: -self.lo,
        }
    }
    pub fn excludes_zero(self) -> bool {
        self.lo > 0.0 || self.hi < 0.0
    }
}

/// Cubic lattice noise: range [-1,1], each partial derivative <=3.
/// The hash depends only on integer lattice identity; no stochastic skipping.
pub fn noise(p: V3, seed: u32) -> f64 {
    // Shared hash prefixes and fixed loops; the arithmetic and summation order
    // are those of `noise_reference`, so results are bit-identical (tested).
    let fx = p[0].floor();
    let fy = p[1].floor();
    let fz = p[2].floor();
    let cell = [fx as i32, fy as i32, fz as i32];
    let s = |f: f64| f * f * (3.0 - 2.0 * f);
    let t = [s(p[0] - fx), s(p[1] - fy), s(p[2] - fz)];
    let wx = [1.0 - t[0], t[0]];
    let wy = [1.0 - t[1], t[1]];
    let wz = [1.0 - t[2], t[2]];
    let mut sum = 0.0;
    for (z, &wzz) in wz.iter().enumerate() {
        let hz = hash((cell[2] + z as i32) as u32 ^ seed);
        for (y, &wyy) in wy.iter().enumerate() {
            let hy = hash((cell[1] + y as i32) as u32 ^ hz);
            for (x, &wxx) in wx.iter().enumerate() {
                let h = hash((cell[0] + x as i32) as u32 ^ hy);
                let v = f64::from(h >> 8) * (2.0 / 16_777_215.0) - 1.0;
                sum += v * (wxx * wyy * wzz);
            }
        }
    }
    sum
}
/// The original lattice noise, kept as the reference `noise` must match bit for bit.
pub fn noise_reference(p: V3, seed: u32) -> f64 {
    let cell = p.map(|x| x.floor() as i32);
    let t = std::array::from_fn::<_, 3, _>(|i| {
        let f = p[i] - p[i].floor();
        f * f * (3.0 - 2.0 * f)
    });
    let mut sum = 0.0;
    for z in 0..2 {
        for y in 0..2 {
            for x in 0..2 {
                let h = hash(
                    (cell[0] + x) as u32
                        ^ hash((cell[1] + y) as u32 ^ hash((cell[2] + z) as u32 ^ seed)),
                );
                let v = f64::from(h >> 8) * (2.0 / 16_777_215.0) - 1.0;
                let w = [x, y, z]
                    .iter()
                    .enumerate()
                    .map(|(i, &a)| if a == 0 { 1.0 - t[i] } else { t[i] })
                    .product::<f64>();
                sum += v * w;
            }
        }
    }
    sum
}

#[derive(Clone, Copy, Debug)]
pub struct Ray {
    pub origin: V3,
    pub direction: V3,
    pub near: f64,
    pub far: f64,
}
impl Ray {
    pub fn at(self, t: f64) -> V3 {
        add(self.origin, mul(self.direction, t))
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Solid {
    pub scene: u32,
    pub seed: u32,
    pub bands: u32,
    pub amplitude: f64,
    pub ratio: f64,
}
impl Default for Solid {
    fn default() -> Self {
        Self {
            scene: 0,
            seed: 2026,
            bands: 8,
            amplitude: 0.12,
            ratio: 0.45,
        }
    }
}
pub fn norm_range(p: V3, d: V3, half: f64) -> Range {
    let dd = dot(d, d);
    let t = if dd > 0.0 {
        (-dot(p, d) / dd).clamp(-half, half)
    } else {
        0.0
    };
    Range {
        lo: length(add(p, mul(d, t))),
        hi: length(add(p, mul(d, -half))).max(length(add(p, mul(d, half)))),
    }
}
impl Solid {
    pub fn base(self, p: V3) -> f64 {
        self.base_range(p, [0.0; 3], 0.0).lo
    }
    pub fn base_range(self, p: V3, d: V3, half: f64) -> Range {
        let sphere = norm_range(p, d, half);
        let sphere = Range {
            lo: sphere.lo - 3.0,
            hi: sphere.hi - 3.0,
        };
        match self.scene {
            0 => {
                let bore = norm_range([0.0, p[1], p[2]], [0.0, d[1], d[2]], half);
                sphere.intersect(Range {
                    lo: 0.75 - bore.hi,
                    hi: 0.75 - bore.lo,
                })
            }
            1 => {
                // Warped cave: bounded displacement of the bore centre.
                let warp = 0.35 * noise(mul(p, 0.6), self.seed);
                let q = [0.0, p[1] - warp, p[2]];
                let r = length(q);
                let e = (1.0 + 0.35 * 0.6 * 3.0 * 3.0_f64.sqrt()) * half;
                sphere.intersect(Range::around(0.8 - r, e))
            }
            2 => {
                // An arch cut from a box, plus a disconnected boulder.
                let box_value = (p[0].abs() - 3.0)
                    .max(p[1].abs() - 2.0)
                    .max(p[2].abs() - 0.65);
                let b = Range::around(box_value, half);
                let arch = norm_range([p[0], p[1] + 1.0, 0.0], [d[0], d[1], 0.0], half);
                let a = b.intersect(Range {
                    lo: 1.5 - arch.hi,
                    hi: 1.5 - arch.lo,
                });
                let rock = norm_range(sub(p, [3.7, -1.4, 0.0]), d, half);
                a.union(Range {
                    lo: rock.lo - 0.45,
                    hi: rock.hi - 0.45,
                })
            }
            3 => {
                // Periodic cavities inside a sphere; conservative warp range.
                let q = p.map(|v| (v + 0.6).rem_euclid(1.2) - 0.6);
                let cavity = length(q) - 0.32;
                sphere.intersect(Range::around(-cavity, half))
            }
            5 => sphere,
            6 => {
                let v = p[1].abs() - 0.0005;
                Range::around(v, d[1].abs() * half)
            }
            _ => sphere,
        }
    }
    pub fn value(self, p: V3) -> f64 {
        let mut v = self.base(p);
        let mut a = self.amplitude;
        let mut f = 0.7;
        for k in 0..self.bands {
            v += a * noise(mul(p, f), self.seed.wrapping_add(k));
            a *= self.ratio;
            f *= 2.0;
        }
        v
    }
    pub fn range(self, ray: Ray, a: f64, b: f64, method: u32, counters: &mut [u32; 2]) -> Range {
        counters[0] += 1;
        let half = (b - a) * 0.5;
        let p = ray.at((a + b) * 0.5);
        let base_l = if self.scene == 1 { 2.1 } else { 1.0 };
        let mut range = if method == 2 {
            self.base_range(p, ray.direction, half)
        } else {
            Range::around(self.base(p), base_l * half)
        };
        let mut amp = self.amplitude;
        let mut freq = 0.7;
        for k in 0..=self.bands {
            let tail = if k == self.bands {
                0.0
            } else {
                amp * (1.0 - self.ratio.powi((self.bands - k) as i32)) / (1.0 - self.ratio)
            };
            let error = 2e-12 * (1.0 + length(p) + b.abs());
            let r = Range {
                lo: range.lo - tail - error,
                hi: range.hi + tail + error,
            };
            if k == self.bands || (method != 0 && r.excludes_zero()) {
                return r;
            }
            let n = noise(mul(p, freq), self.seed.wrapping_add(k));
            let delta = 3.0 * freq * ray.direction.iter().map(|x| x.abs()).sum::<f64>() * half;
            let lo = if method == 2 {
                (n - delta).max(-1.0)
            } else {
                n - delta
            };
            let hi = if method == 2 {
                (n + delta).min(1.0)
            } else {
                n + delta
            };
            range.lo += amp * lo;
            range.hi += amp * hi;
            amp *= self.ratio;
            freq *= 2.0;
            counters[1] += 1;
        }
        unreachable!()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Status {
    Miss = 0,
    Hit = 1,
    Unresolved = 2,
    Overflow = 3,
}
#[derive(Clone, Copy, Debug)]
pub struct Hit {
    pub status: Status,
    pub near: f64,
    pub far: f64,
    pub bounds: u32,
    pub bands: u32,
    pub high_water: u32,
}

/// Ordered DFS of ray intervals, retaining the earliest possible root.
/// Hit requires a sign change AND an uncertainty span <= tolerance.
/// Unbracketed tangencies, ill-conditioned roots and exhausted work are explicit.
pub trait FieldOracle {
    fn value(&self, p: V3) -> f64;
    fn point_band_cost(&self) -> u32 {
        0
    }
    fn range(&self, ray: Ray, a: f64, b: f64, method: u32, counters: &mut [u32; 2]) -> Range;
}
impl FieldOracle for Solid {
    fn point_band_cost(&self) -> u32 {
        self.bands
    }
    fn value(&self, p: V3) -> f64 {
        Solid::value(*self, p)
    }
    fn range(&self, ray: Ray, a: f64, b: f64, method: u32, counters: &mut [u32; 2]) -> Range {
        Solid::range(*self, ray, a, b, method, counters)
    }
}
pub fn trace(solid: impl FieldOracle, ray: Ray, tolerance: f64, budget: u32, method: u32) -> Hit {
    assert!(tolerance > 0.0 && ray.near < ray.far && (length(ray.direction) - 1.0).abs() < 1e-8);
    let mut stack = vec![(ray.near, ray.far)];
    let mut count = [0; 2];
    let mut water = 1;
    let mut pending: Option<f64> = None;
    while let Some((a, b)) = stack.pop() {
        if count[0] >= budget {
            return Hit {
                status: Status::Unresolved,
                near: pending.unwrap_or(a),
                far: b,
                bounds: count[0],
                bands: count[1],
                high_water: water,
            };
        }
        let range = solid.range(ray, a, b, method, &mut count);
        if range.excludes_zero() {
            if let Some(first) = pending {
                let fa = solid.value(ray.at(first));
                count[1] += solid.point_band_cost();
                if fa * range.lo < 0.0 && a - first <= tolerance {
                    return Hit {
                        status: Status::Hit,
                        near: first,
                        far: a,
                        bounds: count[0],
                        bands: count[1],
                        high_water: water,
                    };
                }
            }
            continue;
        }
        if b - a <= tolerance * 0.125 {
            let first = *pending.get_or_insert(a);
            let fa = solid.value(ray.at(first));
            let fb = solid.value(ray.at(b));
            count[1] += 2 * solid.point_band_cost();
            if fa * fb < 0.0 && b - first <= tolerance {
                return Hit {
                    status: Status::Hit,
                    near: first,
                    far: b,
                    bounds: count[0],
                    bands: count[1],
                    high_water: water,
                };
            }
            if b - first > tolerance {
                return Hit {
                    status: Status::Unresolved,
                    near: first,
                    far: b,
                    bounds: count[0],
                    bands: count[1],
                    high_water: water,
                };
            }
        } else {
            let mid = (a + b) * 0.5;
            stack.push((mid, b));
            stack.push((a, mid));
            water = water.max(stack.len() as u32);
        }
    }
    Hit {
        status: if pending.is_some() {
            Status::Unresolved
        } else {
            Status::Miss
        },
        near: pending.unwrap_or(ray.far),
        far: ray.far,
        bounds: count[0],
        bands: count[1],
        high_water: water,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fast_noise_is_bit_identical_to_the_reference() {
        let mut x = 0x1234_5678u32;
        for i in 0..200_000u32 {
            x = crate::hash(x ^ i);
            let a = f64::from(x) / f64::from(u32::MAX) * 2e6 - 1e6;
            let b = f64::from(crate::hash(x)) / f64::from(u32::MAX) * 300.0 - 150.0;
            let c = f64::from(crate::hash(x ^ 7)) / f64::from(u32::MAX) * 9e5 - 4.5e5;
            let p = [a, b, c];
            assert_eq!(noise(p, i).to_bits(), noise_reference(p, i).to_bits());
        }
    }
    #[test]
    fn sphere_roots_are_enclosed_and_inside_exits_found() {
        let s = Solid {
            scene: 5,
            bands: 0,
            ..Solid::default()
        };
        for (o, d, expected) in [
            ([0.0, 0.0, 6.0], [0.0, 0.0, -1.0], 3.0),
            ([0.0; 3], [0.0, 0.0, 1.0], 3.0),
            ([2.0, 0.0, 6.0], [0.0, 0.0, -1.0], 6.0 - 5.0_f64.sqrt()),
        ] {
            let h = trace(
                s,
                Ray {
                    origin: o,
                    direction: d,
                    near: 0.0,
                    far: 20.0,
                },
                1e-4,
                10000,
                2,
            );
            assert_eq!(h.status, Status::Hit, "{h:?}");
            assert!(h.near <= expected && expected <= h.far);
            assert!(h.far - h.near <= 1e-4);
        }
    }
    #[test]
    fn tangent_is_not_a_fabricated_hit_or_miss() {
        let s = Solid {
            scene: 5,
            bands: 0,
            ..Solid::default()
        };
        let h = trace(
            s,
            Ray {
                origin: [3.0, 0.0, 6.0],
                direction: [0.0, 0.0, -1.0],
                near: 0.0,
                far: 20.0,
            },
            1e-4,
            10000,
            2,
        );
        assert_eq!(h.status, Status::Unresolved);
    }
    #[test]
    fn millimetre_sheet_is_not_skipped() {
        let s = Solid {
            scene: 6,
            bands: 0,
            ..Solid::default()
        };
        let h = trace(
            s,
            Ray {
                origin: [0.0, 1.0, 0.0],
                direction: [0.0, -1.0, 0.0],
                near: 0.0,
                far: 3.0,
            },
            1e-5,
            10000,
            2,
        );
        assert_eq!(h.status, Status::Hit);
        assert!(h.near <= 0.9995 && h.far >= 0.9995);
    }
    #[test]
    fn budget_saturation_is_explicit() {
        let h = trace(
            Solid::default(),
            Ray {
                origin: [0.0, 1.0, 6.0],
                direction: [0.0, 0.0, -1.0],
                near: 0.0,
                far: 20.0,
            },
            1e-4,
            1,
            2,
        );
        assert_eq!(h.status, Status::Unresolved);
    }
    #[test]
    fn segment_ranges_enclose_samples_across_csg_warp_and_lattice_edges() {
        for scene in 0..4 {
            for i in 0..100 {
                let s = Solid {
                    scene,
                    ..Solid::default()
                };
                let o = [i, i + 7, i + 41]
                    .map(|v| f64::from(hash(v)) / f64::from(u32::MAX) * 8.0 - 4.0);
                let ray = Ray {
                    origin: o,
                    direction: normalized([0.3, 0.7, -0.2]),
                    near: 0.0,
                    far: 0.63,
                };
                let range = s.range(ray, 0.0, 0.63, 2, &mut [0; 2]);
                for j in 0..21 {
                    let f = s.value(ray.at(0.63 * f64::from(j) / 20.0));
                    assert!(f >= range.lo && f <= range.hi, "{scene}: {f} {range:?}");
                }
            }
        }
    }
}

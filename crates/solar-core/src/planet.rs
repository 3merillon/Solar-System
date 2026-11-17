//! Integer body identity and finite, directly addressable geological bands.
use crate::{
    field::{self, V3},
    hash,
};
pub const EARTH_RADIUS: f64 = crate::body::PROCEDURAL_EARTH.radius;
pub const BANDS: usize = 24;
/// Relief and roughness bits, and the bands they produce.
type BandTable = (u64, u64, [(f64, f64, u32); BANDS]);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BodyAddress {
    pub sector: [i64; 3],
    pub body: u64,
}
impl BodyAddress {
    pub fn seed(self, seed: u32) -> u32 {
        self.sector
            .iter()
            .chain([self.body as i64].iter())
            .fold(seed, |s, &x| hash(s ^ x as u32 ^ (x as u64 >> 32) as u32))
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Geology {
    pub seed: u32,
    pub relief: f64,
    pub roughness: f64,
}
impl Default for Geology {
    fn default() -> Self {
        Self {
            seed: 2026,
            relief: 1.0,
            roughness: 0.48,
        }
    }
}
impl Geology {
    /// Band k: scale, amplitude and mode (1 for ridges). Memoized per thread: the
    /// variable-exponent powers cost more than the noise itself in per-sample loops.
    pub fn band(self, k: usize) -> (f64, f64, u32) {
        thread_local! {
            static TABLE: std::cell::Cell<BandTable> =
                const { std::cell::Cell::new((u64::MAX, u64::MAX, [(0.0, 0.0, 0); BANDS])) };
        }
        if k >= BANDS {
            return self.band_exact(k);
        }
        let key = (self.relief.to_bits(), self.roughness.to_bits());
        TABLE.with(|t| {
            let (relief, roughness, table) = t.get();
            if (relief, roughness) == key {
                return table[k];
            }
            let table = std::array::from_fn(|i| self.band_exact(i));
            t.set((key.0, key.1, table));
            table[k]
        })
    }
    pub fn band_exact(self, k: usize) -> (f64, f64, u32) {
        // Separate continental plates, folded mountain ridges and fine rock strata.
        let scale = 2_097_152.0 / 2.0_f64.powi(k as i32);
        let mut amp = if k == 0 {
            6500.0
        } else {
            2200.0 * self.roughness.powi(k as i32 - 1)
        } * self.relief;
        if k >= 8 {
            amp = amp.max(600.0 * self.roughness.powi(k as i32 - 8) * self.relief);
        }
        (scale, amp, if (2..9).contains(&k) { 1 } else { 0 })
    }
    pub fn height(self, p: V3) -> f64 {
        (0..BANDS)
            .map(|k| {
                let (s, a, mode) = self.band(k);
                let n = field::noise(field::mul(p, 1.0 / s), self.seed.wrapping_add(k as u32));
                a * if mode == 1 { 0.55 - n.abs() } else { n }
            })
            .sum()
    }
    pub fn lipschitz(self) -> f64 {
        (0..BANDS)
            .map(|k| {
                let (s, a, _) = self.band(k);
                a / s * 3.0 * 3.0_f64.sqrt()
            })
            .sum()
    }
    pub fn tail(self, from: usize) -> f64 {
        (from..BANDS).map(|k| self.band(k).1).sum()
    }
}
/// Exact finite trilinear-cubic local proxy. Coefficients are reconstructed from
/// the canonical integer lattice, so cold cuts need O(bands), not address depth.
#[derive(Clone, Copy, Debug)]
pub struct Proxy {
    pub cell: [i32; 3],
    pub phase: V3,
    pub corners: [f64; 8],
    pub value: f64,
    pub scale: f64,
    pub amplitude: f64,
    pub mode: u32,
}
impl Proxy {
    pub fn gradient(self) -> V3 {
        let t = self.phase.map(|f| f * f * (3.0 - 2.0 * f));
        let dt = self.phase.map(|f| 6.0 * f * (1.0 - f));
        std::array::from_fn(|axis| {
            let mut sum = 0.0;
            for i in 0..8 {
                let mut w = 1.0;
                for j in 0..3 {
                    let bit = (i >> j) & 1;
                    w *= if j == axis {
                        if bit == 0 {
                            -dt[j]
                        } else {
                            dt[j]
                        }
                    } else if bit == 0 {
                        1.0 - t[j]
                    } else {
                        t[j]
                    };
                }
                sum += self.corners[i] * w;
            }
            sum / self.scale
        })
    }
    pub fn new(g: Geology, origin: V3, k: usize) -> Self {
        let (scale, amplitude, mode) = g.band(k);
        let p = field::mul(origin, 1.0 / scale);
        let cell = p.map(|x| x.floor() as i32);
        let phase = p.map(|x| x - x.floor());
        let corners = std::array::from_fn(|i| {
            let c = std::array::from_fn::<_, 3, _>(|j| cell[j] + ((i >> j) & 1) as i32);
            f64::from(
                hash(
                    c[0] as u32
                        ^ hash(c[1] as u32 ^ hash(c[2] as u32 ^ g.seed.wrapping_add(k as u32))),
                ) >> 8,
            ) * (2.0 / 16_777_215.0)
                - 1.0
        });
        Self {
            cell,
            phase,
            corners,
            value: field::noise(p, g.seed.wrapping_add(k as u32)),
            scale,
            amplitude,
            mode,
        }
    }
}
/// Radial distance change without subtracting two Earth-sized lengths.
pub fn radial_delta(unit: V3, r: f64, offset: V3) -> f64 {
    let q = 2.0 * r * field::dot(unit, offset) + field::dot(offset, offset);
    q / ((r * r + q).sqrt() + r)
}

/// Independent f64 planetary oracle. Uses direct body coordinates, never the
/// shader's camera-local polynomial evaluation or its numerical padding.
#[derive(Clone, Copy)]
pub struct PlanetSolid {
    pub geology: Geology,
    pub radius: f64,
    pub feature: V3,
}
impl PlanetSolid {
    fn csg(self, p: V3, d: V3, base: field::Range, half: f64) -> field::Range {
        use field::{norm_range, Range};
        let p = field::sub(p, self.feature);
        let mut rough = Range::around(0.0, 0.0);
        for (k, (scale, amp)) in [(32.0, 7.0), (4.0, 0.8), (0.5, 0.1), (0.0625, 0.0125)]
            .into_iter()
            .enumerate()
        {
            let n = field::noise(
                field::mul(p, 1.0 / scale),
                self.geology.seed.wrapping_add(701 + k as u32),
            );
            let e = 3.0 * d.iter().map(|v| v.abs()).sum::<f64>() * half / scale;
            rough.lo += amp * (n - e).max(-1.0);
            rough.hi += amp * (n + e).min(1.0);
        }
        let displace = |r: Range, f: f64| Range {
            lo: r.lo + rough.lo * f,
            hi: r.hi + rough.hi * f,
        };
        let ellipsoid = |center: V3, axes: V3, scale: f64| {
            let q = std::array::from_fn(|i| (p[i] - center[i]) / axes[i]);
            let v = std::array::from_fn(|i| d[i] / axes[i]);
            let r = norm_range(q, v, half);
            Range {
                lo: (r.lo - 1.0) * scale,
                hi: (r.hi - 1.0) * scale,
            }
        };
        let mesa = displace(
            ellipsoid([0.0, 0.0, -90.0], [210.0, 70.0, 230.0], 70.0),
            1.0,
        );
        let basin = displace(
            ellipsoid([0.0, 10.0, 270.0], [310.0, 80.0, 175.0], 80.0),
            0.35,
        );
        let bore = norm_range([p[0], p[1] + 5.0, 0.0], [d[0], d[1], 0.0], half);
        let bore = displace(
            Range {
                lo: bore.lo - 24.0,
                hi: bore.hi - 24.0,
            },
            0.25,
        );
        let cap = Range {
            lo: (p[2].abs() - d[2].abs() * half).max(0.0) - 240.0,
            hi: p[2].abs() + d[2].abs() * half - 240.0,
        };
        let rock = displace(
            ellipsoid([46.0, 5.0, 190.0], [11.25, 16.875, 9.0], 9.0),
            0.3,
        );
        base.union(mesa)
            .intersect(basin.negate())
            .intersect(bore.intersect(cap).negate())
            .union(rock)
    }
}
impl field::FieldOracle for PlanetSolid {
    fn point_band_cost(&self) -> u32 {
        BANDS as u32 + 4
    }
    fn value(&self, p: V3) -> f64 {
        let f = field::length(p) - self.radius - self.geology.height(p);
        self.csg(p, [0.0; 3], field::Range::around(f, 0.0), 0.0).lo
    }
    fn range(
        &self,
        ray: field::Ray,
        a: f64,
        b: f64,
        _method: u32,
        counters: &mut [u32; 2],
    ) -> field::Range {
        use field::Range;
        counters[0] += 1;
        let half = (b - a) * 0.5;
        let p = ray.at((a + b) * 0.5);
        let radial = field::norm_range(p, ray.direction, half);
        let mut r = Range {
            lo: radial.lo - self.radius,
            hi: radial.hi - self.radius,
        };
        for k in 0..=BANDS {
            let tail = self.geology.tail(k) + 1e-7;
            let result = self.csg(
                p,
                ray.direction,
                Range {
                    lo: r.lo - tail,
                    hi: r.hi + tail,
                },
                half,
            );
            if k == BANDS || result.excludes_zero() {
                return result;
            }
            let (scale, amp, mode) = self.geology.band(k);
            let n = field::noise(
                field::mul(p, 1.0 / scale),
                self.geology.seed.wrapping_add(k as u32),
            );
            let e = 3.0 * ray.direction.iter().map(|v| v.abs()).sum::<f64>() * half / scale;
            let mut lo = (n - e).max(-1.0);
            let mut hi = (n + e).min(1.0);
            if mode == 1 {
                let minabs = if lo <= 0.0 && hi >= 0.0 {
                    0.0
                } else {
                    lo.abs().min(hi.abs())
                };
                let maxabs = lo.abs().max(hi.abs());
                lo = 0.55 - maxabs;
                hi = 0.55 - minabs;
            }
            r.lo -= amp * hi;
            r.hi -= amp * lo;
            counters[1] += 1;
        }
        unreachable!()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn earth_radius_millimetre_queries_do_not_subtract_large_floats() {
        let d = radial_delta([0.0, 1.0, 0.0], EARTH_RADIUS, [0.001, 0.001, 0.001]);
        assert!((d - 0.001).abs() < 1e-11);
    }
    #[test]
    fn body_identity_is_independent_of_camera_and_unvisited_bodies() {
        let a = BodyAddress {
            sector: [i64::MAX / 2, -42, 17],
            body: 0xffff_ffff_0000_0001,
        };
        assert_eq!(a.seed(2026), a.seed(2026));
        assert_ne!(
            a.seed(2026),
            BodyAddress {
                body: a.body + 1,
                ..a
            }
            .seed(2026)
        );
    }
    #[test]
    fn finite_geology_has_declared_derivative_and_tail_bounds() {
        let g = Geology::default();
        assert!(g.lipschitz() < 10.0);
        assert_eq!(g.tail(BANDS), 0.0);
        for i in 0..100 {
            let p = [
                f64::from(hash(i)) * 0.01,
                EARTH_RADIUS,
                f64::from(i) * 317.0,
            ];
            let d = [0.001, 0.0, 0.0];
            assert!(
                (g.height(field::add(p, d)) - g.height(p)).abs() <= g.lipschitz() * 0.001 + 1e-8
            );
        }
    }
}

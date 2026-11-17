//! Single-valued radial surface. Independent f64 reference; no rendering code.
use crate::{
    field::{self, V3},
    planet::{Geology, BANDS, EARTH_RADIUS},
    surface::{ClipmapEnvelope, FieldAnswer, Served, SurfaceSource},
};

#[derive(Clone, Debug)]
pub struct Skin {
    pub geology: Geology,
    pub radius: f64,
    /// Durable, bounded radial brush edits: unit direction, radius metres, delta metres.
    pub edits: Vec<[f64; 5]>,
}
impl Default for Skin {
    fn default() -> Self {
        Self {
            geology: Geology::default(),
            radius: EARTH_RADIUS,
            edits: Vec::new(),
        }
    }
}
impl Skin {
    pub fn spacing(&self, level: u32) -> f64 {
        self.radius * 2.0 / f64::from(crate::patches::GRID << level)
    }
    /// Smooth low pass shared by geometry and its cached analytic gradient.
    pub fn weight(scale: f64, spacing: f64) -> f64 {
        let t = ((scale / spacing.max(1e-12) - 1.0) / 3.0).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }
    pub fn height(&self, n: V3, spacing: f64) -> f64 {
        let p = field::mul(n, self.radius);
        let mut h = 0.0;
        for k in 0..BANDS {
            let (scale, amp, mode) = self.geology.band(k);
            let w = Self::weight(scale, spacing);
            // Ridge bands have a positive DC component. Dropping the entire
            // band lifted whole patches as they refined. Retain a declared
            // 0.25 mean estimate and filter only its residual. This is not an
            // exact stochastic integral; the existing amplitude bound encloses
            // both the estimate and the realized ridge in [-0.45, 0.55].
            if mode == 1 {
                h += amp * 0.25 * (1.0 - w);
            }
            if w == 0.0 {
                continue;
            }
            let v = field::noise(
                field::mul(p, 1.0 / scale),
                self.geology.seed.wrapping_add(k as u32),
            );
            h += amp * w * if mode == 1 { 0.55 - v.abs() } else { v };
        }
        for e in &self.edits {
            let d =
                field::length(field::sub(p, field::mul([e[0], e[1], e[2]], self.radius))) / e[3];
            let t = (1.0 - d * d).max(0.0);
            h += e[4] * t * t;
        }
        h
    }
    pub fn position(&self, n: V3, spacing: f64) -> V3 {
        field::mul(n, self.radius + self.height(n, spacing))
    }
    pub fn residual(&self, spacing: f64) -> f64 {
        (0..BANDS)
            .map(|k| {
                let (s, a, _) = self.geology.band(k);
                a * (1.0 - Self::weight(s, spacing))
            })
            .sum()
    }
    pub fn height_bound(&self) -> f64 {
        self.geology.tail(0) + self.edits.iter().map(|e| e[4].abs()).sum::<f64>()
    }
    /// Lipschitz bound, per metre of 3D distance between p = n R points, of the field
    /// filtered at `spacing`: each noise partial is at most 3 per band scale, edits 4|d|/r.
    pub fn filtered_lipschitz(&self, spacing: f64) -> f64 {
        let mut l: f64 = self.edits.iter().map(|e| 4.0 * e[4].abs() / e[3]).sum();
        for k in 0..BANDS {
            let (scale, amp, _) = self.geology.band(k);
            l += amp * Self::weight(scale, spacing) * 3.0 * 3.0_f64.sqrt() / scale;
        }
        l
    }
    /// Interval of the unfiltered height over the cap of `radius` metres of arc around
    /// `n`: h_s(n) +- (residual(s) + L_s r). |h_0 - h_s| <= residual(s) at every point
    /// (tested) and h_s moves by at most L_s per metre of chord, chord <= arc.
    pub fn region_interval(&self, n: V3, radius: f64) -> (f64, f64) {
        let r = radius.max(0.0);
        let bound = self.height_bound();
        // Filtering at the cap's own size balances the two terms within a small factor.
        let s = r.max(0.25);
        let h = self.height(n, s);
        let e = self.residual(s) + self.filtered_lipschitz(s) * r;
        ((h - e).max(-bound), (h + e).min(bound))
    }
    pub fn gradient_bound(&self) -> f64 {
        self.geology.lipschitz()
            + self
                .edits
                .iter()
                .map(|e| 4.0 * e[4].abs() / e[3])
                .sum::<f64>()
    }
    /// Conservative linear-interpolation height error using the Lipschitz bound
    /// for abs ridges and C1 cubic Hessian elsewhere, plus spherical chord error.
    /// The edge length covers the cube-map derivative and diagonal. Not a visibility proof.
    pub fn error_bound(&self, level: u32) -> f64 {
        let d = self.spacing(level) * 2.0_f64.sqrt();
        let mut e = d * d / (2.0 * self.radius) + self.residual(self.spacing(level));
        for k in 0..BANDS {
            let (s, a, mode) = self.geology.band(k);
            let w = Self::weight(s, self.spacing(level));
            let term = if mode == 1 {
                3.0 * 3.0_f64.sqrt() * d / s
            } else {
                15.0 * d * d / (s * s) + 6.0 * d * d / (s * self.radius)
            };
            e += a * w * term.min(2.0);
        }
        e + self
            .edits
            .iter()
            .map(|v| (4.0 * v[4].abs() * d / v[3]).min(2.0 * v[4].abs()))
            .sum::<f64>()
    }
    /// One sun clipmap level at spacing `step`. The receiver's own filtered spectrum
    /// is added per receiver on the GPU instead of assuming the worst footprint of
    /// the level. The guard is 2 cm of position for the double-single producer.
    pub fn clipmap_envelope(&self, step: f64, live_start: usize) -> ClipmapEnvelope {
        let guard = 0.02 * self.gradient_bound();
        let d = step * 2.0f64.sqrt();
        let producer = (step * 0.25).max(0.25);
        let edit_term = self
            .edits
            .iter()
            .map(|e| (4.0 * e[4].abs() * d / e[3]).min(2.0 * e[4].abs()))
            .sum::<f64>();
        let mut full = guard + edit_term;
        let mut live = full;
        let mut margin = 0.0;
        for k in 0..BANDS {
            let (scale, amplitude, ridge) = self.geology.band(k);
            let source = Self::weight(scale, producer);
            let interpolation = if ridge == 1 {
                3.0 * 3.0f64.sqrt() * d / scale
            } else {
                15.0 * d * d / (scale * scale) + 6.0 * d * d / (scale * self.radius)
            };
            let error = amplitude * (source * interpolation.min(2.0) + 1.0 - source);
            full += error;
            margin += amplitude * (1.0 - (std::f64::consts::PI * (step / scale).min(1.0)).cos());
            if !(k == 8 || k >= live_start) {
                live += error;
            }
        }
        ClipmapEnvelope {
            full,
            live,
            margin,
            conservative: true,
        }
    }
}
impl SurfaceSource for Skin {
    fn radius(&self) -> f64 {
        self.radius
    }
    fn query(&self, n: V3, spacing: f64) -> FieldAnswer {
        FieldAnswer {
            height: Skin::height(self, n, spacing),
            served: Served::Analytic,
        }
    }
    fn height_bound(&self) -> Option<f64> {
        Some(Skin::height_bound(self))
    }
    fn gradient_bound(&self) -> Option<f64> {
        Some(Skin::gradient_bound(self))
    }
    fn region_bounds(&self, n: V3, radius: f64) -> Option<(f64, f64)> {
        Some(self.region_interval(n, radius))
    }
    fn level_error_bound(&self, level: u32) -> Option<f64> {
        Some(self.error_bound(level))
    }
    fn clipmap_envelope(&self, step: f64, live_start: usize) -> ClipmapEnvelope {
        Skin::clipmap_envelope(self, step, live_start)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn radial_function_and_filter_residual() {
        let s = Skin::default();
        for i in 0..200 {
            let n = field::normalized([
                ((i * 73 % 97) as f64) - 48.0,
                17.0,
                ((i * 41 % 101) as f64) - 50.0,
            ]);
            let full = s.height(n, 0.0);
            assert!(full.abs() <= s.height_bound());
            for l in [0, 4, 9, 16, 20] {
                assert!(
                    (full - s.height(n, s.spacing(l))).abs() <= s.residual(s.spacing(l)) + 1e-8
                );
            }
            assert!((field::length(s.position(n, 0.0)) - s.radius - full).abs() < 2e-9);
        }
    }
    #[test]
    fn bounds_finite_and_edit_support_continuous() {
        let mut s = Skin::default();
        s.edits.push([0.0, 1.0, 0.0, 100.0, 20.0]);
        assert!(s.gradient_bound().is_finite());
        for l in 0..=20 {
            assert!(s.error_bound(l).is_finite());
        }
        assert_eq!(
            s.height([0.0, 1.0, 0.0], 0.0) - Skin::default().height([0.0, 1.0, 0.0], 0.0),
            20.0
        );
    }
}

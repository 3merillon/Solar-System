//! Transport contracts, independent from rendering and quadrature policy.
#[derive(Clone, Copy, Debug)]
pub struct Medium {
    pub extinction: f64,
    pub scattering: f64,
    pub emission: f64,
    pub incoming_bound: Option<f64>,
    pub phase_bound: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct OpticalBound {
    pub removed_transmittance: f64,
    pub added_radiance: Option<f64>,
}
impl Medium {
    pub fn bound(self, length: f64) -> OpticalBound {
        assert!(
            length >= 0.0
                && self.extinction >= 0.0
                && self.scattering >= 0.0
                && self.scattering <= self.extinction
                && self.emission >= 0.0
        );
        let removed = -(-self.extinction * length).exp_m1();
        let integrated = if self.extinction > 0.0 {
            removed / self.extinction
        } else {
            length
        };
        OpticalBound {
            removed_transmittance: removed,
            added_radiance: self
                .incoming_bound
                .map(|i| (self.scattering * self.phase_bound * i + self.emission) * integrated),
        }
    }
}
pub fn homogeneous(
    transmittance: f64,
    radiance: f64,
    sigma: f64,
    source: f64,
    distance: f64,
) -> (f64, f64) {
    let t = (-sigma * distance).exp();
    let integral = if sigma > 0.0 {
        -(-sigma * distance).exp_m1() / sigma
    } else {
        distance
    };
    (
        transmittance * t,
        radiance + transmittance * source * integral,
    )
}
pub fn hg_phase_max(g: f64) -> f64 {
    let a = g.abs();
    assert!(a < 1.0);
    (1.0 + a) / (4.0 * std::f64::consts::PI * (1.0 - a).powi(2))
}
/// Unpolarized dielectric reflectance, including the continuous critical-angle
/// limit. `eta` is incident/transmitted index of refraction.
pub fn dielectric_fresnel(cosine: f64, eta: f64) -> f64 {
    assert!(eta > 0.0 && eta.is_finite());
    let ci = cosine.clamp(0.0, 1.0);
    let sin_transmitted_squared = eta * eta * (1.0 - ci * ci);
    if sin_transmitted_squared >= 1.0 {
        return 1.0;
    }
    let ct = (1.0 - sin_transmitted_squared).sqrt();
    let rs = (eta * ci - ct) / (eta * ci + ct).max(1e-15);
    let rp = (ci - eta * ct) / (ci + eta * ct).max(1e-15);
    (rs * rs + rp * rp) * 0.5
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn water_reflectance_reaches_total_reflection_continuously() {
        let eta: f64 = 1.333;
        let critical = (1.0 - 1.0 / (eta * eta)).sqrt();
        assert!((dielectric_fresnel(1.0, eta) - ((eta - 1.0) / (eta + 1.0)).powi(2)).abs() < 1e-14);
        assert_eq!(dielectric_fresnel(critical - 1e-6, eta), 1.0);
        assert!(dielectric_fresnel(critical + 1e-10, eta) > 0.9998);
        let mut previous = 1.0;
        for i in 0..10000 {
            let c = critical + (1.0 - critical) * i as f64 / 9999.0;
            let reflectance = dielectric_fresnel(c, eta);
            assert!(reflectance <= previous + 1e-14 && (0.0..=1.0).contains(&reflectance));
            previous = reflectance;
        }
    }
    #[test]
    fn extinction_alone_cannot_certify_radiance_skipping() {
        let m = Medium {
            extinction: 0.001,
            scattering: 0.001,
            emission: 0.0,
            incoming_bound: None,
            phase_bound: hg_phase_max(0.8),
        };
        assert!(m.bound(1.0).added_radiance.is_none());
        let bright = Medium {
            incoming_bound: Some(1e6),
            ..m
        };
        assert!(bright.bound(1.0).added_radiance.unwrap() > 1.0);
    }
    #[test]
    fn homogeneous_partition_and_additive_media_are_consistent() {
        let whole = homogeneous(1.0, 0.0, 0.2 + 0.3, 0.4 + 0.5, 4.0);
        let mut pieces = (1.0, 0.0);
        for _ in 0..64 {
            pieces = homogeneous(pieces.0, pieces.1, 0.5, 0.9, 4.0 / 64.0);
        }
        assert!((whole.0 - pieces.0).abs() < 1e-14);
        assert!((whole.1 - pieces.1).abs() < 1e-14);
    }
}

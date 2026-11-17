//! Arbitrary-topology diagnostic. Scalar fields are NOT assumed to be SDFs.
//! Bounds rely on a declared Lipschitz bound; they are real-arithmetic bounds.

#[derive(Clone, Copy, Debug)]
pub struct Region {
    pub center: [f64; 3],
    pub half_extent: [f64; 3],
}

#[derive(Clone, Copy, Debug)]
pub struct Interval {
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Classification {
    Empty,
    Solid,
    Boundary,
}

impl Interval {
    pub fn classification(self) -> Classification {
        if self.min > 0.0 {
            Classification::Empty
        } else if self.max < 0.0 {
            Classification::Solid
        } else {
            Classification::Boundary
        }
    }
}

/// Research contract: the implementer must supply a valid bound on |grad f|.
/// Unknown bounds must remain unknown in a production oracle; never guess one.
pub trait BoundedField {
    fn value(&self, point: [f64; 3]) -> f64;
    fn lipschitz_bound(&self) -> f64;

    fn enclose(&self, region: Region) -> Interval {
        assert!(region
            .half_extent
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0));
        let radius = region.half_extent.iter().map(|v| v * v).sum::<f64>().sqrt();
        let middle = self.value(region.center);
        let uncertainty = self.lipschitz_bound() * radius;
        Interval {
            min: middle - uncertainty,
            max: middle + uncertainty,
        }
    }
}

/// Sphere with a cylindrical tunnel through it. This has multiple crossings
/// along some radial rays, so it cannot be represented by one radial height.
pub struct BoredSphere {
    pub radius: f64,
    pub tunnel_radius: f64,
}

impl BoundedField for BoredSphere {
    fn value(&self, [x, y, z]: [f64; 3]) -> f64 {
        let sphere = (x * x + y * y + z * z).sqrt() - self.radius;
        let cylinder = (y * y + z * z).sqrt() - self.tunnel_radius;
        sphere.max(-cylinder)
    }

    // max(f, -g) remains 1-Lipschitz if both f and g are 1-Lipschitz.
    fn lipschitz_bound(&self) -> f64 {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bore_is_a_real_hole_in_the_solid_field() {
        let field = BoredSphere {
            radius: 3.0,
            tunnel_radius: 0.75,
        };
        assert!(field.value([0.0, 0.0, 0.0]) > 0.0);
        assert!(field.value([0.0, 1.0, 0.0]) < 0.0);
        assert!(field.value([4.0, 1.0, 0.0]) > 0.0);
        // From the centre: void -> tunnel wall -> solid -> exterior.
        assert!(field.value([0.0, 0.5, 0.0]) > 0.0);
        assert!(field.value([0.0, 2.0, 0.0]) < 0.0);
        assert!(field.value([0.0, 3.5, 0.0]) > 0.0);
    }

    #[test]
    fn region_envelopes_enclose_samples_on_both_sides_of_tunnel_and_surface() {
        let field = BoredSphere {
            radius: 3.0,
            tunnel_radius: 0.75,
        };
        for index in 0..256_u32 {
            let center = [index, index + 17, index + 71]
                .map(|v| f64::from(crate::hash(v)) / f64::from(u32::MAX) * 8.0 - 4.0);
            let half_extent = [0.25, 0.125, 0.5];
            let bounds = field.enclose(Region {
                center,
                half_extent,
            });
            for x in [-1.0, 0.0, 1.0] {
                for y in [-1.0, 0.0, 1.0] {
                    for z in [-1.0, 0.0, 1.0] {
                        let point = [
                            center[0] + x * half_extent[0],
                            center[1] + y * half_extent[1],
                            center[2] + z * half_extent[2],
                        ];
                        let value = field.value(point);
                        assert!(value >= bounds.min - 1e-12 && value <= bounds.max + 1e-12);
                    }
                }
            }
        }
    }

    #[test]
    fn boundary_is_not_misreported_as_empty() {
        let field = BoredSphere {
            radius: 3.0,
            tunnel_radius: 0.75,
        };
        assert_eq!(
            field
                .enclose(Region {
                    center: [0.0, 0.75, 0.0],
                    half_extent: [0.1; 3]
                })
                .classification(),
            Classification::Boundary
        );
        assert_eq!(
            field
                .enclose(Region {
                    center: [0.0, 0.0, 0.0],
                    half_extent: [0.1; 3]
                })
                .classification(),
            Classification::Empty
        );
        assert_eq!(
            field
                .enclose(Region {
                    center: [0.0, 2.0, 0.0],
                    half_extent: [0.1; 3]
                })
                .classification(),
            Classification::Solid
        );
    }
}

//! Deterministic lazy residual bounds versus full-spectrum sphere tracing.
//! The result is a field-residual candidate, NOT a certified ray intersection.

use crate::implicit::{BoredSphere, BoundedField};

const BANDS: u32 = 16;
const AMPLITUDE: f64 = 0.18;
const RATIO: f64 = 0.58;

fn band_amplitude(band: u32) -> f64 {
    AMPLITUDE * RATIO.powi(band as i32)
}

fn band_value(point: [f64; 3], band: u32) -> f64 {
    let frequency = 0.7 * 2.0_f64.powi(band as i32);
    band_amplitude(band)
        * (point[0] * frequency + 0.31).sin()
        * (point[1] * frequency + 0.73).sin()
        * (point[2] * frequency + 1.27).sin()
}

fn base(point: [f64; 3]) -> f64 {
    BoredSphere {
        radius: 3.0,
        tunnel_radius: 0.75,
    }
    .value(point)
}

pub fn full_field(point: [f64; 3]) -> f64 {
    base(point) + (0..BANDS).map(|band| band_value(point, band)).sum::<f64>()
}

fn tail(bands: u32) -> f64 {
    if bands == BANDS {
        return 0.0;
    }
    band_amplitude(bands) * (1.0 - RATIO.powi((BANDS - bands) as i32)) / (1.0 - RATIO)
}

fn band_lipschitz(band: u32) -> f64 {
    3.0_f64.sqrt() * band_amplitude(band) * 0.7 * 2.0_f64.powi(band as i32)
}

#[derive(Clone, Copy, Debug)]
pub struct Clearance {
    pub distance: f64,
    pub field_value: f64,
    pub bands: u32,
}

/// If g is the evaluated prefix, |remainder| <= E and Lip(g) <= L,
/// every point less than (g(p)-E)/L away remains outside the complete field.
/// The omitted remainder's derivative does not enter this particular bound.
/// Floating point roundoff is not covered by this real-arithmetic derivation.
pub fn clearance(point: [f64; 3], lazy: bool, resolution: f64) -> Clearance {
    let mut value = base(point);
    let mut lipschitz = 1.0;
    for bands in 0..=BANDS {
        let distance = ((value - tail(bands)) / lipschitz).max(0.0);
        if bands == BANDS || (lazy && distance > resolution * 4.0) {
            return Clearance {
                distance,
                field_value: value,
                bands,
            };
        }
        value += band_value(point, bands);
        lipschitz += band_lipschitz(bands);
    }
    unreachable!()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    ResidualCandidate,
    Miss,
    BudgetExhausted,
    StartedInside,
}

#[derive(Clone, Copy, Debug)]
pub struct Trace {
    pub status: Status,
    pub steps: u32,
    pub band_evaluations: u64,
}

/// Finite diagnostic rays in a small local frame. This is not a planetary
/// coordinate implementation. Budget exhaustion is exposed, never a miss.
pub fn trace(origin: [f64; 3], direction: [f64; 3], lazy: bool) -> Trace {
    let direction_length = direction.iter().map(|v| v * v).sum::<f64>().sqrt();
    assert!((direction_length - 1.0).abs() < 1e-10);
    let resolution = 1e-4;
    let mut distance = 0.0;
    let mut evaluations = 0;
    for step in 1..=2048 {
        let point = std::array::from_fn(|axis| origin[axis] + direction[axis] * distance);
        let bound = clearance(point, lazy, resolution);
        evaluations += u64::from(bound.bands);
        let status = if bound.bands == BANDS && bound.field_value < -resolution {
            Some(Status::StartedInside)
        } else if bound.bands == BANDS && bound.field_value.abs() <= resolution {
            Some(Status::ResidualCandidate)
        } else if distance + bound.distance > 20.0 {
            Some(Status::Miss)
        } else {
            None
        };
        if let Some(status) = status {
            return Trace {
                status,
                steps: step,
                band_evaluations: evaluations,
            };
        }
        // Never force a minimum step: that could skip a thin surface.
        if bound.distance <= 0.0 {
            return Trace {
                status: Status::BudgetExhausted,
                steps: step,
                band_evaluations: evaluations,
            };
        }
        distance += bound.distance * (1.0 - 1e-10);
    }
    Trace {
        status: Status::BudgetExhausted,
        steps: 2048,
        band_evaluations: evaluations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampled_points_inside_clearance_balls_do_not_cross_full_surface() {
        for index in 0..384_u32 {
            let point = [index, index + 37, index + 71]
                .map(|v| f64::from(crate::hash(v)) / f64::from(u32::MAX) * 12.0 - 6.0);
            let bound = clearance(point, true, 1e-4);
            if bound.distance <= 0.0 {
                continue;
            }
            for direction in [
                [1.0, 0.0, 0.0],
                [-1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [0.6, 0.8, 0.0],
            ] {
                let sample = std::array::from_fn(|axis| {
                    point[axis] + direction[axis] * bound.distance * 0.99
                });
                assert!(full_field(sample) > -1e-10);
            }
        }
    }

    #[test]
    fn lazy_bounds_skip_fine_evaluation_in_certifiably_empty_space() {
        let lazy = clearance([8.0, 0.0, 0.0], true, 1e-4);
        let full = clearance([8.0, 0.0, 0.0], false, 1e-4);
        assert_eq!(lazy.bands, 0);
        assert_eq!(full.bands, BANDS);
        assert!(lazy.distance > full.distance);
    }
}

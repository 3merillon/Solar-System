//! Submission-owned camera history. Absolute body coordinates never reach reprojection.
use solar_core::field::{self, V3};
pub fn halton(mut index: u32, base: u32) -> f32 {
    let mut value = 0.0;
    let mut weight = 1.0;
    while index > 0 {
        weight /= base as f32;
        value += weight * (index % base) as f32;
        index /= base;
    }
    value
}
pub fn jitter(phase: u32, output_width: u32, input_width: u32) -> [f32; 2] {
    let ratio = output_width as f32 / input_width as f32;
    let count = (8.0 * ratio * ratio).round().max(16.0) as u32;
    [
        halton(phase % count + 1, 2) - 0.5,
        halton(phase % count + 1, 3) - 0.5,
    ]
}
pub fn project(q: V3, right: V3, up: V3, forward: V3, tan: f64, aspect: f64) -> [f64; 2] {
    let z = field::dot(q, forward);
    [
        0.5 + field::dot(q, right) / (2.0 * z * tan * aspect),
        0.5 - field::dot(q, up) / (2.0 * z * tan),
    ]
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unjittered_motion_and_rebase() {
        let r = [1.0, 0.0, 0.0];
        let u = [0.0, 1.0, 0.0];
        let f = [0.0, 0.0, -1.0];
        let before = project([0.0, 0.0, -10.0], r, u, f, 1.0, 1.0);
        let after = project([-1.0, 0.0, -10.0], r, u, f, 1.0, 1.0);
        assert!((before[0] - after[0] - 0.05).abs() < 1e-12);
        // Different 4096 m origins describe one physical point and camera.
        let world = [4096.001, 6_371_001.0, 17.0];
        let eye = [4096.0, 6_371_001.0, 27.0];
        let q = field::sub(world, eye);
        let shifted = field::sub(
            field::sub(world, [4096.0, 0.0, 0.0]),
            field::sub(eye, [4096.0, 0.0, 0.0]),
        );
        assert_eq!(
            project(q, r, u, f, 1.0, 1.0),
            project(shifted, r, u, f, 1.0, 1.0)
        );
    }
    #[test]
    fn jitter_is_bounded_repeatable_and_scale_dependent() {
        for width in [1920, 1478, 1286, 960] {
            for i in 0..64 {
                assert!(jitter(i, 1920, width).iter().all(|x| x.abs() <= 0.5));
            }
        }
        assert_eq!(jitter(0, 1920, 1920), jitter(16, 1920, 1920));
        assert_eq!(jitter(0, 1920, 960), jitter(32, 1920, 960));
    }
}

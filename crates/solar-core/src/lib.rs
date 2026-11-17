//! Reference experiments for a procedurally addressed planetary surface.
//! This is a technology investigation, not a terrain renderer.

use std::f64::consts::TAU;

pub mod body;
pub mod candidates;
pub mod celestial;
pub mod ephemeris;
pub mod erosion;
pub mod field;
pub mod flight;
pub mod galaxy;
pub mod implicit;
pub mod optics;
pub mod pages;
pub mod patches;
pub mod planet;
pub mod skin;
pub mod stars;
pub mod streaming;
pub mod surface;
pub mod tracing;
pub mod trip;

/// A periodic surface coordinate in Q0.64. No spatial nodes are allocated.
/// The address has a finite 64-bit resolution; it is not infinite precision.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Coordinate(pub u64);

impl Coordinate {
    pub fn words(self) -> [u32; 2] {
        [(self.0 >> 32) as u32, self.0 as u32]
    }

    /// Fractional part of coordinate * 2^band, evaluated in integers first.
    pub fn phase(self, band: u32) -> f64 {
        assert!(band < 64);
        let shifted = self.0.wrapping_shl(band);
        let hi = (shifted >> 32) as u32;
        let lo = shifted as u32;
        f64::from(hi) * 2.0_f64.powi(-32) + f64::from(lo) * 2.0_f64.powi(-64)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SurfaceAddress {
    pub body: u128,
    pub chart: u8,
    pub u: Coordinate,
    pub v: Coordinate,
}

/// A deliberately simple analytic diagnostic. It is not realistic terrain.
/// h(u,v) = sum A*r^k*sin(tau*2^k*u+phase)*sin(tau*2^k*v+phase).
/// All spectral tails below assume this exact construction, with no domain warp.
#[derive(Clone, Copy, Debug)]
pub struct Spectrum {
    amplitude: f64,
    ratio: f64,
    seed: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct Approximation {
    pub height: f64,
    /// Infinite omitted series, bounded in height units under real arithmetic.
    /// Floating-point evaluation requires an additional numerical error budget.
    pub remainder: f64,
    pub evaluated_bands: u32,
}

impl Spectrum {
    pub fn new(amplitude: f64, ratio: f64, seed: u32) -> Result<Self, &'static str> {
        if !amplitude.is_finite()
            || amplitude < 0.0
            || !ratio.is_finite()
            || !(0.0..1.0).contains(&ratio)
        {
            return Err("need finite amplitude >= 0 and finite ratio in [0, 1)");
        }
        Ok(Self {
            amplitude,
            ratio,
            seed,
        })
    }

    pub fn remainder(self, bands: u32) -> f64 {
        self.amplitude * self.ratio.powf(f64::from(bands)) / (1.0 - self.ratio)
    }

    /// Upper bound for gradient of the omitted series per unit chart coordinate.
    /// A convergent height series need not have a convergent derivative bound.
    pub fn gradient_remainder(self, bands: u32) -> Option<f64> {
        if self.amplitude == 0.0 {
            return Some(0.0);
        }
        let gradient_ratio = 2.0 * self.ratio;
        if gradient_ratio >= 1.0 {
            return None;
        }
        Some(
            2.0_f64.sqrt() * TAU * self.amplitude * gradient_ratio.powf(f64::from(bands))
                / (1.0 - gradient_ratio),
        )
    }

    pub fn approximate(self, u: Coordinate, v: Coordinate, bands: u32) -> Approximation {
        assert!(bands <= 64);
        let mut amplitude = self.amplitude;
        let mut height = 0.0;
        for band in 0..bands {
            let phase = f64::from(hash(self.seed.wrapping_add(band))) / 4_294_967_296.0;
            height += amplitude
                * (TAU * (u.phase(band) + phase)).sin()
                * (TAU * (v.phase(band) + phase * 0.5)).sin();
            amplitude *= self.ratio;
        }
        Approximation {
            height,
            remainder: self.remainder(bands),
            evaluated_bands: bands,
        }
    }

    /// Smallest prefix passing a height tolerance. This does not certify shading,
    /// silhouette coverage, topology or a screen-space rendering error.
    pub fn bands_for_height_error(self, tolerance: f64) -> Option<u32> {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return None;
        }
        (0..=64).find(|&bands| self.remainder(bands) <= tolerance)
    }
}

pub fn hash(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

/// Number of binary scale changes, without constructing intermediate cells.
pub fn scale_depth(span_m: f64, detail_m: f64) -> Option<u32> {
    if !span_m.is_finite() || !detail_m.is_finite() || span_m <= 0.0 || detail_m <= 0.0 {
        return None;
    }
    let depth = (span_m.log2() - detail_m.log2()).ceil().max(0.0);
    (depth <= 64.0).then_some(depth as u32)
}

/// Two-part position. Subtract matching parts before combining on the GPU.
/// This handles a local body frame, not arbitrary universe positions in f64.
pub fn split_position(value: f64) -> Option<[f32; 2]> {
    if !value.is_finite() || value.abs() > f64::from(f32::MAX) {
        return None;
    }
    let hi = value as f32;
    Some([hi, (value - f64::from(hi)) as f32])
}

/// Explicit resource exhaustion. Never silently delete visible surface work.
#[derive(Debug)]
pub struct WorkQueue<T> {
    items: Vec<T>,
    limit: usize,
}

impl<T> WorkQueue<T> {
    pub fn new(limit: usize) -> Self {
        Self {
            items: Vec::with_capacity(limit),
            limit,
        }
    }
    pub fn try_push(&mut self, value: T) -> Result<(), T> {
        if self.items.len() == self.limit {
            return Err(value);
        }
        self.items.push(value);
        Ok(())
    }
    pub fn pop(&mut self) -> Option<T> {
        self.items.pop()
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spectral_envelopes_enclose_the_unsampled_finite_reference() {
        for ratio in [0.35, 0.5, 0.65, 0.85] {
            let spectrum = Spectrum::new(8_000.0, ratio, 123).unwrap();
            for index in 0..256_u32 {
                let u = Coordinate((u64::from(hash(index)) << 32) | u64::from(hash(index + 7919)));
                let v =
                    Coordinate((u64::from(hash(index + 17)) << 32) | u64::from(hash(index + 23)));
                let full = spectrum.approximate(u, v, 64).height;
                for bands in [0, 1, 4, 12, 24, 40, 56] {
                    let partial = spectrum.approximate(u, v, bands);
                    assert!((full - partial.height).abs() <= partial.remainder + 1e-9);
                }
            }
        }
    }

    #[test]
    fn height_convergence_does_not_imply_normal_convergence() {
        let rough = Spectrum::new(8_000.0, 0.65, 1).unwrap();
        assert!(rough.remainder(48) < 0.0001);
        assert!(rough.gradient_remainder(48).is_none());
        assert!(Spectrum::new(8_000.0, 0.35, 1)
            .unwrap()
            .gradient_remainder(48)
            .is_some());
    }

    #[test]
    fn dyadic_phases_preserve_deep_coordinate_bits() {
        let a = Coordinate(0x1234_5678_0000_0000);
        let b = Coordinate(a.0 + 1);
        assert_ne!(a.phase(63), b.phase(63));
        assert_eq!(b.words(), [0x1234_5678, 1]);
        // Converting the full address to f32 first would erase this difference.
        assert_eq!(a.0 as f32, b.0 as f32);
    }

    #[test]
    fn depth_is_address_size_not_node_count() {
        assert_eq!(scale_depth(40_075_017.0, 0.001), Some(36));
        assert_eq!(scale_depth(1e18, 1.0), Some(60));
        assert_eq!(scale_depth(1e30, 0.001), None);
        assert_eq!(scale_depth(f64::INFINITY, 1.0), None);
    }

    #[test]
    fn local_split_preserves_millimetres_at_earth_radius() {
        let value = 6_371_000.001_234;
        let split = split_position(value).unwrap();
        assert!((f64::from(split[0]) + f64::from(split[1]) - value).abs() < 1e-9);
        assert!((f64::from(value as f32) - value).abs() > 0.001);
        assert!(split_position(f64::NAN).is_none());
    }

    #[test]
    fn saturation_is_explicit_and_does_not_destroy_existing_work() {
        let mut queue = WorkQueue::new(2);
        assert_eq!(queue.try_push(1), Ok(()));
        assert_eq!(queue.try_push(2), Ok(()));
        assert_eq!(queue.try_push(3), Err(3));
        assert_eq!(queue.len(), 2);
        assert_eq!(queue.pop(), Some(2));
        assert_eq!(queue.pop(), Some(1));
        assert!(queue.is_empty());
    }

    #[test]
    fn height_budget_chooses_a_minimal_prefix_and_rejects_unrepresentable_requests() {
        let model = Spectrum::new(8_000.0, 0.65, 1).unwrap();
        let bands = model.bands_for_height_error(0.01).unwrap();
        assert!(model.remainder(bands) <= 0.01);
        assert!(model.remainder(bands - 1) > 0.01);
        assert_eq!(model.bands_for_height_error(1e-100), None);
        assert_eq!(model.bands_for_height_error(0.0), None);
        assert!(Spectrum::new(1.0, 1.0, 0).is_err());
        assert!(Spectrum::new(f64::NAN, 0.5, 0).is_err());
    }
}

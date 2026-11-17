use solar_core::{scale_depth, Spectrum};

fn main() {
    println!("Address depth (no spatial tree allocated):");
    for (span, detail) in [(40_075_017.0, 1.0), (40_075_017.0, 0.001), (1e18, 1.0)] {
        println!(
            "span={span:.3e}m detail={detail:.3e}m binary_scales={:?}",
            scale_depth(span, detail)
        );
    }
    println!("\nAnalytic toy spectrum; height tolerance is NOT an image error bound:");
    for ratio in [0.35, 0.5, 0.65, 0.85] {
        let model = Spectrum::new(8_000.0, ratio, 2026).unwrap();
        for tolerance in [1.0, 0.01, 0.001] {
            let bands = model.bands_for_height_error(tolerance);
            println!("ratio={ratio:.2} height_tolerance={tolerance:.3}m bands={bands:?} finite_gradient_tail={}", model.gradient_remainder(32).is_some());
        }
    }
    println!("\nThis is an analytic scaling report, not a renderer performance benchmark.");
}

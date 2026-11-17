//! Quantify the LOD DC bias independently over a fixed equal-area sphere sample.
use serde_json::json;
use solar_core::{field, planet::BANDS, skin::Skin};
fn main() {
    let skin = Skin::default();
    let count = 8192;
    let mut rows = Vec::new();
    for level in 0..14 {
        let spacing = skin.spacing(level);
        let next = spacing * 0.5;
        let mut old_sum = 0.0;
        let mut new_sum = 0.0;
        let mut old_sq = 0.0;
        let mut new_sq = 0.0;
        let mut max_bound_excess = 0.0_f64;
        for i in 0..count {
            let z = 1.0 - 2.0 * (i as f64 + 0.5) / count as f64;
            let angle = i as f64 * 2.399963229728653;
            let radius = (1.0 - z * z).sqrt();
            let n = [radius * angle.cos(), radius * angle.sin(), z];
            let legacy = |spacing| {
                (0..BANDS)
                    .map(|k| {
                        let (scale, amp, mode) = skin.geology.band(k);
                        let v = field::noise(
                            field::mul(n, skin.radius / scale),
                            skin.geology.seed.wrapping_add(k as u32),
                        );
                        amp * Skin::weight(scale, spacing)
                            * if mode == 1 { 0.55 - v.abs() } else { v }
                    })
                    .sum::<f64>()
            };
            let old = legacy(next) - legacy(spacing);
            let new = skin.height(n, next) - skin.height(n, spacing);
            old_sum += old;
            new_sum += new;
            old_sq += old * old;
            new_sq += new * new;
            max_bound_excess = max_bound_excess.max(
                (skin.height(n, 0.0) - skin.height(n, spacing)).abs() - skin.residual(spacing),
            );
            assert!((skin.height(n, 0.0) - legacy(0.0)).abs() < 1e-8);
        }
        assert_eq!(max_bound_excess, 0.0);
        rows.push(json!({"level":level,"samples":count,"legacy_mean_step_m":old_sum/count as f64,"retained_mean_step_m":new_sum/count as f64,"legacy_rms_step_m":(old_sq/count as f64).sqrt(),"retained_rms_step_m":(new_sq/count as f64).sqrt(),"max_bound_excess_m":max_bound_excess}));
    }
    println!("{}", serde_json::to_string_pretty(&rows).unwrap());
}

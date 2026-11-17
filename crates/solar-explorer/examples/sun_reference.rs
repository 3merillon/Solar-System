//! Independent f64 visibility checks against captured GPU receivers. Uses dense
//! physical ray intervals, not the renderer's clipmap or logarithmic stepping.
use serde_json::{json, Value};
use solar_core::{
    field::{self, V3},
    skin::Skin,
};
use solar_explorer::renderer::Settings;
use std::{fs, path::Path};

fn vector(v: &Value) -> V3 {
    std::array::from_fn(|i| v[i].as_f64().unwrap())
}
fn distribution(mut v: Vec<f64>) -> Value {
    v.sort_by(f64::total_cmp);
    if v.is_empty() {
        return json!({"count":0});
    }
    json!({"count":v.len(),"mean":v.iter().sum::<f64>()/v.len() as f64,"p95":v[(v.len()-1)*95/100],"p99":v[(v.len()-1)*99/100],"max":v.last()})
}
fn visible(skin: &Skin, origin: V3, sun: V3, footprint: f64) -> (f64, usize) {
    let radius = field::length(origin);
    let b = field::dot(origin, sun);
    let bound = skin.height_bound();
    if b < 0. && b * b > radius * radius - (skin.radius - bound).powi(2) {
        return (0., 0);
    }
    let upper = (skin.radius + bound).powi(2);
    let end = (-b + (b * b - radius * radius + upper).max(0.).sqrt()).max(0.);
    let mut t = 0.25;
    let mut count = 0;
    let mut visibility: f64 = 1.;
    while t < end && t < 2_000_000. {
        let p = field::add(origin, field::mul(sun, t));
        let h = field::length(p) - skin.radius;
        // Retain the receiver's resolved spectrum; do not duplicate the GPU's
        // distance-selected terrain cache or its interpolation correction.
        let terrain = skin.height(field::normalized(p), footprint.max(0.25));
        let margin = h - terrain;
        let width = (t * 0.00465).max(0.05);
        let q = ((margin + 0.025 + width) / (2. * width)).clamp(0., 1.);
        visibility = visibility.min(q * q * (3. - 2. * q));
        count += 1;
        if visibility < 0.001 {
            return (0., count);
        }
        let step = if t < 128. {
            0.5
        } else if t < 1024. {
            2.
        } else if t < 8192. {
            16.
        } else if t < 65536. {
            128.
        } else {
            512.
        };
        t += step;
    }
    (visibility, count)
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arg = std::env::args()
        .nth(1)
        .ok_or("supply Test-Sun-Shadows evidence directory")?;
    let dir = Path::new(&arg);
    let report: Value = serde_json::from_slice(&fs::read(dir.join("report.json"))?)?;
    let mut cases = Vec::new();
    for case in report["cases"].as_array().unwrap() {
        let Some(samples) = case["audit"]["samples"].as_array() else {
            continue;
        };
        let settings: Settings = serde_json::from_value(case["snapshot"]["settings"].clone())?;
        let skin = settings.skin();
        let eye = vector(&case["geometry"]["eye"]);
        let sun = field::normalized(settings.sun);
        let mut height_error = Vec::new();
        let mut visibility_error = Vec::new();
        let mut cloud_error = Vec::new();
        let mut unresolved = 0;
        let mut queries = 0;
        let mut mismatch = 0;
        let mut shadowed = 0;
        let mut receiver_error = Vec::new();
        let mut canonical_visibility_error = Vec::new();
        let mut canonical_mismatch = 0;
        for (i, s) in samples.iter().enumerate() {
            let v: Vec<f64> = s
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_f64().unwrap())
                .collect();
            let p = [v[4], v[5], v[6]];
            if field::length(p) < 0.1 {
                continue;
            }
            cloud_error.push((v[12] - v[13]).abs());
            unresolved += usize::from(v[9] > 0.5);
            if v[3] < -100. || i % 8 != 0 {
                continue;
            }
            let world = field::add(eye, p);
            let expected = skin.height(field::normalized(world), v[2].max(0.25));
            height_error.push((v[16] - expected).abs());
            receiver_error.push((field::length(world) - skin.radius - expected).abs());
            // Report the proxy disagreement separately instead of hiding it
            // in a global bias or calling underground starts ray failures.
            let canonical = field::mul(field::normalized(world), skin.radius + expected);
            let (canonical_reference, canonical_work) = visible(&skin, canonical, sun, v[2]);
            canonical_visibility_error.push((v[8] - canonical_reference).abs());
            canonical_mismatch += usize::from((v[8] < 0.5) != (canonical_reference < 0.5));
            queries += canonical_work;
            let (reference, work) = visible(&skin, world, sun, v[2]);
            queries += work;
            shadowed += usize::from(reference < 0.5);
            let error = (v[8] - reference).abs();
            visibility_error.push(error);
            mismatch += usize::from((v[8] < 0.5) != (reference < 0.5));
        }
        let mut fixed_error = Vec::new();
        let mut fixed_mismatch = 0;
        if let Some(fixed) = case["audit"]["fixed_samples"].as_array() {
            for s in fixed.iter().step_by(8) {
                let p = std::array::from_fn(|i| s[i + 4].as_f64().unwrap());
                let (reference, work) = visible(&skin, field::add(eye, p), sun, 0.25);
                let gpu = s[8].as_f64().unwrap();
                fixed_error.push((gpu - reference).abs());
                fixed_mismatch += usize::from((gpu < 0.5) != (reference < 0.5));
                queries += work;
            }
        }
        let row = json!({"name":case["name"],"height_error_m":distribution(height_error),"displayed_receiver_residual_m":distribution(receiver_error),"terrain_visibility_error":distribution(visibility_error),"canonical_receiver_visibility_error":distribution(canonical_visibility_error),"canonical_receiver_binary_mismatches":canonical_mismatch,"fixed_world_visibility_error":distribution(fixed_error),"fixed_world_binary_mismatches":fixed_mismatch,"cloud_transmittance_error":distribution(cloud_error),"binary_visibility_mismatches":mismatch,"reference_shadowed":shadowed,"reference_queries":queries,"unresolved_gpu_samples":unresolved});
        println!("{row}");
        cases.push(row);
    }
    fs::write(
        dir.join("independent-reference.json"),
        serde_json::to_vec_pretty(
            &json!({"cases":cases,"scope":"sampled evidence; no conservative visibility certificate"}),
        )?,
    )?;
    Ok(())
}

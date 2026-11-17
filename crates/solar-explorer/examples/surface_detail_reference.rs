//! Independent f64 checks of captured distant land/water. No GPU helper reuse.
//! Sea-point classification is a coastal heightfield check, not first-hit proof.
use serde_json::{json, Value};
use solar_core::field::{self, V3};
use solar_explorer::renderer::Settings;
use std::{fs, path::Path};
fn vector(v: &Value) -> V3 {
    std::array::from_fn(|i| v[i].as_f64().unwrap())
}
fn scalar(bytes: &[u8], index: usize) -> f64 {
    f64::from(f32::from_le_bytes(
        bytes[index * 4..index * 4 + 4].try_into().unwrap(),
    ))
}
fn summary(mut a: Vec<f64>) -> Value {
    a.sort_by(f64::total_cmp);
    if a.is_empty() {
        return json!({"count":0});
    }
    json!({"count":a.len(),"mean":a.iter().sum::<f64>()/a.len() as f64,"p99":a[(a.len()-1)*99/100],"max":a.last()})
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let dir = Path::new(args.get(1).ok_or("supply captured evidence directory")?);
    let report: Value = serde_json::from_slice(&fs::read(dir.join("report.json"))?)?;
    let width = report["width"].as_u64().unwrap() as usize;
    let height = report["height"].as_u64().unwrap() as usize;
    let focal = height as f64 / (2.0 * 30.0_f64.to_radians().tan());
    let mut rows = Vec::new();
    for case in report["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        for variant in case["variants"].as_array().unwrap() {
            let mode = if variant["detail"].as_bool().unwrap() {
                "detail"
            } else {
                "mesh"
            };
            let settings: Settings =
                serde_json::from_value(variant["snapshot"]["settings"].clone())?;
            let skin = settings.skin();
            let audit = &variant["audit"];
            let eye = vector(&audit["eye"]);
            let right = vector(&audit["right"]);
            let up = vector(&audit["up"]);
            let forward = vector(&audit["forward"]);
            let positions = fs::read(dir.join(format!("{name}-{mode}-position.bin")))?;
            let ocean = fs::read(dir.join(format!("{name}-{mode}-ocean.bin")))?;
            let mut residuals = Vec::new();
            let mut clearance_errors = Vec::new();
            let mut coastal_clearance_errors = Vec::new();
            let mut checked = 0;
            let mut coast = 0;
            let mut mismatch = 0;
            let mut water = 0;
            for y in (3..height).step_by(13) {
                for x in (3..width).step_by(13) {
                    let i = y * width + x;
                    let p = std::array::from_fn(|j| scalar(&positions, i * 4 + j));
                    let rd = field::normalized(field::add(
                        forward,
                        field::add(
                            field::mul(right, (x as f64 + 0.5 - width as f64 / 2.0) / focal),
                            field::mul(up, -(y as f64 + 0.5 - height as f64 / 2.0) / focal),
                        ),
                    ));
                    let world = field::add(eye, p);
                    let radial = field::normalized(world);
                    let fp = field::length(p) / focal / field::dot(radial, rd).abs().max(0.15);
                    if field::length(p) > 1.0 {
                        residuals.push(
                            (field::length(world) - skin.radius - skin.height(radial, fp)).abs(),
                        );
                    }
                    let b = field::dot(eye, rd);
                    let c = field::dot(eye, eye) - (skin.radius + settings.sea).powi(2);
                    let discriminant = b * b - c;
                    if discriminant <= 0.0 {
                        continue;
                    }
                    let t = c / (-b + discriminant.sqrt());
                    let point = field::add(eye, field::mul(rd, t));
                    let n = field::normalized(point);
                    let footprint = t / focal / field::dot(n, rd).abs().max(0.15);
                    let h = skin.height(n, footprint);
                    let actual_water =
                        scalar(&ocean, i * 2) > 0.0 && scalar(&ocean, i * 2) < field::length(p);
                    checked += 1;
                    water += usize::from(actual_water);
                    if scalar(&ocean, i * 2) > 0.0 {
                        clearance_errors
                            .push((scalar(&ocean, i * 2 + 1) - (settings.sea - h)).abs());
                    }
                    if (h - settings.sea).abs() < 100.0 {
                        coast += 1;
                        mismatch += usize::from(actual_water != (h < settings.sea));
                        if scalar(&ocean, i * 2) > 0.0 {
                            coastal_clearance_errors
                                .push((scalar(&ocean, i * 2 + 1) - (settings.sea - h)).abs());
                        }
                    }
                }
            }
            rows.push(json!({"name":name,"mode":mode,"checked":checked,"water":water,"coastal_samples":coast,"coastal_mismatch":mismatch,"height_residual_m":summary(residuals),"clearance_error_m":summary(clearance_errors),"coastal_clearance_error_m":summary(coastal_clearance_errors)}));
        }
    }
    let text = serde_json::to_string_pretty(&rows)?;
    fs::write(dir.join("reference.json"), &text)?;
    println!("{text}");
    Ok(())
}

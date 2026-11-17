//! Offline independent f64 dense triangle comparison. Never a production renderer.
use serde_json::Value;
use solar_core::{
    candidates::{Mesh, Triangle},
    field::{self, Ray, V3},
    patches::{cell_triangles, Cut, Patch},
};
use solar_explorer::renderer::Settings;
use std::{collections::BTreeSet, fs, path::Path};
fn vector(v: &Value) -> V3 {
    std::array::from_fn(|i| v[i].as_f64().unwrap())
}
fn quantile(v: &mut [f64], q: f64) -> f64 {
    v.sort_by(f64::total_cmp);
    if v.is_empty() {
        0.0
    } else {
        v[((v.len() - 1) as f64 * q) as usize]
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let dir = Path::new(args.get(1).ok_or("supply browser evidence directory")?);
    let report: Value = serde_json::from_slice(&fs::read(dir.join("report.json"))?)?;
    let width = report["width"].as_u64().unwrap() as usize;
    let height = report["height"].as_u64().unwrap() as usize;
    for case in report["cases"].as_array().unwrap() {
        let name = case["view"].as_str().unwrap();
        if args.len() > 2 && args[2] != name {
            continue;
        }
        let audit = &case["audit"];
        if audit.is_null() {
            continue;
        }
        if audit["morph"].as_f64().unwrap() < 1.0 {
            return Err("capture must be at a settled endpoint".into());
        }
        let settings: Settings =
            serde_json::from_value(case["measured"]["snapshot"]["settings"].clone())?;
        let skin = settings.skin();
        let cut = Cut {
            leaves: audit["leaves"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| Patch {
                    face: v[0].as_u64().unwrap() as u8,
                    level: v[1].as_u64().unwrap() as u32,
                    x: v[2].as_u64().unwrap() as u32,
                    y: v[3].as_u64().unwrap() as u32,
                })
                .collect(),
        };
        let eye = vector(&audit["eye"]);
        let right = vector(&audit["right"]);
        let up = vector(&audit["up"]);
        let forward = vector(&audit["forward"]);
        let mut triangles = Vec::new();
        let mut evaluations = 0usize;
        for p in &cut.leaves {
            let mask = cut.mask(*p);
            let q = Patch {
                face: p.face,
                level: p.level + 2,
                x: p.x * 4,
                y: p.y * 4,
            };
            let mut vertices = Vec::with_capacity(65 * 65);
            for y in 0..=64 {
                for x in 0..=64 {
                    vertices.push(field::sub(
                        skin.position(q.vertex(x, y).direction(), 0.0),
                        eye,
                    ));
                }
            }
            evaluations += vertices.len();
            let collapse = |(x, y): (u32, u32)| {
                let mut a = x;
                let mut b = y;
                if (x == 0 && mask & 1 != 0) || (x == 64 && mask & 2 != 0) {
                    b &= !1;
                }
                if (y == 0 && mask & 4 != 0) || (y == 64 && mask & 8 != 0) {
                    a &= !1;
                }
                (a, b)
            };
            for y in 0..64 {
                for x in 0..64 {
                    for t in cell_triangles(x, y) {
                        let t = t.map(collapse);
                        if t[0] == t[1] || t[1] == t[2] || t[0] == t[2] {
                            continue;
                        }
                        triangles.push(Triangle {
                            vertices: t.map(|(a, b)| vertices[(b * 65 + a) as usize]),
                        });
                    }
                }
            }
        }
        eprintln!(
            "{name}: {} independent f64 samples, {} dense triangles",
            evaluations,
            triangles.len()
        );
        let mesh = Mesh::from_triangles(triangles, 8_000_000)?;
        let bytes = fs::read(dir.join(format!("{name}-position.bin")))?;
        let position = |x: usize, y: usize| -> V3 {
            std::array::from_fn(|i| {
                let offset = ((y * width + x) * 4 + i) * 4;
                f64::from(f32::from_le_bytes(
                    bytes[offset..offset + 4].try_into().unwrap(),
                ))
            })
        };
        let focal = height as f64 / (2.0 * (30.0f64.to_radians()).tan());
        let ray = |x: usize, y: usize| Ray {
            origin: [0.0; 3],
            direction: field::normalized(field::add(
                forward,
                field::add(
                    field::mul(right, (x as f64 + 0.5 - width as f64 / 2.0) / focal),
                    field::mul(up, -(y as f64 + 0.5 - height as f64 / 2.0) / focal),
                ),
            )),
            near: 0.1,
            far: 250e6,
        };
        let mut samples = BTreeSet::new();
        for y in (2..height).step_by(5) {
            for x in (2..width).step_by(5) {
                samples.insert((x, y));
            }
        }
        // Native-pixel silhouette neighborhoods, including coverage disagreements.
        for x in (0..width).step_by(4) {
            for y in 1..height {
                if (field::length(position(x, y)) > 0.1)
                    != (field::length(position(x, y - 1)) > 0.1)
                {
                    for yy in y.saturating_sub(12)..=(y + 12).min(height - 1) {
                        samples.insert((x, yy));
                    }
                }
            }
        }
        let mut errors = Vec::new();
        let mut metres = Vec::new();
        let mut missing = 0;
        let mut extra = 0;
        let mut both_miss = 0;
        let mut difference = vec![0u8; width * height * 3];
        for &(x, y) in &samples {
            let gpu = field::length(position(x, y));
            let reference = mesh.trace(ray(x, y));
            let color = match (reference, gpu > 0.1) {
                (Some(t), true) => {
                    let m = (gpu - t).abs();
                    let e = m * focal / t;
                    errors.push(e);
                    metres.push(m);
                    let z = (e.min(1.0) * 255.0) as u8;
                    [z, 255 - z, 0]
                }
                (Some(_), false) => {
                    missing += 1;
                    [255, 0, 255]
                }
                (None, true) => {
                    extra += 1;
                    [0, 255, 255]
                }
                (None, false) => {
                    both_miss += 1;
                    [30, 30, 30]
                }
            };
            let o = (y * width + x) * 3;
            difference[o..o + 3].copy_from_slice(&color);
        }
        let p50 = quantile(&mut errors, 0.5);
        let p95 = quantile(&mut errors, 0.95);
        let p99 = quantile(&mut errors, 0.99);
        let max = quantile(&mut errors, 1.0);
        let max_m = quantile(&mut metres, 1.0);
        let result = serde_json::json!({"view":name,"density_per_axis":4,"canonical_unfiltered":true,"f64_evaluations":evaluations,"triangles":mesh.triangles.len(),"cpu_bvh_bytes":mesh.bytes(),"rays":samples.len(),"both_hit":errors.len(),"both_miss":both_miss,"missing_gpu_hits":missing,"extra_gpu_hits":extra,"depth_error_projected_pixels":{"p50":p50,"p95":p95,"p99":p99,"max":max},"max_depth_error_metres":max_m,"depth_gate_pass":p99<=1.0,"scope":"5-pixel grid plus native-pixel +/-12 neighborhoods at every fourth silhouette column; projected depth is not a silhouette certificate"});
        fs::write(
            dir.join(format!("{name}-dense.json")),
            serde_json::to_vec_pretty(&result)?,
        )?;
        let mut encoder = png::Encoder::new(
            fs::File::create(dir.join(format!("{name}-dense-difference.png")))?,
            width as u32,
            height as u32,
        );
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header()?.write_image_data(&difference)?;
        println!("{result}");
    }
    Ok(())
}

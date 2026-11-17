//! Independent f64 central differences of Skin::height, not shader derivatives.
use serde_json::{json, Value};
use solar_core::field::{self, V3};
use solar_explorer::renderer::Settings;
use std::{fs, path::Path};
fn vector(v: &Value) -> V3 {
    std::array::from_fn(|i| v[i].as_f64().unwrap())
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let dir = Path::new(args.get(1).ok_or("supply shading capture directory")?);
    let report: Value = serde_json::from_slice(&fs::read(dir.join("report.json"))?)?;
    let mut results = Vec::new();
    for case in report["cases"].as_array().unwrap() {
        let settings: Settings = serde_json::from_value(case["settings"].clone())?;
        let skin = settings.skin();
        let eye = vector(&case["eye"]);
        let mut errors = Vec::new();
        for point in case["points"].as_array().unwrap() {
            let p = vector(&point["p"]);
            let radial = field::normalized(field::add(eye, p));
            let ray = field::normalized(p);
            let footprint = (field::length(p) * 2.0 * (30_f64.to_radians()).tan()
                / 1080.0
                / field::dot(radial, ray).abs().max(0.15))
            .max(0.008);
            let u = field::normalized(cross(
                radial,
                if radial[2].abs() < 0.9 {
                    [0., 0., 1.]
                } else {
                    [0., 1., 0.]
                },
            ));
            let v = cross(radial, u);
            let epsilon = (footprint * 0.0001).clamp(0.0005, 0.05);
            let derivative = |axis| {
                let offset = field::mul(axis, epsilon / skin.radius);
                (skin.height(field::normalized(field::add(radial, offset)), footprint)
                    - skin.height(field::normalized(field::sub(radial, offset)), footprint))
                    / (2.0 * epsilon)
            };
            let grad = field::add(field::mul(u, derivative(u)), field::mul(v, derivative(v)));
            let expected = field::normalized(field::sub(
                radial,
                field::mul(
                    grad,
                    skin.radius / (skin.radius + point["p"][3].as_f64().unwrap()),
                ),
            ));
            let actual = field::normalized(vector(&point["n"]));
            errors.push(
                field::dot(expected, actual)
                    .clamp(-1.0, 1.0)
                    .acos()
                    .to_degrees(),
            );
        }
        errors.sort_by(f64::total_cmp);
        let p99 = errors[(errors.len() - 1) * 99 / 100];
        let result = json!({"view":case["view"],"frame":case["frame"],"samples":errors.len(),"p99_degrees":p99,"max_degrees":errors.last(),"gate_degrees":0.5,"pass":p99<0.5});
        println!("{result}");
        results.push(result);
    }
    fs::write(
        dir.join("normal-reference.json"),
        serde_json::to_vec_pretty(&results)?,
    )?;
    if results.iter().any(|r| r["pass"] != true) {
        return Err("normal reference gate failed".into());
    }
    Ok(())
}

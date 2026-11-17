//! Check browser-read placement against the independent f64 height/ecology source.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use solar_core::field;
    use solar_explorer::scenery_reference::{ecology, random, ObjectKey, GENERATOR_VERSION};
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: scenery_reference <forest-objects.json>")?;
    let report: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let skin = solar_explorer::renderer::Settings::default().skin();
    let mut mismatches = 0;
    let mut sea_trees = 0;
    let mut slope_or_ecology = 0;
    let mut maximum_height_error = 0.0_f64;
    let mut max_position_error = 0.0_f64;
    let mut max_scale_error = 0.0_f64;
    let mut seen = std::collections::HashSet::new();
    let mut duplicates = 0;
    let objects = report["objects"].as_array().ok_or("missing object audit")?;
    for o in objects {
        let a = o["key"].as_array().unwrap();
        let key = ObjectKey {
            body_seed: skin.geology.seed,
            face: a[0].as_u64().unwrap() as u32,
            x: a[1].as_u64().unwrap() as u32,
            y: a[2].as_u64().unwrap() as u32,
            version: GENERATOR_VERSION,
        };
        if !seen.insert((key.face, key.x, key.y)) {
            duplicates += 1;
        }
        let cube = key.cube();
        for (j, v) in cube.iter().enumerate() {
            if i64::from(*v) != o["canonical"][j].as_i64().unwrap() {
                mismatches += 1;
            }
        }
        let n = field::normalized(cube.map(f64::from));
        let position = skin.position(n, 0.0);
        let actual =
            std::array::from_fn(|j| o["hi"][j].as_f64().unwrap() + o["lo"][j].as_f64().unwrap());
        max_position_error = max_position_error.max(field::length(field::sub(position, actual)));
        maximum_height_error =
            maximum_height_error.max((skin.height(n, 0.0) - o["height"].as_f64().unwrap()).abs());
        let kind = o["kind"].as_f64().unwrap() as u32;
        // Second pass: size from the variant (species and age for trees, family for rocks) and the cell's seed, as
        // scenery.wgsl sc_choose; giant boulders and airless bodies are outside this check.
        let variant = o["shape"][2].as_f64().unwrap() as u32;
        let u = random(key.seed().wrapping_add(4));
        let expected_scale = if kind == 1 {
            let (heights, ages) = (
                [
                    24.0, 22.0, 24.0, 20.0, 26.0, 18.0, 17.0, 26.0, 14.0, 16.0, 13.0, 8.0, 2.6,
                    14.0, 14.0,
                ],
                3u32,
            );
            let species = (variant / ages) as usize;
            let age = f64::from(variant % ages);
            if species == 12 {
                heights[species] * (0.6 + 0.8 * u)
            } else {
                heights[species]
                    * (0.45 + 0.55 * age.min(1.0))
                    * (1.0 + 0.18 * (age - 1.0).max(0.0))
                    * (0.82 + 0.36 * u)
            }
        } else {
            let family = ((variant - 45) / 4) as usize;
            let dmax = [5.0, 4.5, 0.55, 9.0, 2.5, 6.0][family.min(5)];
            let lo = (dmax / 0.22_f64).powf(-2.4);
            0.22 * (1.0 - u * (1.0 - lo)).powf(-1.0 / 2.4)
        };
        let giant = random(key.seed().wrapping_add(90)) <= 0.0035;
        if !giant {
            max_scale_error = max_scale_error
                .max((expected_scale - o["shape"][0].as_f64().unwrap()).abs() / expected_scale);
        }
        if kind == 1 {
            if o["height"].as_f64().unwrap() <= 3.0 {
                sea_trees += 1;
            }
            if ecology(&skin, n, 0.0)[0] <= 0.0 {
                slope_or_ecology += 1;
            }
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &serde_json::json!({"objects":objects.len(),"canonical_key_mismatches":mismatches,"duplicate_keys":duplicates,"height_error_max_m":maximum_height_error,"position_error_max_m":max_position_error,"scale_error_max":max_scale_error,"sea_trees":sea_trees,"zero_ecology_trees":slope_or_ecology,"pass":mismatches==0&&duplicates==0&&maximum_height_error<0.02&&max_position_error<0.03&&max_scale_error<0.0001&&sea_trees==0&&slope_or_ecology==0})
        )?
    );
    Ok(())
}

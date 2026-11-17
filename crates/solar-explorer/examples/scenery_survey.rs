//! Independent deterministic bookmark survey. Never uploads rendering instances.
fn main() {
    use solar_core::field;
    use solar_explorer::scenery_reference::{cross, ecology};
    let skin = solar_explorer::renderer::Settings::default().skin();
    let n = field::normalized([-0.6, 1.0, 0.0]);
    let x = field::normalized(cross([0.0, 0.0, 1.0], n));
    let z = cross(n, x);
    for (name, offset) in [
        ("near", 0.0),
        ("edge", 400.0),
        ("inside", 800.0),
        ("far", 1600.0),
    ] {
        let p = field::normalized(field::add(
            field::mul(n, skin.radius),
            field::mul(x, offset),
        ));
        println!(
            "{name}: {p:?} height {} ecology {:?}",
            skin.height(p, 0.0),
            ecology(&skin, p, 0.0)
        );
    }
    for y in -4..=4 {
        for a in -4..=4 {
            let p = field::normalized(field::add(
                field::add(
                    field::mul(n, skin.radius),
                    field::mul(x, f64::from(a) * 300.0),
                ),
                field::mul(z, f64::from(y) * 300.0),
            ));
            let e = ecology(&skin, p, 0.0);
            if e[0] > 0.85 || e[1] > 0.30 {
                println!(
                    "offset {a},{y} n {p:?} h {:.2} ecology {e:?}",
                    skin.height(p, 0.0)
                );
            }
        }
    }
    let mut coastal = (1e9, [0.0; 3]);
    let mut conifer = None;
    for y in -24..=24 {
        for a in -24..=24 {
            let p = field::normalized(field::add(
                field::add(
                    field::mul(n, skin.radius),
                    field::mul(x, f64::from(a) * 1000.0),
                ),
                field::mul(z, f64::from(y) * 1000.0),
            ));
            let h = skin.height(p, 0.0);
            if h.abs() < coastal.0 {
                coastal = (h.abs(), p);
            }
            if conifer.is_none() && h > 10.0 && h < 1800.0 {
                let e = ecology(&skin, p, 0.0);
                if e[0] > 0.7 && e[2] < -0.15 {
                    conifer = Some((p, h, e));
                }
            }
        }
    }
    println!(
        "COAST {:?} height {}",
        coastal.1,
        skin.height(coastal.1, 0.0)
    );
    println!("CONIFER {conifer:?}");
}

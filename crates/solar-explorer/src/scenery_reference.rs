//! Independent f64 scenery reference and future bounded collision/source contract.
//! This module never supplies production rendering vertices or instance lists.
use solar_core::{
    field::{self, V3},
    hash,
    skin::Skin,
};
pub const GENERATOR_VERSION: u32 = 2;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ObjectKey {
    pub body_seed: u32,
    pub face: u32,
    pub x: u32,
    pub y: u32,
    pub version: u32,
}
impl ObjectKey {
    pub fn seed(self) -> u32 {
        hash(self.x ^ hash(self.y ^ hash(self.face ^ self.body_seed ^ 0x53540001)))
    }
    pub fn cube(self) -> [i32; 3] {
        let seed = self.seed();
        let u = self.x as i32 * 1024 - 268435456 + ((96 + (hash(seed) % 832) as i32) & !1);
        let v = self.y as i32 * 1024 - 268435456
            + ((96 + (hash(seed.wrapping_add(1)) % 832) as i32) & !1);
        match self.face {
            0 => [268435456, v, -u],
            1 => [-268435456, v, u],
            2 => [u, 268435456, -v],
            3 => [u, -268435456, v],
            4 => [u, v, 268435456],
            _ => [-u, v, -268435456],
        }
    }
    pub fn canonical(self, skin: &Skin) -> V3 {
        skin.position(field::normalized(self.cube().map(f64::from)), 0.0)
    }
}
pub fn random(seed: u32) -> f64 {
    f64::from(hash(seed) >> 8) / 16_777_216.0
}
fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
pub fn ecology(skin: &Skin, n: V3, sea: f64) -> [f64; 3] {
    let p = field::mul(n, skin.radius);
    let h = skin.height(n, 0.0);
    let gradient: V3 = std::array::from_fn(|i| {
        let mut a = p;
        let mut b = p;
        a[i] += 0.1;
        b[i] -= 0.1;
        (skin.height(field::normalized(a), 0.0) - skin.height(field::normalized(b), 0.0)) / 0.2
    });
    let normal = field::normalized(field::sub(n, gradient));
    let slope = field::dot(normal, n);
    let noise = |scale, seed| {
        field::noise(
            field::mul(p, 1.0 / scale),
            skin.geology.seed.wrapping_add(seed),
        )
    };
    let wet = noise(8192.0, 813);
    let stand = noise(512.0, 814);
    let clearing = noise(64.0, 815);
    let geology = noise(2048.0, 816);
    let forest = smooth(-0.45, 0.22, stand + wet * 0.35) * smooth(-0.7, -0.15, clearing);
    // Second pass (scenery_common.wgsl sc_eco): climate from latitude and altitude, moisture from broad noise; palms may
    // stand on warm coasts below the usual shore margin.
    let latitude = n[1].clamp(-1.0, 1.0).asin().to_degrees();
    let temperature = 29.0 - 0.0052 * latitude * latitude - 0.0065 * (h - sea).max(0.0);
    let moisture = (0.55 + 0.38 * wet + 0.3 * noise(600000.0, 817)).clamp(0.0, 1.0);
    let climate = smooth(-2.0, 1.5, temperature) * (0.3 + 0.7 * smooth(0.12, 0.4, moisture));
    let coast = 1.0 - smooth(sea + 1.5, sea + 25.0, h);
    // Palms on warm coasts, but only on dry ground.
    let altitude = (smooth(sea + 3.0, sea + 20.0, h)
        + coast * smooth(18.0, 24.0, temperature) * 0.6 * smooth(sea + 0.5, sea + 1.5, h))
    .min(1.0);
    [
        forest * altitude * climate * smooth(0.68, 0.88, slope),
        (0.025
            + 0.4 * smooth(0.05, 0.55, geology + clearing * 0.7)
            + 0.3 * (1.0 - smooth(0.65, 0.9, slope)))
            * (1.0 - smooth(5000.0, 6500.0, h)),
        wet,
    ]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
/// Intersect a radial line with triangles gathered from the published index
/// stream. This uses f64 plane/barycentric math, not the shader's chart weights.
pub fn inspect_contact(
    bytes: &[u8],
    skin: &Skin,
    eye: V3,
    viewport_height: u32,
    detail: bool,
) -> serde_json::Value {
    let mut errors = Vec::new();
    let mut missing = 0;
    let mut checked = 0;
    for record in bytes.chunks_exact(1024) {
        let f = |i: usize| f64::from(f32::from_bits(crate::audit::word(record, i * 4)));
        let vector = |i: usize| [f(i * 4), f(i * 4 + 1), f(i * 4 + 2)];
        let count = f(11) as usize;
        if count == 0 {
            continue;
        }
        checked += 1;
        let support = vector(0);
        let up = field::normalized(vector(1));
        let burial = f(7);
        let origin = vector(3);
        let mut hit = None;
        for j in 0..count {
            let a = vector(4 + j * 3);
            let b = vector(5 + j * 3);
            let c = vector(6 + j * 3);
            let ab = field::sub(b, a);
            let ac = field::sub(c, a);
            let normal = cross(ab, ac);
            let denominator = field::dot(normal, up);
            if denominator.abs() < 1e-12 {
                continue;
            }
            let t = field::dot(normal, field::sub(a, origin)) / denominator;
            let p = field::add(origin, field::mul(up, t));
            let ap = field::sub(p, a);
            let aa = field::dot(ab, ab);
            let bb = field::dot(ac, ac);
            let cc = field::dot(ab, ac);
            let determinant = aa * bb - cc * cc;
            if determinant.abs() < 1e-16 {
                continue;
            }
            let u = (bb * field::dot(ap, ab) - cc * field::dot(ap, ac)) / determinant;
            let v = (aa * field::dot(ap, ac) - cc * field::dot(ap, ab)) / determinant;
            if u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001 {
                hit = Some(p);
                break;
            }
        }
        if let Some(mut p) = hit {
            if detail {
                // Independent f64 field evaluation and finite-difference slopes.
                // The proxy intersection above remains the reference when detail
                // is disabled or the view falls outside the relief domain.
                let radial = field::normalized(field::add(eye, origin));
                let ray = field::normalized(p);
                let distance = field::length(p);
                let cosine = -field::dot(radial, ray);
                let footprint = (distance * 2.0 * 30.0_f64.to_radians().tan()
                    / f64::from(viewport_height)
                    / cosine.abs().max(0.15))
                .max(0.008);
                let height = skin.height(radial, footprint);
                let axis = if radial[2].abs() < 0.9 {
                    [0.0, 0.0, 1.0]
                } else {
                    [0.0, 1.0, 0.0]
                };
                let u = field::normalized(cross(radial, axis));
                let v = cross(radial, u);
                let epsilon = (footprint * 0.01).max(0.01);
                let derivative = |axis: V3| {
                    let a = field::normalized(field::add(
                        radial,
                        field::mul(axis, epsilon / skin.radius),
                    ));
                    let b = field::normalized(field::sub(
                        radial,
                        field::mul(axis, epsilon / skin.radius),
                    ));
                    (skin.height(a, footprint) - skin.height(b, footprint)) / (2.0 * epsilon)
                };
                let gradient =
                    field::add(field::mul(u, derivative(u)), field::mul(v, derivative(v)));
                let normal = field::normalized(field::sub(
                    radial,
                    field::mul(gradient, skin.radius / (skin.radius + height)),
                ));
                let weight = (1.0 - smooth(30000.0, 60000.0, distance))
                    * smooth(0.10, 0.25, cosine)
                    * smooth(0.04, 0.12, -field::dot(normal, ray));
                let target = field::sub(field::mul(radial, skin.radius + height), eye);
                p = field::add(p, field::mul(field::sub(target, p), weight));
            }
            errors.push(field::length(field::sub(
                field::add(support, field::mul(up, burial)),
                p,
            )));
        } else {
            missing += 1;
        }
    }
    errors.sort_by(f64::total_cmp);
    serde_json::json!({"checked":checked,"missing":missing,"p95_m":errors.get(errors.len()*95/100),"max_m":errors.last(),"surface_detail":detail,"scope":"center anchor before burial versus independent published-triangle intersection plus filtered canonical radial support; footprint extrema remain sampled"})
}
/// Orthonormal object axes with determinant +1, including both poles.
pub fn basis(up: V3, yaw: f64) -> [V3; 3] {
    let reference = if up[2].abs() > 0.95 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    let x = field::normalized(cross(up, reference));
    let z = cross(x, up);
    [
        field::add(field::mul(x, yaw.cos()), field::mul(z, yaw.sin())),
        up,
        field::sub(field::mul(z, yaw.cos()), field::mul(x, yaw.sin())),
    ]
}
/// Independent check of contact over large rocks' footprints (docs/SCENERY.md, "Rocks"). For each probed rock and each
/// of 7 x 7 columns over its footprint, the radial line through the column meets (a) the published terrain triangles
/// gathered from the actual index stream and (b) the rock's own generated mesh (LOD0 vertices read back, transformed by
/// the rock's model matrix): f64 plane/barycentric math, no shader support lookup. A column whose lowest rock surface
/// lies above the terrain floats there; the gap is reported. Columns the rock does not cover are skipped.
pub fn inspect_footprints(
    probe: &[u8],
    geometry: &[u8],
    tier: &crate::tier::Tier,
) -> serde_json::Value {
    const WORDS: usize = 2748;
    let f = |i: usize| f64::from(f32::from_bits(crate::audit::word(probe, i * 4)));
    let v4 = |i: usize| [f(i * 4), f(i * 4 + 1), f(i * 4 + 2), f(i * 4 + 3)];
    let tree_variants = 15 * u64::from(tier.tree_ages);
    let rock_base = crate::scenery::class_vertex_base(tier, 3);
    // Rock LOD0 template: six faces of 16 x 16 quads over 17 x 17 vertices.
    let mut triangles = Vec::new();
    for face in 0..6u64 {
        for j in 0..16u64 {
            for i in 0..16u64 {
                let a = face * 289 + j * 17 + i;
                triangles.push([a, a + 1, a + 18]);
                triangles.push([a, a + 18, a + 17]);
            }
        }
    }
    let ray = |origin: V3, up: V3, a: V3, b: V3, c: V3| -> Option<f64> {
        let ab = field::sub(b, a);
        let ac = field::sub(c, a);
        let normal = cross(ab, ac);
        let denominator = field::dot(normal, up);
        if denominator.abs() < 1e-12 {
            return None;
        }
        let t = field::dot(normal, field::sub(a, origin)) / denominator;
        let p = field::add(origin, field::mul(up, t));
        let ap = field::sub(p, a);
        let (aa, bb, cc) = (field::dot(ab, ab), field::dot(ac, ac), field::dot(ab, ac));
        let determinant = aa * bb - cc * cc;
        if determinant.abs() < 1e-18 {
            return None;
        }
        let u = (bb * field::dot(ap, ab) - cc * field::dot(ap, ac)) / determinant;
        let v = (aa * field::dot(ap, ac) - cc * field::dot(ap, ab)) / determinant;
        (u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001).then_some(t)
    };
    let mut rocks = Vec::new();
    let mut worst = 0.0_f64;
    let mut gaps_all = Vec::new();
    for r in 0..16 {
        let block = r * WORDS;
        let header = v4(block);
        if header[3] <= 0.0 {
            continue;
        }
        let m = [v4(block + 1), v4(block + 2), v4(block + 3)];
        let variant = m[0][3] as u64;
        if variant < tree_variants {
            continue;
        }
        let origin = [header[0], header[1], header[2]];
        let world: Vec<V3> = (0..1734)
            .filter_map(|k| {
                crate::scenery::vertex_position(
                    geometry,
                    rock_base + (variant - tree_variants) * 1734 + k,
                )
            })
            .map(|p| {
                field::add(
                    origin,
                    field::add(
                        field::add(
                            field::mul([m[0][0], m[0][1], m[0][2]], p[0]),
                            field::mul([m[1][0], m[1][1], m[1][2]], p[1]),
                        ),
                        field::mul([m[2][0], m[2][1], m[2][2]], p[2]),
                    ),
                )
            })
            .collect();
        if world.len() < 1734 {
            continue;
        }
        let (mut covered, mut floating, mut max_gap, mut max_burial, mut missing) =
            (0, 0, f64::MIN, 0.0_f64, 0);
        for p in 0..49 {
            let column = block + 4 + p * 56;
            let head = v4(column);
            let count = head[3] as usize;
            if count == 0 {
                missing += 1;
                continue;
            }
            let line = [head[0], head[1], head[2]];
            let up = field::normalized({
                let u = v4(column + 1);
                [u[0], u[1], u[2]]
            });
            let mut ground = None;
            for t in 0..count.min(18) {
                let a = v4(column + 2 + t * 3);
                let b = v4(column + 3 + t * 3);
                let c = v4(column + 4 + t * 3);
                if let Some(h) = ray(
                    line,
                    up,
                    [a[0], a[1], a[2]],
                    [b[0], b[1], b[2]],
                    [c[0], c[1], c[2]],
                ) {
                    ground = Some(h);
                    break;
                }
            }
            let Some(ground) = ground else {
                missing += 1;
                continue;
            };
            let mut lowest: Option<f64> = None;
            for tri in &triangles {
                if let Some(t) = ray(
                    line,
                    up,
                    world[tri[0] as usize],
                    world[tri[1] as usize],
                    world[tri[2] as usize],
                ) {
                    lowest = Some(lowest.map_or(t, |l: f64| l.min(t)));
                }
            }
            let Some(bottom) = lowest else { continue };
            covered += 1;
            let gap = bottom - ground;
            gaps_all.push(gap.max(0.0));
            max_gap = max_gap.max(gap);
            max_burial = max_burial.max(-gap);
            if gap > 0.02 {
                floating += 1;
            }
        }
        worst = worst.max(max_gap);
        rocks.push(serde_json::json!({"slot":m[2][3] as u64,"variant":variant,"size_m":header[3],"columns_covered":covered,"columns_floating":floating,"max_gap_m":max_gap,"max_burial_m":max_burial,"columns_without_terrain":missing}));
    }
    gaps_all.sort_by(f64::total_cmp);
    serde_json::json!({"rocks":rocks,"checked":rocks.len(),"max_gap_m":worst,"p95_gap_m":gaps_all.get(gaps_all.len()*95/100),"scope":"7 x 7 radial columns over each footprint: lowest generated rock surface against the published terrain triangles; gap > 0.02 m counts as floating"})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unique_interior_keys_at_all_faces() {
        let mut seen = std::collections::HashSet::new();
        for face in 0..6 {
            for x in [0, 1, 262143, 524286, 524287] {
                for y in [0, 1, 262143, 524286, 524287] {
                    let k = ObjectKey {
                        body_seed: 2026,
                        face,
                        x,
                        y,
                        version: 1,
                    };
                    assert!(seen.insert(k.cube()));
                    assert_eq!(k.seed(), k.seed());
                    let p = k.cube();
                    assert_eq!(p.iter().map(|x| x.abs()).max(), Some(268435456));
                }
            }
        }
    }
    #[test]
    fn frames_preserve_features_at_poles_and_edges() {
        for v in [
            [0.0, 1.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [1.0, 0.001, 1.0],
        ] {
            for yaw in [0.0, 1.0, std::f64::consts::PI, 6.1] {
                let b = basis(field::normalized(v), yaw);
                assert!((field::dot(cross(b[0], b[1]), b[2]) - 1.0).abs() < 1e-12);
                let feature = [0.23, 0.91, -0.18];
                let world = field::add(
                    field::add(field::mul(b[0], feature[0]), field::mul(b[1], feature[1])),
                    field::mul(b[2], feature[2]),
                );
                let recovered = b.map(|axis| field::dot(axis, world));
                assert!(field::length(field::sub(feature, recovered)) < 1e-12);
            }
        }
    }
    #[test]
    fn trees_reject_sea_and_settings_reject_unknown_generator() {
        let skin = Skin::default();
        for n in [[0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [-0.6, 1.0, 0.0]] {
            let n = field::normalized(n);
            assert_eq!(ecology(&skin, n, skin.height(n, 0.0) + 1.0)[0], 0.0);
        }
        let s = crate::renderer::Settings {
            scenery_version: 3,
            ..Default::default()
        };
        assert!(s.validate().is_err());
    }
}

//! Explicit readback audits, never used by the production scheduler.
use solar_core::{
    field,
    pages::{direction_to_chart, page_at, MAX_PAGE_LEVEL},
    patches::{Cut, Patch},
    surface::SurfaceSource,
};
use std::collections::{BTreeSet, HashMap};
pub const NODE_OFFSET: usize = 28272;
pub const NODE_STRIDE: usize = 80;
pub fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
pub fn cut(bytes: &[u8]) -> Cut {
    let mut leaves = BTreeSet::new();
    for i in 0..4096 {
        let o = NODE_OFFSET + i * NODE_STRIDE;
        if word(bytes, o + 36) & 4 != 0 {
            leaves.insert(Patch {
                face: word(bytes, o) as u8,
                level: word(bytes, o + 4),
                x: word(bytes, o + 8),
                y: word(bytes, o + 12),
            });
        }
    }
    Cut { leaves }
}
pub fn inspect(
    surface: &dyn SurfaceSource,
    state: &[u8],
    samples: &[u8],
    indices: &[u8],
    args: &[u8],
) -> serde_json::Value {
    let mut height_error = 0.0_f64;
    let mut worst = serde_json::Value::Null;
    let mut over_tolerance = 0;
    let mut over_samples = Vec::new();
    let mut excess = 0.0_f64;
    let mut served_differ = 0;
    let mut differ_error = 0.0_f64;
    let mut same_error = 0.0_f64;
    let mut position_error = 0.0_f64;
    let mut checked = 0;
    let mut nonfinite = 0;
    let mut shared = HashMap::new();
    let mut repeated = 0;
    let mut unequal = 0;
    for i in 0..4096 {
        let o = NODE_OFFSET + i * NODE_STRIDE;
        if word(state, o + 36) & 1 == 0 || word(state, o + 40) == 0 {
            continue;
        }
        let p = Patch {
            face: word(state, o) as u8,
            level: word(state, o + 4),
            x: word(state, o + 8),
            y: word(state, o + 12),
        };
        for y in 0..=16 {
            for x in 0..=16 {
                let slot = (i * 289 + y * 17 + x) * 48;
                let values: Vec<_> = (0..12)
                    .map(|j| f32::from_bits(word(samples, slot + j * 4)))
                    .collect();
                if values.iter().any(|x| !x.is_finite()) {
                    nonfinite += 1;
                    continue;
                }
                let key = p.vertex(x as u32, y as u32);
                let identity = (key, p.level);
                let bits = [
                    word(samples, slot),
                    word(samples, slot + 4),
                    word(samples, slot + 8),
                    word(samples, slot + 16),
                    word(samples, slot + 20),
                    word(samples, slot + 24),
                    word(samples, slot + 28),
                ];
                if let Some(old) = shared.insert(identity, bits) {
                    repeated += 1;
                    if old != bits {
                        unequal += 1;
                    }
                }
                if (x == 0 || x == 8 || x == 16) && (y == 0 || y == 8 || y == 16) {
                    let n = key.direction();
                    let h = surface.mesh_height(n, p.level);
                    // The node records what served its four corners when it generated, six bits each, the
                    // low five the level plus one, read as its vertices read them: across a cube edge, on the
                    // neighbouring face. Every sample's page is one of those four. Which one can't be told
                    // from where the sample lies in the patch, as a corner on a low cube edge reads another face.
                    // A root's token is instead a bit for each face's root page, so 1 where this sample's is up.
                    let page = |x: u32, y: u32| {
                        let (face, u, v) = direction_to_chart(p.vertex(x, y).direction());
                        page_at(
                            face,
                            p.level.saturating_sub(4).min(u32::from(MAX_PAGE_LEVEL)) as u8,
                            u,
                            v,
                        )
                        .0
                    };
                    let own = page(x as u32, y as u32);
                    let token = if p.level == 0 {
                        (word(state, o + 40) >> 8 >> own.face) & 1
                    } else {
                        (0..4u32)
                            .find(|c| page((c & 1) * 16, (c >> 1) * 16) == own)
                            .map_or(0, |c| (word(state, o + 40) >> 8 >> (6 * c)) & 31)
                    };
                    let served = surface
                        .mesh_served(n, p.level)
                        .map_or(0, |l| u32::from(l) + 1);
                    let error = (f64::from(values[7]) - h).abs();
                    // docs/SINGLE-SKIN.md: 0.02 m + 2e-6 x absolute height, for each sample.
                    let over = error - (0.02 + 2e-6 * h.abs());
                    if over > 0.0 {
                        over_tolerance += 1;
                        excess = excess.max(over);
                        if over_samples.len() < 64 {
                            over_samples.push(serde_json::json!({"face":p.face,"level":p.level,"x":p.x,"y":p.y,"sx":x,"sy":y,"error":error,"token":word(state, o + 40) >> 8}));
                        }
                    }
                    if token != served {
                        served_differ += 1;
                        differ_error = differ_error.max(error);
                    } else {
                        same_error = same_error.max(error);
                    }
                    if error > height_error {
                        worst = serde_json::json!({"face":p.face,"level":p.level,"x":p.x,"y":p.y,"sx":x,"sy":y,"gpu":values[7],"reference":h,"direction":n,"gpu_served":token,"reference_served":served});
                    }
                    height_error = height_error.max((f64::from(values[7]) - h).abs());
                    let position =
                        std::array::from_fn(|j| f64::from(values[j]) + f64::from(values[j + 4]));
                    position_error = position_error.max(field::length(field::sub(
                        position,
                        field::mul(n, surface.radius() + h),
                    )));
                    checked += 1;
                }
            }
        }
    }
    let count = word(args, 48) as usize;
    let start = word(args, 56) as usize;
    let mut edges = HashMap::new();
    let mut triangles = 0;
    let mut degenerates = 0;
    for t in 0..count / 3 {
        let tri = std::array::from_fn::<_, 3, _>(|j| word(indices, (start + t * 3 + j) * 4));
        if tri[0] == tri[1] || tri[1] == tri[2] || tri[2] == tri[0] {
            degenerates += 1;
            continue;
        }
        triangles += 1;
        for j in 0..3 {
            let mut e = [tri[j], tri[(j + 1) % 3]];
            e.sort();
            *edges.entry(e).or_insert(0u32) += 1;
        }
    }
    let boundary = edges.values().filter(|v| **v == 1).count();
    let nonmanifold = edges.values().filter(|v| **v != 2).count();
    let current = cut(state);
    serde_json::json!({"worst_height_sample":worst,"over_tolerance_samples":over_samples,"samples_over_tolerance":over_tolerance,"largest_excess_over_tolerance_m":excess,"served_level_disagreements":served_differ,"height_error_where_served_differs_m":differ_error,"height_error_where_served_agrees_m":same_error,"filtered_height_samples":checked,"max_height_error_m":height_error,"max_position_error_m":position_error,"nonfinite_samples":nonfinite,"identical_shared_samples":repeated-unequal,"unequal_shared_samples":unequal,"triangles":triangles,"degenerate_transition_triangles":degenerates,"undirected_edges":edges.len(),"boundary_edges":boundary,"nonmanifold_edges":nonmanifold,"complete_face_area":current.area(),"balanced":current.balanced(),"leaf_count":current.leaves.len(),"phase":word(state,4),"morph":f32::from_bits(word(state,8)),"topology_overflow":word(state,56)})
}

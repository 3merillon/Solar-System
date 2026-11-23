// Specialize the *module*, not the scene. Strip unreachable entry points and
// functions at build time so browser compilers never ingest the entire engine
// for a tiny scheduling kernel. Naga validates both sides of the transformation.
use naga::{
    compact::{compact, KeepUnused},
    valid::{Capabilities, ValidationFlags, Validator},
};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};

fn validate(m: &naga::Module) -> naga::valid::ModuleInfo {
    Validator::new(ValidationFlags::all(), Capabilities::all())
        .validate(m)
        .expect("shader validation")
}
/// Compile time, not arithmetic: give every counted loop (`for (..; i < N; ..)`,
/// `i <= N`, N an integer literal or constant) the bound `N + f.numeric.x`. The
/// host always writes `numeric.x = 0` (the same word `rounded()` reads), so each
/// loop runs exactly the iterations it did. Only the compilers stop seeing a
/// constant trip count. Browser compilers inline every call. A constant loop
/// whose body holds page lookups or noise gets fully unrolled, and the GPU
/// driver's backend then compiles every copy. Measured on the cold water program (Edge,
/// RTX 3080, 13 Nov 2026): driver 27.3 -> 9.2 s, DXC 23.9 -> 21.1 s; the whole
/// registry 75.7 -> 51.1 s wall (docs/STARTUP.md). The lost unrolling costs frame
/// time: forest GPU p50 +4 to +56 ms in four interleaved pairs, coast +12 ms
/// (14 Nov 2026), so this is opt-in: SOLAR_OPAQUE_LOOPS=1. Programs without the frame uniform
/// keep their loops. Returns the number of loops rewritten.
fn opaque_loop_bounds(m: &mut naga::Module) -> usize {
    use naga::{Expression as E, Literal, Statement as S};
    let Some((frame, numeric)) = m.global_variables.iter().find_map(|(h, v)| {
        if v.name.as_deref() != Some("f") || v.space != naga::AddressSpace::Uniform {
            return None;
        }
        match &m.types[v.ty].inner {
            naga::TypeInner::Struct { members, .. } => members
                .iter()
                .position(|s| s.name.as_deref() == Some("numeric"))
                .map(|i| (h, i as u32)),
            _ => None,
        }
    }) else {
        return 0;
    };
    // Some(true): signed bound; Some(false): unsigned; None: not a constant integer.
    let constant_kind = |e: &E, consts: &naga::Arena<naga::Constant>, globals: &naga::Arena<E>| {
        let lit = match e {
            E::Literal(l) => Some(*l),
            E::Constant(c) => match globals[consts[*c].init] {
                E::Literal(l) => Some(l),
                _ => None,
            },
            _ => None,
        };
        match lit {
            Some(Literal::I32(_)) => Some(true),
            Some(Literal::U32(_)) => Some(false),
            _ => None,
        }
    };
    fn walk(
        block: &mut naga::Block,
        exprs: &mut naga::Arena<E>,
        rewrite: &mut dyn FnMut(&mut naga::Block, &mut naga::Arena<E>),
    ) {
        for s in block.iter_mut() {
            match s {
                S::Loop {
                    body, continuing, ..
                } => {
                    rewrite(body, exprs);
                    walk(body, exprs, rewrite);
                    walk(continuing, exprs, rewrite);
                }
                S::If { accept, reject, .. } => {
                    walk(accept, exprs, rewrite);
                    walk(reject, exprs, rewrite);
                }
                S::Switch { cases, .. } => {
                    for c in cases.iter_mut() {
                        walk(&mut c.body, exprs, rewrite);
                    }
                }
                S::Block(b) => walk(b, exprs, rewrite),
                _ => {}
            }
        }
    }
    let naga::Module {
        functions,
        entry_points,
        constants,
        global_expressions,
        ..
    } = m;
    let mut count = 0;
    // The WGSL front end lowers `for` and `while` to a loop whose first
    // non-Emit statement is `if cond {} else { break; }`.
    let mut rewrite = |body: &mut naga::Block, exprs: &mut naga::Arena<E>| {
        let Some(i) = body.iter().position(|s| !matches!(s, S::Emit(_))) else {
            return;
        };
        let S::If {
            condition,
            accept,
            reject,
        } = &body[i]
        else {
            return;
        };
        if !accept.is_empty() || reject.len() != 1 || !matches!(reject[0], S::Break) {
            return;
        }
        let E::Binary { op, left, right } = exprs[*condition] else {
            return;
        };
        if !matches!(
            op,
            naga::BinaryOperator::Less | naga::BinaryOperator::LessEqual
        ) {
            return;
        }
        let Some(signed) = constant_kind(&exprs[right], constants, global_expressions) else {
            return;
        };
        let span = naga::Span::UNDEFINED;
        let global = exprs.append(E::GlobalVariable(frame), span); // pre-emitted
        let vector = exprs.append(
            E::AccessIndex {
                base: global,
                index: numeric,
            },
            span,
        );
        let word = exprs.append(
            E::AccessIndex {
                base: vector,
                index: 0,
            },
            span,
        );
        let mut zero = exprs.append(E::Load { pointer: word }, span);
        if signed {
            zero = exprs.append(
                E::As {
                    expr: zero,
                    kind: naga::ScalarKind::Sint,
                    convert: Some(4),
                },
                span,
            );
        }
        let bound = exprs.append(
            E::Binary {
                op: naga::BinaryOperator::Add,
                left: right,
                right: zero,
            },
            span,
        );
        let test = exprs.append(
            E::Binary {
                op,
                left,
                right: bound,
            },
            span,
        );
        if let S::If { condition, .. } = &mut body[i] {
            *condition = test;
        }
        body.splice(
            i..i,
            naga::Block::from_vec(vec![S::Emit(naga::Range::new_from_bounds(vector, test))]),
        );
        count += 1;
    };
    for (_, func) in functions.iter_mut() {
        walk(&mut func.body, &mut func.expressions, &mut rewrite);
    }
    for ep in entry_points.iter_mut() {
        walk(
            &mut ep.function.body,
            &mut ep.function.expressions,
            &mut rewrite,
        );
    }
    count
}
fn main() {
    println!("cargo:rerun-if-env-changed=SOLAR_SHADER_BUILD_KEY");
    println!("cargo:rerun-if-env-changed=SOLAR_OPAQUE_LOOPS");
    // Constant loop bounds by default: opaque bounds compile 25 s faster cold but
    // render slower (see opaque_loop_bounds).
    let constant_loops = env::var_os("SOLAR_OPAQUE_LOOPS").is_none_or(|v| v != "1");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let mut source = String::new();
    for file in [
        "explorer",
        "surface_field",
        "surface_detail",
        "water",
        "clouds",
        "sun_visibility",
        "sun_clouds",
        "scenery_common",
        "terrain_gpu",
        "scenery_trees",
        "scenery",
        "scenery_cover",
        "sun_casters",
        "buildings",
    ] {
        let path = format!("../../shaders/{file}.wgsl");
        println!("cargo:rerun-if-changed={path}");
        source.push_str(&fs::read_to_string(path).unwrap());
        source.push('\n');
    }
    source.pop(); // match the independent include_str! concatenation exactly
    fs::write(out.join("source.wgsl"), &source).unwrap();
    let base = naga::front::wgsl::parse_str(&source)
        .unwrap_or_else(|e| panic!("{}", e.emit_to_string(&source)));
    validate(&base);
    let compute = [
        "building_begin",
        "building_remap",
        "building_generate",
        "shade",
        "shade_initial",
        "scenery_shade",
        "water",
        "cloud_pass",
        "cloud_far_pass",
        "weather_generate",
        "cloud_far_map",
        "cloud_shape_generate",
        "atmosphere_lut",
        "composite",
        "temporal_resolve",
        "water_chart_prepare",
        "water_foam_step",
        "water_cache_generate",
        "water_bed_generate",
        "gpu_begin",
        "gpu_scores",
        "gpu_mark",
        "gpu_reclaim",
        "gpu_reset_progress",
        "gpu_census",
        "gpu_progress",
        "gpu_park",
        "gpu_mark_progress",
        "gpu_candidates",
        "gpu_select",
        "gpu_generate",
        "gpu_metrics",
        "gpu_prepare",
        "gpu_union_flags",
        "gpu_union_collect",
        "gpu_snap_flags",
        "gpu_clear",
        "gpu_hash",
        "gpu_hash_resolve",
        "gpu_morph_vertices",
        "gpu_render_bounds",
        "gpu_bounds_finish",
        "gpu_indices",
        "gpu_finish",
        "gpu_audit_morph",
        "scenery_begin",
        "scenery_place",
        "scenery_templates",
        "scenery_tree_skeleton",
        "scenery_tree_vertices",
        "scenery_rock_vertices",
        "scenery_cover_vertices",
        "scenery_leaf_atlas",
        "scenery_leaf_mip",
        "scenery_capture_copy",
        "scenery_draws",
        "scenery_cover_place",
        "scenery_cover_select",
        "scenery_cover_emit",
        "scenery_cover_draws",
        "scenery_ready",
        "scenery_cull",
        "scenery_classify",
        "scenery_refresh",
        "scenery_support_begin",
        "scenery_audit_contact",
        "scenery_audit_footprint",
        "scenery_audit_cover",
        "sun_audit",
        "sun_world_audit",
        "scenery_mip",
        "sun_height_generate",
        "sun_height_blocks",
        "sun_height_maxima",
        "sun_cache_begin",
        "sun_cloud_global_generate",
        "sun_cloud_local_generate",
        "sun_caster_begin",
        "sun_caster_cull",
    ];
    let mut programs: Vec<Value> = compute
        .iter()
        .map(|name| json!({"key":name,"compute":name}))
        .collect();
    for (vs, fs, formats, compare, cull) in [
        (
            "building_mesh",
            "building_fragment",
            vec!["rgba32float", "rgba16float", "rgba16float"],
            "greater-equal",
            "none",
        ),
        (
            "building_shadow",
            "building_shadow_fragment",
            vec![],
            "less-equal",
            "none",
        ),
        (
            "terrain_vertex",
            "terrain_fragment",
            vec!["rgba32float", "rgba16float"],
            "greater-equal",
            "back",
        ),
        (
            "terrain_prepass",
            "terrain_prepass_fragment",
            vec!["rg32float"],
            "greater-equal",
            "back",
        ),
        (
            "ocean_vertex",
            "ocean_fragment",
            vec!["rg32float"],
            "greater-equal",
            "none",
        ),
        (
            "ocean_cap_vertex",
            "ocean_cap_fragment",
            vec!["r32float"],
            "greater-equal",
            "none",
        ),
        (
            "water_mesh_vertex",
            "ocean_fragment",
            vec!["rg32float"],
            "greater-equal",
            "none",
        ),
        (
            "water_mesh_cap_vertex",
            "ocean_cap_fragment",
            vec!["r32float"],
            "greater-equal",
            "none",
        ),
        (
            "scenery_capture",
            "scenery_capture_fragment",
            vec!["rgba16float", "rgba16float"],
            "less-equal",
            "none",
        ),
        (
            "scenery_mesh",
            "scenery_mesh_fragment",
            vec!["rgba32float", "rgba16float", "rgba16float"],
            "greater-equal",
            "none",
        ),
        (
            "scenery_cover_mesh",
            "scenery_mesh_fragment",
            vec!["rgba32float", "rgba16float", "rgba16float"],
            "greater-equal",
            "none",
        ),
        (
            "scenery_card",
            "scenery_card_fragment",
            vec!["rgba32float", "rgba16float", "rgba16float"],
            "greater-equal",
            "none",
        ),
        (
            "sun_mesh_vertex",
            "sun_mesh_fragment",
            vec![],
            "less-equal",
            "none",
        ),
        (
            "sun_card_vertex",
            "sun_card_fragment",
            vec![],
            "less-equal",
            "none",
        ),
    ] {
        let vertex = if vs == "terrain_prepass" {
            "terrain_vertex"
        } else {
            vs
        };
        programs.push(json!({"key":vs,"vertex":vertex,"fragment":fs,"formats":formats,"compare":compare,"cull":cull}));
    }
    let mut generated = String::from("pub const COMPILED_SOURCE: &[u8] = include_bytes!(concat!(env!(\"OUT_DIR\"), \"/source.wgsl\"));\npub fn source(key: &str) -> &'static str { match key {\n");
    let mut binding_table = String::from("/// Bindings a specialized program still uses after compaction.\npub fn program_bindings(key: &str) -> &'static [u32] { match key {\n");
    for p in &mut programs {
        let key = p["key"].as_str().unwrap().to_owned();
        let mut m = base.clone();
        m.entry_points
            .retain(|e| p["compute"] == e.name || p["vertex"] == e.name || p["fragment"] == e.name);
        assert!(!m.entry_points.is_empty(), "missing {key}");
        compact(&mut m, KeepUnused::No);
        let mut used: Vec<u32> = m
            .global_variables
            .iter()
            .filter_map(|(_, v)| {
                v.binding
                    .as_ref()
                    .filter(|b| b.group == 0)
                    .map(|b| b.binding)
            })
            .collect();
        used.sort_unstable();
        binding_table.push_str(&format!("{key:?} => &{used:?},\n"));
        if !constant_loops {
            p["opaque_loops"] = opaque_loop_bounds(&mut m).into();
        }
        let info = validate(&m);
        let text =
            naga::back::wgsl::write_string(&m, &info, naga::back::wgsl::WriterFlags::empty())
                .unwrap();
        // Validate the actual emitted source, not only its source IR.
        validate(&naga::front::wgsl::parse_str(&text).unwrap());
        fs::write(out.join(format!("{key}.wgsl")), &text).unwrap();
        generated.push_str(&format!(
            "{key:?} => include_str!(concat!(env!(\"OUT_DIR\"), \"/{key}.wgsl\")),\n"
        ));
        p["code"] = text.into();
    }
    println!("cargo:rerun-if-changed=../../shaders/present.wgsl");
    let present = fs::read_to_string("../../shaders/present.wgsl").unwrap();
    programs.push(json!({"key":"vertex","vertex":"vertex","fragment":"fragment","formats":["canvas"],"code":present}));
    programs[0]["source_build_key"] = env::var("SOLAR_SHADER_BUILD_KEY")
        .unwrap_or_else(|_| "manual-unpackaged-build".into())
        .into();
    generated.push_str("\"vertex\" => include_str!(\"../../../shaders/present.wgsl\"),\n_ => panic!(\"unknown pipeline {key}\"), }}\n");
    // The path of include_str! is relative to this generated file.
    generated = generated.replace(
        "include_str!(\"../../../shaders/present.wgsl\")",
        "include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/../../shaders/present.wgsl\"))",
    );
    binding_table.push_str("_ => &[], }}\n");
    generated.push_str(&binding_table);
    fs::write(out.join("shaders.rs"), generated).unwrap();
    fs::write(
        out.join("pipelines.json"),
        serde_json::to_string(&programs).unwrap(),
    )
    .unwrap();
}

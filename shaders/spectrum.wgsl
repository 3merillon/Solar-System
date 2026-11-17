// Diagnostic, not the final terrain generator. Matches solar-core's spectrum.
// An integer Q0.64 address survives scale changes before conversion to f32.
struct Query { words: vec4<u32>, bands: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<storage, read> queries: array<Query>;
@group(0) @binding(1) var<storage, read_write> results: array<vec4<f32>>;

fn hash(input: u32) -> u32 {
    var value = input;
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    value *= 0x846ca68bu;
    return value ^ (value >> 16u);
}

fn phase(words: vec2<u32>, band: u32) -> f32 {
    var hi = words.x;
    var lo = words.y;
    if band >= 32u {
        hi = lo << (band - 32u);
        lo = 0u;
    } else if band > 0u {
        hi = (hi << band) | (lo >> (32u - band));
        lo = lo << band;
    }
    return f32(hi) * 2.3283064365386963e-10 + f32(lo) * 5.421010862427522e-20;
}

@compute @workgroup_size(64)
fn probe(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let index = invocation.x;
    if index >= arrayLength(&queries) { return; }
    let query = queries[index];
    var amplitude = 8000.0;
    var height = 0.0;
    for (var band = 0u; band < query.bands; band++) {
        let offset = f32(hash(2026u + band)) * 2.3283064365386963e-10;
        height += amplitude * sin(6.283185307179586 * (phase(query.words.xy, band) + offset))
            * sin(6.283185307179586 * (phase(query.words.zw, band) + offset * 0.5));
        amplitude *= 0.65;
    }
    results[index] = vec4<f32>(height, amplitude / (1.0 - 0.65), f32(query.bands), 0.0);
}

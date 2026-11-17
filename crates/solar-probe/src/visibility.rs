use crate::gpu::Gpu;
use solar_core::field::{self, Ray, Solid, Status};
use wgpu::util::DeviceExt;

pub const SOURCE: &str = concat!(
    include_str!("../../../shaders/field.wgsl"),
    "\n",
    include_str!("../../../shaders/visibility.wgsl")
);
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Query {
    origin: [f32; 4],
    direction: [f32; 4],
    controls: [u32; 4],
    parameters: [f32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct ResultRow {
    span: [f32; 4],
    counts: [u32; 4],
}

#[derive(serde::Serialize)]
pub struct Report {
    pub backend: String,
    pub adapter: String,
    pub rays: u32,
    pub hits: u32,
    pub misses: u32,
    pub unresolved: u32,
    pub overflow: u32,
    pub false_misses: u32,
    pub invalid_hits: u32,
    pub worst_bracket_m: f64,
    pub bounds_by_method: [u64; 3],
    pub bands_by_method: [u64; 3],
    pub stack_high_water: u32,
    pub gpu_ms: Option<f64>,
    pub submission_readback_ms: f64,
    pub explicit_bytes: u64,
}

pub async fn run() -> Result<Report, String> {
    let gpu = Gpu::new().await?;
    run_on(&gpu).await
}
pub async fn run_on(g: &Gpu) -> Result<Report, String> {
    let mut queries = Vec::new();
    for method in 0..3 {
        for scene in 0..4 {
            for y in 0..19 {
                for x in 0..29 {
                    let d = field::normalized([
                        (f64::from(x) - 14.0) * 0.065,
                        (f64::from(y) - 9.0) * 0.065,
                        -1.0,
                    ]);
                    queries.push(Query {
                        origin: [0.0, 0.2, 7.0, 0.0],
                        direction: [d[0] as f32, d[1] as f32, d[2] as f32, 14.0],
                        controls: [scene, 8, method, 8192],
                        parameters: [0.12, 0.45, 0.004, 0.0],
                    });
                }
            }
        }
    }
    // Analytic sphere, exact tangent, near tangent, inside, thin sheet and saturation.
    for (scene, o, d, budget, tol) in [
        (5, [0.0, 0.0, 6.0], [0.0, 0.0, -1.0], 8192, 0.002),
        (5, [3.0, 0.0, 6.0], [0.0, 0.0, -1.0], 8192, 0.002),
        (5, [2.999, 0.0, 6.0], [0.0, 0.0, -1.0], 8192, 0.002),
        (5, [0.0, 0.0, 0.0], [0.0, 0.0, 1.0], 8192, 0.002),
        (6, [0.0, 1.0, 0.0], [0.0, -1.0, 0.0], 8192, 0.0004),
        (0, [0.0, 1.0, 7.0], [0.0, 0.0, -1.0], 1, 0.002),
    ] {
        queries.push(Query {
            origin: [o[0], o[1], o[2], 0.0],
            direction: [d[0], d[1], d[2], 14.0],
            controls: [scene, 0, 2, budget],
            parameters: [0.0, 0.45, tol, 0.0],
        });
    }
    let input = g
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("visibility rays"),
            contents: bytemuck::cast_slice(&queries),
            usage: wgpu::BufferUsages::STORAGE,
        });
    let bytes = queries.len() as u64 * 32;
    let output = g.buffer(
        "visibility intervals",
        bytes,
        wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
    );
    let readback = g.buffer(
        "validation readback",
        bytes,
        wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
    );
    let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("bounded visibility"),
        source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
    });
    let pipeline = g
        .device
        .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("ordered intervals"),
            layout: None,
            module: &module,
            entry_point: Some("visibility"),
            compilation_options: Default::default(),
            cache: None,
        });
    let bg = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: input.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: output.as_entire_binding(),
            },
        ],
    });
    let ts = g.timestamps.then(|| {
        g.device.create_query_set(&wgpu::QuerySetDescriptor {
            label: None,
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        })
    });
    let resolve = g.buffer(
        "timing resolve",
        16,
        wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
    );
    let timing = g.buffer(
        "timing readback",
        16,
        wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
    );
    let mut encoder = g.device.create_command_encoder(&Default::default());
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("visibility comparison"),
            timestamp_writes: ts.as_ref().map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(0),
                end_of_pass_write_index: Some(1),
            }),
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bg, &[]);
        pass.dispatch_workgroups((queries.len() as u32).div_ceil(64), 1, 1);
    }
    encoder.copy_buffer_to_buffer(&output, 0, &readback, 0, bytes);
    if let Some(ref q) = ts {
        encoder.resolve_query_set(q, 0..2, &resolve, 0);
        encoder.copy_buffer_to_buffer(&resolve, 0, &timing, 0, 16);
    }
    let start = crate::now_ms();
    g.queue.submit([encoder.finish()]);
    let data = g.read(&readback).await?;
    let elapsed = crate::now_ms() - start;
    let gpu_ms = if ts.is_some() {
        let t = g.read(&timing).await?;
        let words: &[u64] = bytemuck::cast_slice(&t);
        Some((words[1] - words[0]) as f64 * f64::from(g.queue.get_timestamp_period()) / 1e6)
    } else {
        None
    };
    let info = g.adapter.get_info();
    let mut report = Report {
        backend: format!("{:?}", info.backend),
        adapter: info.name,
        rays: queries.len() as u32,
        hits: 0,
        misses: 0,
        unresolved: 0,
        overflow: 0,
        false_misses: 0,
        invalid_hits: 0,
        worst_bracket_m: 0.0,
        bounds_by_method: [0; 3],
        bands_by_method: [0; 3],
        stack_high_water: 0,
        gpu_ms,
        submission_readback_ms: elapsed,
        explicit_bytes: input.size() + 2 * bytes + 32,
    };
    let rows: &[ResultRow] = bytemuck::cast_slice(&data);
    for (q, r) in queries.iter().zip(rows) {
        let model = Solid {
            scene: q.controls[0],
            bands: q.controls[1],
            amplitude: f64::from(q.parameters[0]),
            ratio: f64::from(q.parameters[1]),
            ..Default::default()
        };
        let ray = Ray {
            origin: [q.origin[0], q.origin[1], q.origin[2]].map(f64::from),
            direction: field::normalized(
                [q.direction[0], q.direction[1], q.direction[2]].map(f64::from),
            ),
            near: 0.0,
            far: 14.0,
        };
        let reference = field::trace(model, ray, f64::from(q.parameters[2]) * 0.25, 100000, 2);
        let method = q.controls[2] as usize;
        report.bounds_by_method[method] += u64::from(r.counts[0]);
        report.bands_by_method[method] += u64::from(r.counts[1]);
        report.stack_high_water = report.stack_high_water.max(r.counts[2]);
        match r.span[2] as u32 {
            0 => {
                report.misses += 1;
                if reference.status == Status::Hit {
                    report.false_misses += 1;
                }
            }
            1 => {
                report.hits += 1;
                let a = f64::from(r.span[0]);
                let b = f64::from(r.span[1]);
                report.worst_bracket_m = report.worst_bracket_m.max(b - a);
                // Independent f64 signs, plus the nearest f64 interval when resolvable.
                if model.value(ray.at(a)) * model.value(ray.at(b)) >= 0.0
                    || b - a > f64::from(q.parameters[2]) * 1.001
                    || (reference.status == Status::Hit
                        && (reference.far < a - 1e-5 || reference.near > b + 1e-5))
                {
                    report.invalid_hits += 1;
                }
            }
            2 => report.unresolved += 1,
            _ => report.overflow += 1,
        }
    }
    let analytic = &rows[rows.len() - 6..];
    if analytic[0].span[2] != 1.0
        || analytic[1].span[2] != 2.0
        || analytic[3].span[2] != 1.0
        || analytic[4].span[2] != 1.0
        || analytic[5].span[2] != 2.0
    {
        return Err(format!(
            "analytic status regression: {:?}",
            analytic.iter().map(|r| r.span).collect::<Vec<_>>()
        ));
    }
    if report.false_misses > 0 || report.invalid_hits > 0 || report.overflow > 0 {
        return Err(serde_json::to_string_pretty(&report).unwrap());
    }
    Ok(report)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub async fn validate_visibility() -> Result<String, wasm_bindgen::JsValue> {
    run()
        .await
        .map(|r| serde_json::to_string(&r).unwrap())
        .map_err(|e| wasm_bindgen::JsValue::from_str(&e))
}

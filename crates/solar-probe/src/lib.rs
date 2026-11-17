//! Run the same bounded-series evaluation kernel on native wgpu and WebGPU.
//! This validates a primitive, not the proposed renderer or frame-time target.

use solar_core::{hash, Coordinate, Spectrum};
use wgpu::util::DeviceExt;

#[cfg(target_arch = "wasm32")]
pub mod browser;
pub mod erosion_io;
pub mod gpu;
pub mod reconstruction;
pub mod renderer;
pub mod surface_cache;
pub mod temporal;
pub mod temporal_audit;
pub mod temporal_resolve;
pub mod timing;
pub mod visibility;

const COUNT: u32 = 4096;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Query {
    words: [u32; 4],
    bands: u32,
    padding: [u32; 3],
}

#[derive(Debug)]
pub struct Report {
    pub adapter: String,
    pub backend: String,
    pub samples: u32,
    pub worst_prefix_error_m: f64,
    pub max_bound_excess_m: f64,
    /// Includes queue submission and GPU -> CPU readback; not GPU timestamps.
    pub submission_and_readback_ms: f64,
    pub explicit_buffer_bytes: u64,
}

impl Report {
    pub fn text(&self) -> String {
        format!("adapter: {}\nbackend: {}\nsamples: {}\nworst GPU vs f64 prefix error: {:.9} m\nmax bound violation after numerical allowance: {:.9} m\nsubmission + readback: {:.3} ms\nexplicit GPU buffers: {} bytes\n\nPASS: toy spectral bounds within 0.05 m numerical allowance.\nThis does not establish renderer performance, millimetre precision, or silhouette correctness.",
            self.adapter, self.backend, self.samples, self.worst_prefix_error_m,
            self.max_bound_excess_m, self.submission_and_readback_ms, self.explicit_buffer_bytes)
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    use std::sync::OnceLock;
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1000.0
}

#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    web_sys::window()
        .and_then(|w| w.performance())
        .map(|p| p.now())
        .unwrap_or_else(js_sys::Date::now)
}

pub async fn run() -> Result<Report, String> {
    let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    #[cfg(target_arch = "wasm32")]
    {
        descriptor.backends = wgpu::Backends::BROWSER_WEBGPU;
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        descriptor.backends = wgpu::Backends::PRIMARY;
    }
    let instance = wgpu::Instance::new(descriptor);
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions::default())
        .await
        .map_err(|error| error.to_string())?;
    let info = adapter.get_info();
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("solar primitive probe"),
            ..Default::default()
        })
        .await
        .map_err(|error| error.to_string())?;

    let queries: Vec<_> = (0..COUNT)
        .map(|index| Query {
            words: [
                hash(index),
                hash(index.wrapping_add(7)),
                hash(index.wrapping_add(19)),
                hash(index.wrapping_add(31)),
            ],
            bands: [4, 8, 16, 24, 32, 48, 63][index as usize % 7],
            padding: [0; 3],
        })
        .collect();
    let input = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("dyadic sample addresses"),
        contents: bytemuck::cast_slice(&queries),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let output_bytes = u64::from(COUNT) * 16;
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("bounded approximations"),
        size: output_bytes,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("probe readback"),
        size: output_bytes,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("bounded spectrum"),
        source: wgpu::ShaderSource::Wgsl(include_str!("../../../shaders/spectrum.wgsl").into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("spectral bounds probe"),
        layout: None,
        module: &module,
        entry_point: Some("probe"),
        compilation_options: Default::default(),
        cache: None,
    });
    let bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("probe inputs and outputs"),
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
    let mut encoder = device.create_command_encoder(&Default::default());
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("evaluate diagnostic spectrum"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bindings, &[]);
        pass.dispatch_workgroups(COUNT.div_ceil(64), 1, 1);
    }
    encoder.copy_buffer_to_buffer(&output, 0, &readback, 0, output_bytes);
    let start = now_ms();
    queue.submit([encoder.finish()]);
    let (sender, receiver) = futures_channel::oneshot::channel();
    readback
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
    #[cfg(not(target_arch = "wasm32"))]
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let elapsed = now_ms() - start;
    let mapped = readback
        .slice(..)
        .get_mapped_range()
        .map_err(|error| error.to_string())?;
    let values: &[[f32; 4]] = bytemuck::cast_slice(&mapped);
    // Compare the GPU's actual rounded parameter to the CPU, not decimal 0.65.
    let model = Spectrum::new(8_000.0, f64::from(0.65_f32), 2026).unwrap();
    let mut worst_prefix_error: f64 = 0.0;
    let mut excess: f64 = 0.0;
    for (query, value) in queries.iter().zip(values) {
        if !value.iter().all(|number| number.is_finite()) {
            return Err("non-finite shader result".into());
        }
        let u = Coordinate((u64::from(query.words[0]) << 32) | u64::from(query.words[1]));
        let v = Coordinate((u64::from(query.words[2]) << 32) | u64::from(query.words[3]));
        let prefix = model.approximate(u, v, query.bands);
        let full = model.approximate(u, v, 64);
        worst_prefix_error = worst_prefix_error.max((f64::from(value[0]) - prefix.height).abs());
        excess = excess.max((full.height - f64::from(value[0])).abs() - f64::from(value[1]) - 0.05);
    }
    if worst_prefix_error > 0.05 || excess > 0.0 {
        return Err(format!(
            "probe failed: prefix_error={worst_prefix_error}, bound_excess={excess}"
        ));
    }
    drop(mapped);
    readback.unmap();
    Ok(Report {
        adapter: info.name,
        backend: format!("{:?}", info.backend),
        samples: COUNT,
        worst_prefix_error_m: worst_prefix_error,
        max_bound_excess_m: excess,
        submission_and_readback_ms: elapsed,
        explicit_buffer_bytes: input.size() + output.size() + readback.size(),
    })
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub async fn run_probe() -> Result<String, wasm_bindgen::JsValue> {
    run()
        .await
        .map(|report| report.text())
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

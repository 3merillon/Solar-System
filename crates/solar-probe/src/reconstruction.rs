//! Display reconstruction owns the only display transform. Input is linear HDR.
use crate::gpu::Gpu;
pub struct Reconstruction {
    pub temporal: Option<crate::temporal_resolve::TemporalResolve>,
    dummy_guide: wgpu::Buffer,
    params: wgpu::Buffer,
    pipeline: wgpu::ComputePipeline,
    pub temporal_pipeline: Option<crate::temporal_resolve::Pipelines>,
    bindings: wgpu::BindGroup,
    pub width: u32,
    pub height: u32,
}
impl Reconstruction {
    pub fn new(g: &Gpu, hdr: &wgpu::Texture, display: &wgpu::Texture) -> Self {
        Self::with_pipelines(g, hdr, display, None, None)
    }
    pub fn resized(&self, g: &Gpu, hdr: &wgpu::Texture, display: &wgpu::Texture) -> Self {
        Self::with_pipelines(
            g,
            hdr,
            display,
            Some(self.pipeline.clone()),
            self.temporal_pipeline.clone(),
        )
    }
    fn with_pipelines(
        g: &Gpu,
        hdr: &wgpu::Texture,
        display: &wgpu::Texture,
        cached: Option<wgpu::ComputePipeline>,
        temporal_pipeline: Option<crate::temporal_resolve::Pipelines>,
    ) -> Self {
        let pipeline = cached.unwrap_or_else(|| {
            let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("linear HDR spatial resolve"),
                source: wgpu::ShaderSource::Wgsl(
                    include_str!("../../../shaders/resolve.wgsl").into(),
                ),
            });
            g.device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("spatial resolve and display encoding"),
                    layout: None,
                    module: &module,
                    entry_point: Some("resolve"),
                    compilation_options: Default::default(),
                    cache: None,
                })
        });
        let params = g.buffer(
            "display transform parameters",
            32,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let bindings = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spatial resolve resources"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(
                        &hdr.create_view(&Default::default()),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(
                        &display.create_view(&Default::default()),
                    ),
                },
            ],
        });
        Self {
            temporal: None,
            dummy_guide: g.buffer("unused spatial guide", 32, wgpu::BufferUsages::STORAGE),
            params,
            pipeline,
            temporal_pipeline,
            bindings,
            width: display.width(),
            height: display.height(),
        }
    }
    pub fn update(&self, g: &Gpu, width: u32, height: u32, exposure: f32, diagnostic: bool) {
        let mut data = [0u32; 8];
        data[..4].copy_from_slice(&[width, height, self.width, self.height]);
        data[4] = exposure.to_bits();
        data[5] = f32::from(diagnostic).to_bits();
        g.queue
            .write_buffer(&self.params, 0, bytemuck::cast_slice(&data));
    }
    pub fn encode(&self, e: &mut wgpu::CommandEncoder, timestamps: Option<&wgpu::QuerySet>) {
        if let Some(t) = &self.temporal {
            t.encode(e, timestamps);
            return;
        }
        let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("linear HDR spatial reconstruction"),
            timestamp_writes: timestamps.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(4),
                end_of_pass_write_index: Some(5),
            }),
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bindings, &[]);
        pass.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
    }
    pub fn guide(&self, index: usize) -> &wgpu::Buffer {
        self.temporal
            .as_ref()
            .map_or(&self.dummy_guide, |t| &t.guides[index])
    }
    pub fn index(&self) -> usize {
        self.temporal.as_ref().map_or(0, |t| t.index)
    }
    pub fn submitted(&mut self) {
        if let Some(t) = &mut self.temporal {
            t.index = 1 - t.index;
        }
    }
    pub fn bytes(&self) -> u64 {
        64 + self.temporal.as_ref().map_or(0, |t| t.bytes())
    }
}
pub fn texture(
    g: &Gpu,
    label: &str,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
) -> wgpu::Texture {
    g.device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

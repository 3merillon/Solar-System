//! Optional TAA/TSR resources; no full-sized temporal allocations in spatial mode.
use crate::{gpu::Gpu, reconstruction::texture};
#[derive(Clone)]
pub struct Pipelines {
    resolve: wgpu::ComputePipeline,
    scatter: wgpu::ComputePipeline,
    clear: wgpu::ComputePipeline,
}
pub struct TemporalResolve {
    pub guides: [wgpu::Buffer; 2],
    histories: [wgpu::Texture; 2],
    params: wgpu::Buffer,
    pub pipelines: Pipelines,
    scatter: wgpu::Buffer,
    locks: [wgpu::Texture; 2],
    bindings: [wgpu::BindGroup; 2],
    pub index: usize,
    width: u32,
    height: u32,
    input_size: [u32; 2],
    tsr: bool,
}
impl TemporalResolve {
    pub fn new(
        g: &Gpu,
        hdr: &wgpu::Texture,
        display: &wgpu::Texture,
        cached: Option<Pipelines>,
    ) -> Self {
        let width = display.width();
        let height = display.height();
        let tsr = hdr.width() < width || hdr.height() < height;
        let scatter = g.buffer(
            "reprojected nearest ray depth",
            if tsr {
                u64::from(hdr.width()) * u64::from(hdr.height()) * 4
            } else {
                4
            },
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        );
        let locks = std::array::from_fn(|_| {
            texture(
                g,
                "thin-feature lock state",
                if tsr { width } else { 1 },
                if tsr { height } else { 1 },
                wgpu::TextureFormat::Rgba16Float,
            )
        });
        let guides = std::array::from_fn(|_| {
            g.buffer(
                "depth motion normal identity guide",
                u64::from(hdr.width()) * u64::from(hdr.height()) * 24,
                wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST,
            )
        });
        let histories = std::array::from_fn(|_| {
            texture(
                g,
                "linear temporal radiance and age",
                width,
                height,
                wgpu::TextureFormat::Rgba16Float,
            )
        });
        let pipelines = cached.unwrap_or_else(|| {
            let entries: Vec<_> = (0..10)
                .map(|binding| wgpu::BindGroupLayoutEntry {
                    binding,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    count: None,
                    ty: match binding {
                        0 => wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        3 | 4 | 7 => wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage {
                                read_only: binding != 7,
                            },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        2 | 6 | 9 => wgpu::BindingType::StorageTexture {
                            access: wgpu::StorageTextureAccess::WriteOnly,
                            format: if binding == 2 {
                                wgpu::TextureFormat::Rgba8Unorm
                            } else {
                                wgpu::TextureFormat::Rgba16Float
                            },
                            view_dimension: wgpu::TextureViewDimension::D2,
                        },
                        _ => wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: false },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                    },
                })
                .collect();
            let bindings = g
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("temporal shared layout"),
                    entries: &entries,
                });
            let layout = g
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &[Some(&bindings)],
                    immediate_size: 0,
                });
            let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("TMT reconstruction adaptation"),
                source: wgpu::ShaderSource::Wgsl(
                    include_str!("../../../shaders/temporal.wgsl").into(),
                ),
            });
            let resolve = g
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("temporal reconstruction"),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some("resolve"),
                    compilation_options: Default::default(),
                    cache: None,
                });
            let scatter = g
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("temporal depth scatter"),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some("scatter_depth"),
                    compilation_options: Default::default(),
                    cache: None,
                });
            let clear = g
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("temporal depth clear"),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some("clear_depth"),
                    compilation_options: Default::default(),
                    cache: None,
                });
            Pipelines {
                resolve,
                scatter,
                clear,
            }
        });
        let params = g.buffer(
            "temporal parameters",
            64,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let bindings = std::array::from_fn(|i| {
            g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("temporal ping pong"),
                layout: &pipelines.resolve.get_bind_group_layout(0),
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
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: guides[i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: guides[1 - i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 5,
                        resource: wgpu::BindingResource::TextureView(
                            &histories[1 - i].create_view(&Default::default()),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 6,
                        resource: wgpu::BindingResource::TextureView(
                            &histories[i].create_view(&Default::default()),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 7,
                        resource: scatter.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 8,
                        resource: wgpu::BindingResource::TextureView(
                            &locks[1 - i].create_view(&Default::default()),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 9,
                        resource: wgpu::BindingResource::TextureView(
                            &locks[i].create_view(&Default::default()),
                        ),
                    },
                ],
            })
        });
        Self {
            guides,
            histories,
            params,
            pipelines,
            scatter,
            locks,
            bindings,
            index: 0,
            width,
            height,
            input_size: [hdr.width(), hdr.height()],
            tsr,
        }
    }
    pub fn update(
        &self,
        g: &Gpu,
        size: [u32; 2],
        control: [f32; 4],
        jitter: [f32; 4],
        timing: [f32; 4],
    ) {
        let mut bytes = [0u32; 16];
        bytes[..4].copy_from_slice(&[size[0], size[1], self.width, self.height]);
        for (chunk, row) in bytes[4..].chunks_mut(4).zip([control, jitter, timing]) {
            chunk.copy_from_slice(&row.map(f32::to_bits));
        }
        g.queue
            .write_buffer(&self.params, 0, bytemuck::cast_slice(&bytes));
    }
    pub fn encode(&self, e: &mut wgpu::CommandEncoder, timestamps: Option<&wgpu::QuerySet>) {
        if self.tsr {
            {
                let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("measured temporal depth clear"),
                    timestamp_writes: timestamps.map(|q| wgpu::ComputePassTimestampWrites {
                        query_set: q,
                        beginning_of_pass_write_index: Some(4),
                        end_of_pass_write_index: None,
                    }),
                });
                p.set_pipeline(&self.pipelines.clear);
                p.set_bind_group(0, &self.bindings[self.index], &[]);
                p.dispatch_workgroups(
                    self.input_size[0].div_ceil(8),
                    self.input_size[1].div_ceil(8),
                    1,
                );
            }
            let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("temporal depth reconstruction"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipelines.scatter);
            pass.set_bind_group(0, &self.bindings[self.index], &[]);
            pass.dispatch_workgroups(
                self.input_size[0].div_ceil(8),
                self.input_size[1].div_ceil(8),
                1,
            );
        }
        let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("TMT adapted temporal resolve"),
            timestamp_writes: timestamps.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: if self.tsr { None } else { Some(4) },
                end_of_pass_write_index: Some(5),
            }),
        });
        pass.set_pipeline(&self.pipelines.resolve);
        pass.set_bind_group(0, &self.bindings[self.index], &[]);
        pass.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
    }
    pub fn bytes(&self) -> u64 {
        self.guides.iter().map(wgpu::Buffer::size).sum::<u64>()
            + self
                .histories
                .iter()
                .map(|t| u64::from(t.width()) * u64::from(t.height()) * 8)
                .sum::<u64>()
            + 64
            + self.scatter.size()
            + self
                .locks
                .iter()
                .map(|t| u64::from(t.width()) * u64::from(t.height()) * 8)
                .sum::<u64>()
    }
    pub fn resolved(&self) -> &wgpu::Texture {
        &self.histories[1 - self.index]
    }
}

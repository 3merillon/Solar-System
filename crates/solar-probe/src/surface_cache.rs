//! Bounded, disposable GPU extraction/raster proposal over the canonical field.
//! Never authoritative: topology and extraction overflow require field fallback.
use crate::gpu::Gpu;
pub const NODE_CAP: u32 = 65_536;
pub const VERTEX_CAP: u32 = 393_216;
pub const SOURCE: &str = include_str!("../../../shaders/surface_cache.wgsl");
pub struct SurfaceCache {
    _nodes: [wgpu::Buffer; 2],
    vertices: wgpu::Buffer,
    pub counts: wgpu::Buffer,
    _params: wgpu::Buffer,
    frame: wgpu::BindGroup,
    bindings: [wgpu::BindGroup; 2],
    refine: wgpu::ComputePipeline,
    finish: wgpu::ComputePipeline,
    raster: wgpu::RenderPipeline,
    pub distance: wgpu::Texture,
    depth_texture: wgpu::Texture,
    depth: u32,
    pub leaf_width: f32,
}
impl SurfaceCache {
    pub fn new(
        g: &Gpu,
        oracle: [&wgpu::Buffer; 3],
        size: [u32; 2],
        center: [f32; 3],
        extent: f32,
        depth: u32,
    ) -> Self {
        let [frame, proxies, erosion] = oracle;
        let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("bounded adaptive field extraction"),
            source: wgpu::ShaderSource::Wgsl(
                format!("{}\n{}", crate::renderer::SOURCE, SOURCE).into(),
            ),
        });
        let buffer_entry =
            |binding, read_only, dynamic, uniform, visibility| wgpu::BindGroupLayoutEntry {
                binding,
                visibility,
                ty: wgpu::BindingType::Buffer {
                    ty: if uniform {
                        wgpu::BufferBindingType::Uniform
                    } else {
                        wgpu::BufferBindingType::Storage { read_only }
                    },
                    has_dynamic_offset: dynamic,
                    min_binding_size: None,
                },
                count: None,
            };
        let frame_layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("field extraction oracle"),
                entries: &[
                    buffer_entry(
                        0,
                        true,
                        false,
                        true,
                        wgpu::ShaderStages::COMPUTE | wgpu::ShaderStages::VERTEX,
                    ),
                    buffer_entry(1, true, false, false, wgpu::ShaderStages::COMPUTE),
                    buffer_entry(4, true, false, false, wgpu::ShaderStages::COMPUTE),
                ],
            });
        let mesh_layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("bounded extraction queues"),
                entries: &[
                    buffer_entry(0, true, false, false, wgpu::ShaderStages::COMPUTE),
                    buffer_entry(1, false, false, false, wgpu::ShaderStages::COMPUTE),
                    buffer_entry(2, false, false, false, wgpu::ShaderStages::COMPUTE),
                    buffer_entry(3, false, false, false, wgpu::ShaderStages::COMPUTE),
                    buffer_entry(4, true, true, true, wgpu::ShaderStages::COMPUTE),
                ],
            });
        let frame = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("surface field inputs"),
            layout: &frame_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: frame.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: proxies.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: erosion.as_entire_binding(),
                },
            ],
        });
        let nodes = std::array::from_fn(|_| {
            g.buffer(
                "bounded cell frontier",
                u64::from(NODE_CAP) * 16,
                wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            )
        });
        let vertices = g.buffer(
            "derived surface triangle proposals",
            u64::from(VERTEX_CAP) * 16,
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_SRC,
        );
        let counts = g.buffer(
            "extraction overflow and indirect draw",
            256,
            wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::INDIRECT,
        );
        let mut initial = [0u32; 64];
        initial[4] = 1;
        initial[8] = 1;
        g.queue
            .write_buffer(&counts, 0, bytemuck::cast_slice(&initial));
        g.queue
            .write_buffer(&nodes[0], 0, bytemuck::cast_slice(&[0u32; 4]));
        let params = g.buffer(
            "aligned bounded extraction levels",
            u64::from(depth + 1) * 256,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let mut data = vec![0u32; (depth as usize + 1) * 64];
        for level in 0..=depth {
            let row = &mut data[level as usize * 64..];
            for i in 0..3 {
                row[i] = (center[i] - extent * 0.5).to_bits();
            }
            row[3] = extent.to_bits();
            row[4..8].copy_from_slice(&[level, depth, NODE_CAP, VERTEX_CAP]);
        }
        g.queue
            .write_buffer(&params, 0, bytemuck::cast_slice(&data));
        let bindings = std::array::from_fn(|i| {
            g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("alternating cell frontiers"),
                layout: &mesh_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: nodes[i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: nodes[1 - i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: vertices.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: counts.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                            buffer: &params,
                            offset: 0,
                            size: wgpu::BufferSize::new(32),
                        }),
                    },
                ],
            })
        });
        let layout = g
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("field extraction layout"),
                bind_group_layouts: &[Some(&frame_layout), Some(&mesh_layout)],
                immediate_size: 0,
            });
        let compute = |entry| {
            g.device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(entry),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    cache: None,
                })
        };
        let refine = compute("mesh_refine");
        let finish = compute("mesh_finish");
        let texture = |label, format, usage| {
            g.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let distance = texture(
            "rasterized primary distance proposal",
            wgpu::TextureFormat::R32Float,
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
        );
        let depth_texture = texture(
            "surface proposal raster depth",
            wgpu::TextureFormat::Depth32Float,
            wgpu::TextureUsages::RENDER_ATTACHMENT,
        );
        let raster_layout = g
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("derived surface raster layout"),
                bind_group_layouts: &[Some(&frame_layout)],
                immediate_size: 0,
            });
        let raster = g
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("derived primary visibility proposals"),
                layout: Some(&raster_layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("mesh_vertex"),
                    compilation_options: Default::default(),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: 16,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x4,
                            offset: 0,
                            shader_location: 0,
                        }],
                    })],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("mesh_fragment"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::R32Float,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState {
                    cull_mode: None,
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Greater),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
        Self {
            _nodes: nodes,
            vertices,
            counts,
            _params: params,
            frame,
            bindings,
            refine,
            finish,
            raster,
            distance,
            depth_texture,
            depth,
            leaf_width: extent / 2.0_f32.powi(depth as i32),
        }
    }
    pub fn encode_build(&self, e: &mut wgpu::CommandEncoder, q: Option<&wgpu::QuerySet>) {
        for level in 0..=self.depth {
            let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("adaptive surface frontier"),
                timestamp_writes: if level == 0 {
                    q.map(|q| wgpu::ComputePassTimestampWrites {
                        query_set: q,
                        beginning_of_pass_write_index: Some(6),
                        end_of_pass_write_index: None,
                    })
                } else {
                    None
                },
            });
            p.set_pipeline(&self.refine);
            p.set_bind_group(0, &self.frame, &[]);
            p.set_bind_group(1, &self.bindings[level as usize % 2], &[level * 256]);
            p.dispatch_workgroups(NODE_CAP.div_ceil(64), 1, 1);
        }
        let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("finish bounded surface draw"),
            timestamp_writes: q.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: None,
                end_of_pass_write_index: Some(7),
            }),
        });
        p.set_pipeline(&self.finish);
        p.set_bind_group(0, &self.frame, &[]);
        p.set_bind_group(
            1,
            &self.bindings[self.depth as usize % 2],
            &[self.depth * 256],
        );
        p.dispatch_workgroups(1, 1, 1);
    }
    pub fn encode_raster(&self, e: &mut wgpu::CommandEncoder, q: Option<&wgpu::QuerySet>) {
        let color = self.distance.create_view(&Default::default());
        let depth = self.depth_texture.create_view(&Default::default());
        let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("rasterized surface proposals"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &color,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(0.0),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: q.map(|q| wgpu::RenderPassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(8),
                end_of_pass_write_index: Some(9),
            }),
            ..Default::default()
        });
        p.set_pipeline(&self.raster);
        p.set_bind_group(0, &self.frame, &[]);
        p.set_vertex_buffer(0, self.vertices.slice(..));
        p.draw_indirect(&self.counts, 12);
    }
    pub fn bytes(&self) -> u64 {
        u64::from(NODE_CAP) * 32
            + u64::from(VERTEX_CAP) * 16
            + self._params.size()
            + 256
            + u64::from(self.distance.width()) * u64::from(self.distance.height()) * 8
    }
    pub fn params(&self) -> &wgpu::Buffer {
        &self._params
    }
}

//! The finish: from the frame's linear HDR image to the display image (bloom, exposure, tone curve, transfer curve).
//! Both ways a frame is made end here: the composite's HDR target, or the space layer alone when no surface pass ran.
//! docs/HDR-FINISH.md.
use crate::gpu::Gpu;
pub const SOURCE: &str = include_str!("../../../shaders/finish.wgsl");
/// The display target's format (renderer.rs `Targets::display`).
const DISPLAY: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const LEVEL: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// The bloom's share of the image: the display shows (1 - share) of the frame and `share` of the mean of the bloom's levels.
/// Jimenez (2014) gives "about 0.04" for the same mix.
pub const BLOOM_SHARE: f32 = 0.04;
pub const MAX_LEVELS: u32 = 6;
/// Bright sources the lens flare is drawn for at once.
pub const MAX_SOURCES: usize = 4;
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniform {
    /// x: exposure; y: the bloom's share (0: none); z: one over the bloom's levels.
    tone: [f32; 4],
    /// x: the lens flare's strength (0: none); y: the frame's aspect; z: a pixel in half heights; w: sources.
    flare: [f32; 4],
    sources: [[f32; 4]; MAX_SOURCES],
    /// x: 1 when the exposure adapts; y: the share of the way to its goal it moves this frame.
    meter: [f32; 4],
}
/// The time constant of the exposure's adaptation, seconds.
pub const ADAPT_SECONDS: f32 = 1.0;
/// What the finish does this frame.
#[derive(Clone, Copy)]
pub struct Options {
    pub exposure: f32,
    /// Levels of the bloom's chain, each half the one before, the first half the frame; 0 for no bloom.
    pub bloom_levels: u32,
    /// The lens flare's sources this frame (none: no flare): each its place from the frame's centre in half heights, x right
    /// and y down, and its angular radius in the same unit.
    pub sources: [[f32; 4]; MAX_SOURCES],
    pub source_count: usize,
    /// Adapt the frame's exposure to its light (finish.wgsl `exposure_meter`); `dt`: this frame's time step, seconds.
    pub auto_exposure: bool,
    pub dt: f32,
}
struct Level {
    view: wgpu::TextureView,
    /// This level as a source: for the step down from it, and for the step up out of it.
    group: wgpu::BindGroup,
}
pub struct Finish {
    finish: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    meter: wgpu::RenderPipeline,
    finish_layout: wgpu::BindGroupLayout,
    level_layout: wgpu::BindGroupLayout,
    meter_layout: wgpu::BindGroupLayout,
    /// The adapted exposure, one texel, this frame's and the frame before's in turn.
    adapted: [wgpu::TextureView; 2],
    /// Which of the two holds this frame's.
    turn: usize,
    /// The meter's bindings, one for each turn: the chain's last level and the other turn's texel.
    meter_groups: Option<[wgpu::BindGroup; 2]>,
    sampler: wgpu::Sampler,
    uniform: wgpu::Buffer,
    levels: Vec<Level>,
    /// The frame size and level count `levels` was made for.
    made: (u32, u32, u32),
    /// The bindings that hold the scene (as the first step's source, and the finish's for each turn), with the key they were
    /// made for.
    scene: [Option<(u64, wgpu::BindGroup, [wgpu::BindGroup; 2])>; 2],
}
impl Finish {
    pub fn new(g: &Gpu) -> Self {
        let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("finish"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let texture = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let sampler_entry = wgpu::BindGroupLayoutEntry {
            binding: 3,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        };
        let finish_layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("finish"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    // The scene is also read where the frame's corners are worked out (the lens flare's measure).
                    wgpu::BindGroupLayoutEntry {
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ..texture(1)
                    },
                    texture(2),
                    sampler_entry,
                    texture(5),
                ],
            });
        let meter_layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("exposure meter"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    sampler_entry,
                    texture(4),
                    texture(5),
                ],
            });
        let level_layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("bloom level"),
                entries: &[sampler_entry, texture(4)],
            });
        let pipeline = |label, layout: &wgpu::BindGroupLayout, corner, entry, format, blend| {
            let pipeline_layout =
                g.device
                    .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                        label: Some(label),
                        bind_group_layouts: &[Some(layout)],
                        immediate_size: 0,
                    });
            g.device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&pipeline_layout),
                    vertex: wgpu::VertexState {
                        module: &module,
                        entry_point: Some(corner),
                        buffers: &[],
                        compilation_options: Default::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some(entry),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format,
                            blend,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
        };
        let add = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        };
        let finish = pipeline(
            "finish",
            &finish_layout,
            "finish_corner",
            "finish",
            DISPLAY,
            None,
        );
        let down = pipeline(
            "bloom down",
            &level_layout,
            "corner",
            "bloom_down",
            LEVEL,
            None,
        );
        let up = pipeline(
            "bloom up",
            &level_layout,
            "corner",
            "bloom_up",
            LEVEL,
            Some(wgpu::BlendState {
                color: add,
                alpha: add,
            }),
        );
        let meter = pipeline(
            "exposure meter",
            &meter_layout,
            "corner",
            "exposure_meter",
            LEVEL,
            None,
        );
        let adapted = [0, 1].map(|_| {
            g.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("adapted exposure"),
                    size: wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: LEVEL,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        });
        let sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("finish"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let uniform = g.buffer(
            "finish",
            std::mem::size_of::<Uniform>() as u64,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        Self {
            finish,
            down,
            up,
            meter,
            finish_layout,
            level_layout,
            meter_layout,
            adapted,
            turn: 0,
            meter_groups: None,
            sampler,
            uniform,
            levels: Vec::new(),
            made: (0, 0, 0),
            scene: [None, None],
        }
    }
    /// The bloom's levels in bytes, for the resource account.
    pub fn bytes(&self) -> u64 {
        let (mut w, mut h, count) = self.made;
        let mut bytes = 0;
        for _ in 0..count {
            w = w.div_ceil(2);
            h = h.div_ceil(2);
            bytes += u64::from(w) * u64::from(h) * 8;
        }
        bytes
    }
    fn level_group(&self, g: &Gpu, view: &wgpu::TextureView) -> wgpu::BindGroup {
        g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bloom level"),
            layout: &self.level_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(view),
                },
            ],
        })
    }
    /// The chain for a frame of this size: at least one level always, so the finish has something bound.
    fn make_levels(&mut self, g: &Gpu, width: u32, height: u32, count: u32) {
        let count = count.clamp(1, MAX_LEVELS);
        if self.made == (width, height, count) {
            return;
        }
        self.levels.clear();
        let (mut w, mut h) = (width, height);
        for _ in 0..count {
            w = w.div_ceil(2);
            h = h.div_ceil(2);
            let texture = g.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("bloom level"),
                size: wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: LEVEL,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            let group = self.level_group(g, &view);
            self.levels.push(Level { view, group });
        }
        self.made = (width, height, count);
        self.scene = [None, None];
        self.meter_groups = None;
    }
    /// `scene`: the linear HDR image, `width` by `height`; `key`: its identity, which changes whenever the view is another
    /// texture; `mark`: stamps the end of the bloom and of the finish for the frame's timing.
    #[allow(clippy::too_many_arguments)]
    pub fn encode(
        &mut self,
        g: &Gpu,
        encoder: &mut wgpu::CommandEncoder,
        scene: &wgpu::TextureView,
        key: u64,
        (width, height): (u32, u32),
        display: &wgpu::TextureView,
        options: Options,
        mark: &mut dyn FnMut(&mut wgpu::CommandEncoder, &'static str),
    ) {
        let bloom = options.bloom_levels > 0;
        // The meter reads the chain's last level, so with it on the chain is always its full length (the levels past the
        // bloom's own are a few hundred texels) and runs whether or not the bloom is drawn.
        let auto = options.auto_exposure;
        self.make_levels(
            g,
            width,
            height,
            if auto {
                MAX_LEVELS
            } else {
                options.bloom_levels
            },
        );
        let count = self.levels.len();
        let bloom_count = (options.bloom_levels as usize).clamp(1, count);
        if auto {
            self.turn = 1 - self.turn;
        }
        let turn = self.turn;
        g.queue.write_buffer(
            &self.uniform,
            0,
            bytemuck::bytes_of(&Uniform {
                tone: [
                    options.exposure,
                    if bloom { BLOOM_SHARE } else { 0.0 },
                    1.0 / bloom_count as f32,
                    0.0,
                ],
                flare: [
                    if options.source_count > 0 { 1.0 } else { 0.0 },
                    width as f32 / height as f32,
                    2.0 / height as f32,
                    options.source_count as f32,
                ],
                sources: options.sources,
                meter: [
                    if auto { 1.0 } else { 0.0 },
                    1.0 - (-options.dt.clamp(0.0, 0.5) / ADAPT_SECONDS).exp(),
                    0.0,
                    0.0,
                ],
            }),
        );
        let scene_slot = (key & 1) as usize;
        if self.scene[scene_slot]
            .as_ref()
            .is_none_or(|(k, ..)| *k != key)
        {
            let first = self.level_group(g, scene);
            let finish = [0, 1].map(|t| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("finish"),
                    layout: &self.finish_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 5,
                            resource: wgpu::BindingResource::TextureView(&self.adapted[t]),
                        },
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: self.uniform.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(scene),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::TextureView(&self.levels[0].view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 3,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                })
            });
            self.scene[scene_slot] = Some((key, first, finish));
        }
        if auto && self.meter_groups.is_none() {
            // For each turn: the texel written is that turn's, the one read is the other's.
            self.meter_groups = Some([0, 1].map(|t: usize| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("exposure meter"),
                    layout: &self.meter_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: self.uniform.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 3,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                        wgpu::BindGroupEntry {
                            binding: 4,
                            resource: wgpu::BindingResource::TextureView(
                                &self.levels[count - 1].view,
                            ),
                        },
                        wgpu::BindGroupEntry {
                            binding: 5,
                            resource: wgpu::BindingResource::TextureView(&self.adapted[1 - t]),
                        },
                    ],
                })
            }));
        }
        let (_, first, finish) = self.scene[scene_slot].as_ref().unwrap();
        let draw = |encoder: &mut wgpu::CommandEncoder,
                    label,
                    pipeline: &wgpu::RenderPipeline,
                    group: &wgpu::BindGroup,
                    target: &wgpu::TextureView,
                    load| {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, group, &[]);
            pass.draw(0..3, 0..1);
        };
        let clear = wgpu::LoadOp::Clear(wgpu::Color::BLACK);
        if bloom || auto {
            // Down the chain: the scene into the first level, each level into the next.
            for i in 0..count {
                let source = if i == 0 {
                    first
                } else {
                    &self.levels[i - 1].group
                };
                draw(
                    encoder,
                    "bloom down",
                    &self.down,
                    source,
                    &self.levels[i].view,
                    clear,
                );
            }
        }
        if auto {
            draw(
                encoder,
                "exposure meter",
                &self.meter,
                &self.meter_groups.as_ref().unwrap()[turn],
                &self.adapted[turn],
                clear,
            );
        }
        if bloom {
            // And back up, each of the bloom's levels added to the one above, so the first ends as their sum.
            for i in (1..bloom_count).rev() {
                draw(
                    encoder,
                    "bloom up",
                    &self.up,
                    &self.levels[i].group,
                    &self.levels[i - 1].view,
                    wgpu::LoadOp::Load,
                );
            }
            mark(encoder, "bloom");
        }
        draw(
            encoder,
            "finish",
            &self.finish,
            &finish[turn],
            display,
            clear,
        );
        mark(encoder, "finish");
    }
}

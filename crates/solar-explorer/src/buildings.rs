//! Bounded source-footprint residency. Compute owns support and draw generation.
use crate::{gpu::Gpu, pages::PageBindings};
const FEATURES: u64 = 16384;
const POINTS: u64 = 131072;
struct Compute {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
}
pub struct Buildings {
    arrivals: std::collections::HashMap<[u32; 7], u32>,
    // Last validated raw source bytes, before GPU arrival stamps. Bounded by
    // FEATURES/POINTS; body changes clear them with the GPU source counts.
    source_records: Vec<u8>,
    source_points: Vec<u8>,
    pub(crate) sources: wgpu::Buffer,
    pub(crate) points: wgpu::Buffer,
    refs: wgpu::Buffer,
    support: wgpu::Buffer,
    state: wgpu::Buffer,
    pub(crate) control: wgpu::Buffer,
    begin: Compute,
    generate: Compute,
    mesh: wgpu::RenderPipeline,
    mesh_group: wgpu::BindGroup,
    shadow: wgpu::RenderPipeline,
    shadow_groups: Vec<wgpu::BindGroup>,
    pub count: u32,
    pub point_count: u32,
}
fn entry(binding: u32, b: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding,
        resource: b.as_entire_binding(),
    }
}
impl Buildings {
    pub fn new(
        g: &Gpu,
        frame: &wgpu::Buffer,
        pages: &PageBindings,
        sun: &wgpu::Buffer,
        urban: &crate::urban::Urban,
    ) -> Self {
        use wgpu::BufferUsages as U;
        let sources = urban.sources.clone();
        let points = urban.points.clone();
        let refs = g.buffer(
            "GPU building vertex references",
            ((POINTS * 2 + FEATURES * 4) * 6 + 2048 * 32 * 6) * 8,
            U::STORAGE,
        );
        let support = g.buffer("GPU building foundations", FEATURES * 16, U::STORAGE);
        let state = g.buffer(
            "building indirect draw and counters",
            32,
            U::STORAGE | U::INDIRECT | U::COPY_SRC,
        );
        let control = urban.control.clone();
        let inputs = [
            (0, frame),
            (64, sun),
            (127, &sources),
            (128, &points),
            (129, &refs),
            (130, &refs),
            (131, &state),
            (132, &support),
            (133, &support),
            (134, &control),
        ];
        let entries = |key: &str| {
            let used = crate::startup::program_bindings(key);
            let mut e: Vec<_> = inputs
                .iter()
                .filter(|(i, _)| used.contains(i))
                .map(|(i, b)| entry(*i, b))
                .collect();
            e.extend(pages.entries(key));
            e
        };
        let compute = |key: &str| {
            let module = crate::startup::shader(g, key);
            let pipeline = g
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(key),
                    layout: None,
                    module: &module,
                    entry_point: Some(key),
                    compilation_options: Default::default(),
                    cache: g.cache(),
                });
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(key),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries(key),
            });
            Compute { pipeline, group }
        };
        let begin = compute("building_begin");
        let generate = compute("building_generate");
        let raster = |key: &str, fragment: &str, shadow: bool| {
            let module = crate::startup::shader(g, key);
            let targets: Vec<_> = if shadow {
                vec![]
            } else {
                vec![
                    wgpu::TextureFormat::Rgba32Float,
                    wgpu::TextureFormat::Rgba16Float,
                    wgpu::TextureFormat::Rgba16Float,
                ]
            }
            .into_iter()
            .map(|format| {
                Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })
            })
            .collect();
            g.device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(key),
                    layout: None,
                    vertex: wgpu::VertexState {
                        module: &module,
                        entry_point: Some(key),
                        buffers: &[],
                        compilation_options: Default::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some(fragment),
                        targets: &targets,
                        compilation_options: Default::default(),
                    }),
                    primitive: wgpu::PrimitiveState {
                        cull_mode: None,
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth32Float,
                        depth_write_enabled: Some(true),
                        depth_compare: Some(if shadow {
                            wgpu::CompareFunction::LessEqual
                        } else {
                            wgpu::CompareFunction::GreaterEqual
                        }),
                        stencil: Default::default(),
                        bias: if shadow {
                            // Match a sloped planar receiver across the PCF
                            // footprint, instead of self-shadowing each texel.
                            wgpu::DepthBiasState {
                                constant: 2,
                                slope_scale: 2.0,
                                clamp: 0.0,
                            }
                        } else {
                            Default::default()
                        },
                    }),
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: g.cache(),
                })
        };
        let mesh = raster("building_mesh", "building_fragment", false);
        let shadow = raster("building_shadow", "building_shadow_fragment", true);
        let mesh_group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("building mesh"),
            layout: &mesh.get_bind_group_layout(0),
            entries: &entries("building_mesh"),
        });
        let shadow_groups = (0..6u32)
            .map(|layer| {
                let b = g.buffer("building shadow layer", 16, U::UNIFORM | U::COPY_DST);
                g.queue
                    .write_buffer(&b, 0, bytemuck::cast_slice(&[layer, 0, 0, 0]));
                let mut e = entries("building_shadow");
                e.push(entry(78, &b));
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("building shadow"),
                    layout: &shadow.get_bind_group_layout(0),
                    entries: &e,
                })
            })
            .collect();
        Self {
            arrivals: Default::default(),
            sources,
            points,
            refs,
            support,
            state,
            control,
            begin,
            generate,
            mesh,
            mesh_group,
            shadow,
            shadow_groups,
            source_records: Vec::new(),
            source_points: Vec::new(),
            count: 0,
            point_count: 0,
        }
    }
    pub fn upload(
        &mut self,
        g: &Gpu,
        records: &[u8],
        points: &[u8],
        frame: u32,
    ) -> Result<Option<Vec<u8>>, String> {
        if self.source_records == records && self.source_points == points {
            return Ok(None);
        }
        if records.len() % 112 != 0
            || points.len() % 16 != 0
            || records.len() as u64 > FEATURES * 112
            || points.len() as u64 > POINTS * 16
        {
            return Err("building source capacity or record alignment".into());
        }
        let count = (records.len() / 112) as u32;
        let n = (points.len() / 16) as u32;
        let word = |bytes: &[u8], i: usize| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        let mut used = 0u32;
        let mut roads = 0;
        for r in records.chunks_exact(112) {
            let start = word(r, 80);
            let size = word(r, 84);
            if start != used {
                return Err("noncontiguous building source ranges".into());
            }
            let road = f32::from_bits(word(r, 108)) < 0.;
            roads += u32::from(road);
            if roads > 2048
                || !(if road { 2..=2 } else { 3..=256 }).contains(&size)
                || start.checked_add(size).is_none_or(|end| end > n)
            {
                return Err("invalid building ring range".into());
            }
            used += size;
            for p in points[start as usize * 16..used as usize * 16].chunks_exact(16) {
                if !(start..used).contains(&word(p, 8)) {
                    return Err("building edge leaves its footprint".into());
                }
            }
            for i in (0..20).chain(24..28) {
                if !f32::from_bits(word(r, i * 4)).is_finite() {
                    return Err("nonfinite building source".into());
                }
            }
        }
        if used != n {
            return Err("building point count mismatch".into());
        }
        for p in points.chunks_exact(16) {
            if word(p, 8) >= n || !(0..2).all(|i| f32::from_bits(word(p, i * 4)).abs() < 100_000.0)
            {
                return Err("invalid building edge".into());
            }
        }
        self.source_records = records.to_vec();
        self.source_points = points.to_vec();
        let mut records = records.to_vec();
        let mut arrivals = std::collections::HashMap::new();
        for r in records.chunks_exact_mut(112) {
            // Include the low anchor words: many road spans share one 4 km
            // high-word cell and a source seed, but arrive independently.
            let key = [
                word(r, 0),
                word(r, 4),
                word(r, 8),
                word(r, 16),
                word(r, 20),
                word(r, 24),
                word(r, 88),
            ];
            let first = *self.arrivals.get(&key).unwrap_or(&frame);
            r[92..96].copy_from_slice(&first.to_le_bytes());
            arrivals.insert(key, first);
        }
        self.arrivals = arrivals;
        if !records.is_empty() {
            g.queue.write_buffer(&self.sources, 0, &records);
        }
        if !points.is_empty() {
            g.queue.write_buffer(&self.points, 0, points);
        }
        self.count = count;
        self.point_count = n;
        g.queue
            .write_buffer(&self.control, 0, bytemuck::cast_slice(&[count, n, 0, 0]));
        // The terrain-shading index needs these same persistent birth stamps.
        Ok(Some(records))
    }
    pub fn clear(&mut self, g: &Gpu) {
        self.arrivals.clear();
        self.source_records.clear();
        self.source_points.clear();
        self.count = 0;
        self.point_count = 0;
        g.queue.write_buffer(&self.control, 0, &[0; 16]);
    }
    pub fn encode(&self, encoder: &mut wgpu::CommandEncoder, queries: Option<&wgpu::QuerySet>) {
        let mut p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("building support and visibility"),
            timestamp_writes: queries.map(|query_set| wgpu::ComputePassTimestampWrites {
                query_set,
                beginning_of_pass_write_index: Some(58),
                end_of_pass_write_index: Some(59),
            }),
        });
        p.set_pipeline(&self.begin.pipeline);
        p.set_bind_group(0, &self.begin.group, &[]);
        p.dispatch_workgroups(1, 1, 1);
        if self.count > 0 {
            p.set_pipeline(&self.generate.pipeline);
            p.set_bind_group(0, &self.generate.group, &[]);
            p.dispatch_workgroups(self.count.div_ceil(64), 1, 1);
        }
    }
    pub fn draw(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        views: [&wgpu::TextureView; 4],
        queries: Option<&wgpu::QuerySet>,
    ) {
        let attachments: Vec<_> = views[..3]
            .iter()
            .map(|view| {
                Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })
            })
            .collect();
        let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("buildings"),
            color_attachments: &attachments,
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: views[3],
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: queries.map(|query_set| wgpu::RenderPassTimestampWrites {
                query_set,
                beginning_of_pass_write_index: Some(60),
                end_of_pass_write_index: Some(61),
            }),
            occlusion_query_set: None,
            multiview_mask: None,
        });
        p.set_pipeline(&self.mesh);
        p.set_bind_group(0, &self.mesh_group, &[]);
        p.draw_indirect(&self.state, 0);
    }
    pub fn shadow(&self, p: &mut wgpu::RenderPass<'_>, layer: usize) {
        if self.count == 0 {
            return;
        }
        p.set_pipeline(&self.shadow);
        p.set_bind_group(0, &self.shadow_groups[layer], &[]);
        p.draw_indirect(&self.state, 0);
    }
    pub fn bytes(&self) -> u64 {
        self.sources.size()
            + self.points.size()
            + self.refs.size()
            + self.support.size()
            + self.state.size()
            + self.control.size()
            + 6 * 16
    }
    pub fn source_cache_bytes(&self) -> usize {
        self.source_records.capacity() + self.source_points.capacity()
    }
}

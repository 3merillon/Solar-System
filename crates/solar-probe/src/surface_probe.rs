//! Quality/readback prototype, deliberately outside the interactive product path.
use super::*;
impl Renderer {
    pub async fn capture_display(&self) -> Result<Vec<u8>, String> {
        let stride = (self.image.width() * 4).div_ceil(256) * 256;
        let mut e = self.gpu.device.create_command_encoder(&Default::default());
        e.copy_texture_to_buffer(
            self.image.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &self.image_read,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: None,
                },
            },
            self.image.size(),
        );
        self.gpu.queue.submit([e.finish()]);
        Ok(self
            .gpu
            .read(&self.image_read)
            .await?
            .chunks(stride as usize)
            .flat_map(|r| r[..self.image.width() as usize * 4].iter().copied())
            .collect())
    }
    pub async fn surface_cache_probe(
        &mut self,
        eye: V3,
        target: V3,
        extent: f32,
        depth: u32,
        frames: u32,
    ) -> Result<serde_json::Value, String> {
        if self.settings.scene != 4
            || self.settings.temporal_mode != 0
            || self.settings.region_cache
            || self.settings.solar_cache
            || self.settings.separate_media
            || self.settings.normal_filter != 0
            || self.settings.water_rate != 1
            || self.erosion_bounds[0] != 0.0
            || self.settings.erosion_steps != 0
            || self.reference_region != [0; 4]
            || self.workgroup != [8, 8]
            || !extent.is_finite()
            || !(1.0..=1024.0).contains(&extent)
            || !(1..=20).contains(&depth)
            || !(1..=12).contains(&frames)
        {
            return Err("Surface probe requires unedited planetary field, spatial/default pipelines, extent 1..1024, depth 1..20, frames 1..12".into());
        }
        self.reset_history();
        self.reference_jitter = [0.0; 2];
        self.reference_filter_scale = 1.0;
        self.update_camera(eye, target)?;
        let started = crate::now_ms();
        let cache = crate::surface_cache::SurfaceCache::new(
            &self.gpu,
            [&self.uniform, &self.proxies, &self.erosion_buffer],
            [self.width, self.height],
            field::sub(target, eye).map(|v| v as f32),
            extent,
            depth,
        );
        let g = &self.gpu;
        let layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("surface hint only"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 4,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 5,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: false },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                ],
            });
        let view = cache.distance.create_view(&Default::default());
        let hints = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("bounded surface proposal"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: cache.params(),
                        offset: 0,
                        size: wgpu::BufferSize::new(32),
                    }),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
            ],
        });
        let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("canonical validation of surface hint"),
            source: wgpu::ShaderSource::Wgsl(
                format!("{}\n{}", SOURCE, crate::surface_cache::SOURCE).into(),
            ),
        });
        let pipeline_layout = g
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout), Some(&layout)],
                immediate_size: 0,
            });
        let guided = g
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("certified prefix with raster hint"),
                layout: Some(&pipeline_layout),
                module: &module,
                entry_point: Some("mesh_guided_visibility"),
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[("DIAGNOSTICS", 1.0)],
                    ..Default::default()
                },
                cache: None,
            });
        let q = g.timestamps.then(|| {
            g.device.create_query_set(&wgpu::QuerySetDescriptor {
                label: None,
                ty: wgpu::QueryType::Timestamp,
                count: 10,
            })
        });
        let resolve = g.buffer(
            "surface timestamps",
            80,
            wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
        );
        let timing = g.buffer(
            "surface timestamp audit",
            80,
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let count_read = g.buffer(
            "extraction count audit",
            256,
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let hit_read = g.buffer(
            "canonical proposal audit",
            u64::from(self.width) * u64::from(self.height) * 32,
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let stride = (self.width * 4).div_ceil(256) * 256;
        let raster_read = g.buffer(
            "surface coverage audit",
            u64::from(stride) * u64::from(self.height),
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let setup_ms = crate::now_ms() - started;
        let mut rows = Vec::new();
        let mut counts = vec![];
        let mut coverage = 0;
        let mut audit = serde_json::Value::Null;
        for i in 0..frames {
            let (baseline, base_pixels) = self.measure(eye, target).await?;
            let mut e = self.gpu.device.create_command_encoder(&Default::default());
            e.clear_buffer(&self.stats, 0, None);
            if i == 0 {
                cache.encode_build(&mut e, q.as_ref());
            }
            cache.encode_raster(&mut e, q.as_ref());
            for (stage, pipeline) in [&guided, &self.shade].into_iter().enumerate() {
                let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("surface comparison"),
                    timestamp_writes: q.as_ref().map(|q| wgpu::ComputePassTimestampWrites {
                        query_set: q,
                        beginning_of_pass_write_index: Some(stage as u32 * 2),
                        end_of_pass_write_index: Some(stage as u32 * 2 + 1),
                    }),
                });
                p.set_pipeline(pipeline);
                p.set_bind_group(0, &self.bindings, &[]);
                if stage == 0 {
                    p.set_bind_group(1, &hints, &[]);
                }
                p.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
            }
            self.reconstruction.encode(&mut e, q.as_ref());
            e.copy_buffer_to_buffer(&self.stats, 0, &self.stats_read, 0, 128);
            e.copy_buffer_to_buffer(&cache.counts, 0, &count_read, 0, 256);
            e.copy_buffer_to_buffer(&self.hit_buffer, 0, &hit_read, 0, hit_read.size());
            e.copy_texture_to_buffer(
                cache.distance.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &raster_read,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(stride),
                        rows_per_image: None,
                    },
                },
                cache.distance.size(),
            );
            if let Some(q) = &q {
                e.resolve_query_set(q, 0..10, &resolve, 0);
                e.copy_buffer_to_buffer(&resolve, 0, &timing, 0, 80);
            }
            let submitted = crate::now_ms();
            self.gpu.queue.submit([e.finish()]);
            let stat = self.gpu.read(&self.stats_read).await?;
            let stat: &[u32] = bytemuck::cast_slice(&stat);
            let completion = crate::now_ms() - submitted;
            let times = if q.is_some() {
                let b = self.gpu.read(&timing).await?;
                let t: &[u64] = bytemuck::cast_slice(&b);
                let period = f64::from(self.gpu.queue.get_timestamp_period()) / 1e6;
                let mut out = [0.0; 5];
                for j in 0..5 {
                    if t[j * 2 + 1] < t[j * 2] {
                        return Err("Nonmonotonic surface timestamp".into());
                    }
                    out[j] = (t[j * 2 + 1] - t[j * 2]) as f64 * period;
                }
                if i > 0 {
                    out[3] = 0.0;
                }
                Some(out)
            } else {
                None
            };
            let b = self.gpu.read(&count_read).await?;
            counts = bytemuck::cast_slice::<u8, u32>(&b).to_vec();
            let b = self.gpu.read(&raster_read).await?;
            coverage = b
                .chunks(stride as usize)
                .flat_map(|r| bytemuck::cast_slice::<u8, f32>(&r[..self.width as usize * 4]))
                .filter(|&&v| v > 0.0 && v.is_finite())
                .count();
            let pixels = self.capture_display().await?;
            let mut hist = [0u64; 256];
            let mut squared = 0u64;
            for (a, b) in pixels.chunks_exact(4).zip(base_pixels.chunks_exact(4)) {
                for k in 0..3 {
                    let d = a[k].abs_diff(b[k]);
                    hist[d as usize] += 1;
                    squared += u64::from(d) * u64::from(d);
                }
            }
            let n = u64::from(self.image.width()) * u64::from(self.image.height()) * 3;
            let mut sum = 0;
            let p99 = hist
                .iter()
                .position(|&n1| {
                    sum += n1;
                    sum as f64 >= n as f64 * 0.99
                })
                .unwrap_or(255);
            let counter = |lo, hi| u64::from(stat[lo]) + (u64::from(stat[hi]) << 32);
            if i == 0 {
                let b = self.gpu.read(&hit_read).await?;
                audit = self.surface_hit_audit(eye, target, &b);
            }
            rows.push(serde_json::json!({"baseline":baseline,"candidate":{"gpu_ms_visibility_transport_resolve_extract_raster":times,"gpu_total_ms":times.map(|v|v.iter().sum::<f64>()),"submit_completion_with_audit_copies_ms":completion,"hits":stat[0],"misses":stat[1],"unresolved":stat[2],"bound_queries":counter(3,10),"band_queries":counter(4,11),"secondary_unresolved":stat[6],"secondary_rays":stat[7]},"display_difference":{"max":hist.iter().rposition(|&v|v>0),"p99":p99,"rmse":(squared as f64/n as f64).sqrt()},"cold":i==0}));
        }
        Ok(
            serde_json::json!({"contract":"rasterized derived surface proposals; canonical ordered prefix validation; no certified topology from corner samples","cache_policy":"single view only; dropped after probe; rebuild on every invocation including cut/seed/edit","extent_m":extent,"depth":depth,"leaf_width_m":cache.leaf_width,"setup_cpu_ms":setup_ms,"controlled_cache_bytes":cache.bytes(),"controlled_renderer_bytes":self.resident_bytes(),"audit_readback_bytes":hit_read.size()+raster_read.size()+336,"node_capacity":crate::surface_cache::NODE_CAP,"vertex_capacity":crate::surface_cache::VERTEX_CAP,"certified_cells":counts[0],"uncertified_surface_leaves":counts[1],"dropped_nodes":counts[2],"draw_vertices":counts[3],"dropped_triangles":counts[7],"frontier_counts":&counts[8..9+depth as usize],"ambiguous_same_sign_leaves":counts[40],"raster_covered_pixels":coverage,"independent_f64":audit,"settings":self.settings,"eye":eye,"target":target,"rows":rows}),
        )
    }
    fn surface_hit_audit(&self, eye: V3, target: V3, bytes: &[u8]) -> serde_json::Value {
        use solar_core::field::{FieldOracle, Ray, Status};
        let planet = solar_core::planet::PlanetSolid {
            geology: self.settings.geology(),
            radius: self.settings.radius,
            feature: self.feature,
        };
        let forward = field::normalized(field::sub(target, eye));
        let mut up = field::normalized(eye);
        if field::length(cross(forward, up)) < 0.01 {
            up = [0.0, 0.0, 1.0];
        }
        let right = field::normalized(cross(forward, up));
        let up = field::normalized(cross(right, forward));
        let rows: &[[f32; 8]] = bytemuck::cast_slice(bytes);
        let (mut hit, mut miss, mut unknown, mut bad, mut false_miss, mut ref_unknown) =
            (0, 0, 0, 0, 0, 0);
        for y in 0..5 {
            for x in 0..7 {
                let px = (x * 2 + 1) * self.width / 14;
                let py = (y * 2 + 1) * self.height / 10;
                let row = rows[(py * self.width + px) as usize];
                if row[2] >= 2.0 {
                    unknown += 1;
                    continue;
                }
                let fov = (55.0f64.to_radians() * 0.5).tan();
                let u = ((f64::from(px) + 0.5) / f64::from(self.width) * 2.0 - 1.0)
                    * fov
                    * f64::from(self.width)
                    / f64::from(self.height);
                let v = (1.0 - (f64::from(py) + 0.5) / f64::from(self.height) * 2.0) * fov;
                let d = field::normalized(field::add(
                    forward,
                    field::add(field::mul(right, u), field::mul(up, v)),
                ));
                let ray = Ray {
                    origin: eye,
                    direction: d,
                    near: 0.0,
                    far: f64::from(row[1]).max(0.0),
                };
                let tol = self
                    .settings
                    .tolerance
                    .max(ray.far * 2.0 * fov / f64::from(self.height) * self.settings.pixel_error);
                let reference = field::trace(planet, ray, tol, 20000, 2);
                if reference.status == Status::Unresolved {
                    ref_unknown += 1;
                }
                if row[2] == 0.0 {
                    miss += 1;
                    if reference.status == Status::Hit {
                        false_miss += 1;
                    }
                } else {
                    hit += 1;
                    let a = f64::from(row[0]);
                    let b = f64::from(row[1]);
                    let fa = planet.value(ray.at(a));
                    let fb = planet.value(ray.at(b));
                    let pad = 0.0001 + b * 3e-6;
                    if (fa * fb > 0.0 && fa.abs().min(fb.abs()) > pad)
                        || (reference.status == Status::Hit
                            && (reference.far < a - pad || reference.near > b + pad))
                    {
                        bad += 1;
                    }
                }
            }
        }
        serde_json::json!({"rays":35,"hits":hit,"misses":miss,"unknown":unknown,"false_misses":false_miss,"invalid_brackets":bad,"reference_unknown":ref_unknown,"passed":bad==0&&false_miss==0,"scope":"finite selected-pixel audit; not topology proof"})
    }
}

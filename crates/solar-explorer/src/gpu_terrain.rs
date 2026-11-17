//! GPU-owned topology, allocation, generation and indirect draw commands.
//! No node lists, heights, vertices or indices cross the CPU/GPU boundary.
use crate::gpu::Gpu;
use std::sync::{Arc, Mutex};
pub const SAMPLES: u64 = 289;
pub const NAMES: [&str; 25] = [
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
];
pub struct GpuTerrain {
    pub state: wgpu::Buffer,
    pub indirect: wgpu::Buffer,
    pub probes: wgpu::Buffer,
    pub owners: wgpu::Buffer,
    map: wgpu::Buffer,
    read: wgpu::Buffer,
    pipelines: Vec<wgpu::ComputePipeline>,
    groups: Vec<wgpu::BindGroup>,
    audit: std::cell::OnceCell<(wgpu::ComputePipeline, wgpu::BindGroup)>,
    stats: Arc<Mutex<Option<[u8; 256]>>>,
    reading: Arc<Mutex<bool>>,
}
impl GpuTerrain {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        g: &Gpu,
        input: &wgpu::Buffer,
        projected: &wgpu::Buffer,
        cache: &wgpu::Buffer,
        vertices: &[wgpu::Buffer; 2],
        indices: &wgpu::Buffer,
        tier: &crate::tier::Tier,
        pages: &crate::pages::PageBindings,
    ) -> Self {
        use wgpu::BufferUsages as U;
        let state = g.buffer(
            "GPU terrain state and bounded node pool",
            1048576,
            U::STORAGE | U::COPY_SRC,
        );
        let indirect = g.buffer(
            "GPU dispatch and draw commands",
            256,
            U::STORAGE | U::INDIRECT | U::COPY_SRC,
        );
        let owners = g.buffer(
            "canonical shared vertex ownership",
            2 * u64::from(tier.hash_cap) * 4,
            U::STORAGE,
        );
        let probes = g.buffer("explicit morph probes", 64 * 16, U::STORAGE | U::COPY_SRC);
        let map = g.buffer(
            "union patch vertex map",
            2 * u64::from(tier.union_cap) * SAMPLES * 4,
            U::STORAGE,
        );
        let read = g.buffer(
            "optional asynchronous terrain counters",
            256,
            U::MAP_READ | U::COPY_DST,
        );
        let names = NAMES;
        let pipelines: Vec<_> = names
            .iter()
            .map(|name| {
                let module = crate::startup::shader(g, name);
                g.device
                    .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                        label: Some(name),
                        layout: None,
                        module: &module,
                        entry_point: Some(name),
                        compilation_options: Default::default(),
                        cache: g.cache(),
                    })
            })
            .collect();
        let buffers = [
            (0, input),
            (2, cache),
            (3, cache),
            (20, &state),
            (21, &owners),
            (22, &vertices[0]),
            (29, &vertices[1]),
            (23, indices),
            (24, &map),
            (25, &indirect),
            (26, projected),
            (47, &probes),
        ];
        // Every kernel that addresses the vertex banks or union map reads the
        // allocation tier from the frame uniform (binding 0).
        let used: &[&[u32]] = &[
            &[0, 20, 25],
            &[0, 20],
            &[20],
            &[20],
            &[20],
            &[20],
            &[0, 20, 22, 24, 29],
            &[0, 20, 21, 22, 24, 29],
            &[20],
            &[0, 20],
            &[0, 20],
            &[0, 2, 20],
            &[0, 3, 20],
            &[20, 25],
            &[0, 20],
            &[0, 20, 25],
            &[0, 20],
            &[0, 20, 21, 22, 29],
            &[0, 20, 21],
            &[0, 20, 21, 24],
            &[0, 3, 20, 21, 22, 24, 29],
            &[0, 20, 22, 24, 29],
            &[0, 3, 20],
            &[0, 20, 23, 24],
            &[0, 20, 21, 22, 25, 26, 29],
        ];
        let groups = pipelines
            .iter()
            .zip(used)
            .zip(names)
            .map(|((p, used), name)| {
                let mut entries: Vec<_> = buffers
                    .iter()
                    .filter(|(i, _)| used.contains(i))
                    .map(|(i, b)| wgpu::BindGroupEntry {
                        binding: *i,
                        resource: b.as_entire_binding(),
                    })
                    .collect();
                entries.extend(pages.entries(name));
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &p.get_bind_group_layout(0),
                    entries: &entries,
                })
            })
            .collect();
        Self {
            state,
            indirect,
            probes,
            owners,
            map,
            read,
            pipelines,
            groups,
            audit: std::cell::OnceCell::new(),
            stats: Arc::new(Mutex::new(None)),
            reading: Arc::new(Mutex::new(false)),
        }
    }
    pub fn encode(
        &self,
        e: &mut wgpu::CommandEncoder,
        queries: Option<&wgpu::QuerySet>,
        marker: &mut crate::timing::Marker,
    ) {
        if marker.set.is_some() {
            // Profiling: one pass per kernel, each followed by a timeline mark.
            for (stage, range) in [(0, 0..11), (1, 11..13), (2, 13..25)] {
                for i in range.clone() {
                    {
                        let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                            label: Some(NAMES[i]),
                            timestamp_writes: queries
                                .filter(|_| i == range.start || i + 1 == range.end)
                                .map(|q| wgpu::ComputePassTimestampWrites {
                                    query_set: q,
                                    beginning_of_pass_write_index: (i == range.start)
                                        .then_some(stage as u32 * 2),
                                    end_of_pass_write_index: (i + 1 == range.end)
                                        .then_some(stage as u32 * 2 + 1),
                                }),
                        });
                        self.dispatch(&mut p, i);
                    }
                    marker.mark(e, NAMES[i]);
                }
            }
            return;
        }
        for (stage, range) in [(0, 0..11), (1, 11..13), (2, 13..25)] {
            let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(
                    [
                        "GPU scheduling",
                        "cached height generation",
                        "shared transition topology",
                    ][stage],
                ),
                timestamp_writes: queries.map(|q| wgpu::ComputePassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(stage as u32 * 2),
                    end_of_pass_write_index: Some(stage as u32 * 2 + 1),
                }),
            });
            for i in range {
                self.dispatch(&mut p, i);
            }
        }
    }
    fn dispatch(&self, p: &mut wgpu::ComputePass<'_>, i: usize) {
        {
            {
                p.set_pipeline(&self.pipelines[i]);
                p.set_bind_group(0, &self.groups[i], &[]);
                match i {
                    1 | 2 | 4 | 5 | 8 | 9 => p.dispatch_workgroups_indirect(&self.indirect, 128),
                    12 | 14 | 16 | 22 => p.dispatch_workgroups(64, 1, 1),
                    6 => p.dispatch_workgroups_indirect(&self.indirect, 96),
                    7 => p.dispatch_workgroups_indirect(&self.indirect, 80),
                    11 => p.dispatch_workgroups((64u32 * 289).div_ceil(64), 1, 1),
                    17 => p.dispatch_workgroups_indirect(&self.indirect, 0),
                    18..=20 => p.dispatch_workgroups_indirect(&self.indirect, 16),
                    21 => p.dispatch_workgroups_indirect(&self.indirect, 112),
                    23 => p.dispatch_workgroups_indirect(&self.indirect, 32),
                    _ => p.dispatch_workgroups(1, 1, 1),
                }
            }
        }
    }
    pub fn request_stats(&self, g: &Gpu) {
        let mut busy = self.reading.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
        drop(busy);
        let mut e = g.device.create_command_encoder(&Default::default());
        e.copy_buffer_to_buffer(&self.state, 0, &self.read, 0, 256);
        g.queue.submit([e.finish()]);
        let read = self.read.clone();
        let stats = self.stats.clone();
        let busy = self.reading.clone();
        self.read
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                if result.is_ok() {
                    if let Ok(bytes) = read.slice(..).get_mapped_range() {
                        let mut values = [0u8; 256];
                        values.copy_from_slice(&bytes);
                        *stats.lock().unwrap() = Some(values);
                    }
                    read.unmap();
                }
                *busy.lock().unwrap() = false;
            });
    }
    /// Diagnostics only: the morph audit program compiles on first use.
    pub fn encode_audit(
        &self,
        g: &Gpu,
        e: &mut wgpu::CommandEncoder,
        frame: &wgpu::Buffer,
        vertices: &[wgpu::Buffer; 2],
    ) {
        let (pipeline, group) = self.audit.get_or_init(|| {
            let name = "gpu_audit_morph";
            let module = crate::startup::shader(g, name);
            let pipeline = g
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(name),
                    layout: None,
                    module: &module,
                    entry_point: Some(name),
                    compilation_options: Default::default(),
                    cache: g.cache(),
                });
            let entries: Vec<_> = [
                (0, frame),
                (20, &self.state),
                (21, &self.owners),
                (22, &vertices[0]),
                (29, &vertices[1]),
                (47, &self.probes),
            ]
            .into_iter()
            .map(|(binding, b)| wgpu::BindGroupEntry {
                binding,
                resource: b.as_entire_binding(),
            })
            .collect();
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(name),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries,
            });
            (pipeline, group)
        });
        let mut p = e.begin_compute_pass(&Default::default());
        p.set_pipeline(pipeline);
        p.set_bind_group(0, group, &[]);
        p.dispatch_workgroups(1, 1, 1);
    }
    pub fn stats(&self) -> serde_json::Value {
        let values = *self.stats.lock().unwrap();
        let Some(b) = values else {
            return serde_json::json!({"gpu_resident":true,"counters_ready":false});
        };
        let u = |i: usize| u32::from_le_bytes(b[i * 4..i * 4 + 4].try_into().unwrap());
        let f = |i| f32::from_bits(u(i));
        serde_json::json!({"gpu_resident":true,"counters_ready":true,"phase":u(1),"morph":f(2),"patches":u(4),"union_patches":u(5),"free_nodes":u(6),"pending_samples":(u(8)-u(7))*289,"last_generation_samples":u(9)*289,"epochs":u(10),"generated":u(11),"denied":u(12),"vertices":u(13),"topology_overflow":u(14),"hash_probe_max":u(15),"max_level":u(16),"error_bound_pixels":f(20),"camera_height_gpu":f(21),"camera_lift_m":f(24),"triangles":u(5)*512,"samples":(4096-u(6))*289,"frame_count":u(23)})
    }
    pub fn bytes(&self) -> u64 {
        self.state.size()
            + self.indirect.size()
            + self.owners.size()
            + self.map.size()
            + self.read.size()
            + self.probes.size()
    }
}

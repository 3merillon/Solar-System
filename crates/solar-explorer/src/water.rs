//! The local water chart under the eye: procedural wave cache, advected foam and coastal bed.
//! State never leaves the GPU in play.
use crate::gpu::Gpu;

pub struct Water {
    wave_base: u32,
    pub state: wgpu::Buffer,
    pub wave_cache: wgpu::Buffer,
    wave_pipeline: wgpu::ComputePipeline,
    wave_group: wgpu::BindGroup,
    pub foam: [wgpu::Buffer; 2],
    pub bed: wgpu::Buffer,
    bed_pipeline: wgpu::ComputePipeline,
    bed_group: wgpu::BindGroup,
    prepare: wgpu::ComputePipeline,
    step: wgpu::ComputePipeline,
    prepare_group: wgpu::BindGroup,
    step_groups: [wgpu::BindGroup; 2],
}
impl Water {
    pub fn new(
        g: &Gpu,
        frame: &wgpu::Buffer,
        tier: &crate::tier::Tier,
        pages: &crate::pages::PageBindings,
    ) -> Self {
        use wgpu::BufferUsages as U;
        // Two WaterChart records (water.wgsl), one per frame parity.
        let state = g.buffer("water chart metadata", 160, U::STORAGE | U::COPY_SRC);
        let wave_cache = g.buffer(
            "filtered procedural wave jets",
            tier.wave_entries() * 32,
            U::STORAGE | U::COPY_SRC,
        );
        let foam = std::array::from_fn(|_| {
            g.buffer(
                "advected breaking-wave foam",
                512 * 512 * 4,
                U::STORAGE | U::COPY_SRC,
            )
        });
        let bed = g.buffer(
            "128 squared canonical coastal bed",
            128 * 128 * 16,
            U::STORAGE,
        );
        let pipeline = |name| {
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
        };
        let prepare = pipeline("water_chart_prepare");
        let step = pipeline("water_foam_step");
        let wave_pipeline = pipeline("water_cache_generate");
        let bed_pipeline = pipeline("water_bed_generate");
        fn b(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding,
                resource: buffer.as_entire_binding(),
            }
        }
        let mut prepare_entries = vec![b(0, frame), b(30, &state)];
        prepare_entries.extend(pages.entries("water_chart_prepare"));
        let prepare_group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("water chart relocation"),
            layout: &prepare.get_bind_group_layout(0),
            entries: &prepare_entries,
        });
        let step_groups = std::array::from_fn(|i| {
            g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("foam advection"),
                layout: &step.get_bind_group_layout(0),
                entries: &[
                    b(0, frame),
                    b(33, &state),
                    b(37, &wave_cache),
                    b(38, &foam[1 - i]),
                    b(39, &foam[i]),
                    b(43, &bed),
                ],
            })
        });
        let wave_group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("procedural wave cache"),
            layout: &wave_pipeline.get_bind_group_layout(0),
            entries: &[b(0, frame), b(33, &state), b(36, &wave_cache)],
        });
        let mut bed_entries = vec![b(0, frame), b(33, &state), b(42, &bed)];
        bed_entries.extend(pages.entries("water_bed_generate"));
        let bed_group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("coastal bed on chart relocation"),
            layout: &bed_pipeline.get_bind_group_layout(0),
            entries: &bed_entries,
        });
        Self {
            wave_base: tier.wave_base,
            wave_cache,
            wave_pipeline,
            wave_group,
            state,
            foam,
            bed,
            bed_pipeline,
            bed_group,
            prepare,
            step,
            prepare_group,
            step_groups,
        }
    }
    pub fn encode(
        &self,
        e: &mut wgpu::CommandEncoder,
        parity: usize,
        marker: &mut crate::timing::Marker,
    ) {
        {
            let mut p = e.begin_compute_pass(&Default::default());
            p.set_pipeline(&self.prepare);
            p.set_bind_group(0, &self.prepare_group, &[]);
            p.dispatch_workgroups(1, 1, 1);
        }
        marker.mark(e, "water_chart");
        {
            let mut p = e.begin_compute_pass(&Default::default());
            p.set_pipeline(&self.bed_pipeline);
            p.set_bind_group(0, &self.bed_group, &[]);
            p.dispatch_workgroups(16, 16, 1);
        }
        marker.mark(e, "water_bed");
        {
            let mut p = e.begin_compute_pass(&Default::default());
            p.set_pipeline(&self.wave_pipeline);
            p.set_bind_group(0, &self.wave_group, &[]);
            p.dispatch_workgroups(self.wave_base / 8, self.wave_base / 8, 5);
        }
        marker.mark(e, "water_waves");
        {
            let mut p = e.begin_compute_pass(&Default::default());
            p.set_pipeline(&self.step);
            p.set_bind_group(0, &self.step_groups[parity], &[]);
            p.dispatch_workgroups(64, 64, 1);
        }
    }
    pub fn bytes(&self) -> u64 {
        self.wave_cache.size()
            + self.state.size()
            + self.foam.iter().map(wgpu::Buffer::size).sum::<u64>()
            + self.bed.size()
    }
}

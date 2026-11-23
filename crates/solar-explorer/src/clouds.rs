use crate::{gpu::Gpu, startup};

/// A seamless shape field shared by the view, shadow rays and orbital map.
/// Camera motion, animation and world changes only alter its sample coordinates.
pub(crate) struct CloudShape {
    view: wgpu::TextureView,
    sampler: wgpu::Sampler,
}

impl CloudShape {
    pub const SIDE: u32 = 48;
    pub const BYTES: u64 = Self::SIDE as u64 * Self::SIDE as u64 * Self::SIDE as u64 * 8;

    pub fn new(g: &Gpu) -> Self {
        let texture = g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("periodic cloud shape"),
            size: wgpu::Extent3d {
                width: Self::SIDE,
                height: Self::SIDE,
                depth_or_array_layers: Self::SIDE,
            },
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::Rgba16Float,
            mip_level_count: 1,
            sample_count: 1,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let key = "cloud_shape_generate";
        let pipeline = g
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(key),
                layout: None,
                module: &startup::shader(g, key),
                entry_point: Some(key),
                compilation_options: Default::default(),
                cache: g.cache(),
            });
        let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(key),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 48,
                resource: wgpu::BindingResource::TextureView(&view),
            }],
        });
        let mut encoder = g.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &group, &[]);
            let groups = Self::SIDE.div_ceil(4);
            pass.dispatch_workgroups(groups, groups, groups);
        }
        g.queue.submit([encoder.finish()]);
        let sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("periodic cloud shape"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            address_mode_w: wgpu::AddressMode::Repeat,
            min_filter: wgpu::FilterMode::Linear,
            mag_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self { view, sampler }
    }

    pub fn entries(&self) -> [wgpu::BindGroupEntry<'_>; 2] {
        [
            wgpu::BindGroupEntry {
                binding: 49,
                resource: wgpu::BindingResource::TextureView(&self.view),
            },
            wgpu::BindGroupEntry {
                binding: 87,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            },
        ]
    }
}

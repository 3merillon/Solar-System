//! Fixed-capacity GPU scenery. No production geometry/instance/pixel uploads.
//!
//! Second pass (docs/SCENERY.md): trees grown from a species model on the GPU (skeleton, tubes and leaf cards at three
//! levels of detail on shared template topologies), rocks in six geological families, ground cover near the eye, a
//! procedural twig-and-leaf card atlas per species and an impostor atlas per variant. One generation job per frame,
//! chosen on the GPU (`scenery_begin`); every pass below is gated by indirect arguments or an early exit.
use crate::{gpu::Gpu, gpu_terrain::GpuTerrain};
use std::sync::{Arc, Mutex};
pub const SOURCE: &str = concat!(
    include_str!("../../../shaders/explorer.wgsl"),
    "\n",
    include_str!("../../../shaders/surface_field.wgsl"),
    "\n",
    include_str!("../../../shaders/surface_detail.wgsl"),
    "\n",
    include_str!("../../../shaders/water.wgsl"),
    "\n",
    include_str!("../../../shaders/clouds.wgsl"),
    "\n",
    include_str!("../../../shaders/sun_visibility.wgsl"),
    "\n",
    include_str!("../../../shaders/sun_clouds.wgsl"),
    "\n",
    include_str!("../../../shaders/scenery_common.wgsl"),
    "\n",
    include_str!("../../../shaders/terrain_gpu.wgsl"),
    "\n",
    include_str!("../../../shaders/scenery_trees.wgsl"),
    "\n",
    include_str!("../../../shaders/scenery.wgsl"),
    "\n",
    include_str!("../../../shaders/scenery_cover.wgsl"),
    "\n",
    include_str!("../../../shaders/sun_casters.wgsl"),
    "\n",
    include_str!("../../../shaders/buildings.wgsl")
);
/// Words in `ScState` (scenery.wgsl), rounded up to the buffer.
pub const STATE_BYTES: u64 = 8192;
/// Byte offset of the indirect draws (8 words each) and generation dispatches in `ScState`.
pub const ARGS: u64 = 40 * 4;
pub const DISPATCH: u64 = 168 * 4;
/// Compacted draw list entries over all classes (scenery.wgsl `SC_LIST_TOTAL`).
pub const VISIBLE: u64 = 107_520;
/// Ground cover instances over all lists (scenery_cover.wgsl `CV_TOTAL`), 32 bytes each.
pub const COVER: u64 = 155_648;
pub const COVER_BASES: [usize; 6] = [0, 16_384, 81_920, 90_112, 122_880, 139_264];
/// Skeleton scratch, vec4 (1009 branches x 4 + 2048 cards x 3).
pub const SKELETON: u64 = 4036 + 2048 * 3;
/// Mesh classes: vertices per variant and template groups (count, columns, rows), as in scenery_trees.wgsl.
pub const CLASS_VERTS: [u64; 10] = [23825, 5891, 932, 1734, 486, 212, 124, 324, 56, 148];
pub const GROUPS: [&[(u64, u64, u64)]; 12] = [
    &[
        (1, 12, 20),
        (48, 7, 8),
        (192, 5, 4),
        (768, 3, 1),
        (2048, 1, 1),
    ],
    &[(1, 8, 10), (48, 5, 4), (192, 3, 2), (512, 1, 1)],
    &[(1, 5, 5), (48, 3, 1), (128, 1, 1)],
    &[(6, 16, 16)],
    &[(6, 8, 8)],
    &[(20, 1, 4), (3, 1, 1)],
    &[(10, 1, 4), (4, 1, 2)],
    &[(36, 2, 2)],
    &[(7, 1, 3)],
    &[(3, 3, 2), (28, 1, 1)],
    &[(8, 1, 4)],
    &[(6, 2, 2)],
];
pub fn template_quads() -> u64 {
    GROUPS
        .iter()
        .flat_map(|g| g.iter())
        .map(|(n, c, r)| n * c * r)
        .sum()
}
fn class_variants(tier: &crate::tier::Tier, c: usize) -> u64 {
    match c {
        0..=2 => 15 * u64::from(tier.tree_ages),
        3 | 4 => 24,
        5 | 7 => 8,
        _ => 4,
    }
}
pub fn geometry_vertices(tier: &crate::tier::Tier) -> u64 {
    (0..10)
        .map(|c| CLASS_VERTS[c] * class_variants(tier, c))
        .sum()
}
struct Pass {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
}
pub struct Scenery {
    pub urban: crate::urban::Urban,
    pages: crate::pages::PageBindings,
    pub capacity: u64,
    pub atlas_size: u32,
    pub leaf_size: u32,
    pub variants: u32,
    atlas_mips: u32,
    leaf_mip_count: u32,
    pub state: wgpu::Buffer,
    /// The generation dispatches, copied out of `state` each frame: a dispatch may not read its arguments from a
    /// buffer it also binds for writing.
    jobs: wgpu::Buffer,
    read: wgpu::Buffer,
    stats: Arc<Mutex<Option<Vec<u8>>>>,
    reading: Arc<Mutex<bool>>,
    pub instances: wgpu::Buffer,
    pub geometry: wgpu::Buffer,
    pub indices: wgpu::Buffer,
    skeleton: wgpu::Buffer,
    pub cover: wgpu::Buffer,
    cover_history: wgpu::Buffer,
    cover_admission: wgpu::Buffer,
    pub contact_probe: wgpu::Buffer,
    /// Diagnostics: published terrain under up to 16 large rocks (scenery.wgsl scenery_audit_footprint).
    pub footprint_probe: wgpu::Buffer,
    pub footprint_slots: wgpu::Buffer,
    footprint_audit: std::cell::OnceCell<Pass>,
    /// Diagnostics: published terrain around sampled ground-cover roots (scenery_cover.wgsl scenery_audit_cover).
    pub cover_probe: wgpu::Buffer,
    cover_audit: std::cell::OnceCell<Pass>,
    support_cache: wgpu::Buffer,
    pub visible: wgpu::Buffer,
    pub color: wgpu::Texture,
    pub normal: wgpu::Texture,
    pub leaf_color: wgpu::Texture,
    pub leaf_normal: wgpu::Texture,
    pub leaf_sampler: wgpu::Sampler,
    capture_color: wgpu::Texture,
    capture_normal: wgpu::Texture,
    depth: wgpu::Texture,
    capture_color_view: wgpu::TextureView,
    capture_normal_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    /// begin, place (far, near, middle: one pipeline, three band uniforms), support_begin, templates, skeleton, tree vertices, rock vertices, cover
    /// vertices, leaf atlas, capture copy, ready, draws, cover draws.
    passes: Vec<Pass>,
    /// Deferred with the scenery feature (see `renderer::Pipelines`).
    cull: Option<Pass>,
    refresh: Option<Pass>,
    cover_place: Option<Pass>,
    /// Records whose support is measured again this frame (scenery.wgsl `SC_REFRESH_CAP`).
    refresh_queue: wgpu::Buffer,
    audit: std::cell::OnceCell<Pass>,
    mips: Vec<Pass>,
    leaf_mips: Vec<Pass>,
    capture: wgpu::RenderPipeline,
    capture_group: wgpu::BindGroup,
    mesh: wgpu::RenderPipeline,
    mesh_group: wgpu::BindGroup,
    cover_mesh: wgpu::RenderPipeline,
    cover_group: wgpu::BindGroup,
    card: wgpu::RenderPipeline,
    card_group: wgpu::BindGroup,
}
/// Every buffer and view a scenery program may bind, by binding number.
struct Resources<'a> {
    buffers: Vec<(u32, &'a wgpu::Buffer)>,
    views: Vec<(u32, &'a wgpu::TextureView)>,
    sampler: &'a wgpu::Sampler,
}
impl Resources<'_> {
    fn entries<'b>(
        &'b self,
        key: &str,
        overrides: &[(u32, &'b wgpu::TextureView)],
    ) -> Vec<wgpu::BindGroupEntry<'b>> {
        crate::startup::program_bindings(key)
            .iter()
            .filter_map(|binding| {
                if *binding == 146 {
                    return Some(wgpu::BindGroupEntry {
                        binding: *binding,
                        resource: wgpu::BindingResource::Sampler(self.sampler),
                    });
                }
                if let Some((_, v)) = overrides
                    .iter()
                    .find(|(b, _)| b == binding)
                    .or_else(|| self.views.iter().find(|(b, _)| b == binding))
                {
                    return Some(wgpu::BindGroupEntry {
                        binding: *binding,
                        resource: wgpu::BindingResource::TextureView(v),
                    });
                }
                self.buffers
                    .iter()
                    .find(|(b, _)| b == binding)
                    .map(|(_, b)| wgpu::BindGroupEntry {
                        binding: *binding,
                        resource: b.as_entire_binding(),
                    })
            })
            .collect()
    }
}
impl Scenery {
    pub fn new(
        g: &Gpu,
        frame: &wgpu::Buffer,
        terrain: &GpuTerrain,
        vertices: &[wgpu::Buffer; 2],
        indices: &wgpu::Buffer,
        tier: &crate::tier::Tier,
        pages: &crate::pages::PageBindings,
    ) -> Self {
        use wgpu::BufferUsages as U;
        let urban = crate::urban::Urban::new(g);
        let capacity = tier.sc_cap();
        let atlas_size = tier.atlas;
        let leaf_size = tier.leaf_atlas;
        let variants = tier.sc_variants() - 24;
        let atlas_mips = tier.atlas_mips();
        let leaf_mip_count = leaf_size.trailing_zeros().saturating_sub(4).max(1);
        let state = g.buffer(
            "scenery bounded state, jobs and indirect draws",
            STATE_BYTES,
            U::STORAGE | U::INDIRECT | U::COPY_SRC,
        );
        let footprint_probe = g.buffer(
            "bounded footprint diagnostic",
            16 * 2748 * 16,
            U::STORAGE | U::COPY_SRC,
        );
        let footprint_slots = g.buffer("footprint diagnostic rocks", 64, U::STORAGE | U::COPY_DST);
        let cover_probe = g.buffer(
            "bounded cover contact diagnostic",
            64 * 64 * 16,
            U::STORAGE | U::COPY_SRC,
        );
        let refresh_queue = g.buffer("scenery support refresh queue", 65_536 * 4, U::STORAGE);
        let jobs = g.buffer(
            "scenery generation dispatches",
            64,
            U::INDIRECT | U::COPY_DST,
        );
        let contact_probe = g.buffer(
            "bounded contact diagnostic",
            64 * 64 * 16,
            U::STORAGE | U::COPY_SRC,
        );
        let geometry = g.buffer(
            "GPU generated variant geometry (packed, 32 bytes a vertex)",
            geometry_vertices(tier) * 32,
            U::STORAGE | U::COPY_SRC,
        );
        let template = g.buffer(
            "GPU template indices per mesh class",
            template_quads() * 6 * 4,
            U::STORAGE | U::INDEX,
        );
        let skeleton = g.buffer(
            "tree skeleton scratch (one variant at a time)",
            SKELETON * 16,
            U::STORAGE,
        );
        let cover_history = g.buffer(
            "bounded cover appearance history",
            6 * 512 * 512 * 48,
            U::STORAGE,
        );
        let cover_admission = g.buffer(
            "stable cover admission",
            (1536 + 6) * 4,
            U::STORAGE | U::COPY_DST,
        );
        let cover = g.buffer(
            "ground cover instances, rebuilt each frame",
            COVER * 32,
            U::STORAGE | U::COPY_SRC,
        );
        let instances = g.buffer(
            "canonical toroidal scenery records",
            capacity * 112,
            U::STORAGE | U::COPY_SRC,
        );
        let visible = g.buffer(
            "compacted scenery draw lists per class",
            VISIBLE * 4,
            U::STORAGE | U::COPY_SRC,
        );
        let support_cache = g.buffer(
            "scenery exact support stamps",
            96 + capacity * 4,
            U::STORAGE,
        );
        let texture = |label, size: u32, format, layers, mips, usage| {
            g.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size,
                    height: size,
                    depth_or_array_layers: layers,
                },
                mip_level_count: mips,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        use wgpu::TextureUsages as T;
        let atlas_usage = T::TEXTURE_BINDING | T::STORAGE_BINDING | T::COPY_SRC;
        let color = texture(
            "impostor colour atlas (sqrt albedo, coverage)",
            atlas_size,
            wgpu::TextureFormat::Rgba8Unorm,
            variants,
            atlas_mips,
            atlas_usage,
        );
        let normal = texture(
            "impostor normal and depth atlas",
            atlas_size,
            wgpu::TextureFormat::Rgba8Unorm,
            variants,
            atlas_mips,
            atlas_usage,
        );
        let leaf_color = texture(
            "twig and leaf card atlas (sqrt albedo, coverage)",
            leaf_size,
            wgpu::TextureFormat::Rgba8Unorm,
            16,
            leaf_mip_count,
            atlas_usage,
        );
        let leaf_normal = texture(
            "twig and leaf card normal, translucency, height",
            leaf_size,
            wgpu::TextureFormat::Rgba8Unorm,
            16,
            leaf_mip_count,
            atlas_usage,
        );
        let capture_usage = T::RENDER_ATTACHMENT | T::TEXTURE_BINDING;
        let capture_color = texture(
            "impostor capture colour (one variant)",
            atlas_size,
            wgpu::TextureFormat::Rgba16Float,
            1,
            1,
            capture_usage,
        );
        let capture_normal = texture(
            "impostor capture normal and depth (one variant)",
            atlas_size,
            wgpu::TextureFormat::Rgba16Float,
            1,
            1,
            capture_usage,
        );
        let depth = texture(
            "impostor capture depth",
            atlas_size,
            wgpu::TextureFormat::Depth32Float,
            1,
            1,
            T::RENDER_ATTACHMENT,
        );
        let leaf_sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("leaf card sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            anisotropy_clamp: 4,
            ..Default::default()
        });
        let array_view = |t: &wgpu::Texture, mip: u32, count: Option<u32>| {
            t.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: mip,
                mip_level_count: count,
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            })
        };
        let color_all = array_view(&color, 0, None);
        let normal_all = array_view(&normal, 0, None);
        let color0 = array_view(&color, 0, Some(1));
        let normal0 = array_view(&normal, 0, Some(1));
        let leaf_color_all = array_view(&leaf_color, 0, None);
        let leaf_normal_all = array_view(&leaf_normal, 0, None);
        let leaf_color0 = array_view(&leaf_color, 0, Some(1));
        let leaf_normal0 = array_view(&leaf_normal, 0, Some(1));
        let capture_color_view = capture_color.create_view(&Default::default());
        let capture_normal_view = capture_normal.create_view(&Default::default());
        let depth_view = depth.create_view(&Default::default());
        let resources = Resources {
            buffers: vec![
                (127, &urban.sources),
                (128, &urban.points),
                (134, &urban.control),
                (177, &urban.index),
                (0, frame),
                (4, &vertices[0]),
                (28, &vertices[1]),
                (20, &terrain.state),
                (21, &terrain.owners),
                (22, &vertices[0]),
                (29, &vertices[1]),
                (23, indices),
                (50, &state),
                (51, &geometry),
                (52, &instances),
                (53, &visible),
                (58, &geometry),
                (59, &instances),
                (60, &visible),
                (61, &state),
                (63, &contact_probe),
                (82, &support_cache),
                (154, &refresh_queue),
                (140, &skeleton),
                (141, &template),
                (149, &cover),
                (169, &cover_history),
                (176, &cover_admission),
                (150, &cover),
            ],
            views: vec![
                (54, &color_all),
                (55, &normal_all),
                (56, &color0),
                (57, &normal0),
                (142, &leaf_color0),
                (143, &leaf_normal0),
                (144, &leaf_color_all),
                (145, &leaf_normal_all),
                (147, &capture_color_view),
                (148, &capture_normal_view),
            ],
            sampler: &leaf_sampler,
        };
        let compute = |name: &str, overrides: &[(u32, &wgpu::TextureView)]| {
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
            let mut e = resources.entries(name, overrides);
            e.extend(pages.entries(name));
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(name),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &e,
            });
            Pass { pipeline, group }
        };
        // Placement: one program, a band uniform per dispatch (far, near, middle at passes 1, 2, 3).
        let place_module = crate::startup::shader(g, "scenery_place");
        let place_pipeline = g
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("scenery_place"),
                layout: None,
                module: &place_module,
                entry_point: Some("scenery_place"),
                compilation_options: Default::default(),
                cache: g.cache(),
            });
        let place_bands: Vec<wgpu::Buffer> = [2u32, 0, 1]
            .iter()
            .map(|band| {
                let b = g.buffer(
                    "scenery placement band",
                    16,
                    wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                );
                g.queue
                    .write_buffer(&b, 0, bytemuck::cast_slice(&[*band, 0, 0, 0]));
                b
            })
            .collect();
        let place = |band: &wgpu::Buffer| {
            let mut e = resources.entries("scenery_place", &[]);
            e.push(wgpu::BindGroupEntry {
                binding: 175,
                resource: band.as_entire_binding(),
            });
            e.extend(pages.entries("scenery_place"));
            Pass {
                pipeline: place_pipeline.clone(),
                group: g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("scenery_place"),
                    layout: &place_pipeline.get_bind_group_layout(0),
                    entries: &e,
                }),
            }
        };
        let mut passes: Vec<Pass> = [
            "scenery_begin",
            "scenery_support_begin",
            "scenery_templates",
            "scenery_tree_skeleton",
            "scenery_tree_vertices",
            "scenery_rock_vertices",
            "scenery_cover_vertices",
            "scenery_leaf_atlas",
            "scenery_capture_copy",
            "scenery_ready",
            "scenery_draws",
            "scenery_cover_draws",
            "scenery_classify",
            "scenery_cover_select",
            "scenery_cover_emit",
        ]
        .iter()
        .map(|name| compute(name, &[]))
        .collect();
        for (i, band) in place_bands.iter().enumerate() {
            passes.insert(1 + i, place(band));
        }
        let mip_chain = |name: &str,
                         count: u32,
                         textures: [&wgpu::Texture; 2],
                         bindings: [u32; 4]|
         -> Vec<Pass> {
            (1..count)
                .map(|mip| {
                    let src_c = array_view(textures[0], mip - 1, Some(1));
                    let src_n = array_view(textures[1], mip - 1, Some(1));
                    let dst_c = array_view(textures[0], mip, Some(1));
                    let dst_n = array_view(textures[1], mip, Some(1));
                    compute(
                        name,
                        &[
                            (bindings[0], &src_c),
                            (bindings[1], &src_n),
                            (bindings[2], &dst_c),
                            (bindings[3], &dst_n),
                        ],
                    )
                })
                .collect()
        };
        let mips = mip_chain(
            "scenery_mip",
            atlas_mips,
            [&color, &normal],
            [54, 55, 56, 57],
        );
        let leaf_mip_passes = mip_chain(
            "scenery_leaf_mip",
            leaf_mip_count,
            [&leaf_color, &leaf_normal],
            [144, 145, 142, 143],
        );
        let raster = |vs: &str, fs: &str, capture: bool| {
            let module = crate::startup::shader(g, vs);
            let targets: Vec<_> = if capture {
                vec![wgpu::TextureFormat::Rgba16Float; 2]
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
            let pipeline = g
                .device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(vs),
                    layout: None,
                    vertex: wgpu::VertexState {
                        module: &module,
                        entry_point: Some(vs),
                        buffers: &[],
                        compilation_options: Default::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some(fs),
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
                        depth_compare: Some(if capture {
                            wgpu::CompareFunction::LessEqual
                        } else {
                            wgpu::CompareFunction::GreaterEqual
                        }),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: g.cache(),
                });
            let e = resources.entries(vs, &[]);
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(vs),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &e,
            });
            (pipeline, group)
        };
        let (capture, capture_group) = raster("scenery_capture", "scenery_capture_fragment", true);
        let (mesh, mesh_group) = raster("scenery_mesh", "scenery_mesh_fragment", false);
        let (cover_mesh, cover_group) =
            raster("scenery_cover_mesh", "scenery_mesh_fragment", false);
        let (card, card_group) = raster("scenery_card", "scenery_card_fragment", false);
        let read = g.buffer(
            "optional scenery counters",
            STATE_BYTES,
            U::MAP_READ | U::COPY_DST,
        );
        Self {
            urban,
            pages: pages.clone(),
            capacity,
            atlas_size,
            leaf_size,
            variants,
            atlas_mips,
            leaf_mip_count,
            read,
            stats: Arc::new(Mutex::new(None)),
            reading: Arc::new(Mutex::new(false)),
            state,
            jobs,
            instances,
            geometry,
            indices: template,
            skeleton,
            cover,
            cover_history,
            cover_admission,
            contact_probe,
            footprint_probe,
            footprint_slots,
            footprint_audit: std::cell::OnceCell::new(),
            cover_probe,
            cover_audit: std::cell::OnceCell::new(),
            support_cache,
            visible,
            color,
            normal,
            leaf_color,
            leaf_normal,
            leaf_sampler,
            capture_color,
            capture_normal,
            depth,
            capture_color_view,
            capture_normal_view,
            depth_view,
            passes,
            cull: None,
            refresh: None,
            cover_place: None,
            refresh_queue,
            audit: std::cell::OnceCell::new(),
            mips,
            leaf_mips: leaf_mip_passes,
            capture,
            capture_group,
            mesh,
            mesh_group,
            cover_mesh,
            cover_group,
            card,
            card_group,
        }
    }
    fn dispatch(p: &mut wgpu::ComputePass, a: &Pass, groups: [u32; 3]) {
        p.set_pipeline(&a.pipeline);
        p.set_bind_group(0, &a.group, &[]);
        p.dispatch_workgroups(groups[0], groups[1], groups[2]);
    }
    fn dispatch_indirect(&self, p: &mut wgpu::ComputePass, a: &Pass, job: u64) {
        p.set_pipeline(&a.pipeline);
        p.set_bind_group(0, &a.group, &[]);
        p.dispatch_workgroups_indirect(&self.jobs, job * 12);
    }
    fn timed<'a>(
        e: &'a mut wgpu::CommandEncoder,
        queries: Option<&'a wgpu::QuerySet>,
        stage: usize,
    ) -> wgpu::ComputePass<'a> {
        e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some(crate::timing::NAMES[stage]),
            timestamp_writes: queries.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(stage as u32 * 2),
                end_of_pass_write_index: Some(stage as u32 * 2 + 1),
            }),
        })
    }
    pub fn encode(
        &self,
        e: &mut wgpu::CommandEncoder,
        queries: Option<&wgpu::QuerySet>,
        _frame: u64,
        marker: &mut crate::timing::Marker,
    ) {
        let records = (self.capacity / 64) as u32;
        {
            let mut p = Self::timed(e, queries, 9);
            Self::dispatch(&mut p, &self.passes[0], [1, 1, 1]);
            for i in [2, 3, 1] {
                Self::dispatch(&mut p, &self.passes[i], [records, 1, 1]);
            }
        }
        marker.mark(e, "scenery_placement");
        e.copy_buffer_to_buffer(&self.state, DISPATCH, &self.jobs, 0, 60);
        {
            // One job at most: template indices and cover meshes once, a variant's skeleton and vertices, or a leaf layer.
            let mut p = Self::timed(e, queries, 10);
            self.dispatch_indirect(&mut p, &self.passes[5], 0);
            self.dispatch_indirect(&mut p, &self.passes[9], 0);
            self.dispatch_indirect(&mut p, &self.passes[6], 1);
            self.dispatch_indirect(&mut p, &self.passes[7], 2);
            self.dispatch_indirect(&mut p, &self.passes[8], 3);
            self.dispatch_indirect(&mut p, &self.passes[10], 4);
            for (i, a) in self.leaf_mips.iter().enumerate() {
                let size = (self.leaf_size >> (i + 1)).div_ceil(8);
                Self::dispatch(&mut p, a, [size, size, 1]);
            }
        }
        marker.mark(e, "scenery_generation");
        {
            let attachments = [&self.capture_color_view, &self.capture_normal_view].map(|view| {
                Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })
            });
            let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("bounded variant impostor capture"),
                color_attachments: &attachments,
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: queries.map(|q| wgpu::RenderPassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(22),
                    end_of_pass_write_index: Some(23),
                }),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            p.set_pipeline(&self.capture);
            p.set_bind_group(0, &self.capture_group, &[]);
            p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
            p.draw_indexed_indirect(&self.state, ARGS + 6 * 32);
            p.draw_indexed_indirect(&self.state, ARGS + 7 * 32);
        }
        {
            let mut p = Self::timed(e, queries, 15);
            let groups = self.atlas_size.div_ceil(8);
            Self::dispatch(&mut p, &self.passes[11], [groups, groups, 1]);
            for (i, a) in self.mips.iter().enumerate() {
                let size = (self.atlas_size >> (i + 1)).div_ceil(8);
                Self::dispatch(&mut p, a, [size, size, 1]);
            }
        }
        {
            let mut p = Self::timed(e, queries, 12);
            Self::dispatch(&mut p, &self.passes[12], [1, 1, 1]);
            Self::dispatch(&mut p, &self.passes[4], [1, 1, 1]);
            if let (Some(cull), Some(refresh)) = (&self.cull, &self.refresh) {
                Self::dispatch(&mut p, &self.passes[15], [records, 1, 1]);
                Self::dispatch(&mut p, refresh, [65_536 / 64, 1, 1]);
                Self::dispatch(&mut p, cull, [records, 1, 1]);
            }
            Self::dispatch(&mut p, &self.passes[13], [1, 1, 1]);
        }
        e.clear_buffer(&self.cover_admission, 0, Some(1536 * 4));
        {
            let mut p = Self::timed(e, queries, 16);
            if let Some(place) = &self.cover_place {
                Self::dispatch(&mut p, place, [64, 64, 6]);
                Self::dispatch(&mut p, &self.passes[16], [1, 1, 1]);
                Self::dispatch(&mut p, &self.passes[17], [6 * 512 * 512 / 64, 1, 1]);
            }
            Self::dispatch(&mut p, &self.passes[14], [1, 1, 1]);
        }
    }
    pub fn draw(
        &self,
        e: &mut wgpu::CommandEncoder,
        queries: Option<&wgpu::QuerySet>,
        views: [&wgpu::TextureView; 4],
    ) {
        let attachment = |view, load| {
            Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load,
                    store: wgpu::StoreOp::Store,
                },
            })
        };
        let attachments = [
            attachment(views[0], wgpu::LoadOp::Load),
            attachment(views[1], wgpu::LoadOp::Load),
            attachment(views[2], wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)),
        ];
        let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scenery surface visibility"),
            color_attachments: &attachments,
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: views[3],
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: queries.map(|q| wgpu::RenderPassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(26),
                end_of_pass_write_index: Some(27),
            }),
            occlusion_query_set: None,
            multiview_mask: None,
        });
        p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
        p.set_pipeline(&self.mesh);
        p.set_bind_group(0, &self.mesh_group, &[]);
        for class in 0..5 {
            p.draw_indexed_indirect(&self.state, ARGS + class * 32);
        }
        p.draw_indexed_indirect(&self.state, ARGS + 14 * 32);
        p.set_pipeline(&self.card);
        p.set_bind_group(0, &self.card_group, &[]);
        p.draw_indirect(&self.state, ARGS + 5 * 32);
        if self.cover_place.is_some() {
            p.set_pipeline(&self.cover_mesh);
            p.set_bind_group(0, &self.cover_group, &[]);
            for draw in 8..14 {
                p.draw_indexed_indirect(&self.state, ARGS + draw * 32);
            }
        }
    }
    pub fn cull_ready(&self) -> bool {
        self.cull.is_some() && self.refresh.is_some() && self.cover_place.is_some()
    }
    /// Create the deferred cull and ground-cover programs once they have compiled.
    pub fn complete(
        &mut self,
        g: &Gpu,
        frame: &wgpu::Buffer,
        terrain: &GpuTerrain,
        vertices: &[wgpu::Buffer; 2],
    ) -> bool {
        let mut changed = false;
        for (name, slot) in [
            ("scenery_cull", 0),
            ("scenery_cover_place", 1),
            ("scenery_refresh", 2),
        ] {
            let have = match slot {
                0 => self.cull.is_some(),
                1 => self.cover_place.is_some(),
                _ => self.refresh.is_some(),
            };
            if have || !crate::startup::pipeline_ready(name) {
                continue;
            }
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
            let buffers = [
                (127, &self.urban.sources),
                (128, &self.urban.points),
                (134, &self.urban.control),
                (177, &self.urban.index),
                (0, frame),
                (20, &terrain.state),
                (21, &terrain.owners),
                (22, &vertices[0]),
                (29, &vertices[1]),
                (50, &self.state),
                (52, &self.instances),
                (53, &self.visible),
                (82, &self.support_cache),
                (149, &self.cover),
                (169, &self.cover_history),
                (176, &self.cover_admission),
                (154, &self.refresh_queue),
            ];
            let used = crate::startup::program_bindings(name);
            let mut entries: Vec<_> = buffers
                .iter()
                .filter(|(b, _)| used.contains(b))
                .map(|(binding, b)| wgpu::BindGroupEntry {
                    binding: *binding,
                    resource: b.as_entire_binding(),
                })
                .collect();
            entries.extend(self.pages.entries(name));
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(name),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries,
            });
            let pass = Pass { pipeline, group };
            match slot {
                0 => self.cull = Some(pass),
                1 => self.cover_place = Some(pass),
                _ => self.refresh = Some(pass),
            }
            changed = true;
        }
        changed
    }
    /// Diagnostics only: the contact audit program compiles on first use.
    pub fn encode_audit(
        &self,
        g: &Gpu,
        e: &mut wgpu::CommandEncoder,
        frame: &wgpu::Buffer,
        terrain: &GpuTerrain,
        vertices: &[wgpu::Buffer; 2],
        indices: &wgpu::Buffer,
    ) {
        fn audit_entry(binding: u32, b: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding,
                resource: b.as_entire_binding(),
            }
        }
        let a = self.audit.get_or_init(|| {
            let name = "scenery_audit_contact";
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
            let used = crate::startup::program_bindings(name);
            let mut entries: Vec<_> = [
                audit_entry(0, frame),
                audit_entry(20, &terrain.state),
                audit_entry(22, &vertices[0]),
                audit_entry(23, indices),
                audit_entry(29, &vertices[1]),
                audit_entry(50, &self.state),
                audit_entry(52, &self.instances),
                audit_entry(53, &self.visible),
                audit_entry(63, &self.contact_probe),
            ]
            .into_iter()
            .filter(|e| used.contains(&e.binding))
            .collect();
            entries.extend(self.pages.entries(name));
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(name),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries,
            });
            Pass { pipeline, group }
        });
        let mut p = e.begin_compute_pass(&Default::default());
        p.set_pipeline(&a.pipeline);
        p.set_bind_group(0, &a.group, &[]);
        p.dispatch_workgroups(1, 1, 1);
    }
    /// Diagnostics only: gather the published terrain under the listed rocks (slots written by the caller).
    pub fn encode_footprint_audit(
        &self,
        g: &Gpu,
        e: &mut wgpu::CommandEncoder,
        frame: &wgpu::Buffer,
        terrain: &GpuTerrain,
        vertices: &[wgpu::Buffer; 2],
        indices: &wgpu::Buffer,
    ) {
        let a = self.footprint_audit.get_or_init(|| {
            let name = "scenery_audit_footprint";
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
            let used = crate::startup::program_bindings(name);
            let mut entries: Vec<_> = [
                (0, frame),
                (20, &terrain.state),
                (22, &vertices[0]),
                (23, indices),
                (29, &vertices[1]),
                (59, &self.instances),
                (151, &self.footprint_probe),
                (152, &self.footprint_slots),
            ]
            .into_iter()
            .filter(|(b, _)| used.contains(b))
            .map(|(binding, b)| wgpu::BindGroupEntry {
                binding,
                resource: b.as_entire_binding(),
            })
            .collect();
            entries.extend(self.pages.entries(name));
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(name),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries,
            });
            Pass { pipeline, group }
        });
        let mut p = e.begin_compute_pass(&Default::default());
        p.set_pipeline(&a.pipeline);
        p.set_bind_group(0, &a.group, &[]);
        p.dispatch_workgroups((16 * 49u32).div_ceil(64), 1, 1);
    }
    /// Diagnostics only: the published terrain around sampled ground-cover roots.
    pub fn encode_cover_audit(
        &self,
        g: &Gpu,
        e: &mut wgpu::CommandEncoder,
        frame: &wgpu::Buffer,
        terrain: &GpuTerrain,
        vertices: &[wgpu::Buffer; 2],
        indices: &wgpu::Buffer,
    ) {
        let a = self.cover_audit.get_or_init(|| {
            let name = "scenery_audit_cover";
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
            let used = crate::startup::program_bindings(name);
            let mut entries: Vec<_> = [
                (0, frame),
                (20, &terrain.state),
                (22, &vertices[0]),
                (23, indices),
                (29, &vertices[1]),
                (50, &self.state),
                (149, &self.cover),
                (169, &self.cover_history),
                (176, &self.cover_admission),
                (153, &self.cover_probe),
            ]
            .into_iter()
            .filter(|(b, _)| used.contains(b))
            .map(|(binding, b)| wgpu::BindGroupEntry {
                binding,
                resource: b.as_entire_binding(),
            })
            .collect();
            entries.extend(self.pages.entries(name));
            let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(name),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries,
            });
            Pass { pipeline, group }
        });
        let mut p = e.begin_compute_pass(&Default::default());
        p.set_pipeline(&a.pipeline);
        p.set_bind_group(0, &a.group, &[]);
        p.dispatch_workgroups(1, 1, 1);
    }
    pub fn request_stats(&self, g: &Gpu) {
        let mut busy = self.reading.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
        drop(busy);
        let mut e = g.device.create_command_encoder(&Default::default());
        e.copy_buffer_to_buffer(&self.state, 0, &self.read, 0, STATE_BYTES);
        g.queue.submit([e.finish()]);
        let read = self.read.clone();
        let stats = self.stats.clone();
        let busy = self.reading.clone();
        self.read
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                if result.is_ok() {
                    if let Ok(bytes) = read.slice(..).get_mapped_range() {
                        *stats.lock().unwrap() = Some(bytes.to_vec());
                    }
                    read.unmap();
                }
                *busy.lock().unwrap() = false;
            });
    }
    pub fn stats(&self) -> serde_json::Value {
        let guard = self.stats.lock().unwrap();
        let Some(b) = guard.as_ref() else {
            return serde_json::json!({"ready":false});
        };
        Self::decode_stats(b)
    }
    /// The `ScState` words (scenery.wgsl): counters 20-35, job 36-39, draws from 40 (8 words each), ready 184,
    /// leaf layers 256, capture radii 344, class counts 416.
    pub fn decode_stats(b: &[u8]) -> serde_json::Value {
        let u = |i: usize| u32::from_le_bytes(b[i * 4..i * 4 + 4].try_into().unwrap());
        let variants = u(6) as usize;
        let draws = |d: usize| u(40 + d * 8 + 1);
        let ready: Vec<u32> = (0..variants.min(72)).map(|i| u(184 + i)).collect();
        serde_json::json!({
            "ready":true,
            "variants":ready.iter().filter(|r|**r!=0).count(),
            "variants_total":variants,
            "tree_variants":u(5),
            "variant_ready":ready.iter().map(|r|*r!=0).collect::<Vec<_>>(),
            "variant_captured":ready.iter().map(|r|*r>=2).collect::<Vec<_>>(),
            "leaf_ready":(0..16).map(|i|u(256+i)!=0).collect::<Vec<_>>(),
            "capture_radii":(0..variants.min(72)).map(|i|f32::from_bits(u(344+i))).collect::<Vec<_>>(),
            "requests":u(20),"generated":u(21),"resident":u(22),"trees":u(23),"rocks":u(24),"deferred":u(25),"overflow":u(26),"support_deferred":u(27),
            "canonical_display_delta_max_m":f32::from_bits(u(28)),"footprint_rejected":u(29),"support_reused":u(30),"support_refreshed":u(31),
            "mesh_draws":(0..5).map(draws).sum::<u32>() + draws(14),"impostor_draws":draws(5),
            "class_draws":(0..6).chain(std::iter::once(14)).map(draws).collect::<Vec<_>>(),
            "class_appended":(0..6).chain(std::iter::once(14)).map(|k|u(416+k)).collect::<Vec<_>>(),
            "templates":u(7)!=0,"job":[u(36),u(37)],"jobs_done":u(38),"support_queue":u(39),
            "cover":{"instances":u(32),"overflow":u(33),"candidates":u(34),"water_rejected":u(35),"draws":(8..14).map(draws).collect::<Vec<_>>()}
        })
    }
    pub fn bytes(&self) -> u64 {
        let atlas: u64 = (0..self.atlas_mips)
            .map(|m| u64::from(self.atlas_size >> m).pow(2))
            .sum();
        let leaf: u64 = (0..self.leaf_mip_count)
            .map(|m| u64::from(self.leaf_size >> m).pow(2))
            .sum();
        crate::urban::INDEX_BYTES
            + self.contact_probe.size()
            + self.footprint_probe.size()
            + self.footprint_slots.size()
            + self.cover_probe.size()
            + self.support_cache.size()
            + self.read.size()
            + self.state.size()
            + self.jobs.size()
            + self.instances.size()
            + self.geometry.size()
            + self.indices.size()
            + self.skeleton.size()
            + self.cover.size()
            + self.cover_history.size()
            + self.cover_admission.size()
            + self.visible.size()
            + self.refresh_queue.size()
            + 2 * 4 * u64::from(self.variants) * atlas
            + 2 * 4 * 16 * leaf
            + 2 * 8 * u64::from(self.atlas_size).pow(2)
            + 4 * u64::from(self.atlas_size).pow(2)
    }
    pub fn textures(&self) -> [&wgpu::Texture; 7] {
        [
            &self.color,
            &self.normal,
            &self.leaf_color,
            &self.leaf_normal,
            &self.capture_color,
            &self.capture_normal,
            &self.depth,
        ]
    }
}
/// Diagnostics: decode every generated vertex (scenery_trees.wgsl `sc_pack`), count non-finite or out-of-range values,
/// and measure each variant's radius from its model centre in its finest class, for the capture-bound gate.
pub fn inspect_geometry(
    bytes: &[u8],
    tier: &crate::tier::Tier,
    stats: &serde_json::Value,
) -> serde_json::Value {
    let tree_variants = 15 * tier.tree_ages as usize;
    let variants = tree_variants + 24;
    let mut radii = vec![0.0_f32; variants];
    let mut nonfinite = 0usize;
    let mut vertices_checked = 0usize;
    let mut materials = [0usize; 16];
    let mut base = 0u64;
    for (c, &count) in CLASS_VERTS.iter().enumerate() {
        let rows = class_variants(tier, c);
        for row in 0..rows {
            let variant = match c {
                0..=2 => row as usize,
                3 | 4 => tree_variants + row as usize,
                _ => usize::MAX,
            };
            if variant != usize::MAX
                && !stats["variant_ready"]
                    .get(variant)
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            {
                continue;
            }
            for v in 0..count {
                let i = ((base + row * count + v) * 32) as usize;
                if i + 32 > bytes.len() {
                    break;
                }
                let w = |k: usize| {
                    u32::from_le_bytes(bytes[i + k * 4..i + k * 4 + 4].try_into().unwrap())
                };
                let material = (w(5) & 15) as usize;
                materials[material] += 1;
                if material == 0 {
                    continue;
                }
                vertices_checked += 1;
                let q = [
                    w(0) & 0x1fffff,
                    (w(0) >> 21) | ((w(1) & 0x3ff) << 11),
                    (w(1) >> 10) & 0x1fffff,
                ];
                let p = q.map(|x| x as f32 / 2_097_151.0 * 4.0 - 2.0);
                let halves = |word: u32| [f16_to_f32(word as u16), f16_to_f32((word >> 16) as u16)];
                let [bend, flutter] = halves(w(6));
                let [radius, extra] = halves(w(7));
                if ![bend, flutter, radius, extra].iter().all(|x| x.is_finite())
                    || p.iter().any(|x| x.abs() > 1.999)
                {
                    nonfinite += 1;
                }
                if variant != usize::MAX && (c == 0 || c == 3) {
                    let centre = if c == 0 { [0.0, 0.5, 0.0] } else { [0.0; 3] };
                    let r = (0..3)
                        .map(|k| (p[k] - centre[k]).powi(2))
                        .sum::<f32>()
                        .sqrt();
                    radii[variant] = radii[variant].max(r);
                }
            }
        }
        base += count * rows;
    }
    serde_json::json!({"nonfinite":nonfinite,"vertices_checked":vertices_checked,"variant_radii":radii,"materials":materials})
}
/// First vertex of a mesh class in the geometry buffer.
pub fn class_vertex_base(tier: &crate::tier::Tier, class: usize) -> u64 {
    (0..class)
        .map(|c| CLASS_VERTS[c] * class_variants(tier, c))
        .sum()
}
/// Model-space position of a packed vertex (scenery_trees.wgsl `sc_pack`).
pub fn vertex_position(bytes: &[u8], vertex: u64) -> Option<[f64; 3]> {
    let i = (vertex * 32) as usize;
    if i + 32 > bytes.len() {
        return None;
    }
    let w = |k: usize| u32::from_le_bytes(bytes[i + k * 4..i + k * 4 + 4].try_into().unwrap());
    let q = [
        w(0) & 0x1fffff,
        (w(0) >> 21) | ((w(1) & 0x3ff) << 11),
        (w(1) >> 10) & 0x1fffff,
    ];
    Some(q.map(|x| f64::from(x) / 2_097_151.0 * 4.0 - 2.0))
}
fn f16_to_f32(h: u16) -> f32 {
    let sign = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = (h >> 10) & 31;
    let mantissa = f32::from(h & 1023);
    sign * match exponent {
        0 => mantissa / 1024.0 * 2f32.powi(-14),
        31 => {
            if mantissa == 0.0 {
                f32::INFINITY
            } else {
                f32::NAN
            }
        }
        e => (1.0 + mantissa / 1024.0) * 2f32.powi(i32::from(e) - 15),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    /// The WGSL tables (vertices per class, quads, template total) must agree with GROUPS.
    #[test]
    fn class_tables_match_shader() {
        let wgsl = include_str!("../../../shaders/scenery_trees.wgsl");
        let table = |name: &str| -> Vec<u64> {
            let start = wgsl
                .find(&format!("fn {name}(c:u32)->u32{{switch c{{"))
                .unwrap();
            let body = &wgsl[start..start + wgsl[start..].find("default").unwrap()];
            body.split("return ")
                .skip(1)
                .map(|t| t[..t.find('u').unwrap()].parse().unwrap())
                .collect()
        };
        let verts = table("sc_class_verts");
        let quads = table("sc_class_quads");
        for (c, groups) in GROUPS.iter().enumerate() {
            let v: u64 = groups.iter().map(|(n, c, r)| n * (c + 1) * (r + 1)).sum();
            let q: u64 = groups.iter().map(|(n, c, r)| n * c * r).sum();
            if c < 10 {
                assert_eq!(v, CLASS_VERTS[c], "vertices of class {c}");
                assert_eq!(v, verts[c], "shader vertices of class {c}");
            }
            assert_eq!(q, quads[c], "quads of class {c}");
        }
        assert!(wgsl.contains(&format!(
            "const SC_TEMPLATE_QUADS:u32={}u;",
            template_quads()
        )));
        // The grass far copy is the first eight blades of class 5.
        assert_eq!(GROUPS[10][0], (8, GROUPS[5][0].1, GROUPS[5][0].2));
    }
    #[test]
    fn geometry_fits_a_storage_binding_on_every_tier() {
        for tier in [
            crate::tier::Tier::FULL,
            crate::tier::Tier::REDUCED,
            crate::tier::Tier::MINIMAL,
        ] {
            assert!(geometry_vertices(&tier) * 32 <= 128 << 20);
            assert!(tier.sc_variants() <= 72);
        }
    }
}

//! Bounded GPU sun visibility: canonical radial cache, light-space props and
//! registered cloud profiles. CPU uploads only a fixed lighting uniform.
use crate::{gpu::Gpu, scenery::Scenery};
use solar_core::field::{self, V3};

pub const CASCADES: usize = 6;
/// Per cascade: tree and rock caster meshes (indexed, 5 words each), impostor cards (4 words), padding.
pub const DRAW_WORDS: usize = CASCADES * 16;
const EXTENTS: [f64; CASCADES] = [8.0, 32.0, 96.0, 384.0, 1536.0, 6144.0];
/// Canonical radial height clipmaps: nine levels at x4 spacing from 1 m.
pub const HEIGHT_LEVELS: usize = 9;
/// Sun turn, radians, below which cloud profiles follow it by interleaved refresh
/// instead of a complete rebuild (0.05 degrees).
pub const SUN_REBAKE_ANGLE: f64 = 0.000_872_664_6;
/// First band each level leaves to live evaluation (band 8, the dominant
/// ridge band, is always live). Coarser levels trust fewer bands.
const LIVE_START: [usize; HEIGHT_LEVELS] = [19, 17, 15, 12, 10, 9, 9, 9, 9];

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct SunFrame {
    right: [f32; 4],
    up: [f32; 4],
    centers: [[f32; 4]; CASCADES],
    control: [f32; 4],
    metrics: [f32; 4],
    origins: [[u32; 4]; CASCADES],
    height_errors: [[f32; 4]; 12],
    cloud_centers: [[f32; 4]; 3],
    ceilings: [[u32; 4]; 3],
    cache_control: [u32; 4],
    quality: [f32; 4],
    height_refresh: [u32; 4],
}
struct Pass {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
}
pub struct Sun {
    pages: crate::pages::PageBindings,
    pub tier: crate::tier::Tier,
    pub uniform: wgpu::Buffer,
    pub heights: wgpu::TextureView,
    /// Per-level block maxima of the cached full height (2, 4, 8 and 16
    /// texel blocks per texel), rebuilt only when a level's texels change.
    pub maxima: wgpu::TextureView,
    pub depth: wgpu::TextureView,
    pub global: wgpu::TextureView,
    pub local: wgpu::TextureView,
    pub compare: wgpu::Sampler,
    pub sampler: wgpu::Sampler,
    pub wrap_sampler: wgpu::Sampler,
    pub state: wgpu::Buffer,
    pub cache_state: wgpu::Buffer,
    cache_begin: Pass,
    height_pass: Pass,
    block_pass: Pass,
    maxima_pass: Pass,
    // Deferred with the cloud feature (see `renderer::Pipelines`).
    cloud_global_pass: Option<Pass>,
    cloud_local_pass: Option<Pass>,
    begin: Pass,
    cull: Pass,
    mesh: wgpu::RenderPipeline,
    card: wgpu::RenderPipeline,
    /// Scenery template indices: casters draw the coarsest tree and rock meshes from them.
    indices: wgpu::Buffer,
    mesh_groups: Vec<wgpu::BindGroup>,
    card_groups: Vec<wgpu::BindGroup>,
    depth_layers: Vec<wgpu::TextureView>,
    cloud_key: Vec<f64>,
    solid_key: Vec<f64>,
    /// Sun direction of the last complete profile bake, and of the last frame.
    baked_sun: Option<V3>,
    last_sun: Option<V3>,
    light_right: Option<V3>,
    light_sun: Option<V3>,
    /// Light-grid phase in metres. Rotate the sampling lattice about the eye,
    /// not the planet centre; camera translation still traverses fixed texels.
    light_phase: V3,
    /// Frame index, interleave divisor, animation advanced, parameter jump.
    animation: [u32; 4],
    active_cascades: usize,
}
fn buffer(i: u32, b: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding: i,
        resource: b.as_entire_binding(),
    }
}
fn texture(i: u32, t: &wgpu::TextureView) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding: i,
        resource: wgpu::BindingResource::TextureView(t),
    }
}
fn sun_pass(
    g: &Gpu,
    name: &str,
    entries: &[wgpu::BindGroupEntry<'_>],
    pages: &crate::pages::PageBindings,
) -> Pass {
    let module = crate::startup::shader(g, name);
    let mut entries = entries.to_vec();
    entries.extend(pages.entries(name));
    entries.retain(|e| crate::startup::program_bindings(name).contains(&e.binding));
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
    let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(name),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &entries,
    });
    Pass { pipeline, group }
}
impl Sun {
    pub fn audit_layout(&self) -> serde_json::Value {
        serde_json::json!({"extents": EXTENTS, "right": self.light_right, "sun": self.light_sun})
    }
    pub fn new(
        g: &Gpu,
        frame: &wgpu::Buffer,
        scenery: &Scenery,
        tier: &crate::tier::Tier,
        pages: &crate::pages::PageBindings,
    ) -> Self {
        use wgpu::{BufferUsages as B, TextureFormat as F, TextureUsages as T};
        let uniform = g.buffer(
            "fixed sun frame",
            size_of::<SunFrame>() as u64,
            B::UNIFORM | B::COPY_DST,
        );
        let keys = g.buffer(
            "radial cache address validity",
            tier.height_texels() * 8,
            B::STORAGE,
        );
        let state = g.buffer(
            "sun indirect draws and overflow",
            (DRAW_WORDS as u64 + 4) * 4,
            B::STORAGE | B::INDIRECT | B::COPY_SRC,
        );
        let cache_state = g.buffer(
            "sun profile validity, rebuild counts, height maxima, maxima dirt",
            576,
            B::STORAGE | B::COPY_SRC,
        );
        // 16-block maxima of every level, slots modulo (n / 16 + 1) per axis.
        let blocks16 = g.buffer(
            "sun height 16-block maxima",
            HEIGHT_LEVELS as u64 * u64::from(tier.sun_height / 16 + 1).pow(2) * 4,
            B::STORAGE,
        );
        let draws = g.buffer(
            "bounded light-space caster IDs",
            CASCADES as u64 * 3 * u64::from(tier.sun_casters) * 4,
            B::STORAGE,
        );
        let make_texture = |label, size, layers, format, usage| {
            g.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size,
                    height: size,
                    depth_or_array_layers: layers,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let height_texture = make_texture(
            "canonical radial height clipmaps (full, coarse)",
            tier.sun_height,
            HEIGHT_LEVELS as u32,
            F::Rg32Float,
            T::TEXTURE_BINDING | T::STORAGE_BINDING,
        );
        let depth_texture = make_texture(
            "stable sun caster maps",
            tier.shadow_map,
            CASCADES as u32,
            F::Depth32Float,
            T::TEXTURE_BINDING | T::RENDER_ATTACHMENT,
        );
        let global_texture = make_texture(
            "equal-area sun-ray hemisphere profiles",
            tier.sun_global,
            8,
            F::Rgba16Float,
            T::TEXTURE_BINDING | T::STORAGE_BINDING,
        );
        let local_texture = make_texture(
            "local sun cloud profiles",
            258,
            24,
            F::Rgba16Float,
            T::TEXTURE_BINDING | T::STORAGE_BINDING,
        );
        let heights = height_texture.create_view(&Default::default());
        let maxima_texture = make_texture(
            "sun height block maxima (2, 4, 8, 16 texel blocks)",
            tier.sun_height,
            HEIGHT_LEVELS as u32,
            F::Rgba32Float,
            T::TEXTURE_BINDING | T::STORAGE_BINDING,
        );
        let maxima = maxima_texture.create_view(&Default::default());
        let depth = depth_texture.create_view(&Default::default());
        let global = global_texture.create_view(&Default::default());
        let local = local_texture.create_view(&Default::default());
        let depth_layers = (0..CASCADES as u32)
            .map(|i| {
                depth_texture.create_view(&wgpu::TextureViewDescriptor {
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: i,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let compare = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("sun comparison filter"),
            compare: Some(wgpu::CompareFunction::LessEqual),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("sun optical-depth interpolation"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        // Local profile maps are toroidal: repeat so bilinear neighbours wrap.
        let wrap_sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("toroidal local profile interpolation"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let compute =
            |name, entries: &[wgpu::BindGroupEntry<'_>]| sun_pass(g, name, entries, pages);
        let cache_begin = compute(
            "sun_cache_begin",
            &[
                buffer(0, frame),
                buffer(64, &uniform),
                buffer(81, &cache_state),
            ],
        );
        let height_pass = compute(
            "sun_height_generate",
            &[
                buffer(0, frame),
                buffer(64, &uniform),
                texture(71, &heights),
                buffer(72, &keys),
                buffer(81, &cache_state),
            ],
        );
        let block_pass = compute(
            "sun_height_blocks",
            &[
                buffer(0, frame),
                buffer(64, &uniform),
                texture(65, &heights),
                buffer(81, &cache_state),
                buffer(97, &blocks16),
            ],
        );
        let maxima_pass = compute(
            "sun_height_maxima",
            &[
                buffer(0, frame),
                buffer(64, &uniform),
                texture(65, &heights),
                buffer(81, &cache_state),
                texture(95, &maxima),
                buffer(97, &blocks16),
            ],
        );
        let begin = compute(
            "sun_caster_begin",
            &[
                buffer(0, frame),
                buffer(61, &scenery.state),
                buffer(64, &uniform),
                buffer(75, &state),
            ],
        );
        let cull = compute(
            "sun_caster_cull",
            &[
                buffer(0, frame),
                buffer(59, &scenery.instances),
                buffer(61, &scenery.state),
                buffer(64, &uniform),
                buffer(75, &state),
                buffer(76, &draws),
            ],
        );
        let raster = |vs, fs| {
            let module = crate::startup::shader(g, vs);
            g.device
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
                        targets: &[],
                        compilation_options: Default::default(),
                    }),
                    primitive: wgpu::PrimitiveState {
                        cull_mode: None,
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: F::Depth32Float,
                        depth_write_enabled: Some(true),
                        depth_compare: Some(wgpu::CompareFunction::LessEqual),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: g.cache(),
                })
        };
        let mesh = raster("sun_mesh_vertex", "sun_mesh_fragment");
        let card = raster("sun_card_vertex", "sun_card_fragment");
        let color = scenery.color.create_view(&Default::default());
        let normal = scenery.normal.create_view(&Default::default());
        let leaf = scenery.leaf_color.create_view(&Default::default());
        let mut mesh_groups = Vec::new();
        let mut card_groups = Vec::new();
        for layer in 0..CASCADES as u32 {
            let index = g.buffer("sun map index", 16, B::UNIFORM | B::COPY_DST);
            g.queue
                .write_buffer(&index, 0, bytemuck::cast_slice(&[layer, 0, 0, 0]));
            let all = [
                buffer(0, frame),
                texture(54, &color),
                texture(55, &normal),
                buffer(58, &scenery.geometry),
                buffer(59, &scenery.instances),
                buffer(61, &scenery.state),
                buffer(64, &uniform),
                buffer(77, &draws),
                buffer(78, &index),
                texture(144, &leaf),
                wgpu::BindGroupEntry {
                    binding: 146,
                    resource: wgpu::BindingResource::Sampler(&scenery.leaf_sampler),
                },
            ];
            let used = |key: &str| -> Vec<wgpu::BindGroupEntry<'_>> {
                all.iter()
                    .filter(|e| crate::startup::program_bindings(key).contains(&e.binding))
                    .cloned()
                    .collect()
            };
            let mesh_entries = used("sun_mesh_vertex");
            mesh_groups.push(g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("sun mesh"),
                layout: &mesh.get_bind_group_layout(0),
                entries: &mesh_entries,
            }));
            let card_entries = used("sun_card_vertex");
            card_groups.push(g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("sun-direction atlas"),
                layout: &card.get_bind_group_layout(0),
                entries: &card_entries,
            }));
        }
        Self {
            indices: scenery.indices.clone(),
            pages: pages.clone(),
            tier: *tier,
            uniform,
            heights,
            maxima,
            depth,
            global,
            local,
            compare,
            sampler,
            wrap_sampler,
            state,
            cache_state,
            cache_begin,
            height_pass,
            block_pass,
            maxima_pass,
            cloud_global_pass: None,
            cloud_local_pass: None,
            begin,
            cull,
            mesh,
            card,
            mesh_groups,
            card_groups,
            depth_layers,
            cloud_key: Vec::new(),
            solid_key: Vec::new(),
            baked_sun: None,
            last_sun: None,
            light_right: None,
            light_sun: None,
            light_phase: [0.0; 3],
            animation: [0; 4],
            active_cascades: CASCADES,
        }
    }
    /// Frame index and interleave divisor for animated profile refresh, plus
    /// whether animation advanced this frame and whether a parameter change or
    /// time jump demands a complete rebuild.
    pub fn set_animation(&mut self, frame: u32, divisor: u32, animated: bool, jump: bool) {
        self.animation = [frame, divisor, animated as u32, jump as u32];
    }
    pub fn entries(&self, solid: bool) -> Vec<wgpu::BindGroupEntry<'_>> {
        let mut entries = vec![
            buffer(64, &self.uniform),
            texture(68, &self.global),
            texture(69, &self.local),
            wgpu::BindGroupEntry {
                binding: 70,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            },
            wgpu::BindGroupEntry {
                binding: 83,
                resource: wgpu::BindingResource::Sampler(&self.wrap_sampler),
            },
        ];
        if solid {
            entries.extend([
                texture(65, &self.heights),
                texture(96, &self.maxima),
                texture(66, &self.depth),
                wgpu::BindGroupEntry {
                    binding: 67,
                    resource: wgpu::BindingResource::Sampler(&self.compare),
                },
            ]);
        }
        entries
    }
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        g: &Gpu,
        eye: V3,
        settings: &crate::renderer::Settings,
        clock: crate::animation::CloudClock,
        revision: u32,
        profiling: bool,
        body: &solar_core::body::BodyDescriptor,
        clipmap_refresh: u32,
        solid_generation: u32,
    ) {
        fn cross(a: V3, b: V3) -> V3 {
            [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ]
        }
        fn four(a: V3, w: f32) -> [f32; 4] {
            [a[0] as f32, a[1] as f32, a[2] as f32, w]
        }
        let sun = field::normalized(settings.sun);
        let axis = if sun[2].abs() < 0.95 {
            [0., 0., 1.]
        } else {
            [0., 1., 0.]
        };
        let candidate = self
            .light_right
            .map(|r| field::sub(r, field::mul(sun, field::dot(r, sun))));
        let right = if self.light_sun == Some(sun) {
            self.light_right.unwrap()
        } else {
            match candidate {
                Some(r) if field::length(r) > 0.1 => field::normalized(r),
                _ => field::normalized(cross(axis, sun)),
            }
        };
        let up = cross(sun, right);
        if self.light_sun != Some(sun) {
            let axes = [right, up, sun];
            if let (Some(old_right), Some(old_sun)) = (self.light_right, self.light_sun) {
                let old = [old_right, cross(old_sun, old_right), old_sun];
                for i in 0..3 {
                    self.light_phase[i] += field::dot(eye, field::sub(old[i], axes[i]));
                }
            } else {
                self.light_phase = axes.map(|axis| -field::dot(eye, axis));
            }
        }
        self.light_right = Some(right);
        self.light_sun = Some(sun);
        let mut origins = [[0; 4]; CASCADES];
        // A fixed-sun camera move traverses this world lattice. A sun rotation
        // preserves its phase at the eye, instead of sweeping Earth-radius
        // offsets through thousands of stochastic foliage texels per second.
        // No snapped sun direction, temporal image history, or geometry change.
        let eye_z = field::dot(eye, sun) + self.light_phase[2];
        let z = (eye_z / 64.0).round() * 64.0 - eye_z;
        let centers = std::array::from_fn(|i| {
            let extent = EXTENTS[i];
            let half = i64::from(self.tier.shadow_map / 2);
            let texel = extent / half as f64;
            let eye_x = field::dot(eye, right) + self.light_phase[0];
            let eye_y = field::dot(eye, up) + self.light_phase[1];
            let cx = (eye_x / texel).round() as i64;
            let cy = (eye_y / texel).round() as i64;
            origins[i] = [(cx - half) as u32, (-cy - half) as u32, 0, 0];
            let x = cx as f64 * texel - eye_x;
            let y = cy as f64 * texel - eye_y;
            four(
                field::add(
                    field::add(field::mul(right, x), field::mul(up, y)),
                    field::mul(sun, z),
                ),
                extent as f32,
            )
        });
        origins[0][2] = profiling as u32;
        // Optical parameters alone decide a full rebuild. Animation (clock
        // values) refreshes an interleaved fraction of columns per frame
        // unless the renderer flagged a time jump.
        let _ = clock;
        // The solar clock turns the sun a little every frame (Earth: 0.004 degrees per
        // second at rate 1). An exact sun key rebuilt every cloud profile, optical and
        // solid, every frame. Below SUN_REBAKE_ANGLE since the last complete bake the
        // profiles instead refresh an interleaved 1/divisor of their rows per frame (as
        // cloud animation does), so every row follows the sun within `divisor` frames;
        // a larger turn (a time jump, a new body) rebuilds everything as before.
        let drift = self
            .baked_sun
            .map_or(f64::INFINITY, |b| field::dot(b, sun).clamp(-1., 1.).acos());
        if drift > SUN_REBAKE_ANGLE {
            self.baked_sun = Some(sun);
        }
        let sun_drifting = drift <= SUN_REBAKE_ANGLE && self.last_sun != Some(sun);
        self.last_sun = Some(sun);
        let baked = self.baked_sun.unwrap_or(sun);
        let key = vec![
            settings.cloud_cover,
            settings.cloud_type,
            settings.cloud_turbulence,
            baked[0],
            baked[1],
            baked[2],
            settings.clouds as u32 as f64,
            settings.shadows as u32 as f64,
            revision as f64,
        ];
        let dirty = key != self.cloud_key || self.animation[3] != 0;
        self.cloud_key = key;
        let solid_key = vec![
            baked[0],
            baked[1],
            baked[2],
            settings.clouds as u32 as f64,
            settings.shadows as u32 as f64,
            revision as f64,
            solid_generation as f64,
        ];
        let solid_dirty = solid_key != self.solid_key;
        self.solid_key = solid_key;
        let skin = settings.skin();
        let measured = body.surface == solar_core::body::SurfaceKind::Measured;
        // Per level: x = full-cache envelope (interpolation of every cached
        // band plus the producer's omitted spectrum plus a 2 cm position
        // guard for the double-single producer); y = the two-part envelope
        // after live bands are evaluated exactly (cached bands only);
        // z = first live band; w = sub-texel crest margin: how far a band's
        // crest can rise above the texel-centre sample within one texel
        // (a sinusoid of the band's scale sampled at the texel spacing).
        // The receiver's own filtered spectrum is added per receiver on the
        // GPU instead of assuming the worst footprint of the level.
        let mut height_errors = [[0.0f32; 4]; 12];
        for (level, entry) in height_errors.iter_mut().enumerate().take(HEIGHT_LEVELS) {
            // A measured clipmap caches everything, so no band is live at any level. Its envelope
            // is the spectrum estimate, not a bound on data that has not been seen.
            let live_start = if measured { 24 } else { LIVE_START[level] };
            let envelope = solar_core::surface::SurfaceSource::clipmap_envelope(
                &skin,
                4.0f64.powi(level as i32),
                live_start,
            );
            *entry = [
                envelope.full as f32,
                envelope.live as f32,
                live_start as f32,
                envelope.margin as f32,
            ];
        }
        let frame = SunFrame {
            right: four(right, dirty as u32 as f32),
            up: four(up, solid_dirty as u32 as f32),
            centers,
            origins,
            height_errors,
            cloud_centers: [[0.; 4]; 3],
            ceilings: [[0; 4]; 3],
            cache_control: [
                self.animation[0],
                self.animation[1].max(1),
                (self.animation[2] != 0 || sun_drifting) as u32,
                sun_drifting as u32,
            ],
            height_refresh: [clipmap_refresh, 0, 0, 0],
            quality: [
                settings.shadow_cascades as f32,
                settings.profile_quality as f32,
                0.,
                0.,
            ],
            metrics: [
                if measured {
                    body.relief_limit as f32
                } else {
                    skin.height_bound() as f32
                },
                (field::length(eye) - body.radius) as f32,
                0.,
                0.,
            ],
            control: [
                settings.shadows as u32 as f32,
                settings.shadow_diagnostic as f32,
                0.00465,
                settings.shadow_steps as f32,
            ],
        };
        self.active_cascades = (settings.shadow_cascades as usize).clamp(1, CASCADES);
        g.queue
            .write_buffer(&self.uniform, 0, bytemuck::bytes_of(&frame));
    }
    pub fn clouds_ready(&self) -> bool {
        self.cloud_global_pass.is_some() && self.cloud_local_pass.is_some()
    }
    /// Forget the profile keys so the next update rebuilds both maps: a
    /// rebuild flagged while the programs were still pending wrote nothing.
    pub fn invalidate(&mut self) {
        self.cloud_key.clear();
        self.solid_key.clear();
    }
    /// Create the cloud profile programs once they have compiled.
    pub fn complete(
        &mut self,
        g: &Gpu,
        frame: &wgpu::Buffer,
        weather: &wgpu::TextureView,
        cloud_sampler: &wgpu::Sampler,
    ) -> bool {
        if self.clouds_ready() {
            return false;
        }
        let entries = [
            buffer(0, frame),
            texture(46, weather),
            wgpu::BindGroupEntry {
                binding: 50,
                resource: wgpu::BindingResource::Sampler(cloud_sampler),
            },
            buffer(64, &self.uniform),
            texture(65, &self.heights),
            texture(73, &self.global),
            texture(74, &self.local),
            buffer(81, &self.cache_state),
        ];
        let mut changed = false;
        if self.cloud_global_pass.is_none()
            && crate::startup::pipeline_ready("sun_cloud_global_generate")
        {
            let pass = sun_pass(g, "sun_cloud_global_generate", &entries, &self.pages);
            self.cloud_global_pass = Some(pass);
            changed = true;
        }
        if self.cloud_local_pass.is_none()
            && crate::startup::pipeline_ready("sun_cloud_local_generate")
        {
            let pass = sun_pass(g, "sun_cloud_local_generate", &entries, &self.pages);
            self.cloud_local_pass = Some(pass);
            changed = true;
        }
        changed
    }
    /// `props`: whether scenery is drawn this frame; without it no caster is
    /// culled into the shadow maps (the draw counters are still reset).
    pub fn encode(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        queries: Option<&wgpu::QuerySet>,
        props: bool,
        buildings: &crate::buildings::Buildings,
        marker: &mut crate::timing::Marker,
    ) {
        for (stage, jobs) in [
            (
                17,
                vec![
                    (Some(&self.cache_begin), [1, 1, 1]),
                    (
                        Some(&self.height_pass),
                        [
                            self.tier.sun_height / 8,
                            self.tier.sun_height / 8,
                            HEIGHT_LEVELS as u32,
                        ],
                    ),
                    // One 16 x 16 workgroup per 16-texel block of every level
                    // (one extra per axis: the window need not start on a
                    // block), twice: 16-block maxima, then every texel's 4, 16,
                    // 64 and 256-block maxima. Levels whose texels did not
                    // change return at once.
                    (
                        Some(&self.block_pass),
                        [
                            self.tier.sun_height / 16 + 1,
                            self.tier.sun_height / 16 + 1,
                            HEIGHT_LEVELS as u32,
                        ],
                    ),
                    (
                        Some(&self.maxima_pass),
                        [
                            self.tier.sun_height / 16 + 1,
                            self.tier.sun_height / 16 + 1,
                            HEIGHT_LEVELS as u32,
                        ],
                    ),
                ],
            ),
            (
                20,
                vec![(
                    self.cloud_global_pass.as_ref(),
                    [self.tier.sun_global.div_ceil(64), self.tier.sun_global, 1],
                )],
            ),
            (
                21,
                vec![(
                    self.cloud_local_pass.as_ref(),
                    [258u32.div_ceil(64), 258, 3],
                )],
            ),
            (
                22,
                vec![
                    (Some(&self.begin), [1, 1, 1]),
                    (
                        props.then_some(&self.cull),
                        [self.tier.sc_cap() as u32 / 64, 1, 1],
                    ),
                ],
            ),
        ] {
            // With the whole-frame timeline on, the height stage runs one pass
            // per job so its cache begin, height refill and block maxima are
            // timed apart; the stage's own pair stamps the first and last.
            let split = stage == 17 && marker.set.is_some();
            const PARTS: [&str; 4] = [
                "sun_cache_begin",
                "sun_height_generate",
                "sun_height_blocks",
                "sun_height_maxima",
            ];
            let groups_of: Vec<_> = if split {
                jobs.into_iter().map(|j| vec![j]).collect()
            } else {
                vec![jobs]
            };
            let count = groups_of.len();
            for (n, jobs) in groups_of.into_iter().enumerate() {
                let mut p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(crate::timing::NAMES[stage]),
                    // A pass with neither index set is invalid: middle parts carry none.
                    timestamp_writes: queries.filter(|_| n == 0 || n + 1 == count).map(|q| {
                        wgpu::ComputePassTimestampWrites {
                            query_set: q,
                            beginning_of_pass_write_index: (n == 0).then_some(stage as u32 * 2),
                            end_of_pass_write_index: (n + 1 == count)
                                .then_some(stage as u32 * 2 + 1),
                        }
                    }),
                });
                for (pass, groups) in jobs {
                    let Some(pass) = pass else { continue };
                    p.set_pipeline(&pass.pipeline);
                    p.set_bind_group(0, &pass.group, &[]);
                    p.dispatch_workgroups(groups[0], groups[1], groups[2]);
                }
                drop(p);
                marker.mark(
                    encoder,
                    match stage {
                        17 if split => PARTS[n.min(3)],
                        17 => "sun_height_maxima",
                        20 => "sun_cloud_global",
                        21 => "sun_cloud_local",
                        _ => "sun_casters",
                    },
                );
            }
            if stage == 17 {
                // Compute chart normalization once on the GPU, with the same
                // safety-adjusted frame used by every receiver. No readback.
                encoder.copy_buffer_to_buffer(
                    &self.cache_state,
                    80,
                    &self.uniform,
                    std::mem::offset_of!(SunFrame, cloud_centers) as u64,
                    48,
                );
                // Ordered-float maxima of cached full heights per level let
                // receivers stop marching once a rising ray clears every
                // cached mountain. GPU-produced; no readback.
                encoder.copy_buffer_to_buffer(
                    &self.cache_state,
                    176,
                    &self.uniform,
                    std::mem::offset_of!(SunFrame, ceilings) as u64,
                    48,
                );
            }
        }
        // Publish capacity failure directly on the GPU. Lighting reports
        // unresolved work without replacing resolved shadows with proxy disks.
        let metrics = std::mem::offset_of!(SunFrame, metrics) as u64;
        encoder.copy_buffer_to_buffer(
            &self.state,
            DRAW_WORDS as u64 * 4,
            &self.uniform,
            metrics + 8,
            4,
        );
        encoder.copy_buffer_to_buffer(
            &self.state,
            (DRAW_WORDS as u64 + 2) * 4,
            &self.uniform,
            metrics + 12,
            4,
        );
        for layer in 0..self.active_cascades {
            let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("sun scenery depth"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_layers[layer],
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: queries.map(|q| wgpu::RenderPassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(if layer == 0 {
                        36
                    } else {
                        (layer as u32 + 22) * 2
                    }),
                    end_of_pass_write_index: Some(if layer == 0 {
                        37
                    } else {
                        (layer as u32 + 22) * 2 + 1
                    }),
                }),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            let base = layer as u64 * 64;
            p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
            p.set_pipeline(&self.mesh);
            p.set_bind_group(0, &self.mesh_groups[layer], &[]);
            p.draw_indexed_indirect(&self.state, base);
            p.draw_indexed_indirect(&self.state, base + 20);
            p.set_pipeline(&self.card);
            p.set_bind_group(0, &self.card_groups[layer], &[]);
            p.draw_indirect(&self.state, base + 40);
            buildings.shadow(&mut p, layer);
            drop(p);
            const CASCADE: [&str; 6] = [
                "sun_cascade_0",
                "sun_cascade_1",
                "sun_cascade_2",
                "sun_cascade_3",
                "sun_cascade_4",
                "sun_cascade_5",
            ];
            marker.mark(encoder, CASCADE[layer.min(5)]);
        }
    }
    pub fn bytes(&self) -> u64 {
        size_of::<SunFrame>() as u64
            + self.cache_state.size()
            + CASCADES as u64 * 16
            + (DRAW_WORDS as u64 + 4) * 4
            + self.tier.height_texels() * 16
            + self.tier.height_texels() * 16
            + CASCADES as u64 * 3 * u64::from(self.tier.sun_casters) * 4
            + CASCADES as u64 * u64::from(self.tier.shadow_map).pow(2) * 4
            + u64::from(self.tier.sun_global).pow(2) * 8 * 8
            + 258 * 258 * 24 * 8
    }
}

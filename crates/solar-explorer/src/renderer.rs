use crate::{
    gpu::Gpu,
    timing::{self, Sample, Timing},
};
use serde::{Deserialize, Serialize};
use solar_core::{
    body::BodyDescriptor,
    field::{self, V3},
    planet::BodyAddress,
    skin::Skin,
    surface::SurfaceSource,
};
/// How much of the complement stands on a body with no height data.
const NO_HEIGHTS_RELIEF: f64 = 0.6;
/// Frames the height table stays quiet before the terrain mask in cloud lighting is baked again.
const SOLID_REBAKE_QUIET: u32 = 120;
/// Frames the surface pass runs unseen when it starts, to have its shadows and clouds before anyone sees them.
const SURFACE_WARM: u32 = 8;
/// The most the surface's share of the picture can change in a frame.
const SURFACE_RATE: f32 = 1.0 / 30.0;
/// Earth's clouds for the far planet: see `update_far_clouds`.
struct FarClouds {
    uniform: wgpu::Buffer,
    pipeline: wgpu::ComputePipeline,
    map: wgpu::BindGroup,
    width: u32,
    first_row: u32,
    cold: bool,
    last_weather: Option<[f64; 3]>,
    last_clock: crate::animation::CloudClock,
    pending_frames: u32,
    seed: u32,
}
#[derive(Clone, Copy)]
struct Asked {
    water: bool,
    clouds: bool,
    trees: bool,
    rocks: bool,
    sea: f64,
    relief: f64,
}
impl Asked {
    fn of(s: &Settings) -> Self {
        Self {
            water: s.water,
            clouds: s.clouds,
            trees: s.trees,
            rocks: s.rocks,
            sea: s.sea,
            relief: s.relief,
        }
    }
    fn restore(self, s: &mut Settings) {
        s.water = self.water;
        s.clouds = self.clouds;
        s.trees = self.trees;
        s.rocks = self.rocks;
        s.sea = self.sea;
        s.relief = self.relief;
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    /// The body, fixed when the renderer is created: "procedural" or "earth".
    pub world: String,
    pub shadows: bool,
    pub shadow_diagnostic: u32,
    pub shadow_steps: u32,
    pub trees: bool,
    pub rocks: bool,
    pub buildings: bool,
    pub scenery_density: f64,
    pub scenery_detail: f64,
    pub scenery_wind: f64,
    pub scenery_budget: u32,
    pub scenery_version: u32,
    pub scenery_draw_limit: u32,
    pub scenery_variant_limit: u32,
    pub scenery_lod: u32,
    pub scenery_isolate: u32,
    /// Ground cover near the eye: grass clumps, reeds, pebbles, ferns, bushes (docs/SCENERY.md).
    pub ground_cover: bool,
    /// How far ground cover reaches, metres.
    pub cover_reach: f64,
    pub cover_density: f64,
    /// Diagnostics: every tree (or rock) record shows this variant + 1, for the species sheet. 0 is off.
    pub scenery_showcase: u32,
    pub seed: u32,
    pub body: u32,
    pub sector: [String; 3],
    pub relief: f64,
    pub roughness: f64,
    pub sea: f64,
    pub wave_height: f64,
    pub wave_speed: f64,
    pub water_clarity: f64,
    pub foam: f64,
    pub caustics: bool,
    pub atmosphere: bool,
    pub clouds: bool,
    pub water: bool,
    pub cloud_history: bool,
    pub taa: bool,
    pub reference: bool,
    pub sun: [f64; 3],
    pub cloud_cover: f64,
    pub cloud_speed: f64,
    pub cloud_evolution: f64,
    pub cloud_turbulence: f64,
    pub cloud_type: f64,
    pub cloud_steps: u32,
    // Private qualification bits through 256 (direct cloud sunlight reference)
    // and cost-attribution bits 512..8192 (skip one sunlight component each);
    // bits 65536..8388608 move one water switch each (water.wgsl water_diagnostic).
    pub cloud_diagnostic: u32,
    pub surface_detail: bool,
    /// The synthesized ground material over measured imagery. Off, a measured body shows the image alone.
    pub ground_detail: bool,
    pub fetch_limits: bool,
    pub cloud_scale: u32,
    /// Animated cloud fields (weather atlas and light profiles)
    /// refresh one in this many texels per frame; a time jump or parameter
    /// change refreshes everything at once.
    pub cloud_refresh: u32,
    /// Far-field clouds (beyond cloud_far_distance metres) integrate at one
    /// texel per this many cloud pixels; 1 keeps the single full-rate march.
    pub cloud_far_scale: u32,
    pub cloud_far_distance: f64,
    /// Internal rendering resolution as a fraction of the canvas (bilinear
    /// presentation). 1 renders native pixels.
    pub render_scale: f64,
    /// Active prop shadow cascades (nearest first); fewer skip far maps.
    pub shadow_cascades: u32,
    /// Scale on the cloud profile bake sample counts (1 = full quadrature).
    pub profile_quality: f64,
    pub atmosphere_steps: u32,
    /// Procedural wave bands evaluated (the finest are dropped first).
    pub water_bands: u32,
    pub water_reflections: bool,
    /// Per-fragment relief refinement steps on the raster proxy (0 = off).
    pub relief_steps: u32,
    pub wind: [f64; 2],
    pub exposure: f64,
    /// Bloom (finish.rs): on or off, and the levels of its chain, each half the one before (a preset's choice).
    pub bloom: bool,
    pub bloom_levels: u32,
    /// The lens's own light from a bright source: ghosts, a halo, spikes (finish.wgsl).
    pub lens_flare: bool,
    /// The frame's exposure adapts to its light, slowly and in part (finish.wgsl `exposure_meter`).
    pub auto_exposure: bool,
    pub tolerance: f64,
    pub lod_distance: f64,
    pub patch_cap: usize,
    pub generation_limit: usize,
    pub debug: u32,
    pub edits: Vec<[f64; 5]>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            shadows: true,
            shadow_diagnostic: 0,
            shadow_steps: 64,
            trees: true,
            rocks: true,
            buildings: true,
            scenery_density: 1.0,
            scenery_detail: 1.0,
            scenery_wind: 1.0,
            scenery_budget: 4096,
            scenery_version: 2,
            scenery_draw_limit: 32768,
            scenery_variant_limit: 72,
            scenery_lod: 0,
            scenery_isolate: 0,
            ground_cover: true,
            cover_reach: 220.0,
            cover_density: 1.0,
            scenery_showcase: 0,
            seed: 2026,
            body: 0,
            sector: ["0".into(), "0".into(), "0".into()],
            relief: 1.0,
            roughness: 0.48,
            world: "procedural".into(),
            sea: 0.0,
            wave_height: 1.0,
            wave_speed: 1.0,
            water_clarity: 1.0,
            foam: 1.0,
            caustics: true,
            atmosphere: true,
            clouds: true,
            water: true,
            cloud_history: false,
            taa: false,
            reference: true,
            sun: [-0.45, 0.8, 0.38],
            cloud_cover: 0.11,
            cloud_speed: 1.0,
            cloud_evolution: 1.0,
            cloud_turbulence: 0.3,
            cloud_type: 0.0,
            cloud_steps: 128,
            cloud_diagnostic: 0,
            surface_detail: true,
            ground_detail: true,
            fetch_limits: true,
            cloud_scale: 1,
            cloud_refresh: 4,
            cloud_far_scale: 1,
            cloud_far_distance: 16000.0,
            render_scale: 1.0,
            shadow_cascades: 6,
            profile_quality: 1.0,
            atmosphere_steps: 12,
            water_bands: 10,
            water_reflections: true,
            relief_steps: 5,
            wind: [8.0, 3.0],
            exposure: 1.3,
            bloom: true,
            bloom_levels: 6,
            lens_flare: true,
            auto_exposure: true,
            tolerance: 2.0,
            lod_distance: 4.0,
            patch_cap: 2240,
            generation_limit: 18496,
            debug: 0,
            edits: Vec::new(),
        }
    }
}
impl Settings {
    /// What the finish does with these settings. A diagnostic view is shown as it is, without bloom or flare. `sources`: the
    /// bright sources in view (finish.rs `Options::sources`).
    pub fn finish(&self, sources: &[[f32; 4]], dt: f64) -> crate::finish::Options {
        let mut list = [[0.0; 4]; crate::finish::MAX_SOURCES];
        let count = if self.lens_flare && self.debug == 0 {
            sources.len().min(list.len())
        } else {
            0
        };
        list[..count].copy_from_slice(&sources[..count]);
        crate::finish::Options {
            sources: list,
            source_count: count,
            auto_exposure: self.auto_exposure && self.debug == 0,
            dt: dt as f32,
            exposure: self.exposure as f32,
            bloom_levels: if self.bloom && self.debug == 0 {
                self.bloom_levels
            } else {
                0
            },
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if solar_core::body::BodyDescriptor::named(&self.world).is_none() {
            return Err("unknown world".into());
        }
        if ![
            self.scenery_density,
            self.scenery_detail,
            self.scenery_wind,
            self.cover_reach,
            self.cover_density,
            self.relief,
            self.roughness,
            self.sea,
            self.wave_height,
            self.wave_speed,
            self.water_clarity,
            self.foam,
            self.cloud_cover,
            self.cloud_speed,
            self.cloud_evolution,
            self.cloud_turbulence,
            self.cloud_type,
            self.exposure,
            self.tolerance,
            self.lod_distance,
            self.cloud_far_distance,
            self.render_scale,
            self.profile_quality,
        ]
        .iter()
        .chain(self.sun.iter())
        .chain(self.wind.iter())
        .all(|v| v.is_finite())
        {
            return Err("settings must be finite".into());
        }
        if !(0.0..=1.0).contains(&self.scenery_density)
            || !(0.5..=2.0).contains(&self.scenery_detail)
            || !(0.0..=2.0).contains(&self.scenery_wind)
            || self.shadow_diagnostic > 7
            || !(1..=64).contains(&self.shadow_steps)
            || self.scenery_budget > 8192
            || self.scenery_draw_limit > 32768
            || self.scenery_variant_limit > 72
            || self.scenery_lod > 4
            || !(20.0..=280.0).contains(&self.cover_reach)
            || !(0.0..=2.0).contains(&self.cover_density)
            || self.scenery_showcase > 72
            || self.scenery_isolate > crate::tier::Tier::FULL.sc_cap() as u32
            || self.scenery_version != 2
            || !(0.0..=2.0).contains(&self.relief)
            || !(0.25..=0.6).contains(&self.roughness)
            || self.sea.abs() > 10000.0
            || !(0.0..=8.0).contains(&self.wave_height)
            || !(0.0..=3.0).contains(&self.wave_speed)
            || !(0.25..=4.0).contains(&self.water_clarity)
            || !(0.0..=2.0).contains(&self.foam)
            || !(0.1..=5.0).contains(&self.exposure)
            || !(1..=crate::finish::MAX_LEVELS).contains(&self.bloom_levels)
            || !(0.2..=200.0).contains(&self.tolerance)
            || !(0.5..=16.0).contains(&self.lod_distance)
            || !(6..=2240).contains(&self.patch_cap)
            || self.generation_limit > 18496
            || self.edits.len() > 16
            || field::length(self.sun) < 0.1
            || self.debug > 5
            || self.cloud_cover.abs() > 0.6
            || !(0.0..=10.0).contains(&self.cloud_speed)
            || !(0.0..=10.0).contains(&self.cloud_evolution)
            || !(0.0..=2.0).contains(&self.cloud_turbulence)
            || self.cloud_type.abs() > 1.0
            || !(32..=256).contains(&self.cloud_steps)
            || self.cloud_diagnostic > 16777215
            || ![1, 2, 4].contains(&self.cloud_scale)
            || !(1..=8).contains(&self.cloud_refresh)
            || ![1, 2, 4].contains(&self.cloud_far_scale)
            || !(0.25..=1.0).contains(&self.render_scale)
            || !(1..=6).contains(&self.shadow_cascades)
            || !(0.25..=1.0).contains(&self.profile_quality)
            || !(2..=24).contains(&self.atmosphere_steps)
            || !(2..=10).contains(&self.water_bands)
            || self.relief_steps > 8
            || !(2000.0..=1.0e7).contains(&self.cloud_far_distance)
            || self.wind.iter().any(|v| v.abs() > 100.0)
        {
            return Err("settings outside bounded explorer domain".into());
        }
        for e in &self.edits {
            if !e.iter().all(|v| v.is_finite())
                || !(2.0..=100000.0).contains(&e[3])
                || e[4].abs() > 1000.0
                || (field::length([e[0], e[1], e[2]]) - 1.0).abs() > 1e-6
            {
                return Err("invalid radial brush edit".into());
            }
        }
        for s in &self.sector {
            s.parse::<i64>()
                .map_err(|_| "sector must be an i64 decimal string")?;
        }
        Ok(())
    }
    pub fn skin(&self) -> Skin {
        let address = BodyAddress {
            sector: self.sector.each_ref().map(|s| s.parse().unwrap()),
            body: u64::from(self.body),
        };
        Skin {
            geology: solar_core::planet::Geology {
                seed: address.seed(self.seed),
                relief: self.relief,
                roughness: self.roughness,
            },
            radius: solar_core::body::PROCEDURAL_EARTH.radius,
            edits: self.edits.clone(),
        }
    }
}
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Frame {
    eye_hi: [f32; 4],
    eye_lo: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    forward: [f32; 4],
    sun: [f32; 4],
    view: [f32; 4],
    planet: [f32; 4],
    options: [f32; 4],
    lod: [f32; 4],
    geo: [f32; 4],
    prev_hi: [f32; 4],
    prev_lo: [f32; 4],
    prev_right: [f32; 4],
    prev_up: [f32; 4],
    prev_forward: [f32; 4],
    wind: [f32; 4],
    eye_tail: [f32; 4],
    edits: [[f32; 4]; 32],
    /// x 0, y frame parity, z unused (0), w settings revision.
    numeric: [u32; 4],
    water: [f32; 4],
    /// x unused (0), y caustics, z the terrain spacing under the eye (written on the GPU), w clamped dt.
    water_motion: [f32; 4],
    cloud_motion: [f32; 4],
    cloud_drift: [f32; 4],
    scenery: [f32; 4],
    scenery_work: [f32; 4],
    scenery_limits: [u32; 4],
    cloud_cache: [u32; 4],
    cloud_far: [f32; 4],
    quality: [f32; 4],
    tier_a: [u32; 4],
    tier_b: [u32; 4],
    tier_c: [u32; 4],
    tier_d: [u32; 4],
    atmosphere: [f32; 4],
    atmosphere_beta: [f32; 4],
    cloud_shell: [f32; 4],
    field: [f32; 4],
    field_serial: [u32; 4],
    surface_blend: [f32; 4],
    solar: [f32; 4],
    body_detail: [f32; 4],
    air_scatter: [f32; 4],
    sky_low: [f32; 4],
    sky_high: [f32; 4],
    cover: [f32; 4],
    starlight: [f32; 4],
    // Sample offset in pixels, temporal resolve enabled, previous image usable.
    temporal: [f32; 4],
}
fn dispatch_weather(pass: &mut wgpu::ComputePass<'_>, frame: &Frame, face_size: u32) {
    let divisor = if frame.cloud_cache[2] != 0 {
        1
    } else {
        frame.cloud_cache[1].max(1)
    };
    let padded = face_size + 2;
    pass.dispatch_workgroups(padded.div_ceil(8), (6 * padded).div_ceil(8 * divisor), 1);
}
fn four(v: V3, w: f32) -> [f32; 4] {
    [v[0] as f32, v[1] as f32, v[2] as f32, w]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub struct Texture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub bytes: u64,
}
impl Texture {
    fn new(
        g: &Gpu,
        label: &str,
        w: u32,
        h: u32,
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
        bpp: u64,
    ) -> Self {
        let texture = g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Self {
            texture,
            view,
            bytes: u64::from(w) * u64::from(h) * bpp,
        }
    }
}
pub struct Targets {
    position: Texture,
    normal: Texture,
    depth: Texture,
    ocean: Texture,
    ocean_cap: Texture,
    shade: Texture,
    material: Texture,
    water: Texture,
    cloud: [Texture; 2],
    guide: [Texture; 2],
    far: Texture,
    far_guide: Texture,
    proxy: Texture,
    proxy_depth: Texture,
    /// The frame in linear light, before exposure and the tone curve (finish.rs makes `display` from it).
    pub hdr: Texture,
    resolved: [Texture; 2],
    pub display: Texture,
    pub cw: u32,
    pub ch: u32,
}
impl Targets {
    fn new(g: &Gpu, w: u32, h: u32, scale: u32, far_scale: u32, taa: bool) -> Self {
        use wgpu::{TextureFormat as F, TextureUsages as U};
        let sampled = U::TEXTURE_BINDING | U::COPY_SRC;
        let output = sampled | U::STORAGE_BINDING;
        let render = sampled | U::RENDER_ATTACHMENT;
        let (cw, ch) = (w.div_ceil(scale), h.div_ceil(scale));
        // The single-rate path only needs a valid binding for the untaken branch.
        let (fw, fh) = if far_scale == 1 {
            (1, 1)
        } else {
            (cw.div_ceil(far_scale), ch.div_ceil(far_scale))
        };
        Self {
            position: Texture::new(g, "camera local position", w, h, F::Rgba32Float, render, 16),
            normal: Texture::new(g, "filtered normal", w, h, F::Rgba16Float, render, 8),
            ocean: Texture::new(
                g,
                "geometric ocean distance and spacing",
                w,
                h,
                F::Rg32Float,
                render,
                8,
            ),
            ocean_cap: Texture::new(g, "near-plane water crossing", w, h, F::R32Float, render, 4),
            depth: Texture::new(
                g,
                "reverse depth",
                w,
                h,
                F::Depth32Float,
                U::RENDER_ATTACHMENT | U::TEXTURE_BINDING,
                4,
            ),
            material: Texture::new(g, "prop material", w, h, F::Rgba16Float, render, 8),
            shade: Texture::new(
                g,
                "surface lighting",
                w,
                h,
                F::Rgba16Float,
                output | U::RENDER_ATTACHMENT,
                8,
            ),
            water: Texture::new(g, "water lighting", w, h, F::Rgba16Float, output, 8),
            cloud: std::array::from_fn(|_| {
                Texture::new(
                    g,
                    "cloud scattering history",
                    cw,
                    ch,
                    F::Rgba16Float,
                    output,
                    8,
                )
            }),
            guide: std::array::from_fn(|_| {
                Texture::new(g, "cloud depth history", cw, ch, F::Rgba32Float, output, 16)
            }),
            proxy: Texture::new(
                g,
                "terrain proxy distance and trust",
                w,
                h,
                F::Rg32Float,
                render,
                8,
            ),
            proxy_depth: Texture::new(
                g,
                "terrain proxy depth",
                w,
                h,
                F::Depth32Float,
                U::RENDER_ATTACHMENT,
                4,
            ),
            far: Texture::new(g, "far cloud scattering", fw, fh, F::Rgba16Float, output, 8),
            far_guide: Texture::new(
                g,
                "far cloud depth guide",
                fw,
                fh,
                F::Rgba32Float,
                output,
                16,
            ),
            resolved: std::array::from_fn(|_| {
                Texture::new(
                    g,
                    "temporal HDR history",
                    if taa { w } else { 1 },
                    if taa { h } else { 1 },
                    F::Rgba16Float,
                    output,
                    8,
                )
            }),
            hdr: Texture::new(g, "hdr", w, h, F::Rgba16Float, output, 8),
            display: Texture::new(
                g,
                "display",
                w,
                h,
                F::Rgba8Unorm,
                output | U::RENDER_ATTACHMENT,
                4,
            ),
            cw,
            ch,
        }
    }
    fn bytes(&self) -> u64 {
        self.position.bytes
            + self.material.bytes
            + self.normal.bytes
            + self.depth.bytes
            + self.ocean.bytes
            + self.ocean_cap.bytes
            + self.shade.bytes
            + self.water.bytes
            + self.hdr.bytes
            + self.resolved[0].bytes * 2
            + self.display.bytes
            + self.far.bytes
            + self.far_guide.bytes
            + self.proxy.bytes
            + self.proxy_depth.bytes
            + self
                .cloud
                .iter()
                .chain(&self.guide)
                .map(|t| t.bytes)
                .sum::<u64>()
    }
}
/// Programs the first image needs exist from construction. The ocean, cloud
/// and scenery-shading programs are deferred: the browser compiles them after
/// the first image (`web/gpu-startup.js` lists the same keys) and
/// `Pipelines::complete` creates each one once `startup::pipeline_ready`
/// reports it; native builds create everything at construction. A feature is
/// active only when every program it needs exists.
pub struct Pipelines {
    raster: wgpu::RenderPipeline,
    prepass: wgpu::RenderPipeline,
    ocean: Option<wgpu::RenderPipeline>,
    ocean_cap: Option<wgpu::RenderPipeline>,
    /// The water layer's own mesh (docs/WATER-LAYER.md phase 3b) and its near-plane crossing.
    water_mesh: Option<wgpu::RenderPipeline>,
    water_mesh_cap: Option<wgpu::RenderPipeline>,
    shade: Option<wgpu::ComputePipeline>,
    shade_initial: wgpu::ComputePipeline,
    scenery_shade: Option<wgpu::ComputePipeline>,
    water: Option<wgpu::ComputePipeline>,
    cloud: Option<wgpu::ComputePipeline>,
    cloud_far: Option<wgpu::ComputePipeline>,
    weather: wgpu::ComputePipeline,
    lut: wgpu::ComputePipeline,
    composite: wgpu::ComputePipeline,
    temporal: wgpu::ComputePipeline,
}
impl Pipelines {
    /// Create every deferred program whose compilation has finished.
    fn complete(&mut self, g: &Gpu) -> bool {
        let mut changed = false;
        for (slot, key) in [
            (&mut self.water, "water"),
            (&mut self.cloud, "cloud_pass"),
            (&mut self.cloud_far, "cloud_far_pass"),
            (&mut self.scenery_shade, "scenery_shade"),
            (&mut self.shade, "shade"),
        ] {
            if slot.is_none() && crate::startup::pipeline_ready(key) {
                *slot = Some(compute_pipeline(g, key));
                changed = true;
            }
        }
        if self.ocean.is_none() && crate::startup::pipeline_ready("ocean_vertex") {
            self.ocean = Some(ocean_pipeline(g, false));
            changed = true;
        }
        if self.ocean_cap.is_none() && crate::startup::pipeline_ready("ocean_cap_vertex") {
            self.ocean_cap = Some(ocean_pipeline(g, true));
            changed = true;
        }
        if self.water_mesh.is_none() && crate::startup::pipeline_ready("water_mesh_vertex") {
            self.water_mesh = Some(water_mesh_pipeline(g, false));
            changed = true;
        }
        if self.water_mesh_cap.is_none() && crate::startup::pipeline_ready("water_mesh_cap_vertex")
        {
            self.water_mesh_cap = Some(water_mesh_pipeline(g, true));
            changed = true;
        }
        changed
    }
    fn ocean_ready(&self) -> bool {
        self.ocean.is_some()
            && self.ocean_cap.is_some()
            && self.water.is_some()
            && self.water_mesh.is_some()
            && self.water_mesh_cap.is_some()
    }
    fn clouds_ready(&self) -> bool {
        self.cloud.is_some() && self.cloud_far.is_some()
    }
    fn scenery_ready(&self) -> bool {
        self.scenery_shade.is_some()
    }
    fn shadows_ready(&self) -> bool {
        self.shade.is_some()
    }
}
fn compute_pipeline(g: &Gpu, name: &str) -> wgpu::ComputePipeline {
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
}
/// The water layer's mesh: vertices from the vertex index (no buffers), the ocean's fragments and targets.
fn water_mesh_pipeline(g: &Gpu, cap: bool) -> wgpu::RenderPipeline {
    let key = if cap {
        "water_mesh_cap_vertex"
    } else {
        "water_mesh_vertex"
    };
    let module = crate::startup::shader(g, key);
    g.device
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(if cap {
                "water mesh near-plane crossings"
            } else {
                "water mesh"
            }),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some(key),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some(if cap {
                    "ocean_cap_fragment"
                } else {
                    "ocean_fragment"
                }),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: if cap {
                        wgpu::TextureFormat::R32Float
                    } else {
                        wgpu::TextureFormat::Rg32Float
                    },
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: g.cache(),
        })
}
/// explorer.wgsl WATER_RINGS x WATER_RING_CELLS^2 cells x 6 vertices.
const WATER_MESH_VERTICES: u32 = 18 * 48 * 48 * 6;
fn ocean_pipeline(g: &Gpu, cap: bool) -> wgpu::RenderPipeline {
    let module = crate::startup::shader(
        g,
        if cap {
            "ocean_cap_vertex"
        } else {
            "ocean_vertex"
        },
    );
    g.device
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(if cap {
                "water near-plane crossings"
            } else {
                "conforming wave geometry"
            }),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some(if cap {
                    "ocean_cap_vertex"
                } else {
                    "ocean_vertex"
                }),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some(if cap {
                    "ocean_cap_fragment"
                } else {
                    "ocean_fragment"
                }),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: if cap {
                        wgpu::TextureFormat::R32Float
                    } else {
                        wgpu::TextureFormat::Rg32Float
                    },
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: g.cache(),
        })
}
pub struct Bindings {
    raster: wgpu::BindGroup,
    prepass: wgpu::BindGroup,
    ocean: Option<wgpu::BindGroup>,
    ocean_cap: Option<wgpu::BindGroup>,
    water_mesh: Option<wgpu::BindGroup>,
    water_mesh_cap: Option<wgpu::BindGroup>,
    shade: Option<wgpu::BindGroup>,
    shade_initial: wgpu::BindGroup,
    scenery_shade: Option<wgpu::BindGroup>,
    water: Option<wgpu::BindGroup>,
    cloud: Option<[wgpu::BindGroup; 2]>,
    cloud_far: Option<wgpu::BindGroup>,
    weather: wgpu::BindGroup,
    lut: wgpu::BindGroup,
    composite: [wgpu::BindGroup; 2],
    temporal: [[wgpu::BindGroup; 2]; 2],
}
fn half_to_f32(h: u16) -> f32 {
    let sign = u32::from(h >> 15) << 31;
    let exponent = u32::from((h >> 10) & 0x1f);
    let mantissa = u32::from(h & 0x3ff);
    let bits = match exponent {
        0 if mantissa == 0 => sign,
        0 => {
            // Subnormal half: renormalize.
            let mut m = mantissa;
            let mut e = 127 - 15 + 1;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((m & 0x3ff) << 13)
        }
        31 => sign | 0x7f80_0000 | (mantissa << 13),
        _ => sign | ((exponent + 127 - 15) << 23) | (mantissa << 13),
    };
    f32::from_bits(bits)
}
#[derive(Clone, Copy, Default)]
struct SpacePose {
    eye: V3,
    right: V3,
    up: V3,
    forward: V3,
    seconds: f64,
}
pub struct Renderer {
    space_pose: SpacePose,
    previous_space: Option<SpacePose>,
    last_resolve: Option<(usize, bool)>,
    pub gpu: Gpu,
    pub tier: crate::tier::Tier,
    pub settings: Settings,
    pub body: BodyDescriptor,
    pub skin: Skin,
    pages_camera: V3,
    page_bindings: crate::pages::PageBindings,
    /// Measured pages: atlases, clip table, and the f64 reader. Streaming health is in `lag`.
    pub pages: crate::pages::PageAtlas,
    /// Canonical height under the camera, from the CPU reader on a measured body.
    pub ground_height: f64,
    /// Stars, the Sun and every body not in full detail. A one-texel stand-in until `solar_on`.
    pub space: crate::space::SpacePass,
    finish: crate::finish::Finish,
    /// Counts replacements of `targets`, for the finish's binding.
    target_serial: u32,
    /// Whether this frame has a surface pass. Far from every solid body it has none.
    surface_shown: bool,
    /// How much of the picture is the surface pass, against the far planet. One with no solar system.
    surface_blend: f32,
    /// Frames the surface pass has run since it last did not.
    surface_warm: u32,
    far_clouds: Option<FarClouds>,
    /// Whether Earth covers a pixel or more this frame, so that its far clouds are worth keeping up.
    earth_seen: bool,
    solar_on: bool,
    /// A solid body is close enough to want its surface, whether or not its pages are in yet.
    space_wanted: bool,
    /// Internal render resolution (canvas size times render_scale).
    pub width: u32,
    pub height: u32,
    /// Canvas (presentation) size.
    pub display_width: u32,
    pub display_height: u32,
    pub targets: Targets,
    pub timing: Timing,
    pub marker: timing::Marker,
    table_serials: [u32; 2],
    table_quiet: u32,
    solid_height_serial: u32,
    solid_generation: u32,
    uniform: wgpu::Buffer,
    projected: wgpu::Buffer,
    pub terrain: crate::gpu_terrain::GpuTerrain,
    pub scenery: crate::scenery::Scenery,
    pub buildings: crate::buildings::Buildings,
    /// What the page asked for that a body may override. The body's overrides go into `settings`, so without this a visit to an airless
    /// body left Earth with no water, clouds or scenery when the craft came back.
    asked: Option<Asked>,
    pub sun_system: crate::sun::Sun,
    revision: u32,
    cache: wgpu::Buffer,
    vertices: [wgpu::Buffer; 2],
    indices: wgpu::Buffer,
    lut: Texture,
    weather: Texture,
    cloud_shape: crate::clouds::CloudShape,
    cloud_sampler: wgpu::Sampler,
    /// Weather parameters that force a complete atlas refresh.
    cloud_signature: Vec<f64>,
    weather_settle: u32,
    /// Set on restore or when deferred weather consumers become ready.
    pub cloud_force_refresh: bool,
    pipelines: Pipelines,
    bindings: Bindings,
    pub water_system: crate::water::Water,
    frame: Frame,
    previous: Option<Frame>,
    pub frame_id: u64,
    lut_dirty: bool,
    pub time: f64,
    pub cloud_clock: crate::animation::CloudClock,
    pub last_camera: V3,
    pub last_encode_ms: f64,
    pub resize_peak: u64,
    /// Diagnostic anchor offset only; physics/camera coordinates are unchanged.
    pub audit_origin_bias: V3,
    /// Explicit camera up preserves the flight quaternion, including roll.
    pub camera_up: Option<V3>,
}
impl Renderer {
    fn temporal_enabled(&self) -> bool {
        self.settings.taa
            && self.settings.debug == 0
            && self.settings.shadow_diagnostic == 0
            && self.settings.cloud_diagnostic == 0
    }
    fn jitter(&self) -> [f32; 2] {
        // Centred, eight-sample Halton (bases 2 and 3).
        const OFFSETS: [[f32; 2]; 8] = [
            [0.0546875, -1.0 / 6.0],
            [-0.1953125, 1.0 / 6.0],
            [0.3046875, -7.0 / 18.0],
            [-0.3203125, -1.0 / 18.0],
            [0.1796875, 5.0 / 18.0],
            [-0.0703125, -5.0 / 18.0],
            [0.4296875, 1.0 / 18.0],
            [-0.3828125, 7.0 / 18.0],
        ];
        if self.temporal_enabled() {
            OFFSETS[self.frame_id as usize % 8]
        } else {
            [0.0; 2]
        }
    }
    fn internal_size(w: u32, h: u32, scale: f64) -> (u32, u32) {
        (
            ((f64::from(w) * scale).round() as u32).max(1),
            ((f64::from(h) * scale).round() as u32).max(1),
        )
    }
    pub async fn new(
        display_width: u32,
        display_height: u32,
        mut settings: Settings,
        tier: crate::tier::Tier,
    ) -> Result<Self, String> {
        tier.validate()?;
        settings.validate()?;
        settings.patch_cap = settings.patch_cap.min(tier.patch_cap);
        let (width, height) =
            Self::internal_size(display_width, display_height, settings.render_scale);
        Self::validate_size(width, height, settings.reference)?;
        let gpu = Gpu::new().await?;
        let g = &gpu;
        crate::startup::prepare(g).await?;
        crate::startup::mark("programs ready");
        let validation = g.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let compute = |name| compute_pipeline(g, name);
        let prepass_module = crate::startup::shader(g, "terrain_prepass");
        let prepass = g
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("terrain proxy pre-pass"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &prepass_module,
                    entry_point: Some("terrain_vertex"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &prepass_module,
                    entry_point: Some("terrain_prepass_fragment"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rg32Float,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState {
                    cull_mode: Some(wgpu::Face::Back),
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                multiview_mask: None,
                cache: g.cache(),
            });
        let module = crate::startup::shader(g, "terrain_vertex");
        let raster = g
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("conforming raster visibility"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("terrain_vertex"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("terrain_fragment"),
                    compilation_options: Default::default(),
                    targets: &[
                        Some(wgpu::ColorTargetState {
                            format: wgpu::TextureFormat::Rgba32Float,
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        }),
                        Some(wgpu::ColorTargetState {
                            format: wgpu::TextureFormat::Rgba16Float,
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        }),
                    ],
                }),
                primitive: wgpu::PrimitiveState {
                    cull_mode: Some(wgpu::Face::Back),
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                multiview_mask: None,
                cache: g.cache(),
            });
        let pipelines = Pipelines {
            ocean: None,
            ocean_cap: None,
            water_mesh: None,
            water_mesh_cap: None,
            raster,
            prepass,
            shade: None,
            shade_initial: compute("shade_initial"),
            scenery_shade: None,
            water: None,
            cloud: None,
            cloud_far: None,
            weather: compute("weather_generate"),
            lut: compute("atmosphere_lut"),
            composite: compute("composite"),
            temporal: compute("temporal_resolve"),
        };
        use wgpu::BufferUsages as U;
        let uniform = g.buffer(
            "frame",
            std::mem::size_of::<Frame>() as u64,
            U::UNIFORM | U::COPY_DST,
        );
        let projected = g.buffer(
            "GPU-adjusted render frame",
            std::mem::size_of::<Frame>() as u64,
            U::UNIFORM | U::STORAGE | U::COPY_SRC | U::COPY_DST,
        );
        let cache = g.buffer(
            "persistent GPU height cache",
            u64::from(tier.node_cap) * crate::gpu_terrain::SAMPLES * 48,
            U::STORAGE | U::COPY_SRC,
        );
        let vertices = std::array::from_fn(|_| {
            g.buffer(
                "shared continuous vertex trajectories",
                u64::from(tier.hash_cap) * 112,
                U::STORAGE | U::COPY_SRC,
            )
        });
        // Two banks, each with a full terrain region and an ocean region
        // holding only the patches that can show sea (see gpu_bounds_finish).
        let indices = g.buffer(
            "conforming triangles",
            u64::from(tier.index_cap()) * 4 * 4,
            U::INDEX | U::STORAGE | U::COPY_DST | U::COPY_SRC,
        );
        let targets = Targets::new(
            g,
            width,
            height,
            settings.cloud_scale,
            settings.cloud_far_scale,
            settings.taa,
        );
        let lut = Texture::new(
            g,
            "atmosphere optical depth LUT",
            256,
            64,
            wgpu::TextureFormat::Rgba16Float,
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
            8,
        );
        let body = BodyDescriptor::named(&settings.world).ok_or("unknown world")?;
        crate::startup::mark("targets");
        let mut pages = crate::pages::PageAtlas::new(
            g,
            &tier,
            body.surface == solar_core::body::SurfaceKind::Measured,
            15,
            12,
        );
        if body.naif != 399 {
            pages.source_limits(3, 3, false);
        }
        let page_bindings = pages.bindings();
        crate::startup::mark("pages");
        let space = crate::space::SpacePass::new(g);
        let finish = crate::finish::Finish::new(g);
        crate::startup::mark("space");
        let water_system = crate::water::Water::new(g, &projected, &tier, &page_bindings);
        let cloud_shape = crate::clouds::CloudShape::new(g);
        let cloud_sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("cloud field interpolation"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let weather = Texture::new(
            g,
            "world cloud weather with cube gutters",
            tier.weather_face + 2,
            6 * (tier.weather_face + 2),
            wgpu::TextureFormat::Rgba16Float,
            wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            8,
        );
        crate::startup::mark("water, clouds");
        let terrain = crate::gpu_terrain::GpuTerrain::new(
            g,
            &uniform,
            &projected,
            &cache,
            &vertices,
            &indices,
            &tier,
            &page_bindings,
        );
        crate::startup::mark("terrain");
        let scenery = crate::scenery::Scenery::new(
            g,
            &projected,
            &terrain,
            &vertices,
            &indices,
            &tier,
            &page_bindings,
        );
        crate::startup::mark("scenery");
        let sun_system = crate::sun::Sun::new(g, &projected, &scenery, &tier, &page_bindings);
        crate::startup::mark("sun");
        let buildings = crate::buildings::Buildings::new(
            g,
            &projected,
            &page_bindings,
            &sun_system.uniform,
            &scenery.urban,
        );
        let bindings = Self::bindings(
            g,
            &pipelines,
            &projected,
            &cache,
            &vertices,
            &indices,
            &targets,
            &lut,
            &water_system,
            &weather,
            &cloud_shape,
            &cloud_sampler,
            &scenery,
            &sun_system,
            &page_bindings,
            &space,
        );
        crate::startup::mark("buildings, body");
        let timing = Timing::new(g);
        let skin = settings.skin();
        if let Some(cpu) = &mut pages.cpu {
            cpu.geology = skin.geology;
        }
        crate::startup::mark("before validation scope");
        if let Some(error) = validation.pop().await {
            return Err(format!("explorer GPU validation: {error}"));
        }
        crate::startup::mark("validation scope");
        let mut renderer = Self {
            gpu,
            tier,
            settings,
            body,
            skin,
            pages_camera: [0.0; 3],
            pages,
            page_bindings,
            space,
            finish,
            target_serial: 0,
            surface_shown: true,
            surface_blend: 1.0,
            surface_warm: 0,
            far_clouds: None,
            earth_seen: false,
            solar_on: false,
            space_wanted: false,
            ground_height: 0.0,
            width,
            height,
            display_width,
            display_height,
            targets,
            timing,
            marker: Default::default(),
            table_serials: [0, 0],
            table_quiet: 0,
            solid_height_serial: 0,
            solid_generation: 0,
            uniform,
            projected,
            terrain,
            scenery,
            buildings,
            sun_system,
            asked: None,
            revision: 1,
            cache,
            vertices,
            indices,
            lut,
            pipelines,
            bindings,
            water_system,
            weather,
            cloud_shape,
            cloud_sampler,

            cloud_signature: Vec::new(),
            weather_settle: 0,
            cloud_force_refresh: true,
            frame: bytemuck::Zeroable::zeroed(),
            previous: None,
            space_pose: SpacePose::default(),
            previous_space: None,
            last_resolve: None,
            frame_id: 0,
            lut_dirty: true,
            time: 0.0,
            cloud_clock: Default::default(),
            last_camera: [0.0; 3],
            last_encode_ms: 0.0,
            resize_peak: 0,
            audit_origin_bias: [0.0; 3],
            camera_up: None,
        };
        renderer.complete_features();
        Ok(renderer)
    }
    fn scenery_active(&self) -> bool {
        self.pipelines.scenery_ready() && self.scenery.cull_ready()
    }
    fn ocean_active(&self) -> bool {
        self.settings.water && self.pipelines.ocean_ready()
    }
    fn clouds_active(&self) -> bool {
        self.settings.clouds && self.pipelines.clouds_ready() && self.sun_system.clouds_ready()
    }
    /// Features whose programs the browser is still compiling. The frame
    /// renders without them (no sea, no clouds or cloud shadows, no props)
    /// until `complete_features` creates them.
    pub fn pending_features(&self) -> Vec<&'static str> {
        let mut pending = Vec::new();
        if !self.pipelines.ocean_ready() {
            pending.push("ocean");
        }
        if !(self.pipelines.clouds_ready() && self.sun_system.clouds_ready()) {
            pending.push("clouds");
        }
        if !self.scenery_active() {
            pending.push("scenery");
        }
        if !self.pipelines.shadows_ready() {
            pending.push("shadows");
        }
        pending
    }
    /// Create deferred programs that finished compiling; returns whether any
    /// feature changed. Cheap when nothing is pending.
    pub fn complete_features(&mut self) -> bool {
        let pipelines = self.pipelines.complete(&self.gpu);
        let scenery =
            self.scenery
                .complete(&self.gpu, &self.projected, &self.terrain, &self.vertices);
        let sun = self.sun_system.complete(
            &self.gpu,
            &self.projected,
            &self.weather.view,
            &self.cloud_sampler,
            &self.cloud_shape,
        );
        if pipelines {
            self.bindings = Self::bindings(
                &self.gpu,
                &self.pipelines,
                &self.projected,
                &self.cache,
                &self.vertices,
                &self.indices,
                &self.targets,
                &self.lut,
                &self.water_system,
                &self.weather,
                &self.cloud_shape,
                &self.cloud_sampler,
                &self.scenery,
                &self.sun_system,
                &self.page_bindings,
                &self.space,
            );
        }
        if pipelines || sun || scenery {
            // Refresh requests consumed while a feature's programs were still
            // pending wrote nothing: rebuild the weather and light profiles.
            self.cloud_force_refresh = true;
            self.sun_system.invalidate();
        }
        pipelines || sun || scenery
    }
    #[allow(clippy::too_many_arguments)]
    fn bindings(
        g: &Gpu,
        p: &Pipelines,
        u: &wgpu::Buffer,
        _c: &wgpu::Buffer,
        v: &[wgpu::Buffer; 2],
        indices: &wgpu::Buffer,
        t: &Targets,
        l: &Texture,
        water: &crate::water::Water,
        weather: &Texture,
        cloud_shape: &crate::clouds::CloudShape,
        cloud_sampler: &wgpu::Sampler,
        scenery: &crate::scenery::Scenery,
        sun_system: &crate::sun::Sun,
        pages: &crate::pages::PageBindings,
        space: &crate::space::SpacePass,
    ) -> Bindings {
        fn with_pages<'a>(
            pages: &'a crate::pages::PageBindings,
            key: &str,
            entries: &[wgpu::BindGroupEntry<'a>],
        ) -> Vec<wgpu::BindGroupEntry<'a>> {
            let mut all = entries.to_vec();
            all.extend(pages.entries(key));
            all
        }
        // A program with an automatic layout takes exactly the bindings its specialized source still uses.
        fn only_used<'a>(
            pages: &'a crate::pages::PageBindings,
            key: &str,
            entries: &[wgpu::BindGroupEntry<'a>],
        ) -> Vec<wgpu::BindGroupEntry<'a>> {
            let used = crate::startup::program_bindings(key);
            let mut all: Vec<_> = entries
                .iter()
                .filter(|e| used.contains(&e.binding))
                .cloned()
                .collect();
            all.extend(pages.entries(key));
            all
        }
        fn b(i: u32, buf: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding: i,
                resource: buf.as_entire_binding(),
            }
        }
        fn tex(i: u32, view: &wgpu::TextureView) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding: i,
                resource: wgpu::BindingResource::TextureView(view),
            }
        }
        let group =
            |key: &str, pipeline: &wgpu::ComputePipeline, entries: &[wgpu::BindGroupEntry<'_>]| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &{
                        let mut all = entries.to_vec();
                        let used = crate::startup::program_bindings(key);
                        if used.contains(&49) {
                            all.extend(cloud_shape.entries());
                        }
                        for (i, buffer) in [
                            (127, &scenery.urban.sources),
                            (128, &scenery.urban.points),
                            (134, &scenery.urban.control),
                            (177, &scenery.urban.index),
                        ] {
                            if used.contains(&i) {
                                all.push(b(i, buffer));
                            }
                        }
                        with_pages(pages, key, &all)
                    },
                })
            };
        let sun_group = |key: &str,
                         pipeline: &wgpu::ComputePipeline,
                         entries: &[wgpu::BindGroupEntry<'_>],
                         solid| {
            let mut all = entries.to_vec();
            all.extend(sun_system.entries(solid));
            if solid && !all.iter().any(|e| e.binding == 59) {
                all.push(b(59, &scenery.instances));
            }
            group(key, pipeline, &all)
        };
        Bindings {
            weather: group(
                "weather_generate",
                &p.weather,
                &[b(0, u), tex(45, &weather.view)],
            ),
            ocean: p.ocean.as_ref().map(|pipeline| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("shared sea geometry"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &with_pages(
                        pages,
                        "ocean_vertex",
                        &[
                            b(0, u),
                            tex(5, &t.position.view),
                            b(4, &v[0]),
                            b(28, &v[1]),
                            b(135, indices),
                            b(33, &water.state),
                            b(37, &water.wave_cache),
                        ],
                    ),
                })
            }),
            ocean_cap: p.ocean_cap.as_ref().map(|pipeline| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("shared sea geometry"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &with_pages(
                        pages,
                        "ocean_cap_vertex",
                        &[
                            b(0, u),
                            b(4, &v[0]),
                            b(28, &v[1]),
                            b(135, indices),
                            b(33, &water.state),
                            b(37, &water.wave_cache),
                        ],
                    ),
                })
            }),
            water_mesh: p.water_mesh.as_ref().map(|pipeline| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("water mesh"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &only_used(
                        pages,
                        "water_mesh_vertex",
                        &[
                            b(0, u),
                            tex(5, &t.position.view),
                            b(33, &water.state),
                            b(37, &water.wave_cache),
                        ],
                    ),
                })
            }),
            water_mesh_cap: p.water_mesh_cap.as_ref().map(|pipeline| {
                g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("water mesh near-plane crossings"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &only_used(
                        pages,
                        "water_mesh_cap_vertex",
                        &[
                            b(0, u),
                            tex(5, &t.position.view),
                            b(33, &water.state),
                            b(37, &water.wave_cache),
                        ],
                    ),
                })
            }),
            raster: g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &p.raster.get_bind_group_layout(0),
                entries: &with_pages(
                    pages,
                    "terrain_vertex",
                    &[b(0, u), b(4, &v[0]), b(28, &v[1]), tex(92, &t.proxy.view)],
                ),
            }),
            prepass: g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("terrain proxy pre-pass"),
                layout: &p.prepass.get_bind_group_layout(0),
                entries: &with_pages(
                    pages,
                    "terrain_prepass",
                    &[b(0, u), b(4, &v[0]), b(28, &v[1])],
                ),
            }),
            scenery_shade: p.scenery_shade.as_ref().map(|pipeline| {
                sun_group(
                    "scenery_shade",
                    pipeline,
                    &[
                        b(0, u),
                        tex(5, &t.position.view),
                        tex(6, &t.normal.view),
                        tex(7, &t.shade.view),
                        tex(62, &t.material.view),
                    ],
                    true,
                )
            }),
            shade: p.shade.as_ref().map(|pipeline| {
                sun_group(
                    "shade",
                    pipeline,
                    &[
                        b(0, u),
                        b(59, &scenery.instances),
                        tex(5, &t.position.view),
                        tex(6, &t.normal.view),
                        tex(7, &t.shade.view),
                    ],
                    true,
                )
            }),
            shade_initial: group(
                "shade_initial",
                &p.shade_initial,
                &[
                    b(0, u),
                    b(59, &scenery.instances),
                    tex(5, &t.position.view),
                    tex(6, &t.normal.view),
                    tex(7, &t.shade.view),
                    b(64, &sun_system.uniform),
                ],
            ),
            water: p.water.as_ref().map(|pipeline| {
                sun_group(
                    "water",
                    pipeline,
                    &[
                        b(0, u),
                        tex(5, &t.position.view),
                        tex(6, &t.normal.view),
                        tex(8, &t.shade.view),
                        tex(9, &t.water.view),
                        b(33, &water.state),
                        b(37, &water.wave_cache),
                        b(40, &water.foam[0]),
                        b(41, &water.foam[1]),
                        b(43, &water.bed),
                        tex(27, &t.ocean.view),
                        tex(44, &t.ocean_cap.view),
                    ],
                    true,
                )
            }),
            cloud: p.cloud.as_ref().map(|pipeline| {
                std::array::from_fn(|i| {
                    sun_group(
                        "cloud_pass",
                        pipeline,
                        &[
                            b(0, u),
                            tex(5, &t.position.view),
                            tex(11, &t.cloud[i].view),
                            tex(10, &t.water.view),
                            tex(12, &t.guide[i].view),
                            tex(15, &t.cloud[1 - i].view),
                            tex(16, &t.guide[1 - i].view),
                            tex(46, &weather.view),
                            wgpu::BindGroupEntry {
                                binding: 50,
                                resource: wgpu::BindingResource::Sampler(cloud_sampler),
                            },
                            tex(27, &t.ocean.view),
                            tex(90, &t.far.view),
                            tex(91, &t.far_guide.view),
                        ],
                        false,
                    )
                })
            }),
            cloud_far: p.cloud_far.as_ref().map(|pipeline| {
                sun_group(
                    "cloud_far_pass",
                    pipeline,
                    &[
                        b(0, u),
                        tex(5, &t.position.view),
                        tex(46, &weather.view),
                        wgpu::BindGroupEntry {
                            binding: 50,
                            resource: wgpu::BindingResource::Sampler(cloud_sampler),
                        },
                        tex(27, &t.ocean.view),
                        tex(88, &t.far.view),
                        tex(10, &t.water.view),
                        tex(89, &t.far_guide.view),
                    ],
                    false,
                )
            }),
            lut: group("atmosphere_lut", &p.lut, &[b(0, u), tex(17, &l.view)]),
            temporal: std::array::from_fn(|space_only| {
                std::array::from_fn(|i| {
                    group(
                        "temporal_resolve",
                        &p.temporal,
                        &[
                            b(0, u),
                            tex(121, space.distance_view()),
                            tex(
                                191,
                                if space_only == 1 {
                                    space.color_view()
                                } else {
                                    &t.hdr.view
                                },
                            ),
                            tex(192, &t.resolved[1 - i].view),
                            tex(193, &t.resolved[i].view),
                        ],
                    )
                })
            }),
            composite: std::array::from_fn(|i| {
                sun_group(
                    "composite",
                    &p.composite,
                    &[
                        b(0, u),
                        tex(5, &t.position.view),
                        tex(8, &t.shade.view),
                        tex(10, &t.water.view),
                        tex(13, &t.cloud[i].view),
                        tex(14, &t.guide[i].view),
                        tex(18, &l.view),
                        tex(19, &t.hdr.view),
                        tex(46, &weather.view),
                        wgpu::BindGroupEntry {
                            binding: 50,
                            resource: wgpu::BindingResource::Sampler(cloud_sampler),
                        },
                        tex(27, &t.ocean.view),
                        wgpu::BindGroupEntry {
                            binding: 120,
                            resource: wgpu::BindingResource::TextureView(space.color_view()),
                        },
                        wgpu::BindGroupEntry {
                            binding: 121,
                            resource: wgpu::BindingResource::TextureView(space.distance_view()),
                        },
                        wgpu::BindGroupEntry {
                            binding: 122,
                            resource: wgpu::BindingResource::TextureView(space.active_view()),
                        },
                    ],
                    false,
                )
            }),
        }
    }
    fn validate_size(w: u32, h: u32, reference: bool) -> Result<(), String> {
        let max = if reference { 1920 * 1080 } else { 2560 * 1440 };
        if w == 0 || h == 0 || w > 4096 || h > 4096 || u64::from(w) * u64::from(h) > max {
            return Err("viewport exceeds bounded native-resolution allocation".into());
        }
        Ok(())
    }
    pub fn resize(&mut self, display_w: u32, display_h: u32) -> Result<(), String> {
        let (w, h) = Self::internal_size(display_w, display_h, self.settings.render_scale);
        Self::validate_size(w, h, self.settings.reference)?;
        self.display_width = display_w;
        self.display_height = display_h;
        if w == self.width && h == self.height {
            return Ok(());
        }
        let targets = Targets::new(
            &self.gpu,
            w,
            h,
            self.settings.cloud_scale,
            self.settings.cloud_far_scale,
            self.settings.taa,
        );
        self.resize_peak = self
            .resize_peak
            .max(self.resource_bytes() + targets.bytes());
        self.targets = targets;
        self.width = w;
        self.height = h;
        self.space.resize(&self.gpu, w, h);
        self.target_serial += 1;
        self.rebind();
        Ok(())
    }
    fn rebind(&mut self) {
        self.bindings = Self::bindings(
            &self.gpu,
            &self.pipelines,
            &self.projected,
            &self.cache,
            &self.vertices,
            &self.indices,
            &self.targets,
            &self.lut,
            &self.water_system,
            &self.weather,
            &self.cloud_shape,
            &self.cloud_sampler,
            &self.scenery,
            &self.sun_system,
            &self.page_bindings,
            &self.space,
        );
        self.previous = None;
        self.previous_space = None;
    }
    pub fn configure(&mut self, mut s: Settings) -> Result<(), String> {
        self.asked = Some(Asked::of(&s));
        // `reference` is derived from the requested cloud scale, never the
        // other way round: a stale flag in a caller's settings copy would
        // force full-resolution clouds back on the next unrelated change.
        s.reference = s.cloud_scale == 1;
        if self.solar_on {
            self.lock_to_body(&mut s);
        }
        s.validate()?;
        s.patch_cap = s.patch_cap.min(self.tier.patch_cap);
        let (width, height) =
            Self::internal_size(self.display_width, self.display_height, s.render_scale);
        Self::validate_size(width, height, s.reference)?;
        let next = s.skin();
        let old = &self.skin;
        let reset = next.geology.seed != old.geology.seed
            || next.geology.relief != old.geology.relief
            || next.geology.roughness != old.geology.roughness
            || next.edits != old.edits;
        if reset {
            self.revision += 1;
            if let Some(cpu) = &mut self.pages.cpu {
                cpu.geology = next.geology;
            }
            self.skin = next;
        }
        if s.taa != self.settings.taa
            || s.cloud_scale != self.settings.cloud_scale
            || s.cloud_far_scale != self.settings.cloud_far_scale
            || width != self.width
            || height != self.height
        {
            self.width = width;
            self.height = height;
            let t = Targets::new(
                &self.gpu,
                self.width,
                self.height,
                s.cloud_scale,
                s.cloud_far_scale,
                s.taa,
            );
            self.resize_peak = self.resize_peak.max(self.resource_bytes() + t.bytes());
            self.targets = t;
            self.space.resize(&self.gpu, width, height);
            self.target_serial += 1;
            self.rebind();
        }
        self.settings = s;
        self.previous = None;
        self.previous_space = None;
        Ok(())
    }
    /// The canonical surface on the CPU: camera constraints, bookmarks and audits.
    /// Turn on the solar system: from here the body can change without a reload.
    pub fn enable_space(&mut self) {
        if self.solar_on {
            return;
        }
        let far_width = self.tier.weather_face * 2;
        self.space
            .enable(&self.gpu, self.width, self.height, far_width);
        crate::startup::mark("space pass");
        self.solar_on = true;
        self.surface_shown = false;
        self.surface_blend = 0.0;
        self.rebind();
        crate::startup::mark("space rebind");
        self.far_clouds = self.space.far_cloud_out().map(|out| {
            let uniform = self.gpu.buffer(
                "far cloud frame",
                std::mem::size_of::<Frame>() as u64,
                wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            );
            let pipeline = compute_pipeline(&self.gpu, "cloud_far_map");
            let [shape_view, shape_sampler] = self.cloud_shape.entries();
            let map = self
                .gpu
                .device
                .create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("far cloud map"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: uniform.as_entire_binding(),
                        },
                        shape_view,
                        shape_sampler,
                        wgpu::BindGroupEntry {
                            binding: 123,
                            resource: wgpu::BindingResource::TextureView(out),
                        },
                    ],
                });
            let mut earth = self.settings.clone();
            earth.world = "earth".into();
            FarClouds {
                uniform,
                pipeline,
                map,
                width: far_width,
                first_row: 0,
                cold: true,
                last_weather: None,
                last_clock: Default::default(),
                pending_frames: 0,
                seed: earth.skin().geology.seed,
            }
        });
    }
    /// Earth's far clouds, kept up from the same weather and cloud clock as the surface pass, whichever body is in full detail. All at
    /// once the first time, since a cloud layer arriving later would be the very pop this exists to prevent, then a few rows a frame
    /// while Earth is to be seen: clouds move far less than a texel of this map in the frames that takes.
    fn update_far_clouds(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if !self.surface_shown {
            self.cloud_clock.advance(
                self.time,
                self.settings.cloud_speed,
                self.settings.cloud_evolution,
                self.settings.wind,
            );
        }
        let Some(far) = &mut self.far_clouds else {
            return;
        };
        if self.body.naif == 399 && far.seed != self.skin.geology.seed {
            far.seed = self.skin.geology.seed;
            far.last_weather = None;
        }
        let asked = self.asked.map_or(self.settings.clouds, |a| a.clouds);
        let surface_has_it =
            self.surface_shown && self.body.naif == 399 && self.surface_blend >= 1.0;
        if !asked || !(far.cold || (self.earth_seen && !surface_has_it)) {
            return;
        }
        let earth = BodyDescriptor::of_naif(399).expect("Earth is in the table");
        let height = far.width / 2;
        let weather = [
            self.settings.cloud_cover,
            self.settings.cloud_turbulence,
            self.settings.cloud_type,
        ];
        let clock = self.cloud_clock;
        // A settings edit, seek or long absence must replace the entire visible
        // planet coherently. Ordinary wind moves much less than an orbital texel.
        let full = far.cold
            || far.last_weather != Some(weather)
            || (clock.evolution - far.last_clock.evolution).abs() > 30.
            || (clock.travel - far.last_clock.travel).abs() > 30.
            || (clock.drift[0] - far.last_clock.drift[0])
                .hypot(clock.drift[1] - far.last_clock.drift[1])
                > 2000.;
        if clock.evolution != far.last_clock.evolution
            || clock.travel != far.last_clock.travel
            || clock.drift != far.last_clock.drift
        {
            far.pending_frames = 64;
        }
        if !full && far.pending_frames == 0 {
            return;
        }
        far.last_weather = Some(weather);
        far.last_clock = clock;
        far.pending_frames = if full {
            0
        } else {
            far.pending_frames.saturating_sub(1)
        };
        let rows = if full { height } else { height.div_ceil(64) };
        let words = self.tier.frame_words();
        let mut frame = self.frame;
        frame.sun[3] = self.settings.cloud_cover as f32;
        frame.planet[0] = earth.radius as f32;
        frame.options[1] = 1.0;
        frame.lod[3] = far.first_row as f32;
        frame.geo[2] = f32::from_bits(far.seed);
        frame.cloud_motion = [
            self.cloud_clock.travel as f32,
            self.cloud_clock.evolution as f32,
            self.settings.cloud_turbulence as f32,
            self.settings.cloud_type as f32,
        ];
        frame.cloud_drift = [
            self.cloud_clock.drift[0] as f32,
            self.cloud_clock.drift[1] as f32,
            0.0,
            0.0,
        ];
        frame.tier_a = words[0];
        frame.tier_b = words[1];
        frame.tier_c = words[2];
        frame.tier_d = words[3];
        self.gpu
            .queue
            .write_buffer(&far.uniform, 0, bytemuck::bytes_of(&frame));
        let mut p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("far clouds"),
            timestamp_writes: None,
        });
        p.set_pipeline(&far.pipeline);
        p.set_bind_group(0, &far.map, &[]);
        p.dispatch_workgroups(far.width.div_ceil(64), rows, 1);
        self.space.encode_far_cloud_levels(&mut p);
        far.first_row = (far.first_row + rows) % height;
        far.cold = false;
    }
    /// Bring another body into full detail. No program changes, and nothing here waits: the surface
    /// stays off until the body's pinned pages have come in, and its impostor stands until then.
    pub fn set_body(&mut self, name: &str) -> Result<(), String> {
        let body = BodyDescriptor::named(name).ok_or("unknown body")?;
        if body.kind != solar_core::body::BodyKind::Solid {
            return Err("only a solid body has a surface pass".into());
        }
        self.scenery.urban.clear(&self.gpu);
        self.buildings.clear(&self.gpu);
        self.body = body;
        self.skin.radius = body.radius;
        let mut settings = self.settings.clone();
        settings.world = name.into();
        let asked = *self.asked.get_or_insert(Asked::of(&self.settings));
        asked.restore(&mut settings);
        self.lock_to_body(&mut settings);
        if body.naif >= 10000 {
            settings.seed = (body.naif as u32).wrapping_mul(2654435761);
        }
        self.settings = settings;
        self.skin.geology = self.settings.skin().geology;
        // Until its manifest arrives, a baked body only promises the pinned
        // levels. Returning to Earth restores its live sources and overlay.
        let earth = body.naif == 399;
        self.pages.source_limits(
            if earth { 15 } else { 3 },
            if earth { 12 } else { 3 },
            earth,
        );
        self.pages.switch_body(
            &self.gpu,
            body.radius,
            body.sea.is_some(),
            body.surface == solar_core::body::SurfaceKind::Measured,
        );
        if let Some(cpu) = &mut self.pages.cpu {
            cpu.geology = self.skin.geology;
            cpu.relief_floor = if body.no_heights && self.settings.ground_detail {
                NO_HEIGHTS_RELIEF
            } else {
                0.0
            };
        }
        self.pages_camera = [0.0; 3];
        self.ground_height = 0.0;
        self.revision += 1;
        self.lut_dirty = true;
        self.previous = None;
        self.previous_space = None;
        self.cloud_force_refresh = true;
        self.sun_system.invalidate();
        self.table_quiet = 0;
        self.surface_shown = false;
        self.surface_blend = 0.0;
        self.surface_warm = 0;
        Ok(())
    }
    /// What the body itself decides, whatever a settings panel sends: the page's copy of the settings still says Earth.
    fn lock_to_body(&self, s: &mut Settings) {
        let body = &self.body;
        s.world = body.name.into();
        s.water = body.earthlike && s.water;
        s.clouds = body.earthlike && s.clouds;
        s.trees = body.earthlike && s.trees;
        // Rocks on every solid body large enough for metre-scale cells; plants only where they grow (docs/SCENERY.md).
        s.rocks =
            body.kind == solar_core::body::BodyKind::Solid && body.radius >= 150_000.0 && s.rocks;
        s.atmosphere = body.atmosphere.is_some();
        if !body.earthlike {
            s.sea = 0.0;
            // The complement's bands are in metres on an Earth-sized body, so a small one has less of it.
            s.relief = if s.ground_detail {
                (body.radius / 1.7e6).clamp(0.1, 1.0)
            } else {
                0.0
            };
        }
    }
    fn relief_floor(&self) -> f64 {
        if self.body.no_heights && self.settings.ground_detail {
            NO_HEIGHTS_RELIEF
        } else {
            0.0
        }
    }
    /// Whether the surface pass draws this frame, given the share of the picture it should have. It may only once the pinned pages are
    /// in, and has none until it has run long enough to have its shadows and clouds. Then it follows the share no faster than SURFACE_RATE,
    /// so that neither pages coming in late nor a very fast craft bring it in or take it out all at once. Off with no share, and costing nothing.
    pub fn show_surface(&mut self, wanted: bool, share: f32) -> bool {
        if !(wanted && self.pages.pinned_ready() && (share > 0.0 || self.surface_blend > 0.0)) {
            self.surface_shown = false;
            self.surface_blend = 0.0;
            self.surface_warm = 0;
            return false;
        }
        self.surface_shown = true;
        self.surface_warm = self.surface_warm.saturating_add(1);
        self.surface_blend = if self.surface_warm <= SURFACE_WARM {
            0.0
        } else {
            share.clamp(
                self.surface_blend - SURFACE_RATE,
                self.surface_blend + SURFACE_RATE,
            )
        };
        true
    }
    /// A sky colour lit by the system star: times its tint, which is exactly 1 in Sol.
    fn starlit(&self, c: [f32; 4]) -> [f32; 4] {
        let s = self.space.starlight;
        [c[0] * s[0], c[1] * s[1], c[2] * s[2], c[3]]
    }
    pub fn surface_shown(&self) -> bool {
        self.surface_shown
    }
    /// One frame's packet from `solar::SolarWorld`, in the axes of the wanted body. Returns its NAIF
    /// code when it has only now become the body with a surface, and zero otherwise.
    pub fn apply_space(&mut self, packet: &[f64]) -> Result<i32, String> {
        use crate::solar::{HEADER, PER_BODY};
        if packet.len() < HEADER {
            return Err("short space packet".into());
        }
        let count = packet[26] as usize;
        let ring_words = packet[31] as usize;
        if packet.len() != HEADER + count * PER_BODY + ring_words {
            return Err("space packet of the wrong size".into());
        }
        let ring = (ring_words != 0).then(|| &packet[packet.len() - ring_words..]);
        let wanted = packet[9] as i32;
        let mut changed = 0;
        if wanted != 0 && wanted != self.body.naif {
            let name = BodyDescriptor::of_naif(wanted).ok_or("unknown body")?.name;
            self.set_body(name)?;
            changed = wanted;
        }
        self.space_wanted = wanted != 0;
        let shown = self.show_surface(wanted != 0, packet[32] as f32);
        let sun = [packet[11], packet[12], packet[13]];
        if field::length(sun) > 0.5 {
            self.settings.sun = sun;
        }
        let v3 = |at: usize| [packet[at], packet[at + 1], packet[at + 2]];
        let forward = v3(3);
        let up = v3(6);
        let right = field::normalized(cross(forward, up));
        let up = cross(right, forward);
        let f3 = |v: V3| [v[0] as f32, v[1] as f32, v[2] as f32];
        let active = crate::solar::layer_of(self.body.naif) as f32;
        let mut bodies = Vec::with_capacity(count);
        let earth_layer = crate::solar::layer_of(399) as f32;
        let clouds_asked = self.asked.map_or(self.settings.clouds, |a| a.clouds);
        let pixel = 2.0 * 30.0_f32.to_radians().tan() / self.height as f32;
        self.earth_seen = false;
        self.space.overlay = None;
        for i in 0..count.min(crate::space::MAX_BODIES) {
            let r = &packet[HEADER + i * PER_BODY..HEADER + (i + 1) * PER_BODY];
            let f = |at: usize| r[at] as f32;
            let layer = f(9);
            let drawn_by_surface = shown && layer == active && f(10) != 8.0;
            let flag = if drawn_by_surface { 2.0 } else { f(10) };
            // Under the surface pass, the impostor sits below all terrain: it only ever shows through a hole, never
            // beyond a horizon lower than the reference radius, as the Moon's often is.
            let sunk = if drawn_by_surface {
                self.body.relief_limit as f32 * 1.1
            } else {
                0.0
            };
            let far_clouds = layer == earth_layer && f(10) != 8.0 && clouds_asked;
            if far_clouds && f(11) > pixel {
                self.earth_seen = true;
            }
            let ring = [f(33), f(34), f(35), far_clouds as u32 as f32];
            if drawn_by_surface && self.surface_blend < 1.0 {
                self.space.overlay = Some(crate::space::Body {
                    rect: [f(0), f(1), f(2), f(3)],
                    center: [f(4), f(5), f(6), f(7)],
                    shape: [f(8), layer, f(10), f(11)],
                    sun: [f(12), f(13), f(14), f(15)],
                    axes: [
                        [f(16), f(17), f(18), f(36)],
                        [f(19), f(20), f(21), f(37)],
                        [f(22), f(23), f(24), f(38)],
                    ],
                    air: [f(25), f(26), f(27), f(28)],
                    beta: [f(29), f(30), f(31), f(32)],
                    ring,
                });
            }
            bodies.push(crate::space::Body {
                rect: [f(0), f(1), f(2), f(3)],
                center: [f(4), f(5), f(6), f(7) - sunk],
                shape: [f(8) - sunk, layer, flag, f(11)],
                sun: [f(12), f(13), f(14), f(15)],
                axes: [
                    [f(16), f(17), f(18), f(36)],
                    [f(19), f(20), f(21), f(37)],
                    [f(22), f(23), f(24), f(38)],
                ],
                air: [f(25), f(26), f(27), f(28)],
                beta: [f(29), f(30), f(31), f(32)],
                ring,
            });
        }
        // The star with the largest disk gets its active regions computed here, once a frame (space.rs `star_regions`), and the
        // eye's place against it in its fixed axes, in radii, from the packet's doubles.
        let star_row = (0..count.min(crate::space::MAX_BODIES))
            .map(|i| &packet[HEADER + i * PER_BODY..HEADER + (i + 1) * PER_BODY])
            .filter(|r| r[10] == 1.0)
            .max_by(|a, b| a[11].total_cmp(&b[11]));
        if let Some(r) = star_row {
            let centre = [r[4], r[5], r[6]];
            let radius = r[7].max(1.0);
            let eye = [0, 1, 2].map(|k| {
                let row = [r[16 + 3 * k], r[17 + 3 * k], r[18 + 3 * k]];
                -(row[0] * centre[0] + row[1] * centre[1] + row[2] * centre[2]) / radius
            });
            self.space.set_star_field(
                &self.gpu,
                r[38] as u32,
                r[37] as f32,
                r[13].abs() as f32,
                eye,
                r[32],
                r[15] as f32,
                r[36] > 0.5,
                // The star's relief takes its march from the same preset key as the terrain's (5 on Ultra and High, 3, 1, 0).
                self.settings.relief_steps as f32,
            );
        }
        self.space.visible = bodies;
        // Proper motion follows the clock, in Julian centuries.
        self.space.centuries = (packet[23] / (36_525.0 * 86_400.0)) as f32;
        self.space.eye_sun = [packet[27] as f32, packet[28] as f32, packet[29] as f32];
        self.space.belt_gain = packet[30] as f32;
        self.space.starlight = [packet[33] as f32, packet[34] as f32, packet[35] as f32];
        self.space.set_ring_field(&self.gpu, ring);
        self.space
            .set_belt_field(&self.gpu, [packet[27], packet[28], packet[29]], packet[30]);
        let icrf = [f3(v3(14)), f3(v3(17)), f3(v3(20))];
        // The packet's rows map inertial axes into the current render frame.
        // Keep the history camera in inertial axes across changes of that frame.
        let inertial =
            |v: V3| std::array::from_fn(|j| (0..3).map(|i| packet[14 + 3 * i + j] * v[i]).sum());
        self.space_pose = SpacePose {
            eye: v3(27),
            right: inertial(right),
            up: inertial(up),
            forward: inertial(forward),
            seconds: packet[23],
        };
        self.space.set_view(
            &self.gpu,
            f3(right),
            f3(up),
            f3(forward),
            self.width,
            self.height,
            icrf,
            self.jitter(),
            self.settings.exposure as f32,
        );
        Ok(changed)
    }
    pub fn surface(&self) -> &dyn SurfaceSource {
        match &self.pages.cpu {
            Some(field) => field,
            None => &self.skin,
        }
    }
    pub fn height(&self, n: V3) -> f64 {
        self.surface().height(field::normalized(n), 0.0)
    }
    pub fn safe_height(&self, n: V3) -> f64 {
        self.height(n)
    }
    pub fn bookmark(&self, name: &str) -> [V3; 2] {
        crate::world::bookmark(self.surface(), name)
    }
    fn frame(&mut self, camera: [V3; 2], dt: f64) -> Result<(), String> {
        let eye = camera[0];
        if !camera
            .iter()
            .flatten()
            .all(|v| v.is_finite() && v.abs() <= 250e6)
            || field::length(eye) < self.body.radius - 20000.0
            || field::length(field::sub(camera[1], eye)) < 0.001
        {
            return Err("invalid bounded body-local camera".into());
        }
        let forward = field::normalized(field::sub(camera[1], eye));
        let radial = field::normalized(eye);
        let mut up = self.camera_up.unwrap_or(radial);
        if up.iter().any(|v| !v.is_finite()) || field::length(up) < 1e-6 {
            return Err("invalid camera up".into());
        }
        up = field::normalized(up);
        if field::dot(up, forward).abs() > 0.9999 {
            up = [0.0, 0.0, 1.0];
            if field::dot(up, forward).abs() > 0.98 {
                up = [0.0, 1.0, 0.0];
            }
        }
        let right = field::normalized(cross(forward, up));
        let up = cross(right, forward);
        let hi =
            std::array::from_fn(|i| (eye[i] / 4096.0).floor() * 4096.0 + self.audit_origin_bias[i]);
        let lo = field::sub(eye, hi);
        let old = self.previous.unwrap_or(self.frame);
        let history = self.previous.is_some()
            && dt > 0.0
            && dt < 0.1
            && field::length(field::sub(eye, self.last_camera)) < 500.0;
        let mut edits = [[0.0; 4]; 32];
        for (i, e) in self.skin.edits.iter().enumerate() {
            let p = field::mul([e[0], e[1], e[2]], self.skin.radius);
            let hi = p.map(|v| (v / 4096.0).floor() * 4096.0);
            edits[2 * i] = four(hi, e[3] as f32);
            edits[2 * i + 1] = four(field::sub(p, hi), e[4] as f32);
        }
        let previous_clock = self.cloud_clock;
        self.cloud_clock.advance(
            self.time,
            self.settings.cloud_speed,
            self.settings.cloud_evolution,
            self.settings.wind,
        );
        // Cloud field refresh policy: parameter changes and time jumps larger
        // than one long frame refresh every texel; ordinary animation refreshes
        // an interleaved fraction so repeated epochs still reproduce exactly.
        let signature = vec![
            self.settings.cloud_cover,
            self.settings.cloud_type,
            self.settings.cloud_turbulence,
            f64::from(self.skin.geology.seed),
            f64::from(self.revision),
            f64::from(self.settings.clouds as u32),
        ];
        let jump = (self.cloud_clock.time - previous_clock.time).abs() > 0.26
            || (self.cloud_clock.travel - previous_clock.travel).abs()
                > 0.26 * self.settings.cloud_speed.max(1.0)
            || (self.cloud_clock.evolution - previous_clock.evolution).abs()
                > 0.26 * self.settings.cloud_evolution.max(1.0);
        let animated = self.cloud_clock.travel != previous_clock.travel
            || self.cloud_clock.evolution != previous_clock.evolution
            || self.cloud_clock.drift != previous_clock.drift;
        let cloud_params_dirty =
            self.cloud_force_refresh || signature != self.cloud_signature || (animated && jump);
        if cloud_params_dirty {
            self.weather_settle = 0;
        } else if animated {
            self.weather_settle = self.settings.cloud_refresh;
        }
        let refresh = self.weather_settle > 0;
        self.weather_settle = self.weather_settle.saturating_sub(1);
        self.cloud_signature = signature;
        self.cloud_force_refresh = false;
        self.sun_system.set_animation(
            self.frame_id as u32,
            self.settings.cloud_refresh,
            refresh,
            cloud_params_dirty,
        );
        // Frames since a page table last changed, for what must wait for them to go quiet.
        let table_serials = [self.pages.height_serial, self.pages.albedo_serial];
        self.table_quiet = if table_serials == self.table_serials {
            self.table_quiet.saturating_add(1)
        } else {
            0
        };
        self.table_serials = table_serials;
        // Cloud lighting keeps a mask of the terrain, too costly to bake again per page. Once the
        // height table has gone quiet it follows, or it would hold whatever the camera found first.
        if self.table_quiet == SOLID_REBAKE_QUIET
            && self.pages.height_serial != self.solid_height_serial
        {
            self.solid_height_serial = self.pages.height_serial;
            self.solid_generation = self.solid_generation.wrapping_add(1);
        }
        self.frame = Frame {
            eye_hi: four(hi, (field::length(eye) - self.body.radius) as f32),
            eye_lo: four(lo, 0.0),
            right: four(right, 0.0),
            up: four(up, 0.0),
            forward: four(forward, 0.0),
            sun: four(
                field::normalized(self.settings.sun),
                self.settings.cloud_cover as f32,
            ),
            view: [
                self.width as f32,
                self.height as f32,
                self.width as f32 / self.height as f32,
                (30.0_f32.to_radians()).tan(),
            ],
            planet: [
                self.body.radius as f32,
                // A body with no sea has no sea level: zero would be a shore on every contour through it, wet and dark.
                if self.body.sea.is_some() {
                    self.settings.sea as f32
                } else {
                    -(self.body.relief_limit as f32 + 2000.0)
                },
                self.settings.exposure as f32,
                self.time as f32,
            ],
            options: [
                self.settings.atmosphere as u32 as f32,
                self.clouds_active() as u32 as f32,
                self.ocean_active() as u32 as f32,
                self.settings.debug as f32,
            ],
            lod: [
                1.0,
                self.settings.lod_distance as f32,
                self.settings.cloud_steps as f32,
                0.0,
            ],
            geo: [
                self.settings.relief as f32,
                self.settings.roughness as f32,
                f32::from_bits(self.skin.geology.seed),
                self.skin.edits.len() as f32,
            ],
            cloud_motion: [
                self.cloud_clock.travel as f32,
                self.cloud_clock.evolution as f32,
                self.settings.cloud_turbulence as f32,
                self.settings.cloud_type as f32,
            ],
            scenery: [
                self.settings.trees as u32 as f32,
                self.settings.rocks as u32 as f32,
                self.settings.scenery_density as f32,
                self.settings.scenery_detail as f32,
            ],
            scenery_limits: [
                self.settings.scenery_draw_limit,
                self.settings.scenery_variant_limit,
                self.settings.scenery_lod,
                self.settings.scenery_isolate,
            ],
            scenery_work: [
                self.settings.scenery_budget as f32,
                (self.frame_id % 16) as f32,
                self.settings.scenery_wind as f32,
                self.settings.buildings as u32 as f32,
            ],
            cloud_cache: [
                self.frame_id as u32,
                self.settings.cloud_refresh,
                cloud_params_dirty as u32,
                refresh as u32,
            ],
            cloud_far: [
                self.settings.cloud_far_scale as f32,
                self.settings.cloud_far_distance as f32,
                self.targets.cw as f32,
                self.targets.ch as f32,
            ],
            quality: [
                self.settings.atmosphere_steps as f32,
                self.settings.water_bands as f32,
                self.settings.water_reflections as u32 as f32,
                self.settings.relief_steps as f32,
            ],
            tier_a: self.tier.frame_words()[0],
            tier_b: self.tier.frame_words()[1],
            tier_c: self.tier.frame_words()[2],
            tier_d: {
                // w: startup placeholder flags (bit 0: sea programs pending).
                let mut words = self.tier.frame_words()[3];
                words[3] = u32::from(self.settings.water && !self.pipelines.ocean_ready());
                words
            },
            atmosphere: self.body.atmosphere_words().0,
            atmosphere_beta: self.body.atmosphere_words().1,
            cloud_shell: self.body.cloud_words(),
            surface_blend: [self.surface_blend, 0.0, 0.0, 0.0],
            solar: [
                self.solar_on as u32 as f32,
                self.body.ambient as f32,
                // The Sun's disk is the space pass's when that is on, at its true size.
                if self.solar_on { 0.0 } else { 1.0 },
                self.body.ground as u32 as f32,
            ],
            body_detail: {
                // The blue in the ambient is Earth's sky. Elsewhere, a neutral grey, or the body's own air.
                let tint = match (self.body.earthlike, self.body.atmosphere) {
                    (true, _) => [1.0, 1.0, 1.0],
                    (false, None) => [1.25, 0.97, 0.77],
                    (false, Some(a)) => [
                        (a.sky_low[0] / 0.21) as f32 * 0.5,
                        (a.sky_low[1] / 0.27) as f32 * 0.5,
                        (a.sky_low[2] / 0.34) as f32 * 0.5,
                    ],
                };
                let s = self.space.starlight;
                [
                    self.relief_floor() as f32,
                    tint[0] * s[0],
                    tint[1] * s[1],
                    tint[2] * s[2],
                ]
            },
            // The sky is lit by the system star: its colour against the Sun's, exactly 1 in Sol.
            air_scatter: self.starlit(self.body.air_colour_words()[0]),
            sky_low: self.starlit(self.body.air_colour_words()[1]),
            sky_high: self.starlit(self.body.air_colour_words()[2]),
            temporal: {
                let enabled = self.temporal_enabled();
                let valid = enabled
                    && self.previous.is_some()
                    && old.temporal[2] > 0.0
                    && dt < 0.2
                    && field::dot(forward, std::array::from_fn(|i| f64::from(old.forward[i])))
                        > 0.75
                    && field::length(field::sub(eye, self.last_camera))
                        < (self.body.radius * 0.12).clamp(1000.0, 100000.0);
                let offset = self.jitter();
                [
                    offset[0],
                    offset[1],
                    enabled as u32 as f32,
                    valid as u32 as f32,
                ]
            },
            starlight: [
                self.space.starlight[0],
                self.space.starlight[1],
                self.space.starlight[2],
                0.0,
            ],
            cover: [
                (self.settings.ground_cover && (self.settings.trees || self.settings.rocks)) as u32
                    as f32,
                self.settings.cover_reach as f32,
                self.settings.cover_density as f32,
                self.settings.scenery_showcase as f32,
            ],
            field: self.pages.field_words(),
            field_serial: [
                self.pages.height_serial,
                self.pages.albedo_serial,
                self.table_quiet,
                self.settings.ground_detail as u32,
            ],
            cloud_drift: [
                self.cloud_clock.drift[0] as f32,
                self.cloud_clock.drift[1] as f32,
                self.settings.cloud_diagnostic as f32,
                self.settings.surface_detail as u32 as f32,
            ],
            prev_hi: old.eye_hi,
            prev_lo: old.eye_lo,
            prev_right: old.right,
            prev_up: old.up,
            prev_forward: old.forward,
            wind: [
                self.settings.wind[0] as f32,
                self.settings.wind[1] as f32,
                dt as f32,
                (history && self.settings.cloud_history) as u32 as f32,
            ],
            eye_tail: four(
                std::array::from_fn(|i| lo[i] - f64::from(lo[i] as f32)),
                0.0,
            ),
            edits,
            numeric: [0, (self.frame_id % 2) as u32, 0, self.revision],
            water: [
                self.settings.wave_height as f32,
                self.settings.foam as f32,
                self.settings.water_clarity as f32,
                self.settings.wave_speed as f32,
            ],
            water_motion: [
                0.0,
                self.settings.caustics as u32 as f32,
                0.0,
                (self.time - old.planet[3] as f64).clamp(0.0, 0.05) as f32,
            ],
        };
        self.previous = Some(self.frame);
        self.frame.right[3] = self.settings.patch_cap as f32;
        self.frame.up[3] = self.revision as f32;
        self.frame.forward[3] = dt as f32;
        self.frame.lod[3] = self.settings.tolerance as f32;
        self.frame.prev_hi[3] = self.settings.cloud_cover as f32;
        self.frame.sun[3] = (self.settings.generation_limit / 289).min(64) as f32;
        self.last_camera = eye;
        Ok(())
    }
    /// Bounded page upload and residency from the f64 camera, before the frame uniform is
    /// written so that the frame sees what it was told about. No GPU feedback enters here.
    fn update_pages(&mut self, camera: [V3; 2], dt: f64) {
        if !self.pages.measured() {
            return;
        }
        self.pages.flush(&self.gpu, self.frame_id);
        let eye = camera[0];
        let n = field::normalized(eye);
        self.ground_height = self.pages.cpu.as_ref().map_or(0.0, |f| f.height(n, 1.0));
        let velocity = if dt > 0.0 && self.pages_camera != [0.0; 3] {
            field::mul(field::sub(eye, self.pages_camera), 1.0 / dt)
        } else {
            [0.0; 3]
        };
        self.pages_camera = eye;
        self.pages.update(
            &solar_core::streaming::StreamCamera {
                position: eye,
                velocity,
                forward: field::normalized(field::sub(camera[1], eye)),
                clearance: self.pages.clearance(eye),
            },
            self.settings.fetch_limits,
        );
        let deficit = self.pages.camera_deficit(eye);
        self.pages.lag.camera_level_deficit = deficit[0];
        self.pages.lag.camera_albedo_deficit = deficit[1];
    }
    pub fn encode(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        camera: [V3; 2],
        dt: f64,
        slot: Option<usize>,
    ) -> Result<(), String> {
        self.last_resolve = None;
        let start = crate::now_ms();
        if let Some(query_set) = slot.and_then(|i| self.timing.slots[i].queries.as_ref()) {
            let _p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("whole frame begin"),
                timestamp_writes: Some(wgpu::ComputePassTimestampWrites {
                    query_set,
                    beginning_of_pass_write_index: Some(timing::FRAME_BEGIN),
                    end_of_pass_write_index: None,
                }),
            });
        }
        self.marker
            .begin(slot.and_then(|i| self.timing.slots[i].queries.as_ref()));
        self.complete_features();
        if self.solar_on {
            self.update_far_clouds(encoder);
            self.marker.mark(encoder, "far_clouds");
            self.space.encode(encoder);
            self.marker.mark(encoder, "space");
            if self.surface_shown && self.surface_blend < 1.0 {
                self.space.encode_active(encoder);
                self.marker.mark(encoder, "space_active");
            }
            if self.surface_shown {
                self.space.encode_rocks(encoder);
                self.marker.mark(encoder, "space_rocks");
            }
            if !self.surface_shown {
                // Pages keep arriving for the body about to come into full detail, within their
                // budget, and nothing else of the surface runs.
                if self.space_wanted {
                    self.update_pages(camera, dt);
                } else {
                    self.pages.flush(&self.gpu, self.frame_id);
                }
                self.space.encode_rocks(encoder);
                self.marker.mark(encoder, "space_rocks");
                self.previous = None;
                let parity = self.frame_id as usize % 2;
                let (scene, key) = if self.temporal_enabled() {
                    let frame = self.space_temporal_frame(dt);
                    self.gpu
                        .queue
                        .write_buffer(&self.projected, 0, bytemuck::bytes_of(&frame));
                    self.resolve_temporal(encoder, parity, true);
                    self.last_resolve = Some((parity, frame.temporal[3] > 0.0));
                    self.previous_space = Some(self.space_pose);
                    (
                        &self.targets.resolved[parity].view,
                        (u64::from(self.target_serial) << 2) | 2 | parity as u64,
                    )
                } else {
                    self.previous_space = None;
                    (
                        self.space.color_view(),
                        1 << 63 | u64::from(self.space.serial),
                    )
                };
                self.finish.encode(
                    &self.gpu,
                    encoder,
                    scene,
                    key,
                    (self.width, self.height),
                    &self.targets.display.view,
                    self.settings.finish(&self.space.star_sources(), dt),
                    &mut |e, label| self.marker.mark(e, label),
                );
                self.last_encode_ms = crate::now_ms() - start;
                return Ok(());
            }
        }
        self.previous_space = None;
        let clouds_active = self.clouds_active();
        let water_active = self.ocean_active();
        self.update_pages(camera, dt);
        self.frame(camera, dt)?;
        self.gpu
            .queue
            .write_buffer(&self.uniform, 0, bytemuck::bytes_of(&self.frame));
        let queries = slot.and_then(|i| self.timing.slots[i].queries.as_ref());
        self.terrain.encode(encoder, queries, &mut self.marker);
        self.scenery
            .encode(encoder, queries, self.frame_id, &mut self.marker);
        self.marker.mark(encoder, "scenery_encode");
        self.buildings.encode(encoder, queries);
        self.marker.mark(encoder, "buildings_encode");
        let clipmap_refresh = if self.pages.measured() {
            self.pages
                .take_clipmap_refresh(camera[0], crate::sun::HEIGHT_LEVELS as u32)
        } else {
            0
        };
        self.sun_system.update(
            &self.gpu,
            camera[0],
            &self.settings,
            self.revision,
            queries.is_some(),
            &self.body,
            clipmap_refresh,
            self.solid_generation,
        );
        // Weather must be current before any surface or cloud reads sunlight.
        {
            let mut p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("shared cloud fields"),
                timestamp_writes: queries.map(|q| wgpu::ComputePassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(38),
                    end_of_pass_write_index: Some(39),
                }),
            });
            // Stamp the empty interval too: query slots are reused, so leaving
            // this stage unwritten would report an earlier cloudy frame.
            if self.settings.clouds
                && (self.frame.cloud_cache[2] != 0 || self.frame.cloud_cache[3] != 0)
            {
                p.set_pipeline(&self.pipelines.weather);
                p.set_bind_group(0, &self.bindings.weather, &[]);
                dispatch_weather(&mut p, &self.frame, self.tier.weather_face);
            }
        }
        self.marker.mark(encoder, "cloud_fields");
        self.sun_system.encode(
            encoder,
            queries,
            self.scenery_active(),
            &self.buildings,
            &mut self.marker,
        );
        self.marker.mark(encoder, "sun_tail");
        // Keep the historical cloud-volume timestamp slot valid for telemetry.
        if let Some(query_set) = queries {
            let _stamp = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("retired cloud volume stage"),
                timestamp_writes: Some(wgpu::ComputePassTimestampWrites {
                    query_set,
                    beginning_of_pass_write_index: Some(56),
                    end_of_pass_write_index: Some(57),
                }),
            });
        }
        let writes = |stage: u32| {
            queries.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(stage * 2),
                end_of_pass_write_index: Some(stage * 2 + 1),
            })
        };
        if self.settings.relief_steps > 0 && self.settings.surface_detail {
            // Proxy visibility first: nearest unrefined distance and trust.
            let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("terrain proxy pre-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.proxy.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 1.0e30,
                            g: 0.0,
                            b: 0.0,
                            a: 0.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.targets.proxy_depth.view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: queries.map(|q| wgpu::RenderPassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(6),
                    end_of_pass_write_index: None,
                }),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            p.set_pipeline(&self.pipelines.prepass);
            p.set_bind_group(0, &self.bindings.prepass, &[]);
            p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
            p.draw_indexed_indirect(&self.terrain.indirect, 48);
        }
        self.marker.mark(encoder, "proxy_prepass");
        let prepassed = self.settings.relief_steps > 0 && self.settings.surface_detail;
        {
            let attachments = [
                Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.position.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.normal.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
            ];
            let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("triangle visibility"),
                color_attachments: &attachments,
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.targets.depth.view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: queries.map(|q| wgpu::RenderPassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: if prepassed { None } else { Some(6) },
                    end_of_pass_write_index: Some(7),
                }),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            p.set_pipeline(&self.pipelines.raster);
            p.set_bind_group(0, &self.bindings.raster, &[]);
            p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint32);
            p.draw_indexed_indirect(&self.terrain.indirect, 48);
        }
        self.marker.mark(encoder, "terrain_raster");
        if self.scenery_active() {
            self.scenery.draw(
                encoder,
                queries,
                [
                    &self.targets.position.view,
                    &self.targets.normal.view,
                    &self.targets.material.view,
                    &self.targets.depth.view,
                ],
            );
        }
        self.marker.mark(encoder, "scenery_draw");
        self.buildings.draw(
            encoder,
            [
                &self.targets.position.view,
                &self.targets.normal.view,
                &self.targets.material.view,
                &self.targets.depth.view,
            ],
            queries,
        );
        self.marker.mark(encoder, "buildings_draw");
        let parity = self.frame_id as usize % 2;
        // Every stage still opens its pass so the timing slots are stamped;
        // a feature whose programs are pending simply dispatches nothing.
        for (stage, pipeline, bindings, w, h) in [
            (
                4,
                Some(
                    self.pipelines
                        .shade
                        .as_ref()
                        .unwrap_or(&self.pipelines.shade_initial),
                ),
                Some(
                    self.bindings
                        .shade
                        .as_ref()
                        .unwrap_or(&self.bindings.shade_initial),
                ),
                self.width,
                self.height,
            ),
            (
                14,
                self.pipelines.scenery_shade.as_ref(),
                self.bindings.scenery_shade.as_ref(),
                self.width,
                self.height,
            ),
            (
                5,
                self.pipelines.water.as_ref().filter(|_| water_active),
                self.bindings.water.as_ref(),
                self.width,
                self.height,
            ),
            (
                6,
                self.pipelines.cloud.as_ref().filter(|_| clouds_active),
                self.bindings.cloud.as_ref().map(|c| &c[parity]),
                self.targets.cw,
                self.targets.ch,
            ),
            (
                7,
                Some(&self.pipelines.composite),
                Some(&self.bindings.composite[parity]),
                self.width,
                self.height,
            ),
        ] {
            if stage == 5 {
                {
                    let _p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some("begin water including simulation"),
                        timestamp_writes: queries.map(|q| wgpu::ComputePassTimestampWrites {
                            query_set: q,
                            beginning_of_pass_write_index: Some(10),
                            end_of_pass_write_index: None,
                        }),
                    });
                }
                self.water_system.encode(encoder, parity, &mut self.marker);
                self.marker.mark(encoder, "water_foam");
                let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("ocean visibility"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.targets.ocean.view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &self.targets.depth.view,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                if let (true, Some(pipeline), Some(group)) = (
                    water_active,
                    self.pipelines.ocean.as_ref(),
                    self.bindings.ocean.as_ref(),
                ) {
                    p.set_pipeline(pipeline);
                    p.set_bind_group(0, group, &[]);
                    p.draw_indirect(&self.terrain.indirect, 144);
                }
                // With the whole-frame timeline on, the water mesh draws in a
                // pass of its own (loading the target) so the two are timed apart.
                if self.marker.set.is_some() {
                    drop(p);
                    self.marker.mark(encoder, "ocean_lifted");
                    p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("ocean visibility, water mesh"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &self.targets.ocean.view,
                            depth_slice: None,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &self.targets.depth.view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                }
                // The water layer's own mesh (explorer.wgsl water_mesh_surface): vertices from the index alone.
                if let (true, Some(pipeline), Some(group)) = (
                    water_active && self.pages.water_layer_active(),
                    self.pipelines.water_mesh.as_ref(),
                    self.bindings.water_mesh.as_ref(),
                ) {
                    p.set_pipeline(pipeline);
                    p.set_bind_group(0, group, &[]);
                    p.draw(0..WATER_MESH_VERTICES, 0..1);
                }
                drop(p);
                self.marker.mark(encoder, "ocean_raster");
                let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("near-plane ocean crossing"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.targets.ocean_cap.view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &self.targets.depth.view,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Clear(0.0),
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                if let (true, Some(pipeline), Some(group)) = (
                    water_active
                        && (self.pages.water_layer_active()
                            || (self.frame.eye_hi[3] - self.settings.sea as f32).abs()
                                < self.settings.wave_height as f32 * 1.1 + 1.3),
                    self.pipelines.ocean_cap.as_ref(),
                    self.bindings.ocean_cap.as_ref(),
                ) {
                    p.set_pipeline(pipeline);
                    p.set_bind_group(0, group, &[]);
                    p.draw_indirect(&self.terrain.indirect, 144);
                }
                if let (true, Some(pipeline), Some(group)) = (
                    water_active
                        && self.pages.water_layer_active()
                        && (self.pages.water_layer_active()
                            || (self.frame.eye_hi[3] - self.settings.sea as f32).abs()
                                < self.settings.wave_height as f32 * 1.1 + 1.3),
                    self.pipelines.water_mesh_cap.as_ref(),
                    self.bindings.water_mesh_cap.as_ref(),
                ) {
                    p.set_pipeline(pipeline);
                    p.set_bind_group(0, group, &[]);
                    p.draw(0..WATER_MESH_VERTICES, 0..1);
                }
                drop(p);
                self.marker.mark(encoder, "ocean_cap");
            }
            let mut p = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(timing::NAMES[stage]),
                timestamp_writes: if stage == 5 {
                    queries.map(|q| wgpu::ComputePassTimestampWrites {
                        query_set: q,
                        beginning_of_pass_write_index: None,
                        end_of_pass_write_index: Some(11),
                    })
                } else {
                    writes(stage as u32)
                },
            });
            if stage == 7 && self.lut_dirty {
                p.set_pipeline(&self.pipelines.lut);
                p.set_bind_group(0, &self.bindings.lut, &[]);
                p.dispatch_workgroups(32, 8, 1);
                self.lut_dirty = false;
            }
            if let (true, Some(pipeline), Some(group)) = (
                stage == 6 && clouds_active && self.settings.cloud_far_scale > 1,
                self.pipelines.cloud_far.as_ref(),
                self.bindings.cloud_far.as_ref(),
            ) {
                p.set_pipeline(pipeline);
                p.set_bind_group(0, group, &[]);
                p.dispatch_workgroups(
                    self.targets.far.texture.width().div_ceil(8),
                    self.targets.far.texture.height().div_ceil(8),
                    1,
                );
            }
            if let (Some(pipeline), Some(bindings)) = (pipeline, bindings) {
                p.set_pipeline(pipeline);
                p.set_bind_group(0, bindings, &[]);
                p.dispatch_workgroups(w.div_ceil(8), h.div_ceil(8), 1);
            }
            drop(p);
            const STAGE_MARKS: [&str; 15] = [
                "",
                "",
                "",
                "",
                "shade",
                "water",
                "clouds",
                "composite",
                "",
                "",
                "",
                "",
                "",
                "",
                "scenery_shade",
            ];
            self.marker.mark(encoder, STAGE_MARKS[stage]);
        }
        let temporal = self.frame.temporal[2] > 0.0;
        let (scene, key) = if temporal {
            self.resolve_temporal(encoder, parity, false);
            self.last_resolve = Some((parity, self.frame.temporal[3] > 0.0));
            (
                &self.targets.resolved[parity].view,
                (u64::from(self.target_serial) << 2) | 2 | parity as u64,
            )
        } else {
            (&self.targets.hdr.view, u64::from(self.target_serial) << 2)
        };
        self.finish.encode(
            &self.gpu,
            encoder,
            scene,
            key,
            (self.width, self.height),
            &self.targets.display.view,
            self.settings.finish(&self.flare_sources(), dt),
            &mut |e, label| self.marker.mark(e, label),
        );
        self.last_encode_ms = crate::now_ms() - start;
        Ok(())
    }
    fn resolve_temporal(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        parity: usize,
        space_only: bool,
    ) {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("temporal resolve"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipelines.temporal);
        pass.set_bind_group(0, &self.bindings.temporal[space_only as usize][parity], &[]);
        pass.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
        drop(pass);
        self.marker.mark(encoder, "temporal_resolve");
    }
    fn space_temporal_frame(&self, dt: f64) -> Frame {
        let pose = self.space_pose;
        let old = self.previous_space.unwrap_or(pose);
        let delta = field::sub(pose.eye, old.eye);
        let valid = self.previous_space.is_some()
            && dt < 0.2
            && (pose.seconds - old.seconds).abs() < 5.0
            && field::dot(old.forward, pose.forward) > 0.75
            && field::length(delta) < 1e10;
        let jitter = self.jitter();
        let mut frame = self.frame;
        frame.view = [
            self.width as f32,
            self.height as f32,
            self.width as f32 / self.height as f32,
            30_f32.to_radians().tan(),
        ];
        frame.temporal = [jitter[0], jitter[1], 2.0, valid as u32 as f32];
        frame.right = four(pose.right, 0.0);
        frame.up = four(pose.up, 0.0);
        frame.forward = four(pose.forward, 0.0);
        frame.prev_right = four(old.right, 0.0);
        frame.prev_up = four(old.up, 0.0);
        frame.prev_forward = four(old.forward, 0.0);
        frame.eye_hi = four(delta, 0.0);
        frame.eye_lo = [0.0; 4];
        frame.prev_hi = [0.0; 4];
        frame.prev_lo = [0.0; 4];
        frame
    }
    /// The lens flare's sources for a frame with a surface pass: the space layer's stars, or on a world of its own the sky's
    /// sun (explorer.wgsl `sun_disk`, whose edge is at a cosine of 0.99993).
    fn flare_sources(&self) -> Vec<[f32; 4]> {
        if self.solar_on {
            return self.space.star_sources();
        }
        let f = &self.frame;
        let dot = |a: &[f32; 4], b: &[f32; 4]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let ahead = dot(&f.sun, &f.forward);
        if ahead <= 0.0 {
            return Vec::new();
        }
        let tan = f.view[3];
        vec![[
            dot(&f.sun, &f.right) / ahead / tan,
            -dot(&f.sun, &f.up) / ahead / tan,
            0.99993_f32.acos().tan() / tan,
            1.0,
        ]]
    }
    pub fn submit_timing(&mut self, slot: Option<usize>) {
        if let Some(i) = slot {
            self.timing.submitted(
                i,
                &self.gpu,
                Sample {
                    id: self.frame_id,
                    surface_stages: !self.solar_on || self.surface_shown,
                    cpu_schedule_ms: 0.0,
                    cpu_encode_ms: self.last_encode_ms,
                    submit_ms: crate::now_ms(),
                    completion_ms: 0.0,
                    gpu_ms: None,
                    gpu_span_ms: None,
                    generated: None,
                    patches: None,
                    error: None,
                    marks: Vec::new(),
                    mark_labels: self.marker.take(),
                },
            );
        }
        self.frame_id += 1;
        if slot.is_some() && self.frame_id % 30 == 1 {
            self.pages.lag.readback_requests += 2;
            self.terrain.request_stats(&self.gpu);
            self.scenery.request_stats(&self.gpu);
        }
    }
    pub fn native_present_stamp(&self, e: &mut wgpu::CommandEncoder, slot: Option<usize>) {
        let q = slot.and_then(|i| self.timing.slots[i].queries.as_ref());
        let _p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("native no swapchain"),
            timestamp_writes: q.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(16),
                end_of_pass_write_index: Some(17),
            }),
        });
        drop(_p);
        self.frame_end_stamp(e, slot);
    }
    pub fn frame_end_stamp(&self, e: &mut wgpu::CommandEncoder, slot: Option<usize>) {
        if let Some(query_set) = slot.and_then(|i| self.timing.slots[i].queries.as_ref()) {
            let _p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("whole frame end"),
                timestamp_writes: Some(wgpu::ComputePassTimestampWrites {
                    query_set,
                    beginning_of_pass_write_index: None,
                    end_of_pass_write_index: Some(timing::FRAME_END),
                }),
            });
        }
    }
    pub fn building_sources(&mut self, records: &[u8], points: &[u8]) -> Result<(), String> {
        let Some(records) =
            self.buildings
                .upload(&self.gpu, records, points, self.frame_id as u32)?
        else {
            // An identical source publication cannot rebuild/upload the
            // multi-megabyte urban index.
            return Ok(());
        };
        self.scenery.urban.update(&self.gpu, &records, points);
        // Urban masks are read every frame; their upload must not change the
        // world's revision. That revision resets the terrain quadtree and its
        // morphs, turning ordinary vector streaming into repeated planet rebuilds.
        Ok(())
    }
    pub fn resource_bytes(&self) -> u64 {
        self.uniform.size()
            + self.cache.size()
            + self.vertices.iter().map(wgpu::Buffer::size).sum::<u64>()
            + self.indices.size()
            + self.targets.bytes()
            + self.finish.bytes()
            + self.lut.bytes
            + self.weather.bytes
            + crate::clouds::CloudShape::BYTES
            + self.terrain.bytes()
            + self.scenery.bytes()
            + self.sun_system.bytes()
            + self.buildings.bytes()
            + self.water_system.bytes()
            + self.pages.bytes()
            + self.projected.size()
            + 4 * 1024
    }
    pub fn stats(&self) -> serde_json::Value {
        let mut s = serde_json::json!({"patches":6,"max_level":0,"triangles":0,"vertices":0,"samples":0,"pending_samples":0,"generated":0,"denied":0,"error_bound_pixels":0.0,"morph":1.0,"epochs":0,"controlled_gpu_bytes":self.resource_bytes(),"resize_overlap_bytes":self.resize_peak,"cloud_resolution":[self.targets.cw,self.targets.ch],"width":self.width,"height":self.height,"display_width":self.display_width,"display_height":self.display_height,"render_scale":self.settings.render_scale,"stage_names":timing::NAMES,"adapter":format!("{:?}",self.gpu.adapter.get_info()),"timestamps":self.gpu.timestamps,"timing_skipped":self.timing.skipped});
        s["pending_features"] = serde_json::json!(self.pending_features());
        if let Some(values) = self.terrain.stats().as_object() {
            for (k, v) in values {
                s[k] = v.clone();
            }
        }
        s["body"] = self.body.name.into();
        s["urban_index_overflow"] = self.scenery.urban.overflow.into();
        s["urban_source_cache_bytes"] = self.buildings.source_cache_bytes().into();
        s["surface_source"] = if self.pages.measured() {
            "mapped"
        } else {
            "procedural"
        }
        .into();
        if self.solar_on {
            s["solar"] = serde_json::json!({"surface_shown": self.surface_shown, "blend": self.surface_blend, "far_clouds": self.far_clouds.as_ref().is_some_and(|c| !c.cold), "wanted": self.space_wanted, "stars": self.space.stars_loaded, "belt_field": self.space.belt_on, "body": self.body.name, "applied": {"water": self.settings.water, "clouds": self.settings.clouds, "trees": self.settings.trees, "rocks": self.settings.rocks, "sea": self.settings.sea, "relief": self.settings.relief, "atmosphere": self.settings.atmosphere}, "maps": self.space.maps_loaded, "drawn": self.space.visible.len(), "pinned_ready": self.pages.pinned_ready(), "uploaded_since_switch": self.pages.uploaded_since_switch, "star_regions": self.space.star_region_list()});
        }
        s["data_lag"] = serde_json::to_value(self.pages.lag).unwrap();
        s["water_layer"] = serde_json::to_value(self.pages.water_layer).unwrap();
        s["pages_gpu_bytes"] = self.pages.bytes().into();
        s["source_levels"] = serde_json::json!({"height":self.pages.field_words()[1],"albedo":self.pages.field_words()[2],"height_data":!self.body.no_heights});
        s["sources_in_view"] = self.pages.sources_in_view().into();
        s["scenery"] = self.scenery.stats();
        s["scenery_gpu_bytes"] = self.scenery.bytes().into();
        s["sun_gpu_bytes"] = self.sun_system.bytes().into();
        s["buildings"] = serde_json::json!({"enabled":self.settings.buildings,"sources":self.buildings.count,"source_points":self.buildings.point_count,"source_capacity":16384,"point_capacity":131072,"visibility":"projected size","gpu_bytes":self.buildings.bytes(),"height_provenance":"source estimates"});
        s["sun"] = serde_json::json!({"enabled": self.settings.shadows, "terrain_queries": self.settings.shadow_steps, "height_texels": self.tier.height_texels(), "height_levels": crate::sun::HEIGHT_LEVELS, "height_size": self.tier.sun_height, "caster_capacity_per_stream": self.tier.sun_casters, "cloud_knots":16, "history":false});
        s["taa_history_used"] = self.last_resolve.is_some_and(|(_, used)| used).into();
        s["tier"] = serde_json::json!({"name": self.tier.name, "hash_cap": self.tier.hash_cap, "union_cap": self.tier.union_cap, "node_cap": self.tier.node_cap, "scenery_capacity": self.tier.sc_cap(), "patch_cap": self.tier.patch_cap, "shadow_map": self.tier.shadow_map, "cloud_shape_size": crate::clouds::CloudShape::SIDE, "weather_face": self.tier.weather_face, "atlas": self.tier.atlas, "wave_base": self.tier.wave_base});
        s
    }
    pub async fn capture(&self, kind: &str) -> Result<Vec<u8>, String> {
        // The frame in linear light: the composite's, or the space layer when it alone was the frame.
        let space_frame = self.solar_on && !self.surface_shown;
        let (t, bpp): (&wgpu::Texture, u32) = match kind {
            "resolved_hdr" if self.last_resolve.is_some() => (
                &self.targets.resolved[self.last_resolve.unwrap().0].texture,
                8,
            ),
            "hdr" | "resolved_hdr" if space_frame => (self.space.color(), 8),
            "position" => (&self.targets.position.texture, 16),
            "normal" => (&self.targets.normal.texture, 8),
            "shaded" => (&self.targets.shade.texture, 8),
            "weather" => (&self.weather.texture, 8),
            "ocean" => (&self.targets.ocean.texture, 8),
            "ocean-cap" => (&self.targets.ocean_cap.texture, 4),
            "water" => (&self.targets.water.texture, 8),
            "hdr" | "resolved_hdr" => (&self.targets.hdr.texture, 8),
            "cloud" => (
                &self.targets.cloud[self.frame_id.saturating_sub(1) as usize % 2].texture,
                8,
            ),
            _ => (&self.targets.display.texture, 4),
        };
        let width = t.width();
        let height = t.height();
        let row = (width * bpp).div_ceil(256) * 256;
        let read = self.gpu.buffer(
            "explicit capture staging",
            u64::from(row) * u64::from(height),
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut e = self.gpu.device.create_command_encoder(&Default::default());
        e.copy_texture_to_buffer(
            t.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &read,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: None,
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.gpu.queue.submit([e.finish()]);
        let padded = self.gpu.read(&read).await?;
        let mut out = Vec::with_capacity((width * height * bpp) as usize);
        for r in padded.chunks_exact(row as usize) {
            out.extend_from_slice(&r[..(width * bpp) as usize]);
        }
        if kind == "weather" {
            // Diagnostics read the atlas as 32-bit floats with the stored
            // base relative to its 1550 m mean restored.
            let mut widened = Vec::with_capacity(out.len() * 2);
            for (i, half) in out.chunks_exact(2).enumerate() {
                let mut value = half_to_f32(u16::from_le_bytes([half[0], half[1]]));
                if i % 4 == 2 {
                    value += 1550.0;
                }
                widened.extend_from_slice(&value.to_le_bytes());
            }
            return Ok(widened);
        }
        Ok(out)
    }
    pub async fn read_buffer(&self, buffer: &wgpu::Buffer) -> Result<Vec<u8>, String> {
        self.read_prefix(buffer, buffer.size()).await
    }
    async fn read_prefix(&self, buffer: &wgpu::Buffer, bytes: u64) -> Result<Vec<u8>, String> {
        self.read_range(buffer, 0, bytes).await
    }
    async fn read_range(
        &self,
        buffer: &wgpu::Buffer,
        offset: u64,
        bytes: u64,
    ) -> Result<Vec<u8>, String> {
        let read = self.gpu.buffer(
            "explicit audit staging",
            bytes,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut e = self.gpu.device.create_command_encoder(&Default::default());
        e.copy_buffer_to_buffer(buffer, offset, &read, 0, bytes);
        self.gpu.queue.submit([e.finish()]);
        self.gpu.read(&read).await
    }
    pub async fn audit_shadows(&self) -> Result<serde_json::Value, String> {
        let g = &self.gpu;
        // The build's specialized program, like every pass: the raw source
        // lacks the build's specialization and later shader files.
        let module = crate::startup::shader(g, "sun_audit");
        let pipeline = g
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("sun audit"),
                layout: None,
                module: &module,
                entry_point: Some("sun_audit"),
                compilation_options: Default::default(),
                cache: g.cache(),
            });
        let output = g.buffer(
            "explicit sun audit",
            3072 * 5 * 16,
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        );
        let mut entries = self.sun_system.entries(true);
        entries.extend([
            wgpu::BindGroupEntry {
                binding: 0,
                resource: self.projected.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 5,
                resource: wgpu::BindingResource::TextureView(&self.targets.position.view),
            },
            wgpu::BindGroupEntry {
                binding: 6,
                resource: wgpu::BindingResource::TextureView(&self.targets.normal.view),
            },
            wgpu::BindGroupEntry {
                binding: 46,
                resource: wgpu::BindingResource::TextureView(&self.weather.view),
            },
            wgpu::BindGroupEntry {
                binding: 50,
                resource: wgpu::BindingResource::Sampler(&self.cloud_sampler),
            },
            wgpu::BindGroupEntry {
                binding: 59,
                resource: self.scenery.instances.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 79,
                resource: output.as_entire_binding(),
            },
        ]);
        entries.extend(self.cloud_shape.entries());
        entries.extend(self.page_bindings.audit_entries());
        entries.sort_by_key(|e| e.binding);
        entries.dedup_by_key(|e| e.binding);
        entries.retain(|e| crate::startup::program_bindings("sun_audit").contains(&e.binding));
        let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sun audit"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &entries,
        });
        let mut encoder = g.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(48, 1, 1);
        }
        g.queue.submit([encoder.finish()]);
        let bytes = self.read_buffer(&output).await?;
        let samples: Vec<Vec<f32>> = bytes
            .chunks_exact(80)
            .map(|row| {
                row.chunks_exact(4)
                    .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
                    .collect()
            })
            .collect();
        let bytes = self.read_buffer(&self.sun_system.state).await?;
        let counters: Vec<u32> = bytes
            .chunks_exact(4)
            .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
            .collect();
        let cache = self.read_buffer(&self.sun_system.cache_state).await?;
        let cache_words: Vec<u32> = cache
            .chunks_exact(4)
            .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
            .collect();
        // cloud_centers starts at byte 80 in SunCacheState. Each w is the
        // resident half-width of the published square for that level.
        let radii = [23, 27, 31].map(|word| f32::from_bits(cache_words[word]));
        Ok(
            serde_json::json!({"cloud_profile_radii":radii,"samples":&samples[..2048],"fixed_samples":&samples[2048..],"draws":(0..crate::sun::CASCADES).flat_map(|i|[1,6,11,15].map(|offset| counters[i*20+offset])).collect::<Vec<_>>(),"overflow":counters[crate::sun::DRAW_WORDS],"casters":counters[crate::sun::DRAW_WORDS + 1],"incomplete_casters":counters[crate::sun::DRAW_WORDS + 2],"gpu_bytes":self.sun_system.bytes(),"height_refills_last_profiled_frame":cache_words[32],"height_refills_profiled_total":u64::from(cache_words[33]) | (u64::from(cache_words[34]) << 32),"profile_rebuild_flags":&cache_words[12..16],"profile_rebuild_frames":&cache_words[16..20],"profile_counter_order":["global_optical","global_solid","local_optical","local_solid"]}),
        )
    }
    pub async fn audit_shadow_points(&self, points: &[f64]) -> Result<serde_json::Value, String> {
        if points.is_empty()
            || points.len() % 4 != 0
            || points.len() > 4096 * 4
            || points.iter().any(|v| !v.is_finite() || v.abs() > 250e6)
            || points
                .chunks_exact(4)
                .any(|v| v[3].abs() < 0.008 || v[3].abs() > 10000.0)
        {
            return Err("invalid world shadow probes".into());
        }
        let g = &self.gpu;
        let values: Vec<[f32; 4]> = points
            .chunks_exact(4)
            .map(|p| {
                [
                    (p[0] - self.last_camera[0]) as f32,
                    (p[1] - self.last_camera[1]) as f32,
                    (p[2] - self.last_camera[2]) as f32,
                    p[3] as f32,
                ]
            })
            .collect();
        let input = g.buffer(
            "explicit world sun probes",
            (values.len() * 16) as u64,
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        );
        g.queue
            .write_buffer(&input, 0, bytemuck::cast_slice(&values));
        let output = g.buffer(
            "explicit world sun results",
            (values.len() * 224) as u64,
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        );
        let module = crate::startup::shader(g, "sun_world_audit");
        let pipeline = g
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("sun_world_audit"),
                layout: None,
                module: &module,
                entry_point: Some("sun_world_audit"),
                compilation_options: Default::default(),
                cache: g.cache(),
            });
        let mut entries = self.sun_system.entries(true);
        for (binding, buffer) in [
            (0, &self.projected),
            (59, &self.scenery.instances),
            (79, &output),
            (80, &input),
        ] {
            entries.push(wgpu::BindGroupEntry {
                binding,
                resource: buffer.as_entire_binding(),
            });
        }
        entries.extend(self.page_bindings.audit_entries());
        entries.sort_by_key(|e| e.binding);
        entries.dedup_by_key(|e| e.binding);
        entries
            .retain(|e| crate::startup::program_bindings("sun_world_audit").contains(&e.binding));
        let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("world sun audit"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &entries,
        });
        let mut encoder = g.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups((values.len() as u32).div_ceil(64), 1, 1);
        }
        g.queue.submit([encoder.finish()]);
        let data = self.read_buffer(&output).await?;
        let rows: Vec<Vec<f32>> = data
            .chunks_exact(224)
            .map(|p| {
                p.chunks_exact(4)
                    .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
                    .collect()
            })
            .collect();
        Ok(serde_json::json!({"samples":rows,"layout":self.sun_system.audit_layout()}))
    }
    pub async fn audit_scenery(&self) -> Result<serde_json::Value, String> {
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        self.scenery.encode_audit(
            &self.gpu,
            &mut encoder,
            &self.projected,
            &self.terrain,
            &self.vertices,
            &self.indices,
        );
        self.gpu.queue.submit([encoder.finish()]);
        let bytes = self
            .read_prefix(&self.scenery.state, crate::scenery::STATE_BYTES)
            .await?;
        let mut result = crate::scenery::Scenery::decode_stats(&bytes);
        let instances = self.read_buffer(&self.scenery.instances).await?;
        let frame = self.read_buffer(&self.projected).await?;
        let rendered = bytemuck::pod_read_unaligned::<Frame>(&frame[..size_of::<Frame>()]);
        let value = |offset: usize| f64::from(f32::from_bits(crate::audit::word(&frame, offset)));
        let eye: [f64; 3] =
            std::array::from_fn(|i| value(i * 4) + value(16 + i * 4) + value(272 + i * 4));
        let draws = self.read_buffer(&self.scenery.visible).await?;
        let mut visible = std::collections::HashSet::new();
        // Draw lists per class (scenery.wgsl sc_list_base): tree LOD0-2, rock LOD0-1, impostor cards.
        let bases = [0usize, 1024, 5120, 21504, 25600, 41984, 74752];
        for (k, base) in bases.iter().enumerate() {
            let count = result["class_draws"][k].as_u64().unwrap_or(0) as usize;
            for i in 0..count {
                visible.insert(crate::audit::word(&draws, (base + i) * 4) as usize);
            }
        }
        let mut nearest = Vec::new();
        let showcase = if rendered.cover[3] > 0.5 {
            solar_core::hash((rendered.cover[3] as u32).wrapping_add(0x5ca1))
        } else {
            0
        };
        let revision =
            (rendered.numeric[3] << 16) ^ solar_core::hash(rendered.planet[1].to_bits()) ^ showcase;
        result["placement_frame"] = serde_json::json!({"revision":rendered.numeric[3],"cpu_revision":self.revision,"seed":rendered.geo[2].to_bits(),"cpu_seed":self.skin.geology.seed,"radius":rendered.planet[0],"measured":rendered.field[0]});
        for (slot, record) in instances.chunks_exact(112).enumerate() {
            let u = |i: usize| crate::audit::word(record, i * 4);
            let f = |i: usize| f32::from_bits(u(i));
            let current = if rendered.field[0] > 0.5 {
                (u(3) ^ revision) < 65536
            } else {
                u(3) == revision
            };
            if f(7) > 0.0 && current && u(23) == rendered.geo[2].to_bits() {
                let distance = (0..3)
                    .map(|j| (f64::from(f(4 + j)) + f64::from(f(8 + j)) - eye[j]).powi(2))
                    .sum::<f64>();
                nearest.push((distance, slot));
            }
        }
        nearest.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        let mut objects = Vec::new();
        for (_, slot) in nearest.into_iter().take(4096) {
            let record = &instances[slot * 112..(slot + 1) * 112];
            let u = |i: usize| crate::audit::word(record, i * 4);
            let f = |i: usize| f32::from_bits(u(i));
            objects.push(serde_json::json!({"slot":slot,"drawn":visible.contains(&slot),"key":[u(0),u(1),u(2),u(3)],"kind":f(7),"hi":[f(4),f(5),f(6)],"lo":[f(8),f(9),f(10)],"height":f(11),"shape":[f(12),f(13),f(14),f(15)],"support":[f(16),f(17),f(18),f(19)],"contact":[f(24),f(25),f(26),f(27)],"canonical":[u(20) as i32,u(21) as i32,u(22) as i32]}));
        }
        result["objects"] = objects.into();
        let contact = self.read_buffer(&self.scenery.contact_probe).await?;
        result["eye"] = serde_json::json!(eye);
        result["contact_reference"] = crate::scenery_reference::inspect_contact(
            &contact,
            &self.skin,
            eye,
            self.height,
            self.settings.surface_detail,
        );
        let vertices = self.read_buffer(&self.scenery.geometry).await?;
        let geometry = crate::scenery::inspect_geometry(&vertices, &self.tier, &result);
        result["geometry"] = geometry;
        // The largest drawn rocks (over a metre), for the footprint check.
        let mut rocks: Vec<(f32, u32)> = instances
            .chunks_exact(112)
            .enumerate()
            .filter(|(slot, r)| {
                visible.contains(slot)
                    && f32::from_bits(crate::audit::word(r, 28)) == 2.0
                    && f32::from_bits(crate::audit::word(r, 48)) > 1.0
            })
            .map(|(slot, r)| (f32::from_bits(crate::audit::word(r, 48)), slot as u32))
            .collect();
        rocks.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut slots = [u32::MAX; 16];
        for (i, (_, slot)) in rocks.iter().take(16).enumerate() {
            slots[i] = *slot;
        }
        self.gpu.queue.write_buffer(
            &self.scenery.footprint_slots,
            0,
            bytemuck::cast_slice(&slots),
        );
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        self.scenery.encode_footprint_audit(
            &self.gpu,
            &mut encoder,
            &self.projected,
            &self.terrain,
            &self.vertices,
            &self.indices,
        );
        self.gpu.queue.submit([encoder.finish()]);
        let probe = self.read_buffer(&self.scenery.footprint_probe).await?;
        result["footprint_reference"] =
            crate::scenery_reference::inspect_footprints(&probe, &vertices, &self.tier);
        // Ground cover: contact of sampled roots with the published triangles, and every instance's place (camera
        // relative, with the eye) so a test can classify them against an independent water map.
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        self.scenery.encode_cover_audit(
            &self.gpu,
            &mut encoder,
            &self.projected,
            &self.terrain,
            &self.vertices,
            &self.indices,
        );
        self.gpu.queue.submit([encoder.finish()]);
        let cover_probe = self.read_buffer(&self.scenery.cover_probe).await?;
        result["cover_contact"] = crate::scenery_reference::inspect_contact(
            &cover_probe,
            &self.skin,
            eye,
            self.height,
            self.settings.surface_detail && !self.pages.measured(),
        );
        let cover = self.read_buffer(&self.scenery.cover).await?;
        let bases = crate::scenery::COVER_BASES;
        let mut listed = Vec::new();
        for (k, base) in bases.iter().enumerate() {
            let count = result["cover"]["draws"][k].as_u64().unwrap_or(0) as usize;
            for i in 0..count.min(3000) {
                let at = (base + i) * 32;
                let f = |w: usize| f32::from_bits(crate::audit::word(&cover, at + w * 4));
                listed.push(serde_json::json!([k, f(0), f(1), f(2)]));
            }
        }
        result["cover_instances"] = listed.into();
        result["eye"] = serde_json::json!(eye);
        result["bytes"] = self.scenery.bytes().into();
        Ok(result)
    }
    pub async fn audit_water(&self) -> Result<serde_json::Value, String> {
        let parity = self.frame.numeric[1] as usize;
        let mut nonfinite = 0usize;
        let foam = self.read_buffer(&self.water_system.foam[parity]).await?;
        let mut foam_sum = 0.0f64;
        let mut foam_peak = 0.0f32;
        for cell in foam.chunks_exact(4) {
            let value = f32::from_le_bytes(cell.try_into().unwrap());
            nonfinite += usize::from(!value.is_finite());
            foam_sum += f64::from(value);
            foam_peak = foam_peak.max(value);
        }
        let meta = self.read_buffer(&self.water_system.state).await?;
        // WaterChart in water.wgsl: five vec4s per parity, the wave height under the eye in status.z.
        let offset = parity * 80 + 72;
        let wave_at_eye = f32::from_le_bytes(meta[offset..offset + 4].try_into().unwrap());
        // Wave cache levels in the layout of wave_offset in water.wgsl: eight
        // rows of each level spread across it (the fine level alone is 32 MB on
        // the full tier). A level the allocation leaves out reads as empty.
        let base = u64::from(self.tier.wave_base);
        let sizes = [base, base / 2, base / 4, base / 8, base];
        let unit = base * base / 64;
        let offsets = [0, 64, 80, 84, 85].map(|steps| unit * steps);
        let required = (offsets[4] + base * base) * 32;
        let fits = self.water_system.wave_cache.size() >= required;
        let mut levels = Vec::new();
        for (level, (&size, &start)) in sizes.iter().zip(&offsets).enumerate() {
            let mut slope = 0.0f64;
            let mut height = 0.0f64;
            let mut entries = 0usize;
            let mut populated = 0usize;
            let mut bad = 0usize;
            if fits {
                for row in (0..8).map(|k| k * size / 8) {
                    let bytes = self
                        .read_range(
                            &self.water_system.wave_cache,
                            (start + row * size) * 32,
                            size * 32,
                        )
                        .await?;
                    for jet in bytes.chunks_exact(32) {
                        let v: Vec<f32> = jet
                            .chunks_exact(4)
                            .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
                            .collect();
                        if v.iter().any(|x| !x.is_finite()) {
                            bad += 1;
                            continue;
                        }
                        let gradient = f64::from((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt());
                        slope += gradient;
                        height += f64::from(v[3].abs());
                        entries += 1;
                        populated += usize::from(gradient > 1e-6 || v[3].abs() > 1e-6);
                    }
                }
            }
            nonfinite += bad;
            levels.push(serde_json::json!({"level":level,"texels":size,"mean_slope":slope/entries.max(1) as f64,"mean_height_m":height/entries.max(1) as f64,"populated":populated as f64/entries.max(1) as f64,"nonfinite":bad}));
        }
        Ok(
            serde_json::json!({"nonfinite":nonfinite,"cells":262144,"foam_mean":foam_sum/262144.0,"foam_peak":foam_peak,"wave_at_eye_m":wave_at_eye,"controlled_bytes":self.water_system.bytes(),"wave_cache":{"bytes":self.water_system.wave_cache.size(),"required_bytes":required,"fits":fits,"levels":levels}}),
        )
    }
    pub async fn audit_progress(&self) -> Result<serde_json::Value, String> {
        let bytes = self.read_prefix(&self.terrain.state, 256).await?;
        let u = |i: usize| crate::audit::word(&bytes, i * 4);
        let f = |i: usize| f32::from_bits(u(i));
        Ok(
            serde_json::json!({"frame":u(23),"phase":u(1),"morph":f(2),"epochs":u(10),"patches":u(4),"displayed_patches":u(31),"level":u(16),"pending_samples":(u(8)-u(7))*289,"generated_samples":u(9)*289,"overflow":u(14),"camera_lift_m":f(24),"clock":f(28),"catchup_frames":u(61),"deferred_generations":u(63)}),
        )
    }
    /// Diagnostic cut trace only. Production never reads nodes to the CPU.
    pub async fn audit_lod(&self) -> Result<serde_json::Value, String> {
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        self.terrain
            .encode_audit(&self.gpu, &mut encoder, &self.projected, &self.vertices);
        self.gpu.queue.submit([encoder.finish()]);
        let probe_bytes = self.read_buffer(&self.terrain.probes).await?;
        let probes: Vec<Vec<f32>> = probe_bytes
            .chunks_exact(16)
            .map(|b| {
                (0..4)
                    .map(|i| f32::from_bits(crate::audit::word(b, i * 4)))
                    .collect()
            })
            .collect();
        let bytes = self
            .read_prefix(
                &self.terrain.state,
                (crate::audit::NODE_OFFSET + 4096 * crate::audit::NODE_STRIDE) as u64,
            )
            .await?;
        let mut nodes = Vec::new();
        for i in 0..4096 {
            let o = crate::audit::NODE_OFFSET + i * crate::audit::NODE_STRIDE;
            let u = |j| crate::audit::word(&bytes, o + j);
            if u(36) & 20 != 0 {
                nodes.push(serde_json::json!({"key":[u(0),u(4),u(8),u(12)],"flags":u(36),"score":f32::from_bits(u(48)),"error":f32::from_bits(u(64))}));
            }
        }
        Ok(serde_json::json!({"epoch":crate::audit::word(&bytes,40),"nodes":nodes,"probes":probes}))
    }
    pub async fn audit_geometry(&self) -> Result<serde_json::Value, String> {
        let state = self.read_buffer(&self.terrain.state).await?;
        let cache = self.read_buffer(&self.cache).await?;
        let indices = self.read_buffer(&self.indices).await?;
        let args = self.read_buffer(&self.terrain.indirect).await?;
        let mut report = crate::audit::inspect(self.surface(), &state, &cache, &indices, &args);
        let frame = self.read_buffer(&self.projected).await?;
        let value = |offset: usize| f64::from(f32::from_bits(crate::audit::word(&frame, offset)));
        report["eye"] = serde_json::json!((0..3)
            .map(|i| value(i * 4) + value(16 + i * 4) + value(272 + i * 4))
            .collect::<Vec<_>>());
        for (name, offset) in [("right", 32), ("up", 48), ("forward", 64)] {
            report[name] =
                serde_json::json!((0..3).map(|i| value(offset + i * 4)).collect::<Vec<_>>());
        }
        report["leaves"] = serde_json::json!(crate::audit::cut(&state)
            .leaves
            .iter()
            .map(|p| [u32::from(p.face), p.level, p.x, p.y])
            .collect::<Vec<_>>());
        Ok(report)
    }
}

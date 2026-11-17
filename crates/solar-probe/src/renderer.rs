//! Reusable compute renderer. JS owns input/DOM, Rust owns scene, GPU and resources.
use crate::gpu::Gpu;
use solar_core::{
    erosion::Basin,
    field::{self, V3},
    planet::{Geology, Proxy, BANDS, EARTH_RADIUS},
};
use wgpu::util::DeviceExt;

pub const SOURCE: &str = concat!(
    include_str!("../../../shaders/field.wgsl"),
    "\n",
    include_str!("../../../shaders/planet.wgsl"),
    "\n",
    include_str!("../../../shaders/normal.wgsl"),
    "\n",
    include_str!("../../../shaders/transport.wgsl"),
    "\n",
    include_str!("../../../shaders/media.wgsl"),
    "\n",
    include_str!("../../../shaders/cache.wgsl")
);
pub const AUDIT_SOURCE: &str = concat!(
    include_str!("../../../shaders/field.wgsl"),
    "\n",
    include_str!("../../../shaders/planet.wgsl"),
    "\n",
    include_str!("../../../shaders/normal.wgsl"),
    "\n",
    include_str!("../../../shaders/transport.wgsl"),
    "\n",
    include_str!("../../../shaders/media_audit.wgsl"),
    "\n",
    include_str!("../../../shaders/cache.wgsl")
);
const MAX_PIXELS: u64 = 1920 * 1080;
const BASIN_N: usize = 65;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub seed: u32,
    pub body: u32,
    /// Decimal strings preserve signed 64-bit sector identity through JavaScript.
    pub sector: [String; 3],
    pub radius: f64,
    pub relief: f64,
    pub roughness: f64,
    pub scene: u32,
    pub water: bool,
    pub sea_level: f64,
    pub clouds: f64,
    pub atmosphere: f64,
    pub separate_media: bool,
    pub instrumented: bool,
    /// Exact zero-support/work elimination; false retains the paired control.
    pub exact_work: bool,
    /// Experimental ray-local bounded coarse-spectrum reuse.
    pub prefix_cache: bool,
    /// Exact bounded cloud lattice memoization; solar-grid experiments bypass it.
    pub noise_cache: bool,
    /// 0 spatial, 1 native TAA, 2 experimental TMT-derived temporal resolve.
    pub temporal_mode: u32,
    pub temporal_debug: u32,
    pub region_cache: bool,
    pub solar_cache: bool,
    /// 0 finite differences, 1 analytic reference, 2 footprint/variance candidate.
    pub normal_filter: u32,
    /// Experimental full-resolution visibility with coarse water shading only.
    pub water_rate: u32,
    pub animate: bool,
    pub wind_speed: f64,
    pub shadows: bool,
    pub sun_azimuth: f64,
    pub sun_elevation: f64,
    pub sun_power: f64,
    pub exposure: f64,
    pub budget: u32,
    pub medium_steps: u32,
    pub tolerance: f64,
    pub pixel_error: f64,
    pub diagnostic: u32,
    pub method: u32,
    pub erosion_steps: u32,
    pub erosion_strength: f64,
    pub rain: f64,
    pub erodibility: f64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            seed: 2026,
            body: 0,
            sector: ["0".into(), "0".into(), "0".into()],
            radius: EARTH_RADIUS,
            relief: 1.0,
            roughness: 0.48,
            scene: 4,
            water: true,
            sea_level: 0.0,
            clouds: 0.65,
            atmosphere: 1.0,
            separate_media: false,
            instrumented: false,
            exact_work: true,
            prefix_cache: false,
            noise_cache: true,
            temporal_mode: 0,
            temporal_debug: 0,
            region_cache: false,
            solar_cache: false,
            normal_filter: 0,
            water_rate: 1,
            animate: true,
            wind_speed: 12.0,
            shadows: false,
            sun_azimuth: 0.7,
            sun_elevation: 0.6,
            sun_power: 6.0,
            exposure: 1.0,
            budget: 2048,
            medium_steps: 64,
            tolerance: 0.002,
            pixel_error: 0.5,
            diagnostic: 0,
            method: 2,
            erosion_steps: 0,
            erosion_strength: 1.0,
            rain: 0.04,
            erodibility: 0.2,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if self.sector.iter().any(|v| v.parse::<i64>().is_err()) {
            return Err("Sector coordinates must be signed 64-bit decimal strings".into());
        }
        let numbers = [
            self.radius,
            self.relief,
            self.roughness,
            self.sea_level,
            self.clouds,
            self.atmosphere,
            self.sun_azimuth,
            self.sun_elevation,
            self.sun_power,
            self.exposure,
            self.tolerance,
            self.pixel_error,
            self.erosion_strength,
            self.rain,
            self.erodibility,
            self.wind_speed,
        ];
        if !numbers.iter().all(|x| x.is_finite())
            || !(1000.0..=1e8).contains(&self.radius)
            || !(0.0..=3.0).contains(&self.relief)
            || !(0.2..=0.65).contains(&self.roughness)
            || self.scene > 6
            || self.budget < 8
            || self.budget > 8192
            || self.medium_steps < 4
            || self.medium_steps > 128
            || !(0.0002..=10.0).contains(&self.tolerance)
            || !(0.1..=4.0).contains(&self.pixel_error)
            || self.diagnostic > 9
            || self.method > 2
            || self.temporal_mode > 2
            || self.temporal_debug > 6
            || self.normal_filter > 2
            || !matches!(self.water_rate, 1 | 2 | 4)
            || (self.water_rate > 1 && self.temporal_mode > 0)
            || self.erosion_steps > 1024
            || !(0.0..=1.0).contains(&self.rain)
            || !(0.0..=1.0).contains(&self.erodibility)
            || !(0.0..=4.0).contains(&self.erosion_strength)
            || !(0.0..=2.0).contains(&self.clouds)
            || !(0.0..=3.0).contains(&self.atmosphere)
            || !(-20000.0..=20000.0).contains(&self.sea_level)
            || !(0.0..=30.0).contains(&self.sun_power)
            || !(0.1..=5.0).contains(&self.exposure)
            || !(0.0..=100.0).contains(&self.wind_speed)
        {
            return Err("Settings are outside the documented finite budgets/ranges".into());
        }
        Ok(())
    }
    pub fn geology(&self) -> Geology {
        Geology {
            seed: if self.body == 0 && self.sector.iter().all(|v| v == "0") {
                self.seed
            } else {
                solar_core::planet::BodyAddress {
                    sector: self.sector.each_ref().map(|v| v.parse().unwrap_or(0)),
                    body: u64::from(self.body),
                }
                .seed(self.seed)
            },
            relief: self.relief,
            roughness: self.roughness,
        }
    }
    pub fn feature(&self) -> V3 {
        let geology = self.geology();
        let mut lo = -geology.tail(0) - 1.0;
        let mut hi = geology.tail(0) + 1.0;
        for _ in 0..40 {
            let h = (lo + hi) * 0.5;
            let f = h - geology.height([0.0, self.radius + h, 0.0]);
            if f > 0.0 {
                hi = h;
            } else {
                lo = h;
            }
        }
        let h = (lo + hi) * 0.5;
        [0.0, self.radius + h, 0.0]
    }
    pub fn bookmark(&self, name: &str) -> (V3, V3) {
        if self.scene != 4 {
            return match name {
                "inside" => ([0.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
                "shore" => ([4.0, -0.42, 6.0], [0.0, 0.0, 0.0]),
                "underwater" => ([4.0, -0.65, 6.0], [0.0, 0.0, 0.0]),
                _ => ([6.0, 3.0, 8.0], [0.0, 0.0, 0.0]),
            };
        }
        let a = self.feature();
        match name {
            "ground" => (
                field::add(a, [260.0, 120.0, 380.0]),
                field::add(a, [0.0, 25.0, 50.0]),
            ),
            "cave" => (
                field::add(a, [0.0, -12.0, 100.0]),
                field::add(a, [0.0, -12.0, -170.0]),
            ),
            "shore" => (
                [75.0, self.radius + self.sea_level + 1.0, 200.0],
                field::add(a, [0.0, -8.0, 0.0]),
            ),
            "underwater" => (
                [25.0, self.radius + self.sea_level - 1.0, 240.0],
                field::add(a, [0.0, -4.0, 0.0]),
            ),
            "horizon" => (
                [
                    a[0],
                    (a[1] + 500.0).max(self.radius + self.sea_level + 500.0),
                    a[2] + 1000.0,
                ],
                field::add(a, [200000.0, -1500.0, -100000.0]),
            ),
            "antipode" => ([0.0, -self.radius * 1.3, 0.0], [0.0, 0.0, 0.0]),
            "clouds" => (
                [0.0, self.radius + 7800.0, -10000.0],
                [0.0, self.radius + 5700.0, -40000.0],
            ),
            _ => (
                [self.radius * 0.18, self.radius * 1.60, self.radius * 1.80],
                [0.0, 0.0, 0.0],
            ),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Frame {
    camera_hi: [f32; 4],
    camera_lo: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    forward: [f32; 4],
    radial: [f32; 4],
    sun: [f32; 4],
    geology: [f32; 4],
    media: [f32; 4],
    quality: [f32; 4],
    options: [u32; 4],
    size: [u32; 4],
    anchor: [f32; 4],
    base: [f32; 4],
    registry: [u32; 4],
    extra: [f32; 4],
    coarse: [f32; 4],
    coarse_meta: [f32; 4],
    animation: [f32; 4],
    waves: [f32; 4],
    previous_right: [f32; 4],
    previous_up: [f32; 4],
    previous_forward: [f32; 4],
    previous_offset: [f32; 4],
    sampling: [f32; 4],
    history: [f32; 4],
    reference_region: [u32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuProxy {
    cell: [i32; 4],
    phase: [f32; 4],
    c0: [f32; 4],
    c1: [f32; 4],
    config: [f32; 4],
}
fn vec4(v: V3, w: f64) -> [f32; 4] {
    [v[0] as f32, v[1] as f32, v[2] as f32, w as f32]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[derive(serde::Serialize)]
pub struct FrameReport {
    pub active_reference_region: [u32; 4],
    pub animation_time_seconds: f64,
    pub backend: String,
    pub adapter: String,
    pub width: u32,
    pub height: u32,
    pub internal_resolution: [u32; 2],
    pub gpu_pass_ms: Option<[f64; 3]>,
    pub gpu_total_ms: Option<f64>,
    pub submission_readback_ms: f64,
    pub hits: u32,
    pub misses: u32,
    pub unresolved: u32,
    pub bound_queries: u64,
    pub band_queries: u64,
    pub stack_high_water: u32,
    pub secondary_unresolved: u32,
    pub secondary_rays: u32,
    pub secondary_bounds: u64,
    pub secondary_bands: u64,
    pub budget_unresolved: u32,
    pub uncertainty_unresolved: u32,
    pub shading_calls: [u64; 8],
    pub resident_controlled_bytes: u64,
    pub proxy_build_ms: f64,
    pub erosion_build_ms: f64,
    pub erosion_ledger_error: f64,
    pub image_hash: u32,
}

pub struct Renderer {
    pub gpu: Gpu,
    pub settings: Settings,
    pub width: u32,
    pub height: u32,
    uniform: wgpu::Buffer,
    proxies: wgpu::Buffer,
    hit_buffer: wgpu::Buffer,
    pub image: wgpu::Texture,
    pub hdr: wgpu::Texture,
    pub reconstruction: crate::reconstruction::Reconstruction,
    erosion_buffer: wgpu::Buffer,
    materials: wgpu::Buffer,
    stats: wgpu::Buffer,
    stats_read: wgpu::Buffer,
    layout: wgpu::BindGroupLayout,
    bindings: wgpu::BindGroup,
    bindings_other: Option<wgpu::BindGroup>,
    previous: Option<(V3, Frame, f64)>,
    prepared: Option<(V3, Frame)>,
    phase: u32,
    pub reference_jitter: [f32; 2],
    pub reference_filter_scale: f32,
    pub reference_region: [u32; 4],
    region_cache: wgpu::Buffer,
    cache_pipeline: wgpu::ComputePipeline,
    cache_dirty: bool,
    solar_cache: wgpu::Buffer,
    solar_pipeline: wgpu::ComputePipeline,
    noise_pipeline: wgpu::ComputePipeline,
    workgroup: [u32; 2],
    pipeline_key: [u32; 10],
    group_variants: Vec<([u32; 10], [wgpu::ComputePipeline; 5], bool)>,
    visibility: wgpu::ComputePipeline,
    shade: wgpu::ComputePipeline,
    shade_separate: wgpu::ComputePipeline,
    production_visibility: wgpu::ComputePipeline,
    production_shade: wgpu::ComputePipeline,
    diagnostics_ready: bool,
    camera_cache: Option<(V3, V3, Frame)>,
    pub proxy_cache_hits: u64,
    pub proxy_cache_misses: u64,
    timestamps: Option<wgpu::QuerySet>,
    timing_resolve: wgpu::Buffer,
    timing_read: wgpu::Buffer,
    image_read: wgpu::Buffer,
    pub basin: Basin,
    erosion_build_ms: f64,
    proxy_build_ms: f64,
    erosion_bounds: [f32; 2],
    feature: V3,
    pub time_seconds: f64,
}
impl Renderer {
    pub async fn new(width: u32, height: u32, settings: Settings) -> Result<Self, String> {
        settings.validate()?;
        Self::check_size(width, height)?;
        let g = Gpu::new().await?;
        let uniform = g.buffer(
            "frame uniform",
            std::mem::size_of::<Frame>() as u64,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let proxies = g.buffer(
            "canonical local polynomial proxies",
            BANDS as u64 * 80,
            wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::UNIFORM
                | wgpu::BufferUsages::COPY_DST,
        );
        let hit_buffer = g.buffer(
            "bounded visible ray records",
            u64::from(width) * u64::from(height) * 32,
            wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
        );
        let image = Self::texture(&g, width, height);
        let hdr = crate::reconstruction::texture(
            &g,
            "unexposed linear HDR",
            width,
            height,
            wgpu::TextureFormat::Rgba16Float,
        );
        let reconstruction = crate::reconstruction::Reconstruction::new(&g, &hdr, &image);
        let region_cache = g.buffer(
            "bounded regional certificates",
            32 * 32 * 32 * 8,
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        );
        let solar_cache = g.buffer("unused solar cache", 16, wgpu::BufferUsages::STORAGE);
        let image_read = g.buffer(
            "explicit capture readback",
            u64::from((width * 4).div_ceil(256) * 256) * u64::from(height),
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let erosion_buffer = g.buffer(
            "durable basin delta",
            (BASIN_N * BASIN_N * 4) as u64,
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        );
        let material_rows: Vec<[f32; 4]> =
            serde_json::from_str(include_str!("../../../web/materials.json"))
                .map_err(|e| e.to_string())?;
        let materials = g
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("resident physical material classes"),
                contents: bytemuck::cast_slice(&material_rows),
                usage: wgpu::BufferUsages::STORAGE,
            });
        let stats = g.buffer(
            "diagnostic reductions",
            128,
            wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
        );
        let stats_read = g.buffer(
            "diagnostic readback",
            128,
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let buffer_entry = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("shared fields"),
                entries: &[
                    buffer_entry(0, wgpu::BufferBindingType::Uniform),
                    buffer_entry(1, wgpu::BufferBindingType::Storage { read_only: true }),
                    buffer_entry(2, wgpu::BufferBindingType::Storage { read_only: false }),
                    wgpu::BindGroupLayoutEntry {
                        binding: 3,
                        visibility: wgpu::ShaderStages::COMPUTE,
                        ty: wgpu::BindingType::StorageTexture {
                            access: wgpu::StorageTextureAccess::WriteOnly,
                            format: wgpu::TextureFormat::Rgba16Float,
                            view_dimension: wgpu::TextureViewDimension::D2,
                        },
                        count: None,
                    },
                    buffer_entry(4, wgpu::BufferBindingType::Storage { read_only: true }),
                    buffer_entry(5, wgpu::BufferBindingType::Storage { read_only: false }),
                    buffer_entry(6, wgpu::BufferBindingType::Storage { read_only: true }),
                    buffer_entry(7, wgpu::BufferBindingType::Storage { read_only: false }),
                    buffer_entry(8, wgpu::BufferBindingType::Storage { read_only: false }),
                    buffer_entry(9, wgpu::BufferBindingType::Storage { read_only: false }),
                    buffer_entry(10, wgpu::BufferBindingType::Uniform),
                ],
            });
        let bindings = Self::bindings(
            &g,
            &layout,
            [
                &uniform,
                &proxies,
                &hit_buffer,
                &erosion_buffer,
                &stats,
                &materials,
                reconstruction.guide(0),
                &region_cache,
                &solar_cache,
            ],
            &hdr,
        );
        let pl = g
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("field passes"),
                bind_group_layouts: &[Some(&layout)],
                immediate_size: 0,
            });
        let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("planet + interface + media fields"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline = |entry: &str, diagnostics: bool| {
            let image_pass = entry == "visibility_image" || entry == "shade_image";
            g.device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(entry),
                    layout: Some(&pl),
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: wgpu::PipelineCompilationOptions {
                        constants: &[
                            ("DIAGNOSTICS", f64::from(diagnostics)),
                            (
                                "PLANET_ONLY",
                                f64::from(image_pass && settings.exact_work && settings.scene == 4),
                            ),
                            (
                                "NORMAL_FILTER",
                                if image_pass {
                                    f64::from(settings.normal_filter)
                                } else {
                                    0.0
                                },
                            ),
                            ("SOLAR_CACHE", f64::from(image_pass && settings.solar_cache)),
                            (
                                "WATER_RATE",
                                if image_pass {
                                    f64::from(settings.water_rate)
                                } else {
                                    1.0
                                },
                            ),
                            ("EXACT_WORK", f64::from(!image_pass || settings.exact_work)),
                            (
                                "PREFIX_CACHE",
                                f64::from(image_pass && settings.prefix_cache),
                            ),
                            (
                                "NOISE_CACHE",
                                f64::from(
                                    image_pass && settings.noise_cache && !settings.solar_cache,
                                ),
                            ),
                        ],
                        ..Default::default()
                    },
                    cache: None,
                })
        };
        let production_visibility = pipeline("visibility_image", false);
        let production_shade = pipeline("shade_image", false);
        // Default exploration needs no counter atomics. Prepare the default
        // diagnostic pair on measurement, instrumentation or variant selection.
        let visibility = production_visibility.clone();
        let shade = production_shade.clone();
        // The independent-media audit has large private arrays. Compile it only
        // when explicitly selected; the separate_media pipeline key does that.
        let shade_separate = shade.clone();
        let cache_pipeline = pipeline("build_region_cache", false);
        let solar_pipeline = pipeline("build_solar_cache", false);
        let noise_pipeline = pipeline("build_noise_cache", false);
        let timestamps = g.timestamps.then(|| {
            g.device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("geometry and transport GPU timings"),
                ty: wgpu::QueryType::Timestamp,
                count: 6,
            })
        });
        let timing_resolve = g.buffer(
            "GPU timing resolve",
            48,
            wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
        );
        let timing_read = g.buffer(
            "GPU timing readback",
            48,
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let basin = Basin::new(BASIN_N, 8.0, vec![0.0; BASIN_N * BASIN_N]);
        let mut renderer = Self {
            gpu: g,
            settings: Settings::default(),
            width,
            height,
            uniform,
            proxies,
            hit_buffer,
            image,
            hdr,
            reconstruction,
            erosion_buffer,
            materials,
            stats,
            stats_read,
            layout,
            bindings,
            bindings_other: None,
            previous: None,
            prepared: None,
            phase: 0,
            reference_jitter: [0.0; 2],
            reference_filter_scale: 1.0,
            reference_region: [0; 4],
            region_cache,
            cache_pipeline,
            cache_dirty: true,
            solar_cache,
            solar_pipeline,
            noise_pipeline,
            workgroup: [8, 8],
            group_variants: Vec::new(),
            pipeline_key: [
                8,
                8,
                settings.normal_filter,
                u32::from(settings.solar_cache),
                0,
                settings.water_rate,
                u32::from(settings.exact_work),
                u32::from(settings.prefix_cache),
                u32::from(settings.noise_cache && !settings.solar_cache),
                u32::from(settings.exact_work && settings.scene == 4),
            ],
            visibility,
            shade,
            shade_separate,
            production_visibility,
            production_shade,
            diagnostics_ready: false,
            camera_cache: None,
            proxy_cache_hits: 0,
            proxy_cache_misses: 0,
            timestamps,
            timing_resolve,
            timing_read,
            image_read,
            basin,
            erosion_build_ms: -1.0,
            proxy_build_ms: 0.0,
            erosion_bounds: [0.0; 2],
            feature: [0.0; 3],
            time_seconds: 0.0,
        };
        renderer.configure(settings)?;
        Ok(renderer)
    }
    fn check_size(w: u32, h: u32) -> Result<(), String> {
        if w == 0 || h == 0 || u64::from(w) * u64::from(h) > MAX_PIXELS {
            Err("Render extent must be nonzero and at most 2,073,600 pixels (explicit resource cap)".into())
        } else {
            Ok(())
        }
    }
    fn texture(g: &Gpu, w: u32, h: u32) -> wgpu::Texture {
        g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("tone mapped gamma encoded display output"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
    }
    fn bindings(
        g: &Gpu,
        layout: &wgpu::BindGroupLayout,
        b: [&wgpu::Buffer; 9],
        image: &wgpu::Texture,
    ) -> wgpu::BindGroup {
        let view = image.create_view(&Default::default());
        g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("frame working set"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: b[0].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: b[1].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: b[2].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: b[3].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: b[4].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: b[5].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: b[6].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 8,
                    resource: b[7].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 9,
                    resource: b[8].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 10,
                    resource: b[1].as_entire_binding(),
                },
            ],
        })
    }
    pub fn configure(&mut self, s: Settings) -> Result<(), String> {
        s.validate()?;
        self.check_working_set(
            self.width,
            self.height,
            self.image.width(),
            self.image.height(),
            &s,
        )?;
        self.camera_cache = None;
        self.cache_dirty = true;
        self.reset_history();
        let start = crate::now_ms();
        let old = &self.settings;
        let rebuild = self.erosion_build_ms < 0.0
            || old.seed != s.seed
            || old.body != s.body
            || old.sector != s.sector
            || old.radius != s.radius
            || old.relief != s.relief
            || old.roughness != s.roughness
            || old.rain != s.rain
            || old.erodibility != s.erodibility
            || self.basin.steps > s.erosion_steps;
        let g = s.geology();
        let radius = s.radius;
        if rebuild {
            let heights = (0..BASIN_N * BASIN_N)
                .map(|i| {
                    let x = (i % BASIN_N) as f64 * 8.0 - 256.0;
                    let z = (i / BASIN_N) as f64 * 8.0 - 256.0;
                    g.height([x, radius, z]) - (x * x + z * z) / (2.0 * radius)
                })
                .collect();
            self.basin = Basin::new(BASIN_N, 8.0, heights);
            self.feature = s.feature();
        }
        for _ in self.basin.steps..s.erosion_steps {
            self.basin.step(s.rain, s.erodibility);
        }
        let delta = self.basin.delta();
        let max_delta = delta.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        let mut slope = 0.0_f32;
        for i in 0..delta.len() {
            if i % BASIN_N + 1 < BASIN_N {
                slope = slope.max((delta[i + 1] - delta[i]).abs() / 8.0);
            }
            if i + BASIN_N < delta.len() {
                slope = slope.max((delta[i + BASIN_N] - delta[i]).abs() / 8.0);
            }
        }
        self.erosion_bounds = [max_delta, slope * 2.0];
        self.gpu
            .queue
            .write_buffer(&self.erosion_buffer, 0, bytemuck::cast_slice(&delta));
        self.erosion_build_ms = crate::now_ms() - start;
        self.settings = s;
        let group_mode = match self.workgroup {
            [4, 8] => 1,
            [16, 4] => 2,
            _ => 0,
        };
        self.set_workgroup(group_mode)?;
        if self.settings.instrumented {
            self.ensure_diagnostics();
        }
        let solar_size = if self.settings.solar_cache {
            64 * 32 * 64 * 16
        } else if self.settings.noise_cache {
            64 * 64 * 64 * 8 * 4
        } else {
            16
        };
        if self.solar_cache.size() != solar_size {
            self.solar_cache = self.gpu.buffer(
                "bounded current-epoch solar cache",
                solar_size,
                wgpu::BufferUsages::STORAGE,
            );
        }
        self.configure_temporal();
        Ok(())
    }
    pub fn reset_history(&mut self) {
        self.previous = None;
        self.prepared = None;
        self.phase = 0;
    }
    fn ensure_diagnostics(&mut self) {
        // Each cached variant owns its readiness bit. Placeholder handles are
        // replaced before any measured or instrumented submission.
        if self.diagnostics_ready {
            return;
        }
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("on-demand default counters"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = |entry| {
            self.gpu
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(entry),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: wgpu::PipelineCompilationOptions {
                        constants: &[
                            ("DIAGNOSTICS", 1.0),
                            ("GROUP_X", f64::from(self.pipeline_key[0])),
                            ("GROUP_Y", f64::from(self.pipeline_key[1])),
                            ("NORMAL_FILTER", f64::from(self.pipeline_key[2])),
                            ("SOLAR_CACHE", f64::from(self.pipeline_key[3])),
                            ("WATER_RATE", f64::from(self.pipeline_key[5])),
                            ("EXACT_WORK", f64::from(self.pipeline_key[6])),
                            ("PREFIX_CACHE", f64::from(self.pipeline_key[7])),
                            ("NOISE_CACHE", f64::from(self.pipeline_key[8])),
                            ("PLANET_ONLY", f64::from(self.pipeline_key[9])),
                        ],
                        ..Default::default()
                    },
                    cache: None,
                })
        };
        self.visibility = pipeline("visibility_image");
        self.shade = pipeline("shade_image");
        self.diagnostics_ready = true;
    }
    pub fn set_workgroup(&mut self, mode: u32) -> Result<(), String> {
        let group = match mode {
            0 => [8, 8],
            1 => [4, 8],
            2 => [16, 4],
            _ => return Err("Workgroup mode must be 0, 1 or 2".into()),
        };
        let key = [
            group[0],
            group[1],
            self.settings.normal_filter,
            u32::from(self.settings.solar_cache),
            u32::from(self.settings.separate_media),
            self.settings.water_rate,
            u32::from(self.settings.exact_work),
            u32::from(self.settings.prefix_cache),
            u32::from(self.settings.noise_cache && !self.settings.solar_cache),
            u32::from(self.settings.exact_work && self.settings.scene == 4),
        ];
        if key == self.pipeline_key {
            return Ok(());
        }
        // Preserve whether the cached diagnostic handles are prepared. Variant
        // selection alone must not compile counter-enabled pipelines.
        self.group_variants.push((
            self.pipeline_key,
            [
                self.visibility.clone(),
                self.shade.clone(),
                self.shade_separate.clone(),
                self.production_visibility.clone(),
                self.production_shade.clone(),
            ],
            self.diagnostics_ready,
        ));
        let (pipelines, diagnostics_ready) = if let Some(i) =
            self.group_variants.iter().position(|(g, _, _)| *g == key)
        {
            let (_, pipelines, ready) = self.group_variants.swap_remove(i);
            (pipelines, ready)
        } else {
            let module = self
                .gpu
                .device
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("workgroup experiment"),
                    source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
                });
            let audit_module = self.settings.separate_media.then(|| {
                self.gpu
                    .device
                    .create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: Some("independent-media audit only"),
                        source: wgpu::ShaderSource::Wgsl(AUDIT_SOURCE.into()),
                    })
            });
            let layout = self
                .gpu
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &[Some(&self.layout)],
                    immediate_size: 0,
                });
            (
                std::array::from_fn(|i| {
                    if i < 2 {
                        // Replaced by ensure_diagnostics before any measured or
                        // instrumented submission; no eager audit compilation.
                        return self.production_visibility.clone();
                    }
                    if group == self.workgroup
                        && self.pipeline_key[6..8] == key[6..8]
                        && self.pipeline_key[9] == key[9]
                        && i == 3
                    {
                        return self.production_visibility.clone();
                    }
                    if i == 2 && !self.settings.separate_media {
                        return self.shade_separate.clone();
                    }
                    self.gpu
                        .device
                        .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                            label: Some("workgroup variant"),
                            layout: Some(&layout),
                            module: if i == 2 {
                                audit_module.as_ref().expect("separate audit selected")
                            } else {
                                &module
                            },
                            entry_point: Some(
                                [
                                    "visibility_image",
                                    "shade_image",
                                    "shade_separate",
                                    "visibility_image",
                                    "shade_image",
                                ][i],
                            ),
                            compilation_options: wgpu::PipelineCompilationOptions {
                                constants: &[
                                    ("DIAGNOSTICS", f64::from(i < 3)),
                                    ("GROUP_X", f64::from(group[0])),
                                    ("GROUP_Y", f64::from(group[1])),
                                    ("NORMAL_FILTER", f64::from(self.settings.normal_filter)),
                                    ("SOLAR_CACHE", f64::from(self.settings.solar_cache)),
                                    (
                                        "PLANET_ONLY",
                                        f64::from(
                                            self.settings.exact_work && self.settings.scene == 4,
                                        ),
                                    ),
                                    ("WATER_RATE", f64::from(self.settings.water_rate)),
                                    ("EXACT_WORK", f64::from(self.settings.exact_work)),
                                    ("PREFIX_CACHE", f64::from(self.settings.prefix_cache)),
                                    (
                                        "NOISE_CACHE",
                                        f64::from(
                                            self.settings.noise_cache && !self.settings.solar_cache,
                                        ),
                                    ),
                                ],
                                ..Default::default()
                            },
                            cache: None,
                        })
                }),
                false,
            )
        };
        let [visibility, shade, separate, prod_visibility, prod_shade] = pipelines;
        self.visibility = visibility;
        self.shade = shade;
        self.shade_separate = separate;
        self.production_visibility = prod_visibility;
        self.production_shade = prod_shade;
        self.workgroup = group;
        self.pipeline_key = key;
        self.diagnostics_ready = diagnostics_ready;
        // Bounded experiment cache; pipeline/driver allocations are reported
        // separately from the controlled buffer/texture byte ledger.
        if self.group_variants.len() > 6 {
            self.group_variants.remove(0);
        }
        Ok(())
    }
    fn configure_temporal(&mut self) {
        let wanted = self.settings.temporal_mode > 0 && self.settings.diagnostic == 0;
        if wanted != self.reconstruction.temporal.is_some() {
            self.reconstruction.temporal = if wanted {
                let resolve = crate::temporal_resolve::TemporalResolve::new(
                    &self.gpu,
                    &self.hdr,
                    &self.image,
                    self.reconstruction.temporal_pipeline.clone(),
                );
                self.reconstruction.temporal_pipeline = Some(resolve.pipelines.clone());
                Some(resolve)
            } else {
                None
            };
        }
        self.rebuild_bindings();
    }
    fn rebuild_bindings(&mut self) {
        let make = |index| {
            Self::bindings(
                &self.gpu,
                &self.layout,
                [
                    &self.uniform,
                    &self.proxies,
                    &self.hit_buffer,
                    &self.erosion_buffer,
                    &self.stats,
                    &self.materials,
                    self.reconstruction.guide(index),
                    &self.region_cache,
                    &self.solar_cache,
                ],
                &self.hdr,
            )
        };
        self.bindings = make(0);
        self.bindings_other = self.reconstruction.temporal.as_ref().map(|_| make(1));
    }
    pub fn erosion_state(&self) -> String {
        serde_json::to_string(&crate::erosion_io::Snapshot::capture(
            &self.settings,
            &self.basin,
        ))
        .unwrap()
    }
    pub fn import_erosion(&mut self, json: &str) -> Result<(), String> {
        if json.len() > 4_000_000 {
            return Err("Basin file exceeds the 4 MB limit".into());
        }
        let snapshot: crate::erosion_io::Snapshot =
            serde_json::from_str(json).map_err(|e| e.to_string())?;
        let (s, b) = snapshot.restore()?;
        self.feature = s.feature();
        self.settings = s.clone();
        self.basin = b;
        self.erosion_build_ms = 0.0;
        self.configure(s)
    }
    pub fn resize(&mut self, w: u32, h: u32) -> Result<(), String> {
        self.resize_output(w, h, w, h)
    }
    pub fn resize_output(
        &mut self,
        w: u32,
        h: u32,
        output_w: u32,
        output_h: u32,
    ) -> Result<(), String> {
        Self::check_size(w, h)?;
        Self::check_size(output_w, output_h)?;
        self.check_working_set(w, h, output_w, output_h, &self.settings)?;
        if w == self.width
            && h == self.height
            && self.image.width() == output_w
            && self.image.height() == output_h
        {
            return Ok(());
        }
        self.hit_buffer = self.gpu.buffer(
            "visible ray records",
            u64::from(w) * u64::from(h) * 32,
            wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
        );
        self.image = Self::texture(&self.gpu, output_w, output_h);
        self.hdr = crate::reconstruction::texture(
            &self.gpu,
            "unexposed linear HDR",
            w,
            h,
            wgpu::TextureFormat::Rgba16Float,
        );
        self.reconstruction = self
            .reconstruction
            .resized(&self.gpu, &self.hdr, &self.image);
        self.image_read = self.gpu.buffer(
            "capture readback",
            u64::from((output_w * 4).div_ceil(256) * 256) * u64::from(output_h),
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        self.bindings = Self::bindings(
            &self.gpu,
            &self.layout,
            [
                &self.uniform,
                &self.proxies,
                &self.hit_buffer,
                &self.erosion_buffer,
                &self.stats,
                &self.materials,
                self.reconstruction.guide(0),
                &self.region_cache,
                &self.solar_cache,
            ],
            &self.hdr,
        );
        self.width = w;
        self.height = h;
        self.reference_region = [0; 4];
        self.camera_cache = None;
        self.reset_history();
        self.configure_temporal();
        Ok(())
    }
    pub fn update_camera(&mut self, eye: V3, target: V3) -> Result<(), String> {
        if !eye
            .iter()
            .chain(target.iter())
            .all(|x| x.is_finite() && x.abs() < 2.5e8)
            || field::length(field::sub(target, eye)) < 1e-8
        {
            return Err(
                "Camera is non-finite, outside its body frame, or has zero view direction".into(),
            );
        }
        let start = crate::now_ms();
        self.reconstruction.update(
            &self.gpu,
            self.width,
            self.height,
            self.settings.exposure as f32,
            self.settings.diagnostic != 0,
        );
        if let Some((previous_eye, previous_target, mut frame)) = self.camera_cache {
            if previous_eye == eye && previous_target == target {
                Self::animate_frame(&mut frame, eye, self.time_seconds);
                self.prepare_history(&mut frame, eye);
                self.gpu
                    .queue
                    .write_buffer(&self.uniform, 0, bytemuck::bytes_of(&frame));
                self.proxy_cache_hits += 1;
                self.proxy_build_ms = crate::now_ms() - start;
                return Ok(());
            }
        }
        self.proxy_cache_misses += 1;
        self.cache_dirty = true;
        let s = &self.settings;
        let g = s.geology();
        let length = field::length(eye).max(1.0);
        let unit = field::mul(eye, 1.0 / length);
        let altitude = length - s.radius;
        let mut proxy_rows = [GpuProxy::zeroed(); BANDS];
        let mut prefix = 0.0;
        let mut coarse_gradient = [0.0; 3];
        let mut hessian = 0.0;
        let mut validity = 4096.0_f64;
        for (k, row) in proxy_rows.iter_mut().enumerate() {
            let p = Proxy::new(g, eye, k);
            if k < 8 {
                let sign = if p.mode == 1 { -p.value.signum() } else { 1.0 };
                coarse_gradient = field::add(
                    coarse_gradient,
                    field::mul(p.gradient(), p.amplitude * sign),
                );
                hessian += 30.0 * p.amplitude / (p.scale * p.scale);
                if p.mode == 1 {
                    validity =
                        validity.min(p.value.abs() * p.scale / (3.0 * 3.0_f64.sqrt()) * 0.99);
                }
            }
            prefix += p.amplitude
                * if p.mode == 1 {
                    0.55 - p.value.abs()
                } else {
                    p.value
                };
            *row = GpuProxy {
                cell: [p.cell[0], p.cell[1], p.cell[2], p.mode as i32],
                phase: vec4(p.phase, 1.0 / p.scale),
                c0: p.corners[..4]
                    .try_into()
                    .unwrap_or([0.0; 4])
                    .map(|v| v as f32),
                c1: p.corners[4..]
                    .try_into()
                    .unwrap_or([0.0; 4])
                    .map(|v| v as f32),
                config: [
                    p.amplitude as f32,
                    p.value as f32,
                    (altitude - prefix) as f32,
                    g.tail(k + 1) as f32,
                ],
            };
        }
        let forward = field::normalized(field::sub(target, eye));
        let mut up = if s.scene == 4 { unit } else { [0.0, 1.0, 0.0] };
        if field::length(cross(forward, up)) < 0.01 {
            up = [0.0, 0.0, 1.0];
        }
        let right = field::normalized(cross(forward, up));
        let up = field::normalized(cross(right, forward));
        let hi = eye.map(|x| (x / 4096.0).floor() * 4096.0);
        let lo = field::sub(eye, hi);
        let sun = [
            s.sun_azimuth.cos() * s.sun_elevation.cos(),
            s.sun_elevation.sin(),
            s.sun_azimuth.sin() * s.sun_elevation.cos(),
        ];
        let mut frame = Frame {
            camera_hi: vec4(hi, s.radius),
            camera_lo: vec4(lo, length),
            right: vec4(right, (55.0_f64.to_radians() * 0.5).tan()),
            up: vec4(up, f64::from(self.width) / f64::from(self.height)),
            forward: vec4(forward, 0.0),
            radial: vec4(unit, altitude),
            sun: vec4(sun, s.sun_power),
            geology: [
                s.relief as f32,
                s.roughness as f32,
                s.erosion_strength as f32,
                s.sea_level as f32,
            ],
            media: [
                s.clouds as f32,
                s.atmosphere as f32,
                f32::from(s.water),
                f32::from(s.shadows),
            ],
            quality: [
                s.tolerance as f32,
                s.pixel_error as f32,
                if s.scene == 4 {
                    (s.radius * 6.0) as f32
                } else {
                    24.0
                },
                s.exposure as f32,
            ],
            options: [s.scene, s.diagnostic, s.method, g.seed],
            size: [self.width, self.height, s.budget, s.medium_steps],
            anchor: vec4(field::sub(self.feature, eye), self.feature[1] - s.radius),
            base: [
                (altitude - prefix) as f32,
                g.lipschitz() as f32,
                g.tail(0) as f32,
                0.0,
            ],
            registry: [
                4096,
                BASIN_N as u32,
                12, // Fixed cloud-layer solar quadrature, never a quality knob.
                6,  // Fixed outside-layer solar quadrature.
            ],
            extra: [
                512.0,
                self.erosion_bounds[0],
                self.erosion_bounds[1],
                (altitude - s.sea_level) as f32,
            ],
            coarse: vec4(coarse_gradient, hessian),
            coarse_meta: [
                validity as f32,
                1e-7,
                if s.region_cache && s.scene == 4 {
                    32.0
                } else {
                    0.0
                },
                0.0,
            ],
            animation: [self.time_seconds as f32, s.wind_speed as f32, 0.0, 0.0],
            waves: std::array::from_fn(|k| {
                let wavelength = [8.0, 3.0, 0.8, 0.2][k];
                let direction = [
                    [1.0, 0.37, 0.61],
                    [-0.3, 0.51, 1.0],
                    [0.7, -0.21, -0.8],
                    [0.2, 0.8, 0.6],
                ][k];
                let frequency = std::f64::consts::TAU / wavelength;
                ((field::dot(eye, direction) * frequency
                    - (9.81 * frequency).sqrt() * self.time_seconds)
                    .rem_euclid(std::f64::consts::TAU)) as f32
            }),
            previous_right: [0.0; 4],
            previous_up: [0.0; 4],
            previous_forward: [0.0; 4],
            previous_offset: [0.0; 4],
            sampling: [0.0; 4],
            history: [0.0; 4],
            reference_region: [0; 4],
        };
        self.camera_cache = Some((eye, target, frame));
        self.prepare_history(&mut frame, eye);
        self.gpu
            .queue
            .write_buffer(&self.uniform, 0, bytemuck::bytes_of(&frame));
        self.gpu
            .queue
            .write_buffer(&self.proxies, 0, bytemuck::cast_slice(&proxy_rows));
        self.proxy_build_ms = crate::now_ms() - start;
        Ok(())
    }
    fn prepare_history(&mut self, frame: &mut Frame, eye: V3) {
        frame.reference_region = self.reference_region;
        let active = self.reconstruction.temporal.is_some();
        let jitter = if active {
            crate::temporal::jitter(self.phase, self.image.width(), self.width)
        } else {
            self.reference_jitter
        };
        frame.sampling = [
            jitter[0],
            jitter[1],
            self.image.width() as f32,
            self.image.height() as f32,
        ];
        let mut reset = true;
        let mut dt = 1.0;
        let mut old_jitter = [0.0; 2];
        if let Some((previous_eye, previous, time)) = self.previous {
            dt = ((crate::now_ms() - time) / 1000.0).max(0.001) as f32;
            frame.previous_right = previous.right;
            frame.previous_up = previous.up;
            frame.previous_forward = previous.forward;
            frame.previous_offset = vec4(field::sub(eye, previous_eye), 0.0);
            old_jitter = [previous.sampling[0], previous.sampling[1]];
            reset = dt > 0.25;
        }
        frame.history = [
            f32::from(active),
            f32::from(reset),
            dt,
            if active {
                1.0
            } else {
                self.reference_filter_scale
            },
        ];
        if let Some(t) = &self.reconstruction.temporal {
            t.update(
                &self.gpu,
                [self.width, self.height],
                [
                    self.settings.exposure as f32,
                    f32::from(reset),
                    if self.width == self.image.width() && self.height == self.image.height() {
                        1.0
                    } else {
                        self.settings.temporal_mode as f32
                    },
                    self.settings.temporal_debug as f32,
                ],
                [jitter[0], jitter[1], old_jitter[0], old_jitter[1]],
                [dt, 0.25, 2.0 * frame.right[3] / self.height as f32, 0.0],
            );
        }
        self.prepared = Some((eye, *frame));
    }
    pub fn submitted(&mut self) {
        self.cache_dirty = false;
        if let Some((eye, frame)) = self.prepared.take() {
            self.previous = Some((eye, frame, crate::now_ms()));
            self.phase = self.phase.wrapping_add(1);
            self.reconstruction.submitted();
        }
    }
    fn animate_frame(frame: &mut Frame, eye: V3, seconds: f64) {
        frame.animation[0] = seconds as f32;
        frame.waves = std::array::from_fn(|k| {
            let wavelength = [8.0, 3.0, 0.8, 0.2][k];
            let direction = [
                [1.0, 0.37, 0.61],
                [-0.3, 0.51, 1.0],
                [0.7, -0.21, -0.8],
                [0.2, 0.8, 0.6],
            ][k];
            let frequency = std::f64::consts::TAU / wavelength;
            ((field::dot(eye, direction) * frequency - (9.81 * frequency).sqrt() * seconds)
                .rem_euclid(std::f64::consts::TAU)) as f32
        });
    }
    pub fn encode(&self, encoder: &mut wgpu::CommandEncoder, measure: bool) {
        self.encode_passes(
            encoder,
            measure || self.settings.instrumented,
            if measure {
                self.timestamps.as_ref()
            } else {
                None
            },
        );
        if measure {
            encoder.copy_buffer_to_buffer(&self.stats, 0, &self.stats_read, 0, 128);
            if let Some(q) = &self.timestamps {
                encoder.resolve_query_set(q, 0..6, &self.timing_resolve, 0);
                encoder.copy_buffer_to_buffer(&self.timing_resolve, 0, &self.timing_read, 0, 48);
            }
        }
    }
    pub fn encode_passes(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        diagnostics: bool,
        timestamps: Option<&wgpu::QuerySet>,
    ) {
        let built_cache =
            self.settings.region_cache && self.settings.scene == 4 && self.cache_dirty;
        if built_cache {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("cold regional certificate build"),
                timestamp_writes: timestamps.map(|q| wgpu::ComputePassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(0),
                    end_of_pass_write_index: None,
                }),
            });
            pass.set_pipeline(&self.cache_pipeline);
            pass.set_bind_group(0, &self.bindings, &[]);
            pass.dispatch_workgroups(8, 8, 8);
        }
        if diagnostics || self.settings.separate_media {
            encoder.clear_buffer(&self.stats, 0, None);
        }
        let visibility = if diagnostics {
            &self.visibility
        } else {
            &self.production_visibility
        };
        let shade = if self.settings.separate_media {
            &self.shade_separate
        } else if diagnostics {
            &self.shade
        } else {
            &self.production_shade
        };
        for (i, pipeline) in [visibility, shade].iter().enumerate() {
            let build_solar = i == 1
                && (self.settings.solar_cache
                    || (self.settings.noise_cache && self.settings.clouds > 0.0))
                && self.settings.scene == 4;
            if build_solar {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("current-epoch solar cache"),
                    timestamp_writes: timestamps.map(|q| wgpu::ComputePassTimestampWrites {
                        query_set: q,
                        beginning_of_pass_write_index: Some(2),
                        end_of_pass_write_index: None,
                    }),
                });
                pass.set_pipeline(if self.settings.noise_cache && !self.settings.solar_cache {
                    &self.noise_pipeline
                } else {
                    &self.solar_pipeline
                });
                pass.set_bind_group(0, &self.bindings, &[]);
                if self.settings.noise_cache && !self.settings.solar_cache {
                    pass.dispatch_workgroups(4, 16, 128);
                } else {
                    pass.dispatch_workgroups(16, 8, 16);
                }
            }
            let writes = timestamps.map(|q| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: if (i == 0 && built_cache) || build_solar {
                    None
                } else {
                    Some(i as u32 * 2)
                },
                end_of_pass_write_index: Some(i as u32 * 2 + 1),
            });
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(if i == 0 {
                    "bounded primary visibility"
                } else {
                    "interfaces and participating media"
                }),
                timestamp_writes: writes,
            });
            pass.set_pipeline(pipeline);
            let bindings = if self.reconstruction.index() == 1 {
                self.bindings_other.as_ref().unwrap_or(&self.bindings)
            } else {
                &self.bindings
            };
            pass.set_bind_group(0, bindings, &[]);
            pass.dispatch_workgroups(
                self.width.div_ceil(self.workgroup[0]),
                self.height.div_ceil(self.workgroup[1]),
                1,
            );
        }
        self.reconstruction.encode(encoder, timestamps);
    }
    pub fn resident_bytes(&self) -> u64 {
        self.uniform.size()
            + self.proxies.size()
            + self.hit_buffer.size()
            + u64::from(self.image.width()) * u64::from(self.image.height()) * 4
            + u64::from(self.width) * u64::from(self.height) * 8
            + self.reconstruction.bytes()
            + self.region_cache.size()
            + self.solar_cache.size()
            + self.image_read.size()
            + self.erosion_buffer.size()
            + self.materials.size()
            + 400
            + (self.basin.height.len() * 8 * 6) as u64
    }
    // Application-controlled steady payload only. Driver allocations and old
    // submitted resources during resize are explicitly outside this figure.
    fn check_working_set(
        &self,
        w: u32,
        h: u32,
        ow: u32,
        oh: u32,
        s: &Settings,
    ) -> Result<(), String> {
        let fixed = self.resident_bytes()
            - self.hit_buffer.size()
            - u64::from(self.width) * u64::from(self.height) * 8
            - u64::from(self.image.width()) * u64::from(self.image.height()) * 4
            - self.image_read.size()
            - self.reconstruction.bytes()
            - self.solar_cache.size();
        let i = u64::from(w) * u64::from(h);
        let o = u64::from(ow) * u64::from(oh);
        let temporal = if s.temporal_mode == 0 {
            0
        } else {
            48 * i + 16 * o + 64 + if w < ow || h < oh { 4 * i + 16 * o } else { 20 }
        };
        let solar = if s.solar_cache {
            64 * 32 * 64 * 16
        } else if s.noise_cache {
            64 * 64 * 64 * 8 * 4
        } else {
            16
        };
        let bytes = fixed
            + 40 * i
            + 4 * o
            + u64::from((ow * 4).div_ceil(256) * 256) * u64::from(oh)
            + 64
            + temporal
            + solar;
        if bytes > 256 * 1024 * 1024 {
            return Err(format!("Configuration needs {bytes} controlled bytes, above the provisional 256 MiB steady working-set limit"));
        }
        Ok(())
    }
    /// Explicit quality-only capture, raw unexposed RGBA binary16. No tone map.
    pub async fn capture_hdr(&self) -> Result<Vec<u8>, String> {
        self.capture_texture(&self.hdr).await
    }
    pub async fn capture_resolved_hdr(&self) -> Result<Vec<u8>, String> {
        self.capture_texture(
            self.reconstruction
                .temporal
                .as_ref()
                .map_or(&self.hdr, |t| t.resolved()),
        )
        .await
    }
    async fn capture_texture(&self, texture: &wgpu::Texture) -> Result<Vec<u8>, String> {
        self.capture_texture_region(texture, [0, 0, texture.width(), texture.height()])
            .await
    }
    pub fn check_region(&self, region: [u32; 4]) -> Result<(), String> {
        let [x, y, w, h] = region;
        if w == 0
            || h == 0
            || x.checked_add(w).is_none_or(|v| v > self.width)
            || y.checked_add(h).is_none_or(|v| v > self.height)
        {
            return Err("Reference region lies outside the internal image".into());
        }
        Ok(())
    }
    pub async fn capture_hdr_region(&self, region: [u32; 4]) -> Result<Vec<u8>, String> {
        self.check_region(region)?;
        self.capture_texture_region(&self.hdr, region).await
    }
    async fn capture_texture_region(
        &self,
        texture: &wgpu::Texture,
        region: [u32; 4],
    ) -> Result<Vec<u8>, String> {
        let [x, y, width, height] = region;
        let stride = (width * 8).div_ceil(256) * 256;
        let read = self.gpu.buffer(
            "explicit HDR quality readback",
            u64::from(stride) * u64::from(height),
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut e = self.gpu.device.create_command_encoder(&Default::default());
        e.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x, y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &read,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.gpu.queue.submit([e.finish()]);
        let bytes = self.gpu.read(&read).await?;
        Ok(bytes
            .chunks(stride as usize)
            .flat_map(|row| row[..width as usize * 8].iter().copied())
            .collect())
    }
    pub async fn capture_validity(&self) -> Result<Vec<u8>, String> {
        self.capture_validity_region([0, 0, self.width, self.height])
            .await
    }
    pub async fn capture_validity_region(&self, region: [u32; 4]) -> Result<Vec<u8>, String> {
        self.check_region(region)?;
        let [x, y, w, h] = region;
        let read = self.gpu.buffer(
            "explicit primary validity readback",
            u64::from(w) * u64::from(h) * 32,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut e = self.gpu.device.create_command_encoder(&Default::default());
        for row in 0..h {
            e.copy_buffer_to_buffer(
                &self.hit_buffer,
                (u64::from(y + row) * u64::from(self.width) + u64::from(x)) * 32,
                &read,
                u64::from(row) * u64::from(w) * 32,
                u64::from(w) * 32,
            );
        }
        self.gpu.queue.submit([e.finish()]);
        let bytes = self.gpu.read(&read).await?;
        Ok(bytes
            .chunks_exact(32)
            .map(|row| u8::from(f32::from_le_bytes(row[8..12].try_into().unwrap()) < 2.0))
            .collect())
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn inspect_unresolved(&self, eye: V3, target: V3) -> Result<(), String> {
        use solar_core::field::FieldOracle;
        let read = self.gpu.buffer(
            "explicit unresolved audit",
            self.hit_buffer.size(),
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let mut e = self.gpu.device.create_command_encoder(&Default::default());
        e.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, self.hit_buffer.size());
        self.gpu.queue.submit([e.finish()]);
        let bytes = self.gpu.read(&read).await?;
        let rows: &[[u32; 8]] = bytemuck::cast_slice(&bytes);
        let f = field::normalized(field::sub(target, eye));
        let u = field::normalized(eye);
        let r = field::normalized(cross(f, u));
        let u = field::normalized(cross(r, f));
        let tan = (55.0_f64.to_radians() * 0.5).tan();
        let planet = solar_core::planet::PlanetSolid {
            geology: self.settings.geology(),
            radius: self.settings.radius,
            feature: self.feature,
        };
        let mut count = 0;
        for (i, row) in rows.iter().enumerate() {
            if f32::from_bits(row[2]) < 2.0 || row[7] == 1 {
                continue;
            }
            let x = i % self.width as usize;
            let y = i / self.width as usize;
            let uv = [
                (x as f64 + 0.5) / f64::from(self.width) * 2.0 - 1.0,
                (y as f64 + 0.5) / f64::from(self.height) * 2.0 - 1.0,
            ];
            let d = field::normalized(field::add(
                f,
                field::sub(
                    field::mul(
                        r,
                        uv[0] * tan * f64::from(self.width) / f64::from(self.height),
                    ),
                    field::mul(u, uv[1] * tan),
                ),
            ));
            let a = f64::from(f32::from_bits(row[0]));
            let b = f64::from(f32::from_bits(row[1]));
            let fa = planet.value(field::add(eye, field::mul(d, a)));
            let fb = planet.value(field::add(eye, field::mul(d, b)));
            println!(
                "audit pixel={x},{y} a={a} b={b} f64_a={fa} f64_b={fb} gpu_b={} bounds={}",
                f32::from_bits(row[3]),
                row[4]
            );
            count += 1;
            if count == 12 {
                break;
            }
        }
        Ok(())
    }
    pub async fn precision(&mut self) -> Result<String, String> {
        let g = self.settings.geology();
        let r = self.settings.radius;
        let eye = [5000.0, r + g.height([5000.0, r, 5000.0]) + 1.0, 5000.0];
        self.update_camera(eye, field::add(eye, [0.0, 0.0, -1.0]))?;
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("planet precision audit"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("millimetre planetary queries"),
                layout: Some(&layout),
                module: &module,
                entry_point: Some("precision_probe"),
                compilation_options: Default::default(),
                cache: None,
            });
        let read = self.gpu.buffer(
            "precision readback",
            128 * 32,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &self.bindings, &[]);
            pass.dispatch_workgroups(2, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, 128 * 32);
        self.gpu.queue.submit([encoder.finish()]);
        let bytes = self.gpu.read(&read).await?;
        let rows: &[[f32; 8]] = bytemuck::cast_slice(&bytes);
        let mut worst = 0.0_f64;
        let mut radial = 0.0_f64;
        for (i, row) in rows.iter().enumerate() {
            let mut q = [i as u32, i as u32 + 71, i as u32 + 191].map(|v| {
                let x = (solar_core::hash(v) >> 8) as f32 * (16.0_f32 / 16777215.0) - 8.0;
                f64::from(x)
            });
            if i == 0 {
                q = [0.0, f64::from(0.001_f32), 0.0];
            }
            let p = field::add(eye, q);
            let expected = field::length(p) - r - g.height(p);
            worst = worst.max((f64::from(row[0]) - expected).abs());
            radial = radial.max(
                (f64::from(row[1])
                    - solar_core::planet::radial_delta(
                        field::normalized(eye),
                        field::length(eye),
                        q,
                    ))
                .abs(),
            );
        }
        let report = serde_json::json!({"queries":128,"radius_m":r,"worst_field_error_m":worst,"worst_radial_error_m":radial,"allowance_m":0.001,"passed":worst<0.001&&radial<0.001});
        if worst >= 0.001 || radial >= 0.001 {
            return Err(report.to_string());
        }
        Ok(report.to_string())
    }
    /// Same ray partition, lighting and finite quadrature. The separate variant
    /// explicitly walks and stores air/cloud samples independently before compositing.
    pub async fn compare_media(&mut self) -> Result<String, String> {
        let saved = self.settings.clone();
        let mut rows = Vec::new();
        for name in ["orbit", "cave", "shore", "underwater", "clouds"] {
            let mut s = saved.clone();
            s.separate_media = false;
            if matches!(name, "cave" | "shore" | "underwater") {
                s.sea_level = s.feature()[1] - s.radius - 14.0;
            }
            self.configure(s.clone())?;
            let (eye, target) = s.bookmark(name);
            let (shared, a) = self.measure(eye, target).await?;
            s.separate_media = true;
            self.configure(s.clone())?;
            let (separate, b) = self.measure(eye, target).await?;
            let max_difference = a
                .iter()
                .zip(&b)
                .map(|(&x, &y)| x.abs_diff(y))
                .max()
                .unwrap_or(0);
            s.separate_media = false;
            s.medium_steps = 128;
            self.configure(s)?;
            let (reference, c) = self.measure(eye, target).await?;
            let mse = a
                .chunks_exact(4)
                .zip(c.chunks_exact(4))
                .flat_map(|(x, y)| {
                    (0..3).map(move |k| {
                        let d = (f64::from(x[k]) - f64::from(y[k])) / 255.0;
                        d * d
                    })
                })
                .sum::<f64>()
                / (f64::from(self.width) * f64::from(self.height) * 3.0);
            rows.push(serde_json::json!({"view":name,"shared":shared,"separate":separate,"reference_128":reference,"max_shared_separate_byte_error":max_difference,"display_rgb_rmse_vs_128":mse.sqrt()}));
            if max_difference > 1 {
                return Err(format!("Shared/separate medium mismatch: {max_difference}"));
            }
        }
        self.configure(saved)?;
        Ok(serde_json::json!({"width":self.width,"height":self.height,"comparison":"identical sampled transport, independent air/cloud walks","cases":rows}).to_string())
    }
    pub async fn validate_planet(&mut self) -> Result<String, String> {
        use solar_core::field::{FieldOracle, Ray, Status};
        let stored_state = self.erosion_state();
        let saved = self.settings.clone();
        let mut s = saved.clone();
        s.scene = 4;
        s.erosion_steps = 0;
        self.configure(s)?;
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("planet visibility audit"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("planet independent f64 comparison"),
                layout: Some(&layout),
                module: &module,
                entry_point: Some("planet_query_probe"),
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[("PREFIX_CACHE", f64::from(self.settings.prefix_cache))],
                    ..Default::default()
                },
                cache: None,
            });
        let read = self.gpu.buffer(
            "planet audit readback",
            35 * 32,
            wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        );
        let (
            mut total,
            mut hit,
            mut miss,
            mut unknown,
            mut false_miss,
            mut invalid,
            mut reference_unknown,
        ) = (0, 0, 0, 0, 0, 0, 0);
        for name in ["orbit", "ground", "cave", "shore"] {
            let (eye, target) = self.settings.bookmark(name);
            self.update_camera(eye, target)?;
            let forward = field::normalized(field::sub(target, eye));
            let mut up = field::normalized(eye);
            if field::length(cross(forward, up)) < 0.01 {
                up = [0.0, 0.0, 1.0];
            }
            let right = field::normalized(cross(forward, up));
            let up = field::normalized(cross(right, forward));
            let mut queries = [[0u32; 8]; 35];
            let mut rays = Vec::new();
            for y in 0..5 {
                for x in 0..7 {
                    let d = field::normalized(field::add(
                        forward,
                        field::add(
                            field::mul(right, (x as f64 - 3.0) * 0.14),
                            field::mul(up, (y as f64 - 2.0) * 0.14),
                        ),
                    ));
                    let d = d.map(|v| v as f32);
                    let d64 = field::normalized(d.map(f64::from));
                    let sphere = self.settings.radius + self.settings.geology().tail(0) + 250.0;
                    let b = field::dot(eye, d64);
                    let c = field::dot(eye, eye) - sphere * sphere;
                    let discriminant = b * b - c;
                    let (near, far) = if discriminant >= 0.0 {
                        (
                            (-b - discriminant.sqrt() - 10.0).max(0.0),
                            (-b + discriminant.sqrt() + 10.0).max(1.0),
                        )
                    } else {
                        (0.0, self.settings.radius * 4.0)
                    };
                    let i = y * 7 + x;
                    queries[i] = [
                        d[0].to_bits(),
                        d[1].to_bits(),
                        d[2].to_bits(),
                        (far as f32).to_bits(),
                        (near as f32).to_bits(),
                        0,
                        0,
                        0,
                    ];
                    rays.push(Ray {
                        origin: eye,
                        direction: d64,
                        near: f64::from(near as f32),
                        far: f64::from(far as f32),
                    });
                }
            }
            self.gpu
                .queue
                .write_buffer(&self.hit_buffer, 0, bytemuck::cast_slice(&queries));
            let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
            {
                let mut pass = encoder.begin_compute_pass(&Default::default());
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &self.bindings, &[]);
                pass.dispatch_workgroups(1, 1, 1);
            }
            encoder.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, 35 * 32);
            self.gpu.queue.submit([encoder.finish()]);
            let bytes = self.gpu.read(&read).await?;
            let rows: &[[f32; 8]] = bytemuck::cast_slice(&bytes);
            let planet = solar_core::planet::PlanetSolid {
                geology: self.settings.geology(),
                radius: self.settings.radius,
                feature: self.feature,
            };
            for (&ray, row) in rays.iter().zip(rows) {
                total += 1;
                let tolerance = if name == "orbit" { 0.1 } else { 0.001 };
                let reference = field::trace(planet, ray, tolerance, 20000, 2);
                if reference.status == Status::Unresolved {
                    reference_unknown += 1;
                }
                match row[2] as u32 {
                    0 => {
                        miss += 1;
                        if reference.status == Status::Hit {
                            false_miss += 1;
                        }
                    }
                    1 => {
                        hit += 1;
                        let a = f64::from(row[0]);
                        let b = f64::from(row[1]);
                        let fa = planet.value(ray.at(a));
                        let fb = planet.value(ray.at(b));
                        let numerical = 0.0001 + b * 3e-6;
                        if (fa * fb > 0.0 && fa.abs().min(fb.abs()) > numerical)
                            || (reference.status == Status::Hit
                                && (reference.far < a - numerical
                                    || reference.near > b + numerical))
                        {
                            invalid += 1;
                        }
                    }
                    _ => unknown += 1,
                }
            }
        }
        self.import_erosion(&stored_state)?;
        let report = serde_json::json!({"rays":total,"hits":hit,"misses":miss,"unresolved":unknown,"false_misses":false_miss,"invalid_hits":invalid,"reference_unresolved":reference_unknown,"passed":false_miss==0&&invalid==0});
        if false_miss > 0 || invalid > 0 {
            return Err(report.to_string());
        }
        Ok(report.to_string())
    }
    pub async fn validate_rebase(&mut self) -> Result<String, String> {
        let stored_state = self.erosion_state();
        let saved = self.settings.clone();
        let mut max_field = 0.0_f64;
        let mut max_material = 0.0_f64;
        let mut field_reference = 0.0_f64;
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("anchored field audit"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: None,
                layout: Some(&layout),
                module: &module,
                entry_point: Some("anchored_probe"),
                compilation_options: Default::default(),
                cache: None,
            });
        let read = self.gpu.buffer(
            "rebase audit readback",
            64 * 32,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        for seed in [2026, 8128, 91] {
            let mut s = saved.clone();
            s.seed = seed;
            s.scene = 4;
            s.erosion_steps = 0;
            self.configure(s)?;
            let g = self.settings.geology();
            let radius = self.settings.radius;
            let origin = [
                5000.0,
                radius + g.height([5000.0, radius, 5000.0]) + 1.0,
                5000.0,
            ];
            let mut original = Vec::<[f32; 8]>::new();
            for shift in [0.0, 4096.0] {
                let eye = field::add(origin, [shift, 0.0, 0.0]);
                self.update_camera(eye, field::add(eye, [0.0, 0.0, -1.0]))?;
                let mut queries = [[0.0_f32; 8]; 64];
                for (i, q) in queries.iter_mut().enumerate() {
                    let offset = [i as u32, i as u32 + 71, i as u32 + 191]
                        .map(|x| f64::from(solar_core::hash(x) >> 8) * (16.0 / 16777215.0) - 8.0);
                    for k in 0..3 {
                        q[k] = (origin[k] + offset[k] - eye[k]) as f32;
                    }
                }
                self.gpu
                    .queue
                    .write_buffer(&self.hit_buffer, 0, bytemuck::cast_slice(&queries));
                let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
                {
                    let mut pass = encoder.begin_compute_pass(&Default::default());
                    pass.set_pipeline(&pipeline);
                    pass.set_bind_group(0, &self.bindings, &[]);
                    pass.dispatch_workgroups(1, 1, 1);
                }
                encoder.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, 64 * 32);
                self.gpu.queue.submit([encoder.finish()]);
                let bytes = self.gpu.read(&read).await?;
                let rows: &[[f32; 8]] = bytemuck::cast_slice(&bytes);
                for (i, row) in rows.iter().enumerate() {
                    let p = field::add(
                        eye,
                        [
                            queries[i][0] as f64,
                            queries[i][1] as f64,
                            queries[i][2] as f64,
                        ],
                    );
                    let f = field::length(p) - radius - g.height(p);
                    field_reference = field_reference.max((f - row[0] as f64).abs());
                    if shift != 0.0 {
                        max_field = max_field.max((row[0] - original[i][0]).abs() as f64);
                        max_material = max_material.max((row[1] - original[i][1]).abs() as f64);
                    }
                }
                if shift == 0.0 {
                    original = rows.to_vec();
                }
            }
        }
        self.import_erosion(&stored_state)?;
        let report = serde_json::json!({"seeds":3,"queries_per_frame":64,"origin_shift_m":4096,"worst_field_change_m":max_field,"worst_f64_field_error_m":field_reference,"worst_material_noise_change":max_material,"field_allowance_m":0.001,"material_noise_allowance":0.03,"passed":max_field<0.001&&field_reference<0.001&&max_material<0.03});
        if max_field >= 0.001 || field_reference >= 0.001 || max_material >= 0.03 {
            return Err(report.to_string());
        }
        Ok(report.to_string())
    }
    pub async fn validate_bounds(&mut self) -> Result<String, String> {
        use solar_core::field::FieldOracle;
        let stored = self.erosion_state();
        let saved = self.settings.clone();
        let mut violations = 0u32;
        let mut ball_violations = 0u32;
        let mut prefix_violations = 0u32;
        let mut prefix_reuses = 0u32;
        let mut prefix_examples = Vec::new();
        let mut worst = 0.0_f64;
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("correlated region bounds audit"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: None,
                layout: Some(&layout),
                module: &module,
                entry_point: Some("region_probe"),
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[("PREFIX_CACHE", 1.0)],
                    ..Default::default()
                },
                cache: None,
            });
        let read = self.gpu.buffer(
            "region audit readback",
            64 * 32,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        for seed in [2026, 8128, 91] {
            let mut s = saved.clone();
            s.seed = seed;
            s.erosion_steps = 0;
            s.method = 2;
            self.configure(s)?;
            for feature in [false, true] {
                let g = self.settings.geology();
                let r = self.settings.radius;
                let eye = if feature {
                    field::add(self.feature, [0.0, 50.0, 100.0])
                } else {
                    [5000.0, r + g.height([5000.0, r, 5000.0]) + 1.0, 5000.0]
                };
                self.update_camera(eye, field::add(eye, [0.0, 0.0, -1.0]))?;
                let mut queries = [[0u32; 8]; 64];
                for (i, q) in queries.iter_mut().enumerate() {
                    let p = [i as u32, i as u32 + 7, i as u32 + 31]
                        .map(|v| (solar_core::hash(v) >> 8) as f32 * (128.0 / 16777215.0) - 64.0);
                    let d = field::normalized([
                        i as f64 + 1.0,
                        (i % 7) as f64 - 3.1,
                        -((i % 11) as f64) - 0.2,
                    ])
                    .map(|v| v as f32);
                    let half = 2.0_f32.powi((i % 22) as i32 - 9);
                    *q = [
                        p[0].to_bits(),
                        p[1].to_bits(),
                        p[2].to_bits(),
                        half.to_bits(),
                        d[0].to_bits(),
                        d[1].to_bits(),
                        d[2].to_bits(),
                        0,
                    ];
                }
                self.gpu
                    .queue
                    .write_buffer(&self.hit_buffer, 0, bytemuck::cast_slice(&queries));
                let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
                {
                    let mut pass = encoder.begin_compute_pass(&Default::default());
                    pass.set_pipeline(&pipeline);
                    pass.set_bind_group(0, &self.bindings, &[]);
                    pass.dispatch_workgroups(1, 1, 1);
                }
                encoder.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, 64 * 32);
                self.gpu.queue.submit([encoder.finish()]);
                let bytes = self.gpu.read(&read).await?;
                let rows: &[[f32; 8]] = bytemuck::cast_slice(&bytes);
                let planet = solar_core::planet::PlanetSolid {
                    geology: g,
                    radius: r,
                    feature: self.feature,
                };
                for (input, row) in queries.iter().zip(rows) {
                    prefix_reuses += u32::from(row[6].to_bits() != 0);
                    let q = input[..3]
                        .iter()
                        .map(|&v| f64::from(f32::from_bits(v)))
                        .collect::<Vec<_>>();
                    let d = input[4..7]
                        .iter()
                        .map(|&v| f64::from(f32::from_bits(v)))
                        .collect::<Vec<_>>();
                    let half = f64::from(f32::from_bits(input[3]));
                    for j in 0..17 {
                        let t = half * (j as f64 / 8.0 - 1.0);
                        let p = std::array::from_fn(|k| eye[k] + q[k] + d[k] * t);
                        let value = planet.value(p);
                        let excess = (row[0] as f64 - value).max(value - row[1] as f64);
                        worst = worst.max(excess);
                        if excess > 1e-7 {
                            violations += 1;
                        }
                        let cached_excess = (row[4] as f64 - value).max(value - row[5] as f64);
                        if cached_excess > 1e-7 {
                            prefix_violations += 1;
                            worst = worst.max(cached_excess);
                            if prefix_examples.len() < 4 {
                                prefix_examples.push(serde_json::json!({"seed":seed,"feature":feature,"q":q,"half":half,"t":t,"value":value,"direct":[row[0],row[1]],"cached":[row[4],row[5]],"reused":row[6].to_bits()}));
                            }
                        }
                        let ball_excess = (row[2] as f64 - value).max(value - row[3] as f64);
                        if ball_excess > 1e-7 {
                            ball_violations += 1;
                        }
                        let direction = field::normalized([
                            (j as f64 * 1.7).cos(),
                            (j as f64 * 2.3).sin(),
                            (j as f64 * 0.9).cos(),
                        ]);
                        let other = std::array::from_fn(|k| eye[k] + q[k] + direction[k] * half);
                        let other_value = planet.value(other);
                        if (row[2] as f64 - other_value).max(other_value - row[3] as f64) > 1e-7 {
                            ball_violations += 1;
                        }
                    }
                }
            }
        }
        self.import_erosion(&stored)?;
        let report = serde_json::json!({"regions":384,"samples":6528,"ball_samples":13056,"ball_violations":ball_violations,"prefix_samples":6528,"prefix_violations":prefix_violations,"prefix_reused_regions":prefix_reuses,"prefix_examples":prefix_examples,"seeds":3,"worst_violation_m":worst,"violations":violations,"passed":violations==0&&ball_violations==0&&prefix_violations==0&&prefix_reuses>0});
        if violations > 0 || ball_violations > 0 || prefix_violations > 0 || prefix_reuses == 0 {
            return Err(report.to_string());
        }
        Ok(report.to_string())
    }
    pub async fn validate_normals(&mut self) -> Result<String, String> {
        use solar_core::field::FieldOracle;
        let stored = self.erosion_state();
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("analytic gradient audit"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("normal oracle comparison"),
                layout: Some(&layout),
                module: &module,
                entry_point: Some("normal_probe"),
                compilation_options: Default::default(),
                cache: None,
            });
        let read = self.gpu.buffer(
            "normal audit readback",
            128 * 32,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut tested = 0;
        let mut seams = 0;
        let mut failed = 0;
        let mut worst = 0.0_f64;
        let mut examples = Vec::new();
        let mut worst_packing = 0.0_f64;
        let mut worst_value = 0.0_f64;
        for seed in [2026, 8128, 91] {
            let mut s = self.settings.clone();
            s.seed = seed;
            s.erosion_steps = 0;
            s.scene = 4;
            s.normal_filter = 0;
            self.configure(s)?;
            for feature in [false, true] {
                let geology = self.settings.geology();
                let radius = self.settings.radius;
                let eye = if feature {
                    field::add(self.feature, [0.0, 50.0, 100.0])
                } else {
                    [
                        5000.0,
                        radius + geology.height([5000.0, radius, 5000.0]) + 1.0,
                        5000.0,
                    ]
                };
                self.update_camera(eye, field::add(eye, [0.0, 0.0, -1.0]))?;
                let oracle = solar_core::planet::PlanetSolid {
                    geology,
                    radius,
                    feature: self.feature,
                };
                let mut queries = [[0.0_f32; 8]; 128];
                for (i, row) in queries.iter_mut().enumerate() {
                    for (k, v) in row[..3].iter_mut().enumerate() {
                        *v = (solar_core::hash(i as u32 + k as u32 * 131) >> 8) as f32
                            * (400.0 / 16777215.0)
                            - 200.0;
                    }
                    // Normals are a surface quantity. Away from zero the GPU's
                    // certified feature-support cull and the oracle's global CSG
                    // can return different positive field values/derivatives.
                    // Locate zeros using only the independent f64 oracle, then
                    // compare at the exact f32 local point sent to the GPU.
                    let mut point = [
                        eye[0] + f64::from(row[0]),
                        eye[1],
                        eye[2] + f64::from(row[2]),
                    ];
                    let mut a = radius - geology.tail(0) - 1000.0;
                    let mut b = radius + geology.tail(0) + 1000.0;
                    for _ in 0..48 {
                        let m = (a + b) * 0.5;
                        point[1] = m;
                        if oracle.value(point) < 0.0 {
                            a = m;
                        } else {
                            b = m;
                        }
                    }
                    row[1] = ((a + b) * 0.5 - eye[1]) as f32;
                }
                self.gpu
                    .queue
                    .write_buffer(&self.hit_buffer, 0, bytemuck::cast_slice(&queries));
                let mut e = self.gpu.device.create_command_encoder(&Default::default());
                {
                    let mut p = e.begin_compute_pass(&Default::default());
                    p.set_pipeline(&pipeline);
                    p.set_bind_group(0, &self.bindings, &[]);
                    p.dispatch_workgroups(2, 1, 1);
                }
                e.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, 128 * 32);
                self.gpu.queue.submit([e.finish()]);
                let bytes = self.gpu.read(&read).await?;
                let rows: &[[f32; 8]] = bytemuck::cast_slice(&bytes);
                let oracle = solar_core::planet::PlanetSolid {
                    geology,
                    radius,
                    feature: self.feature,
                };
                for (q, row) in queries.iter().zip(rows) {
                    if row[3] < 0.001 {
                        seams += 1;
                        continue;
                    }
                    let position = std::array::from_fn(|k| eye[k] + q[k] as f64);
                    let derivative = |epsilon: f64| {
                        field::normalized(std::array::from_fn(|axis| {
                            let mut a = position;
                            let mut b = position;
                            a[axis] -= epsilon;
                            b[axis] += epsilon;
                            (oracle.value(b) - oracle.value(a)) / (2.0 * epsilon)
                        }))
                    };
                    let fine = derivative(0.00005);
                    let coarse = derivative(0.0001);
                    if field::length(field::sub(fine, coarse)) > 0.001 {
                        seams += 1;
                        continue;
                    }
                    let gpu = [row[0] as f64, row[1] as f64, row[2] as f64];
                    let bits = row[4].to_bits();
                    let oct = [
                        f64::from(bits as i16) / 32767.0,
                        f64::from((bits >> 16) as i16) / 32767.0,
                    ];
                    let mut decoded = [oct[0], oct[1], 1.0 - oct[0].abs() - oct[1].abs()];
                    let fold = (-decoded[2]).clamp(0.0, 1.0);
                    for v in &mut decoded[..2] {
                        *v += if *v >= 0.0 { -fold } else { fold };
                    }
                    let packing = field::length(field::sub(field::normalized(decoded), gpu));
                    worst_packing = worst_packing.max(packing);
                    let value_error = (row[5] as f64 - oracle.value(position)).abs();
                    worst_value = worst_value.max(value_error);
                    let error = field::length(field::sub(fine, gpu));
                    worst = worst.max(error);
                    tested += 1;
                    if !error.is_finite() || error > 0.01 || packing > 0.0002 || value_error > 0.002
                    {
                        failed += 1;
                        if examples.len() < 8 {
                            examples.push(serde_json::json!({"seed":seed,"feature":feature,"q":q,"normal":gpu,"reference":fine,"candidate_value":row[5],"canonical_value":row[6],"oracle_value":oracle.value(position),"margin":row[3]}));
                        }
                    }
                }
            }
        }
        self.import_erosion(&stored)?;
        let report = serde_json::json!({"tested":tested,"seams_or_unstable_reference":seams,"max_normal_vector_error":worst,"max_packed_normal_error":worst_packing,"max_surface_value_error_m":worst_value,"failures":failed,"examples":examples,"threshold":0.01,"passed":failed==0&&tested>600});
        if failed > 0 || tested <= 600 {
            return Err(report.to_string());
        }
        Ok(report.to_string())
    }
    pub async fn validate_water(&mut self) -> Result<String, String> {
        let saved = self.settings.clone();
        let mut s = saved.clone();
        s.scene = 4;
        s.water = true;
        s.sea_level = s.feature()[1] - s.radius - 14.0;
        self.configure(s)?;
        let module = self
            .gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("submillimetre water crossing audit"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
        let layout = self
            .gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: None,
                layout: Some(&layout),
                module: &module,
                entry_point: Some("water_probe"),
                compilation_options: Default::default(),
                cache: None,
            });
        let read = self.gpu.buffer(
            "water audit readback",
            64 * 32,
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let mut queries = [[0.0_f32; 8]; 64];
        for (i, q) in queries.iter_mut().enumerate() {
            let y = [-1.0, -0.1, -0.001, -0.000001, 0.000001, 0.001, 0.1, 1.0][i % 8];
            let critical = (1.0_f64 - 1.0 / (1.333_f64 * 1.333)).sqrt();
            q[3] = if i < 32 {
                i as f32 / 31.0
            } else {
                (critical + (i as f64 - 47.5) * 1e-5) as f32
            };
            let angle = (i / 8) as f64 * std::f64::consts::TAU / 8.0;
            let d = field::normalized([angle.cos(), y, angle.sin()]);
            for k in 0..3 {
                q[k] = d[k] as f32;
            }
        }
        let mut failures = 0;
        let mut worst_fresnel = 0.0_f64;
        let mut fresnel_failures = 0;
        let mut worst_near = 0.0_f64;
        let mut near_queries = 0;
        let mut total = 0;
        for height in [-1.0, -0.03, -0.001, -0.0001, 0.0, 0.0001, 0.001, 0.03, 1.0] {
            let interface = self.settings.radius + self.settings.sea_level;
            let r = interface + height;
            let eye = [75.0, (r * r - 75.0 * 75.0 - 200.0 * 200.0).sqrt(), 200.0];
            self.update_camera(eye, field::add(eye, [0.0, 0.0, -1.0]))?;
            self.gpu
                .queue
                .write_buffer(&self.hit_buffer, 0, bytemuck::cast_slice(&queries));
            let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
            {
                let mut pass = encoder.begin_compute_pass(&Default::default());
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &self.bindings, &[]);
                pass.dispatch_workgroups(1, 1, 1);
            }
            encoder.copy_buffer_to_buffer(&self.hit_buffer, 0, &read, 0, 64 * 32);
            self.gpu.queue.submit([encoder.finish()]);
            let bytes = self.gpu.read(&read).await?;
            let rows: &[[f32; 8]] = bytemuck::cast_slice(&bytes);
            for (input, row) in queries.iter().zip(rows) {
                total += 1;
                for (actual, eta) in [(row[2], 1.333_f32), (row[3], 1.0_f32 / 1.333)] {
                    let expected =
                        solar_core::optics::dielectric_fresnel(input[3] as f64, eta as f64);
                    let error = (actual as f64 - expected).abs();
                    worst_fresnel = worst_fresnel.max(error);
                    if !actual.is_finite() || error > 0.001 {
                        fresnel_failures += 1;
                    }
                }
                let d = [input[0] as f64, input[1] as f64, input[2] as f64];
                let a = field::dot(d, d);
                let b = field::dot(eye, d);
                let radial = field::length(eye);
                let h = radial - self.settings.radius - self.settings.sea_level;
                let c = h * (radial + interface);
                let disc = b * b - a * c;
                let mut expected = -1.0;
                if disc >= 0.0 {
                    let q = -b - disc.sqrt().copysign(b);
                    let mut roots = [q / a, if q != 0.0 { c / q } else { 0.0 }];
                    roots.sort_by(f64::total_cmp);
                    expected = roots.into_iter().find(|t| *t > 0.0).unwrap_or(-1.0);
                    if h == 0.0 && b < 0.0 {
                        expected = 1e-7;
                    }
                }
                let actual = row[0] as f64;
                let error = (actual - expected).abs();
                let allowance = 0.00002 + expected.abs() * 4e-6;
                if (0.0..1000.0).contains(&expected) {
                    near_queries += 1;
                    worst_near = worst_near.max(error);
                }
                if !actual.is_finite()
                    || (actual < 0.0) != (expected < 0.0)
                    || (expected >= 0.0 && error > allowance)
                {
                    failures += 1;
                }
            }
        }
        self.configure(saved)?;
        let report = serde_json::json!({"rays":total,"camera_heights_m":[-1.0,-0.03,-0.001,-0.0001,0.0,0.0001,0.001,0.03,1.0],"near_queries":near_queries,"worst_near_error_m":worst_near,"failed":failures,"fresnel_failed":fresnel_failures,"worst_fresnel_error":worst_fresnel,"passed":failures==0&&fresnel_failures==0});
        if failures > 0 || fresnel_failures > 0 {
            return Err(report.to_string());
        }
        Ok(report.to_string())
    }
    pub async fn measure(&mut self, eye: V3, target: V3) -> Result<(FrameReport, Vec<u8>), String> {
        self.ensure_diagnostics();
        self.update_camera(eye, target)?;
        let mut enc = self.gpu.device.create_command_encoder(&Default::default());
        self.encode(&mut enc, true);
        let stride = (self.image.width() * 4).div_ceil(256) * 256;
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.image,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &self.image_read,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(self.image.height()),
                },
            },
            wgpu::Extent3d {
                width: self.image.width(),
                height: self.image.height(),
                depth_or_array_layers: 1,
            },
        );
        let start = crate::now_ms();
        self.gpu.queue.submit([enc.finish()]);
        self.submitted();
        let counters = self.gpu.read(&self.stats_read).await?;
        let counters: &[u32] = bytemuck::cast_slice(&counters);
        let timing = if self.timestamps.is_some() {
            let bytes = self.gpu.read(&self.timing_read).await?;
            let t: &[u64] = bytemuck::cast_slice(&bytes);
            let period = f64::from(self.gpu.queue.get_timestamp_period()) / 1e6;
            Some(std::array::from_fn(|i| {
                (t[i * 2 + 1] - t[i * 2]) as f64 * period
            }))
        } else {
            None
        };
        let data = self.gpu.read(&self.image_read).await?;
        let pixels: Vec<u8> = data
            .chunks(stride as usize)
            .flat_map(|r| r[..self.image.width() as usize * 4].iter().copied())
            .collect();
        let elapsed = crate::now_ms() - start;
        let image_hash = pixels.iter().fold(2166136261u32, |h, &x| {
            (h ^ u32::from(x)).wrapping_mul(16777619)
        });
        let info = self.gpu.adapter.get_info();
        let report = FrameReport {
            active_reference_region: self.reference_region,
            animation_time_seconds: self.time_seconds,
            backend: format!("{:?}", info.backend),
            adapter: info.name,
            width: self.image.width(),
            height: self.image.height(),
            internal_resolution: [self.width, self.height],
            gpu_pass_ms: timing,
            gpu_total_ms: timing.map(|t| t.iter().sum()),
            submission_readback_ms: elapsed,
            hits: counters[0],
            misses: counters[1],
            unresolved: counters[2],
            bound_queries: u64::from(counters[3]) + (u64::from(counters[10]) << 32),
            band_queries: u64::from(counters[4]) + (u64::from(counters[11]) << 32),
            stack_high_water: counters[5],
            secondary_unresolved: counters[6],
            secondary_rays: counters[7],
            secondary_bounds: u64::from(counters[8]) + (u64::from(counters[12]) << 32),
            secondary_bands: u64::from(counters[9]) + (u64::from(counters[13]) << 32),
            budget_unresolved: counters[14],
            uncertainty_unresolved: counters[15],
            shading_calls: std::array::from_fn(|i| {
                u64::from(counters[16 + i]) + (u64::from(counters[24 + i]) << 32)
            }),
            resident_controlled_bytes: self.resident_bytes(),
            proxy_build_ms: self.proxy_build_ms,
            erosion_build_ms: self.erosion_build_ms,
            erosion_ledger_error: self.basin.solid_ledger_error(),
            image_hash,
        };
        Ok((report, pixels))
    }
}
use bytemuck::Zeroable;
#[path = "surface_probe.rs"]
mod surface_probe;

#[cfg(not(target_arch = "wasm32"))]
pub async fn native_render() -> Result<String, String> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--validate-temporal") {
        return crate::temporal_audit::run(&Gpu::new().await?).await;
    }
    let at = |key: &str| {
        args.iter()
            .position(|x| x == key)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let width = at("--width").and_then(|s| s.parse().ok()).unwrap_or(960);
    let height = at("--height").and_then(|s| s.parse().ok()).unwrap_or(540);
    let mut settings = Settings::default();
    if let Some(path) = at("--settings") {
        settings = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    if let Some(scene) = at("--scene") {
        settings.scene = scene.parse().map_err(|_| "invalid scene")?;
    }
    let bookmark = at("--bookmark").unwrap_or("orbit".into());
    if settings.scene != 4 {
        settings.tolerance = 0.004;
    }
    if matches!(
        bookmark.as_str(),
        "ground" | "cave" | "shore" | "underwater"
    ) {
        settings.sea_level = settings.feature()[1] - settings.radius - 14.0;
    }
    let mut renderer = Renderer::new(width, height, settings).await?;
    if let Some(path) = at("--erosion-import") {
        renderer.import_erosion(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)?;
    }
    if let Some(steps) = at("--erosion-add-steps") {
        let mut s = renderer.settings.clone();
        let steps: u32 = steps.parse().map_err(|_| "Invalid erosion step count")?;
        s.erosion_steps = s.erosion_steps.saturating_add(steps).min(1024);
        renderer.configure(s)?;
    }
    if let Some(path) = at("--erosion-export") {
        std::fs::write(path, renderer.erosion_state()).map_err(|e| e.to_string())?;
    }
    if args.iter().any(|a| a == "--precision") {
        return renderer.precision().await;
    }
    if args.iter().any(|a| a == "--validate-planet") {
        return renderer.validate_planet().await;
    }
    if args.iter().any(|a| a == "--validate-prefix") {
        let mut settings = renderer.settings.clone();
        settings.prefix_cache = true;
        renderer.configure(settings)?;
        return renderer.validate_planet().await;
    }
    if args.iter().any(|a| a == "--validate-rebase") {
        return renderer.validate_rebase().await;
    }
    if args.iter().any(|a| a == "--validate-bounds") {
        return renderer.validate_bounds().await;
    }
    if args.iter().any(|a| a == "--validate-normals") {
        return renderer.validate_normals().await;
    }
    if args.iter().any(|a| a == "--validate-water") {
        return renderer.validate_water().await;
    }
    if args.iter().any(|a| a == "--compare-media") {
        return renderer.compare_media().await;
    }
    if let Some(time) = at("--time") {
        let time: f64 = time.parse().map_err(|_| "Invalid time")?;
        if !time.is_finite() || !(0.0..=1e7).contains(&time) {
            return Err("Time outside finite epoch".into());
        }
        renderer.time_seconds = time;
    }
    let (mut eye, mut target) = renderer.settings.bookmark(&bookmark);
    if let Some(depth) = at("--water-height") {
        let depth: f64 = depth.parse().map_err(|_| "Invalid water height")?;
        if !depth.is_finite() || depth.abs() > 100.0 {
            return Err("Water audit height outside ±100 m".into());
        }
        let radial = renderer.settings.radius + renderer.settings.sea_level + depth;
        let y = (radial * radial - eye[0] * eye[0] - eye[2] * eye[2]).sqrt();
        target[1] += y - eye[1];
        eye[1] = y;
    }
    if let Some(pitch) = at("--pitch") {
        let pitch: f64 = pitch.parse().map_err(|_| "Invalid pitch")?;
        if !pitch.is_finite() || pitch.abs() >= 90.0 {
            return Err("Pitch must be between -90 and 90 degrees".into());
        }
        let up = field::normalized(eye);
        let direction = field::sub(target, eye);
        let flat = field::normalized(field::sub(
            direction,
            field::mul(up, field::dot(direction, up)),
        ));
        target = field::add(
            eye,
            field::add(
                field::mul(flat, pitch.to_radians().cos()),
                field::mul(up, pitch.to_radians().sin()),
            ),
        );
    }
    let frames = at("--frames").and_then(|s| s.parse().ok()).unwrap_or(1u32);
    if args.iter().any(|a| a == "--surface-cache") {
        let extent = at("--extent").and_then(|s| s.parse().ok()).unwrap_or(128.0);
        let depth = at("--depth").and_then(|s| s.parse().ok()).unwrap_or(6);
        return renderer
            .surface_cache_probe(eye, target, extent, depth, frames)
            .await
            .map(|v| v.to_string());
    }
    let output = at("--output").unwrap_or("evidence/local/render.png".into());
    let mut reports = Vec::new();
    for i in 0..frames {
        let (report, pixels) = renderer.measure(eye, target).await?;
        reports.push(report);
        if args.iter().any(|a| a == "--inspect") {
            renderer.inspect_unresolved(eye, target).await?;
        }
        if i + 1 == frames {
            if let Some(parent) = std::path::Path::new(&output).parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let file = std::fs::File::create(&output).map_err(|e| e.to_string())?;
            let mut encoder = png::Encoder::new(file, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .map_err(|e| e.to_string())?
                .write_image_data(&pixels)
                .map_err(|e| e.to_string())?;
        }
    }
    let text = serde_json::to_string_pretty(&reports).unwrap();
    std::fs::write(format!("{output}.json"), &text).map_err(|e| e.to_string())?;
    Ok(text)
}

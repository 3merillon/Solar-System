//! The space pass: stars, the Sun and bounded impostors of every body not in full detail. Its own
//! small program and bindings, off and one texel in size unless the solar system is on, so a single
//! body's renderer neither pays for it nor changes by a bit.
use crate::gpu::Gpu;

pub const MAX_BODIES: usize = 48;
pub const MAX_ASTEROIDS: usize = 100_000;
pub const MAX_TRAIL_POINTS: usize = 12_000;
/// Saturn's rings up close: shells of rocks around the eye, each four times coarser than the one inside it. Cell sizes, metres.
pub const RING_CELLS: [f64; 7] = [4.0, 16.0, 64.0, 256.0, 1024.0, 4096.0, 16384.0];
/// The belts up close: shells of rocks in three dimensions around the eye. Cell sizes, metres.
pub const BELT_CELLS: [f64; 5] = [300.0, 2_400.0, 19_200.0, 153_600.0, 1_228_800.0];
const BELT_REACH: u32 = 12;
const AU: f64 = 1.495_978_707e11;
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct BeltField {
    origin: [[i32; 4]; 5],
    fraction: [[f32; 4]; 5],
}
/// Cells from the eye each way in one shell, as the shader has it.
const RING_REACH: u32 = 48;
/// The nearest star's active regions (the model space.wgsl computed per pixel before 16 November 2026): computed once a frame
/// here, so the star's pixels read them from a uniform instead of each hashing twelve into a private array.
pub const MAX_REGIONS: usize = 12;
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct StarField {
    /// The star's seed and its region count.
    star: [f32; 4],
    /// Per region: centre and size, east and life, north and age in days, and the hash in two 16-bit halves.
    regions: [[f32; 4]; MAX_REGIONS * 4],
    /// The eye against an anchor point near it on the star (fixed axes, radii), and per fine octave the anchor's place in that
    /// octave's cells (the fraction), both from double precision: a single-precision point on the unit sphere resolves only
    /// about 6e-8 of the radius (40 m on the Sun), so the boiling's finest octaves are drawn from the eye outward.
    eye: [f32; 4],
    octaves: [[f32; 4]; OCTAVES],
    /// The anchor's place in granule widths, whole cells and the rest, from double precision: the granules' cells near the
    /// eye are found from it (space.wgsl `granule_place`).
    cells: [[f32; 4]; 2],
}
/// The boiling's octaves below the granules (space.wgsl), each a fifth the size of the one above.
pub const OCTAVES: usize = 10;
fn hash32(v: u32) -> u32 {
    let mut x = v;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^ (x >> 16)
}
fn unit_hash(h: u32) -> f32 {
    (h & 0xffff) as f32 / 65535.0
}
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
/// Active regions: up to 12 slots, each holding one region for a lifetime of 20 to 60 days and then a new one, in the active
/// latitudes 5 to 35 degrees, a bipolar pair tilted by a rule like Joy's law (half the latitude). Synthetic; see
/// docs/SOLAR-SYSTEM.md, "The Sun reworked".
/// A region's flare (the model space.wgsl computed per pixel before 17 November 2026): its impulse, and its phase, the time
/// since onset in decay times, negative with none. `clock`: the star's granule clock in lifetimes; `familiar`: the time-lapsed
/// schedule of the familiar view, or the physical one (up to three flares in the region's first 20 days).
fn region_flare(hash: u32, size: f32, age_days: f32, clock: f32, familiar: bool) -> (f32, f32) {
    let (mut impulse, mut phase) = (0.0_f32, -1.0_f32);
    let mut take = |f: f32, p: f32| {
        impulse = impulse.max(f);
        if phase < 0.0 || p < phase {
            phase = p;
        }
    };
    if familiar {
        let win = (clock / 6.0).floor();
        for k in 0..2 {
            let wk = win - k as f32;
            let hk = hash32(hash ^ ((wk + 4096.0) as u32).wrapping_mul(0x1656_67b1));
            if unit_hash(hk) > 0.35 + 0.4 * size {
                continue;
            }
            let dt = clock - (wk * 6.0 + unit_hash(hk >> 16) * 5.0);
            if dt > -0.15 && dt < 9.0 {
                take(
                    smoothstep(-0.15, 0.0, dt)
                        * (-dt.max(0.0) / 0.9).exp()
                        * (0.6 + 0.4 * unit_hash(hk >> 7)),
                    dt.max(0.0) / 0.9,
                );
            }
        }
    } else {
        for k in 0..3_u32 {
            let hk = hash32(hash ^ k.wrapping_mul(0x1656_67b1));
            if unit_hash(hk) > size * 0.8 {
                continue;
            }
            let dt = (age_days - unit_hash(hk >> 16) * 20.0) * 1440.0;
            if dt > -6.0 && dt < 240.0 {
                take(
                    smoothstep(-6.0, 0.0, dt) * (-dt.max(0.0) / 25.0).exp(),
                    dt.max(0.0) / 25.0,
                );
            }
        }
    }
    (impulse, phase)
}
/// Loops over a quiet region, and the points along each at which the ray's closest approach is first tried (space.wgsl
/// `region_loops`): numbers the shader reads rather than constants, so its compilers do not unroll the loops.
const REGION_LOOPS: f32 = 14.0;
const LOOP_POINTS: f32 = 12.0;
#[allow(clippy::too_many_arguments)]
fn star_regions(
    seed: u32,
    days: f32,
    activity: f32,
    eye: [f64; 3],
    granule: f64,
    clock: f32,
    familiar: bool,
    relief: f32,
) -> StarField {
    let count = (7.0 * activity).round().clamp(0.0, MAX_REGIONS as f32) as usize;
    let mut field = StarField {
        star: [seed as f32, count as f32, REGION_LOOPS, LOOP_POINTS],
        regions: [[0.0; 4]; MAX_REGIONS * 4],
        eye: [0.0; 4],
        octaves: [[0.0; 4]; OCTAVES],
        cells: [[0.0; 4]; 2],
    };
    // The anchor: the eye's place on a lattice of 1e-4 radii, so it moves only in steps, and the eye's offset from it is small.
    let lattice = 1e-4;
    let anchor = eye.map(|v| (v / lattice).round() * lattice);
    field.eye = [
        (eye[0] - anchor[0]) as f32,
        (eye[1] - anchor[1]) as f32,
        (eye[2] - anchor[2]) as f32,
        // The steps of the relief's march looking straight down (space.wgsl `star`); 0 for no relief.
        relief,
    ];
    for (k, a) in anchor.iter().enumerate() {
        let c = a / granule;
        field.cells[0][k] = c.floor() as f32;
        field.cells[1][k] = (c - c.floor()) as f32;
    }
    let mut size = granule * 0.2;
    for o in field.octaves.iter_mut() {
        let f = anchor.map(|v| {
            let c = v / size;
            // Kept within one period of the noise's lattice (the noise is not periodic, so the whole part matters too):
            // modulo 4096 cells, which a single float holds to 1/4096 of a cell.
            (c - (c / 4096.0).floor() * 4096.0) as f32
        });
        *o = [f[0], f[1], f[2], size as f32];
        size *= 0.2;
    }
    for i in 0..count {
        let h0 = hash32((i as u32).wrapping_mul(0x9e37_79b9) ^ seed);
        let period = 20.0 + 40.0 * unit_hash(h0);
        let shifted = days / period + unit_hash(h0 >> 16);
        let cycle = (shifted.floor() as u32) & 1023;
        let age = shifted - shifted.floor();
        let h = hash32(h0 ^ cycle.wrapping_mul(0x85eb_ca6b));
        let h2 = hash32(h ^ 0x27d4_eb2f);
        let sign = if h & 0x10000 != 0 { 1.0 } else { -1.0 };
        let lat = (5.0 + 30.0 * unit_hash(h)) * sign * 0.017_453_3_f32;
        let lon = unit_hash(h >> 17) * std::f32::consts::TAU;
        let centre = [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()];
        let east0 = [lon.cos(), 0.0, -lon.sin()];
        let north0 = cross3(centre, east0);
        let tilt = -sign * 0.5 * lat.abs();
        let east = [0, 1, 2].map(|k| east0[k] * tilt.cos() + north0[k] * tilt.sin());
        let north = cross3(centre, east);
        let size = 0.3 + 0.7 * unit_hash(h2).powi(2);
        let life = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.5, 1.0, age));
        let r = &mut field.regions[i * 4..i * 4 + 4];
        r[0] = [centre[0], centre[1], centre[2], size];
        r[1] = [east[0], east[1], east[2], life];
        let (impulse, phase) = region_flare(h2, size, age * period, clock, familiar);
        r[2] = [north[0], north[1], north[2], phase];
        r[3] = [(h2 & 0xffff) as f32, (h2 >> 16) as f32, age, impulse * life];
    }
    field
}
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct RingField {
    axes: [[f32; 4]; 3],
    eye: [f32; 4],
    sun: [f32; 4],
    origin: [[i32; 4]; 7],
    fraction: [[f32; 4]; 7],
}
pub const MAX_STARS: usize = 10_000;
const MAP_WIDTH: u32 = 1024;
const MAP_HEIGHT: u32 = 512;
const MAP_LEVELS: u32 = 7;
pub const MAP_LAYERS: u32 = 32;
const SKY_SIDE: u32 = 2048;
const SKY_PREVIEW_LEVEL: u32 = 4;
const PREVIEW_SIDE: u32 = SKY_SIDE >> SKY_PREVIEW_LEVEL;
const SKY_PREVIEW: &[u8; (6 * PREVIEW_SIDE * PREVIEW_SIDE * 3) as usize] =
    include_bytes!("../data/sky-preview.rgb");
const FAR_CLOUD_LEVELS: u32 = 6;
pub const SOURCE: &str = include_str!("../../../shaders/space.wgsl");

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct View {
    right: [f32; 4],
    up: [f32; 4],
    forward: [f32; 4],
    screen: [f32; 4],
    icrf: [[f32; 4]; 3],
    tone: [f32; 4],
    eye_sun: [f32; 4],
    starlight: [f32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, Default)]
pub struct Body {
    pub rect: [f32; 4],
    pub center: [f32; 4],
    pub shape: [f32; 4],
    pub sun: [f32; 4],
    pub axes: [[f32; 4]; 3],
    pub air: [f32; 4],
    pub beta: [f32; 4],
    pub ring: [f32; 4],
}
/// One-texel targets until `enable`. Composite always binds them.
struct Targets {
    color: wgpu::Texture,
    color_view: wgpu::TextureView,
    distance_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    /// The body in full detail as its far version, alone, for the dissolve between the two.
    active_view: wgpu::TextureView,
    width: u32,
    height: u32,
}
fn targets(g: &Gpu, width: u32, height: u32) -> Targets {
    let make = |label, format| {
        g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
    };
    let color = make("space colour", wgpu::TextureFormat::Rgba16Float);
    let active = make("space far planet", wgpu::TextureFormat::Rgba16Float);
    let distance = make("space distance", wgpu::TextureFormat::R32Float);
    let depth = make("space rock depth", wgpu::TextureFormat::Depth32Float);
    Targets {
        depth_view: depth.create_view(&Default::default()),
        active_view: active.create_view(&Default::default()),
        color_view: color.create_view(&Default::default()),
        color,
        distance_view: distance.create_view(&Default::default()),
        width,
        height,
    }
}
/// The largest resolved giant gets an independent view march. Keep the ring
/// sheet and its occultations on the full-resolution space target.
struct GiantTarget {
    size: [u32; 2],
    color: wgpu::TextureView,
    depth: wgpu::TextureView,
    group: wgpu::BindGroup,
}
impl GiantTarget {
    fn new(g: &Gpu, layout: &wgpu::BindGroupLayout, size: [u32; 2]) -> Self {
        let make = |label, format| {
            g.device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width: size[0],
                        height: size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let color = make("giant radiance", wgpu::TextureFormat::Rgba16Float);
        let depth = make("giant distance", wgpu::TextureFormat::R32Float);
        let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("giant reconstruction"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&color),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&depth),
                },
            ],
        });
        Self {
            size,
            color,
            depth,
            group,
        }
    }
}
struct Programs {
    giant_march: wgpu::RenderPipeline,
    giant_composite: wgpu::RenderPipeline,
    giant_layout: wgpu::BindGroupLayout,
    body: wgpu::RenderPipeline,
    body_active: wgpu::RenderPipeline,
    far_cloud_mip: wgpu::ComputePipeline,
    far_cloud_mips: Vec<(wgpu::BindGroup, [u32; 2])>,
    far_cloud_out: wgpu::TextureView,
    star: wgpu::RenderPipeline,
    sky: wgpu::RenderPipeline,
    sky_map: wgpu::Texture,
    asteroid: wgpu::RenderPipeline,
    belt: wgpu::RenderPipeline,
    asteroids: wgpu::Buffer,
    trail: wgpu::RenderPipeline,
    trails: wgpu::Buffer,
    rock: wgpu::RenderPipeline,
    rings: wgpu::Buffer,
    star_field: wgpu::Buffer,
    belt_rock: wgpu::RenderPipeline,
    belts: wgpu::Buffer,
    draw: wgpu::BindGroup,
    uniform: wgpu::Buffer,
    bodies: wgpu::Buffer,
    stars: wgpu::Buffer,
    maps: wgpu::Texture,
}
pub struct SpacePass {
    giant: Option<GiantTarget>,
    giant_index: Option<usize>,
    targets: Targets,
    /// Counts the targets' replacements, so whoever binds the colour view knows when it is another texture.
    pub serial: u32,
    /// The star the active regions were last computed for: its seed, clock in days and activity.
    star_seen: Option<(u32, f32, f32, f32, bool)>,
    programs: Option<Programs>,
    view: Option<View>,
    pub visible: Vec<Body>,
    /// The body in full detail as its far version, while the two are dissolving: drawn alone, after the rest.
    pub overlay: Option<Body>,
    pub stars_loaded: u32,
    pub maps_loaded: u32,
    pub sky_loaded: bool,
    trail_count: u32,
    /// Whether the eye is near enough to the ring plane for rocks.
    ring_on: bool,
    /// Whether the eye is inside a belt, with its light on, for rocks.
    pub belt_on: bool,
    sky_faces: u32,
    pub asteroids_loaded: u32,
    /// Brightness of the belts in magnitudes above the truth. Zero is true, and shows nothing.
    pub belt_gain: f32,
    /// The colour of the system star's light against the Sun's.
    pub starlight: [f32; 3],
    pub eye_sun: [f32; 3],
    /// Julian centuries from J2000, for proper motion, and the sky's brightness against the stars.
    pub centuries: f32,
    sky_scale: f32,
    pub daylight: f32,
}
impl SpacePass {
    pub fn new(g: &Gpu) -> Self {
        Self {
            giant: None,
            giant_index: None,
            targets: targets(g, 1, 1),
            serial: 0,
            star_seen: None,
            programs: None,
            view: None,
            visible: Vec::new(),
            overlay: None,
            stars_loaded: 0,
            maps_loaded: 0,
            sky_loaded: false,
            trail_count: 0,
            ring_on: false,
            belt_on: false,
            sky_faces: 0,
            asteroids_loaded: 0,
            belt_gain: 0.0,
            starlight: [1.0; 3],
            eye_sun: [0.0; 3],
            centuries: 0.0,
            sky_scale: 0.3,
            daylight: 1.0,
        }
    }
    pub fn enabled(&self) -> bool {
        self.programs.is_some()
    }
    pub fn color_view(&self) -> &wgpu::TextureView {
        &self.targets.color_view
    }
    /// The stars in front of the eye whose disks are at least partly seen, for the lens flare (finish.rs): each its place
    /// from the frame's centre in half heights (x right, y down) and its angular radius in the same unit; nearest the
    /// view's axis first.
    pub fn star_sources(&self) -> Vec<[f32; 4]> {
        let Some(v) = &self.view else {
            return Vec::new();
        };
        let dot = |a: &[f32; 4], b: &[f32; 4]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let tan = v.screen[3];
        let mut found: Vec<[f32; 4]> = self
            .visible
            .iter()
            .filter(|b| (b.shape[2] as u32) & 1 != 0 && b.sun[2] > 0.0)
            .filter_map(|b| {
                let ahead = dot(&b.center, &v.forward);
                (ahead > 0.0).then(|| {
                    [
                        dot(&b.center, &v.right) / ahead / tan,
                        -dot(&b.center, &v.up) / ahead / tan,
                        b.shape[3].tan() / tan,
                        1.0,
                    ]
                })
            })
            .collect();
        found.sort_by(|a, b| (a[0] * a[0] + a[1] * a[1]).total_cmp(&(b[0] * b[0] + b[1] * b[1])));
        found
    }
    /// The active regions of the star they were last computed for, for tests and captures that want to look at one: each its
    /// latitude and longitude in degrees in the star's fixed axes, its size (0.3 to 1), its life (0 to 1), its age as a share
    /// of its life, and its flare's phase (negative: none) and impulse.
    pub fn star_region_list(&self) -> Vec<[f32; 7]> {
        let Some((seed, days, activity, clock, familiar)) = self.star_seen else {
            return Vec::new();
        };
        let field = star_regions(seed, days, activity, [0.0; 3], 1.0, clock, familiar, 0.0);
        (0..field.star[1] as usize)
            .map(|i| {
                let r = &field.regions[i * 4..i * 4 + 4];
                [
                    r[0][1].clamp(-1.0, 1.0).asin().to_degrees(),
                    r[0][0].atan2(r[0][2]).to_degrees(),
                    r[0][3],
                    r[1][3],
                    r[3][2],
                    r[2][3],
                    r[3][3],
                ]
            })
            .collect()
    }
    /// The layer's colour, linear light, half floats: the whole frame when no surface pass ran.
    pub fn color(&self) -> &wgpu::Texture {
        &self.targets.color
    }
    pub fn active_view(&self) -> &wgpu::TextureView {
        &self.targets.active_view
    }
    /// The far cloud map's top level, for the surface program that fills it.
    pub fn far_cloud_out(&self) -> Option<&wgpu::TextureView> {
        self.programs.as_ref().map(|p| &p.far_cloud_out)
    }
    pub fn distance_view(&self) -> &wgpu::TextureView {
        &self.targets.distance_view
    }
    pub fn bytes(&self) -> u64 {
        let target = u64::from(self.targets.width * self.targets.height) * 12
            + self
                .giant
                .as_ref()
                .map_or(0, |t| u64::from(t.size[0] * t.size[1]) * 12);
        let maps = if self.programs.is_some() {
            u64::from(MAP_WIDTH * MAP_HEIGHT * 4 * MAP_LAYERS) * 4 / 3
        } else {
            0
        };
        target + maps
    }
    /// `far_cloud_width`: of the far cloud map, whose height is half that.
    pub(crate) fn enable(
        &mut self,
        g: &Gpu,
        width: u32,
        height: u32,
        far_cloud_width: u32,
        shape: &crate::clouds::CloudShape,
    ) {
        self.targets = targets(g, width, height);
        self.serial += 1;
        let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("space"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        use wgpu::BufferUsages as U;
        let uniform = g.buffer(
            "space view",
            std::mem::size_of::<View>() as u64,
            U::UNIFORM | U::COPY_DST,
        );
        let bodies = g.buffer(
            "space bodies",
            (std::mem::size_of::<Body>() * (MAX_BODIES + 1)) as u64,
            U::STORAGE | U::COPY_DST,
        );
        let stars = g.buffer("stars", (MAX_STARS * 32) as u64, U::STORAGE | U::COPY_DST);
        let belts = g.buffer(
            "belt field",
            std::mem::size_of::<BeltField>() as u64,
            U::UNIFORM | U::COPY_DST,
        );
        let rings = g.buffer(
            "ring field",
            std::mem::size_of::<RingField>() as u64,
            U::UNIFORM | U::COPY_DST,
        );
        let star_field = g.buffer(
            "star field",
            std::mem::size_of::<StarField>() as u64,
            U::UNIFORM | U::COPY_DST,
        );
        let trails = g.buffer(
            "orbit trails",
            (MAX_TRAIL_POINTS * 16) as u64,
            U::STORAGE | U::COPY_DST,
        );
        let asteroids = g.buffer(
            "asteroids",
            (MAX_ASTEROIDS * 48) as u64,
            U::STORAGE | U::COPY_DST,
        );
        let maps = g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("body maps"),
            size: wgpu::Extent3d {
                width: MAP_WIDTH,
                height: MAP_HEIGHT,
                depth_or_array_layers: MAP_LAYERS,
            },
            mip_level_count: MAP_LEVELS,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let far_clouds = g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("far clouds"),
            size: wgpu::Extent3d {
                width: far_cloud_width,
                height: far_cloud_width / 2,
                depth_or_array_layers: 1,
            },
            mip_level_count: FAR_CLOUD_LEVELS,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        });
        let far_level = |level: u32| {
            far_clouds.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: level,
                mip_level_count: Some(1),
                ..Default::default()
            })
        };
        let far_clouds_view = far_clouds.create_view(&Default::default());
        let sky_map = g.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("diffuse sky"),
            size: wgpu::Extent3d {
                width: SKY_SIDE,
                height: SKY_SIDE,
                depth_or_array_layers: 6,
            },
            mip_level_count: SKY_PREVIEW_LEVEL + 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let preview: Vec<u8> = SKY_PREVIEW
            .chunks_exact(3)
            .flat_map(|rgb| [rgb[0], rgb[1], rgb[2], 255])
            .collect();
        g.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &sky_map,
                mip_level: SKY_PREVIEW_LEVEL,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &preview,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(PREVIEW_SIDE * 4),
                rows_per_image: Some(PREVIEW_SIDE),
            },
            wgpu::Extent3d {
                width: PREVIEW_SIDE,
                height: PREVIEW_SIDE,
                depth_or_array_layers: 6,
            },
        );
        let sky_view = sky_map.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::Cube),
            ..Default::default()
        });
        let maps_view = maps.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("body map"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("space draw"),
                entries: &[
                    entry(
                        0,
                        wgpu::ShaderStages::VERTEX_FRAGMENT,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        1,
                        wgpu::ShaderStages::VERTEX_FRAGMENT,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        2,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2Array,
                            multisampled: false,
                        },
                    ),
                    entry(
                        3,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    ),
                    entry(
                        4,
                        wgpu::ShaderStages::VERTEX,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        11,
                        wgpu::ShaderStages::VERTEX,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        10,
                        wgpu::ShaderStages::VERTEX_FRAGMENT,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        9,
                        wgpu::ShaderStages::VERTEX,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        8,
                        wgpu::ShaderStages::VERTEX,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        49,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D3,
                            multisampled: false,
                        },
                    ),
                    entry(
                        87,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    ),
                    entry(
                        12,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                    ),
                    entry(
                        15,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                    ),
                    entry(
                        7,
                        wgpu::ShaderStages::FRAGMENT,
                        wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::Cube,
                            multisampled: false,
                        },
                    ),
                ],
            });
        let pipeline_layout = g
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("space draw"),
                bind_group_layouts: &[Some(&layout)],
                immediate_size: 0,
            });
        let sample = |binding, filterable| {
            entry(
                binding,
                wgpu::ShaderStages::FRAGMENT,
                wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            )
        };
        let giant_layout = g
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("giant reconstruction"),
                entries: &[sample(0, true), sample(1, false)],
            });
        let composite_layout = g
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("giant composite"),
                bind_group_layouts: &[Some(&layout), Some(&giant_layout)],
                immediate_size: 0,
            });
        let colour = |blend: wgpu::BlendState| {
            [
                Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba16Float,
                    blend: Some(blend),
                    write_mask: wgpu::ColorWrites::ALL,
                }),
                Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::R32Float,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                }),
            ]
        };
        let over = wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING;
        let add = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::Zero,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
        };
        let mut star_targets = colour(add);
        if let Some(t) = &mut star_targets[1] {
            t.write_mask = wgpu::ColorWrites::empty();
        }
        let pipeline = |label, vertex, fragment, targets: &[Option<wgpu::ColorTargetState>]| {
            g.device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(if fragment == "giant_composite" {
                        &composite_layout
                    } else {
                        &pipeline_layout
                    }),
                    vertex: wgpu::VertexState {
                        module: &module,
                        entry_point: Some(vertex),
                        buffers: &[],
                        compilation_options: Default::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some(fragment),
                        targets,
                        compilation_options: Default::default(),
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
        };
        let giant_march = pipeline(
            "giant atmosphere",
            "body_vertex",
            "giant_march",
            &colour(over),
        );
        let giant_composite = pipeline(
            "giant composite",
            "body_vertex",
            "giant_composite",
            &colour(over),
        );
        let body = pipeline(
            "space bodies",
            "body_vertex",
            "body_fragment",
            &colour(over),
        );
        // The same program, to the far planet's own target: a shader output with no target goes nowhere.
        let body_active = pipeline(
            "space far planet",
            "body_vertex",
            "body_fragment",
            &colour(over)[..1],
        );
        let star = pipeline("stars", "star_vertex", "star_fragment", &star_targets);
        let sky = pipeline("space sky", "sky_vertex", "sky_fragment", &star_targets);
        let belt = pipeline("space belt", "belt_vertex", "belt_fragment", &star_targets);
        let trail = pipeline(
            "space trails",
            "trail_vertex",
            "trail_fragment",
            &star_targets,
        );
        // Rocks, in a pass of their own after everything else, the only things here that need a depth buffer: they hide each other.
        let rock_targets = [
            Some(wgpu::ColorTargetState {
                format: wgpu::TextureFormat::Rgba16Float,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            }),
            Some(wgpu::ColorTargetState {
                format: wgpu::TextureFormat::R32Float,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            }),
        ];
        let rock_pipeline = |label, vertex| {
            g.device
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&pipeline_layout),
                    vertex: wgpu::VertexState {
                        module: &module,
                        entry_point: Some(vertex),
                        buffers: &[],
                        compilation_options: Default::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("ring_rock_fragment"),
                        targets: &rock_targets,
                        compilation_options: Default::default(),
                    }),
                    primitive: Default::default(),
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth32Float,
                        depth_write_enabled: Some(true),
                        depth_compare: Some(wgpu::CompareFunction::Less),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
        };
        let rock = rock_pipeline("space ring rocks", "ring_rock_vertex");
        let belt_rock = rock_pipeline("space belt rocks", "belt_rock_vertex");
        let asteroid = g
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("space asteroids"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("asteroid_vertex"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("asteroid_fragment"),
                    targets: &star_targets,
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::PointList,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
        // Explicit layouts for the two compute programs: get_bind_group_layout on a pipeline created synchronously
        // waits for the browser to finish compiling it, and at startup that queue holds every other program
        // (5.2 s of a blocked worker on 5 Nov 2026, docs/STARTUP.md).
        let compute_layout = |label, entries: &[wgpu::BindGroupLayoutEntry]| {
            let group = g
                .device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some(label),
                    entries,
                });
            let pipeline = g
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some(label),
                    bind_group_layouts: &[Some(&group)],
                    immediate_size: 0,
                });
            (group, pipeline)
        };
        let unfiltered = |binding| {
            entry(
                binding,
                wgpu::ShaderStages::COMPUTE,
                wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            )
        };
        let written = |binding, format| {
            entry(
                binding,
                wgpu::ShaderStages::COMPUTE,
                wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
            )
        };
        let (mip_group_layout, mip_layout) = compute_layout(
            "far cloud levels",
            &[
                unfiltered(13),
                written(14, wgpu::TextureFormat::Rgba16Float),
            ],
        );
        let far_cloud_mip = g
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("far cloud levels"),
                layout: Some(&mip_layout),
                module: &module,
                entry_point: Some("far_cloud_mip"),
                compilation_options: Default::default(),
                cache: None,
            });
        let far_cloud_mips = (1..FAR_CLOUD_LEVELS)
            .map(|level| {
                let (from, to) = (far_level(level - 1), far_level(level));
                let group = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("far cloud level"),
                    layout: &mip_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 13,
                            resource: wgpu::BindingResource::TextureView(&from),
                        },
                        wgpu::BindGroupEntry {
                            binding: 14,
                            resource: wgpu::BindingResource::TextureView(&to),
                        },
                    ],
                });
                (
                    group,
                    [far_cloud_width >> level, (far_cloud_width / 2) >> level],
                )
            })
            .collect();
        let draw = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("space draw"),
            layout: &layout,
            entries: &[
                shape.entries()[0].clone(),
                shape.entries()[1].clone(),
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: bodies.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&maps_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: stars.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: wgpu::BindingResource::TextureView(&sky_view),
                },
                wgpu::BindGroupEntry {
                    binding: 12,
                    resource: wgpu::BindingResource::TextureView(&far_clouds_view),
                },
                wgpu::BindGroupEntry {
                    binding: 8,
                    resource: asteroids.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 9,
                    resource: trails.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 10,
                    resource: rings.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 11,
                    resource: belts.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 15,
                    resource: star_field.as_entire_binding(),
                },
            ],
        });
        // A grey map until a body's own arrives: it says "no map yet" and does not pretend.
        upload_constant_maps(g, &maps, [150; 4]);
        self.programs = Some(Programs {
            giant_layout,
            giant_march,
            giant_composite,
            body,
            body_active,
            far_cloud_mip,
            far_cloud_mips,
            far_cloud_out: far_level(0),
            star,
            sky,
            sky_map,
            asteroid,
            belt,
            asteroids,
            trail,
            trails,
            rock,
            rings,
            star_field,
            belt_rock,
            belts,
            draw,
            uniform,
            bodies,
            stars,
            maps,
        });
    }
    pub fn resize(&mut self, g: &Gpu, width: u32, height: u32) {
        if self.enabled() && (width != self.targets.width || height != self.targets.height) {
            self.targets = targets(g, width, height);
            self.serial += 1;
        }
    }
    /// Rows of directions and magnitudes, as the stars file holds them.
    pub fn load_stars(&mut self, g: &Gpu, data: &[f32]) {
        let Some(p) = &self.programs else {
            return;
        };
        let count = (data.len() / 8).min(MAX_STARS);
        g.queue
            .write_buffer(&p.stars, 0, bytemuck::cast_slice(&data[..count * 8]));
        self.stars_loaded = count as u32;
    }
    /// The ring's frame this frame, or none away from its plane. The eye's cell in each shell is worked out here in f64: a f32
    /// cannot hold a place 100,000 km out to a 4 m cell.
    pub fn set_ring_field(&mut self, g: &Gpu, words: Option<&[f64]>) {
        let Some(p) = &self.programs else {
            return;
        };
        self.ring_on = words.is_some();
        let Some(w) = words else {
            return;
        };
        let row = |at: usize, last: f32| [w[at] as f32, w[at + 1] as f32, w[at + 2] as f32, last];
        let mut origin = [[0i32; 4]; 7];
        let mut fraction = [[0f32; 4]; 7];
        for (i, cell) in RING_CELLS.iter().enumerate() {
            let (x, y) = (w[9] / cell, w[10] / cell);
            origin[i] = [x.floor() as i32, y.floor() as i32, 0, 0];
            fraction[i] = [
                (x - x.floor()) as f32,
                (y - y.floor()) as f32,
                *cell as f32,
                0.0,
            ];
        }
        let field = RingField {
            axes: [row(0, 0.0), row(3, 0.0), row(6, 0.0)],
            // Saturn's equatorial and polar radii ride in the spare lanes.
            eye: row(9, w[15] as f32),
            sun: row(12, w[16] as f32),
            origin,
            fraction,
        };
        g.queue
            .write_buffer(&p.rings, 0, bytemuck::bytes_of(&field));
    }
    /// The nearest star's active regions for this frame, from its seed, clock in days and activity (its body row).
    #[allow(clippy::too_many_arguments)]
    pub fn set_star_field(
        &mut self,
        g: &Gpu,
        seed: u32,
        days: f32,
        activity: f32,
        eye: [f64; 3],
        granule: f64,
        clock: f32,
        familiar: bool,
        relief: f32,
    ) {
        let Some(p) = &self.programs else {
            return;
        };
        let field = star_regions(seed, days, activity, eye, granule, clock, familiar, relief);
        self.star_seen = Some((seed, days, activity, clock, familiar));
        g.queue
            .write_buffer(&p.star_field, 0, bytemuck::bytes_of(&field));
    }
    /// The eye's cell in each shell of the belt's rocks, from its place against the Sun in f64. Cells wrap in an i32, which only the
    /// hash reads. On only inside a belt, and with its light raised at all: at true brightness there are only the real asteroids.
    pub fn set_belt_field(&mut self, g: &Gpu, eye_sun: [f64; 3], gain: f64) {
        let Some(p) = &self.programs else {
            return;
        };
        let r = (eye_sun[0] * eye_sun[0] + eye_sun[1] * eye_sun[1] + eye_sun[2] * eye_sun[2])
            .sqrt()
            / AU;
        self.belt_on = gain > 0.0 && ((1.7..4.4).contains(&r) || (28.0..60.0).contains(&r));
        if !self.belt_on {
            return;
        }
        let mut origin = [[0i32; 4]; 5];
        let mut fraction = [[0f32; 4]; 5];
        for (i, cell) in BELT_CELLS.iter().enumerate() {
            let c = eye_sun.map(|v| v / cell);
            origin[i] = [
                c[0].floor() as i64 as i32,
                c[1].floor() as i64 as i32,
                c[2].floor() as i64 as i32,
                0,
            ];
            fraction[i] = [
                (c[0] - c[0].floor()) as f32,
                (c[1] - c[1].floor()) as f32,
                (c[2] - c[2].floor()) as f32,
                *cell as f32,
            ];
        }
        g.queue.write_buffer(
            &p.belts,
            0,
            bytemuck::bytes_of(&BeltField { origin, fraction }),
        );
    }
    /// The rock pass: nothing unless the eye is among rocks.
    pub fn encode_rocks(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let Some(p) = &self.programs else {
            return;
        };
        if !self.ring_on && !self.belt_on {
            return;
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("space ring rocks"),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.distance_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                }),
            ],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &self.targets.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_bind_group(0, &p.draw, &[]);
        if self.ring_on {
            pass.set_pipeline(&p.rock);
            let side = 2 * RING_REACH + 1;
            pass.draw(0..6, 0..side * side * RING_CELLS.len() as u32);
        }
        if self.belt_on {
            pass.set_pipeline(&p.belt_rock);
            let side = 2 * BELT_REACH + 1;
            pass.draw(0..6, 0..side * side * side * BELT_CELLS.len() as u32);
        }
    }
    /// This frame's orbit trails, as `solar::SolarWorld::trail_points` makes them. Empty draws none.
    pub fn set_trails(&mut self, g: &Gpu, data: &[f32]) {
        let Some(p) = &self.programs else {
            return;
        };
        let count = (data.len() / 4).min(MAX_TRAIL_POINTS);
        if count > 0 {
            g.queue
                .write_buffer(&p.trails, 0, bytemuck::cast_slice(&data[..count * 4]));
        }
        self.trail_count = count as u32;
    }
    /// Asteroid orbits, 12 floats each, as tools/Bake-Asteroids.mjs writes them.
    pub fn load_asteroids(&mut self, g: &Gpu, data: &[f32]) {
        let Some(p) = &self.programs else {
            return;
        };
        let count = (data.len() / 12).min(MAX_ASTEROIDS);
        g.queue
            .write_buffer(&p.asteroids, 0, bytemuck::cast_slice(&data[..count * 12]));
        self.asteroids_loaded = count as u32;
    }
    /// One face of the sky, at both its levels, RGBA, sRGB: 2048 and 1024 square. It shows once all six have come.
    pub fn load_sky_face(
        &mut self,
        g: &Gpu,
        face: u32,
        top: &[u8],
        half: &[u8],
        scale: f32,
    ) -> Result<(), String> {
        let Some(p) = &self.programs else {
            return Ok(());
        };
        if face >= 6
            || top.len() != (SKY_SIDE * SKY_SIDE * 4) as usize
            || half.len() != (SKY_SIDE * SKY_SIDE) as usize
        {
            return Err("a sky face is 2048 and 1024 square, RGBA".into());
        }
        for (level, bytes) in [top, half].iter().enumerate() {
            let side = SKY_SIDE >> level;
            g.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &p.sky_map,
                    mip_level: level as u32,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: face,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(side * 4),
                    rows_per_image: Some(side),
                },
                wgpu::Extent3d {
                    width: side,
                    height: side,
                    depth_or_array_layers: 1,
                },
            );
        }
        self.sky_faces |= 1 << face;
        self.sky_loaded = self.sky_faces == 0b11_1111;
        self.sky_scale = scale;
        Ok(())
    }
    /// One body's equirectangular map, RGBA, sRGB, MAP_WIDTH x MAP_HEIGHT.
    pub fn load_map(&mut self, g: &Gpu, layer: u32, rgba: &[u8]) -> Result<(), String> {
        let Some(p) = &self.programs else {
            return Ok(());
        };
        if layer >= MAP_LAYERS || rgba.len() != (MAP_WIDTH * MAP_HEIGHT * 4) as usize {
            return Err("a body map is 1024 x 512 RGBA".into());
        }
        upload_map(g, &p.maps, layer, rgba);
        self.maps_loaded += 1;
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    pub fn set_view(
        &mut self,
        g: &Gpu,
        right: [f32; 3],
        up: [f32; 3],
        forward: [f32; 3],
        width: u32,
        height: u32,
        icrf: [[f32; 3]; 3],
        jitter: [f32; 2],
        sky_radiance: f32,
        atmosphere_steps: u32,
        cloud_scale: u32,
        cloud_steps: u32,
    ) {
        let Some(p) = &self.programs else {
            return;
        };
        // Full-resolution giant silhouettes and cloud heads on the desktop presets.
        let cloud_scale = if cloud_scale == 2 && atmosphere_steps >= 12 {
            1
        } else {
            cloud_scale
        };
        self.giant_index = (0..self.visible.len().min(MAX_BODIES))
            .filter(|&i| {
                cloud_scale > 1
                    && self.visible[i].shape[2] == 4.0
                    && self.visible[i].shape[3] > 0.04
            })
            .max_by(|&a, &b| self.visible[a].shape[3].total_cmp(&self.visible[b].shape[3]));
        let size = [width.div_ceil(cloud_scale), height.div_ceil(cloud_scale)];
        if self.giant_index.is_some() && self.giant.as_ref().is_none_or(|t| t.size != size) {
            self.giant = Some(GiantTarget::new(g, &p.giant_layout, size));
        } else if self.giant_index.is_none() {
            self.giant = None;
        }
        let word = |v: [f32; 3]| [v[0], v[1], v[2], 0.0];
        let mut view = View {
            right: [right[0], right[1], right[2], jitter[0]],
            up: [up[0], up[1], up[2], jitter[1]],
            forward: [forward[0], forward[1], forward[2], atmosphere_steps as f32],
            screen: [
                width as f32,
                height as f32,
                width as f32 / height as f32,
                (30.0_f32.to_radians()).tan(),
            ],
            icrf: icrf.map(word),
            tone: [sky_radiance, self.centuries, self.sky_scale, self.belt_gain],
            eye_sun: [
                self.eye_sun[0],
                self.eye_sun[1],
                self.eye_sun[2],
                self.visible.len().min(MAX_BODIES) as f32,
            ],
            starlight: [
                self.starlight[0],
                self.starlight[1],
                self.starlight[2],
                if self.sky_loaded {
                    0.0
                } else {
                    SKY_PREVIEW_LEVEL as f32
                },
            ],
        };
        view.icrf[0][3] = size[0] as f32;
        view.icrf[1][3] = size[1] as f32;
        view.icrf[2][3] = cloud_steps as f32;
        g.queue
            .write_buffer(&p.uniform, 0, bytemuck::bytes_of(&view));
        self.view = Some(view);
        let count = self.visible.len().min(MAX_BODIES);
        g.queue
            .write_buffer(&p.bodies, 0, bytemuck::cast_slice(&self.visible[..count]));
        if let Some(body) = &self.overlay {
            g.queue.write_buffer(
                &p.bodies,
                (count * std::mem::size_of::<Body>()) as u64,
                bytemuck::bytes_of(body),
            );
        }
    }
    /// The body in full detail as its far version, to its own target.
    pub fn encode_active(&self, encoder: &mut wgpu::CommandEncoder) {
        let Some(p) = &self.programs else {
            return;
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("space far planet"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &self.targets.active_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        // The active planet may be behind the camera during a representation
        // fade. Clear even with no overlay, or the previous planet's disk and
        // clouds reappear from this persistent target.
        if self.overlay.is_none() {
            return;
        }
        pass.set_bind_group(0, &p.draw, &[]);
        pass.set_pipeline(&p.body_active);
        let at = self.visible.len().min(MAX_BODIES) as u32;
        let full = self.overlay.is_some_and(|b| b.rect[2] >= 4.0);
        pass.draw(0..if full { 3 } else { 6 }, at..at + 1);
    }
    /// The far cloud map's lower levels, from its top one.
    pub fn encode_far_cloud_levels(&self, pass: &mut wgpu::ComputePass<'_>) {
        let Some(p) = &self.programs else {
            return;
        };
        pass.set_pipeline(&p.far_cloud_mip);
        for (group, size) in &p.far_cloud_mips {
            pass.set_bind_group(0, group, &[]);
            pass.dispatch_workgroups(size[0].div_ceil(8), size[1].div_ceil(8), 1);
        }
    }
    pub fn encode(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let Some(p) = &self.programs else {
            return;
        };
        if let (Some(i), Some(t)) = (self.giant_index, &self.giant) {
            let attachment = |view| {
                Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("giant atmosphere"),
                color_attachments: &[attachment(&t.color), attachment(&t.depth)],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&p.giant_march);
            pass.set_bind_group(0, &p.draw, &[]);
            let vertices = if self.visible[i].rect[2] >= 4.0 { 3 } else { 6 };
            pass.draw(0..vertices, i as u32..i as u32 + 1);
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("space"),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.distance_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
            ],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_bind_group(0, &p.draw, &[]);
        pass.set_pipeline(&p.sky);
        pass.draw(0..3, 0..1);
        if self.belt_gain > 0.0 {
            pass.set_pipeline(&p.belt);
            pass.draw(0..3, 0..1);
        }
        if self.stars_loaded > 0 {
            pass.set_pipeline(&p.star);
            pass.draw(0..6, 0..self.stars_loaded);
        }
        if self.asteroids_loaded > 0 && self.belt_gain > 0.0 {
            pass.set_pipeline(&p.asteroid);
            pass.draw(0..self.asteroids_loaded, 0..1);
        }
        for i in 0..self.visible.len().min(MAX_BODIES) as u32 {
            if let Some(t) = self
                .giant
                .as_ref()
                .filter(|_| self.giant_index == Some(i as usize))
            {
                pass.set_pipeline(&p.giant_composite);
                pass.set_bind_group(1, &t.group, &[]);
            } else {
                pass.set_pipeline(&p.body);
            }
            let full = self.visible[i as usize].rect[2] >= 4.0;
            pass.draw(0..if full { 3 } else { 6 }, i..i + 1);
        }
        // After the bodies, each fragment testing itself against them all: a line can pass in front of one or behind it.
        if self.trail_count > 1 {
            pass.set_pipeline(&p.trail);
            pass.draw(0..6, 0..self.trail_count - 1);
        }
    }
}
fn entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    ty: wgpu::BindingType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty,
        count: None,
    }
}
fn upload_map(g: &Gpu, maps: &wgpu::Texture, layer: u32, rgba: &[u8]) {
    let (mut w, mut h) = (MAP_WIDTH, MAP_HEIGHT);
    let mut level_data = rgba.to_vec();
    for level in 0..MAP_LEVELS {
        g.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: maps,
                mip_level: level,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: layer,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &level_data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w * 4),
                rows_per_image: Some(h),
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        if level + 1 == MAP_LEVELS {
            break;
        }
        level_data = halved(&level_data, w as usize, h as usize);
        w /= 2;
        h /= 2;
    }
}
/// Every layer's mip chain of a constant image, as `upload_map` would build it: each level of a constant image is
/// constant, and its value is `halved` of four equal texels (the same arithmetic, on a 2 x 2 tile). Building the
/// placeholder chains texel by texel took 5.2 s of WASM at startup (32 layers, powf per channel; docs/STARTUP.md).
fn upload_constant_maps(g: &Gpu, maps: &wgpu::Texture, value: [u8; 4]) {
    let (mut w, mut h) = (MAP_WIDTH, MAP_HEIGHT);
    let mut texel = value;
    let mut encoder = g
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("placeholder body maps"),
        });
    for level in 0..MAP_LEVELS {
        // Layer 0 from the CPU, the others copied from it on the GPU: the same bytes without 80 MB of uploads.
        g.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: maps,
                mip_level: level,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &texel.repeat((w * h) as usize),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w * 4),
                rows_per_image: Some(h),
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        for layer in 1..MAP_LAYERS {
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: maps,
                    mip_level: level,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: maps,
                    mip_level: level,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: layer,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
            );
        }
        let next = halved(&texel.repeat(4), 2, 2);
        texel = [next[0], next[1], next[2], next[3]];
        w /= 2;
        h /= 2;
    }
    g.queue.submit([encoder.finish()]);
}
/// Mean of 2 x 2 texels in linear light.
fn halved(src: &[u8], w: usize, h: usize) -> Vec<u8> {
    fn linear(v: u8) -> f32 {
        let v = f32::from(v) / 255.0;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    }
    fn encoded(v: f32) -> u8 {
        let e = if v <= 0.003_130_8 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        };
        (e * 255.0 + 0.5) as u8
    }
    // A byte has 256 values: the same linear() values from a table, without four powf per channel and texel.
    let table: [f32; 256] = std::array::from_fn(|v| linear(v as u8));
    let (nw, nh) = (w / 2, h / 2);
    let mut out = vec![255u8; nw * nh * 4];
    for y in 0..nh {
        for x in 0..nw {
            for k in 0..3 {
                let at = |yy: usize, xx: usize| table[src[(yy * w + xx) * 4 + k] as usize];
                let mean = (at(2 * y, 2 * x)
                    + at(2 * y, 2 * x + 1)
                    + at(2 * y + 1, 2 * x)
                    + at(2 * y + 1, 2 * x + 1))
                    * 0.25;
                out[(y * nw + x) * 4 + k] = encoded(mean);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn constant_map_levels_match_halving_the_full_image() {
        for value in [[150u8; 4], [3, 77, 200, 255]] {
            let (mut w, mut h) = (16usize, 8usize);
            let mut full = value.repeat(w * h);
            let mut texel = value;
            for _ in 0..3 {
                full = super::halved(&full, w, h);
                let next = super::halved(&texel.repeat(4), 2, 2);
                texel = [next[0], next[1], next[2], next[3]];
                assert!(full.chunks(4).all(|t| t == texel));
                w /= 2;
                h /= 2;
            }
        }
    }
}

//! GPU residency of measured pages: atlases, clip table, and a bounded upload per frame.
//! The CPU uploads source pages here and nothing else: never a cut, mesh or vertex.
//! A body without pages keeps one-texel placeholders, so its payload does not grow.
use crate::{data_lag::DataLag, gpu::Gpu};
use solar_core::{
    field::V3,
    pages::{
        HeightPage, PageField, PageKey, ALBEDO_PAGE_BYTES, HEIGHT_PAGE_BYTES, MAX_PAGE_LEVEL,
        PAGES_PER_LAYER_SIDE, PAGE_TEXELS,
    },
    streaming::{
        ChannelSpec, Commands, SharpRegion, Stream, StreamCamera, StreamConfig, CHANNEL_ALBEDO,
        CHANNEL_HEIGHT, SLOTS_PER_LAYER, TABLE_LAYERS, WINDOW,
    },
};
use std::collections::{HashMap, VecDeque};

/// Row of `page_meta` holding one (x, y) window origin per table layer.
const ORIGIN_ROW: u32 = 5;
const META_WIDTH: u32 = 256;
/// First row of `page_meta` holding the arrival frame of each height slot. Five rows, as for the
/// parameters, which cover the largest pool.
const HEIGHT_ARRIVAL_ROW: u32 = 14;
/// First row of `page_meta` holding water levels: one row per height slot, 32 x 32 values in RGBA.
/// Beside the page's other parameters because the water program has no binding to spare.
const WATER_ROW: u32 = 19;
/// First row of `page_meta` holding the arrival frame of each imagery slot.
const ALBEDO_ROW: u32 = 6;
/// The water layer's parameters per height slot (docs/WATER-LAYER.md): rows 0 to 4 beside the slot's own parameters,
/// from this column. x: the water slot (0 and up), or WATER_DRY (no water within the band), WATER_UNIFORM (one body
/// over the whole page: y its kind, z its level), WATER_UNKNOWN (no water layer for this page: the old water reads
/// stand), WATER_EVICTED (its water slot went to another page: a coarser page's water is read). With a slot: y the
/// level offset, z the level scale.
const WATER_LAYER_X: u32 = 256;
const WATER_DRY: f32 = -1.0;
const WATER_UNIFORM: f32 = -2.0;
const WATER_UNKNOWN: f32 = -3.0;
const WATER_EVICTED: f32 = -4.0;
/// Water layer texels per page: RGBA16 (distance, level, coverage | kind | fetch, flow).
pub const WATER_PAGE_BYTES: usize = PAGE_TEXELS * PAGE_TEXELS * 8;
/// Water pages resident at once, per allocation tier: one layer of the atlas (225 pages, about 128 MB) on the full and
/// reduced tiers, its first eight rows (120 pages, about 69 MB) on the minimal one, where the height pool holds 675
/// pages. A page past them takes the slot of the page the view needs least (write_water); the page that loses it, or
/// that finds every slot more needed than itself, reads a coarser page's water, and the loss is counted
/// (water_layer.evicted). Slots keep the layer's 15 columns, so the shader's arithmetic is the
/// same on every tier.
pub fn water_slots(tier: &crate::tier::Tier) -> u32 {
    match tier.name {
        "full" => 2 * SLOTS_PER_LAYER,
        "reduced" => SLOTS_PER_LAYER,
        _ => 8 * PAGES_PER_LAYER_SIDE,
    }
}
/// A water page as it arrives, beside its height page.
struct WaterArrived {
    level_offset: f32,
    level_scale: f32,
    /// -1 texels, -2 dry, 0..3 one body of this kind over the whole page.
    kind: i32,
    level: f32,
    bytes: Vec<u8>,
}
#[derive(Default, Clone, Copy, serde::Serialize)]
pub struct WaterLayerCounts {
    pub pages: u32,
    pub dry: u32,
    pub uniform: u32,
    pub resident: u32,
    pub evicted: u32,
}
/// Upload limits per frame. Unused budget does not accumulate.
const PAGES_PER_FRAME: usize = 4;
const TABLE_LAYERS_PER_FRAME: usize = 24;

/// SWISSIMAGE through its bounding box; the worker feathers the overlay at its real border.
const SHARP_IMAGERY: &[SharpRegion] = &[SharpRegion {
    lon: [5.9, 10.5],
    lat: [45.8, 47.9],
    max_level: 16,
}];
/// Pools per allocation tier: height slots, albedo slots.
pub fn pool_slots(tier: &crate::tier::Tier) -> (u32, u32) {
    match tier.name {
        "full" => (5 * SLOTS_PER_LAYER, 7 * SLOTS_PER_LAYER),
        "reduced" => (4 * SLOTS_PER_LAYER, 5 * SLOTS_PER_LAYER),
        _ => (3 * SLOTS_PER_LAYER, 3 * SLOTS_PER_LAYER),
    }
}
/// What every program that reads the field binds. Clones share the GPU resources.
#[derive(Clone)]
pub struct PageBindings {
    table: wgpu::TextureView,
    heights: wgpu::TextureView,
    meta: wgpu::TextureView,
    albedo: wgpu::TextureView,
    sampler: wgpu::Sampler,
    water: wgpu::TextureView,
}
impl PageBindings {
    /// Exactly the page bindings this specialized program kept after compaction.
    pub fn entries(&self, key: &str) -> Vec<wgpu::BindGroupEntry<'_>> {
        crate::startup::program_bindings(key)
            .iter()
            .filter_map(|b| self.entry(*b))
            .collect()
    }
    /// For audit programs compiled outside the specialized registry.
    pub fn audit_entries(&self) -> Vec<wgpu::BindGroupEntry<'_>> {
        [110, 111, 112, 113, 114, 115]
            .iter()
            .filter_map(|b| self.entry(*b))
            .collect()
    }
    fn entry(&self, binding: u32) -> Option<wgpu::BindGroupEntry<'_>> {
        let resource = match binding {
            110 => wgpu::BindingResource::TextureView(&self.table),
            111 => wgpu::BindingResource::TextureView(&self.heights),
            112 => wgpu::BindingResource::TextureView(&self.meta),
            113 => wgpu::BindingResource::TextureView(&self.albedo),
            114 => wgpu::BindingResource::Sampler(&self.sampler),
            115 => wgpu::BindingResource::TextureView(&self.water),
            _ => return None,
        };
        Some(wgpu::BindGroupEntry { binding, resource })
    }
}
/// With a page's source bits: it went up without the image its shore would come from, and is to be asked for again.
const PROVISIONAL: u8 = 128;
struct Arrived {
    channel: u8,
    key: PageKey,
    offset: f32,
    scale: f32,
    /// Bit mask of the sources in this page, for attribution of the data in view.
    sources: u8,
    bytes: Vec<u8>,
    /// Empty: sea level everywhere, for the pinned pack. One value: the whole page. Else the grid.
    water: Vec<f32>,
}
/// Note when a page came on screen, for its fade in.
fn stamp_arrival(g: &Gpu, meta: &wgpu::Texture, first_row: u32, slot: u32, frame: u64) {
    let arrival = [frame as f32, 0.0, 0.0, 0.0];
    g.queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: meta,
            mip_level: 0,
            origin: wgpu::Origin3d {
                x: slot % META_WIDTH,
                y: first_row + slot / META_WIDTH,
                z: 0,
            },
            aspect: wgpu::TextureAspect::All,
        },
        bytemuck::cast_slice(&arrival),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(16),
            rows_per_image: Some(1),
        },
        wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
    );
}
pub struct PageAtlas {
    measured: bool,
    height_max: u8,
    albedo_max: u8,
    radius: f64,
    clipmap_pending: u32,
    clipmap_cursor: u32,
    table: wgpu::Texture,
    pub table_view: wgpu::TextureView,
    heights: wgpu::Texture,
    pub heights_view: wgpu::TextureView,
    meta: wgpu::Texture,
    pub meta_view: wgpu::TextureView,
    albedo: wgpu::Texture,
    pub albedo_view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    water: wgpu::Texture,
    pub water_view: wgpu::TextureView,
    water_pending: HashMap<PageKey, WaterArrived>,
    water_slots: HashMap<PageKey, u32>,
    /// Water slots on this tier (water_slots).
    water_count: u32,
    water_free: Vec<u32>,
    water_order: VecDeque<PageKey>,
    pub water_layer: WaterLayerCounts,
    bytes: u64,
    pub stream: Option<Stream>,
    pub cpu: Option<PageField>,
    arrived: VecDeque<Arrived>,
    page_sources: HashMap<(u8, PageKey), u8>,
    pinned_sources: u8,
    commands: Commands,
    /// Advances whenever the height table changes; wakes GPU selection.
    pub height_serial: u32,
    pub albedo_serial: u32,
    /// Levels of height pages uploaded since the last frame, for clipmap invalidation.
    pub height_arrivals: Vec<PageKey>,
    pub lag: DataLag,
    /// Page uploads since the body last changed, for telling when its pinned pages are in.
    pub uploaded_since_switch: u32,
    /// What a page with no water grid says about water: sea level, or none at all.
    water_default: f32,
    specs: [ChannelSpec; 2],
}
/// Height and imagery pages of D0 to D2 on all six faces: enough to draw any view coarsely.
const PINNED_READY: u32 = 2 * 6 * (1 + 4 + 16);
impl PageAtlas {
    pub fn new(
        g: &Gpu,
        tier: &crate::tier::Tier,
        measured: bool,
        height_max: u8,
        albedo_max: u8,
    ) -> Self {
        let (height_slots, albedo_slots) = pool_slots(tier);
        let layers = |slots: u32| slots.div_ceil(SLOTS_PER_LAYER);
        let side = PAGES_PER_LAYER_SIDE * PAGE_TEXELS as u32 + 136;
        let texture = |label, width: u32, height: u32, depth: u32, format| {
            g.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: depth,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            })
        };
        // A placeholder keeps bindings valid; the procedural branch never reads it.
        let (table_side, table_layers, atlas_side, height_layers, albedo_layers, meta_w, meta_h) =
            if measured {
                (
                    WINDOW,
                    TABLE_LAYERS,
                    side,
                    layers(height_slots),
                    layers(albedo_slots),
                    META_WIDTH * 2,
                    WATER_ROW + height_slots * 4,
                )
            } else {
                (1, 1, 1, 1, 1, 1, 1)
            };
        let table = texture(
            "page clip table",
            table_side,
            table_side,
            table_layers,
            wgpu::TextureFormat::R32Uint,
        );
        // Height in the low 16 bits, the water's excess over it in the high 16 (zero: no water
        // texels in this page; see resample.js). One load serves both.
        let heights = texture(
            "height page atlas",
            atlas_side,
            atlas_side,
            height_layers,
            wgpu::TextureFormat::R32Uint,
        );
        let albedo = texture(
            "albedo page atlas",
            atlas_side,
            atlas_side,
            albedo_layers,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );
        let meta = texture(
            "page parameters and window origins",
            meta_w,
            meta_h,
            1,
            wgpu::TextureFormat::Rgba32Float,
        );
        // The water layer: one atlas layer of RGBA16 pages with its own slots (docs/WATER-LAYER.md).
        let water_count = water_slots(tier);
        let (water_side, water_height, water_layers) = if measured {
            // Whole rows of 15 pages; a tier with fewer slots than a layer holds fewer rows.
            let rows = water_count
                .min(SLOTS_PER_LAYER)
                .div_ceil(PAGES_PER_LAYER_SIDE);
            (
                side,
                (rows * PAGE_TEXELS as u32 + 136).min(side),
                water_count.div_ceil(SLOTS_PER_LAYER),
            )
        } else {
            (1, 1, 1)
        };
        let water = texture(
            "water layer atlas",
            water_side,
            water_height,
            water_layers,
            wgpu::TextureFormat::Rgba16Uint,
        );
        let array = |t: &wgpu::Texture| {
            t.create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            })
        };
        let bytes = u64::from(table_side * table_side * table_layers) * 4
            + u64::from(atlas_side * atlas_side)
                * (u64::from(height_layers) * 4 + u64::from(albedo_layers) * 4)
            + u64::from(meta_w * meta_h) * 16
            + u64::from(water_side * water_height * water_layers) * 8;
        let specs = [
            ChannelSpec {
                channel: CHANNEL_HEIGHT,
                max_level: height_max,
                sharp: &[],
                live_from: solar_core::pages::PINNED_LEVELS,
                slots: height_slots,
                page_bytes: 137_000.0,
            },
            ChannelSpec {
                channel: CHANNEL_ALBEDO,
                max_level: albedo_max,
                sharp: SHARP_IMAGERY,
                live_from: 2,
                slots: albedo_slots,
                page_bytes: 20_000.0,
            },
        ];
        let radius = solar_core::body::REAL_EARTH.radius;
        Self {
            measured,
            height_max,
            albedo_max,
            radius,
            clipmap_pending: 0,
            clipmap_cursor: 0,
            table_view: array(&table),
            heights_view: array(&heights),
            albedo_view: array(&albedo),
            water_view: array(&water),
            water,
            water_pending: HashMap::new(),
            water_slots: HashMap::new(),
            water_free: (0..water_count).rev().collect(),
            water_count,
            water_order: VecDeque::new(),
            water_layer: WaterLayerCounts::default(),
            meta_view: meta.create_view(&Default::default()),
            table,
            heights,
            meta,
            albedo,
            sampler: g.device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("albedo pages"),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            }),
            bytes,
            stream: measured.then(|| {
                Stream::new(
                    StreamConfig {
                        radius,
                        ..Default::default()
                    },
                    &specs,
                )
            }),
            cpu: measured.then(|| PageField::new(radius, height_max.min(MAX_PAGE_LEVEL))),
            arrived: VecDeque::new(),
            page_sources: HashMap::new(),
            pinned_sources: 0,
            commands: Commands::default(),
            height_serial: 0,
            albedo_serial: 0,
            height_arrivals: Vec::new(),
            lag: DataLag::default(),
            uploaded_since_switch: 0,
            water_default: 0.0,
            specs,
        }
    }
    /// Start over on another body's pages. The atlases stay allocated and the programs stay bound.
    /// The clip table is cleared in one bounded write, so nothing of the old body can be read.
    pub fn switch_body(&mut self, g: &Gpu, radius: f64, sea: bool, measured: bool) {
        self.radius = radius;
        self.measured = measured;
        self.water_default = if sea { 0.0 } else { -1_000_000.0 };
        self.stream = measured.then(|| {
            Stream::new(
                StreamConfig {
                    radius,
                    ..Default::default()
                },
                &self.specs,
            )
        });
        self.cpu = measured.then(|| PageField::new(radius, self.height_max.min(MAX_PAGE_LEVEL)));
        self.arrived.clear();
        self.water_pending.clear();
        self.water_slots.clear();
        self.water_free = (0..self.water_count).rev().collect();
        self.water_order.clear();
        self.water_layer = WaterLayerCounts::default();
        self.page_sources.clear();
        self.pinned_sources = 0;
        self.commands = Commands::default();
        self.height_arrivals.clear();
        self.clipmap_pending = 0;
        self.uploaded_since_switch = 0;
        let empty = vec![0u8; (WINDOW * WINDOW * 4) as usize];
        for layer in 0..TABLE_LAYERS {
            g.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.table,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: layer,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                &empty,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(WINDOW * 4),
                    rows_per_image: Some(WINDOW),
                },
                wgpu::Extent3d {
                    width: WINDOW,
                    height: WINDOW,
                    depth_or_array_layers: 1,
                },
            );
        }
        self.height_serial = self.height_serial.wrapping_add(1);
        self.albedo_serial = self.albedo_serial.wrapping_add(1);
    }
    pub fn pinned_ready(&self) -> bool {
        !self.measured || self.uploaded_since_switch >= PINNED_READY
    }
    pub fn measured(&self) -> bool {
        self.measured
    }
    pub fn bindings(&self) -> PageBindings {
        PageBindings {
            table: self.table_view.clone(),
            heights: self.heights_view.clone(),
            meta: self.meta_view.clone(),
            albedo: self.albedo_view.clone(),
            sampler: self.sampler.clone(),
            water: self.water_view.clone(),
        }
    }
    /// The active pack's ceiling, shared by streaming, CPU height queries and
    /// shader filtering. Regional Earth imagery is never applied to other bodies.
    pub fn source_limits(&mut self, height: u8, albedo: u8, earth: bool) {
        self.height_max = height.min(MAX_PAGE_LEVEL);
        self.albedo_max = albedo.min(MAX_PAGE_LEVEL);
        self.specs[0].max_level = self.height_max;
        self.specs[1].max_level = self.albedo_max;
        self.specs[1].sharp = if earth { SHARP_IMAGERY } else { &[] };
        self.specs[1].live_from = if earth {
            2
        } else {
            solar_core::pages::PINNED_LEVELS
        };
        if let Some(stream) = &mut self.stream {
            stream.source_limits(&self.specs);
        }
        if let Some(cpu) = &mut self.cpu {
            cpu.max_level = self.height_max;
        }
    }
    /// Measured flag, finest height and albedo levels, slope of full complement amplitude.
    pub fn field_words(&self) -> [f32; 4] {
        [
            f32::from(u8::from(self.measured)),
            f32::from(self.height_max),
            f32::from(
                self.specs[1]
                    .sharp
                    .iter()
                    .fold(self.albedo_max, |m, r| m.max(r.max_level)),
            ),
            0.5,
        ]
    }
    /// Sun clipmap levels to refill this frame, as a bit mask. A height page changes the levels
    /// that could read it and whose window it touches. At most two levels refill per frame, so a
    /// burst of arrivals cannot stretch one frame; the rest wait their turn.
    pub fn take_clipmap_refresh(&mut self, eye: V3, levels: u32) -> u32 {
        let n = solar_core::field::normalized(eye);
        for key in std::mem::take(&mut self.height_arrivals) {
            let (cu, cv) = key.center();
            let center = solar_core::pages::chart_to_direction(key.face, cu, cv);
            let metric = solar_core::pages::chart_metric(cu, cv);
            let half = key.chart_size() * metric * self.radius * std::f64::consts::SQRT_2 * 0.5;
            let away = solar_core::field::dot(center, n).clamp(-1.0, 1.0).acos() * self.radius;
            for level in 0..levels {
                let step = 4.0f64.powi(level as i32);
                let producer = (step * 0.25).max(0.25);
                let wanted = solar_core::pages::wanted_level(self.radius, cu, cv, producer).ceil();
                if f64::from(key.level) <= wanted
                    && away <= half + 256.0 * step * std::f64::consts::SQRT_2
                {
                    self.clipmap_pending |= 1 << level;
                }
            }
        }
        let mut mask = 0u32;
        for _ in 0..levels {
            let bit = 1 << self.clipmap_cursor;
            self.clipmap_cursor = (self.clipmap_cursor + 1) % levels.max(1);
            if self.clipmap_pending & bit != 0 && mask.count_ones() < 2 {
                self.clipmap_pending &= !bit;
                mask |= bit;
            }
        }
        mask
    }
    pub fn bytes(&self) -> u64 {
        self.bytes
    }
    /// A finished page from the field worker. It waits for the frame's upload budget.
    #[allow(clippy::too_many_arguments)]
    pub fn page_arrived(
        &mut self,
        channel: u8,
        key: PageKey,
        offset: f32,
        scale: f32,
        sources: u8,
        bytes: Vec<u8>,
        water: Vec<f32>,
    ) -> Result<(), String> {
        let expected = if channel == CHANNEL_HEIGHT {
            HEIGHT_PAGE_BYTES
        } else {
            ALBEDO_PAGE_BYTES
        };
        // A height page may carry its water texels after its heights.
        let with_water = channel == CHANNEL_HEIGHT && bytes.len() == 2 * HEIGHT_PAGE_BYTES;
        if bytes.len() != expected && !with_water {
            return Err(format!(
                "page of {} bytes, expected {expected}",
                bytes.len()
            ));
        }
        self.arrived.push_back(Arrived {
            channel,
            key,
            offset,
            scale,
            sources,
            bytes,
            water,
        });
        Ok(())
    }
    /// A height page's water layer page, sent right after the height page (render-worker.js). kind: -1 texels
    /// (bytes: 264 x 264 RGBA16), -2 no water within the band, 0..3 one body of that kind over the whole page.
    pub fn water_page_arrived(
        &mut self,
        key: PageKey,
        level_offset: f32,
        level_scale: f32,
        kind: i32,
        level: f32,
        bytes: Vec<u8>,
    ) -> Result<(), String> {
        if kind == -1 && bytes.len() != WATER_PAGE_BYTES {
            return Err(format!(
                "water page of {} bytes, expected {WATER_PAGE_BYTES}",
                bytes.len()
            ));
        }
        self.water_pending.insert(
            key,
            WaterArrived {
                level_offset,
                level_scale,
                kind,
                level,
                bytes,
            },
        );
        Ok(())
    }
    /// The water layer parameters of a height slot (WATER_LAYER_X), and the water texels when it has them.
    fn write_water(&mut self, g: &Gpu, key: PageKey, slot: u32) {
        let params = match self.water_pending.remove(&key) {
            None => [WATER_UNKNOWN, 0.0, 0.0, 0.0],
            Some(w) if w.kind == -2 => {
                self.water_layer.dry += 1;
                self.release_water(key);
                [WATER_DRY, 0.0, 0.0, 0.0]
            }
            Some(w) if w.kind >= 0 => {
                self.water_layer.uniform += 1;
                self.release_water(key);
                [WATER_UNIFORM, w.kind as f32, w.level, 0.0]
            }
            Some(w) => {
                self.water_layer.pages += 1;
                let ws = match self.water_slots.get(&key) {
                    Some(&ws) => ws,
                    None => {
                        let ws = match self.water_free.pop() {
                            Some(ws) => ws,
                            None => {
                                // Full: the slot of the page the view needs least, which then reads a coarser
                                // page's water: one the view no longer wants, else the least urgent wanted page
                                // (the stream's order), the oldest of equals, and never one more urgent than the
                                // page asking, which goes without instead. First in, first out until 4 November
                                // 2026: the pages under the camera arrive first and lost their water first, and a
                                // harbour 46 m from the camera drew no water on some runs (lakeshore view).
                                // One pass over the wanted list against the slot holders (at most 225), with
                                // no map of the whole list: a fast flight evicts many pages a frame.
                                let holders: HashMap<PageKey, usize> = self
                                    .water_order
                                    .iter()
                                    .enumerate()
                                    .map(|(i, k)| (*k, i))
                                    .collect();
                                let mut needs = vec![f32::INFINITY; self.water_order.len()];
                                let mut own = f32::INFINITY;
                                if let Some(s) = self.stream.as_ref() {
                                    for (k, u) in s.wanted(CHANNEL_HEIGHT) {
                                        if let Some(&i) = holders.get(k) {
                                            needs[i] = *u;
                                        }
                                        if *k == key {
                                            own = *u;
                                        }
                                    }
                                }
                                let mut victim: Option<(usize, f32)> = None;
                                for (i, &u) in needs.iter().enumerate() {
                                    if victim.is_none_or(|(_, best)| u > best) {
                                        victim = Some((i, u));
                                    }
                                }
                                let Some((at, least)) = victim else {
                                    return;
                                };
                                if least.is_finite() && least <= own {
                                    self.water_layer.evicted += 1;
                                    self.water_layer.resident = self.water_slots.len() as u32;
                                    self.write_water_params(
                                        g,
                                        slot,
                                        [WATER_EVICTED, 0.0, 0.0, 0.0],
                                    );
                                    return;
                                }
                                let Some(old) = self.water_order.remove(at) else {
                                    return;
                                };
                                let ws = self.water_slots.remove(&old).unwrap_or(0);
                                self.water_layer.evicted += 1;
                                if let Some(hs) = self
                                    .stream
                                    .as_ref()
                                    .and_then(|s| s.slot_of(CHANNEL_HEIGHT, old))
                                {
                                    self.write_water_params(g, hs, [WATER_EVICTED, 0.0, 0.0, 0.0]);
                                }
                                ws
                            }
                        };
                        self.water_slots.insert(key, ws);
                        self.water_order.push_back(key);
                        ws
                    }
                };
                let col = ws % PAGES_PER_LAYER_SIDE;
                let row = (ws / PAGES_PER_LAYER_SIDE) % PAGES_PER_LAYER_SIDE;
                g.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.water,
                        mip_level: 0,
                        origin: wgpu::Origin3d {
                            x: col * PAGE_TEXELS as u32,
                            y: row * PAGE_TEXELS as u32,
                            z: ws / SLOTS_PER_LAYER,
                        },
                        aspect: wgpu::TextureAspect::All,
                    },
                    &w.bytes,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(PAGE_TEXELS as u32 * 8),
                        rows_per_image: Some(PAGE_TEXELS as u32),
                    },
                    wgpu::Extent3d {
                        width: PAGE_TEXELS as u32,
                        height: PAGE_TEXELS as u32,
                        depth_or_array_layers: 1,
                    },
                );
                self.lag.bytes_uploaded += w.bytes.len() as u64;
                [ws as f32, w.level_offset, w.level_scale, 0.0]
            }
        };
        self.water_layer.resident = self.water_slots.len() as u32;
        self.write_water_params(g, slot, params);
    }
    /// Whether any page has come with a water layer since the body changed: the water mesh draws only then.
    pub fn water_layer_active(&self) -> bool {
        self.water_layer.pages + self.water_layer.dry + self.water_layer.uniform > 0
    }
    fn release_water(&mut self, key: PageKey) {
        if let Some(ws) = self.water_slots.remove(&key) {
            self.water_free.push(ws);
            self.water_order.retain(|k| *k != key);
        }
    }
    fn write_water_params(&self, g: &Gpu, slot: u32, params: [f32; 4]) {
        g.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.meta,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: WATER_LAYER_X + slot % META_WIDTH,
                    y: slot / META_WIDTH,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(&params),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(16),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
    }
    pub fn page_missing(&mut self, channel: u8, key: PageKey) {
        if let Some(stream) = &mut self.stream {
            stream.on_missing(channel, key);
        }
    }
    pub fn page_failed(&mut self, channel: u8, key: PageKey) {
        if let Some(stream) = &mut self.stream {
            stream.on_failed(channel, key);
        }
    }
    pub fn observe_throughput(&mut self, bytes_per_second: f64) {
        if let Some(stream) = &mut self.stream {
            stream.observe_throughput(bytes_per_second);
        }
    }
    /// Advance residency from the f64 camera. No GPU feedback enters here. Without limits, as tests of
    /// the settled image ask, pages nothing on screen reads go out like any other.
    pub fn update(&mut self, camera: &StreamCamera, fetch_limits: bool) {
        let Some(stream) = &mut self.stream else {
            return;
        };
        stream.config.unseen_in_flight = if fetch_limits {
            StreamConfig::default().unseen_in_flight
        } else {
            [usize::MAX; 2]
        };
        let commands = stream.update(camera);
        self.commands.want.extend(commands.want);
        self.commands.cancel.extend(commands.cancel);
    }
    /// Requests and cancellations since the last call, as JSON for the field worker.
    pub fn take_commands(&mut self) -> Option<String> {
        if self.commands.want.is_empty() && self.commands.cancel.is_empty() {
            return None;
        }
        let commands = std::mem::take(&mut self.commands);
        let pages: Vec<_> = commands
            .want
            .iter()
            .map(|p| {
                serde_json::json!({"id":p.id,"face":p.key.face,"level":p.key.level,"x":p.key.x,"y":p.key.y,"channel":p.channel,"priority":p.priority,"refresh":p.refresh})
            })
            .collect();
        Some(serde_json::json!({"type":"want","pages":pages,"cancel":commands.cancel}).to_string())
    }
    /// Bounded upload at the start of a frame. A page beyond the budget waits for the next
    /// frame and is counted; rendering never waits for it.
    pub fn flush(&mut self, g: &Gpu, frame: u64) {
        let Some(stream) = &mut self.stream else {
            return;
        };
        let mut uploaded = 0;
        let mut water_uploads = Vec::new();
        while uploaded < PAGES_PER_FRAME {
            let Some(page) = self.arrived.pop_front() else {
                break;
            };
            let sources = page.sources & !PROVISIONAL;
            let Some(slot) = stream.on_page(page.channel, page.key, sources & 1 != 0) else {
                continue;
            };
            if page.sources & PROVISIONAL != 0 {
                stream.on_provisional(page.channel, page.key);
            }
            self.page_sources.insert((page.channel, page.key), sources);
            if page.key.pinned() {
                self.pinned_sources |= sources;
            }
            uploaded += 1;
            self.uploaded_since_switch = self.uploaded_since_switch.saturating_add(1);
            let col = slot % PAGES_PER_LAYER_SIDE;
            let row = (slot / PAGES_PER_LAYER_SIDE) % PAGES_PER_LAYER_SIDE;
            let layer = slot / SLOTS_PER_LAYER;
            let texture = if page.channel == CHANNEL_HEIGHT {
                &self.heights
            } else {
                &self.albedo
            };
            let texels = PAGE_TEXELS * PAGE_TEXELS;
            let water_texels = page.bytes.len() == 2 * HEIGHT_PAGE_BYTES;
            let packed: Vec<u8>;
            let upload: &[u8] = if page.channel == CHANNEL_HEIGHT {
                let word = |i: usize| -> u32 {
                    let h = u32::from(u16::from_le_bytes([
                        page.bytes[2 * i],
                        page.bytes[2 * i + 1],
                    ]));
                    let w = if water_texels {
                        let o = HEIGHT_PAGE_BYTES + 2 * i;
                        u32::from(u16::from_le_bytes([page.bytes[o], page.bytes[o + 1]]))
                    } else {
                        0
                    };
                    h | (w << 16)
                };
                packed = (0..texels).flat_map(|i| word(i).to_le_bytes()).collect();
                &packed
            } else {
                &page.bytes
            };
            g.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: col * PAGE_TEXELS as u32,
                        y: row * PAGE_TEXELS as u32,
                        z: layer,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                upload,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(PAGE_TEXELS as u32 * 4),
                    rows_per_image: Some(PAGE_TEXELS as u32),
                },
                wgpu::Extent3d {
                    width: PAGE_TEXELS as u32,
                    height: PAGE_TEXELS as u32,
                    depth_or_array_layers: 1,
                },
            );
            self.lag.pages_uploaded += 1;
            self.lag.bytes_uploaded += page.bytes.len() as u64;
            if page.channel == CHANNEL_HEIGHT {
                // z: whether the page carries water texels, so a slot never reads an old page's.
                let params = [
                    page.offset,
                    page.scale,
                    if water_texels { 1.0 } else { 0.0 },
                    0.0,
                ];
                g.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.meta,
                        mip_level: 0,
                        origin: wgpu::Origin3d {
                            x: slot % META_WIDTH,
                            y: slot / META_WIDTH,
                            z: 0,
                        },
                        aspect: wgpu::TextureAspect::All,
                    },
                    bytemuck::cast_slice(&params),
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(16),
                        rows_per_image: Some(1),
                    },
                    wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                );
                let mut levels = vec![0.0f32; META_WIDTH as usize * 16];
                for cell in levels.chunks_exact_mut(4) {
                    cell[0] = self.water_default;
                }
                match page.water.len() {
                    1 => {
                        for cell in levels.chunks_exact_mut(4) {
                            cell[0] = page.water[0];
                        }
                    }
                    1024 => {
                        for (cell, value) in levels.chunks_exact_mut(4).zip(&page.water) {
                            cell[0] = *value;
                        }
                    }
                    4096 | 8192 => levels.copy_from_slice(&page.water[..4096]),
                    _ => {}
                }
                let empty_banks = vec![0.0f32; levels.len()];
                let banks = if page.water.len() == levels.len() * 2 {
                    &page.water[levels.len()..]
                } else {
                    &empty_banks
                };
                for (part, data) in [&levels[..], banks].into_iter().enumerate() {
                    g.queue.write_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &self.meta,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: part as u32 * META_WIDTH,
                                y: WATER_ROW + slot * 4,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        bytemuck::cast_slice(data),
                        wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(META_WIDTH * 16),
                            rows_per_image: Some(4),
                        },
                        wgpu::Extent3d {
                            width: META_WIDTH,
                            height: 4,
                            depth_or_array_layers: 1,
                        },
                    );
                }
                stamp_arrival(g, &self.meta, HEIGHT_ARRIVAL_ROW, slot, frame);
                self.height_serial = self.height_serial.wrapping_add(1);
                self.height_arrivals.push(page.key);
                water_uploads.push((page.key, slot));
                if let (Some(cpu), Ok(p)) = (
                    &mut self.cpu,
                    HeightPage::from_bytes(
                        page.key,
                        f64::from(page.offset),
                        f64::from(page.scale),
                        &page.bytes[..HEIGHT_PAGE_BYTES],
                    ),
                ) {
                    cpu.insert(p);
                }
            } else {
                self.albedo_serial = self.albedo_serial.wrapping_add(1);
                stamp_arrival(g, &self.meta, ALBEDO_ROW, slot, frame);
            }
        }
        if !self.arrived.is_empty() {
            self.lag.upload_deferred_frames += 1;
        }
        for (key, slot) in water_uploads {
            self.write_water(g, key, slot);
        }
        let Some(stream) = &mut self.stream else {
            return;
        };
        // Pages entering or leaving the wanted set change what the table serves, and so what
        // the field means: everything downstream hears about it the same way as an upload.
        for (key, served) in stream.take_map_changes(CHANNEL_HEIGHT) {
            if let Some(cpu) = &mut self.cpu {
                cpu.set_served(key, served);
            }
            // A page coming back on screen fades in as a new one does.
            if let (true, Some(slot)) = (served, stream.slot_of(CHANNEL_HEIGHT, key)) {
                stamp_arrival(g, &self.meta, HEIGHT_ARRIVAL_ROW, slot, frame);
            }
            self.height_serial = self.height_serial.wrapping_add(1);
            self.height_arrivals.push(key);
        }
        for (key, served) in stream.take_map_changes(CHANNEL_ALBEDO) {
            if let (true, Some(slot)) = (served, stream.slot_of(CHANNEL_ALBEDO, key)) {
                stamp_arrival(g, &self.meta, ALBEDO_ROW, slot, frame);
            }
            self.albedo_serial = self.albedo_serial.wrapping_add(1);
        }
        let mut gone = Vec::new();
        for key in stream.take_evicted(CHANNEL_HEIGHT) {
            // Evicted and admitted again within this flush: the page is held after all.
            if stream.is_resident(CHANNEL_HEIGHT, key) {
                continue;
            }
            if let Some(cpu) = &mut self.cpu {
                cpu.remove(key);
            }
            gone.push(key);
        }
        for key in gone {
            self.release_water(key);
            self.water_pending.remove(&key);
        }
        let Some(stream) = &mut self.stream else {
            return;
        };
        let _ = stream.take_evicted(CHANNEL_ALBEDO);
        // The table follows the pages it may point at, within the same frame.
        for (layer, entries) in stream.take_dirty_layers(TABLE_LAYERS_PER_FRAME) {
            // The GPU's meaning changes when the layer arrives, which can be frames after the
            // change that dirtied it, so wake regeneration now as well or nodes keep the old answer.
            if layer < TABLE_LAYERS / 2 {
                self.height_serial = self.height_serial.wrapping_add(1);
            } else {
                self.albedo_serial = self.albedo_serial.wrapping_add(1);
            }
            g.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.table,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: layer,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                bytemuck::cast_slice(&entries),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(WINDOW * 4),
                    rows_per_image: Some(WINDOW),
                },
                wgpu::Extent3d {
                    width: WINDOW,
                    height: WINDOW,
                    depth_or_array_layers: 1,
                },
            );
        }
        if let Some(origins) = stream.take_origins() {
            self.height_serial = self.height_serial.wrapping_add(1);
            self.albedo_serial = self.albedo_serial.wrapping_add(1);
            let mut row = vec![[0.0f32; 4]; META_WIDTH as usize];
            for (i, origin) in origins.iter().enumerate().take(META_WIDTH as usize) {
                row[i] = [origin[0] as f32, origin[1] as f32, 0.0, 0.0];
            }
            g.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.meta,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: ORIGIN_ROW,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                bytemuck::cast_slice(&row),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(META_WIDTH * 16),
                    rows_per_image: Some(1),
                },
                wgpu::Extent3d {
                    width: META_WIDTH,
                    height: 1,
                    depth_or_array_layers: 1,
                },
            );
        }
        let height = stream.counters(CHANNEL_HEIGHT);
        let albedo = stream.counters(CHANNEL_ALBEDO);
        self.lag.pages_wanted = height.wanted + albedo.wanted;
        self.lag.pages_resident = height.resident + albedo.resident;
        self.lag.pages_in_flight = height.in_flight + albedo.in_flight;
        self.lag.pages_failed = height.failed + albedo.failed;
        self.lag.pages_not_found = height.not_found + albedo.not_found;
        self.lag.pages_cancelled = height.cancelled + albedo.cancelled;
        self.lag.pool_overflow = height.pool_overflow + albedo.pool_overflow;
        self.lag.pages_over_pool = height.over_pool + albedo.over_pool;
        self.lag.pages_queued = self.arrived.len() as u32;
    }
    /// Sources of the pages the table serves now, as a bit mask, plus the pinned levels'
    /// sources, which are always in view from somewhere. Attribution follows this.
    pub fn sources_in_view(&self) -> u8 {
        let Some(stream) = &self.stream else {
            return 0;
        };
        let mut mask = self.pinned_sources;
        for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
            for key in stream.served(channel) {
                mask |= self.page_sources.get(&(channel, key)).copied().unwrap_or(0);
            }
        }
        mask
    }
    /// The clearance residency goes by.
    pub fn clearance(&self, position: V3) -> f64 {
        match (&self.stream, &self.cpu) {
            (Some(stream), Some(cpu)) => stream.clearance(cpu, position),
            _ => 0.5,
        }
    }
    /// Levels between the finest wanted under the camera and the one served, per channel.
    pub fn camera_deficit(&self, position: V3) -> [u32; 2] {
        let Some(stream) = &self.stream else {
            return [0, 0];
        };
        let n = solar_core::field::normalized(position);
        let (face, u, v) = solar_core::pages::direction_to_chart(n);
        [CHANNEL_HEIGHT, CHANNEL_ALBEDO].map(|channel| {
            let finest = stream.finest(channel);
            let (key, _, _) = solar_core::pages::page_at(face, finest, u, v);
            let entry = stream.lookup(channel, key);
            u32::from(finest).saturating_sub(u32::from(solar_core::streaming::entry_level(entry)))
        })
    }
}

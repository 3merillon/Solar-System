//! What the camera wants, what is resident and what to ask for next. Pure logic driven by
//! the f64 camera, with no GPU feedback and no network: the same inputs give the same
//! commands. The request design follows CesiumJS's scheduler (see docs/M1-LIVE-EARTH.md).
use crate::{
    field::{self, V3},
    pages::{
        cell_size, chart_metric, chart_to_direction, direction_to_chart, direction_to_lon_lat,
        page_at, wanted_level, PageField, PageKey, MAX_PAGE_LEVEL, PAGES_PER_LAYER_SIDE,
        PAGE_CELLS, PINNED_LEVELS,
    },
};
use std::collections::{HashMap, HashSet};

/// Entries per clip table window side; a window this wide covers a whole face at D5.
pub const WINDOW: u32 = 32;
pub const CHANNELS: usize = 2;
pub const CHANNEL_HEIGHT: u8 = 0;
pub const CHANNEL_ALBEDO: u8 = 1;
/// Levels with a table window: 0 to MAX_PAGE_LEVEL.
pub const TABLE_LEVELS: u32 = MAX_PAGE_LEVEL as u32 + 1;
/// Layers of the clip table: one per channel, level and face.
pub const TABLE_LAYERS: u32 = CHANNELS as u32 * TABLE_LEVELS * 6;
pub const ENTRY_VALID: u32 = 1 << 31;
/// The page may yet be replaced at the same level by its final form. In the entry so that what read it can tell when that happens.
pub const ENTRY_PROVISIONAL: u32 = 1 << 30;
/// Slots per atlas layer.
pub const SLOTS_PER_LAYER: u32 = PAGES_PER_LAYER_SIDE * PAGES_PER_LAYER_SIDE;
/// Half-angle that covers the corners of a 60 degree vertical field at 16:9, radians.
const VIEW_CONE: f64 = 0.92;
/// The order of a cold view, each step behind all of the one before. The first pass runs from 0 to 6,000.
/// In view and no finer than what the pixels finally read, coarse to fine.
const SECOND_PASS: f64 = 10_000.0;
/// In view and finer than anything on screen reads.
const FINER_IN_VIEW: f64 = 40_000.0;
/// Every page out of view waits behind every page in view.
const OUT_OF_VIEW: f64 = 70_000.0;
/// How many provisional pages may be asked for again at once, as each may wait a long time on its host.
const REFRESHES_IN_FLIGHT: usize = 4;
/// Ticks before a provisional page is first asked for again.
const REFRESH_AFTER_TICKS: u64 = 60;
/// Above this speed, metres per second, nothing is asked for that nothing on screen reads.
const STILL_SPEED: f64 = 1.0;
/// Table changes per channel and update from pages entering or leaving the wanted set.
const MAPPING_CHANGES_PER_UPDATE: usize = 96;
/// Window rebuilds per channel and update.
const WINDOW_MOVES_PER_UPDATE: usize = 8;

pub fn table_layer(channel: u8, level: u8, face: u8) -> u32 {
    u32::from(channel) * TABLE_LEVELS * 6 + u32::from(level) * 6 + u32::from(face)
}
pub fn encode_entry(slot: u32, served: u8) -> u32 {
    ENTRY_VALID | (slot & 0xfff) | (u32::from(served) << 12)
}
pub fn entry_slot(entry: u32) -> u32 {
    entry & 0xfff
}
pub fn entry_level(entry: u32) -> u8 {
    ((entry >> 12) & 0x1f) as u8
}

#[derive(Clone, Copy, Debug)]
pub struct StreamCamera {
    /// Body-frame position, metres.
    pub position: V3,
    /// Metres per second.
    pub velocity: V3,
    pub forward: V3,
    /// Height above the local surface, metres.
    pub clearance: f64,
}
/// A place where a sharper source raises a channel's finest level, degrees.
#[derive(Clone, Copy, Debug)]
pub struct SharpRegion {
    pub lon: [f64; 2],
    pub lat: [f64; 2],
    pub max_level: u8,
}
#[derive(Clone, Copy, Debug)]
pub struct ChannelSpec {
    pub channel: u8,
    /// Finest level the global source of this channel supplies.
    pub max_level: u8,
    /// Sharper sources, applied while the camera is over them.
    pub sharp: &'static [SharpRegion],
    /// Coarsest level asked of the live source. Below PINNED_LEVELS a live page replaces the
    /// pack's page in view, where the pack's colour would otherwise meet live colour at a hard line.
    pub live_from: u8,
    /// Atlas slots, pinned levels included.
    pub slots: u32,
    /// A typical bytes-on-the-wire figure per page, used until it is measured.
    pub page_bytes: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct StreamConfig {
    pub radius: f64,
    /// Radians per pixel at the screen centre.
    pub pixel_angle: f64,
    /// Pages either side of the camera in each ring; the ring is 2 * reach + 1 wide.
    pub reach: i32,
    /// Outstanding requests per channel.
    pub in_flight_limit: usize,
    /// Of those, per channel, how many may be pages nothing on screen reads.
    pub unseen_in_flight: [usize; CHANNELS],
    /// Tallest relief considered when limiting pages to the horizon, metres.
    pub relief: f64,
    pub c_min: f64,
    pub c_max: f64,
}
impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            radius: 6_371_000.0,
            pixel_angle: 2.0 * 30.0f64.to_radians().tan() / 1080.0,
            reach: 4,
            in_flight_limit: 32,
            unseen_in_flight: [16, 2],
            relief: 9_000.0,
            c_min: 0.2,
            c_max: 4.0,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageRequest {
    pub id: u32,
    pub channel: u8,
    pub key: PageKey,
    /// Lower is more urgent. Order only: it never changes what is resident.
    pub priority: f32,
    /// The page is already up, provisional, so this asks for its final form and need not hurry.
    pub refresh: bool,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Commands {
    pub want: Vec<PageRequest>,
    pub cancel: Vec<u32>,
}
/// One clip table layer update for the GPU: its 32 x 32 entries.
#[derive(Clone, Debug, Default)]
pub struct Counters {
    pub wanted: u32,
    pub resident: u32,
    pub in_flight: u32,
    pub failed: u64,
    pub not_found: u64,
    pub cancelled: u64,
    pub dropped_unwanted: u64,
    pub pool_overflow: u64,
    pub evicted: u64,
    /// Pages this camera would want that lie past what the pool can hold, now.
    pub over_pool: u32,
}
struct Resident {
    slot: u32,
    last_wanted: u64,
}
struct Channel {
    spec: ChannelSpec,
    resident: HashMap<PageKey, Resident>,
    /// Pinned pages that a live source has replaced; a late pack page must not overwrite them.
    refreshed: HashSet<PageKey>,
    /// Resident pages that went up without something they would like, to be asked for again.
    provisional: HashSet<PageKey>,
    /// Pages the table may serve: pinned levels and resident wanted pages. Other resident pages
    /// are only a cache. Without this, what an earlier route left behind would show through.
    mapped: HashSet<PageKey>,
    /// Changes to `mapped`, for the CPU reader: page and whether it is now served.
    map_changes: Vec<(PageKey, bool)>,
    /// Pages that left the pool, for the CPU copy.
    evicted: Vec<PageKey>,
    free: Vec<u32>,
    in_flight: HashMap<PageKey, u32>,
    missing: HashSet<PageKey>,
    retry: HashMap<PageKey, (u64, u32)>,
    wanted: Vec<(PageKey, f32)>,
    wanted_set: HashSet<PageKey>,
    /// What the table may show: the wanted pages plus the finer ones speed alone holds back from
    /// fetching. A page in this set stays on screen, so a burst of speed cannot take detail away.
    serving: HashSet<PageKey>,
    origins: Vec<[u32; 2]>,
    table: Vec<u32>,
    dirty: HashSet<u32>,
    origins_changed: bool,
    counters: Counters,
    finest: u8,
}
impl Channel {
    fn new(spec: ChannelSpec) -> Self {
        Self {
            spec,
            resident: HashMap::new(),
            refreshed: HashSet::new(),
            provisional: HashSet::new(),
            mapped: HashSet::new(),
            map_changes: Vec::new(),
            evicted: Vec::new(),
            free: (0..spec.slots).rev().collect(),
            in_flight: HashMap::new(),
            missing: HashSet::new(),
            retry: HashMap::new(),
            wanted: Vec::new(),
            wanted_set: HashSet::new(),
            serving: HashSet::new(),
            origins: vec![[0, 0]; (TABLE_LEVELS * 6) as usize],
            table: vec![0; (TABLE_LEVELS * 6 * WINDOW * WINDOW) as usize],
            dirty: HashSet::new(),
            origins_changed: true,
            counters: Counters::default(),
            finest: 0,
        }
    }
    fn origin(&self, level: u8, face: u8) -> [u32; 2] {
        self.origins[usize::from(level) * 6 + usize::from(face)]
    }
    fn layer_slice(&mut self, level: u8, face: u8) -> &mut [u32] {
        let n = (WINDOW * WINDOW) as usize;
        let at = (usize::from(level) * 6 + usize::from(face)) * n;
        &mut self.table[at..at + n]
    }
    fn nearest(&self, mut key: PageKey) -> Option<(PageKey, u32)> {
        loop {
            if self.mapped.contains(&key) {
                if let Some(r) = self.resident.get(&key) {
                    return Some((key, r.slot));
                }
            }
            key = key.parent()?;
        }
    }
    fn map_page(&mut self, key: PageKey, slot: u32) {
        if self.mapped.insert(key) {
            self.map_changes.push((key, true));
        }
        self.entries_arrived(key, slot);
    }
    fn unmap_page(&mut self, key: PageKey, slot: u32) {
        if self.mapped.remove(&key) {
            self.map_changes.push((key, false));
            self.entries_evicted(key, slot);
        }
    }
    /// Bring the table to the wanted set, a bounded number of pages per update, so that a camera
    /// cut spreads over frames. A page not yet changed only means a lookup served coarser or sharper
    /// for a moment; the settled state is exactly the wanted set.
    fn sync_mapping(&mut self) {
        let mut budget = MAPPING_CHANGES_PER_UPDATE;
        let leaving: Vec<PageKey> = self
            .mapped
            .iter()
            .filter(|k| !k.pinned() && !self.serving.contains(k))
            .take(budget)
            .copied()
            .collect();
        budget -= leaving.len();
        for key in leaving {
            if let Some(slot) = self.resident.get(&key).map(|r| r.slot) {
                self.unmap_page(key, slot);
            }
        }
        let arriving: Vec<(PageKey, u32)> = self
            .wanted
            .iter()
            .map(|(k, _)| *k)
            .chain(
                self.serving
                    .iter()
                    .filter(|k| !self.wanted_set.contains(k))
                    .copied(),
            )
            .filter(|k| !self.mapped.contains(k))
            .filter_map(|k| self.resident.get(&k).map(|r| (k, r.slot)))
            .take(budget)
            .collect();
        for (key, slot) in arriving {
            self.map_page(key, slot);
        }
    }
    /// Rebuild one window from what is resident.
    fn rebuild_layer(&mut self, level: u8, face: u8) {
        let origin = self.origin(level, face);
        let side = 1u32 << level;
        let mut entries = vec![0u32; (WINDOW * WINDOW) as usize];
        for wy in 0..WINDOW.min(side) {
            for wx in 0..WINDOW.min(side) {
                let (x, y) = (origin[0] + wx, origin[1] + wy);
                let entry = self
                    .nearest(PageKey { face, level, x, y })
                    .map_or(0, |(k, slot)| self.entry_for(k, slot));
                entries[((y % WINDOW) * WINDOW + x % WINDOW) as usize] = entry;
            }
        }
        self.layer_slice(level, face).copy_from_slice(&entries);
        self.dirty
            .insert(table_layer(self.spec.channel, level, face));
    }
    /// The rectangle of window entries at `level` that lie inside `key`, if any.
    fn window_span(&self, key: PageKey, level: u8) -> Option<[u32; 4]> {
        let shift = u32::from(level - key.level);
        let (low_x, low_y) = (key.x << shift, key.y << shift);
        let span = 1u64 << shift;
        let origin = self.origin(level, key.face);
        let width = u64::from(WINDOW).min(1u64 << level);
        let (x0, y0) = (origin[0].max(low_x), origin[1].max(low_y));
        let x1 = (u64::from(origin[0]) + width).min(u64::from(low_x) + span) as u32;
        let y1 = (u64::from(origin[1]) + width).min(u64::from(low_y) + span) as u32;
        (x0 < x1 && y0 < y1).then_some([x0, y0, x1, y1])
    }
    fn entry_for(&self, key: PageKey, slot: u32) -> u32 {
        let provisional = if self.provisional.contains(&key) {
            ENTRY_PROVISIONAL
        } else {
            0
        };
        encode_entry(slot, key.level) | provisional
    }
    /// A page arrived: it now serves every entry inside it that a coarser page served.
    /// Constant work per entry, because uploads must stay within the frame budget.
    fn entries_arrived(&mut self, key: PageKey, slot: u32) {
        let new = self.entry_for(key, slot);
        for level in key.level..=MAX_PAGE_LEVEL {
            let Some([x0, y0, x1, y1]) = self.window_span(key, level) else {
                continue;
            };
            let mut changed = false;
            let layer = self.layer_slice(level, key.face);
            for y in y0..y1 {
                for x in x0..x1 {
                    let at = ((y % WINDOW) * WINDOW + x % WINDOW) as usize;
                    let old = layer[at];
                    if old & ENTRY_VALID == 0 || entry_level(old) <= key.level {
                        layer[at] = new;
                        changed = true;
                    }
                }
            }
            if changed {
                self.dirty
                    .insert(table_layer(self.spec.channel, level, key.face));
            }
        }
    }
    /// A page left: only the entries it served fall back to their nearest resident ancestor.
    fn entries_evicted(&mut self, key: PageKey, slot: u32) {
        for level in key.level..=MAX_PAGE_LEVEL {
            let Some([x0, y0, x1, y1]) = self.window_span(key, level) else {
                continue;
            };
            let mut changed = false;
            for y in y0..y1 {
                for x in x0..x1 {
                    let at = ((y % WINDOW) * WINDOW + x % WINDOW) as usize;
                    let old = self.layer_slice(level, key.face)[at];
                    if old & ENTRY_VALID != 0
                        && entry_slot(old) == slot
                        && entry_level(old) == key.level
                    {
                        let entry = self
                            .nearest(PageKey {
                                face: key.face,
                                level,
                                x,
                                y,
                            })
                            .map_or(0, |(k, s)| self.entry_for(k, s));
                        self.layer_slice(level, key.face)[at] = entry;
                        changed = true;
                    }
                }
            }
            if changed {
                self.dirty
                    .insert(table_layer(self.spec.channel, level, key.face));
            }
        }
    }
    fn evict_one(&mut self, tick: u64) -> Option<u32> {
        let victim = self
            .resident
            .iter()
            .filter(|(k, r)| !k.pinned() && !self.wanted_set.contains(k) && r.last_wanted < tick)
            .min_by_key(|(k, r)| {
                (
                    self.serving.contains(k),
                    r.last_wanted,
                    k.level,
                    k.face,
                    k.x,
                    k.y,
                )
            })
            .map(|(k, _)| *k)?;
        let slot = self.resident.get(&victim)?.slot;
        self.unmap_page(victim, slot);
        self.resident.remove(&victim);
        self.provisional.remove(&victim);
        self.evicted.push(victim);
        self.counters.evicted += 1;
        Some(slot)
    }
}
pub struct Stream {
    pub config: StreamConfig,
    /// The speed admission constant, pages per second across a page's own size.
    pub c: f64,
    channels: Vec<Channel>,
    next_id: u32,
    tick: u64,
    bytes_per_page: f64,
}
impl Stream {
    pub fn new(config: StreamConfig, channels: &[ChannelSpec]) -> Self {
        Self {
            config,
            c: 1.2,
            channels: channels.iter().map(|s| Channel::new(*s)).collect(),
            next_id: 1,
            tick: 0,
            bytes_per_page: channels.iter().map(|s| s.page_bytes).sum(),
        }
    }
    /// Pages per level per second at speed admission c is about 2 * (2 reach + 1) * c,
    /// summing to about twice that across levels. c follows measured throughput, so a slow
    /// link means less fine detail in motion, never a stall.
    pub fn observe_throughput(&mut self, bytes_per_second: f64) {
        if bytes_per_second <= 0.0 {
            return;
        }
        let ring = f64::from(2 * self.config.reach + 1);
        let per_c = 2.0 * ring * self.bytes_per_page;
        self.c = (bytes_per_second / per_c).clamp(self.config.c_min, self.config.c_max);
    }
    pub fn counters(&self, channel: u8) -> &Counters {
        &self.channels[usize::from(channel)].counters
    }
    pub fn finest(&self, channel: u8) -> u8 {
        self.channels[usize::from(channel)].finest
    }
    /// Change source availability without discarding resident ancestor pages.
    /// The next update cancels requests outside the new demand set.
    pub fn source_limits(&mut self, specs: &[ChannelSpec]) {
        for spec in specs {
            let channel = &mut self.channels[usize::from(spec.channel)];
            channel.spec.max_level = spec.max_level;
            channel.spec.sharp = spec.sharp;
            channel.spec.live_from = spec.live_from;
        }
    }
    /// Finest level admitted at this camera.
    pub fn admitted(&self, spec: &ChannelSpec, u: f64, v: f64, camera: &StreamCamera) -> u8 {
        let at_rest = self.admitted_at_rest(spec, u, v, camera);
        let speed = field::length(camera.velocity);
        if speed <= 0.0 {
            return at_rest;
        }
        let cell0 = cell_size(self.config.radius, 0.0) * chart_metric(u, v);
        let admitted = (f64::from(PAGE_CELLS) * cell0 * self.c / speed)
            .log2()
            .floor();
        (f64::from(at_rest).min(admitted)).max(f64::from(PINNED_LEVELS) - 1.0) as u8
    }
    /// The finest level this altitude and these sources can use, whatever the speed.
    fn admitted_at_rest(&self, spec: &ChannelSpec, u: f64, v: f64, camera: &StreamCamera) -> u8 {
        let metric = chart_metric(u, v);
        let (lon, lat) = direction_to_lon_lat(field::normalized(camera.position));
        let (lon, lat) = (lon.to_degrees(), lat.to_degrees());
        let source_max = spec
            .sharp
            .iter()
            .filter(|r| lon >= r.lon[0] && lon <= r.lon[1] && lat >= r.lat[0] && lat <= r.lat[1])
            .fold(spec.max_level, |m, r| m.max(r.max_level));
        self.altitude_level(metric, camera.clearance)
            .min(f64::from(source_max))
            .max(f64::from(PINNED_LEVELS) - 1.0) as u8
    }
    /// The level a clearance asks for, before any limit of the sources.
    fn altitude_level(&self, metric: f64, clearance: f64) -> f64 {
        let cell0 = cell_size(self.config.radius, 0.0) * metric;
        (cell0 / (clearance.max(0.5) * self.config.pixel_angle))
            .log2()
            .ceil()
    }
    /// The clearance to decide residency by. Read from whatever is served, it would depend on the
    /// set it decides, and near a level's limit both the finer set and the coarser one would hold
    /// themselves up, so that the way the camera came would choose. So it is the height of the
    /// coarsest level that asks for nothing finer, walking up from the pinned pages, which cannot
    /// depend on anything finer being served.
    pub fn clearance(&self, pages: &PageField, position: V3) -> f64 {
        let (face, u, v) = direction_to_chart(field::normalized(position));
        let above = field::length(position) - self.config.radius;
        let mut clearance = above.max(0.5);
        for level in PINNED_LEVELS - 1..=pages.max_level {
            let Some(read) = pages.read_level(face, u, v, level) else {
                break;
            };
            clearance = (above - read.height).max(0.5);
            if self.altitude_level(chart_metric(u, v), clearance) <= f64::from(level) {
                break;
            }
        }
        clearance
    }
    /// Recompute the wanted set and return what to ask for and what to cancel.
    pub fn update(&mut self, camera: &StreamCamera) -> Commands {
        self.update_with_repairs(camera, |_, _| HashSet::new())
    }
    /// Refresh selected resident pages whose auxiliary data lost its slot. The caller
    /// chooses them against this frame's priorities. Terrain stays final and mapped.
    pub fn update_with_repairs(
        &mut self,
        camera: &StreamCamera,
        repairs: impl Fn(u8, &[(PageKey, f32)]) -> HashSet<PageKey>,
    ) -> Commands {
        self.tick += 1;
        let tick = self.tick;
        let config = self.config;
        let radial = field::normalized(camera.position);
        // Rank page footprints in the local ground frame. A camera ten metres
        // above a mountain needs the same fine pages as one ten metres above a beach.
        let footprint_eye = field::mul(radial, config.radius + camera.clearance.max(0.5));
        let (face, u, v) = direction_to_chart(radial);
        let speed = field::length(camera.velocity);
        // Look ahead one second along the ground, bounded so a fast camera still has rings.
        let ahead = field::add(camera.position, camera.velocity);
        let predicted = field::normalized(ahead);
        let height = (field::length(camera.position) - config.radius).max(0.0);
        let horizon = (config.radius / (config.radius + height + config.relief))
            .clamp(-1.0, 1.0)
            .acos()
            + (config.radius / (config.radius + config.relief)).acos();
        let mut commands = Commands::default();
        for index in 0..self.channels.len() {
            let spec = self.channels[index].spec;
            let finest = self.admitted(&spec, u, v, camera);
            let finest_shown = self.admitted_at_rest(&spec, u, v, camera);
            let mut wanted: Vec<(PageKey, f32)> = Vec::new();
            let mut admission: HashMap<PageKey, f64> = HashMap::new();
            let mut serving: HashSet<PageKey> = HashSet::new();
            let mut seen: HashSet<PageKey> = HashSet::new();
            for level in spec.live_from.min(PINNED_LEVELS)..=finest_shown {
                let size = 2.0 / f64::from(1u32 << level);
                let mut keys: Vec<PageKey> = Vec::new();
                if level < PINNED_LEVELS {
                    // A pinned page refreshed live stays live, in its one slot. So that what shows
                    // cannot depend on where the camera has been, every one in sight is wanted, not
                    // only those in the rings. Past the horizon nothing reads it.
                    for f2 in 0..6u8 {
                        for y in 0..1u32 << level {
                            for x in 0..1u32 << level {
                                keys.push(PageKey {
                                    face: f2,
                                    level,
                                    x,
                                    y,
                                });
                            }
                        }
                    }
                } else {
                    for dy in -config.reach..=config.reach {
                        for dx in -config.reach..=config.reach {
                            let (eu, ev) = (u + f64::from(dx) * size, v + f64::from(dy) * size);
                            // The gnomonic plane extends past the face, so a ring crosses cube
                            // edges by re-projecting into whichever face holds the direction.
                            let n = chart_to_direction(face, eu, ev);
                            let (f2, u2, v2) = direction_to_chart(n);
                            keys.push(page_at(f2, level, u2, v2).0);
                        }
                    }
                }
                for key in keys {
                    if !seen.insert(key) {
                        continue;
                    }
                    let (cu, cv) = key.center();
                    let center = chart_to_direction(key.face, cu, cv);
                    let angle = field::dot(center, radial).clamp(-1.0, 1.0).acos();
                    let half = key.chart_size() * chart_metric(cu, cv) * std::f64::consts::SQRT_2;
                    if angle - half > horizon {
                        continue;
                    }
                    serving.insert(key);
                    if level > finest {
                        continue;
                    }
                    let offset = field::sub(field::mul(center, config.radius), footprint_eye);
                    let to_page = field::normalized(offset);
                    let facing = field::dot(to_page, camera.forward);
                    // Pages in view go first: order only, so a turn never changes what is
                    // resident. A page counts as in view if any of it can touch the frustum.
                    let seen = (half * config.radius / field::length(offset).max(1.0)).atan();
                    let in_view = facing.clamp(-1.0, 1.0).acos() <= VIEW_CONE + seen;
                    let along = field::dot(center, predicted).clamp(-1.0, 1.0).acos();
                    let nearness = if speed > 0.0 { along.min(angle) } else { angle };
                    let in_pages = nearness / (key.chart_size() * chart_metric(cu, cv));
                    // First pass: pages at the level that matches their pixels, largest on
                    // screen first, so most of the image is within one level of final with a
                    // fraction of the pages. Each spot on the ground has one such level: the
                    // floor of what its pixels want. Then everything else that can show, coarse to fine, up
                    // to the level above the first pass, which is what those pixels finally read. Pages
                    // finer than that wait, as nothing on screen reads them until the camera comes closer.
                    let span = half * config.radius;
                    let distance = field::length(offset).max(1.0);
                    let incidence = (-field::dot(center, to_page)).max(0.02);
                    let matched = |d: f64| {
                        let footprint = d.max(1.0) * config.pixel_angle / incidence.max(0.15);
                        wanted_level(config.radius, cu, cv, footprint)
                            .clamp(0.0, f64::from(finest))
                            .floor()
                    };
                    let (far, near) = (
                        matched(distance + span),
                        matched((distance - span).max(camera.clearance)),
                    );
                    let page = key.chart_size() * chart_metric(cu, cv) * config.radius;
                    let on_screen = page * page * incidence / (distance * distance);
                    // Pool admission is omnidirectional. View direction may
                    // reorder requests, but must never evict prepared heights
                    // or imagery when the owner only turns their head.
                    let residency = if f64::from(level) >= far && f64::from(level) <= near {
                        -on_screen.clamp(1e-6, 1.0).log10() * 1000.0
                    } else {
                        (if f64::from(level) > near + 1.0 {
                            FINER_IN_VIEW
                        } else {
                            SECOND_PASS
                        }) + f64::from(level) * 1000.0
                            + in_pages * 40.0
                    };
                    admission.insert(key, residency);
                    let first_pass = in_view && f64::from(level) >= far && f64::from(level) <= near;
                    let priority = if first_pass {
                        let page = key.chart_size() * chart_metric(cu, cv) * config.radius;
                        let on_screen = page * page * incidence / (distance * distance);
                        -on_screen.clamp(1e-6, 1.0).log10() * 1000.0
                    } else {
                        (if !in_view {
                            OUT_OF_VIEW
                        } else if f64::from(level) > near + 1.0 {
                            FINER_IN_VIEW
                        } else {
                            SECOND_PASS
                        }) + f64::from(level) * 1000.0
                            + in_pages * 40.0
                            + (1.0 - facing) * 60.0
                    };
                    wanted.push((key, priority as f32));
                }
            }
            wanted.sort_by(|a, b| {
                admission[&a.0]
                    .total_cmp(&admission[&b.0])
                    .then_with(|| a.0.cmp(&b.0))
            });
            // The pool holds what ranks highest, by camera and key alone, so that what a small pool
            // holds does not depend on what arrived first. The rest are not wanted at all, so they
            // are not fetched over and over, and they are counted.
            let room = spec.slots.saturating_sub(PageKey::pinned_count()) as usize;
            let (before, mut live) = (wanted.len(), 0usize);
            wanted.retain(|(key, _)| {
                if key.pinned() {
                    return true;
                }
                live += 1;
                if live > room {
                    serving.remove(key);
                }
                live <= room
            });
            wanted.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
            let over_pool = (before - wanted.len()) as u32;
            let channel = &mut self.channels[index];
            channel.counters.over_pool = over_pool;
            channel.finest = finest;
            channel.wanted_set = wanted.iter().map(|w| w.0).collect();
            channel.serving = serving;
            for (key, _) in &wanted {
                if let Some(r) = channel.resident.get_mut(key) {
                    r.last_wanted = tick;
                }
            }
            channel.wanted = wanted;
            // Windows follow what may be shown, so such a page always has an entry.
            let mut bounds: HashMap<(u8, u8), [u32; 4]> = HashMap::new();
            for key in &channel.serving {
                let b = bounds
                    .entry((key.level, key.face))
                    .or_insert([key.x, key.y, key.x, key.y]);
                b[0] = b[0].min(key.x);
                b[1] = b[1].min(key.y);
                b[2] = b[2].max(key.x);
                b[3] = b[3].max(key.y);
            }
            let mut moved: Vec<(u8, u8)> = Vec::new();
            for ((level, face), b) in &bounds {
                if (1u32 << *level) <= WINDOW {
                    continue;
                }
                let origin = channel.origin(*level, *face);
                let fits = b[0] >= origin[0]
                    && b[1] >= origin[1]
                    && b[2] < origin[0] + WINDOW
                    && b[3] < origin[1] + WINDOW;
                if !fits {
                    moved.push((*level, *face));
                }
            }
            let wanted_bounds = bounds;
            // Rebuilding a window walks ancestors, so a camera cut spreads it over frames. A window
            // not yet moved only means those queries answer from a coarser level meanwhile.
            moved.sort_unstable();
            for (level, face) in moved.into_iter().take(WINDOW_MOVES_PER_UPDATE) {
                let b = wanted_bounds[&(level, face)];
                let side = 1u32 << level;
                let center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
                channel.origins[usize::from(level) * 6 + usize::from(face)] = [
                    center[0].saturating_sub(WINDOW / 2).min(side - WINDOW),
                    center[1].saturating_sub(WINDOW / 2).min(side - WINDOW),
                ];
                channel.origins_changed = true;
                channel.rebuild_layer(level, face);
            }
            // Cancel what could no longer be shown; pinned pages are never cancelled. A page speed
            // has only paused stays in flight, or each burst of speed would restart its fetch.
            let stale: Vec<PageKey> = channel
                .in_flight
                .keys()
                .filter(|k| !k.pinned() && !channel.serving.contains(k))
                .copied()
                .collect();
            for key in stale {
                if let Some(id) = channel.in_flight.remove(&key) {
                    commands.cancel.push(id);
                    channel.counters.cancelled += 1;
                }
            }
            // Ask for the most urgent absent pages, within the in-flight limit. Most of a cold view's
            // pages are ones nothing on screen reads, for a turn or a closer camera later. They come
            // last, a few at a time, and only while the eye is still, so that a page that can show
            // never waits behind one and a free service is not asked for what nobody sees.
            let room = config
                .in_flight_limit
                .saturating_sub(channel.in_flight.len());
            let unseen_limit = if speed > STILL_SPEED {
                0
            } else {
                config.unseen_in_flight[index]
            };
            let is_unseen = |priority: f32| f64::from(priority) >= FINER_IN_VIEW;
            let mut unseen = channel
                .wanted
                .iter()
                .filter(|(key, priority)| {
                    is_unseen(*priority) && channel.in_flight.contains_key(key)
                })
                .count();
            let repairs = repairs(spec.channel, &channel.wanted);
            let settled = |key: &PageKey| {
                channel.resident.contains_key(key)
                    && (!key.pinned() || channel.refreshed.contains(key))
            };
            let mut refreshing = channel.in_flight.keys().filter(|key| settled(key)).count();
            let mut issued = 0;
            let mut asks: Vec<(PageKey, f32, bool)> = Vec::new();
            for (key, priority) in &channel.wanted {
                if issued >= room || (is_unseen(*priority) && unseen >= unseen_limit) {
                    break;
                }
                let settled = settled(key);
                let refresh =
                    settled && (channel.provisional.contains(key) || repairs.contains(key));
                if (settled && (!refresh || refreshing >= REFRESHES_IN_FLIGHT))
                    || channel.in_flight.contains_key(key)
                    || channel.missing.contains(key)
                    || channel.retry.get(key).is_some_and(|r| r.0 > tick)
                {
                    continue;
                }
                asks.push((*key, *priority, refresh));
                refreshing += usize::from(refresh);
                issued += 1;
                unseen += usize::from(is_unseen(*priority));
            }
            for (key, priority, refresh) in asks {
                let id = self.next_id;
                self.next_id = self.next_id.wrapping_add(1).max(1);
                let channel = &mut self.channels[index];
                channel.in_flight.insert(key, id);
                commands.want.push(PageRequest {
                    id,
                    channel: spec.channel,
                    key,
                    priority,
                    refresh,
                });
            }
            let channel = &mut self.channels[index];
            channel.sync_mapping();
            channel.counters.wanted = channel.wanted.len() as u32;
            channel.counters.resident = channel.resident.len() as u32;
            channel.counters.in_flight = channel.in_flight.len() as u32;
        }
        commands
    }
    /// A page arrived. Returns its atlas slot, or None if nobody wants it any more or the pool
    /// has nothing it may replace. Both are counted; the page is simply dropped.
    pub fn on_page(&mut self, channel: u8, key: PageKey, from_pack: bool) -> Option<u32> {
        let tick = self.tick;
        let channel = &mut self.channels[usize::from(channel)];
        if from_pack && channel.refreshed.contains(&key) {
            return None;
        }
        if !from_pack && key.pinned() {
            channel.refreshed.insert(key);
        }
        channel.in_flight.remove(&key);
        channel.retry.remove(&key);
        channel.missing.remove(&key);
        channel.provisional.remove(&key);
        if let Some(r) = channel.resident.get_mut(&key) {
            r.last_wanted = tick;
            let slot = r.slot;
            if key.pinned() || channel.serving.contains(&key) {
                channel.map_page(key, slot);
            }
            return Some(slot);
        }
        if !key.pinned() && !channel.serving.contains(&key) {
            channel.counters.dropped_unwanted += 1;
            return None;
        }
        let Some(slot) = channel.free.pop().or_else(|| channel.evict_one(tick)) else {
            // The pool holds only wanted pages. Coarser pages were asked for first, so this
            // is the finest detail losing out. Count it and do not fetch it again at once.
            channel.counters.pool_overflow += 1;
            channel.retry.insert(key, (tick + 120, 1));
            return None;
        };
        channel.resident.insert(
            key,
            Resident {
                slot,
                last_wanted: tick,
            },
        );
        channel.map_page(key, slot);
        Some(slot)
    }
    /// The page that just arrived is provisional. It stays up, and is asked for again after a while.
    pub fn on_provisional(&mut self, channel: u8, key: PageKey) {
        let tick = self.tick;
        let channel = &mut self.channels[usize::from(channel)];
        if let Some(slot) = channel.resident.get(&key).map(|r| r.slot) {
            channel.provisional.insert(key);
            channel.retry.insert(key, (tick + REFRESH_AFTER_TICKS, 0));
            if channel.mapped.contains(&key) {
                channel.entries_arrived(key, slot);
            }
        }
    }
    /// The source says this level does not exist here. Never asked for again; the parent serves.
    pub fn on_missing(&mut self, channel: u8, key: PageKey) {
        let channel = &mut self.channels[usize::from(channel)];
        channel.in_flight.remove(&key);
        channel.missing.insert(key);
        channel.counters.not_found += 1;
    }
    /// A transient failure. Retried later, with growing delay, while it stays wanted.
    pub fn on_failed(&mut self, channel: u8, key: PageKey) {
        let tick = self.tick;
        let channel = &mut self.channels[usize::from(channel)];
        channel.in_flight.remove(&key);
        let attempts = channel.retry.get(&key).map_or(1, |r| r.1 + 1);
        channel
            .retry
            .insert(key, (tick + (20u64 << attempts.min(6)), attempts));
        // A page that stays up has not failed anyone. It is only asked for again.
        if !channel.provisional.contains(&key) {
            channel.counters.failed += 1;
        }
    }
    /// Pages that became served or stopped being served since the last call, per channel.
    pub fn take_map_changes(&mut self, channel: u8) -> Vec<(PageKey, bool)> {
        std::mem::take(&mut self.channels[usize::from(channel)].map_changes)
    }
    /// Pages that left this channel's pool since the last call.
    pub fn take_evicted(&mut self, channel: u8) -> Vec<PageKey> {
        std::mem::take(&mut self.channels[usize::from(channel)].evicted)
    }
    /// Pages the table serves now, for what-is-on-screen questions.
    pub fn served(&self, channel: u8) -> impl Iterator<Item = PageKey> + '_ {
        self.channels[usize::from(channel)].mapped.iter().copied()
    }
    /// The atlas slot of a resident page.
    pub fn slot_of(&self, channel: u8, key: PageKey) -> Option<u32> {
        self.channels[usize::from(channel)]
            .resident
            .get(&key)
            .map(|r| r.slot)
    }
    /// The pages the view wants on a channel with their urgency (lower is more urgent), most urgent first.
    pub fn wanted(&self, channel: u8) -> &[(PageKey, f32)] {
        &self.channels[usize::from(channel)].wanted
    }
    pub fn is_resident(&self, channel: u8, key: PageKey) -> bool {
        self.channels[usize::from(channel)]
            .resident
            .contains_key(&key)
    }
    /// Table layers changed since the last call, with their 32 x 32 entries.
    pub fn take_dirty_layers(&mut self, limit: usize) -> Vec<(u32, Vec<u32>)> {
        let mut out = Vec::new();
        for channel in &mut self.channels {
            let mut layers: Vec<u32> = channel.dirty.iter().copied().collect();
            layers.sort_unstable();
            for layer in layers {
                if out.len() >= limit {
                    return out;
                }
                channel.dirty.remove(&layer);
                let local = layer - u32::from(channel.spec.channel) * TABLE_LEVELS * 6;
                let n = WINDOW * WINDOW;
                let at = (local * n) as usize;
                out.push((layer, channel.table[at..at + n as usize].to_vec()));
            }
        }
        out
    }
    /// Window origins, one per table layer, when any moved since the last call.
    pub fn take_origins(&mut self) -> Option<Vec<[u32; 2]>> {
        if !self.channels.iter().any(|c| c.origins_changed) {
            return None;
        }
        for channel in &mut self.channels {
            channel.origins_changed = false;
        }
        Some(
            self.channels
                .iter()
                .flat_map(|c| c.origins.iter().copied())
                .collect(),
        )
    }
    /// The entry a query at this exact level would read, walking coarser out of its window.
    pub fn lookup(&self, channel: u8, mut key: PageKey) -> u32 {
        let channel = &self.channels[usize::from(channel)];
        loop {
            let origin = channel.origin(key.level, key.face);
            let side = 1u32 << key.level;
            let span = WINDOW.min(side);
            if key.x >= origin[0]
                && key.y >= origin[1]
                && key.x < origin[0] + span
                && key.y < origin[1] + span
            {
                let n = (WINDOW * WINDOW) as usize;
                let at = (usize::from(key.level) * 6 + usize::from(key.face)) * n;
                let entry =
                    channel.table[at + ((key.y % WINDOW) * WINDOW + key.x % WINDOW) as usize];
                if entry & ENTRY_VALID != 0 {
                    return entry;
                }
            }
            match key.parent() {
                Some(parent) => key = parent,
                None => return 0,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::lon_lat_to_direction;
    const R: f64 = 6_371_000.0;
    fn specs(slots: u32) -> Vec<ChannelSpec> {
        vec![
            ChannelSpec {
                channel: CHANNEL_HEIGHT,
                max_level: 11,
                sharp: &[],
                live_from: PINNED_LEVELS,
                slots,
                page_bytes: 137_000.0,
            },
            ChannelSpec {
                channel: CHANNEL_ALBEDO,
                max_level: 12,
                sharp: &[],
                live_from: PINNED_LEVELS,
                slots,
                page_bytes: 20_000.0,
            },
        ]
    }
    fn camera(lon: f64, lat: f64, clearance: f64, velocity: V3) -> StreamCamera {
        let n = lon_lat_to_direction(lon.to_radians(), lat.to_radians());
        StreamCamera {
            position: field::mul(n, R + clearance),
            velocity,
            forward: field::mul(n, -1.0),
            clearance,
        }
    }
    fn stream(slots: u32) -> Stream {
        let mut s = Stream::new(StreamConfig::default(), &specs(slots));
        for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
            for key in PageKey::all_pinned() {
                assert!(s.on_page(channel, key, true).is_some());
            }
        }
        s
    }
    #[test]
    fn body_source_limits_cancel_impossible_detail_and_keep_ancestors() {
        let mut s = stream(1125);
        let cam = camera(6.63, 46.52, 2.0, [0.0; 3]);
        let old = s.update(&cam);
        assert!(old.want.iter().any(|p| p.key.level > 6));
        let mut limits = specs(1125);
        limits[0].max_level = 6;
        limits[1].max_level = 4;
        s.source_limits(&limits);
        let now = s.update(&cam);
        assert_eq!(s.finest(0), 6);
        assert_eq!(s.finest(1), 4);
        assert!(now
            .want
            .iter()
            .all(|p| p.key.level <= limits[p.channel as usize].max_level));
        assert!(old
            .want
            .iter()
            .filter(|p| p.key.level > limits[p.channel as usize].max_level)
            .all(|p| now.cancel.contains(&p.id)));
        for channel in &s.channels {
            assert!(channel.spec.sharp.is_empty());
            assert!(channel.resident.keys().any(|key| key.pinned()));
        }
    }
    #[test]
    fn mountain_flight_uses_ground_clearance_to_order_detail_pages() {
        let low = camera(6.63, 46.52, 10.0, [0.0; 3]);
        let high = StreamCamera {
            position: field::mul(field::normalized(low.position), R + 4010.0),
            ..low
        };
        let priorities = |cam: &StreamCamera| {
            let mut s = stream(1125);
            s.update(cam);
            s.wanted(CHANNEL_HEIGHT)
                .iter()
                .filter(|(k, _)| k.level >= 9)
                .map(|(k, priority)| (*k, priority.round() as i32))
                .collect::<Vec<_>>()
        };
        let expected = priorities(&low);
        assert!(!expected.is_empty());
        assert_eq!(priorities(&high), expected);
    }
    #[test]
    fn a_complete_planet_always_answers() {
        let s = stream(1125);
        for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
            for face in 0..6u8 {
                for (x, y) in [(0, 0), (1 << 19, 77), (1048575, 1048575)] {
                    let entry = s.lookup(
                        channel,
                        PageKey {
                            face,
                            level: 20,
                            x,
                            y,
                        },
                    );
                    assert!(entry & ENTRY_VALID != 0);
                    assert!(entry_level(entry) < PINNED_LEVELS);
                }
            }
        }
    }
    #[test]
    fn an_arrival_serves_every_finer_query_and_an_eviction_falls_back() {
        let mut s = stream(1125);
        let cam = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let commands = s.update(&cam);
        assert!(!commands.want.is_empty());
        let first = commands.want[0];
        assert!(first.key.level >= PINNED_LEVELS);
        let slot = s.on_page(first.channel, first.key, false).unwrap();
        let deep = PageKey {
            face: first.key.face,
            level: first.key.level + 3,
            x: first.key.x * 8 + 3,
            y: first.key.y * 8 + 5,
        };
        // Deep pages may lie outside their window, in which case the query walks coarser
        // through windows until one holds it.
        let entry = s.lookup(first.channel, first.key);
        assert_eq!(entry_slot(entry), slot);
        assert_eq!(entry_level(entry), first.key.level);
        let entry = s.lookup(first.channel, deep);
        assert!(entry_level(entry) >= PINNED_LEVELS - 1);
    }
    #[test]
    fn hovering_settles_and_stops_asking() {
        let mut s = stream(1350);
        let cam = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let mut total = 0;
        for _ in 0..4000 {
            let commands = s.update(&cam);
            if commands.want.is_empty() {
                break;
            }
            total += commands.want.len();
            for want in commands.want {
                assert!(s.on_page(want.channel, want.key, false).is_some());
            }
        }
        assert!(s.update(&cam).want.is_empty());
        assert!(total > 100, "{total}");
        assert_eq!(s.counters(CHANNEL_HEIGHT).pool_overflow, 0);
        // Everything wanted is resident, and the served level under the camera is the finest.
        let (face, u, v) = direction_to_chart(field::normalized(cam.position));
        let finest = s.finest(CHANNEL_HEIGHT);
        assert_eq!(finest, 11);
        let (key, _, _) = page_at(face, finest, u, v);
        assert_eq!(entry_level(s.lookup(CHANNEL_HEIGHT, key)), finest);
    }
    #[test]
    fn page_rate_does_not_grow_with_speed() {
        // The plan's invariant: moving faster excludes the finest levels, so demand is flat.
        let rate = |speed: f64| {
            let mut s = stream(4000);
            let mut lon = 6.0;
            let mut asked = 0usize;
            let mut seconds = 0.0;
            for frame in 0..600 {
                let dt = 1.0 / 60.0;
                lon += speed * dt / (R * 46.5f64.to_radians().cos()) * 57.29578;
                let east = lon_lat_to_direction((lon + 90.0).to_radians(), 0.0);
                let cam = camera(lon, 46.5, 2_000.0, field::mul(east, speed));
                let commands = s.update(&cam);
                if frame >= 240 {
                    asked += commands.want.len();
                    seconds += dt;
                }
                for want in commands.want {
                    let _ = s.on_page(want.channel, want.key, false);
                }
            }
            asked as f64 / seconds
        };
        let (slow, fast, faster) = (rate(3_000.0), rate(30_000.0), rate(300_000.0));
        assert!(fast < slow * 2.0, "{slow} {fast}");
        assert!(faster < slow * 2.0, "{slow} {faster}");
        assert!(faster > 0.0);
    }
    #[test]
    fn resident_repairs_share_the_refresh_budget_and_keep_terrain_final() {
        let mut s = stream(1125);
        let eye = camera(6.6, 46.5, 3000.0, [0.0; 3]);
        let mut repair = HashSet::new();
        for p in s.update(&eye).want {
            if p.channel == CHANNEL_HEIGHT {
                s.on_page(p.channel, p.key, false).unwrap();
                repair.insert(p.key);
            }
        }
        let repair_requests = |s: &mut Stream, keys: &HashSet<PageKey>| {
            s.update_with_repairs(&eye, |channel, _| {
                if channel == CHANNEL_HEIGHT {
                    keys.clone()
                } else {
                    HashSet::new()
                }
            })
            .want
            .into_iter()
            .filter(|p| p.refresh)
            .collect::<Vec<_>>()
        };
        let asked = repair_requests(&mut s, &repair);
        assert_eq!(asked.len(), REFRESHES_IN_FLIGHT);
        assert!(repair_requests(&mut s, &repair).is_empty());
        for p in asked {
            assert_ne!(s.lookup(p.channel, p.key), 0);
            assert_eq!(s.lookup(p.channel, p.key) & ENTRY_PROVISIONAL, 0);
            let before = s.slot_of(p.channel, p.key);
            assert_eq!(s.on_page(p.channel, p.key, false), before);
        }
        assert!(repair_requests(&mut s, &HashSet::new()).is_empty());
    }
    #[test]
    fn a_provisional_page_stays_up_and_is_asked_for_again_a_few_at_a_time() {
        let mut s = stream(1125);
        let eye = camera(6.6, 46.5, 3000.0, [0.0; 3]);
        let commands = s.update(&eye);
        let heights: Vec<PageKey> = commands
            .want
            .iter()
            .filter(|w| w.channel == CHANNEL_HEIGHT)
            .map(|w| w.key)
            .take(REFRESHES_IN_FLIGHT + 3)
            .collect();
        assert!(heights.len() > REFRESHES_IN_FLIGHT);
        assert!(commands.want.iter().all(|w| !w.refresh));
        let height = usize::from(CHANNEL_HEIGHT);
        for key in &heights {
            s.on_page(CHANNEL_HEIGHT, *key, false).unwrap();
            s.on_provisional(CHANNEL_HEIGHT, *key);
            // The table says so, so that what read the page can tell when its final form replaces it.
            assert!(s.lookup(CHANNEL_HEIGHT, *key) & ENTRY_PROVISIONAL != 0);
        }
        // Not at once, as whatever made it provisional will not have gone away.
        let soon = s.update(&eye);
        assert!(!soon.want.iter().any(|w| heights.contains(&w.key)));
        for _ in 0..REFRESH_AFTER_TICKS {
            assert!(!s.update(&eye).want.iter().any(|w| w.refresh));
        }
        // With room to ask, the most urgent go first, and only a few at once: each may wait long on its host.
        let open: Vec<PageKey> = s.channels[height]
            .in_flight
            .keys()
            .copied()
            .take(REFRESHES_IN_FLIGHT + 2)
            .collect();
        for key in open {
            s.on_page(CHANNEL_HEIGHT, key, false);
        }
        let later = s.update(&eye);
        let again: Vec<&PageRequest> = later.want.iter().filter(|w| w.refresh).collect();
        assert_eq!(again.len(), REFRESHES_IN_FLIGHT);
        assert!(again.iter().all(|w| heights.contains(&w.key)));
        // Failing changes nothing about the page: it stays up, unfailed, and comes round again.
        let failed = s.channels[height].counters.failed;
        let first = again[0].key;
        s.on_failed(CHANNEL_HEIGHT, first);
        assert_eq!(s.channels[height].counters.failed, failed);
        assert!(s.served(CHANNEL_HEIGHT).any(|k| k == first));
        assert!(s.channels[height].provisional.contains(&first));
        // An ordinary arrival settles it, at the same level and in the same slot, and the table changes.
        let before = s.lookup(CHANNEL_HEIGHT, first);
        s.on_page(CHANNEL_HEIGHT, first, false).unwrap();
        assert!(!s.channels[height].provisional.contains(&first));
        let after = s.lookup(CHANNEL_HEIGHT, first);
        assert_ne!(before, after);
        assert_eq!(entry_slot(before), entry_slot(after));
        assert_eq!(entry_level(before), entry_level(after));
    }
    #[test]
    fn what_nothing_on_screen_reads_waits_behind_what_can_show() {
        let mut s = stream(3000);
        // Looking along the ground, so that the view reaches well past the finest pages' own reach.
        let mut cam = camera(6.63, 46.52, 1000.0, [0.0; 3]);
        let ahead = field::mul(
            lon_lat_to_direction(7.5_f64.to_radians(), 46.52_f64.to_radians()),
            R,
        );
        cam.forward = field::normalized(field::sub(ahead, cam.position));
        s.update(&cam);
        for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
            let wanted = &s.channels[usize::from(channel)].wanted;
            let step = |lo: f64, hi: f64| {
                wanted
                    .iter()
                    .filter(|(_, p)| f64::from(*p) >= lo && f64::from(*p) < hi)
                    .collect::<Vec<_>>()
            };
            let (first, second, finer, out) = (
                step(0.0, SECOND_PASS),
                step(SECOND_PASS, FINER_IN_VIEW),
                step(FINER_IN_VIEW, OUT_OF_VIEW),
                step(OUT_OF_VIEW, f64::MAX),
            );
            assert!(
                !first.is_empty() && !second.is_empty() && !finer.is_empty() && !out.is_empty()
            );
            assert_eq!(
                first.len() + second.len() + finer.len() + out.len(),
                wanted.len()
            );
            // In the order they are asked for, whatever comes finer than the first pass waits behind what can show.
            let ask = |entry: &&&(PageKey, f32)| wanted.iter().position(|w| w == **entry).unwrap();
            assert!(first.iter().map(|e| ask(&e)).max() < second.iter().map(|e| ask(&e)).min());
            assert!(second.iter().map(|e| ask(&e)).max() < finer.iter().map(|e| ask(&e)).min());
            assert!(finer.iter().map(|e| ask(&e)).max() < out.iter().map(|e| ask(&e)).min());
        }
    }

    #[test]
    fn a_turn_changes_order_but_not_the_wanted_set() {
        let mut a = stream(1125);
        let mut b = stream(1125);
        let mut one = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let mut two = one;
        one.forward = [1.0, 0.0, 0.0];
        two.forward = [-1.0, 0.0, 0.0];
        let _ = a.update(&one);
        let _ = b.update(&two);
        let keys = |s: &Stream| {
            let mut k: Vec<_> = s.channels[0].wanted.iter().map(|w| w.0).collect();
            k.sort();
            k
        };
        assert_eq!(keys(&a), keys(&b));
    }
    #[test]
    fn a_turn_under_pool_pressure_keeps_height_and_imagery_residency() {
        let mut a = stream(PageKey::pinned_count() + 40);
        let mut b = stream(PageKey::pinned_count() + 40);
        for s in [&mut a, &mut b] {
            s.channels[0].spec.max_level = 15;
        }
        let mut one = camera(7.1284, 51.1396, 3.0, [0.0; 3]);
        let mut two = one;
        one.forward = [1.0, 0.0, 0.0];
        two.forward = [-1.0, 0.0, 0.0];
        let _ = a.update(&one);
        let _ = b.update(&two);
        for channel in 0..2 {
            assert!(a.channels[channel].counters.over_pool > 0);
            assert_eq!(
                a.channels[channel].wanted_set,
                b.channels[channel].wanted_set
            );
            assert_eq!(a.channels[channel].serving, b.channels[channel].serving);
        }
    }
    #[test]
    fn missing_is_never_asked_again_and_failure_backs_off() {
        let mut s = stream(1125);
        let cam = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let first = s.update(&cam).want[0];
        s.on_missing(first.channel, first.key);
        for _ in 0..50 {
            for want in s.update(&cam).want {
                assert_ne!(want.key, first.key);
            }
        }
        let mut s = stream(1125);
        let commands = s.update(&cam);
        let first = commands.want[0];
        for want in &commands.want[1..] {
            let _ = s.on_page(want.channel, want.key, false);
        }
        s.on_failed(first.channel, first.key);
        assert_eq!(s.counters(first.channel).failed, 1);
        for want in s.update(&cam).want {
            assert!(
                want.key != first.key || want.channel != first.channel,
                "backs off"
            );
            let _ = s.on_page(want.channel, want.key, false);
        }
        let mut seen_again = false;
        for _ in 0..200 {
            for want in s.update(&cam).want {
                if want.key == first.key && want.channel == first.channel {
                    seen_again = true;
                } else {
                    let _ = s.on_page(want.channel, want.key, false);
                }
            }
        }
        assert!(seen_again, "retries while still wanted");
    }
    #[test]
    fn a_direction_change_cancels_and_a_small_pool_evicts_old_pages() {
        let mut s = stream(510 + 80);
        let a = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let b = camera(-120.0, 37.0, 500.0, [0.0; 3]);
        // Fill around the first place.
        for _ in 0..400 {
            let commands = s.update(&a);
            for want in commands.want {
                let _ = s.on_page(want.channel, want.key, false);
            }
        }
        let before = s.counters(CHANNEL_HEIGHT).resident;
        assert!(before > 510);
        // A cut leaves requests in flight, then the next update cancels them.
        let in_flight = s.update(&b);
        let cancels = s.update(&a);
        assert!(!in_flight.want.is_empty());
        assert!(!cancels.cancel.is_empty());
        for _ in 0..400 {
            let commands = s.update(&b);
            for want in commands.want {
                let _ = s.on_page(want.channel, want.key, false);
            }
        }
        assert!(s.counters(CHANNEL_HEIGHT).evicted > 0);
        // Pinned pages are never evicted.
        for key in PageKey::all_pinned() {
            assert!(s.is_resident(CHANNEL_HEIGHT, key));
        }
    }
    #[test]
    fn slow_links_lower_c_and_fast_links_raise_it() {
        let mut s = stream(1125);
        s.observe_throughput(625_000.0); // 5 Mbit/s
        let slow = s.c;
        s.observe_throughput(12_500_000.0); // 100 Mbit/s
        assert!(s.c > slow);
        assert!(s.c <= s.config.c_max && slow >= s.config.c_min);
    }
    #[test]
    fn wanted_level_matches_cell_size_at_a_face_centre() {
        assert!((wanted_level(R, 0.0, 0.0, cell_size(R, 11.0)) - 11.0).abs() < 1e-9);
    }
    #[test]
    fn a_sharp_region_raises_the_finest_level_only_over_it() {
        const SWISS: &[SharpRegion] = &[SharpRegion {
            lon: [5.9, 10.5],
            lat: [45.8, 47.9],
            max_level: 16,
        }];
        let mut spec = specs(2000);
        spec[1].sharp = SWISS;
        let mut s = Stream::new(StreamConfig::default(), &spec);
        let _ = s.update(&camera(6.63, 46.52, 30.0, [0.0; 3]));
        assert_eq!(s.finest(CHANNEL_ALBEDO), 16);
        assert_eq!(s.finest(CHANNEL_HEIGHT), 11);
        let _ = s.update(&camera(2.35, 48.85, 30.0, [0.0; 3]));
        assert_eq!(s.finest(CHANNEL_ALBEDO), 12);
    }
    #[test]
    fn a_burst_of_speed_keeps_what_is_shown_and_what_is_in_flight() {
        let mut s = stream(4000);
        let mut cam = camera(6.6, 46.5, 2000.0, [0.0, 0.0, 0.0]);
        let want = s.update(&cam).want;
        let finest = want
            .iter()
            .filter(|p| p.channel == 0)
            .map(|p| p.key.level)
            .max()
            .unwrap();
        // Everything arrives except one page at the finest level, which stays in flight.
        let held = want
            .iter()
            .find(|p| p.channel == 0 && p.key.level == finest)
            .unwrap()
            .key;
        for p in &want {
            if p.key != held || p.channel != 0 {
                s.on_page(p.channel, p.key, false);
            }
        }
        let shown = want
            .iter()
            .find(|p| p.channel == 0 && p.key.level == finest && p.key != held)
            .unwrap()
            .key;
        s.update(&cam);
        assert_eq!(entry_level(s.lookup(0, shown)), finest);
        // Fast enough that nothing near this level is admitted for fetching.
        cam.velocity = [0.0, 50_000.0, 0.0];
        let burst = s.update(&cam);
        assert!(s.finest(0) < finest, "speed must pause fetching");
        assert!(
            burst
                .want
                .iter()
                .all(|p| p.key.level <= s.finest(p.channel)),
            "nothing finer may be asked for"
        );
        assert!(burst.cancel.is_empty(), "a paused page must stay in flight");
        assert_eq!(
            entry_level(s.lookup(0, shown)),
            finest,
            "speed must not take detail off the screen"
        );
    }
    #[test]
    fn the_table_serves_only_what_is_wanted_so_routes_cannot_show_through() {
        let settled = |route: &[StreamCamera]| {
            let mut s = stream(4000);
            for cam in route {
                for _ in 0..300 {
                    for want in s.update(cam).want {
                        let _ = s.on_page(want.channel, want.key, false);
                    }
                }
            }
            s
        };
        let target = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let direct = settled(&[target]);
        let around = settled(&[camera(6.9, 46.2, 3000.0, [0.0; 3]), target]);
        for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
            let (a, b) = (
                &direct.channels[usize::from(channel)],
                &around.channels[usize::from(channel)],
            );
            let levels =
                |c: &Channel| -> Vec<u8> { c.table.iter().map(|e| entry_level(*e)).collect() };
            assert_eq!(a.origins.len(), b.origins.len());
            assert_eq!(a.mapped.len(), b.mapped.len());
            assert_eq!(a.mapped, b.mapped);
            // Same origins do not hold for windows left behind, but every query must agree.
            for key in a.mapped.iter() {
                assert_eq!(
                    entry_level(direct.lookup(channel, *key)),
                    entry_level(around.lookup(channel, *key))
                );
            }
            let _ = levels;
        }
    }
    #[test]
    fn every_pinned_page_in_sight_is_live_whichever_way_the_camera_came() {
        let mut spec = specs(4000);
        spec[1].live_from = 2;
        let settled = |route: &[StreamCamera]| {
            let mut s = Stream::new(StreamConfig::default(), &spec);
            for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
                for key in PageKey::all_pinned() {
                    assert!(s.on_page(channel, key, true).is_some());
                }
            }
            for cam in route {
                for _ in 0..300 {
                    for want in s.update(cam).want {
                        let _ = s.on_page(want.channel, want.key, false);
                    }
                }
            }
            s
        };
        // From 5,000 km, Germany's horizon lies well past the rings of a D3 page.
        let target = camera(10.0, 51.0, 5_000_000.0, [0.0; 3]);
        let direct = settled(&[target]);
        let around = settled(&[camera(-9.2, 38.7, 6_000.0, [0.0; 3]), target]);
        let pinned = |s: &Stream| -> HashSet<PageKey> {
            s.channels[1]
                .wanted
                .iter()
                .map(|w| w.0)
                .filter(|k| k.pinned())
                .collect()
        };
        let sight = pinned(&direct);
        assert_eq!(sight, pinned(&around));
        assert!(
            sight.iter().filter(|k| k.level == 3).count() > 81,
            "the rings alone hold at most 81"
        );
        for key in &sight {
            assert!(direct.channels[1].refreshed.contains(key));
            assert!(around.channels[1].refreshed.contains(key));
        }
    }
    #[test]
    fn a_small_pool_holds_the_same_pages_whichever_way_the_camera_came() {
        let settled = |route: &[StreamCamera]| {
            let mut s = stream(510 + 80);
            for cam in route {
                for _ in 0..600 {
                    for want in s.update(cam).want {
                        let _ = s.on_page(want.channel, want.key, false);
                    }
                }
            }
            s
        };
        let target = camera(6.63, 46.52, 500.0, [0.0; 3]);
        let mut direct = settled(&[target]);
        let mut around = settled(&[camera(6.9, 46.2, 3000.0, [0.0; 3]), target]);
        for channel in [CHANNEL_HEIGHT, CHANNEL_ALBEDO] {
            let (a, b) = (
                &direct.channels[usize::from(channel)],
                &around.channels[usize::from(channel)],
            );
            assert_eq!(a.mapped, b.mapped);
            assert_eq!(a.counters.over_pool, b.counters.over_pool);
            assert!(a.counters.over_pool > 0, "this pool is meant to be small");
            assert_eq!(a.counters.pool_overflow, 0, "nothing is dropped on arrival");
        }
        // And nothing is asked for again at rest.
        assert!(direct.update(&target).want.is_empty());
        assert!(around.update(&target).want.is_empty());
    }
    #[test]
    fn clearance_does_not_read_the_set_it_decides() {
        let s = stream(4000);
        let mut pages = PageField::new(R, 12);
        for key in PageKey::all_pinned() {
            pages.insert(crate::pages::page_from_function(key, |_| 0.0));
        }
        let eye = field::mul(lon_lat_to_direction(0.2, 0.8), R + 30_000.0);
        let (face, u, v) = direction_to_chart(field::normalized(eye));
        assert_eq!(s.clearance(&pages, eye), 30_000.0);
        let asked = s.altitude_level(chart_metric(u, v), 30_000.0) as u8;
        // A page this clearance does not ask for, disagreeing by enough to ask for a finer level.
        let (key, _, _) = page_at(face, asked + 1, u, v);
        pages.insert(crate::pages::page_from_function(key, |_| 25_000.0));
        assert_eq!(s.clearance(&pages, eye), 30_000.0);
        // The page it does ask for counts, and the walk goes on from there.
        let (key, _, _) = page_at(face, asked, u, v);
        pages.insert(crate::pages::page_from_function(key, |_| 10_000.0));
        assert!((s.clearance(&pages, eye) - 5_000.0).abs() < 1e-6);
    }
    #[test]
    fn rings_cross_cube_edges() {
        // Just south of the +Y / +Z edge, near Genoa: the ring holds pages on both faces.
        let mut s = stream(4000);
        let cam = camera(8.9, 44.5, 500.0, [0.0; 3]);
        let _ = s.update(&cam);
        let faces: HashSet<u8> = s.channels[0].wanted.iter().map(|w| w.0.face).collect();
        assert!(faces.contains(&2) && faces.contains(&4), "{faces:?}");
    }
}

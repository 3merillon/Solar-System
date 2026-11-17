//! Measured field pages on the integer cube grid, and the f64 reader that defines
//! what they mean. The WGSL field (`shaders/surface_field.wgsl`) evaluates the same
//! formulas; the height audit compares the two. See docs/M1-LIVE-EARTH.md.
use crate::{
    field::{self, V3},
    planet::{Geology, BANDS},
    skin::Skin,
    surface::{ClipmapEnvelope, FieldAnswer, Served, SurfaceSource},
};
use std::collections::{HashMap, HashSet};

/// Texels per page side, gutters included. 15 x 15 pages fit one 4096-square layer.
pub const PAGE_TEXELS: usize = 264;
pub const PAGES_PER_LAYER_SIDE: u32 = 15;
pub const PAGE_CELLS: u32 = 256;
/// Grid point 0 of a height page sits at this texel (3 below, 4 above).
pub const HEIGHT_GUTTER: i32 = 3;
/// Cell 0 of an albedo page sits at this texel.
pub const ALBEDO_GUTTER: i32 = 4;
pub const MAX_PAGE_LEVEL: u8 = 20;
/// Levels D0 to D3 are always resident, so a complete planet always exists.
pub const PINNED_LEVELS: u8 = 4;
/// A patch at level L lies inside one page at D = L - 4.
pub const PATCH_TO_PAGE: u32 = 4;
/// Cells over which a page fades to a coarser neighbour.
pub const PAGE_FADE_CELLS: f64 = 32.0;
/// Relief kept on ground that is not water-flat, as a share of full complement amplitude.
pub const RELIEF_FLOOR: f64 = 0.25;
/// Bytes of one height page: little-endian u16 per texel.
pub const HEIGHT_PAGE_BYTES: usize = PAGE_TEXELS * PAGE_TEXELS * 2;
/// Bytes of one albedo page: RGBA8 per texel.
pub const ALBEDO_PAGE_BYTES: usize = PAGE_TEXELS * PAGE_TEXELS * 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PageKey {
    pub face: u8,
    pub level: u8,
    pub x: u32,
    pub y: u32,
}
impl PageKey {
    pub fn parent(self) -> Option<PageKey> {
        (self.level > 0).then(|| PageKey {
            face: self.face,
            level: self.level - 1,
            x: self.x / 2,
            y: self.y / 2,
        })
    }
    pub fn pinned(self) -> bool {
        self.level < PINNED_LEVELS
    }
    /// Chart width of one page.
    pub fn chart_size(self) -> f64 {
        2.0 / f64::from(1u32 << self.level)
    }
    /// Chart coordinates of the page centre.
    pub fn center(self) -> (f64, f64) {
        let s = self.chart_size();
        (
            -1.0 + (f64::from(self.x) + 0.5) * s,
            -1.0 + (f64::from(self.y) + 0.5) * s,
        )
    }
    /// How many pages the pinned levels hold: 6 x (1 + 4 + 16 + 64) = 510.
    pub const fn pinned_count() -> u32 {
        6 * ((1 << (2 * PINNED_LEVELS as u32)) - 1) / 3
    }
    /// All pages of the pinned levels.
    pub fn all_pinned() -> Vec<PageKey> {
        let mut pages = Vec::with_capacity(510);
        for face in 0..6u8 {
            for level in 0..PINNED_LEVELS {
                let side = 1u32 << level;
                for y in 0..side {
                    for x in 0..side {
                        pages.push(PageKey { face, level, x, y });
                    }
                }
            }
        }
        pages
    }
}
/// The gnomonic cube chart of the terrain patches; `cube_key` in terrain_gpu.wgsl.
pub fn chart_to_direction(face: u8, u: f64, v: f64) -> V3 {
    field::normalized(match face {
        0 => [1.0, v, -u],
        1 => [-1.0, v, u],
        2 => [u, 1.0, -v],
        3 => [u, -1.0, v],
        4 => [u, v, 1.0],
        _ => [-u, v, -1.0],
    })
}
/// Inverse of `chart_to_direction`, choosing the dominant axis exactly as `face_chart`.
pub fn direction_to_chart(n: V3) -> (u8, f64, f64) {
    let a = [n[0].abs(), n[1].abs(), n[2].abs()];
    if a[0] >= a[1] && a[0] >= a[2] {
        if n[0] >= 0.0 {
            (0, -n[2] / a[0], n[1] / a[0])
        } else {
            (1, n[2] / a[0], n[1] / a[0])
        }
    } else if a[1] >= a[2] {
        if n[1] >= 0.0 {
            (2, n[0] / a[1], -n[2] / a[1])
        } else {
            (3, n[0] / a[1], n[2] / a[1])
        }
    } else if n[2] >= 0.0 {
        (4, n[0] / a[2], n[1] / a[2])
    } else {
        (5, -n[0] / a[2], n[1] / a[2])
    }
}
/// +Y north, longitude 0 on +Z, east on +X. Radians.
pub fn lon_lat_to_direction(lon: f64, lat: f64) -> V3 {
    [lat.cos() * lon.sin(), lat.sin(), lat.cos() * lon.cos()]
}
pub fn direction_to_lon_lat(n: V3) -> (f64, f64) {
    (n[0].atan2(n[2]), n[1].clamp(-1.0, 1.0).asin())
}
/// Isotropic metres per chart unit at (u, v), relative to a face centre: between the
/// tangential 1/r and the radial 1/r^2 compression of the gnomonic chart.
pub fn chart_metric(u: f64, v: f64) -> f64 {
    let r2 = 1.0 + u * u + v * v;
    r2.powf(-0.75)
}
/// Cell width at a face centre of level `level`, metres.
pub fn cell_size(radius: f64, level: f64) -> f64 {
    radius / 128.0 * (-level).exp2()
}
/// The level whose cell matches `footprint` metres at (u, v), unclamped.
pub fn wanted_level(radius: f64, u: f64, v: f64, footprint: f64) -> f64 {
    (radius / 128.0 * chart_metric(u, v) / footprint.max(1e-6)).log2()
}

/// Quadratic B-spline weights and derivative weights at x, with stencil centre i.
#[inline]
pub fn spline(x: f64) -> (i32, [f64; 3], [f64; 3]) {
    let i = (x + 0.5).floor();
    let s = x - i;
    (
        i as i32,
        [
            0.5 * (0.5 - s) * (0.5 - s),
            0.75 - s * s,
            0.5 * (0.5 + s) * (0.5 + s),
        ],
        [s - 0.5, -2.0 * s, s + 0.5],
    )
}

#[derive(Clone, Debug)]
pub struct HeightPage {
    pub key: PageKey,
    pub offset: f64,
    pub scale: f64,
    pub samples: Vec<u16>,
}
impl HeightPage {
    pub fn from_bytes(key: PageKey, offset: f64, scale: f64, bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != HEIGHT_PAGE_BYTES {
            return Err(format!("height page of {} bytes", bytes.len()));
        }
        Ok(Self {
            key,
            offset,
            scale,
            samples: bytes
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect(),
        })
    }
    #[inline]
    fn texel(&self, gx: i32, gy: i32) -> f64 {
        let i = (gx + HEIGHT_GUTTER).clamp(0, PAGE_TEXELS as i32 - 1) as usize;
        let j = (gy + HEIGHT_GUTTER).clamp(0, PAGE_TEXELS as i32 - 1) as usize;
        self.offset + self.scale * f64::from(self.samples[j * PAGE_TEXELS + i])
    }
    /// Min/max of the texels each of 8 x 8 blocks of 32 cells can read. A quadratic
    /// B-spline read is a convex combination of its 3 x 3 stencil, so it lies inside.
    pub fn block_bounds(&self) -> [(f64, f64); 64] {
        let mut out = [(f64::INFINITY, f64::NEG_INFINITY); 64];
        for (b, slot) in out.iter_mut().enumerate() {
            let (bx, by) = ((b % 8) as i32, (b / 8) as i32);
            for gy in by * 32 - 2..=by * 32 + 34 {
                for gx in bx * 32 - 2..=bx * 32 + 34 {
                    let t = self.texel(gx, gy);
                    slot.0 = slot.0.min(t);
                    slot.1 = slot.1.max(t);
                }
            }
        }
        out
    }
    /// Spline height and gradient in grid units at grid position (gx, gy).
    pub fn read(&self, gx: f64, gy: f64) -> (f64, f64, f64) {
        let (ix, wx, dx) = spline(gx);
        let (iy, wy, dy) = spline(gy);
        let (mut h, mut du, mut dv) = (0.0, 0.0, 0.0);
        for (b, (&a, &d)) in wy.iter().zip(&dy).enumerate() {
            for (c, (&e, &g)) in wx.iter().zip(&dx).enumerate() {
                let t = self.texel(ix + c as i32 - 1, iy + b as i32 - 1);
                h += t * e * a;
                du += t * g * a;
                dv += t * e * d;
            }
        }
        (h, du, dv)
    }
}
/// Page coordinates of a chart position at `level`: page index and grid position in it.
pub fn page_at(face: u8, level: u8, u: f64, v: f64) -> (PageKey, f64, f64) {
    let side = f64::from(1u32 << level);
    // A point on a page boundary belongs to the page after it, as on the GPU; chart rounding,
    // about 1e-16 of a face, must not move a mesh vertex into the page before.
    let snap = |p: f64| {
        let r = p.round();
        if (p - r).abs() < 1e-12 * side {
            r
        } else {
            p
        }
    };
    let px = snap((u * 0.5 + 0.5) * side);
    let py = snap((v * 0.5 + 0.5) * side);
    let x = px.floor().clamp(0.0, side - 1.0);
    let y = py.floor().clamp(0.0, side - 1.0);
    (
        PageKey {
            face,
            level,
            x: x as u32,
            y: y as u32,
        },
        (px - x) * f64::from(PAGE_CELLS),
        (py - y) * f64::from(PAGE_CELLS),
    )
}
/// One field read: the height, its surface gradient per metre and what served it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DataRead {
    pub height: f64,
    pub gradient: V3,
    pub served_level: u8,
}
/// Tangent-plane gradient per metre on a sphere of `radius`, from chart derivatives.
/// `du`, `dv` are height per chart unit. Only the two chart tangents and their dual
/// basis enter, so the same formula runs in WGSL with f32.
pub fn chart_gradient(radius: f64, face: u8, u: f64, v: f64, du: f64, dv: f64) -> V3 {
    let plane = |u: f64, v: f64| -> V3 {
        match face {
            0 => [1.0, v, -u],
            1 => [-1.0, v, u],
            2 => [u, 1.0, -v],
            3 => [u, -1.0, v],
            4 => [u, v, 1.0],
            _ => [-u, v, -1.0],
        }
    };
    let p = plane(u, v);
    let r2 = field::dot(p, p);
    let r = r2.sqrt();
    let n = field::mul(p, 1.0 / r);
    let e_u = field::sub(plane(u + 1.0, v), p);
    let e_v = field::sub(plane(u, v + 1.0), p);
    // d(R p/r)/du = R (e_u - n (n.e_u)) / r
    let t_u = field::mul(
        field::sub(e_u, field::mul(n, field::dot(n, e_u))),
        radius / r,
    );
    let t_v = field::mul(
        field::sub(e_v, field::mul(n, field::dot(n, e_v))),
        radius / r,
    );
    let g11 = field::dot(t_u, t_u);
    let g12 = field::dot(t_u, t_v);
    let g22 = field::dot(t_v, t_v);
    let det = g11 * g22 - g12 * g12;
    let a = (g22 * du - g12 * dv) / det;
    let b = (g11 * dv - g12 * du) / det;
    field::add(field::mul(t_u, a), field::mul(t_v, b))
}

/// Measured surface: resident pages plus band complements. It mirrors the GPU's height pool, because
/// a reader that holds less answers differently from the mesh it is meant to agree with.
pub struct PageField {
    pub radius: f64,
    pub geology: Geology,
    /// Where a body has no height data at all, its surface is flat to the reader, and this much of the complement is laid
    /// over it anyway. Zero on a body with heights.
    pub relief_floor: f64,
    /// Largest level any source supplies, for "the finest thing the source has".
    pub max_level: u8,
    /// Roughness used by the complement: |grad H| of this value means full amplitude.
    pub rough_gradient: f64,
    pages: HashMap<PageKey, HeightPage>,
    unserved: HashSet<PageKey>,
    /// Min/max of the texels each 32-cell block of a page's spline can read, metres.
    blocks: HashMap<PageKey, Box<[(f64, f64); 64]>>,
    /// Union of the block bounds of every page at or below a key: the bound pyramid.
    subtree: HashMap<PageKey, (f64, f64)>,
}
impl PageField {
    pub fn new(radius: f64, max_level: u8) -> Self {
        Self {
            radius,
            geology: Geology::default(),
            relief_floor: 0.0,
            max_level,
            rough_gradient: 0.5,
            pages: HashMap::new(),
            unserved: HashSet::new(),
            blocks: HashMap::new(),
            subtree: HashMap::new(),
        }
    }
    pub fn len(&self) -> usize {
        self.pages.len()
    }
    pub fn is_empty(&self) -> bool {
        self.pages.is_empty()
    }
    pub fn contains(&self, key: PageKey) -> bool {
        self.pages.contains_key(&key)
    }
    pub fn insert(&mut self, page: HeightPage) {
        let key = page.key;
        self.blocks.insert(key, Box::new(page.block_bounds()));
        self.pages.insert(key, page);
        self.refresh_subtree(key);
    }
    pub fn remove(&mut self, key: PageKey) {
        self.pages.remove(&key);
        self.unserved.remove(&key);
        if self.blocks.remove(&key).is_some() {
            self.refresh_subtree(key);
        }
    }
    /// Recompute the bound pyramid from `key` up to its face root.
    fn refresh_subtree(&mut self, key: PageKey) {
        let mut at = Some(key);
        while let Some(k) = at {
            let mut bound = self.blocks.get(&k).map(|b| union_all(b.iter().copied()));
            if k.level < MAX_PAGE_LEVEL {
                for c in 0..4u32 {
                    let child = PageKey {
                        face: k.face,
                        level: k.level + 1,
                        x: k.x * 2 + (c & 1),
                        y: k.y * 2 + (c >> 1),
                    };
                    if let Some(b) = self.subtree.get(&child) {
                        bound = Some(bound.map_or(*b, |a| (a.0.min(b.0), a.1.max(b.1))));
                    }
                }
            }
            match bound {
                Some(b) => self.subtree.insert(k, b),
                None => self.subtree.remove(&k),
            };
            at = k.parent();
        }
    }
    /// Level of the nearest served page at or above `key`, if any.
    fn served_level(&self, key: PageKey) -> Option<u8> {
        self.resident(key).map(|p| p.key.level)
    }
    /// Coarsest level a read inside `key` (at its own level) can blend with: its served
    /// level and its eight neighbours', the only targets of the page edge fade.
    fn fade_floor(&self, key: PageKey) -> Option<u8> {
        let side = 1i64 << key.level;
        let mut lowest: Option<u8> = None;
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                let (x, y) = (i64::from(key.x) + dx, i64::from(key.y) + dy);
                if x < 0 || y < 0 || x >= side || y >= side {
                    continue;
                }
                let near = PageKey {
                    x: x as u32,
                    y: y as u32,
                    ..key
                };
                let l = self.served_level(near)?;
                lowest = Some(lowest.map_or(l, |m| m.min(l)));
            }
        }
        lowest
    }
    /// Largest complement a read served at `level` can add: every non-ridge band the
    /// page does not resolve, |noise term| <= 1, roughness factor <= max(1, floor).
    pub fn complement_bound(&self, level: u8) -> f64 {
        let spacing = cell_size(self.radius, f64::from(level));
        let mut c = 0.0;
        for k in 0..BANDS {
            let (scale, amplitude, mode) = self.geology.band(k);
            if mode == 1 {
                continue;
            }
            c += amplitude * (1.0 - Skin::weight(scale, spacing)).max(0.0);
        }
        c * self.relief_floor.max(1.0)
    }
    /// Bound of every read inside the chart square [u0,u1] x [v0,v1] of one face.
    fn square_bounds(&self, face: u8, u0: f64, u1: f64, v0: f64, v1: f64) -> (f64, f64) {
        let width = (u1 - u0).max(v1 - v0).max(1e-12);
        // Pages of this level are at least twice the square's width: at most 2 x 2 cover it.
        let level = ((1.0 / width).log2().floor().max(0.0) as u8).min(MAX_PAGE_LEVEL);
        let (k0, _, _) = page_at(face, level, u0, v0);
        let (k1, _, _) = page_at(face, level, u1, v1);
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        let mut floor = u8::MAX;
        for y in k0.y..=k1.y {
            for x in k0.x..=k1.x {
                let key = PageKey { face, level, x, y };
                // Nothing served here at all: the reference sphere answers.
                let Some(own) = self.served_level(key) else {
                    lo = lo.min(0.0);
                    hi = hi.max(0.0);
                    floor = 0;
                    continue;
                };
                let ancestor = PageKey {
                    face,
                    level: own.min(level),
                    x: x >> (level - own.min(level)),
                    y: y >> (level - own.min(level)),
                };
                for k in [key, ancestor] {
                    match self.fade_floor(k) {
                        Some(l) => floor = floor.min(l).min(own),
                        None => {
                            lo = lo.min(0.0);
                            hi = hi.max(0.0);
                            floor = 0;
                        }
                    }
                }
                if let Some(b) = self.subtree.get(&key) {
                    lo = lo.min(b.0);
                    hi = hi.max(b.1);
                }
                // Every resident ancestor's blocks over the square: fades and coarse reads.
                let mut at = key.parent();
                while let Some(a) = at {
                    if let Some(blocks) = self.blocks.get(&a) {
                        let block_range = |c0: f64, c1: f64, page: u32| {
                            let side = f64::from(1u32 << a.level);
                            let g = |c: f64| ((c * 0.5 + 0.5) * side - f64::from(page)) * 8.0;
                            (
                                g(c0).floor().clamp(0.0, 7.0) as usize,
                                g(c1).floor().clamp(0.0, 7.0) as usize,
                            )
                        };
                        let (bx0, bx1) = block_range(u0, u1, a.x);
                        let (by0, by1) = block_range(v0, v1, a.y);
                        for by in by0..=by1 {
                            for bx in bx0..=bx1 {
                                let b = blocks[by * 8 + bx];
                                lo = lo.min(b.0);
                                hi = hi.max(b.1);
                            }
                        }
                    }
                    at = a.parent();
                }
            }
        }
        let c = self.complement_bound(floor.min(MAX_PAGE_LEVEL));
        (lo - c, hi + c)
    }
    /// The bound pyramid: a conservative interval of `query(_, 0.0)` over the cap of
    /// `radius` metres of arc around `n`. A spline read is a convex combination of the
    /// texels it touches, so block min/max bound it; fades and footprint blends mix such
    /// reads; the complement adds at most `complement_bound` at the coarsest level any
    /// read in the cap can blend with. It bounds the served surface, not the truth.
    pub fn region_interval(&self, n: V3, radius: f64) -> (f64, f64) {
        let angle = (radius.max(0.0) / self.radius).min(1.0);
        let (face, u, v) = direction_to_chart(n);
        // The gnomonic chart stretches arcs by at most 1 + u^2 + v^2.
        let du = angle * (1.0 + u * u + v * v) * 1.1 + 1e-12;
        let du = angle * (1.0 + (u.abs() + du).powi(2) + (v.abs() + du).powi(2)) * 1.1 + 1e-12;
        if u.abs() + du <= 1.0 && v.abs() + du <= 1.0 {
            return self.square_bounds(face, u - du, u + du, v - du, v + du);
        }
        // Near a cube edge: the cap's directions grouped by face, each face's chart box
        // around its samples widened by the same stretch margin.
        let a = if n[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        let t1 = field::normalized(cross(n, a));
        let t2 = cross(n, t1);
        let mut boxes: [Option<(f64, f64, f64, f64)>; 6] = [None; 6];
        for ring in [0.0, 0.5, 1.0] {
            let (sin, cos) = (angle * ring).sin_cos();
            for i in 0..16 {
                let phi = f64::from(i) * std::f64::consts::TAU / 16.0;
                let d = field::normalized(field::add(
                    field::mul(n, cos),
                    field::add(
                        field::mul(t1, sin * phi.cos()),
                        field::mul(t2, sin * phi.sin()),
                    ),
                ));
                let (f, cu, cv) = direction_to_chart(d);
                let e = &mut boxes[f as usize];
                *e = Some(e.map_or((cu, cu, cv, cv), |(a0, a1, b0, b1)| {
                    (a0.min(cu), a1.max(cu), b0.min(cv), b1.max(cv))
                }));
                if ring == 0.0 {
                    break;
                }
            }
        }
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for (f, b) in boxes.iter().enumerate() {
            if let Some((a0, a1, b0, b1)) = *b {
                let r = self.square_bounds(
                    f as u8,
                    (a0 - du).max(-1.0),
                    (a1 + du).min(1.0),
                    (b0 - du).max(-1.0),
                    (b1 + du).min(1.0),
                );
                lo = lo.min(r.0);
                hi = hi.max(r.1);
            }
        }
        (lo, hi)
    }
    /// The GPU table served this page, or stopped serving it. The reader must answer as the
    /// GPU does: a cached page the table does not serve must not show through here either.
    pub fn set_served(&mut self, key: PageKey, served: bool) {
        if served {
            self.unserved.remove(&key);
        } else {
            self.unserved.insert(key);
        }
    }
    /// The page itself or its nearest resident ancestor.
    fn resident(&self, key: PageKey) -> Option<&HeightPage> {
        let mut at = Some(key);
        while let Some(k) = at {
            if !self.unserved.contains(&k) {
                if let Some(page) = self.pages.get(&k) {
                    return Some(page);
                }
            }
            at = k.parent();
        }
        None
    }
    /// Read at one exact level (or its nearest resident ancestor).
    pub fn read_level(&self, face: u8, u: f64, v: f64, level: u8) -> Option<DataRead> {
        let (key, _, _) = page_at(face, level, u, v);
        let page = self.resident(key)?;
        let served = page.key.level;
        let (key, gx, gy) = page_at(face, served, u, v);
        debug_assert_eq!(key, page.key);
        let (h, du, dv) = page.read(gx, gy);
        // Grid units to chart units: one grid unit is chart_size / 256.
        let per_chart = f64::from(PAGE_CELLS) / page.key.chart_size();
        Some(DataRead {
            height: h,
            gradient: chart_gradient(self.radius, face, u, v, du * per_chart, dv * per_chart),
            served_level: served,
        })
    }
    /// One level, fading toward a coarser neighbour across the page's last cells, so that resident
    /// pages of different levels never meet at a hard line. page_soft in the shader, without its
    /// arrival fade, which is over in a third of a second and belongs to the display.
    fn read_soft(&self, face: u8, u: f64, v: f64, level: u8) -> Option<(DataRead, f64)> {
        let a = self.read_level(face, u, v, level)?;
        let served = a.served_level;
        let cell = cell_size(self.radius, f64::from(served));
        if served == 0 {
            return Some((a, cell));
        }
        let (key, gx, gy) = page_at(face, served, u, v);
        let (mut weight, mut toward, side) = (1.0_f64, served, 1u32 << served);
        for (x, along) in [(gx, key.x), (gy, key.y)].into_iter().zip([true, false]) {
            let (x, page) = x;
            let edge = x.min(f64::from(PAGE_CELLS) - x);
            if edge >= PAGE_FADE_CELLS {
                continue;
            }
            let up = x >= f64::from(PAGE_CELLS) * 0.5;
            if (up && page + 1 >= side) || (!up && page == 0) {
                continue;
            }
            let next = if up { page + 1 } else { page - 1 };
            let near = if along {
                PageKey { x: next, ..key }
            } else {
                PageKey { y: next, ..key }
            };
            let other = self.resident(near).map_or(0, |p| p.key.level);
            if other < served {
                let t = edge / PAGE_FADE_CELLS;
                weight = weight.min(t * t * (3.0 - 2.0 * t));
                toward = toward.min(other);
            }
        }
        if weight >= 1.0 {
            return Some((a, cell));
        }
        let coarse = self.read_level(face, u, v, toward)?;
        if coarse.served_level == served {
            return Some((a, cell));
        }
        let mixed = |c: f64, f: f64| lerp(c, f, weight);
        Some((
            DataRead {
                height: mixed(coarse.height, a.height),
                gradient: [
                    mixed(coarse.gradient[0], a.gradient[0]),
                    mixed(coarse.gradient[1], a.gradient[1]),
                    mixed(coarse.gradient[2], a.gradient[2]),
                ],
                served_level: served,
            },
            mixed(cell_size(self.radius, f64::from(coarse.served_level)), cell),
        ))
    }
    /// Read at a footprint in metres, blending the two levels around the wanted one so that
    /// a change of footprint moves the answer continuously.
    pub fn read_footprint(&self, n: V3, footprint: f64) -> Option<(DataRead, f64)> {
        let (face, u, v) = direction_to_chart(n);
        let wanted = if footprint <= 0.0 {
            f64::from(self.max_level)
        } else {
            wanted_level(self.radius, u, v, footprint)
        }
        .clamp(0.0, f64::from(self.max_level));
        let low = wanted.floor();
        let t = wanted - low;
        let (a, cell_a) = self.read_soft(face, u, v, low as u8)?;
        if t <= 0.0 || low as u8 >= self.max_level {
            return Some((a, cell_a));
        }
        let (b, cell_b) = self.read_soft(face, u, v, low as u8 + 1)?;
        let spacing = lerp(cell_a, cell_b, t);
        Some((
            DataRead {
                height: lerp(a.height, b.height, t),
                gradient: [
                    lerp(a.gradient[0], b.gradient[0], t),
                    lerp(a.gradient[1], b.gradient[1], t),
                    lerp(a.gradient[2], b.gradient[2], t),
                ],
                served_level: b.served_level,
            },
            spacing,
        ))
    }
    /// Synthesized detail: only wavelengths the served page does not resolve, scaled by the
    /// data's own roughness. Value noise only, whose expected value is zero; this preserves
    /// the measured local mean in expectation, not exactly over one page.
    pub fn complement(&self, n: V3, footprint: f64, served_spacing: f64, gradient: V3) -> f64 {
        let slope = field::length(gradient);
        let dry = ((slope - 0.0005) / 0.0025).clamp(0.0, 1.0);
        let dry = dry * dry * (3.0 - 2.0 * dry);
        let rho = (slope / self.rough_gradient)
            .clamp(0.0, 1.0)
            .max(RELIEF_FLOOR * dry)
            .max(self.relief_floor);
        if rho <= 0.0 {
            return 0.0;
        }
        let crag = ((slope - 0.35) / 0.45).clamp(0.0, 1.0);
        let crag = crag * crag * (3.0 - 2.0 * crag);
        let p = field::mul(n, self.radius);
        let mut h = 0.0;
        for k in 0..BANDS {
            let (scale, amplitude, mode) = self.geology.band(k);
            if mode == 1 {
                continue;
            }
            // What the footprint shows less what the data already resolves. With the footprint at
            // the data's own cell this is exactly zero, so a read at the data's level is the data.
            let w = Skin::weight(scale, footprint) - Skin::weight(scale, served_spacing);
            if w <= 0.001 {
                continue;
            }
            let q = field::noise(
                field::mul(p, 1.0 / scale),
                self.geology.seed.wrapping_add(k as u32),
            );
            h += amplitude * rho * w * (q + (0.3 - q.abs() - q) * crag);
        }
        h
    }
}
fn union_all(it: impl Iterator<Item = (f64, f64)>) -> (f64, f64) {
    it.fold((f64::INFINITY, f64::NEG_INFINITY), |a, b| {
        (a.0.min(b.0), a.1.max(b.1))
    })
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
impl SurfaceSource for PageField {
    fn radius(&self) -> f64 {
        self.radius
    }
    fn query(&self, n: V3, spacing: f64) -> FieldAnswer {
        match self.read_footprint(n, spacing) {
            Some((read, served_spacing)) => FieldAnswer {
                height: read.height
                    + self.complement(n, spacing.max(0.0), served_spacing, read.gradient),
                served: Served::Page {
                    level: read.served_level,
                },
            },
            // A measured body starts with its pinned pack; with nothing at all the answer is
            // the reference sphere and the level says so.
            None => FieldAnswer {
                height: 0.0,
                served: Served::Nothing,
            },
        }
    }
    fn mesh_height(&self, n: V3, level: u32) -> f64 {
        let (face, u, v) = direction_to_chart(n);
        let page_level = level
            .saturating_sub(PATCH_TO_PAGE)
            .min(u32::from(self.max_level)) as u8;
        let spacing = self.radius * 2.0 / f64::from(crate::patches::GRID << level);
        match self.read_level(face, u, v, page_level) {
            Some(read) => {
                read.height
                    + self.complement(
                        n,
                        spacing,
                        cell_size(self.radius, f64::from(read.served_level)),
                        read.gradient,
                    )
            }
            None => 0.0,
        }
    }
    fn mesh_served(&self, n: V3, level: u32) -> Option<u8> {
        let (face, u, v) = direction_to_chart(n);
        let page_level = level
            .saturating_sub(PATCH_TO_PAGE)
            .min(u32::from(self.max_level)) as u8;
        self.read_level(face, u, v, page_level)
            .map(|read| read.served_level)
    }
    fn height_bound(&self) -> Option<f64> {
        None
    }
    fn gradient_bound(&self) -> Option<f64> {
        None
    }
    fn region_bounds(&self, n: V3, radius: f64) -> Option<(f64, f64)> {
        Some(self.region_interval(n, radius))
    }
    fn level_error_bound(&self, _level: u32) -> Option<f64> {
        None
    }
    fn clipmap_envelope(&self, step: f64, live_start: usize) -> ClipmapEnvelope {
        // No source bound exists for unloaded data. Keep the shape of the spectrum estimate
        // the shadow confirmation needs, and say that it is one.
        let mut envelope = Skin {
            geology: self.geology,
            radius: self.radius,
            edits: Vec::new(),
        }
        .clipmap_envelope(step, live_start);
        envelope.conservative = false;
        envelope
    }
}
/// Deterministic test height, for checks independent of any data file.
pub fn synthetic_height(n: V3) -> f64 {
    1000.0 * (n[0] * 37.0).sin() * (n[1] * 23.0).cos() + 300.0 * (n[2] * 91.0).sin()
}
/// Height page sampled from a function, for tests and for the pinned pack's checks.
pub fn page_from_function(key: PageKey, f: impl Fn(V3) -> f64) -> HeightPage {
    let size = PAGE_TEXELS as i32;
    let cell = key.chart_size() / f64::from(PAGE_CELLS);
    let mut values = vec![0.0; PAGE_TEXELS * PAGE_TEXELS];
    let (mut low, mut high) = (f64::MAX, f64::MIN);
    for j in 0..size {
        for i in 0..size {
            let u =
                -1.0 + key.chart_size() * f64::from(key.x) + cell * f64::from(i - HEIGHT_GUTTER);
            let v =
                -1.0 + key.chart_size() * f64::from(key.y) + cell * f64::from(j - HEIGHT_GUTTER);
            let h = f(chart_to_direction(key.face, u, v));
            values[(j * size + i) as usize] = h;
            low = low.min(h);
            high = high.max(h);
        }
    }
    let scale = if high > low {
        (high - low) / 65535.0
    } else {
        0.0
    };
    HeightPage {
        key,
        offset: low,
        scale,
        samples: values
            .iter()
            .map(|h| {
                if scale > 0.0 {
                    ((h - low) / scale).round() as u16
                } else {
                    0
                }
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const R: f64 = 6_371_000.0;
    fn field_with(keys: &[PageKey]) -> PageField {
        let mut f = PageField::new(R, 12);
        for &k in keys {
            f.insert(page_from_function(k, synthetic_height));
        }
        f
    }
    #[test]
    fn chart_round_trip_and_known_places() {
        for face in 0..6u8 {
            for (u, v) in [(0.0, 0.0), (0.3, -0.7), (-0.95, 0.95), (0.999, 0.2)] {
                let n = chart_to_direction(face, u, v);
                let (f, a, b) = direction_to_chart(n);
                assert_eq!(f, face);
                assert!((a - u).abs() < 1e-12 && (b - v).abs() < 1e-12);
            }
        }
        // Lausanne is on the +Y face, north of its edge with +Z.
        let lausanne = lon_lat_to_direction(6.63_f64.to_radians(), 46.52_f64.to_radians());
        let (face, u, v) = direction_to_chart(lausanne);
        assert_eq!(face, 2);
        assert!(u > 0.0 && v < -0.8, "{u} {v}");
        // East is on the right when north is up, seen from outside: not mirrored.
        let at = lon_lat_to_direction(0.0, 0.0);
        let east = lon_lat_to_direction(0.01, 0.0);
        let north = lon_lat_to_direction(0.0, 0.01);
        let forward = field::mul(at, -1.0);
        let up = field::normalized(field::sub(north, at));
        let right = [
            forward[1] * up[2] - forward[2] * up[1],
            forward[2] * up[0] - forward[0] * up[2],
            forward[0] * up[1] - forward[1] * up[0],
        ];
        assert!(field::dot(right, field::sub(east, at)) > 0.0);
        let (lon, lat) = direction_to_lon_lat(lausanne);
        assert!((lon.to_degrees() - 6.63).abs() < 1e-9 && (lat.to_degrees() - 46.52).abs() < 1e-9);
    }
    #[test]
    fn spline_partition_and_range() {
        for k in 0..200 {
            let x = f64::from(k) * 0.0173;
            let (_, w, d) = spline(x);
            assert!((w.iter().sum::<f64>() - 1.0).abs() < 1e-12);
            assert!(d.iter().sum::<f64>().abs() < 1e-12);
            assert!(w.iter().all(|v| *v >= 0.0));
        }
        // C1 across the stencil change at half-integers.
        let flat = |x: f64| {
            let (i, w, _) = spline(x);
            (0..3)
                .map(|c| w[c] * f64::from(i + c as i32 - 1).powi(2))
                .sum::<f64>()
        };
        let e = 1e-7;
        assert!((flat(4.5 - e) - flat(4.5 + e)).abs() < 1e-5);
    }
    #[test]
    fn interpolant_tracks_the_function_and_stays_in_range() {
        let key = PageKey {
            face: 2,
            level: 6,
            x: 30,
            y: 8,
        };
        let page = page_from_function(key, synthetic_height);
        let (low, high) = page
            .samples
            .iter()
            .fold((u16::MAX, 0u16), |a, v| (a.0.min(*v), a.1.max(*v)));
        let (low, high) = (
            page.offset + page.scale * f64::from(low),
            page.offset + page.scale * f64::from(high),
        );
        let size = key.chart_size();
        for k in 0..40 {
            let gx = f64::from(k) * 6.37 + 1.0;
            let gy = f64::from(k) * 3.11 + 2.0;
            let u = -1.0 + size * (f64::from(key.x) + gx / 256.0);
            let v = -1.0 + size * (f64::from(key.y) + gy / 256.0);
            let (h, _, _) = page.read(gx, gy);
            assert!(h >= low - 1e-9 && h <= high + 1e-9);
            let truth = synthetic_height(chart_to_direction(2, u, v));
            assert!((h - truth).abs() < 4.0, "{h} {truth}");
        }
    }
    #[test]
    fn chart_gradient_matches_a_finite_difference_on_the_sphere() {
        // A known height over the sphere, read through the chart at several places.
        let height = |n: V3| 500.0 * n[0] + 200.0 * n[1] * n[2];
        for (face, u, v) in [
            (2u8, 0.3, -0.7),
            (0, -0.9, 0.9),
            (4, 0.0, 0.0),
            (5, 0.5, 0.1),
        ] {
            let e = 1e-6;
            let du = (height(chart_to_direction(face, u + e, v))
                - height(chart_to_direction(face, u - e, v)))
                / (2.0 * e);
            let dv = (height(chart_to_direction(face, u, v + e))
                - height(chart_to_direction(face, u, v - e)))
                / (2.0 * e);
            let g = chart_gradient(R, face, u, v, du, dv);
            let n = chart_to_direction(face, u, v);
            assert!(field::dot(g, n).abs() < 1e-9, "tangent");
            // Compare a step in an arbitrary tangent direction.
            let t = field::normalized(field::sub(
                [0.3, 0.5, 0.8],
                field::mul(n, field::dot(n, [0.3, 0.5, 0.8])),
            ));
            let s = 1e-6;
            let a = field::normalized(field::add(n, field::mul(t, s)));
            let b = field::normalized(field::sub(n, field::mul(t, s)));
            let numeric = (height(a) - height(b)) / (2.0 * s * R);
            assert!(
                (numeric - field::dot(g, t)).abs() < 1e-6,
                "{numeric} {}",
                field::dot(g, t)
            );
        }
    }
    #[test]
    fn missing_pages_answer_coarser_and_say_so() {
        let root = PageKey {
            face: 2,
            level: 0,
            x: 0,
            y: 0,
        };
        let f = field_with(&[root]);
        let n = chart_to_direction(2, 0.12, -0.2);
        let answer = f.query(n, 10.0);
        assert_eq!(answer.served, Served::Page { level: 0 });
        assert!(answer.height.is_finite());
        // A face with no page at all still answers at once.
        let other = f.query(chart_to_direction(5, 0.0, 0.0), 10.0);
        assert_eq!(other.served, Served::Nothing);
    }
    #[test]
    fn a_finer_page_changes_only_where_it_is_read() {
        let n = chart_to_direction(2, 0.12, -0.2);
        let (_, u, v) = direction_to_chart(n);
        let coarse = page_at(2, 0, u, v).0;
        let fine = page_at(2, 5, u, v).0;
        let mut f = field_with(&[coarse]);
        let before = f.read_level(2, u, v, 5).unwrap();
        assert_eq!(before.served_level, 0);
        f.insert(page_from_function(fine, synthetic_height));
        let after = f.read_level(2, u, v, 5).unwrap();
        assert_eq!(after.served_level, 5);
        let truth = synthetic_height(n);
        assert!((after.height - truth).abs() <= (before.height - truth).abs() + 1.0);
    }
    #[test]
    fn a_page_the_table_does_not_serve_does_not_show_through() {
        let coarse = PageKey {
            face: 0,
            level: 3,
            x: 1,
            y: 1,
        };
        let fine = PageKey {
            face: 0,
            level: 5,
            x: 4,
            y: 4,
        };
        let mut f = PageField::new(R, 12);
        f.insert(page_from_function(coarse, synthetic_height));
        f.insert(page_from_function(fine, synthetic_height));
        let (u, v) = fine.center();
        assert_eq!(f.read_level(0, u, v, 5).unwrap().served_level, 5);
        f.set_served(fine, false);
        assert_eq!(f.read_level(0, u, v, 5).unwrap().served_level, 3);
        f.set_served(fine, true);
        f.remove(fine);
        assert_eq!(f.read_level(0, u, v, 5).unwrap().served_level, 3);
    }
    #[test]
    fn complement_stays_above_the_resolved_band_and_flat_stays_flat() {
        let f = field_with(&[]);
        let n = chart_to_direction(2, 0.1, 0.1);
        assert_eq!(f.complement(n, 0.5, 24.0, [0.0, 0.0, 0.0]), 0.0);
        let steep = [0.6, 0.0, 0.0];
        // With a served page finer than every band there is nothing to add.
        assert_eq!(f.complement(n, 0.5, 0.01, steep), 0.0);
        // A wide footprint filters the complement away.
        assert_eq!(f.complement(n, 100_000.0, 24.0, steep), 0.0);
        assert!(f.complement(n, 0.5, 24.0, steep) != 0.0);
    }
}

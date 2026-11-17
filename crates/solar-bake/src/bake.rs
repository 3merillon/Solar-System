//! Page baking: area means of the global sources over each texel's cell on the cube grid.
//!
//! Chart and texel placement follow docs/M1-LIVE-EARTH.md ("Page formats") and the
//! functions of `solar_core::pages`; nothing about the chart is re-derived here.
//!
//! Area mean method: the cell of a texel is a box in chart space. Its four corners give
//! its footprint in source pixels (ex, ey). A mean-pyramid level `l = floor(log2(min(ex, ey)))`
//! is chosen so that one level pixel is no larger than the smaller side, and `n x n` stratified
//! sample points (n = ceil(max(ex, ey) / 2^l), at least 2, at most `MAX_N`) are bilinearly read
//! from that level and averaged. This is an approximation of the exact area mean, not the exact
//! integral; cells near the pole, whose longitude span is the whole circle, are undersampled in
//! longitude once n hits the cap.
use crate::{
    pngenc,
    source::{linear_to_srgb, AlbedoSource, HeightSource},
};
use solar_core::pages::{
    chart_to_direction, direction_to_lon_lat, PageKey, ALBEDO_GUTTER, HEIGHT_GUTTER, PAGE_CELLS,
    PAGE_TEXELS,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

pub const MAX_N: usize = 64;
const TAU: f64 = std::f64::consts::TAU;
const PI: f64 = std::f64::consts::PI;

#[derive(Clone, Debug)]
pub struct BakeOptions {
    /// Heights are snapped to multiples of this many metres before quantizing.
    pub height_step: f64,
    pub jpeg_quality: u8,
    pub chroma_420: bool,
    /// If > 0, the page step is the power of two at or below (mean absolute neighbour
    /// difference / this), clamped to [height_step, height_max_step].
    pub height_rel_div: f64,
    pub height_max_step: f64,
    /// Zopfli iterations for the height PNG; 0 means plain zlib level 9.
    pub zopfli_iterations: u64,
}
impl Default for BakeOptions {
    fn default() -> Self {
        Self {
            height_step: 1.0,
            jpeg_quality: 88,
            chroma_420: false,
            height_rel_div: 4.0,
            height_max_step: 16.0,
            zopfli_iterations: 15,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BakedPage {
    pub key: PageKey,
    pub offset: f32,
    pub scale: f32,
    pub height_png: Vec<u8>,
    pub albedo_jpeg: Vec<u8>,
}

/// Footprint of a chart-space box in source pixels and the sampling plan for it.
#[allow(clippy::too_many_arguments)]
fn plan(
    face: u8,
    u0: f64,
    v0: f64,
    u1: f64,
    v1: f64,
    w: usize,
    h: usize,
    max_level: usize,
) -> (usize, usize) {
    let corners = [(u0, v0), (u1, v0), (u0, v1), (u1, v1)];
    let ll: Vec<(f64, f64)> = corners
        .iter()
        .map(|&(u, v)| direction_to_lon_lat(chart_to_direction(face, u, v)))
        .collect();
    let (cl, _) = direction_to_lon_lat(chart_to_direction(face, 0.5 * (u0 + u1), 0.5 * (v0 + v1)));
    let contains_pole =
        (face == 2 || face == 3) && u0 <= 0.0 && u1 >= 0.0 && v0 <= 0.0 && v1 >= 0.0;
    let (mut lo, mut hi) = (f64::MAX, f64::MIN);
    let (mut la_lo, mut la_hi) = (f64::MAX, f64::MIN);
    for &(lon, lat) in &ll {
        let mut d = lon - cl;
        d -= TAU * (d / TAU).round();
        lo = lo.min(d);
        hi = hi.max(d);
        la_lo = la_lo.min(lat);
        la_hi = la_hi.max(lat);
    }
    let ex = if contains_pole {
        w as f64
    } else {
        ((hi - lo) / TAU * w as f64).min(w as f64)
    };
    let ey = (la_hi - la_lo) / PI * h as f64;
    let small = ex.min(ey).max(1.0);
    let level = (small.log2().floor().max(0.0) as usize).min(max_level);
    let n = ((ex.max(ey) / f64::from(1u32 << level)).ceil() as usize).clamp(2, MAX_N);
    (level, n)
}

/// Mean of `f(lon, lat)` over the stratified sample points of a chart box.
fn box_mean<const C: usize>(
    face: u8,
    u0: f64,
    v0: f64,
    u1: f64,
    v1: f64,
    n: usize,
    f: &impl Fn(f64, f64) -> [f64; C],
) -> [f64; C] {
    let mut acc = [0.0; C];
    for b in 0..n {
        let v = v0 + (b as f64 + 0.5) / n as f64 * (v1 - v0);
        for a in 0..n {
            let u = u0 + (a as f64 + 0.5) / n as f64 * (u1 - u0);
            let (lon, lat) = direction_to_lon_lat(chart_to_direction(face, u, v));
            let s = f(lon, lat);
            for k in 0..C {
                acc[k] += s[k];
            }
        }
    }
    let inv = 1.0 / (n * n) as f64;
    for a in &mut acc {
        *a *= inv;
    }
    acc
}

/// Chart box of the height texel (i, j): the cell centred on grid point (i - 3, j - 3).
pub fn height_cell(key: PageKey, i: i32, j: i32) -> (f64, f64, f64, f64) {
    let cell = key.chart_size() / f64::from(PAGE_CELLS);
    let o = (
        -1.0 + key.chart_size() * f64::from(key.x),
        -1.0 + key.chart_size() * f64::from(key.y),
    );
    let g = |t: i32| f64::from(t - HEIGHT_GUTTER);
    (
        o.0 + cell * (g(i) - 0.5),
        o.1 + cell * (g(j) - 0.5),
        o.0 + cell * (g(i) + 0.5),
        o.1 + cell * (g(j) + 0.5),
    )
}
/// Chart box of the albedo texel (i, j): cell (i - 4, j - 4).
pub fn albedo_cell(key: PageKey, i: i32, j: i32) -> (f64, f64, f64, f64) {
    let cell = key.chart_size() / f64::from(PAGE_CELLS);
    let o = (
        -1.0 + key.chart_size() * f64::from(key.x),
        -1.0 + key.chart_size() * f64::from(key.y),
    );
    let c = |t: i32| f64::from(t - ALBEDO_GUTTER);
    (
        o.0 + cell * c(i),
        o.1 + cell * c(j),
        o.0 + cell * (c(i) + 1.0),
        o.1 + cell * (c(j) + 1.0),
    )
}

/// Area-mean heights of a page, metres, row-major 264 x 264, before snapping.
pub fn height_texels(key: PageKey, src: &HeightSource) -> Vec<f64> {
    let (w, h) = src.size();
    let mut out = vec![0.0; PAGE_TEXELS * PAGE_TEXELS];
    for j in 0..PAGE_TEXELS {
        for i in 0..PAGE_TEXELS {
            let (u0, v0, u1, v1) = height_cell(key, i as i32, j as i32);
            let (level, n) = plan(key.face, u0, v0, u1, v1, w, h, src.max_level());
            out[j * PAGE_TEXELS + i] = box_mean::<1>(key.face, u0, v0, u1, v1, n, &|lo, la| {
                [src.sample(level, lo, la)]
            })[0];
        }
    }
    out
}

/// Snap to multiples of `step`, then quantize. The scale is `step` whenever the snapped range
/// fits 65535 steps, so values land on integers; otherwise it is (max - min) / 65535.
pub fn quantize(values: &[f64], step: f64) -> (f32, f32, Vec<u16>) {
    let snap = |h: f64| {
        if step > 0.0 {
            (h / step).round() * step
        } else {
            h
        }
    };
    let snapped: Vec<f64> = values.iter().map(|&h| snap(h)).collect();
    let min = snapped.iter().cloned().fold(f64::MAX, f64::min);
    let max = snapped.iter().cloned().fold(f64::MIN, f64::max);
    let scale = if step > 0.0 && (max - min) / step <= 65535.0 {
        step
    } else if max > min {
        (max - min) / 65535.0
    } else {
        1.0
    };
    // f32 storage must reproduce what the samples were quantized against.
    let offset = min as f32;
    let scale = scale as f32;
    let q = snapped
        .iter()
        .map(|&h| {
            ((h - f64::from(offset)) / f64::from(scale))
                .round()
                .clamp(0.0, 65535.0) as u16
        })
        .collect();
    (offset, scale, q)
}

/// Area-mean albedo of a page as RGBA8, alpha 255. Linear-light mean, then sRGB.
pub fn albedo_texels(key: PageKey, src: &AlbedoSource) -> Vec<u8> {
    let (w, h) = src.size();
    let mut out = vec![255u8; PAGE_TEXELS * PAGE_TEXELS * 4];
    for j in 0..PAGE_TEXELS {
        for i in 0..PAGE_TEXELS {
            let (u0, v0, u1, v1) = albedo_cell(key, i as i32, j as i32);
            let (level, n) = plan(key.face, u0, v0, u1, v1, w, h, src.max_level());
            let c = box_mean::<3>(key.face, u0, v0, u1, v1, n, &|lo, la| {
                src.sample(level, lo, la)
            });
            let o = (j * PAGE_TEXELS + i) * 4;
            for k in 0..3 {
                out[o + k] = (linear_to_srgb(c[k].clamp(0.0, 1.0)) * 255.0 + 0.5).floor() as u8;
            }
        }
    }
    out
}

pub fn encode_jpeg(rgba: &[u8], quality: u8, chroma_420: bool) -> Vec<u8> {
    use jpeg_encoder::{ColorType, Encoder, SamplingFactor};
    let rgb: Vec<u8> = rgba
        .chunks_exact(4)
        .flat_map(|p| [p[0], p[1], p[2]])
        .collect();
    let mut out = Vec::new();
    let mut enc = Encoder::new(&mut out, quality);
    enc.set_sampling_factor(if chroma_420 {
        SamplingFactor::F_2_2
    } else {
        SamplingFactor::F_1_1
    });
    enc.set_optimized_huffman_tables(true);
    enc.encode(&rgb, PAGE_TEXELS as u16, PAGE_TEXELS as u16, ColorType::Rgb)
        .expect("jpeg encode");
    out
}

/// Page step: `opt.height_step`, or coarser in proportion to the page's own roughness.
pub fn page_step(values: &[f64], opt: &BakeOptions) -> f64 {
    if opt.height_rel_div <= 0.0 {
        return opt.height_step;
    }
    let mut sum = 0.0;
    let mut n = 0usize;
    for row in values.chunks_exact(PAGE_TEXELS) {
        for p in row.windows(2) {
            sum += (p[1] - p[0]).abs();
            n += 1;
        }
    }
    let target = sum / n as f64 / opt.height_rel_div;
    let pow2 = if target >= 1.0 {
        2f64.powf(target.log2().floor())
    } else {
        0.0
    };
    pow2.clamp(opt.height_step, opt.height_max_step)
}

pub fn bake_page(key: PageKey, h: &HeightSource, a: &AlbedoSource, opt: &BakeOptions) -> BakedPage {
    let values = height_texels(key, h);
    let (offset, scale, q) = quantize(&values, page_step(&values, opt));
    BakedPage {
        key,
        offset,
        scale,
        height_png: pngenc::encode_height_png(&q, PAGE_TEXELS, PAGE_TEXELS, opt.zopfli_iterations),
        albedo_jpeg: encode_jpeg(&albedo_texels(key, a), opt.jpeg_quality, opt.chroma_420),
    }
}

/// Bake pages in parallel; the result keeps the order of `keys`.
pub fn bake_pages(
    keys: &[PageKey],
    h: &HeightSource,
    a: &AlbedoSource,
    opt: &BakeOptions,
    threads: usize,
) -> Vec<BakedPage> {
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let slots: Mutex<Vec<Option<BakedPage>>> = Mutex::new(vec![None; keys.len()]);
    std::thread::scope(|s| {
        for _ in 0..threads.max(1) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= keys.len() {
                    break;
                }
                let page = bake_page(keys[i], h, a, opt);
                slots.lock().unwrap()[i] = Some(page);
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                if d % 50 == 0 || d == keys.len() {
                    eprintln!("baked {d}/{} pages", keys.len());
                }
            });
        }
    });
    slots
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|p| p.expect("page baked"))
        .collect()
}

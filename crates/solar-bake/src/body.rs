//! Bake one body of the solar system from USGS global mosaics: its pinned pack, deeper pages in
//! bundles per face and level, and the small map its impostor draws from. A body with no global
//! height data bakes with flat height, and the manifest says so. Nothing synthesized goes in.
use crate::{
    bake::{self, BakeOptions, BakedPage},
    pack,
    source::{srgb_to_linear, AlbedoSource, HeightSource},
};
use serde_json::{json, Value};
use solar_core::pages::PageKey;
use std::{fs, fs::File, io::BufReader, path::Path};
use tiff::decoder::{Decoder, DecodingResult, Limits};
use tiff::tags::Tag;

pub struct RasterInfo {
    pub width: usize,
    pub height: usize,
    /// Longitude of the left edge, degrees, read from the GeoTIFF if it says.
    pub left_edge: Option<f64>,
    pub channels: usize,
}
/// Fill NaN cells of an equirectangular raster from those around them, in place, returning how many were unknown. Push-pull: means of
/// the known cells down a pyramid, wrapping in longitude, then each level's unknown cells taken from the one below, bilinearly, so
/// that a hole of any size meets its edge with no step. Known cells do not change.
pub fn fill_holes(raster: &mut [f32], width: usize, height: usize) -> usize {
    let unknown = raster.iter().filter(|v| !v.is_finite()).count();
    if unknown == 0 || unknown == raster.len() {
        return unknown;
    }
    let mut levels: Vec<(Vec<f32>, usize, usize)> = Vec::new();
    let (mut w, mut h) = (width, height);
    let mut above: Vec<f32> = raster.to_vec();
    while w > 1 || h > 1 {
        let (nw, nh) = (w.div_ceil(2), h.div_ceil(2));
        let mut sum = vec![0f64; nw * nh];
        let mut count = vec![0u32; nw * nh];
        for y in 0..h {
            for x in 0..w {
                let v = above[y * w + x];
                if v.is_finite() {
                    let at = (y / 2) * nw + x / 2;
                    sum[at] += f64::from(v);
                    count[at] += 1;
                }
            }
        }
        let below: Vec<f32> = sum
            .iter()
            .zip(&count)
            .map(|(s, c)| {
                if *c > 0 {
                    (*s / f64::from(*c)) as f32
                } else {
                    f32::NAN
                }
            })
            .collect();
        levels.push((std::mem::replace(&mut above, below), w, h));
        (w, h) = (nw, nh);
    }
    let mut filled = above;
    let (mut fw, mut fh) = (w, h);
    while let Some((mut level, lw, lh)) = levels.pop() {
        for y in 0..lh {
            for x in 0..lw {
                let at = y * lw + x;
                if level[at].is_finite() {
                    continue;
                }
                let u = (x as f64 + 0.5) * fw as f64 / lw as f64 - 0.5;
                let t =
                    ((y as f64 + 0.5) * fh as f64 / lh as f64 - 0.5).clamp(0.0, fh as f64 - 1.0);
                let (x0, y0) = (u.floor(), t.floor());
                let (fx, fy) = (u - x0, t - y0);
                let column = |i: i64| i.rem_euclid(fw as i64) as usize;
                let (xa, xb) = (column(x0 as i64), column(x0 as i64 + 1));
                let (ya, yb) = (y0 as usize, (y0 as usize + 1).min(fh - 1));
                let v = |xi: usize, yi: usize| f64::from(filled[yi * fw + xi]);
                let top = v(xa, ya) * (1.0 - fx) + v(xb, ya) * fx;
                let bottom = v(xa, yb) * (1.0 - fx) + v(xb, yb) * fx;
                level[at] = (top * (1.0 - fy) + bottom * fy) as f32;
            }
        }
        filled = level;
        (fw, fh) = (lw, lh);
    }
    raster.copy_from_slice(&filled);
    unknown
}
/// Read a GeoTIFF, averaging every `decimate` pixels as it goes, so a mosaic larger than memory
/// is fine. Values come back per channel as f32, in file units. `no_data` values are skipped in the mean.
pub fn read_raster(
    path: &Path,
    decimate: usize,
    no_data: Option<f64>,
) -> Result<(Vec<f32>, RasterInfo), String> {
    let f = BufReader::new(File::open(path).map_err(|e| format!("{}: {e}", path.display()))?);
    let mut d = Decoder::new(f)
        .map_err(|e| e.to_string())?
        .with_limits(Limits::unlimited());
    // The file's own statement of what means no data, GDAL's tag, unless the caller says otherwise: a hole taken for a height is a
    // chasm, -32768 m on Pluto.
    let no_data = no_data.or_else(|| {
        d.get_tag_ascii_string(Tag::GdalNodata).ok().and_then(|t| {
            t.trim_matches(|c: char| c == '\0' || c.is_whitespace())
                .parse::<f64>()
                .ok()
        })
    });
    let (w, h) = d.dimensions().map_err(|e| e.to_string())?;
    let (w, h) = (w as usize, h as usize);
    let color = d.colortype().map_err(|e| e.to_string())?;
    use tiff::ColorType as C;
    let channels = match color {
        C::Gray(_) => 1,
        C::RGB(_) => 3,
        C::RGBA(_) => 4,
        other => return Err(format!("unsupported colour type {other:?}")),
    };
    let tiepoint = d.get_tag_f64_vec(Tag::Unknown(33922)).unwrap_or_default();
    let scale = d.get_tag_f64_vec(Tag::Unknown(33550)).unwrap_or_default();
    // Metres or degrees: either way, the left edge's fraction of the width says where it is.
    let left_edge = if tiepoint.len() >= 4 && !scale.is_empty() && scale[0] > 0.0 {
        let span = scale[0] * w as f64;
        Some(tiepoint[3] / span * 360.0)
    } else {
        None
    };
    let (out_w, out_h) = (w / decimate, h / decimate);
    let mut sum = vec![0f64; out_w * out_h * channels.min(3)];
    let mut count = vec![0u32; out_w * out_h * channels.min(3)];
    let chunks = d.strip_count().map_err(|e| e.to_string())? as usize;
    let (_, chunk_h) = d.chunk_dimensions();
    // Bands may lie one after another in the file instead of interleaved, each its own run of strips.
    let planar = d.get_tag_u32(Tag::PlanarConfiguration).unwrap_or(1) == 2;
    let per_plane = if planar { chunks / channels } else { chunks };
    let samples = if planar { 1 } else { channels };
    let mut y = 0usize;
    for i in 0..chunks {
        if planar && i % per_plane == 0 {
            y = 0;
        }
        let plane = i / per_plane;
        let (cw, ch) = d.chunk_data_dimensions(i as u32);
        let (cw, ch) = (cw as usize, ch as usize);
        if cw != w {
            return Err("tiled TIFFs are not read here".into());
        }
        let data = d.read_chunk(i as u32).map_err(|e| e.to_string())?;
        macro_rules! feed {
            ($v:expr) => {{
                for row in 0..ch {
                    let oy = (y + row) / decimate;
                    if oy >= out_h {
                        continue;
                    }
                    for x in 0..out_w * decimate {
                        for k in 0..samples.min(3) {
                            if plane >= 3 {
                                continue;
                            }
                            let value = $v[(row * w + x) * samples + k] as f64;
                            if !value.is_finite()
                                || no_data.is_some_and(|n| (value - n).abs() < 0.5)
                            {
                                continue;
                            }
                            let band = if planar { plane } else { k };
                            let at = (oy * out_w + x / decimate) * channels.min(3) + band;
                            sum[at] += value;
                            count[at] += 1;
                        }
                    }
                }
            }};
        }
        match data {
            DecodingResult::U8(v) => feed!(v),
            DecodingResult::U16(v) => feed!(v),
            DecodingResult::I16(v) => feed!(v),
            DecodingResult::U32(v) => feed!(v),
            DecodingResult::I32(v) => feed!(v),
            DecodingResult::F32(v) => feed!(v),
            DecodingResult::F64(v) => feed!(v),
            _ => return Err("unsupported sample type".into()),
        }
        y += chunk_h as usize;
        let _ = ch;
    }
    let out: Vec<f32> = sum
        .iter()
        .zip(&count)
        .map(|(s, n)| {
            if *n > 0 {
                (*s / f64::from(*n)) as f32
            } else {
                f32::NAN
            }
        })
        .collect();
    Ok((
        out,
        RasterInfo {
            width: out_w,
            height: out_h,
            left_edge,
            channels: channels.min(3),
        },
    ))
}
/// Roll a map so its left edge is longitude -180, as the bake reads it.
fn to_left_edge_minus_180(data: &mut [f32], w: usize, channels: usize, left_edge: f64) {
    let shift = (((left_edge + 180.0) / 360.0).rem_euclid(1.0) * w as f64).round() as usize % w;
    if shift == 0 {
        return;
    }
    for row in data.chunks_exact_mut(w * channels) {
        row.rotate_right(shift * channels);
    }
}
pub struct BodyOptions<'a> {
    pub name: &'a str,
    pub image: &'a Path,
    pub height: Option<&'a Path>,
    /// Metres per height unit in the file, and what to add.
    pub height_scale: f64,
    pub height_offset: f64,
    pub image_no_data: Option<f64>,
    pub height_no_data: Option<f64>,
    pub decimate_image: usize,
    pub decimate_height: usize,
    /// Finest level baked. D0 to D3 are the pinned pack; finer pages go in page bundles.
    pub finest: u8,
    /// The pack's version, written to the manifest as `NAME-vN`: it goes up whenever the pack's content changes, and the
    /// pack is published in a folder of that name, so a reader never mixes pages of two bakes.
    pub version: u32,
    pub out: &'a Path,
    pub map_out: &'a Path,
    pub credit: &'a str,
    pub threads: usize,
    /// Label stored in the manifest for what the image is, for the provenance line.
    pub image_is: &'a str,
}
pub fn bake(options: &BodyOptions) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    let (mut raster, info) =
        read_raster(options.image, options.decimate_image, options.image_no_data)?;
    eprintln!(
        "{}: image {} x {} x {} read at {:.1}s, left edge {:?}",
        options.name,
        info.width,
        info.height,
        info.channels,
        t0.elapsed().as_secs_f64(),
        info.left_edge
    );
    if let Some(edge) = info.left_edge {
        to_left_edge_minus_180(&mut raster, info.width, info.channels, edge);
    }
    // Stretch to bytes: 8-bit files keep their values, anything else by its own 0.1% to 99.9% range.
    let mut sorted: Vec<f32> = raster
        .iter()
        .step_by((raster.len() / 2_000_000).max(1))
        .copied()
        .filter(|v| v.is_finite())
        .collect();
    sorted.sort_by(f32::total_cmp);
    let (lo, hi) = if sorted.last().is_some_and(|m| *m <= 255.0)
        && sorted.first().is_some_and(|m| *m >= 0.0)
    {
        (0.0, 255.0)
    } else {
        (
            sorted[sorted.len() / 1000],
            sorted[sorted.len() - 1 - sorted.len() / 1000],
        )
    };
    let span = (hi - lo).max(1e-6);
    let mut rgb = vec![0u8; info.width * info.height * 3];
    for i in 0..info.width * info.height {
        for k in 0..3 {
            let v = raster[i * info.channels + if info.channels == 3 { k } else { 0 }];
            // No data: black would read as a feature, so mid-grey of the map's own tone.
            let byte = if v.is_finite() {
                ((v - lo) / span * 255.0).clamp(0.0, 255.0) as u8
            } else {
                64
            };
            rgb[i * 3 + k] = byte;
        }
    }
    drop(raster);
    write_map(&rgb, info.width, info.height, options.map_out)?;
    eprintln!("map written at {:.1}s", t0.elapsed().as_secs_f64());
    let albedo = AlbedoSource::new(info.width, info.height, rgb);
    let mut filled = 0.0_f64;
    let (h, has_height) = match options.height {
        Some(path) => {
            let (mut raster, hi) =
                read_raster(path, options.decimate_height, options.height_no_data)?;
            if let Some(edge) = hi.left_edge {
                to_left_edge_minus_180(&mut raster, hi.width, 1, edge);
            }
            for v in &mut raster {
                if v.is_finite() {
                    *v = (f64::from(*v) * options.height_scale + options.height_offset) as f32;
                }
            }
            // A hole is not at the reference sphere: on Pluto the measured ground averages hundreds of metres from it, with kilometres
            // of relief, so that would leave a cliff round every hole. These heights are interpolated, not measured.
            let unknown = fill_holes(&mut raster, hi.width, hi.height);
            filled = unknown as f64 / raster.len().max(1) as f64;
            eprintln!(
                "height {} x {} read at {:.1}s",
                hi.width,
                hi.height,
                t0.elapsed().as_secs_f64()
            );
            (HeightSource::new(hi.width, hi.height, raster), true)
        }
        None => (HeightSource::new(4, 2, vec![0.0; 8]), false),
    };
    let opt = BakeOptions {
        zopfli_iterations: 0,
        jpeg_quality: 85,
        ..BakeOptions::default()
    };
    let keys = PageKey::all_pinned();
    let pages = bake::bake_pages(&keys, &h, &albedo, &opt, options.threads);
    let mut extra = json!({
        "body": options.name,
        "image_is": options.image_is,
        "image": options.image.file_name().map(|f| f.to_string_lossy().to_string()),
        "height": options.height.and_then(|p| p.file_name()).map(|f| f.to_string_lossy().to_string()),
        "has_height": has_height,
        "seconds": t0.elapsed().as_secs_f64(),
    });
    // Only where heights were interpolated: a manifest with no such field filled nothing, as those baked before filling existed did.
    if filled > 0.0 {
        extra["height_filled_fraction"] = json!(filled);
    }
    write_body_pack(options, &pages, extra.clone())?;
    // Deeper pages: one bundle per face and level (pack.rs), written as each face is done, so one
    // face of pages waits in memory at a time (about 220 MB at level 6 of the Moon).
    let mut total = 0usize;
    for level in 4..=options.finest {
        let n = 1u32 << level;
        for face in 0..6u8 {
            let keys: Vec<PageKey> = (0..n)
                .flat_map(|y| (0..n).map(move |x| PageKey { face, level, x, y }))
                .collect();
            let slots: Vec<std::sync::OnceLock<Vec<u8>>> =
                keys.iter().map(|_| std::sync::OnceLock::new()).collect();
            let next = std::sync::atomic::AtomicUsize::new(0);
            std::thread::scope(|s| {
                for _ in 0..options.threads.max(1) {
                    s.spawn(|| loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(key) = keys.get(i).copied() else {
                            break;
                        };
                        let page = bake::bake_page(key, &h, &albedo, &opt);
                        slots[i]
                            .set(pack::write_level(&[&page]))
                            .expect("one bake per page");
                    });
                }
            });
            let pages: Vec<Option<Vec<u8>>> = slots
                .into_iter()
                .map(std::sync::OnceLock::into_inner)
                .collect();
            pack::write_bundle_file(
                &options.out.join(pack::bundle_path(level, face)),
                level,
                face,
                &pages,
            )?;
            total += keys.len();
        }
        eprintln!(
            "level {level}: {} pages at {:.1}s",
            6 * n * n,
            t0.elapsed().as_secs_f64()
        );
    }
    eprintln!(
        "{}: done, {} deep pages, {:.1}s",
        options.name,
        total,
        t0.elapsed().as_secs_f64()
    );
    Ok(())
}
fn write_body_pack(options: &BodyOptions, pages: &[BakedPage], extra: Value) -> Result<(), String> {
    pack::write_pack(options.out, pages, &[options.credit], json!({}), extra)?;
    let path = options.out.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    manifest["version"] = json!(format!("{}-v{}", options.name, options.version));
    manifest["finest_level"] = json!(options.finest);
    fs::write(&path, serde_json::to_string_pretty(&manifest).unwrap()).map_err(|e| e.to_string())
}
/// The impostor's map: 1024 x 512, area mean in linear light.
fn write_map(rgb: &[u8], w: usize, h: usize, path: &Path) -> Result<(), String> {
    const W: usize = 1024;
    const H: usize = 512;
    let mut sum = vec![0f64; W * H * 3];
    let mut count = vec![0u32; W * H];
    let lut: Vec<f64> = (0..256)
        .map(|i| srgb_to_linear(f64::from(i) / 255.0))
        .collect();
    for y in 0..h {
        let oy = y * H / h;
        for x in 0..w {
            let ox = x * W / w;
            let at = oy * W + ox;
            for k in 0..3 {
                sum[at * 3 + k] += lut[rgb[(y * w + x) * 3 + k] as usize];
            }
            count[at] += 1;
        }
    }
    let mut out = vec![0u8; W * H * 3];
    for i in 0..W * H {
        for k in 0..3 {
            let v = sum[i * 3 + k] / f64::from(count[i].max(1));
            out[i * 3 + k] = (crate::source::linear_to_srgb(v) * 255.0 + 0.5) as u8;
        }
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut encoded = Vec::new();
    jpeg_encoder::Encoder::new(&mut encoded, 90)
        .encode(&out, W as u16, H as u16, jpeg_encoder::ColorType::Rgb)
        .map_err(|e| e.to_string())?;
    fs::write(path, encoded).map_err(|e| e.to_string())
}
/// A map from a whole JPEG, already in the map's projection.
pub fn map_from_jpeg(path: &Path, out: &Path) -> Result<(), String> {
    let f = BufReader::new(File::open(path).map_err(|e| format!("{}: {e}", path.display()))?);
    let mut d = jpeg_decoder::Decoder::new(f);
    let pixels = d.decode().map_err(|e| e.to_string())?;
    let info = d.info().ok_or("no jpeg info")?;
    if info.pixel_format != jpeg_decoder::PixelFormat::RGB24 {
        return Err(format!("unexpected jpeg format {:?}", info.pixel_format));
    }
    write_map(&pixels, info.width as usize, info.height as usize, out)
}
/// Not a measurement. No free global map of these three was found, so this is a smooth colour by
/// latitude, from the planet's overall look, standing in until one is. The provenance line says so.
pub fn schematic_map(name: &str, out: &Path) -> Result<(), String> {
    const W: usize = 1024;
    const H: usize = 512;
    // Latitude in degrees and colour, in sRGB bytes.
    let stops: &[(f64, [f64; 3])] = match name {
        "saturn" => &[
            (-90.0, [118.0, 112.0, 96.0]),
            (-60.0, [176.0, 158.0, 122.0]),
            (-35.0, [205.0, 182.0, 138.0]),
            (-15.0, [224.0, 202.0, 156.0]),
            (0.0, [232.0, 214.0, 170.0]),
            (15.0, [222.0, 198.0, 150.0]),
            (35.0, [206.0, 180.0, 134.0]),
            (60.0, [172.0, 156.0, 124.0]),
            (90.0, [112.0, 118.0, 118.0]),
        ],
        "uranus" => &[
            (-90.0, [196.0, 232.0, 234.0]),
            (-40.0, [182.0, 226.0, 232.0]),
            (20.0, [166.0, 216.0, 226.0]),
            (90.0, [158.0, 208.0, 222.0]),
        ],
        "neptune" => &[
            (-90.0, [64.0, 96.0, 186.0]),
            (-30.0, [72.0, 112.0, 214.0]),
            (0.0, [80.0, 122.0, 224.0]),
            (30.0, [72.0, 112.0, 214.0]),
            (90.0, [62.0, 92.0, 180.0]),
        ],
        _ => return Err("no schematic for this body".into()),
    };
    let mut rgb = vec![0u8; W * H * 3];
    for y in 0..H {
        let lat = 90.0 - (y as f64 + 0.5) / H as f64 * 180.0;
        let i = stops
            .partition_point(|s| s.0 < lat)
            .clamp(1, stops.len() - 1);
        let (a, b) = (stops[i - 1], stops[i]);
        let t = ((lat - a.0) / (b.0 - a.0)).clamp(0.0, 1.0);
        for x in 0..W {
            for k in 0..3 {
                rgb[(y * W + x) * 3 + k] = (a.1[k] + (b.1[k] - a.1[k]) * t) as u8;
            }
        }
    }
    write_map(&rgb, W, H, out)
}
/// The diffuse sky from NASA's Deep Star Maps 2020: ICRF, right ascension 0 at the centre and rising
/// to the left. Checked here against the Bright Star Catalogue, which is independent of the map's
/// layout: bright stars should land on bright pixels under the stated orientation and not under the
/// wrong ones. The map's values are linear, so this is linear to sRGB with a fixed scale, and the pass
/// scales it again; its absolute brightness is an appearance choice and not a photometric claim.
pub fn sky(path: &Path, stars: &Path, out: &Path) -> Result<(), String> {
    use exr::prelude::*;
    let image = read_first_rgba_layer_from_file(
        path,
        |resolution, _| {
            (
                resolution.width(),
                resolution.height(),
                vec![0f32; resolution.width() * resolution.height() * 3],
            )
        },
        |storage: &mut (usize, usize, Vec<f32>), position, (r, g, b, _a): (f32, f32, f32, f32)| {
            let at = (position.y() * storage.0 + position.x()) * 3;
            storage.2[at] = r;
            storage.2[at + 1] = g;
            storage.2[at + 2] = b;
        },
    )
    .map_err(|e| e.to_string())?;
    let (w, h, data) = image.layer_data.channel_data.pixels;
    eprintln!("sky {w} x {h}");
    let at = |x: usize, y: usize| {
        let i = (y.min(h - 1) * w + x % w) * 3;
        data[i] + data[i + 1] + data[i + 2]
    };
    let catalogue = fs::read(stars).map_err(|e| e.to_string())?;
    let mut bright = Vec::new();
    for entry in catalogue[28..].chunks_exact(32) {
        let ra = f64::from_le_bytes(entry[4..12].try_into().unwrap());
        let dec = f64::from_le_bytes(entry[12..20].try_into().unwrap());
        let mag = f64::from(i16::from_le_bytes(entry[22..24].try_into().unwrap())) / 100.0;
        if mag > -2.0 && mag < 2.5 {
            bright.push((ra, dec));
        }
    }
    use std::f64::consts::PI;
    let mut results = Vec::new();
    for (name, flip_ra, flip_dec, half_turn) in [
        ("as stated: RA 0 centre, rising left", true, false, false),
        ("RA rising right", false, false, false),
        ("RA 0 at the edge", true, false, true),
        ("south up", true, true, false),
    ] {
        let mut sum = 0.0;
        for &(ra, dec) in &bright {
            let mut u = ra / (2.0 * PI);
            if flip_ra {
                u = -u;
            }
            u += if half_turn { 0.0 } else { 0.5 };
            let mut v = 0.5 - dec / PI;
            if flip_dec {
                v = 1.0 - v;
            }
            let x = (u.rem_euclid(1.0) * w as f64) as usize;
            let y = (v * h as f64) as usize;
            // The brightest pixel within a few of where the star should be.
            let mut peak = 0f32;
            for dy in 0..7 {
                for dx in 0..7 {
                    peak = peak.max(at(x + w + dx - 3, (y + dy).saturating_sub(3)));
                }
            }
            sum += f64::from(peak);
        }
        results.push((name, sum / bright.len() as f64));
    }
    for (name, value) in &results {
        eprintln!(
            "mean peak at {} bright stars, {name}: {value:.3}",
            bright.len()
        );
    }
    let best = results.iter().map(|r| r.1).fold(0.0, f64::max);
    if results[0].1 < best {
        return Err("the sky map does not match the catalogue under its stated orientation".into());
    }
    // Sharpen, in linear light, with an unsharp mask: the map's stars are a few pixels wide and the cube resamples them once more.
    let opened = unsharp(&data, w, h, 1.0);
    let lookup = |d: [f64; 3]| {
        let ra = d[1].atan2(d[0]);
        let dec = d[2].clamp(-1.0, 1.0).asin();
        let u = (0.5 - ra / (2.0 * PI)).rem_euclid(1.0) * w as f64 - 0.5;
        let v = ((0.5 - dec / PI) * h as f64 - 0.5).clamp(0.0, h as f64 - 1.0);
        let (x0, y0) = (u.floor(), v.floor());
        let (tx, ty) = (u - x0, v - y0);
        let (x0, y0) = (x0 as i64, y0 as usize);
        let get = |x: i64, y: usize, k: usize| {
            f64::from(opened[(y.min(h - 1) * w + x.rem_euclid(w as i64) as usize) * 3 + k])
        };
        let mut c = [0.0; 3];
        for (k, value) in c.iter_mut().enumerate() {
            let top = get(x0, y0, k) * (1.0 - tx) + get(x0 + 1, y0, k) * tx;
            let bottom = get(x0, y0 + 1, k) * (1.0 - tx) + get(x0 + 1, y0 + 1, k) * tx;
            *value = top * (1.0 - ty) + bottom * ty;
        }
        c
    };
    // A cube has no poles to pinch. Faces in WebGPU's order and orientation, at about the map's own density at its equator.
    const SIDE: usize = 2048;
    const SAMPLES: usize = 2;
    for face in 0..6 {
        let mut bytes = vec![0u8; SIDE * SIDE * 3];
        std::thread::scope(|scope| {
            let lookup = &lookup;
            let chunks: Vec<(usize, &mut [u8])> =
                bytes.chunks_mut(SIDE * 3 * 128).enumerate().collect();
            for (index, chunk) in chunks {
                scope.spawn(move || {
                    for (r, line) in chunk.chunks_mut(SIDE * 3).enumerate() {
                        let y = index * 128 + r;
                        for x in 0..SIDE {
                            let mut c = [0.0; 3];
                            for sy in 0..SAMPLES {
                                for sx in 0..SAMPLES {
                                    let a = (x as f64 + (sx as f64 + 0.5) / SAMPLES as f64)
                                        / SIDE as f64
                                        * 2.0
                                        - 1.0;
                                    let b = (y as f64 + (sy as f64 + 0.5) / SAMPLES as f64)
                                        / SIDE as f64
                                        * 2.0
                                        - 1.0;
                                    let d = cube_direction(face, a, b);
                                    let n = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                                    let t = lookup([d[0] / n, d[1] / n, d[2] / n]);
                                    for k in 0..3 {
                                        c[k] += t[k];
                                    }
                                }
                            }
                            for k in 0..3 {
                                let v =
                                    (c[k] / (SAMPLES * SAMPLES) as f64 * SKY_GAIN).clamp(0.0, 1.0);
                                line[x * 3 + k] =
                                    (crate::source::linear_to_srgb(v) * 255.0 + 0.5) as u8;
                            }
                        }
                    }
                });
            }
        });
        let mut encoded = Vec::new();
        jpeg_encoder::Encoder::new(&mut encoded, 93)
            .encode(
                &bytes,
                SIDE as u16,
                SIDE as u16,
                jpeg_encoder::ColorType::Rgb,
            )
            .map_err(|e| e.to_string())?;
        fs::write(out.join(format!("sky-{face}.jpg")), encoded).map_err(|e| e.to_string())?;
        eprintln!("sky face {face}");
    }
    Ok(())
}
/// Brightens the map into the JPEG's useful range; the pass scales it back by its own factor.
const SKY_GAIN: f64 = 2.0;
/// WebGPU's cube: for each face, the direction of (a, b) in -1..1, b running down the image.
pub fn cube_direction(face: usize, a: f64, b: f64) -> [f64; 3] {
    match face {
        0 => [1.0, -b, -a],
        1 => [-1.0, -b, a],
        2 => [a, 1.0, b],
        3 => [a, -1.0, -b],
        4 => [a, -b, 1.0],
        _ => [-a, -b, -1.0],
    }
}
/// Unsharp mask with a small blur, over all channels. Negative lobes clamp at zero, so a star gains and the sky does not ring dark.
fn unsharp(data: &[f32], w: usize, h: usize, amount: f32) -> Vec<f32> {
    let mut out = data.to_vec();
    let kernel = [0.25f32, 0.5, 0.25];
    // A separable blur into a scratch row, then the mask. Parallel by rows.
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .min(8);
    let chunk = h.div_ceil(threads) * w * 3;
    std::thread::scope(|scope| {
        for (t, slice) in out.chunks_mut(chunk).enumerate() {
            scope.spawn(move || {
                for (r, line) in slice.chunks_mut(w * 3).enumerate() {
                    let y = t * h.div_ceil(threads) + r;
                    for x in 0..w {
                        for k in 0..3 {
                            let mut blurred = 0.0;
                            for (j, a) in kernel.iter().enumerate() {
                                for (i, b) in kernel.iter().enumerate() {
                                    let yy = (y + j).saturating_sub(1).min(h - 1);
                                    let xx = (x + w + i - 1) % w;
                                    blurred += a * b * data[(yy * w + xx) * 3 + k];
                                }
                            }
                            let v = data[(y * w + x) * 3 + k];
                            line[x * 3 + k] = (v + (v - blurred) * amount).max(0.0);
                        }
                    }
                }
            });
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::fill_holes;
    /// The owner saw a rift across Pluto: no-data cells baked as a depth. A filled hole keeps what is known and meets its edge with no
    /// step, across the seam in longitude too.
    #[test]
    fn a_filled_hole_keeps_what_is_known_and_has_no_step_at_its_edge() {
        let (w, h) = (256, 128);
        let known = |x: usize, y: usize| {
            500.0 + 300.0 * (x as f32 * 0.05).sin() + 200.0 * (y as f32 * 0.07).cos()
        };
        let hole = |x: usize, y: usize| (x + 40) % w < 90 && y > 10 && y < 100;
        let mut raster: Vec<f32> = (0..w * h)
            .map(|i| {
                let (x, y) = (i % w, i / w);
                if hole(x, y) {
                    f32::NAN
                } else {
                    known(x, y)
                }
            })
            .collect();
        let unknown = fill_holes(&mut raster, w, h);
        assert_eq!(unknown, (0..w * h).filter(|i| hole(i % w, i / w)).count());
        assert!(raster.iter().all(|v| v.is_finite()));
        let mut worst_step = 0.0_f32;
        for y in 0..h {
            for x in 0..w {
                let v = raster[y * w + x];
                if !hole(x, y) {
                    assert_eq!(v, known(x, y));
                }
                worst_step = worst_step.max((v - raster[y * w + (x + 1) % w]).abs());
            }
        }
        println!("worst step between neighbours {worst_step} m");
        // The known field itself has steps up to 15 m per cell here, and the hole at the reference sphere would make one of about 500 m.
        // Coarse here at 256 cells: this is a ledge of a few times the field's own slope, not a cliff.
        assert!(worst_step < 100.0, "{worst_step}");
    }
}

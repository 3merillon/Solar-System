//! Global equirectangular sources, pixel-centred (pixel i covers longitude -180 + 360 i/W),
//! with mean pyramids so that coarse pages are area means and do not alias.
use std::{fs::File, io::BufReader, path::Path};

pub const MAX_PYRAMID_LEVEL: usize = 5;
const TWO_PI: f64 = std::f64::consts::TAU;
const PI: f64 = std::f64::consts::PI;

/// Pixel coordinates of (lon, lat) in an image of `w` x `h`; pixel centres sit at integers.
#[inline]
fn pixel_pos(lon: f64, lat: f64, w: usize, h: usize) -> (f64, f64) {
    (
        (lon + PI) / TWO_PI * w as f64 - 0.5,
        (PI * 0.5 - lat) / PI * h as f64 - 0.5,
    )
}
/// Bilinear taps: wrap in longitude, clamp at the poles.
#[inline]
fn taps(lon: f64, lat: f64, w: usize, h: usize) -> ([usize; 2], [usize; 2], f64, f64) {
    let (px, py) = pixel_pos(lon, lat, w, h);
    let (fx, fy) = (px.floor(), py.floor());
    let (tx, ty) = (px - fx, py - fy);
    let wrap = |i: i64| i.rem_euclid(w as i64) as usize;
    let clamp = |i: i64| i.clamp(0, h as i64 - 1) as usize;
    (
        [wrap(fx as i64), wrap(fx as i64 + 1)],
        [clamp(fy as i64), clamp(fy as i64 + 1)],
        tx,
        ty,
    )
}

pub struct Level<T> {
    pub w: usize,
    pub h: usize,
    pub data: Vec<T>,
}

/// Mean of 2x2 blocks (edge rows and columns replicate when odd) over `c` interleaved channels.
fn halve(src: &Level<f32>, c: usize) -> Level<f32> {
    let (w, h) = (src.w.div_ceil(2), src.h.div_ceil(2));
    let mut data = vec![0f32; w * h * c];
    for y in 0..h {
        let (y0, y1) = (2 * y, (2 * y + 1).min(src.h - 1));
        for x in 0..w {
            let (x0, x1) = (2 * x, (2 * x + 1).min(src.w - 1));
            for k in 0..c {
                let s = |yy: usize, xx: usize| f64::from(src.data[(yy * src.w + xx) * c + k]);
                data[(y * w + x) * c + k] =
                    ((s(y0, x0) + s(y0, x1) + s(y1, x0) + s(y1, x1)) * 0.25) as f32;
            }
        }
    }
    Level { w, h, data }
}

/// Heights in metres, one f32 per pixel.
pub struct HeightSource {
    pub levels: Vec<Level<f32>>,
}
impl HeightSource {
    pub fn new(w: usize, h: usize, data: Vec<f32>) -> Self {
        assert_eq!(data.len(), w * h);
        let mut levels = vec![Level { w, h, data }];
        while levels.len() <= MAX_PYRAMID_LEVEL {
            let last = levels.last().unwrap();
            if last.w < 2 || last.h < 2 {
                break;
            }
            let next = halve(last, 1);
            levels.push(next);
        }
        Self { levels }
    }
    pub fn size(&self) -> (usize, usize) {
        (self.levels[0].w, self.levels[0].h)
    }
    pub fn max_level(&self) -> usize {
        self.levels.len() - 1
    }
    pub fn sample(&self, level: usize, lon: f64, lat: f64) -> f64 {
        let l = &self.levels[level.min(self.levels.len() - 1)];
        let (xs, ys, tx, ty) = taps(lon, lat, l.w, l.h);
        let g = |y: usize, x: usize| f64::from(l.data[y * l.w + x]);
        let a = g(ys[0], xs[0]) * (1.0 - tx) + g(ys[0], xs[1]) * tx;
        let b = g(ys[1], xs[0]) * (1.0 - tx) + g(ys[1], xs[1]) * tx;
        a * (1.0 - ty) + b * ty
    }
}

pub fn srgb_to_linear(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}
pub fn linear_to_srgb(l: f64) -> f64 {
    if l <= 0.0031308 {
        l * 12.92
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    }
}

/// sRGB bytes at level 0, linear-light f32 means above it.
pub struct AlbedoSource {
    pub w: usize,
    pub h: usize,
    base: Vec<u8>,
    lut: [f32; 256],
    /// levels[0] is pyramid level 1.
    pub levels: Vec<Level<f32>>,
}
impl AlbedoSource {
    pub fn new(w: usize, h: usize, rgb: Vec<u8>) -> Self {
        assert_eq!(rgb.len(), w * h * 3);
        let mut lut = [0f32; 256];
        for (i, v) in lut.iter_mut().enumerate() {
            *v = srgb_to_linear(i as f64 / 255.0) as f32;
        }
        let (w1, h1) = (w.div_ceil(2), h.div_ceil(2));
        let mut d1 = vec![0f32; w1 * h1 * 3];
        for y in 0..h1 {
            let (y0, y1) = (2 * y, (2 * y + 1).min(h - 1));
            for x in 0..w1 {
                let (x0, x1) = (2 * x, (2 * x + 1).min(w - 1));
                for k in 0..3 {
                    let s =
                        |yy: usize, xx: usize| f64::from(lut[rgb[(yy * w + xx) * 3 + k] as usize]);
                    d1[(y * w1 + x) * 3 + k] =
                        ((s(y0, x0) + s(y0, x1) + s(y1, x0) + s(y1, x1)) * 0.25) as f32;
                }
            }
        }
        let mut levels = vec![Level {
            w: w1,
            h: h1,
            data: d1,
        }];
        while levels.len() < MAX_PYRAMID_LEVEL {
            let last = levels.last().unwrap();
            if last.w < 2 || last.h < 2 {
                break;
            }
            let next = halve(last, 3);
            levels.push(next);
        }
        Self {
            w,
            h,
            base: rgb,
            lut,
            levels,
        }
    }
    pub fn size(&self) -> (usize, usize) {
        (self.w, self.h)
    }
    pub fn max_level(&self) -> usize {
        self.levels.len()
    }
    /// Linear-light RGB.
    pub fn sample(&self, level: usize, lon: f64, lat: f64) -> [f64; 3] {
        let mut o = [0.0; 3];
        if level == 0 {
            let (xs, ys, tx, ty) = taps(lon, lat, self.w, self.h);
            let g = |y: usize, x: usize, k: usize| {
                f64::from(self.lut[self.base[(y * self.w + x) * 3 + k] as usize])
            };
            for (k, ok) in o.iter_mut().enumerate() {
                let a = g(ys[0], xs[0], k) * (1.0 - tx) + g(ys[0], xs[1], k) * tx;
                let b = g(ys[1], xs[0], k) * (1.0 - tx) + g(ys[1], xs[1], k) * tx;
                *ok = a * (1.0 - ty) + b * ty;
            }
            return o;
        }
        let l = &self.levels[(level - 1).min(self.levels.len() - 1)];
        let (xs, ys, tx, ty) = taps(lon, lat, l.w, l.h);
        let g = |y: usize, x: usize, k: usize| f64::from(l.data[(y * l.w + x) * 3 + k]);
        for (k, ok) in o.iter_mut().enumerate() {
            let a = g(ys[0], xs[0], k) * (1.0 - tx) + g(ys[0], xs[1], k) * tx;
            let b = g(ys[1], xs[0], k) * (1.0 - tx) + g(ys[1], xs[1], k) * tx;
            *ok = a * (1.0 - ty) + b * ty;
        }
        o
    }
}

/// Geo information read from the GeoTIFF, to check pixel registration.
pub struct TiffInfo {
    pub width: usize,
    pub height: usize,
    pub tiepoint: Vec<f64>,
    pub pixel_scale: Vec<f64>,
    /// GTRasterTypeGeoKey: 1 = PixelIsArea, 2 = PixelIsPoint.
    pub raster_type: Option<u16>,
}

pub fn read_etopo(path: &Path) -> Result<(HeightSource, TiffInfo), String> {
    use tiff::decoder::{Decoder, DecodingResult};
    use tiff::tags::Tag;
    let f = BufReader::new(File::open(path).map_err(|e| format!("{}: {e}", path.display()))?);
    let mut d = Decoder::new(f)
        .map_err(|e| e.to_string())?
        .with_limits(tiff::decoder::Limits::unlimited());
    let (w, h) = d.dimensions().map_err(|e| e.to_string())?;
    let tiepoint = d.get_tag_f64_vec(Tag::Unknown(33922)).unwrap_or_default();
    let pixel_scale = d.get_tag_f64_vec(Tag::Unknown(33550)).unwrap_or_default();
    let keys = d.get_tag_u32_vec(Tag::Unknown(34735)).unwrap_or_default();
    let mut raster_type = None;
    for k in keys.chunks_exact(4).skip(1) {
        if k[0] == 1025 {
            raster_type = Some(k[3] as u16);
        }
    }
    let info = TiffInfo {
        width: w as usize,
        height: h as usize,
        tiepoint,
        pixel_scale,
        raster_type,
    };
    let img = d.read_image().map_err(|e| e.to_string())?;
    let data: Vec<f32> = match img {
        DecodingResult::F32(v) => v,
        DecodingResult::F64(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::I16(v) => v.into_iter().map(f32::from).collect(),
        _ => return Err("unexpected ETOPO sample type".into()),
    };
    if data.len() != info.width * info.height {
        return Err("ETOPO size mismatch".into());
    }
    if data.iter().any(|v| !v.is_finite()) {
        return Err("ETOPO contains non-finite values".into());
    }
    Ok((HeightSource::new(info.width, info.height, data), info))
}

pub fn read_marble(path: &Path) -> Result<AlbedoSource, String> {
    let f = BufReader::new(File::open(path).map_err(|e| format!("{}: {e}", path.display()))?);
    let mut d = jpeg_decoder::Decoder::new(f);
    let px = d.decode().map_err(|e| e.to_string())?;
    let info = d.info().ok_or("no jpeg info")?;
    if info.pixel_format != jpeg_decoder::PixelFormat::RGB24 {
        return Err(format!("unexpected jpeg format {:?}", info.pixel_format));
    }
    Ok(AlbedoSource::new(
        info.width as usize,
        info.height as usize,
        px,
    ))
}

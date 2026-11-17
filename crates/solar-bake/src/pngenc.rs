//! 8-bit RGB PNG writer for height pages: R = high byte, G = low byte, B = 0.
//! Filters are chosen per row between Up and Paeth by the smallest sum of absolute
//! signed residuals; deflate is zlib at its highest level.
use flate2::{write::ZlibEncoder, Compression, Crc};
use std::io::Write;

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc = Crc::new();
    crc.update(kind);
    crc.update(data);
    out.extend_from_slice(&crc.sum().to_be_bytes());
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let (ia, ib, ic) = (i32::from(a), i32::from(b), i32::from(c));
    let p = ia + ib - ic;
    let (pa, pb, pc) = ((p - ia).abs(), (p - ib).abs(), (p - ic).abs());
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// Filtered scanlines (each prefixed with its filter byte) of an RGB image.
pub fn filtered_rows(raw: &[u8], width: usize, height: usize) -> Vec<u8> {
    let stride = width * 3;
    let mut out = Vec::with_capacity((stride + 1) * height);
    let zero = vec![0u8; stride];
    let mut up = vec![0u8; stride];
    let mut pa = vec![0u8; stride];
    for y in 0..height {
        let row = &raw[y * stride..(y + 1) * stride];
        let prev = if y == 0 {
            &zero[..]
        } else {
            &raw[(y - 1) * stride..y * stride]
        };
        let (mut cost_up, mut cost_pa) = (0u32, 0u32);
        for x in 0..stride {
            up[x] = row[x].wrapping_sub(prev[x]);
            let (a, c) = if x >= 3 {
                (row[x - 3], prev[x - 3])
            } else {
                (0, 0)
            };
            pa[x] = row[x].wrapping_sub(paeth(a, prev[x], c));
            cost_up += u32::from((up[x] as i8).unsigned_abs());
            cost_pa += u32::from((pa[x] as i8).unsigned_abs());
        }
        if cost_pa < cost_up {
            out.push(4);
            out.extend_from_slice(&pa);
        } else {
            out.push(2);
            out.extend_from_slice(&up);
        }
    }
    out
}

/// `zopfli_iterations` 0 uses plain zlib level 9.
pub fn encode_height_png(
    samples: &[u16],
    width: usize,
    height: usize,
    zopfli_iterations: u64,
) -> Vec<u8> {
    assert_eq!(samples.len(), width * height);
    let mut raw = Vec::with_capacity(width * height * 3);
    for &s in samples {
        raw.extend_from_slice(&[(s >> 8) as u8, (s & 255) as u8, 0]);
    }
    let rows = filtered_rows(&raw, width, height);
    let idat = deflate(&rows, zopfli_iterations);
    let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(width as u32).to_be_bytes());
    ihdr.extend_from_slice(&(height as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &idat);
    chunk(&mut out, b"IEND", &[]);
    out
}

/// Zlib stream: zopfli when `iterations > 0` (about 6% smaller), otherwise zlib level 9.
fn deflate(rows: &[u8], iterations: u64) -> Vec<u8> {
    match std::num::NonZeroU64::new(iterations) {
        Some(n) => {
            let mut out = Vec::new();
            let opt = zopfli::Options {
                iteration_count: n,
                ..Default::default()
            };
            zopfli::compress(opt, zopfli::Format::Zlib, rows, &mut out).expect("zopfli");
            out
        }
        None => {
            let mut z = ZlibEncoder::new(Vec::new(), Compression::best());
            z.write_all(rows).unwrap();
            z.finish().unwrap()
        }
    }
}

//! Spatial index over imported sources. No generated meshes or material pixels.
use crate::gpu::Gpu;
pub const SIDE: usize = 128;
pub const PER_CELL: usize = 64;
pub const INDEX_PREFIX: usize = 96 + SIDE * SIDE * 4 + SIDE * SIDE * PER_CELL * 4;
pub const INDEX_BYTES: u64 = (INDEX_PREFIX + 16384 * 112 + 131072 * 16) as u64;
pub struct Urban {
    pub sources: wgpu::Buffer,
    pub points: wgpu::Buffer,
    pub control: wgpu::Buffer,
    pub index: wgpu::Buffer,
    pub overflow: usize,
}
impl Urban {
    pub fn new(g: &Gpu) -> Self {
        use wgpu::BufferUsages as U;
        Self {
            sources: g.buffer(
                "urban source footprints",
                16384 * 112,
                U::STORAGE | U::COPY_DST,
            ),
            points: g.buffer("urban source points", 131072 * 16, U::STORAGE | U::COPY_DST),
            control: g.buffer("urban source counts", 16, U::UNIFORM | U::COPY_DST),
            index: g.buffer(
                "urban source spatial index",
                INDEX_BYTES,
                U::STORAGE | U::COPY_DST,
            ),
            overflow: 0,
        }
    }
    pub fn clear(&mut self, g: &Gpu) {
        g.queue.write_buffer(&self.index, 80, &[0; 16]);
        self.overflow = 0;
    }
    pub fn update(&mut self, g: &Gpu, records: &[u8], points: &[u8]) {
        if records.is_empty() {
            self.clear(g);
            return;
        }
        let (mut bytes, overflow) = source_index(records);
        bytes[INDEX_PREFIX..INDEX_PREFIX + records.len()].copy_from_slice(records);
        let point_start = INDEX_PREFIX + 16384 * 112;
        bytes[point_start..point_start + points.len()].copy_from_slice(points);
        self.overflow = overflow;
        g.queue.write_buffer(&self.index, 0, &bytes);
    }
}
fn source_index(records: &[u8]) -> (Vec<u8>, usize) {
    let number =
        |r: &[u8], i: usize| f64::from(f32::from_le_bytes(r[i * 4..i * 4 + 4].try_into().unwrap()));
    let first = &records[..112];
    let anchor: [f64; 3] = std::array::from_fn(|i| number(first, i) + number(first, 4 + i));
    let east: [f64; 3] = std::array::from_fn(|i| number(first, 8 + i));
    let north: [f64; 3] = std::array::from_fn(|i| number(first, 12 + i));
    let dot = |a: [f64; 3], b: [f64; 3]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
    let mut boxes = Vec::new();
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for r in records.chunks_exact(112) {
        let center: [f64; 3] = std::array::from_fn(|i| number(r, i) + number(r, 4 + i) - anchor[i]);
        let e: [f64; 3] = std::array::from_fn(|i| number(r, 8 + i));
        let n: [f64; 3] = std::array::from_fn(|i| number(r, 12 + i));
        let mut a = [f64::INFINITY; 2];
        let mut b = [f64::NEG_INFINITY; 2];
        for x in [number(r, 16), number(r, 18)] {
            for y in [number(r, 17), number(r, 19)] {
                let p = std::array::from_fn(|i| center[i] + e[i] * x + n[i] * y);
                let q = [dot(p, east), dot(p, north)];
                for i in 0..2 {
                    a[i] = a[i].min(q[i] - 16.);
                    b[i] = b[i].max(q[i] + 16.);
                }
            }
        }
        for i in 0..2 {
            lo[i] = lo[i].min(a[i]);
            hi[i] = hi[i].max(b[i]);
        }
        boxes.push((a, b));
    }
    let cell = ((hi[0] - lo[0]).max(hi[1] - lo[1]) / SIDE as f64)
        .ceil()
        .max(32.);
    let mut bytes = vec![0u8; INDEX_BYTES as usize];
    let mut put = |at: usize, x: f32| bytes[at * 4..at * 4 + 4].copy_from_slice(&x.to_le_bytes());
    for i in 0..3 {
        let h = (anchor[i] / 4096.).floor() * 4096.;
        put(i, h as f32);
        put(4 + i, (anchor[i] - h) as f32);
        put(8 + i, east[i] as f32);
        put(12 + i, north[i] as f32);
    }
    put(16, lo[0] as f32);
    put(17, lo[1] as f32);
    put(18, cell as f32);
    put(19, SIDE as f32);
    bytes[80..84].copy_from_slice(&(boxes.len() as u32).to_le_bytes());
    let mut counts = vec![0u32; SIDE * SIDE];
    let mut saturated = vec![false; SIDE * SIDE];
    let mut overflow = 0;
    for (id, (a, b)) in boxes.iter().enumerate() {
        let lower: [usize; 2] =
            std::array::from_fn(|i| ((a[i] - lo[i]) / cell).floor().clamp(0., 127.) as usize);
        let upper: [usize; 2] =
            std::array::from_fn(|i| ((b[i] - lo[i]) / cell).floor().clamp(0., 127.) as usize);
        for y in lower[1]..=upper[1] {
            for x in lower[0]..=upper[0] {
                let c = y * SIDE + x;
                let at = counts[c] as usize;
                if at == PER_CELL {
                    overflow += 1;
                    saturated[c] = true;
                    continue;
                }
                let offset = 96 + SIDE * SIDE * 4 + (c * PER_CELL + at) * 4;
                bytes[offset..offset + 4].copy_from_slice(&(id as u32).to_le_bytes());
                counts[c] += 1;
            }
        }
    }
    for (i, n) in counts.iter().enumerate() {
        let value = *n | if saturated[i] { 0x8000_0000 } else { 0 };
        bytes[96 + i * 4..100 + i * 4].copy_from_slice(&value.to_le_bytes());
    }
    (bytes, overflow)
}

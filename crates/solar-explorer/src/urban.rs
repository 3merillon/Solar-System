//! Spatial index over imported sources. No generated meshes or material pixels.
use crate::gpu::Gpu;
const SIDE: usize = 128;
const SOURCES: usize = 16384;
const HEADER: usize = 96;
const NODES_START: usize = HEADER + SIDE * SIDE * 4;
const SOURCES_START: usize =
    (NODES_START + (2 * SOURCES - 1) * size_of::<Node>()).next_multiple_of(16);
const POINTS_START: usize = SOURCES_START + SOURCES * 112;
pub const INDEX_BYTES: u64 = (POINTS_START + 131072 * 16) as u64;
const BRANCH: u32 = u32::MAX;
const HAS_ROAD: u32 = 1 << 31;

#[repr(C)]
#[derive(Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
struct Node {
    lo: [f32; 2],
    hi: [f32; 2],
    end: u32,
    source: u32,
}

struct Index {
    header: [u32; 24],
    cells: Vec<u32>,
    nodes: Vec<Node>,
}

pub struct Urban {
    pub sources: wgpu::Buffer,
    pub points: wgpu::Buffer,
    pub control: wgpu::Buffer,
    pub index: wgpu::Buffer,
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
        }
    }
    pub fn clear(&mut self, g: &Gpu) {
        g.queue.write_buffer(&self.index, 80, &[0; 16]);
    }
    pub fn update(&mut self, g: &Gpu, records: &[u8], points: &[u8]) {
        if records.is_empty() {
            self.clear(g);
            return;
        }
        let tree = source_index(records);
        for (at, bytes) in [
            (0, bytemuck::cast_slice(&tree.header)),
            (HEADER, bytemuck::cast_slice(&tree.cells)),
            (NODES_START, bytemuck::cast_slice(&tree.nodes)),
            (SOURCES_START, records),
            (POINTS_START, points),
        ] {
            g.queue.write_buffer(&self.index, at as u64, bytes);
        }
    }
}

// Preorder layout lets a GPU query skip an entire non-overlapping subtree with
// one index, without a stack. Every source has one leaf, including long roads.
fn build_nodes(nodes: &mut Vec<Node>, leaves: &mut [Node]) {
    if leaves.len() == 1 {
        let mut leaf = leaves[0];
        leaf.end |= nodes.len() as u32 + 1;
        nodes.push(leaf);
        return;
    }
    let lo = std::array::from_fn(|i| leaves.iter().map(|n| n.lo[i]).fold(f32::INFINITY, f32::min));
    let hi = std::array::from_fn(|i| {
        leaves
            .iter()
            .map(|n| n.hi[i])
            .fold(f32::NEG_INFINITY, f32::max)
    });
    let axis = usize::from(hi[1] - lo[1] > hi[0] - lo[0]);
    let middle = leaves.len() / 2;
    leaves.select_nth_unstable_by(middle, |a, b| {
        (a.lo[axis] + a.hi[axis])
            .total_cmp(&(b.lo[axis] + b.hi[axis]))
            .then(a.source.cmp(&b.source))
    });
    let branch = nodes.len();
    nodes.push(Node {
        lo,
        hi,
        end: 0,
        source: BRANCH,
    });
    let (left, right) = leaves.split_at_mut(middle);
    build_nodes(nodes, left);
    let right_root = nodes.len();
    build_nodes(nodes, right);
    let flags = (nodes[branch + 1].end | nodes[right_root].end) & HAS_ROAD;
    nodes[branch].end = nodes.len() as u32 | flags;
}

fn source_index(records: &[u8]) -> Index {
    let number =
        |r: &[u8], i: usize| f64::from(f32::from_le_bytes(r[i * 4..i * 4 + 4].try_into().unwrap()));
    let first = &records[..112];
    let anchor: [f64; 3] = std::array::from_fn(|i| number(first, i) + number(first, 4 + i));
    let east: [f64; 3] = std::array::from_fn(|i| number(first, 8 + i));
    let north: [f64; 3] = std::array::from_fn(|i| number(first, 12 + i));
    let dot = |a: [f64; 3], b: [f64; 3]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
    let mut leaves = Vec::with_capacity(records.len() / 112);
    for (id, r) in records.chunks_exact(112).enumerate() {
        let center: [f64; 3] = std::array::from_fn(|i| number(r, i) + number(r, 4 + i) - anchor[i]);
        let e: [f64; 3] = std::array::from_fn(|i| number(r, 8 + i));
        let n: [f64; 3] = std::array::from_fn(|i| number(r, 12 + i));
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        for x in [number(r, 16), number(r, 18)] {
            for y in [number(r, 17), number(r, 19)] {
                let p = std::array::from_fn(|i| center[i] + e[i] * x + n[i] * y);
                let q = [dot(p, east), dot(p, north)];
                for i in 0..2 {
                    lo[i] = lo[i].min((q[i] - 16.) as f32);
                    hi[i] = hi[i].max((q[i] + 16.) as f32);
                }
            }
        }
        leaves.push(Node {
            lo,
            hi,
            end: if number(r, 27) < 0. { HAS_ROAD } else { 0 },
            source: id as u32,
        });
    }
    let mut nodes = Vec::with_capacity(2 * leaves.len() - 1);
    build_nodes(&mut nodes, &mut leaves);
    let root = nodes[0];
    let cell = ((root.hi[0] - root.lo[0]).max(root.hi[1] - root.lo[1]) / SIDE as f32)
        .ceil()
        .max(32.);
    let mut header = [0; 24];
    for i in 0..3 {
        let h = (anchor[i] / 4096.).floor() * 4096.;
        header[i] = (h as f32).to_bits();
        header[4 + i] = ((anchor[i] - h) as f32).to_bits();
        header[8 + i] = (east[i] as f32).to_bits();
        header[12 + i] = (north[i] as f32).to_bits();
    }
    header[16..20].copy_from_slice(&[root.lo[0], root.lo[1], cell, SIDE as f32].map(f32::to_bits));
    header[20] = leaves.len() as u32;
    // Each cell names the first and last intersecting leaf. Intervening
    // branches still carry their escape indices. Empty cells cost one lookup.
    let mut cells = vec![0u32; SIDE * SIDE];
    for (index, node) in nodes.iter().enumerate().filter(|(_, n)| n.source != BRANCH) {
        let grid = |p: [f32; 2]| -> [usize; 2] {
            std::array::from_fn(|i| (((p[i] - root.lo[i]) / cell).floor() as usize).min(SIDE - 1))
        };
        let a = grid(node.lo);
        let b = grid(node.hi);
        for y in a[1]..=b[1] {
            for span in &mut cells[y * SIDE + a[0]..=y * SIDE + b[0]] {
                let first = if *span == 0 {
                    index as u32
                } else {
                    *span & 0xffff
                };
                let flags = (*span | node.end) & HAS_ROAD;
                *span = first | ((node.end & 0x7fff) << 16) | flags;
            }
        }
    }
    Index {
        header,
        cells,
        nodes,
    }
}

//! Read SPICE SPK kernels (DAF, little-endian, segment types 2 and 3) without the toolkit, and
//! answer position against the solar system barycentre by chaining segments.
use std::{collections::HashMap, fs::File, io::Read, path::Path};

struct Segment {
    start: f64,
    stop: f64,
    target: i32,
    center: i32,
    kind: i32,
    begin: usize,
    end: usize,
    file: usize,
}
pub struct Kernels {
    files: Vec<Vec<f64>>,
    segments: Vec<Segment>,
    by_target: HashMap<i32, Vec<usize>>,
}
impl Kernels {
    pub fn new() -> Self {
        Self {
            files: Vec::new(),
            segments: Vec::new(),
            by_target: HashMap::new(),
        }
    }
    /// A later file's segments take precedence, as in SPICE's kernel pool.
    pub fn load(&mut self, path: &Path) -> Result<(), String> {
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|mut f| f.read_to_end(&mut bytes))
            .map_err(|e| format!("{}: {e}", path.display()))?;
        if &bytes[..8] != b"DAF/SPK " || &bytes[88..96] != b"LTL-IEEE" {
            return Err(format!("{}: not a little-endian SPK", path.display()));
        }
        let int = |at: usize| i32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        let (nd, ni, fward) = (int(8) as usize, int(12) as usize, int(76) as usize);
        if nd != 2 || ni != 6 {
            return Err("unexpected summary format".into());
        }
        let words: Vec<f64> = bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
            .collect();
        drop(bytes);
        let file = self.files.len();
        let mut record = fward;
        while record != 0 {
            let at = (record - 1) * 128;
            let next = words[at] as usize;
            let count = words[at + 2] as usize;
            for s in 0..count {
                let summary = at + 3 + s * 5;
                let ints: Vec<i32> = words[summary + 2..summary + 5]
                    .iter()
                    .flat_map(|w| {
                        let b = w.to_le_bytes();
                        [
                            i32::from_le_bytes(b[..4].try_into().unwrap()),
                            i32::from_le_bytes(b[4..].try_into().unwrap()),
                        ]
                    })
                    .collect();
                let segment = Segment {
                    start: words[summary],
                    stop: words[summary + 1],
                    target: ints[0],
                    center: ints[1],
                    kind: ints[3],
                    begin: ints[4] as usize,
                    end: ints[5] as usize,
                    file,
                };
                if ints[2] != 1 {
                    return Err(format!("segment for {} not in J2000", segment.target));
                }
                let i = self.segments.len();
                self.by_target
                    .entry(segment.target)
                    .or_default()
                    .insert(0, i);
                self.segments.push(segment);
            }
            record = next;
        }
        self.files.push(words);
        Ok(())
    }
    fn lookup(&self, target: i32, et: f64) -> Result<&Segment, String> {
        self.by_target
            .get(&target)
            .and_then(|list| {
                list.iter()
                    .map(|&i| &self.segments[i])
                    .find(|s| (s.start..=s.stop).contains(&et))
            })
            .ok_or_else(|| format!("no segment for {target} at et {et}"))
    }
    /// Kilometres against the segment's own centre, and the centre.
    fn segment_position(&self, s: &Segment, et: f64) -> Result<[f64; 3], String> {
        let w = &self.files[s.file];
        let tail = s.end - 4;
        let (init, len, rsize, n) = (
            w[tail],
            w[tail + 1],
            w[tail + 2] as usize,
            w[tail + 3] as usize,
        );
        let record = (((et - init) / len).floor() as usize).min(n - 1);
        let base = s.begin - 1 + record * rsize;
        let (mid, radius) = (w[base], w[base + 1]);
        let per_axis = match s.kind {
            2 => rsize.saturating_sub(2) / 3,
            3 => rsize.saturating_sub(2) / 6,
            k => return Err(format!("SPK type {k} for body {} not supported", s.target)),
        };
        let x = (et - mid) / radius;
        let mut out = [0.0; 3];
        for (axis, value) in out.iter_mut().enumerate() {
            let c = &w[base + 2 + axis * per_axis..base + 2 + (axis + 1) * per_axis];
            let (mut t0, mut t1) = (1.0, x);
            let mut sum = c[0];
            for &k in &c[1..] {
                sum += k * t1;
                let t2 = 2.0 * x * t1 - t0;
                (t0, t1) = (t1, t2);
            }
            *value = sum;
        }
        Ok(out)
    }
    /// Metres against the solar system barycentre, ICRF-aligned J2000 axes.
    pub fn barycentric(&self, mut body: i32, et: f64) -> Result<[f64; 3], String> {
        let mut p = [0.0; 3];
        while body != 0 {
            let s = self.lookup(body, et)?;
            let q = self.segment_position(s, et)?;
            for i in 0..3 {
                p[i] += q[i] * 1000.0;
            }
            body = s.center;
        }
        Ok(p)
    }
    pub fn relative(&self, body: i32, against: i32, et: f64) -> Result<[f64; 3], String> {
        // Shared paths are subtracted away numerically; satellite kernels carry the moons against
        // their barycentre, so nothing large enters a moon's difference beyond the shared part.
        let (mut a, mut b) = (body, against);
        let mut p = [0.0; 3];
        let mut path_b = vec![];
        loop {
            path_b.push(b);
            if b == 0 {
                break;
            }
            b = self.lookup(b, et)?.center;
        }
        while !path_b.contains(&a) {
            let s = self.lookup(a, et)?;
            let q = self.segment_position(s, et)?;
            for i in 0..3 {
                p[i] += q[i] * 1000.0;
            }
            a = s.center;
        }
        let mut b = against;
        while b != a {
            let s = self.lookup(b, et)?;
            let q = self.segment_position(s, et)?;
            for i in 0..3 {
                p[i] -= q[i] * 1000.0;
            }
            b = s.center;
        }
        Ok(p)
    }
}
impl Default for Kernels {
    fn default() -> Self {
        Self::new()
    }
}
/// Values of one name in a text kernel: `BODY301_POLE_RA = ( 269.9949 0.0031 0. )`.
pub fn text_kernel(path: &Path) -> Result<HashMap<String, Vec<f64>>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut out = HashMap::new();
    let mut in_data = false;
    let mut name: Option<String> = None;
    let mut values = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "\\begindata" {
            in_data = true;
            continue;
        }
        if trimmed == "\\begintext" {
            in_data = false;
            continue;
        }
        if !in_data {
            continue;
        }
        let mut rest = trimmed;
        if let Some((left, right)) = trimmed.split_once('=') {
            name = Some(left.trim().to_string());
            values.clear();
            rest = right;
        }
        for token in rest.split(|c: char| c == '(' || c == ')' || c == ',' || c.is_whitespace()) {
            if token.is_empty() {
                continue;
            }
            if let Ok(v) = token.replace(['D', 'd'], "E").parse::<f64>() {
                values.push(v);
            }
        }
        if rest.contains(')') || (!rest.contains('(') && trimmed.contains('=')) {
            if let Some(n) = name.take() {
                out.insert(n, std::mem::take(&mut values));
            }
        }
    }
    Ok(out)
}

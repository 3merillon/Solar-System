//! Balanced cube-sphere cuts and conforming regular-grid triangles.
//! Canonical integer cube triples identify the SAME vertex on every face.
use crate::{
    field::{self, V3},
    skin::Skin,
};
use std::collections::{BTreeSet, HashMap};
pub const GRID: u32 = 16;
pub const MAX_LEVEL: u32 = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Patch {
    pub face: u8,
    pub level: u32,
    pub x: u32,
    pub y: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Vertex(pub [i32; 3]);
pub fn cube(face: u8, u: i32, v: i32, d: i32) -> [i32; 3] {
    match face {
        0 => [d, v, -u],
        1 => [-d, v, u],
        2 => [u, d, -v],
        3 => [u, -d, v],
        4 => [u, v, d],
        _ => [-u, v, -d],
    }
}
pub fn chart(p: V3) -> (u8, f64, f64) {
    let a = p.map(f64::abs);
    let (f, u, v, d) = if a[0] >= a[1] && a[0] >= a[2] {
        if p[0] >= 0.0 {
            (0, -p[2], p[1], a[0])
        } else {
            (1, p[2], p[1], a[0])
        }
    } else if a[1] >= a[2] {
        if p[1] >= 0.0 {
            (2, p[0], -p[2], a[1])
        } else {
            (3, p[0], p[2], a[1])
        }
    } else if p[2] >= 0.0 {
        (4, p[0], p[1], a[2])
    } else {
        (5, -p[0], p[1], a[2])
    };
    (f, (u / d + 1.0) * 0.5, (v / d + 1.0) * 0.5)
}
pub fn on_face(p: V3, face: u8) -> (f64, f64) {
    let (u, v, d) = match face {
        0 => (-p[2], p[1], p[0]),
        1 => (p[2], p[1], -p[0]),
        2 => (p[0], -p[2], p[1]),
        3 => (p[0], p[2], -p[1]),
        4 => (p[0], p[1], p[2]),
        _ => (-p[0], p[1], -p[2]),
    };
    ((u / d + 1.0) * 0.5, (v / d + 1.0) * 0.5)
}
impl Vertex {
    pub fn direction(self) -> V3 {
        field::normalized(self.0.map(f64::from))
    }
}
impl Patch {
    pub fn vertex(self, x: u32, y: u32) -> Vertex {
        let d = (GRID << self.level) as i32;
        let mut p = cube(
            self.face,
            (2 * i64::from(self.x * GRID + x) - i64::from(d)) as i32,
            (2 * i64::from(self.y * GRID + y) - i64::from(d)) as i32,
            d,
        );
        while p.iter().all(|v| v % 2 == 0) {
            p = p.map(|v| v / 2);
        }
        Vertex(p)
    }
    pub fn children(self) -> [Self; 4] {
        std::array::from_fn(|i| Self {
            face: self.face,
            level: self.level + 1,
            x: self.x * 2 + (i as u32 % 2),
            y: self.y * 2 + (i as u32 / 2),
        })
    }
    pub fn parent(self) -> Self {
        Self {
            face: self.face,
            level: self.level.saturating_sub(1),
            x: self.x / 2,
            y: self.y / 2,
        }
    }
    pub fn center(self) -> V3 {
        self.vertex(GRID / 2, GRID / 2).direction()
    }
    pub fn neighbor_point(self, edge: usize, t: f64) -> V3 {
        let size = f64::from(1u32 << self.level);
        let eps = 1e-6;
        let (x, y) = match edge {
            0 => (-eps, t),
            1 => (1.0 + eps, t),
            2 => (t, -eps),
            _ => (t, 1.0 + eps),
        };
        let u = 2.0 * (f64::from(self.x) + x) / size - 1.0;
        let v = 2.0 * (f64::from(self.y) + y) / size - 1.0;
        match self.face {
            0 => [1.0, v, -u],
            1 => [-1.0, v, u],
            2 => [u, 1.0, -v],
            3 => [u, -1.0, v],
            4 => [u, v, 1.0],
            _ => [-u, v, -1.0],
        }
    }
}
#[derive(Clone, Debug)]
pub struct Cut {
    pub leaves: BTreeSet<Patch>,
}
impl Default for Cut {
    fn default() -> Self {
        Self {
            leaves: (0..6)
                .map(|face| Patch {
                    face,
                    level: 0,
                    x: 0,
                    y: 0,
                })
                .collect(),
        }
    }
}
impl Cut {
    pub fn find(&self, p: V3) -> Patch {
        let (f, u, v) = chart(p);
        self.find_uv(f, u, v)
    }
    pub fn find_uv(&self, face: u8, u: f64, v: f64) -> Patch {
        for level in 0..=MAX_LEVEL {
            let s = f64::from(1u32 << level);
            let p = Patch {
                face,
                level,
                x: (u * s).floor().max(0.0).min(s - 1.0) as u32,
                y: (v * s).floor().max(0.0).min(s - 1.0) as u32,
            };
            if self.leaves.contains(&p) {
                return p;
            }
        }
        panic!("incomplete planet")
    }
    pub fn mask(&self, p: Patch) -> u8 {
        (0..4).fold(0, |mask, e| {
            mask | ((self.find(p.neighbor_point(e, 0.5)).level < p.level) as u8) << e
        })
    }
    pub fn balanced(&self) -> bool {
        self.leaves.iter().all(|&p| {
            (0..4).all(|e| {
                [0.25, 0.75]
                    .iter()
                    .all(|&t| p.level.abs_diff(self.find(p.neighbor_point(e, t)).level) <= 1)
            })
        })
    }
    pub fn area(&self) -> f64 {
        self.leaves
            .iter()
            .map(|p| 4.0_f64.powi(-(p.level as i32)))
            .sum()
    }
    pub fn split(&mut self, p: Patch) {
        if self.leaves.remove(&p) {
            self.leaves.extend(p.children());
        }
    }
    /// One-level epochs, hysteresis, bounded proposal count. Balance closure is
    /// transactional: if its complete closure cannot fit, retain the old cut.
    pub fn propose(
        &self,
        skin: &Skin,
        camera: V3,
        pixels: f64,
        tolerance: f64,
        cap: usize,
    ) -> (Self, usize, f64) {
        let radial = field::normalized(camera);
        let surface_camera = field::mul(radial, skin.radius);
        let altitude = (field::length(camera) - skin.radius - skin.height(radial, 0.0))
            .abs()
            .max(2.0);
        let errors: Vec<_> = (0..=MAX_LEVEL).map(|l| skin.error_bound(l)).collect();
        let error = |p: Patch| {
            let center = field::mul(p.center(), skin.radius);
            let radius = skin.radius * 1.5 / f64::from(1u32 << p.level);
            // Tangent distance/altitude is a scheduling estimate, not a certified
            // nearest-distance bound. The finite height-error bound is separate.
            let dist = (field::length(field::sub(center, surface_camera)) - radius)
                .max(0.0)
                .hypot(altitude);
            let horizon = field::dot(p.center(), radial);
            if horizon + 2.0 / f64::from(1u32 << p.level)
                < skin.radius / field::length(camera).max(skin.radius) - 0.04
            {
                return 0.0;
            }
            errors[p.level as usize] * pixels / dist
        };
        let mut next = self.clone();
        let mut denied = 0;
        let parents: BTreeSet<_> = self
            .leaves
            .iter()
            .filter(|p| p.level > 0)
            .map(|p| p.parent())
            .collect();
        for p in parents {
            if p.children().iter().all(|c| next.leaves.contains(c)) && error(p) < tolerance * 0.4 {
                let mut trial = next.clone();
                for c in p.children() {
                    trial.leaves.remove(&c);
                }
                trial.leaves.insert(p);
                if trial.balanced() {
                    next = trial;
                }
            }
        }
        let mut desired: Vec<_> = self
            .leaves
            .iter()
            .copied()
            .filter(|p| p.level < MAX_LEVEL && error(*p) > tolerance)
            .collect();
        desired.sort_by(|a, b| error(*b).total_cmp(&error(*a)).then(a.cmp(b)));
        for p in desired.into_iter().take(64) {
            if !next.leaves.contains(&p) {
                continue;
            }
            let mut trial = next.clone();
            trial.split(p);
            loop {
                let mut split = BTreeSet::new();
                for &q in &trial.leaves {
                    for e in 0..4 {
                        for t in [0.25, 0.75] {
                            let n = trial.find(q.neighbor_point(e, t));
                            if q.level > n.level + 1 {
                                split.insert(n);
                            }
                        }
                    }
                }
                if split.is_empty() {
                    break;
                }
                for q in split {
                    trial.split(q);
                }
                if trial.leaves.len() > cap {
                    break;
                }
            }
            // Prefer useful near-ground refinement under pressure. Coarsen low
            // priority sibling groups transactionally, even if their error goal
            // remains unmet. Coverage is never discarded; deferrals are counted.
            if trial.leaves.len() > cap {
                let candidates: BTreeSet<_> = next
                    .leaves
                    .iter()
                    .filter(|q| q.level > 0)
                    .map(|q| q.parent())
                    .collect();
                let mut candidates: Vec<_> = candidates
                    .into_iter()
                    .filter(|q| {
                        error(*q) < error(p) * 0.2
                            && q.children()
                                .iter()
                                .all(|c| self.leaves.contains(c) && trial.leaves.contains(c))
                    })
                    .collect();
                candidates.sort_by(|a, b| error(*a).total_cmp(&error(*b)).then(a.cmp(b)));
                for q in candidates {
                    let mut smaller = trial.clone();
                    for c in q.children() {
                        smaller.leaves.remove(&c);
                    }
                    smaller.leaves.insert(q);
                    if smaller.balanced() {
                        trial = smaller;
                        denied += 1;
                    }
                    if trial.leaves.len() <= cap {
                        break;
                    }
                }
            }
            // All changes within one level of the current mesh, for bounded union work.
            if trial.leaves.len() <= cap
                && trial
                    .leaves
                    .iter()
                    .all(|p| p.level <= self.find(p.center()).level + 1)
            {
                next = trial;
            } else {
                denied += 1;
            }
        }
        let worst = next.leaves.iter().map(|&p| error(p)).fold(0.0, f64::max);
        (next, denied, worst)
    }
    pub fn union(&self, other: &Self) -> Self {
        let leaves = self
            .leaves
            .iter()
            .chain(&other.leaves)
            .copied()
            .filter(|p| {
                let a = self.find(p.center());
                let b = other.find(p.center());
                p.level == a.level.max(b.level)
            })
            .collect();
        Self { leaves }
    }
}
pub fn collapsed(x: u32, y: u32, mask: u8) -> (u32, u32) {
    let mut a = x;
    let mut b = y;
    if (x == 0 && mask & 1 != 0) || (x == GRID && mask & 2 != 0) {
        b &= !1;
    }
    if (y == 0 && mask & 4 != 0) || (y == GRID && mask & 8 != 0) {
        a &= !1;
    }
    (a, b)
}
pub fn triangles(mask: u8) -> Vec<[(u32, u32); 3]> {
    let mut out = Vec::with_capacity((GRID * GRID * 2) as usize);
    for y in 0..GRID {
        for x in 0..GRID {
            for tri in cell_triangles(x, y) {
                let t = tri.map(|(a, b)| collapsed(a, b, mask));
                if t[0] != t[1] && t[1] != t[2] && t[0] != t[2] {
                    out.push(t);
                }
            }
        }
    }
    out
}
/// Alternating diagonals form a 2x2 diamond fan. Unlike a uniform diagonal,
/// collapsing an odd boundary vertex preserves only axis/45-degree edges.
/// The next finer diamond grid contains every parent edge, including stitches.
pub fn cell_triangles(x: u32, y: u32) -> [[(u32, u32); 3]; 2] {
    if (x + y) % 2 == 0 {
        [
            [(x, y), (x + 1, y), (x + 1, y + 1)],
            [(x, y), (x + 1, y + 1), (x, y + 1)],
        ]
    } else {
        [
            [(x, y), (x + 1, y), (x, y + 1)],
            [(x + 1, y), (x + 1, y + 1), (x, y + 1)],
        ]
    }
}
pub fn barycentric(q: [f64; 2], t: [(u32, u32); 3]) -> Option<[f64; 3]> {
    let [[ax, ay], [bx, by], [cx, cy]] = t.map(|(x, y)| [f64::from(x), f64::from(y)]);
    let den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if den.abs() < 1e-9 {
        return None;
    }
    let a = ((by - cy) * (q[0] - cx) + (cx - bx) * (q[1] - cy)) / den;
    let b = ((cy - ay) * (q[0] - cx) + (ax - cx) * (q[1] - cy)) / den;
    let w = [a, b, 1.0 - a - b];
    w.iter().all(|v| *v >= -1e-7).then_some(w)
}
/// Patch topology has one sample owner (coarsest incident leaf) for every shared
/// vertex, including corners across three cube faces. No face-specific noise.
pub struct Topology {
    pub cut: Cut,
    pub owners: HashMap<Vertex, u32>,
    masks: HashMap<Patch, u8>,
    patterns: Vec<Vec<[(u32, u32); 3]>>,
}
impl Topology {
    pub fn new(cut: Cut) -> Self {
        let mut owners = HashMap::new();
        let mut masks = HashMap::new();
        for &p in &cut.leaves {
            masks.insert(p, cut.mask(p));
            for y in 0..=GRID {
                for x in 0..=GRID {
                    owners
                        .entry(p.vertex(x, y))
                        .and_modify(|l: &mut u32| *l = (*l).min(p.level))
                        .or_insert(p.level);
                }
            }
        }
        Self {
            cut,
            owners,
            masks,
            patterns: (0..16).map(triangles).collect(),
        }
    }
    pub fn triangles(&self, p: Patch) -> &[[(u32, u32); 3]] {
        &self.patterns[self.masks[&p] as usize]
    }
    pub fn basis(&self, v: Vertex) -> [(Vertex, u32, f64); 3] {
        let p = self.cut.find(v.direction());
        let (u, w) = on_face(v.0.map(f64::from), p.face);
        let size = f64::from(GRID << p.level);
        let q = [
            (u * size - f64::from(p.x * GRID)).clamp(0.0, f64::from(GRID)),
            (w * size - f64::from(p.y * GRID)).clamp(0.0, f64::from(GRID)),
        ];
        let x = q[0].floor() as i32;
        let y = q[1].floor() as i32;
        // Search only the nearby cells, including the one-cell edge-collapse fan.
        for yy in (y - 1).max(0)..=(y + 1).min(GRID as i32 - 1) {
            for xx in (x - 1).max(0)..=(x + 1).min(GRID as i32 - 1) {
                let (xx, yy) = (xx as u32, yy as u32);
                for tri in cell_triangles(xx, yy) {
                    let t = tri.map(|(a, b)| collapsed(a, b, self.masks[&p]));
                    if let Some(b) = barycentric(q, t) {
                        return std::array::from_fn(|i| {
                            let v = p.vertex(t[i].0, t[i].1);
                            (v, self.owners[&v], b[i].max(0.0))
                        });
                    }
                }
            }
        }
        panic!("no conforming triangle for {v:?} in {p:?} {q:?}")
    }
    pub fn position(&self, skin: &Skin, v: Vertex) -> V3 {
        self.basis(v).iter().fold([0.0; 3], |sum, (v, l, w)| {
            field::add(
                sum,
                field::mul(skin.position(v.direction(), skin.spacing(*l)), *w),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diamond_refinement_preserves_the_interior_of_every_parent_transition() {
        for mask in 0..16 {
            let old = triangles(mask);
            // Deliberately nonlinear vertex data: agreement cannot be obtained
            // by interpolating the underlying function instead of the triangle.
            let value =
                |(x, y): (u32, u32)| (f64::from(x) * 1.7).sin() + (f64::from(y) * 0.7).cos();
            let at = |q: [f64; 2]| {
                old.iter()
                    .find_map(|t| {
                        barycentric(q, *t).map(|w| (0..3).map(|i| w[i] * value(t[i])).sum::<f64>())
                    })
                    .unwrap()
            };
            for y in 0..32 {
                for x in 0..32 {
                    for t in cell_triangles(x, y) {
                        let q = t.map(|(a, b)| [f64::from(a) * 0.5, f64::from(b) * 0.5]);
                        for weights in [[0.2, 0.3, 0.5], [0.7, 0.2, 0.1]] {
                            let p =
                                std::array::from_fn(|j| (0..3).map(|i| q[i][j] * weights[i]).sum());
                            let refined = (0..3).map(|i| at(q[i]) * weights[i]).sum::<f64>();
                            assert!((refined - at(p)).abs() < 1e-6, "mask {mask}, cell {x},{y}");
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn face_edges_and_corners_have_canonical_identity() {
        let mut counts = HashMap::new();
        for p in Cut::default().leaves {
            for y in 0..=GRID {
                for x in 0..=GRID {
                    *counts.entry(p.vertex(x, y)).or_insert(0) += 1;
                }
            }
        }
        assert_eq!(counts.values().filter(|&&n| n == 3).count(), 8);
        assert_eq!(
            counts.values().filter(|&&n| n == 2).count(),
            12 * (GRID as usize - 1)
        );
        assert!(counts.values().all(|&n| n <= 3));
    }
    #[test]
    fn transition_patterns_are_positive_and_cover_the_square() {
        for mask in 0..16 {
            let mut area = 0i64;
            let mut edges = HashMap::new();
            for t in triangles(mask) {
                let a = t.map(|(x, y)| [i64::from(x), i64::from(y)]);
                let cross = (a[1][0] - a[0][0]) * (a[2][1] - a[0][1])
                    - (a[1][1] - a[0][1]) * (a[2][0] - a[0][0]);
                assert!(cross > 0);
                area += cross;
                for i in 0..3 {
                    let mut e = [t[i], t[(i + 1) % 3]];
                    e.sort();
                    *edges.entry(e).or_insert(0) += 1;
                }
            }
            assert_eq!(area, i64::from(GRID * GRID * 2));
            assert!(edges.values().all(|n| *n == 1 || *n == 2));
        }
    }
    #[test]
    fn adaptive_cuts_remain_complete_balanced_and_bounded() {
        let s = Skin::default();
        let mut c = Cut::default();
        for i in 0..24 {
            let cam = field::mul(
                field::normalized([0.31, 1.0, 0.27]),
                s.radius + if i < 12 { 20.0 } else { 8e6 },
            );
            c = c.propose(&s, cam, 900.0, 8.0, 96).0;
            assert!(c.balanced());
            assert_eq!(c.area(), 6.0);
            assert!(c.leaves.len() <= 96);
        }
        let same = c.propose(&s, [s.radius, 0.0, 0.0], 900.0, 0.1, 6).0;
        assert!(same.balanced());
        assert_eq!(same.area(), 6.0);
    }
    #[test]
    fn transition_union_is_closed_and_morph_endpoints_use_actual_triangles() {
        let mut a = Cut::default();
        a.split(Patch {
            face: 2,
            level: 0,
            x: 0,
            y: 0,
        });
        let mut b = a.clone();
        b.split(Patch {
            face: 2,
            level: 1,
            x: 0,
            y: 0,
        });
        // Balance at adjoining faces through a scheduler instead of invalid manual cut.
        if !b.balanced() {
            b = a
                .propose(&Skin::default(), [0.0, 6371005.0, 0.0], 900.0, 1000.0, 96)
                .0;
        }
        let union = Topology::new(a.union(&b));
        let ta = Topology::new(a);
        let tb = Topology::new(b);
        let skin = Skin::default();
        let mut edges = HashMap::new();
        for &p in &union.cut.leaves {
            for t in union.triangles(p) {
                let verts = t.map(|(x, y)| p.vertex(x, y));
                for i in 0..3 {
                    let mut e = [verts[i], verts[(i + 1) % 3]];
                    e.sort();
                    *edges.entry(e).or_insert(0) += 1;
                }
                for v in verts {
                    let p0 = ta.position(&skin, v);
                    let p1 = tb.position(&skin, v);
                    for alpha in [0.0, 0.125, 0.5, 0.875, 1.0] {
                        assert!(
                            field::add(field::mul(p0, 1.0 - alpha), field::mul(p1, alpha))
                                .iter()
                                .all(|x| x.is_finite())
                        );
                    }
                }
            }
        }
        assert!(edges.values().all(|n| *n == 2));
    }
}

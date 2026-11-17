//! Falsifiable alternatives: deterministic compact convolution and finite
//! conforming tetrahedral micromesh over exactly the same local solid program.
use crate::{
    field::{self, Ray, Solid, V3},
    hash,
};
pub fn sparse_convolution(p: V3, seed: u32) -> f64 {
    let c = p.map(|v| v.floor() as i32);
    let mut result = 0.0;
    for z in -1..=1 {
        for y in -1..=1 {
            for x in -1..=1 {
                let cell = [c[0] + x, c[1] + y, c[2] + z];
                let identity =
                    hash(cell[0] as u32 ^ hash(cell[1] as u32 ^ hash(cell[2] as u32 ^ seed)));
                let offset = [identity, identity.wrapping_add(1), identity.wrapping_add(2)]
                    .map(|v| f64::from(hash(v)) / f64::from(u32::MAX));
                let centre = std::array::from_fn(|i| f64::from(cell[i]) + offset[i]);
                let d = field::sub(p, centre);
                let r2 = field::dot(d, d);
                if r2 < 1.0 {
                    let w =
                        f64::from(hash(identity.wrapping_add(3))) / f64::from(u32::MAX) * 2.0 - 1.0;
                    result += w * (1.0 - r2).powi(3) / 27.0;
                }
            }
        }
    }
    result
}
#[derive(Clone, Copy, Debug)]
pub struct Triangle {
    pub vertices: [V3; 3],
}
#[derive(Clone, Debug)]
struct Node {
    min: V3,
    max: V3,
    range: [usize; 2],
    children: Option<[usize; 2]>,
}
pub struct Mesh {
    pub triangles: Vec<Triangle>,
    nodes: Vec<Node>,
    pub field_evaluations: usize,
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
impl Mesh {
    /// Offline triangle reference only. The explorer never uses this CPU BVH.
    pub fn from_triangles(triangles: Vec<Triangle>, cap: usize) -> Result<Self, &'static str> {
        if triangles.len() > cap {
            return Err("reference triangle budget exceeded");
        }
        let mut mesh = Self {
            triangles,
            nodes: Vec::new(),
            field_evaluations: 0,
        };
        if !mesh.triangles.is_empty() {
            mesh.build_node(0, mesh.triangles.len());
        }
        Ok(mesh)
    }
    pub fn build(solid: Solid, n: usize, cap: usize) -> Result<Self, &'static str> {
        if !(4..=160).contains(&n) {
            return Err("micromesh grid outside bounded experiment range");
        }
        let count = (n + 1).pow(3);
        let spacing = 8.0 / n as f64;
        let point = |x: usize, y: usize, z: usize| {
            [
                -4.0 + x as f64 * spacing,
                -4.0 + y as f64 * spacing,
                -4.0 + z as f64 * spacing,
            ]
        };
        let index = |x: usize, y: usize, z: usize| (z * (n + 1) + y) * (n + 1) + x;
        let mut samples = vec![0.0; count];
        for z in 0..=n {
            for y in 0..=n {
                for x in 0..=n {
                    samples[index(x, y, z)] = solid.value(point(x, y, z));
                }
            }
        }
        let mut mesh = Self {
            triangles: Vec::new(),
            nodes: Vec::new(),
            field_evaluations: count,
        };
        let tetrahedra = [
            [0, 1, 3, 7],
            [0, 3, 2, 7],
            [0, 2, 6, 7],
            [0, 6, 4, 7],
            [0, 4, 5, 7],
            [0, 5, 1, 7],
        ];
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    let p: [V3; 8] = std::array::from_fn(|i| {
                        point(x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1))
                    });
                    let f: [f64; 8] = std::array::from_fn(|i| {
                        samples[index(x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1))]
                    });
                    if f.iter().all(|v| *v > 0.0) || f.iter().all(|v| *v < 0.0) {
                        continue;
                    }
                    for tet in tetrahedra {
                        let mut cuts = Vec::with_capacity(4);
                        for [a, b] in [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] {
                            let a = tet[a];
                            let b = tet[b];
                            if (f[a] < 0.0) != (f[b] < 0.0) {
                                let t = f[a] / (f[a] - f[b]);
                                cuts.push(field::add(p[a], field::mul(field::sub(p[b], p[a]), t)));
                            }
                        }
                        if cuts.len() < 3 {
                            continue;
                        }
                        // Sort the convex tetrahedron cross section around its centroid.
                        let centre = field::mul(
                            cuts.iter().fold([0.0; 3], |a, &b| field::add(a, b)),
                            1.0 / cuts.len() as f64,
                        );
                        let u = field::normalized(field::sub(cuts[0], centre));
                        let normal = field::normalized(cross(field::sub(cuts[1], centre), u));
                        let v = cross(normal, u);
                        cuts.sort_by(|a, b| {
                            let a = field::sub(*a, centre);
                            let b = field::sub(*b, centre);
                            field::dot(a, v)
                                .atan2(field::dot(a, u))
                                .total_cmp(&field::dot(b, v).atan2(field::dot(b, u)))
                        });
                        for i in 1..cuts.len() - 1 {
                            if mesh.triangles.len() == cap {
                                return Err("explicit triangle budget exhausted");
                            }
                            mesh.triangles.push(Triangle {
                                vertices: [cuts[0], cuts[i], cuts[i + 1]],
                            });
                        }
                    }
                }
            }
        }
        if !mesh.triangles.is_empty() {
            mesh.build_node(0, mesh.triangles.len());
        }
        Ok(mesh)
    }
    fn build_node(&mut self, start: usize, end: usize) -> usize {
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for tri in &self.triangles[start..end] {
            for p in tri.vertices {
                for i in 0..3 {
                    min[i] = min[i].min(p[i]);
                    max[i] = max[i].max(p[i]);
                }
            }
        }
        let id = self.nodes.len();
        self.nodes.push(Node {
            min,
            max,
            range: [start, end],
            children: None,
        });
        if end - start > 8 {
            let axis = (0..3)
                .max_by(|&a, &b| (max[a] - min[a]).total_cmp(&(max[b] - min[b])))
                .unwrap();
            self.triangles[start..end].sort_by(|a, b| {
                a.vertices
                    .iter()
                    .map(|p| p[axis])
                    .sum::<f64>()
                    .total_cmp(&b.vertices.iter().map(|p| p[axis]).sum::<f64>())
            });
            let mid = (start + end) / 2;
            let left = self.build_node(start, mid);
            let right = self.build_node(mid, end);
            self.nodes[id].children = Some([left, right]);
        }
        id
    }
    pub fn trace(&self, ray: Ray) -> Option<f64> {
        if self.nodes.is_empty() {
            return None;
        }
        let mut stack = vec![0];
        let mut closest = ray.far;
        let mut found = false;
        while let Some(id) = stack.pop() {
            let node = &self.nodes[id];
            let mut lo = ray.near;
            let mut hi = closest;
            for i in 0..3 {
                if ray.direction[i].abs() < 1e-20 {
                    if ray.origin[i] < node.min[i] || ray.origin[i] > node.max[i] {
                        hi = -1.0;
                        break;
                    }
                } else {
                    let a = (node.min[i] - ray.origin[i]) / ray.direction[i];
                    let b = (node.max[i] - ray.origin[i]) / ray.direction[i];
                    lo = lo.max(a.min(b));
                    hi = hi.min(a.max(b));
                }
            }
            if hi < lo {
                continue;
            }
            if let Some(children) = node.children {
                stack.extend(children);
                continue;
            }
            for tri in &self.triangles[node.range[0]..node.range[1]] {
                let [a, b, c] = tri.vertices;
                let e1 = field::sub(b, a);
                let e2 = field::sub(c, a);
                let p = cross(ray.direction, e2);
                let det = field::dot(e1, p);
                if det.abs() < 1e-14 {
                    continue;
                }
                let t = field::sub(ray.origin, a);
                let u = field::dot(t, p) / det;
                if !(0.0..=1.0).contains(&u) {
                    continue;
                }
                let q = cross(t, e1);
                let v = field::dot(ray.direction, q) / det;
                if v < 0.0 || u + v > 1.0 {
                    continue;
                }
                let hit = field::dot(e2, q) / det;
                if hit >= ray.near && hit < closest {
                    closest = hit;
                    found = true;
                }
            }
        }
        found.then_some(closest)
    }
    pub fn bytes(&self) -> usize {
        self.triangles.capacity() * std::mem::size_of::<Triangle>()
            + self.nodes.capacity() * std::mem::size_of::<Node>()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_noise_respects_deterministic_amplitude_and_gradient_envelope() {
        for i in 0..200 {
            let p = [i, i + 3, i + 7].map(|x| f64::from(hash(x)) / f64::from(u32::MAX) * 8.0);
            let v = sparse_convolution(p, 123);
            assert!(v.abs() <= 1.0);
            let next = sparse_convolution(field::add(p, [1e-5, 0.0, 0.0]), 123);
            assert!((next - v).abs() <= 2e-5);
        }
    }
    #[test]
    fn mesh_preserves_bore_and_has_explicit_capacity() {
        let s = Solid {
            bands: 0,
            ..Default::default()
        };
        let m = Mesh::build(s, 24, 100000).unwrap();
        let r = Ray {
            origin: [-5.0, 0.0, 0.0],
            direction: [1.0, 0.0, 0.0],
            near: 0.0,
            far: 10.0,
        };
        assert!(m.trace(r).is_none());
        assert!(m
            .trace(Ray {
                origin: [-5.0, 1.0, 0.0],
                ..r
            })
            .is_some());
        assert!(Mesh::build(s, 24, 4).is_err());
    }
}

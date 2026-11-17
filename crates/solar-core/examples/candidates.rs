use solar_core::{
    candidates::{self, Mesh},
    field::{self, Ray, Solid, Status},
};
use std::time::Instant;
fn main() {
    let solid = Solid::default();
    let mut references = Vec::new();
    for y in 0..25 {
        for x in 0..41 {
            let ray = Ray {
                origin: [0.0, 0.2, 7.0],
                direction: field::normalized([
                    (f64::from(x) - 20.0) * 0.045,
                    (f64::from(y) - 12.0) * 0.045,
                    -1.0,
                ]),
                near: 0.0,
                far: 14.0,
            };
            let h = field::trace(solid, ray, 0.001, 100000, 2);
            references.push((ray, h));
        }
    }
    println!("grid,triangles,resident_bytes,generation_ms,ray_ms,false_misses,worst_depth_error_m,reference_unresolved");
    for n in [24, 48, 96] {
        let start = Instant::now();
        let mesh = Mesh::build(solid, n, 1000000).unwrap();
        let generation = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let (mut misses, mut worst, mut unresolved) = (0, 0.0_f64, 0);
        for &(ray, reference) in &references {
            let t = mesh.trace(ray);
            if reference.status == Status::Hit {
                if let Some(t) = t {
                    worst = worst.max((t - (reference.near + reference.far) * 0.5).abs());
                } else {
                    misses += 1;
                }
            } else if reference.status == Status::Unresolved {
                unresolved += 1;
            }
        }
        println!(
            "{n},{},{},{generation:.3},{:.3},{misses},{worst:.8},{unresolved}",
            mesh.triangles.len(),
            mesh.bytes(),
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
    for sparse in [false, true] {
        let start = Instant::now();
        let mut sum = 0.0;
        for i in 0..100000 {
            let p = [f64::from(i) * 0.013, 1.7, 3.1];
            sum += if sparse {
                candidates::sparse_convolution(p, 2026)
            } else {
                field::noise(p, 2026)
            };
        }
        println!(
            "noise sparse={sparse}, queries=100000, ms={:.3}, checksum={sum}",
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

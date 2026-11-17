use solar_core::tracing::{trace, Status};

fn main() {
    println!("Bored sphere + 16 bounded trigonometric bands, 2145 rays, local f64.");
    println!(
        "Residual candidates are not certified first intersections. No renderer timing claim."
    );
    for lazy in [false, true] {
        let mut steps = Vec::new();
        let mut evaluations = 0_u64;
        let mut candidates = 0;
        let mut misses = 0;
        let mut unresolved = 0;
        let mut inside = 0;
        for y in -16..=16 {
            for x in -32..=32 {
                let mut direction = [f64::from(x) * 0.022, f64::from(y) * 0.022, -1.0];
                let length = direction.iter().map(|v| v * v).sum::<f64>().sqrt();
                direction.iter_mut().for_each(|v| *v /= length);
                let result = trace([0.0, 0.0, 6.0], direction, lazy);
                steps.push(result.steps);
                evaluations += result.band_evaluations;
                match result.status {
                    Status::ResidualCandidate => candidates += 1,
                    Status::Miss => misses += 1,
                    Status::BudgetExhausted => unresolved += 1,
                    Status::StartedInside => inside += 1,
                }
            }
        }
        steps.sort_unstable();
        println!("lazy={lazy} bands={evaluations} steps_p50={} steps_p99={} candidates={candidates} misses={misses} unresolved={unresolved} inside={inside}", steps[steps.len()/2], steps[steps.len()*99/100]);
    }
}

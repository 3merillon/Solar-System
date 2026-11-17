//! Durable finite-basin generation. Explicit open outlet, fixed rim, conserved
//! solid + suspended sediment ledger; this is a simulation, separate from noise.
use std::cmp::Reverse;
use std::collections::BinaryHeap;
#[derive(Clone, Debug)]
pub struct Basin {
    pub n: usize,
    pub spacing: f64,
    pub height: Vec<f64>,
    pub original: Vec<f64>,
    pub water: Vec<f64>,
    pub sediment: Vec<f64>,
    pub drainage: Vec<usize>,
    pub catchment: Vec<f64>,
    pub exported_sediment: f64,
    pub steps: u32,
}
impl Basin {
    pub fn new(n: usize, spacing: f64, height: Vec<f64>) -> Self {
        assert!(
            (4..=256).contains(&n)
                && spacing > 0.0
                && height.len() == n * n
                && height.iter().all(|x| x.is_finite())
        );
        let mut b = Self {
            n,
            spacing,
            original: height.clone(),
            height,
            water: vec![0.0; n * n],
            sediment: vec![0.0; n * n],
            drainage: vec![usize::MAX; n * n],
            catchment: vec![1.0; n * n],
            exported_sediment: 0.0,
            steps: 0,
        };
        b.rebuild_drainage();
        b
    }
    fn edge(&self, i: usize) -> bool {
        i < self.n || i >= self.n * (self.n - 1) || i % self.n == 0 || i % self.n == self.n - 1
    }
    fn neighbors(&self, i: usize) -> impl Iterator<Item = usize> {
        let n = self.n;
        [
            i.wrapping_sub(n),
            i + n,
            if i % n > 0 { i - 1 } else { usize::MAX },
            if i % n + 1 < n { i + 1 } else { usize::MAX },
        ]
        .into_iter()
        .filter(move |&j| j < n * n)
    }
    /// Priority flood supplies a consistent downstream DAG even across depressions.
    /// Quantized millimetre priorities affect routing only, not terrain heights.
    pub fn rebuild_drainage(&mut self) {
        let mut seen = vec![false; self.n * self.n];
        let mut heap = BinaryHeap::new();
        let mut order = Vec::with_capacity(seen.len());
        self.drainage.fill(usize::MAX);
        self.catchment.fill(1.0);
        for (i, s) in seen.iter_mut().enumerate() {
            if self.edge(i) {
                *s = true;
                heap.push(Reverse(((self.height[i] * 1000.0).round() as i64, i)));
            }
        }
        while let Some(Reverse((h, i))) = heap.pop() {
            order.push(i);
            for j in self.neighbors(i) {
                if !seen[j] {
                    seen[j] = true;
                    self.drainage[j] = i;
                    heap.push(Reverse((
                        h.max((self.height[j] * 1000.0).round() as i64),
                        j,
                    )));
                }
            }
        }
        for &i in order.iter().rev() {
            let j = self.drainage[i];
            if j != usize::MAX {
                self.catchment[j] += self.catchment[i];
            }
        }
    }
    pub fn step(&mut self, rain: f64, erodibility: f64) {
        assert!((0.0..=1.0).contains(&rain) && (0.0..=1.0).contains(&erodibility));
        let len = self.height.len();
        let mut dw = vec![0.0; len];
        let mut ds = vec![0.0; len];
        let mut dh = vec![0.0; len];
        for i in 0..len {
            self.water[i] += rain;
            let j = self.drainage[i];
            if j == usize::MAX {
                self.exported_sediment += self.sediment[i];
                self.sediment[i] = 0.0;
                self.water[i] = 0.0;
                continue;
            }
            let slope = ((self.height[i] - self.height[j]) / self.spacing).max(0.0);
            let discharge = self.water[i] * 0.35;
            // Stream-power capacity with bounded erosion/deposition per timestep.
            let capacity = discharge * slope.sqrt() * 0.8;
            let transfer = (capacity - self.sediment[i]) * erodibility;
            let amount = transfer.clamp(-self.sediment[i], 0.08);
            if !self.edge(i) {
                self.height[i] -= amount;
                self.sediment[i] += amount;
            }
            let moved = self.sediment[i] * 0.35;
            dw[i] -= discharge;
            dw[j] += discharge;
            ds[i] -= moved;
            ds[j] += moved;
            // Thermal creep transports excess talus to a downhill neighbor, conservatively.
            if !self.edge(i) && !self.edge(j) {
                let talus =
                    ((self.height[i] - self.height[j]) - self.spacing * 0.65).max(0.0) * 0.02;
                dh[i] -= talus;
                dh[j] += talus;
            }
        }
        for i in 0..len {
            self.water[i] = (self.water[i] + dw[i]) * 0.98;
            self.sediment[i] += ds[i];
            self.height[i] += dh[i];
        }
        self.steps += 1;
        if self.steps % 16 == 0 {
            self.rebuild_drainage();
        }
    }
    pub fn solid_ledger_error(&self) -> f64 {
        self.height.iter().sum::<f64>() + self.sediment.iter().sum::<f64>() + self.exported_sediment
            - self.original.iter().sum::<f64>()
    }
    pub fn delta(&self) -> Vec<f32> {
        self.height
            .iter()
            .zip(&self.original)
            .map(|(h, o)| (h - o) as f32)
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basin_has_deterministic_boundary_conditions_and_conserves_sediment() {
        let n = 24;
        let heights = (0..n * n)
            .map(|i| ((i % n) as f64 * 0.31).sin() * 5.0 + (i / n) as f64 * 1.4)
            .collect();
        let mut a = Basin::new(n, 1.0, heights);
        let mut b = a.clone();
        for _ in 0..80 {
            a.step(0.04, 0.2);
            b.step(0.04, 0.2);
        }
        assert!(
            a.solid_ledger_error().abs() < 1e-8,
            "{}",
            a.solid_ledger_error()
        );
        assert_eq!(a.height, b.height);
        assert!(a.delta().iter().any(|x| x.abs() > 0.01));
        for i in 0..n * n {
            if a.edge(i) {
                assert_eq!(a.height[i], a.original[i]);
            }
            let mut j = i;
            for k in 0..=n * n {
                if a.drainage[j] == usize::MAX {
                    break;
                }
                j = a.drainage[j];
                assert!(k < n * n, "drainage cycle");
            }
        }
    }
}

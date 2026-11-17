//! Versioned durable simulation state; rendering caches are deliberately absent.
use crate::renderer::Settings;
use solar_core::erosion::Basin;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    version: u32,
    pub settings: Settings,
    n: usize,
    spacing: f64,
    height: Vec<f64>,
    original: Vec<f64>,
    water: Vec<f64>,
    sediment: Vec<f64>,
    drainage: Vec<Option<usize>>,
    catchment: Vec<f64>,
    exported_sediment: f64,
    steps: u32,
    ledger_error: f64,
}
impl Snapshot {
    pub fn capture(settings: &Settings, b: &Basin) -> Self {
        Self {
            version: 2,
            settings: settings.clone(),
            n: b.n,
            spacing: b.spacing,
            height: b.height.clone(),
            original: b.original.clone(),
            water: b.water.clone(),
            sediment: b.sediment.clone(),
            drainage: b
                .drainage
                .iter()
                .map(|&i| (i != usize::MAX).then_some(i))
                .collect(),
            catchment: b.catchment.clone(),
            exported_sediment: b.exported_sediment,
            steps: b.steps,
            ledger_error: b.solid_ledger_error(),
        }
    }
    pub fn restore(self) -> Result<(Settings, Basin), String> {
        self.settings.validate()?;
        let len = self.n.saturating_mul(self.n);
        if self.version != 2
            || self.n != 65
            || self.spacing != 8.0
            || self.steps != self.settings.erosion_steps
            || self.drainage.len() != len
            || [
                &self.height,
                &self.original,
                &self.water,
                &self.sediment,
                &self.catchment,
            ]
            .iter()
            .any(|a| a.len() != len || a.iter().any(|x| !x.is_finite() || x.abs() > 1e6))
            || self.water.iter().chain(&self.sediment).any(|x| *x < -1e-9)
            || !self.exported_sediment.is_finite()
            || self.exported_sediment < 0.0
        {
            return Err("Invalid finite basin snapshot".into());
        }
        let g = self.settings.geology();
        for i in 0..len {
            let x = (i % self.n) as f64 * 8.0 - 256.0;
            let z = (i / self.n) as f64 * 8.0 - 256.0;
            let original = g.height([x, self.settings.radius, z])
                - (x * x + z * z) / (2.0 * self.settings.radius);
            if (self.original[i] - original).abs() > 1e-7 {
                return Err("Basin belongs to a different generator".into());
            }
            let edge =
                i < self.n || i >= len - self.n || i % self.n == 0 || i % self.n == self.n - 1;
            if edge && (self.height[i] != self.original[i] || self.drainage[i].is_some()) {
                return Err("Basin boundary changed".into());
            }
            let mut j = i;
            for depth in 0..=len {
                let Some(next) = self.drainage[j] else { break };
                if next >= len
                    || depth == len
                    || !((next.abs_diff(j) == self.n)
                        || (next.abs_diff(j) == 1 && next / self.n == j / self.n))
                {
                    return Err("Invalid drainage graph".into());
                }
                j = next;
            }
        }
        let b = Basin {
            n: self.n,
            spacing: self.spacing,
            height: self.height,
            original: self.original,
            water: self.water,
            sediment: self.sediment,
            drainage: self
                .drainage
                .into_iter()
                .map(|v| v.unwrap_or(usize::MAX))
                .collect(),
            catchment: self.catchment,
            exported_sediment: self.exported_sediment,
            steps: self.steps,
        };
        if b.solid_ledger_error().abs() > 1e-4 {
            return Err("Sediment conservation ledger is invalid".into());
        }
        Ok((self.settings, b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stored_state_resumes_exactly_and_rejects_corruption() {
        let mut s = Settings::default();
        let g = s.geology();
        let h = (0..65 * 65)
            .map(|i| {
                let x = (i % 65) as f64 * 8.0 - 256.0;
                let z = (i / 65) as f64 * 8.0 - 256.0;
                g.height([x, s.radius, z]) - (x * x + z * z) / (2.0 * s.radius)
            })
            .collect();
        let mut a = Basin::new(65, 8.0, h);
        for _ in 0..19 {
            a.step(s.rain, s.erodibility);
        }
        s.erosion_steps = a.steps;
        let json = serde_json::to_string(&Snapshot::capture(&s, &a)).unwrap();
        let (_, mut b) = serde_json::from_str::<Snapshot>(&json)
            .unwrap()
            .restore()
            .unwrap();
        for _ in 0..7 {
            a.step(s.rain, s.erodibility);
            b.step(s.rain, s.erodibility);
        }
        assert_eq!(a.height, b.height);
        assert_eq!(a.water, b.water);
        assert_eq!(a.sediment, b.sediment);
        let mut bad = Snapshot::capture(&s, &b);
        bad.drainage[66] = Some(66);
        assert!(bad.restore().is_err());
    }
    #[test]
    fn sector_json_preserves_full_integer_identity() {
        let s = Settings {
            sector: [i64::MIN.to_string(), i64::MAX.to_string(), "17".into()],
            ..Settings::default()
        };
        let copy: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(copy.validate().is_ok());
        assert_eq!(s.geology().seed, copy.geology().seed);
        assert_ne!(s.geology().seed, Settings::default().geology().seed);
    }
}

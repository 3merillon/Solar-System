use serde::{Deserialize, Serialize};

/// Integrate controls instead of multiplying a new speed by the world's age.
/// This small input state is saved with snapshots; terrain remains GPU-owned.
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct CloudClock {
    pub time: f64,
    pub travel: f64,
    pub evolution: f64,
    pub drift: [f64; 2],
}
impl CloudClock {
    pub fn advance(&mut self, time: f64, speed: f64, evolution: f64, wind: [f64; 2]) {
        let delta = time - self.time;
        self.time = time;
        self.travel += delta * speed;
        self.evolution += delta * evolution;
        for (offset, velocity) in self.drift.iter_mut().zip(wind) {
            *offset += delta * speed * velocity;
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if [
            self.time,
            self.travel,
            self.evolution,
            self.drift[0],
            self.drift[1],
        ]
        .iter()
        .any(|v| !v.is_finite() || v.abs() > 1e10)
        {
            return Err("invalid cloud animation state".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::CloudClock;
    #[test]
    fn controls_pause_resume_and_snapshot_without_phase_jumps() {
        let mut clock = CloudClock::default();
        clock.advance(120.0, 1.0, 2.0, [8.0, 3.0]);
        clock.advance(120.0, 0.0, 0.0, [-20.0, 7.0]);
        clock.advance(140.0, 0.0, 0.0, [-20.0, 7.0]);
        assert_eq!(
            (clock.travel, clock.evolution, clock.drift),
            (120.0, 240.0, [960.0, 360.0])
        );
        let mut restored: CloudClock =
            serde_json::from_str(&serde_json::to_string(&clock).unwrap()).unwrap();
        restored.advance(142.0, 3.0, 0.5, [-20.0, 7.0]);
        assert_eq!(
            (restored.travel, restored.evolution, restored.drift),
            (126.0, 241.0, [840.0, 402.0])
        );
    }
}

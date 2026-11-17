//! The compressed table against positions recorded from JPL Horizons (tools/Record-Horizons.mjs),
//! independently of the kernels the table was fitted from. The limits are what was measured, with a
//! margin; they are not a precision claim beyond the recorded epochs. Run with --nocapture for all.
use solar_core::{celestial::system, ephemeris::SimTime, field::length, field::sub};
const RECORD: &str = include_str!("data/horizons-v1.json");
fn number(text: &str, key: &str, from: usize) -> Option<(f64, usize)> {
    let at = text[from..].find(key)? + from + key.len();
    let end = at + text[at..].find(|c: char| ",]}".contains(c))?;
    Some((text[at..end].parse().ok()?, end))
}
#[test]
fn table_matches_recorded_horizons_positions() {
    let s = system();
    // (target, centre, limit km over the whole recorded span, limit km within 2010 to 2040).
    // Uranus and Neptune differ from Horizons by thousands of km while every other planet agrees to
    // kilometres, and the table's fit to DE440 itself is 31 km. So this looks like Horizons using other
    // integrations for those two, which is an inference: it was not confirmed. It is under a millionth
    // of a radian seen from the Sun, and nothing flown in those planets' frames reads it.
    let limits = [
        (199, 10, 20.0, 20.0),
        (299, 10, 5.0, 5.0),
        (399, 10, 5.0, 5.0),
        (301, 399, 10.0, 10.0),
        (499, 10, 5.0, 5.0),
        (599, 10, 40.0, 40.0),
        (699, 10, 40.0, 40.0),
        (799, 10, 6000.0, 6000.0),
        (899, 10, 3000.0, 3000.0),
        (999, 10, 60.0, 60.0),
    ];
    let mut failures = Vec::new();
    let mut at = 0;
    while let Some(start) = RECORD[at..].find("\"target\":") {
        let block = at + start;
        let (target, end) = number(RECORD, "\"target\":", block).unwrap();
        let (center, _) = number(RECORD, "\"center\":", end).unwrap();
        let next = RECORD[end..]
            .find("\"target\":")
            .map_or(RECORD.len(), |n| end + n);
        let mut cursor = end;
        let mut worst: f64 = 0.0;
        let mut worst_velocity: f64 = 0.0;
        let mut worst_near: f64 = 0.0;
        while let Some(found) = RECORD[cursor..next].find("\"jd\":") {
            let row = cursor + found;
            let (jd, after) = number(RECORD, "\"jd\":", row).unwrap();
            let tail = RECORD[after..].find("\"position_km\":[").unwrap() + after + 15;
            let close = RECORD[tail..].find(']').unwrap() + tail;
            let p: Vec<f64> = RECORD[tail..close]
                .split(',')
                .map(|v| v.parse().unwrap())
                .collect();
            let vstart = RECORD[close..].find("\"velocity_km_s\":[").unwrap() + close + 17;
            let vclose = RECORD[vstart..].find(']').unwrap() + vstart;
            let v: Vec<f64> = RECORD[vstart..vclose]
                .split(',')
                .map(|v| v.parse().unwrap())
                .collect();
            let t = SimTime::from_seconds((jd - 2_451_545.0) * 86_400.0);
            let (q, w) = s.ephemeris.relative_state(target as i32, center as i32, t);
            let error = length(sub(q, [p[0] * 1e3, p[1] * 1e3, p[2] * 1e3]));
            let velocity = length(sub(w, [v[0] * 1e3, v[1] * 1e3, v[2] * 1e3]));
            worst = worst.max(error);
            if (2_455_197.0..2_466_154.0).contains(&jd) {
                worst_near = worst_near.max(error);
            }
            worst_velocity = worst_velocity.max(velocity);
            cursor = vclose;
        }
        println!(
            "{target:>4} against {center:>3}: worst {:>10.2} km, 2010-2040 {:>10.2} km, {:>9.3} m/s",
            worst / 1e3,
            worst_near / 1e3,
            worst_velocity
        );
        // A moon's series: fitted over 1995 to 2050, and recorded inside that, so one limit.
        let (limit, near) = limits
            .iter()
            .find(|l| l.0 == target as i32)
            .map_or((400.0, 400.0), |l| (l.2, l.3));
        if worst / 1e3 > limit || worst_near / 1e3 > near {
            failures.push((target, worst / 1e3, limit));
        }
        at = next;
    }
    assert!(failures.is_empty(), "over limit: {failures:?}");
}

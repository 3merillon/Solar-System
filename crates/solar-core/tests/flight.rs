//! The flight model, numerically, against the embedded solar table. No GPU. Each test states the
//! case the brief asks for: terminal velocity, drag fading with height, a stable orbit, escape,
//! re-entry, hand-over with no jump, and landing on a moving body under a time rate.
use solar_core::{
    celestial::system,
    ephemeris::SimTime,
    field::{add, dot, length, mul, normalized, sub, V3},
    flight::{advance, air_of, free_blend, hand_over, Controls, Craft, Ground},
};
const EARTH: i32 = 399;
const R: f64 = 6_371_000.0;
fn epoch() -> SimTime {
    // 1 January 2027, near enough. The date is not special.
    SimTime::from_seconds(852_076_800.0)
}
fn tangent_of(p: V3) -> V3 {
    let east = [-p[1], p[0], 0.0];
    normalized(east)
}
fn at_height(height: f64) -> V3 {
    mul(normalized([0.3, 0.8, 0.5]), R + height)
}
fn no_ground() -> Ground {
    Ground { height: 0.0 }
}
#[test]
fn pausing_the_clock_does_not_drag_a_hovering_camera_over_the_ground() {
    let s = system();
    for rate in [0.0, 1.0, 60.0] {
        let mut t = epoch();
        let p = at_height(100.0);
        let omega = solar_core::celestial::spin(&s.ephemeris.body(EARTH).unwrap().rotation, t);
        let mut c = Craft::new(
            EARTH,
            p,
            solar_core::celestial::cross(omega, p),
            tangent_of(p),
            normalized(p),
        );
        let before = solar_core::flight::view_of(s, &c, EARTH, t);
        for _ in 0..600 {
            (t, _) = advance(
                s,
                &mut c,
                &Controls::default(),
                no_ground(),
                t,
                rate,
                1.0 / 60.0,
            );
        }
        let after = solar_core::flight::view_of(s, &c, EARTH, t);
        assert!(
            length(sub(before.eye, after.eye)) < 0.05,
            "rate {rate}: {} m drift",
            length(sub(before.eye, after.eye))
        );
        assert!(
            length(sub(before.forward, after.forward)) < 1e-6,
            "rate {rate}: attitude drift"
        );
    }
}
#[test]
fn with_assistance_off_terminal_speed_at_sea_level_is_the_setting_and_rises_as_the_air_thins() {
    let s = system();
    for (height, setting) in [(500.0, 100.0), (8_000.0, 100.0)] {
        let p = at_height(height);
        let forward = tangent_of(p);
        let mut c = Craft::new(EARTH, p, [0.0; 3], forward, normalized(p));
        let controls = Controls {
            thrust: [0.0, 0.0, 1.0],
            setting,
            assist: false,
            ..Controls::default()
        };
        let mut t = epoch();
        for _ in 0..1800 {
            // Hold the height: this measures a level terminal speed, not a climb.
            let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
            t = next;
            let here = c.position.metres();
            c.position =
                solar_core::celestial::Address::from_metres(mul(normalized(here), R + height));
        }
        let air = air_of(EARTH).unwrap();
        let air_velocity = solar_core::celestial::cross(
            solar_core::celestial::spin(&s.ephemeris.body(EARTH).unwrap().rotation, t),
            c.position.metres(),
        );
        let relative = length(sub(c.velocity, air_velocity));
        // Thrust / drag at this height; the setting is the sea-level case.
        let expected = setting * air.density / air.density_at(height);
        assert!(
            (relative - expected).abs() < expected * 0.05,
            "height {height}: {relative} against {expected}"
        );
    }
}
#[test]
fn drag_fades_out_with_height_and_ends_at_the_shell() {
    let air = air_of(EARTH).unwrap();
    let mut last = f64::MAX;
    for h in [0.0, 5e3, 2e4, 5e4, 8e4, 9.5e4] {
        let d = air.drag(h);
        assert!(d < last);
        last = d;
    }
    assert_eq!(air.drag(1e5), 0.0);
    assert_eq!(air.drag(4e5), 0.0);
    // Blend: grounded at the surface for every body, free far out.
    assert_eq!(free_blend(R, R, 3.986e14), 0.0);
    assert_eq!(free_blend(10.0 * R, R, 3.986e14), 1.0);
    let mid = free_blend(2.0 * R, R, 3.986e14);
    assert!((0.001..1.0).contains(&mid), "{mid}");
}
#[test]
fn with_assistance_off_a_low_orbit_keeps_its_energy() {
    let s = system();
    let gm = s.ephemeris.body(EARTH).unwrap().gm;
    let p = at_height(400_000.0);
    let r = length(p);
    let v = (gm / r).sqrt();
    let velocity = mul(tangent_of(p), v);
    let mut c = Craft::new(EARTH, p, velocity, velocity, normalized(p));
    let mut t = epoch();
    let energy = |c: &Craft| 0.5 * dot(c.velocity, c.velocity) - gm / length(c.position.metres());
    let e0 = energy(&c);
    // Over two orbits. A real-rate clock: no carry.
    let controls = Controls {
        assist: false,
        ..Controls::default()
    };
    let mut highest = 0.0_f64;
    let mut lowest = f64::MAX;
    let steps = (2.0 * 92.5 * 60.0 * 60.0) as usize;
    for _ in 0..steps {
        let (next, report) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
        assert_eq!(report.hand_overs, 0);
        let h = length(c.position.metres()) - R;
        highest = highest.max(h);
        lowest = lowest.min(h);
    }
    let drift = (energy(&c) - e0).abs() / e0.abs();
    assert!(drift < 1e-3, "energy drift {drift}");
    assert!(
        lowest > 380_000.0 && highest < 420_000.0,
        "{lowest} {highest}"
    );
}
#[test]
fn escape_speed_leaves_the_frame_with_its_velocity_unbroken() {
    let s = system();
    let gm = s.ephemeris.body(EARTH).unwrap().gm;
    let p = at_height(400_000.0);
    let r = length(p);
    // Well above escape, radial, so the test is short.
    let v = 6.0 * (2.0 * gm / r).sqrt();
    let mut c = Craft::new(
        EARTH,
        p,
        mul(normalized(p), v),
        normalized(p),
        tangent_of(p),
    );
    let mut t = epoch();
    let controls = Controls {
        assist: false,
        ..Controls::default()
    };
    let mut left = false;
    for _ in 0..20_000 {
        let frame = c.frame;
        let before = (c.position, c.velocity);
        let (next, report) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0);
        if report.hand_overs > 0 {
            assert_eq!(frame, EARTH);
            assert_eq!(c.frame, 10);
            // Compare in the new frame, at the new time, what the old state becomes.
            let (body, body_velocity) = s.ephemeris.relative_state(EARTH, 10, next);
            let carried = add(before.1, body_velocity);
            let dv = length(sub(c.velocity, carried));
            assert!(dv < 1.0, "velocity jump {dv} m/s");
            let expected = add(before.0.metres(), body);
            let moved = length(sub(c.position.metres(), expected));
            // One second's flight at this speed, and nothing more.
            assert!(moved < v * 1.1, "position jump {moved}");
            left = true;
            break;
        }
        t = next;
    }
    assert!(left, "never left Earth's frame");
}
#[test]
fn a_hand_over_keeps_position_and_apparent_velocity_at_any_rate() {
    let s = system();
    let t = epoch();
    for (body, rate) in [
        (EARTH, 1.0),
        (EARTH, 1e5),
        (499, 1e5),
        (899, 1.0),
        (899, 1e6),
        (999, 1e6),
    ] {
        let (place, velocity) = s.ephemeris.relative_state(body, 10, t);
        let i = s.ephemeris.index(body).unwrap();
        let edge = s.influence[i] * 0.999;
        let inside = [edge * 0.6, edge * 0.64, 0.48 * edge];
        // A craft in the Sun's frame, just inside the body's sphere: it should hand down.
        let world = add(place, inside);
        let apparent = add(mul(velocity, rate), [1000.0, -2000.0, 500.0]);
        let mut c = Craft::new(10, world, apparent, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
        let changes = hand_over(s, &mut c, t, rate);
        assert_eq!(changes, 1, "{body}");
        assert_eq!(c.frame, body);
        // Exact to the rounding of a heliocentric number, not to a sector.
        let position_error = length(sub(c.position.metres(), inside));
        let tolerance = length(world) * 1e-15 + 1e-3;
        assert!(
            position_error <= tolerance,
            "{body} {position_error} tolerance {tolerance}"
        );
        // What it sees relative to the body is unchanged by the frame it is reckoned in.
        let velocity_error = length(sub(c.velocity, [1000.0, -2000.0, 500.0]));
        let tolerance = length(apparent) * 1e-14;
        assert!(velocity_error <= tolerance, "{body} {velocity_error}");
    }
}
#[test]
fn nothing_near_a_body_depends_on_its_distance_or_the_clock_rate() {
    // At Neptune, at a high rate, two crafts a millimetre apart stay a millimetre apart: the eye
    // against the moving body has the precision of the bounded frame, not of a heliocentric number.
    let s = system();
    let p = mul(normalized([0.1, 0.9, 0.3]), 25_000_000.0);
    let a0 = Craft::new(899, p, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
    let b0 = Craft::new(
        899,
        add(p, [1e-3, 0.0, 0.0]),
        [0.0; 3],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    let (mut a, mut b) = (a0, b0);
    let mut t = epoch();
    let controls = Controls {
        assist: false,
        ..Controls::default()
    };
    for _ in 0..600 {
        let (next, _) = advance(s, &mut a, &controls, no_ground(), t, 1e7, 1.0 / 60.0);
        advance(s, &mut b, &controls, no_ground(), t, 1e7, 1.0 / 60.0);
        t = next;
    }
    assert_eq!(a.frame, 899);
    let gap = length(sub(b.position.metres(), a.position.metres()));
    // Neptune's gravity gradient over ten seconds of free fall is negligible at this separation.
    assert!((gap - 1e-3).abs() < 1e-4, "gap {gap}");
}
#[test]
fn reentry_slows_a_fast_arrival_and_the_ground_holds_it() {
    let s = system();
    let p = at_height(400_000.0);
    let down = mul(normalized(p), -1.0);
    // Falling steeply at 12 km/s, faster than a return from the Moon.
    let velocity = add(mul(down, 12_000.0), mul(tangent_of(p), 3_000.0));
    let mut c = Craft::new(EARTH, p, velocity, down, tangent_of(p));
    let mut t = epoch();
    // With thrust down: on the air alone, a craft falls the last kilometres at a few m/s.
    let controls = Controls {
        dive: true,
        thrust: [0.0, 0.0, 1.0],
        ..Controls::default()
    };
    let mut landed = false;
    let mut slowest_high = f64::MAX;
    for _ in 0..(60 * 900) {
        let (next, report) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
        if length(c.position.metres()) - R < 60_000.0 {
            slowest_high = slowest_high.min(length(c.velocity));
        }
        if report.touched {
            landed = true;
            let air_velocity = solar_core::celestial::cross(
                solar_core::celestial::spin(&s.ephemeris.body(EARTH).unwrap().rotation, t),
                c.position.metres(),
            );
            let speed = length(sub(c.velocity, air_velocity));
            assert!(speed < 600.0, "arrived at {speed} m/s");
            break;
        }
    }
    assert!(landed, "never reached the ground");
    // The air took most of 12 km/s off before the ground came.
    assert!(slowest_high < 2_000.0, "{slowest_high}");
    let h = length(c.position.metres()) - R;
    assert!((0.0..3.0).contains(&h), "{h}");
}
#[test]
fn landing_on_a_moving_body_under_a_time_rate_stays_on_its_ground() {
    let s = system();
    for (body, rate) in [(499, 1e4), (301, 1e5), (EARTH, 1e5)] {
        let radius = s.radius(body);
        // Start a good way out in the body's frame, at rest against it, descending.
        let p = mul(normalized([0.5, 0.3, 0.8]), radius * 1.5);
        let down = mul(normalized(p), -1.0);
        let mut c = Craft::new(body, p, mul(down, 500.0), down, tangent_of(p));
        let mut t = epoch();
        let controls = Controls {
            thrust: [0.0, 0.0, 1.0],
            setting: 200.0,
            ..Controls::default()
        };
        let ground = Ground { height: 1200.0 };
        let mut landed_at = None;
        for step in 0..(60 * 1200) {
            let (next, report) = advance(s, &mut c, &controls, ground, t, rate, 1.0 / 60.0);
            t = next;
            assert_eq!(c.frame, body, "left the frame");
            if report.landed {
                landed_at = Some((step, t));
                break;
            }
        }
        let (_, touched) = landed_at.expect("reached the ground");
        // Stay put with no input for ten seconds of flight, which is a long way for the body.
        let rest = Controls::default();
        let spot = |c: &Craft, t: SimTime| {
            let m =
                solar_core::celestial::orientation(&s.ephemeris.body(body).unwrap().rotation, t);
            solar_core::celestial::apply(&m, c.position.metres())
        };
        let mut t = touched;
        let first = spot(&c, t);
        for _ in 0..600 {
            let (next, _) = advance(s, &mut c, &rest, ground, t, rate, 1.0 / 60.0);
            t = next;
        }
        let moved = length(sub(spot(&c, t), first));
        let h = length(c.position.metres()) - radius - 1200.0;
        assert!(
            moved < 1.0,
            "{body} moved {moved} m on its own ground at rate {rate}"
        );
        assert!((0.0..3.0).contains(&h), "{body} {h}");
    }
}
#[test]
fn a_giant_has_no_ground_but_the_model_has_a_floor_and_the_air_closes_in() {
    let s = system();
    let direction = normalized([1.0, 0.2, 0.1]);
    let t0 = epoch();
    let radius = s.figure_radius(599, direction, t0);
    let p = mul(direction, radius + 500_000.0);
    let down = mul(normalized(p), -1.0);
    let mut c = Craft::new(599, p, mul(down, 20_000.0), down, tangent_of(p));
    let mut t = t0;
    let controls = Controls {
        thrust: [0.0, 0.0, 1.0],
        dive: true,
        setting: 500.0,
        ..Controls::default()
    };
    let mut deepest = f64::MAX;
    for _ in 0..(60 * 1800) {
        let (next, report) = advance(s, &mut c, &controls, Ground::default(), t, 1.0, 1.0 / 60.0);
        t = next;
        let here = c.position.metres();
        deepest = deepest.min(length(here) - s.figure_radius(599, here, t));
        if report.touched {
            break;
        }
    }
    assert!(
        (-150_100.0..-100_000.0).contains(&deepest),
        "deepest {deepest}"
    );
}

/// The trip the brief names, under the autopilot: leave Earth, stop above Mars, at two clock rates.
/// Every hand-over on the way goes through the same frame code, and the eye never jumps.
#[test]
fn a_trip_from_earth_to_mars_arrives_in_minutes_at_any_rate() {
    let s = system();
    for rate in [1.0, 1e4] {
        let p = at_height(2_000.0);
        let mut c = Craft::new(EARTH, p, [0.0; 3], tangent_of(p), normalized(p));
        let mut t = epoch();
        let controls = Controls {
            autopilot: Some((499, 1_000_000.0)),
            ..Controls::default()
        };
        let mut frames = vec![EARTH];
        let mut arrived = None;
        for step in 0..(60 * 60 * 20) {
            let (next, _) = advance(s, &mut c, &controls, no_ground(), t, rate, 1.0 / 60.0);
            t = next;
            if frames.last() != Some(&c.frame) {
                frames.push(c.frame);
            }
            if c.frame == 499 {
                let h = length(c.position.metres()) - s.radius(499);
                if h < 1_500_000.0 && length(c.velocity) < 500.0 {
                    arrived = Some(step as f64 / 60.0);
                    break;
                }
            }
        }
        println!("rate {rate}: frames {frames:?}, arrived after {arrived:?} s");
        assert_eq!(frames, vec![EARTH, 10, 499], "at rate {rate}");
        let seconds = arrived.expect("arrived");
        assert!(seconds < 900.0, "took {seconds} s at rate {rate}");
    }
}

#[test]
fn thrust_held_in_deep_space_stays_inside_the_system() {
    let s = system();
    let p = at_height(400_000.0);
    let up = normalized(p);
    let mut c = Craft::new(EARTH, p, [0.0; 3], up, tangent_of(p));
    let controls = Controls {
        thrust: [0.0, 0.0, 1.0],
        boost: true,
        ..Controls::default()
    };
    let mut t = epoch();
    let mut fastest = 0.0_f64;
    for _ in 0..(60 * 600) {
        let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
        fastest = fastest.max(length(c.velocity));
    }
    assert!(fastest <= 1.0001e11, "{fastest}");
    let far = length(c.position.metres());
    assert!(far.is_finite() && far < 1.01e14, "{far}");
}
#[test]
fn the_autopilot_with_no_stop_height_lands() {
    let s = system();
    for body in [499, 301] {
        let p = mul(normalized([0.5, 0.3, 0.8]), s.radius(body) + 300_000.0);
        let down = mul(normalized(p), -1.0);
        let mut c = Craft::new(body, p, [0.0; 3], down, tangent_of(p));
        let controls = Controls {
            autopilot: Some((body, 0.0)),
            ..Controls::default()
        };
        let mut t = epoch();
        let mut touched = false;
        let mut speed_at_touch = 0.0;
        for _ in 0..(60 * 600) {
            let (next, report) = advance(
                s,
                &mut c,
                &controls,
                Ground { height: 800.0 },
                t,
                1.0,
                1.0 / 60.0,
            );
            t = next;
            if report.touched {
                touched = true;
                speed_at_touch = report.relative_speed;
                break;
            }
        }
        assert!(touched, "{body} never reached the ground");
        // Against the frame's centre: a slow body's ground and a slow arrival. The air's turning is under this.
        assert!(speed_at_touch < 300.0, "{body} {speed_at_touch}");
    }
}

/// Flown, not placed: the owner flew straight through the rings and saw no rocks, because the craft crossed the whole field in
/// well under a second. A pilot holding thrust at the rings from far away must spend long enough among them to see them.
#[test]
fn a_pilot_flying_at_the_rings_is_slowed_among_them_and_still_gets_through() {
    use solar_core::celestial::orientation;
    let s = system();
    let t0 = epoch();
    let m = orientation(&s.ephemeris.body(699).unwrap().rotation, t0);
    let pole = m[1];
    let along = m[0];
    let at = add(mul(along, 105e6), mul(pole, 5_000_000.0));
    let mut c = Craft::new(699, at, [0.0; 3], mul(pole, -1.0), along);
    let controls = Controls {
        thrust: [0.0, 0.0, 1.0],
        setting: 100.0,
        ..Controls::default()
    };
    let mut t = t0;
    let (mut among, mut crossed, mut fastest_near) = (0.0_f64, false, 0.0_f64);
    for _ in 0..(60 * 600) {
        let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
        let over = dot(c.position.metres(), pole);
        if over.abs() < 49_000.0 {
            among += 1.0 / 60.0;
            fastest_near = fastest_near.max(length(c.velocity));
        }
        if over < -49_000.0 {
            crossed = true;
            break;
        }
    }
    println!("among the rocks for {among} s, at up to {fastest_near} m/s");
    assert!(among > 5.0, "only {among} s among the rocks");
    assert!(crossed, "never got through, {among} s among them");
}

const MARS: i32 = 499;
fn mars_radius() -> f64 {
    system().radius(MARS)
}
fn surface_speed(c: &Craft, id: i32, t: SimTime) -> f64 {
    let rotation = &system().ephemeris.body(id).unwrap().rotation;
    let turning = solar_core::celestial::cross(
        solar_core::celestial::spin(rotation, t),
        c.position.metres(),
    );
    length(sub(c.velocity, turning))
}
/// The owner: "when inside a planet (as in the planets repo) we should slow to a hovering stop". On every body, with or without air.
#[test]
fn inside_a_band_a_craft_with_no_input_slows_to_a_hover_on_any_body() {
    let s = system();
    for id in [EARTH, MARS, 301, 199] {
        let radius = s.radius(id);
        let p = mul(normalized([0.3, 0.8, 0.5]), radius + 200_000.0);
        let v = mul(tangent_of(p), 3_000.0);
        let mut c = Craft::new(id, p, v, v, normalized(p));
        let controls = Controls::default();
        let mut t = epoch();
        for _ in 0..(60 * 20) {
            let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
            t = next;
        }
        let speed = surface_speed(&c, id, t);
        let height = length(c.position.metres()) - radius;
        println!("body {id}: {speed} m/s at {height} m after 20 s");
        assert!(speed < 1.0, "body {id} still at {speed} m/s");
        assert!(
            (height - 200_000.0).abs() < 25_000.0,
            "body {id} went to {height} m"
        );
    }
}
/// The owner: "I keep flying around marbles". A near miss at speed, hands off, must end in a stop by the planet, not a curve round it.
#[test]
fn a_fast_near_miss_with_hands_off_is_caught_by_the_planet() {
    let s = system();
    let radius = mars_radius();
    let at = [-20e6, radius + 500_000.0, 0.0];
    for speed in [20_000.0, 200_000.0, 5_000_000.0] {
        let mut c = Craft::new(
            MARS,
            at,
            [speed, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        let controls = Controls::default();
        let mut t = epoch();
        // Long enough for the slowest to arrive, at 40,000 km, and to settle.
        for _ in 0..(60 * 4000) {
            let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
            t = next;
        }
        let r = length(c.position.metres());
        let left = surface_speed(&c, MARS, t);
        println!(
            "{speed} m/s in: {left} m/s, {} radii, frame {}",
            r / radius,
            c.frame
        );
        assert_eq!(c.frame, MARS, "{speed} m/s left the planet");
        assert!(
            r < 2.2 * radius,
            "{speed} m/s ended at {} radii",
            r / radius
        );
        assert!(left < 20.0, "{speed} m/s still at {left}");
    }
}
/// Aimed roughly at a planet from far off, holding thrust: the pilot reaches the ground, and stands on it after letting go.
#[test]
fn holding_thrust_at_a_planet_from_far_off_reaches_the_ground_and_lands() {
    let s = system();
    let radius = mars_radius();
    let at = [60e6, 0.0, 0.0];
    let aim = normalized([-60e6, radius * 0.6, 0.0]);
    let mut c = Craft::new(MARS, at, [0.0; 3], aim, [0.0, 0.0, 1.0]);
    let thrust = Controls {
        thrust: [0.0, 0.0, 1.0],
        ..Controls::default()
    };
    let mut t = epoch();
    let mut touched = None;
    for i in 0..(60 * 600) {
        let (next, report) = advance(s, &mut c, &thrust, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
        if report.touched {
            touched = Some(i as f64 / 60.0);
            break;
        }
    }
    let touched = touched.expect("never reached the ground");
    let arrived = surface_speed(&c, MARS, t);
    println!("touched after {touched} s at {arrived} m/s");
    assert!(touched < 300.0, "took {touched} s");
    let controls = Controls::default();
    for _ in 0..(60 * 10) {
        let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
    }
    assert!(surface_speed(&c, MARS, t) < 3.0, "still moving");
}
/// Leaving: thrust straight up from the ground gets out of the band in reasonable time, despite its drag.
#[test]
fn a_band_does_not_trap_a_craft_climbing_out() {
    let s = system();
    let p = at_height(100.0);
    let up = normalized(p);
    let mut c = Craft::new(EARTH, p, [0.0; 3], up, tangent_of(p));
    let controls = Controls {
        thrust: [0.0, 0.0, 1.0],
        ..Controls::default()
    };
    let edge = solar_core::flight::free_radius(R, s.ephemeris.body(EARTH).unwrap().gm);
    let mut t = epoch();
    let mut seconds = 0.0;
    while length(c.position.metres()) < edge && seconds < 300.0 {
        let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
        seconds += 1.0 / 60.0;
    }
    println!("out of the band in {seconds} s");
    assert!(seconds < 180.0, "{seconds} s to climb out");
}
/// Just past a band, a coasting orbit is still an orbit with assistance on: where the Go button puts a craft.
#[test]
fn an_orbit_past_the_band_keeps_its_energy_with_assistance_on() {
    let s = system();
    let gm = s.ephemeris.body(EARTH).unwrap().gm;
    let r = solar_core::flight::free_radius(R, gm) * 1.01;
    let p = mul(normalized([0.3, 0.8, 0.5]), r);
    let v = mul(tangent_of(p), (gm / r).sqrt());
    let mut c = Craft::new(EARTH, p, v, v, normalized(p));
    let energy = |c: &Craft| 0.5 * dot(c.velocity, c.velocity) - gm / length(c.position.metres());
    let e0 = energy(&c);
    let controls = Controls::default();
    let mut t = epoch();
    for _ in 0..(60 * 1200) {
        let (next, _) = advance(s, &mut c, &controls, no_ground(), t, 1.0, 1.0 / 60.0);
        t = next;
    }
    let drift = (energy(&c) - e0).abs() / e0.abs();
    assert!(drift < 1e-3, "energy drift {drift}");
}

/// The owner: "when the time speed is quick and I enter a planets influence I should be in sync with it". A craft sitting in space while a
/// fast clock sweeps a planet up to it must end up moving with the planet, not flung through it at the planet's apparent speed.
#[test]
fn entering_a_planets_frame_under_a_fast_clock_puts_the_craft_in_sync_with_it() {
    let s = system();
    let t0 = epoch();
    let rate = 3600.0;
    let (earth, earth_velocity) = s.ephemeris.relative_state(EARTH, 10, t0);
    let index = s.ephemeris.index(EARTH).unwrap();
    let ahead = mul(normalized(earth_velocity), s.influence[index] * 1.5);
    let mut c = Craft::new(
        10,
        add(earth, ahead),
        [0.0; 3],
        normalized(earth_velocity),
        [0.0, 0.0, 1.0],
    );
    let controls = Controls::default();
    let mut t = t0;
    let (mut entered, mut held) = (None, 0.0);
    for _ in 0..(60 * 60) {
        let (next, _) = advance(s, &mut c, &controls, no_ground(), t, rate, 1.0 / 60.0);
        t = next;
        if entered.is_none() && c.frame == EARTH {
            entered = Some(length(c.velocity));
        }
        if entered.is_some() {
            assert_eq!(c.frame, EARTH, "flung back out after {held} s");
            held += 1.0 / 60.0;
        }
    }
    let entered = entered.expect("the planet never arrived");
    println!("entered at {entered} m/s against it, held {held} s");
    // Its true speed round the Sun is 30 km/s; its speed at this clock, 107,000 km/s.
    assert!(entered < 40_000.0, "entered at {entered} m/s");
    assert!(held > 20.0);
}
/// The other way round: moving with a planet at a fast clock, leaving its frame and coming straight back must not pick up the clock's speed.
#[test]
fn coming_back_into_a_frame_just_left_keeps_the_speed_it_had() {
    let s = system();
    let t = epoch();
    let rate = 3600.0;
    let index = s.ephemeris.index(EARTH).unwrap();
    let edge = s.influence[index] * 1.03;
    let p = mul(normalized([0.3, 0.8, 0.5]), edge);
    let v = mul(normalized(p), 100.0);
    let mut c = Craft::new(EARTH, p, v, normalized(p), tangent_of(p));
    solar_core::flight::hand_over(s, &mut c, t, rate);
    assert_eq!(c.frame, 10);
    // Back inside, with the same velocity against the planet that it left with.
    let (earth, _) = s.ephemeris.relative_state(EARTH, 10, t);
    c.position = solar_core::celestial::Address::from_metres(add(
        earth,
        mul(normalized(p), s.influence[index] * 0.9),
    ));
    let controls = Controls::default();
    let (_, report) = advance(s, &mut c, &controls, no_ground(), t, rate, 1e-6);
    assert_eq!(report.hand_overs, 1);
    assert!(
        length(c.velocity) < 200.0,
        "came back at {} m/s",
        length(c.velocity)
    );
}

//! Named stellar destinations with deterministic, explicitly synthetic worlds.
//! Stellar distances are approximate; local circular orbits are a game model,
//! not an ephemeris or a claim about an exoplanet's unobserved surface.
use crate::stars::{Sourced, StarRecord};
use crate::{
    body::{BodyDescriptor, BodyKind, Ground, SurfaceKind, PROCEDURAL_EARTH},
    ephemeris::{Entry, Ephemeris, Motion, Rotation, Series, SUN},
};
pub const LIGHT_YEAR: f64 = 9.460_730_472_580_8e15;
/// `radius` follows the star's record in STAR_RECORDS (16 November 2026: Proxima 0.154 to 0.141, TRAPPIST-1 0.119 to
/// 0.1192, Tau Ceti 0.79 to 0.793 solar radii).
pub struct StarSystem {
    pub id: i32,
    pub name: &'static str,
    pub slug: &'static str,
    pub distance: f64,
    pub ra: f64,
    pub dec: f64,
    pub mass: f64,
    pub radius: f64,
    pub worlds: &'static [&'static str],
    pub inner_au: f64,
}
pub const SYSTEMS: &[StarSystem] = &[
    StarSystem {
        id: 10000,
        name: "Proxima Centauri",
        slug: "star-proxima",
        distance: 4.24,
        ra: 217.43,
        dec: -62.68,
        mass: 0.122,
        radius: 0.141,
        inner_au: 0.035,
        worlds: &["exo-proxima-i", "exo-proxima-ii", "exo-proxima-iii"],
    },
    StarSystem {
        id: 10100,
        name: "TRAPPIST-1",
        slug: "star-trappist",
        distance: 40.7,
        ra: 346.62,
        dec: -5.04,
        mass: 0.0898,
        radius: 0.1192,
        inner_au: 0.0115,
        worlds: &[
            "exo-trappist-b",
            "exo-trappist-c",
            "exo-trappist-d",
            "exo-trappist-e",
            "exo-trappist-f",
            "exo-trappist-g",
            "exo-trappist-h",
        ],
    },
    StarSystem {
        id: 10200,
        name: "Tau Ceti",
        slug: "star-tau-ceti",
        distance: 11.9,
        ra: 26.02,
        dec: -15.94,
        mass: 0.783,
        radius: 0.793,
        inner_au: 0.18,
        worlds: &["exo-tau-i", "exo-tau-ii", "exo-tau-iii", "exo-tau-iv"],
    },
    StarSystem {
        id: 10300,
        name: "Epsilon Eridani",
        slug: "star-eridani",
        distance: 10.5,
        ra: 53.23,
        dec: -9.46,
        mass: 0.82,
        radius: 0.74,
        inner_au: 0.24,
        worlds: &[
            "exo-eridani-i",
            "exo-eridani-ii",
            "exo-eridani-iii",
            "exo-eridani-iv",
        ],
    },
    StarSystem {
        id: 10400,
        name: "Kepler-186",
        slug: "star-kepler186",
        distance: 580.,
        ra: 298.0,
        dec: 43.95,
        mass: 0.544,
        radius: 0.523,
        inner_au: 0.04,
        worlds: &[
            "exo-kepler-b",
            "exo-kepler-c",
            "exo-kepler-d",
            "exo-kepler-e",
            "exo-kepler-f",
        ],
    },
];
/// What catalogues give for each of these stars (crates/solar-core/src/stars.rs reads it). Filled from cited sources only.
pub const STAR_RECORDS: &[crate::stars::StarRecord] = &[
    StarRecord {
        id: 10000,
        name: "Proxima Centauri",
        spectral: Some(("M5.5Ve", "Bessell 1991, AJ 101, 662 (via SIMBAD)")),
        teff: Some(Sourced {
            value: 2900.0,
            source: SUAREZ_2025,
        }),
        radius: Some(Sourced {
            value: 0.141,
            source: SUAREZ_2025,
        }),
        luminosity: Some(Sourced {
            value: 0.00151,
            source: SUAREZ_2025,
        }),
    },
    StarRecord {
        id: 10100,
        name: "TRAPPIST-1",
        // The source gives no luminosity class.
        spectral: Some(("M7.5e", "Gizis et al. 2000, AJ 120, 1085 (via SIMBAD)")),
        teff: Some(Sourced {
            value: 2566.0,
            source: AGOL_2021,
        }),
        radius: Some(Sourced {
            value: 0.1192,
            source: AGOL_2021,
        }),
        luminosity: Some(Sourced {
            value: 5.53e-4,
            source: AGOL_2021,
        }),
    },
    StarRecord {
        id: 10200,
        name: "Tau Ceti",
        spectral: Some(("G8V", KEENAN_1989)),
        teff: Some(Sourced {
            value: 5320.0,
            source: KOROLIK_2023,
        }),
        radius: Some(Sourced {
            value: 0.793,
            source: KOROLIK_2023,
        }),
        luminosity: Some(Sourced {
            value: 0.45,
            source: KOROLIK_2023,
        }),
    },
    StarRecord {
        id: 10300,
        name: "Epsilon Eridani",
        spectral: Some(("K2V", KEENAN_1989)),
        teff: Some(Sourced {
            value: 5039.0,
            source: BAINES_2012,
        }),
        radius: Some(Sourced {
            value: 0.74,
            source: BAINES_2012,
        }),
        // Not in that source: left unknown.
        luminosity: None,
    },
    StarRecord {
        id: 10400,
        name: "Kepler-186",
        spectral: Some(("M1V", "Muirhead et al. 2012, ApJ 750, L37 (via SIMBAD)")),
        teff: Some(Sourced {
            value: 3755.0,
            source: TORRES_2015,
        }),
        radius: Some(Sourced {
            value: 0.523,
            source: TORRES_2015,
        }),
        luminosity: Some(Sourced {
            value: 0.055,
            source: TORRES_2015,
        }),
    },
];
const SUAREZ_2025: &str =
    "Suárez Mascareño et al. 2025, A&A 700, A11 (NASA Exoplanet Archive, pscomppars)";
const AGOL_2021: &str = "Agol et al. 2021, PSJ 2, 1 (NASA Exoplanet Archive, pscomppars)";
const KOROLIK_2023: &str = "Korolik et al. 2023, AJ 166, 123";
const KEENAN_1989: &str = "Keenan & McNeil 1989, ApJS 71, 245 (via SIMBAD)";
const BAINES_2012: &str =
    "Baines & Armstrong 2012, ApJ 744, 138 (as quoted by MacGregor et al. 2015)";
const TORRES_2015: &str = "Torres et al. 2015, ApJ 800, 99 (NASA Exoplanet Archive, pscomppars)";
pub fn system_id(id: i32) -> i32 {
    if (10000..10500).contains(&id) {
        id / 100 * 100
    } else {
        SUN
    }
}
pub fn descriptor(id: i32) -> Option<BodyDescriptor> {
    let s = SYSTEMS.iter().find(|s| s.id == system_id(id))?;
    let n = id - s.id;
    if n == 0 {
        return Some(BodyDescriptor {
            name: s.slug,
            naif: id,
            kind: BodyKind::Star,
            radius: s.radius * 695_700_000.,
            earthlike: false,
            atmosphere: None,
            sea: None,
            clouds: None,
            ..PROCEDURAL_EARTH
        });
    }
    let name = *s.worlds.get((n - 1) as usize)?;
    let ground = match n % 4 {
        1 => Ground::Dust,
        2 => Ground::Regolith,
        3 => Ground::Earth,
        _ => Ground::Ice,
    };
    let lush = ground == Ground::Earth;
    Some(BodyDescriptor {
        name,
        naif: id,
        radius: (0.72 + f64::from((id * 37) % 95) / 100.) * 6_371_000.,
        surface: SurfaceKind::Procedural,
        earthlike: lush,
        ground,
        ambient: if lush { 1. } else { 0.12 },
        atmosphere: if lush {
            PROCEDURAL_EARTH.atmosphere
        } else {
            None
        },
        sea: if lush { PROCEDURAL_EARTH.sea } else { None },
        clouds: if lush { PROCEDURAL_EARTH.clouds } else { None },
        ..PROCEDURAL_EARTH
    })
}
pub fn named(name: &str) -> Option<BodyDescriptor> {
    for s in SYSTEMS {
        for n in 0..=s.worlds.len() {
            let d = descriptor(s.id + n as i32)?;
            if d.name == name {
                return Some(d);
            }
        }
    }
    None
}
pub fn append(ephemeris: &mut Ephemeris) {
    for s in SYSTEMS {
        let ra = s.ra.to_radians();
        let dec = s.dec.to_radians();
        let distance = s.distance * LIGHT_YEAR;
        let p = [
            ra.cos() * dec.cos() * distance,
            ra.sin() * dec.cos() * distance,
            dec.sin() * distance,
        ];
        let rotation = || Rotation {
            pole_ra: [0.; 3],
            pole_dec: [90., 0., 0.],
            prime: [0., 360., 0.],
            nutation: vec![],
        };
        ephemeris.bodies.push(Entry {
            id: s.id,
            parent: SUN,
            gm: s.mass * 1.327_124_400_18e20,
            radii: [s.radius * 695_700_000.; 3],
            rotation: rotation(),
            motion: Motion::Series(Box::new(std::array::from_fn(|i| Series {
                polynomial: [p[i], 0., 0.],
                terms: vec![],
            }))),
            fit_error: 0.,
        });
        for (i, _) in s.worlds.iter().enumerate() {
            let id = s.id + i as i32 + 1;
            let body = descriptor(id).unwrap();
            let radius = s.inner_au * 1.68_f64.powi(i as i32) * 1.495_978_707e11;
            let frequency = (s.mass * 1.327_124_400_18e20 / radius.powi(3)).sqrt() * 86400.;
            let phase = i as f64 * 2.399963;
            let (sn, cs) = phase.sin_cos();
            let axes = [
                Series {
                    polynomial: [0.; 3],
                    terms: vec![[frequency, radius * cs, -radius * sn]],
                },
                Series {
                    polynomial: [0.; 3],
                    terms: vec![[frequency, radius * sn, radius * cs]],
                },
                Series {
                    polynomial: [0.; 3],
                    terms: vec![],
                },
            ];
            ephemeris.bodies.push(Entry {
                id,
                parent: s.id,
                gm: 3.986_004_418e14 * (body.radius / 6_371_000.).powi(3),
                radii: [body.radius; 3],
                rotation: rotation(),
                motion: Motion::Series(Box::new(axes)),
                fit_error: 0.,
            });
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_world_has_a_stable_descriptor_and_local_orbit() {
        let s = crate::celestial::system();
        for star in SYSTEMS {
            for n in 1..=star.worlds.len() {
                let id = star.id + n as i32;
                let d = descriptor(id).unwrap();
                assert_eq!(named(d.name), Some(d));
                let (p, v) = s.ephemeris.relative_state(id, star.id, Default::default());
                assert!(crate::field::length(p) > d.radius * 4.);
                assert!(crate::field::length(v) > 100.);
                assert!(p.iter().all(|x| x.is_finite()));
            }
        }
    }
    #[test]
    fn interstellar_frames_keep_local_metre_precision() {
        let s = crate::celestial::system();
        for star in SYSTEMS {
            let (p, _) = s
                .ephemeris
                .relative_state(star.id + 1, star.id, Default::default());
            let a = crate::celestial::Address::from_metres(p).moved([0.001, 0., 0.]);
            assert!((a.minus(p)[0] - 0.001).abs() < 1e-6);
        }
    }
}

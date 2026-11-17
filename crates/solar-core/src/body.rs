//! What distinguishes one body from another: every renderer literal that is really
//! a property of a planet lives here. Values describe this renderer's model of the
//! body, not a claim of physical accuracy.
use crate::field::V3;

/// The scattering shell behind the sky, aerial perspective and optical depth table.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Atmosphere {
    /// Top of the shell above the reference radius, metres.
    pub shell_height: f64,
    pub rayleigh_scale_height: f64,
    pub mie_scale_height: f64,
    /// Height over which the sky colour fades toward space.
    pub sky_fade_height: f64,
    /// Rayleigh extinction per metre at the reference radius, red, green, blue.
    pub rayleigh_beta: [f64; 3],
    /// Colour of what the air scatters toward the eye. Earth's is the literal `aerial` had.
    pub scatter: [f64; 3],
    /// The sky's colour at the horizon and at the zenith, in `sky`.
    pub sky_low: [f64; 3],
    pub sky_high: [f64; 3],
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sea {
    /// Default global water level above the reference radius. The level is a setting.
    pub default_level: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CloudShell {
    /// Top of the cloud ray and shadow shell above the reference radius, metres.
    pub top: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rotation {
    /// Body-frame spin axis. +Y is north on every body.
    pub axis: V3,
    pub sidereal_period_seconds: f64,
}
/// Where the canonical surface comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceKind {
    /// The analytic spectrum of `skin::Skin`, answered at any level at once.
    Procedural,
    /// Measured pages from public sources (docs/M1-LIVE-EARTH.md).
    Measured,
}
/// The kinds of ground the material knows, as the shader numbers them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ground {
    /// The Earth classes: vegetation, snow, rock, sediment, by image colour.
    Earth = 0,
    /// Fine grey regolith, boulders and small craters.
    Regolith = 1,
    /// Dust, rock showing on steep ground, few craters.
    Dust = 2,
    /// Ice with fracture sets across all of it.
    Ice = 3,
}
/// What the renderer can do with a body at close range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyKind {
    /// A radial surface of pages: the single skin.
    Solid,
    /// No surface: a shell of air over a map, drawn by the space pass at every distance.
    Giant,
    /// The Sun.
    Star,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyDescriptor {
    pub name: &'static str,
    /// NAIF code, the key into the solar table. Zero for a body outside it.
    pub naif: i32,
    pub kind: BodyKind,
    /// Light from the sky on the ground, against Earth's. With no air, a small amount for what the lit ground around a
    /// shadow scatters into it, chosen by eye: pure black reads as a hole, and the real figure varies with the view.
    pub ambient: f64,
    /// Scenery, the Earth classes of ground and the sea's programs. Off elsewhere: no forests on the Moon.
    pub earthlike: bool,
    /// Which ground the material draws where the data stops: the owner's decision, 31 October 2026, that every
    /// body has refinement. Synthesized, labelled on screen and in the manifest, and off with the ground detail switch.
    pub ground: Ground,
    /// No height data was found for this body: its surface is flat in the data, and refinement alone gives it relief.
    pub no_heights: bool,
    /// Reference sphere radius, metres.
    pub radius: f64,
    /// Largest |height| the body has, a physical fact used for shadow early-outs.
    /// Zero on a procedural body, whose bound comes from its spectrum.
    pub relief_limit: f64,
    pub atmosphere: Option<Atmosphere>,
    pub sea: Option<Sea>,
    pub clouds: Option<CloudShell>,
    pub rotation: Rotation,
    pub surface: SurfaceKind,
}
/// The procedural Earth-sized planet: the regression baseline of the renderer.
pub const PROCEDURAL_EARTH: BodyDescriptor = BodyDescriptor {
    name: "procedural",
    naif: 0,
    kind: BodyKind::Solid,
    ambient: 1.0,
    earthlike: true,
    ground: Ground::Earth,
    no_heights: false,
    radius: 6_371_000.0,
    relief_limit: 0.0,
    atmosphere: Some(Atmosphere {
        shell_height: 100_000.0,
        rayleigh_scale_height: 8_000.0,
        mie_scale_height: 1_500.0,
        sky_fade_height: 55_000.0,
        rayleigh_beta: [0.0000058, 0.0000135, 0.000028],
        scatter: [0.38, 0.55, 0.85],
        sky_low: [0.32, 0.46, 0.61],
        sky_high: [0.045, 0.17, 0.39],
    }),
    sea: Some(Sea { default_level: 0.0 }),
    clouds: Some(CloudShell { top: 12_500.0 }),
    rotation: Rotation {
        axis: [0.0, 1.0, 0.0],
        sidereal_period_seconds: 86_164.090_5,
    },
    surface: SurfaceKind::Procedural,
};
/// The real Earth on the same sphere, atmosphere and cloud model. Challenger Deep is about
/// 10.9 km down and Everest about 8.8 km up; synthesized detail adds metres, not kilometres.
pub const REAL_EARTH: BodyDescriptor = BodyDescriptor {
    name: "earth",
    naif: 399,
    relief_limit: 11_100.0,
    surface: SurfaceKind::Measured,
    ..PROCEDURAL_EARTH
};
const fn airless(name: &'static str, naif: i32, radius: f64, relief_limit: f64) -> BodyDescriptor {
    BodyDescriptor {
        name,
        naif,
        kind: BodyKind::Solid,
        ambient: 0.05,
        earthlike: false,
        ground: Ground::Regolith,
        no_heights: true,
        radius,
        relief_limit,
        atmosphere: None,
        sea: None,
        clouds: None,
        rotation: PROCEDURAL_EARTH.rotation,
        surface: SurfaceKind::Measured,
    }
}
const fn with_heights(body: BodyDescriptor) -> BodyDescriptor {
    BodyDescriptor {
        no_heights: false,
        ..body
    }
}
const fn iced(body: BodyDescriptor) -> BodyDescriptor {
    BodyDescriptor {
        ground: Ground::Ice,
        ..body
    }
}
const fn giant(name: &'static str, naif: i32, radius: f64, air: Atmosphere) -> BodyDescriptor {
    BodyDescriptor {
        name,
        naif,
        kind: BodyKind::Giant,
        ambient: 1.0,
        earthlike: false,
        ground: Ground::Earth,
        no_heights: true,
        radius,
        relief_limit: 0.0,
        atmosphere: Some(air),
        sea: None,
        clouds: None,
        rotation: PROCEDURAL_EARTH.rotation,
        surface: SurfaceKind::Measured,
    }
}
const fn air(
    shell_height: f64,
    scale_height: f64,
    rayleigh_beta: [f64; 3],
    scatter: [f64; 3],
    sky_low: [f64; 3],
    sky_high: [f64; 3],
) -> Atmosphere {
    Atmosphere {
        shell_height,
        rayleigh_scale_height: scale_height,
        mie_scale_height: scale_height * 0.2,
        sky_fade_height: shell_height * 0.55,
        rayleigh_beta,
        scatter,
        sky_low,
        sky_high,
    }
}
/// The solar system. Radii are the means of the PCK's triaxial figures, and relief limits are
/// generous physical facts: the shadow early-outs read them. Air here is a first appearance model
/// with scale heights from the fact sheets, for the owner's eye and not yet checked against images
/// of each body (docs/SOLAR-SYSTEM.md, "Atmospheres"). Venus and Titan do not fit one exponential.
pub const BODIES: [BodyDescriptor; 31] = [
    BodyDescriptor {
        name: "sun",
        naif: 10,
        kind: BodyKind::Star,
        ambient: 1.0,
        earthlike: false,
        ground: Ground::Earth,
        no_heights: true,
        radius: 695_700_000.0,
        relief_limit: 0.0,
        atmosphere: None,
        sea: None,
        clouds: None,
        rotation: PROCEDURAL_EARTH.rotation,
        surface: SurfaceKind::Measured,
    },
    with_heights(airless("mercury", 199, 2_439_400.0, 11_000.0)),
    BodyDescriptor {
        atmosphere: Some(air(
            250_000.0,
            15_900.0,
            [0.0025, 0.0032, 0.0042],
            [0.85, 0.64, 0.34],
            [0.55, 0.40, 0.20],
            [0.62, 0.50, 0.30],
        )),
        ambient: 0.5,
        ground: Ground::Dust,
        no_heights: false,
        ..airless("venus", 299, 6_051_800.0, 13_000.0)
    },
    REAL_EARTH,
    with_heights(airless("moon", 301, 1_737_400.0, 11_000.0)),
    BodyDescriptor {
        atmosphere: Some(air(
            125_000.0,
            11_100.0,
            [0.000012, 0.000017, 0.000024],
            [0.66, 0.44, 0.27],
            [0.62, 0.47, 0.33],
            [0.38, 0.27, 0.20],
        )),
        ambient: 0.6,
        ground: Ground::Dust,
        no_heights: false,
        ..airless("mars", 499, 3_389_500.0, 30_000.0)
    },
    airless("phobos", 401, 11_080.0, 6_000.0),
    airless("deimos", 402, 6_200.0, 3_000.0),
    giant(
        "jupiter",
        599,
        69_911_000.0,
        air(
            450_000.0,
            27_000.0,
            [0.00001, 0.000014, 0.00002],
            [0.8, 0.72, 0.6],
            [0.6, 0.55, 0.47],
            [0.1, 0.1, 0.13],
        ),
    ),
    airless("io", 501, 1_821_490.0, 18_000.0),
    iced(airless("europa", 502, 1_560_800.0, 6_000.0)),
    airless("ganymede", 503, 2_631_200.0, 8_000.0),
    airless("callisto", 504, 2_410_300.0, 8_000.0),
    giant(
        "saturn",
        699,
        58_232_000.0,
        air(
            900_000.0,
            59_500.0,
            [0.000006, 0.000008, 0.000011],
            [0.85, 0.78, 0.6],
            [0.7, 0.63, 0.47],
            [0.12, 0.11, 0.12],
        ),
    ),
    iced(airless("mimas", 601, 198_200.0, 12_000.0)),
    iced(airless("enceladus", 602, 252_100.0, 8_000.0)),
    iced(airless("tethys", 603, 531_000.0, 12_000.0)),
    iced(airless("dione", 604, 561_400.0, 10_000.0)),
    iced(airless("rhea", 605, 763_500.0, 12_000.0)),
    BodyDescriptor {
        atmosphere: Some(air(
            600_000.0,
            40_000.0,
            [0.00004, 0.00009, 0.00019],
            [0.85, 0.55, 0.2],
            [0.72, 0.5, 0.22],
            [0.42, 0.3, 0.2],
        )),
        ambient: 0.5,
        ground: Ground::Dust,
        ..airless("titan", 606, 2_574_730.0, 3_000.0)
    },
    airless("iapetus", 608, 734_300.0, 25_000.0),
    giant(
        "uranus",
        799,
        25_362_000.0,
        air(
            400_000.0,
            27_700.0,
            [0.000009, 0.000006, 0.000005],
            [0.55, 0.8, 0.85],
            [0.5, 0.72, 0.76],
            [0.08, 0.14, 0.17],
        ),
    ),
    iced(airless("ariel", 701, 578_900.0, 10_000.0)),
    airless("umbriel", 702, 584_700.0, 10_000.0),
    iced(airless("titania", 703, 788_900.0, 10_000.0)),
    airless("oberon", 704, 761_400.0, 10_000.0),
    iced(airless("miranda", 705, 235_800.0, 20_000.0)),
    giant(
        "neptune",
        899,
        24_622_000.0,
        air(
            300_000.0,
            19_700.0,
            [0.00001, 0.000006, 0.000004],
            [0.35, 0.55, 0.95],
            [0.3, 0.5, 0.85],
            [0.05, 0.08, 0.2],
        ),
    ),
    iced(airless("triton", 801, 1_352_600.0, 4_000.0)),
    BodyDescriptor {
        atmosphere: Some(air(
            400_000.0,
            50_000.0,
            [0.00000012, 0.00000024, 0.00000048],
            [0.4, 0.55, 0.9],
            [0.2, 0.28, 0.42],
            [0.05, 0.08, 0.13],
        )),
        ambient: 0.05,
        ground: Ground::Ice,
        no_heights: false,
        ..airless("pluto", 999, 1_188_300.0, 6_500.0)
    },
    iced(with_heights(airless("charon", 901, 606_000.0, 8_000.0))),
];
impl BodyDescriptor {
    pub fn named(name: &str) -> Option<BodyDescriptor> {
        match name {
            "procedural" => Some(PROCEDURAL_EARTH),
            _ => BODIES
                .iter()
                .find(|b| b.name == name)
                .copied()
                .or_else(|| crate::galaxy::named(name)),
        }
    }
    pub fn of_naif(naif: i32) -> Option<BodyDescriptor> {
        BODIES
            .iter()
            .find(|b| b.naif == naif)
            .copied()
            .or_else(|| crate::galaxy::descriptor(naif))
    }
    /// Frame words for the shader; a body without a shell keeps the shape of the
    /// uniform, and the matching pass stays off through its own setting.
    pub fn atmosphere_words(&self) -> ([f32; 4], [f32; 4]) {
        let a = self
            .atmosphere
            .or(PROCEDURAL_EARTH.atmosphere)
            .expect("the baseline body has an atmosphere");
        (
            [
                a.shell_height as f32,
                a.rayleigh_scale_height as f32,
                a.mie_scale_height as f32,
                a.sky_fade_height as f32,
            ],
            [
                a.rayleigh_beta[0] as f32,
                a.rayleigh_beta[1] as f32,
                a.rayleigh_beta[2] as f32,
                0.0,
            ],
        )
    }
    /// The colours of the air: scatter, horizon, zenith. The same baseline rule as `atmosphere_words`.
    pub fn air_colour_words(&self) -> [[f32; 4]; 3] {
        let a = self
            .atmosphere
            .or(PROCEDURAL_EARTH.atmosphere)
            .expect("the baseline body has an atmosphere");
        [a.scatter, a.sky_low, a.sky_high].map(|c| [c[0] as f32, c[1] as f32, c[2] as f32, 0.0])
    }
    pub fn cloud_words(&self) -> [f32; 4] {
        let top = self
            .clouds
            .or(PROCEDURAL_EARTH.clouds)
            .map_or(0.0, |c| c.top);
        [top as f32, 0.0, 0.0, 0.0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frame_words_match_the_replaced_literals() {
        let (shell, beta) = PROCEDURAL_EARTH.atmosphere_words();
        assert_eq!(shell, [100000.0, 8000.0, 1500.0, 55000.0]);
        assert_eq!(beta[0].to_bits(), 0.0000058f32.to_bits());
        assert_eq!(beta[1].to_bits(), 0.0000135f32.to_bits());
        assert_eq!(beta[2].to_bits(), 0.000028f32.to_bits());
        assert_eq!(PROCEDURAL_EARTH.cloud_words()[0], 12500.0);
        let [scatter, low, high] = PROCEDURAL_EARTH.air_colour_words();
        assert_eq!(scatter[..3], [0.38f32, 0.55, 0.85]);
        assert_eq!(low[..3], [0.32f32, 0.46, 0.61]);
        assert_eq!(high[..3], [0.045f32, 0.17, 0.39]);
    }
    #[test]
    fn every_body_can_be_named_and_found_by_its_code() {
        for b in BODIES {
            assert_eq!(BodyDescriptor::named(b.name).unwrap().naif, b.naif);
            assert_eq!(BodyDescriptor::of_naif(b.naif).unwrap().name, b.name);
        }
        assert_eq!(BodyDescriptor::named("earth").unwrap().naif, 399);
        assert_eq!(BodyDescriptor::named("procedural").unwrap().naif, 0);
    }
}

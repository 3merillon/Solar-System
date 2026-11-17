//! Stars as light: what a catalogue says about each star, and what the renderer derives from it, by stated rules.
//!
//! A record holds only what a cited source gives; a field it does not give stays `None`, never filled silently. The
//! renderer's numbers come from `photosphere`, which says where its temperature came from (`TeffOrigin`).
//!
//! Colour: Planck's law integrated against the CIE 1931 2° colour-matching functions, in the multi-lobe Gaussian fit of
//! Wyman, Sloan and Shirley (2013, JCGT 2(2), 1-11), then the XYZ to linear sRGB (IEC 61966-2-1, Rec. 709 primaries,
//! D65 white) matrix: the display's primaries. The tests hold the fit to the Planckian locus at 2856 K (CIE illuminant A)
//! and 6500 K.
//!
//! Limb darkening: the Eddington-Barbier approximation on a grey atmosphere in radiative equilibrium (Eddington
//! approximation, T^4(tau) = 3/4 Teff^4 (tau + 2/3)): the intensity leaving at mu is the Planck function at the
//! temperature where tau = mu (e.g. Gray, The Observation and Analysis of Stellar Photospheres, 3rd ed., ch. 9; Rutten,
//! Radiative Transfer in Stellar Atmospheres, 2003, ch. 2). It is a model, not a measured profile: it darkens the visible
//! limb more than the Sun's measured profile does (numbers in docs/SOLAR-SYSTEM.md, "The star model"). Integrated over
//! each display channel and fitted with the quadratic law I(mu)/I(1) = 1 - a (1 - mu) - b (1 - mu)^2, it gives the shader
//! six coefficients per star.
use crate::ephemeris::SUN;

/// A catalogue value and where it comes from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sourced {
    pub value: f64,
    pub source: &'static str,
}
/// One star. Radius and luminosity in nominal solar units (IAU 2015 B3); temperature in kelvin.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StarRecord {
    pub id: i32,
    pub name: &'static str,
    /// Spectral class and luminosity class, e.g. "G2V", and its source.
    pub spectral: Option<(&'static str, &'static str)>,
    pub teff: Option<Sourced>,
    pub radius: Option<Sourced>,
    pub luminosity: Option<Sourced>,
}
const IAU_B3: &str = "IAU 2015 Resolution B3 (nominal solar values)";
/// Every star the app can visit. New stars plug in here; nothing star-specific is in the shader.
pub const RECORDS: &[StarRecord] = &[StarRecord {
    id: SUN,
    name: "Sun",
    spectral: Some((
        "G2V",
        "Morgan & Keenan 1973, ARA&A 11, 29 (the G2V standard)",
    )),
    teff: Some(Sourced {
        value: 5772.0,
        source: IAU_B3,
    }),
    radius: Some(Sourced {
        value: 1.0,
        source: IAU_B3,
    }),
    luminosity: Some(Sourced {
        value: 1.0,
        source: IAU_B3,
    }),
}];
pub fn record(id: i32) -> Option<&'static StarRecord> {
    RECORDS
        .iter()
        .chain(crate::galaxy::STAR_RECORDS.iter())
        .find(|r| r.id == id)
}
pub const SUN_TEFF: f64 = 5772.0;

/// Mean dwarf temperature by spectral class, for a star with a class and no catalogue temperature: E. Mamajek, "A Modern
/// Mean Dwarf Stellar Color and Effective Temperature Sequence", version 2022.04.16
/// (https://www.pas.rochester.edu/~emamajek/EEM_dwarf_UBVIJHK_colors_Teff.txt; the sequence of Pecaut & Mamajek 2013,
/// ApJS 208, 9). Subclasses between two rows are interpolated linearly. Giants and supergiants are cooler than
/// dwarfs of the same class; a class without its luminosity class is read as a dwarf, and the record says so.
pub const DWARF_SEQUENCE: &[(&str, f64)] = &[
    ("O5", 41400.0),
    ("O9", 33300.0),
    ("B0", 31400.0),
    ("B2", 20600.0),
    ("B5", 15700.0),
    ("B8", 12300.0),
    ("A0", 9700.0),
    ("A2", 8800.0),
    ("A5", 8100.0),
    ("A8", 7590.0),
    ("F0", 7220.0),
    ("F2", 6820.0),
    ("F5", 6550.0),
    ("F8", 6180.0),
    ("G0", 5930.0),
    ("G2", 5770.0),
    ("G5", 5660.0),
    ("G8", 5480.0),
    ("K0", 5270.0),
    ("K2", 5100.0),
    ("K5", 4440.0),
    ("K7", 4100.0),
    ("M0", 3850.0),
    ("M2", 3560.0),
    ("M4", 3210.0),
    ("M5", 3060.0),
    ("M6", 2810.0),
    ("M8", 2570.0),
    ("M9", 2380.0),
];
/// The class letter and subclass as one number: O0 = 0, B0 = 10, ... M9 = 69.
fn class_number(class: &str) -> Option<f64> {
    let mut chars = class.chars();
    let letter = "OBAFGKM".find(chars.next()?)? as f64;
    let rest: String = chars
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let sub = if rest.is_empty() {
        0.0
    } else {
        rest.parse().ok()?
    };
    Some(letter * 10.0 + sub)
}
pub fn teff_from_class(class: &str) -> Option<f64> {
    let n = class_number(class)?;
    let rows: Vec<(f64, f64)> = DWARF_SEQUENCE
        .iter()
        .filter_map(|(c, t)| Some((class_number(c)?, *t)))
        .collect();
    if n <= rows[0].0 {
        return Some(rows[0].1);
    }
    for w in rows.windows(2) {
        if n <= w[1].0 {
            let f = (n - w[0].0) / (w[1].0 - w[0].0);
            return Some(w[0].1 + f * (w[1].1 - w[0].1));
        }
    }
    Some(rows.last()?.1)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TeffOrigin {
    Catalogue,
    /// From the spectral class by the dwarf sequence.
    SpectralClass,
    /// No temperature and no class: the Sun's, stated as a fallback.
    Fallback,
}
pub fn teff_of(r: &StarRecord) -> (f64, TeffOrigin) {
    if let Some(t) = r.teff {
        return (t.value, TeffOrigin::Catalogue);
    }
    if let Some(t) = r.spectral.and_then(|(c, _)| teff_from_class(c)) {
        return (t, TeffOrigin::SpectralClass);
    }
    (SUN_TEFF, TeffOrigin::Fallback)
}

// Colour science.
const H: f64 = 6.626_070_15e-34;
const KB: f64 = 1.380_649e-23;
const CL: f64 = 299_792_458.0;
/// Spectral radiance B_lambda(T), W sr^-1 m^-3, wavelength in nanometres.
pub fn planck(nm: f64, t: f64) -> f64 {
    let l = nm * 1e-9;
    2.0 * H * CL * CL / l.powi(5) / ((H * CL / (l * KB * t)).exp_m1())
}
fn lobe(x: f64, mu: f64, s1: f64, s2: f64) -> f64 {
    let s = if x < mu { s1 } else { s2 };
    (-0.5 * ((x - mu) / s).powi(2)).exp()
}
/// CIE 1931 2° colour-matching functions, Wyman, Sloan and Shirley (2013), multi-lobe fit.
pub fn cmf(nm: f64) -> [f64; 3] {
    [
        1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7)
            - 0.065 * lobe(nm, 501.1, 20.4, 26.2),
        0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
        1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
    ]
}
/// CIE XYZ of a blackbody, 360-830 nm in 1 nm steps, arbitrary but consistent units.
pub fn blackbody_xyz(t: f64) -> [f64; 3] {
    let mut xyz = [0.0; 3];
    for nm in 360..=830 {
        let b = planck(f64::from(nm), t);
        let c = cmf(f64::from(nm));
        for i in 0..3 {
            xyz[i] += b * c[i];
        }
    }
    xyz
}
pub fn chromaticity(xyz: [f64; 3]) -> [f64; 2] {
    let s = xyz[0] + xyz[1] + xyz[2];
    [xyz[0] / s, xyz[1] / s]
}
/// XYZ to linear sRGB (IEC 61966-2-1). Out of gamut stays negative here; callers clamp.
pub fn linear_srgb(xyz: [f64; 3]) -> [f64; 3] {
    let [x, y, z] = xyz;
    [
        3.2406 * x - 1.5372 * y - 0.4986 * z,
        -0.9689 * x + 1.8758 * y + 0.0415 * z,
        0.0557 * x - 0.2040 * y + 1.0570 * z,
    ]
}
/// Temperature where the grey atmosphere's optical depth is tau (Eddington approximation).
pub fn grey_temperature(teff: f64, tau: f64) -> f64 {
    teff * (0.75 * (tau + 2.0 / 3.0)).powf(0.25)
}
/// Linear sRGB radiance leaving the photosphere at mu (cosine from the normal), Eddington-Barbier: B at T(tau = mu).
pub fn surface_rgb(teff: f64, mu: f64) -> [f64; 3] {
    linear_srgb(blackbody_xyz(grey_temperature(teff, mu.max(0.0))))
}
/// The renderer's luminance of the Sun's disk centre, in its HDR units: the value of the former plain disk (18, 15, 10).
pub const SUN_CENTRE_LUMINANCE: f64 = 15.28;
/// A granule's diameter on the Sun, km: "granulation (1 Mm)" and "supergranulation (30 Mm)" (Rincon and Rieutord 2018,
/// Living Rev. Sol. Phys. 15, 6; arXiv:1005.5376).
pub const SUN_GRANULE_KM: f64 = 1000.0;
/// Supergranules against granules, by the same source.
pub const SUPERGRANULE_RATIO: f64 = 30.0;
/// What the renderer needs of one star.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Photosphere {
    pub teff: f64,
    pub origin: TeffOrigin,
    /// Linear sRGB radiance at the disk centre, HDR units: the Sun's centre keeps the former luminance.
    pub centre: [f64; 3],
    /// Quadratic limb darkening per channel: I(mu)/I(1) = 1 - linear (1 - mu) - quadratic (1 - mu)^2.
    pub linear: [f64; 3],
    pub quadratic: [f64; 3],
    /// The colour of its light on a planet, against the Sun's (1, 1, 1 for the Sun), at equal luminance.
    pub tint: [f64; 3],
    /// A granule's diameter as a fraction of the star's radius.
    pub granule: f64,
    /// Synthetic activity: 1 for the Sun; M dwarfs more spotted.
    pub activity: f64,
}
fn luminance(rgb: [f64; 3]) -> f64 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}
fn quadratic_fit(samples: &[(f64, f64)]) -> (f64, f64) {
    // Least squares of 1 - y against a x + b x^2, x = 1 - mu.
    let (mut sxx, mut sxx2, mut sx2x2, mut sxy, mut sx2y) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for &(mu, ratio) in samples {
        let x = 1.0 - mu;
        let y = 1.0 - ratio;
        sxx += x * x;
        sxx2 += x * x * x;
        sx2x2 += x * x * x * x;
        sxy += x * y;
        sx2y += x * x * y;
    }
    let det = sxx * sx2x2 - sxx2 * sxx2;
    (
        (sxy * sx2x2 - sx2y * sxx2) / det,
        (sx2y * sxx - sxy * sxx2) / det,
    )
}
pub const MU_SAMPLES: usize = 24;
/// The Sun's measured centre-to-limb variation: Neckel and Labs (1994, Solar Physics 153, 91), table I, I(mu)/I(1) =
/// sum A_k mu^k, at the rows nearest each display channel: 640.97 nm (red), the mean of 541.76 and 559.95 nm (green),
/// 457.345 nm (blue). Their fit leaves out mu < ~0.12, so the extreme limb is an extrapolation.
pub const NECKEL_LABS: [[f64; 6]; 4] = [
    [0.33644, 1.30590, -1.79238, 2.45040, -1.89979, 0.59943],
    [0.26073, 1.27428, -1.30352, 1.47085, -0.96618, 0.26384],
    [0.26892, 1.34319, -1.58427, 1.91271, -1.31350, 0.37295],
    [0.16604, 1.38544, -1.52275, 2.00232, -1.45969, 0.42864],
];
pub fn neckel_labs(mu: f64) -> [f64; 3] {
    let p = |a: &[f64; 6]| {
        a.iter()
            .enumerate()
            .map(|(k, c)| c * mu.powi(k as i32))
            .sum::<f64>()
    };
    [
        p(&NECKEL_LABS[0]),
        0.5 * (p(&NECKEL_LABS[1]) + p(&NECKEL_LABS[2])),
        p(&NECKEL_LABS[3]),
    ]
}
/// Limb ratio of the model at mu, per channel.
pub fn limb_ratio(teff: f64, mu: f64) -> [f64; 3] {
    let c = surface_rgb(teff, 1.0);
    let m = surface_rgb(teff, mu);
    [m[0] / c[0], m[1] / c[1], m[2] / c[2]]
}
/// The Sun with its measured limb (Neckel and Labs); any other star with the grey-atmosphere model.
pub fn photosphere_for(
    teff: f64,
    origin: TeffOrigin,
    radius_solar: f64,
    mass_solar: f64,
) -> Photosphere {
    photosphere_with(teff, origin, radius_solar, mass_solar, false)
}
pub fn photosphere_with(
    teff: f64,
    origin: TeffOrigin,
    radius_solar: f64,
    mass_solar: f64,
    measured_sun: bool,
) -> Photosphere {
    let sun_centre = luminance(surface_rgb(SUN_TEFF, 1.0));
    let raw = surface_rgb(teff, 1.0);
    let scale = SUN_CENTRE_LUMINANCE / sun_centre;
    let centre = raw.map(|c| (c * scale).max(0.0));
    let mut linear = [0.0; 3];
    let mut quadratic = [0.0; 3];
    for ch in 0..3 {
        let samples: Vec<(f64, f64)> = (0..MU_SAMPLES)
            .map(|i| {
                let mu = 0.02 + 0.98 * i as f64 / (MU_SAMPLES - 1) as f64;
                if measured_sun {
                    let mu = 0.12 + 0.88 * i as f64 / (MU_SAMPLES - 1) as f64;
                    (mu, neckel_labs(mu)[ch])
                } else {
                    (mu, limb_ratio(teff, mu)[ch])
                }
            })
            .collect();
        let (a, b) = quadratic_fit(&samples);
        linear[ch] = a;
        quadratic[ch] = b;
    }
    let colour = |t: f64| {
        let rgb = linear_srgb(blackbody_xyz(t)).map(|c| c.max(0.0));
        let y = luminance(rgb);
        rgb.map(|c| c / y)
    };
    let (own, sun) = (colour(teff), colour(SUN_TEFF));
    let tint = [own[0] / sun[0], own[1] / sun[1], own[2] / sun[2]];
    // Granules scale with the pressure scale height, H ~ T / g (Trampedach et al. 2013, ApJ 769, 18; Magic et al. 2013):
    // as a fraction of the radius, H / R ~ T R / M.
    let granule =
        SUN_GRANULE_KM / 695_700.0 * (teff / SUN_TEFF) * radius_solar / mass_solar.max(0.01);
    let activity = if teff < 3900.0 {
        3.0
    } else if teff < 5300.0 {
        1.5
    } else {
        1.0
    };
    Photosphere {
        teff,
        origin,
        centre,
        linear,
        quadratic,
        tint,
        granule,
        activity,
    }
}
/// The renderer's star for a NAIF id: its record, or the Sun's temperature as a stated fallback.
pub fn photosphere(id: i32) -> Photosphere {
    let r = record(id);
    let (teff, origin) = r.map_or((SUN_TEFF, TeffOrigin::Fallback), teff_of);
    let radius = r.and_then(|r| r.radius).map_or(1.0, |v| v.value);
    let mass = crate::galaxy::SYSTEMS
        .iter()
        .find(|s| s.id == id)
        .map_or(1.0, |s| s.mass);
    photosphere_with(teff, origin, radius, mass, id == SUN)
}

#[cfg(test)]
#[allow(clippy::needless_range_loop)]
mod tests {
    use super::*;
    #[test]
    fn the_colour_matching_fit_lands_on_the_planckian_locus() {
        // CIE illuminant A is a 2856 K blackbody: x = 0.44757, y = 0.40745 (CIE 15:2004).
        let a = chromaticity(blackbody_xyz(2856.0));
        assert!(
            (a[0] - 0.44757).abs() < 0.003 && (a[1] - 0.40745).abs() < 0.003,
            "{a:?}"
        );
        // The Planckian locus at 6500 K: x = 0.3135, y = 0.3237 (Wyszecki and Stiles, table 1(3.3.4)).
        let b = chromaticity(blackbody_xyz(6500.0));
        assert!(
            (b[0] - 0.3135).abs() < 0.003 && (b[1] - 0.3237).abs() < 0.003,
            "{b:?}"
        );
    }
    #[test]
    fn the_sun_is_white_with_a_warm_cast_and_red_dwarfs_are_orange_and_dim() {
        let sun = photosphere(SUN);
        assert!(sun.centre[0] > sun.centre[1] && sun.centre[1] > sun.centre[2]);
        assert!(sun.centre[2] / sun.centre[0] > 0.8, "{:?}", sun.centre);
        assert!((luminance(sun.centre) - SUN_CENTRE_LUMINANCE).abs() < 1e-9);
        assert!(sun.tint.iter().all(|c| (c - 1.0).abs() < 1e-12));
        let red = photosphere_for(3050.0, TeffOrigin::Catalogue, 0.15, 0.12);
        assert!(red.centre[2] / red.centre[0] < 0.4, "{:?}", red.centre);
        assert!(luminance(red.centre) < 0.1 * luminance(sun.centre));
        assert!(red.tint[0] > 1.0 && red.tint[2] < 0.6);
    }
    #[test]
    fn the_limb_darkens_more_in_blue_and_the_quadratic_law_fits_the_model() {
        for teff in [2560.0, 3050.0, 5080.0, 5772.0, 9700.0] {
            let p = photosphere_for(teff, TeffOrigin::Catalogue, 1.0, 1.0);
            let at = |mu: f64, ch: usize| {
                let x = 1.0 - mu;
                1.0 - p.linear[ch] * x - p.quadratic[ch] * x * x
            };
            for i in 0..=20 {
                let mu = 0.05 + 0.95 * f64::from(i) / 20.0;
                let model = limb_ratio(teff, mu);
                for ch in 0..3 {
                    assert!(
                        (at(mu, ch) - model[ch]).abs() < 0.03,
                        "{teff} K mu {mu} ch {ch}: {} {}",
                        at(mu, ch),
                        model[ch]
                    );
                }
            }
            assert!(at(0.3, 2) < at(0.3, 0), "{teff} K: blue darkens more");
        }
    }
    #[test]
    fn the_sun_uses_its_measured_limb_and_the_model_is_near_it() {
        let sun = photosphere(SUN);
        let x = |mu: f64| 1.0 - mu;
        for mu in [0.15, 0.3, 0.5, 0.8, 1.0] {
            let nl = neckel_labs(mu);
            for ch in 0..3 {
                let q = 1.0 - sun.linear[ch] * x(mu) - sun.quadratic[ch] * x(mu) * x(mu);
                assert!(
                    (q - nl[ch]).abs() < 0.03,
                    "mu {mu} ch {ch}: {q} against {}",
                    nl[ch]
                );
                // The grey model darkens the visible limb by at most this much more than the measured Sun.
                assert!(
                    (limb_ratio(SUN_TEFF, mu)[ch] - nl[ch]).abs() < 0.07,
                    "model at mu {mu} ch {ch}"
                );
            }
        }
    }
    #[test]
    fn a_class_without_a_temperature_takes_the_dwarf_sequence() {
        assert_eq!(teff_from_class("G2"), Some(5770.0));
        assert!((teff_from_class("M5.5").unwrap() - 2935.0).abs() < 1.0);
        let r = StarRecord {
            id: 1,
            name: "x",
            spectral: Some(("K1V", "test")),
            teff: None,
            radius: None,
            luminosity: None,
        };
        assert_eq!(teff_of(&r).1, TeffOrigin::SpectralClass);
        let none = StarRecord {
            spectral: None,
            ..r
        };
        assert_eq!(teff_of(&none), (SUN_TEFF, TeffOrigin::Fallback));
    }
}
#[cfg(test)]
mod table {
    use super::*;
    /// The numbers in docs/SOLAR-SYSTEM.md, "The star model": cargo test -p solar-core --lib stars::table -- --ignored --nocapture
    #[test]
    #[ignore]
    fn print_star_table() {
        for t in [
            2560.0, 3050.0, 3790.0, 5080.0, 5340.0, 5772.0, 6500.0, 9700.0, 20000.0,
        ] {
            let p = photosphere_for(t, TeffOrigin::Catalogue, 1.0, 1.0);
            let xy = chromaticity(blackbody_xyz(t));
            let r = |mu| limb_ratio(t, mu).map(|v| (v * 1000.0).round() / 1000.0);
            println!("{t} K xy {:.4} {:.4} centre {:.3?} Y {:.3} tint {:.3?} a {:.3?} b {:.3?} mu0.1 {:?} mu0.5 {:?}", xy[0], xy[1], p.centre, luminance(p.centre), p.tint, p.linear, p.quadratic, r(0.1), r(0.5));
        }
    }
}
#[cfg(test)]
mod sun_table {
    use super::*;
    #[test]
    #[ignore]
    fn print_records() {
        for id in [SUN, 10000, 10100, 10200, 10300, 10400] {
            let p = photosphere(id);
            let mean: Vec<f64> = (0..3)
                .map(|c| p.centre[c] * (1.0 - p.linear[c] / 3.0 - p.quadratic[c] / 6.0))
                .collect();
            println!("{id} {} K {:?} centre {:.3?} Y {:.3} meanY {:.3} a {:.3?} b {:.3?} tint {:.3?} granule {:.6}", p.teff, p.origin, p.centre, luminance(p.centre), 0.2126*mean[0]+0.7152*mean[1]+0.0722*mean[2], p.linear, p.quadratic, p.tint, p.granule);
        }
    }
}

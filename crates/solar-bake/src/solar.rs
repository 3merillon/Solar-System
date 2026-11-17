//! Bake the solar table: fit JPL's kernels to small Chebyshev tables and harmonic series, with the
//! IAU rotation model from the PCK. Every error printed here is measured at times the fit did not
//! use. A body that cannot reach its tolerance says so: the figure goes in the table and the log.
use crate::spk::{text_kernel, Kernels};
use solar_core::ephemeris::{MAGIC, SECONDS_PER_DAY};
use std::{collections::HashMap, f64::consts::PI, io::Write, path::Path};

const DAY: f64 = SECONDS_PER_DAY;
const YEAR: f64 = 365.25 * DAY;

struct Plan {
    id: i32,
    parent: i32,
    /// What to sample: NAIF code against NAIF code.
    target: (i32, i32),
    fit: Fit,
}
enum Fit {
    Origin,
    /// Chebyshev: segment days, coefficients per axis.
    Table(f64, usize),
    /// As `Table`, for a planet whose centre is found from its barycentre and moons.
    Barycentric(f64, usize, &'static [i32]),
    /// Harmonic series: sample step in days, terms per axis.
    Series(f64, usize),
}
const fn body(id: i32, parent: i32, target: (i32, i32), fit: Fit) -> Plan {
    Plan {
        id,
        parent,
        target,
        fit,
    }
}
fn plans() -> Vec<Plan> {
    use Fit::*;
    vec![
        body(10, 10, (10, 10), Origin),
        body(199, 10, (1, 10), Table(20.0, 11)),
        body(299, 10, (2, 10), Table(45.0, 10)),
        body(399, 10, (3, 10), Barycentric(45.0, 10, &[301])),
        body(301, 399, (301, 399), Table(14.0, 11)),
        body(499, 10, (4, 10), Barycentric(60.0, 9, &[401, 402])),
        body(401, 499, (401, 499), Series(0.02, 30)),
        body(402, 499, (402, 499), Series(0.05, 24)),
        body(
            599,
            10,
            (5, 10),
            Barycentric(180.0, 9, &[501, 502, 503, 504]),
        ),
        body(501, 599, (501, 599), Series(0.1, 40)),
        body(502, 599, (502, 599), Series(0.2, 70)),
        body(503, 599, (503, 599), Series(0.4, 70)),
        body(504, 599, (504, 599), Series(0.8, 60)),
        body(
            699,
            10,
            (6, 10),
            Barycentric(360.0, 9, &[601, 602, 603, 604, 605, 606, 608]),
        ),
        body(601, 699, (601, 699), Series(0.05, 70)),
        body(602, 699, (602, 699), Series(0.08, 30)),
        body(603, 699, (603, 699), Series(0.1, 40)),
        body(604, 699, (604, 699), Series(0.15, 30)),
        body(605, 699, (605, 699), Series(0.25, 40)),
        body(606, 699, (606, 699), Series(0.8, 50)),
        body(608, 699, (608, 699), Series(1.0, 60)),
        body(
            799,
            10,
            (7, 10),
            Barycentric(360.0, 9, &[701, 702, 703, 704, 705]),
        ),
        body(701, 799, (701, 799), Series(0.15, 24)),
        body(702, 799, (702, 799), Series(0.2, 24)),
        body(703, 799, (703, 799), Series(0.5, 24)),
        body(704, 799, (704, 799), Series(0.7, 24)),
        body(705, 799, (705, 799), Series(0.07, 30)),
        body(899, 10, (8, 10), Barycentric(360.0, 9, &[801])),
        body(801, 899, (801, 899), Series(0.3, 24)),
        body(999, 10, (9, 10), Barycentric(360.0, 9, &[901])),
        body(901, 999, (901, 999), Series(0.3, 16)),
    ]
}
fn chebyshev_nodes(order: usize) -> Vec<f64> {
    // Lobatto nodes: both ends are samples, so neighbouring segments agree at their join.
    (0..order)
        .map(|i| -(PI * i as f64 / (order - 1) as f64).cos())
        .collect()
}
fn chebyshev_coefficients(values: &[f64], nodes: &[f64]) -> Vec<f64> {
    // Discrete cosine transform on the Lobatto grid, with the halved end weights.
    let n = values.len();
    let m = (n - 1) as f64;
    (0..n)
        .map(|k| {
            let mut sum = 0.0;
            for (j, (&v, &x)) in values.iter().zip(nodes).enumerate() {
                let weight = if j == 0 || j == n - 1 { 0.5 } else { 1.0 };
                sum += weight * v * (k as f64 * x.acos()).cos();
            }
            let scale = if k == 0 || k == n - 1 { 1.0 } else { 2.0 };
            scale * sum / m
        })
        .collect()
}
fn write_chebyshev(
    out: &mut Vec<u8>,
    sample: &dyn Fn(f64) -> [f64; 3],
    span: [f64; 2],
    days: f64,
    order: usize,
) -> solar_core::ephemeris::Chebyshev {
    let length = days * DAY;
    let segments = ((span[1] - span[0]) / length).ceil() as usize;
    let nodes = chebyshev_nodes(order);
    out.extend_from_slice(&span[0].to_le_bytes());
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&(order as u32).to_le_bytes());
    out.extend_from_slice(&(segments as u32).to_le_bytes());
    let mut kept = Vec::with_capacity(segments * order * 3);
    for s in 0..segments {
        let start = span[0] + s as f64 * length;
        let points: Vec<[f64; 3]> = nodes
            .iter()
            .map(|x| sample(start + (x + 1.0) * 0.5 * length))
            .collect();
        for axis in 0..3 {
            let values: Vec<f64> = points.iter().map(|p| p[axis]).collect();
            for (k, c) in chebyshev_coefficients(&values, &nodes).iter().enumerate() {
                if k < 3 {
                    out.extend_from_slice(&c.to_le_bytes());
                    kept.push(*c);
                } else {
                    out.extend_from_slice(&(*c as f32).to_le_bytes());
                    kept.push(f64::from(*c as f32));
                }
            }
        }
    }
    solar_core::ephemeris::Chebyshev {
        start: span[0],
        span: length,
        order,
        coefficients: kept,
    }
}
/// In-place radix-2 FFT of (re, im).
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = -2.0 * PI / len as f64;
        let (ws, wc) = angle.sin_cos();
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let next = cr * wc - ci * ws;
                ci = cr * ws + ci * wc;
                cr = next;
            }
        }
        len <<= 1;
    }
}
fn solve(mut a: Vec<f64>, mut b: Vec<f64>) -> Vec<f64> {
    let n = b.len();
    for i in 0..n {
        let mut pivot = i;
        for r in i + 1..n {
            if a[r * n + i].abs() > a[pivot * n + i].abs() {
                pivot = r;
            }
        }
        if pivot != i {
            for c in 0..n {
                a.swap(i * n + c, pivot * n + c);
            }
            b.swap(i, pivot);
        }
        let d = a[i * n + i];
        if d.abs() < 1e-300 {
            continue;
        }
        for r in i + 1..n {
            let f = a[r * n + i] / d;
            if f != 0.0 {
                for c in i..n {
                    a[r * n + c] -= f * a[i * n + c];
                }
                b[r] -= f * b[i];
            }
        }
    }
    for i in (0..n).rev() {
        let mut v = b[i];
        for c in i + 1..n {
            v -= a[i * n + c] * b[c];
        }
        b[i] = if a[i * n + i].abs() < 1e-300 {
            0.0
        } else {
            v / a[i * n + i]
        };
    }
    b
}
/// Least squares of `y` on 1, t, t^2 (t in centuries) and cos/sin of the given frequencies.
fn least_squares(t: &[f64], y: &[f64], w: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let k = 3 + 2 * w.len();
    let mut ata = vec![0.0; k * k];
    let mut atb = vec![0.0; k];
    let mut row = vec![0.0; k];
    // Far more rows than unknowns. Not on a regular stride: two frequencies that alias on one
    // become one column, and the solve answers with huge cancelling amplitudes.
    let rows = t.len().min(6_000);
    for n in 0..rows {
        let i = if rows == t.len() {
            n
        } else {
            ((n as f64 * 0.618_033_988_749_895).fract() * t.len() as f64) as usize
        };
        let c = t[i] / 36_525.0;
        row[0] = 1.0;
        row[1] = c;
        row[2] = c * c;
        for (f, &omega) in w.iter().enumerate() {
            let (s, co) = (omega * t[i]).sin_cos();
            row[3 + 2 * f] = co;
            row[4 + 2 * f] = s;
        }
        for r in 0..k {
            atb[r] += row[r] * y[i];
            for q in 0..k {
                ata[r * k + q] += row[r] * row[q];
            }
        }
    }
    let solution = solve(ata, atb);
    let mut residual = y.to_vec();
    for i in 0..t.len() {
        let c = t[i] / 36_525.0;
        let mut v = solution[0] + c * (solution[1] + c * solution[2]);
        for (f, &omega) in w.iter().enumerate() {
            let (s, co) = (omega * t[i]).sin_cos();
            v += solution[3 + 2 * f] * co + solution[4 + 2 * f] * s;
        }
        residual[i] -= v;
    }
    (solution, residual)
}
/// Matching pursuit on one axis: the strongest frequency left in the residual, refined, then a
/// joint solve. Windowed so that one strong term's leakage is not read as many weak ones.
fn fit_series(t: &[f64], y: &[f64], step_days: f64, count: usize) -> (Vec<f64>, Vec<f64>, f64) {
    let mut frequencies: Vec<f64> = Vec::new();
    let (mut solution, mut residual) = least_squares(t, y, &frequencies);
    let size = t.len().next_power_of_two() * 2;
    while frequencies.len() < count {
        let mut re = vec![0.0; size];
        let mut im = vec![0.0; size];
        let n = t.len() as f64;
        for (i, r) in residual.iter().enumerate() {
            re[i] = r * (0.5 - 0.5 * (2.0 * PI * i as f64 / n).cos());
        }
        fft(&mut re, &mut im);
        let mut best = (0.0, 1);
        for k in 1..size / 2 {
            let p = re[k] * re[k] + im[k] * im[k];
            if p > best.0 {
                best = (p, k);
            }
        }
        // Parabolic refinement on log power, then a golden search of the projection.
        let at = |k: usize| (re[k] * re[k] + im[k] * im[k]).max(1e-300).ln();
        let k = best.1;
        let d = if k > 1 && k + 1 < size / 2 {
            let (a, b, c) = (at(k - 1), at(k), at(k + 1));
            0.5 * (a - c) / (a - 2.0 * b + c)
        } else {
            0.0
        };
        let bin = 2.0 * PI / (size as f64 * step_days);
        let centre = (k as f64 + d) * bin;
        let projection = |omega: f64| {
            let (mut a, mut b) = (0.0, 0.0);
            let stride = (t.len() / 200_000).max(1);
            for i in (0..t.len()).step_by(stride) {
                let (s, c) = (omega * t[i]).sin_cos();
                let window = 0.5 - 0.5 * (2.0 * PI * i as f64 / n).cos();
                a += residual[i] * c * window;
                b += residual[i] * s * window;
            }
            a * a + b * b
        };
        let (mut lo, mut hi) = (centre - bin, centre + bin);
        let g = 0.618_033_988_75;
        let (mut x1, mut x2) = (hi - g * (hi - lo), lo + g * (hi - lo));
        let (mut f1, mut f2) = (projection(x1), projection(x2));
        for _ in 0..24 {
            if f1 > f2 {
                hi = x2;
                x2 = x1;
                f2 = f1;
                x1 = hi - g * (hi - lo);
                f1 = projection(x1);
            } else {
                lo = x1;
                x1 = x2;
                f1 = f2;
                x2 = lo + g * (hi - lo);
                f2 = projection(x2);
            }
        }
        frequencies.push(0.5 * (lo + hi));
        (solution, residual) = least_squares(t, y, &frequencies);
    }
    let worst = residual.iter().fold(0.0_f64, |a, r| a.max(r.abs()));
    (frequencies, solution, worst)
}
pub struct SolarOptions<'a> {
    pub kernels: &'a Path,
    pub out: &'a Path,
    /// Years from J2000 of the span of the Chebyshev tables.
    pub span_years: [f64; 2],
    /// Years from J2000 of the span the moon series are fitted over.
    pub series_years: [f64; 2],
}
fn pck_rotation(pck: &HashMap<String, Vec<f64>>, id: i32) -> Vec<u8> {
    let get = |suffix: &str| pck.get(&format!("BODY{id}_{suffix}")).cloned();
    let triple = |suffix: &str| {
        let v = get(suffix).unwrap_or_default();
        [
            v.first().copied().unwrap_or(0.0),
            v.get(1).copied().unwrap_or(0.0),
            v.get(2).copied().unwrap_or(0.0),
        ]
    };
    let mut out = Vec::new();
    let (ra, dec, pm) = (triple("POLE_RA"), triple("POLE_DEC"), triple("PM"));
    for v in ra.iter().chain(dec.iter()).chain(pm.iter()) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    // The angles belong to the planet's system: BODY3 for the Moon and Earth, BODY5 for Io.
    let system = if id == 10 { 0 } else { id / 100 };
    let angles = pck
        .get(&format!("BODY{system}_NUT_PREC_ANGLES"))
        .cloned()
        .unwrap_or_default();
    let (nra, ndec, nw) = (
        get("NUT_PREC_RA").unwrap_or_default(),
        get("NUT_PREC_DEC").unwrap_or_default(),
        get("NUT_PREC_PM").unwrap_or_default(),
    );
    let at = |v: &[f64], i: usize| v.get(i).copied().unwrap_or(0.0);
    // Mars's system lists a quadratic term as well; it moves the angle far under a bit of Phobos's map.
    let stride = pck
        .get(&format!("BODY{system}_MAX_PHASE_DEGREE"))
        .and_then(|v| v.first())
        .map_or(2, |d| *d as usize + 1);
    let span = angles.len() / stride;
    let terms: Vec<[f64; 5]> = (0..span)
        .map(|i| {
            [
                angles[stride * i],
                angles[stride * i + 1],
                at(&nra, i),
                at(&ndec, i),
                at(&nw, i),
            ]
        })
        .filter(|t| t[2] != 0.0 || t[3] != 0.0 || t[4] != 0.0)
        .collect();
    out.extend_from_slice(&(terms.len() as u32).to_le_bytes());
    for t in &terms {
        for v in t {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}
pub fn bake(options: &SolarOptions) -> Result<(), String> {
    let mut kernels = Kernels::new();
    // Last wins. The satellite kernels carry their own copies of planets from older integrations,
    // thousands of km apart at Neptune, so DE440 goes last and every barycentre and the Sun are its.
    for name in [
        "mar099s.bsp",
        "nep097.bsp",
        "plu060.bsp",
        "sat441.bsp",
        "ura184_part-2.bsp",
        "ura184_part-3.bsp",
        "jup365.bsp",
        "de440s.bsp",
    ] {
        kernels.load(&options.kernels.join(name))?;
        eprintln!("loaded {name}");
    }
    let pck = text_kernel(&options.kernels.join("pck00011.tpc"))?;
    let gm = text_kernel(&options.kernels.join("gm_de440.tpc"))?;
    let gm_of = |id: i32| {
        gm.get(&format!("BODY{id}_GM"))
            .and_then(|v| v.first().copied())
    };
    let span = options.span_years.map(|y| y * YEAR);
    let series_span = options.series_years.map(|y| y * YEAR);
    let plan = plans();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&span[0].to_le_bytes());
    bytes.extend_from_slice(&span[1].to_le_bytes());
    bytes.extend_from_slice(&(plan.len() as u32).to_le_bytes());
    let mut report = Vec::new();
    let mut fitted: HashMap<i32, (f64, usize)> = HashMap::new();
    let quick = std::env::var("SOLAR_SOLAR_QUICK").is_ok();
    for p in &plan {
        if quick && matches!(p.fit, Fit::Series(..)) {
            continue;
        }
        let radii = pck
            .get(&format!("BODY{}_RADII", p.id))
            .ok_or_else(|| format!("no radii for {}", p.id))?;
        // Planets with moons: the kernels' GM is for the system under the barycentre's code.
        let body_gm = gm_of(p.id).or_else(|| gm_of(p.id / 100)).unwrap_or(0.0) * 1e9;
        let mut entry = Vec::new();
        entry.extend_from_slice(&p.id.to_le_bytes());
        entry.extend_from_slice(&p.parent.to_le_bytes());
        entry.extend_from_slice(&body_gm.to_le_bytes());
        for r in radii.iter().take(3) {
            entry.extend_from_slice(&(r * 1000.0).to_le_bytes());
        }
        let error_at = entry.len();
        entry.extend_from_slice(&0.0f64.to_le_bytes());
        entry.extend_from_slice(&pck_rotation(&pck, p.id));
        let started = std::time::Instant::now();
        let sample = |et: f64| {
            kernels
                .relative(p.target.0, p.target.1, et)
                .unwrap_or_else(|e| panic!("{e}"))
        };
        let probe_times: Vec<f64> = (0..4000)
            .map(|i| {
                // Off every grid: an irrational step through the span.
                let f = (i as f64 * 0.618_033_988_749_895) % 1.0;
                span[0] + f * (span[1] - span[0])
            })
            .collect();
        let chebyshev_error = |c: &solar_core::ephemeris::Chebyshev| {
            let mut worst = 0.0_f64;
            for &t in &probe_times {
                let (q, _) = c.state(t);
                let s = sample(t);
                let e =
                    ((q[0] - s[0]).powi(2) + (q[1] - s[1]).powi(2) + (q[2] - s[2]).powi(2)).sqrt();
                worst = worst.max(e);
            }
            worst
        };
        let error = match &p.fit {
            Fit::Origin => {
                entry.extend_from_slice(&0u32.to_le_bytes());
                0.0
            }
            Fit::Table(days, order) => {
                entry.extend_from_slice(&1u32.to_le_bytes());
                let c = write_chebyshev(&mut entry, &sample, span, *days, *order);
                chebyshev_error(&c)
            }
            Fit::Barycentric(days, order, moons) => {
                entry.extend_from_slice(&3u32.to_le_bytes());
                let c = write_chebyshev(&mut entry, &sample, span, *days, *order);
                let e = chebyshev_error(&c);
                entry.extend_from_slice(&(moons.len() as u32).to_le_bytes());
                let planet_gm = gm_of(p.id).ok_or_else(|| format!("no GM for {}", p.id))?;
                for m in moons.iter() {
                    let mu = gm_of(*m).ok_or_else(|| format!("no GM for {m}"))? / planet_gm;
                    entry.extend_from_slice(&m.to_le_bytes());
                    entry.extend_from_slice(&mu.to_le_bytes());
                }
                e
            }
            Fit::Series(step, count) => {
                entry.extend_from_slice(&2u32.to_le_bytes());
                // Times in days, centred, so the series are well conditioned.
                let (first, last) = (series_span[0] / DAY, series_span[1] / DAY);
                let n = ((last - first) / step) as usize;
                let t: Vec<f64> = (0..n).map(|i| first + i as f64 * step).collect();
                let samples: Vec<[f64; 3]> = t.iter().map(|d| sample(d * DAY)).collect();
                let fitted_axes: Vec<_> = std::thread::scope(|scope| {
                    let handles: Vec<_> = (0..3)
                        .map(|axis| {
                            let (t, samples) = (&t, &samples);
                            scope.spawn(move || {
                                let y: Vec<f64> = samples.iter().map(|s| s[axis]).collect();
                                fit_series(t, &y, *step, *count)
                            })
                        })
                        .collect();
                    handles.into_iter().map(|h| h.join().unwrap()).collect()
                });
                let mut axes = Vec::new();
                for (frequencies, solution, worst) in fitted_axes {
                    for v in &solution[..3] {
                        entry.extend_from_slice(&v.to_le_bytes());
                    }
                    entry.extend_from_slice(&(frequencies.len() as u32).to_le_bytes());
                    let mut terms = Vec::new();
                    for (f, &omega) in frequencies.iter().enumerate() {
                        let (a, b) = (solution[3 + 2 * f], solution[4 + 2 * f]);
                        entry.extend_from_slice(&omega.to_le_bytes());
                        entry.extend_from_slice(&a.to_le_bytes());
                        entry.extend_from_slice(&b.to_le_bytes());
                        terms.push([omega, a, b]);
                    }
                    axes.push((solution[..3].to_vec(), terms, worst));
                }
                // Measured off the fitting grid, inside the fitted span.
                let mut worst = 0.0_f64;
                for i in 0..4000 {
                    let d = first + ((i as f64 * 0.618_033_988_749_895) % 1.0) * (last - first);
                    let s = sample(d * DAY);
                    let mut e = 0.0;
                    for (axis, (polynomial, terms, _)) in axes.iter().enumerate() {
                        let c = d / 36_525.0;
                        let mut v = polynomial[0] + c * (polynomial[1] + c * polynomial[2]);
                        for &[w, a, b] in terms {
                            let (si, co) = (w * d).sin_cos();
                            v += a * co + b * si;
                        }
                        e += (v - s[axis]).powi(2);
                    }
                    worst = worst.max(e.sqrt());
                }
                worst
            }
        };
        entry[error_at..error_at + 8].copy_from_slice(&error.to_le_bytes());
        fitted.insert(p.id, (error, entry.len()));
        report.push(format!(
            "{{\"id\":{},\"fit_error_m\":{:.1},\"bytes\":{},\"seconds\":{:.1}}}",
            p.id,
            error,
            entry.len(),
            started.elapsed().as_secs_f64()
        ));
        eprintln!(
            "{:>4} error {:>12.1} km  {:>9} bytes  {:.1} s",
            p.id,
            error / 1000.0,
            entry.len(),
            started.elapsed().as_secs_f64()
        );
        bytes.extend_from_slice(&entry);
    }
    let mut f = std::fs::File::create(options.out).map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    let log = options.out.with_extension("log.json");
    std::fs::write(&log, format!("[{}]", report.join(",\n"))).map_err(|e| e.to_string())?;
    eprintln!("wrote {} bytes", bytes.len());
    Ok(())
}

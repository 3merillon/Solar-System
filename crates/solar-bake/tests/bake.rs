//! Bake checks on synthetic sources with analytic fields. No data files needed.
use solar_bake::{
    bake::{self, BakeOptions, BakedPage},
    pack,
    source::{AlbedoSource, HeightSource},
};
use solar_core::pages::{
    chart_to_direction, direction_to_lon_lat, PageKey, HEIGHT_GUTTER, PAGE_CELLS, PAGE_TEXELS,
};

const W: usize = 720;
const H: usize = 360;

/// Smooth in the direction vector, so it has no seam at the antimeridian or the poles.
fn field(n: [f64; 3]) -> f64 {
    1200.0 * n[1] + 800.0 * n[0] + 400.0 * n[2] + 600.0 * n[0] * n[1] - 300.0 * n[2] * n[2]
}
fn height_source(scale: f64) -> HeightSource {
    let mut d = Vec::with_capacity(W * H);
    for y in 0..H {
        let lat = std::f64::consts::FRAC_PI_2 - (y as f64 + 0.5) / H as f64 * std::f64::consts::PI;
        for x in 0..W {
            let lon = -std::f64::consts::PI + (x as f64 + 0.5) / W as f64 * std::f64::consts::TAU;
            d.push((scale * field(solar_core::pages::lon_lat_to_direction(lon, lat))) as f32);
        }
    }
    HeightSource::new(W, H, d)
}
fn flat_albedo(rgb: [u8; 3]) -> AlbedoSource {
    AlbedoSource::new(W, H, (0..W * H).flat_map(|_| rgb).collect())
}
fn opts(step: f64) -> BakeOptions {
    BakeOptions {
        height_step: step,
        height_rel_div: 0.0,
        zopfli_iterations: 0,
        ..Default::default()
    }
}

fn decode_height(page: &BakedPage) -> Vec<f64> {
    let dec = png::Decoder::new(std::io::Cursor::new(&page.height_png));
    let mut r = dec.read_info().unwrap();
    let mut buf = vec![0; r.output_buffer_size()];
    let info = r.next_frame(&mut buf).unwrap();
    assert_eq!((info.width, info.height), (264, 264));
    assert_eq!(info.color_type, png::ColorType::Rgb);
    assert_eq!(info.bit_depth, png::BitDepth::Eight);
    buf.chunks_exact(3)
        .map(|p| {
            assert_eq!(p[2], 0, "B must be zero");
            f64::from(page.offset)
                + f64::from(page.scale) * f64::from(u16::from(p[0]) << 8 | u16::from(p[1]))
        })
        .collect()
}
fn truth(key: PageKey, scale: f64) -> Vec<f64> {
    let cell = key.chart_size() / f64::from(PAGE_CELLS);
    let mut v = Vec::new();
    for j in 0..PAGE_TEXELS as i32 {
        for i in 0..PAGE_TEXELS as i32 {
            let u =
                -1.0 + key.chart_size() * f64::from(key.x) + cell * f64::from(i - HEIGHT_GUTTER);
            let w =
                -1.0 + key.chart_size() * f64::from(key.y) + cell * f64::from(j - HEIGHT_GUTTER);
            v.push(scale * field(chart_to_direction(key.face, u, w)));
        }
    }
    v
}
fn max_err(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs())
        .fold(0.0, f64::max)
}

#[test]
fn analytic_field_round_trips_through_pages() {
    // Tolerance: step/2 quantization (0.125 m) plus source bilinear and box-mean bias on a field
    // whose second derivative is ~2000 m per radian^2 over cells of at most 0.01 rad: well under 1 m.
    let src = height_source(1.0);
    let a = flat_albedo([128, 128, 128]);
    for key in [
        PageKey {
            face: 4,
            level: 1,
            x: 1,
            y: 0,
        },
        PageKey {
            face: 0,
            level: 3,
            x: 5,
            y: 2,
        },
        PageKey {
            face: 1,
            level: 0,
            x: 0,
            y: 0,
        },
    ] {
        let page = bake::bake_page(key, &src, &a, &opts(0.25));
        let err = max_err(&decode_height(&page), &truth(key, 1.0));
        assert!(err < 1.0, "{key:?} error {err}");
    }
}

#[test]
fn poles_and_antimeridian_have_no_seam() {
    let src = height_source(1.0);
    let a = flat_albedo([128, 128, 128]);
    // Source reads either side of the antimeridian agree, and the pole rows do not depend on longitude.
    let pi = std::f64::consts::PI;
    for lat in [-1.0, 0.0, 0.7, 1.4] {
        let d = src.sample(0, pi - 1e-9, lat) - src.sample(0, -pi + 1e-9, lat);
        assert!(d.abs() < 1e-3, "antimeridian jump {d}");
    }
    let pole = |lon: f64| src.sample(0, lon, std::f64::consts::FRAC_PI_2);
    // The last row sits 0.25 degrees from the pole, where the field still varies by up to
    // 2 * 800 * cos(89.75 deg) = 7 m with longitude: that is the field, not a seam.
    assert!((pole(0.1) - pole(2.9)).abs() < 10.0);
    // Pages containing the north pole (face 2 centre), the south pole (face 3) and lon = 180 (face 5 centre).
    for key in [
        PageKey {
            face: 2,
            level: 1,
            x: 0,
            y: 0,
        },
        PageKey {
            face: 2,
            level: 3,
            x: 4,
            y: 3,
        },
        PageKey {
            face: 3,
            level: 2,
            x: 1,
            y: 1,
        },
        PageKey {
            face: 5,
            level: 1,
            x: 1,
            y: 0,
        },
        PageKey {
            face: 5,
            level: 3,
            x: 3,
            y: 4,
        },
    ] {
        let page = bake::bake_page(key, &src, &a, &opts(0.25));
        let err = max_err(&decode_height(&page), &truth(key, 1.0));
        // Pole pages: the source's last row is 0.25 degrees from the pole and is clamped beyond it,
        // which cannot follow the field's 3.5 m longitude variation there. A seam would be hundreds of metres.
        let tol = if key.face == 2 || key.face == 3 {
            6.0
        } else {
            1.0
        };
        assert!(err < tol, "{key:?} error {err}");
    }
    // The pole texel itself.
    let key = PageKey {
        face: 2,
        level: 0,
        x: 0,
        y: 0,
    };
    let page = bake::bake_page(key, &src, &a, &opts(0.25));
    let h = decode_height(&page);
    let centre = h[(HEIGHT_GUTTER as usize + 128) * PAGE_TEXELS + HEIGHT_GUTTER as usize + 128];
    assert!((centre - 1200.0).abs() < 1.0, "pole height {centre}");
    let _ = direction_to_lon_lat([0.0, 1.0, 0.0]);
}

#[test]
fn gutters_agree_with_the_neighbour_interior() {
    let src = height_source(1.0);
    let a = flat_albedo([128, 128, 128]);
    let o = opts(0.25);
    let left = bake::bake_page(
        PageKey {
            face: 4,
            level: 2,
            x: 1,
            y: 1,
        },
        &src,
        &a,
        &o,
    );
    let right = bake::bake_page(
        PageKey {
            face: 4,
            level: 2,
            x: 2,
            y: 1,
        },
        &src,
        &a,
        &o,
    );
    let (hl, hr) = (decode_height(&left), decode_height(&right));
    let step = f64::from(left.scale.max(right.scale));
    let g = HEIGHT_GUTTER as usize;
    let mut compared = 0;
    // Grid point 256 + k of the left page is grid point k of the right page, for k in -3..=4.
    for k in -(g as i32)..=4 {
        for j in 0..PAGE_TEXELS {
            let il = (g as i32 + 256 + k) as usize;
            let ir = (g as i32 + k) as usize;
            if il >= PAGE_TEXELS {
                continue;
            }
            let d = (hl[j * PAGE_TEXELS + il] - hr[j * PAGE_TEXELS + ir]).abs();
            assert!(d <= step + 1e-6, "k {k} j {j}: {d} > one step {step}");
            compared += 1;
        }
    }
    assert!(compared > 7 * 256);
}

#[test]
fn reconstruction_covers_the_source_and_is_not_clamped() {
    // Range 2 * 4000 m at step 0.25 needs more than 65535 steps, so the scale falls back to range / 65535.
    let src = height_source(10.0);
    let a = flat_albedo([128, 128, 128]);
    let key = PageKey {
        face: 0,
        level: 0,
        x: 0,
        y: 0,
    };
    let values = bake::height_texels(key, &src);
    let (offset, scale, q) = bake::quantize(&values, 0.25);
    assert!(f64::from(scale) > 0.25, "fallback scale {scale}");
    assert!(q.iter().any(|&v| v >= 65000), "range should be used");
    let recon: Vec<f64> = q
        .iter()
        .map(|&v| f64::from(offset) + f64::from(scale) * f64::from(v))
        .collect();
    assert!(max_err(&recon, &values) <= f64::from(scale) / 2.0 + 0.125 + 1e-3);
    // Means never leave the source range.
    let l0 = &src.levels[0].data;
    let (lo, hi) = l0
        .iter()
        .fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
    for &r in &recon {
        assert!(r >= f64::from(lo) - f64::from(scale) && r <= f64::from(hi) + f64::from(scale));
    }
    // And the stored page agrees with the unquantized means to within its step.
    let page = bake::bake_page(key, &src, &a, &opts(0.25));
    assert!(max_err(&decode_height(&page), &values) <= f64::from(page.scale) / 2.0 + 0.125 + 1e-3);
}

#[test]
fn step_snapping_stays_within_half_a_step() {
    let values: Vec<f64> = (0..PAGE_TEXELS * PAGE_TEXELS)
        .map(|i| (i % 977) as f64 * 0.37 - 100.0)
        .collect();
    for step in [0.5, 1.0, 4.0, 16.0] {
        let (offset, scale, q) = bake::quantize(&values, step);
        assert_eq!(f64::from(scale), step);
        let e = values
            .iter()
            .zip(&q)
            .map(|(v, &s)| (f64::from(offset) + f64::from(scale) * f64::from(s) - v).abs())
            .fold(0.0, f64::max);
        assert!(e <= step / 2.0 + 1e-6, "step {step} error {e}");
    }
}

#[test]
fn albedo_is_averaged_in_linear_light() {
    // One-pixel stripes of 0 and 255: the area mean in linear light is 0.5, which is sRGB 188.
    let (sw, sh) = (7200, 3600);
    let mut px = Vec::with_capacity(sw * sh * 3);
    for _y in 0..sh {
        for x in 0..sw {
            let v = if x % 2 == 0 { 0 } else { 255 };
            px.extend_from_slice(&[v, v, v]);
        }
    }
    let a = AlbedoSource::new(sw, sh, px);
    let key = PageKey {
        face: 4,
        level: 0,
        x: 0,
        y: 0,
    };
    let t = bake::albedo_texels(key, &a);
    let c = ((PAGE_TEXELS / 2) * PAGE_TEXELS + PAGE_TEXELS / 2) * 4;
    assert!((i32::from(t[c]) - 188).abs() <= 3, "got {}", t[c]);
    assert_eq!(t[c + 3], 255);
    // A flat colour stays flat, including at the pole and the antimeridian.
    let flat = flat_albedo([200, 100, 50]);
    for key in [
        PageKey {
            face: 2,
            level: 0,
            x: 0,
            y: 0,
        },
        PageKey {
            face: 5,
            level: 1,
            x: 1,
            y: 1,
        },
    ] {
        for p in bake::albedo_texels(key, &flat).chunks_exact(4) {
            assert!(
                (i32::from(p[0]) - 200).abs() <= 1
                    && (i32::from(p[1]) - 100).abs() <= 1
                    && (i32::from(p[2]) - 50).abs() <= 1
            );
        }
    }
}

#[test]
fn albedo_jpeg_decodes_to_the_page() {
    let a = flat_albedo([30, 120, 200]);
    let src = height_source(1.0);
    let page = bake::bake_page(
        PageKey {
            face: 4,
            level: 0,
            x: 0,
            y: 0,
        },
        &src,
        &a,
        &opts(1.0),
    );
    let mut d = jpeg_decoder::Decoder::new(std::io::Cursor::new(&page.albedo_jpeg));
    let px = d.decode().unwrap();
    let info = d.info().unwrap();
    assert_eq!((info.width, info.height), (264, 264));
    assert!(
        (i32::from(px[0]) - 30).abs() <= 3
            && (i32::from(px[1]) - 120).abs() <= 3
            && (i32::from(px[2]) - 200).abs() <= 3
    );
}

fn sample_pages(
    src: &HeightSource,
    a: &AlbedoSource,
    threads: usize,
) -> (Vec<PageKey>, Vec<BakedPage>) {
    let keys: Vec<PageKey> = PageKey::all_pinned()
        .into_iter()
        .filter(|k| k.level < 2 || (k.x == 1 && k.y == 2 && k.face % 2 == 0))
        .collect();
    let pages = bake::bake_pages(
        &keys,
        src,
        a,
        &BakeOptions {
            zopfli_iterations: 0,
            ..Default::default()
        },
        threads,
    );
    (keys, pages)
}

#[test]
fn pack_reader_returns_what_was_written_and_bakes_are_deterministic() {
    let src = height_source(1.0);
    let a = flat_albedo([90, 140, 60]);
    let (keys, one) = sample_pages(&src, &a, 3);
    let (_, two) = sample_pages(&src, &a, 1);
    assert_eq!(one, two, "two bakes must be identical");
    assert_eq!(one.iter().map(|p| p.key).collect::<Vec<_>>(), keys);

    let dir = std::env::temp_dir().join(format!("solar-bake-test-{}", std::process::id()));
    let (d1, d2) = (dir.join("a"), dir.join("b"));
    for d in [&d1, &d2] {
        pack::write_pack(
            d,
            &one,
            &["credit"],
            serde_json::json!({}),
            serde_json::json!({}),
        )
        .unwrap();
    }
    let mut total = 0;
    for level in 0..4u8 {
        let f = format!("level-{level}.bin");
        let b1 = std::fs::read(d1.join(&f)).unwrap();
        assert_eq!(
            b1,
            std::fs::read(d2.join(&f)).unwrap(),
            "{f} differs between writes"
        );
        let back = pack::read_level(&b1).unwrap();
        let want: Vec<&BakedPage> = one.iter().filter(|p| p.key.level == level).collect();
        assert_eq!(back.len(), want.len());
        for (x, y) in back.iter().zip(want) {
            assert_eq!(x, y);
        }
        total += back.len();
    }
    assert_eq!(total, one.len());
    let m: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(d1.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(m["version"], "earth-v1");
    assert_eq!(m["page_texels"], 264);
    assert_eq!(m["files"]["0"]["pages"], 6);
    assert!(pack::read_level(&[1, 2, 3]).is_err());
    let mut bad = std::fs::read(d1.join("level-0.bin")).unwrap();
    bad.truncate(bad.len() - 5);
    assert!(pack::read_level(&bad).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

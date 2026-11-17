//! solar-bake fetch --dir DIR
//! solar-bake inspect --etopo PATH
//! solar-bake pack --etopo PATH --marble PATH --out DIR [--ledger PATH] [--height-step M]
//!                  [--quality Q] [--420] [--threads N]
//! solar-bake solar --kernels DIR --out FILE
//! solar-bake body --name NAME --image PATH --out DIR --map FILE --credit TEXT
//!                  [--height PATH] [--height-scale K] [--height-offset M] [--no-data V] [--height-no-data V]
//!                  [--decimate-image N] [--decimate-height N] [--finest L] [--image-is TEXT] [--threads N]
//! solar-bake bundle --dir DIR   (a body pack baked with loose page files: write its page bundles)
//! solar-bake map --jpeg PATH --map FILE
//! solar-bake sky --exr PATH --stars BSC5 --out FILE
//! solar-bake schematic --name saturn|uranus|neptune --map FILE
use solar_bake::{bake, body, fetch, pack, solar, source};
use solar_core::pages::PageKey;
use std::{path::PathBuf, time::Instant};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("fetch") => {
            let dir = arg(&args, "--dir").ok_or("--dir required")?;
            fetch::fetch_all(PathBuf::from(dir).as_path())
        }
        Some("inspect") => {
            let p = arg(&args, "--etopo").ok_or("--etopo required")?;
            let (src, info) = source::read_etopo(&PathBuf::from(p))?;
            println!(
                "{}x{} tiepoint {:?} scale {:?} raster_type {:?}",
                info.width, info.height, info.tiepoint, info.pixel_scale, info.raster_type
            );
            let l0 = &src.levels[0];
            let (lo, hi) = l0
                .data
                .iter()
                .fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
            println!("min {lo} max {hi}");
            Ok(())
        }
        Some("pack") => {
            let etopo = arg(&args, "--etopo").ok_or("--etopo required")?;
            let marble = arg(&args, "--marble").ok_or("--marble required")?;
            let out = arg(&args, "--out").ok_or("--out required")?;
            let mut opt = bake::BakeOptions::default();
            if let Some(s) = arg(&args, "--height-step") {
                opt.height_step = s.parse().map_err(|_| "bad --height-step")?;
            }
            if let Some(s) = arg(&args, "--quality") {
                opt.jpeg_quality = s.parse().map_err(|_| "bad --quality")?;
            }
            if let Some(s) = arg(&args, "--rel-div") {
                opt.height_rel_div = s.parse().map_err(|_| "bad --rel-div")?;
            }
            if let Some(s) = arg(&args, "--max-step") {
                opt.height_max_step = s.parse().map_err(|_| "bad --max-step")?;
            }
            if let Some(s) = arg(&args, "--zopfli") {
                opt.zopfli_iterations = s.parse().map_err(|_| "bad --zopfli")?;
            }
            opt.chroma_420 = args.iter().any(|a| a == "--420");
            let threads = arg(&args, "--threads")
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(|| {
                    std::thread::available_parallelism()
                        .map(|n| n.get())
                        .unwrap_or(4)
                        .min(12)
                });
            let t0 = Instant::now();
            let (h, info) = source::read_etopo(&PathBuf::from(&etopo))?;
            eprintln!(
                "etopo {}x{} raster_type {:?} read in {:.1}s",
                info.width,
                info.height,
                info.raster_type,
                t0.elapsed().as_secs_f64()
            );
            let a = source::read_marble(&PathBuf::from(&marble))?;
            eprintln!(
                "marble {}x{} read at {:.1}s",
                a.w,
                a.h,
                t0.elapsed().as_secs_f64()
            );
            let keys = PageKey::all_pinned();
            let pages = bake::bake_pages(&keys, &h, &a, &opt, threads);
            let mut sources = serde_json::json!({});
            if let Some(l) = arg(&args, "--ledger") {
                let v: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(&l).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                sources = v["sources"].clone();
            }
            let elapsed = t0.elapsed().as_secs_f64();
            let extra = serde_json::json!({
                "height_step_m": opt.height_step, "jpeg_quality": opt.jpeg_quality,
                "height_rel_div": opt.height_rel_div, "height_max_step_m": opt.height_max_step, "zopfli_iterations": opt.zopfli_iterations, "chroma": if opt.chroma_420 {"4:2:0"} else {"4:4:4"},
                "area_mean": "mean pyramid level + stratified n x n bilinear samples per cell, n <= 64",
                "seconds": elapsed,
            });
            let attribution = [fetch::ETOPO.credit, fetch::MARBLE.credit];
            let sizes =
                pack::write_pack(&PathBuf::from(&out), &pages, &attribution, sources, extra)?;
            let mut total = 0;
            for (l, b) in &sizes {
                println!("level {l}: {b} bytes");
                total += b;
            }
            let hp: usize = pages.iter().map(|p| p.height_png.len()).sum();
            let ap: usize = pages.iter().map(|p| p.albedo_jpeg.len()).sum();
            println!(
                "total {total} bytes (height PNG {hp}, albedo JPEG {ap}), {} pages, {elapsed:.1}s",
                pages.len()
            );
            Ok(())
        }
        Some("solar") => {
            let kernels = arg(&args, "--kernels").ok_or("--kernels required")?;
            let out = arg(&args, "--out").ok_or("--out required")?;
            solar::bake(&solar::SolarOptions {
                kernels: &PathBuf::from(kernels),
                out: &PathBuf::from(out),
                span_years: [-100.0, 100.0],
                series_years: [-5.0, 50.0],
            })
        }
        Some("body") => {
            let name = arg(&args, "--name").ok_or("--name required")?;
            let image = PathBuf::from(arg(&args, "--image").ok_or("--image required")?);
            let height = arg(&args, "--height").map(PathBuf::from);
            let out = PathBuf::from(arg(&args, "--out").ok_or("--out required")?);
            let map = PathBuf::from(arg(&args, "--map").ok_or("--map required")?);
            let credit = arg(&args, "--credit").ok_or("--credit required")?;
            let image_is = arg(&args, "--image-is").unwrap_or_else(|| "visible light".into());
            let number = |name: &str| arg(&args, name).and_then(|s| s.parse::<f64>().ok());
            body::bake(&body::BodyOptions {
                name: &name,
                image: &image,
                height: height.as_deref(),
                height_scale: number("--height-scale").unwrap_or(1.0),
                height_offset: number("--height-offset").unwrap_or(0.0),
                image_no_data: number("--no-data"),
                height_no_data: number("--height-no-data"),
                decimate_image: number("--decimate-image").unwrap_or(1.0) as usize,
                decimate_height: number("--decimate-height").unwrap_or(1.0) as usize,
                finest: number("--finest").unwrap_or(3.0) as u8,
                out: &out,
                map_out: &map,
                credit: &credit,
                threads: number("--threads").map_or_else(
                    || std::thread::available_parallelism().map_or(4, |n| n.get()),
                    |n| n as usize,
                ),
                image_is: &image_is,
            })
        }
        Some("bundle") => {
            let dir = PathBuf::from(arg(&args, "--dir").ok_or("--dir required")?);
            let t0 = Instant::now();
            let written = pack::bundle_loose_pages(&dir)?;
            if written.is_empty() {
                return Err(format!("{}: no pages/<level> to bundle", dir.display()));
            }
            for (level, face, pages, bytes) in &written {
                println!(
                    "level {level} face {face}: {pages} pages, {bytes} bytes, read back identical"
                );
            }
            eprintln!(
                "{} bundles in {:.1}s",
                written.len(),
                t0.elapsed().as_secs_f64()
            );
            Ok(())
        }
        Some("map") => {
            let jpeg = PathBuf::from(arg(&args, "--jpeg").ok_or("--jpeg required")?);
            let map = PathBuf::from(arg(&args, "--map").ok_or("--map required")?);
            body::map_from_jpeg(&jpeg, &map)
        }
        Some("sky") => {
            let exr = PathBuf::from(arg(&args, "--exr").ok_or("--exr required")?);
            let stars = PathBuf::from(arg(&args, "--stars").ok_or("--stars required")?);
            let out = PathBuf::from(arg(&args, "--out").ok_or("--out required")?);
            body::sky(&exr, &stars, &out)
        }
        Some("schematic") => {
            let name = arg(&args, "--name").ok_or("--name required")?;
            let map = PathBuf::from(arg(&args, "--map").ok_or("--map required")?);
            body::schematic_map(&name, &map)
        }
        _ => Err(
            "usage: solar-bake fetch|inspect|pack|solar|body|bundle|map|sky|schematic ...".into(),
        ),
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    use std::{
        future::Future,
        sync::Arc,
        task::{Context, Poll, Wake, Waker},
    };
    struct W(std::thread::Thread);
    impl Wake for W {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(W(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut future = Box::pin(run());
    loop {
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(Ok(())) => break,
            Poll::Ready(Err(e)) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
            Poll::Pending => std::thread::park(),
        }
    }
}
#[cfg(not(target_arch = "wasm32"))]
async fn run() -> Result<(), String> {
    use solar_explorer::renderer::{Renderer, Settings};
    let args: Vec<_> = std::env::args().collect();
    let arg = |key: &str, default: &str| {
        args.iter()
            .position(|s| s == key)
            .and_then(|i| args.get(i + 1))
            .cloned()
            .unwrap_or(default.into())
    };
    let module = wgpu::naga::front::wgsl::parse_str(solar_explorer::scenery::SOURCE)
        .map_err(|e| e.emit_to_string(solar_explorer::scenery::SOURCE))?;
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::all(),
    )
    .validate(&module)
    .map_err(|e| format!("{e:?}"))?;
    let space = wgpu::naga::front::wgsl::parse_str(solar_explorer::space::SOURCE)
        .map_err(|e| e.emit_to_string(solar_explorer::space::SOURCE))?;
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::all(),
    )
    .validate(&space)
    .map_err(|e| format!("{e:?}"))?;
    let finish = wgpu::naga::front::wgsl::parse_str(solar_explorer::finish::SOURCE)
        .map_err(|e| e.emit_to_string(solar_explorer::finish::SOURCE))?;
    wgpu::naga::valid::Validator::new(
        wgpu::naga::valid::ValidationFlags::all(),
        wgpu::naga::valid::Capabilities::all(),
    )
    .validate(&finish)
    .map_err(|e| format!("{e:?}"))?;
    if args.iter().any(|s| s == "--validate") {
        println!("explorer WGSL: Naga validation passed");
        return Ok(());
    }
    let width = arg("--width", "1920").parse().unwrap();
    let height = arg("--height", "1080").parse().unwrap();
    let frames: usize = arg("--frames", "300").parse().unwrap();
    let warmup: usize = arg("--warmup", "300").parse().unwrap();
    let mut settings = Settings::default();
    if args.iter().any(|s| s == "--simple") {
        settings.clouds = false;
        settings.atmosphere = false;
        settings.water = false;
    }
    if args.iter().any(|s| s == "--reference") {
        settings.reference = true;
        settings.tolerance = 2.0;
    }
    settings.world = arg("--world", "procedural");
    let start = solar_explorer::now_ms();
    let tier = solar_explorer::tier::Tier::named(&arg("--tier", "full"))?;
    let mut r = Renderer::new(width, height, settings, tier).await?;
    let ready = solar_explorer::now_ms() - start;
    let cached = r.gpu.persist_pipeline_cache()?;
    eprintln!(
        "ready {ready:.0} ms; native pipeline cache: {}",
        cached.map_or("unavailable on this backend".to_string(), |n| format!(
            "{n} bytes written to {}",
            r.gpu.pipeline_cache_path.as_ref().unwrap().display()
        ))
    );
    let camera = r.bookmark(&arg("--view", "orbit"));
    let mut rows = Vec::new();
    let mut first = 0.0;
    for i in 0..warmup + frames {
        let slot = r.timing.acquire();
        let mut e = r.gpu.device.create_command_encoder(&Default::default());
        r.time = if args.iter().any(|s| s == "--frozen") {
            0.0
        } else {
            i.saturating_sub(warmup) as f64 / 60.0
        };
        r.encode(&mut e, camera, 1.0 / 60.0, slot)?;
        r.native_present_stamp(&mut e, slot);
        if let Some(s) = slot {
            r.timing.resolve(s, &mut e);
        }
        r.gpu.queue.submit([e.finish()]);
        r.submit_timing(slot);
        r.gpu
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| e.to_string())?;
        if i == 0 {
            first = solar_explorer::now_ms() - start;
        }
        let values = r.timing.drain();
        if i >= warmup {
            rows.extend(values);
        }
        if i % 100 == 0 {
            eprintln!(
                "frame {i}: patches {}, level {}",
                r.stats()["patches"],
                r.stats()["max_level"]
            );
        }
    }
    let output = arg("--output", "evidence/local/explorer-native");
    std::fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    let bytes = r.capture("display").await?;
    let file = std::fs::File::create(format!("{output}/view.png")).map_err(|e| e.to_string())?;
    let mut png = png::Encoder::new(file, width, height);
    png.set_color(png::ColorType::Rgba);
    png.set_depth(png::BitDepth::Eight);
    png.write_header()
        .map_err(|e| e.to_string())?
        .write_image_data(&bytes)
        .map_err(|e| e.to_string())?;
    let audit = if args.iter().any(|s| s == "--audit") {
        Some(r.audit_geometry().await?)
    } else {
        None
    };
    let report = serde_json::json!({"audit":audit,"backend":"native wgpu (not browser performance)","ready_ms":ready,"first_image_ms":first,"pipeline_cache_bytes":cached,"tier":r.tier.name,"settings":r.settings,"camera":camera,"stats":r.stats(),"samples":rows});
    std::fs::write(
        format!("{output}/report.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    println!("{}", r.stats());
    Ok(())
}
#[cfg(target_arch = "wasm32")]
fn main() {}

use crate::renderer::{Renderer, Settings};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;
fn js(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
pub struct Laboratory {
    renderer: Renderer,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    present: wgpu::RenderPipeline,
    bindings: wgpu::BindGroup,
    lost: Arc<Mutex<Option<String>>>,
    in_flight: Arc<AtomicU32>,
    completed: Arc<AtomicU32>,
    timing: crate::timing::TimingRing,
    profiling: bool,
    submitted: u64,
    skipped: u64,
    timing_skipped: u64,
    max_in_flight: u32,
}
#[wasm_bindgen]
impl Laboratory {
    #[wasm_bindgen(js_name=create)]
    pub async fn create(canvas: web_sys::HtmlCanvasElement) -> Result<Laboratory, JsValue> {
        let renderer = Renderer::new(
            canvas.width().max(1),
            canvas.height().max(1),
            Settings::default(),
        )
        .await
        .map_err(js)?;
        let g = &renderer.gpu;
        let surface = g
            .instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(js)?;
        let mut config = surface
            .get_default_config(&g.adapter, renderer.width, renderer.height)
            .ok_or_else(|| js("No supported surface configuration"))?;
        let caps = surface.get_capabilities(&g.adapter);
        config.format = *caps
            .formats
            .iter()
            .find(|f| !f.is_srgb())
            .unwrap_or(&caps.formats[0]);
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&g.device, &config);
        let module = g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("canvas presentation"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../../../shaders/present.wgsl").into()),
        });
        let present = g
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("display actual internal pixels"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vertex"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fragment"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: config.format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
        let bindings = Self::present_bindings(&renderer, &present);
        let lost = Arc::new(Mutex::new(None));
        let copy = lost.clone();
        g.device.set_device_lost_callback(move |reason, message| {
            *copy.lock().unwrap() = Some(format!(
                "GPU device lost ({reason:?}): {message}. Reload to recreate the device."
            ));
        });
        let timing = crate::timing::TimingRing::new(g);
        Ok(Self {
            renderer,
            surface,
            config,
            present,
            bindings,
            lost,
            in_flight: Arc::new(AtomicU32::new(0)),
            completed: Arc::new(AtomicU32::new(0)),
            timing,
            profiling: false,
            submitted: 0,
            skipped: 0,
            timing_skipped: 0,
            max_in_flight: 1,
        })
    }
    pub fn settings(&self) -> String {
        serde_json::to_string(&self.renderer.settings).unwrap()
    }
    pub fn configure(&mut self, json: &str) -> Result<(), JsValue> {
        let s = serde_json::from_str(json).map_err(js)?;
        self.renderer.configure(s).map_err(js)
    }
    pub fn set_time(&mut self, seconds: f64) -> Result<(), JsValue> {
        if !seconds.is_finite() || !(0.0..=1e7).contains(&seconds) {
            return Err(js("Animation time is outside the finite epoch"));
        }
        self.renderer.time_seconds = seconds;
        Ok(())
    }
    pub fn bookmark(&self, name: &str) -> String {
        let (a, b) = self.renderer.settings.bookmark(name);
        serde_json::to_string(&[a, b]).unwrap()
    }
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.resize_scaled(width, height, 1.0)
    }
    pub fn resize_scaled(&mut self, width: u32, height: u32, scale: f64) -> Result<(), JsValue> {
        if !scale.is_finite() || !(0.5..=1.0).contains(&scale) {
            return Err(js("Scale must be 0.5 through 1.0"));
        }
        self.renderer
            .resize_output(
                (f64::from(width) * scale).round().max(1.0) as u32,
                (f64::from(height) * scale).round().max(1.0) as u32,
                width,
                height,
            )
            .map_err(js)?;
        self.config.width = width;
        self.config.height = height;
        self.surface
            .configure(&self.renderer.gpu.device, &self.config);
        self.bindings = Self::present_bindings(&self.renderer, &self.present);
        Ok(())
    }
    pub fn render(&mut self, camera: &[f64]) -> Result<bool, JsValue> {
        self.render_at(camera, crate::now_ms())
    }
    pub fn profiling(&mut self, enabled: bool, max_in_flight: u32) -> Result<(), JsValue> {
        if !(1..=2).contains(&max_in_flight) {
            return Err(js("One or two pending frames required"));
        }
        self.profiling = enabled;
        self.max_in_flight = max_in_flight;
        Ok(())
    }
    pub fn telemetry(&self) -> String {
        let g = &self.renderer.gpu;
        let info = g.adapter.get_info();
        serde_json::json!({
            "samples": self.timing.drain(), "submitted": self.submitted,
            "completed": self.completed.load(Ordering::Relaxed), "skipped": self.skipped,
            "pending": self.in_flight.load(Ordering::Relaxed), "timing_skipped": self.timing_skipped,
            "device_lost": *self.lost.lock().unwrap(),
            "timing_overwritten": self.timing.overwritten(),
            "presented": null, "presentation_observation": "WebGPU present requests only; compositor scanout unavailable",
            "adapter": format!("{info:?}"), "features": format!("{:?}", g.device.features()),
            "timestamps": g.timestamps, "controlled_bytes": self.resource_bytes(),
            "proxy_cache_hits": self.renderer.proxy_cache_hits, "proxy_cache_misses": self.renderer.proxy_cache_misses,
        }).to_string()
    }
    pub fn render_at(&mut self, camera: &[f64], input_ms: f64) -> Result<bool, JsValue> {
        let begin = crate::now_ms();
        if !input_ms.is_finite() || input_ms > begin {
            return Err(js("Invalid input timestamp"));
        }
        if let Some(e) = &*self.lost.lock().unwrap() {
            return Err(js(e));
        }
        if self.in_flight.load(Ordering::Relaxed) >= self.max_in_flight {
            self.skipped += 1;
            return Ok(false);
        }
        if camera.len() != 6 {
            return Err(js("Camera requires six finite coordinates"));
        }
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                self.skipped += 1;
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.skipped += 1;
                self.surface
                    .configure(&self.renderer.gpu.device, &self.config);
                return Ok(false);
            }
            other => {
                return Err(js(format!(
                    "Surface needs recovery: {other:?}. Reload to recreate it."
                )))
            }
        };
        self.renderer
            .update_camera(
                camera[..3].try_into().unwrap(),
                camera[3..].try_into().unwrap(),
            )
            .map_err(js)?;
        let camera_done = crate::now_ms();
        let slot = if self.profiling {
            self.timing.acquire()
        } else {
            None
        };
        if self.profiling && slot.is_none() {
            self.timing_skipped += 1;
        }
        let timestamps = slot.and_then(|i| self.timing.slots[i].queries.as_ref());
        let view = frame.texture.create_view(&Default::default());
        let g = &self.renderer.gpu;
        let mut encoder = g.device.create_command_encoder(&Default::default());
        self.renderer.encode_passes(
            &mut encoder,
            self.renderer.settings.instrumented,
            timestamps,
        );
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("present"),
                timestamp_writes: timestamps.map(|q| wgpu::RenderPassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(6),
                    end_of_pass_write_index: Some(7),
                }),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.present);
            pass.set_bind_group(0, &self.bindings, &[]);
            pass.draw(0..3, 0..1);
        }
        if let Some(i) = slot {
            self.timing.resolve(i, &mut encoder);
        }
        let commands = encoder.finish();
        let submit_ms = crate::now_ms();
        g.queue.submit([commands]);
        g.queue.present(frame);
        self.submitted += 1;
        if let Some(i) = slot {
            self.timing.submitted(
                i,
                g,
                crate::timing::Sample {
                    id: self.submitted,
                    cpu_camera_ms: camera_done - begin,
                    cpu_encode_ms: submit_ms - camera_done,
                    submit_ms,
                    completion_ms: 0.0,
                    input_age_at_submit_ms: submit_ms - input_ms,
                    gpu_pass_ms: None,
                    error: None,
                },
            );
        }
        self.in_flight.fetch_add(1, Ordering::Relaxed);
        let pending = self.in_flight.clone();
        let completed = self.completed.clone();
        g.queue.on_submitted_work_done(move || {
            pending.fetch_sub(1, Ordering::Relaxed);
            completed.fetch_add(1, Ordering::Relaxed);
        });
        self.renderer.submitted();
        Ok(true)
    }
    /// Explicit diagnostic capture; ordinary render() never maps GPU buffers.
    pub async fn measure(&mut self, camera: &[f64]) -> Result<String, JsValue> {
        if camera.len() != 6 {
            return Err(js("six camera coordinates required"));
        }
        self.renderer.time_seconds = 0.0;
        let (mut r, _) = self
            .renderer
            .measure(
                camera[..3].try_into().unwrap(),
                camera[3..].try_into().unwrap(),
            )
            .await
            .map_err(js)?;
        r.resident_controlled_bytes = self.resource_bytes();
        Ok(serde_json::to_string(&r).unwrap())
    }
    pub fn resource_bytes(&self) -> u64 {
        self.renderer.resident_bytes() + self.timing.resident_bytes()
    }
    pub fn render_dimensions(&self) -> Vec<u32> {
        vec![
            self.renderer.width,
            self.renderer.height,
            self.renderer.image.width(),
            self.renderer.image.height(),
        ]
    }
    pub fn reset_history(&mut self) {
        self.renderer.reset_history();
    }
    pub async fn validate_temporal(&self) -> Result<String, JsValue> {
        crate::temporal_audit::run(&self.renderer.gpu)
            .await
            .map_err(js)
    }
    pub async fn surface_cache_probe(
        &mut self,
        camera: &[f64],
        extent: f32,
        depth: u32,
        frames: u32,
    ) -> Result<String, JsValue> {
        if camera.len() != 6 || self.in_flight.load(Ordering::Relaxed) > 0 {
            return Err(js("Idle renderer and six camera coordinates required"));
        }
        self.renderer
            .surface_cache_probe(
                [camera[0], camera[1], camera[2]],
                [camera[3], camera[4], camera[5]],
                extent,
                depth,
                frames,
            )
            .await
            .map(|v| v.to_string())
            .map_err(js)
    }
    pub async fn capture_display(&self) -> Result<Vec<u8>, JsValue> {
        self.renderer.capture_display().await.map_err(js)
    }
    pub fn workgroup(&mut self, mode: u32) -> Result<(), JsValue> {
        self.renderer.set_workgroup(mode).map_err(js)
    }
    pub async fn capture_hdr(&self) -> Result<Vec<u8>, JsValue> {
        self.renderer.capture_hdr().await.map_err(js)
    }
    pub async fn capture_resolved_hdr(&self) -> Result<Vec<u8>, JsValue> {
        self.renderer.capture_resolved_hdr().await.map_err(js)
    }
    pub async fn capture_validity(&self) -> Result<Vec<u8>, JsValue> {
        self.renderer.capture_validity().await.map_err(js)
    }
    pub fn reference_sample(&mut self, x: f32, y: f32) -> Result<(), JsValue> {
        if !x.is_finite() || !y.is_finite() || x.abs() > 0.5 || y.abs() > 0.5 {
            return Err(js("Reference jitter must be within half a pixel"));
        }
        self.renderer.reference_jitter = [x, y];
        Ok(())
    }
    pub fn reference_footprint(&mut self, scale: f32) -> Result<(), JsValue> {
        if !scale.is_finite() || !(0.015625..=1.0).contains(&scale) {
            return Err(js("Reference footprint scale must be 1/64 through 1"));
        }
        self.renderer.reference_filter_scale = scale;
        Ok(())
    }
    pub fn reference_region(
        &mut self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        if width == 0 && height == 0 {
            self.renderer.reference_region = [0; 4];
            return Ok(());
        }
        if self.renderer.settings.temporal_mode != 0 {
            return Err(js("Reference regions require spatial mode"));
        }
        self.renderer
            .check_region([x, y, width, height])
            .map_err(js)?;
        self.renderer.reference_region = [x, y, x + width, y + height];
        Ok(())
    }
    pub async fn capture_reference_hdr(
        &self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, JsValue> {
        self.renderer
            .capture_hdr_region([x, y, width, height])
            .await
            .map_err(js)
    }
    pub async fn capture_reference_validity(
        &self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, JsValue> {
        self.renderer
            .capture_validity_region([x, y, width, height])
            .await
            .map_err(js)
    }
    pub fn erosion_state(&self) -> String {
        self.renderer.erosion_state()
    }
    pub fn import_erosion(&mut self, json: &str) -> Result<(), JsValue> {
        self.renderer.import_erosion(json).map_err(js)
    }
    pub async fn precision(&mut self) -> Result<String, JsValue> {
        self.renderer.precision().await.map_err(js)
    }
    pub async fn validate_planet(&mut self) -> Result<String, JsValue> {
        self.renderer.validate_planet().await.map_err(js)
    }
    pub async fn compare_media(&mut self) -> Result<String, JsValue> {
        self.renderer.compare_media().await.map_err(js)
    }
    pub async fn validate_rebase(&mut self) -> Result<String, JsValue> {
        self.renderer.validate_rebase().await.map_err(js)
    }
    pub async fn validate_bounds(&mut self) -> Result<String, JsValue> {
        self.renderer.validate_bounds().await.map_err(js)
    }
    pub async fn validate_water(&mut self) -> Result<String, JsValue> {
        self.renderer.validate_water().await.map_err(js)
    }
    pub async fn measure_at_time(
        &mut self,
        camera: &[f64],
        seconds: f64,
    ) -> Result<String, JsValue> {
        self.set_time(seconds)?;
        if camera.len() != 6 {
            return Err(js("Six camera coordinates required"));
        }
        let (mut report, _) = self
            .renderer
            .measure(
                camera[..3].try_into().unwrap(),
                camera[3..].try_into().unwrap(),
            )
            .await
            .map_err(js)?;
        report.resident_controlled_bytes = self.resource_bytes();
        Ok(serde_json::to_string(&report).unwrap())
    }
    /// Explicit robustness hook; never called by the exploration frame loop.
    pub fn test_device_loss(&self) {
        self.renderer.gpu.device.destroy();
    }
}
impl Laboratory {
    fn present_bindings(r: &Renderer, p: &wgpu::RenderPipeline) -> wgpu::BindGroup {
        r.gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &p.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(
                    &r.image.create_view(&Default::default()),
                ),
            }],
        })
    }
}

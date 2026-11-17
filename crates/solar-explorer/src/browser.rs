use crate::renderer::{Renderer, Settings};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};
use wasm_bindgen::prelude::*;
fn js(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}
// The UI needs synchronous camera constraints and bookmark coordinates. This
// tiny model has no GPU handles and never initializes/generates planet caches.
#[wasm_bindgen]
pub struct CameraWorld {
    settings: Settings,
    skin: solar_core::skin::Skin,
}
fn page_key(face: u8, level: u8, x: u32, y: u32) -> solar_core::pages::PageKey {
    solar_core::pages::PageKey { face, level, x, y }
}
#[wasm_bindgen]
impl CameraWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<Self, JsValue> {
        let settings: Settings = serde_json::from_str(json).map_err(js)?;
        settings.validate().map_err(js)?;
        let skin = settings.skin();
        Ok(Self { settings, skin })
    }
    pub fn configure(&mut self, json: &str) -> Result<(), JsValue> {
        *self = Self::new(json)?;
        Ok(())
    }
    pub fn settings(&self) -> String {
        serde_json::to_string(&self.settings).unwrap()
    }
    pub fn radius(&self) -> f64 {
        self.skin.radius
    }
    pub fn height(&self, x: f64, y: f64, z: f64) -> f64 {
        self.skin
            .height(solar_core::field::normalized([x, y, z]), 0.0)
    }
    pub fn bookmark(&self, name: &str) -> String {
        serde_json::to_string(&crate::world::bookmark(&self.skin, name)).unwrap()
    }
}
/// The running solar system on the page's thread: clock, craft and frames, with no GPU.
#[wasm_bindgen]
pub struct SolarFlight {
    world: crate::solar::SolarWorld,
    controls: solar_core::flight::Controls,
}
#[wasm_bindgen]
impl SolarFlight {
    #[wasm_bindgen(constructor)]
    pub fn new(tdb_seconds: f64, body: i32, height: f64) -> Self {
        Self {
            world: crate::solar::SolarWorld::new(
                solar_core::ephemeris::SimTime::from_seconds(tdb_seconds),
                body,
                height,
            ),
            controls: Default::default(),
        }
    }
    /// thrust right, up, forward; setting; boost; dive; brake; roll; assist; ground height.
    pub fn step(&mut self, dt: f64, input: &[f64]) {
        if input.len() < 10 {
            return;
        }
        self.controls.thrust = [input[0], input[1], input[2]];
        self.controls.setting = input[3];
        self.controls.boost = input[4] != 0.0;
        self.controls.dive = input[5] != 0.0;
        self.controls.brake = input[6] != 0.0;
        self.controls.roll = input[7];
        self.controls.assist = input[8] != 0.0;
        self.world.ground = input[9];
        // Any flight input ends a trip where it is.
        if self.world.trip.is_some()
            && (self.controls.thrust.iter().any(|v| *v != 0.0)
                || self.controls.brake
                || self.controls.roll != 0.0)
        {
            self.world.stop_trip();
        }
        self.world.step(&self.controls, dt);
        // A landing ends at the ground; from there the craft is held by it.
        if self.world.report.touched && self.controls.autopilot.is_some_and(|a| a.1 <= 0.0) {
            self.controls.autopilot = None;
            self.world.craft.landed = true;
        }
    }
    pub fn packet(&mut self, width: f64, height: f64) -> Vec<f64> {
        self.world.packet(width, height)
    }
    pub fn load_asteroids(&mut self, data: &[f32]) {
        self.world.load_asteroids(data);
    }
    pub fn jump_near_asteroid(&mut self, index: usize, standoff: f64) {
        self.world.trip = None;
        self.world.jump_near_asteroid(index, standoff);
    }
    /// Where every body falls on screen, for the indicators: id, x, y (pixels), disk radius (pixels), distance (metres),
    /// and flags: 1 in front of the eye, 2 on screen, 4 hidden behind a nearer body.
    pub fn markers(&self, width: f64, height: f64) -> Vec<f64> {
        self.world.markers(width, height)
    }
    /// Named surface features of a body on screen: `points` is latitude, east longitude (degrees) pairs; per point x, y,
    /// distance (metres) and flags (1 in front, 2 on screen, 4 on the hemisphere facing the eye).
    pub fn surface_markers(&self, body: i32, points: &[f64], width: f64, height: f64) -> Vec<f64> {
        self.world.surface_markers(body, points, width, height)
    }
    /// Turn the view to a body at a steady rate, until the mouse takes over. Zero stops.
    pub fn look_at(&mut self, body: i32) {
        self.world.stop_trip();
        self.world.looking_at = body;
    }
    /// Face a direction in ICRF at once: for tests that read a known star.
    pub fn face(&mut self, x: f64, y: f64, z: f64) {
        self.world.craft.attitude =
            solar_core::flight::look_rotation([x, y, z], self.world.craft.up());
    }
    /// Orbit trails for this frame, in the packet's axes.
    pub fn trails(&mut self, target: i32) -> Vec<f32> {
        self.world.trail_points(target)
    }
    pub fn set_belt_gain(&mut self, magnitudes: f64) {
        self.world.belt_gain = magnitudes;
    }
    pub fn look(&mut self, dx: f64, dy: f64) {
        self.world.stop_trip();
        self.world.craft.look(dx, dy);
        self.world.looking_at = 0;
    }
    pub fn set_rate(&mut self, rate: f64) {
        self.world.rate = rate;
    }
    pub fn rate(&self) -> f64 {
        self.world.rate
    }
    pub fn seconds(&self) -> f64 {
        self.world.time.seconds()
    }
    pub fn set_seconds(&mut self, seconds: f64) {
        if seconds.is_finite() {
            self.world
                .set_time(solar_core::ephemeris::SimTime::from_seconds(seconds));
        }
    }
    /// Go to a body: an animated trip of about five seconds into the orbit the jump gave (solar-core trip.rs).
    pub fn go_to(&mut self, body: i32) {
        self.controls.autopilot = None;
        self.world.start_trip(body, solar_core::trip::End::Orbit);
    }
    /// The same trip, ending `height` metres over a place (degrees north, east), looking down with north up.
    pub fn go_over(&mut self, body: i32, latitude: f64, longitude: f64, height: f64) {
        self.controls.autopilot = None;
        self.world.start_trip(
            body,
            solar_core::trip::End::Over {
                latitude,
                longitude,
                height,
            },
        );
    }
    /// The same trip, ending `height` metres over the ground at a place, looking north over the horizon.
    pub fn land_at(&mut self, body: i32, latitude: f64, longitude: f64, height: f64) {
        self.controls.autopilot = None;
        self.world.start_trip(
            body,
            solar_core::trip::End::Land {
                latitude,
                longitude,
                height,
            },
        );
    }
    /// A landmark trip's end place, for the page to ask the terrain about: body, then the direction in its fixed axes. Empty
    /// for none.
    pub fn trip_place(&self) -> Vec<f64> {
        self.world
            .trip
            .as_ref()
            .and_then(|t| t.place())
            .map_or(Vec::new(), |(b, u)| vec![f64::from(b), u[0], u[1], u[2]])
    }
    /// The terrain's answer for that direction: metres over the reference radius.
    pub fn measure_trip_place(&mut self, ground: f64, dt: f64) {
        self.world.measure_trip_place(ground, dt);
    }
    pub fn stop_trip(&mut self) {
        self.world.stop_trip();
    }
    /// A trip under way: 1 or 0, its fraction, its target, detours planned, and the body still in the way (0: none).
    pub fn trip_state(&self) -> Vec<f64> {
        self.world.trip.as_ref().map_or(vec![0.0; 5], |t| {
            vec![
                1.0,
                t.fraction(),
                f64::from(t.target),
                t.detours as f64,
                f64::from(t.blocked.unwrap_or(0)),
            ]
        })
    }
    /// The least height of the craft over any body's surface in its system (reference spheres), and that body: for the trips' evidence.
    pub fn body_clearance(&self) -> Vec<f64> {
        let (c, id) = solar_core::trip::clearance_to_bodies(
            solar_core::celestial::system(),
            self.world.craft.frame,
            self.world.craft.position.metres(),
            self.world.time,
        );
        vec![c, f64::from(id)]
    }
    /// The craft against a body, for the trips' evidence: its position (inertial axes, metres), its view direction (inertial), and
    /// its position in the body's fixed axes.
    pub fn probe(&self, body: i32) -> Vec<f64> {
        let s = solar_core::celestial::system();
        let Some(b) = s.ephemeris.body(body) else {
            return Vec::new();
        };
        let (p, _) = s
            .ephemeris
            .relative_state(body, self.world.craft.frame, self.world.time);
        let at = self.world.craft.position.minus(p);
        let f = self.world.craft.forward();
        let fixed = solar_core::celestial::apply(
            &solar_core::celestial::orientation(&b.rotation, self.world.time),
            at,
        );
        vec![
            at[0], at[1], at[2], f[0], f[1], f[2], fixed[0], fixed[1], fixed[2],
        ]
    }
    /// Autopilot to a body, stopping this far above it. Zero turns it off.
    pub fn fly_to(&mut self, body: i32, stop: f64) {
        self.world.stop_trip();
        self.controls.autopilot = (body != 0).then_some((body, stop));
    }
    pub fn flying_to(&self) -> i32 {
        self.controls.autopilot.map_or(0, |a| a.0)
    }
    /// Instantly into a circular orbit of a body, sunlit, looking at it. A shortcut, and stated as one: the clock stays where it is.
    pub fn jump_orbit(&mut self, body: i32) {
        self.world.trip = None;
        self.world.jump_orbit(body);
        self.world.looking_at = 0;
        self.controls.autopilot = None;
    }
    /// In the middle of the main asteroid belt.
    /// The opening view over a place on a body (degrees north and east), at a height: see `SolarWorld::start_over`.
    pub fn start_over(&mut self, body: i32, latitude: f64, longitude: f64, height: f64) {
        self.world.start_over(body, latitude, longitude, height);
        self.controls.autopilot = None;
    }
    pub fn jump_belt(&mut self) {
        self.world.trip = None;
        self.world.jump_belt();
        self.controls.autopilot = None;
    }
    /// Inside Saturn's rings, this high over their plane.
    pub fn jump_rings(&mut self, height: f64) {
        self.world.trip = None;
        self.world.jump_rings(height);
        self.controls.autopilot = None;
    }
    /// Above the plane of the planets, looking down.
    pub fn jump_overview(&mut self, distance: f64) {
        self.world.trip = None;
        self.world.jump_overview(distance);
        self.controls.autopilot = None;
    }
    pub fn jump_low_sun(&mut self, body: i32, height: f64, elevation: f64) {
        self.world.trip = None;
        self.world.jump_low_sun(body, height, elevation);
    }
    pub fn jump_facing(&mut self, body: i32, latitude: f64, longitude: f64, height: f64) {
        self.world.trip = None;
        self.world.jump_facing(body, latitude, longitude, height);
    }
    pub fn jump_over(&mut self, body: i32, latitude: f64, longitude: f64, height: f64) {
        self.world.trip = None;
        self.world.jump_over(body, latitude, longitude, height);
        self.controls.autopilot = None;
    }
    pub fn jump_camera(&mut self, body: i32, camera: &[f64]) -> Result<(), JsValue> {
        self.world.trip = None;
        if camera.len() != 9 || camera.iter().any(|v| !v.is_finite()) {
            return Err(js("invalid destination camera"));
        }
        let eye = [camera[0], camera[1], camera[2]];
        let forward = [
            camera[3] - camera[0],
            camera[4] - camera[1],
            camera[5] - camera[2],
        ];
        self.world
            .jump_camera(body, eye, forward, [camera[6], camera[7], camera[8]]);
        self.controls.autopilot = None;
        Ok(())
    }
    pub fn jump_near(&mut self, body: i32, height: f64) {
        self.world.trip = None;
        self.world.jump_near(body, height);
    }
    /// Frame, nearest body, clearance, speed against the nearest, frame speed, drag, free blend,
    /// thrust, landed, hand-overs, altitude over the frame body, ground speed.
    pub fn report(&self) -> Vec<f64> {
        let r = &self.world.report;
        vec![
            f64::from(self.world.craft.frame),
            f64::from(r.nearest),
            r.clearance,
            r.relative_speed,
            solar_core::field::length(self.world.craft.velocity),
            r.drag,
            r.free,
            r.thrust,
            f64::from(u8::from(r.landed)),
            f64::from(r.hand_overs),
            self.world.altitude_over(self.world.craft.frame),
            self.world.ground_speed(),
        ]
    }
    pub fn body_name(body: i32) -> String {
        solar_core::body::BodyDescriptor::of_naif(body)
            .map_or_else(|| "none".into(), |b| b.name.to_string())
    }
    pub fn body_radius(body: i32) -> f64 {
        solar_core::celestial::system().radius(body)
    }
    /// Body names in map-layer order, as JSON.
    pub fn catalogue() -> String {
        let names: Vec<&str> = solar_core::body::BODIES.iter().map(|b| b.name).collect();
        serde_json::to_string(&names).unwrap()
    }
    /// Known stellar destinations; all of their worlds use synthetic surfaces and orbits.
    pub fn galaxy_catalogue() -> String {
        let systems: Vec<_> = solar_core::galaxy::SYSTEMS.iter().map(|s| {
            let worlds: Vec<_> = s.worlds.iter().enumerate().map(|(i, slug)| {
                let suffix = slug.rsplit('-').next().unwrap_or("world").to_uppercase();
                serde_json::json!({"id":s.id+i as i32+1,"name":format!("{} {}",s.name,suffix),"slug":slug})
            }).collect();
            { let p = solar_core::stars::photosphere(s.id); let spectral = solar_core::stars::record(s.id).and_then(|r| r.spectral).map(|x| x.0); serde_json::json!({"id":s.id,"name":s.name,"distance":s.distance,"worlds":worlds,"procedural":true,"teff":p.teff.round(),"spectral":spectral}) }
        }).collect();
        serde_json::to_string(&systems).unwrap()
    }
    /// The star model's two switches: the eye's adaptation to a star's disk, and the synthetic surface layer.
    /// How stars are drawn: 0 true colour, 1 the familiar composite (filtered views in false colour, labelled on screen).
    pub fn set_star_view(&mut self, view: u8) {
        self.world.star_view = view.min(1);
    }
    pub fn set_star_options(&mut self, adapt: bool, detail: bool) {
        self.world.star_adapt = adapt;
        self.world.star_detail = detail;
    }
    /// The exposure last given to the system star's disk (1: none).
    pub fn star_exposure(&self) -> f64 {
        self.world.star_exposure
    }
    /// A star's record and what the renderer derives from it, as JSON: catalogue values with their sources, the temperature
    /// used and where it came from, and the model's colour and limb darkening.
    pub fn star_info(id: i32) -> String {
        let r = solar_core::stars::record(id);
        let p = solar_core::stars::photosphere(id);
        let v = |x: Option<solar_core::stars::Sourced>| {
            x.map(|x| serde_json::json!({"value":x.value,"source":x.source}))
        };
        serde_json::json!({
            "id": id,
            "name": r.map(|r| r.name),
            "spectral": r.and_then(|r| r.spectral).map(|(c, s)| serde_json::json!({"value":c,"source":s})),
            "teff": r.and_then(|r| v(r.teff)),
            "radius": r.and_then(|r| v(r.radius)),
            "luminosity": r.and_then(|r| v(r.luminosity)),
            "teff_used": p.teff,
            "teff_origin": format!("{:?}", p.origin),
            "centre": p.centre, "linear": p.linear, "quadratic": p.quadratic, "tint": p.tint, "granule": p.granule,
        })
        .to_string()
    }
    pub fn table_span() -> Vec<f64> {
        solar_core::celestial::system().ephemeris.covered.to_vec()
    }
}
#[wasm_bindgen]
pub struct Explorer {
    r: Renderer,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    present: wgpu::RenderPipeline,
    present_sampler: wgpu::Sampler,
    bindings: wgpu::BindGroup,
    pending: Arc<AtomicU32>,
    completed: Arc<AtomicU32>,
    lost: Arc<Mutex<Option<String>>>,
    skipped: u64,
    /// Real time of frames that were not drawn (GPU backpressure, occluded surface),
    /// carried into the next drawn frame so simulation never loses it.
    carried: f64,
    profiling: bool,
    queue_depth: u32,
}
#[wasm_bindgen]
impl Explorer {
    #[wasm_bindgen(js_name=create)]
    /// `tier` selects the resident-cache allocation tier ("full", "reduced",
    /// "minimal"); it is fixed for the lifetime of the explorer. So is `world`,
    /// the body: "procedural" or "earth".
    pub async fn create(
        canvas: web_sys::OffscreenCanvas,
        tier: &str,
        world: &str,
    ) -> Result<Explorer, JsValue> {
        // A panic should say what it was, not "unreachable".
        std::panic::set_hook(Box::new(|info| wasm_bindgen::throw_str(&info.to_string())));
        let tier = crate::tier::Tier::named(tier).map_err(js)?;
        let r = Renderer::new(
            canvas.width().max(1),
            canvas.height().max(1),
            Settings {
                world: world.into(),
                ..Settings::default()
            },
            tier,
        )
        .await
        .map_err(js)?;
        crate::startup::mark("renderer");
        let g = &r.gpu;
        let surface = g
            .instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(js)?;
        let mut config = surface
            .get_default_config(&g.adapter, r.display_width, r.display_height)
            .ok_or_else(|| js("no canvas config"))?;
        let caps = surface.get_capabilities(&g.adapter);
        config.format = *caps
            .formats
            .iter()
            .find(|f| !f.is_srgb())
            .unwrap_or(&caps.formats[0]);
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&g.device, &config);
        let module = crate::startup::shader(g, "vertex");
        let present = g
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("native resolution display"),
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
                    targets: &[Some(wgpu::ColorTargetState {
                        format: config.format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
        let present_sampler = g.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("display resolve"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let bindings = Self::binding(&r, &present, &present_sampler);
        let lost = g.lost.clone();
        if let Some(error) = &*lost.lock().unwrap() {
            return Err(js(error));
        }
        crate::startup::mark("explorer");
        Ok(Self {
            r,
            surface,
            config,
            present,
            present_sampler,
            bindings,
            pending: Arc::new(AtomicU32::new(0)),
            completed: Arc::new(AtomicU32::new(0)),
            lost,
            skipped: 0,
            carried: 0.,
            profiling: false,
            // One callback can arrive a rAF later than GPU completion in WebGPU.
            // Two bounded slots avoid skipping alternate display frames.
            queue_depth: 2,
        })
    }
    pub fn enable_space(&mut self) {
        self.r.enable_space();
        self.bindings = Self::binding(&self.r, &self.present, &self.present_sampler);
    }
    /// One frame's packet from `SolarFlight`. Returns a body's NAIF code when it has just become the
    /// body in full detail, so the worker can point the field at it, and zero otherwise.
    pub fn space(&mut self, packet: &[f64]) -> Result<i32, JsValue> {
        self.r.apply_space(packet).map_err(js)
    }
    pub fn asteroids(&mut self, data: &[f32]) {
        self.r.space.load_asteroids(&self.r.gpu, data);
    }
    pub fn trails(&mut self, data: &[f32]) {
        self.r.space.set_trails(&self.r.gpu, data);
    }
    pub fn stars(&mut self, data: &[f32]) {
        self.r.space.load_stars(&self.r.gpu, data);
    }
    pub fn sky_face(
        &mut self,
        face: u32,
        top: &[u8],
        half: &[u8],
        scale: f32,
    ) -> Result<(), JsValue> {
        self.r
            .space
            .load_sky_face(&self.r.gpu, face, top, half, scale)
            .map_err(js)
    }
    pub fn body_map(&mut self, layer: u32, rgba: &[u8]) -> Result<(), JsValue> {
        self.r.space.load_map(&self.r.gpu, layer, rgba).map_err(js)
    }
    pub fn frame_queue_depth(&mut self, depth: u32) -> Result<(), JsValue> {
        if !(1..=2).contains(&depth) {
            return Err(js("frame queue depth must be one or two"));
        }
        self.queue_depth = depth;
        Ok(())
    }
    pub fn render(&mut self, camera: &[f64], dt: f64, time: f64) -> Result<bool, JsValue> {
        if let Some(e) = &*self.lost.lock().unwrap() {
            return Err(js(e));
        }
        if self.pending.load(Ordering::Relaxed) >= self.queue_depth {
            self.skipped += 1;
            if dt.is_finite() {
                self.carried = (self.carried + dt.max(0.)).min(1.);
            }
            return Ok(false);
        }
        if let Some(e) = &*self.lost.lock().unwrap() {
            return Err(js(e));
        }
        if ![6, 9].contains(&camera.len())
            || !dt.is_finite()
            || !(0.0..=1.0).contains(&dt)
            || !time.is_finite()
            || !(0.0..=1e6).contains(&time)
        {
            return Err(js("invalid camera epoch"));
        }
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                self.carried = (self.carried + dt).min(1.);
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.r.gpu.device, &self.config);
                self.carried = (self.carried + dt).min(1.);
                return Ok(false);
            }
            e => return Err(js(format!("surface {e:?}"))),
        };
        let dt = (dt + std::mem::take(&mut self.carried)).min(1.);
        self.r.time = time;
        self.r.camera_up = (camera.len() == 9).then(|| [camera[6], camera[7], camera[8]]);
        let slot = if self.profiling {
            self.r.timing.acquire()
        } else {
            None
        };
        let mut encoder = self
            .r
            .gpu
            .device
            .create_command_encoder(&Default::default());
        self.r
            .encode(
                &mut encoder,
                [
                    [camera[0], camera[1], camera[2]],
                    [camera[3], camera[4], camera[5]],
                ],
                dt,
                slot,
            )
            .map_err(js)?;
        {
            let view = frame.texture.create_view(&Default::default());
            let q = slot.and_then(|i| self.r.timing.slots[i].queries.as_ref());
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("canvas"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: q.map(|q| wgpu::RenderPassTimestampWrites {
                    query_set: q,
                    beginning_of_pass_write_index: Some(16),
                    end_of_pass_write_index: Some(17),
                }),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.present);
            pass.set_bind_group(0, &self.bindings, &[]);
            pass.draw(0..3, 0..1);
        }
        self.r.marker.mark(&mut encoder, "canvas");
        self.r.frame_end_stamp(&mut encoder, slot);
        if let Some(i) = slot {
            self.r.timing.resolve(i, &mut encoder);
        }
        self.pending.fetch_add(1, Ordering::Relaxed);
        self.r.gpu.queue.submit([encoder.finish()]);
        self.r.gpu.queue.present(frame);
        self.r.submit_timing(slot);
        let pending = self.pending.clone();
        let completed = self.completed.clone();
        self.r.gpu.queue.on_submitted_work_done(move || {
            pending.fetch_sub(1, Ordering::Relaxed);
            completed.fetch_add(1, Ordering::Relaxed);
        });
        Ok(true)
    }
    pub fn source_limits(&mut self, height: u32, albedo: u32) {
        let earth = self.r.body.naif == 399;
        self.r
            .pages
            .source_limits(height.min(16) as u8, albedo.min(16) as u8, earth);
    }
    pub fn configure(&mut self, json: &str) -> Result<(), JsValue> {
        self.r
            .configure(serde_json::from_str(json).map_err(js)?)
            .map_err(js)?;
        self.bindings = Self::binding(&self.r, &self.present, &self.present_sampler);
        Ok(())
    }
    pub fn settings(&self) -> String {
        serde_json::to_string(&self.r.settings).unwrap()
    }
    pub fn animation(&self) -> String {
        serde_json::to_string(&self.r.cloud_clock).unwrap()
    }
    pub fn restore_animation(&mut self, json: &str) -> Result<(), JsValue> {
        let clock: crate::animation::CloudClock = serde_json::from_str(json).map_err(js)?;
        clock.validate().map_err(js)?;
        self.r.cloud_clock = clock;
        self.r.cloud_force_refresh = true;
        Ok(())
    }
    pub fn bookmark(&self, name: &str) -> String {
        serde_json::to_string(&self.r.bookmark(name)).unwrap()
    }
    pub fn height(&self, x: f64, y: f64, z: f64) -> f64 {
        self.r.height([x, y, z])
    }
    pub fn safe_height(&self, x: f64, y: f64, z: f64) -> f64 {
        self.r.safe_height([x, y, z])
    }
    pub fn radius(&self) -> f64 {
        self.r.skin.radius
    }
    pub fn resize(&mut self, w: u32, h: u32) -> Result<(), JsValue> {
        self.r.resize(w, h).map_err(js)?;
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.r.gpu.device, &self.config);
        self.bindings = Self::binding(&self.r, &self.present, &self.present_sampler);
        Ok(())
    }
    pub fn building_sources(&mut self, records: Vec<u8>, points: Vec<u8>) -> Result<(), JsValue> {
        self.r.building_sources(&records, &points).map_err(js)
    }
    /// Requests and cancellations for the field worker, as JSON, or nothing.
    pub fn page_commands(&mut self) -> Option<String> {
        self.r.pages.take_commands()
    }
    /// The water layer page of a height page (docs/WATER-LAYER.md), right after it. kind: -1 texels (bytes),
    /// -2 no water within the band, 0..3 one body of that kind over the whole page at `level`.
    #[allow(clippy::too_many_arguments)]
    pub fn water_page_arrived(
        &mut self,
        face: u8,
        level: u8,
        x: u32,
        y: u32,
        level_offset: f32,
        level_scale: f32,
        kind: i32,
        uniform_level: f32,
        bytes: Vec<u8>,
    ) -> Result<(), JsValue> {
        self.r
            .pages
            .water_page_arrived(
                page_key(face, level, x, y),
                level_offset,
                level_scale,
                kind,
                uniform_level,
                bytes,
            )
            .map_err(js)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn page_arrived(
        &mut self,
        channel: u8,
        face: u8,
        level: u8,
        x: u32,
        y: u32,
        offset: f32,
        scale: f32,
        sources: u8,
        bytes: Vec<u8>,
        water: Vec<f32>,
    ) -> Result<(), JsValue> {
        self.r
            .pages
            .page_arrived(
                channel,
                page_key(face, level, x, y),
                offset,
                scale,
                sources,
                bytes,
                water,
            )
            .map_err(js)
    }
    pub fn page_missing(&mut self, channel: u8, face: u8, level: u8, x: u32, y: u32) {
        self.r
            .pages
            .page_missing(channel, page_key(face, level, x, y));
    }
    pub fn page_failed(&mut self, channel: u8, face: u8, level: u8, x: u32, y: u32) {
        self.r
            .pages
            .page_failed(channel, page_key(face, level, x, y));
    }
    pub fn page_throughput(&mut self, bytes_per_second: f64) {
        self.r.pages.observe_throughput(bytes_per_second);
    }
    pub fn page_backlog(&mut self, pages: u32) {
        self.r.pages.lag.pages_queued = pages;
    }
    /// Height of the canonical surface under the camera, for the page's camera constraint.
    pub fn ground_height(&self) -> f64 {
        self.r.ground_height
    }
    pub fn stats(&self) -> String {
        let mut s = self.r.stats();
        let memory: js_sys::WebAssembly::Memory = wasm_bindgen::memory().unchecked_into();
        s["wasm_heap_bytes"] = js_sys::Uint8Array::new(&memory.buffer()).length().into();
        s["pending"] = self.pending.load(Ordering::Relaxed).into();
        s["in_flight_limit"] = self.queue_depth.into();
        s["completed"] = self.completed.load(Ordering::Relaxed).into();
        s["skipped"] = self.skipped.into();
        s["device_lost"] = serde_json::json!(*self.lost.lock().unwrap());
        s.to_string()
    }
    pub fn telemetry(&self) -> String {
        serde_json::to_string(&self.r.timing.drain()).unwrap()
    }
    pub fn profiling(&mut self, on: bool) {
        self.profiling = on;
    }
    /// Explicit numerical test hook. Normal play always uses the zero bias.
    pub fn audit_rebase(&mut self, x: f64, y: f64, z: f64) -> Result<(), JsValue> {
        let bias = [x, y, z];
        if bias
            .iter()
            .any(|v| !v.is_finite() || v.abs() > 8192.0 || v % 4096.0 != 0.0)
        {
            return Err(js("invalid audit anchor offset"));
        }
        self.r.audit_origin_bias = bias;
        Ok(())
    }
    pub async fn capture(&self, kind: &str) -> Result<Vec<u8>, JsValue> {
        self.r.capture(kind).await.map_err(js)
    }
    pub fn destroy_device(&self) {
        self.r.gpu.device.destroy();
    }
    /// Promise for completion of everything submitted so far. Unlike the async
    /// `wait_idle`, this borrows the explorer only while registering the
    /// callback, so the worker can keep one frame in flight while encoding the
    /// next without tripping wasm-bindgen's aliasing guard.
    /// Create any deferred feature whose programs the browser finished
    /// compiling; returns the JSON list of features still pending.
    pub fn complete_pending(&mut self) -> String {
        self.r.complete_features();
        serde_json::to_string(&self.r.pending_features()).unwrap_or_default()
    }
    pub fn completion(&self) -> js_sys::Promise {
        let (tx, rx) = futures_channel::oneshot::channel();
        self.r.gpu.queue.on_submitted_work_done(move || {
            let _ = tx.send(());
        });
        let lost = self.lost.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            rx.await.map_err(js)?;
            if let Some(error) = &*lost.lock().unwrap() {
                return Err(js(error));
            }
            Ok(JsValue::UNDEFINED)
        })
    }
    pub async fn wait_idle(&self) -> Result<(), JsValue> {
        let (tx, rx) = futures_channel::oneshot::channel();
        self.r.gpu.queue.on_submitted_work_done(move || {
            let _ = tx.send(());
        });
        rx.await.map_err(js)?;
        if let Some(error) = &*self.lost.lock().unwrap() {
            return Err(js(error));
        }
        Ok(())
    }
    pub async fn audit_geometry(&self) -> Result<String, JsValue> {
        Ok(self.r.audit_geometry().await.map_err(js)?.to_string())
    }
    pub async fn audit_shadows(&self) -> Result<String, JsValue> {
        Ok(self.r.audit_shadows().await.map_err(js)?.to_string())
    }
    pub async fn audit_shadow_points(&self, points: &[f64]) -> Result<String, JsValue> {
        Ok(self
            .r
            .audit_shadow_points(points)
            .await
            .map_err(js)?
            .to_string())
    }
    pub async fn audit_cover_fade(&self, details: Option<bool>) -> Result<String, JsValue> {
        let bytes = self
            .r
            .read_buffer(&self.r.scenery.state)
            .await
            .map_err(js)?;
        let state = crate::scenery::Scenery::decode_stats(&bytes);
        let cover = self
            .r
            .read_buffer(&self.r.scenery.cover)
            .await
            .map_err(js)?;
        let mut count = 0;
        let mut fading = 0;
        let mut visibility = 0.;
        let mut far = 0_f32;
        let mut records = Vec::new();
        for (list, base) in crate::scenery::COVER_BASES.into_iter().enumerate() {
            let n = state["cover"]["draws"][list].as_u64().unwrap_or(0) as usize;
            for i in base..base + n {
                let word = |j: usize| {
                    u32::from_le_bytes(
                        cover[i * 32 + j * 4..i * 32 + j * 4 + 4]
                            .try_into()
                            .unwrap(),
                    )
                };
                let fade = (f32::from_bits(word(3)) as u32 >> 12) as f32 / 4095.;
                count += 1;
                visibility += fade;
                if fade < 0.99 {
                    fading += 1;
                }
                let distance = (0..3)
                    .map(|j| f32::from_bits(word(j)).powi(2))
                    .sum::<f32>()
                    .sqrt();
                far = far.max(distance);
                if details == Some(true) {
                    let position: Vec<_> = (0..3).map(|j| f32::from_bits(word(j))).collect();
                    records.push(serde_json::json!({"seed":word(6),"kind":word(7),"list":list,"position":position,"fade":fade,"lod":(f32::from_bits(word(3)) as u32 & 4095) as f32 / 4095.}));
                }
            }
        }
        Ok(serde_json::json!({"records":records,"eye":self.r.last_camera,"count":count,"fading":fading,"mean_visibility":visibility/(count.max(1) as f32),"farthest_m":far,"overflow":state["cover"]["overflow"]}).to_string())
    }
    pub async fn audit_scenery(&self) -> Result<String, JsValue> {
        Ok(self.r.audit_scenery().await.map_err(js)?.to_string())
    }
    pub async fn audit_water(&self) -> Result<String, JsValue> {
        Ok(self.r.audit_water().await.map_err(js)?.to_string())
    }
    pub async fn audit_progress(&self) -> Result<String, JsValue> {
        Ok(self.r.audit_progress().await.map_err(js)?.to_string())
    }
    pub async fn audit_lod(&self) -> Result<String, JsValue> {
        Ok(self.r.audit_lod().await.map_err(js)?.to_string())
    }
}
impl Explorer {
    fn binding(r: &Renderer, p: &wgpu::RenderPipeline, sampler: &wgpu::Sampler) -> wgpu::BindGroup {
        r.gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("display pixels"),
            layout: &p.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&r.targets.display.view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
            ],
        })
    }
}

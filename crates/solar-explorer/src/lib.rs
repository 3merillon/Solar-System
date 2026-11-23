//! Playable single-skin renderer. The archived field tracer is not a dependency.
pub mod animation;
pub mod audit;
#[cfg(target_arch = "wasm32")]
pub mod browser;
mod clouds;
pub mod data_lag;
pub mod finish;
#[path = "../../solar-probe/src/gpu.rs"]
pub mod gpu;
pub mod gpu_terrain;
pub mod pages;
pub mod renderer;
pub mod scenery;
pub mod solar;
pub mod space;
pub mod startup;
pub mod sun;
pub mod tier;
pub mod timing;
pub mod water;
pub mod world;
#[cfg(not(target_arch = "wasm32"))]
pub fn now_ms() -> f64 {
    use std::sync::OnceLock;
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1000.0
}
#[cfg(target_arch = "wasm32")]
pub fn now_ms() -> f64 {
    use wasm_bindgen::JsCast;
    js_sys::Reflect::get(&js_sys::global(), &"performance".into())
        .ok()
        .and_then(|p| p.dyn_into::<web_sys::Performance>().ok())
        .map_or_else(js_sys::Date::now, |p| p.now())
}
pub mod scenery_reference;

pub mod buildings;
pub mod urban;

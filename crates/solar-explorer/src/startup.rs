//! Build-specialized shaders and the browser's asynchronous compiler bridge.
include!(concat!(env!("OUT_DIR"), "/shaders.rs"));
// Cargo's timestamp cache can retain generated shaders after a restored file or
// a checkout sharing target/. Never compile fresh resource layouts around stale
// generated WGSL. This compares bytes, independently of build-script metadata.
#[allow(long_running_const_eval)]
const _: () = {
    let a = COMPILED_SOURCE;
    let b = crate::scenery::SOURCE.as_bytes();
    assert!(
        a.len() == b.len(),
        "Generated WGSL length is stale; rebuild solar-explorer's build script"
    );
    let mut i = 0;
    while i < a.len() {
        assert!(
            a[i] == b[i],
            "Generated WGSL is stale; rebuild solar-explorer's build script"
        );
        i += 1;
    }
};
pub fn shader(g: &crate::gpu::Gpu, key: &str) -> wgpu::ShaderModule {
    g.device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(key),
        source: wgpu::ShaderSource::Wgsl(source(key).into()),
    })
}
pub async fn prepare(g: &crate::gpu::Gpu) -> Result<(), String> {
    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen::JsCast;
        let f = js_sys::Reflect::get(&js_sys::global(), &"solarCompilePipelines".into())
            .map_err(|e| format!("{e:?}"))?;
        let f = f
            .dyn_into::<js_sys::Function>()
            .map_err(|_| "GPU initialization must run in the render worker")?;
        let device = g
            .device
            .as_webgpu()
            .ok_or("browser GPU device unavailable")?;
        let promise = f
            .call2(
                &wasm_bindgen::JsValue::NULL,
                device,
                &include_str!(concat!(env!("OUT_DIR"), "/pipelines.json")).into(),
            )
            .map_err(|e| format!("{e:?}"))?;
        wasm_bindgen_futures::JsFuture::from(js_sys::Promise::from(promise))
            .await
            .map_err(|e| format!("{e:?}"))?;
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = g;
    Ok(())
}
/// A named point of renderer construction, timed by the worker (`solarStartupMark`) and reported with the
/// startup record (docs/STARTUP.md). No effect natively or without the hook.
pub fn mark(label: &str) {
    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen::JsCast;
        if let Ok(f) = js_sys::Reflect::get(&js_sys::global(), &"solarStartupMark".into()) {
            if let Ok(f) = f.dyn_into::<js_sys::Function>() {
                let _ = f.call1(&wasm_bindgen::JsValue::NULL, &label.into());
            }
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = label;
}
/// Whether the browser bridge has finished compiling `key`. Native builds
/// create pipelines synchronously, so every program is always ready.
pub fn pipeline_ready(key: &str) -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen::JsCast;
        let Ok(f) = js_sys::Reflect::get(&js_sys::global(), &"solarPipelineReady".into()) else {
            return true;
        };
        let Ok(f) = f.dyn_into::<js_sys::Function>() else {
            return true;
        };
        f.call1(&wasm_bindgen::JsValue::NULL, &key.into())
            .map(|v| v.is_truthy())
            .unwrap_or(true)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = key;
        true
    }
}

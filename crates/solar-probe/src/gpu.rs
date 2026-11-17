//! Shared native/browser device and bounded readback utilities.
use std::sync::{Arc, Mutex};
pub struct Gpu {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub timestamps: bool,
    pub lost: Arc<Mutex<Option<String>>>,
    /// Native Vulkan pipeline cache loaded from disk when the driver exposes
    /// one; browsers keep their own shader cache keyed by source text.
    pub pipeline_cache: Option<wgpu::PipelineCache>,
    pub pipeline_cache_path: Option<std::path::PathBuf>,
}
impl Gpu {
    pub async fn new() -> Result<Self, String> {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = if cfg!(target_arch = "wasm32") {
            wgpu::Backends::BROWSER_WEBGPU
        } else {
            wgpu::Backends::PRIMARY
        };
        let instance = wgpu::Instance::new(desc);
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                ..Default::default()
            })
            .await
            .map_err(|e| e.to_string())?;
        let timestamps = adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY);
        let mut features = if timestamps {
            wgpu::Features::TIMESTAMP_QUERY
        } else {
            wgpu::Features::empty()
        };
        let cacheable = !cfg!(target_arch = "wasm32")
            && adapter.features().contains(wgpu::Features::PIPELINE_CACHE);
        if cacheable {
            features |= wgpu::Features::PIPELINE_CACHE;
        }
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Solar-System v2 field engine"),
                required_features: features,
                ..Default::default()
            })
            .await
            .map_err(|e| e.to_string())?;
        let lost = Arc::new(Mutex::new(None));
        let lost_callback = lost.clone();
        device.set_device_lost_callback(move |reason, message| {
            *lost_callback.lock().unwrap() =
                Some(format!("GPU device lost ({reason:?}): {message}"));
        });
        let (pipeline_cache, pipeline_cache_path) = if cacheable {
            Self::load_pipeline_cache(&adapter, &device)
        } else {
            (None, None)
        };
        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            timestamps,
            lost,
            pipeline_cache,
            pipeline_cache_path,
        })
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn load_pipeline_cache(
        adapter: &wgpu::Adapter,
        device: &wgpu::Device,
    ) -> (Option<wgpu::PipelineCache>, Option<std::path::PathBuf>) {
        let Some(key) = wgpu::util::pipeline_cache_key(&adapter.get_info()) else {
            return (None, None);
        };
        let dir = std::env::var_os("SOLAR_PIPELINE_CACHE_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from("target/pipeline-cache"));
        let path = dir.join(format!("{key}.bin"));
        let data = std::fs::read(&path).ok();
        // SAFETY: the data was produced by `PipelineCache::get_data` for the
        // same adapter key; the driver validates its header and `fallback`
        // discards anything it rejects.
        let cache = unsafe {
            device.create_pipeline_cache(&wgpu::PipelineCacheDescriptor {
                label: Some("solar native pipeline cache"),
                data: data.as_deref(),
                fallback: true,
            })
        };
        (Some(cache), Some(path))
    }
    #[cfg(target_arch = "wasm32")]
    fn load_pipeline_cache(
        _adapter: &wgpu::Adapter,
        _device: &wgpu::Device,
    ) -> (Option<wgpu::PipelineCache>, Option<std::path::PathBuf>) {
        (None, None)
    }
    pub fn cache(&self) -> Option<&wgpu::PipelineCache> {
        self.pipeline_cache.as_ref()
    }
    /// Persist the native pipeline cache after pipeline creation. Returns the
    /// byte count written, or None when the backend has no cache.
    pub fn persist_pipeline_cache(&self) -> Result<Option<usize>, String> {
        let (Some(cache), Some(path)) = (&self.pipeline_cache, &self.pipeline_cache_path) else {
            return Ok(None);
        };
        let Some(data) = cache.get_data() else {
            return Ok(None);
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, &data).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
        Ok(Some(data.len()))
    }
    pub fn buffer(&self, label: &str, size: u64, usage: wgpu::BufferUsages) -> wgpu::Buffer {
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage,
            mapped_at_creation: false,
        })
    }
    pub async fn read(&self, buffer: &wgpu::Buffer) -> Result<Vec<u8>, String> {
        let (tx, rx) = futures_channel::oneshot::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        #[cfg(not(target_arch = "wasm32"))]
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| e.to_string())?;
        rx.await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let data = buffer
            .slice(..)
            .get_mapped_range()
            .map_err(|e| e.to_string())?
            .to_vec();
        buffer.unmap();
        Ok(data)
    }
}

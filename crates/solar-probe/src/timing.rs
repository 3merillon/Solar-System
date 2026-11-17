//! Four bounded, asynchronous timestamp slots. No image/counter readback.
use crate::gpu::Gpu;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Clone, serde::Serialize)]
pub struct Sample {
    pub id: u64,
    pub cpu_camera_ms: f64,
    pub cpu_encode_ms: f64,
    pub submit_ms: f64,
    pub completion_ms: f64,
    pub input_age_at_submit_ms: f64,
    pub gpu_pass_ms: Option<[f64; 4]>,
    pub error: Option<String>,
}
pub struct Slot {
    pub queries: Option<wgpu::QuerySet>,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    busy: Arc<Mutex<bool>>,
}
pub struct TimingRing {
    pub slots: Vec<Slot>,
    samples: Arc<Mutex<VecDeque<Sample>>>,
    overwritten: Arc<Mutex<u64>>,
}
impl TimingRing {
    pub fn new(g: &Gpu) -> Self {
        Self {
            slots: (0..4)
                .map(|_| Slot {
                    queries: g.timestamps.then(|| {
                        g.device.create_query_set(&wgpu::QuerySetDescriptor {
                            label: Some("asynchronous frame timestamps"),
                            ty: wgpu::QueryType::Timestamp,
                            count: 8,
                        })
                    }),
                    resolve: g.buffer(
                        "timestamp resolve slot",
                        64,
                        wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                    ),
                    read: g.buffer(
                        "timestamp read slot",
                        64,
                        wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    ),
                    busy: Arc::new(Mutex::new(false)),
                })
                .collect(),
            samples: Arc::new(Mutex::new(VecDeque::with_capacity(512))),
            overwritten: Arc::new(Mutex::new(0)),
        }
    }
    pub fn acquire(&self) -> Option<usize> {
        self.slots.iter().position(|slot| {
            let mut busy = slot.busy.lock().unwrap();
            if *busy {
                false
            } else {
                *busy = true;
                true
            }
        })
    }
    pub fn resolve(&self, i: usize, encoder: &mut wgpu::CommandEncoder) {
        let slot = &self.slots[i];
        if let Some(q) = &slot.queries {
            encoder.resolve_query_set(q, 0..8, &slot.resolve, 0);
            encoder.copy_buffer_to_buffer(&slot.resolve, 0, &slot.read, 0, 64);
        }
    }
    pub fn submitted(&self, i: usize, g: &Gpu, mut sample: Sample) {
        let slot = &self.slots[i];
        let read = slot.read.clone();
        let busy = slot.busy.clone();
        let samples = self.samples.clone();
        let overwritten = self.overwritten.clone();
        if slot.queries.is_none() {
            g.queue.on_submitted_work_done(move || {
                sample.completion_ms = crate::now_ms();
                let mut rows = samples.lock().unwrap();
                if rows.len() == 512 {
                    rows.pop_front();
                    *overwritten.lock().unwrap() += 1;
                }
                rows.push_back(sample);
                *busy.lock().unwrap() = false;
            });
            return;
        }
        let period = f64::from(g.queue.get_timestamp_period()) / 1e6;
        let finish = move |result: Result<(), String>| {
            sample.completion_ms = crate::now_ms();
            match result {
                Ok(()) => match read.slice(..).get_mapped_range() {
                    Ok(bytes) => {
                        let t: &[u64] = bytemuck::cast_slice(&bytes);
                        if (0..4).any(|k| t[k * 2 + 1] < t[k * 2]) {
                            sample.error = Some("Nonmonotonic GPU timestamp pair".into());
                        } else {
                            sample.gpu_pass_ms = Some(std::array::from_fn(|k| {
                                (t[k * 2 + 1] - t[k * 2]) as f64 * period
                            }));
                        }
                    }
                    Err(e) => sample.error = Some(e.to_string()),
                },
                Err(e) => sample.error = Some(e),
            }
            read.unmap();
            let mut rows = samples.lock().unwrap();
            if rows.len() == 512 {
                rows.pop_front();
                *overwritten.lock().unwrap() += 1;
            }
            rows.push_back(sample);
            *busy.lock().unwrap() = false;
        };
        slot.read
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |r| {
                finish(r.map_err(|e| e.to_string()))
            });
    }
    pub fn drain(&self) -> Vec<Sample> {
        self.samples.lock().unwrap().drain(..).collect()
    }
    pub fn overwritten(&self) -> u64 {
        *self.overwritten.lock().unwrap()
    }
    pub fn resident_bytes(&self) -> u64 {
        4 * 192 + 512 * std::mem::size_of::<Sample>() as u64
    }
}

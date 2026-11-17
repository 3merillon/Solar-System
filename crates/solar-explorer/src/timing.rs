//! Bounded asynchronous per-pass timestamps, independent of image readbacks.
use crate::gpu::Gpu;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
pub const STAGES: usize = 31;
// Two additional timestamps bracket ALL work, including the solar renderer
// before surface scheduling. They fit the existing 512-byte readback slots.
pub const FRAME_BEGIN: u32 = (STAGES * 2) as u32;
pub const FRAME_END: u32 = FRAME_BEGIN + 1;
/// Sequential timeline markers after the stage pairs: each mark is an empty pass
/// stamped at its beginning, so consecutive intervals partition the whole frame
/// (FRAME_BEGIN .. marks .. FRAME_END) and add up to the span by construction.
pub const MARKS: usize = 96;
pub const MARK_BASE: u32 = FRAME_END + 1;
pub const QUERIES: u32 = MARK_BASE + MARKS as u32;
const SLOT_BYTES: u64 = (QUERIES as u64 * 8).div_ceil(256) * 256;
/// Per-frame list of timeline labels, written as the frame is encoded.
#[derive(Default)]
pub struct Marker {
    pub set: Option<wgpu::QuerySet>,
    pub labels: Vec<&'static str>,
}
impl Marker {
    pub fn begin(&mut self, set: Option<&wgpu::QuerySet>) {
        self.set = set.cloned();
        self.labels.clear();
    }
    /// Stamps the end of the work encoded since the previous mark under `label`.
    pub fn mark(&mut self, e: &mut wgpu::CommandEncoder, label: &'static str) {
        let Some(set) = &self.set else { return };
        if self.labels.len() >= MARKS {
            return;
        }
        let index = MARK_BASE + self.labels.len() as u32;
        self.labels.push(label);
        let _p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some(label),
            timestamp_writes: Some(wgpu::ComputePassTimestampWrites {
                query_set: set,
                beginning_of_pass_write_index: Some(index),
                end_of_pass_write_index: None,
            }),
        });
    }
    pub fn take(&mut self) -> Vec<&'static str> {
        self.set = None;
        std::mem::take(&mut self.labels)
    }
}
pub const NAMES: [&str; STAGES] = [
    "gpu_scheduling",
    "generation",
    "topology",
    "raster",
    "shading",
    "water",
    "clouds",
    "atmosphere_reconstruction",
    "presentation",
    "scenery_placement",
    "scenery_generation",
    "scenery_atlas",
    "scenery_culling_support",
    "scenery_raster",
    "scenery_shading",
    "scenery_atlas_filter",
    "ground_cover",
    "sun_height_cache",
    "sun_scenery_raster_0",
    "cloud_fields",
    "sun_cloud_global",
    "sun_cloud_local",
    "sun_caster_selection",
    "sun_scenery_raster_1",
    "sun_scenery_raster_2",
    "sun_scenery_raster_3",
    "sun_scenery_raster_4",
    "sun_scenery_raster_5",
    "cloud_volume",
    "building_support",
    "building_raster",
];
#[derive(Clone, serde::Serialize)]
pub struct Sample {
    pub id: u64,
    pub surface_stages: bool,
    pub cpu_schedule_ms: f64,
    pub cpu_encode_ms: f64,
    pub submit_ms: f64,
    pub completion_ms: f64,
    pub gpu_ms: Option<[f64; STAGES]>,
    /// Whole encoded frame through presentation, including solar work and copies.
    pub gpu_span_ms: Option<f64>,
    pub generated: Option<usize>,
    pub patches: Option<usize>,
    pub error: Option<String>,
    /// Timeline: (label, ms since the previous mark), the last row ending at FRAME_END.
    pub marks: Vec<(&'static str, f64)>,
    #[serde(skip)]
    pub mark_labels: Vec<&'static str>,
}
pub struct Slot {
    pub queries: Option<wgpu::QuerySet>,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    busy: Arc<Mutex<bool>>,
}
pub struct Timing {
    pub slots: Vec<Slot>,
    samples: Arc<Mutex<VecDeque<Sample>>>,
    pub skipped: u64,
}
impl Timing {
    pub fn new(g: &Gpu) -> Self {
        Self {
            slots: (0..4)
                .map(|_| Slot {
                    queries: g.timestamps.then(|| {
                        g.device.create_query_set(&wgpu::QuerySetDescriptor {
                            label: Some("explorer stages"),
                            ty: wgpu::QueryType::Timestamp,
                            count: QUERIES,
                        })
                    }),
                    resolve: g.buffer(
                        "resolve",
                        SLOT_BYTES,
                        wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                    ),
                    read: g.buffer(
                        "timing",
                        SLOT_BYTES,
                        wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    ),
                    busy: Arc::new(Mutex::new(false)),
                })
                .collect(),
            samples: Arc::new(Mutex::new(VecDeque::with_capacity(512))),
            skipped: 0,
        }
    }
    pub fn acquire(&mut self) -> Option<usize> {
        let result = self.slots.iter().position(|s| {
            let mut b = s.busy.lock().unwrap();
            if *b {
                false
            } else {
                *b = true;
                true
            }
        });
        if result.is_none() {
            self.skipped += 1;
        }
        result
    }
    pub fn resolve(&self, i: usize, e: &mut wgpu::CommandEncoder) {
        let s = &self.slots[i];
        if let Some(q) = &s.queries {
            e.resolve_query_set(q, 0..QUERIES, &s.resolve, 0);
            e.copy_buffer_to_buffer(&s.resolve, 0, &s.read, 0, SLOT_BYTES);
        }
    }
    pub fn submitted(&self, i: usize, g: &Gpu, mut sample: Sample) {
        let s = &self.slots[i];
        let read = s.read.clone();
        let busy = s.busy.clone();
        let rows = self.samples.clone();
        let period = f64::from(g.queue.get_timestamp_period()) / 1e6;
        if s.queries.is_none() {
            g.queue.on_submitted_work_done(move || {
                sample.completion_ms = crate::now_ms();
                let mut r = rows.lock().unwrap();
                if r.len() == 512 {
                    r.pop_front();
                }
                r.push_back(sample);
                *busy.lock().unwrap() = false;
            });
            return;
        }
        s.read
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                sample.completion_ms = crate::now_ms();
                match result {
                    Ok(()) => {
                        match read.slice(..).get_mapped_range() {
                            Ok(bytes) => {
                                let t: &[u64] = bytemuck::cast_slice(&bytes);
                                if t[FRAME_END as usize] >= t[FRAME_BEGIN as usize] {
                                    sample.gpu_span_ms = Some(
                                        (t[FRAME_END as usize] - t[FRAME_BEGIN as usize]) as f64
                                            * period,
                                    );
                                }
                                {
                                    let mut prev = t[FRAME_BEGIN as usize];
                                    let labels = std::mem::take(&mut sample.mark_labels);
                                    let mut marks = Vec::with_capacity(labels.len() + 1);
                                    let mut ok = true;
                                    for (k, l) in labels.iter().enumerate() {
                                        let v = t[MARK_BASE as usize + k];
                                        ok &= v >= prev;
                                        marks.push((*l, v.saturating_sub(prev) as f64 * period));
                                        prev = v.max(prev);
                                    }
                                    let end = t[FRAME_END as usize];
                                    ok &= end >= prev;
                                    marks.push((
                                        "frame_end",
                                        end.saturating_sub(prev) as f64 * period,
                                    ));
                                    if ok {
                                        sample.marks = marks;
                                    }
                                }
                                if !sample.surface_stages {
                                    // Space-only frames do not execute the surface passes;
                                    // their old query-slot contents are not current costs.
                                } else if (0..STAGES).all(|j| t[2 * j + 1] >= t[2 * j]) {
                                    sample.gpu_ms = Some(std::array::from_fn(|j| {
                                        (t[2 * j + 1] - t[2 * j]) as f64 * period
                                    }));
                                } else {
                                    sample.error = Some("nonmonotonic timestamps".into());
                                }
                            }
                            Err(e) => sample.error = Some(e.to_string()),
                        }
                        read.unmap();
                    }
                    Err(e) => sample.error = Some(e.to_string()),
                }
                let mut r = rows.lock().unwrap();
                if r.len() == 512 {
                    r.pop_front();
                }
                r.push_back(sample);
                *busy.lock().unwrap() = false;
            });
    }
    pub fn drain(&self) -> Vec<Sample> {
        self.samples.lock().unwrap().drain(..).collect()
    }
}

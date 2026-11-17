//! Streaming health, exposed rather than hidden. These are CPU counters the page
//! scheduler keeps; reporting them adds no GPU work and no readback. A procedural
//! body answers every query analytically, so all of them stay zero there.
use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct DataLag {
    /// Page groups the camera currently wants, and those resident.
    pub pages_wanted: u32,
    pub pages_resident: u32,
    pub pages_in_flight: u32,
    /// Requests that failed, and sources that answered that a level does not exist.
    pub pages_failed: u64,
    pub pages_not_found: u64,
    /// Requests cancelled because the camera no longer wanted the page.
    pub pages_cancelled: u64,
    pub pages_uploaded: u64,
    pub bytes_uploaded: u64,
    /// Frames on which the upload budget left arrived pages waiting.
    pub upload_deferred_frames: u64,
    /// Finished pages waiting for the upload budget.
    pub pages_queued: u32,
    /// Pages that arrived when the pool held only wanted pages: the finest detail lost out.
    pub pool_overflow: u64,
    /// Pages this camera would want that lie past what the pool can hold, now: not fetched.
    pub pages_over_pool: u32,
    /// Levels between the finest level wanted under the camera and the one served.
    pub camera_level_deficit: u32,
    pub camera_albedo_deficit: u32,
    /// GPU readbacks requested. Only profiling asks for them: normal play stays zero.
    pub readback_requests: u64,
}

//! The canonical surface as the CPU sees it. Every query answers at once from what
//! the source holds and says what served it; a missing page means a coarser answer,
//! never a wait. Unknown bounds stay `None`, because fixed storage and sampled pages
//! do not bound what they have not seen. Independent of the renderer.
use crate::field::{self, V3};

/// What answered a field query.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Served {
    /// An analytic source: the requested filter was evaluated exactly.
    Analytic,
    /// A measured page of this level answered, possibly coarser than requested.
    Page { level: u8 },
    /// A measured source with nothing resident here yet: the reference sphere answered.
    Nothing,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FieldAnswer {
    pub height: f64,
    pub served: Served,
}
/// Error accounting of one sun height clipmap level. `conservative` says whether the
/// figures are an engineering bound or an explicitly non-conservative estimate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClipmapEnvelope {
    /// Interpolation of every cached band, the producer's omitted spectrum and guard.
    pub full: f64,
    /// The same after live bands are evaluated exactly: cached bands only.
    pub live: f64,
    /// How far a crest can rise above a texel-centre sample within one texel.
    pub margin: f64,
    pub conservative: bool,
}
pub trait SurfaceSource {
    /// Reference sphere radius, metres.
    fn radius(&self) -> f64;
    /// Height above the reference sphere at unit direction `n`, filtered to `spacing`
    /// metres. Zero asks for the finest thing the source has.
    fn query(&self, n: V3, spacing: f64) -> FieldAnswer;
    /// Bound of |height| over the body.
    fn height_bound(&self) -> Option<f64>;
    /// Bound of the radial surface gradient over the body.
    fn gradient_bound(&self) -> Option<f64>;
    /// Bound of interpolated mesh height error at a patch level.
    fn level_error_bound(&self, level: u32) -> Option<f64>;
    fn clipmap_envelope(&self, step: f64, live_start: usize) -> ClipmapEnvelope;

    /// Conservative interval of the finest height this source serves (`query(_, 0.0)`) over
    /// every unit direction within `radius` metres of arc, on the reference sphere, of `n`.
    /// `None` when no bound is known; a caller must then treat contact as possible.
    /// This is a bound on the served surface, not on the true terrain it approximates.
    fn region_bounds(&self, _n: V3, _radius: f64) -> Option<(f64, f64)> {
        None
    }
    fn height(&self, n: V3, spacing: f64) -> f64 {
        self.query(n, spacing).height
    }
    /// Height of a mesh vertex at a patch level, as the GPU generates it.
    fn mesh_height(&self, n: V3, level: u32) -> f64 {
        self.height(n, self.spacing(level))
    }
    /// The page level behind `mesh_height`, for sources made of pages.
    fn mesh_served(&self, _n: V3, _level: u32) -> Option<u8> {
        None
    }
    fn position(&self, n: V3, spacing: f64) -> V3 {
        field::mul(n, self.radius() + self.height(n, spacing))
    }
    /// Vertex spacing of a patch level at a cube face centre, metres.
    fn spacing(&self, level: u32) -> f64 {
        self.radius() * 2.0 / f64::from(crate::patches::GRID << level)
    }
}

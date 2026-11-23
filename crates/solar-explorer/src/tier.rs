//! Resident-cache allocation tiers. A tier is chosen once when the renderer
//! is created and fixes every bounded GPU allocation; quality settings then
//! vary work within those allocations. Sizes reach shaders through the frame
//! uniform (`tier_a..tier_d`), never as compile-time constants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tier {
    pub name: &'static str,
    /// Vertex trajectories per bank; a power of two for the probe mask.
    pub hash_cap: u32,
    /// Union patches (at most 2560, the node-pool arrays).
    pub union_cap: u32,
    /// Terrain nodes the scheduler may allocate (at most 4096).
    pub node_cap: u32,
    /// Scenery window side per cube face.
    pub sc_side: u32,
    /// Caster IDs per cascade stream.
    pub sun_casters: u32,
    pub shadow_map: u32,
    pub sun_global: u32,
    pub sun_height: u32,
    pub weather_face: u32,
    /// Impostor atlas size per variant layer (eight by eight view cells).
    pub atlas: u32,
    /// Tree age classes generated per species (variants = 15 x ages + 24 rocks).
    pub tree_ages: u32,
    /// Leaf and twig card atlas layer size (two by two cards per species).
    pub leaf_atlas: u32,
    pub wave_base: u32,
    /// Largest patch count a settings snapshot may request on this tier.
    pub patch_cap: usize,
}
impl Tier {
    pub const FULL: Tier = Tier {
        name: "full",
        hash_cap: 1_048_576,
        union_cap: 2560,
        node_cap: 4096,
        sc_side: 384,
        sun_casters: 65_536,
        shadow_map: 1024,
        sun_global: 512,
        sun_height: 512,
        weather_face: 512,
        atlas: 384,
        tree_ages: 3,
        leaf_atlas: 512,
        wave_base: 1024,
        patch_cap: 2240,
    };
    pub const REDUCED: Tier = Tier {
        name: "reduced",
        hash_cap: 524_288,
        union_cap: 1280,
        node_cap: 2048,
        sc_side: 288,
        sun_casters: 32_768,
        shadow_map: 1024,
        sun_global: 512,
        sun_height: 512,
        weather_face: 512,
        atlas: 256,
        tree_ages: 2,
        leaf_atlas: 512,
        wave_base: 1024,
        patch_cap: 1120,
    };
    pub const MINIMAL: Tier = Tier {
        name: "minimal",
        hash_cap: 262_144,
        union_cap: 640,
        node_cap: 1024,
        sc_side: 192,
        sun_casters: 16_384,
        shadow_map: 512,
        sun_global: 256,
        sun_height: 256,
        weather_face: 256,
        atlas: 192,
        tree_ages: 1,
        leaf_atlas: 256,
        wave_base: 512,
        patch_cap: 560,
    };
    pub fn named(name: &str) -> Result<Tier, String> {
        match name {
            "full" | "" => Ok(Self::FULL),
            "reduced" => Ok(Self::REDUCED),
            "minimal" => Ok(Self::MINIMAL),
            other => Err(format!("unknown allocation tier {other:?}")),
        }
    }
    pub fn index_cap(&self) -> u32 {
        self.union_cap * 1536
    }
    pub fn sc_cap(&self) -> u64 {
        6 * u64::from(self.sc_side) * u64::from(self.sc_side)
    }
    pub fn atlas_cell(&self) -> u32 {
        self.atlas / 8
    }
    /// Scenery variants: 15 tree species at each age class, then 24 rocks.
    pub fn sc_variants(&self) -> u32 {
        15 * self.tree_ages + 24
    }
    /// Impostor mip levels: halving while the view cell stays whole, at most five.
    pub fn atlas_mips(&self) -> u32 {
        (self.atlas_cell().trailing_zeros() + 1).min(5)
    }
    pub fn height_texels(&self) -> u64 {
        9 * u64::from(self.sun_height) * u64::from(self.sun_height)
    }
    /// Entries of the wave cache: levels at B, B/2, B/4, B/8 texels plus a fine
    /// level at B, B*B/64 * 149 in all. The fine level starts at B*B/64 * 85
    /// (wave_offset in water.wgsl); counting only that offset left the fine level
    /// out of the allocation and flattened the waves within 24 m of the eye.
    pub fn wave_entries(&self) -> u64 {
        let base = u64::from(self.wave_base);
        [base, base / 2, base / 4, base / 8, base]
            .iter()
            .map(|side| side * side)
            .sum()
    }
    pub fn frame_words(&self) -> [[u32; 4]; 4] {
        [
            [
                self.hash_cap,
                self.union_cap,
                self.sc_side,
                self.sun_casters,
            ],
            [self.shadow_map, self.sun_global, self.sun_height, 0],
            [
                self.weather_face,
                self.atlas_cell(),
                self.wave_base,
                self.index_cap(),
            ],
            [self.node_cap, self.tree_ages, self.leaf_atlas, 0],
        ]
    }
    pub fn validate(&self) -> Result<(), String> {
        if !self.hash_cap.is_power_of_two()
            || self.union_cap > 2560
            || self.node_cap > 4096
            || u64::from(self.union_cap) * 289 * 100 > u64::from(self.hash_cap) * 75
            || self.sc_cap() % 64 != 0
            || self.patch_cap + 48 > self.union_cap as usize
            || !(1..=3).contains(&self.tree_ages)
            || !self.leaf_atlas.is_power_of_two()
            || self.atlas % 8 != 0
        {
            return Err(format!("inconsistent allocation tier {}", self.name));
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::Tier;
    #[test]
    fn tiers_are_consistent_and_shrink_monotonically() {
        for tier in [Tier::FULL, Tier::REDUCED, Tier::MINIMAL] {
            tier.validate().unwrap();
        }
        let caps: Vec<u32> = [Tier::MINIMAL, Tier::REDUCED, Tier::FULL]
            .iter()
            .map(|t| t.hash_cap)
            .collect();
        assert!(caps.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(Tier::FULL.index_cap(), 3_932_160);
        assert_eq!(Tier::FULL.wave_entries(), 2_441_216);
        assert_eq!(Tier::MINIMAL.wave_entries(), 610_304);
        assert_eq!(Tier::FULL.sc_cap(), 884_736);
        assert!(Tier::named("nope").is_err());
    }
}

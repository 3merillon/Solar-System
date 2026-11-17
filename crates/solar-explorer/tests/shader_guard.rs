//! Guards the field seam: the spectrum has one definition, and the body literals
//! stay in the descriptor. A new height site cannot quietly reappear.
const SHADERS: [(&str, &str); 10] = [
    ("explorer", include_str!("../../../shaders/explorer.wgsl")),
    (
        "surface_detail",
        include_str!("../../../shaders/surface_detail.wgsl"),
    ),
    ("water", include_str!("../../../shaders/water.wgsl")),
    ("clouds", include_str!("../../../shaders/clouds.wgsl")),
    (
        "sun_visibility",
        include_str!("../../../shaders/sun_visibility.wgsl"),
    ),
    (
        "sun_clouds",
        include_str!("../../../shaders/sun_clouds.wgsl"),
    ),
    (
        "scenery_common",
        include_str!("../../../shaders/scenery_common.wgsl"),
    ),
    (
        "terrain_gpu",
        include_str!("../../../shaders/terrain_gpu.wgsl"),
    ),
    ("scenery", include_str!("../../../shaders/scenery.wgsl")),
    (
        "sun_casters",
        include_str!("../../../shaders/sun_casters.wgsl"),
    ),
];
fn calls(source: &str, name: &str) -> usize {
    source
        .match_indices(name)
        .filter(|(i, _)| {
            source[..*i]
                .chars()
                .next_back()
                .is_none_or(|c| !c.is_alphanumeric() && c != '_')
        })
        .count()
}
#[test]
fn only_the_field_module_reads_the_spectrum() {
    for (name, source) in SHADERS {
        let allowed = usize::from(name == "explorer"); // its own definition
        assert_eq!(calls(source, "band("), allowed, "{name} calls band()");
    }
}
#[test]
fn body_literals_stay_in_the_descriptor() {
    let explorer = SHADERS[0].1;
    for literal in ["100000.0", "55000.0", "0.0000058", "exp(-h/8000.0)"] {
        assert!(!explorer.contains(literal), "explorer.wgsl has {literal}");
    }
    assert!(!SHADERS[3].1.contains("12500.0"), "clouds.wgsl has the top");
}

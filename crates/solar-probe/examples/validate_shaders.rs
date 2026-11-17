//! CPU-only validation before launching expensive GPU/browser experiments.
fn main() {
    let shaders = [
        ("renderer", solar_probe::renderer::SOURCE.to_owned()),
        (
            "independent-media",
            solar_probe::renderer::AUDIT_SOURCE.to_owned(),
        ),
        (
            "surface",
            format!(
                "{}\n{}",
                solar_probe::renderer::SOURCE,
                solar_probe::surface_cache::SOURCE
            ),
        ),
        (
            "temporal",
            include_str!("../../../shaders/temporal.wgsl").to_owned(),
        ),
        (
            "spatial",
            include_str!("../../../shaders/resolve.wgsl").to_owned(),
        ),
    ];
    for (name, source) in shaders {
        let module = wgpu::naga::front::wgsl::parse_str(&source)
            .unwrap_or_else(|e| panic!("{name}: {}", e.emit_to_string(&source)));
        wgpu::naga::valid::Validator::new(
            wgpu::naga::valid::ValidationFlags::all(),
            wgpu::naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        println!("{name}: parsed and validated (CPU Naga; browser Tint still required)");
    }
}

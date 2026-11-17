fn main() {
    use solar_core::field;
    let s = solar_explorer::renderer::Settings::default().skin();
    for y in [-0.7, -0.3, 0.0, 0.3, 0.7, 1.0] {
        for x in [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0] {
            let n = field::normalized([x, 1.0, y]);
            let h = s.height(n, 0.0);
            if (-200.0..1600.0).contains(&h) {
                println!("{x} 1 {y} -> {h:.2}");
            }
        }
    }
}

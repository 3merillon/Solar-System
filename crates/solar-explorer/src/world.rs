//! Small camera queries only: no GPU, residency, generation or renderer startup.
use solar_core::{
    field::{self, V3},
    surface::SurfaceSource,
};
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
/// Real places: longitude and latitude in degrees, eye height above sea level, metres, and a
/// compass heading. An eye below the ground is lifted by the flight controller on arrival.
const PLACES: [(&str, f64, f64, f64, f64); 18] = [
    ("earth-orbit", 8.0, 47.0, 9_000_000.0, 0.0),
    ("alps-high", 7.0, 46.3, 60_000.0, 150.0),
    ("wupper", 7.1284, 51.1396, 350.0, 270.0),
    ("douro-mouth", -8.6710, 41.1430, 700.0, 270.0),
    ("lausanne", 6.6275, 46.5075, 1_400.0, 0.0),
    ("ouchy", 6.6275, 46.5040, 520.0, 170.0),
    ("lavaux", 6.7500, 46.4860, 760.0, 240.0),
    ("dents-du-midi", 6.8900, 46.2050, 3_500.0, 150.0),
    ("matterhorn", 7.6000, 45.9900, 4_700.0, 90.0),
    ("genoa-edge", 8.9000, 44.9000, 5_000.0, 180.0),
    ("cube-corner", 45.0000, 35.2644, 8_000.0, 90.0),
    ("north-pole", 0.0, 89.9000, 300_000.0, 180.0),
    ("south-pole", 0.0, -89.9000, 300_000.0, 0.0),
    ("everest", 86.9250, 27.9000, 10_000.0, 0.0),
    ("rainier", -121.7600, 46.7500, 4_800.0, 0.0),
    ("grand-canyon", -112.1100, 36.1000, 3_000.0, 0.0),
    ("hawaii", -155.5800, 19.6000, 5_000.0, 90.0),
    ("nile-delta", 31.2000, 30.5000, 20_000.0, 0.0),
];
fn place_bookmark(surface: &dyn SurfaceSource, place: (&str, f64, f64, f64, f64)) -> [V3; 2] {
    let (_, lon, lat, altitude, heading) = place;
    let n = solar_core::pages::lon_lat_to_direction(lon.to_radians(), lat.to_radians());
    let eye = field::mul(n, surface.radius() + altitude);
    if altitude > 1_000_000.0 {
        return [eye, field::add(eye, field::mul(n, -1000.0))];
    }
    // North and east at this place, then a heading and a gentle downward look.
    let east = field::normalized(cross([0.0, 1.0, 0.0], n));
    let north = cross(n, east);
    let h = heading.to_radians();
    let along = field::add(field::mul(north, h.cos()), field::mul(east, h.sin()));
    let pitch = if place.0 == "lausanne" { -0.55 } else { -0.25 };
    let forward = field::normalized(field::add(along, field::mul(n, pitch)));
    [eye, field::add(eye, field::mul(forward, 1000.0))]
}
pub fn bookmark(surface: &dyn SurfaceSource, name: &str) -> [V3; 2] {
    if let Some(place) = PLACES.iter().find(|p| p.0 == name) {
        return place_bookmark(surface, *place);
    }
    let n = match name {
        "pole" => [0.0, 1.0, 0.0],
        "face-edge" => field::normalized([1.0, 1.0, 0.14]),
        "corner" => field::normalized([1.0, 1.0, 1.0]),
        "antipode" => field::normalized([-0.17, -1.0, -0.24]),
        "rough" => field::normalized([0.2, 1.0, 1.0]),
        "conifers" => [
            -0.5127413390270789,
            0.8585348733163405,
            -0.00376703496308122,
        ],
        "coast" => [
            -0.5120696158031552,
            0.8589407228440772,
            0.0023544025363192813,
        ],
        "forest" | "canopy" => [-0.514549591671309, 0.8574606216677763, 0.0],
        "rocky" => [
            -0.514334233959984,
            0.8575898166136782,
            -0.000047088368285331675,
        ],
        _ => field::normalized([-0.6, 1.0, 0.0]),
    };
    let h = surface.height(n, 0.0);
    let tangent = field::normalized(cross([0.0, 0.0, 1.0], n));
    let alt = match name {
        "orbit" => 9_000_000.0,
        "clouds" => 6500.0,
        "horizon" => 15000.0,
        "rough" => 450.0,
        "ground" => 12.0,
        "forest" | "conifers" => 2.5,
        "canopy" => 130.0,
        "rocky" => 5.0,
        "coast" => 25.0,
        "face-edge" | "corner" | "pole" => 8000.0,
        "antipode" => 15000.0,
        _ => 8000.0,
    };
    let eye = field::mul(n, surface.radius() + h + alt);
    let forward = if name == "orbit" {
        field::mul(n, -1.0)
    } else {
        field::normalized(field::add(tangent, field::mul(n, -0.18)))
    };
    [eye, field::add(eye, field::mul(forward, 1000.0))]
}

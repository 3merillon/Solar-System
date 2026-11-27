// Runs inside the explorer through its ordinary body-fixed flight camera API.
// At the selected epoch the route crosses the inner B-ring shadow on the day side.
export function giantFlightPath(flight, id) {
  flight.jump_near(id, 2.6e8);
  flight.look_at(id);
  const packet = flight.packet(1920, 1080), stride = 39;
  const count = packet[26], header = packet.length - count * stride - packet[31];
  const historicalRadius = id === 699 ? 60268000 : 71492000;
  let row;
  for (let i = 0; i < count; i++) {
    const r = packet.slice(header + i * stride, header + (i + 1) * stride);
    if (r[10] === 4 && (r[38] === id || (!r[38] && Math.abs(r[7] - historicalRadius) < 100))) row = r;
  }
  if (!row) throw Error('Giant outside flight camera');
  const a = row[7], polar = row[8], sun = row.slice(12, 15);
  const sunLon = Math.atan2(sun[0], sun[2]), flat = Math.hypot(sun[0], sun[2]);
  const radius = lat => 1 / Math.hypot(Math.cos(lat) / a, Math.sin(lat) / polar);
  // Intersect the line from the inner B-ring edge away from the Sun with the
  // one-bar spheroid. Its radial latitude is the centre of the shadow crossing.
  const ring = 92e6, ringLongitude = .34;
  const qa = (flat / a) ** 2 + (sun[1] / polar) ** 2;
  const qb = -ring * Math.cos(ringLongitude) * flat / (a * a);
  const qc = (ring / a) ** 2 - 1;
  const t = qc / (-qb + Math.sqrt(Math.max(0, qb * qb - qa * qc)));
  const shadowX = ring * Math.sin(ringLongitude), shadowZ = ring * Math.cos(ringLongitude) - t * flat;
  const shadowLat = Math.atan2(-t * sun[1], Math.hypot(shadowX, shadowZ));
  const shadowLon = Math.atan2(shadowX, shadowZ);
  const smooth = (lo, hi, x) => { const u = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return u * u * (3 - 2 * u); };
  return fraction => {
    const approach = smooth(0, .62, fraction), skim = smooth(.47, 1, fraction);
    const lat = (1 - approach) * .68 + approach * (id === 699 ? shadowLat + .025 - skim * .065 : .34);
    const lon = sunLon + (1 - approach) * .65 + approach * (id === 699 ? shadowLon : 1.12);
    const upperSkim = id === 599 ? 60000 * (1 - smooth(.72, .98, fraction)) : 0;
    const height = 2.8e8 * Math.exp(-9 * approach) + 47000 - skim * 100000 + upperSkim;
    const up = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    const north = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)];
    const eye = up.map(v => v * (radius(lat) + height));
    const pitch = 1.44 - approach * 1.32;
    const target = eye.map((v, i) => v + 1000 * (-north[i] * Math.cos(pitch) - up[i] * Math.sin(pitch)));
    flight.jump_camera(id, new Float64Array([...eye, ...target, ...up]));
  };
}

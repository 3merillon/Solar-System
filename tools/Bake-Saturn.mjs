// Rebake-Packs passes the Cycle 30 Rotation B FITS files in red, green, violet order.
// These particular primary images use uncompressed IEEE big-endian floats and ship
// north first. The OPAL product README supplies I/F per FITS unit for each filter.
import {readFile, writeFile} from 'node:fs/promises';
import {png} from './Explorer-Test-Lib.mjs';

const [redFile, greenFile, violetFile, output] = process.argv.slice(2);
const width = 1800, height = 900;
async function reflectance(file, filter, scale) {
  const bytes = await readFile(file);
  const cards = new Map();
  let end = 0;
  for (; end + 80 <= bytes.length;) {
    const card = bytes.toString('ascii', end, end + 80);
    end += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END') break;
    cards.set(key, card.slice(10).split('/')[0].trim().replaceAll("'", '').trim());
  }
  const offset = Math.ceil(end / 2880) * 2880;
  if (cards.get('FILTER') !== filter || Number(cards.get('BITPIX')) !== -32 ||
      Number(cards.get('NAXIS1')) !== width || Number(cards.get('NAXIS2')) !== height ||
      bytes.length < offset + width * height * 4) throw Error('Unexpected OPAL image: ' + file);
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) values[i] = bytes.readFloatBE(offset + 4 * i) * scale;
  // The coverage edge varies with longitude. A few severely attenuated pixels
  // survive even on the bordering rows. Interpolate those across longitude
  // before they can be stretched through a masked latitude band.
  for (let y = 0; y < height; y++) {
    const row = values.subarray(y * width, (y + 1) * width);
    const sorted = row.slice().sort();
    const median = sorted[width / 2];
    if (!(median > 0)) continue;
    const spread = Math.max(.022, (sorted[1350] - sorted[450]) * 4);
    const good = [];
    for (let x = 0; x < width; x++) if (Math.abs(row[x] - median) <= spread) good.push(x);
    for (let i = 0; i < good.length; i++) {
      const left = good[i], right = good[i + 1] ?? good[0] + width;
      for (let x = left + 1; x < right; x++) {
        const t = (x - left) / (right - left);
        row[x % width] = row[left] * (1 - t) + row[right % width] * t;
      }
    }
  }
  return values;
}
const planes = await Promise.all([
  reflectance(redFile, 'F631N', .00323), reflectance(greenFile, 'F502N', .00296),
  reflectance(violetFile, 'F395N', .00240),
]);
// Mask both edges of the ring/shadow and the foreshortened southern limb.
// Interpolate the missing latitudes in reflectance, carrying only resolved
// longitudinal structure from the bordering rows. Continue the last row at the pole.
function sample(plane, x, lat) {
  const row = (degrees) => Math.max(0, Math.min(height - 1, (90 - degrees) * 5 - .5));
  const at = (y) => {
    const i = Math.floor(y), f = y - i;
    return plane[i * width + x] * (1 - f) + plane[Math.min(i + 1, height - 1) * width + x] * f;
  };
  if (lat > -19.2 && lat < -1.5) {
    const t = (lat + 19.2) / 17.7;
    return at(row(-19.2)) * (1 - t) + at(row(-1.5)) * t;
  }
  if(lat < -64){
    // Fade into the last usable zonal mean so the polar fill has no meridional streaks.
    const polarMean=plane.polarMean;
    const t=Math.min(1,(-64-lat)/4);
    return at(row(-64))*(1-t)+polarMean*t;
  }
  return at(row(lat));
}
for (const plane of planes) {
  const y = Math.round((90 + 68) * 5 - .5);
  plane.polarMean = plane.subarray(y * width, (y + 1) * width).reduce((a, b) => a + b, 0) / width;
}
const srgb = x => Math.round(255 * Math.min(1, x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055));
const w = 1024, h = 512, rgba = Buffer.alloc(w * h * 4, 255);
for (let y = 0; y < h; y++) {
  // Renderer samples the unit ellipsoid. The normal's latitude is planetographic.
  const parametric = Math.PI * (.5 - (y + .5) / h);
  const lat = Math.atan2(60268 * Math.sin(parametric), 54364 * Math.cos(parametric)) * 180 / Math.PI;
  for (let x = 0; x < w; x++) {
    // OPAL starts at 360 W and decreases west longitude toward the right.
    const sourceX = ((x + .5) / w + .5) * width - .5;
    const i = Math.floor(sourceX), f = sourceX - i;
    const [red, green, violet] = planes.map(plane =>
      sample(plane, i % width, lat) * (1 - f) + sample(plane, (i + 1) % width, lat) * f);
    // Approximate visible RGB reflectance by interpolating the narrow bands.
    // Encoding is sRGB because the GPU map array decodes it back to linear.
    const p = (y * w + x) * 4;
    rgba[p] = srgb(red);
    rgba[p + 1] = srgb(green * .63 + red * .37);
    rgba[p + 2] = srgb(violet * .46 + green * .54);
  }
}
await writeFile(output, png(rgba, w, h));

// Where this site's data packs are. solar-pack.json says whether the site has them ("solar") and,
// when they live on another host, their absolute base URL ("base": written by
// tools/Package-Explorer.mjs from SOLAR_PACK_BASE; that host must send Access-Control-Allow-Origin).
// Without a base the packs are the site's own pack/ folder, as on the development server.
// Read once per page or worker; every pack URL is base + '<pack>/<file>'.
let site = null;
export function packSite() {
  site ??= fetch(new URL('solar-pack.json', import.meta.url))
    .then(r => r.ok ? r.json() : {}).catch(() => ({}))
    .then(p => ({solar: !!p.solar, base: typeof p.base === 'string' && p.base ? p.base.replace(/\/?$/, '/') : 'pack/'}));
  return site;
}

// Each body pack's version. A pack whose content changes is published under the next version, in a new folder
// `<body>-v<N>/` with its map `solar/maps/<body>-v<N>.jpg` (version 1: `<body>.jpg`), and the old folder is left as it was:
// a browser that cached pages of one bake never mixes them with another, and a deployment of older code still finds the
// files it knows. tools/Rebake-Packs.mjs reads this table, so a rebake writes the folders this code reads.
// Version 2 (17 November 2026): no-data read from each source's own tag (grey, not black, where a mosaic has no image) and
// Mercury's heights at the product's 0.5 m per unit (version 1 had them doubled).
export const PACK_VERSION = {callisto: 2, dione: 2, enceladus: 2, europa: 2, ganymede: 2, iapetus: 2, io: 2, mars: 2, mercury: 2,
  phobos: 2, rhea: 2, tethys: 2, titan: 2, triton: 2};
export const packFolder = name => `${name}-v${PACK_VERSION[name] || 1}/`;
export const mapFile = name => PACK_VERSION[name] > 1 ? `solar/maps/${name}-v${PACK_VERSION[name]}.jpg` : `solar/maps/${name}.jpg`;

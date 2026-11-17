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

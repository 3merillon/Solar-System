// Source adapters as data plus small functions. Attribution strings come from the ledger
// (docs/REAL-EARTH-SOURCES.md, "Attribution strings for the manifest"). Nothing here touches the network.
export const MERCATOR_LAT_LIMIT=85.0511287798;
// A page ranked here or later is one nothing on screen reads: FINER_IN_VIEW in crates/solar-core/src/streaming.rs.
export const UNSEEN_RANK=40000;
// Single constant for the EOX layer year. The ledger covers the 2018-2025 layers (CC BY-NC-SA 4.0).
export const EOX_LAYER_YEAR=2024;
const lat=MERCATOR_LAT_LIMIT;
export const SOURCES={
 terrarium:{
  id:'terrarium',channel:'height',role:'base',decoder:'terrarium',seabedZoom:10,mime:'image/png',tileSize:256,minZoom:0,
  // Finer tiles are mostly oversampled for global data (the ledger lists no maximum useful zoom).
  maxZoom:13,coverage:{latLimit:lat},
  // zoomBias (default 0, any source) is added to the zoom the texel-spacing rule chose, before clamping.
  // Terrarium tiles are about 100 KB against about 20 KB for imagery and the data's own resolution is about 30 m,
  // so a height page reads tiles one zoom coarser than the imagery rule: at the finest level this loses no real
  // information, and the fetch volume falls (docs/M1-LIVE-EARTH.md, tools/Bench-Field-Pages.mjs).
  zoomBias:-1,
  // Argument order here is z/x/y.
  tileUrl:(z,x,y)=>`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  attribution:'Terrain Tiles (AWS Open Data), credits per region: 3DEP, SRTM and GMTED2010 data courtesy of the U.S. Geological Survey; Norway terrain data © Kartverket; © Environment Agency copyright and/or database right 2015. All rights reserved.; Contains information licensed under the Open Government Licence – Canada.; © Commonwealth of Australia (Geoscience Australia) 2017.; Produced using Copernicus data and information funded by the European Union - EU-DEM layers. Full list: github.com/tilezen/joerd/blob/master/docs/attribution.md',
  cachePermission:'silent in the ledger (section 1): no statement about a local browser cache; UNCONFIRMED',
 },
 eox:{
  id:'eox',channel:'albedo',role:'base',decoder:'image',mime:'image/jpeg',tileSize:256,minZoom:0,maxZoom:14,coverage:{latLimit:lat},
  // Our own budget for a free service that states no limit, and refuses a session that asks too much (403, seen 31 October 2026). Enough for what a cold view can show (about 350 tiles in
  // 3 s, measured), then a steady pace. The figures are a judgement, not EOX's: they halve by themselves at a refusal, and nothing here can promise never to reach a limit that is not published.
  limits:{tilesPerSecond:20,burst:300,unseenPerSecond:4},
  // WMTS order is z/row/col, that is z/y/x.
  tileUrl:(z,x,y)=>`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${EOX_LAYER_YEAR}_3857/default/g/${z}/${y}/${x}.jpg`,
  attribution:`EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${EOX_LAYER_YEAR})`,
  cachePermission:'the FAQ on the public endpoints advises caching "on your own CDN or device" (ledger, section 2); its commercial licence asks that tiles stay in the app and cannot be extracted as raw data',
 },
 swissimage:{
  id:'swissimage',channel:'albedo',role:'overlay',minLevel:13,decoder:'image',mime:'image/jpeg',tileSize:256,minZoom:0,maxZoom:18,
  // The page states a limit per time unit in a table not yet read (ledger, section 3), and asks that high query intensities be avoided.
  limits:{tilesPerSecond:20,burst:200,unseenPerSecond:4},
  coverage:{latLimit:lat,bbox:{lonMin:5.9,lonMax:10.5,latMin:45.8,latMax:47.9}},
  // z/x/y here, unlike EOX.
  tileUrl:(z,x,y)=>`https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`,
  attribution:'©swisstopo (includes material © (2016-2018) Planet. All rights reserved, for the 20 largest lakes in 2018+ imagery)',
  cachePermission:'silent in the ledger (section 3); request limits table UNCONFIRMED',
 },
};
// Names the default sources. Data only, so it can cross postMessage. overrides: per-source field replacements
// of plain values (for example {terrarium:{maxZoom:12}}).
export default {
 version:1,height:'terrarium',albedo:'eox',overlays:['swissimage'],overrides:{},
 limits:{perHost:6,global:18},cacheBytes:128*1024*1024,
};
// Resolve a manifest (or null for the default) into source objects keyed by id.
export function resolveSources(manifest){
 // A baked body has no tile sources: its pages come whole from its own pack.
 if(manifest?.baked)return {manifest,sources:{},height:null,albedo:null,overlays:[]};
 const m={...defaultManifestCopy(),...(manifest||{})},out={};
 for(const id of [m.height,m.albedo,...(m.overlays||[])]){
  if(!SOURCES[id])throw Error(`manifest names unknown source ${id}`);
  out[id]={...SOURCES[id],...(m.overrides?.[id]||{})};
 }
 return {manifest:m,sources:out,height:out[m.height],albedo:out[m.albedo],overlays:(m.overlays||[]).map(id=>out[id])};
}
const defaultManifestCopy=()=>({version:1,height:'terrarium',albedo:'eox',overlays:['swissimage'],overrides:{},limits:{perHost:6,global:18},cacheBytes:128*1024*1024});
// https://HOST/PATH?Q -> PROXY/proxy/HOST/PATH?Q, for tests that replay recorded tiles. No proxy: unchanged.
// Under replay every upstream host gets its own loopback port, because a browser limits connections
// per host and port: one shared port would apply one host's limit to all of them.
const REPLAY_PORT={'s3.amazonaws.com':0,'tiles.maps.eox.at':1,'wmts.geo.admin.ch':2};
export function proxyUrl(url,proxy){
 if(!proxy)return url;
 const m=/^https:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?$/.exec(url);
 if(!m)throw Error(`cannot proxy ${url}`);
 const base=proxy.replace(/\/+$/,'').replace(/:(\d+)$/,(_,port)=>`:${+port+(REPLAY_PORT[m[1]]||0)}`);
 return `${base}/proxy/${m[1]}${m[2]}${m[3]||''}`;
}
export const hostOf=url=>/^https:\/\/([^/?#]+)/.exec(url)?.[1]||'';

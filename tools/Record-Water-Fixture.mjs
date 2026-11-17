// Records a small water fixture: OpenFreeMap vector tiles (water and waterway layers, decoded) at z14 and at the
// coarser zooms map water reads (z(level+1) for levels 7 to 11), and Terrain Tiles DEM tiles at z13, around one
// place. Live requests go only to tiles.openfreemap.org and s3.amazonaws.com (public, free), one at a time, at most
// --budget of them. Never imagery. Output: fixture.json in the shape Render-Water-Pages and Test-River-Overflow read,
// with vectors keyed by zoom.
//   node tools/Record-Water-Fixture.mjs --lon 6.77 --lat 51.23 --out $SOLAR_DATA/water-fixtures/rhine [--z14 1] [--coarse 10,12] [--budget 60]
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {decodeVectorTile} from '../web/field/vector-tile.js';
import {decodeTerrarium} from '../web/field/png.js';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const lon=+arg('lon'),lat=+arg('lat'),out=resolve(arg('out')),r14=+arg('z14',1),coarse=arg('coarse','').split(',').filter(Boolean).map(Number),budget=+arg('budget',60);
let asked=0;
async function get(url){if(++asked>budget)throw Error('request budget spent');const r=await fetch(url,{headers:{'User-Agent':'solar-system-v2 test fixture recorder (local, low volume)'}});if(r.status===404||r.status===204)return null;if(!r.ok)throw Error(`${r.status} ${url}`);return new Uint8Array(await r.arrayBuffer());}
const tileOf=(z)=>{const n=2**z,x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);return [x,y];};
const meta=await (await fetch('https://tiles.openfreemap.org/planet')).json();asked++;
const template=meta.tiles[0];
const vectors={};
for(const [z,rad] of [[14,r14],...coarse.map(z=>[z,1])]){
 const [cx,cy]=tileOf(z);vectors[z]=[];
 for(let y=cy-rad;y<=cy+rad;y++)for(let x=cx-rad;x<=cx+rad;x++){
  const bytes=await get(template.replace('{z}',z).replace('{x}',x).replace('{y}',y));
  vectors[z].push({z,x,y,layers:bytes?decodeVectorTile(bytes,['water','waterway']):{}});
 }
}
// DEM: z13 tiles covering the z14 area plus one tile of margin each way.
const dem=[];{const [cx,cy]=tileOf(13),rad=Math.ceil(r14/2)+1;
 for(let y=cy-rad;y<=cy+rad;y++)for(let x=cx-rad;x<=cx+rad;x++){
  const bytes=await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/${x}/${y}.png`);if(!bytes)continue;
  const t=await decodeTerrarium(bytes);dem.push({z:13,x,y,width:t.width,height:t.height,heights:Array.from(t.heights,v=>Math.round(v*256)/256)});
 }}
await mkdir(out,{recursive:true});
await writeFile(resolve(out,'fixture.json'),JSON.stringify({source:{lon,lat,template,attribution:'© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap; Terrain Tiles (Mapzen, AWS Open Data)',recorded:new Date().toISOString()},rivers:vectors[14],vectors,dem}));
console.log(JSON.stringify({requests:asked,vectors:Object.fromEntries(Object.entries(vectors).map(([z,v])=>[z,v.length])),dem:dem.length}));

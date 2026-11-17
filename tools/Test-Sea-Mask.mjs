// The sea rule on recorded height tiles: no browser, no network. A sea decided tile by tile leaves squares, and one decided
// differently per zoom pops while zooming, so measure both directly.
// 1. Across each shared border of two recorded tiles, of the pixel pairs both at or under sea level, how many get different answers.
// 2. Between each recorded tile and the tile covering it one zoom up, how much of it gets a different answer.
// 3. Of pixels 10 m or more under sea level from z11 up, outside the listed inland basins, how many are left dry. Those can only be sea.
//    The rule before this one left all of them dry, since it looked for zeros there. This one fails above 0.1%.
//   node tools/Test-Sea-Mask.mjs [--output DIR] [--zooms 8,9,10,11,12,13]
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {decodeTerrarium} from '../web/field/png.js';
import {findSea} from '../web/field/seabed.js';
import {flatRegions} from '../web/field/water.js';
import {FIXTURE} from './Earth-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=arg('output')?resolve(arg('output')):null;
const zooms=new Set(arg('zooms','8,9,10,11,12,13').split(',').map(Number));
const quant=v=>{v=[...v].sort((x,y)=>x-y);const q=p=>v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]??null;return {n:v.length,p50:q(.5),p95:q(.95),p99:q(.99),max:v.at(-1)??null};};
// Recorded height tiles, from the fixture's own records.
const root=join(FIXTURE,'s3.amazonaws.com'),tiles=new Map();
for(const shard of await readdir(root)){
 for(const name of await readdir(join(root,shard))){
  if(!name.endsWith('.json'))continue;
  const meta=JSON.parse(await readFile(join(root,shard,name),'utf8')),m=/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(meta.url||'');
  if(!m||meta.status!==200||!zooms.has(+m[1]))continue;
  tiles.set(`${m[1]}/${m[2]}/${m[3]}`,{z:+m[1],x:+m[2],y:+m[3],file:join(root,shard,name.replace(/\.json$/,'.bin'))});
 }
}
// A tile with nothing near sea level has nothing to decide, and most recorded tiles are mountains.
const LOW=3/256,work=[];let skipped=0;const started=performance.now();
const costs=[];
for(const t of tiles.values()){
 const decoded=await decodeTerrarium(await readFile(t.file));let any=false;for(const v of decoded.heights)if(v<=LOW){any=true;break;}
 if(!any){skipped++;t.decided=false;continue;}
 const t0=performance.now();t.sea=findSea(decoded,t.z,t.x,t.y);costs.push(performance.now()-t0);t.heights=decoded.heights;t.w=decoded.width;t.decided=true;work.push(t);
}
const report={fixture:FIXTURE,tiles:tiles.size,without_low_ground:skipped,decided:work.length,find_sea_ms:quant(costs),zoom:{}};
let deep=0,deepDry=0;
const row=z=>report.zoom[z]||(report.zoom[z]={tiles:0,sea_share_mean:0,border_pairs:0,border_differ:0,border_edges:0,worst_border:0,zoom_up_pairs:0,zoom_up_shares:[],flat_below_sea:0,flat_below_sea_tiles:0});
for(const t of work){
 const r=row(t.z),w=t.w;let sea=0;for(const v of t.sea.mask)sea+=v;r.tiles++;r.sea_share_mean+=sea/t.sea.mask.length;
 if(t.z>=11&&!t.sea.basins)for(let a=0;a<t.heights.length;a++)if(t.heights[a]<=-10){deep++;if(!t.sea.mask[a])deepDry++;}
 // The flat regions the lake search would still see below sea level.
 let flat=0;for(const f of flatRegions({heights:t.heights,width:w,height:w},t.z,t.y,t.sea.mask))if(f.level<0&&!t.sea.basins)flat++;if(flat){r.flat_below_sea+=flat;r.flat_below_sea_tiles++;}
 for(const [dx,dy] of [[1,0],[0,1]]){
  const o=tiles.get(`${t.z}/${(t.x+dx)%2**t.z}/${t.y+dy}`);if(!o||!o.decided)continue;
  let pairs=0,differ=0;
  for(let k=0;k<w;k++){
   const a=dx?k*w+w-1:(w-1)*w+k,b=dx?k*w:k;
   if(t.heights[a]>LOW||o.heights[b]>LOW)continue;pairs++;if(t.sea.mask[a]!==o.sea.mask[b])differ++;
  }
  r.border_pairs+=pairs;r.border_differ+=differ;if(pairs){r.border_edges++;r.worst_border=Math.max(r.worst_border,differ);}
 }
 const up=tiles.get(`${t.z-1}/${t.x>>1}/${t.y>>1}`);
 if(up&&up.decided){
  const qx=(t.x&1)*(w>>1),qy=(t.y&1)*(w>>1);let same=0;
  for(let j=0;j<w;j++)for(let i=0;i<w;i++)if(t.sea.mask[j*w+i]===up.sea.mask[(qy+(j>>1))*w+qx+(i>>1)])same++;
  r.zoom_up_pairs++;r.zoom_up_shares.push(1-same/(w*w));
 }
}
let pairs=0,differ=0;
for(const r of Object.values(report.zoom)){r.sea_share_mean/=Math.max(1,r.tiles);r.border_differ_share=r.border_pairs?r.border_differ/r.border_pairs:null;r.zoom_up_differ=quant(r.zoom_up_shares);delete r.zoom_up_shares;pairs+=r.border_pairs;differ+=r.border_differ;}
report.deep_pixels=deep;report.deep_left_dry=deepDry;report.deep_left_dry_share=deep?deepDry/deep:null;report.pass=!deep||deepDry/deep<=0.001;
report.border_pairs=pairs;report.border_differ=differ;report.border_differ_share=pairs?differ/pairs:null;report.seconds=(performance.now()-started)/1000;
if(dir){await mkdir(dir,{recursive:true});await writeFile(join(dir,'report.json'),JSON.stringify(report,null,1));}
console.log(JSON.stringify(report,null,1));

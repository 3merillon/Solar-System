// Page build cost with and without the water layer, on recorded fixtures, serially (docs/WATER-LAYER.md). Per level a
// 3 x 3 block of pages is built cold (first build: river solves and water bodies not yet cached), then warm, five
// times each way, alternating; p50 / p95 over pages and repeats. warm_new_pipeline: the water layer and terrain from it
// (opts.terrain), without the old water rules, against warm_old, the old path. Run on a quiet machine; the report records the CPU.
//   node tools/Bench-Water-Pages.mjs --out DIR [--modules DIR]  (another build of web/field, for before and after)
import {withCoarserTiles} from './Fixture-Dem.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const u=f=>pathToFileURL(resolve(arg('modules','web/field'),f)).href;
const {buildHeightPage}=await import(u('resample.js'));const {directionToChart,lonLatToDirection,mercatorToLonLat}=await import(u('chart.js'));const {WATER_STEPS}=await import(u('water-steps.js'));
const out=resolve(arg('out','evidence/local/water-bench'));await mkdir(out,{recursive:true});
const fixtures=[['wupper',(process.env.SOLAR_DATA||'data')+'/cloud-river-buildings-2026-11-02/fixtures/wupper/fixture.json',false,[13,14,15]],['rhine',(process.env.SOLAR_DATA||'data')+'/water-fixtures/rhine/fixture.json',false,[11,12,13,14,15]],
 ['douro',(process.env.SOLAR_DATA||'data')+'/cloud-river-buildings-2026-11-02/fixtures/douro/fixture.json',true,[12,13,14,15]],['leixoes',(process.env.SOLAR_DATA||'data')+'/water-fixtures/leixoes/fixture.json',true,[11,12,13,14,15]]];
const q=(v,p)=>{const s=[...v].sort((a,b)=>a-b);return s.length?+s[Math.min(s.length-1,Math.floor(p*(s.length-1)+.5))].toFixed(2):null;};
const report={cpu:os.cpus()[0]?.model,node:process.version,fixtures:{}};
for(const [name,path,sea,levels] of fixtures){
 const real=JSON.parse(await readFile(path,'utf8')),z=real.dem[0].z,source={id:'fixture',channel:'height',tileSize:256,minZoom:z,maxZoom:z,coverage:{latLimit:85},seabedZoom:10};
 const prepare=t=>{const tile={...t,heights:Float32Array.from(t.heights)};if(!sea)return tile;const scan=WATER_STEPS.scan({tile,z:t.z,x:t.x,y:t.y}),o=WATER_STEPS.finish({tile,z:t.z,x:t.x,y:t.y,zoom:10,sea:scan.sea,parent:null,regions:[],image:null,imageZ:0});return {...tile,riverHeights:tile.heights,heights:o.heights||tile.heights,water:o.water};};
 const tiles=new Map(real.dem.map(t=>[t.z+'/'+t.x+'/'+t.y,prepare(t)])),coarser=withCoarserTiles(tiles,real.dem[0].z),get=(s,zz,x,y)=>coarser(zz,x,y);
 const t=real.rivers[real.rivers.length>>1],n=2**t.z,[lon,lat]=mercatorToLonLat((t.x+.5)/n,(t.y+.5)/n),c=directionToChart(lonLatToDirection(lon,lat));report.fixtures[name]={};
 for(const level of levels){const m=2**level,px=Math.floor((c.u+1)/2*m),py=Math.floor((c.v+1)/2*m),vec=real.vectors?.[level>=12?14:Math.min(14,level+1)]??real.rivers;
  const pages=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)pages.push({face:c.face,level,x:px+dx,y:py+dy});
  const cold={old:[],layer:[]},warm={old:[],with:[],layer:[],terrain:[]};
  for(const page of pages){let t0=performance.now();buildHeightPage(page,get,source,vec);cold.old.push(performance.now()-t0);}
  for(const page of pages){const r=buildHeightPage(page,get,source,vec,{water:true});if(r.waterPage)cold.layer.push(r.waterPage.stats.ms+(r.waterPage.stats.unionMs||0));}
  for(let rep=0;rep<5;rep++)for(const page of pages){let t0=performance.now();buildHeightPage(page,get,source,vec);warm.old.push(performance.now()-t0);
   t0=performance.now();const r=buildHeightPage(page,get,source,vec,{water:true});warm.with.push(performance.now()-t0);if(r.waterPage)warm.layer.push(r.waterPage.stats.ms+(r.waterPage.stats.unionMs||0));
   t0=performance.now();buildHeightPage(page,get,source,vec,{water:true,terrain:true});warm.terrain.push(performance.now()-t0);}
  const row={pages:pages.length,water_pages:cold.layer.length,cold_old:{p50:q(cold.old,.5),p95:q(cold.old,.95)},cold_layer:{p50:q(cold.layer,.5),p95:q(cold.layer,.95)},
   warm_old:{p50:q(warm.old,.5),p95:q(warm.old,.95)},warm_with_layer:{p50:q(warm.with,.5),p95:q(warm.with,.95)},warm_layer:{p50:q(warm.layer,.5),p95:q(warm.layer,.95)},warm_new_pipeline:{p50:q(warm.terrain,.5),p95:q(warm.terrain,.95)}};
  report.fixtures[name][level]=row;console.log(name,'L'+level,JSON.stringify(row));}}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1));

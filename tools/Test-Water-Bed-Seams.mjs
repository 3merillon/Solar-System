// The water's bed must not step at a page border (owner's report of 4 November 2026: "sudden deep shelves in bays", a
// straight underwater wall between shallow and deep water). Neighbouring pages of one level overlap by eight texels
// (264 = 256 + 2 x 4, texel i of page x stands where texel i - 256 of page x + 1 does), and every texel there is the
// same ground: its shaped height (water-layer.js shapeTerrain) and its water level must agree on both pages. Pages are
// built with the water layer and the terrain from it, as the field worker builds them, in a block around a place.
// Reported per level: the largest disagreement of ground height and of water level over the overlaps, texels under
// water (on either page, by more than 5 cm) and the rest apart. Pass: under water, ground within --limit (0.1 m) and
// level within --level-limit (0.3 m: each page fits its own river network's levels, an open item in WATER-LAYER.md).
//   node tools/Test-Water-Bed-Seams.mjs [--fixture-path F] [--at lon,lat] [--levels 13,14,15,16] [--radius 1] [--web DIR]
//     [--sea 0] [--limit 0.1] [--level-limit 0.3] [--worst 5]
import {withCoarserTiles} from './Fixture-Dem.mjs';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const web=pathToFileURL(resolve(arg('web','web/field'))).href+'/',W=pathToFileURL(resolve('web/field')).href+'/';
const {buildHeightPage}=await import(web+'resample.js');const {directionToChart,lonLatToDirection,chartToDirection,directionToLonLat}=await import(W+'chart.js');const {WATER_STEPS}=await import(W+'water-steps.js');
const real=JSON.parse(await readFile(arg('fixture-path',(process.env.SOLAR_DATA||'data')+'/water-fixtures/leixoes/fixture.json'),'utf8')),z=real.dem[0].z,source={id:'fixture',channel:'height',tileSize:256,minZoom:z,maxZoom:z,coverage:{latLimit:85},seabedZoom:10};
const sea=arg('sea','1')!=='0',prepare=t=>{const tile={...t,heights:Float32Array.from(t.heights)};if(!sea)return tile;const scan=WATER_STEPS.scan({tile,z:t.z,x:t.x,y:t.y}),o=WATER_STEPS.finish({tile,z:t.z,x:t.x,y:t.y,zoom:10,sea:scan.sea,parent:null,regions:[],image:null,imageZ:0});return {...tile,riverHeights:tile.heights,heights:o.heights||tile.heights,water:o.water};};
const tiles=new Map(real.dem.map(t=>[t.z+'/'+t.x+'/'+t.y,prepare(t)])),coarser=withCoarserTiles(tiles,z),get=(s,zz,x,y)=>coarser(zz,x,y);
const [lon,lat]=arg('at','-8.7045,41.176').split(',').map(Number),levels=arg('levels','13,14,15,16').split(',').map(Number),radius=+arg('radius',1),limit=+arg('limit',0.1),levelLimit=+arg('level-limit',0.3),N=264;
const c=directionToChart(lonLatToDirection(lon*Math.PI/180,lat*Math.PI/180));
const cache=new Map();
function page(face,level,x,y){const key=[face,level,x,y].join('/');if(cache.has(key))return cache.get(key);
 const vec=real.vectors?.[level>=12?14:Math.min(14,level+1)]??real.vectors?.['14']??real.rivers;
 const r=buildHeightPage({face,level,x,y},get,source,vec,{water:true,terrain:true});
 const q=r.bytes?new Uint16Array(r.bytes):null,v={h:q?Float32Array.from(q,k=>r.offset+r.scale*k):null,lv:r.waterPage?Float32Array.from(r.waterPage.level):null,quant:r.scale};cache.set(key,v);return v;}
const lonLatOf=(level,x,y,i,j)=>{const m=2**level,d=chartToDirection(c.face,((x+(i-3)/256)/m)*2-1,((y+(j-3)/256)/m)*2-1),ll=directionToLonLat(d);return [+(ll[0]*180/Math.PI).toFixed(5),+(ll[1]*180/Math.PI).toFixed(5)];};
const report={at:[lon,lat],face:c.face,limit,levels:[]};let pass=true;
for(const level of levels){
 const m=2**level,cx=Math.floor((c.u+1)/2*m),cy=Math.floor((c.v+1)/2*m),worst=[];let wet={n:0,h:0,lv:0},dry={n:0,h:0,lv:0};
 const consider=(A,B,ia,ja,ib,jb,where)=>{const ka=ja*N+ia,kb=jb*N+ib,ha=A.h[ka],hb=B.h[kb],dh=Math.abs(ha-hb),tol=(A.quant+B.quant);
  const la=A.lv?A.lv[ka]:NaN,lb=B.lv?B.lv[kb]:NaN,known=la===la&&lb===lb,under=known&&(la-ha>0.05||lb-hb>0.05);
  if(under){wet.n++;const dl=Math.abs(la-lb);if(dh>wet.h)wet.h=dh;if(dl>wet.lv)wet.lv=dl;if(dh>tol||dl>tol)worst.push({dh:+dh.toFixed(3),dl:+dl.toFixed(3),depth:[+(la-ha).toFixed(2),+(lb-hb).toFixed(2)],where});}
  else{dry.n++;if(dh>dry.h)dry.h=dh;if(known){const dl=Math.abs(la-lb);if(dl>dry.lv)dry.lv=dl;}}};
 for(let y=cy-radius;y<=cy+radius;y++)for(let x=cx-radius;x<=cx+radius;x++){
  const A=page(c.face,level,x,y);if(!A.h)continue;
  const R=x<cx+radius?page(c.face,level,x+1,y):null,D=y<cy+radius?page(c.face,level,x,y+1):null;
  // Rows 4..259 of the shared columns (the corners' overlap is counted by the other direction).
  if(R?.h)for(let i=256;i<N;i++)for(let j=4;j<260;j++)consider(A,R,i,j,i-256,j,{page:[x,y],right:true,texel:[i,j],lonlat:lonLatOf(level,x,y,i,j)});
  if(D?.h)for(let j=256;j<N;j++)for(let i=4;i<260;i++)consider(A,D,i,j,i,j-256,{page:[x,y],down:true,texel:[i,j],lonlat:lonLatOf(level,x,y,i,j)});
 }
 worst.sort((a,b)=>Math.max(b.dh,b.dl)-Math.max(a.dh,a.dl));
 const row={level,pages:(2*radius+1)**2,wet_texels:wet.n,wet_ground_m:+wet.h.toFixed(3),wet_level_m:+wet.lv.toFixed(3),dry_texels:dry.n,dry_ground_m:+dry.h.toFixed(3),dry_level_m:+dry.lv.toFixed(3),over_quantisation:worst.length,worst:worst.slice(0,+arg('worst',5))};
 if(wet.h>limit||wet.lv>levelLimit)pass=false;report.levels.push(row);console.log(JSON.stringify(row));
}
report.pass=pass;console.log(JSON.stringify({pass,limit,level_limit:levelLimit}));if(!pass)process.exitCode=1;

// The water's bed must not depend on the page level (docs/WATER-LAYER.md, the owner's darker ring, 3 November 2026):
// every reader picks its page level by distance from the eye, so a bed that differs by level is a ring about the camera.
// Along a line (default: from the Leixões shore out to sea), the water's depth (level minus ground, bilinear in each
// page) is read on pages of levels 12 to 16 built with the water layer and the terrain from it; the spread across levels
// at each point must stay under --limit metres (default 0.1). Before the fix the same open sea lay 3.2 m deep on a level
// 16 page and 10 m on a level 12 one.
//   node tools/Test-Water-Bed-Levels.mjs [--fixture-path F] [--line lon0,lat0,lon1,lat1] [--steps 48] [--web DIR] [--sea]
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
const [lon0,lat0,lon1,lat1]=(arg('line','-8.6985,41.172,-8.722,41.172')).split(',').map(Number),STEPS=+arg('steps',48);
const cache=new Map();
function page(face,level,x,y){const key=[face,level,x,y].join('/');if(cache.has(key))return cache.get(key);const vec=real.vectors?.[level>=12?14:Math.min(14,level+1)]??real.vectors?.['14']??real.rivers;const r=buildHeightPage({face,level,x,y},get,source,vec,{water:true,terrain:true});
 const q=r.bytes?new Uint16Array(r.bytes):null,v={h:q?Float32Array.from(q,c=>r.offset+r.scale*c):null,lv:r.waterPage?Float32Array.from(r.waterPage.level):null};cache.set(key,v);return v;}
const rows=[];
for(let s=0;s<=STEPS;s++){const t=s/STEPS,lon=lon0+(lon1-lon0)*t,lat=lat0+(lat1-lat0)*t,c=directionToChart(lonLatToDirection(lon*Math.PI/180,lat*Math.PI/180));
 const out=[];for(const level of [12,13,14,15,16]){const m=2**level,fx=(c.u+1)/2*m,fy=(c.v+1)/2*m,px=Math.floor(fx),py=Math.floor(fy),pg=page(c.face,level,px,py);if(!pg.h||!pg.lv){out.push(NaN);continue;}
  const N=264,X=3+(fx-px)*256,Y=3+(fy-py)*256,i=Math.floor(X),j=Math.floor(Y),a=X-i,b=Y-j,at=(A,ii,jj)=>A[jj*N+ii];
  const bil=A=>(at(A,i,j)*(1-a)+at(A,i+1,j)*a)*(1-b)+(at(A,i,j+1)*(1-a)+at(A,i+1,j+1)*a)*b;out.push(bil(pg.lv)-bil(pg.h));}
 const dist=Math.hypot((lon-lon0)*Math.cos(lat0*Math.PI/180),lat-lat0)*111320;rows.push([dist,...out]);}
let worst=0;for(const r of rows){const v=r.slice(1).filter(x=>x===x);const sp=Math.max(...v)-Math.min(...v);if(sp>worst)worst=sp;console.log(r[0].toFixed(0).padStart(5)+' m',r.slice(1).map(x=>x===x?x.toFixed(2).padStart(6):'   -  ').join(' '),'spread',sp.toFixed(2));}
const limit=+arg('limit',0.1);console.log(JSON.stringify({worst_spread_m:+worst.toFixed(3),limit,pass:worst<=limit}));if(worst>limit)process.exitCode=1;

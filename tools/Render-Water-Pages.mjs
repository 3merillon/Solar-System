// Top-down render of built height pages and their water texels, on the CPU, from a recorded fixture: DEM tiles
// and decoded OSM vector tiles (fixture.json as Test-River-Overflow reads it). No GPU: it shows what the page builder
// hands the GPU, where the shore is the zero crossing of the excess. Hillshaded ground, water by depth (blue), the
// dry fringe within 5 cm of the water (yellow) and saturated deep water (dark blue).
//   node tools/Render-Water-Pages.mjs --fixture $SOLAR_DATA/.../wupper/fixture.json --at X,Y --level 15 --radius 1 --out a.png
//   [--modules DIR]  page builder to load (default web/field), to compare builds
//   [--layer]  draw the water layer (water-layer.js) instead of the excess plane: water where the signed distance is
//   negative, coloured by kind (sea navy, still blue, river cyan) and depth, the shore (|distance| under 0.12 texel)
//   white, partly covered texels by their coverage, and wet neighbours whose levels differ by over 0.25 m red
//   [--terrain]  with --layer: the terrain shaped from the layer (phase 2); wholly dry texels within two texels of the
//   shore more than 10 cm under the water magenta
import {withCoarserTiles} from './Fixture-Dem.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {png} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const modules=resolve(arg('modules','web/field')),url=f=>pathToFileURL(resolve(modules,f)).href;
const {buildHeightPage,waterExcessValue,exactTexelMap}=await import(url('resample.js'));const {riverField}=await import(url('rivers.js'));
const {directionToChart,lonLatToDirection,mercatorToLonLat}=await import(pathToFileURL(resolve('web/field/chart.js')).href);
const real=JSON.parse(await readFile(arg('fixture'),'utf8'));
const level=+arg('level',15),radius=+arg('radius',1),[AX,AY]=arg('at').split(',').map(Number),sea=process.argv.includes('--sea'),layer=process.argv.includes('--layer'),terrainMode=process.argv.includes('--terrain');
const z=real.dem[0].z,source={id:'fixture',channel:'height',tileSize:256,minZoom:z,maxZoom:z,coverage:{latLimit:85},seabedZoom:10};
// --sea: the sea as the worker prepares it (water-steps.js: scan, regions, finish) from heights alone, with no
// imagery and no coarser floor tile, so seabed fill and dry-land lift are real; lakes need imagery and stay out.
const {WATER_STEPS}=await import(url('water-steps.js'));
const prepare=t=>{const tile={...t,heights:Float32Array.from(t.heights)};if(!sea)return tile;
 const scan=WATER_STEPS.scan({tile,z:t.z,x:t.x,y:t.y}),out=WATER_STEPS.finish({tile,z:t.z,x:t.x,y:t.y,zoom:10,sea:scan.sea,parent:null,regions:[],image:null,imageZ:0});
 return {...tile,riverHeights:tile.heights,heights:out.heights||tile.heights,water:out.water};};
const tiles=new Map(real.dem.map(t=>[t.z+'/'+t.x+'/'+t.y,prepare(t)]));
const coarser=withCoarserTiles(tiles,real.dem[0].z),get=(s,zz,x,y)=>coarser(zz,x,y);
// --no-map: every vector tile missing (as a host's 404), so the water layer takes the source's sea (water-layer.js sourceSea).
const vectors=process.argv.includes('--no-map')?(real.rivers.map(t=>({z:t.z,x:t.x,y:t.y,layers:{},missing:true}))):(real.vectors?.[level>=12?14:Math.min(14,level+1)]??real.rivers);
// --folds: texels where the valley warp (rivers.js) reverses the DEM, in magenta, and its shift in cyan shades.
const folds=process.argv.includes('--folds');let field=null;
if(folds&&level>=12){const demT=new Map(real.dem.map(t=>[t.x+'/'+t.y,t]));field=riverField(real.rivers,(x,y)=>{const zz=13,n=2**zz,px=x*n*256-.5,py=y*n*256-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;const g=(i,j)=>{const t=demT.get(Math.floor(i/256)+'/'+Math.floor(j/256));return t?t.heights[(j%256)*256+(i%256)]:NaN;};return (g(x0,y0)*(1-fx)+g(x0+1,y0)*fx)*(1-fy)+(g(x0,y0+1)*(1-fx)+g(x0+1,y0+1)*fx)*fy;});}
const [lon,lat]=mercatorToLonLat(AX,AY),c=directionToChart(lonLatToDirection(lon,lat)),n=2**level;
const px=Math.floor((c.u+1)/2*n),py=Math.floor((c.v+1)/2*n),side=2*radius+1,W=256*side,img=new Uint8Array(W*W*4),stats=[];
for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
 const page={face:c.face,level,x:px+dx,y:py+dy},t0=performance.now(),r=buildHeightPage(page,get,source,vectors,{water:layer,terrain:terrainMode}),ms=performance.now()-t0;
 if(r.missing){stats.push({page,missing:r.reason});continue;}
 let pageMap=null;const u=new Uint16Array(r.bytes),N=264,hh=k=>r.offset+r.scale*u[k],cell=2*Math.PI*6371000/4/n/256;
 let wet=0,deep=0;
 for(let j=3;j<259;j++)for(let i=3;i<259;i++){
  const k=j*N+i,gx=(dx+radius)*256+(i-3),gy=(dy+radius)*256+(j-3),o=(gy*W+gx)*4;
  const sx=(hh(k+1)-hh(k-1))/(2*cell),sy=(hh(k+N)-hh(k-N))/(2*cell),l=Math.max(0,Math.min(1,(-sx*.6-sy*.6+1)/Math.sqrt(1+sx*sx+sy*sy)/1.5));
  let R=60+150*l,G=58+140*l,B=50+120*l;
  if(layer){const w=r.waterPage;if(w){const b=w.bytes,o4=k*4,sd=(b[o4]-32768)/512,lv=b[o4+1]===65535?NaN:w.levelOffset+w.levelScale*b[o4+1],al=(b[o4+2]&255)/255,kind=(b[o4+2]>>8)&3;
    const depth=lv-hh(k),tint=kind===1?[20,40,110]:kind===2?[40,90,200]:[40,170,210];
    if(sd<0||al>0){const d=Math.min(1,Math.max(0,depth)/4),a=sd<0?1:al;const wr=tint[0]*(1-.5*d),wg=tint[1]*(1-.4*d),wb=tint[2]*(1-.2*d);R=R*(1-a)+wr*a;G=G*(1-a)+wg*a;B=B*(1-a)+wb*a;wet++;}
    if(Math.abs(sd)<.12){R=G=B=255;}
    if(terrainMode&&sd>=.75&&sd<2&&al===0&&lv-hh(k)>.1){R=255;G=0;B=255;}
    if(sd<0&&i>3&&j>3){for(const q of [k-1,k-N]){const b2=b[q*4+1],l2=b2===65535?NaN:w.levelOffset+w.levelScale*b2;if((b[q*4]-32768)<0&&Math.abs(l2-lv)>.25){R=255;G=30;B=30;}}}}}
  else if(r.texels){const code=u[N*N+k],e=waterExcessValue(code);
   if(code===65535){R=10;G=20;B=90;deep++;wet++;}
   else if(e>0){const d=Math.min(1,e/3);R=R*.25*(1-d)+20*d;G=G*.35*(1-d)+60*d+40;B=180+60*(1-d);wet++;}
   else if(e>-.05){R=230;G=200;B=40;}}
  if(field?.warp){const m=pageMap||(pageMap=exactTexelMap(page,'height')),w=field.warp(m.X[k],m.Y[k]),w1=field.warp(m.X[k+1],m.Y[k+1]),wn=field.warp(m.X[k+N],m.Y[k+N]);
   const ax=m.X[k+1]-m.X[k],bx=m.X[k+N]-m.X[k],ay=m.Y[k+1]-m.Y[k],by=m.Y[k+N]-m.Y[k],z0=w||[0,0],z1=w1||[0,0],z2=wn||[0,0];
   const det=((ax+z1[0]-z0[0])*(by+z2[1]-z0[1])-(bx+z2[0]-z0[0])*(ay+z1[1]-z0[1]))/(ax*by-bx*ay);
   if(det<.25){R=255;G=0;B=255;}else if(w){const sm=Math.hypot(...w)*2*Math.PI*6371000/Math.cosh((.5-m.Y[k])*2*Math.PI);if(sm>2&&!(r.texels&&waterExcessValue(u[N*N+k])>0)){G=Math.min(255,G+sm*2);B=Math.min(255,B+sm*2);}}}
  img[o]=R;img[o+1]=G;img[o+2]=B;img[o+3]=255;
 }
 stats.push({page,ms:+ms.toFixed(1),texels:!!r.texels,wet,deep,layer:r.waterPage?{ms:+r.waterPage.stats.ms.toFixed(1),pieces:r.waterPage.stats.pieces,unresolved:r.waterPage.stats.unresolved,fallback:r.waterPage.stats.fallbackLevel,over:r.waterPage.stats.overBudget}:undefined,rivers:r.rivers&&{segments:r.rivers.segments,mapped:r.rivers.mappedWidths,outliers:r.rivers.widthOutliers,limited:r.rivers.terrainLimited,lakes:r.rivers.lakeOutlets},map:r.mapWater&&{features:r.mapWater.features,still:r.mapWater.still,est:r.mapWater.estimated,disagree:r.mapWater.disagreeing,over:r.mapWater.overBudget}});
}
await writeFile(resolve(arg('out','water-pages.png')),png(Buffer.from(img),W,W));
console.log(JSON.stringify(stats));

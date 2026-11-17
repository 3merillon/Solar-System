// Water must cover the open sea from every distance. Each view settles, then the ocean and position targets are read
// directly. A pixel whose ground lies well under the sea, with no water fragment over it, is a hole. Nothing here
// judges colour, so a hole cannot hide in a bright glint or pass as one. Ground from 1 to 100 m under is counted apart,
// as shallow: most of it is sea, but it also holds land below sea level, so it reports without failing.
//   node tools/Test-Earth-Sea-Cover.mjs [--web DIR] [--record --max-requests N] [--views a,b] [--overlay] --output DIR
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture,png} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/sea-cover'));await mkdir(dir,{recursive:true});
const W=+arg('width',1280),H=+arg('height',720),record=process.argv.includes('--record');
// Well below the 60 m a lake bed can reach, so a pixel counted here is the sea on any build.
const DEEP=100;
const VIEWS=[
 // The owner's report: the western Mediterranean, tilted, with every sea level of detail on screen.
 {name:'med-5000km',lon:8,lat:30,alt:5000000,pitch:-1.2},
 {name:'med-1500km',lon:8,lat:34,alt:1500000,pitch:-1.0},
 {name:'med-600km',lon:6,lat:37,alt:600000,pitch:-.8},
 {name:'med-200km',lon:6,lat:39,alt:200000,pitch:-.6},
 {name:'med-60km',lon:6,lat:40,alt:60000,pitch:-.4},
 {name:'med-20km',lon:6,lat:40,alt:20000,pitch:-.25},
 {name:'med-5km',lon:6,lat:40,alt:5000,pitch:-.15},
 {name:'med-1km',lon:6,lat:40,alt:1000,pitch:-.1},
 {name:'med-100m',lon:6,lat:40,alt:100,pitch:-.05},
 {name:'med-10m',lon:6,lat:40,alt:10,pitch:-.02},
 // Open ocean far from the owner's view, and the whole disc.
 {name:'atlantic-1500km',lon:-35,lat:30,alt:1500000,pitch:-1.0},
 {name:'pacific-disc',lon:-150,lat:0,alt:15000000,pitch:-3},
];
const wanted=arg('views');const views=wanted?wanted.split(',').map(n=>{const v=VIEWS.find(x=>x.name===n);if(!v)throw Error('no view '+n);return v;}):VIEWS;
const server=await tileServer({web:arg('web','web'),record,maxRequests:+arg('max-requests',0)});
const report={web:arg('web','web'),width:W,height:H,deep_below_m:DEEP,views:[]};
let b;
try{
 b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H});
 await b.evaluate(`solarExplorer.configure({clouds:false})`);
 for(const v of views){
  const eye=toEye(v.lon,v.lat,v.alt),f=heading(v.lon,v.lat,0,v.pitch);
  await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((x,i)=>x+f[i]*1000)])};`);
  const settled=await settle(b,{maxFrames:+arg('frames',6000)});
  const seen=await b.evaluate(`(async()=>{
   const floats=async k=>{const r=await solarExplorer.capture(k);return new Float32Array(r.buffer,r.byteOffset,r.byteLength>>2);};
   const position=await floats('position'),ocean=await floats('ocean');
   let ground=0,deep=0,holes=0,shallow=0,shallow_holes=0,minx=1e9,miny=1e9,maxx=-1,maxy=-1;
   const w=${W},h=${H},mark=new Uint8Array(w*h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,px=position[4*i],py=position[4*i+1],pz=position[4*i+2];
    if(px*px+py*py+pz*pz<0.01)continue;ground++;
    const h=position[4*i+3];if(h>-1)continue;
    if(h>-${DEEP}){shallow++;if(ocean[2*i]===0)shallow_holes++;continue;}
    deep++;if(ocean[2*i]===0){holes++;mark[i]=1;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}
   }
   window.__holes=mark;
   return {ground,deep,holes,shallow,shallow_holes,bounds:holes?[minx,miny,maxx,maxy]:null};
  })()`);
  await capture(b,resolve(dir,`${v.name}.png`),W,H);
  // The holes in red over the image (--overlay).
  if(process.argv.includes('--overlay')&&seen.holes){const raw=await b.evaluate(`(async()=>{const d=await solarExplorer.capture('display'),m=window.__holes;for(let i=0;i<m.length;i++)if(m[i]){d[4*i]=255;d[4*i+1]=0;d[4*i+2]=0;}let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
   await writeFile(resolve(dir,`${v.name}-holes.png`),png(Buffer.from(raw,'base64'),W,H));}
  const row={view:v.name,alt:v.alt,...seen,hole_share:seen.deep?seen.holes/seen.deep:null,quiet:settled.quiet,resident:settled.lag?.pages_resident,failed:settled.lag?.pages_failed,frames:settled.frames};
  report.views.push(row);console.log(JSON.stringify(row));
 }
 const measured=report.views.filter(r=>r.deep>0);
 report.views_with_deep_sea=measured.length;
 report.total_holes=measured.reduce((n,r)=>n+r.holes,0);
 // Not zero: from far away the ground under a pixel comes from the field, and the water mesh, coarser than the pixel, can miss an inlet
 // narrower than its cells. Such a pixel shows the image, which is what the water there shows too, without its reflection.
 report.hole_share_limit=0.001;
 report.pass=measured.length===report.views.length&&measured.every(r=>r.hole_share<=report.hole_share_limit);
 const st=await server.stats();report.server={requests:st.requests,misses:st.misses,upstream:st.upstreamFetches};
 console.log(JSON.stringify({pass:report.pass,total_holes:report.total_holes,views_with_deep_sea:report.views_with_deep_sea,server:report.server}));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));if(b)await b.close();server.close();}

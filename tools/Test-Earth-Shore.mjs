// Water must reach the shore the field says, at every footprint. A coarse triangle crosses the water level anywhere between its vertices, so the mesh can stand above
// water that is there, and the bed or the image's water then shows bare, short of the shore. Each view settles, then four targets are read: a pixel the field calls water
// (the alpha of the shaded target) whose colour the water pass left unchanged is left dry. This counted only footprints of 6 m or more until the owner saw bare sand in square
// blocks, closer in than that: tools/Test-Earth-Water-Arrival.mjs tests what shows while pages arrive. Nothing here judges colour, and water over ground the field calls dry is reported without failing.
// The field can itself be wrong: a coarse height tile cannot hold a lake, and the owner saw a straight edge across Lake Geneva where it said dry. So places known to be open water, from where
// they are and nothing the renderer holds, must also be shaded as water, wherever the lake is large enough on screen to judge. From about 400 km it is some 33 pixels, past where any
// ring holds a page that knows it, and shows as its image. That is reported, not failed.
//   node tools/Test-Earth-Shore.mjs [--web DIR] [--views a,b] [--overlay] --output DIR
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture,png} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/shore'));await mkdir(dir,{recursive:true});
const W=+arg('width',1280),H=+arg('height',720);
// Open water, well inside Lake Geneva: longitude, latitude, radius in metres. Each lies more than its radius from any shore in the recorded z12 height tiles, where the lake reads a flat 371 m.
const KNOWN_WATER=[[6.62,46.46,2000],[6.50,46.44,1500],[6.75,46.44,1500]];
const VIEWS=[
 // The owner's report: along the lake from over its western end, where the page level changes across the water.
 {name:'geneva-along-15km',lon:6.2,lat:46.28,heading:45,pitch:-.35,alt:15000},
 {name:'geneva-along-30km',lon:6.1,lat:46.2,heading:35,pitch:-.25,alt:30000},
 {name:'lausanne',go:'lausanne'},
 {name:'ouchy',go:'ouchy'},
 {name:'geneva-3km',lon:6.63,lat:46.45,heading:180,pitch:-.12,alt:2500},
 {name:'portofino-3km',lon:9.2,lat:44.28,heading:270,pitch:-.2,alt:3000},
 {name:'ligurian-120km',lon:8.9,lat:43.5,heading:10,pitch:-.5,alt:120000},
 {name:'tel-aviv-20km',lon:34.75,lat:32.05,heading:20,pitch:-.4,alt:20000},
 {name:'levant-200km',lon:34.75,lat:32.05,heading:10,pitch:-.9,alt:200000},
 {name:'somme-6km',lon:1.5,lat:50.22,heading:90,pitch:-.25,alt:6000},
 {name:'flanders-6km',lon:2.85,lat:51.25,heading:90,pitch:-.25,alt:6000},
 {name:'crete-30km',lon:25,lat:34.7,heading:0,pitch:-.35,alt:30000},
 {name:'med-1500km',lon:8,lat:34,heading:0,pitch:-1.2,alt:1500000},
 {name:'orbit',go:'earth-orbit'},
];
const wanted=arg('views');const views=wanted?wanted.split(',').map(n=>{const v=VIEWS.find(x=>x.name===n);if(!v)throw Error('no view '+n);return v;}):VIEWS;
const server=await tileServer({web:arg('web','web')});
const report={web:arg('web','web'),width:W,height:H,views:[]};
let b;
try{
 b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H});
 await b.evaluate(`solarExplorer.configure({clouds:false})`);
 for(const v of views){
  if(v.go)await b.evaluate(`solarExplorer.go(${JSON.stringify(v.go)})`);
  else{const eye=toEye(v.lon,v.lat,v.alt),f=heading(v.lon,v.lat,v.heading,v.pitch);await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((x,i)=>x+f[i]*1000)])};`);}
  // Settled in short stretches, each within the harness's time limit for one call.
  let settled=null;for(let k=0;k<40;k++){settled=await settle(b,{maxFrames:150});if(settled.quiet>=45)break;}
  const seen=await b.evaluate(`(async()=>{
   const floats=async k=>{const r=await solarExplorer.capture(k);return new Float32Array(r.buffer,r.byteOffset,r.byteLength>>2);};
   const halves=async k=>{const r=await solarExplorer.capture(k);return new Uint16Array(r.buffer,r.byteOffset,r.byteLength>>1);};
   const half=v=>{const e=(v>>10)&31,m=v&1023;return e===0?m*2**-24:(1+m/1024)*2**(e-15);};
   const position=await floats('position'),ocean=await floats('ocean'),shaded=await halves('shaded'),water=await halves('water');
   const w=${W},h=${H},pixel=${(2*Math.tan(Math.PI/6)/H)};
   let ground=0,far=0,field=0,by_mesh=0,claimed=0,left=0,over=0,minx=1e9,miny=1e9,maxx=-1,maxy=-1,known=0,known_dry=0;const mark=new Uint8Array(${W}*${H});
   const cam=solarExplorer.camera[0],discs=${JSON.stringify(KNOWN_WATER)}.map(([lon,lat,r])=>{const a=lon*Math.PI/180,b=lat*Math.PI/180;return [Math.cos(b)*Math.sin(a),Math.sin(b),Math.cos(b)*Math.cos(a),r/6371000];});
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,px=position[4*i],py=position[4*i+1],pz=position[4*i+2],d2=px*px+py*py+pz*pz;
    if(d2<0.01)continue;ground++;
    const t=Math.sqrt(d2);if(t*pixel>=6)far++;
    const s=4*i,changed=water[s]!==shaded[s]||water[s+1]!==shaded[s+1]||water[s+2]!==shaded[s+2];
    const here=1-half(shaded[s+3]),sea=Math.abs(ocean[2*i]),front=sea>0&&sea<t;
    const wx=cam[0]+px,wy=cam[1]+py,wz=cam[2]+pz,wr=Math.hypot(wx,wy,wz);
    for(const d of discs){if(Math.acos(Math.min(1,(wx*d[0]+wy*d[1]+wz*d[2])/wr))<d[3]){known++;if(!changed)known_dry++;break;}}
    if(here>=.9){field++;if(front)by_mesh++;else claimed++;if(!changed){left++;mark[i]=1;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}}
    else if(here<=.1&&changed&&front){over++;mark[i]=2;}
   }
   window.__shoreMarks=mark;
   return {ground,far,field,by_mesh,claimed,left,over,known,known_dry,bounds:left?[minx,miny,maxx,maxy]:null};
  })()`);
  await capture(b,resolve(dir,`${v.name}.png`),W,H);
  // --overlay: water left dry in red, water over ground the field calls dry in yellow.
  if(process.argv.includes('--overlay')&&(seen.left||seen.over)){const raw=await b.evaluate(`(async()=>{const d=await solarExplorer.capture('display'),m=window.__shoreMarks;for(let i=0;i<m.length;i++){if(m[i]===1){d[4*i]=255;d[4*i+1]=0;d[4*i+2]=0;}else if(m[i]===2){d[4*i]=255;d[4*i+1]=230;d[4*i+2]=0;}}let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
   await writeFile(resolve(dir,`${v.name}-marks.png`),png(Buffer.from(raw,'base64'),W,H));}
  const row={view:v.name,...seen,left_share:seen.field?seen.left/seen.field:0,claimed_share_of_image:seen.claimed/(W*H),over_share_of_image:seen.over/(W*H),quiet:settled.quiet,failed:settled.lag?.pages_failed,water_layer:(await b.evaluate('solarExplorer.stats().water_layer||null'))};
  report.views.push(row);console.log(JSON.stringify(row));
 }
 report.left_share_limit=0.001;report.known_dry_share_limit=0.01;report.known_smallest=100;report.over_share_limit=0.003;
 report.known_pixels=report.views.reduce((n,r)=>n+r.known,0);report.known_dry=report.views.reduce((n,r)=>n+r.known_dry,0);
 report.pass=report.views.every(r=>r.left_share<=report.left_share_limit&&r.over_share_of_image<=report.over_share_limit&&(r.known<report.known_smallest||r.known_dry/r.known<=report.known_dry_share_limit))&&report.known_pixels>0;
 const st=await server.stats();report.server={requests:st.requests,misses:st.misses,upstream:st.upstreamFetches};
 console.log(JSON.stringify({pass:report.pass,total_left:report.views.reduce((n,r)=>n+r.left,0),known_pixels:report.known_pixels,known_dry:report.known_dry,server:report.server}));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));if(b)await b.close();server.close();}

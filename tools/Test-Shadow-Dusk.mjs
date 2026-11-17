// Terrain and cloud shadows at dusk seen from altitude. From 3500 km above a
// point where the sun stands 10 degrees up, the terminator crosses the view:
// ground with the sun below its horizon must be dark, ground under a grazing
// sun must resolve (its terrain march finishes within its step limit), the
// result must not depend on where the camera is, and the coarse cloud-shadow
// map must agree on average with the independent point quadrature. (Until 15
// November gates 2 and 3 checked the coarse horizon maps' clearances; the
// horizon maps were replaced by the exact cached march, see SUN-SHADOWS.md.) The first horizon-map build failed
// all of it: the sweep addressed its heights and horizons by window-relative
// texel instead of the absolute index every other kernel uses, so each
// horizon carried the sun geometry of a place up to a window away (harmless
// at the metre levels, kilometres off at the 16 and 65 km levels), and its
// reference-ray rise was only exact near the ground. The night side beyond
// the 4 km level's window stayed lit, the window edge showed as a square,
// and the cloud lookup of those lit receivers painted stretched global
// texels across them.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/shadow-dusk'));await mkdir(dir,{recursive:true});
const W=960,H=540,ALT=3.5e6;
const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const b=await headless(dir);const report={gates:[],cases:{}};
const gate=(name,pass,metrics)=>{report.gates.push({name,pass,metrics});console.log(JSON.stringify({gate:name,pass,metrics}));};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.go('orbit');solarExplorer.time=0;`);
 const settings=JSON.parse(await b.evaluate('solarExplorer.engine.settings()'));const sun=norm(settings.sun);const R=await b.evaluate('solarExplorer.engine.radius()');
 // Sun frame: t across the sun, u toward the terminator from the sub-solar point.
 const t=norm(cross(sun,[0,0,1]));const u=cross(t,sun);
 const towards=(deg,side)=>norm(sun.map((v,i)=>v*Math.cos(deg*Math.PI/180)+u[i]*Math.sin(deg*Math.PI/180)+t[i]*side));
 const cameras={a:towards(80,0).map(v=>v*(R+ALT)),b:norm(towards(80,0).map((v,i)=>v*Math.cos(700e3/R)+t[i]*Math.sin(700e3/R))).map(v=>v*(R+ALT))};
 const fp=Math.min(10000,ALT*2*Math.tan(Math.PI/6)/H);
 // Receivers: four lines across the terminator (sun 15 degrees up to 5
 // degrees down), 300 km apart, on the surface with the frame's hinted
 // pixel-footprint contract; plus cloud-height points for the cloud maps.
 const probes=[];const meta=[];
 for(let line=0;line<4;line++){for(let i=0;i<128;i++){const deg=75+20*i/127;const n=norm(towards(deg,0).map((v,j)=>v+t[j]*Math.sin(line*300e3/R)));const h=await b.evaluate(`solarExplorer.engine.height(${n.join(',')})`);probes.push(...n.map(v=>v*(R+h+0.05)),-fp);meta.push({line,el:Math.asin(dot(n,sun))*180/Math.PI,h});}}
 const audit=async(input)=>b.evaluate(`(async()=>JSON.parse(await solarExplorer.engine.audit_shadow_points(new Float64Array(${JSON.stringify(input)}))).samples)()`);
 const results={};
 for(const [name,eye] of Object.entries(cameras)){await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,[0,0,0]])}`);await runFrames(b,40);if(name==='a'){await b.evaluate('solarExplorer.configure({shadow_diagnostic:1})');await runFrames(b,5);await capture(b,resolve(dir,'dusk-solid.png'),W,H);await b.evaluate('solarExplorer.configure({shadow_diagnostic:0})');await runFrames(b,5);}results[name]=await audit(probes);}
 const rows=results.a;
 // 1. Ground with the sun 0.3 to 3 degrees below its horizon is dark.
 const night=rows.map((r,i)=>({r,m:meta[i]})).filter(x=>x.m.el<-0.3&&x.m.el>-3);
 const lit=night.filter(x=>x.r[4]>0.02).length;
 report.cases.night={receivers:night.length,lit};
 gate('night side shadowed',night.length>=40&&lit<=night.length*0.02,report.cases.night);
 // 2. Ground under a grazing sun (0 to 3 degrees up) resolves: the terrain
 // march finishes within its step limit there (unresolved flag, slot 5), from
 // both cameras.
 const grazing=rows.map((r,i)=>i).filter(i=>meta[i].el>0&&meta[i].el<3);
 const open=grazing.filter(i=>rows[i][5]>0.5||results.b[i][5]>0.5).length;
 report.cases.grazing={receivers:grazing.length,unresolved:open};
 gate('grazing receivers resolve',grazing.length>=40&&open<=grazing.length*0.02,report.cases.grazing);
 // 4. Camera independence: the same receivers from a camera 700 km aside.
 let flips=0;for(let i=0;i<rows.length;i++){if(Math.abs(rows[i][4]-results.b[i][4])>0.5)flips++;}
 report.cases.camera={receivers:rows.length,flips};
 gate('camera independent',flips<=rows.length*0.03,report.cases.camera);
 // 5. The far receiver's cloud transmittance (the direct march of the
 // filtered field, in these views) is close to unbiased against the point
 // quadrature over the cloudy terrain pixels of two views (the screen
 // audit's transmittance and reference columns). The coverage statistics
 // leave a net +0.06: +0.15 under dense decks, where the coverage term
 // saturates slowly, and -0.24 at cloud-free points; the former mean-density
 // global map sat at -0.085.
 let sum=0,n=0;
 for(const deg of [30,60]){await b.evaluate(`solarExplorer.camera=${JSON.stringify([towards(deg,0).map(v=>v*(R+9e6)),[0,0,0]])}`);await runFrames(b,40);
  const screen=JSON.parse(await b.evaluate('solarExplorer.engine.audit_shadows()')).samples.slice(0,2048);
  for(const r of screen){const terrain=r[3]>=-100&&(r[4]!==0||r[5]!==0||r[6]!==0);if(!terrain)continue;if(r[12]>0.95&&r[13]>0.95)continue;sum+=r[12]-r[13];n++;}}
 report.cases.cloud={cloudy_samples:n,bias:n?sum/n:null};
 gate('far cloud shadow near unbiased',n>=300&&Math.abs(sum/n)<=0.08,report.cases.cloud);
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));
 assert.ok(report.gates.every(g=>g.pass),'dusk shadow gates failed: '+report.gates.filter(g=>!g.pass).map(g=>g.name).join(', '));
 console.log('shadow dusk test passed');
}finally{await b.close();}

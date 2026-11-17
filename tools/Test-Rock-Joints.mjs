// Close views of steep rock on measured ground, for the cracks the owner saw as closed loops. Replays recorded
// tiles in a private browser, and takes the same cameras on whichever build it is pointed at.
//   node tools/Test-Rock-Joints.mjs --web DIR --output DIR
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/rock'));await mkdir(dir,{recursive:true});
const W=1280,H=720,clearance=+arg('clearance',35);
// Faces under the Dents du Midi: longitude, latitude, heading. No claim about each one: the capture shows whether it is rock.
// Everest and Rainier: only the 10 m base imagery there, which is where cracks are added at all.
const SITES=arg('sites','everest')==='swiss'?[[6.918,46.165,120],[6.930,46.158,250]]:[[86.925,27.90,0],[86.95,27.95,60],[86.90,27.97,300],[-121.76,46.80,0],[-121.70,46.87,90],[-121.80,46.87,240]];
const server=await tileServer({web:arg('web','web')});
let b;const report=[];
try{
 b=await earthBrowser(dir,server,{view:'earth-orbit',width:W,height:H,quality:'high'});
 await b.evaluate(`solarExplorer.configure({"clouds":false,"trees":false,"rocks":false,"sun":[0.25,0.6,0.75]})`);
 let n=0;
 for(const [lon,lat,head] of SITES){
  // A high sun off to one side, here, so that every site is lit.
  const a=lon*Math.PI/180,c=lat*Math.PI/180,up=[Math.cos(c)*Math.sin(a),Math.sin(c),Math.cos(c)*Math.cos(a)],east=[Math.cos(a),0,-Math.sin(a)];
  await b.evaluate(`solarExplorer.configure({sun:${JSON.stringify(up.map((v,i)=>v+0.4*east[i]))}})`);
  const f=heading(lon,lat,head,-0.35);let eye=toEye(lon,lat,8000);
  await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((v,i)=>v+f[i]*1000)])};`);
  await settle(b,{maxFrames:900});
  const ground=await b.evaluate('solarExplorer.engine.height(0,1,0)');
  eye=toEye(lon,lat,ground+clearance);
  await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((v,i)=>v+f[i]*1000)])};`);
  await settle(b,{maxFrames:900});
  await capture(b,resolve(dir,`site-${n}.png`),W,H);
  report.push({site:n,lon,lat,head,ground});console.log(JSON.stringify(report.at(-1)));n++;
 }
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));if(b)await b.close();server.close();}

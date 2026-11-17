import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/cloud-coordinates');await mkdir(dir,{recursive:true});const W=384,H=288,b=await headless(dir),report={cases:[],gates:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const half=n=>{const e=(n>>10)&31,m=n&1023;return (n&32768?-1:1)*(e===0?m*2**-24:e===31?Infinity:(1+m/1024)*2**(e-15));};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate(`solarExplorer.resize(${W},${H});solarExplorer.configure({cloud_diagnostic:64,cloud_cover:.4,cloud_type:1,cloud_speed:1,cloud_evolution:1,trees:false,rocks:false,water:false,shadows:false});`);
 for(const time of [0,86400,999999]){
  await b.evaluate(`solarExplorer.time=${time}`);await runFrames(b,1);const raw=await capture(b,resolve(dir,`metric-${time}.bin`),W,H,'cloud');let lengthError=0,angleError=0,areaError=0;
  for(let i=0;i<raw.length;i+=8){lengthError=Math.max(lengthError,Math.abs(half(raw.readUInt16LE(i))-1),Math.abs(half(raw.readUInt16LE(i+2))-1));angleError=Math.max(angleError,Math.abs(half(raw.readUInt16LE(i+4))));areaError=Math.max(areaError,Math.abs(half(raw.readUInt16LE(i+6))-1));}
  report.gates.push({name:`spherical metric at ${time}s`,pass:Math.max(lengthError,angleError,areaError)<.01,lengthError,angleError,areaError});
 }
 await b.evaluate('solarExplorer.time=0;solarExplorer.configure({cloud_speed:0,cloud_evolution:0,cloud_diagnostic:128})');
 for(const view of ['clouds','face-edge','corner','pole','antipode']){
  await b.evaluate(`solarExplorer.go(${JSON.stringify(view)});{const n=solarExplorer.camera[0].map(v=>v/Math.hypot(...solarExplorer.camera[0])),eye=n.map(v=>v*(solarExplorer.engine.radius()+4000));solarExplorer.camera=[eye,eye.map((v,j)=>v-n[j]*1000),Math.abs(n[2])>.9?[0,1,0]:[0,0,1]];}`);await runFrames(b,2);
  const raw=await capture(b,resolve(dir,`${view}-boundary.bin`),W,H,'cloud');let max=0,occupied=0;for(let i=0;i<raw.length;i+=8){const a=half(raw.readUInt16LE(i)),c=half(raw.readUInt16LE(i+2));max=Math.max(max,Math.abs(a-c));occupied+=a>.00001||c>.00001;}
  report.gates.push({name:`${view} cache boundary density`,pass:max<.02,max,occupied});
 }
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.gates));assert.ok(report.gates.every(g=>g.pass));
}finally{await b.close();}

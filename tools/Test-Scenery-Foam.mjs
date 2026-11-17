import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-foam');await mkdir(dir,{recursive:true});const b=await headless(dir),report={cases:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 const source=JSON.parse(await readFile('evidence/local/scenery-water-edges/report.json','utf8')).cases[0].snapshot;
 await b.evaluate(`solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure(${JSON.stringify(source.settings)});solarExplorer.camera=${JSON.stringify(source.camera)};solarExplorer.time=4;`);await runFrames(b,360);
 const images=[];
 for(const [name,foam,caustics] of [['neither',0,false],['foam-only',1,false],['caustics-only',0,true],['both',1,true]]){
  await b.evaluate(`solarExplorer.configure({foam:${foam},caustics:${caustics}});`);const run=await runFrames(b,60);const pixels=await capture(b,resolve(dir,`${name}.png`));images.push(pixels);report.cases.push({name,run,snapshot:await b.evaluate('solarExplorer.snapshot()')});
 }
 report.differences=images.slice(1).map((p,i)=>{let changed=0,total=0,max=0;for(let j=0;j<p.length;j++){if(j%4===3)continue;const d=Math.abs(p[j]-images[0][j]);changed+=d>3;total+=d;max=Math.max(max,d);}return{name:report.cases[i+1].name,mean_codes:total/(1920*1080*3),channels_changed_over_3:changed,max_codes:max};});
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.differences));
}finally{await b.close();}

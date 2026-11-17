// Actual DOM controls, snapshot import, cold publication and frozen wind.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-controls');await mkdir(dir,{recursive:true});
const b=await headless(dir),report={cold:[],gates:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const gate=(name,pass,detail)=>report.gates.push({name,pass,detail});
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate('solarExplorer.engine.profiling(true);solarExplorer.go("forest");solarExplorer.configure({clouds:false,water:false,atmosphere:false});');
 const start=performance.now();let frame=0;
 for(const target of [1,2,4,8,16,32,64,128,240]){const run=await runFrames(b,target-frame);frame=target;report.cold.push({frame,wall_ms:performance.now()-start,stats:run.stats,rows:run.rows});}
 for(const [id,key,value] of [['trees','trees',false],['rocks','rocks',false],['scenery-density','scenery_density',0.5],['scenery-detail','scenery_detail',1.5],['scenery-wind','scenery_wind',2]]){
  const s=await b.evaluate(`(async()=>{const e=document.getElementById(${JSON.stringify(id)});if(e.type==='checkbox'){e.checked=${value};await e.onchange();}else{e.value=${value};await e.oninput();}return solarExplorer.snapshot().settings;})()`);
  gate(`DOM ${id}`,s[key]===value,{actual:s[key],expected:value});
 }
 await runFrames(b,2);const disabled=await b.evaluate('solarExplorer.stats().scenery');gate('toggles remove draws',disabled.mesh_draws===0&&disabled.impostor_draws===0,disabled);
 await b.evaluate('solarExplorer.configure({trees:true,rocks:true,scenery_density:1,scenery_detail:1,scenery_wind:1});solarExplorer.time=0;');await runFrames(b,12);
 const snapshot=await b.evaluate('solarExplorer.snapshot()');const a=await capture(b,resolve(dir,'wind-zero.png'));
 await b.evaluate('solarExplorer.time=2');await runFrames(b,1);const moving=await capture(b,resolve(dir,'wind-two.png'));let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==moving[i]||a[i+1]!==moving[i+1]||a[i+2]!==moving[i+2])changed++;
 gate('wind changes visible foliage',changed>100,{changed_pixels:changed});
 await b.evaluate(`(async()=>{await solarExplorer.configure({scenery_density:0,scenery_wind:0});const input=document.getElementById('file'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(snapshot))}],'scenery-snapshot.json',{type:'application/json'}));input.files=transfer.files;await input.onchange();})()`);await runFrames(b,2);const restored=await capture(b,resolve(dir,'snapshot-restored.png'));gate('snapshot restores exact frozen image',a.equals(restored),{equal:a.equals(restored)});
 const frozen=await capture(b,resolve(dir,'frozen.png'));await new Promise(r=>setTimeout(r,200));await runFrames(b,2);const later=await capture(b,resolve(dir,'frozen-later.png'));gate('paused time holds wind',frozen.equals(later),{equal:frozen.equals(later)});
 report.snapshot=await b.evaluate('solarExplorer.snapshot()');gate('generator version saved',report.snapshot.settings.scenery_version===1,report.snapshot.settings.scenery_version);
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({dir,gates:report.gates}));assert.ok(report.gates.every(g=>g.pass));
}finally{await b.close();}

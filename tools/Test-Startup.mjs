import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const dir=process.argv[2]||'evidence/local/startup/worker';await mkdir(dir,{recursive:true});const b=await headless(dir);
const report={browser:b.version,manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
try{
 await b.send('Page.enable');
 await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.uiHeartbeat=[];window.mainGpuCalls=0;setInterval(()=>uiHeartbeat.push(performance.now()),50);if(globalThis.GPUDevice){for(const method of ['createShaderModule','createComputePipeline','createRenderPipeline']){const original=GPUDevice.prototype[method];GPUDevice.prototype[method]=function(...a){mainGpuCalls++;return original.apply(this,a);};}}`});
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});const started=performance.now();let last='';
 for(let i=0;i<600;i++){
  const s=await b.evaluate('({ready:!!window.explorerReady,error:window.explorerFailure,stage:window.solarStartup})');
  if(s.error)throw Error(s.error);
  if(s.stage?.detail!==last){last=s.stage?.detail;console.log(JSON.stringify({seconds:(performance.now()-started)/1000,stage:s.stage?.stage,detail:last}));}
  if(s.ready)break;if(i===599)throw Error('Startup exceeded 300 seconds');await new Promise(r=>setTimeout(r,500));
 }
 report.ready_ms=performance.now()-started;report.first_image_ms=await b.evaluate('window.solarFirstImage');
 report.startup=await b.evaluate('solarExplorer.startup()');report.progress=await b.evaluate('solarStartup.events');
 report.mainGpuCalls=await b.evaluate('mainGpuCalls');const beats=await b.evaluate('uiHeartbeat');report.mainHeartbeatMaxGapMs=Math.max(...beats.slice(1).map((v,i)=>v-beats[i]));
 assert.equal(report.mainGpuCalls,0,'UI thread compiled GPU work');assert.ok(report.progress.some(e=>e.stage==='Compiling shaders'));assert.equal(report.startup.unexpectedCompiles,0);
 assert.ok(report.mainHeartbeatMaxGapMs<1000,'UI thread blocked for over one second');
 await b.evaluate("solarExplorer.resize(960,540);solarExplorer.engine.profiling(true);solarExplorer.go('forest')");
 report.render=await runFrames(b,60);assert.equal(report.render.stats.device_lost,null);await capture(b,dir+'/forest.png',960,540);
 // Gameplay startup leaves the four diagnostic-only pipelines lazy. Exercise
 // all four explicitly, then reuse their Rust OnceLocks on the same device.
 const diagnostics=['gpu_audit_morph','scenery_audit_contact','scenery_audit_footprint','scenery_audit_cover'];
 assert.deepEqual(report.startup.on_demand,diagnostics);assert.ok(diagnostics.every(k=>!report.startup.pipelines.some(p=>p.name===k)));
 report.audits=[];for(let i=0;i<2;i++){const at=performance.now(),lod=JSON.parse(await b.evaluate('solarExplorer.engine.audit_lod()')),scenery=JSON.parse(await b.evaluate('solarExplorer.engine.audit_scenery()'));assert.ok(lod.nodes.length>0&&lod.probes.length>0);assert.ok(lod.probes.flat().every(Number.isFinite));report.audits.push({ms:performance.now()-at,nodes:lod.nodes.length,probes:lod.probes.length,scenery_objects:scenery.objects.length});}
 if(process.argv.includes('--loss')){
  await b.evaluate('solarExplorer.engine.destroy_device().catch(()=>{})');
  for(let i=0;i<100;i++){if(await b.evaluate('!!window.explorerFailure'))break;await new Promise(r=>setTimeout(r,20));}
  report.loss=await b.evaluate('({error:explorerFailure,retry:!document.getElementById("startup-retry").hidden,pending:solarExplorer.stats().pending})');
  assert.ok(report.loss.error);assert.equal(report.loss.retry,true);assert.equal(report.loss.pending,0);
  await b.evaluate('window.oldDeviceDocument=true');await b.send('Page.reload');const retry=performance.now();let recovered=false;
  for(let i=0;i<1200;i++){const s=await b.evaluate('({old:!!window.oldDeviceDocument,ready:!!window.explorerReady,error:window.explorerFailure})').catch(()=>null);if(s&&!s.old){if(s.error)throw Error(s.error);if(s.ready){recovered=true;break;}}await new Promise(r=>setTimeout(r,100));}
  assert.ok(recovered,'Fresh device did not recover after reload');report.recovery={ready_ms:performance.now()-retry,stats:await b.evaluate('solarExplorer.stats()')};
 }
 await writeFile(dir+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({ready_ms:report.ready_ms,first_image_ms:report.first_image_ms,bridge_first_ms:report.startup.first_ms,bridge_complete_ms:report.startup.compile_ms,lanes:report.startup.concurrency,heartbeat:report.mainHeartbeatMaxGapMs,mainGpuCalls:report.mainGpuCalls,pipelines:report.startup.pipelines.slice().sort((a,b)=>b.ms-a.ms).slice(0,12)}));
}catch(error){report.error=String(error);report.progress=await b.evaluate('window.solarStartup').catch(()=>null);await writeFile(dir+'/report.json',JSON.stringify(report,null,2));throw error;}finally{await b.close();}

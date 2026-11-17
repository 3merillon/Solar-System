// Real WASM flight and the preview's time controls; no desktop input.
import assert from 'node:assert/strict';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/cloud-rework/time-camera');
await mkdir(dir,{recursive:true});const b=await headless(dir);let report;
try{
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?body=solar&test=1&quality=high'});await ready(b);
 report=await b.evaluate(`(async()=>{
  const s=solarFlight,f=s.flight,delta=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  solarExplorer.go('wupper');const start=s.frame(0,new Set(),100),rows=[];
  const pose=()=>s.frame(0,new Set(),100),check=(name,before,after)=>rows.push({name,position:delta(before[0],after[0]),forward:delta(before[1].map((v,i)=>v-before[0][i]),after[1].map((v,i)=>v-after[0][i])),up:delta(before[2],after[2])});
  document.getElementById('solar-daylight').click();check('local noon',start,pose());
  const noon=pose();for(let i=0;i<600;i++)f.step(1/60,new Float64Array([0,0,0,100,0,0,0,0,1,0]));check('hover ten seconds paused',noon,pose());
  const beforeDate=pose(),input=document.getElementById('solar-time');input.value='2026-11-03T20:30';input.dispatchEvent(new Event('change'));check('UTC date change',beforeDate,pose());
  const beforeNow=pose();document.getElementById('solar-now').click();check('Now',beforeNow,pose());
  const beforeLook=pose();s.look(500,-100);rows.push({name:'head turn',position:delta(beforeLook[0],pose()[0]),forward:0,up:0});
  const {SolarFlight}=await import('/pkg/solar_explorer.js'),flights=[];
  for(const [rate,shift] of [[0,0],[1,0],[60,0],[0,21600]]){
   const test=new SolarFlight(8.5e8+shift,399,100);test.jump_camera(399,start.flat());test.set_rate(rate);const a=test.packet(960,540);
   for(let i=0;i<120;i++)test.step(1/60,new Float64Array([0,0,1,100,0,0,0,0,1,0]));const p=test.packet(960,540);
   flights.push({rate,shift,displacement:Array.from(p.slice(0,3),(v,i)=>v-a[i])});test.free();
  }
  return {rows,flights,timeVisible:document.getElementById('solar-time').type==='datetime-local',sunHidden:getComputedStyle(document.getElementById('sun').closest('label')).display==='none',date:input.value};
 })()`);
 assert.ok(report.timeVisible&&report.sunHidden);
 assert.ok(report.rows.every(r=>r.position<.05&&r.forward<.001&&r.up<1e-6),JSON.stringify(report.rows));
 for(const f of report.flights)assert.ok(Math.hypot(...f.displacement.map((v,i)=>v-report.flights[0].displacement[i]))<.05,'Time changed surface flight response');
 report.pass=true;console.log(JSON.stringify(report));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));await b.close();}

// Exercise the live resize handler, including a resize during startup before
// the render worker can allocate its new targets. The test-mode URL fixes the
// renderer size, so this check uses the normal flight entry point.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';

const dir=process.argv[2]||'evidence/local/viewport-resize';
const base=process.argv[3]||'http://127.0.0.1:5198/';
await mkdir(dir,{recursive:true});
const b=await headless(dir);
const resize=(width,height)=>b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
const observations=[];
try{
 await resize(960,540);
 await b.send('Page.navigate',{url:new URL('explorer.html?body=procedural&quality=high',base).href});
 await b.evaluate('(async()=>{while(!window.solarStartup)await new Promise(r=>setTimeout(r,10))})()');
 await resize(440,660);
 await ready(b);
 for(const [width,height] of [[440,660],[1100,230],[700,400],[640,720],[960,540]]){
  await resize(width,height);
  let observation;
  for(let i=0;i<100;i++){
   observation=await b.evaluate(`(()=>{
    const canvas=document.getElementById('world'),style=getComputedStyle(canvas),s=solarExplorer.stats();
    return {renderer:[s.display_width,s.display_height],canvas:[canvas.clientWidth,canvas.clientHeight],
     padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft].map(parseFloat)};
   })()`);
   if(observation.renderer[0]===width&&observation.renderer[1]===height)break;
   await new Promise(r=>setTimeout(r,50));
  }
  observations.push(observation);
  assert.deepEqual(observation.renderer,[width,height]);
  assert.deepEqual(observation.canvas,[width,height]);assert.deepEqual(observation.padding,[0,0,0,0]);
 }
 console.log('The canvas and renderer filled all five viewports.');
}finally{await writeFile(dir+'/report.json',JSON.stringify(observations,null,2));await b.close();}

// Interface screenshots and a layout check, in a private headless browser (never the owner's desktop).
// For each viewport (desktop, and phones with device and touch emulation) and each scene, a page screenshot and a check that
// every visible control is on screen, that no two controls overlap, that each control is the element hit at its own centre, and
// that the interface regions (panel, dock, touch controls) do not overlap each other.
//   node tools/Capture-UI.mjs --base http://127.0.0.1:5231 --out DIR [--sizes 1920x1080,390x844m] [--scenes earth,moon] [--states closed,open] [--no-startup 1]
// A size ending in m is a phone: mobile, touch, device scale 3 (portrait or landscape by its numbers).
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5231'),out=resolve(arg('out','evidence/local/ui'));mkdirSync(out,{recursive:true});
const sizes=arg('sizes','1920x1080,1280x720,390x844m,844x390m').split(',').map(s=>{const m=/^(\d+)x(\d+)(m?)$/.exec(s);return {w:+m[1],h:+m[2],mobile:!!m[3],name:s};});
const T=852076800;
const SCENES={
 earth:{q:`body=solar&tdb=${T}`},
 moon:{q:`body=solar&tdb=${T}&at=301&height=400000`},
 jump:{q:`body=solar&tdb=${T}`,setup:`(async()=>{const s=document.getElementById('world-select');s.value='10000';s.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,450));})()`,wait:0},
 fast:{q:`body=solar&tdb=${T}`,setup:`solarFlight.setRate(7)`,wait:2500},
 sun:{q:`body=solar&tdb=${T}&at=10&height=20000000000`},
 'time-hidden':{q:`body=solar&tdb=${T}`,setup:`document.getElementById('time-hide').click()`},
 'time-more':{q:`body=solar&tdb=${T}`,setup:`document.getElementById('time-set').click()`},
 // The panel scrolled to its foot, so the Support group and its links are held to the same rules.
 'panel-foot':{q:`body=solar&tdb=${T}`,setup:`document.getElementById('support-section').scrollIntoView({block:'end'})`},
 'local-earth':{q:'body=earth'},
 'local-procedural':{q:'body=procedural'},
};
const scenes=arg('scenes',Object.keys(SCENES).join(',')).split(',');
const states=arg('states','default,toggled').split(',');
// In the page: the layout check.
const CHECK=`(()=>{
 const W=innerWidth,H=innerHeight,shown=e=>{if(e.closest('[hidden]'))return false;for(let p=e;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)return false;}for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!(e.tagName==='SUMMARY'&&e.parentElement===p))return false;return true;};
 const clip=e=>{const r=e.getBoundingClientRect();let [x0,y0,x1,y1]=[r.left,r.top,r.right,r.bottom];for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(c.overflowX+c.overflowY)){const q=p.getBoundingClientRect();x0=Math.max(x0,q.left);y0=Math.max(y0,q.top);x1=Math.min(x1,q.right);y1=Math.min(y1,q.bottom);}}return [x0,y0,x1,y1];};
 const name=e=>e.id?'#'+e.id:(e.tagName.toLowerCase()+(e.dataset.go?'[data-go='+e.dataset.go+']':'')+(e.textContent?':'+e.textContent.trim().slice(0,18):''));
 const controls=[...document.querySelectorAll('button,select,input,summary,a[href],[role=slider],textarea')].filter(e=>e.type!=='file'&&e.type!=='hidden'&&shown(e)).map(e=>({e,c:clip(e)})).filter(o=>o.c[2]-o.c[0]>0.5&&o.c[3]-o.c[1]>0.5&&!o.e.closest('#hyperdrive,#startup'));
 const problems=[];
 for(const o of controls){const [x0,y0,x1,y1]=o.c;if(x0<-0.5||y0<-0.5||x1>W+0.5||y1>H+0.5)problems.push('off screen '+name(o.e)+' '+o.c.map(Math.round).join(','));
  const hit=document.elementFromPoint((x0+x1)/2,(y0+y1)/2);if(hit?.closest?.('#hyperdrive'))continue;if(!hit||!(hit===o.e||o.e.contains(hit)||hit.contains(o.e)&&hit.tagName==='LABEL'||(hit.tagName==='LABEL'&&hit.control===o.e)))problems.push('covered '+name(o.e)+' by '+(hit?name(hit):'nothing'));}
 for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;const w=Math.min(a.c[2],b.c[2])-Math.max(a.c[0],b.c[0]),h=Math.min(a.c[3],b.c[3])-Math.max(a.c[1],b.c[1]);if(w>0.5&&h>0.5)problems.push('overlap '+name(a.e)+' / '+name(b.e)+' '+w.toFixed(0)+'x'+h.toFixed(0));}
 const regions=['#explorer-controls','#dock','#solar-hud','#deck-audio','#toggle-ui','#attribution','#touch-stick','#touch-buttons','#touch-throttle','#touch-speed','#field-notice','#time-chip','header','footer'].map(s=>document.querySelector(s)).filter(e=>e&&shown(e)).map(e=>({e,r:e.getBoundingClientRect()})).filter(o=>o.r.width>0&&o.r.height>0);
 // A region inside another (the navigation inside the panel) scrolls with it: only the outer one is held to the screen.
 regions.splice(0,regions.length,...regions.filter(o=>!regions.some(p=>p!==o&&p.e.contains(o.e))));
 for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){const a=regions[i],b=regions[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;const w=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left),h=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);if(w>0.5&&h>0.5)problems.push('region overlap '+name(a.e)+' / '+name(b.e)+' '+w.toFixed(0)+'x'+h.toFixed(0));}
 for(const o of regions){const r=o.r;if(r.left<-0.5||r.top<-0.5||r.right>W+0.5||r.bottom>H+0.5)problems.push('region off screen '+name(o.e));}
 return {controls:controls.length,regions:regions.map(o=>name(o.e)),problems};
})()`;
const results=[];let failures=0;
const b=await headless(join(out,'.profile'));
try{
 for(const size of sizes){
  await b.send('Emulation.setDeviceMetricsOverride',{width:size.w,height:size.h,deviceScaleFactor:size.mobile?3:1,mobile:size.mobile,screenOrientation:size.mobile?{type:size.w>size.h?'landscapePrimary':'portraitPrimary',angle:size.w>size.h?90:0}:undefined});
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:size.mobile,maxTouchPoints:size.mobile?5:1});
  // Startup on the solar page: from the first paint to ready, no travel-mode control (Orbit, Fly, Walk, the touch mode button, the
  // descent) may show, not even for a frame. Polled every 30 ms, with a screenshot part way.
  if(!arg('no-startup')){
   await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=high&limits=off&body=solar&tdb=${T}`});
   let polls=0,seen=[],shotTaken=false;const t0=Date.now();
   for(;Date.now()-t0<60000;polls++){
    const r=await b.evaluate(`(()=>{const vis=e=>{if(!e||e.closest('[hidden]'))return false;const q=e.getBoundingClientRect();return q.width>0&&q.height>0&&getComputedStyle(e).visibility!=='hidden';};const bad=[...document.querySelectorAll('[data-mode],#touch-mode,#descent,.modes,button')].filter(e=>vis(e)&&(e.matches('[data-mode],#touch-mode,#descent,.modes')||/^(Orbit|Walk)/.test(e.textContent.trim()))).map(e=>e.id||e.textContent.trim().slice(0,20));return {bad,ready:!!window.explorerReady,started:!!document.getElementById('startup')};})()`).catch(()=>({bad:[],ready:false,started:false}));
    if(r.bad.length)seen.push(...r.bad);
    if(r.started&&!shotTaken){shotTaken=true;const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,`startup-${size.name}.png`),Buffer.from(shot.data,'base64'));}
    if(r.ready)break;await new Promise(r=>setTimeout(r,30));
   }
   const problems=[...new Set(seen)].map(x=>'mode control during startup: '+x);
   results.push({size:size.name,scene:'startup',state:'startup',file:`startup-${size.name}.png`,controls:0,regions:[],problems,polls});if(problems.length)failures++;
   console.log(problems.length?'FAIL':'pass',size.name,'startup',`${polls} polls`,problems.join(' | '));
  }
  for(const scene of scenes){
   const s=SCENES[scene];if(!s)throw Error('unknown scene '+scene);
   for(const state of states){
    await b.send('Page.navigate',{url:`${base}/explorer.html?test=1&quality=high&limits=off&${s.q}`});
    await ready(b);
    await b.evaluate(`(()=>{try{localStorage.clear();}catch{}solarExplorer.paused=false;})()`);
    await new Promise(r=>setTimeout(r,1800));
    if(state==='toggled')await b.evaluate(`document.getElementById('toggle-ui').click()`);
    if(s.setup)await b.evaluate(s.setup);
    await new Promise(r=>setTimeout(r,s.wait??900));
    const shot=await b.send('Page.captureScreenshot',{format:'png'});
    const file=`${scene}-${size.name}-${state}.png`;writeFileSync(join(out,file),Buffer.from(shot.data,'base64'));
    const check=await b.evaluate(CHECK);
    await b.evaluate(`(()=>{try{localStorage.clear();}catch{}})()`);
    const row={size:size.name,scene,state,file,...check};results.push(row);
    if(check.problems.length)failures++;
    console.log(check.problems.length?'FAIL':'pass',size.name,scene,state,`${check.controls} controls`,check.problems.slice(0,6).join(' | '));
   }
  }
 }
}finally{await b.close();}
writeFileSync(join(out,'layout-check.json'),JSON.stringify({base,results},null,1));
console.log(`${results.length-failures}/${results.length} layouts clean`);
process.exitCode=failures?1:0;

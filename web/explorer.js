import {installFlightDeck} from './flight-deck.js';
import {packSite} from './pack-base.js';
import {createWorkerExplorer} from './worker-client.js';
import {Flight,RenderClock,add,mul,len,norm} from './flight.js';
import {PRESETS,PRESET_KEYS,presetOf,detectDevice,startingPreset,canvasSize,allocationTier,world} from './quality.js';
import {TouchControls} from './touch.js';
import {startSolar} from './solar.js';
import {guardBrowser,forGame} from './game-input.js';
import {installCredits} from './credits.js';
guardBrowser();
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);let canvas=$('world');
const updateCredits=installCredits($('attribution'));
let solar=null,engine,camera,flight,paused=params.has('test'),time=0,last=performance.now(),speed=100,keys=new Set(),look=false,ready=false,lastStats=0;
const renderClock=new RenderClock();
function setCamera(value){flight=new Flight(value);camera=flight.camera;}
function step(dt=1/60){return engine.render(camera.flat(),dt,time,solar?solar.packet():undefined,solar?solar.trails():undefined,solar?solar.probe():undefined);}
function snapshot(){return {version:1,settings:JSON.parse(engine.settings()),camera,mode:'flight',time,animation:JSON.parse(engine.animation())};}
// Poll the renderer until every deferred feature exists; explorerReady (the
// regression tools' gate) means the complete renderer, not the first image.
async function settle(){for(;;){if(startupFailed)return;const pending=JSON.parse(await engine.complete_pending());if(!pending.length)break;$('state').textContent=`Compiling ${pending.join(', ')}…`;await new Promise(r=>setTimeout(r,100));}$('state').textContent='Ready to explore';window.explorerReady=true;}
function fail(e){$('error').hidden=false;$('error').textContent=String(e);$('state').textContent='Explorer needs attention';console.error(e);}
const startupPanel=document.createElement('section');startupPanel.id='startup';startupPanel.setAttribute('role','status');startupPanel.setAttribute('aria-live','polite');startupPanel.innerHTML='<div class="eyebrow">Starting</div><h2 id="startup-stage">Starting render worker</h2><p id="startup-detail">Preparing the planet</p><progress id="startup-progress"></progress><p id="startup-time"></p><p id="startup-note">The first launch compiles the GPU programs, which can take a minute or more. Later launches usually start faster: the browser keeps much of that work.</p><button id="startup-retry" hidden>Retry initialization</button>';document.body.append(startupPanel);
let startupStarted=performance.now(),startupFailed=false,startupLast={};
const elapsedTimer=setInterval(()=>{if(!startupPanel.hidden)$('startup-time').textContent=`${((performance.now()-startupStarted)/1000).toFixed(1)} s elapsed${startupLast.total?` · ${startupLast.completed??0}/${startupLast.total} pipelines ready`:''}`;},100);
function startupProgress(value){startupLast=value;$('startup-stage').textContent=value.stage;$('startup-detail').textContent=value.detail||'';if(!ready)$('state').textContent=value.stage;const p=$('startup-progress');if(value.total){p.max=value.total;p.value=value.completed??0;}else p.removeAttribute('value');window.solarStartup={...value,events:[...(window.solarStartup?.events||[]),value]};}
function rendererFailed(e){ready=false;paused=true;startupFailed=true;window.explorerReady=false;window.explorerFailure=String(e);startupPanel.hidden=false;$('startup-stage').textContent='Renderer stopped';$('startup-detail').textContent=String(e);$('startup-retry').hidden=false;$('explorer-controls').inert=true;fail(e);}
function updateSpeed(){speed=10**Number($('speed').value);$('speed-value').textContent=speed>=1000?`${(speed/1000).toFixed(1)} km/s`:`${speed.toFixed(speed<10?1:0)} m/s`;touch?.setSpeed($('speed-value').textContent,(Number($('speed').value)+1)/8);}
function go(name){if(solar){solar.goEarth(name);setCamera(solar.frame(0,keys,speed));return;}const place=JSON.parse(engine.bookmark(name));if(name==='earth-orbit')place[2]=[0,1,0];setCamera(place);keys.clear();}
async function configure(patch){const s={...JSON.parse(engine.settings()),...patch};const applied=engine.configure(JSON.stringify(s));syncWaterUi(s);syncCloudUi(s);syncTerrainUi(s);syncSceneryUi(s);syncQualityUi(s);await applied;return s;}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function capture(){await engine.flush();const size=JSON.parse(engine.stats());const bytes=await engine.capture('display');const c=document.createElement('canvas');c.width=size.width;c.height=size.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),c.width,c.height),0,0);c.toBlob(b=>download(b,'solar-explorer.png'));}
function rotate(dx,dy){flight.look(dx,dy);camera=flight.camera;}
// Flight is the only way to travel (owner, 16 November 2026): no orbit camera and no walking. The eye stays a metre over the ground.
function move(dt){
 flight.move(keys,dt,speed,false,touch?.enabled?touch.analog:null);
 const eye=flight.position,n=norm(eye),minimum=engine.radius()+engine.safe_height(...n)+1.0;if(len(eye)<minimum)flight.position=mul(n,minimum);
 camera=flight.camera;
}
async function tick(now){const elapsed=Math.max(0,(now-last)/1000),dt=Math.min(.05,elapsed);last=now;if(ready&&!paused){try{if(solar)camera=solar.frame(dt,keys,speed,touch?.enabled?touch.analog:null);else move(dt);if($('animate').checked)time+=Math.min(1,elapsed);renderClock.advance(elapsed);renderClock.submit(step);if(now-lastStats>500){lastStats=now;const s=JSON.parse(engine.stats()),rows=JSON.parse(engine.telemetry()),times=rows.map(r=>r.gpu_span_ms??(r.gpu_ms?.reduce((a,b)=>a+b,0)??null)).filter(Number.isFinite).sort((a,b)=>a-b);const gpu=times.length?times[times.length>>1]:null;if(solar)solar.report(s);else{const n=norm(camera[0]),alt=len(camera[0])-engine.radius()-engine.height(...n),text=`${alt>=1000?(alt/1000).toFixed(1)+' km':alt.toFixed(1)+' m'} above the terrain`;if($('hud-readout').textContent!==text)$('hud-readout').textContent=text;}$('performance').textContent=`${s.width} × ${s.height} · ${gpu===null?'—':gpu.toFixed(2)+' ms GPU'}`;$('state').textContent=!$('diagnostics').open?'Ready':s.pending_samples?`Refining · ${s.pending_samples.toLocaleString()} samples queued`:s.morph<1?'Refining the landscape':`${s.patches} patches · local explorer`;$('stats').textContent=`${s.triangles.toLocaleString()} triangles\nLevel ${s.max_level} · ${s.samples.toLocaleString()} cached samples\n${(s.controlled_gpu_bytes/1048576).toFixed(1)} MiB controlled GPU\nClouds ${s.cloud_resolution.join(' × ')}\nBound shortfall ${s.error_bound_pixels.toFixed(1)} px\nResource deferrals ${s.denied}\nScenery ${s.scenery?.trees??0} trees · ${s.scenery?.rocks??0} rocks\nUrban sources ${s.buildings?.sources??0} · omitted ${((s.field?.vectors?.overBudget??0)+(s.field?.vectors?.complex??0)+(s.field?.vectors?.roadOverflow??0))}\nScenery pending ${s.scenery?.deferred??0} · overflow ${s.scenery?.overflow??0}\nSupport waiting ${s.scenery?.support_deferred??0}\nScenery ${((s.scenery_gpu_bytes??0)/1048576).toFixed(1)} MiB`;}}catch(e){paused=true;fail(e);}}else renderClock.reset();requestAnimationFrame(tick);}
// The panel stops above whatever sits under it at the bottom (the dock, the touch controls), so nothing overlaps at any size.
// Where that would leave too little panel on a touch screen, the open panel is a sheet: the dock and the touch controls step aside
// until it is closed (a tap on the world closes it). Measured on resize and when the panel or the dock changes, never per frame.
function layout(){
 const body=document.body,panel=$('explorer-controls');if(!panel)return;
 body.classList.remove('panel-sheet');document.documentElement.style.setProperty('--dock-reserve','0px');
 const p=panel.getBoundingClientRect(),H=innerHeight;let reserve=0;
 for(const id of ['dock','touch-stick','touch-buttons','touch-throttle']){const e=$(id);if(!e||e.closest('[hidden]'))continue;const r=e.getBoundingClientRect();if(r.width&&r.height&&r.left<p.right+8&&r.right>p.left-8)reserve=Math.max(reserve,H-r.top+8);}
 const room=H-p.top-12-reserve;
 let touching=false;try{touching=!!touch?.enabled;}catch{}
 if(touching&&room<300)body.classList.add('panel-sheet');else document.documentElement.style.setProperty('--dock-reserve',reserve+'px');
}
addEventListener('resize',()=>layout());
function setUiCollapsed(collapsed){
 document.body.classList.toggle('hidden-ui',collapsed);
 const button=$('toggle-ui');button.setAttribute('aria-expanded',String(!collapsed));button.title=`${collapsed?'Open':'Collapse'} the panel (H)`;button.innerHTML=`<span class="toggle-glyph" aria-hidden="true">${collapsed?'›':'‹'}</span><span class="toggle-text">${collapsed?'Panel':'Hide'}</span> <kbd>H</kbd>`;
 if(collapsed&&$('panel-body').contains(document.activeElement))button.focus({preventScroll:true});
 layout();
 engine?.profiling(!collapsed&&$('diagnostics').open);
 try{localStorage.setItem('solar.skin.ui-collapsed',String(collapsed));}catch{}
}
let savedUiCollapsed=false;try{savedUiCollapsed=localStorage.getItem('solar.skin.ui-collapsed')==='true';}catch{}
setUiCollapsed(savedUiCollapsed);
$('toggle-ui').onclick=()=>setUiCollapsed(!document.body.classList.contains('hidden-ui'));
$('diagnostics').ontoggle=()=>engine?.profiling($('diagnostics').open&&!document.body.classList.contains('hidden-ui'));
canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(e.button===2){look=true;canvas.setPointerCapture(e.pointerId);}});canvas.addEventListener('pointerup',()=>look=false);canvas.addEventListener('lostpointercapture',()=>look=false);canvas.addEventListener('pointermove',e=>{if(!look||!ready)return;if(solar){solar.look(e.movementX,e.movementY);return;}rotate(e.movementX,e.movementY);});
function nudgeSpeed(delta){$('speed').value=Math.max(-1,Math.min(7,Number($('speed').value)+delta));updateSpeed();}
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!ready)return;nudgeSpeed(-e.deltaY*.001);},{passive:false});
// Touch: drag looks, pinch scales the travel speed, a twist rolls; the stick and buttons feed the
// flight model's displacement. Enabled for coarse pointers and on first touch.
const touch=new TouchControls(canvas,{
 look:(dx,dy)=>{if(!ready)return;if(solar){solar.look(dx,dy);return;}rotate(dx,dy);},
 pinch:ratio=>{if(!ready||!(ratio>0))return;nudgeSpeed(Math.log10(ratio));},
 twist:angle=>{if(!ready)return;if(solar){solar.roll(angle);return;}flight.turn(flight.forward,angle);camera=flight.camera;},
 speedFraction:v=>{if(!ready)return;$('speed').value=-1+8*v;updateSpeed();},
 // A tap on the world closes the controls panel on touch layouts.
 tapWorld:()=>{if(touch.enabled&&!document.body.classList.contains('hidden-ui'))setUiCollapsed(true);}
});
function enableTouch(){touch.enable(true);layout();}
let dockSize='';new ResizeObserver(([e])=>{const r=e.contentRect;if(!r.width)return;const k=`${r.width}x${r.height}`;if(k!==dockSize){dockSize=k;layout();}}).observe($('dock'));
updateSpeed();
if(matchMedia('(pointer: coarse)').matches)enableTouch();window.addEventListener('touchstart',()=>enableTouch(),{once:true,passive:true});
window.addEventListener('keydown',e=>{if(!forGame(e))return;if(e.code==='KeyH'&&!e.repeat){e.preventDefault();setUiCollapsed(!document.body.classList.contains('hidden-ui'));return;}if(!ready)return;keys.add(e.code);if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyC','Space','PageUp','PageDown'].includes(e.code))e.preventDefault();});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();look=false;});
$('destination').onchange=()=>go($('destination').value);$('speed').oninput=updateSpeed;
for(const id of ['water','atmosphere','clouds','caustics'])$(id).onchange=()=>configure({[id]:$(id).checked}).catch(fail);$('history').onchange=()=>configure({cloud_history:$('history').checked}).catch(fail);for(const id of ['seed','body','debug'])$(id).onchange=()=>configure({[id]:Number($(id).value)}).catch(fail);$('sun').oninput=()=>configure({sun:[-.45,Number($('sun').value),.38]}).catch(fail);
function syncSceneryUi(s){for(const id of ['trees','rocks','buildings','ground_cover'])$(id).checked=s[id];$('cover-reach').value=s.cover_reach;$('cover-reach-value').textContent=Math.round(s.cover_reach)+' m';for(const [id,key] of [['scenery-density','scenery_density'],['scenery-detail','scenery_detail'],['scenery-wind','scenery_wind']]){$(id).value=s[key];$(id+'-value').textContent=Number(s[key]).toFixed(1)+'x';}}
for(const id of ['trees','rocks','buildings','ground_cover'])$(id).onchange=()=>configure({[id]:$(id).checked}).catch(fail);
$('cover-reach').oninput=()=>configure({cover_reach:Number($('cover-reach').value)}).catch(fail);
for(const [id,key] of [['scenery-density','scenery_density'],['scenery-detail','scenery_detail'],['scenery-wind','scenery_wind']])$(id).oninput=()=>configure({[key]:Number($(id).value)}).catch(fail);
function syncTerrainUi(s){$('lod-distance').value=s.lod_distance;$('lod-distance-value').textContent=Number(s.lod_distance).toFixed(1)+'x';$('surface-detail').checked=s.surface_detail;$('ground-detail').checked=s.ground_detail;}
$('surface-detail').onchange=()=>configure({surface_detail:$('surface-detail').checked}).catch(fail);
$('ground-detail').onchange=()=>configure({ground_detail:$('ground-detail').checked}).catch(fail);
$('lod-distance').oninput=()=>configure({lod_distance:Number($('lod-distance').value)}).catch(fail);
function syncWaterUi(s){$('sea').value=s.sea;$('sea-slider').value=s.sea;for(const [id,key,unit] of [['wave-height','wave_height','m'],['wave-speed','wave_speed','x'],['water-clarity','water_clarity','x'],['foam','foam','x']]){$(id).value=s[key];$(id+'-value').textContent=Number(s[key]).toFixed(1)+(unit==='m'?' m':'x');}for(const id of ['water','caustics','atmosphere','clouds'])$(id).checked=s[id];$('history').checked=s.cloud_history;}
async function seaLevel(value){try{const s=await configure({sea:value});syncWaterUi(s);}catch(e){syncWaterUi(JSON.parse(engine.settings()));fail(e);}}
$('sea').onchange=()=>seaLevel(Number($('sea').value));$('sea-slider').oninput=()=>seaLevel(Number($('sea-slider').value));
$('sea-here').onclick=()=>seaLevel(Math.max(-10000,Math.min(10000,Math.round((len(camera[0])-engine.radius()-1.8)*10)/10)));
$('sea-reset').onclick=()=>seaLevel(0);
for(const [id,key] of [['wave-height','wave_height'],['wave-speed','wave_speed'],['water-clarity','water_clarity'],['foam','foam']])$(id).oninput=()=>configure({[key]:Number($(id).value)}).then(syncWaterUi).catch(fail);
$('edit').onclick=()=>{const s=JSON.parse(engine.settings());if(s.edits.length>=16)return fail('The 16-brush edit pool is full. Save the world or remove edits in its snapshot.');s.edits.push([...norm(camera[0]),100,12]);configure(s).catch(fail);};$('capture').onclick=()=>capture().catch(fail);
let places=JSON.parse(localStorage.getItem('solar.skin.places')||'[]');function refreshPlaces(){const select=$('saved');select.innerHTML='<option value="">Saved places</option>';places.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.name;select.append(o);});}refreshPlaces();$('bookmark').onclick=()=>{places.push({name:`Place ${places.length+1}`,camera});places=places.slice(-16);localStorage.setItem('solar.skin.places',JSON.stringify(places));refreshPlaces();};$('saved').onchange=()=>{const p=places[Number($('saved').value)];if(p)setCamera(p.camera);};
$('export').onclick=()=>download(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),'solar-world.json');$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{try{const value=JSON.parse(await $('file').files[0].text());if(value.version!==1||!Array.isArray(value.camera)||![6,9].includes(value.camera.flat().length)||!value.camera.flat().every(Number.isFinite))throw Error('Invalid explorer snapshot');await configure(value.settings);setCamera(value.camera);time=value.time??0;if(value.animation)engine.restore_animation(JSON.stringify(value.animation));else engine.restore_animation(JSON.stringify({time:0,travel:0,evolution:0,drift:[0,0]}));}catch(e){fail(e);}};
const cloudSliders=[['cloud-cover','cloud_cover'],['cloud-type','cloud_type'],['cloud-speed','cloud_speed'],['cloud-evolution','cloud_evolution'],['cloud-turbulence','cloud_turbulence']];
function syncCloudUi(s){
 $('cloud-scale').value=s.cloud_scale;$('cloud-steps').value=s.cloud_steps;
 for(const [id,key] of cloudSliders){$(id).value=s[key];$(id+'-value').textContent=id==='cloud-type'?(Math.abs(s[key])<.05?'Natural mix':s[key]<0?'More stratus':'More cumulus'):Number(s[key]).toFixed(2);}
 const wind=Math.hypot(...s.wind),direction=(Math.atan2(s.wind[1],s.wind[0])*180/Math.PI+360)%360;
 $('cloud-wind').value=wind;$('cloud-direction').value=direction;$('cloud-wind-value').textContent=wind.toFixed(0)+' m/s';$('cloud-direction-value').textContent=direction.toFixed(0)+'°';
}
for(const [id,key] of cloudSliders)$(id).oninput=()=>configure({[key]:Number($(id).value)}).catch(fail);
$('cloud-scale').onchange=()=>{const scale=Number($('cloud-scale').value);configure({cloud_scale:scale,reference:scale===1}).catch(fail);};
$('cloud-steps').onchange=()=>configure({cloud_steps:Number($('cloud-steps').value)}).catch(fail);
// Quality presets and the individual knobs behind them.
let device={mobile:false,weak:false,reason:'not detected'};
function syncQualityUi(s){
 $('quality').value=presetOf(s);$('quality-name').textContent=$('quality').selectedOptions[0]?.textContent.split(' · ')[0]??'';
 $('render-scale').value=String(s.render_scale);$('cloud-far-scale').value=String(s.cloud_far_scale);
 $('cloud-far-distance').value=s.cloud_far_distance;$('cloud-far-distance-value').textContent=(s.cloud_far_distance/1000).toFixed(0)+' km';
 $('cloud-refresh').value=s.cloud_refresh;$('cloud-refresh-value').textContent=s.cloud_refresh===1?'every texel each frame':`1/${s.cloud_refresh} per frame`;
 $('shadows').checked=s.shadows;$('water-reflections').checked=s.water_reflections;$('bloom').checked=s.bloom;$('lens-flare').checked=s.lens_flare;$('auto-exposure').checked=s.auto_exposure;
 for(const [id,key,format] of [['shadow-steps','shadow_steps',v=>v],['shadow-cascades','shadow_cascades',v=>v],['profile-quality','profile_quality',v=>Math.round(v*100)+'%'],['atmosphere-steps','atmosphere_steps',v=>v],['water-bands','water_bands',v=>v],['relief-steps','relief_steps',v=>v]]){$(id).value=s[key];$(id+'-value').textContent=format(s[key]);}
}
function applyPreset(name){if(!PRESETS[name])return Promise.resolve();try{localStorage.setItem('solar.skin.quality',name);}catch{}return configure({...PRESETS[name]});}
$('quality').onchange=()=>{const name=$('quality').value;if(name==='custom')return;applyPreset(name).catch(fail);};
$('render-scale').onchange=()=>configure({render_scale:Number($('render-scale').value)}).catch(fail);
$('cloud-far-scale').onchange=()=>configure({cloud_far_scale:Number($('cloud-far-scale').value)}).catch(fail);
$('cloud-far-distance').oninput=()=>configure({cloud_far_distance:Number($('cloud-far-distance').value)}).catch(fail);
$('cloud-refresh').oninput=()=>configure({cloud_refresh:Number($('cloud-refresh').value)}).catch(fail);
for(const [id,key] of [['shadows','shadows'],['water-reflections','water_reflections'],['bloom','bloom'],['lens-flare','lens_flare'],['auto-exposure','auto_exposure']])$(id).onchange=()=>configure({[key]:$(id).checked}).catch(fail);
for(const [id,key] of [['shadow-steps','shadow_steps'],['shadow-cascades','shadow_cascades'],['atmosphere-steps','atmosphere_steps'],['water-bands','water_bands'],['relief-steps','relief_steps']])$(id).oninput=()=>configure({[key]:Number($(id).value)}).catch(fail);
$('profile-quality').oninput=()=>configure({profile_quality:Number($('profile-quality').value)}).catch(fail);
for(const id of ['cloud-wind','cloud-direction'])$(id).oninput=()=>{const angle=Number($('cloud-direction').value)*Math.PI/180,speed=Number($('cloud-wind').value);configure({wind:[speed*Math.cos(angle),speed*Math.sin(angle)]}).catch(fail);};
// The window bars round the world image follow its aspect (explorer.css #world).
function worldAspect(w,h){if(!(w>0&&h>0))return;world.width=w;world.height=h;showAspect();}
// Whole pixels make the image's shape differ from the window's by a fraction of a percent: it is then shown over the
// whole window, not with bars two pixels wide.
function showAspect(){const a=world.width/world.height,w=innerWidth/innerHeight;$('world')?.style.setProperty('--world-aspect',String(Math.abs(a/w-1)<0.005?w:a));}
// The image takes the window's shape again once a resize or a turn of the device has settled. Until the renderer has
// its new targets the old image stays, with bars. A test page keeps its fixed size.
let fitTimer=0,fitting=false;
async function fitWorld(){
 if(!ready||fitting||!device||params.has('test'))return;
 const [w,h]=canvasSize(device);if(w===world.width&&h===world.height)return;
 fitting=true;try{await engine.resize(w,h);worldAspect(w,h);}catch(error){console.warn('The image keeps its size:',error);}finally{fitting=false;}
 const [nw,nh]=canvasSize(device);if(nw!==world.width||nh!==world.height){clearTimeout(fitTimer);fitTimer=setTimeout(fitWorld,200);}
}
addEventListener('resize',()=>{showAspect();clearTimeout(fitTimer);fitTimer=setTimeout(fitWorld,200);});
async function start(){
 $('explorer-controls').inert=true;startupFailed=false;startupStarted=performance.now();startupPanel.hidden=false;$('startup-retry').hidden=true;$('error').hidden=true;window.explorerFailure=null;window.explorerReady=false;
 try{
  device=await detectDevice();const [cw,ch]=canvasSize(device,params.has('test'));if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}worldAspect(cw,ch);
  if(device.mobile){enableTouch();let saved=null;try{saved=localStorage.getItem('solar.skin.ui-collapsed');}catch{}if(saved===null)setUiCollapsed(true);}
  const tier=params.get('tier')||allocationTier(device);
  startupProgress({stage:'Starting render worker',detail:`${device.reason} · ${cw}x${ch} canvas · ${tier} allocation tier`});
  // The body is fixed for the life of the renderer; ?tiles= points the field worker at the replay server.
  // The solar system, starting at Earth, is the default (owner, 4 November 2026: the app being built). The renderer starts on
  // Earth and changes body with no reload. ?body=earth: real Earth only; ?body=procedural: the procedural planet.
  const bodyParam=params.get('body')||'solar',solarMode=bodyParam==='solar',body=bodyParam==='earth'||solarMode?'earth':'procedural';
  setupBody(body);if(solarMode)$('world-select').value='solar';
  // ?limits=off lifts the budgets on free services, for tests of the settled image on replayed tiles only: they wait for pages nothing on screen reads.
  const unlimited=params.get('limits')==='off';
  // Water as its own layer (docs/WATER-LAYER.md) is the default: pages carry the water layer and the terrain from it.
  // ?water=old: the earlier patch-by-patch water path, kept for comparison until it is removed (phase 6).
  const field=body==='earth'?{manifest:unlimited?{overrides:{eox:{limits:null},swissimage:{limits:null}}}:null,proxy:params.get('tiles')||'',pack:params.get('pack')??(await packSite()).base+'pack-earth-v1/',waterLayer:params.get('water')!=='old'}:null;
  engine=await createWorkerExplorer(canvas,startupProgress,rendererFailed,tier,body,field,solarMode);
  let saved=null;try{saved=localStorage.getItem('solar.skin.quality');}catch{}
  const preset=params.get('quality')||(params.has('test')?'ultra':startingPreset(device,saved));
  if(PRESETS[preset])await configure({...PRESETS[preset]});
  if(unlimited)await configure({fetch_limits:false});
  // The solar page's navigation (#solar-hud) goes in the panel under the soundtrack and its time line into the dock; it lists its own keys.
  if(solarMode){solar=await startSolar({engine,params,canvas,$});setCamera(solar.frame(0,keys,speed));layout();}else{for(const e of document.querySelectorAll('.local-only'))e.hidden=false;go(params.get('view')||(body==='earth'?'earth-orbit':'orbit'));const k=document.querySelector('#flight-hud .hud-key');k.textContent='Travel speed';k.parentElement.title='Travel speed. The wheel changes it too.';}const settings=JSON.parse(engine.settings());syncCloudUi(settings);syncTerrainUi(settings);syncSceneryUi(settings);syncQualityUi(settings);
  window.solarDevice={...device,tier,preset};
  installFlightDeck();
  window.solarFlight=solar;window.solarExplorer={engine,keys,get camera(){return camera;},set camera(v){setCamera(v);},get time(){return time;},set time(v){time=v;},set paused(v){paused=v;},get paused(){return paused;},configure,go,step,stats:()=>JSON.parse(engine.stats()),telemetry:()=>JSON.parse(engine.telemetry()),capture:kind=>engine.capture(kind),resize:(w,h)=>{worldAspect(w,h);return engine.resize(w,h);},snapshot,move,rotate,startup:()=>engine.startup(),presets:PRESETS,applyPreset,device:()=>window.solarDevice};
  startupProgress({stage:'Initializing planet',detail:'Generating the first GPU frame',completed:startupLast.total,total:startupLast.total});
  step(0);await engine.flush();if(startupFailed)return;
  // First image: terrain, sky and shadows. The ocean, clouds and prop shading
  // follow as their programs finish compiling (see web/gpu-startup.js).
  ready=true;paused=params.has('test');last=performance.now();$('explorer-controls').inert=false;startupPanel.hidden=true;window.solarFirstImage=performance.now()-startupStarted;
  await settle();
 }catch(e){rendererFailed(e);}
}
// World selector, Earth destinations, attribution line and data-lag section. Nothing here runs on the procedural body except the selector.
const EARTH_PLACES=[['wupper','Wupper river bend'],['douro-mouth','Douro river mouth'],['lausanne','Lausanne'],['ouchy','Ouchy shore'],['lavaux','Lavaux vineyards'],['dents-du-midi','Dents du Midi'],['matterhorn','Matterhorn'],['genoa-edge','Genoa cube edge'],['cube-corner','Cube corner'],['north-pole','North Pole'],['south-pole','South Pole'],['everest','Everest'],['rainier','Mount Rainier'],['grand-canyon','Grand Canyon'],['hawaii','Hawaii'],['nile-delta','Nile delta'],['alps-high','Alps from high'],['earth-orbit','Earth from orbit']];
let dataNodes=null,measured=false,earth=false;
function setupBody(body){
 earth=body==='earth';measured=earth;$('world-select').value=body;
 updateCredits([],body==='procedural');$('attribution').hidden=false;document.body.classList.add('has-attribution');
 $('world-select').onchange=()=>{const q=new URLSearchParams(location.search);q.set('body',$('world-select').value);q.delete('view');const t=q.toString();location.search=t?'?'+t:'?';};
 if(!measured)return;
 const dest=$('destination');dest.replaceChildren(...EARTH_PLACES.map(([v,n])=>new Option(n,v)));dest.value=params.get('view')||'earth-orbit';
 $('debug').add(new Option('Data lag and synthesis','4'));
 const box=$('data-controls');box.hidden=false;$('clear-tiles').onclick=async()=>{try{await caches.delete('solar-tiles-v1');}catch{}location.reload();};const rows=['Pages','In flight / queued','Failed / not found','Uploaded','Data rate','Level deficit','Pool','Sources','Disk cache'];
 const pre=$('data-lag');pre.replaceChildren(...rows.map(()=>document.createTextNode('')));dataNodes=[...pre.childNodes];
 $('attribution').hidden=false;document.body.classList.add('has-attribution');
 setInterval(()=>{if(!ready)return;try{updateData(JSON.parse(engine.stats()));}catch{}},500);
}
function updateData(s){
 const f=s.field||{},d=s.data_lag||{},n=v=>v==null?'-':Number(v).toLocaleString(),rate=f.bytesPerSecond;
 const procedural=s.surface_source==='procedural';
 updateCredits(Array.isArray(f.attribution)?f.attribution:[],procedural,s.solar?.surface_shown===false);
 // Lower detail because a source is refusing is never silent: this shows with the data panel closed too.
 const hosts=Object.entries(f.hosts||{}),waiting=hosts.filter(([,h])=>h.pausedMs>0),notice=$('field-notice');
 const hostName=h=>({'tiles.maps.eox.at':'EOX','wmts.geo.admin.ch':'swisstopo'})[h]||h;
 if(notice){notice.hidden=!waiting.length;if(waiting.length)notice.textContent=waiting.map(([h,v])=>`${hostName(h)} is refusing requests, so imagery stays at lower detail. Asking again in ${Math.ceil(v.pausedMs/1000)} s.`).join(' ');}
 if(!$('data-controls').open)return;
 const t=[`Pages ${n(d.pages_resident)} resident of ${n(d.pages_wanted)} wanted
`,`In flight ${n(d.pages_in_flight)} · queued ${n(d.pages_queued)}
`,`Failed ${n(d.pages_failed)} · not found ${n(d.pages_not_found)}
`,`Uploaded ${n(d.pages_uploaded)} pages · ${((d.bytes_uploaded||0)/1048576).toFixed(1)} MiB
`,`Data rate ${rate==null?'-':(rate/1048576).toFixed(2)+' MiB/s'}
`,`Level deficit under camera: height ${n(d.camera_level_deficit)} · imagery ${n(d.camera_albedo_deficit)}
`,`Pool overflow ${n(d.pool_overflow)}, past the pool ${n(d.pages_over_pool)} · deferred frames ${n(d.upload_deferred_frames)}
`,(hosts.map(([h,v])=>`${hostName(h)} ${v.rate.toFixed(1)} tiles/s, ${n(v.asked)} asked${v.pauses?`, paused ${v.pauses} times`:''}`).join(', ')||'No limited source')+(f.provisional?`, ${n(f.provisional)} coasts went up before their image`:'')+'\n',f.tileStore?`Disk cache ${(f.tileStore.bytes/1048576).toFixed(0)} of ${(f.tileStore.budgetBytes/1048576).toFixed(0)} MiB, ${n(f.tileStore.tiles)} tiles, ${n(f.tileStore.hits)} not asked for again${f.tileStore.error?', '+f.tileStore.error:''}`:'No disk cache'];
 t.forEach((x,i)=>{if(dataNodes[i].data!==x)dataNodes[i].data=x;});
}
// A transferred canvas cannot be transferred a second time. Keep its DOM event
// listeners by replacing only the page on an explicit retry, never in a loop.
$('startup-retry').onclick=()=>location.reload();
requestAnimationFrame(tick);await start();

// The page's soundtrack: a score composed as it plays, in exact fractions of one note (docs/MUSIC.md).
// This file is the part that touches the page: it makes the audio context on a gesture, keeps it honest across hidden
// tabs and interrupted contexts, asks the flight where the player is twice a second, and hands that to the director.
// The music itself is in music-director.js (what to play), music-composer.js (the notes), music-engine.js (when) and
// music-synth.js (the sound). Nothing here runs on the render path, and nothing is downloaded.
import {createEngine} from './music-engine.js';
import {createDirector,BASE_HZ} from './music-director.js';
import {makeTheme} from './music-composer.js';
import {toModule} from './music-rmt.js';

const systemOf=id=>id>=10000?Math.floor(id/100)*100:10;
// One piece on a context given by the caller, for tools that render the score offline (tools/Test-Explorer-Overhaul.mjs).
export function celestialScore(ctx,seed=2026){
 const offline=typeof OfflineAudioContext!=='undefined'&&ctx instanceof OfflineAudioContext,engine=createEngine(ctx,{offline}),theme=makeTheme({mood:'nocturne',seed,hz:BASE_HZ,length:12});
 return {theme,render:seconds=>engine.render([{at:.05,theme,fade:.5}],seconds),report:()=>engine.report(),close:()=>engine.close()};
}
export function installCelestialMusic(){
 let ctx=null,engine=null,director=null,enabled=true,volume=.24,poll=null,busy=false,line='',quiet=null,stepMs=0,steps=0,belt=false;
 const heard=new Set(),stars=new Map(),log=[];
 try{enabled=localStorage.getItem('solar.music')!=='off';volume=Number(localStorage.getItem('solar.music.volume')??.24);}catch{}
 if(!(volume>=0&&volume<=.7))volume=.24;
 const save=()=>{try{localStorage.setItem('solar.music',enabled?'on':'off');localStorage.setItem('solar.music.volume',String(volume));}catch{}};
 // Phones and tablets, and machines with few cores, get the light profile: fewer voices, no chorus, no shimmer.
 const lite=(typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches)||(navigator.hardwareConcurrency||8)<=4;
 // A new salt every time the page is opened: no two sessions hear the same pieces.
 const salt=((globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0]??0)^Date.now())>>>0;
 const tell=text=>{if(text===line)return;line=text;for(const f of heard){try{f(text);}catch{}}};

 // Where the player is, from the flight the page exposes (web/explorer.js window.solarFlight). Reading the report is a
 // few numbers out of the flight's memory; it is done here, twice a second.
 function look(){
  const flight=globalThis.solarFlight?.flight;
  // The pages without solar flight: the Earth page is at Earth; the procedural body is nowhere in particular.
  if(!flight)return new URLSearchParams(location.search).get('body')==='earth'?{near:399,clear:1000,radius:6371000,speed:0,system:10,rate:1}:{near:0,clear:0,radius:0,speed:0,system:10,rate:1};
  const r=flight.report(),K=flight.constructor,near=r[1]|0,system=systemOf((r[0]|0)||near||399);
  let star=stars.get(system);
  // Another star: its temperature (its note is the ratio to the Sun's) and the names of it and its worlds, read once.
  if(!star){star={teff:5772,name:'',worlds:new Map()};if(system!==10){try{star.teff=JSON.parse(K.star_info(system)).teff_used||5772;}catch{}
   try{const s=JSON.parse(K.galaxy_catalogue()).find(s=>s.id===system);star.name=s?.name||'';for(const w of s?.worlds||[])star.worlds.set(w.id,w.name);}catch{}}stars.set(system,star);}
  const name=near>=10000?(near===system?star.name:star.worlds.get(near)||''):'';
  const jump=document.getElementById('hyperdrive');
  // Whether the page is drawing the asteroid field round the eye: asked of the renderer's statistics, which are a string
  // to parse, so only every fourth second.
  if(steps%8===0){try{belt=!!globalThis.solarExplorer?.stats().solar?.belt_field;}catch{belt=false;}}
  return {near,clear:r[2],radius:near?K.body_radius(near):0,speed:r[3],landed:r[8]>0,system,teff:star.teff,name,systemName:star.name,trip:flight.trip_state()[0]>0,jump:!!jump&&!jump.hidden,rate:flight.rate(),belt};
 }
 async function step(){
  if(busy||!engine||!engine.running)return;
  busy=true;let t0=performance.now();
  try{
   const now=engine.report(),playing=engine.current?{bar:now.bar,length:now.length,barSeconds:engine.current.theme.bar}:null;
   // A piece that was chosen but never started (the music was paused while its room was being made): choose again.
   if(!playing&&director.zone&&!director.silent)director.next();
   for(const a of director.update(look(),performance.now()/1000,playing)){
    // The last actions are kept for the tests (window.solarMusic.report().log).
    // Only the time this function itself runs is counted: waiting for a room to be made is not time on the main thread.
    // The last actions are kept for the tests (window.solarMusic.report().log), a change of piece with what it cost here.
    if(a.play){const chosen=performance.now()-t0;stepMs+=chosen;await engine.prepare(a.play);t0=performance.now();if(engine.running)engine.start(a.play,{fade:a.fade,dip:a.dip});tell(a.play.line);
     log.push(`play ${a.play.mood} @ ${director.zone.key} (chosen in ${chosen.toFixed(1)} ms, started in ${(performance.now()-t0).toFixed(1)} ms)`);}
    else log.push(a.accent?`accent ${a.accent}`:`hush ${a.hush}`);
    if(log.length>24)log.shift();
    else if(a.accent)engine.accent(a.accent,{seed:salt^Math.round(performance.now()),base:a.base,hz:BASE_HZ,seconds:a.seconds});
    else if(a.hush)engine.hush(a.hush);
   }
   engine.setEnergy(director.energy);
  }catch(e){console.error(e);}
  stepMs+=performance.now()-t0;steps++;busy=false;
 }
 // One place decides whether the score is sounding: wanted, the context running, the tab visible.
 function sync(){
  if(!engine)return;
  const live=enabled&&ctx.state==='running'&&!document.hidden;
  if(live){clearTimeout(quiet);engine.run();engine.unmute();if(!poll){poll=setInterval(step,500);step();}}
  else{engine.halt();clearInterval(poll);poll=null;}
 }
 async function start(){
  if(!enabled||document.hidden)return;
  if(!ctx){
   // 'playback': larger buffers, so a long frame of the page is less likely to be heard.
   ctx=new AudioContext({latencyHint:'playback'});engine=createEngine(ctx,{lite});director=createDirector({salt,lite});engine.setVolume(volume,.01);
   // Running, suspended, interrupted (a call on a phone, another app's sound) or closed: every change comes through here.
   ctx.onstatechange=sync;
  }
  if(ctx.state!=='running'){try{await ctx.resume();}catch{}}
  sync();
 }
 function pause(){
  if(!engine)return;
  engine.mute(.15);engine.halt();clearInterval(poll);poll=null;
  // Once the fade is done the context itself is put to sleep: no audio thread, no battery.
  clearTimeout(quiet);quiet=setTimeout(()=>{if(ctx.state==='running'&&(!enabled||document.hidden))ctx.suspend().catch(()=>{});},350);
 }
 // A context may only start on a gesture, and on phones only on some of them; any of these will do, as often as needed.
 const gesture=()=>{if(enabled&&(!ctx||ctx.state!=='running'||!engine.running))start().catch(console.error);};
 for(const type of ['pointerdown','pointerup','keydown','touchend','click'])window.addEventListener(type,gesture,{passive:true,capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(enabled)start().catch(console.error);});
 const api={
  async toggle(){enabled=!enabled;save();if(enabled)await start();else pause();return enabled;},
  setVolume(v){volume=Math.max(0,Math.min(.7,v));save();engine?.setVolume(volume);},
  get enabled(){return enabled;},get volume(){return volume;},
  // What is playing, in words: place, its fraction of the Sun's note, the piece. Called again whenever it changes.
  get line(){return line;},onChange(f){heard.add(f);if(line)f(line);return()=>heard.delete(f);},
  // Another piece in the same place.
  next(){director?.next();step();},
  pause,resume:start,
  // Kept from the first score: the page may still call it. The director reads the flight itself now.
  update(){},
  // stepMs: main-thread time spent asking the flight and the director; tickMs (from the engine): composing and scheduling.
  report(){const r=engine?.report();return r?{playing:enabled&&r.running,line,zone:director.zone?.key||'',profile:lite?'light':'full',volume,stepMs,steps,log:log.slice(),...r}:{playing:false,line:'',volume,voices:0,bar:0,log:[]};},
  // The piece sounding now, from its first bar, as a Relative Music Theory module (the JSON rmt.world loads).
  module(bars=16){const t=engine?.current?.theme;return t?toModule(t,{from:0,bars:Math.min(bars,t.length),energy:director.energy}):null;},
  // For tests only (docs/DIAGNOSTICS.md): the audio context, to suspend it as an interruption would.
  get context(){return ctx;},
 };
 // A handle for tests and the curious, beside window.solarFlight and window.solarExplorer.
 globalThis.solarMusic=api;
 return api;
}

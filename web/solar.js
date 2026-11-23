// The solar system on the page: the running clock, the craft, the keys, and what the display says.
// The physics is Rust (crates/solar-core/src/flight.rs), here only input and text. Every number on
// the display is read from the simulation.
// Layout: navigation in the panel (#solar-hud, in #panel-body after the soundtrack), the time line and the flight readout in the dock at the
// bottom centre. Text is rewritten at most four times a second (TEXT_MS), and only where it changed; the time line's strip is a
// canvas redrawn each frame from the clock alone, with no layout read (its size comes from a ResizeObserver).
import init,{SolarFlight} from './pkg/solar_explorer.js';
import {installPlanetIndicators,PLACES} from './planet-indicators.js';
import {installLandmarks} from './landmarks.js';
import {forGame} from './game-input.js';
import {packSite,packFolder} from './pack-base.js';
import {approximatePlace} from './home-zone.js';
// (As `image`: `world` below is the select element of the same name, which shadowed this and gave the packet no size.)
import {world as image} from './quality.js';
const J2000_UNIX=946727935.816; // 2000-01-01 12:00:00 TT as Unix seconds with the 32 leap seconds then in force
// TDB against UTC: 32.184 s plus leap seconds, 37 since 2017. Earlier dates shown here are off by the difference, which the clock label states.
const toTdb=unix=>unix+5-J2000_UNIX; // five leap seconds since 2000
const toUnix=tdb=>tdb+J2000_UNIX-5;
const RATES=[0,1,10,60,600,3600,21600,86400,604800,2592000,31557600];
const RATE_WORDS={0:'paused',1:'real time',10:'10 seconds per second',60:'1 minute per second',600:'10 minutes per second',3600:'1 hour per second',21600:'6 hours per second',86400:'1 day per second',604800:'1 week per second',2592000:'30 days per second',31557600:'1 year per second'};
// A rate step is signed: below the pause the clock runs backward through the same steps (owner, 16 November 2026).
const rateOf=i=>Math.sign(i)*RATES[Math.abs(i)];
const rateName=r=>r<0?(r===-1?'real time, backward':`−${RATE_WORDS[-r]??`${-r} s per second`}`):RATE_WORDS[r]??`${r} s per second`;
const TEXT_MS=250;
// Numbers: SI digit groups (narrow no-break space), m and km, then the astronomical unit (IAU 2012 B2: au), then light-years.
const AU=1.495978707e11,LY=9.4607304725808e15,C=299792458,GROUP=' ';
const group=(v,d=0)=>{const [i,f]=Math.abs(v).toFixed(d).split('.');return (v<0?'−':'')+i.replace(/\B(?=(\d{3})+(?!\d))/g,GROUP)+(f?'.'+f:'');};
export const metres=v=>{const a=Math.abs(v);if(a<1000)return `${group(v,a<10?1:0)} m`;if(a<1e5)return `${group(v/1e3,1)} km`;if(a<0.1*AU)return `${group(v/1e3)} km`;if(a<0.1*LY)return `${group(v/AU,a<10*AU?3:a<100*AU?2:1)} au`;return `${group(v/LY,2)} ly`;};
export const speedText=v=>{const a=Math.abs(v);if(a<1000)return `${group(v,a<10?1:0)} m/s`;if(a<0.01*C)return `${group(v/1e3,a<1e5?2:0)} km/s`;return `${(v/C).toFixed(3)} c`;};
const accel=v=>{const a=Math.abs(v);return a<1000?`${group(v,a<10?2:0)} m/s²`:a<1e6?`${group(v/1e3,1)} km/s²`:`${group(v/1e6,1)} Mm/s²`;};
// Display names in the order they are offered, grouped by what they orbit.
const nameOf=id=>PLACES.find(p=>p[0]===id)?.[1]??'—';
// What the eye is looking at, stated. A body's pack says what its image is and whether it has heights; these have none to read.
const NOT_MEASURED={10:'Sun: a model, not an image. Colour from a 5772 K blackbody (IAU 2015 B3), limb darkening measured (Neckel and Labs 1994), the corona’s brightness profile Baumbach’s (1937). Granulation, the network, active regions with their spots, loops, prominences and flares are synthetic: not today’s Sun.',599:'Jupiter: Cassini map, 2000. No height: a giant has no ground. Flying in, the air closes the view.',699:'Saturn: colour by latitude is a placeholder, not a map. Ring gaps and depths are published values; their fine ringlets, and every rock up close, are synthesized. Real ring particles are mostly under 10 m, and these do not orbit.',799:'Uranus: colour by latitude is a placeholder, not a map.',899:'Neptune: colour by latitude is a placeholder, not a map.',402:'Deimos: no global map found. It is grey, and not a sphere in reality.',401:'Phobos: not a sphere in reality; this renderer draws a radial surface.',601:'Mimas: no map used yet.',701:'Ariel: no global map found.',702:'Umbriel: no global map found.',703:'Titania: no global map found.',704:'Oberon: no global map found.',705:'Miranda: no global map found.'};
const describing=new Map();
const descriptionsInFlight=new Map();
// Other stars (solar-core galaxy.rs): ids 10000 + 100 k, their worlds the next ids up. Sol's bodies are system 10.
let GALAXY=[];
const systemOf=id=>id>=10000?Math.floor(id/100)*100:10;
const systemName=id=>id===10?'Sol':GALAXY.find(s=>s.id===id)?.name??'—';
function describe(id){
 if(descriptionsInFlight.has(id))return descriptionsInFlight.get(id);
 if(describing.has(id))return Promise.resolve(describing.get(id));
 const pending=readDescription(id).finally(()=>descriptionsInFlight.delete(id));
 descriptionsInFlight.set(id,pending);return pending;
}
async function readDescription(id){
 describing.set(id,NOT_MEASURED[id]??'');
 if(id>=10000){const s=GALAXY.find(s=>s.id===systemOf(id));let star='';try{const i=JSON.parse(SolarFlight.star_info(s.id));star=` ${i.spectral?i.spectral.value+', ':''}${Math.round(i.teff_used)} K (${i.teff_origin==='Catalogue'?i.teff.source:i.teff_origin==='SpectralClass'?'from its spectral class':'unknown: the Sun’s, as a fallback'}). Its colour and limb darkening follow from that temperature; its surface detail, when shown, is synthetic, and it has no corona model.`;}catch{}describing.set(id,s?(id===s.id?`${s.name}:${star} Distance (${s.distance} light-years) and direction are approximate catalogue values.`:`${nameOf(id)}: a synthetic world. Its surface, size and circular orbit are procedural game content, not observations; ${s.name} is ${s.distance} light-years from Sol.`):'');return describing.get(id);}
 if(id===399)describing.set(id,'Earth’s terrain uses elevation measurements and satellite imagery. Surface detail, vegetation and weather are generated locally.');
 if(NOT_MEASURED[id]||id===399)return describing.get(id);
 try{const m=await (await fetch(`${(await packSite()).base}${packFolder(SolarFlight.body_name(id))}manifest.json`)).json();const b=m.bake||{};describing.set(id,`${nameOf(id)}: ${b.image_is}. ${b.has_height?'Heights measured.':'No global height data: all its relief is synthesized.'} Fine detail is synthesized. ${(m.attribution||[]).join(' ')}`);}catch{}
 return describing.get(id);
}
// A text node per readout, rewritten only when its text changes.
const slot=el=>{const t=document.createTextNode('');el.replaceChildren(t);return v=>{if(t.data!==v)t.data=v;};};
// Calendar arithmetic in a zone given by a fixed offset (seconds east of UTC) at the centre of what is shown.
const pad=n=>String(n).padStart(2,'0');
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const zoneOffset=(zone,unix)=>zone==='local'?-new Date(unix*1000).getTimezoneOffset()*60:0;
const zoneLabel=(zone,unix)=>{if(zone!=='local')return 'UTC';const o=zoneOffset(zone,unix),a=Math.abs(o);return `UTC${o<0?'−':'+'}${pad(Math.floor(a/3600))}:${pad(Math.floor(a%3600/60))}`;};
const addMonths=(unix,months)=>{const d=new Date(unix*1000);d.setUTCMonth(d.getUTCMonth()+months);return d.getTime()/1000;};
export async function startSolar({engine,params,canvas,$}){
 await init();
 const SOL=[...PLACES];
 try{GALAXY=JSON.parse(SolarFlight.galaxy_catalogue());}catch{GALAXY=[];}
 for(const s of GALAXY){PLACES.push([s.id,s.name]);for(const w of s.worlds)PLACES.push([w.id,w.name]);}
 // One group per star: the star, then its worlds.
 const starGroup=(s,label)=>{const g=document.createElement('optgroup');g.label=label;g.append(new Option(s.name,s.id),...s.worlds.map(w=>new Option(w.name,w.id)));return g;};
 const start=Number(params.get('tdb'))||toTdb(Date.now()/1000);
 const flight=new SolarFlight(start,Number(params.get('at'))||399,Number(params.get('height'))||600000);
 // The opening view over where the visitor is, roughly: their time zone's main city (no location permission, no request), or
 // the longitude of their UTC offset at 30 degrees north when the zone is not in the list. Only when the address names no place.
 if(!params.has('at')&&!params.has('view')){const here=approximatePlace();if(here)flight.start_over(399,here[0],here[1],Number(params.get('height'))||600000);}
 let packet=null,rateIndex=1,assist=true,wanted=0,last=[],brakeHeld=false,twist=0,zone='utc',windowSeconds=1200,collapsed=false;
 try{zone=localStorage.getItem('solar.time-zone')==='local'?'local':'utc';}catch{}
 flight.set_rate(1);
 // Only where this deployment carries the solar pack (solar-pack.json, written by tools/Package-Explorer.mjs).
 packSite().then(p=>p.solar?fetch(`${p.base}solar/asteroids.bin`):null).then(r=>r&&r.ok?r.arrayBuffer():null).then(b=>{if(b)flight.load_asteroids(new Float32Array(b));}).catch(()=>{});
 // Navigation, in the panel under the soundtrack: where the craft is, the target and what to do with it, quick destinations, star systems, display toggles.
 const hud=document.createElement('section');hud.id='solar-hud';hud.className='group';hud.setAttribute('aria-label','Navigation');hud.setAttribute('aria-live','off');
 hud.innerHTML=`<div class="group-title"><span>Position</span><span id="solar-system"></span></div>
 <div class="where-name" id="solar-near"></div><div class="where-line" id="solar-where"></div><div class="where-line small" id="solar-frame"></div>
 <p class="small" id="solar-note"></p>
 <div class="group-title"><span>Navigate</span></div>
 <div class="target-row"><label>Target <select id="solar-target"><option value="0">None</option></select></label></div>
 <div class="nav-actions"><button id="solar-look" title="Face: turn to the target (T)">Face<kbd>T</kbd></button><button id="solar-fly" title="Autopilot: fly to the target under thrust (Y)">Autopilot<kbd>Y</kbd></button><button id="solar-go" class="primary" title="Go: a five-second trip into its orbit, or over the landmark open below (G). Any flight key or Esc stops it.">Go<kbd>G</kbd></button><button id="solar-land" title="Land: at the landmark open below, or on the nearest body">Land<kbd>&nbsp;</kbd></button><button id="solar-stop" title="Stop the trip or the autopilot">Stop<kbd>&nbsp;</kbd></button></div>
 <div class="group-title" id="solar-display-title"><span>Display</span></div>
 <div class="checks three"><label><input type="checkbox" id="solar-labels" checked> Labels <kbd>L</kbd></label><label><input type="checkbox" id="solar-trails" checked> Orbits <kbd>O</kbd></label><label title="Named surface features of the nearest body (IAU)"><input type="checkbox" id="solar-landmarks-on" checked> Landmarks <kbd>N</kbd></label></div>
 <div class="checks"><label title="A camera metering on a star once its disk is resolved, so its surface shows instead of clipping to white. Only the star's light is scaled; the exposure is stated when it applies."><input type="checkbox" id="solar-star-adapt" checked> Meter on a star's disk</label><label title="Granulation, the network's faculae and sunspots: a synthetic layer with measured sizes and contrasts, not today's Sun."><input type="checkbox" id="solar-star-detail" checked> Synthetic star surface</label></div>
 <label title="Familiar: the star as the well-known filtered pictures show it (an orange disk, H-alpha red chromosphere and prominences, gold EUV loops, the corona brightened as eclipse pictures are): false colour. True colour: what an eye would see, where everything but the disk is a millionth of it.">Stars <select id="solar-star-view"><option value="1">Familiar · filtered, false colour</option><option value="0">True colour</option></select></label>
 <label for="solar-belt">Asteroid belts <output id="solar-belt-value"></output><input id="solar-belt" type="range" min="0" max="12" step="0.5" value="8"></label>`;
 $('sound-section').after(hud);
 // The picture's finish (bloom, lens flare) belongs with Display here; on a page without this panel it stays under Quality details.
 $('solar-star-view').parentElement.before($('finish-checks'));
 const show={system:slot($('solar-system')),near:slot($('solar-near')),where:slot($('solar-where')),frame:slot($('solar-frame')),note:slot($('solar-note'))};
 const select=$('solar-target');{const sol=document.createElement('optgroup');sol.label='Sol';for(const [id,name] of SOL)sol.append(new Option(name,id));select.append(sol);for(const s of GALAXY)select.append(starGroup(s,`${s.name} · ${s.distance} ly`));}
 let landmarks=null;
 const entry=document.createElement('section');entry.id='selection-entry';entry.hidden=true;
 entry.setAttribute('role','status');entry.setAttribute('aria-label','Selected place');
 const entryName=document.createElement('strong'),entryKind=document.createElement('div'),entryText=document.createElement('p');
 const entryCredit=document.createElement('small');
 entry.append(entryName,entryKind,entryText,entryCredit);document.body.append(entry);
 function syncGo(){
  const disabled=!Number(select.value)&&!landmarks?.selected;
  for(const id of ['hud-go','touch-go']){const button=$(id);if(button)button.disabled=disabled;}
 }
 function showEntry(name,kind,text='',credit=''){
  entryName.textContent=name;entryKind.textContent=kind;entryText.textContent=text;entryCredit.textContent=credit;entry.hidden=false;
 }
 function setTarget(value){
  const id=Number(value);select.value=String(id);landmarks?.clear();
  syncGo();if(!id){entry.hidden=true;return;}
  const name=nameOf(id),radius=SolarFlight.body_radius(id);
  const kind=radius>0?`Radius ${metres(radius)}`:systemName(systemOf(id))+' system';
  const detail=text=>text?.startsWith(name+': ')?text.slice(name.length+2):text;
  showEntry(name,kind,detail(describing.get(id)));
  describe(id).then(text=>{if(select.value===String(id)&&!entry.hidden)entryText.textContent=detail(text)||'';});
 }
 select.onchange=()=>{setTarget(select.value);select.blur();};
 // True brightness shows nothing outside the belt, so any other setting is a raised light, and says by how much.
 const syncBelt=()=>{const m=Number($('solar-belt').value);flight.set_belt_gain(m);$('solar-belt-value').textContent=m===0?'true brightness':`${group(10**(0.4*m))}× true`;$('solar-belt').title=m===0?'True brightness: real asteroids only, nearly invisible':`${group(10**(0.4*m))} times brighter than true`;};
 $('solar-belt').oninput=syncBelt;syncBelt();
 // The star model's switches, remembered.
 for(const id of ['solar-star-adapt','solar-star-detail'])try{const v=localStorage.getItem(id);if(v!==null)$(id).checked=v==='1';}catch{}
 const syncStars=()=>{flight.set_star_options($('solar-star-adapt').checked,$('solar-star-detail').checked);for(const id of ['solar-star-adapt','solar-star-detail'])try{localStorage.setItem(id,$(id).checked?'1':'0');}catch{}};
 for(const id of ['solar-star-adapt','solar-star-detail'])$(id).onchange=()=>{syncStars();$(id).blur();};syncStars();
 try{const v=localStorage.getItem('solar-star-view');if(v!==null)$('solar-star-view').value=v;}catch{}
 const syncView=()=>{flight.set_star_view(Number($('solar-star-view').value));describing.delete(10);try{localStorage.setItem('solar-star-view',$('solar-star-view').value);}catch{}};
 $('solar-star-view').onchange=()=>{syncView();$('solar-star-view').blur();};syncView();
 // Planet travel and named Earth destinations both remain available, in the panel's first section under their own names.
 const destination=$('destination'),earthCameras=new Map([...destination.options].map(o=>{const c=JSON.parse(engine.bookmark(o.value));c[2]=c[0].map(v=>v/Math.hypot(...c[0]));return [o.value,c];}));
 const world=$('world-select');world.replaceChildren();
 const whole=document.createElement('optgroup');whole.label='See the whole system';whole.append(new Option('Inner planets, from above','view:6e11'),new Option('All the planets, from above','view:1.2e13'),new Option("Inside Saturn's rings",'rings'),new Option('Inside the asteroid belt','belt'));world.append(whole);
 const bodies=document.createElement('optgroup');bodies.label='Go to';for(const [id,name] of SOL)bodies.append(new Option(name,id));world.append(bodies);
 for(const s of GALAXY)world.append(starGroup(s,`Hyperdrive: ${s.name} · ${s.distance} ly`));
 const leave=document.createElement('optgroup');leave.label='Leave the solar system view';leave.append(new Option('Real Earth only','earth'),new Option('Procedural planet','procedural'));world.append(leave);
 const rename=(el,text)=>{const l=el.closest('label');if(l?.firstChild?.nodeType===3)l.firstChild.data=text;};
 rename(world,'Views and worlds');rename(destination,'Places on Earth');
 const local=$('local-section');local.classList.add('solar');
 const more=document.createElement('div');more.className='group-title';more.innerHTML='<span>More places</span>';local.prepend(more);
 world.value=String(Number(params.get('at'))||399);
 world.onchange=()=>{
  const v=world.value;
  if(v==='earth'||v==='procedural'){const q=new URLSearchParams(location.search);q.set('body',v);location.search='?'+q;return;}
  if(v==='rings'){flight.jump_rings(150);world.blur();return;}
  if(v==='belt'){flight.jump_belt();world.blur();return;}
  if(v.startsWith('view:')){flight.jump_overview(Number(v.slice(5)));world.blur();return;}
  setTarget(v);travel(Number(v));world.blur();
 };
 // Hyperdrive: going to a body around another star (either way) is a jump into its orbit, shown as a short
 // transit that Escape or Cancel stops before it happens. Within a system Go stays immediate.
 const transit=document.createElement('div');transit.id='hyperdrive';transit.hidden=true;transit.setAttribute('role','status');
 transit.innerHTML='<div class="jump-ring" aria-hidden="true"></div><span class="small">HYPERDRIVE</span><strong id="jump-destination"></strong><p id="jump-status"></p><button id="jump-cancel">Cancel jump <kbd>Esc</kbd></button>';
 document.body.append(transit);
 let jumping=false,cancelled=false;
 const currentSystem=()=>systemOf(last[0]||last[1]||399);
 $('jump-cancel').onclick=()=>{cancelled=true;};
 // Esc: cancels a hyperdrive jump before it happens, or ends a trip where it is.
 window.addEventListener('keydown',e=>{if(e.code!=='Escape')return;if(jumping){e.preventDefault();cancelled=true;}else if(flight.trip_state()[0]){e.preventDefault();flight.stop_trip();}else if(!entry.hidden){setTarget(0);}});
 async function travel(id){
  if(!id||jumping)return;
  const to=systemOf(id);
  if(to===currentSystem()){flight.go_to(id);return;}
  const s=GALAXY.find(s=>s.id===to),from=GALAXY.find(s=>s.id===currentSystem());
  const ly=s?s.distance:from?from.distance:0;
  jumping=true;cancelled=false;transit.hidden=false;
  $('jump-destination').textContent=nameOf(id);$('jump-status').textContent=`${systemName(currentSystem())} to ${systemName(to)} · ${ly} light-years · charging`;$('jump-cancel').disabled=false;
  try{
   await new Promise(r=>setTimeout(r,matchMedia('(prefers-reduced-motion: reduce)').matches?150:1100));
   if(cancelled)return;
   $('jump-cancel').disabled=true;flight.jump_orbit(id);$('jump-status').textContent='Arrived';
   await new Promise(r=>setTimeout(r,450));
  }finally{transit.hidden=true;jumping=false;}
 }
 const setRate=i=>{rateIndex=Math.max(1-RATES.length,Math.min(RATES.length-1,i));const r=rateOf(rateIndex);flight.set_rate(r);if(r!==0)windowSeconds=Math.max(1200,Math.abs(r)*24);syncClock(true);};
 const goEarth=name=>{const c=earthCameras.get(name);if(!c)return;flight.jump_camera(399,c.flat());world.value='399';setTarget(0);destination.value=name;};
 destination.onchange=()=>{goEarth(destination.value);destination.blur();};
 if(params.has('view'))goEarth(params.get('view'));
 $('sun').closest('label').hidden=true;
 // The time line, in the dock above the flight readout: one line where it fits (the date, time and zone, the rate's buttons and
 // words, the strip, Now), with the rest (step size, the zone, the Julian Date, Set) folded behind one button. It collapses to a
 // chip at the top right (the clock and rate stay readable); on touch screens the HUD button does the same.
 const timeline=document.createElement('section');timeline.id='timeline';timeline.setAttribute('aria-label','Time');
 timeline.innerHTML=`<div class="time-row"><div class="time-read"><strong id="time-clock" aria-live="off"></strong><span id="time-zone-text" title="Time zone (change it under More)"></span></div>
 <div class="time-rate-group"><button id="solar-slower" title="Slower clock (,)" aria-label="Slower clock">«</button><button id="solar-pause" title="Pause or run the clock (P)">❚❚</button><button id="solar-faster" title="Faster clock (.)" aria-label="Faster clock">»</button></div>
 <span id="time-rate" title="Simulated time per second of real time. A year here is a Julian year, 365.25 days."></span>
 <canvas id="time-strip" tabindex="0" role="slider" aria-label="Time line: drag or use the arrow keys to move in time"></canvas>
 <div class="time-end"><button id="solar-now" title="Real time, now">Now</button><button id="time-set" aria-expanded="false" aria-controls="time-panel" title="More: step, time zone, Julian Date, set the date and time" aria-label="More time controls">⋯</button><button id="time-hide" title="Hide the time line" aria-label="Hide the time line">▾</button></div></div>
 <div id="time-panel" hidden><div class="time-controls"><button id="time-back" class="wide" title="Step back ([)"></button><button id="time-forward" class="wide" title="Step forward (])"></button><button id="time-zone" title="Show the time in UTC or in this device's time zone"></button><span id="time-jd" title="Julian Date in TDB, the ephemeris time scale"></span></div>
 <div class="row"><label style="flex:2"><span id="solar-time-label">Date and time (UTC)</span><input id="solar-time" type="datetime-local" step="60"></label></div>
 <label><span id="solar-local-label">Time of day</span> <output id="solar-local-value"></output><input id="solar-local-time" type="range" min="0" max="1439" step="1"></label><div class="row"><button id="solar-daylight">Local noon</button><button id="time-close">Close</button></div><p class="small">Setting a time pauses the clock and keeps your place and flight. Now restores real time. Dates are UTC (or the zone shown) converted to TDB with today's leap-second count, so dates before 2017 are off by up to 37 s.</p></div>`;
 const chip=document.createElement('button');chip.id='time-chip';chip.type='button';chip.hidden=true;chip.title='Show the time line';chip.innerHTML='<span id="time-chip-clock"></span> <span id="time-chip-rate"></span>';document.body.append(chip);
 $('dock').prepend(timeline);
 const clock=$('time-clock'),strip=$('time-strip'),ink=strip.getContext('2d');
 let stripW=0,stripH=0,dpr=1,drawn=NaN,lastText=0;
 new ResizeObserver(()=>{dpr=devicePixelRatio||1;stripW=strip.clientWidth;stripH=strip.clientHeight;strip.width=Math.round(stripW*dpr);strip.height=Math.round(stripH*dpr);drawn=NaN;}).observe(strip);
 // Steps of the clock, from the rate: an hour while slow, then a day, a month, a year.
 const step=()=>{const r=Math.abs(rateOf(rateIndex));return r<3600?{s:3600,label:'1 h'}:r<86400?{s:86400,label:'1 d'}:r<2592000?{months:1,label:'1 mo'}:{months:12,label:'1 yr'};};
 const stepBy=sign=>{const st=step(),u=toUnix(flight.seconds());flight.set_seconds(toTdb(st.months?addMonths(u,sign*st.months):u+sign*st.s));syncClock(true);};
 // Tick units for the strip: the minor one gives at most 40 ticks across it, the labelled one at most 7.
 const UNITS=[{s:1},{s:10},{s:60},{s:600},{s:3600},{s:6*3600},{s:86400},{s:7*86400},{months:1},{months:3},{months:12},{months:120},{months:1200}];
 const unitCount=(u,w)=>w/(u.s||u.months*2629800);
 function ticks(u,from,to){
  const out=[];
  if(u.s){const unit=u.s===7*86400?86400:u.s;let t=Math.ceil(from/unit)*unit;if(u.s===7*86400){while(new Date(t*1000).getUTCDay()!==1)t+=86400;}for(;t<=to&&out.length<200;t+=u.s)out.push(t);return out;}
  const d=new Date(from*1000);d.setUTCDate(1);d.setUTCHours(0,0,0,0);let m=d.getUTCFullYear()*12+d.getUTCMonth();m=Math.ceil(m/u.months)*u.months;
  for(;out.length<200;m+=u.months){const t=Date.UTC(Math.floor(m/12),m%12,1)/1000;if(t>to)break;if(t>=from)out.push(t);}return out;
 }
 const tickLabel=(u,t)=>{const d=new Date(t*1000);if(u.months>=12)return String(d.getUTCFullYear());if(u.months)return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;if(u.s>=86400)return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;if(u.s>=3600&&d.getUTCHours()===0&&d.getUTCMinutes()===0)return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;return u.s<60?`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`:`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;};
 // The strip: the present at the centre, the window set by the rate (24 s of the clock, at least 20 min), ticks moving with the clock.
 function drawStrip(){
  if(!stripW||collapsed||document.body.classList.contains('panel-sheet')&&!document.body.classList.contains('hidden-ui'))return;
  const unix=toUnix(flight.seconds());if(Math.abs(unix-drawn)*stripW/windowSeconds<0.2)return;drawn=unix;
  const offset=zoneOffset(zone,unix),centre=unix+offset,from=centre-windowSeconds/2,to=centre+windowSeconds/2,x=t=>(t-from)/windowSeconds*stripW;
  ink.setTransform(dpr,0,0,dpr,0,0);ink.clearRect(0,0,stripW,stripH);
  const minor=UNITS.find(u=>unitCount(u,windowSeconds)<=40)||UNITS.at(-1),major=UNITS.find(u=>UNITS.indexOf(u)>UNITS.indexOf(minor)&&unitCount(u,windowSeconds)<=7)||UNITS.at(-1);
  ink.strokeStyle='#ffffff30';ink.lineWidth=1;ink.beginPath();for(const t of ticks(minor,from,to)){const px=Math.round(x(t))+0.5;ink.moveTo(px,stripH-7);ink.lineTo(px,stripH);}ink.stroke();
  ink.font='10px Inter,Segoe UI,sans-serif';ink.textBaseline='top';ink.fillStyle='#aab5be';ink.strokeStyle='#ffffff60';ink.beginPath();
  for(const t of ticks(major,from-windowSeconds*0.2,to)){const px=Math.round(x(t))+0.5;ink.moveTo(px,stripH-14);ink.lineTo(px,stripH);ink.fillText(tickLabel(major,t),px+4,4);}ink.stroke();
  // The real present, where it is in view, and the clock's own place.
  const real=Date.now()/1000+offset;if(real>from&&real<to){const px=Math.round(x(real))+0.5;ink.strokeStyle='#e8c98f99';ink.setLineDash([2,3]);ink.beginPath();ink.moveTo(px,0);ink.lineTo(px,stripH);ink.stroke();ink.setLineDash([]);}
  ink.fillStyle='#9fd4e4';ink.fillRect(Math.round(stripW/2)-1,0,2,stripH);
 }
 // Drag the strip to move in time; the clock holds still while it is held, then runs on at its rate.
 let drag=null;
 strip.addEventListener('pointerdown',e=>{drag={x:e.clientX,rate:rateIndex};strip.setPointerCapture(e.pointerId);flight.set_rate(0);e.preventDefault();});
 strip.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x;drag.x=e.clientX;if(dx&&stripW){flight.set_seconds(flight.seconds()-dx*windowSeconds/stripW);syncClock(true);}});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])strip.addEventListener(type,()=>{if(!drag)return;flight.set_rate(rateOf(drag.rate));drag=null;strip.blur();});
 strip.addEventListener('keydown',e=>{if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();e.stopPropagation();stepBy(e.code==='ArrowLeft'?-1:1);}});
 // Collapsed, the time line is a chip at the top right and its strip is not drawn; remembered.
 try{collapsed=localStorage.getItem('solar.timeline-collapsed')==='1';}catch{}
 const setCollapsed=v=>{collapsed=v;timeline.hidden=v;chip.hidden=!v;document.body.classList.toggle('timeline-collapsed',v);try{localStorage.setItem('solar.timeline-collapsed',v?'1':'0');}catch{}const h=$('touch-hud');if(h){h.setAttribute('aria-pressed',String(!v));h.title=v?'Show the time line':'Hide the time line';}if(!v){drawn=NaN;}syncClock(true);};
 $('time-hide').onclick=()=>{setCollapsed(true);chip.focus({preventScroll:true});chip.blur();};chip.onclick=()=>{setCollapsed(false);chip.blur();};
 const syncZone=()=>{$('time-zone').textContent=zoneLabel(zone,toUnix(flight.seconds()));$('time-zone-text').textContent=zoneLabel(zone,toUnix(flight.seconds()));$('time-zone').setAttribute('aria-pressed',String(zone==='local'));drawn=NaN;syncClock(true);};
 $('time-zone').onclick=()=>{zone=zone==='utc'?'local':'utc';try{localStorage.setItem('solar.time-zone',zone);}catch{}syncZone();$('time-zone').blur();};
 $('time-set').onclick=()=>{const p=$('time-panel');p.hidden=!p.hidden;$('time-set').setAttribute('aria-expanded',String(!p.hidden));if(!p.hidden)syncTime();};
 $('time-close').onclick=()=>{$('time-panel').hidden=true;$('time-set').setAttribute('aria-expanded','false');};
 $('time-back').onclick=()=>stepBy(-1);$('time-forward').onclick=()=>stepBy(1);
 // The clock's text: the date and time in the zone chosen, its Julian Date (TDB), the rate in words.
 const showChipClock=slot($('time-chip-clock')),showChipRate=slot($('time-chip-rate')),showClock=slot(clock),showRate=slot($('time-rate')),showJd=slot($('time-jd')),showBack=slot($('time-back')),showForward=slot($('time-forward')),showPause=slot($('solar-pause'));
 function syncClock(force=false){
  const now=performance.now();if(!force&&now-lastText<TEXT_MS)return;lastText=now;
  const tdb=flight.seconds(),unix=toUnix(tdb),offset=zoneOffset(zone,unix),d=new Date((unix+offset)*1000);
  const text=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,r=rateOf(rateIndex);
  if(collapsed){showChipClock(`${text} ${zoneLabel(zone,unix)}`);showChipRate(rateName(r));return;}
  showClock(text);showRate(rateName(r));$('time-rate').classList.toggle('paused',r===0);
  showJd(`JD ${(tdb/86400+2451545).toFixed(4)} TDB`);
  const st=step();showBack(`−${st.label}`);showForward(`+${st.label}`);showPause(r===0?'▶':'❚❚');$('solar-pause').setAttribute('aria-label',r===0?'Run the clock':'Pause the clock');
  strip.setAttribute('aria-valuetext',`${clock.textContent} ${zoneLabel(zone,unix)}, ${rateName(r)}`);
 }
 const localOffset=()=>packet?.[9]===399?Math.atan2(packet[0],packet[2])/(2*Math.PI)*86400:0;
 function syncTime(){
  if($('time-panel').hidden)return;
  const unix=toUnix(flight.seconds()),solarLocal=new Date((unix+localOffset())*1000),minutes=solarLocal.getUTCHours()*60+solarLocal.getUTCMinutes();
  if(document.activeElement!==$('solar-time'))$('solar-time').value=new Date((unix+zoneOffset(zone,unix))*1000).toISOString().slice(0,16);
  $('solar-time-label').textContent=`Date and time (${zoneLabel(zone,unix)})`;
  if(document.activeElement!==$('solar-local-time'))$('solar-local-time').value=String(minutes);
  $('solar-local-value').textContent=solarLocal.toISOString().slice(11,16);
  $('solar-local-label').textContent=packet?.[9]===399?'Local mean solar time here':'Time of day (UTC)';
 }
 function setTime(seconds){if(!Number.isFinite(seconds))return;flight.set_seconds(seconds);setRate(0);syncTime();}
 function setLocalTime(minutes){
  const offset=localOffset(),day=Math.floor((toUnix(flight.seconds())+offset)/86400)*86400;
  setTime(toTdb(day+minutes*60-offset));
 }
 $('solar-time').onchange=()=>{const t=Date.parse($('solar-time').value+'Z')/1000;if(Number.isFinite(t))setTime(toTdb(t-zoneOffset(zone,t)));};
 $('solar-local-time').oninput=()=>setLocalTime(Number($('solar-local-time').value));
 $('solar-daylight').onclick=()=>setLocalTime(720);
 // Land at a landmark ends this high over its ground: just above it, still flying.
 const LAND_HEIGHT=30;
 const stops=id=>Math.max(SolarFlight.body_radius(id)*(id===10?2:0.4),20000);
 // Picking a target only marks it; Face, Autopilot and Go act on it.
 // A target and an open landmark are one choice or the other: picking either drops the other, so Go and Land always mean the
 // last thing picked (owner, 16 November 2026: Go kept going to a landmark picked before a planet).
 const target=()=>Number(select.value);
 const look=()=>{if(target())flight.look_at(target());};
 // Flying between stars would take years even at the fastest boost: another star means the hyperdrive.
 const fly=()=>{const id=target();if(!id)return;if(systemOf(id)!==currentSystem()){go();return;}flight.fly_to(id,stops(id));flight.look_at(id);};
 // Go: an animated trip to the target, or over the landmark open in the panel; another star is the hyperdrive.
 const go=()=>{const l=landmarks?.selected;if(l){goOver(l);return;}const id=target();if(id){travel(id);$('world-select').value=String(id);}};
 const overHeight=s=>Math.min(Math.max(s.size*1000*1.1,20000),SolarFlight.body_radius(s.body)*0.8);
 const goOver=s=>{flight.go_over(s.body,s.lat,s.lon,overHeight(s));select.value='0';$('world-select').value=String(s.body);};
 const landAt=s=>{flight.land_at(s.body,s.lat,s.lon,LAND_HEIGHT);select.value='0';$('world-select').value=String(s.body);};
 $('solar-go').onclick=go;
 // Touch: Go to the target (picked by tapping its label) and HUD (the time line), in the button grid beside the stick.
 const touchGo=$('touch-go'),touchHud=$('touch-hud');
 if(touchGo){touchGo.hidden=false;touchGo.onclick=()=>{go();touchGo.blur();};}
 if(touchHud){touchHud.hidden=false;touchHud.onclick=()=>{setCollapsed(!collapsed);touchHud.blur();};}
$('solar-look').onclick=look;$('solar-fly').onclick=fly;$('solar-stop').onclick=()=>{flight.stop_trip();flight.fly_to(0,0);flight.look_at(0);};
 $('solar-land').onclick=()=>{const l=landmarks?.selected;if(l){landAt(l);return;}const id=last[1];if(id&&id!==10){flight.fly_to(id,0);setTarget(0);}};
 $('solar-slower').onclick=()=>setRate(rateIndex-1);$('solar-faster').onclick=()=>setRate(rateIndex+1);
 $('solar-pause').onclick=()=>setRate(rateIndex===0?1:0);
 $('solar-now').onclick=()=>{flight.set_seconds(toTdb(Date.now()/1000));setRate(1);syncTime();};
 // The flight readout, in the dock: speed against the nearest body and its ground, height, thrust, and the assist and brake.
 const readout=$('hud-readout');
 readout.innerHTML=`<span title="Speed against the nearest body"><span class="hud-key">Speed</span><b id="hud-speed"></b> <span id="hud-against"></span></span><span title="Speed against the ground under the craft, turning with the body"><span class="hud-key">Ground</span><b id="hud-ground"></b></span><span title="Height over the surface of the nearest body"><span class="hud-key">Height</span><b id="hud-height"></b></span><span title="Acceleration the thrust gives now"><span class="hud-key">Thrust</span><b id="hud-thrust"></b></span><button type="button" id="hud-go" class="hud-toggle" title="Go to the selected planet or landmark (G)" disabled>Go</button><button id="hud-assist" class="hud-toggle" aria-pressed="true" title="Hover assist and approach limit (Z). Off is plain mechanics.">Assist</button><button id="hud-brake" class="hud-toggle" aria-pressed="false" title="Brake: thrust against the motion, while held (X)">Brake</button><span id="hud-state" class="small"></span>`;
 const hudGo=$('hud-go');hudGo.onclick=go;syncGo();
 const hudText={speed:slot($('hud-speed')),against:slot($('hud-against')),ground:slot($('hud-ground')),height:slot($('hud-height')),thrust:slot($('hud-thrust')),state:slot($('hud-state'))};
 const syncAssist=()=>{$('hud-assist').setAttribute('aria-pressed',String(assist));$('hud-assist').textContent=assist?'Assist on':'Assist off';};syncAssist();
 $('hud-assist').onclick=()=>{assist=!assist;syncAssist();};
 const brake=$('hud-brake');brake.addEventListener('pointerdown',e=>{brakeHeld=true;brake.setAttribute('aria-pressed','true');brake.setPointerCapture(e.pointerId);e.preventDefault();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])brake.addEventListener(type,()=>{brakeHeld=false;brake.setAttribute('aria-pressed','false');});
 brake.addEventListener('keydown',e=>{if(e.code==='Enter'||e.code==='Space'){brakeHeld=true;brake.setAttribute('aria-pressed','true');}});brake.addEventListener('keyup',()=>{brakeHeld=false;brake.setAttribute('aria-pressed','false');});
 window.addEventListener('keydown',e=>{if(!forGame(e)||e.repeat)return;if(e.code==='Comma')setRate(rateIndex-1);if(e.code==='Period')setRate(rateIndex+1);if(e.code==='KeyP')setRate(rateIndex===0?1:0);if(e.code==='BracketLeft')stepBy(-1);if(e.code==='BracketRight')stepBy(1);if(e.code==='KeyZ'){assist=!assist;syncAssist();}if(e.code==='KeyT')look();if(e.code==='KeyY')fly();if(e.code==='KeyG')go();if(e.code==='KeyL'){$('solar-labels').checked=!$('solar-labels').checked;}if(e.code==='KeyO'){$('solar-trails').checked=!$('solar-trails').checked;}});
 const indicators=installPlanetIndicators({canvas,onSelect:id=>setTarget(id)});
 // Named features of the nearest body: Go there sets the craft over it, looking straight down, high enough to see it whole.
 landmarks=installLandmarks({canvas,flight,radius:id=>SolarFlight.body_radius(id),onGo:s=>goOver(s),onLand:s=>landAt(s),
  onShow:(s,kind,description,credit)=>{select.value='0';syncGo();showEntry(s.name,nameOf(s.body)+' · '+kind,description,credit);},onClear:()=>{entry.hidden=true;syncGo();}});
 landmarks.attach(hud);hud.insertBefore($('solar-landmark'),$('solar-display-title'));
 $('solar-landmarks-on').checked=landmarks.enabled;$('solar-landmarks-on').onchange=()=>{landmarks.enabled=$('solar-landmarks-on').checked;$('solar-landmarks-on').blur();};
 window.addEventListener('keydown',e=>{if(!forGame(e)||e.repeat||e.code!=='KeyN')return;landmarks.enabled=!landmarks.enabled;$('solar-landmarks-on').checked=landmarks.enabled;});
 // The solar page's keys, in the panel's key list.
 $('local-keys').hidden=true;
 const keyList=document.createElement('dl');keyList.className='keys';keyList.innerHTML=[['<kbd>W</kbd> <kbd>S</kbd>','thrust forward, back'],['<kbd>A</kbd> <kbd>D</kbd> · <kbd>Space</kbd> <kbd>C</kbd>','strafe, up and down'],['<kbd>Q</kbd> <kbd>E</kbd>','roll'],['<kbd>Shift</kbd>','boost'],['<kbd>X</kbd>','brake'],['<kbd>Z</kbd>','assist on or off'],['RMB drag','look'],['Wheel','throttle'],['<kbd>T</kbd> <kbd>Y</kbd> <kbd>G</kbd>','face, autopilot to, go to the target'],['<kbd>,</kbd> <kbd>.</kbd> · <kbd>P</kbd>','clock slower, faster · pause'],['<kbd>[</kbd> <kbd>]</kbd>','step back, forward in time'],['<kbd>L</kbd> <kbd>O</kbd> <kbd>N</kbd>','labels, orbits, landmarks'],['<kbd>H</kbd>','collapse the panel'],['<kbd>Esc</kbd>','stop a trip, cancel a hyperdrive jump'],['<kbd>F11</kbd>','full screen'],['Touch','drag looks, twist rolls, the stick thrusts, the bar sets the throttle; tap a label to target it, Go goes there, HUD shows or hides the time line']].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
 $('keys').append(keyList);
 const drawMarkers=()=>{indicators.draw({markers:flight.markers(image.width,image.height),width:image.width,height:image.height,target:target(),frameBody:last[0],enabled:$('solar-labels').checked});landmarks.draw({body:last[1],clear:last[2],width:image.width,height:image.height});};
 // Controls in, camera out. The camera always comes in the axes of the body in full detail, or inertial axes with none.
 // analog: the touch stick and buttons (web/touch.js), added to the keys.
 function frame(dt,keys,setting,analog=null){
  const axis=(a,b)=>(keys.has(a)?1:0)-(keys.has(b)?1:0),clamp=v=>Math.max(-1,Math.min(1,v));
  // A two-finger twist turns the world with the fingers (the owner found it backwards on 16 November 2026: the sign is flipped).
  const roll=axis('KeyE','KeyQ')+(dt>0?Math.max(-20,Math.min(20,twist/dt)):0);twist=0;
  const input=new Float64Array([clamp(axis('KeyD','KeyA')+(analog?.x||0)),clamp(axis('Space','KeyC')+(analog?.z||0)),clamp(axis('KeyW','KeyS')+(analog?.y||0)),setting,keys.has('ShiftLeft')||keys.has('ShiftRight')||analog?.boost?1:0,keys.has('KeyC')||(analog?.z||0)<0?1:0,keys.has('KeyX')||brakeHeld?1:0,roll,assist?1:0,wanted!==0&&last[0]===wanted?engine.safe_height():0]);
  if(dt>0)flight.step(dt,input);
  last=flight.report();
  const p=flight.packet(image.width,image.height);wanted=p[9];packet=p;
  // A landmark trip asks the terrain for the ground at its end place once that body is the one in full detail; the answer comes
  // back with a later frame (worker-client probe_ground) and sets the end height.
  const place=flight.trip_place();probeDirection=place.length&&place[0]===wanted?new Float64Array(place.slice(1)):null;
  const g=engine.probe_ground?.();if(probeAsked&&probeDirection&&Number.isFinite(g))flight.measure_trip_place(g,dt);probeAsked=!!probeDirection;
  drawMarkers();drawStrip();syncClock();
  const eye=[p[0],p[1],p[2]],forward=[p[3],p[4],p[5]],up=[p[6],p[7],p[8]];
  return [eye,[eye[0]+forward[0]*1000,eye[1]+forward[1]*1000,eye[2]+forward[2]*1000],up];
 }
 let probeDirection=null,probeAsked=false;
 // Sent with the frame, once: it moves to the worker.
 function take(){const p=new Float64Array(packet);return p;}
 // Off, nothing is computed or sent.
 const trailPoints=()=>$('solar-trails').checked?new Float32Array(flight.trails(target())):undefined;
 // Twice a second, from explorer.js: the panel's position text and the flight readout.
 function report(stats){
  const [frameBody,near,clear,relative,inFrame,drag,free,thrust,landed,hand,altitude,ground]=last;
  const seconds=flight.seconds(),span=SolarFlight.table_span();
  syncTime();
  show.system(`${systemName(systemOf(frameBody||near))} system`);
  show.near(nameOf(near));
  show.where(`${metres(clear)} above its surface`);
  show.frame(`Frame ${nameOf(frameBody)} · ${stats?.solar?.surface_shown?`surface pass: ${stats.body}`:'no surface pass'}`);
  hudText.speed(speedText(relative));hudText.against(`vs ${nameOf(near)}`);hudText.ground(speedText(ground));hudText.height(metres(clear));hudText.thrust(accel(thrust));
  hudText.state([landed?'landed':'',drag>0?`drag ${drag>=0.1?drag.toFixed(1):drag.toExponential(1)}/s`:''].filter(Boolean).join(' · '));
  const why=`Drag ${drag>0?drag.toExponential(2)+' per second':'none'} · ${(free*100).toFixed(0)}% free flight (the rest is the body's hover band)`;if($('hud-state').title!==why)$('hud-state').title=why;
  // The credit line follows the pages on screen, and with no surface there are none.
  $('attribution').hidden=false;
  const off=seconds<span[0]||seconds>span[1];const notes=[];
  if(off)notes.push('Outside the fitted span of the table: positions hold still.');
  if(stats?.solar&&stats.solar.wanted&&!stats.solar.surface_shown)notes.push(`Surface pages coming in: ${stats.solar.uploaded_since_switch} uploaded.`);
  describe(near);const said=describing.get(near);if(said)notes.push(said);
  if(systemOf(near)===near||near===10){notes.push($('solar-star-view').value==='1'?'Stars in the familiar view: filtered pictures in false colour (an orange disk with the network’s mottle, H-alpha red chromosphere and prominences, 171 Å gold loops), the corona brightened as eclipse pictures are processed, the granulation and flares time-lapsed 15×, molten veins added, the surface’s relief two and a half times the measured (valleys 250 km deep between granules). Not what an eye would see; True colour in Display.':'Stars in true colour: the corona, chromosphere and prominences are a millionth of the disk and show only when it is covered.');}
  const exposure=flight.star_exposure();if(exposure<0.999)notes.push(`Star disk shown ${(-Math.log2(exposure)).toFixed(1)} EV darker than the planets: the camera meters on it once it is resolved (a display model; switch in Display).`);
  if(stats?.solar?.belt_field)notes.push('Asteroids here: the orbits and sizes of the catalogued ones are real, but they lie millions of km apart. The field of rocks around you is synthesized so that a belt can be seen from inside it; the slider at 0 removes it.');
  show.note(notes.join(' '));
 }
 syncZone();setCollapsed(collapsed);
 return {frame,packet:take,probe:()=>probeDirection,trails:trailPoints,report,look:(dx,dy)=>flight.look(dx,dy),roll:angle=>{twist+=angle;},flight,setRate,goEarth,setTime,setLocalTime,go,goOver,landAt,get landmarks(){return landmarks;}};
}

// Named surface features of the body the eye is nearest: the IAU's approved names (Gazetteer of Planetary Nomenclature,
// USGS Astrogeology, public domain), baked by tools/Bake-Landmarks.mjs into landmarks/<naif>.json, largest first.
// Positions come from the flight model (SolarFlight.surface_markers): planetocentric latitude and east longitude on the
// body's reference sphere, the convention of its map. Relief is not considered: a label stands on that sphere.
const NOTE='Names: IAU Working Group for Planetary System Nomenclature, via the USGS Gazetteer of Planetary Nomenclature (public domain).';
const km=v=>v>=100?`${Math.round(v).toLocaleString()} km`:v>=10?`${v.toFixed(0)} km`:v>0?`${v.toFixed(1)} km`:'size not given';
// Which names to show first when not all fit. The gazetteer gives no prominence, so it is size, weighted by kind: relief and
// landing sites over broad albedo regions, whose names cover a planet's whole face from orbit. For scarps, ridges, fossae and
// valleys the gazetteer's "diameter" is a length (Olympus Rupes: 1,915 km around Olympus Mons), so they weigh less. A landing site has no size
// in the gazetteer; it counts as 300 km, so it is named from a few hundred km up. These are choices by eye, not data.
const WEIGHT={MO:1.6,VA:1.2,CM:1.4,PE:1.4,TH:1.3,ME:1.4,OC:1.4,LG:1.4,CR:1.3,ST:1.0,LF:1.0,AA:1.0,RU:0.45,DO:0.6,FO:0.6,PL:0.8,PM:0.8,TA:0.7,VS:0.6,RE:0.5,AL:0.5,MA:0.5,FA:0.5,SF:0.4};
const extent=f=>f[4]==='ST'?Math.max(f[3],300):f[3];
const prominence=f=>extent(f)*(WEIGHT[f[4]]??0.9);
const degrees=(lat,lon)=>`${Math.abs(lat).toFixed(2)}°${lat>=0?'N':'S'} ${Math.abs(lon).toFixed(2)}°${lon>=0?'E':'W'}`;
export function installLandmarks({canvas,flight,radius,onGo=()=>{},onLand=()=>{},onShow=()=>{}}){
 const overlay=document.createElement('canvas');overlay.id='solar-landmarks';document.body.append(overlay);
 const ink=overlay.getContext('2d');
 let index=null,enabled=true,selected=null,hits=[];const bodies=new Map(),loading=new Set();
 try{enabled=localStorage.getItem('solar.landmarks')!=='0';}catch{}
 fetch('landmarks/index.json').then(r=>r.ok?r.json():null).then(j=>{index=j;}).catch(()=>{});
 function load(id){
  if(!index||!index.bodies.includes(id)||bodies.has(id)||loading.has(id))return;
  loading.add(id);
  fetch(`landmarks/${id}.json`).then(r=>r.ok?r.json():null).then(j=>{
   if(!j)return;const f=j.features.sort((a,b)=>prominence(b)-prominence(a)),points=new Float64Array(f.length*2);
   for(let i=0;i<f.length;i++){points[2*i]=f[i][1];points[2*i+1]=f[i][2];}
   bodies.set(id,{features:f,points});
  }).catch(()=>{}).finally(()=>loading.delete(id));
 }
 // The panel for a chosen feature: what the gazetteer says, and a way there.
 const panel=document.createElement('section');panel.id='solar-landmark';panel.hidden=true;panel.setAttribute('aria-live','polite');
 panel.innerHTML='<div class="solar-row"><strong id="landmark-name"></strong><button id="landmark-close" title="Close">×</button></div><div class="small" id="landmark-kind"></div><p class="small" id="landmark-origin"></p><p class="small" id="landmark-link"></p><div class="solar-controls row"><button id="landmark-go" title="Go there: a short trip, ending high over it (G with it open)">Go there</button><button id="landmark-land" title="Land: a short trip down to just over the ground there (Land with it open)">Land</button></div><p class="small">'+NOTE+'</p>';
 const $=id=>document.getElementById(id);
 function show(body,f){
  onShow();
  selected={body,name:f[0],lat:f[1],lon:f[2],size:f[3]};
  $('landmark-name').textContent=f[0];
  $('landmark-kind').textContent=`${index?.types?.[f[4]]??f[4]} · ${km(f[3])} · ${degrees(f[1],f[2])}`;
  $('landmark-origin').textContent=f[6]?`Named for: ${f[6]}`:'';
  const url=f[5]&&index?`${index.feature}${f[5]}`:'';
  $('landmark-link').textContent=url?`Gazetteer entry: ${url}`:'';
  panel.hidden=false;
 }
 function attach(hud){hud.append(panel);$('landmark-close').onclick=()=>{panel.hidden=true;selected=null;};$('landmark-go').onclick=()=>{if(selected)onGo(selected);$('landmark-go').blur();};$('landmark-land').onclick=()=>{if(selected)onLand(selected);$('landmark-land').blur();};}
 // body: the nearest body; clear: metres from the eye to its surface; width, height: the render size the projection uses.
 function draw({body,clear,width,height}){
  const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);
  if(overlay.width!==W||overlay.height!==H){overlay.width=W;overlay.height=H;}
  ink.clearRect(0,0,W,H);hits=[];
  if(!enabled||!body)return;
  const r=radius(body);if(!(clear<r*40))return;
  load(body);const data=bodies.get(body);if(!data)return;
  const fit=Math.min(W/width,H/height),ox=(W-width*fit)/2,oy=(H-height*fit)/2;
  // Pixels per metre at distance d: the projection's focal length over d. A feature smaller on screen than MIN from the
  // nearest a point of the surface can be is never shown. The list is by prominence, at most extent / 0.4, so once that
  // bound is under MIN the rest are skipped.
  const focal=height*fit/(2*Math.tan(30*Math.PI/180)),floor=Math.max(clear,1),MIN=22*dpr;
  let count=0;while(count<data.features.length&&count<4000&&prominence(data.features[count])/0.4*1000*focal/floor>=MIN)count++;
  if(count===0)return;
  const m=flight.surface_markers(body,data.points.subarray(0,count*2),width,height);
  const size=10*dpr,pad=3*dpr;ink.font=`${size}px ui-monospace,Consolas,monospace`;ink.textBaseline='middle';ink.lineWidth=Math.max(1,dpr*0.75);
  // A budget by screen area keeps the planet visible under its names: about 25 on a 1280 x 720 view.
  const budget=Math.max(8,Math.min(40,Math.round(W*H/(dpr*dpr*36000))));
  const taken=[];let labels=0;
  for(let i=0;i<count&&labels<budget;i++){
   const flags=m[4*i+3];if((flags&7)!==7)continue;
   const f=data.features[i],x=ox+m[4*i]*fit,y=oy+m[4*i+1]*fit,d=m[4*i+2];
   const across=extent(f)*1000*focal/d;if(across<MIN)continue;
   const name=f[0],tw=ink.measureText(name).width,box=[x+5*dpr,y-size/2-pad-2*dpr,tw+pad*2+4*dpr,size+pad*2+4*dpr];
   if(box[0]+box[2]>W||taken.some(t=>box[0]<t[0]+t[2]&&t[0]<box[0]+box[2]&&box[1]<t[1]+t[3]&&t[1]<box[1]+box[3]))continue;
   taken.push(box);labels++;
   const chosen=selected&&selected.body===body&&selected.name===name;
   const colour=chosen?'255,196,92':'236,214,170';
   // Its extent, foreshortening ignored, while that is more than a few pixels; always a point at its centre.
   // A faint outline of its extent (foreshortening ignored) only between a label's size and half the view: smaller says
   // nothing, larger only crosses the screen. The chosen one always.
   if(chosen||(f[3]>0&&across>36*dpr&&across<0.5*Math.min(W,H))){ink.strokeStyle=`rgba(${colour},${chosen?0.6:0.16})`;ink.beginPath();ink.arc(x,y,across/2,0,Math.PI*2);ink.stroke();}
   ink.fillStyle=`rgba(${colour},0.95)`;ink.beginPath();ink.arc(x,y,2*dpr,0,Math.PI*2);ink.fill();
   ink.fillStyle='rgba(8,12,16,0.55)';ink.fillRect(box[0],y-size/2-pad,tw+pad*2,size+pad*2);
   ink.fillStyle=`rgba(${colour},0.95)`;ink.fillText(name,box[0]+pad,y);
   hits.push({x,y,box,f});
  }
 }
 // A click on a label or its point opens the feature's entry.
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||!enabled)return;const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,x=(e.clientX-rect.left)*dpr,y=(e.clientY-rect.top)*dpr;
  const hit=hits.find(h=>(x>=h.box[0]&&x<=h.box[0]+h.box[2]&&y>=h.box[1]&&y<=h.box[1]+h.box[3])||Math.hypot(h.x-x,h.y-y)<8*dpr);
  if(hit)show(lastBody,hit.f);
 });
 let lastBody=0;
 return {attach,show,clear(){panel.hidden=true;selected=null;},get selected(){return panel.hidden?null:selected;},draw:o=>{lastBody=o.body;draw(o);},get enabled(){return enabled;},set enabled(v){enabled=!!v;try{localStorage.setItem('solar.landmarks',enabled?'1':'0');}catch{}if(!enabled){ink.clearRect(0,0,overlay.width,overlay.height);hits=[];}}};
}

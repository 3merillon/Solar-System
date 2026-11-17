// Touch controls for phones and tablets: a left thumb stick for the flight
// model's WASD displacement (analog, so the stick's deflection scales speed),
// hold buttons for ascend and descend (the solar page adds Go and HUD), a one-finger drag on the world
// for look, a two-finger pinch for travel speed and a two-finger twist for
// roll. Nothing here changes the keyboard
// model; the stick and buttons only feed the same displacement vector.
export class TouchControls {
 constructor(canvas,hooks){
  this.canvas=canvas;this.hooks=hooks;this.analog={x:0,y:0,z:0,boost:false};this.pointers=new Map();this.gesture=null;this.enabled=false;
  const overlay=document.createElement('div');overlay.id='touch-controls';overlay.hidden=true;overlay.innerHTML=
   '<div id="touch-stick" aria-label="Move"><div id="touch-knob"></div></div>'+
   '<div id="touch-speed" aria-live="off"></div><div id="touch-throttle" role="slider" aria-label="Travel speed"><div id="touch-throttle-knob"></div></div>'+
   '<div id="touch-buttons"><button id="touch-up" type="button" aria-label="Ascend">▲</button><button id="touch-down" type="button" aria-label="Descend">▼</button><button id="touch-go" type="button" aria-label="Go to the target" hidden>Go</button><button id="touch-hud" type="button" aria-label="Time line" aria-pressed="true" hidden>HUD</button></div>';
  document.body.append(overlay);this.overlay=overlay;
  this.stick=overlay.querySelector('#touch-stick');this.knob=overlay.querySelector('#touch-knob');this.stickPointer=null;
  this.stick.addEventListener('pointerdown',e=>{if(this.stickPointer!==null)return;this.stickPointer=e.pointerId;this.stick.setPointerCapture(e.pointerId);this.moveStick(e);e.preventDefault();});
  this.stick.addEventListener('pointermove',e=>{if(e.pointerId===this.stickPointer)this.moveStick(e);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])this.stick.addEventListener(type,e=>{if(e.pointerId!==this.stickPointer)return;this.stickPointer=null;this.analog.x=0;this.analog.y=0;this.knob.style.transform='';});
  const hold=(id,on,off)=>{const b=overlay.querySelector(id);const stop=()=>{off();b.classList.remove('held');};b.addEventListener('pointerdown',e=>{on();b.classList.add('held');b.setPointerCapture(e.pointerId);e.preventDefault();});for(const type of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(type,stop);b.addEventListener('contextmenu',e=>e.preventDefault());};
  hold('#touch-up',()=>this.analog.z=1,()=>this.analog.z=Math.min(this.analog.z,0));
  hold('#touch-down',()=>this.analog.z=-1,()=>this.analog.z=Math.max(this.analog.z,0));
  // The throttle is a vertical slider over the same logarithmic scale as the panel's speed control, its own pointer target, so
  // it works while another finger holds the stick. (The + and - buttons and the boost were removed on 16 November 2026, the
  // owner's request: the bar already sets the speed.)
  this.speed=overlay.querySelector('#touch-speed');
  this.throttle=overlay.querySelector('#touch-throttle');this.throttleKnob=overlay.querySelector('#touch-throttle-knob');this.throttlePointer=null;
  const throttleAt=e=>{const r=this.throttle.getBoundingClientRect(),pad=21;const v=1-Math.min(1,Math.max(0,(e.clientY-(r.top+pad))/(r.height-2*pad)));hooks.speedFraction(v);};
  this.throttle.addEventListener('pointerdown',e=>{e.preventDefault();this.throttlePointer=e.pointerId;this.throttle.setPointerCapture(e.pointerId);throttleAt(e);});
  this.throttle.addEventListener('pointermove',e=>{if(e.pointerId===this.throttlePointer)throttleAt(e);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])this.throttle.addEventListener(type,e=>{if(e.pointerId===this.throttlePointer)this.throttlePointer=null;});
  // World gestures: pointer events of type touch on the canvas.
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;if(this.pointers.size===0)hooks.tapWorld();this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);this.gesture=this.pointers.size===2?this.pair():null;e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='touch'||!this.pointers.has(e.pointerId))return;const previous=this.pointers.get(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(this.pointers.size===1){hooks.look(e.clientX-previous.x,e.clientY-previous.y);}
   else if(this.pointers.size===2&&this.gesture){const now=this.pair();hooks.look((now.cx-this.gesture.cx)*.5,(now.cy-this.gesture.cy)*.5);if(this.gesture.distance>20)hooks.pinch(now.distance/this.gesture.distance);let twist=now.angle-this.gesture.angle;twist=Math.atan2(Math.sin(twist),Math.cos(twist));hooks.twist(twist);this.gesture=now;}
   e.preventDefault();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(e.pointerType!=='touch')return;this.pointers.delete(e.pointerId);this.gesture=this.pointers.size===2?this.pair():null;});
  // The page itself must never zoom or scroll under a gesture (iOS ignores
  // the viewport flags for pinch; preventing the multi-touch move and the
  // gesture events is what holds). Scrolling stays possible in the panel.
  const panel=document.getElementById('explorer-controls');
  document.addEventListener('touchmove',e=>{if(e.touches.length>1||!(panel?.contains(e.target)||e.target.closest?.('#time-panel')))e.preventDefault();},{passive:false});
  for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,e=>e.preventDefault(),{passive:false});
  document.addEventListener('dblclick',e=>{if(!panel||!panel.contains(e.target))e.preventDefault();},{passive:false});
 }
 pair(){const [a,b]=[...this.pointers.values()];return{cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x)};}
 moveStick(e){const r=this.stick.getBoundingClientRect(),radius=r.width/2;let x=(e.clientX-(r.left+radius))/radius,y=(e.clientY-(r.top+radius))/radius;let m=Math.hypot(x,y);if(m>1){x/=m;y/=m;m=1;}const dead=.12,scale=m>dead?(m-dead)/(1-dead)/m:0;this.analog.x=x*scale;this.analog.y=-y*scale;this.knob.style.transform=`translate(${x*radius*.6}px,${y*radius*.6}px)`;}
 enable(on){this.enabled=on;this.overlay.hidden=!on;document.body.classList.toggle('touch-ui',on);}
 setSpeed(text,fraction){this.speed.textContent=text;const r=this.throttle.getBoundingClientRect();const travel=Math.max(0,(r.height||128)-42);this.throttleKnob.style.top=`${4+(1-fraction)*travel}px`;}
}

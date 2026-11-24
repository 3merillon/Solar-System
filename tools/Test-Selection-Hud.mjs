import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {ready} from './Explorer-Test-Lib.mjs';
import {headless} from './Headless.mjs';
const dir=process.argv[2]||'evidence/local/selection-hud';
await mkdir(dir,{recursive:true});const b=await headless(dir);
const click=async(x,y)=>{for(const type of ['mousePressed','mouseReleased'])await b.send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&quality=high'});await ready(b);
 await b.evaluate(`if(document.querySelector('#toggle-ui').getAttribute('aria-expanded')==='true')document.querySelector('#toggle-ui').click();
 window.labels=[];const original=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(t,x,y,...args){if(this.canvas.id.startsWith('solar-'))labels.push({t,x:x+3,y,layer:this.canvas.id});return original.call(this,t,x,y,...args)};
 window.draw=()=>{labels.length=0;solarExplorer.camera=solarFlight.frame(0,solarExplorer.keys,0);};
 solarFlight.flight.jump_overview(1.3e12);draw();`);
 const planet=await b.evaluate("labels.find(p=>p.layer==='solar-overlay'&&p.t==='MARS'&&document.elementFromPoint(p.x,p.y)?.id==='world')||labels.find(p=>p.layer==='solar-overlay'&&/^(JUPITER|EARTH|SATURN|VENUS|MERCURY|NEPTUNE)$/.test(p.t)&&document.elementFromPoint(p.x,p.y)?.id==='world')");
 assert.ok(planet,'a planet has a visible clickable label');await click(planet.x,planet.y);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(let i=0;i<50&&!await b.evaluate("document.querySelector('#selection-entry p').textContent.length>0");i++)await wait(80);
 const selection=()=>b.evaluate(`(()=>{const e=document.querySelector('#selection-entry'),r=e.getBoundingClientRect(),g=document.querySelector('#hud-go'),p=g.getBoundingClientRect();return {name:e.firstChild.textContent,text:e.textContent,clickThrough:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id==='world',closed:document.querySelector('#toggle-ui').getAttribute('aria-expanded')==='false',canGo:!g.disabled,go:[p.left+p.width/2,p.top+p.height/2]};})()`);
 let state=await selection();assert.equal(state.name.toUpperCase(),planet.t);assert.ok(state.closed&&state.canGo&&state.clickThrough,JSON.stringify(state));assert.ok(await b.evaluate("document.querySelector('#selection-entry p').textContent.length>15"));
 // A click on empty sky, away from every label, drops the selection and its entry; a click back on the label restores it.
 // (A click on a body's disc is not empty: it selects that body.)
 const empty=await b.evaluate(`(()=>{draw();for(let y=60;y<680;y+=20)for(let x=20;x<980;x+=20)if(document.elementFromPoint(x,y)?.id==='world'&&labels.every(p=>Math.hypot(p.x-x,p.y-y)>90))return [x,y];})()`);
 assert.ok(empty,'some empty sky to click');await click(...empty);
 assert.ok(await b.evaluate(`document.querySelector('#selection-entry').hidden&&document.querySelector('#hud-go').disabled&&document.querySelector('#solar-target').value==='0'`),'a click on nothing clears the selection');
 await click(planet.x,planet.y);state=await selection();assert.equal(state.name.toUpperCase(),planet.t);assert.ok(state.canGo,JSON.stringify(state));
 await click(...state.go);assert.equal(await b.evaluate('solarFlight.flight.trip_state()[0]'),1);
 await b.evaluate('solarFlight.flight.stop_trip();solarFlight.flight.jump_orbit(499);solarFlight.flight.go_over(499,18.65,226.2,900000);for(let i=0;i<360;i++)solarFlight.flight.step(1/60,new Float64Array(10));draw()');
 let place;
 for(let i=0;i<60&&!place;i++){place=await b.evaluate("draw();labels.find(p=>p.layer==='solar-landmarks'&&document.elementFromPoint(p.x,p.y)?.id==='world')");if(!place)await wait(80);}
 assert.ok(place,'a named Mars landmark is on screen');await click(place.x,place.y);
 state=await selection();assert.equal(state.name,place.t);assert.ok(state.closed&&state.canGo&&state.clickThrough,JSON.stringify(state));
 await click(...state.go);assert.equal(await b.evaluate('solarFlight.flight.trip_state()[2]'),499);
 console.log('Selected '+planet.t+' and '+place.t+' on the canvas and travelled to each from the desktop HUD.');
}finally{await b.close();}

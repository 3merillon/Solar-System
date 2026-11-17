// The page is a game: the browser's own menus, shortcuts and gestures must not interrupt it, and keys must reach the craft whichever control was
// last touched. The owner ended a right-drag look over a menu and got the browser's menu with Google Lens. Real input events through the private
// headless browser's protocol, read back from a listener that runs after all of the page's own. Headless shows no menus, so what is checked is that the
// page refused each default: the browser's own part of it is the owner's to see.
//   node tools/Test-Game-Input.mjs DIR [BASE URL, default http://127.0.0.1:5198]
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';
const dir=process.argv[2]||'evidence/local/real-earth/runs/game-input';mkdirSync(dir,{recursive:true});
const b=await headless(resolve(dir,'.profile'));
const W=1280,H=720,T=852076800;
try{
await b.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
const BASE=process.argv[3]||process.env.SOLAR_BASE||'http://127.0.0.1:5198';
const url=`${BASE}/explorer.html?test=1&body=solar&quality=high&limits=off&tdb=${T}`;
await b.send('Page.navigate',{url});
await ready(b);
await b.evaluate(`(()=>{window.seen=[];for(const type of ['contextmenu','keydown','keyup','wheel','mousedown','mouseup','auxclick','dragstart','dragover','drop'])window.addEventListener(type,e=>seen.push({type,prevented:e.defaultPrevented,target:e.target.id||e.target.tagName,code:e.code,button:e.button}),{passive:false});window.clicks=0;document.addEventListener('click',()=>clicks++);})()`);
const rows=[];let bad=false;
const check=(name,ok,detail='')=>{rows.push({name,ok,detail});console.log(ok?'pass':'FAIL',name,detail);if(!ok)bad=true;};
const take=async()=>b.evaluate(`seen.splice(0)`);
const mouse=(type,x,y,o={})=>b.send('Input.dispatchMouseEvent',{type,x,y,button:'none',buttons:0,clickCount:0,...o});
const press=(x,y,button='right',n=2)=>mouse('mousePressed',x,y,{button,buttons:n,clickCount:1});
const release=(x,y,button='right')=>mouse('mouseReleased',x,y,{button,clickCount:1});
const centre=sel=>b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;if(!e.matches('aside,canvas'))e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?[r.left+r.width/2,r.top+Math.min(r.height/2,300)]:null;})()`);
const under=(x,y)=>b.evaluate(`(document.elementFromPoint(${x},${y})||{}).id||(document.elementFromPoint(${x},${y})||{}).tagName`);
// Somewhere only the world is.
const world=await b.evaluate(`(()=>{for(let x=${W-60};x>200;x-=40)for(let y=${H-80};y>120;y-=40)if(document.elementFromPoint(x,y)?.id==='world')return [x,y];return null;})()`);
if(!world)throw new Error('no clear part of the world on screen');
const CODES={KeyW:87,KeyS:83,KeyP:80,KeyF:70,KeyG:71,KeyD:68,KeyU:85,KeyJ:74,KeyH:72,KeyL:76,KeyK:75,KeyE:69,KeyO:79,KeyA:65,KeyR:82,KeyI:73,KeyT:84,KeyX:88,KeyZ:90,Space:32,Tab:9,Equal:187,Minus:189,Digit0:48,Digit1:49,ArrowLeft:37,ArrowRight:39,AltLeft:18,F1:112,F3:114,F5:116,F6:117,F7:118,F10:121,F11:122,F12:123,Slash:191,Enter:13,Escape:27};
const NAMES={Escape:'Escape',Space:' ',Tab:'Tab',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight',AltLeft:'Alt',Enter:'Enter',Slash:'/',Equal:'=',Minus:'-',Digit0:'0',Digit1:'1'};
const keyName=code=>NAMES[code]||(code.startsWith('Key')?code.slice(3).toLowerCase():code);
const key=async(type,code,modifiers=0)=>{const k=keyName(code),text=!modifiers&&k.length===1?k:undefined;await b.send('Input.dispatchKeyEvent',{type:type==='down'?(text?'keyDown':'rawKeyDown'):'keyUp',code,key:k,windowsVirtualKeyCode:CODES[code],modifiers,text,unmodifiedText:text});};
const tap=async(code,modifiers=0)=>{await key('down',code,modifiers);await key('up',code,modifiers);};
const ALT=1,CTRL=2,SHIFT=8;
// 1. The owner's fault: right-press on the world, released over something else. Then a plain right click on each.
const places={panel:'aside',buttons:'#solar-look',toggle:'#toggle-ui',dropdown:'#solar-target',credit:'#attribution',world:'#world'};
await b.evaluate(`document.getElementById('attribution').hidden=false`);
for(const [name,sel] of Object.entries(places)){
 const at=name==='world'?world:await centre(sel);
 if(!at){check(`right-drag over ${name}`,false,'not on screen');continue;}
 await take();await mouse('mouseMoved',...world);await press(...world);await mouse('mouseMoved',...at,{buttons:2});await release(...at);
 let got=(await take()).filter(e=>e.type==='contextmenu');
 check(`right-drag released over ${name} (${await under(...at)})`,got.length>0&&got.every(e=>e.prevented),JSON.stringify(got));
 await press(...at);await release(...at);
 got=(await take()).filter(e=>e.type==='contextmenu');
 check(`right click on ${name}`,got.length>0&&got.every(e=>e.prevented),JSON.stringify(got));
}
await key('down','Enter');await key('up','Enter');
// 2. Keys reach the craft whichever control was last touched, and that control does nothing with them.
const held=()=>b.evaluate(`[...solarExplorer.keys]`);
const flies=async(name)=>{await take();await key('down','KeyW');const k=await held();await key('up','KeyW');check(`W flies, ${name}`,k.includes('KeyW'),JSON.stringify(k));};
const planet=await centre('#solar-look');
await mouse('mouseMoved',...planet);await press(...planet,'left',1);await release(...planet,'left');
check('a clicked button does not keep the keys',await b.evaluate(`document.activeElement===document.body`),await b.evaluate(`document.activeElement.id||document.activeElement.tagName`));
await flies('after clicking a solar panel button');
await b.evaluate(`document.querySelector('#solar-look').focus();clicks=0`);
await key('down','Space');const space=await held();await key('up','Space');
check('Space thrusts, and does not press a focused button',space.includes('Space')&&await b.evaluate(`clicks===0`),`keys ${JSON.stringify(space)} clicks ${await b.evaluate(`clicks`)}`);
await b.evaluate(`document.querySelector('#solar-target').focus();window.dropdownWas=document.querySelector('#solar-target').value`);
await flies('with a dropdown focused');
await tap('KeyS');await tap('KeyE');await tap('KeyX');
check('letters do not choose in a focused dropdown',await b.evaluate(`document.querySelector('#solar-target').value===dropdownWas`),await b.evaluate(`document.querySelector('#solar-target').value`));
await b.evaluate(`document.querySelector('#music-volume').focus()`);
await flies('with a slider focused');
const slider=await centre('#music-volume');
if(slider){await mouse('mouseMoved',...slider);await press(...slider,'left',1);await release(...slider,'left');check('a slider let go of does not keep the keys',await b.evaluate(`document.activeElement===document.body`),await b.evaluate(`document.activeElement.id||document.activeElement.tagName`));}
await centre('#sea');await b.evaluate(`document.querySelector('#diagnostics')?.setAttribute('open','');for(const d of document.querySelectorAll('details'))d.open=true;const s=document.querySelector('#sea');s.value='';s.focus()`);
await take();await tap('Digit1');
const typed=await b.evaluate(`document.querySelector('#sea').value`),during=await held();
check('a number box still takes typing',typed==='1',JSON.stringify(typed));
await tap('Enter');
check('Enter in a number box gives the keys back',await b.evaluate(`document.activeElement===document.body`),await b.evaluate(`document.activeElement.id||document.activeElement.tagName`));
await b.evaluate(`(()=>{const s=document.querySelector('#sea');s.value='0';s.dispatchEvent(new Event('change'));})()`);
// 3. The browser's shortcuts, none of which the page has any use for.
const refused=[['Ctrl+S save page','KeyS',CTRL],['Ctrl+P print','KeyP',CTRL],['Ctrl+F find','KeyF',CTRL],['Ctrl+G find next','KeyG',CTRL],['Ctrl+D bookmark','KeyD',CTRL],['Ctrl+U source','KeyU',CTRL],['Ctrl+J downloads','KeyJ',CTRL],['Ctrl+H history','KeyH',CTRL],['Ctrl+L address bar','KeyL',CTRL],['Ctrl+K search','KeyK',CTRL],['Ctrl+E search','KeyE',CTRL],['Ctrl+O open','KeyO',CTRL],['Ctrl+A select all','KeyA',CTRL],['Ctrl+= zoom','Equal',CTRL],['Ctrl+- zoom','Minus',CTRL],['Ctrl+0 zoom','Digit0',CTRL],['Alt browser menu','AltLeft',ALT],['Alt+Left back','ArrowLeft',ALT],['Alt+Right forward','ArrowRight',ALT],['Alt+D address bar','KeyD',ALT],['F1 help','F1',0],['F3 find','F3',0],['F6 address bar','F6',0],['F7 caret browsing','F7',0],['F10 browser menu','F10',0],['/ quick find','Slash',0]];
for(const [name,code,m] of refused){await take();await key('down',code,m);const got=(await take()).filter(e=>e.type==='keydown');await key('up',code,m);check(`refused: ${name}`,got.length>0&&got.every(e=>e.prevented),JSON.stringify(got));}
// A chord is not one of the game's keys.
await tap('KeyH',CTRL);check('Ctrl+H does not hide the panel',await b.evaluate(`!document.body.classList.contains('hidden-ui')`));
await key('down','KeyS',CTRL);const chord=await held();await key('up','KeyS',CTRL);check('Ctrl+S does not thrust',!chord.includes('KeyS'),JSON.stringify(chord));
await b.evaluate(`document.getElementById('solar-trails').checked=true`);await tap('KeyO',ALT);check('Alt+O does not switch the orbit lines',await b.evaluate(`document.getElementById('solar-trails').checked`));
// The pilot's way out and the developer's tools stay.
const allowed=[['F5 reload','F5',0],['Ctrl+R reload','KeyR',CTRL],['F12 tools','F12',0],['Ctrl+Shift+I tools','KeyI',CTRL|SHIFT],['Ctrl+1 change tab','Digit1',CTRL],['Tab reach the controls by keyboard','Tab',0]];
// Sent by the page only: these really would reload it, so the browser must not receive them.
for(const [name,code,m] of allowed){const got=await b.evaluate(`(()=>{const e=new KeyboardEvent('keydown',{code:${JSON.stringify(code)},key:${JSON.stringify(keyName(code))},ctrlKey:${!!(m&CTRL)},shiftKey:${!!(m&SHIFT)},altKey:${!!(m&ALT)},bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented;})()`);check(`left alone: ${name}`,got===false);}
await take();await b.evaluate(`document.activeElement.blur()`);
// 4. Wheel zoom and the middle button, on the panel as well as the world.
const panel=await centre('aside');
for(const [name,at] of [['panel',panel],['world',world]]){
 await take();await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:at[0],y:at[1],deltaX:0,deltaY:-120,modifiers:CTRL});await new Promise(r=>setTimeout(r,120));
 const got=(await take()).filter(e=>e.type==='wheel');
 check(`Ctrl+wheel does not zoom the page, over the ${name}`,got.length>0&&got.every(e=>e.prevented),JSON.stringify(got));
 await press(...at,'middle',4);await release(...at,'middle');
 const down=(await take()).filter(e=>e.type==='mousedown'&&e.button===1);
 check(`middle button does not start autoscroll, over the ${name}`,down.length>0&&down.every(e=>e.prevented),JSON.stringify(down));
}
const before=await b.evaluate(`(()=>{const a=document.querySelector('#panel-body');a.scrollTop=0;return a.scrollHeight>a.clientHeight;})()`);
if(before){await take();await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:panel[0],y:panel[1],deltaX:0,deltaY:200});await new Promise(r=>setTimeout(r,250));const got=(await take()).filter(e=>e.type==='wheel');const moved=await b.evaluate(`document.querySelector('#panel-body').scrollTop`);check('the wheel still scrolls the panel',moved>0&&got.every(e=>!e.prevented),`scrollTop ${moved}`);}
// 5. Dragging: nothing to select or carry off the panel, and a file dropped on the page does not replace it.
await b.evaluate(`document.querySelector('#panel-body').scrollTop=0`);
const text=await b.evaluate(`(()=>{const r=document.querySelector('#local-section label').getBoundingClientRect();return [r.left+1,r.top+r.height/2,r.right-1,r.top+r.height/2];})()`);
await b.evaluate(`getSelection().removeAllRanges()`);
await mouse('mouseMoved',text[0],text[1]);await press(text[0],text[1],'left',1);await mouse('mouseMoved',text[2],text[3],{buttons:1});await release(text[2],text[3],'left');
check('a left drag selects nothing on the panel',await b.evaluate(`getSelection().toString()===''`),await b.evaluate(`getSelection().toString().slice(0,40)`));
const dropped=await b.evaluate(`['dragover','drop','dragstart'].map(type=>{const e=new DragEvent(type,{bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented;})`);
check('a file dragged onto the page is refused',dropped.every(Boolean),JSON.stringify(dropped));
// 6. Full screen is the only place the browser hands over Ctrl+W and its like. F11 goes through the page so that the keyboard lock can apply.
// With nothing focused: the drag above may leave a dropdown focused, and a headless dropdown takes the key.
await b.evaluate(`document.activeElement?.blur()`);
await take();await tap('F11');await new Promise(r=>setTimeout(r,800));
const full=await b.evaluate(`document.fullscreenElement?.tagName||null`),f11=(await take()).filter(e=>e.type==='keydown');const focus=await b.evaluate(`(document.activeElement?.id||document.activeElement?.tagName)+' '+location.href`);
check('F11 goes full screen through the page',full==='HTML'&&f11.every(e=>e.prevented),JSON.stringify({full,f11,focus}));
const locked=await b.evaluate(`typeof navigator.keyboard?.lock`);
check('keyboard lock exists in this browser',locked==='function',locked);
await tap('F11');await new Promise(r=>setTimeout(r,800));
check('F11 again leaves full screen',await b.evaluate(`document.fullscreenElement===null`));
// 7. Travel: G is an animated trip to the target, a flight key or Esc ends it where it is; Land with a landmark open starts one to it.
{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));const trip=()=>b.evaluate(`[...solarFlight.flight.trip_state()]`);
 await b.evaluate(`(()=>{document.activeElement?.blur();solarExplorer.paused=false;solarFlight.flight.jump_orbit(399);document.getElementById('solar-target').value='499';})()`);await sleep(400);
 await tap('KeyG');await sleep(300);let st=await trip();
 check('G starts a trip to the target',st[0]===1&&st[2]===499,JSON.stringify(st));
 await key('down','KeyW');await sleep(150);await key('up','KeyW');await sleep(100);st=await trip();
 check('W ends the trip where it is',st[0]===0,JSON.stringify(st));
 await tap('KeyG');await sleep(300);await tap('Escape');await sleep(100);st=await trip();
 check('Esc ends the trip where it is',st[0]===0,JSON.stringify(st));
 await b.evaluate(`document.getElementById('solar-target').value='301';document.getElementById('solar-go').click()`);await sleep(5600);st=await trip();
 const at=await b.evaluate(`[...solarFlight.flight.report()]`);
 check('Go arrives in the target frame after about 5 s',st[0]===0&&at[0]===301,JSON.stringify({st,frame:at[0]}));
 await b.evaluate(`solarFlight.flight.jump_orbit(499)`);await sleep(300);
 await b.evaluate(`solarFlight.landAt({body:499,lat:18.65,lon:226.2,size:624})`);await sleep(200);st=await trip();
 check('Land at a landmark starts a trip to its body',st[0]===1&&st[2]===499,JSON.stringify(st));
 // A landing may wait up to 4 s more for the ground at the place to settle.
 for(let i=0;i<120&&(await trip())[0];i++)await sleep(100);await sleep(300);const landed=await b.evaluate(`({r:[...solarFlight.flight.report()],p:[...solarFlight.flight.probe(499)]})`);
 const f=landed.p.slice(6,9),rr=Math.hypot(...f),u=[Math.cos(18.65*Math.PI/180)*Math.sin(226.2*Math.PI/180),Math.sin(18.65*Math.PI/180),Math.cos(18.65*Math.PI/180)*Math.cos(226.2*Math.PI/180)];
 const off=Math.acos(Math.min(1,(u[0]*f[0]+u[1]*f[1]+u[2]*f[2])/rr))*rr;
 check('Land ends just over the ground at the landmark',landed.r[2]>0&&landed.r[2]<200&&off<100,JSON.stringify({clear:landed.r[2],off_m:off}));
 // A landmark and a target are one choice or the other: the last one picked is where G goes.
 await b.evaluate(`(()=>{solarFlight.flight.jump_orbit(499);solarFlight.landmarks.show(499,['Olympus Mons',18.65,226.2,624,'MO']);const s=document.getElementById('solar-target');s.value='301';s.dispatchEvent(new Event('change'));})()`);
 let pick=await b.evaluate(`({landmark:!!solarFlight.landmarks.selected,target:document.getElementById('solar-target').value})`);
 await tap('KeyG');await sleep(200);st=await trip();
 check('a planet picked after a landmark: G goes to the planet',!pick.landmark&&st[0]===1&&st[2]===301,JSON.stringify({pick,st}));
 await b.evaluate(`solarFlight.flight.stop_trip()`);
 await b.evaluate(`(()=>{const s=document.getElementById('solar-target');s.value='599';s.dispatchEvent(new Event('change'));solarFlight.landmarks.show(499,['Olympus Mons',18.65,226.2,624,'MO']);})()`);
 pick=await b.evaluate(`({landmark:!!solarFlight.landmarks.selected,target:document.getElementById('solar-target').value})`);
 check('a landmark picked after a planet: the target is cleared',pick.landmark&&pick.target==='0',JSON.stringify(pick));
 await b.evaluate(`solarExplorer.paused=true`);
}
// 8. The mouse's back and forward buttons. Last, as a failure leaves the page.
for(const button of ['back','forward']){
 await mouse('mouseMoved',...world);await press(...world,button,button==='back'?8:16);await release(...world,button);await new Promise(r=>setTimeout(r,800));
 const same=await b.evaluate(`location.href`).catch(()=>'')===url;
 check(`the ${button} button stays in the game`,same);
 if(!same)break;
}
writeFileSync(join(dir,'report.json'),JSON.stringify({rows,failed:rows.filter(r=>!r.ok).length},null,1));
console.log(bad?`FAILED ${rows.filter(r=>!r.ok).length} of ${rows.length}`:`passed ${rows.length}`);
process.exitCode=bad?1:0;
}finally{await b.close();}

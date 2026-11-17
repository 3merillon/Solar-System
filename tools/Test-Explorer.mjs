// A private headless BrowserWebGpu session; never attaches to the owner's tabs.
import {headless} from './Headless.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const frames=Number(option('--frames','300')),warmup=Number(option('--warmup','480')),views=option('--views','orbit,ground,rough,clouds').split(','),width=Number(option('--width','1920')),height=Number(option('--height','1080'));
const directory=resolve(option('--output',`evidence/local/explorer/${new Date().toISOString().replaceAll(':','-')}`));await mkdir(directory,{recursive:true});
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,check]);}
function png(data,w,h){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const pixels=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)data.copy(pixels,y*(w*4+1)+1,y*w*4,(y+1)*w*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
const browser=await headless(directory);let report={backend:'BrowserWebGpu',browser:browser.version,frames,warmup,width,height,temporal_terrain_aa:false,cases:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const capture=async(name,kind='display')=>{const base64=await browser.evaluate(`(async()=>{const b=await solarExplorer.capture(${JSON.stringify(kind)});let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);})()`);const bytes=Buffer.from(base64,'base64');await writeFile(resolve(directory,`${name}.${kind==='display'?'png':'bin'}`),kind==='display'?png(bytes,width,height):bytes);return bytes;};
try {
 const start=performance.now();await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await browser.send('Page.navigate',{url:'http://127.0.0.1:5198/explorer.html?test=1&body=procedural'});
 for(let i=0;i<600;i++){const state=await browser.evaluate('({ready:!!window.explorerReady,error:window.explorerFailure})');if(state.error)throw Error(state.error);if(state.ready)break;if(i===599)throw Error('Explorer startup timeout');await new Promise(r=>setTimeout(r,200));}
 report.ready_ms=performance.now()-start;await browser.evaluate(`solarExplorer.resize(${width},${height});solarExplorer.engine.profiling(true);`);
 if(args.includes('--simple'))await browser.evaluate('solarExplorer.configure({clouds:false,atmosphere:false,water:false})');
 if(args.includes('--reference'))await browser.evaluate('solarExplorer.configure({reference:true,tolerance:2})');
 for(const view of views){console.log(`Browser: ${view}`);await browser.evaluate(`solarExplorer.go(${JSON.stringify(view)});solarExplorer.time=0;solarExplorer.telemetry();`);
  const warm=await browser.evaluate(`(async()=>{const rows=[],pacing=[],s=performance.now();let first=0;for(let i=0;i<${warmup};i++){const b=performance.now();while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));if(i===0)first=performance.now()-s;rows.push(...solarExplorer.telemetry());pacing.push(performance.now()-b);}return {first_ms:first,wall_ms:performance.now()-s,rows,pacing,stats:solarExplorer.stats()};})()`);
  const measured=await browser.evaluate(`(async()=>{const rows=[],pacing=[],s=performance.now();for(let i=0;i<${frames};i++){solarExplorer.time=${args.includes('--frozen')?'0':'i/60'};const b=performance.now();while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));rows.push(...solarExplorer.telemetry());pacing.push(performance.now()-b);}return {wall_ms:performance.now()-s,rows,pacing,stats:solarExplorer.stats(),snapshot:solarExplorer.snapshot()};})()`);
  const audit=args.includes("--audit")?JSON.parse(await browser.evaluate("solarExplorer.engine.audit_geometry()")):null; report.cases.push({view,warmup:warm,measured,audit});if(audit&&(!audit.balanced||audit.complete_face_area!==6||audit.boundary_edges||audit.nonmanifold_edges||audit.topology_overflow||audit.nonfinite_samples))throw Error("Geometry audit failed: "+view);await capture(view);if(args.includes('--depth')){await capture(`${view}-position`,'position');await capture(`${view}-normal`,'normal');}
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(measured.stats));
 }
 await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(r=>writeFile(resolve(directory,'explorer-ui.png'),Buffer.from(r.data,'base64')));
 console.log(directory);
}finally{await browser.close();}

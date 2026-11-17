import {deflateSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,check]);}
export function png(data,w,h){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const pixels=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)data.copy(pixels,y*(w*4+1)+1,y*w*4,(y+1)*w*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
export async function ready(b,limit=1800){for(let i=0;i<limit;i++){const s=await b.evaluate('({ready:!!window.explorerReady,error:window.explorerFailure})');if(s.error)throw Error(s.error);if(s.ready)return;await new Promise(r=>setTimeout(r,100));}throw Error('Explorer startup timeout');}
export async function capture(b,path,w=1920,h=1080,kind='display'){const base64=await b.evaluate(`(async()=>{const b=await solarExplorer.capture(${JSON.stringify(kind)});let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);})()`);const data=Buffer.from(base64,'base64');
 // Presets below render scale one capture the internal target, not the canvas.
 if(kind==='display'&&data.length!==w*h*4){const s=await b.evaluate('solarExplorer.stats()');if(data.length===s.width*s.height*4){w=s.width;h=s.height;}}
 await writeFile(path,kind==='display'?png(data,w,h):data);return data;}
export const runFrames=async(b,n,update='')=>b.evaluate(`(async()=>{const rows=[],pacing=[];for(let i=0;i<${n};i++){${update}const t=performance.now();while(!solarExplorer.step(1/60))await new Promise(r=>setTimeout(r,0));while(solarExplorer.stats().pending)await new Promise(r=>setTimeout(r,0));rows.push(...solarExplorer.telemetry());pacing.push(performance.now()-t);}return{rows,pacing,stats:solarExplorer.stats()};})()`);

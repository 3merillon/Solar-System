// Offline renders of the score in a private headless browser: the same composer, decks and voices as the live page, run
// through an OfflineAudioContext on the bare page web/music-lab.html (no WebGPU, no explorer). Writes one WAV per job and a
// results.json of measurements (peak, RMS, NaN count, band energies, voice peak, dropped notes).
// Takes the shared machine lock (tools/Music-Lock.mjs) for the whole run, as every headless run must.
// --page DIR also copies the WAVs to DIR and writes an index.html of lettered players (serve it with tools/serve.mjs --root DIR).
// Usage: node tools/Render-Music.mjs --jobs jobs.json --out DIR [--root web] [--port 5461] [--wav 1] [--page DIR]
// jobs.json: [{name, seconds, lite, energy, script:[{at, mood, seed, base:"3/2", length, ...}|{at, accent:"riser", seconds}]}]
import {headless} from './Headless.mjs';
import {withLock} from './Music-Lock.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rm,copyFile} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const data=process.env.SOLAR_DATA||'data',root=resolve(arg('root','web')),out=resolve(arg('out',data+'/music/runs/render')),port=+arg('port',5461),wantWav=arg('wav','1')!=='0';
let jobs=JSON.parse(await readFile(arg('jobs'),'utf8'));
const stems=process.argv.includes('--stems');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=createServer(async(q,s)=>{
 try{const file=resolve(root,'.'+decodeURIComponent(new URL(q.url,'http://x').pathname)),rel=relative(root,file);if(rel.startsWith('..')||isAbsolute(rel)){s.writeHead(403).end();return;}
  const body=await readFile(file);s.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(body);}catch{if(!s.headersSent)s.writeHead(404);s.end();}
});
await mkdir(out,{recursive:true});
const seconds=jobs.reduce((a,j)=>a+j.seconds,0);
const results=await withLock(`tools/Render-Music.mjs: ${jobs.length} offline renders, ${Math.round(seconds)} s of sound`,Math.max(1,Math.ceil(seconds/240)),async()=>{
 // The page is served only while the lock is held, so runs that are waiting their turn do not fight over the port.
 await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
 const browser=await headless(resolve(out,'browser')),rows=[];
 try{
  await browser.send('Page.enable');await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/music-lab.html`});
  for(let i=0;i<150&&!(await browser.evaluate('window.labReady===true').catch(()=>false));i++)await sleep(100);
  if(!(await browser.evaluate('window.labReady===true')))throw Error('The lab page did not load (see browser/browser-events.log)');
  if(process.argv.includes('--probe')){const v=await browser.evaluate('probeVoices()');for(const [name,row] of Object.entries(v))console.log(name.padEnd(8),row.kind.padEnd(7),Object.entries(row).filter(([k])=>k!=='kind').map(([f,m])=>`${f} Hz: peak ${m.peakDb} rms ${m.rmsDb}`).join('   '));return [];}
  if(stems){
   // One render per layer of each piece: the mixing desk by numbers.
   const expanded=[];
   for(const job of jobs){const layers=await browser.evaluate(`layersOf(${JSON.stringify(job.script[0])})`);layers.forEach((name,i)=>expanded.push({...job,name:`${job.name} ${String(i).padStart(2)} ${name}`,script:[{...job.script[0],solo:i}]}));expanded.push({...job,name:`${job.name} == all`});}
   jobs=expanded;
  }
  for(const job of jobs){
   const r=await browser.evaluate(`renderJob(${JSON.stringify(job)})`);r.name=job.name;rows.push(r);
   if(wantWav&&!stems){
    const info=await browser.evaluate('wavPrepare()'),parts=[];
    for(let o=0;o<info.bytes;o+=1500000)parts.push(Buffer.from(await browser.evaluate(`wavChunk(${o},1500000)`),'base64'));
    await writeFile(resolve(out,job.name+'.wav'),Buffer.concat(parts));r.wavGainDb=info.gainDb;
    // The opening of the piece as an RMT module, to open in RMT Compose.
    if(job.script[0]?.mood){const text=await browser.evaluate(`moduleJob(${JSON.stringify(job.script[0])},${job.moduleBars||12})`);await writeFile(resolve(out,job.name+'.rmt.json'),text);r.module=JSON.parse(text).notes.length;}
   }
   console.log(`${job.name.padEnd(stems?34:18)} peak ${String(r.peakDb).padStart(6)} dB  rms ${String(r.rmsDb).padStart(6)} dB  bad ${r.bad}  voices ${String(r.voicesPeak).padStart(5)}  dropped ${r.dropped}  notes ${r.spawned}  bands ${r.bandsDb.join(' ')}  render ${r.renderMs} ms  ${r.labels.join(' | ')}`);
  }
 }finally{await browser.close();}
 return rows;
});
server.close();
await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,1));
const page=arg('page',null);
if(page&&wantWav&&!stems){
 await mkdir(page,{recursive:true});
 const esc=t=>String(t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
 let rows='';
 for(const [i,job] of jobs.entries()){
  const r=results[i],letter=job.letter||String.fromCharCode(65+i);await copyFile(resolve(out,job.name+'.wav'),resolve(page,job.name+'.wav'));if(r.module)await copyFile(resolve(out,job.name+'.rmt.json'),resolve(page,job.name+'.rmt.json'));
  rows+=`<section><h2><b>${esc(letter)}</b> ${esc(job.title||job.name)}</h2><p>${esc(job.note||'')}</p><audio controls preload="none" src="${encodeURIComponent(job.name)}.wav"></audio><p class="small">${esc(r.labels.join(' | '))}<br>raw render: peak ${r.peakDb} dB, RMS ${r.rmsDb} dB, at most ${r.voicesPeak} of the voice budget in use, ${r.dropped} notes dropped. The file is levelled for listening.${r.module?` <a href="${encodeURIComponent(job.name)}.rmt.json" download>Its opening as an RMT module</a> (${r.module} notes; Load Module in RMT Compose).`:''}</p></section>`;
 }
 await writeFile(resolve(page,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Solar System v2: the score</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;background:#0b0d12;color:#e6e8ee}h1{font-size:1.4rem}h2{font-size:1.1rem;margin:1.6rem 0 .2rem}h2 b{display:inline-block;min-width:1.8rem;height:1.8rem;line-height:1.8rem;text-align:center;border-radius:.3rem;background:#e6a23c;color:#111;margin-right:.5rem}audio{width:100%;margin:.4rem 0}.small{font-size:.85rem;color:#9aa3b2}a{color:#e6a23c}p{margin:.3rem 0}</style><h1>${esc(arg('heading','Solar System v2: the score, in exact fractions'))}</h1><p>${esc(arg('intro',''))}</p>${rows}<p class="small">Rendered ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC by tools/Render-Music.mjs. Everything is synthesized; no samples.</p>`);
 console.log('page: '+resolve(page,'index.html'));
}

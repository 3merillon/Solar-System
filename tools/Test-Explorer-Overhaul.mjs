import {headless} from './Headless.mjs';
import {ready,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.argv[2]||'evidence/local/explorer-overhaul';await mkdir(dir,{recursive:true});const b=await headless(dir),report={};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await b.send('Network.enable');await b.send('Network.setBlockedURLs',{urls:['*solar_explorer*']});
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&quality=low'});await new Promise(r=>setTimeout(r,800));
 report.boot=await b.evaluate('({className:document.body.className})');
 await writeFile(dir+'/initializing.png',Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await b.send('Network.setBlockedURLs',{urls:[]});
 await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&quality=low'});await ready(b);
 await runFrames(b,120);report.start=await b.evaluate('solarExplorer.stats()');
 assert.equal(await b.evaluate('window.explorerFailure'),null);
 report.audio=await b.evaluate(`(async()=>{const {celestialScore}=await import('./celestial-music.js');const ctx=new OfflineAudioContext(2,48000*8,48000),score=celestialScore(ctx);score.render(8);const output=await ctx.startRendering();let sum=0,peak=0,finite=true;for(const x of output.getChannelData(0)){sum+=x*x;peak=Math.max(peak,Math.abs(x));finite&&=Number.isFinite(x);}return {rms:Math.sqrt(sum/output.length),peak,finite};})()`);
 assert.ok(report.audio.finite&&report.audio.rms>.005&&report.audio.peak<.99,JSON.stringify(report.audio));
 await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await writeFile(dir+'/mobile.png',Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 report.pass=true;console.log(JSON.stringify({pass:true,audio:report.audio}));
}catch(e){report.error=String(e.stack||e);throw e;}finally{await writeFile(dir+'/report.json',JSON.stringify(report,null,2));await b.close();}

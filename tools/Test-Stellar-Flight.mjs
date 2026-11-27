// Fixed broadband photospheric scenes, using the regular flight controls and HDR finish.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {capture, ready, runFrames} from './Explorer-Test-Lib.mjs';

const [base = 'http://127.0.0.1:5198', directory = 'evidence/local/stellar', mode = 'current'] = process.argv.slice(2);
const out = resolve(directory), width = 1920, height = 1080;
await mkdir(out, {recursive: true});
const browser = await headless(join(out, 'browser'));
const camera = 'solarExplorer.camera=solarFlight.frame(0,new Set(),0);';
const results = [];
function mean(image, start, end) {
  let sum = 0, n = 0;
  for (let y = start; y < end; y += 4) {
    for (let x = 20; x < width - 20; x += 4) {
      sum += image[4 * (y * width + x) + 1];
      n++;
    }
  }
  return sum / n;
}
try {
  await browser.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false});
  await browser.send('Page.navigate', {url:base + '/index.html?test=1&at=10&height=7000000&body=solar&quality=high&view=photosphere%3A10'});
  await ready(browser);
  await browser.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarFlight.setTime(852076800)');
  await browser.evaluate("for(const id of ['solar-trails','solar-labels'])document.getElementById(id).checked=false");
  if (mode !== 'baseline') assert.equal(await browser.evaluate("document.getElementById('solar-star-view').value"), '0');
  for (const [name,id,limb,filtered,exposure] of [
    ['sun-granulation',10,false,false,.065], ['sun-limb',10,true,false,.065],
    ['proxima-limb',10000,true,false,1.3], ['sun-filtered',10,true,true,.065],
  ]) {
    if (mode !== 'baseline') {
      await browser.evaluate(`{const band=document.getElementById('solar-star-view');band.value='${filtered?1:0}';band.dispatchEvent(new Event('change'));
        const view=document.getElementById('world-select');view.value='${limb?'photosphere':'granulation'}:${id}';view.dispatchEvent(new Event('change'));}`);
      assert.equal(await browser.evaluate("document.getElementById('world-select').value"),String(id));
    }
    if (mode === 'baseline') await browser.evaluate(`{const f=solarFlight.flight,r=f.constructor.body_radius(${id}),z=r*${limb?1.006:1.02};
      const a=${limb?'Math.acos(r/z)':'1.25'};f.jump_camera(${id},new Float64Array([0,0,z,1000*Math.cos(a),0,z-1000*Math.sin(a),0,0,1]));}`);
    if (mode !== 'baseline') await browser.evaluate(`solarExplorer.configure({auto_exposure:false,exposure:${exposure}})`);
    await runFrames(browser,24,camera);
    const run = await runFrames(browser,48,camera);
    const pixels = await capture(browser,join(out,name+'.png'),width,height);
    const hdr = await capture(browser,join(out,name+'.hdr16'),width,height,'hdr');
    assert.equal(hdr.length,width*height*8);
    for (let i = 0; i < hdr.length; i += 8) {
      for (let c = 0; c < 3; c++) assert((hdr.readUInt16LE(i+c*2) & 0x7c00)!==0x7c00,name+' finite HDR');
    }
    const top = mean(pixels,30,230), bottom = mean(pixels,850,1050);
    if (mode !== 'baseline' && !filtered && limb) assert(bottom>top*15 && bottom>10,name+' disk and sky are separated');
    const times=run.rows.map(r=>r.gpu_span_ms).filter(Number.isFinite).sort((a,b)=>a-b);
    const row={name,top,bottom,p50_ms:times[Math.floor(times.length*.5)],p95_ms:times[Math.ceil(times.length*.95)-1]};
    results.push(row);console.log(row);
  }
} finally {
  await writeFile(join(out,'report.json'),JSON.stringify({mode,width,height,results},null,2));
  await browser.close();
}

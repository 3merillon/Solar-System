// One device, one page and the same deterministic flight camera for each capture.
// node tools/Test-Giant-Flight.mjs http://127.0.0.1:5198 evidence/local/giants
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {capture, ready, runFrames} from './Explorer-Test-Lib.mjs';
import {giantShot} from './Giant-Flight.mjs';

const [base = 'http://127.0.0.1:5198', directory = 'evidence/local/giants', quality = 'high'] = process.argv.slice(2);
const out = resolve(directory), width = 1920, height = 1080;
await mkdir(out, {recursive:true});
const browser = await headless(join(out, 'browser'));
const report = {base,quality,browser:browser.version.product,shots:[]};
const camera = 'solarExplorer.camera=solarFlight.frame(0,new Set(),0);';
const percentile = (values,q) => values.slice().sort((a,b)=>a-b)[Math.ceil(q*values.length)-1];
try {
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url:`${base}/index.html?test=1&body=solar&at=699&quality=${quality}`});
  await ready(browser);
  await browser.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true)');
  // Let the shipping worker feed the sky faces and observed maps.
  await runFrames(browser,90,camera);
  await browser.evaluate(giantShot(699,0));
  const daylight = await browser.evaluate('solarFlight.flight.packet(1920,1080)[36]');
  assert(daylight > .008 && daylight < .014, 'Saturn daylight relative to Earth');
  const locked = 1.3/daylight;
  await browser.evaluate(`solarExplorer.configure({spacecraft_camera:true,auto_exposure:false,exposure:${locked}})`);
  for(const [name,body,fraction] of [['saturn-wide',699,0],['saturn-limb',699,.42],
    ['saturn-shadow',699,.67],['saturn-immersed',699,.93],['jupiter-skim',599,.72]]){
    await browser.evaluate(giantShot(body,fraction));
    // Lock to the local daylight for each destination so both skims retain cloud detail.
    const localDay=await browser.evaluate('solarFlight.flight.packet(1920,1080)[36]');
    await browser.evaluate(`solarExplorer.configure({exposure:${1.3/localDay}})`);
    await runFrames(browser,20,camera);
    const run=await runFrames(browser,72,camera);
    const samples=run.rows.flat().map(r=>r.gpu_span_ms).filter(Number.isFinite);
    const space=run.rows.flat().map(r=>r.marks?.find(([name])=>name==='space')?.[1]).filter(Number.isFinite);
    const display=await capture(browser,join(out,name+'.png'),width,height);
    const hdr=await capture(browser,join(out,name+'.hdr16'),width,height,'hdr');
    assert.equal(hdr.length, display.length*2, name+' linear HDR size');
    let minimum=65535,maximum=0;
    for(let i=0;i<hdr.length;i+=8){const red=hdr.readUInt16LE(i);
      assert((red&0x7c00)!==0x7c00,name+' finite HDR radiance');minimum=Math.min(minimum,red);maximum=Math.max(maximum,red);}
    assert(maximum>minimum,name+' non-uniform linear radiance');
    assert(display.some((v,i)=>i%4!==3 && v>2),name+' frame has light');
    const shot={name,frames:samples.length,p50:percentile(samples,.5),p95:percentile(samples,.95),
      p99:percentile(samples,.99),space_p95:percentile(space,.95)};
    report.shots.push(shot);console.log(shot);
  }
  // On the same dark sky, adaptation must recover stars after a locked daylight exposure.
  await browser.evaluate(giantShot(699,0));
  await browser.evaluate('solarFlight.flight.jump_camera(699,[0,0,3.5e8,0,0,3.6e8,0,1,0])');
  await browser.evaluate(`solarExplorer.configure({exposure:${locked}})`);
  await runFrames(browser,12,camera);
  const dark=await capture(browser,join(out,'sky-locked.png'),width,height);
  await browser.evaluate('solarExplorer.configure({auto_exposure:true,exposure:1.3})');
  await runFrames(browser,300,camera);
  const adapted=await capture(browser,join(out,'sky-adapted.png'),width,height);
  const light = image => {let total=0;for(let i=0;i<image.length;i+=4)total+=image[i+1];return total/(image.length/4);};
  report.sky={locked:light(dark),adapted:light(adapted)};
  assert(report.sky.adapted>report.sky.locked,'dark-space adaptation recovers sky light');
  // Exercise the user-facing route and return the craft to manual flight.
  await browser.evaluate(`const select=document.getElementById('world-select');select.value='saturn-flyby';select.dispatchEvent(new Event('change'));`);
  await runFrames(browser,90,'solarExplorer.camera=solarFlight.frame(.05,new Set(),0);');
  await browser.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))");
  assert.equal(await browser.evaluate("document.getElementById('world-select').value"),'699');
  await browser.evaluate("const view=document.getElementById('world-select');view.value='jupiter-flyby';view.dispatchEvent(new Event('change'));");
  await runFrames(browser,3,'solarExplorer.camera=solarFlight.frame(.05,new Set(),0);');
  await browser.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))");
  assert.equal(await browser.evaluate("document.getElementById('world-select').value"),'599');
  report.device=await browser.evaluate('solarExplorer.device()');
}finally{
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  await browser.close();
}

// Move along one sight line on a settled, steep coast. Every centre ray should
// hit the same place in world space, including as the mesh changes resolution.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {headless} from './Headless.mjs';
import {runFrames} from './Explorer-Test-Lib.mjs';

const dir = process.argv[2] || 'evidence/local/coastal-terrain';
const base = process.argv[3] || 'http://127.0.0.1:5198/';
const width = 385, height = 217;
await mkdir(dir, {recursive: true});
const browser = await headless(dir);
try {
  await browser.send('Page.navigate', {url: new URL('field/chart.js', base).href});
  await browser.evaluate(`(async () => {
    document.body.innerHTML = '<canvas width="${width}" height="${height}"></canvas>';
    const {createWorkerExplorer} = await import('${base}worker-client.js');
    const {R, heightTexelToChart, chartToDirection} = await import('${base}field/chart.js');
    const engine = await createWorkerExplorer(document.querySelector('canvas'), () => {}, err => {window.fatal = err}, 'full', 'earth');
    await engine.profiling(true);
    await engine.configure(JSON.stringify({...JSON.parse(engine.settings()), taa:false, clouds:false,
      wave_height:0, ground_cover:false, trees:false, rocks:false, buildings:false, shadows:false, atmosphere:false, render_scale:1}));
    const u = 2 * 2161.505 / 4096 - 1, v = 2 * 2195.38 / 4096 - 1;
    const radial = chartToDirection(4,u,v);
    const east = [1,0,-u].map(x => x/Math.hypot(1,u));
    const target = radial.map(x => x*(R+20));
    const forward = east.map((x,i) => (x-radial[i]*.18)/Math.hypot(1,.18));
    window.setRange = range => {
      const eye = target.map((x,i) => x-forward[i]*range);
      solarExplorer.camera = [eye, eye.map((x,i) => x+forward[i]), radial];
    };
    window.solarExplorer = {engine, step(dt){return engine.render(this.camera.flat(),dt,0)},
      stats:()=>JSON.parse(engine.stats()), telemetry:()=>JSON.parse(engine.telemetry())};
    setRange(110);
    const water = Float32Array.of(0);
    for(let face=0;face<6;face++)
      await engine.page_arrived(0,face,0,0,0,-12,0,1,new Uint8Array(264*264*2),water);
    for(let level=1;level<=15;level++) {
      const page = {level,x:Math.floor((1+u)*.5*2**level),y:Math.floor((1+v)*.5*2**level)};
      const samples = new Uint16Array(264*264);
      for(let i=0;i<264;i++) {
        const [s] = heightTexelToChart(page,i,3);
        // Coarser source surveys place the coastline ten metres farther inland.
        const offset = level <= 14 ? 10 : 0;
        const elevation = 15+27*Math.tanh(((s-u)*R-offset)/13);
        for(let j=0;j<264;j++) samples[j*264+i] = Math.round((elevation+12)*1000);
      }
      await engine.page_arrived(0,4,level,page.x,page.y,-12,.001,1,new Uint8Array(samples.buffer),water);
    }
    window.readHit = async () => {
      const data = await engine.capture('position');
      const hits = new Float32Array(data.buffer,data.byteOffset,data.byteLength/4);
      if(hits.length !== ${width*height*4}) throw Error('unexpected position buffer size '+hits.length);
      const normals = await engine.capture('normal');
      const half = new Uint16Array(normals.buffer,normals.byteOffset,normals.byteLength/2);
      const mid = ${4*(Math.floor(height/2)*width+Math.floor(width/2))};
      const hit = Array.from(hits.slice(mid,mid+3));
      const world = hit.map((x,i)=>solarExplorer.camera[0][i]-target[i]+x);
      const bits=half[mid+3], exponent=(bits>>10)&31, fraction=bits&1023;
      const lod=(bits>>15?-1:1)*(exponent ? 2**(exponent-15)*(1+fraction/1024) : 2**-24*fraction);
      return {spacing:2**lod,distance:Math.hypot(...hit),along:world.reduce((sum,x,i)=>sum+x*forward[i],0),height:hits[mid+3]};
    };
  })()`);
  await runFrames(browser,250);
  const samples=[],gpuMs=[];
  const recordCost=({rows})=>{
    for(const {gpu_ms} of rows) if (gpu_ms?.length) gpuMs.push(gpu_ms.reduce((a,b)=>a+b,0));
  };
  for (const range of [245,185,110,75,45,23,35,65,110,185,245]) {
    await browser.evaluate('setRange('+range+')');
    recordCost(await runFrames(browser,65));
    samples.push({range,...await browser.evaluate('readHit()')});
  }
  for (let start=245;start>165;start-=5) {
    recordCost(await runFrames(browser,10,`setRange(${start}-(i+1)*.5);`));
    samples.push({range:start-5,moving:true,...await browser.evaluate('readHit()')});
  }
  const spread=Math.max(...samples.map(s=>s.along))-Math.min(...samples.map(s=>s.along));
  const progress=JSON.parse(await browser.evaluate('solarExplorer.engine.audit_progress()'));
  gpuMs.sort((a,b)=>a-b);
  const gpu={frames:gpuMs.length,median:gpuMs[Math.floor(gpuMs.length*.5)],p95:gpuMs[Math.floor(gpuMs.length*.95)]};
  const report={samples,spread,overflow:progress.overflow,gpu};
  await writeFile(dir+'/report.json',JSON.stringify(report,null,2));
  console.log({samples:samples.length,spread,overflow:progress.overflow,gpu});
  assert.ok(samples.every(s=>s.distance>1 && Math.abs(s.along)<5),'every ray must hit the fine coast');
  assert.ok(Math.max(...samples.map(s=>s.spacing))>2*Math.min(...samples.map(s=>s.spacing)),'the mesh must actually change LOD');
  assert.ok(spread<.20,'settled bank moved by more than 20 cm along one sight line');
  assert.equal(progress.overflow,0);
  assert.equal(await browser.evaluate('window.fatal||null'),null);
} finally {
  await browser.close();
}

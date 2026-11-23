// Visit two distant parts of Earth at a frozen weather epoch. On the first
// frame back the density must already match, while the local sunlight maps
// have a bounded refill and eventually reproduce the settled lighting.
// Requires the pack-earth-v1 pack. Additional terrain tiles use replay only.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {earthBrowser, heading, tileServer, toEye} from './Earth-Test-Lib.mjs';
import {capture, runFrames} from './Explorer-Test-Lib.mjs';

const dir = process.argv[2] || 'evidence/local/cloud-streaming';
const width = 640, height = 360;
await mkdir(dir, {recursive: true});
const server = await tileServer({port: 5264});
let browser;
try {
  browser = await earthBrowser(dir, server, {width, height, quality: 'high'});
  const camera = (lon, lat) => {
    const eye = toEye(lon, lat, 2500);
    const forward = heading(lon, lat, 35, 0.8);
    return [eye, eye.map((v, i) => v + 1000 * forward[i]), eye.map(v => v / Math.hypot(...eye))];
  };
  const visit = pose => browser.evaluate(`solarExplorer.camera=${JSON.stringify(pose)}`);
  const radii = () => browser.evaluate('(async()=>JSON.parse(await solarExplorer.engine.audit_shadows()).cloud_profile_radii)()');
  const readCloud = name => capture(browser, join(dir, name + '.bin'), width, height, 'cloud');
  await browser.evaluate('solarExplorer.time=0;solarExplorer.configure({cloud_type:1,cloud_cover:0.4,cloud_speed:0,cloud_evolution:0,cloud_history:false})');

  // Select a bank with measurable transmission so an empty or fully opaque
  // buffer cannot pass the return check. All rays look above the horizon.
  let pose, reference;
  for (const lon of [-40, -32, -22, -12, 5, 20]) {
    pose = camera(lon, 30);
    await visit(pose);
    await runFrames(browser, 20);
    reference = await readCloud('settled');
    let partial = 0;
    for (let i = 6; i < reference.length; i += 8) {
      const transmission = reference.readUInt16LE(i);
      if (transmission > 0x2400 && transmission < 0x3b80) partial++;
    }
    if (partial > reference.length / 8 * 0.02) break;
    reference = null;
  }
  assert.ok(reference, 'expected a cloud bank with partially transmitting rays');
  assert.deepEqual(await radii(), [129, 129, 129]);
  await capture(browser, join(dir, 'settled.png'), width, height);
  await visit(camera(110, -30));
  await runFrames(browser, 16);
  await visit(pose);
  await runFrames(browser, 1);
  const firstRadii = await radii();
  assert.deepEqual(firstRadii, [12, 12, 12], 'a chart cut starts with a bounded centre');
  const returned = await readCloud('first-frame-back');
  assert.equal(returned.length, reference.length);
  for (let i = 6; i < reference.length; i += 8) {
    assert.equal(returned.readUInt16LE(i), reference.readUInt16LE(i), 'density changed on camera return');
  }
  await runFrames(browser, 4);
  const partialRadii = await radii();
  assert.deepEqual(partialRadii, [60, 60, 60], 'the light windows grow incrementally');
  await runFrames(browser, 10);
  assert.deepEqual(await radii(), [129, 129, 129]);
  assert.ok((await readCloud('refilled')).equals(reference), 'settled cloud radiance must reproduce');
  // Release a measured page under a stationary observer. The terrain mask
  // refreshes after 120 quiet frames. Watch its optical window during the refresh.
  const lightState=()=>browser.evaluate('(async()=>{const s=JSON.parse(await solarExplorer.engine.audit_shadows());return {radii:s.cloud_profile_radii,solid:s.profile_rebuild_frames[3]}})()');
  const previous=await lightState();
  await browser.evaluate(`(async()=>{
    const {directionToChart}=await import('./field/chart.js');
    const {face,u,v}=directionToChart(solarExplorer.camera[0]);
    await solarExplorer.engine.page_arrived(0,face,4,Math.floor((u+1)*8),Math.floor((v+1)*8),0,0,1,new Uint8Array(264*264*2),Float32Array.of(0));
  })()`);
  await runFrames(browser,114);
  const samples=[];
  for(let i=0;i<12;i++){
    await runFrames(browser,2);
    const state=await lightState();samples.push(state);
    assert.deepEqual(state.radii,[129,129,129],'a terrain refresh dropped resident cloud lighting');
  }
  assert.ok(samples.at(-1).solid>previous.solid,'the injected terrain must refresh the sunlight mask');
  await writeFile(join(dir, 'report.json'), JSON.stringify({pose, firstRadii, partialRadii, comparedRays: reference.length / 8,terrainRefresh:samples}, null, 2));
  console.log('Cloud density matched on the first frame back and settled sunlight reproduced.');
} finally {
  try { await browser?.close(); } finally { server.close(); }
}

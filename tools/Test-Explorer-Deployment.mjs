// Exercise the packaged static site and the actual browser WASM entry point.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute} from 'node:path';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';

const local=process.argv[2]==='--local';
const dir=resolve(process.argv[3]||`evidence/local/deployment-${local?'local':'live'}`);
await mkdir(dir,{recursive:true});
let server,browser;
try{
 let url=process.argv[2];if(!local&&!/^https?:/.test(url||''))throw Error('Pass the deployment URL to test, or --local for dist/');
 if(local){
  const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
  server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(p==='/'?'/index.html':p));const child=relative(root,file);if(child.startsWith('..')||isAbsolute(child))throw Error('Outside package');res.setHeader('Content-Type',mime[extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));url=`http://127.0.0.1:${server.address().port}/`;
 }
 const report={url,assets:[],browser:null};
 for(const [path,type] of [['','text/html'],['explorer.js','javascript'],['credits.js','javascript'],['game-input.js','javascript'],['flight.js','javascript'],['touch.js','javascript'],['quality.js','javascript'],['worker-client.js','javascript'],['render-worker.js','javascript'],['gpu-startup.js','javascript'],['explorer.css','text/css'],['pkg/solar_explorer.js','javascript'],['pkg/solar_explorer_bg.wasm','application/wasm'],['pkg/explorer-manifest.json','application/json']]){
  const response=await fetch(new URL(path,url));assert.equal(response.status,200,`${path}: HTTP ${response.status}`);assert.ok(response.headers.get('content-type')?.includes(type),`${path}: wrong MIME type`);
  const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>0);
  if(path.endsWith('.wasm'))assert.ok(WebAssembly.validate(bytes));
  if(path.endsWith('manifest.json'))report.manifest=JSON.parse(bytes);
  report.assets.push({path,status:response.status,type:response.headers.get('content-type'),bytes:bytes.length});
 }
 browser=await headless(dir);report.browser=browser.version;
 await browser.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await browser.send('Page.navigate',{url:new URL('?test=1&body=procedural',url).href});await ready(browser);
 await browser.evaluate('solarExplorer.resize(1280,720);solarExplorer.engine.profiling(true);');
 report.render=await runFrames(browser,32);assert.equal(report.render.stats.topology_overflow,0);assert.ok(report.render.stats.completed>0);
 assert.equal(await browser.evaluate('window.isSecureContext'),true);
 const pixels=await capture(browser,resolve(dir,'explorer.png'),1280,720);assert.ok(pixels.some((v,i)=>i%4!==3&&v>16),'Blank image');
 report.settings=await browser.evaluate('solarExplorer.snapshot().settings');assert.equal(report.settings.cloud_steps,128);assert.equal(report.settings.cloud_scale,1);
 assert.equal(report.settings.shadows,true);assert.equal(report.settings.shadow_steps,64);
 assert.equal(report.settings.lod_distance,4);assert.equal(report.settings.surface_detail,true);
 assert.equal(await browser.evaluate('Number(document.getElementById("lod-distance").max)'),16);
 assert.equal(report.settings.scenery_version,2);assert.equal(report.settings.ground_cover,true);assert.equal(report.settings.trees,true);assert.equal(report.settings.rocks,true);
 assert.equal(await browser.evaluate("['trees','rocks','ground_cover','scenery-density','scenery-detail','scenery-wind','cover-reach'].every(id=>!!document.getElementById(id))"),true);
 await browser.evaluate('solarExplorer.go("forest");solarExplorer.configure({clouds:false,water:false,atmosphere:false});');
 report.scenery=await runFrames(browser,240);assert.ok(report.scenery.stats.scenery.trees>100);assert.ok(report.scenery.stats.scenery.rocks>0);assert.equal(report.scenery.stats.scenery.overflow,0);
 await capture(browser,resolve(dir,'forest.png'),1280,720);
 await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({url,commit:report.manifest.commit,assets:report.assets.length,completed:report.render.stats.completed,webgpu:report.render.stats.adapter}));
}finally{if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));}

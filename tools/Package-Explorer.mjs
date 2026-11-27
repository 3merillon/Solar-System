// Publish only the browser explorer and its generated WASM, never native probes.
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyExplorerBuild} from './Verify-Explorer-Build.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const generated=resolve(root,process.argv[2]||'web/pkg');
const output=resolve(root,process.argv[3]||'dist');
const files=['index.html','explorer.html','explorer.js','explorer.css','flight.js','game-input.js','credits.js','solar.js','planet-indicators.js','landmarks.js','quality.js','touch.js','worker-client.js','render-worker.js','pack-base.js','gpu-startup.js','flight-deck.js','flight-deck.css','celestial-music.js','music-theory.js','music-harmony.js','music-composer.js','music-synth.js','music-engine.js','music-director.js','music-rmt.js','THIRD-PARTY-NOTICES.txt','THIRD-PARTY-RUST.txt','home-zone.js','favicon.ico','favicon.svg','favicon-16x16.png','favicon-32x32.png','apple-touch-icon.png'];
// web/field/*.js is the Earth field worker. The tile pack itself is not packaged yet.
const fieldDir=resolve(root,'web/field');
files.push(...(await readdir(fieldDir)).filter(f=>f.endsWith('.js')).sort().map(f=>`field/${f}`));
// web/landmarks/*.json: IAU feature names per body (tools/Bake-Landmarks.mjs), public domain.
files.push(...(await readdir(resolve(root,'web/landmarks'))).filter(f=>f.endsWith('.json')).sort().map(f=>`landmarks/${f}`));
files.push('landmark-guide.js');
const landmarkGroups=['articles','surveys','geology'];
for(const group of landmarkGroups){
 const dir='landmarks/'+group;
 files.push(...(await readdir(resolve(root,'web',dir))).filter(f=>/^\d+\.json$/.test(f)).sort().map(f=>dir+'/'+f));
}
files.push('saturn-opal-2023b.png','giant-flight.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
const wasm=await readFile(resolve(generated,'solar_explorer_bg.wasm'));
const shaders=await verifyExplorerBuild(resolve(generated,'solar_explorer_bg.wasm'),root);
if(!WebAssembly.validate(wasm))throw Error('The explorer package is not valid WebAssembly');
const loader=await readFile(resolve(generated,'solar_explorer.js'),'utf8');
if(!loader.includes('solar_explorer_bg.wasm'))throw Error('Mismatched WASM loader');
// An allowlist prevents old field-lab files or local diagnostics being published.
await mkdir(resolve(output,'pkg'),{recursive:true});
await mkdir(resolve(output,'field'),{recursive:true});
await mkdir(resolve(output,'landmarks'),{recursive:true});
for(const file of files){await mkdir(resolve(output,file,'..'),{recursive:true});await copyFile(resolve(root,'web',file),resolve(output,file));}
await writeFile(resolve(output,'pkg/solar_explorer_bg.wasm'),wasm);
// The data packs are never packaged. SOLAR_PACK_BASE names the https host that serves them (web/pack-base.js reads
// it from solar-pack.json, and that host must send Access-Control-Allow-Origin); without it the deployment says it has
// none, so the page asks for no pack files (web/solar-pack.json says true for the dev server, whose web/pack holds them).
const packBase=process.env.SOLAR_PACK_BASE||'';
if(packBase&&!/^https:\/\/[^/]+\/(.*\/)?$/.test(packBase))throw Error(`SOLAR_PACK_BASE must be an https URL ending in /: ${packBase}`);
await writeFile(resolve(output,'solar-pack.json'),JSON.stringify(packBase?{solar:true,base:packBase}:{solar:false}));
await writeFile(resolve(output,'pkg/solar_explorer.js'),loader);
for(const file of ['solar_explorer.js','solar_explorer_bg.wasm'])for(const suffix of ['.br','.gz'])await copyFile(resolve(generated,file+suffix),resolve(output,'pkg',file+suffix));
const sources={};
async function source(path){
  for(const item of (await readdir(resolve(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const child=`${path}/${item.name}`;
    if(item.isDirectory())await source(child);
    else sources[child]=hash(await readFile(resolve(root,child)));
  }
}
await source('crates/solar-core');await source('crates/solar-explorer');
for(const file of ['Cargo.lock','Cargo.toml','rust-toolchain.toml','crates/solar-probe/src/gpu.rs','shaders/present.wgsl','shaders/finish.wgsl','shaders/explorer.wgsl','shaders/surface_field.wgsl','shaders/buildings.wgsl','shaders/space.wgsl','shaders/terrain_gpu.wgsl','shaders/water.wgsl','shaders/clouds.wgsl','shaders/scenery.wgsl','shaders/scenery_common.wgsl','shaders/scenery_trees.wgsl','shaders/scenery_cover.wgsl','shaders/surface_detail.wgsl','shaders/sun_visibility.wgsl','shaders/sun_clouds.wgsl','shaders/sun_casters.wgsl',...files.map(f=>`web/${f}`)])sources[file]=hash(await readFile(resolve(root,file)));
const commit=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/').replace(/\/$/,'')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const manifest={built_utc:new Date().toISOString(),commit,wasm_sha256:hash(wasm),sources,shaders};
await writeFile(resolve(output,'pkg/explorer-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
// Fail on stale/unexpected output instead of deploying an obsolete function or lab.
async function check(path,allowed){for(const item of await readdir(path)){if(!allowed.includes(item))throw Error(`Unexpected static output: ${relative(root,resolve(path,item))}`);}}
await check(output,[...files.filter(f=>!f.includes('/')),'pkg','field','landmarks','solar-pack.json']);
const landmarkFiles=files.filter(f=>f.startsWith('landmarks/')).map(f=>f.slice(10));
await check(resolve(output,'landmarks'),landmarkFiles.map(f=>f.split('/')[0]));
for(const group of landmarkGroups){
 await check(resolve(output,'landmarks',group),landmarkFiles.filter(f=>f.startsWith(group+'/')).map(f=>f.split('/')[1]));
}
await check(resolve(output,'field'),files.filter(f=>f.startsWith('field/')).map(f=>f.slice(6)));
await check(resolve(output,'pkg'),['solar_explorer.js','solar_explorer_bg.wasm','solar_explorer.js.br','solar_explorer.js.gz','solar_explorer_bg.wasm.br','solar_explorer_bg.wasm.gz','explorer-manifest.json']);
console.log(`Packaged static WebGPU explorer: ${wasm.length} WASM bytes, commit ${commit}`);

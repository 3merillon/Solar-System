// Verify what WASM actually embeds, before writing a manifest or packaging it.
// Source file hashes alone cannot attest a stale Cargo build-script output.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function shaderBuildKey(root=resolve('.')) {
 const files=['crates/solar-explorer/build.rs',...['explorer','surface_field','surface_detail','water','clouds','sun_visibility','sun_clouds','scenery_common','terrain_gpu','scenery_trees','scenery','scenery_cover','sun_casters','buildings','space','finish','present'].map(n=>`shaders/${n}.wgsl`)];
 const h=createHash('sha256');for(const file of files){h.update(file+'\0');h.update(await readFile(resolve(root,file)));h.update('\0');}return h.digest('hex');
}
export function embeddedPrograms(wasm) {
 const marker=Buffer.from('[{"code":'),offset=wasm.indexOf(marker);
 if(offset<0)throw Error('Missing embedded shader program registry');
 // Find the end without interpreting WGSL brackets inside JSON strings.
 const text=wasm.subarray(offset).toString('utf8');let quoted=false,escape=false,depth=0;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='['||c==='{')depth++;else if(c===']'||c==='}') {depth--;if(depth===0)return JSON.parse(text.slice(0,i+1));}}
 throw Error('Incomplete embedded shader program registry');
}
export async function verifyExplorerBuild(path,root=resolve('.')) {
 const wasm=await readFile(path),programs=embeddedPrograms(wasm),expected=await shaderBuildKey(root),actual=programs[0].source_build_key;
 if(actual!==expected)throw Error(`WASM shader provenance mismatch: embedded ${actual??'unversioned'}, source ${expected}. Rebuild with Build-Explorer.ps1 / Build-Vercel.sh.`);
 return {source_build_key:actual,programs:programs.length,programs_sha256:createHash('sha256').update(JSON.stringify(programs)).digest('hex'),wasm_sha256:createHash('sha256').update(wasm).digest('hex')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.includes('--key'))console.log(await shaderBuildKey());
 else console.log(JSON.stringify(await verifyExplorerBuild(resolve(process.argv[2]||'web/pkg/solar_explorer_bg.wasm'))));
}

// Immutable measurement snapshot of web/ in a directory outside the repository (for
// example $SOLAR_DATA/fc-<name>), without web/pack or web/__* links. With --pack, a
// junction to the data bake (default $SOLAR_DATA/bake) is added so Earth and Moon scenes have data.
// Serve with: node tools/serve.mjs --port N --root <dir>
// Usage: node tools/Snapshot-To.mjs <dir> [--pack [bake dir]]
import {cp,mkdir,readdir,symlink,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=process.argv[2];
if(!out)throw Error('Supply a new snapshot directory');
const pi=process.argv.indexOf('--pack'),pack=pi<0?null:process.argv[pi+1]||(process.env.SOLAR_DATA||'data')+'/bake';
await mkdir(out,{recursive:false});
for(const e of await readdir('web',{withFileTypes:true})){
 if(e.name.startsWith('__')||e.name==='pack'||e.isSymbolicLink())continue;
 await cp(resolve('web',e.name),resolve(out,e.name),{recursive:true,dereference:false});
}
if(pack){await stat(pack);await symlink(resolve(pack),resolve(out,'pack'),'junction');}
console.log(JSON.stringify({snapshot:resolve(out),pack}));

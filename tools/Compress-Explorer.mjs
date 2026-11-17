// Deterministic transport sidecars; the development and packaged servers retain the original MIME type.
import {readFile,writeFile} from 'node:fs/promises';
import {brotliCompress,gzip,constants} from 'node:zlib';import {promisify} from 'node:util';
// Usage: node tools/Compress-Explorer.mjs [dir]; dir defaults to web/pkg (Build-Explorer.ps1), Build-Vercel.sh passes target/web-package.
const dir=(process.argv[2]||'web/pkg').replace(/\/$/,'');
for(const file of [`${dir}/solar_explorer_bg.wasm`,`${dir}/solar_explorer.js`]){
 const bytes=await readFile(file),[br,gz]=await Promise.all([promisify(brotliCompress)(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:9}}),promisify(gzip)(bytes,{level:9})]);
 await writeFile(file+'.br',br);await writeFile(file+'.gz',gz);console.log(JSON.stringify({file,raw:bytes.length,brotli:br.length,gzip:gz.length}));
}

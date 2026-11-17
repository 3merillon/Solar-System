// Same views, two builds, exact comparison: whether a compile-time refactor changed any pixel. Each build is served on its
// own port; private headless browsers, one at a time; paused test clock and the same frame count for both.
//   node tools/Compare-Builds.mjs <baseUrl> <candidateUrl> [outDir] [--views=coast,forest,...] [--frames=150]
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const [base,candidate]=process.argv.slice(2,4);
const dir=process.argv.slice(4).find(a=>!a.startsWith('--'))||'evidence/local/compare-builds';await mkdir(dir,{recursive:true});
const views=(process.argv.find(a=>a.startsWith('--views='))||'--views=coast,forest,rocky,ground,clouds,horizon').slice(8).split(',');
const frames=+((process.argv.find(a=>a.startsWith('--frames='))||'--frames=150').slice(9));
const kinds=['display','shaded','water'];
async function shoot(url,label){
 const b=await headless(`${dir}/${label}`);const out={};
 try{
  for(const view of views){
   await b.send('Page.navigate',{url:`${url}/explorer.html?test=1&body=procedural&quality=ultra&view=${view}`});await ready(b);
   await b.evaluate('solarExplorer.resize(960,540)');await runFrames(b,frames);
   for(const kind of kinds){const path=`${dir}/${label}/${view}-${kind}.${kind==="display"?"png":"bin"}`;await capture(b,path,960,540,kind);out[`${view}-${kind}`]=path;}
  }
 }finally{await b.close();}
 return out;
}
const a=await shoot(base,'base'),c=await shoot(candidate,'candidate');
const report={base,candidate,frames,views:{}};let identical=true;
for(const key of Object.keys(a)){const x=await readFile(a[key]),y=await readFile(c[key]);const same=x.equals(y);report.views[key]={identical:same,bytes:[x.length,y.length]};if(!same)identical=false;console.log(key,same?'identical':'DIFFERENT');}
report.identical=identical;await writeFile(`${dir}/report.json`,JSON.stringify(report,null,1));console.log(JSON.stringify({identical}));

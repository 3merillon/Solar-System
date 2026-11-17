// Same world rays at the center of a wide viewport and edges of a narrow one.
// A screen-space fallback must not turn those rays into a dark frame.
import {headless} from './Headless.mjs';
import {ready,capture,runFrames} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]||'evidence/local/scenery-water-edges');await mkdir(dir,{recursive:true});const b=await headless(dir);
const report={cases:[],gates:[],manifest:JSON.parse((await readFile('web/pkg/explorer-manifest.json','utf8')).replace(/^\uFEFF/,''))};
const quantile=a=>{a.sort((x,y)=>x-y);return{n:a.length,mean:a.reduce((s,x)=>s+x,0)/Math.max(1,a.length),p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null};};
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:'http://127.0.0.1:5198/?test=1&body=procedural'});await ready(b);
 await b.evaluate('solarExplorer.resize(1920,1080);solarExplorer.engine.profiling(true);solarExplorer.configure({clouds:false,atmosphere:true,foam:1,caustics:true});solarExplorer.go("coast");window.c=solarExplorer.camera;window.n=c[0].map(x=>x/Math.hypot(...c[0]));window.t=c[1].map((x,j)=>x-c[0][j]);{const h=t.reduce((s,x,j)=>s+x*n[j],0);t=t.map((x,j)=>x-n[j]*h);const l=Math.hypot(...t);t=t.map(x=>x/l);}solarExplorer.time=4;');
 for(const [name,back,altitude,down,roll,time] of [['coastal',600,550,550,0,4],['low-water',80,25,550,0,4],['rolled-shore',400,140,100,-.35,19],['rolled-grazing',700,60,35,.4,41]]){
  await b.evaluate(`{const eye=c[0].map((x,j)=>x-t[j]*${back}+n[j]*${altitude}),d=t.map((x,j)=>x*1000-n[j]*${down}),l=Math.hypot(...d),v=d.map(x=>x/l),cross=[v[1]*n[2]-v[2]*n[1],v[2]*n[0]-v[0]*n[2],v[0]*n[1]-v[1]*n[0]],h=v.reduce((s,x,j)=>s+x*n[j],0),a=${roll};const up=n.map((x,j)=>x*Math.cos(a)+cross[j]*Math.sin(a)+v[j]*h*(1-Math.cos(a)));solarExplorer.camera=[eye,eye.map((x,j)=>x+d[j]),up];}solarExplorer.time=${time};solarExplorer.resize(1920,1080);`);await runFrames(b,360);
  const wide=await capture(b,resolve(dir,`${name}-wide.png`));const before=await runFrames(b,60);
  await b.evaluate('solarExplorer.resize(1280,1080)');await runFrames(b,120);const narrow=await capture(b,resolve(dir,`${name}-narrow.png`),1280,1080);
  const ocean=await capture(b,resolve(dir,`${name}-ocean.bin`),1280,1080,'ocean'),position=await capture(b,resolve(dir,`${name}-position.bin`),1280,1080,'position');
  const edge=[],middle=[];
  for(let y=0;y<1080;y++)for(let x=0;x<1280;x++){
   const i=y*1280+x,t=ocean.readFloatLE(i*8),p=[0,4,8].map(j=>position.readFloatLE(i*16+j));if(!(t>0&&t<Math.hypot(...p)))continue;
   const a=i*4,c=(y*1920+x+320)*4;const error=([0,1,2].reduce((s,j)=>s+Math.abs(narrow[a+j]-wide[c+j]),0))/3;(x<80||x>=1200||y>1000?edge:middle).push(error);
  }
  const row={name,edge:quantile(edge),middle:quantile(middle),timings:before,stats:await b.evaluate('solarExplorer.stats()'),snapshot:await b.evaluate('solarExplorer.snapshot()')};report.cases.push(row);report.gates.push({name:`${name}: viewport edge consistency`,pass:row.edge.n>1000&&row.edge.mean<2&&row.edge.p95<10,edge:row.edge});await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({name,edge:row.edge,middle:row.middle}));
 }
}finally{await b.close();}

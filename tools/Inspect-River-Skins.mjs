// Inspect river water from the side at the Wupper bookmark (owner's report, 5 Nov 2026: two water skins on a river,
// one standing above the other, and a water wall at the first LOD transition when seen from the side). Recorded
// fixture tiles, private headless browser. Captures the same river from several heights and headings.
//   node tools/Inspect-River-Skins.mjs [outDir] [--live]
import {tileServer,earthBrowser,settle,toEye,heading,headless,ready} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const dir=process.argv.slice(2).find(a=>!a.startsWith('--'))||'evidence/local/river-skins';await mkdir(dir,{recursive:true});
const live=process.argv.includes('--live');
const server=live?{base:process.env.BASE||'http://127.0.0.1:5198',close(){}}:await tileServer({});
let b;
if(live){
 // The app's own live sources (as the owner sees them): no tile proxy, the page's default budgets.
 b=await headless(dir);await b.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 // QUERY replaces the whole query (e.g. QUERY='test=1&view=wupper': the default page, solar mode, as the owner starts it).
 await b.send('Page.navigate',{url:`${server.base}/explorer.html?${process.env.QUERY||`test=1&body=earth&view=wupper&quality=high`}${process.env.EXTRA||''}`});await ready(b);await b.evaluate('solarExplorer.resize(1280,720)');
}else b=await earthBrowser(dir,server,{width:1280,height:720,view:'wupper',quality:'high'});
const report=[];
// CONFIG='{"cloud_diagnostic":65536}': renderer settings for diagnosis (water_diagnostic bits, docs/WATER-LAYER.md).
if(process.env.CONFIG)await b.evaluate(`solarExplorer.configure(${process.env.CONFIG})`);
try{
 const ground=async(lon,lat)=>b.evaluate(`solarExplorer.engine.surface_height?solarExplorer.engine.surface_height(${JSON.stringify(toEye(lon,lat,0))}):null`).catch(()=>null);
 const views=process.env.VIEWS?JSON.parse(process.env.VIEWS):[
  ['bookmark',7.1284,51.1396,350,270,-.35],
  ['side-120',7.1284,51.1396,250,270,-.25],
  ['side-60',7.1270,51.1396,170,270,-.12],
  ['side-40',7.1270,51.1396,150,270,-.06],
  ['north-60',7.1260,51.1380,170,0,-.12],
 ];
 for(const [name,lon,lat,alt,deg,pitch] of views){
  // A negative-free "rel" altitude (string "+15") stands that far above the ground under the camera, found by settling
  // first at 600 m: engine.height() is the ground the renderer reports under the eye.
  let height=alt;
  if(typeof alt==='string'){const up=toEye(lon,lat,600);await b.evaluate(`solarExplorer.camera=${JSON.stringify([up,up.map((v,i)=>v+heading(lon,lat,deg,-1)[i]*1000)])}`);await settle(b,{maxFrames:1200,quietFrames:30});const g=await b.evaluate('solarExplorer.engine.height()');height=g+Number(alt);console.log(name,'ground',g.toFixed(1));}
  const eye=toEye(lon,lat,height),f=heading(lon,lat,deg,pitch);
  await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((v,i)=>v+f[i]*1000)])}`);
  const s=await settle(b,{maxFrames:+(process.env.MAXFRAMES||(live?3000:1800)),quietFrames:live?90:40});
  await capture(b,`${dir}/${name}.png`,1280,720);
  // PROBE='[[x,y],..]': raw RGBA16F of the water pass target at those pixels (with the depth paint bit: mesh clearance,
  // field depth, bed path depth, each / 20 m).
  if(process.env.PROBE){const raw=await b.evaluate(`(async()=>{const d=await solarExplorer.capture('water');let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
   const buf=Buffer.from(raw,'base64'),w=1280,row=Math.ceil(w*8/256)*256,half=h=>{const s=h>>15,e=(h>>10)&31,m=h&1023;return (s?-1:1)*(e?2**(e-15)*(1+m/1024):2**-14*m/1024);};
   const at=([x,y])=>[0,1,2,3].map(c=>+(half(buf.readUInt16LE(y*row+x*8+c*2))*(c<3?20:1)).toFixed(2));
   const probes=JSON.parse(process.env.PROBE);console.log(name,JSON.stringify(probes.map(p=>[p,at(p)])));
   // The opaque surface at the same pixels: radial height above the datum (position target w).
   const pos=await b.evaluate(`(async()=>{const d=await solarExplorer.capture('position');let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
   const pb=Buffer.from(pos,'base64'),prow=Math.ceil(w*16/256)*256;
   console.log(name,'opaque',JSON.stringify(probes.map(([x,y])=>[x,y,[0,1,2,3].map(c=>+pb.readFloatLE(y*prow+x*16+c*4).toFixed(2))])));}
  const st=s.stats;report.push({name,lon,lat,alt,height,deg,pitch,frames:s.frames,ground:st.ground_height??null,water_layer:st.water_layer,lag:s.lag?{resident:s.lag.pages_resident,wanted:s.lag.pages_wanted}:null});
  console.log(name,s.frames,JSON.stringify(st.water_layer||{}).slice(0,160));
 }
}finally{await writeFile(dir+'/report.json',JSON.stringify(report,null,1));await b.close();await server.close?.();}

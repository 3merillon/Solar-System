// Decoder worker: runs tile decoding (pure PNG decoder for Terrarium, createImageBitmap for JPEG) and page building for the
// field worker's pool. It never fetches, never decides what is wanted and keeps no tile cache: a build job carries copies
// of the decoded tiles it needs (postMessage structured clone, no SharedArrayBuffer because the site has no COOP/COEP).
//   in:  {op:'init',manifest} | {op:'decode',id,kind,mime,bytes} | {op:'build',id,kind,overlayId,page,tiles:[{key,tile}],rivers,opts} | {op:'water',id,step,args}
//   out: {op:'decoded',id,tile} (tile buffers transferred) | {op:'built',id,result,ms} (result.bytes transferred) | {op:'watered',id,out,ms} (buffers transferred) | {op:'error',id,message}
import {resolveSources} from './sources.js';
import {decodePng,decodeTerrarium} from './png.js';
import {makeImageDecoder} from './image.js';
import {buildHeightPage,buildAlbedoPage,buildOverlayAlbedoPage} from './resample.js';
import {WATER_STEPS,stepTransfer} from './water-steps.js';

// post(message,transferList) answers the pool. Injectable so Node tests can run the same logic over a MessageChannel.
export function createDecoder({post,decodeImage=null,now=()=>performance.now()}){
 let cfg=null;
 const image=(bytes,mime)=>(decodeImage||(decodeImage=makeImageDecoder()))(bytes,mime);
 const sources=manifest=>cfg||(cfg=resolveSources(manifest));
 async function decode(m){
  const bytes=m.bytes instanceof Uint8Array?m.bytes:new Uint8Array(m.bytes);
  const tile=m.kind==='terrarium'?await decodeTerrarium(bytes):m.kind==='png'?await decodePng(bytes):await image(bytes,m.mime);
  const buf=tile.heights?.buffer||tile.rgba.buffer;
  post({op:'decoded',id:m.id,tile},[buf]);
 }
 // The water layer's page as it travels (water-layer.js): its texels and parameters; the float planes stay here.
 function stripWater(r){const w=r.waterPage;if(w===undefined)return;delete r.waterPage;if(!w)return;
  const {stats}=w;r.waterLayer={bytes:w.uniform?null:w.bytes.buffer,levelOffset:w.levelOffset,levelScale:w.levelScale,uniform:w.uniform,stats:{wet:stats.wet,shore:stats.shore,pieces:stats.pieces,unresolved:stats.unresolved,fallbackLevel:stats.fallbackLevel,overBudget:stats.overBudget,terrainLimited:stats.terrain?.terrainLimited??0}};}
 function build(m){
  const c=sources(null),tiles=new Map();
  for(const {key,tile} of m.tiles)tiles.set(key,tile);
  const get=(s,z,x,y)=>tiles.get(`${s.id}/${z}/${x}/${y}`);
  const t0=now();let r;
  if(m.kind==='height')r=buildHeightPage(m.page,get,c.height,m.rivers||[],m.opts||{});
  else if(m.kind==='overlay')r=buildOverlayAlbedoPage(m.page,get,c.albedo,c.overlays.find(o=>o.id===m.overlayId));
  else r=buildAlbedoPage(m.page,get,c.albedo);
  const ms=now()-t0;stripWater(r);
  post({op:'built',id:m.id,result:r,ms},[...(r.bytes?[r.bytes]:[]),...(r.water?[r.water.buffer]:[]),...(r.waterLayer?.bytes?[r.waterLayer.bytes]:[])]);
 }
 function water(m){
  const t0=now(),out=WATER_STEPS[m.step](m.args),ms=now()-t0;
  post({op:'watered',id:m.id,out,ms},stepTransfer(out));
 }
 return {
  async handle(m){
   try{
    if(m.op==='init'){cfg=null;if(m.manifest)cfg=resolveSources(m.manifest);else sources(null);return;}
    if(m.op==='decode')await decode(m);
    else if(m.op==='build')build(m);
    else if(m.op==='water')water(m);
   }catch(e){post({op:'error',id:m.id,message:String(e?.message||e)},[]);}
  },
 };
}

// Browser worker entry. Absent in Node, where tests drive createDecoder directly.
if(typeof WorkerGlobalScope!=='undefined'&&typeof self!=='undefined'&&self instanceof WorkerGlobalScope){
 const d=createDecoder({post:(m,t)=>self.postMessage(m,t)});
 self.onmessage=({data})=>{d.handle(data);};
}

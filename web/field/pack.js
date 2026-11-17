// Pinned pack loader: D0 to D3 of the whole planet (510 pages per channel) from crates/solar-bake.
// Fetches manifest.json, then level-0.bin .. level-3.bin in order, verifies each against its sha256,
// and emits every page in the field worker's page format, yielding between pages so the worker is never
// held for long. A failed level is reported and skipped: D0 first, and a missing level must not stop the planet.
//   level file: 'STPK', u32 count, then per page u8 face, u8 level, u32 x, u32 y, f32 offset, f32 scale,
//   u32 heightBytes, u32 albedoBytes (little endian, packed), the height PNG, the albedo JPEG.
const TEXELS=264,HEIGHT_BYTES=TEXELS*TEXELS*2,ALBEDO_BYTES=TEXELS*TEXELS*4,HEADER=26;
const hex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');

// MessageChannel yields without the 4 ms timer clamp; setTimeout where there is none. close() releases the port.
function makeYielder(){
 if(typeof MessageChannel==='undefined')return {yield:()=>new Promise(r=>setTimeout(r,0)),close(){}};
 const ch=new MessageChannel();let waiting=[];
 ch.port1.onmessage=()=>{const w=waiting;waiting=[];for(const f of w)f();};
 return {yield:()=>new Promise(r=>{waiting.push(r);ch.port2.postMessage(0);}),close(){ch.port1.close();ch.port2.close();}};
}

// Split one level file into page records without decoding anything.
export function parseLevel(buf){
 const dv=new DataView(buf);
 if(buf.byteLength<8||dv.getUint32(0,false)!==0x5354504b)throw Error('pack: bad magic');
 const count=dv.getUint32(4,true),pages=[];let at=8;
 for(let i=0;i<count;i++){
  if(at+HEADER>buf.byteLength)throw Error('pack: truncated page header');
  const hb=dv.getUint32(at+18,true),ab=dv.getUint32(at+22,true),body=at+HEADER;
  if(body+hb+ab>buf.byteLength)throw Error('pack: truncated page body');
  pages.push({face:dv.getUint8(at),level:dv.getUint8(at+1),x:dv.getUint32(at+2,true),y:dv.getUint32(at+6,true),
   offset:dv.getFloat32(at+10,true),scale:dv.getFloat32(at+14,true),
   height:new Uint8Array(buf,body,hb),albedo:new Uint8Array(buf,body+hb,ab)});
  at=body+hb+ab;
 }
 if(at!==buf.byteLength)throw Error('pack: trailing bytes');
 return pages;
}

// R and G of the decoded PNG carry the u16 high and low byte.
export function heightBytes(rgba,width,height){
 if(width!==TEXELS||height!==TEXELS)throw Error(`pack: height page is ${width}x${height}`);
 const u=new Uint16Array(TEXELS*TEXELS);
 for(let i=0;i<u.length;i++)u[i]=(rgba[i*4]<<8)|rgba[i*4+1];
 return u.buffer; // little endian on every browser and Node target
}
export function albedoBytes(rgba,width,height){
 if(width!==TEXELS||height!==TEXELS)throw Error(`pack: albedo page is ${width}x${height}`);
 const out=new Uint8Array(ALBEDO_BYTES);out.set(rgba.subarray(0,ALBEDO_BYTES));
 for(let i=3;i<ALBEDO_BYTES;i+=4)out[i]=255;
 return out.buffer;
}

// onPage receives {face,level,x,y,channel:'height'|'albedo',source:'pack',offset,scale,bytes:ArrayBuffer}; its result is awaited.
// Returns {pages,levels:{n:{ok,pages,bytes}},failures:[{level,page?,reason}]}. Never throws for data problems.
export async function loadPack(baseUrl,onPage,{fetch:fetchFn=globalThis.fetch?.bind(globalThis),decodePng,decodeJpeg,verify=true,onError=()=>{}}={}){
 const base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',report={pages:0,levels:{},failures:[]};
 const fail=(level,reason,page)=>{const f={level,reason:String(reason?.message||reason)};if(page)f.page=page;report.failures.push(f);try{onError(f);}catch{}};
 const get=async name=>{const r=await fetchFn(base+name);if(!r.ok)throw Error(`${name}: HTTP ${r.status}`);return r.arrayBuffer();};
 const y=makeYielder();
 try{
  let manifest;
  try{manifest=JSON.parse(new TextDecoder().decode(await get('manifest.json')));if(!/-v1$/.test(manifest.version||'')||manifest.page_texels!==TEXELS)throw Error('unsupported manifest');}
  catch(e){fail(-1,e);return report;}
  for(const level of manifest.levels||[0,1,2,3]){
   const entry=manifest.files?.[level],stat={ok:false,pages:0,bytes:0};report.levels[level]=stat;
   try{
    const buf=await get(`level-${level}.bin`);stat.bytes=buf.byteLength;
    if(entry&&entry.bytes!==buf.byteLength)throw Error(`level ${level}: ${buf.byteLength} bytes, manifest says ${entry.bytes}`);
    if(verify&&entry?.sha256){
     const sum=hex(await crypto.subtle.digest('SHA-256',buf));
     if(sum!==entry.sha256)throw Error(`level ${level}: sha256 mismatch`);
    }
    for(const p of parseLevel(buf)){
     await y.yield();
     const id={face:p.face,level:p.level,x:p.x,y:p.y};
     try{
      const h=await decodePng(p.height);
      const hb=heightBytes(h.rgba,h.width,h.height);
      const a=await decodeJpeg(p.albedo,'image/jpeg');
      const ab=albedoBytes(a.rgba,a.width,a.height);
      await onPage({...id,channel:'height',source:'pack',offset:p.offset,scale:p.scale,bytes:hb});
      await onPage({...id,channel:'albedo',source:'pack',offset:0,scale:1,bytes:ab});
      stat.pages++;report.pages++;
     }catch(e){fail(level,e,id);}
    }
    stat.ok=stat.pages>0;
   }catch(e){fail(level,e);}
  }
 }finally{y.close();}
 return report;
}
export {HEIGHT_BYTES,ALBEDO_BYTES};

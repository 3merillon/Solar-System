// Pure PNG decoder. Exists so Terrarium heights are never altered by browser colour management
// or alpha premultiplication: gAMA, iCCP, sRGB, cHRM are ignored on purpose, bytes pass through.
// 8-bit colour types 2 (RGB), 3 (palette), 6 (RGBA) only; anything else is rejected with a clear error.
const SIGNATURE=[137,80,78,71,13,10,26,10];
async function inflate(bytes){
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),parts=[];let n=0;
 for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);n+=value.length;}
 const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;
}
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
// Un-filter in place. raw holds height rows of (1 + stride) bytes; the result is written compactly to a new array.
function unfilter(raw,width,height,bpp){
 const stride=width*bpp,out=new Uint8Array(stride*height);
 for(let y=0;y<height;y++){
  const f=raw[y*(stride+1)],src=y*(stride+1)+1,dst=y*stride,up=dst-stride;
  for(let x=0;x<stride;x++){
   const v=raw[src+x],a=x>=bpp?out[dst+x-bpp]:0,b=y>0?out[up+x]:0,c=x>=bpp&&y>0?out[up+x-bpp]:0;
   let r;
   switch(f){case 0:r=v;break;case 1:r=v+a;break;case 2:r=v+b;break;case 3:r=v+((a+b)>>1);break;case 4:r=v+paeth(a,b,c);break;default:throw Error(`PNG: unknown filter type ${f} on row ${y}`);}
   out[dst+x]=r&255;
  }
 }
 return out;
}
// bytes: Uint8Array or ArrayBuffer. Returns {width,height,rgba:Uint8Array} (straight alpha, 255 when the file has none).
export async function decodePng(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 for(let i=0;i<8;i++)if(b[i]!==SIGNATURE[i])throw Error('PNG: bad signature');
 const dv=new DataView(b.buffer,b.byteOffset,b.byteLength),idat=[],pos={o:8};
 let ihdr=null,palette=null,trns=null,idatBytes=0;
 while(pos.o+8<=b.length){
  const len=dv.getUint32(pos.o),type=String.fromCharCode(b[pos.o+4],b[pos.o+5],b[pos.o+6],b[pos.o+7]),start=pos.o+8;
  if(start+len>b.length)throw Error(`PNG: truncated ${type} chunk`);
  const data=b.subarray(start,start+len);
  if(type==='IHDR')ihdr={width:dv.getUint32(start),height:dv.getUint32(start+4),depth:b[start+8],color:b[start+9],compression:b[start+10],filter:b[start+11],interlace:b[start+12]};
  else if(type==='PLTE')palette=data;
  else if(type==='tRNS')trns=data;
  else if(type==='IDAT'){idat.push(data);idatBytes+=len;}
  else if(type==='IEND')break;
  pos.o=start+len+4;
 }
 if(!ihdr)throw Error('PNG: missing IHDR');
 const {width,height,depth,color,interlace}=ihdr;
 if(depth!==8)throw Error(`PNG: unsupported bit depth ${depth} (only 8)`);
 if(color!==2&&color!==3&&color!==6)throw Error(`PNG: unsupported colour type ${color} (only 2 RGB, 3 palette, 6 RGBA)`);
 if(interlace!==0)throw Error('PNG: interlaced images are not supported');
 if(ihdr.compression!==0||ihdr.filter!==0)throw Error('PNG: unknown compression or filter method');
 if(color===3&&!palette)throw Error('PNG: palette image without PLTE');
 if(!idat.length)throw Error('PNG: missing IDAT');
 const joined=new Uint8Array(idatBytes);let o=0;for(const p of idat){joined.set(p,o);o+=p.length;}
 const bpp=color===2?3:color===6?4:1,raw=await inflate(joined);
 if(raw.length<(width*bpp+1)*height)throw Error('PNG: image data too short');
 const px=unfilter(raw,width,height,bpp),rgba=new Uint8Array(width*height*4),n=width*height;
 if(color===6)rgba.set(px);
 else if(color===2)for(let i=0;i<n;i++){rgba[i*4]=px[i*3];rgba[i*4+1]=px[i*3+1];rgba[i*4+2]=px[i*3+2];rgba[i*4+3]=255;}
 else for(let i=0;i<n;i++){
  const k=px[i];if(k*3+2>=palette.length)throw Error('PNG: palette index out of range');
  rgba[i*4]=palette[k*3];rgba[i*4+1]=palette[k*3+1];rgba[i*4+2]=palette[k*3+2];rgba[i*4+3]=trns&&k<trns.length?trns[k]:255;
 }
 return {width,height,rgba};
}
// Terrarium: (R*256 + G + B/256) - 32768 metres. Exact in float32 (24 significant bits).
export const terrariumHeight=(r,g,b)=>r*256+g+b/256-32768;
export function terrariumHeights(rgba,width,height){
 const h=new Float32Array(width*height);
 for(let i=0;i<h.length;i++)h[i]=rgba[i*4]*256+rgba[i*4+1]+rgba[i*4+2]/256-32768;
 return h;
}
export async function decodeTerrarium(bytes){
 const {width,height,rgba}=await decodePng(bytes);
 return {width,height,heights:terrariumHeights(rgba,width,height)};
}

// JPEG/PNG imagery decoding for a worker. The browser decoder is injectable so Node tests can stub it.
// Colour conversion and premultiplication are switched off so bytes stay what the server sent
// (imagery is opaque; Terrarium never comes through here, see png.js).
export function makeImageDecoder(env={}){
 const cib=env.createImageBitmap||globalThis.createImageBitmap,OC=env.OffscreenCanvas||globalThis.OffscreenCanvas;
 // bytes: ArrayBuffer or Uint8Array; type: MIME type. Returns {width,height,rgba:Uint8Array}.
 return async function decodeImage(bytes,type='image/jpeg'){
  if(!cib||!OC)throw Error('image decoding needs createImageBitmap and OffscreenCanvas');
  const bitmap=await cib(new Blob([bytes],{type}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  try{
   const canvas=new OC(bitmap.width,bitmap.height),g=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
   g.drawImage(bitmap,0,0);
   const d=g.getImageData(0,0,bitmap.width,bitmap.height,{colorSpace:'srgb'});
   return {width:bitmap.width,height:bitmap.height,rgba:new Uint8Array(d.data.buffer,d.data.byteOffset,d.data.byteLength)};
  }finally{bitmap.close?.();}
 };
}

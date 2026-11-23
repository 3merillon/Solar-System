// The normal field worker fetches this district as a vector tile. Keep it in
// sight while flying outside the tile request window and through its ceiling.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {earthBrowser,tileServer,toEye} from './Earth-Test-Lib.mjs';
import {capture,runFrames} from './Explorer-Test-Lib.mjs';
import {tilePointToLonLat} from '../web/field/vector-tile.js';

const dir=process.argv[2]||'evidence/local/city-departure';
const fixture=join(dir,'fixture'),host='tiles.openfreemap.org',x=8802,y=5373;
const W=640,H=360;
const varint=n=>{const out=[];while(n>=128){out.push((n&127)|128);n=Math.floor(n/128);}return [...out,n];};
const number=(tag,n)=>[tag*8,...varint(n)];
const field=(tag,bytes)=>[tag*8+2,...varint(bytes.length),...bytes];
const string=(tag,s)=>field(tag,Buffer.from(s));
const features=[];
for(let row=0;row<8;row++)for(let col=0;col<8;col++){
 const px=600+col*390,py=600+row*390;
 const ring=[9,...varint(2*px),...varint(2*py),26,...varint(360),0,0,...varint(360),...varint(359),0,15];
 features.push(...field(2,[...number(1,1000+row*8+col),...field(2,[0,0]),...number(3,3),...field(4,ring)]));
}
const tile=Buffer.from(field(3,[...string(1,'building'),...features,...string(3,'height'),...field(4,number(4,120)),...number(5,4096),...number(15,2)]));
async function put(path,body,contentType){
 const hash=createHash('sha256').update(path).digest('hex'),folder=join(fixture,host,hash.slice(0,2));
 await mkdir(folder,{recursive:true});await writeFile(join(folder,hash+'.bin'),body);
 await writeFile(join(folder,hash+'.json'),JSON.stringify({status:200,contentType}));
}
await put('/planet',Buffer.from(JSON.stringify({tiles:['https://'+host+'/city/{z}/{x}/{y}']})),'application/json');
await put('/city/14/'+x+'/'+y,tile,'application/x-protobuf');
const server=await tileServer({port:5287,dir:fixture});let b;
try{
 b=await earthBrowser(dir,server,{width:W,height:H});
 await b.evaluate('solarExplorer.configure({clouds:false,water:false,trees:false,rocks:false,ground_cover:false,shadows:false,buildings:true})');
 const ground=tilePointToLonLat(14,x,y,4096,[2048,2048]),at=toEye(...ground,160);
 const samples=[];
 for(const [name,dx,alt] of [['hover',0,1700],['depart',3.5,2000],['climb',3.5,18100],['orbit',3.5,1000000]]){
  const loc=tilePointToLonLat(14,x,y,4096,[(.5+dx)*4096,2048]),eye=toEye(...loc,alt);
  const up=dx?eye.map(v=>v/Math.hypot(...eye)):[0,1,0];
  await b.evaluate('solarExplorer.camera='+JSON.stringify([eye,at,up]));
  await runFrames(b,120);
  // Eye updates are wall-clock throttled in the render worker.
  for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,550));await runFrames(b,12);}
  const stats=await b.evaluate('solarExplorer.stats()'),normals=await capture(b,join(dir,name+'.bin'),W,H,'normal');
  let pixels=0;for(let k=6;k<normals.length;k+=8)if(normals.readUInt16LE(k)===0xd680)pixels++;
  samples.push({name,sources:stats.buildings.sources,pixels});console.log(samples.at(-1));
 }
 await writeFile(join(dir,'report.json'),JSON.stringify(samples,null,2));
 assert.equal(samples[0].sources,64,'fixture loads through the field worker');assert.ok(samples[0].pixels>300);
 for(const s of samples.slice(1,3)){assert.equal(s.sources,64,s.name+' discards the city');assert.ok(s.pixels>75,s.name+' loses the skyline');}
 assert.equal(samples.at(-1).sources,0,'subpixel buildings retire');
}finally{try{await b?.close();}finally{server.close();}}

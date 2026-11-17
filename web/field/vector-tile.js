// Small bounded MVT 2.1 reader. Decodes source geometry only; rendering lives on the GPU.
// Spec: https://github.com/mapbox/vector-tile-spec/blob/master/2.1/README.md
const utf8=new TextDecoder('utf-8',{fatal:true});
class Reader {
 constructor(bytes){this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.at=0;}
 need(n){if(n<0||this.at+n>this.bytes.length)throw Error('Truncated vector tile');}
 varint(big=false){let v=0n;for(let n=0;n<10;n++){this.need(1);const b=this.bytes[this.at++];v|=BigInt(b&127)<<BigInt(n*7);if(!(b&128)){if(big)return v.toString();const x=Number(v);if(!Number.isSafeInteger(x))throw Error('Unsafe vector integer');return x;}}throw Error('Invalid vector varint');}
 block(){const size=this.varint();this.need(size);const r=new Reader(this.bytes.subarray(this.at,this.at+size));this.at+=size;return r;}
 string(){const r=this.block();return utf8.decode(r.bytes);}
 skip(wire){if(wire===0)this.varint(true);else if(wire===1){this.need(8);this.at+=8;}else if(wire===2)this.block();else if(wire===5){this.need(4);this.at+=4;}else throw Error('Invalid vector wire type');}
 float(n){this.need(n);const v=n===4?this.view.getFloat32(this.at,true):this.view.getFloat64(this.at,true);this.at+=n;return v;}
}
const zigzag=n=>n%2?-(n+1)/2:n/2;
function value(r){let out=null;while(r.at<r.bytes.length){const tag=r.varint(),field=Math.floor(tag/8),wire=tag%8;if(field===1&&wire===2)out=r.string();else if(field===2&&wire===5)out=r.float(4);else if(field===3&&wire===1)out=r.float(8);else if(field===4&&wire===0){const s=r.varint(true),n=BigInt(s);out=Number(BigInt.asIntN(64,n));}else if(field===5&&wire===0)out=r.varint();else if(field===6&&wire===0)out=zigzag(r.varint());else if(field===7&&wire===0)out=!!r.varint();else r.skip(wire);}return out;}
function geometry(r,type,budget){
 let x=0,y=0,path=null;const paths=[];
 while(r.at<r.bytes.length){const code=r.varint(),command=code%8,count=Math.floor(code/8);if(!count)throw Error('Empty vector command');
  if(command===7){if(type!==3||count!==1||!path?.length)throw Error('Invalid polygon closure');path.closed=true;continue;}
  if(command!==1&&command!==2)throw Error('Unknown vector geometry command');
  if(count>budget.left)throw Error('Vector vertex budget exceeded');budget.left-=count;
  for(let i=0;i<count;i++){
   x+=zigzag(r.varint());y+=zigzag(r.varint());if(Math.abs(x)>2**26||Math.abs(y)>2**26)throw Error('Vector coordinate out of range');
   if(command===1){path=[];paths.push(path);}else if(!path)throw Error('LineTo before MoveTo');path.push([x,y]);
  }
 }
 if(type===3&&paths.some(p=>!p.closed||p.length<3))throw Error('Unclosed vector polygon');return paths;
}
function feature(r,keys,values,extent,budget){
 let id=null,type=0,geom=null;const tags=[];
 while(r.at<r.bytes.length){const tag=r.varint(),field=Math.floor(tag/8),wire=tag%8;
  if(field===1&&wire===0)id=r.varint(true);
  else if(field===2&&wire===2){const p=r.block();while(p.at<p.bytes.length)tags.push(p.varint());}
  else if(field===3&&wire===0)type=r.varint();else if(field===4&&wire===2)geom=r.block();else r.skip(wire);
 }
 if(tags.length%2)throw Error('Odd vector property list');const properties=Object.create(null);
 for(let i=0;i<tags.length;i+=2){if(tags[i]>=keys.length||tags[i+1]>=values.length)throw Error('Invalid vector property index');properties[keys[tags[i]]]=values[tags[i+1]];}
 if(!geom||type<1||type>3)return null;return {id,type,extent,properties,paths:geometry(geom,type,budget)};
}
function layer(r,wanted,budget){
 let name='',extent=4096,version=1;const keys=[],values=[],features=[];
 while(r.at<r.bytes.length){const tag=r.varint(),field=Math.floor(tag/8),wire=tag%8;
  if(field===1&&wire===2)name=r.string();else if(field===2&&wire===2){if(features.length>=32768)throw Error('Vector feature budget exceeded');features.push(r.block());}
  else if(field===3&&wire===2)keys.push(r.string());else if(field===4&&wire===2)values.push(value(r.block()));
  else if(field===5&&wire===0)extent=r.varint();else if(field===15&&wire===0)version=r.varint();else r.skip(wire);
 }
 if(!wanted.has(name))return null;if(version!==1&&version!==2)throw Error('Unsupported vector tile version');if(extent<1||extent>2**20)throw Error('Invalid vector extent');
 return {name,extent,features:features.map(r=>feature(r,keys,values,extent,budget)).filter(Boolean)};
}
export function decodeVectorTile(buffer,names=['building','water','waterway']){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(bytes.length>16*1024*1024)throw Error('Vector tile byte budget exceeded');
 const r=new Reader(bytes),out=Object.create(null),wanted=new Set(names),budget={left:262144};
 while(r.at<bytes.length){const tag=r.varint(),field=Math.floor(tag/8),wire=tag%8;if(field===3&&wire===2){const l=layer(r.block(),wanted,budget);if(l)out[l.name]=l;}else r.skip(wire);}
 return out;
}
export function tilePointToLonLat(z,x,y,extent,point){const n=2**z,X=(x+point[0]/extent)/n,Y=(y+point[1]/extent)/n;return [X*360-180,Math.atan(Math.sinh(Math.PI*(1-2*Y)))*180/Math.PI];}

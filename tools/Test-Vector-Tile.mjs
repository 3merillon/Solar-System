import assert from 'node:assert/strict';
import {decodeVectorTile,tilePointToLonLat} from '../web/field/vector-tile.js';
// MVT wire fixtures include unknown fields, a 64-bit identity, negative deltas,
// multipolygons/holes, and broken inputs. No network required.
const cat=(...a)=>a.flat(Infinity),v=n=>{n=BigInt(n);const a=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;a.push(b);}while(n);return a;};
const bytes=(tag,p)=>cat(v(tag*8+2),v(p.length),p),num=(tag,n)=>cat(v(tag*8),v(n)),str=(tag,s)=>bytes(tag,[...new TextEncoder().encode(s)]);
const zig=n=>n<0?-2*n-1:2*n;
function commands(rings){let x=0,y=0;const out=[];for(const ring of rings){out.push(9,...v(zig(ring[0][0]-x)),...v(zig(ring[0][1]-y)));[x,y]=ring[0];out.push(...v((ring.length-1)*8+2));for(const p of ring.slice(1)){out.push(...v(zig(p[0]-x)),...v(zig(p[1]-y)));[x,y]=p;}out.push(15);}return out;}
const rings=[[[0,0],[200,0],[200,200],[0,200]],[[50,50],[50,150],[150,150],[150,50]]];
const feature=cat(num(1,9007199254740997n),bytes(2,[0,0,1,1]),num(3,3),bytes(4,commands(rings)));
const layer=cat(str(1,'building'),bytes(2,feature),str(3,'render_height'),str(3,'__proto__'),bytes(4,num(5,24)),bytes(4,str(1,'safe')),num(5,4096),num(15,2));
const tile=Uint8Array.from(cat(bytes(3,layer),num(10,7)));
const decoded=decodeVectorTile(tile).building;
assert.equal(decoded.features[0].id,'9007199254740997');
assert.equal(decoded.features[0].properties.render_height,24);
assert.equal(Object.getPrototypeOf(decoded.features[0].properties),null);
assert.equal(decoded.features[0].properties.__proto__,'safe');
assert.deepEqual(decoded.features[0].paths.map(p=>Array.from(p)),rings);
assert.ok(decoded.features[0].paths.every(p=>p.closed));
assert.deepEqual(tilePointToLonLat(1,1,1,4096,[0,0]),[0,0]);
assert.equal(Object.keys(decodeVectorTile(tile,['water'])).length,0);
assert.throws(()=>decodeVectorTile(tile.subarray(0,tile.length-4)),/Truncated/);
assert.throws(()=>decodeVectorTile(Uint8Array.from([0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff])),/Invalid/);
const broken=Uint8Array.from(bytes(3,cat(str(1,'building'),bytes(2,cat(num(3,3),bytes(4,[10,2,2]))),num(15,2))));
assert.throws(()=>decodeVectorTile(broken),/LineTo/);
console.log('MVT: identity, rings/holes, properties, bounds, unknown fields and malformed input passed');

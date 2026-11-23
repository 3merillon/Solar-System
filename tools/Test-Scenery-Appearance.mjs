// A real render of a controlled footprint. Read its wall colour and coverage
// from two settled frames, and measure the transition after source publication.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildingSources} from '../web/field/buildings.js';
import {earthBrowser,tileServer} from './Earth-Test-Lib.mjs';
import {runFrames,capture} from './Explorer-Test-Lib.mjs';

const dir=process.argv[2]||'evidence/local/scenery-appearance';
await mkdir(dir,{recursive:true});
const W=800,H=450;
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const add=(a,b,scale)=>a.map((x,i)=>x+scale*b[i]);
const half=n=>(n&32768?-1:1)*((n>>10&31)===0?(n&1023)*2**-24:(1+(n&1023)/1024)*2**((n>>10&31)-15));
const server=await tileServer({port:5267});
let b;
try{
 b=await earthBrowser(dir,server,{width:W,height:H,quality:'high'});
 const path=Object.assign([[2000,2000],[2040,2000],[2040,2022],[2000,2022]],{closed:true});
 const tile={z:14,x:8802,y:5373,layers:{building:{extent:4096,features:[{id:37,properties:{height:3.5,'building:colour':'#ddddcc'},paths:[path]}]}}};
 const data=buildingSources([tile]);const f=new Float32Array(data.records);
 const points=new Float32Array(data.points),flags=new Uint32Array(data.points);
 const edge=[0,1,2,3].find(i=>flags[4*i+3]===2);assert.ok(edge!==undefined);
 const next=flags[4*edge+2],a=[points[4*edge],points[4*edge+1]],z=[points[4*next],points[4*next+1]];
 const anchor=[0,1,2].map(i=>f[i]+f[i+4]),rad=Math.hypot(...anchor),up=anchor.map(v=>v/rad);
 const east=[...f.slice(8,11)],north=[...f.slice(12,15)];
 const local=(x,y)=>east.map((v,i)=>v*x+north[i]*y);
 const mid=local((a[0]+z[0])/2,(a[1]+z[1])/2),out=mid.map(v=>v/Math.hypot(...mid));
 const delta=local(z[0]-a[0],z[1]-a[1]),length=Math.hypot(...delta),tangent=delta.map(v=>v/length);
 const bays=Math.max(1,Math.floor((length-.8)/3.2));
 const doorwayX=((Math.floor(bays/2)+.5)/bays-.5)*length;
 const wall=add(anchor,mid,1);
 const sun=add(up,out,.7);
 await b.evaluate('solarExplorer.configure('+JSON.stringify({clouds:false,water:false,trees:false,rocks:false,ground_cover:false,shadows:false,buildings:true,sun:sun.map(x=>x/Math.hypot(...sun))})+')');
 const eyeAt=h=>add(add(wall,out,20),up,h+3.0);
 const watch=async h=>b.evaluate('solarExplorer.camera='+JSON.stringify([eyeAt(h),add(wall,up,h+1.65),up]));
 await watch(110);await runFrames(b,100);
 const h=await b.evaluate('solarExplorer.engine.height(...'+JSON.stringify(up)+')');
 await watch(h);await runFrames(b,50);
 const publish=(batch=data)=>b.evaluate('solarExplorer.engine.building_sources(new Uint8Array('+JSON.stringify([...new Uint8Array(batch.records)])+'),new Uint8Array('+JSON.stringify([...new Uint8Array(batch.points)])+'))');
 await publish();
 const masks=[];
 for(const [label,frames] of [['arrival',3],['mid',10],['settled',100],['stopped',3]]){
  await runFrames(b,frames);
  const normal=await capture(b,join(dir,label+'-normal.bin'),W,H,'normal');
  const mask=Buffer.alloc(W*H);
  for(let i=0;i<mask.length;i++)mask[i]=Number(half(normal.readUInt16LE(i*8+6))===-104);
  masks.push(mask);
 }
 const counts=masks.map(mask=>mask.reduce((n,p)=>n+p,0));
 assert.ok(counts[0]>0&&counts[0]<counts[1]&&counts[1]<counts[2],JSON.stringify(counts));
 assert.ok(masks[2].equals(masks[3]),'settled building has a changing coverage mask');
 // A neighbouring tile arrives before our tile in the priority list, then leaves.
 // Its footprint is outside the camera, so every pixel of the facade must survive both updates.
 const neighbour={...tile,x:tile.x+1};
 for(const [label,batch] of [['prepend',buildingSources([neighbour,tile])],['remove',data]]){
  await publish(batch);await runFrames(b,1);
  const normal=await capture(b,join(dir,label+'.bin'),W,H,'normal');
  const coverage=masks[2].reduce((sum,p,i)=>sum+Number(p&&half(normal.readUInt16LE(i*8+6))===-104),0);
  assert.equal(coverage,counts[2],label+' restarted the retained building fade');
 }
 const image=await capture(b,join(dir,'street.png'),W,H);
 const positions=await capture(b,join(dir,'positions.bin'),W,H,'position');
 const origin=await b.evaluate('solarExplorer.camera[0]');
 const samples=[];
 for(let i=0;i<W*H;i++){
  if(!masks[2][i])continue;
  const v=[0,1,2].map(j=>origin[j]+positions.readFloatLE(i*16+4*j)-wall[j]);
  if(Math.abs(dot(v,out))>.15)continue;
  samples.push([dot(v,tangent)-doorwayX,dot(v,up),image[i*4]+image[i*4+1]+image[i*4+2]]);
 }
 assert.ok(samples.length>1000,'front wall must be in view');
 const top=samples.reduce((m,s)=>Math.max(m,s[1]),-Infinity),ground=top-3.5;
 const luminance=(x,y)=>{const area=samples.filter(s=>Math.abs(s[0]-x)<.13&&Math.abs(s[1]-ground-y)<.12);assert.ok(area.length>=4,'missing facade sample '+[x,y,area.length]);return area.reduce((n,s)=>n+s[2],0)/area.length;};
 const door=luminance(0,1.45),surround=luminance(.83,1.45),aboveDoor=luminance(0,2.48),window=luminance(-length/bays,1.45);
 assert.ok(door<surround*.8&&window<surround*.8&&aboveDoor>surround*.85,JSON.stringify({door,surround,aboveDoor,window}));
 const cornerEye=add(add(add(wall,out,10),tangent,length*.72),up,h+4.8);
 await b.evaluate('solarExplorer.camera='+JSON.stringify([cornerEye,add(wall,up,h+1.65),up]));
 await runFrames(b,20);await capture(b,join(dir,'street-corner.png'),W,H);
 // Both objects occupy the same tile and are viewed from the same distance.
 // At 4.2 km the small ground-floor building nearly vanishes, while an
 // 80 m tower still spans several pixels beyond the former 3 km cutoff.
 const farEye=add(add(wall,out,4200),up,h+850);
 await b.evaluate('solarExplorer.camera='+JSON.stringify([farEye,add(wall,up,h+20),up]));
 async function silhouette(label){
  await runFrames(b,90);
  const n=await capture(b,join(dir,label+'.bin'),W,H,'normal');
  let count=0;for(let i=6;i<n.length;i+=8)if(half(n.readUInt16LE(i))===-104)count++;
  return count;
 }
 const housePixels=await silhouette('far-house');f[3]=80;await publish();
 const towerPixels=await silhouette('far-tower');
 assert.ok(towerPixels>=8&&towerPixels>housePixels*3,JSON.stringify({housePixels,towerPixels}));
 await writeFile(join(dir,'report.json'),JSON.stringify({counts,door,surround,aboveDoor,window,housePixels,towerPixels},null,2));
 console.log('Building fade settled and the door bay has solid wall beside and above its entrance.',counts);
}finally{try{await b?.close();}finally{server.close();}}

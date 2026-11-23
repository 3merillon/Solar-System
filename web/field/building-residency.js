// Keep drawable footprints independently of the z14 fetch window. The copy
// retained by the field worker contains at most one GPU budget of buildings.
import {BUILDING_LIMIT,POINT_LIMIT} from './buildings.js';
import {ROAD_LIMIT} from './roads.js';

const R=6371000, STRIDE=28, TILE_STRIDE=131072;
export function packedSources(data){
 return {floats:new Float32Array(data.records),words:new Uint32Array(data.records),points:new Uint32Array(data.points),stats:data.stats};
}

export function createBuildingResidency(){
 let previous=null,incumbents=new Set();
 function update(tiles,eye,pixelHeight,sameTiles,view){
  const radius=eye?Math.hypot(...eye):0,alt=radius-R;
  const surface=radius?eye.map(v=>v*R/radius):[0,0,0];
  const focal=pixelHeight/(2*Math.tan(Math.PI/6));
  const candidates=[],loaded=new Set();
  const stats={buildings:0,points:0,retainedBuildings:0,overBudget:0,complex:0,hidden:0,estimatedHeights:0,roads:0,roadOverflow:0,roadWidthsEstimated:0};
  let pointCount=0;
  function consider(batch,index,id,retained){
   const f=batch.floats,k=index*STRIDE,n=batch.words[k+21];
   const size=Math.max(f[k+18]-f[k+16],f[k+19]-f[k+17],f[k+3]-f[k+7]);
   const dx=surface[0]-(f[k]+f[k+4]),dy=surface[1]-(f[k+1]+f[k+5]),dz=surface[2]-(f[k+2]+f[k+6]);
   // No terrain readback in the field worker. Bound relief conservatively so
   // a mountain town also gets to finish the GPU's projected-size fade.
   const vertical=Math.max(0,alt-9000-f[k+3],-500-alt);
   const d2=(dx*dx+dy*dy+dz*dz)*radius/R+vertical*vertical;
   const importance=size*size/Math.max(1,d2);
   if(retained&&(!eye||importance*focal*focal<.25*.25))return;
   candidates.push({batch,index,id,n,score:importance,visible:false,retained});pointCount+=n;
  }
  for(const t of tiles){
   const batch=t.packed,base=(t.y*16384+t.x)*TILE_STRIDE;
   loaded.add(base);
   for(const stat of ['overBudget','complex','hidden','estimatedHeights'])stats[stat]+=batch.stats[stat];
   for(let i=0;i<batch.stats.buildings;i++)consider(batch,i,base+i,false);
  }
  if(previous&&eye)for(let i=0;i<previous.ids.length;i++){
   const id=previous.ids[i];if(!loaded.has(id-id%TILE_STRIDE))consider(previous,i,id,true);
  }
  // Only sort on exhaustion. Admission is per footprint so a change in tile
  // priority cannot exchange a whole neighbourhood at the capacity boundary.
  if(candidates.length>BUILDING_LIMIT||pointCount>POINT_LIMIT){
   for(const c of candidates){
    if(incumbents.has(c.id))c.score*=1.5;
    if(!view)continue;
    const f=c.batch.floats,k=c.index*STRIDE;
    const lift=1+((view.ground??0)+.5*(f[k+3]+f[k+7]))/R;
    const dx=(f[k]+f[k+4])*lift-eye[0],dy=(f[k+1]+f[k+5])*lift-eye[1],dz=(f[k+2]+f[k+6])*lift-eye[2];
    const cosine=(dx*view.x+dy*view.y+dz*view.z)/Math.max(1,Math.hypot(dx,dy,dz));
    // A guard band outside the viewport and a gradual reduction behind it
    // give a visible skyline priority without unloading it on a small turn.
    const inView=Math.min(1,Math.max(0,(cosine-view.edge+.25)/.25));
    c.visible=inView>=.5&&c.score*focal*focal>=.38*.38;
    c.score*=.12+.88*inView;
   }
   candidates.sort((a,b)=>Number(b.visible)-Number(a.visible)||b.score-a.score||a.id-b.id);
  }
  const chosen=[];pointCount=0;
  for(const c of candidates){
   if(chosen.length===BUILDING_LIMIT||pointCount+c.n>POINT_LIMIT){stats.overBudget++;continue;}
   chosen.push(c);pointCount+=c.n;if(c.retained)stats.retainedBuildings++;
  }
  stats.buildings=chosen.length;
  // Only the camera moved. If the same residents still fit, the GPU already
  // owns their geometry (and the same remaining capacity for local roads).
  if(sameTiles&&chosen.length===incumbents.size&&chosen.every(c=>incumbents.has(c.id)))return null;
  const buildingPoints=pointCount,roads=[];
  for(const t of tiles){
   if(t.outer)continue;
   const b=t.packed;
   const room=Math.min(ROAD_LIMIT-roads.length,BUILDING_LIMIT-chosen.length-roads.length,Math.floor((POINT_LIMIT-pointCount)/2));
   const count=Math.min(room,b.stats.roads);
   stats.roadOverflow+=b.stats.roadOverflow+b.stats.roads-count;
   stats.roadWidthsEstimated+=b.stats.roadWidthsEstimated;
   for(let j=0;j<count;j++)roads.push({batch:b,index:b.stats.buildings+j,n:2});
   pointCount+=2*count;
  }
  stats.roads=roads.length;stats.points=pointCount;
  const records=new Uint32Array((chosen.length+roads.length)*STRIDE),points=new Uint32Array(4*pointCount);
  let row=0,start=0;
  function copy({batch,index,n}){
   const k=index*STRIDE,old=batch.words[k+20];
   records.set(batch.words.subarray(k,k+STRIDE),row*STRIDE);records[row*STRIDE+20]=start;
   points.set(batch.points.subarray(old*4,(old+n)*4),start*4);
   for(let i=start;i<start+n;i++)points[4*i+2]=start+(points[4*i+2]-old);
   row++;start+=n;
  }
  chosen.forEach(copy);
  const words=records.slice(0,chosen.length*STRIDE),ids=Float64Array.from(chosen,c=>c.id);
  previous={ids,words,floats:new Float32Array(words.buffer),points:points.slice(0,buildingPoints*4)};
  incumbents=new Set(ids);
  roads.forEach(copy);
  return {records:records.buffer,points:points.buffer,stats};
 }
 return {update};
}

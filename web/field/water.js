// Water in the height field, written into a height tile once, before any page reads it. Each tile gets
// tile.water: per pixel the level of the water there, NO_WATER where there is none, or null when the tile has
// no water at all. Heights keep the bed, so mesh, shading and the f64 reader all see the same floor.
// The sea comes from seabed.js.
//
// Lakes: Terrain Tiles flatten water to one exact value (Lake Geneva reads 371.000 across whole tiles, with
// tens of thousands of equal pixels, where land beside it has almost no repeats). Flat land exists too, so a
// flat region counts as a lake only if it lies in a basin and the imagery over it looks like water. This is a
// heuristic: docs/M1-LIVE-EARTH.md lists what it finds and misses. Narrow rivers are not flat in this data, and
// muddy water fails the colour test; both wait for vector data (M5).
//
// The DEM has no lake depth, so the bed is synthesized: it falls away from the shore to a plateau with a slow
// undulation. Levels are measured; lake beds are not.
import {fillSeabed,liftDryLand,metresPerPixel} from './seabed.js';
export {metresPerPixel};
export const NO_WATER=-1e6;
export const WATER_GRID=32;
// Imagery no finer than this decides a lake: about 38 m pixels, sharp enough for narrow reservoirs.
export const LAKE_IMAGE_ZOOM=12;
const FLAT_STEP=3/256,MIN_PIXELS=24,MIN_LAKE_M2=20000,LARGE_LAKE_M2=100000,BASIN_SHARE=0.7;
// Low land in whole-metre data holds flat patches by the hundred (the Nile delta), so a low flat has to be larger to count.
const LOW_FLAT_M=10,MIN_LOW_LAKE_M2=250000;
const DARK_LUMA=0.06,BLUE_OVER_RED=1.2,GREEN_OVER_BLUE=2;
const SHORE_REACH_M=200,BED_DEPTH=32,BED_SCALE_M=70,BED_UNDULATION=0.35,MAX_MARGIN=32;
const LINEAR=Float32Array.from({length:256},(_,i)=>{const c=i/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
// Connected regions of equal height, big enough to be a lake: [{level,cells:Int32Array}]. sea, a per-pixel mask or null, excludes
// pixels: the terraces of real sea floor data are as flat as a lake, and there were thousands.
export function flatRegions(tile,z,y,sea){
 const h=tile.heights,w=tile.width,H=tile.height,n=w*H,seen=new Uint8Array(n),queue=new Int32Array(n),out=[];
 const metres=metresPerPixel(z,y+0.5,w),minPixels=Math.max(MIN_PIXELS,Math.ceil(MIN_LAKE_M2/(metres*metres)));
 const open=a=>!seen[a]&&!(sea&&sea[a]);
 let tail=0;
 for(let s=0;s<n;s++){
  if(seen[s])continue;seen[s]=1;const v=h[s];if(sea&&sea[s])continue;
  const start=tail;let head=tail;queue[tail++]=s;
  while(head<tail){
   const a=queue[head++],i=a%w;
   if(i>0&&open(a-1)&&Math.abs(h[a-1]-v)<=FLAT_STEP){seen[a-1]=1;queue[tail++]=a-1;}
   if(i<w-1&&open(a+1)&&Math.abs(h[a+1]-v)<=FLAT_STEP){seen[a+1]=1;queue[tail++]=a+1;}
   if(a>=w&&open(a-w)&&Math.abs(h[a-w]-v)<=FLAT_STEP){seen[a-w]=1;queue[tail++]=a-w;}
   if(a<n-w&&open(a+w)&&Math.abs(h[a+w]-v)<=FLAT_STEP){seen[a+w]=1;queue[tail++]=a+w;}
  }
  if(tail-start<minPixels)continue;
  const cells=queue.slice(start,tail);let sum=0;for(let k=0;k<cells.length;k++)sum+=h[cells[k]];
  // The mean rounded to a Terrarium step, so that the same lake reads the same level in every tile.
  const level=Math.round(sum/cells.length*256)/256;
  if(Math.abs(level)<LOW_FLAT_M&&cells.length*metres*metres<MIN_LOW_LAKE_M2)continue;
  out.push({level,cells});
 }
 return out;
}
// A lake sits in a basin: most of what surrounds it is not lower. This rejects flat tops and filled slopes.
function inBasin(region,tile){
 const h=tile.heights,w=tile.width,n=h.length,low=region.level-0.5;let edge=0,raised=0;
 const look=b=>{const v=h[b];if(Math.abs(v-region.level)<=FLAT_STEP)return;edge++;if(v>=low)raised++;};
 for(let k=0;k<region.cells.length;k++){
  const a=region.cells[k],i=a%w;
  if(i>0)look(a-1);if(i<w-1)look(a+1);if(a>=w)look(a-w);if(a<n-w)look(a+w);
 }
 return edge===0||raised/edge>=BASIN_SHARE;
}
// image is the albedo tile at imageZ holding this tile. Sampled evenly, at most about a thousand pixels.
export function isLake(region,tile,z,x,y,image,imageZ){
 if(!inBasin(region,tile))return false;
 const w=tile.width,shift=z-imageZ,s=2**shift,ix=x>>shift,iy=y>>shift,d=image.rgba,iw=image.width,iH=image.height,metres=metresPerPixel(z,y+0.5,w);
 const step=Math.max(1,Math.floor(region.cells.length/1024));let samples=0,dark=0,blue=0;
 for(let k=0;k<region.cells.length;k+=step){
  const a=region.cells[k],i=a%w,j=(a-i)/w;
  const u=Math.min(iw-1,Math.floor(((x-ix*s)+(i+0.5)/w)/s*iw)),v=Math.min(iH-1,Math.floor(((y-iy*s)+(j+0.5)/w)/s*iH)),o=(v*iw+u)*4;
  const r=LINEAR[d[o]],g=LINEAR[d[o+1]],b=LINEAR[d[o+2]];samples++;
  if((r+g+b)/3<=DARK_LUMA&&b>=r*BLUE_OVER_RED){dark++;if(g<=b*GREEN_OVER_BLUE)blue++;}
 }
 if(!samples)return false;
 // Green water and dark forest overlap in colour, but forest is not flat to the centimetre over ten hectares.
 const area=region.cells.length*metres*metres;
 return blue/samples>=0.5||(area>=LARGE_LAKE_M2&&dark/samples>=0.5);
}
const reachPixels=(z,y,w)=>Math.min(MAX_MARGIN,Math.ceil(SHORE_REACH_M/metresPerPixel(z,y+0.5,w))+1);
// Smooth value noise in global Mercator coordinates, so that it joins across tiles and zooms.
function hash2(a,b){let v=Math.imul(a,0x27d4eb2d)^Math.imul(b,0x165667b1);v^=v>>>15;v=Math.imul(v,0x2c1b3c6d);v^=v>>>12;return (v>>>0)/4294967295;}
function bedNoise(X,Y){
 const a=Math.floor(X),b=Math.floor(Y),fx=X-a,fy=Y-b,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
 return (hash2(a,b)*(1-u)+hash2(a+1,b)*u)*(1-v)+(hash2(a,b+1)*(1-u)+hash2(a+1,b+1)*u)*v;
}
// Distance from each lake pixel to the nearest shore in this tile, then the synthesized bed. It stays inside the tile, so that a tile answers
// from itself alone: a shore just across a border shows as a step in the bed there, in place of fetching up to eight more tiles per lake tile.
function lowerLakeBeds(tile,lakes,z,x,y,water,sea){
 const w=tile.width,H=tile.height,h=tile.heights,metres=metresPerPixel(z,y+0.5,w),dist=new Float32Array(w*H).fill(1e9),D=Math.SQRT2;
 for(let a=0;a<w*H;a++)if(water[a]<=NO_WATER||sea.mask[a])dist[a]=0;
 for(let j=0;j<H;j++)for(let i=0;i<w;i++){const a=j*w+i;let d=dist[a];if(i>0)d=Math.min(d,dist[a-1]+1);if(j>0){d=Math.min(d,dist[a-w]+1);if(i>0)d=Math.min(d,dist[a-w-1]+D);if(i<w-1)d=Math.min(d,dist[a-w+1]+D);}dist[a]=d;}
 for(let j=H-1;j>=0;j--)for(let i=w-1;i>=0;i--){const a=j*w+i;let d=dist[a];if(i<w-1)d=Math.min(d,dist[a+1]+1);if(j<H-1){d=Math.min(d,dist[a+w]+1);if(i<w-1)d=Math.min(d,dist[a+w+1]+D);if(i>0)d=Math.min(d,dist[a+w-1]+D);}dist[a]=d;}
 const scale=2**(13-z);
 for(const region of lakes)for(let k=0;k<region.cells.length;k++){
  const a=region.cells[k],i=a%w,j=(a-i)/w,d=dist[a]*metres;
  const undulation=1+BED_UNDULATION*(2*bedNoise((x+(i+0.5)/w)*scale,(y+(j+0.5)/w)*scale)-1);
  h[a]=region.level-BED_DEPTH*undulation*(1-Math.exp(-d/BED_SCALE_M));
 }
}
// Coarse tiles ring beside a steep shore: Lake Geneva reads down to 347 m against a level of 371 at z9. Ground under a lake's level
// and joined to it is the lake, a bounded way, so that a dam's far side stays out once its crest is in the data.
function spreadLake(region,tile,z,y,sea){
 const h=tile.heights,w=tile.width,H=tile.height,inside=new Uint8Array(w*H),found=[...region.cells],reach=reachPixels(z,y,w);
 for(const a of found)inside[a]=1;
 let front=found.slice();
 for(let step=0;step<reach&&front.length;step++){
  const next=[];
  for(const a of front){const i=a%w,j=(a-i)/w;for(const b of [i>0?a-1:-1,i<w-1?a+1:-1,j>0?a-w:-1,j<H-1?a+w:-1]){if(b<0||inside[b]||sea.mask[b]||h[b]>=region.level)continue;inside[b]=1;found.push(b);next.push(b);}}
  front=next;
 }
 region.cells=Int32Array.from(found);
}
// The only step that changes heights, and it changes the tile given. sea comes from findSea, parent is the coarser tile for the floor under
// flat-zero sea (or null), lakes come from flatRegions and isLake.
export function applyWater(tile,{z,x,y,seabedZoom,sea,parent,lakes}){
 const h=tile.heights,water=new Float32Array(h.length).fill(NO_WATER);
 let any=fillSeabed(tile,sea,parent,z,x,y,Math.min(z,seabedZoom),water)>0;
 for(const region of lakes)spreadLake(region,tile,z,y,sea);
 for(const region of lakes){any=true;for(let k=0;k<region.cells.length;k++)water[region.cells[k]]=region.level;}
 if(lakes.length)lowerLakeBeds(tile,lakes,z,x,y,water,sea);
 liftDryLand(tile,sea,a=>water[a]>NO_WATER);
 tile.water=any?water:null;
}

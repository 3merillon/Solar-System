// Which pixels of a height tile are sea. Terrain Tiles come in two kinds, side by side at the same zoom, by whichever source
// covered the place. Sea is a flat zero with rounding noise of a Terrarium step or two (Portofino, Tokyo, the Mekong), or it
// keeps real depths at every zoom (the Somme, Flanders, the Waddenzee, Baffin). Land below sea level reads negative too
// (Flevoland to -7 m, the Flemish polders). So height alone cannot say, and a tile cannot say by itself: anything spread only
// through one tile stops at its border and leaves a square.
//
// What tells them apart is curvature. Sea here is interpolated from coarse data, so it is smooth even where steep; land carries
// pixel-scale noise however flat it lies. Over 25 recorded places at z12 and a 2 cm limit, 82 to 100% of sea passes and 7% of
// Flevoland does. A heuristic, tuned on that sample: docs/M1-LIVE-EARTH.md has the measurements and what it gets wrong.
export const SHALLOW_DEPTH=3;
// Dry ground stands at least this far above the water that could reach it. See liftDryLand.
export const LOW_LAND=0.5;
const LOW=3/256,DEEP=10,SMOOTH_SHARE=0.5,WINDOW=4,MIN_SEA_M2=4e5,REACH_M=400,MAX_REACH=32,MAX_ENCLOSED_M2=16e6,LIFT_SOFTNESS=0.25,LIFT_END=3;
export const atSeaLevel=v=>Math.abs(v)<=LOW;
export const hasSeaLevelPixels=tile=>{const h=tile.heights;for(let i=0;i<h.length;i++)if(atSeaLevel(h[i]))return true;return false;};
// Largest curvature, in metres per pixel squared, of a pixel that counts as smooth. Measured per zoom: the highest limit
// that keeps Flevoland dry. Downsampling calms land noise, and below z9 the source itself turns coarser.
export const curvatureLimit=z=>z>=12?0.02:z>=9?0.02*2**(12-z):0.02*2**(13-z);
// Low ground that is not the sea, listed by hand: [west,south,east,north,level]. Inside these, no sea comes from being low.
// With a level, what passes for sea there is water standing at that level, since its data does not read as flat water (the Caspian
// reads -33 to -10 m at z12). Without one, only flat lakes are water, such as the Dead Sea, and dry ground stays as measured.
export const INLAND_BASINS=[
 [44,36,59,48,-28],              // Caspian, with the Volga delta, Kuma-Manych and Karagiye
 [-116.4,32,-114.9,33.8,-72],    // Salton Sea and Imperial Valley
 [35.25,29.5,36,33.1,null],      // Jordan valley and the Dead Sea
 [-117.6,35.6,-116.3,37,null],   // Death Valley
 [25,28.5,30.2,30.4,null],       // Qattara
 [30.2,29.1,31,29.7,null],       // Fayum
 [88,42,91,43.5,null],           // Turpan
 [39.7,13,40.95,14.6,null],      // Danakil
 [42.3,11.5,42.55,11.8,null],    // Lake Assal
 [136.5,-29.8,138.5,-27.8,null], // Lake Eyre
 [5.5,33.2,9.3,34.9,null],       // Chott Melrhir and Djerid
 [-72,18.3,-71.3,18.7,null],     // Lake Enriquillo
 [-69.5,-50,-68,-49,null],       // Gran Bajo de San Julian
];
const lonOf=(x,z)=>x/2**z*360-180;
const latOf=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
export function metresPerPixel(z,y,tileSize=256){return 40075016.686*Math.cos(latOf(y,z)*Math.PI/180)/(2**z*tileSize);}
// Per pixel the index of its basin plus one, or null when the tile touches none.
function basinsOfTile(z,x,y,w,H){
 const west=lonOf(x,z),east=lonOf(x+1,z),north=latOf(y,z),south=latOf(y+1,z);
 const near=[];INLAND_BASINS.forEach((b,k)=>{if(b[0]<east&&b[2]>west&&b[1]<north&&b[3]>south)near.push(k);});
 if(!near.length)return null;
 const out=new Uint8Array(w*H);
 for(let j=0;j<H;j++){const lat=latOf(y+(j+.5)/H,z);for(let i=0;i<w;i++){const lon=lonOf(x+(i+.5)/w,z);for(const k of near){const b=INLAND_BASINS[k];if(lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3]){out[j*w+i]=k+1;break;}}}}
 return out;
}
// Share of smooth pixels in a square around each pixel, cut off by the tile.
function smoothShare(h,w,H,limit){
 const sum=new Uint32Array((w+1)*(H+1)),W1=w+1;
 for(let j=0;j<H;j++){let row=0;for(let i=0;i<w;i++){const a=j*w+i;
  const cx=i>0&&i<w-1?Math.abs(h[a-1]-2*h[a]+h[a+1]):0,cy=j>0&&j<H-1?Math.abs(h[a-w]-2*h[a]+h[a+w]):0;
  if(cx<=limit&&cy<=limit)row++;sum[(j+1)*W1+i+1]=sum[j*W1+i+1]+row;}}
 return (i,j)=>{const x0=Math.max(0,i-WINDOW),x1=Math.min(w,i+WINDOW+1),y0=Math.max(0,j-WINDOW),y1=Math.min(H,j+WINDOW+1);return (sum[y1*W1+x1]-sum[y0*W1+x1]-sum[y1*W1+x0]+sum[y0*W1+x0])/((x1-x0)*(y1-y0));};
}
// Connected pixels of a mask. visit(cells,count,touchesBorder) sees each, and each pixel once.
function eachRegion(mask,w,H,visit){
 const seen=new Uint8Array(w*H),queue=new Int32Array(w*H);
 for(let s=0;s<w*H;s++){
  if(!mask[s]||seen[s])continue;seen[s]=1;let tail=1,head=0,border=false;queue[0]=s;
  while(head<tail){const a=queue[head++],i=a%w,j=(a-i)/w;if(i===0||j===0||i===w-1||j===H-1)border=true;
   if(i>0&&mask[a-1]&&!seen[a-1]){seen[a-1]=1;queue[tail++]=a-1;}if(i<w-1&&mask[a+1]&&!seen[a+1]){seen[a+1]=1;queue[tail++]=a+1;}
   if(j>0&&mask[a-w]&&!seen[a-w]){seen[a-w]=1;queue[tail++]=a-w;}if(j<H-1&&mask[a+w]&&!seen[a+w]){seen[a+w]=1;queue[tail++]=a+w;}}
  visit(queue,tail,border);
 }
}
// The sea of a height tile, before anything changes it: {mask,levels,basins}. mask is 1 at sea; levels holds a basin's level
// where one applies and is null when none does; basins is the per-pixel map of inland basins or null.
export function findSea(tile,z,x,y){
 const h=tile.heights,w=tile.width,H=tile.height,n=w*H,metres=metresPerPixel(z,y+.5,w),basins=basinsOfTile(z,x,y,w,H);
 const low=new Uint8Array(n),seed=new Uint8Array(n),share=smoothShare(h,w,H,curvatureLimit(z));
 for(let j=0;j<H;j++)for(let i=0;i<w;i++){
  const a=j*w+i,v=h[a];if(v>LOW)continue;
  const b=basins?INLAND_BASINS[basins[a]-1]:undefined;if(b&&b[4]===null)continue;
  low[a]=1;if((v<=-DEEP&&!b)||share(i,j)>=SMOOTH_SHARE)seed[a]=1;
 }
 // A small patch inside the tile is a pond, a flat field or a spike. One at the border may go on past it.
 const fewest=Math.max(16,MIN_SEA_M2/(metres*metres));
 eachRegion(seed,w,H,(cells,count,border)=>{if(count<fewest&&!border)for(let k=0;k<count;k++)seed[cells[k]]=0;});
 // Sea reaches the rough pixels along its own shore, a bounded way: a path through low ground into a polder stops soon.
 const mask=seed.slice(),reach=Math.min(MAX_REACH,Math.ceil(REACH_M/metres));let front=[];
 for(let a=0;a<n;a++)if(mask[a])front.push(a);
 for(let step=0;step<reach&&front.length;step++){const next=[];for(const a of front){const i=a%w,j=(a-i)/w;
  if(i>0&&low[a-1]&&!mask[a-1]){mask[a-1]=1;next.push(a-1);}if(i<w-1&&low[a+1]&&!mask[a+1]){mask[a+1]=1;next.push(a+1);}
  if(j>0&&low[a-w]&&!mask[a-w]){mask[a-w]=1;next.push(a-w);}if(j<H-1&&low[a+w]&&!mask[a+w]){mask[a+w]=1;next.push(a+w);}}front=next;}
 // Low ground closed in by sea is a rough patch of sea floor. A polder has land around it.
 const rest=new Uint8Array(n);for(let a=0;a<n;a++)rest[a]=low[a]&&!mask[a]?1:0;
 const largest=MAX_ENCLOSED_M2/(metres*metres);
 eachRegion(rest,w,H,(cells,count)=>{
  if(count>largest)return;let sea=0,land=0;
  for(let k=0;k<count;k++){const a=cells[k],i=a%w,j=(a-i)/w;for(const b of [i>0?a-1:-1,i<w-1?a+1:-1,j>0?a-w:-1,j<H-1?a+w:-1]){if(b<0)continue;if(mask[b])sea++;else if(!low[b])land++;}}
  if(sea>0&&sea>=2*land)for(let k=0;k<count;k++)mask[cells[k]]=1;
 });
 let levels=null;
 if(basins)for(let a=0;a<n;a++){const b=basins[a]&&INLAND_BASINS[basins[a]-1];if(b&&b[4]!==null&&mask[a]){if(!levels)levels=new Float32Array(n);levels[a]=b[4];}}
 return {mask,levels,basins,ramp:null,beach:null};
}
// The height data's coast can lie hundreds of metres out to sea from the real one, with sea-coloured imagery on dry land between them and
// the real water stopping short of the beach. So the shoreline follows the imagery: from known sea, through low ground the same colour
// as the water, a step at a time, stopping at any edge. Colour alone would take dark fields and forest, as it did in Flevoland and the
// Amazon; the edge between two neighbouring pixels is what stops it. A heuristic, tuned on recorded coasts: see docs/M1-LIVE-EARTH.md.
const COAST_HEIGHT=80,COAST_BAND_M=2000,COAST_BAND_PIXELS=4,WATER_BLUE_OVER_RED=-6,WATER_GREEN_OVER_BLUE=3,WATER_BRIGHTEST=175,RAMP_TOP=0.5,RAMP_SLOPE=0.02;
// The coarsest zoom given a shore from imagery. Coarser pages come from the pinned pack, apart from a few at high latitude.
export const SHORE_LOWEST_ZOOM=3;
// How high ground can read and still be sea in the image. A coarse pixel averages the shore with the land behind it, in proportion to its size.
const coastHeight=metres=>Math.max(COAST_HEIGHT,0.5*metres);
// Median and spread per channel over sea away from its shore, or null with too little of it.
export function seaColour(image,mask,w,H){
 const d=image.rgba,inner=new Uint8Array(w*H);let count=0;
 for(let j=3;j<H-3;j++)for(let i=3;i<w-3;i++){let all=1;for(let b=-3;b<=3&&all;b++)for(let a=-3;a<=3;a++)if(!mask[(j+b)*w+i+a]){all=0;break;}if(all){inner[j*w+i]=1;count++;}}
 let use=inner;if(count<64){use=mask;count=0;for(let a=0;a<w*H;a++)if(use[a])count++;if(count<16)return null;}
 const hist=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];
 for(let a=0;a<w*H;a++)if(use[a])for(let k=0;k<3;k++)hist[k][d[a*4+k]]++;
 const median=hist.map(h=>{let sum=0;for(let v=0;v<256;v++){sum+=h[v];if(sum*2>=count)return v;}return 255;});
 let spread=0;for(let k=0;k<3;k++){const by=new Uint32Array(256);for(let v=0;v<256;v++)by[Math.abs(v-median[k])]+=hist[k][v];let sum=0;for(let v=0;v<256;v++){sum+=by[v];if(sum*2>=count){spread=Math.max(spread,v);break;}}}
 return {median,spread};
}
// Where a tile's sea may start, from the sea of the coarser tile above it: only inside that sea, a pixel in from its edge. One coarse pixel covers
// many fine ones, so anything nearer would cut square teeth along its grid. The rest comes through growth, with its test for edges.
export function tileSeeds(parentMask,parentWidth,z,x,y,parentZ,w,H){
 const s=2**(z-parentZ),px=x>>(z-parentZ),py=y>>(z-parentZ),out=new Uint8Array(w*H),P=parentWidth;
 const inner=(u,v)=>parentMask[v*P+u]&&(u===0||parentMask[v*P+u-1])&&(u===P-1||parentMask[v*P+u+1])&&(v===0||parentMask[(v-1)*P+u])&&(v===P-1||parentMask[(v+1)*P+u]);
 for(let j=0;j<H;j++)for(let i=0;i<w;i++){const u=Math.min(P-1,Math.floor(((x-px*s)+(i+.5)/w)/s*P)),v=Math.min(P-1,Math.floor(((y-py*s)+(j+.5)/H)/s*P));if(inner(u,v))out[j*w+i]=1;}
 return out;
}
// True when a tile has low ground the sea could yet claim. An inland basin's ground is not the sea's to claim, but the rest of its tile may be.
export function mayHoldShore(tile,sea,z,y){const h=tile.heights,most=coastHeight(metresPerPixel(z,y+.5,tile.width));for(let a=0;a<h.length;a++)if(!sea.mask[a]&&h[a]<=most&&!(sea.basins&&sea.basins[a]))return true;return false;}
// Extends sea.mask from imagery of the same tile, in place. seeds, from the tile above, start the sea in a tile that may hold none of its
// own: one can lie wholly inside the strip, and would otherwise be a dry square. colour stands in where the tile has too little sea to tell.
// Leaves sea.ramp, the shallowest the bed may be per pixel, so that the bed falls away from the new shore. Returns the pixels added.
export function shoreFromImage(tile,sea,image,z,y,seeds=null,colour=null){
 const h=tile.heights,w=tile.width,H=tile.height,n=w*H,d=image.rgba;if(image.width!==w||image.height!==H)return 0;
 const ref=seaColour(image,sea.mask,w,H)||colour,water=new Uint8Array(n);
 const limits=ref?ref.median.map(v=>Math.max(6,0.3*v,Math.min(2*ref.spread,0.5*v))):null;
 for(let a=0;a<n;a++){
  const r=d[a*4],g=d[a*4+1],b=d[a*4+2];
  if(sea.basins&&sea.basins[a])continue;
  if(b-r>=WATER_BLUE_OVER_RED&&g-b<=WATER_GREEN_OVER_BLUE&&(r+g+b)/3<=WATER_BRIGHTEST)water[a]=1;
  else if(ref&&Math.abs(r-ref.median[0])<=limits[0]&&Math.abs(g-ref.median[1])<=limits[1]&&Math.abs(b-ref.median[2])<=limits[2])water[a]=1;
 }
 const mask=sea.mask,metres=metresPerPixel(z,y+.5,w),highest=coastHeight(metres);let front=[],added=0;
 for(let a=0;a<n;a++){if(seeds&&seeds[a]&&water[a]&&!mask[a]&&h[a]<=highest){mask[a]=2;added++;}if(mask[a]&&water[a])front.push(a);}
 const reach=Math.min(w,Math.max(COAST_BAND_PIXELS,Math.ceil(COAST_BAND_M/metres)));
 for(let step=0;step<reach&&front.length;step++){
  const next=[];
  for(const a of front){
   const i=a%w,j=(a-i)/w,bright=Math.max(d[a*4],d[a*4+1],d[a*4+2]),edge=bright<16?3:4;
   for(const b of [i>0?a-1:-1,i<w-1?a+1:-1,j>0?a-w:-1,j<H-1?a+w:-1]){
    if(b<0||mask[b]||!water[b]||h[b]>highest)continue;
    if(Math.abs(d[b*4]-d[a*4])>edge||Math.abs(d[b*4+1]-d[a*4+1])>edge||Math.abs(d[b*4+2]-d[a*4+2])>edge)continue;
    mask[b]=2;added++;next.push(b);
   }
  }
  front=next;
 }
 // The bed falls away from the shore, and the land rises from it. Land stands any height over a pixel's step to the water, and the
 // waterline, where bilinear heights cross the level, then hugs the water pixels in a staircase. Low on both sides, it is a contour.
 // Both scale with the pixel, the same slope at every zoom: a metre over a pixel kilometres wide would flatten a coast's mountains.
 const top=Math.max(RAMP_TOP,RAMP_SLOPE*metres),beach=new Uint8Array(n);let any=added>0;
 // Only ground that was low already: a real cliff keeps its height, and meets the water in one step.
 for(let j=0;j<H;j++)for(let i=0;i<w;i++){const a=j*w+i;if(mask[a]||h[a]>highest||(sea.basins&&sea.basins[a]))continue;if((i>0&&mask[a-1])||(i<w-1&&mask[a+1])||(j>0&&mask[a-w])||(j<H-1&&mask[a+w])){beach[a]=1;any=true;}}
 if(!any)return 0;
 sea.beach=beach;sea.beachHeight=2*top;
 // Distance to dry ground inside this tile, for the bed.
 const dist=new Float32Array(n).fill(1e9),D=Math.SQRT2;
 for(let a=0;a<n;a++)if(!mask[a])dist[a]=0;
 for(let j=0;j<H;j++)for(let i=0;i<w;i++){const a=j*w+i;let v=dist[a];if(i>0)v=Math.min(v,dist[a-1]+1);if(j>0){v=Math.min(v,dist[a-w]+1);if(i>0)v=Math.min(v,dist[a-w-1]+D);if(i<w-1)v=Math.min(v,dist[a-w+1]+D);}dist[a]=v;}
 for(let j=H-1;j>=0;j--)for(let i=w-1;i>=0;i--){const a=j*w+i;let v=dist[a];if(i<w-1)v=Math.min(v,dist[a+1]+1);if(j<H-1){v=Math.min(v,dist[a+w]+1);if(i<w-1)v=Math.min(v,dist[a+w+1]+D);if(i>0)v=Math.min(v,dist[a+w-1]+D);}dist[a]=v;}
 // Beside the shore only: past the ramp's length, or two pixels at a coarse zoom where the ramp has none, the sea keeps its measured depth.
 const ramp=new Float32Array(n),deepest=Math.max(SHALLOW_DEPTH,top),length=Math.max(2*metres,(deepest-top)/RAMP_SLOPE);
 for(let a=0;a<n;a++)if(mask[a]===2||(mask[a]&&dist[a]*metres<=length))ramp[a]=-Math.min(deepest,top+RAMP_SLOPE*dist[a]*metres);
 sea.ramp=ramp;
 for(let a=0;a<n;a++)if(mask[a])mask[a]=1;
 return added;
}
// True when the sea found holds exact zeros, the only sea needing a floor from a coarser tile.
export function seaHasZeros(tile,sea){const h=tile.heights;for(let a=0;a<h.length;a++)if(sea.mask[a]&&atSeaLevel(h[a]))return true;return false;}
// The floor under sea that reads as a flat zero, in place, and sea level in water. A flat zero would put the floor at the surface, so
// waves clip through it and nothing lies under the sea; it comes from parent, the decoded tile at parentZ holding this one, which
// carries depths (or at SHALLOW_DEPTH when parent is null), read raw. Sea that keeps its depths keeps them, up to the ramp beside a shore.
// water, when given, gets the levels.
export function fillSeabed(tile,sea,parent,z,x,y,parentZ,water=null){
 const h=tile.heights,w=tile.width,H=tile.height,shift=z-parentZ,s=2**shift,ph=parent?.heights,pw=parent?.width,pH=parent?.height,px=x>>shift,py=y>>shift;let filled=0;
 for(let j=0;j<H;j++)for(let i=0;i<w;i++){
  const a=j*w+i;if(!sea.mask[a])continue;filled++;
  const level=sea.levels?sea.levels[a]:0;if(water)water[a]=level;
  if(level!==0){h[a]=Math.min(h[a],level-SHALLOW_DEPTH);continue;}
  if(!atSeaLevel(h[a])){if(sea.ramp&&h[a]>sea.ramp[a])h[a]=sea.ramp[a];continue;}
  let floor=-SHALLOW_DEPTH;
  if(ph){
   const u=Math.min(pw-1,Math.max(0,((x-px*s)+(i+.5)/w)/s*pw-.5)),v=Math.min(pH-1,Math.max(0,((y-py*s)+(j+.5)/H)/s*pH-.5));
   const b=Math.floor(u),c=Math.floor(v),d=Math.min(pw-1,b+1),e=Math.min(pH-1,c+1),fu=u-b,fv=v-c;
   floor=Math.min((ph[c*pw+b]*(1-fu)+ph[c*pw+d]*fu)*(1-fv)+(ph[e*pw+b]*(1-fu)+ph[e*pw+d]*fu)*fv,-SHALLOW_DEPTH);
  }
  h[a]=floor;
 }
 return filled;
}
// Ground that stays dry is held above the water, in place, a smooth step that leaves everything from about LIFT_END up alone. Water
// levels are coarse, a cell of a page, so without this any ground under the level in a cell with water floods in the cell's square.
// This moves measured heights: by what a polder lies under sea level, plus LOW_LAND, and on land above sea level by at most 0.53 m at the water's edge, 0.17 m at 0.5 m up.
// A basin with no level of its own keeps its heights, since no sea can reach it.
export function liftDryLand(tile,sea,isWater){
 const h=tile.heights;
 for(let a=0;a<h.length;a++){
  if(isWater(a))continue;
  if(sea.beach&&sea.beach[a]&&h[a]>sea.beachHeight)h[a]=sea.beachHeight;
  const b=sea.basins&&sea.basins[a]?INLAND_BASINS[sea.basins[a]-1]:null;if(b&&b[4]===null)continue;
  const base=(b?b[4]:0)+LOW_LAND,v=h[a];if(v>=base+LIFT_END)continue;
  h[a]=base+LIFT_SOFTNESS*Math.log1p(Math.exp((v-base)/LIFT_SOFTNESS));
 }
}

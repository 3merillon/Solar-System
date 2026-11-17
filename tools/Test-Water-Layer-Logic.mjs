// Logic tests of the water layer (web/field/water-layer.js) on synthetic tiles: each shortcut of its spatial queries
// has a case that fails if the shortcut gives a different answer from brute force.
//   node tools/Test-Water-Layer-Logic.mjs
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const u=f=>pathToFileURL(resolve('web/field',f)).href;
const {waterBodies,waterUnion,buildWaterPage,WATER_BAND,shoreWiggle}=await import(u('water-layer.js'));
const {insideRings,metresPerMercator}=await import(u('map-water.js'));
const {exactTexelMap,pageCellMetres,extendedTexelMap}=await import(u('resample.js'));
const {riverField}=await import(u('rivers.js'));
const {directionToChart,lonLatToDirection,mercatorToLonLat}=await import(u('chart.js'));
let failed=0,passed=0;const check=(name,ok,detail='')=>{if(ok)passed++;else{failed++;console.log('FAIL',name,detail);}};
const Z=14,TX=8516,TY=5474,E=4096,n=2**Z;
// A tile with water polygons (rings in tile units) and waterway lines.
const tile=(features,lines=[])=>({z:Z,x:TX,y:TY,layers:{water:{extent:E,features:features.map(([cls,id,rings])=>({type:3,properties:{class:cls,id},paths:rings}))},waterway:{extent:E,features:lines.map(([cls,path])=>({type:2,properties:{class:cls},paths:[path]}))}}});
const flat=()=>({h:100,water:-1e7});
const sq=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]; // clockwise in tile coordinates (y down): exterior
const merc=(tx,ty)=>[(TX+tx/E)/n,(TY+ty/E)/n];
// A level-17 page inside the tile, with its texel positions.
const pageAt=(tx,ty,level=17)=>{const [X,Y]=merc(tx,ty),[lon,lat]=mercatorToLonLat(X,Y),c=directionToChart(lonLatToDirection(lon,lat)),m=2**level;return {face:c.face,level,x:Math.floor((c.u+1)/2*m),y:Math.floor((c.v+1)/2*m)};};
const build=(t,rivers,page)=>{const map=exactTexelMap(page,'height'),cell=pageCellMetres(page),union=waterUnion(waterBodies([t],flat,{samplerKey:'test'+Math.random()}),rivers);
 return {map,cell,union,w:buildWaterPage(union,map.X,map.Y,cell,new Float32Array(264*264).fill(100),{extended:pad=>extendedTexelMap(page,pad,8,map.X[0])})};};
const N=264,sdf=(w,k)=>(w.bytes[k*4]-32768)/512;

// MVT stores stable feature IDs outside properties. Pieces of one lake must
// share their level even when a tile omits the redundant OSM id property.
{const a=tile([['lake',null,[sq(500,500,2500,2500)]]]),b=tile([['lake',null,[sq(500,500,2500,2500)]]]);
 b.x++;a.layers.water.features[0].id='lake-mvt-42';b.layers.water.features[0].id='lake-mvt-42';
 const bodies=waterBodies([a,b],(x)=>({h:x<(TX+1)/n?100:112,water:-1e7}),{samplerKey:'mvt-id'});
 check('MVT lake pieces share one level',bodies.polys.length===2&&bodies.polys[0].level===bodies.polys[1].level);
}

// 1. Holder bins: a lake whose edge runs along a bin boundary and a thin sliver crossing bins; holder = brute force on
// a dense grid over the whole tile.
{const b=E/16;const t=tile([['lake',1,[sq(3*b,3*b,6*b,5*b)]],['pond',2,[[[7*b+3,2*b],[7*b+9,2*b],[9*b,9*b],[9*b-6,9*b]]]],['ocean',3,[sq(-64,12*b,E+64,E+64)]]]);
 const bodies=waterBodies([t],flat,{samplerKey:'bins'});let bad=0,n2=0;
 for(let j=0;j<400;j++)for(let i=0;i<400;i++){const [x,y]=merc((i+.5)/400*E,(j+.5)/400*E),h=bodies.holder(x,y);let brute=-1;for(const p of bodies.polys)if(insideRings(p.rings,x,y)){brute=p.index;break;}n2++;if((h>=0)!==(brute>=0))bad++;}
 check('holder bins agree with brute force',bad===0,`${bad} of ${n2}`);}

// 2. Seam: two lakes sharing an edge (same OSM nodes). Along the shared edge, inside the union, far from any dry shore:
// the distance is not near zero, and no texel there is dry.
{const t=tile([['lake',10,[sq(1000,1000,2000,3000)]],['lake',11,[sq(2000,1000,3000,3000)]]]),page=pageAt(2000,2000),{w,map}=build(t,null,page);
 let minAbs=Infinity,dry=0;for(let k=0;k<N*N;k++){const [x,y]=[map.X[k],map.Y[k]],tx=(x*n-TX)*E,ty=(y*n-TY)*E;if(Math.abs(tx-2000)<20&&ty>1500&&ty<2500){minAbs=Math.min(minAbs,-sdf(w,k));if(sdf(w,k)>=0)dry++;}}
 check('seam between two lakes is no shore',dry===0&&minAbs>8,`dry ${dry}, least depth ${minAbs.toFixed(2)} texels`);}

// 3. Distances: page distance against brute force (exact distance to the union's edge) for an irregular lake and a
// pond touching it, every texel within the band; plus the shore's deliberate variation near it (shoreWiggle).
{const ring=[];for(let a=0;a<40;a++){const r=900+250*Math.sin(3*a/40*2*Math.PI)+120*Math.cos(7*a/40*2*Math.PI);ring.push([2048+r*Math.cos(a/40*2*Math.PI),2048+r*Math.sin(a/40*2*Math.PI)]);}
 const t=tile([['lake',20,[ring]],['pond',21,[sq(2900,1900,3300,2200)]]]),page=pageAt(2048+800,2048,16),{w,map,cell,union}=build(t,null,page);
 // Brute force: dense samples of every edge where water changes across it.
 const pts=[];for(const p of union.polys)for(const r of p.rings){const m=r.length/2;for(let i=0;i<m;i++){const j=(i+1)%m,ax=r[2*i],ay=r[2*i+1],bx=r[2*j],by=r[2*j+1],len=Math.hypot(bx-ax,by-ay),K=Math.ceil(len*metresPerMercator(ay)/(cell/32));for(let s=0;s<=K;s++){const x=ax+(bx-ax)*s/K,y=ay+(by-ay)*s/K,d=.05/metresPerMercator(y),nx=(by-ay)/len*d,ny=-(bx-ax)/len*d;if(union.wetAt(x+nx,y+ny)!==union.wetAt(x-nx,y-ny))pts.push(x,y);}}}
 let worst=0,count=0;for(let k=0;k<N*N;k+=7){const s=sdf(w,k);if(Math.abs(s)>=WATER_BAND-1)continue;let best=Infinity;for(let i=0;i<pts.length;i+=2)best=Math.min(best,Math.hypot(pts[i]-map.X[k],pts[i+1]-map.Y[k]));const ref=best*metresPerMercator(map.Y[k])/cell*(union.wetAt(map.X[k],map.Y[k])?-1:1),moved=shoreWiggle(map.X[k],map.Y[k],ref*cell,cell,2)/cell;worst=Math.max(worst,Math.abs(ref+moved-s));count++;}
 check('distances match brute force within 0.06 texel',worst<.06&&count>1000,`worst ${worst.toFixed(4)} over ${count} texels`);}

// 4. A dock sharing an edge with the ocean is open to the sea: its level is the sea's, never above it.
{const t=tile([['ocean',30,[sq(-64,2000,E+64,E+64)]],['dock',31,[sq(1500,1200,2500,2000)]]]);
 const sample=()=>({h:5,water:-1e7}),bodies=waterBodies([t],sample,{samplerKey:'dock'}),dock=bodies.polys.find(p=>p.cls==='dock');
 check('dock open to the ocean stands at sea level',dock.level<=0&&bodies.stats.openToSea===1,`level ${dock.level}, open ${bodies.stats.openToSea}`);}

// 5. A channel into a lake: the junction is water on both sides, no shore across the channel's mouth; a free stream of
// one segment (under 32 m, both ends free) tapers to no width (rivers.js), holds no water and makes no shore.
{const t=tile([['lake',40,[sq(2000,1500,3000,2500)]]],[['river',[[500,2000],[2500,2000]]],['stream',[[600,600],[660,600]]]]);
 const dem=(x,y)=>100-((x*n-TX)*E)*1e-3,rivers=riverField([t],dem),page=pageAt(2000,2000,17),{w,map,union}=build(t,rivers,page);
 let mouthDry=0,shoreAcross=0;for(let k=0;k<N*N;k++){const tx=(map.X[k]*n-TX)*E,ty=(map.Y[k]*n-TY)*E;if(Math.abs(ty-2000)<5&&tx>1985&&tx<2015){if(sdf(w,k)>=0)mouthDry++;if(Math.abs(sdf(w,k))<.5)shoreAcross++;}}
 check('channel meets lake without a shore at the mouth',union.channels.length>0&&mouthDry===0&&shoreAcross===0,`channels ${union.channels.length}, dry ${mouthDry}, shore ${shoreAcross}`);
 const page2=pageAt(630,600,17),b2=build(t,rivers,page2);let wet=0;if(b2.w)for(let k=0;k<N*N;k++)if(sdf(b2.w,k)<0)wet++;
 check('zero-width stream holds no water and no shore',!b2.w||(wet===0&&b2.w.stats.channelPieces===0),`wet ${wet}, channel pieces ${b2.w?.stats.channelPieces}`);}

// 6. Coverage: a straight shore through the page; texels within a quarter texel of it are about half covered, and every
// texel's coverage agrees with its distance (full inside 0.75 texel in, empty 0.75 out).
{const t=tile([['lake',50,[sq(-64,2000,E+64,E+64)]]]),page=pageAt(2048,2000,17),{w}=build(t,null,page);let bad=0,half=0,halfBad=0;
 for(let k=0;k<N*N;k++){const s=sdf(w,k),a=(w.bytes[k*4+2]&255)/255;if(s<=-.75&&a<1)bad++;if(s>=.75&&a>0)bad++;if(Math.abs(s)<.05){half++;if(Math.abs(a-.5)>.2)halfBad++;}}
 check('coverage agrees with the distance',bad===0&&half>0&&halfBad===0,`bad ${bad}, near-shore ${half}, off-half ${halfBad}`);}

// 7. Shared edges: two neighbouring pages give the same distance over the texels they share.
{const ring=[];for(let a=0;a<30;a++){const r=600+200*Math.sin(5*a/30*2*Math.PI);ring.push([2048+r*Math.cos(a/30*2*Math.PI),2048+r*Math.sin(a/30*2*Math.PI)]);}
 // a: the page toward the lake's middle, b: its eastern neighbour across the shore.
 const t=tile([['lake',60,[ring]]]),p1=pageAt(2048+600,2048,15),p0={...p1,x:p1.x-1},a=build(t,null,p0).w,b=build(t,null,p1).w;let worst=0;
 if(a&&b)for(let j=2;j<262;j++)for(let o=0;o<=6;o++){const ka=j*N+256+o,kb=j*N+o;worst=Math.max(worst,Math.abs(a.bytes[ka*4]-b.bytes[kb*4])/512);}
 check('neighbouring pages agree on shared texels',!!a&&!!b&&worst<.03,`pages ${!!a} ${!!b}, worst ${worst.toFixed(4)} texel`);}

console.log(`${passed} passed, ${failed} failed`);process.exit(failed?1:0);

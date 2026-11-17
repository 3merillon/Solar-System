// Water while pages arrive. The owner flew over shallows and saw bare sand in square blocks with no water over it, trees in the shallows and coarse ground: the mesh reads coarser pages than the shading and
// gets them later, and height pages waited on images from a host that was holding back. A settled view shows none of this, so these read the image at moments after a jump to a low view, with the budgets on,
// against a host that answers and one that refuses. Replayed tiles only: nothing here touches a live host.
//   - field water left bare: a pixel the field calls water whose colour the water pass changed by under 3%, as a share of the field's water. Water at 3% coverage over bare sand is bare sand.
//   - mesh edge: how much colour changes across the edge of the mesh's water, inside water the field says goes on, against neighbouring pixels inside it. About one means the cells of the mesh's page cannot be seen
//   - trees in water: tree pixels standing directly over ground the field calls water
//   - height deficit: levels the ground under the camera is behind, which must not wait on a host that is refusing. One is allowed: with the budgets on, the finest page right under a camera looking
//     away is one nothing on screen reads, and it trickles in. Geneva at 700 m reads 0 with budgets off, 1 with them on. The build that waited read 7.
//   node tools/Test-Earth-Water-Arrival.mjs [--web DIR] [--views a,b] [--output DIR]
import {tileServer,earthBrowser,settle,toEye,heading} from './Earth-Test-Lib.mjs';
import {capture} from './Explorer-Test-Lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('output','evidence/local/real-earth/runs/water-arrival'));await mkdir(dir,{recursive:true});
const W=1280,H=720,TIMES=[2,4,8,15],EOX='tiles.maps.eox.at',LEFT_LIMIT=0.002,EDGE_LIMIT=1.5,BARE_CHANGE=0.03,TREES_LIMIT=50,HEIGHT_BY_S=4,HEIGHT_DEFICIT_MOST=1;
const VIEWS=[
 {name:'somme-700',lon:1.56,lat:50.21,heading:70,pitch:-.3,alt:700},
 {name:'somme-1500',lon:1.55,lat:50.22,heading:90,pitch:-.3,alt:1500},
 {name:'flanders-1500',lon:3.1,lat:51.35,heading:60,pitch:-.3,alt:1500},
 {name:'portofino-800',lon:9.2,lat:44.28,heading:270,pitch:-.2,alt:800},
 {name:'geneva-700',lon:6.63,lat:46.45,heading:180,pitch:-.15,alt:700},
];
const SERVERS=[{name:'answers',limit:null},{name:'refuses',limit:{hosts:EOX,rate:5,burst:60,block:15}}];
const wanted=arg('views');const views=wanted?VIEWS.filter(v=>wanted.split(',').includes(v.name)):VIEWS;
const report={web:arg('web','web'),width:W,height:H,limits:{left_share:LEFT_LIMIT,mesh_edge:EDGE_LIMIT,tree_pixels:TREES_LIMIT,height_deficit_by_s:HEIGHT_BY_S,height_deficit_most:HEIGHT_DEFICIT_MOST},runs:[]};
const readTargets=b=>b.evaluate(`(async()=>{
 const floats=async k=>{const r=await solarExplorer.capture(k);return new Float32Array(r.buffer,r.byteOffset,r.byteLength>>2);};
 const halves=async k=>{const r=await solarExplorer.capture(k);return new Uint16Array(r.buffer,r.byteOffset,r.byteLength>>1);};
 const half=v=>{const s=v>>15?-1:1,e=(v>>10)&31,m=v&1023;return s*(e===0?m*2**-24:(1+m/1024)*2**(e-15));};
 const position=await floats('position'),ocean=await floats('ocean'),normal=await halves('normal'),shaded=await halves('shaded'),water=await halves('water');
 const w=${W},h=${H};let field=0,left=0,trees=0;
 const here=new Float32Array(w*h),front=new Uint8Array(w*h),tree=new Uint8Array(w*h),lum=new Float32Array(w*h);
 for(let i=0;i<w*h;i++){
  const px=position[4*i],py=position[4*i+1],pz=position[4*i+2],d2=px*px+py*py+pz*pz;if(d2<0.01)continue;
  const s=4*i,sea=Math.abs(ocean[2*i]);here[i]=1-half(shaded[s+3]);front[i]=sea>0&&sea*sea<d2?1:0;tree[i]=half(normal[4*i+3])<-100?1:0;
  lum[i]=Math.log(1e-3+Math.max(0,half(water[s])*0.2126+half(water[s+1])*0.7152+half(water[s+2])*0.0722));
  if(here[i]>=0.5&&!tree[i]){field++;let change=0;for(let k=0;k<3;k++){const a=half(shaded[s+k]),c=half(water[s+k]);change=Math.max(change,Math.abs(c-a)/(Math.abs(a)+1e-3));}if(change<${BARE_CHANGE})left++;}
 }
 // A tree stands over what lies under it: the first ground below its pixels in the image.
 for(let x=0;x<w;x++){let run=0;for(let y=0;y<h;y++){const i=y*w+x;if(tree[i]){run++;continue;}if(run&&here[i]>=0.5)trees+=run;run=0;}}
 // Colour across the edge of the mesh's water, against neighbours inside it, both inside water the field says goes on.
 let edge=0,edges=0,inner=0,inners=0;
 for(let y=0;y<h;y++)for(let x=0;x<w-1;x++){const i=y*w+x,j=i+1;if(here[i]<0.95||here[j]<0.95||tree[i]||tree[j])continue;const d=Math.abs(lum[i]-lum[j]);if(front[i]!==front[j]){edge+=d;edges++;}else{inner+=d;inners++;}}
 const st=solarExplorer.stats(),f=st.field||{};
 return {field,left,trees,edges,edge:edges?edge/edges:0,inner:inners?inner/inners:0,heightDeficit:st.data_lag?.camera_level_deficit,albedoDeficit:st.data_lag?.camera_albedo_deficit,uploaded:st.data_lag?.pages_uploaded,provisional:f.provisional,eox:f.hosts?.['${EOX}']&&{asked:f.hosts['${EOX}'].asked,pauses:f.hosts['${EOX}'].pauses}};
})()`);
try{
 for(const kind of SERVERS)for(const v of views){
  // A fresh browser for each, so that each view is a cold arrival.
  const server=await tileServer({web:arg('web','web'),bandwidth:100,latency:40,limit:kind.limit});let b;
  try{
   b=await earthBrowser(resolve(dir,`${kind.name}-${v.name}`),server,{view:'earth-orbit',width:W,height:H,limits:true});
   await b.evaluate(`solarExplorer.configure({clouds:false})`);
   const eye=toEye(v.lon,v.lat,v.alt),f=heading(v.lon,v.lat,v.heading,v.pitch),t0=Date.now();
   await b.evaluate(`solarExplorer.camera=${JSON.stringify([eye,eye.map((x,i)=>x+f[i]*1000)])};`);
   for(const at of TIMES){
    while((Date.now()-t0)/1000<at)await settle(b,{maxFrames:30,quietFrames:1e9});
    const seen=await readTargets(b);const row={server:kind.name,view:v.name,at,...seen,left_share:seen.field?seen.left/seen.field:0,edge_ratio:seen.inner>0&&seen.edges>=200?seen.edge/seen.inner:null};
    await capture(b,resolve(dir,`${kind.name}-${v.name}-${at}s.png`),W,H);
    report.runs.push(row);console.log(JSON.stringify(row));
   }
  }finally{if(b)await b.close();server.close();await new Promise(r=>setTimeout(r,500));}
 }
 const worst=k=>Math.max(...report.runs.map(k));
 report.worst={left_share:worst(r=>r.left_share),edge_ratio:worst(r=>r.edge_ratio??0),trees:worst(r=>r.trees),height_deficit_after:worst(r=>r.at>=HEIGHT_BY_S?(r.heightDeficit??0):0)};
 report.checks={'no field water left bare':report.worst.left_share<=LEFT_LIMIT,'the mesh\'s cells cannot be seen in the water':report.worst.edge_ratio<=EDGE_LIMIT,'no trees in water':report.worst.trees<=TREES_LIMIT,'heights do not wait on a host holding back':report.worst.height_deficit_after<=HEIGHT_DEFICIT_MOST};
 report.pass=Object.values(report.checks).every(Boolean);
 console.log(JSON.stringify({pass:report.pass,worst:report.worst,checks:report.checks}));
}finally{await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,1));}

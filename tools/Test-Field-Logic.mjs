// Field worker logic tests. Pure Node: no browser, no GPU, no network. One PASS/FAIL line per check.
// Usage: node tools/Test-Field-Logic.mjs
import zlib from 'node:zlib';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),F=p=>import(pathToFileURL(resolve(root,'web/field',p)).href);
const chart=await F('chart.js'),pngm=await F('png.js'),imagem=await F('image.js'),srcm=await F('sources.js'),rs=await F('resample.js'),cachem=await F('tile-cache.js'),schedm=await F('scheduler.js');
const {chartToDirection,directionToChart,directionToLonLat,lonLatToDirection,lonLatToMercator,mercatorToLonLat,directionToMercator,heightTexelToChart,albedoTexelToChart,pageLonLatBounds,FACE_TABLE}=chart;

let failed=0,passed=0;
async function t(name,fn){
 try{const detail=await fn();passed++;console.log(`PASS ${name}${detail?` (${detail})`:''}`);}
 catch(e){failed++;console.log(`FAIL ${name}: ${e.message}`);}
}
const ok=(c,m)=>{if(!c)throw Error(m||'assertion failed');};
const near=(a,b,tol,m)=>{if(!(Math.abs(a-b)<=tol))throw Error(`${m||'values'} differ: ${a} vs ${b} (tol ${tol})`);};
let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const D2R=Math.PI/180;
const pageAt=(lonDeg,latDeg,level)=>{const c=directionToChart(lonLatToDirection(lonDeg*D2R,latDeg*D2R)),n=2**level,cl=v=>Math.min(n-1,Math.max(0,Math.floor((v+1)/2*n)));return {face:c.face,level,x:cl(c.u),y:cl(c.v)};};
const termerr=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));

// ---------------------------------------------------------------- chart
await t('chart: face table equals docs/M1-LIVE-EARTH.md',()=>{
 const note=readFileSync(resolve(root,'docs/M1-LIVE-EARTH.md'),'utf8'),i=note.indexOf('Cube faces follow'),j=note.indexOf('This is the gnomonic',i);
 ok(i>=0&&j>i,'face table paragraph not found');
 const found=[...note.slice(i,j).matchAll(/(\d): (\([^)]*\))/g)];
 ok(found.length===6,`found ${found.length} entries`);
 found.forEach(([,k,expr],n)=>{
  ok(Number(k)===n&&expr===FACE_TABLE[n],`face ${k}: note ${expr} vs ${FACE_TABLE[n]}`);
  const [a,b,c]=new Function('u','v',`return [${expr.slice(1,-1)}]`)(0.3,-0.2),len=Math.hypot(a,b,c);
  ok(termerr(chartToDirection(n,0.3,-0.2),[a/len,b/len,c/len])<1e-15,`face ${n} direction`);
 });
});
await t('chart: chart -> direction -> chart round trip on all six faces',()=>{
 let worst=0;
 for(let face=0;face<6;face++)for(let k=0;k<400;k++){
  const u=rnd()*1.98-0.99,v=rnd()*1.98-0.99,d=chartToDirection(face,u,v),c=directionToChart(d);
  ok(c.face===face,`face ${face} came back as ${c.face}`);worst=Math.max(worst,Math.abs(c.u-u),Math.abs(c.v-v));
  near(Math.hypot(...d),1,1e-14,'norm');
 }
 ok(worst<1e-13,`worst ${worst}`);return `worst ${worst.toExponential(1)}`;
});
await t('chart: gutter positions beyond the face stay on the gnomonic plane',()=>{
 for(let face=0;face<6;face++){const d=chartToDirection(face,1.05,-1.07),c=directionToChart(d);const e=chartToDirection(c.face,c.u,c.v);ok(termerr(d,e)<1e-14);}
 const d=chartToDirection(4,1.04,0.2);near(d[0]/d[2],1.04,1e-14);
});
await t('chart: lon/lat conventions (+Y north, lon 0 on +Z, east +X)',()=>{
 ok(termerr(lonLatToDirection(0,0),[0,0,1])<1e-15);
 ok(termerr(lonLatToDirection(Math.PI/2,0),[1,0,0])<1e-15);
 ok(termerr(lonLatToDirection(0,Math.PI/2),[0,1,0])<1e-15);
 for(let k=0;k<500;k++){const d=chartToDirection(k%6,rnd()*2-1,rnd()*2-1),[lon,lat]=directionToLonLat(d);ok(termerr(lonLatToDirection(lon,lat),d)<1e-14);
  const m=directionToMercator(d),m2=lonLatToMercator(lon,lat);near(m[0],m2[0],1e-15);near(m[1],m2[1],1e-14);
  if(Math.abs(lat)<1.4){const [lo,la]=mercatorToLonLat(...m);near(lo,lon,1e-12);near(la,lat,1e-12);}}
 near(lonLatToMercator(0,0)[0],0.5,1e-15);near(lonLatToMercator(0,0)[1],0.5,1e-15);
 near(lonLatToMercator(0,85.0511287798*D2R)[1],0,1e-9,'north limit');near(lonLatToMercator(0,-85.0511287798*D2R)[1],1,1e-9,'south limit');
});
await t('chart: Lausanne (46.52N, 6.63E) lands on face 2',()=>{
 const c=directionToChart(lonLatToDirection(6.63*D2R,46.52*D2R));ok(c.face===2,`face ${c.face}`);
 const [lon,lat]=directionToLonLat(chartToDirection(c.face,c.u,c.v));near(lon/D2R,6.63,1e-9);near(lat/D2R,46.52,1e-9);
});
await t('chart: antimeridian wraps in Mercator X and in page bounds',()=>{
 const east=lonLatToMercator(179.999*D2R,0)[0],west=lonLatToMercator(-179.999*D2R,0)[0];ok(east>0.9999&&west<0.0001);
 const p=pageLonLatBounds({face:5,level:3,x:3,y:3});ok(p.wraps,'page across +-180 must wrap');ok(p.lonMax-p.lonMin<Math.PI,`span ${p.lonMax-p.lonMin}`);
 const q=pageLonLatBounds(pageAt(6.63,46.52,8));ok(!q.wraps&&q.lonMin<6.63*D2R&&q.lonMax>6.63*D2R&&q.latMin<46.52*D2R&&q.latMax>46.52*D2R,'Lausanne page bounds contain Lausanne');
});
await t('chart: pole direction',()=>{
 const d=chartToDirection(2,0,0);ok(termerr(d,[0,1,0])<1e-15);
 near(directionToLonLat(d)[1],Math.PI/2,1e-15);ok(directionToMercator(d)[1]===-Infinity);
 const b=pageLonLatBounds({face:2,level:2,x:1,y:1});ok(b.containsPole&&b.latMax===Math.PI/2&&b.lonMax-b.lonMin===2*Math.PI);
 ok(directionToChart([0,1,0]).face===2&&directionToChart([0,-1,0]).face===3);
});
await t('chart: texel rules (height vertex aligned, albedo cell centred, gutters extended)',()=>{
 const p={face:4,level:5,x:7,y:9},s=2/32;
 let [u,v]=heightTexelToChart(p,3,3);near(u,-1+s*7,1e-15);near(v,-1+s*9,1e-15);
 [u,v]=heightTexelToChart(p,259,3);near(u,-1+s*8,1e-15,'grid 256 is the next page grid 0');
 near(heightTexelToChart({...p,x:8},3,3)[0],u,1e-15);
 [u]=heightTexelToChart(p,0,3);near(u,-1+s*(7-3/256),1e-15,'gutter below');
 [u]=heightTexelToChart(p,263,3);near(u,-1+s*(7+260/256),1e-15,'gutter above');
 [u,v]=albedoTexelToChart(p,4,4);near(u,-1+s*(7+0.5/256),1e-15);near(v,-1+s*(9+0.5/256),1e-15);
 near(albedoTexelToChart(p,260,4)[0],albedoTexelToChart({...p,x:8},4,4)[0],1e-15,'cell 256 centre = next page cell 0 centre');
 near(albedoTexelToChart(p,0,4)[0],-1+s*(7-3.5/256),1e-15,'albedo gutter 4');
 const e={face:4,level:5,x:0,y:0};ok(heightTexelToChart(e,0,0)[0]<-1&&albedoTexelToChart(e,0,0)[1]<-1,'gutter past the cube edge uses |u|>1');
 const w={face:4,level:5,x:31,y:31};ok(heightTexelToChart(w,263,263)[0]>1);
});

// ---------------------------------------------------------------- PNG
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'latin1'),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(td)>>>0);return Buffer.concat([len,td,crc]);}
function encodePng({w,h,color,data,palette,filters=[0],pre=[],level=6,idatParts=1,depth=8,interlace=0}){
 const bpp=color===2?3:color===6?4:1,stride=w*bpp,rows=[];
 for(let y=0;y<h;y++){
  const f=filters[y%filters.length],line=Buffer.alloc(stride+1);line[0]=f;
  for(let x=0;x<stride;x++){
   const cur=data[y*stride+x],a=x>=bpp?data[y*stride+x-bpp]:0,b=y?data[(y-1)*stride+x]:0,c=x>=bpp&&y?data[(y-1)*stride+x-bpp]:0;
   let pred=0;if(f===1)pred=a;else if(f===2)pred=b;else if(f===3)pred=(a+b)>>1;else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);pred=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
   line[1+x]=(cur-pred)&255;
  }
  rows.push(line);
 }
 const z=zlib.deflateSync(Buffer.concat(rows),{level}),ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=depth;ihdr[9]=color;ihdr[12]=interlace;
 const parts=[],size=Math.ceil(z.length/idatParts);for(let i=0;i<z.length;i+=size)parts.push(chunk('IDAT',z.subarray(i,i+size)));
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...pre,...(palette?[chunk('PLTE',Buffer.from(palette))]:[]),...parts,chunk('IEND',Buffer.alloc(0))]);
}
const randBytes=n=>Uint8Array.from({length:n},()=>Math.floor(rnd()*256));
await t('png: all five filter types, colour types 2 and 6',async()=>{
 for(const color of [2,6])for(const f of [0,1,2,3,4]){
  const w=19,h=11,bpp=color===2?3:4,data=randBytes(w*h*bpp),img=await pngm.decodePng(encodePng({w,h,color,data,filters:[f]}));
  ok(img.width===w&&img.height===h);
  for(let i=0;i<w*h;i++)for(let k=0;k<4;k++){const want=k<3||bpp===4?data[i*bpp+k]:255;ok(img.rgba[i*4+k]===want,`type ${color} filter ${f} texel ${i}.${k}`);}
 }
 const mixed=randBytes(31*12*3),img=await pngm.decodePng(encodePng({w:31,h:12,color:2,data:mixed,filters:[0,1,2,3,4,4,3]}));
 for(let i=0;i<31*12;i++)ok(img.rgba[i*4]===mixed[i*3]&&img.rgba[i*4+2]===mixed[i*3+2]);
});
await t('png: palette (type 3) with every filter, tRNS alpha',async()=>{
 const pal=[];for(let i=0;i<7;i++)pal.push(i*30,255-i*20,i*7);
 const w=13,h=9,data=Uint8Array.from({length:w*h},()=>Math.floor(rnd()*7));
 for(const f of [0,1,2,3,4]){const img=await pngm.decodePng(encodePng({w,h,color:3,data,palette:pal,filters:[f]}));
  for(let i=0;i<w*h;i++){ok(img.rgba[i*4]===pal[data[i]*3]&&img.rgba[i*4+1]===pal[data[i]*3+1]&&img.rgba[i*4+2]===pal[data[i]*3+2]&&img.rgba[i*4+3]===255);}}
 const tr=encodePng({w,h,color:3,data,palette:pal,pre:[chunk('tRNS',Buffer.from([10,20]))]}),img=await pngm.decodePng(tr);
 for(let i=0;i<w*h;i++)ok(img.rgba[i*4+3]===([10,20][data[i]]??255));
});
await t('png: Terrarium known heights (0 m, -32768, fractional blue, max)',async()=>{
 const px=[[128,0,0],[0,0,0],[128,1,128],[127,255,255],[255,255,255],[131,232,64],[0,0,1]],data=new Uint8Array(px.length*3);
 px.forEach((p,i)=>data.set(p,i*3));
 const h=(await pngm.decodeTerrarium(encodePng({w:px.length,h:1,color:2,data}))).heights;
 near(h[0],0,0);near(h[1],-32768,0);near(h[2],1.5,0);near(h[3],-1/256,1e-12);near(h[4],32767+255/256,0);near(h[5],131*256+232+0.25-32768,0);near(h[6],-32768+1/256,0);
 ok(pngm.terrariumHeight(128,0,0)===0);
});
await t('png: gAMA and iCCP chunks do not change the bytes; multi IDAT; compression levels',async()=>{
 const w=64,h=32,data=randBytes(w*h*3),plain=await pngm.decodePng(encodePng({w,h,color:2,data,filters:[4]}));
 const gama=Buffer.alloc(4);gama.writeUInt32BE(45455);
 const icc=chunk('iCCP',Buffer.concat([Buffer.from('junk\0\0'),zlib.deflateSync(Buffer.from('not a real profile'))]));
 const tagged=await pngm.decodePng(encodePng({w,h,color:2,data,filters:[4],pre:[chunk('gAMA',gama),icc,chunk('sRGB',Buffer.from([0])),chunk('cHRM',Buffer.alloc(32))]}));
 ok(Buffer.compare(Buffer.from(plain.rgba),Buffer.from(tagged.rgba))===0,'colour chunks changed the output');
 for(const [level,parts] of [[0,1],[9,3],[1,5]]){const m=await pngm.decodePng(encodePng({w,h,color:2,data,filters:[2],level,idatParts:parts}));ok(Buffer.compare(Buffer.from(m.rgba),Buffer.from(plain.rgba))===0,`level ${level} parts ${parts}`);}
});
await t('png: rejects unsupported formats with a clear error',async()=>{
 const rejects=async(buf,re)=>{try{await pngm.decodePng(buf);}catch(e){ok(re.test(e.message),e.message);return;}throw Error('did not throw');};
 await rejects(encodePng({w:2,h:2,color:2,data:randBytes(12),depth:16}),/bit depth/);
 await rejects(encodePng({w:2,h:2,color:2,data:randBytes(12),interlace:1}),/interlace/);
 const gray=encodePng({w:2,h:2,color:2,data:randBytes(12)});gray[25]=0;await rejects(gray,/colour type 0/);
 await rejects(Buffer.from('not a png at all'),/signature/);
 await rejects(encodePng({w:2,h:2,color:3,data:randBytes(4)}),/PLTE/);
});

// ---------------------------------------------------------------- sources
await t('sources: URL argument order against the known examples',()=>{
 const S=srcm.SOURCES;
 ok(S.terrarium.tileUrl(10,531,361)==='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/531/361.png','terrarium');
 ok(/^https:\/\/tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless-\d{4}_3857\/default\/g\/10\/361\/531\.jpg$/.test(S.eox.tileUrl(10,531,361)),'eox z/row/col '+S.eox.tileUrl(10,531,361));
 ok(S.eox.tileUrl(10,531,361).includes(`s2cloudless-${srcm.EOX_LAYER_YEAR}_3857`));
 ok(S.swissimage.tileUrl(18,135900,92716)==='https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/18/135900/92716.jpeg','swisstopo');
});
await t('sources: manifest, ranges, coverage, ledger fields',()=>{
 const m=srcm.default;ok(m.height==='terrarium'&&m.albedo==='eox'&&m.overlays[0]==='swissimage');
 const r=srcm.resolveSources(null);ok(r.height.maxZoom===13&&r.albedo.maxZoom===14&&r.overlays[0].maxZoom===18);
 const b=srcm.SOURCES.swissimage.coverage.bbox;ok(b.lonMin===5.9&&b.lonMax===10.5&&b.latMin===45.8&&b.latMax===47.9);
 for(const s of Object.values(srcm.SOURCES))ok(s.id&&s.channel&&s.tileSize===256&&s.attribution.length>10&&s.cachePermission&&s.coverage.latLimit>85);
 ok(srcm.resolveSources({overrides:{terrarium:{maxZoom:11}}}).height.maxZoom===11);
 ok(JSON.stringify(m)===JSON.stringify(structuredClone(m)),'manifest is plain data');
});
await t('sources: proxy rewriting',()=>{
 const u='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/531/361.png';
 ok(srcm.proxyUrl(u,'http://127.0.0.1:9')==='http://127.0.0.1:9/proxy/s3.amazonaws.com/elevation-tiles-prod/terrarium/10/531/361.png');
 ok(srcm.proxyUrl(u,'http://h:1/')==='http://h:1/proxy/s3.amazonaws.com/elevation-tiles-prod/terrarium/10/531/361.png','trailing slash');
 ok(srcm.proxyUrl('https://a.b/c/d?x=1&y=2','http://p')==='http://p/proxy/a.b/c/d?x=1&y=2','query kept');
 ok(srcm.proxyUrl(u,'')===u&&srcm.proxyUrl(u,null)===u,'no proxy leaves the URL alone');
 ok(srcm.hostOf(u)==='s3.amazonaws.com');
});

// ---------------------------------------------------------------- resample: mapping and tiles
const TERRA=srcm.SOURCES.terrarium,EOX=srcm.SOURCES.eox;
const tilesFromPositions=(X,Y,source,z)=>{
 const n=2**z,size=source.tileSize*n,set=new Set();
 for(let o=0;o<X.length;o++){
  const px=X[o]*size-0.5,py=Y[o]*size-0.5,x0=Math.floor(px),y0=Math.floor(py);
  for(const dx of [0,1])for(const dy of [0,1]){
   const gx=(((x0+dx)%size)+size)%size,gy=Math.min(size-1,Math.max(0,y0+dy));
   set.add(`${z}/${Math.floor(gx/source.tileSize)}/${Math.floor(gy/source.tileSize)}`);
  }
 }
 return set;
};
await t('resample: requiredTiles never misses a tile a per-texel brute force touches',()=>{
 const cases=[['Lausanne D9',pageAt(6.63,46.52,9)],['Lausanne D12',pageAt(6.63,46.52,12)],['tile boundary',pageAt(0.0001,51.5,10)],['cube edge face 2',{face:2,level:6,x:0,y:0}],['cube edge face 4 corner',{face:4,level:7,x:127,y:0}],
  ['high latitude 80N',pageAt(10,80,7)],['high latitude 84N',pageAt(-120,84,9)],['antimeridian',{face:5,level:5,x:15,y:16}],['D3 coarse',pageAt(100,-30,3)],['D0',{face:4,level:0,x:0,y:0}],['south 70S',pageAt(30,-70,8)]];
 let checked=0,extra=[];
 for(const [name,page] of cases)for(const src of [TERRA,EOX]){
  const z=rs.chooseZoom(page,src),req=rs.requiredTiles(page,src);
  if(!req.length){continue;}
  const set=new Set(req.map(t=>`${t.z}/${t.x}/${t.y}`)),ex=rs.exactTexelMap(page,src.channel),brute=tilesFromPositions(ex.X,ex.Y,src,z);
  for(const k of brute)ok(set.has(k),`${name} ${src.id}: required set misses ${k}`);
  const L=rs.nodesForPage(page,src.channel,z,src.tileSize),m=rs.expandNodes(L),inter=tilesFromPositions(m.X,m.Y,src,z);
  for(const k of inter)ok(set.has(k),`${name} ${src.id}: interpolated positions touch ${k}`);
  if(name==='tile boundary')ok(set.size>1,'tile boundary page should need more than one tile');
  checked++;extra.push(set.size-brute.size);
 }
 ok(checked>=14,`only ${checked} comparisons`);return `${checked} comparisons, surplus tiles 0..${Math.max(...extra)}`;
});
await t('resample: interpolated mapping error stays under 0.02 source pixels (adaptive step)',()=>{
 const pages=[];
 for(let level=0;level<=2;level++)for(let face=0;face<6;face++)for(let x=0;x<2**level;x++)for(let y=0;y<2**level;y++)pages.push({face,level,x,y});
 for(let k=0;k<110;k++){const level=3+Math.floor(rnd()*11),n=2**level;pages.push({face:Math.floor(rnd()*6),level,x:Math.floor(rnd()*n),y:Math.floor(rnd()*n)});}
 for(let k=0;k<40;k++){pages.push(pageAt(rnd()*360-180,70+rnd()*15,3+Math.floor(rnd()*8)));}
 let worst=0,worstPage=null,measured=0,steps={};
 for(const [i,page] of pages.entries()){
  const src=i%2?EOX:TERRA,z=rs.chooseZoom(page,src),L=rs.nodesForPage(page,src.channel,z,src.tileSize);
  const box=L.X.every((x,o)=>Number.isFinite(L.Y[o])&&L.Y[o]>=0&&L.Y[o]<=1);if(!box)continue;
  const m=rs.expandNodes(L),ex=rs.exactTexelMap(page,src.channel),ppu=src.tileSize*2**z;let e=0;
  for(let o=0;o<m.X.length;o++)e=Math.max(e,Math.abs(m.X[o]-ex.X[o]),Math.abs(m.Y[o]-ex.Y[o]));
  e*=ppu;measured++;steps[L.step]=(steps[L.step]||0)+1;if(e>worst){worst=e;worstPage=`${JSON.stringify(page)} ${src.id} z${z} step ${L.step}`;}
 }
 ok(measured>150,`only ${measured} pages measured`);ok(worst<rs.MAP_TOLERANCE,`worst ${worst} px at ${worstPage}`);
 return `${measured} pages, worst ${worst.toFixed(4)} px (${worstPage}), steps ${JSON.stringify(steps)}`;
});
await t('resample: forced step 8 does NOT meet the bound at the worst pages (adaptive step is needed)',()=>{
 let worst=0;
 for(const page of [{face:4,level:0,x:0,y:0},{face:2,level:2,x:0,y:0},pageAt(0,80,3)]){
  const z=rs.chooseZoom(page,TERRA),L=rs.nodesForPage(page,'height',z,256,8);if(!L.Y.every(y=>y>=0&&y<=1))continue;
  const m=rs.expandNodes(L),ex=rs.exactTexelMap(page,'height');let e=0;for(let o=0;o<m.X.length;o++)e=Math.max(e,Math.abs(m.X[o]-ex.X[o]),Math.abs(m.Y[o]-ex.Y[o]));worst=Math.max(worst,e*256*2**z);
 }
 ok(worst>rs.MAP_TOLERANCE,`step 8 worst only ${worst}`);return `step 8 alone: ${worst.toFixed(3)} px`;
});

// ---------------------------------------------------------------- synthetic sources
const SYN={id:'syn',channel:'height',tileSize:256,minZoom:0,maxZoom:8,coverage:{latLimit:85.0511287798}};
const mercDir=(X,Y)=>{const [lon,lat]=mercatorToLonLat(X,Y);return lonLatToDirection(lon,lat);};
const fAnalytic=d=>1000*d[0]*d[2]+600*d[1]+300*Math.sin(5*d[0]+2*d[1]);
function synHeightTiles(f=fAnalytic){
 const cache=new Map();let made=0;
 return {made:()=>made,get:(s,z,tx,ty)=>{const k=`${z}/${tx}/${ty}`;let t=cache.get(k);if(!t){made++;const n=2**z,size=256*n,h=new Float32Array(65536);
  for(let py=0;py<256;py++)for(let px=0;px<256;px++)h[py*256+px]=f(mercDir((tx*256+px+0.5)/size,(ty*256+py+0.5)/size));
  t={width:256,height:256,heights:h};cache.set(k,t);}return t;}};
}
const dequant=(r,o)=>r.offset+r.scale*new Uint16Array(r.bytes)[o];
await t('resample: analytic function through a synthetic Mercator tile pyramid matches within quantisation',()=>{
 const tiles=synHeightTiles();let worst=0,worstScale=0,n=0;
 const randomPages=Array.from({length:10},()=>{const level=3+Math.floor(rnd()*6),n=2**level;return {face:Math.floor(rnd()*6),level,x:Math.floor(rnd()*n),y:Math.floor(rnd()*n)};});
 for(const page of [{face:4,level:3,x:3,y:4},{face:2,level:5,x:20,y:9},{face:0,level:4,x:5,y:5},pageAt(6.63,46.52,7),...randomPages]){
  const r=rs.buildHeightPage(page,tiles.get,SYN);if(r.missing){ok(page.face>=2&&page.face<=3,`page ${JSON.stringify(page)} unexpectedly missing`);continue;}ok(r.bytes.byteLength===139392);
  for(let j=0;j<264;j+=5)for(let i=0;i<264;i+=5){
   const [u,v]=heightTexelToChart(page,i,j),want=fAnalytic(chartToDirection(page.face,u,v)),got=dequant(r,j*264+i);
   worst=Math.max(worst,Math.abs(got-want)-r.scale/2);worstScale=Math.max(worstScale,r.scale);n++;
  }
 }
 ok(worst<0.01,`error beyond half a quantisation step: ${worst}`);return `${n} texels, excess over scale/2 ${worst.toExponential(1)} m, step <= ${worstScale.toFixed(3)} m, tolerance 0.01 m`;
});
const SYN8={...SYN,minZoom:8};
await t('resample: shared edge grid points agree within one quantisation step (same source level)',()=>{
 const tiles=synHeightTiles();let worst=0,step=0,pairs=0;
 for(const A of [{face:4,level:5,x:10,y:12},{face:2,level:4,x:3,y:9},{face:0,level:6,x:30,y:40},pageAt(6.63,46.52,8),{face:3,level:3,x:1,y:5}]){
  const B={...A,x:A.x+1},C={...A,y:A.y+1},a=rs.buildHeightPage(A,tiles.get,SYN8),b=rs.buildHeightPage(B,tiles.get,SYN8),c=rs.buildHeightPage(C,tiles.get,SYN8);
  ok(!a.missing&&!b.missing&&!c.missing,'pages build');let w=0;
  for(let j=0;j<264;j++)w=Math.max(w,Math.abs(dequant(a,j*264+259)-dequant(b,j*264+3)));
  for(let i=0;i<264;i++)w=Math.max(w,Math.abs(dequant(a,259*264+i)-dequant(c,3*264+i)));
  worst=Math.max(worst,w);const st=Math.max(a.scale,b.scale,c.scale);step=Math.max(step,st);pairs++;
  ok(w<=st*1.0001+1e-9,`edge mismatch ${w} vs step ${st} at ${JSON.stringify(A)}`);
 }
 return `${pairs} page triples, max mismatch ${worst.toFixed(4)} m, largest step ${step.toFixed(4)} m`;
});
await t('resample: neighbouring pages may pick different source levels (recorded, not a failure)',()=>{
 const tiles=synHeightTiles(),src={...SYN,maxZoom:9};let pair=null;
 for(const face of [0,4])for(let x=0;x<63&&!pair;x++){const A={face,level:6,x,y:40},B={...A,x:x+1};if(rs.chooseZoom(A,src)!==rs.chooseZoom(B,src))pair=[A,B];}
 ok(pair,'no neighbouring pair with differing levels found');
 const [A,B]=pair,a=rs.buildHeightPage(A,tiles.get,src),b=rs.buildHeightPage(B,tiles.get,src);let worst=0;
 for(let j=0;j<264;j++)worst=Math.max(worst,Math.abs(dequant(a,j*264+259)-dequant(b,j*264+3)));
 return `levels ${a.zoom} and ${b.zoom} across a shared edge: mismatch ${worst.toFixed(4)} m on a smooth analytic field, step ${Math.max(a.scale,b.scale).toFixed(4)} m`;
});
await t('resample: offset and scale reconstruct min and max; gutters sample the extended chart',()=>{
 const tiles=synHeightTiles(),page={face:4,level:3,x:3,y:4},r=rs.buildHeightPage(page,tiles.get,SYN),q=new Uint16Array(r.bytes);
 let lo=65535,hi=0;for(const v of q){lo=Math.min(lo,v);hi=Math.max(hi,v);}
 ok(lo===0&&hi===65535,'full 16-bit range used');near(r.offset,r.min,0);near(r.offset+r.scale*65535,r.max,1e-9*Math.abs(r.max)+1e-9);
 const [u,v]=heightTexelToChart(page,0,0),want=fAnalytic(chartToDirection(4,u,v));near(dequant(r,0),want,r.scale/2+0.01,'gutter texel');
 const edge={face:4,level:3,x:0,y:0},re=rs.buildHeightPage(edge,tiles.get,SYN),[eu,ev]=heightTexelToChart(edge,0,0);ok(eu<-1&&ev<-1);
 near(dequant(re,0),fAnalytic(chartToDirection(4,eu,ev)),re.scale/2+0.01,'gutter beyond the cube edge');
});
await t('resample: flat page has scale 0 and all zero values',()=>{
 const tiles=synHeightTiles(()=>123.5),r=rs.buildHeightPage({face:4,level:4,x:5,y:6},tiles.get,SYN);
 ok(r.scale===0&&r.offset===123.5&&r.min===123.5&&r.max===123.5);ok(new Uint16Array(r.bytes).every(v=>v===0));
});
await t('resample: polar and out-of-coverage pages return missing; missing tile too',()=>{
 const tiles=synHeightTiles();
 ok(rs.buildHeightPage({face:2,level:2,x:1,y:1},tiles.get,SYN).missing===true,'pole page');
 ok(rs.buildHeightPage({face:3,level:4,x:8,y:8},tiles.get,SYN).missing===true,'south pole page');
 ok(rs.buildHeightPage(pageAt(10,87,8),tiles.get,SYN).missing===true,'87N');
 ok(rs.requiredTiles({face:2,level:2,x:1,y:1},SYN).length===0);
 ok(!rs.buildHeightPage(pageAt(10,80,7),tiles.get,SYN).missing,'80N is inside coverage');
 ok(rs.buildHeightPage({face:4,level:3,x:3,y:4},()=>null,SYN).missing===true,'missing tile');
 const box={...SYN,coverage:{latLimit:85.05,bbox:{lonMin:5.9,lonMax:10.5,latMin:45.8,latMax:47.9}}};
 ok(rs.buildHeightPage(pageAt(0,0,6),tiles.get,box).missing===true,'outside bbox');
});

// ---------------------------------------------------------------- colour
await t('colour: sRGB round trip of all 256 values; encode matches the formula',()=>{
 for(let b=0;b<256;b++)ok(rs.linearToSrgbByte(rs.SRGB_TO_LINEAR[b])===b,`byte ${b}`);
 const enc=l=>l<=0.0031308?12.92*l:1.055*Math.pow(l,1/2.4)-0.055;let bad=0;
 for(let k=0;k<20000;k++){const l=Math.pow(rnd(),2);if(rs.linearToSrgbByte(l)!==Math.min(255,Math.max(0,Math.round(255*enc(l)))))bad++;}
 ok(bad===0,`${bad} of 20000 differ from the formula`);
 ok(rs.linearToSrgbByte(0)===0&&rs.linearToSrgbByte(1)===255&&rs.linearToSrgbByte(7)===255&&rs.linearToSrgbByte(-1)===0);
});
const ALB={id:'alb',channel:'albedo',tileSize:256,minZoom:5,maxZoom:5,coverage:{latLimit:85.0511287798}};
await t('colour: bilinear is done in linear light (black/white edge differs from gamma space)',()=>{
 const rgba=new Uint8Array(256*256*4);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const v=x>=128?255:0,o=(y*256+x)*4;rgba[o]=rgba[o+1]=rgba[o+2]=v;rgba[o+3]=255;}
 const tile={width:256,height:256,rgba},page={face:4,level:6,x:32,y:32},z=5,r=rs.buildAlbedoPage(page,()=>tile,ALB);ok(!r.missing&&r.zoom===5);
 const out=new Uint8Array(r.bytes),L=rs.nodesForPage(page,'albedo',z,256),m=rs.expandNodes(L),size=256*2**z;let mids=0,maxGammaGap=0;
 for(let o=0;o<264*264;o++){
  const px=m.X[o]*size-0.5,x0=Math.floor(px),fx=px-x0,cx=((x0%256)+256)%256;
  if((cx===127||cx===255)&&fx>0.05&&fx<0.95){ // between a black and a white pixel
   const w=cx===127?fx:1-fx,expectLinear=rs.linearToSrgbByte(w),gamma=Math.round(255*w);
   ok(Math.abs(out[o*4]-expectLinear)<=1,`texel ${o}: got ${out[o*4]} want ${expectLinear}`);mids++;maxGammaGap=Math.max(maxGammaGap,Math.abs(out[o*4]-gamma));
  }
 }
 ok(mids>20,`only ${mids} edge texels`);ok(maxGammaGap>40,`linear and gamma interpolation barely differ (${maxGammaGap})`);ok(out[3]===255);
 return `${mids} edge texels, linear vs gamma differ by up to ${maxGammaGap} levels`;
});

// ---------------------------------------------------------------- overlay
const OB={id:'ob',channel:'albedo',tileSize:256,minZoom:0,maxZoom:9,coverage:{latLimit:85.0511287798}};
const OO=bbox=>({id:'oo',channel:'albedo',tileSize:256,minZoom:0,maxZoom:12,coverage:{latLimit:85.0511287798,bbox}});
const SWISS={lonMin:5.9,lonMax:10.5,latMin:45.8,latMax:47.9};
const Cbase=(d,k)=>0.30+0.18*Math.sin(3*d[0]+1.7*k)+0.08*Math.cos(4*d[1]-k);
const enc=l=>rs.linearToSrgbByte(l);
function overlayTiles2(mode='normal'){
 const cache=new Map();
 return (s,z,tx,ty)=>{
  if(s.id==='oo'&&mode==='missing')return null;
  const k=`${s.id}/${z}/${tx}/${ty}`;let t=cache.get(k);if(t)return t;
  const size=256*2**z,rgba=new Uint8Array(65536*4);
  for(let py=0;py<256;py++)for(let px=0;px<256;px++){
   const o=(py*256+px)*4,d=mercDir((tx*256+px+0.5)/size,(ty*256+py+0.5)/size);
   for(let c=0;c<3;c++){
    let lin=Cbase(d,c);
    if(s.id==='oo'){lin=0.8*lin*(z>=12?1+0.4*Math.sin(2*Math.PI*(tx*256+px)/5):1); // coarser levels are the filtered pyramid: the detail averages out
    if(mode==='white')lin=1;}
    rgba[o+c]=enc(Math.min(1,Math.max(0,lin)));
   }
   rgba[o+3]=255;
  }
  t={width:256,height:256,rgba};cache.set(k,t);return t;
 };
};
const toLin=bytes=>{const a=new Float32Array(264*264*3);for(let o=0;o<264*264;o++)for(let c=0;c<3;c++)a[o*3+c]=rs.SRGB_TO_LINEAR[bytes[o*4+c]];return a;};
const boxMeans=(lin,block,x0,y0,count)=>{const m=[];for(let by=0;by<count;by++)for(let bx=0;bx<count;bx++)for(let c=0;c<3;c++){let s=0;for(let j=0;j<block;j++)for(let i=0;i<block;i++)s+=lin[((y0+by*block+j)*264+x0+bx*block+i)*3+c];m.push(s/(block*block));}return m;};
const LAUS=pageAt(6.63,46.52,10);
await t('overlay: plan uses matching low resolution, keeps base colour at low frequency, adds detail',()=>{
 const over=OO(SWISS),plan=rs.overlayPlan(LAUS,OB,over);ok(plan.zHigh>plan.zBase&&plan.zLow===plan.zBase,JSON.stringify(plan));
 const get=overlayTiles2(),res=rs.buildOverlayAlbedoPage(LAUS,get,OB,over),base=rs.buildAlbedoPage(LAUS,get,OB);
 ok(!res.missing&&res.overlayCoverage===1,`coverage ${res.overlayCoverage}`);
 const lr=toLin(new Uint8Array(res.bytes)),lb=toLin(new Uint8Array(base.bytes)),block=28,mr=boxMeans(lr,block,8,8,8),mb=boxMeans(lb,block,8,8,8);
 const maxErr=Math.max(...mr.map((v,i)=>Math.abs(v-mb[i])));ok(maxErr<0.02,`box-filtered base error ${maxErr}`);
 let detail=0;for(let o=0;o<lr.length;o++)detail=Math.max(detail,Math.abs(lr[o]-lb[o]));ok(detail>0.05,`overlay detail missing (max |diff| ${detail})`);
 // overlay uncorrected would sit 20% darker
 const rawMean=mr.reduce((a,b)=>a+b)/mr.length,baseMean=mb.reduce((a,b)=>a+b)/mb.length;ok(Math.abs(rawMean/baseMean-1)<0.05,'mean brightness matches base');
 return `box ${block} texels: max error ${maxErr.toFixed(4)} (tolerance 0.02 linear), detail amplitude ${detail.toFixed(3)}, zooms base ${plan.zBase} high ${plan.zHigh}`;
});
await t('overlay: feather weights ramp over about 16 texels',()=>{
 const w=64,h=8,valid=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=32;x<w;x++)valid[y*w+x]=1;
 const fw=rs.featherWeights(valid,w,h,16);
 ok(fw[0*w+10]===0&&fw[0*w+31]===0,'invalid texels get zero');ok(fw[4*w+32+16]>0.999&&fw[4*w+w-1]>0.999,'fully on by 16 texels');
 let maxStep=0,mono=true;for(let x=33;x<w;x++){maxStep=Math.max(maxStep,Math.abs(fw[4*w+x]-fw[4*w+x-1]));if(fw[4*w+x]<fw[4*w+x-1])mono=false;}
 ok(mono&&maxStep<0.13,`step ${maxStep}`);ok(fw[4*w+32]<0.02,'first valid texel nearly off');
 const all=rs.featherWeights(new Uint8Array(w*h).fill(1),w,h,16);ok(all.every(v=>v===1),'no invalid texel: weight 1 everywhere');
 return `largest step between texels ${maxStep.toFixed(3)}`;
});
await t('overlay: bbox border is feathered; outside the bbox the page equals the base exactly',()=>{
 const b=pageLonLatBounds(LAUS),mid=(b.lonMin+b.lonMax)/2/D2R,over=OO({...SWISS,lonMin:mid}),get=overlayTiles2();
 const res=rs.buildOverlayAlbedoPage(LAUS,get,OB,over),base=rs.buildAlbedoPage(LAUS,get,OB);ok(!res.missing);
 ok(res.overlayCoverage>0.2&&res.overlayCoverage<0.8,`coverage ${res.overlayCoverage}`);
 const L=rs.nodesForPage(LAUS,'albedo',12,256),m=rs.expandNodes(L),xmin=0.5+mid/360,rb=new Uint8Array(res.bytes),bb=new Uint8Array(base.bytes);
 let outside=0,identical=0,nearEdgeMaxDiff=0,farMaxDiff=0;
 const lr=toLin(rb),lb=toLin(bb);
 for(let o=0;o<264*264;o++){
  const x=m.X[o]-Math.floor(m.X[o]);
  if(x<xmin){outside++;if(rb[o*4]===bb[o*4]&&rb[o*4+1]===bb[o*4+1]&&rb[o*4+2]===bb[o*4+2])identical++;}
 }
 ok(outside>1000&&identical===outside,`${identical} of ${outside} outside texels equal the base`);
 // detail magnitude grows from the border inwards: compare mean |diff| in the 3 texels after the border to that 40+ texels inside
 const near3=[],far=[];
 for(let j=20;j<244;j++){let first=-1;for(let i=0;i<264;i++){if(m.X[j*264+i]-Math.floor(m.X[j*264+i])>=xmin){first=i;break;}}if(first<0||first+60>=264)continue;
  for(let i=first;i<first+3;i++)near3.push(Math.abs(lr[(j*264+i)*3+1]-lb[(j*264+i)*3+1]));for(let i=first+45;i<first+60;i++)far.push(Math.abs(lr[(j*264+i)*3+1]-lb[(j*264+i)*3+1]));}
 const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;nearEdgeMaxDiff=mean(near3);farMaxDiff=mean(far);
 ok(near3.length>100&&nearEdgeMaxDiff<farMaxDiff*0.35,`mean |detail| near border ${nearEdgeMaxDiff} vs inside ${farMaxDiff}`);
 return `near border ${nearEdgeMaxDiff.toFixed(4)} vs 45 texels inside ${farMaxDiff.toFixed(4)}`;
});
await t('overlay: pure-white no-data and missing overlay tiles fall back to the base',()=>{
 const over=OO(SWISS),base=rs.buildAlbedoPage(LAUS,overlayTiles2(),OB);
 for(const mode of ['white','missing']){
  const res=rs.buildOverlayAlbedoPage(LAUS,overlayTiles2(mode),OB,over);ok(!res.missing&&res.overlayCoverage===0,`${mode} coverage ${res.overlayCoverage}`);
  ok(Buffer.compare(Buffer.from(res.bytes),Buffer.from(base.bytes))===0,`${mode}: result differs from base`);
 }
 ok(rs.buildOverlayAlbedoPage(LAUS,(s)=>s.id==='ob'?null:overlayTiles2()(s,12,0,0),OB,over).missing===true,'missing base tile => missing');
 ok(!rs.overlayApplies(pageAt(100,0,8),OO(SWISS))&&rs.overlayApplies(LAUS,OO(SWISS)),'overlayApplies');
 const all=rs.overlayTiles(LAUS,OB,over);ok(all.some(t=>t.source.id==='ob')&&all.some(t=>t.source.id==='oo'));
});

// ---------------------------------------------------------------- cost
await t('resample: cost per page in Node (tiles already decoded)',()=>{
 const th=synHeightTiles(),get=overlayTiles2(),over=OO(SWISS),time=(fn,n)=>{fn();const t0=performance.now();for(let k=0;k<n;k++)fn();return (performance.now()-t0)/n;};
 const hp=pageAt(6.63,46.52,8),ap=pageAt(6.63,46.52,9);
 const h=time(()=>rs.buildHeightPage(hp,th.get,SYN),8),a=time(()=>rs.buildAlbedoPage(ap,get,OB),8),o=time(()=>rs.buildOverlayAlbedoPage(LAUS,get,OB,over),8);
 const rt=time(()=>rs.requiredTiles(hp,TERRA),10);
 const hz=time(()=>rs.buildHeightPage({face:4,level:0,x:0,y:0},th.get,SYN),3);
 globalThis.__cost=`height ${h.toFixed(1)} ms, albedo ${a.toFixed(1)} ms, overlay ${o.toFixed(1)} ms, requiredTiles ${rt.toFixed(2)} ms, D0 height (exact mapping) ${hz.toFixed(1)} ms`;
 return globalThis.__cost;
});

// ---------------------------------------------------------------- image decoder
await t('image: decoder uses colour-managed-off bitmap options and returns RGBA bytes (stubbed)',async()=>{
 let opts=null,closed=false;
 const dec=imagem.makeImageDecoder({
  createImageBitmap:async(blob,o)=>{opts=o;ok(blob instanceof Blob&&blob.type==='image/jpeg');return {width:2,height:1,close(){closed=true;}};},
  OffscreenCanvas:class{constructor(w,h){this.w=w;this.h=h;}getContext(){return {drawImage(){},getImageData(){return {data:new Uint8ClampedArray([1,2,3,255,4,5,6,255])};}};}},
 });
 const img=await dec(new Uint8Array([1,2,3]),'image/jpeg');
 ok(opts.colorSpaceConversion==='none'&&opts.premultiplyAlpha==='none'&&closed&&img.width===2&&img.rgba[4]===4);
});

// ---------------------------------------------------------------- tile cache
const handle=()=>{let res,rej;const h={promise:new Promise((a,b)=>{res=a;rej=b;}),cancelled:0,prio:[],cancel(){h.cancelled++;rej(Object.assign(new Error('cancelled'),{name:'AbortError'}));},setPriority(p){h.prio.push(p);},res,rej};return h;};
await t('tile cache: byte-budget LRU evicts least recently used',async()=>{
 const c=cachem.createTileCache({budgetBytes:250,sizeOf:()=>100}),mk=k=>c.request(k,'o',0,()=>{const h=handle();h.res({k});return h;});
 await mk('a');await mk('b');await mk('a'); // touch a: b is now oldest
 await mk('c');ok(c.get('a')&&!c.get('b')&&c.get('c'),'b should be evicted');
 ok(c.stats().bytes===200&&c.stats().evictions===1&&c.stats().hits===1,JSON.stringify(c.stats()));
 await mk('d');ok(!c.get('a')&&c.get('c')&&c.get('d'),'a evicted next');ok(c.stats().bytes<=250);
});
await t('tile cache: real 404 is cached as a negative entry; other errors are not',async()=>{
 const c=cachem.createTileCache();let loads=0;
 const miss=()=>c.request('n','o',0,()=>{loads++;const h=handle();h.rej(Object.assign(new Error('nf'),{status:404}));return h;});
 ok(await miss()===null&&await miss()===null&&await miss()===null&&loads===1,`loads ${loads}`);ok(c.hasNegative('n')&&c.stats().negativeHits===2);
 let caught=null;const boom=()=>c.request('e','o',0,()=>{loads++;const h=handle();h.rej(Object.assign(new Error('500'),{status:500}));return h;});
 try{await boom();}catch(e){caught=e;}ok(caught?.status===500&&!c.hasNegative('e'));try{await boom();}catch{}ok(loads===3,'a 500 is retried later');
});
await t('tile cache: concurrent requests share one fetch; cancel aborts only when no owner remains',async()=>{
 const c=cachem.createTileCache();let loads=0,h;
 const load=()=>{loads++;h=handle();return h;};
 const p1=c.request('k','A',5,load),p2=c.request('k','B',2,load),p3=c.request('k','C',9,load);
 ok(loads===1&&p1===p2&&p2===p3,'one fetch, one promise');ok(h.prio.length===1&&h.prio[0]===2,'most urgent priority wins: '+h.prio);
 c.release('A');ok(h.cancelled===0,'B and C still want it');c.release('B');ok(h.cancelled===0,'C still wants it');
 c.release('C');ok(h.cancelled===1,'last owner gone: abort');
 let err=null;try{await p1;}catch(e){err=e;}ok(err?.name==='AbortError');
 const p4=c.request('k','D',1,load);ok(loads===2,'a new request after abort starts a fresh fetch');h.res({ok:1});ok((await p4).ok===1);
 const hit=await c.request('k','E',1,load);ok(loads===2&&hit.ok===1,'served from the cache');
 c.release('nobody');
});

// ---------------------------------------------------------------- scheduler
function fakeNet(){
 const pending=[],calls=[];
 const fetch=(url,{signal})=>new Promise((resolve,reject)=>{
  const e={url,signal,resolve:(bytes=10,status=200)=>resolve({ok:status<300,status,arrayBuffer:async()=>new ArrayBuffer(bytes)}),fail:status=>resolve({ok:false,status,arrayBuffer:async()=>new ArrayBuffer(0)}),reject};
  calls.push(url);pending.push(e);
  signal.addEventListener('abort',()=>{const err=new Error('aborted');err.name='AbortError';reject(err);});
 });
 return {fetch,pending,calls,take:url=>{const i=pending.findIndex(e=>e.url===url);return i<0?null:pending.splice(i,1)[0];}};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
await t('scheduler: per-host and global concurrency limits',async()=>{
 const net=fakeNet(),s=schedm.createScheduler({fetch:net.fetch,perHost:2,global:3}),hs=[];
 for(let i=0;i<4;i++)hs.push(s.request(`https://a.test/${i}`));
 hs.push(s.request('https://b.test/0'),s.request('https://b.test/1'),s.request('https://c.test/0'));
 await tick();
 const hostCount=h=>net.pending.filter(e=>e.url.includes(h)).length;
 ok(s.stats().inFlight===3&&net.pending.length===3,`inFlight ${s.stats().inFlight}`);ok(hostCount('a.test')<=2);
 ok(net.pending.map(e=>e.url).join()==='https://a.test/0,https://a.test/1,https://b.test/0','per-host cap skips the blocked a.test/2: '+net.pending.map(e=>e.url));
 let maxIn=0;for(let n=0;n<7;n++){net.pending[0].resolve();net.pending.shift();await tick();maxIn=Math.max(maxIn,s.stats().inFlight);for(const h of ['a.test','b.test','c.test'])ok(hostCount(h)<=2);}
 ok(maxIn<=3&&s.stats().completed===7&&s.stats().queued===0,JSON.stringify(s.stats()));
});
await t('scheduler: priority order, lower number first, FIFO among equals; setPriority reorders',async()=>{
 const net=fakeNet(),s=schedm.createScheduler({fetch:net.fetch,perHost:1,global:1});
 const first=s.request('https://h.test/first',{priority:0});const hs=[5,1,3,1,4].map((p,i)=>s.request(`https://h.test/p${p}-${i}`,{priority:p}));
 await tick();const order=[];
 hs[4].setPriority(0);
 for(let n=0;n<6;n++){const e=net.pending.shift();order.push(e.url.split('/').pop());e.resolve();await tick();}
 ok(order.join()==='first,p4-4,p1-1,p1-3,p3-2,p5-0',order.join());
});
// A clock and timers the test moves by hand, for what depends on time.
const budgeted=(limits,extra={})=>{const net=fakeNet(),timers=[];let clock=0;
 const s=schedm.createScheduler({fetch:net.fetch,perHost:100,global:100,now:()=>clock,random:()=>0,unseenRank:40000,hostLimits:{'h.test':limits},setTimer:(fn,ms)=>{timers.push(fn);return timers.length;},clearTimer:()=>{},...extra});
 const pass=async ms=>{clock+=ms;const due=timers.splice(0);for(const f of due)f();await tick();await tick();};
 return {net,s,pass};};
await t('scheduler: a limited host spends a budget, most useful tile first',async()=>{
 const {net,s,pass}=budgeted({tilesPerSecond:10,burst:4,unseenPerSecond:2});
 for(let i=0;i<6;i++)s.request(`https://h.test/${i}`,{priority:100+i});
 await tick();ok(net.calls.length===4,'the burst starts at once and stops at its size: '+net.calls.length);
 s.request('https://h.test/urgent',{priority:1});await tick();ok(net.calls.length===4,'an empty budget holds even the most urgent');
 await pass(100);ok(net.calls.length===5&&net.calls.at(-1)==='https://h.test/urgent','a tenth of a second buys one tile, and the most urgent gets it: '+net.calls.at(-1));
 await pass(100);ok(net.calls.length===6&&net.calls.at(-1)==='https://h.test/4','then the rest in order: '+net.calls.at(-1));
 ok(s.stats().hosts['h.test'].asked===6,'and the count of what was asked is exposed');
});
await t('scheduler: what nothing on screen reads trickles, behind what can show',async()=>{
 const {net,s,pass}=budgeted({tilesPerSecond:10,burst:20,unseenPerSecond:2});
 for(let i=0;i<4;i++)s.request(`https://h.test/unseen${i}`,{priority:70000+i});
 await tick();ok(net.calls.length===1,'one at first: '+net.calls.length);
 await pass(250);ok(net.calls.length===1,'not yet');await pass(250);ok(net.calls.length===2,'two a second: '+net.calls.length);
 for(let i=0;i<16;i++)s.request(`https://h.test/seen${i}`,{priority:100+i});await tick();
 ok(net.calls.filter(u=>u.includes('/seen')).length===16,'what can show spends the bucket');
 await pass(500);ok(net.calls.filter(u=>u.includes('/unseen')).length===2,'and with the bucket under half, what cannot show waits, though its own allowance is there');
});
await t('scheduler: a host that refuses is left alone, then asked one request at a time',async()=>{
 const {net,s,pass}=budgeted({tilesPerSecond:20,burst:100,unseenPerSecond:4},{perHost:3});
 const refuse=url=>{const e=net.take(url);ok(e,'in flight: '+url);e.reject(new TypeError('Failed to fetch'));};
 const hs=[];for(let i=0;i<12;i++){const h=s.request(`https://h.test/${i}`,{priority:i});hs.push(h);h.promise.catch(()=>{});}
 await tick();ok(net.calls.length===3,'three at a time');
 // The first two go to retry as any failure does; the third leaves the host alone. What else was in flight is refused too, and keeps its place.
 for(let i=0;i<3;i++)refuse(`https://h.test/${i}`);await tick();await tick();
 while(net.pending.length)net.pending.shift().reject(new TypeError('Failed to fetch'));await tick();await tick();
 const seen=net.calls.length,host=s.stats().hosts['h.test'];
 ok(host.pauses===1&&host.pausedMs>0,'three refusals leave the host alone: '+JSON.stringify(host));ok(host.rate===10&&host.burst===50,'and halve its rate and burst: '+host.rate+' '+host.burst);
 await pass(1000);await pass(1000);ok(net.calls.length===seen,'nothing is asked in the meantime: '+(net.calls.length-seen));
 ok(hs.every(h=>h.state==='queued'||h.state==='waiting'),'no tile has failed: '+hs.map(h=>h.state).join());
 await pass(2500);ok(net.calls.length===seen+1,'after the pause, one request: '+(net.calls.length-seen));
 await pass(50);ok(net.calls.length===seen+1,'and only one until it answers');
 refuse(net.calls.at(-1));await tick();await tick();const again=s.stats().hosts['h.test'];ok(again.pauses===2&&again.pausedMs>4000,'a refused probe pauses for longer: '+again.pausedMs);ok(again.rate===5,'at half the budget again');
 const before=net.calls.length;await pass(8500);ok(net.calls.length===before+1,'one probe again');
 net.take(net.calls.at(-1)).resolve(10);await tick();await tick();await pass(1000);ok(net.calls.length>before+1,'an answer opens the host again: '+(net.calls.length-before));
 ok(s.stats().hosts['h.test'].rate>5,'and its budget starts to recover');
});
await t('scheduler: a host that never comes back still fails its tiles, and one with no budget is not paused',async()=>{
 const {net,s,pass}=budgeted({tilesPerSecond:20,burst:100,unseenPerSecond:4},{perHost:1,retries:0});
 const h=s.request('https://h.test/x',{priority:0});let err=null;h.promise.catch(e=>err=e);
 for(let k=0;k<40&&!err;k++){await pass(40000);const e=net.pending.shift();if(e)e.reject(new TypeError('Failed to fetch'));await tick();await tick();}
 ok(err&&err.failed,'in the end the page hears of it');ok(net.calls.length<=9,'after few requests: '+net.calls.length);
 const open=budgeted({tilesPerSecond:20,burst:100,unseenPerSecond:4},{perHost:1,retries:0}),other=open.s.request('https://other.test/y');let e2=null;other.promise.catch(e=>e2=e);await tick();open.net.take('https://other.test/y').reject(new TypeError('Failed to fetch'));await tick();await tick();
 ok(e2&&e2.failed&&!open.s.stats().hosts['other.test'],'a host with no budget fails as before');
});
// Cache Storage, as far as the tile store asks of it.
function fakeCaches(){const stores=new Map(),key=k=>String(k?.url??k);return {stores,async open(name){if(!stores.has(name))stores.set(name,new Map());const m=stores.get(name);return {
 async match(k){const b=m.get(key(k));return b?new Response(b):undefined;},async put(k,r){m.set(key(k),await r.arrayBuffer());},async delete(k){return m.delete(key(k));},async keys(){return [...m.keys()].map(url=>({url}));}};},async delete(name){return stores.delete(name);}};}
const storem=await F('tile-store.js');
const noTimer=()=>0;
await t('tile store: a tile comes back as it went in, a miss reads nothing, and it survives a new session',async()=>{
 const caches=fakeCaches(),s=await storem.openTileStore({caches,budgetBytes:1e6,setTimer:noTimer,estimate:async()=>null});
 ok(!s.has('eox/5/1/2'),'empty at first');ok(await s.get('eox/5/1/2')===null,'a miss answers null');
 s.put('eox/5/1/2',new Uint8Array([1,2,3]).buffer,'image/jpeg');await tick();await tick();await tick();
 ok(s.has('eox/5/1/2'),'held after it was written');ok(Buffer.compare(Buffer.from(await s.get('eox/5/1/2')),Buffer.from([1,2,3]))===0,'the same bytes');
 const st=s.stats();ok(st.tiles===1&&st.bytes===3&&st.hits===1&&st.writes===1,'and counted: '+JSON.stringify(st));
 await s.close();
 const again=await storem.openTileStore({caches,budgetBytes:1e6,setTimer:noTimer,estimate:async()=>null});ok(again.has('eox/5/1/2'),'a new session finds it');
 ok(Buffer.compare(Buffer.from(await again.get('eox/5/1/2')),Buffer.from([1,2,3]))===0,'with the same bytes');
});
await t('tile store: an index that cannot be read starts again, and a tile gone from the disk is only a miss',async()=>{
 const caches=fakeCaches(),first=await storem.openTileStore({caches,budgetBytes:1e6,setTimer:noTimer});first.put('eox/5/1/2',new Uint8Array(4).buffer);await tick();await tick();await tick();await first.close();
 const c=await caches.open(storem.TILE_STORE_NAME);await c.put('/__strata-tiles/index',new Response('not json'));
 const s=await storem.openTileStore({caches,budgetBytes:1e6,setTimer:noTimer});ok(s&&!s.has('eox/5/1/2'),'it starts empty');
 s.put('eox/6/1/2',new Uint8Array(4).buffer);await tick();await tick();await tick();const c2=await caches.open(storem.TILE_STORE_NAME);await c2.delete('/__strata-tiles/eox/6/1/2');
 ok(await s.get('eox/6/1/2')===null&&!s.has('eox/6/1/2'),'the browser may clear a tile, which then counts as never held');
 ok(await storem.openTileStore({caches:null})===null,'and with no Cache Storage there is no store');
});
await t('tile store: over budget it keeps what is near, used lately and coarse',async()=>{
 const caches=fakeCaches();let clock=1e12;const s=await storem.openTileStore({caches,budgetBytes:1000,setTimer:noTimer,now:()=>clock});
 const near=(z,lon,lat)=>{const n=2**z,X=(lon+180)/360*n,S=Math.sin(lat*Math.PI/180),Y=(0.5-Math.log((1+S)/(1-S))/(4*Math.PI))*n;return `eox/${z}/${Math.floor(X)}/${Math.floor(Y)}`;};
 s.setEye(chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180));
 const home=near(10,6.6,46.5),homeFine=near(14,6.6,46.5),away=near(10,150,-30);
 for(const k of [home,homeFine,away]){s.put(k,new Uint8Array(9).buffer);await tick();await tick();await tick();}
 const key=storem.dropScore;ok(key(away,clock,chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180),clock)>key(homeFine,clock,chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180),clock),'far from the camera goes before fine near it');
 ok(key(homeFine,clock,chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180),clock)>key(home,clock,chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180),clock),'fine before coarse');
 ok(key(home,clock-30*86400000,chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180),clock)>key(home,clock,chart.lonLatToDirection(6.6*Math.PI/180,46.5*Math.PI/180),clock),'and long unused before lately used');
 // Filling it past its budget drops the far one first.
 for(let i=0;i<120&&s.has(away);i++){s.put(near(10,6.6+i*0.4,46.5),new Uint8Array(9).buffer);await tick();await tick();await tick();}
 ok(!s.has(away),'the far tile is gone');ok(s.stats().bytes<=1000,'and the store is inside its budget: '+s.stats().bytes);
});
await t('sources: what counts as unseen is the same in the worker and the engine',async()=>{
 const rust=readFileSync(new URL('../crates/solar-core/src/streaming.rs',import.meta.url),'utf8'),m=/const FINER_IN_VIEW: f64 = ([\d_.]+);/.exec(rust);
 ok(m&&Number(m[1].replace(/_/g,''))===srcm.UNSEEN_RANK,'FINER_IN_VIEW and UNSEEN_RANK: '+(m&&m[1])+' '+srcm.UNSEEN_RANK);
 const {sources}=srcm.resolveSources(null);ok(sources.eox.limits&&sources.swissimage.limits,'budgets on the sources that may have limits');ok(!sources.terrarium.limits,'none on AWS Open Data');
 ok(!srcm.resolveSources({overrides:{eox:{limits:null},swissimage:{limits:null}}}).sources.eox.limits,'and a manifest can lift them');
});
await t('scheduler: cancel frees queue entries and aborts running fetches',async()=>{
 const net=fakeNet(),s=schedm.createScheduler({fetch:net.fetch,perHost:1,global:1}),a=s.request('https://h.test/a'),b=s.request('https://h.test/b'),c=s.request('https://h.test/c');
 await tick();ok(s.stats().inFlight===1&&s.stats().queued===2);
 const errs=[];b.promise.catch(e=>errs.push(e.name));a.promise.catch(e=>errs.push(e.name));
 b.cancel();ok(s.stats().queued===1,'queued entry freed');
 const sig=net.pending[0].signal;a.cancel();ok(sig.aborted,'running fetch aborted');await tick();
 ok(errs.join()==='AbortError,AbortError'&&s.stats().cancelled===2,errs.join());
 ok(net.calls.join()==='https://h.test/a,https://h.test/c','b never fetched, c starts when a frees its slot: '+net.calls);
 net.pending.at(-1).resolve();ok((await c.promise).bytes.byteLength===10);
 a.cancel();// no-op after settle
});
await t('scheduler: cancel with sharing through the tile cache',async()=>{
 const net=fakeNet(),s=schedm.createScheduler({fetch:net.fetch}),c=cachem.createTileCache();
 const load=()=>{const h=s.request('https://h.test/t');return {promise:h.promise.then(r=>({n:r.bytes.byteLength})),cancel:()=>h.cancel(),setPriority:p=>h.setPriority(p)};};
 const pa=c.request('t','A',1,load),pb=c.request('t','B',1,load);await tick();
 c.release('A');await tick();ok(!net.pending[0].signal.aborted,'B still needs it');
 net.pending[0].resolve(42);ok((await pb).n===42&&(await pa).n===42);
 const pc=c.request('u','C',1,()=>{const h=s.request('https://h.test/u');return {promise:h.promise,cancel:()=>h.cancel(),setPriority(){}};});pc.catch(()=>{});await tick();
 const sig=net.take('https://h.test/u').signal;c.release('C');ok(sig.aborted,'no owner left: fetch aborted');
});
await t('scheduler: retries at most twice with exponential backoff and jitter, then reports failed',async()=>{
 const delays=[],net=fakeNet();
 const s=schedm.createScheduler({fetch:net.fetch,backoffMs:100,random:()=>0.5,setTimer:(fn,ms)=>{delays.push(ms);return setTimeout(fn,0);},clearTimer:clearTimeout});
 const h=s.request('https://h.test/x');let err=null;h.promise.catch(e=>err=e);
 for(let n=0;n<3;n++){await tick();await tick();net.take('https://h.test/x').fail(503);}
 await tick();await tick();ok(err&&err.failed&&err.status===503,'failed with status');ok(net.calls.length===3,`${net.calls.length} attempts`);
 ok(delays.join()==='150,300',`delays ${delays}`);ok(s.stats().failed===1&&s.stats().retried===2&&s.stats().inFlight===0);
 // success on the second retry
 const net2=fakeNet(),s2=schedm.createScheduler({fetch:net2.fetch,backoffMs:1,random:()=>0});
 const h2=s2.request('https://h.test/y');await tick();net2.take('https://h.test/y').fail(500);await tick();await tick();await tick();net2.take('https://h.test/y').reject(new Error('network down'));
 await tick();await tick();await tick();net2.take('https://h.test/y').resolve(7);ok((await h2.promise).bytes.byteLength===7&&s2.stats().retried===2&&s2.stats().failed===0);
 // 404 is final, no retry
 const net3=fakeNet(),s3=schedm.createScheduler({fetch:net3.fetch}),h3=s3.request('https://h.test/z');let e3=null;h3.promise.catch(e=>e3=e);await tick();net3.take('https://h.test/z').fail(404);await tick();await tick();
 ok(e3?.status===404&&net3.calls.length===1&&s3.stats().notFound===1&&s3.stats().failed===0,'404 not retried');
});
await t('scheduler: throughput estimate (exponentially weighted bytes per second)',async()=>{
 let clock=0;const net=fakeNet(),s=schedm.createScheduler({fetch:net.fetch,now:()=>clock,ewma:0.3,global:4});
 const hs=[1,2,3,4].map(i=>s.request(`https://h.test/${i}`));await tick();
 for(let i=1;i<=3;i++){clock+=100;net.take(`https://h.test/${i}`).resolve(1000);await tick();}
 near(s.stats().bytesPerSecond,10000,1e-6,'steady 1000 B per 100 ms');
 clock+=1000;net.take('https://h.test/4').resolve(1000);await tick();
 near(s.stats().bytesPerSecond,10000*0.7+1000*0.3,1e-6,'slow body pulls the estimate down');ok(s.stats().bytes===4000);
 await Promise.all(hs.map(h=>h.promise));
});
await t('scheduler: full queue bumps the least urgent request',async()=>{
 const net=fakeNet(),s=schedm.createScheduler({fetch:net.fetch,perHost:1,global:1,maxQueue:2});
 s.request('https://h.test/run');await tick();
 const hi=s.request('https://h.test/hi',{priority:1}),lo=s.request('https://h.test/lo',{priority:9}),mid=s.request('https://h.test/mid',{priority:5});
 let who=[];for(const [n,h] of [['hi',hi],['lo',lo],['mid',mid]])h.promise.catch(e=>who.push(n+':'+e.name));
 await tick();ok(who.join()==='lo:Bumped'&&s.stats().bumped===1&&s.stats().queued===2,who.join()+JSON.stringify(s.stats()));
});

// ---------------------------------------------------------------- optimised builders against the verbatim reference
// tools/Bench-Field-Pages.mjs holds the resample.js that existed before the speed work. Results may differ by one quantisation step.
const refm=await import(pathToFileURL(resolve(root,'tools/Bench-Field-Pages.mjs')).href);
const poolm=await F('pool.js'),decm=await F('field-decoder.js'),fwm=await F('field-worker.js');
const maxByteDiff=(a,b)=>{const x=new Uint8Array(a),y=new Uint8Array(b);ok(x.length===y.length,'length');let m=0;for(let i=0;i<x.length;i++)m=Math.max(m,Math.abs(x[i]-y[i]));return m;};
await t('speed: height pages equal the reference within one quantisation step',()=>{
 const tiles=synHeightTiles();let worst=0,n=0,edge=0;
 const randomPages=Array.from({length:12},()=>{const level=3+Math.floor(rnd()*6),m=2**level;return {face:Math.floor(rnd()*6),level,x:Math.floor(rnd()*m),y:Math.floor(rnd()*m)};});
 for(const page of [{face:4,level:3,x:3,y:4},{face:2,level:5,x:20,y:9},{face:0,level:4,x:5,y:5},{face:2,level:2,x:1,y:1},pageAt(6.63,46.52,7),pageAt(10,87,8),pageAt(179.9,10,6),...randomPages]){
  const a=refm.buildHeightPage(page,tiles.get,SYN),b=rs.buildHeightPage(page,tiles.get,SYN);
  ok(!!a.missing===!!b.missing&&a.reason===b.reason,`missing differs at ${JSON.stringify(page)}: ${a.reason} vs ${b.reason}`);
  if(a.missing)continue;
  const Lw=refm.nodesForPage(page,'height',a.zoom,256);
  if(Math.max(...Lw.X)>=1||Math.min(...Lw.X)<0){ // the reference keys its tile cache by ty*n+tx, so a tile column past the antimeridian collides with the next row: check the new one against the analytic field
   let w=0;for(let j=0;j<264;j+=3)for(let i=0;i<264;i+=3){const [u,v]=heightTexelToChart(page,i,j);w=Math.max(w,Math.abs(dequant(b,j*264+i)-fAnalytic(chartToDirection(page.face,u,v)))-b.scale/2);}
   ok(w<0.05,`wrap page off the analytic field by ${w}`);edge++;continue;
  }
  ok(a.zoom===b.zoom&&a.step===b.step,'zoom and lattice step');near(a.offset,b.offset,1e-9,'offset '+JSON.stringify(page));near(a.scale,b.scale,1e-12,'scale');
  const x=new Uint16Array(a.bytes),y=new Uint16Array(b.bytes);let m=0;for(let i=0;i<x.length;i++)m=Math.max(m,Math.abs(x[i]-y[i]));
  ok(m<=1,`${m} quantisation steps at ${JSON.stringify(page)}`);worst=Math.max(worst,m);n++;
 }
 ok(edge>=1,'at least one antimeridian page');return `${n} pages equal to the reference, worst ${worst} step; ${edge} antimeridian page(s) checked against the analytic field (the reference mis-keys them)`;
});
await t('speed: albedo and overlay pages equal the reference within one byte value',()=>{
 const get=overlayTiles2(),over=OO(SWISS);let worst=0,n=0;
 for(const page of [LAUS,pageAt(6.63,46.52,9),pageAt(7.4,46.9,11),pageAt(2,30,8),{face:4,level:4,x:7,y:9},pageAt(-60,-20,7)]){
  const a=refm.buildAlbedoPage(page,get,OB),b=rs.buildAlbedoPage(page,get,OB);
  ok(!!a.missing===!!b.missing&&a.reason===b.reason,'albedo missing');
  if(!a.missing){worst=Math.max(worst,maxByteDiff(a.bytes,b.bytes));n++;ok(a.zoom===b.zoom);}
  const c=refm.buildOverlayAlbedoPage(page,get,OB,over),d=rs.buildOverlayAlbedoPage(page,get,OB,over);
  ok(!!c.missing===!!d.missing&&c.reason===d.reason,'overlay missing');
  if(!c.missing){worst=Math.max(worst,maxByteDiff(c.bytes,d.bytes));n++;near(c.overlayCoverage,d.overlayCoverage,1e-9,'overlay coverage');}
 }
 ok(worst<=1,`worst ${worst}`);ok(n>=6);return `${n} pages, worst ${worst} level`;
});
await t('speed: table driven sRGB encode equals the reference search on every probe',()=>{
 let bad=0,total=0;const df=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4),probe=l=>{total++;if(rs.linearToSrgbByte(l)!==refm.linearToSrgbByte(l))bad++;};
 for(let k=0;k<300000;k++)probe(k%3===0?rnd():k%3===1?Math.pow(rnd(),3):rnd()*0.01);
 for(let k=0;k<255;k++){const th=df((k+0.5)/255);for(const e of [1-1e-9,1-1e-13,1,1+1e-13,1+1e-9])probe(th*e);probe(k/8192);probe((k+1)/8192-1e-15);}
 for(const l of [0,-0,-1,1,2,NaN,Infinity,-Infinity,1e-300,5e-324])probe(l);
 ok(bad===0,`${bad} of ${total} differ`);return `${total} probes`;
});
await t('speed: lattice and expansion equal the reference to rounding',()=>{
 let worst=0;
 for(const [page,ch] of [[{face:2,level:11,x:1136,y:59},'height'],[{face:4,level:3,x:3,y:4},'albedo'],[pageAt(10,60,5),'height'],[pageAt(6.63,46.52,12),'albedo']]){
  const z=refm.chooseZoom(page,TERRA),A=refm.nodesForPage(page,ch,z,256),B=rs.nodesForPage(page,ch,z,256);
  ok(A.step===B.step&&A.M===B.M,'lattice step');for(let i=0;i<A.X.length;i++)ok(A.X[i]===B.X[i]&&A.Y[i]===B.Y[i],'lattice node '+i);
  const ea=refm.expandNodes(A),eb=rs.expandNodes(B);for(let i=0;i<ea.X.length;i++)worst=Math.max(worst,Math.abs(ea.X[i]-eb.X[i]),Math.abs(ea.Y[i]-eb.Y[i]));
  const xa=refm.exactTexelMap(page,ch),xb=rs.exactTexelMap(page,ch);for(let i=0;i<xa.X.length;i++)ok(xa.X[i]===xb.X[i]&&xa.Y[i]===xb.Y[i],'exact map '+i);
  const ra=refm.requiredTiles(page,{...TERRA,zoomBias:0}),rb=rs.requiredTiles(page,{...TERRA,zoomBias:0});ok(JSON.stringify(ra)===JSON.stringify(rb),'required tiles');
 }
 ok(worst<1e-12,`expansion differs by ${worst}`);return `expansion within ${worst.toExponential(1)}`;
});
await t('zoom bias: default 0, terrarium -1, applied after the spacing rule and before clamping',()=>{
 ok(srcm.SOURCES.terrarium.zoomBias===-1&&!srcm.SOURCES.eox.zoomBias&&!srcm.SOURCES.swissimage.zoomBias,'defaults');
 const plain={...TERRA,zoomBias:0};let coarser=0,clamped=0;
 for(const page of [pageAt(6.63,46.52,11),pageAt(6.63,46.52,8),pageAt(0,0,12),pageAt(60,-30,10),{face:4,level:0,x:0,y:0},pageAt(6.63,46.52,17)]){
  const z0=rs.chooseZoom(page,plain),z1=rs.chooseZoom(page,TERRA),zr=refm.chooseZoom(page,plain);
  ok(z0===zr,'bias 0 equals the reference rule');const raw=rs.chooseZoom(page,{...TERRA,zoomBias:0,minZoom:-99,maxZoom:99});ok(z1===Math.max(TERRA.minZoom,Math.min(TERRA.maxZoom,raw-1)),`raw ${raw} z0 ${z0} z1 ${z1}`);
  if(z1<z0)coarser++;
  ok(rs.requiredTiles(page,TERRA).every(r=>r.z===z1),'tiles come from the biased zoom');
 }
 ok(coarser>=4,'most pages read a coarser zoom');
 ok(rs.chooseZoom({face:4,level:0,x:0,y:0},{...TERRA,minZoom:9,zoomBias:-1})===9,'clamped at the minimum');clamped++;
 ok(rs.chooseZoom(pageAt(6.63,46.52,17),{...TERRA,zoomBias:3})===TERRA.maxZoom,'clamped at the maximum');
 const sw=rs.chooseZoom(pageAt(6.63,46.52,11),{...EOX,zoomBias:0});ok(rs.chooseZoom(pageAt(6.63,46.52,11),{...EOX,zoomBias:-2})===sw-2||sw-2<EOX.minZoom);
});

// ---------------------------------------------------------------- decoder pool
function loopbackWorker(opts={}){ // a real MessageChannel: structured clone and transfer behave as for a Worker
 const ch=new MessageChannel(),log=[];
 const dec=decm.createDecoder({post:(m,tr)=>ch.port2.postMessage(m,tr),decodeImage:opts.decodeImage});
 ch.port2.onmessage=({data})=>{log.push(data.op+(data.kind?':'+data.kind:''));dec.handle(data);};
 ch.port1.unref();ch.port2.unref();
 const w={log,postMessage:(m,tr)=>ch.port1.postMessage(m,tr),terminate(){ch.port1.close();ch.port2.close();},set onmessage(f){ch.port1.onmessage=f;},get onmessage(){return ch.port1.onmessage;},onerror:null,onmessageerror:null};
 return w;
}
function stubWorker(){const w={posted:[],jobs(){return w.posted.filter(m=>m.op!=='init');},postMessage(m){w.posted.push(m);},terminate(){w.dead=true;},onmessage:null,onerror:null,onmessageerror:null,reply(data){w.onmessage({data});}};return w;}
const D_SRC=srcm.resolveSources(null);
// tiles of one page, keyed the way the field worker keys them
async function tilesFor(page,kind){
 const get=kind==='height'?synHeightTiles().get:overlayTiles2(),out=[];
 const map=s=>s.id==='swissimage'?{...s,id:'oo'}:s;
 const need=kind==='height'?rs.requiredTiles(page,D_SRC.height).map(n=>({source:D_SRC.height,...n})):kind==='overlay'?rs.overlayTiles(page,D_SRC.albedo,D_SRC.overlays[0]):rs.requiredTiles(page,D_SRC.albedo).map(n=>({source:D_SRC.albedo,...n}));
 for(const n of need)out.push({key:`${n.source.id}/${n.z}/${n.x}/${n.y}`,tile:get(map(n.source),n.z,n.x,n.y)});
 return out;
}
await t('pool: pages built in a decoder worker equal the local build exactly (height, albedo, overlay)',async()=>{
 const pool=poolm.createPool({spawn:()=>loopbackWorker(),size:2});let n=0;
 for(const [kind,page,build] of [
  ['height',pageAt(6.63,46.52,10),(g)=>rs.buildHeightPage(pageAt(6.63,46.52,10),g,D_SRC.height)],
  ['albedo',pageAt(6.63,46.52,9),(g)=>rs.buildAlbedoPage(pageAt(6.63,46.52,9),g,D_SRC.albedo)],
  ['overlay',LAUS,(g)=>rs.buildOverlayAlbedoPage(LAUS,g,D_SRC.albedo,D_SRC.overlays[0])],
 ]){
  const tiles=await tilesFor(page,kind),m=new Map(tiles.map(x=>[x.key,x.tile])),local=build((s,z,x,y)=>m.get(`${s.id}/${z}/${x}/${y}`));
  ok(!local.missing,`${kind} builds locally`);
  const {result,ms}=await pool.build({kind,overlayId:kind==='overlay'?'swissimage':null,page,tiles});
  ok(Buffer.compare(Buffer.from(local.bytes),Buffer.from(result.bytes))===0,`${kind} bytes differ`);ok(result.offset===local.offset&&result.scale===local.scale&&ms>=0);
  ok(tiles.every(x=>x.tile.heights?x.tile.heights.byteLength>0:x.tile.rgba.byteLength>0),'the caller still owns its tiles (copied, not transferred)');n++;
 }
 pool.close();return `${n} kinds`;
});
await t('pool: decode transfers the input bytes in and the tile out; PNG and image paths',async()=>{
 const w=loopbackWorker({decodeImage:async(b,mime)=>({width:2,height:1,rgba:new Uint8Array([1,2,3,255,4,5,6,255]),mime})}),pool=poolm.createPool({spawn:()=>w,size:1});
 const data=Buffer.alloc(8*4*3);for(let i=0;i<data.length;i++)data[i]=(i*7)&255;
 const png=new Uint8Array(encodePng({w:8,h:4,color:2,data})),buf=png.slice().buffer;
 const tile=await pool.decode('terrarium','image/png',buf);ok(buf.byteLength===0,'input bytes were transferred away');
 ok(tile.width===8&&tile.height===4&&tile.heights.length===32&&tile.heights[0]===data[0]*256+data[1]+data[2]/256-32768,'terrarium tile');
 const p2=await pool.decode('png',null,png.slice().buffer);ok(p2.rgba.length===8*4*4&&p2.rgba[4]===data[3]);
 const img=await pool.decode('image','image/jpeg',new Uint8Array([1,2,3]).buffer);ok(img.rgba[4]===4&&img.mime==='image/jpeg');
 let err=null;try{await pool.decode('terrarium','image/png',new Uint8Array([1,2,3]).buffer);}catch(e){err=e;}ok(err?.name==='DecodeFailed','a bad PNG is a decode failure, not a pool failure');
 ok(pool.alive===1&&pool.stats().poolFailed===0);pool.close();
});
await t('pool: least busy worker first, depth limit, queue in priority order, decodes before builds',async()=>{
 const ws=[stubWorker(),stubWorker(),stubWorker()],pool=poolm.createPool({spawn:i=>ws[i],size:3,maxDepth:2});
 const sub=(p,o)=>{const q=pool.decode('png',null,new ArrayBuffer(4),{priority:p,...o});q.catch(()=>{});return q;};
 for(let i=0;i<6;i++)sub(10+i);
 const counts=ws.map(w=>w.posted.filter(m=>m.op==='decode').length);ok(counts.join()==='2,2,2',`spread ${counts}`);ok(pool.stats().poolBusy===6&&pool.stats().poolSize===3);
 const late=[sub(5),sub(1)],b=pool.build({kind:'height',page:{},tiles:[]}).catch(()=>{});sub(7);
 ok(pool.stats().poolQueued===4);
 // free one slot on worker 1: the next job is the most urgent decode (priority 1), not the earlier arrival or the build
 const first=ws[1].posted.find(m=>m.op==='decode');ws[1].reply({op:'decoded',id:first.id,tile:{width:1,height:1,rgba:new Uint8Array(4)}});
 const next=ws[1].posted.at(-1);ok(next.op==='decode'&&next.id!==first.id,'a decode was dispatched');
 const order=[];for(const w of ws)for(const m of w.posted)order.push(m);
 ok(order.filter(m=>m.op==='build').length===0,'the build waits behind decodes');
 const idOf=m=>m.id;const posted=ws.flatMap(w=>w.posted).filter(m=>m.op==='decode').sort((a,b2)=>idOf(a)-idOf(b2));
 ok(posted.length===7,`${posted.length} decodes sent`);
 pool.close();
});
await t('pool: a cancelled job that has not started never starts',async()=>{
 const w=stubWorker(),pool=poolm.createPool({spawn:()=>w,size:1,maxDepth:1});let cancel=false;
 const first=pool.build({kind:'height',page:{},tiles:[]}),second=pool.build({kind:'height',page:{x:2},tiles:[]},{isCancelled:()=>cancel}),third=pool.build({kind:'height',page:{x:3},tiles:[]});
 second.catch(()=>{});third.catch(()=>{});
 ok(w.jobs().length===1);cancel=true;
 w.reply({op:'built',id:w.jobs()[0].id,result:{bytes:new ArrayBuffer(2)},ms:1});await first;
 let err=null;try{await second;}catch(e){err=e;}ok(err?.name==='Cancelled','rejected as Cancelled');
 ok(w.jobs().length===2&&w.jobs()[1].page.x===3,'the next job went to the worker, the cancelled one never did');
 w.reply({op:'built',id:w.jobs()[1].id,result:{},ms:1});await third;pool.close();
});
await t('pool: a failing worker is dropped, its jobs reject as PoolFailed, the rest keep working; all dead rejects',async()=>{
 const ws=[stubWorker(),stubWorker()],pool=poolm.createPool({spawn:i=>ws[i],size:2,maxDepth:1});
 const a=pool.decode('png',null,new ArrayBuffer(4)),b=pool.decode('png',null,new ArrayBuffer(4)),c=pool.decode('png',null,new ArrayBuffer(4));c.catch(()=>{});
 a.catch(()=>{});const ea=[];a.catch(e=>ea.push(e.name));
 ws[0].onerror({message:'boom',preventDefault(){}});await tick();
 ok(ea[0]==='PoolFailed'&&ws[0].dead,'in-flight job of the dead worker rejects');
 ok(pool.stats().poolSize===1&&pool.stats().poolFailed===1&&/boom/.test(pool.stats().poolError),JSON.stringify(pool.stats()));
 ws[1].reply({op:'decoded',id:ws[1].jobs()[0].id,tile:{}});await b;
 ok(ws[1].jobs().length===2,'queued job moved to the surviving worker');
 ws[1].onerror({message:'second'});await tick();
 let err=null;try{await c;}catch(e){err=e;}ok(err?.name==='PoolFailed');
 err=null;try{await pool.decode('png',null,new ArrayBuffer(4));}catch(e){err=e;}ok(err?.name==='PoolFailed'&&pool.alive===0);
 const none=poolm.createPool({spawn:()=>{throw Error('no Worker here');},size:3});ok(none.alive===0&&none.stats().poolFailed===3&&/no Worker/.test(none.stats().poolError));
 ok(poolm.poolSizeFor(8)===4&&poolm.poolSizeFor(4)===2&&poolm.poolSizeFor(2)===1&&poolm.poolSizeFor(1)===1&&poolm.poolSizeFor(undefined)===2);
});

// ---------------------------------------------------------------- field worker with a pool, fallback and pack
function fakeTerrariumFetch(delay=0,log=[]){
 // Heights from 256 m up, clear of the sea and of the lift that holds low land above it, so that a page depends only on the build.
 const png=(()=>{const data=Buffer.alloc(256*256*3);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const o=(y*256+x)*3;data[o]=129;data[o+1]=(x>>1)&255;data[o+2]=y&255;}return new Uint8Array(encodePng({w:256,h:256,color:2,data}));})();
 const fetch=async(url,{signal}={})=>{
  log.push(url);if(delay)await new Promise(r=>setTimeout(r,delay));if(signal?.aborted)throw Object.assign(new Error('aborted'),{name:'AbortError'});
  if(url.endsWith('manifest.json'))return {ok:true,status:200,json:async()=>({attribution:['Pack credit A','Pack credit B']}),clone(){return this;},arrayBuffer:async()=>new ArrayBuffer(0)};
  return {ok:true,status:200,arrayBuffer:async()=>png.slice().buffer};
 };
 return {fetch,log,png};
}
function harness(data,env){
 const ch=new MessageChannel(),msgs=[];ch.port2.onmessage=({data:m})=>msgs.push(m);ch.port1.unref();ch.port2.unref();
 // These source fixtures contain DEM/imagery only. An unrelated failed vector
 // metadata request would mark every page provisional and invalidate the
 // imagery-retry/disk-cache assertions. Hydrography has its own source tests.
 const f=fwm.initField({type:'init',port:ch.port1,manifest:null,...data},{statsMs:15,createVectors:()=>null,...env});
 return {f,msgs,send:m=>ch.port2.postMessage(m),done:()=>{f.close();ch.port1.close();ch.port2.close();},
  until:async(fn,ms=5000)=>{const t0=Date.now();for(;;){const v=fn();if(v)return v;if(Date.now()-t0>ms)throw Error('timeout waiting; messages: '+JSON.stringify(msgs.slice(-4).map(m=>({...m,bytes:undefined}))));await new Promise(r=>setTimeout(r,5));}}};
}
const wantH=(id,page,priority=0)=>({id,...page,channel:'height',priority});
const NO_BUDGETS={manifest:{overrides:{eox:{limits:null},swissimage:{limits:null}}}};
const ONE_AT_A_TIME={manifest:{overrides:{eox:{limits:{tilesPerSecond:5,burst:1,unseenPerSecond:1}},swissimage:{limits:null}}}};
await t('field worker: pages are built in the pool, equal the local build, and stats report the pool',async()=>{
 const net=fakeTerrariumFetch(),workers=[],page=pageAt(6.63,46.52,10);
 const h=harness({},{fetch:net.fetch,poolSize:3,spawn:i=>{const w=loopbackWorker();workers.push(w);return w;}});
 h.send({type:'want',pages:[wantH(1,page),wantH(2,{...page,x:page.x+1}),wantH(3,{...page,y:page.y+1})],cancel:[]});
 await h.until(()=>h.msgs.filter(m=>m.type==='page').length===3);
 const pg=h.msgs.find(m=>m.type==='page'&&m.id===1);ok(pg.bytes.byteLength===139392&&pg.channel==='height'&&pg.source==='terrarium');
 const tile=await pngm.decodeTerrarium(net.png),local=rs.buildHeightPage(page,()=>tile,D_SRC.height);
 ok(Buffer.compare(Buffer.from(local.bytes),Buffer.from(pg.bytes))===0&&pg.offset===local.offset&&pg.scale===local.scale,'bytes equal the local build');
 ok(workers.some(w=>w.log.includes('decode:terrarium'))&&workers.some(w=>w.log.includes('build:height')),'decoded and built in the pool: '+workers.map(w=>w.log.join('|')));
 const st=await h.until(()=>h.msgs.findLast(m=>m.type==='stats'&&m.completed===3));
 ok(st.poolSize===3&&st.poolBusy===0&&st.poolBuilds===3&&st.localBuilds===0&&st.packError===null&&st.resampleMsMean>0,JSON.stringify(st));
 for(const k of ['inFlight','queued','completed','failed','missing','cancelled','bytes','bytesPerSecond','resampleMsMean','resampleMsP95','cacheBytes'])ok(k in st,'stat '+k+' kept');
 ok(h.msgs.some(m=>m.type==='ready')&&h.msgs.some(m=>m.type==='attribution'&&m.sources.some(s=>/Terrain Tiles/.test(s))),'ready and attribution');
 h.done();
});
await t('field worker: no pool (spawn fails) or a dying decoder still streams, reported in stats',async()=>{
 const page=pageAt(6.63,46.52,10);
 const net=fakeTerrariumFetch(),h=harness({},{fetch:net.fetch,poolSize:2,spawn:()=>{throw Error('Worker blocked');}});
 h.send({type:'want',pages:[wantH(1,page)],cancel:[]});await h.until(()=>h.msgs.some(m=>m.type==='page'));
 let st=await h.until(()=>h.msgs.findLast(m=>m.type==='stats'&&m.completed===1));ok(st.poolSize===0&&/Worker blocked/.test(st.poolError)&&st.localBuilds===1&&st.poolBuilds===0,JSON.stringify(st));h.done();
 // a decoder that dies on its first job: the page is still delivered
 const net2=fakeTerrariumFetch();let killed=null;
 const h2=harness({},{fetch:net2.fetch,poolSize:1,spawn:()=>{const w=stubWorker();killed=w;const post=w.postMessage;w.postMessage=(m)=>{post(m);if(m.op!=='init')queueMicrotask(()=>w.onerror({message:'decoder crashed'}));};return w;}});
 h2.send({type:'want',pages:[wantH(5,page)],cancel:[]});await h2.until(()=>h2.msgs.some(m=>m.type==='page'&&m.id===5));
 st=await h2.until(()=>h2.msgs.findLast(m=>m.type==='stats'&&m.completed===1));ok(st.poolSize===0&&st.poolFailed===1&&/decoder crashed/.test(st.poolError)&&st.localBuilds===1,JSON.stringify(st));
 ok(net2.log.length>=2*1&&killed.dead,'the lost bytes were fetched again');h2.done();
});
await t('field worker: a cancelled page does not start its build; tiles in the LRU are reused',async()=>{
 const net=fakeTerrariumFetch(20),workers=[],page=pageAt(6.63,46.52,10);
 const h=harness({},{fetch:net.fetch,poolSize:1,spawn:()=>{const w=loopbackWorker();workers.push(w);return w;}});
 h.send({type:'want',pages:[wantH(1,page)],cancel:[]});await new Promise(r=>setTimeout(r,2));h.send({type:'want',pages:[],cancel:[1]});
 await new Promise(r=>setTimeout(r,120));
 ok(!h.msgs.some(m=>m.type==='page'||m.type==='failed'),'no page for a cancelled want');ok(!workers[0].log.includes('build:height'),'no build started: '+workers[0].log);
 const st=await h.until(()=>h.msgs.findLast(m=>m.type==='stats'));ok(st.cancelled===1&&st.completed===0);h.done();
});
await t('site: the root page is the explorer page, and has every control the script sets',async()=>{
 const page=n=>readFileSync(resolve(root,'web',n),'utf8').replace(/\r\n/g,'\n');
 const main=page('explorer.html');ok(page('index.html')===main,'web/index.html differs from web/explorer.html: the root crashed at startup for a milestone this way');
 const script=readFileSync(resolve(root,'web/explorer.js'),'utf8'),missing=[...new Set([...script.matchAll(/\$\('([a-z0-9-]+)'\)\.value=/g)].map(m=>m[1]))].filter(id=>!main.includes(`id="${id}"`));
 ok(missing.length===0,'controls the script sets but the page lacks: '+missing.join(' '));
});
await t('water: a flat region counts as a lake only in a basin and under water-coloured imagery',async()=>{
 const {flatRegions,isLake,NO_WATER}=await import('../web/field/water.js');
 const w=256,z=12,x=2124,y=1449,tile=f=>{const heights=new Float32Array(w*w);for(let j=0;j<w;j++)for(let i=0;i<w;i++)heights[j*w+i]=f(i,j);return {heights,width:w,height:w};};
 const disc=(i,j)=>Math.hypot(i-128,j-128)<60;
 const lake=tile((i,j)=>disc(i,j)?371:380+0.37*i+0.61*j+Math.sin(i*j*0.01));
 const regions=flatRegions(lake,z,y,null);ok(regions.length===1&&regions[0].level===371,`regions ${regions.length}`);
 ok(flatRegions(tile((i,j)=>380+0.37*i+0.61*j+Math.sin(i*j*0.01)),z,y,null).length===0,'sloping ground has no flat region');
 const speck=tile((i,j)=>Math.hypot(i-128,j-128)<2?371:380+0.37*i+0.61*j);ok(flatRegions(speck,z,y,null).length===0,'a speck is below the area limit');
 const image=c=>{const rgba=new Uint8Array(w*w*4);for(let o=0;o<w*w;o++){rgba.set(c,o*4);}return {rgba,width:w,height:w};};
 // Bytes in sRGB, as read from recorded tiles: lake about 8,32,36; desert about 150,110,70; forest about 10,40,14.
 const water=image([8,32,36,255]),desert=image([150,110,70,255]),forest=image([10,40,14,255]);
 ok(isLake(regions[0],lake,z,x,y,water,z),'dark blue water is a lake');
 ok(!isLake(regions[0],lake,z,x,y,desert,z),'a bright brown flat is not');
 const small=flatRegions(tile((i,j)=>Math.hypot(i-128,j-128)<5?371:380+0.37*i+0.61*j),z,y,null)[0];
 ok(small&&!isLake(small,tile((i,j)=>Math.hypot(i-128,j-128)<5?371:380+0.37*i+0.61*j),z,x,y,forest,z),'a small flat under forest colour is not');
 ok(isLake(regions[0],lake,z,x,y,forest,z),'a large flat under dark green is: forest is not flat to the centimetre over ten hectares');
 const mesa=tile((i,j)=>disc(i,j)?371:300-Math.hypot(i-128,j-128)*0.1);
 ok(!isLake(flatRegions(mesa,z,y,null)[0],mesa,z,x,y,water,z),'a flat top with lower ground around it is not');
 ok(NO_WATER<-1000);
});
await t('water: sea with rounding noise is sea, never a lake, and keeps its floor',async()=>{
 const {flatRegions,applyWater,NO_WATER}=await import('../web/field/water.js');
 const {findSea}=await import('../web/field/seabed.js');
 const w=256,z=12,y=1484,heights=new Float32Array(w*w);
 for(let j=0;j<w;j++)for(let i=0;i<w;i++)heights[j*w+i]=i<40?500+i+j*0.3:((i*7+j*13)%97===0?(i%2?1:-1)/256:0);
 const tile={heights,width:w,height:w},sea=findSea(tile,z,2152,y);
 ok(flatRegions(tile,z,y,sea.mask).length===0,'no lake at sea level');
 const ph=new Float32Array(16).fill(-600),parent={heights:ph,width:4,height:4};
 applyWater(tile,{z,x:2152,y,seabedZoom:10,sea,parent,lakes:[],neighbours:new Map()});
 let shallowest=-Infinity;for(let j=0;j<w;j++)for(let i=40;i<w;i++)shallowest=Math.max(shallowest,tile.heights[j*w+i]);
 ok(shallowest<=-3,'floor everywhere, shallowest '+shallowest);ok(tile.water[100*w+100]===0&&tile.water[100*w+10]===NO_WATER,'levels');
});
await t('water: applyWater marks levels and lowers a bed that deepens from the shore and joins across tiles',async()=>{
 const {flatRegions,isLake,applyWater,NO_WATER}=await import('../web/field/water.js');
 const {findSea}=await import('../web/field/seabed.js');
 const w=256,z=13,y=2899,span=w*2;
 // One lake across two side-by-side tiles, with its shore just across their shared border on one row band.
 const lakeAt=(gx,gy)=>{const inside=Math.hypot(gx-span/2,(gy-128)*1.2)<170&&!(gy>=100&&gy<130&&gx>=w+3&&gx<w+60);return inside;};
 const make=dx=>{const heights=new Float32Array(w*w);for(let j=0;j<w;j++)for(let i=0;i<w;i++){const gx=i+dx*w;heights[j*w+i]=lakeAt(gx,j)?371:380+0.37*gx+0.61*j+Math.sin(gx*j*0.01);}return {heights,width:w,height:w};};
 const left=make(0),right=make(1),rawRight={heights:right.heights.slice(),width:w,height:w},rawLeft={heights:left.heights.slice(),width:w,height:w};
 const blue=(()=>{const rgba=new Uint8Array(w*w*4);for(let o=0;o<w*w;o++)rgba.set([8,32,36,255],o*4);return {rgba,width:w,height:w};})();
 const run=(tile,x)=>{const sea=findSea(tile,z,x,y),lakes=flatRegions(tile,z,y,sea.mask).filter(r=>isLake(r,tile,z,x,y,blue,z));applyWater(tile,{z,x,y,seabedZoom:10,sea,parent:null,lakes});return lakes;};
 const x=4248;ok(run(left,x).length===1,'lake found on the left');ok(run(right,x+1).length===1,'lake found on the right');
 const at=(t,i,j)=>t.heights[j*w+i];
 ok(left.water[128*w+200]===371,'level kept');ok(left.water[5*w+5]===NO_WATER,'dry land stays dry');ok(at(left,5,5)>=380,'dry land keeps its height');
 const centre=at(left,160,128),shore=at(left,20,128);
 ok(centre<371-15,'the middle is deep: '+centre);ok(shore>centre,'near a shore in the tile the bed is shallower: '+shore+' against '+centre);
 // Each tile answers from itself alone, so the same tile gives the same bed whatever its neighbours hold.
 const again=make(0);run(again,x);ok(again.heights.every((v,o)=>v===left.heights[o]),'a tile answers from itself alone');
 const dry={heights:new Float32Array(w*w).map((_,o)=>500+o*0.01),width:w,height:w};applyWater(dry,{z,x,y,seabedZoom:10,sea:findSea(dry,z,x,y),parent:null,lakes:[],neighbours:new Map()});ok(dry.water===null,'no water at all is null');
 const coarse={heights:new Float32Array(4).fill(-50),width:2,height:2};applyWater(coarse,{z:8,x:0,y:0,seabedZoom:10,sea:findSea(coarse,8,0,0),parent:null,lakes:[],neighbours:new Map()});ok(coarse.water.every(v=>v===0),'deep ground is sea');
});
await t('water: a height page with water carries water texels and a grid of levels, and one value where it has none',async()=>{
 const {NO_WATER,WATER_GRID}=await import('../web/field/water.js');
 const page=pageAt(6.7,46.45,10),src=D_SRC.height,R=6371000;
 const dirC=lonLatToDirection(6.7*D2R,46.45*D2R),radius=2500;
 const pix=(z,x,y,i,j)=>{const X=(x+(i+.5)/256)/2**z,Y=(y+(j+.5)/256)/2**z;const lon=(X-.5)*2*Math.PI,lat=Math.atan(Math.sinh(Math.PI*(1-2*Y)));return lonLatToDirection(lon,lat);};
 const dist=(a,b)=>Math.acos(Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))*R;
 const cache=new Map(),get=(s,z,x,y)=>{const k=`${z}/${x}/${y}`;if(!cache.has(k)){const heights=new Float32Array(65536),water=new Float32Array(65536).fill(NO_WATER);for(let j=0;j<256;j++)for(let i=0;i<256;i++){const inside=dist(pix(z,x,y,i,j),dirC)<radius;heights[j*256+i]=inside?340:400;if(inside)water[j*256+i]=371;}cache.set(k,{heights,width:256,height:256,water});}return cache.get(k);};
 const r=rs.buildHeightPage(page,get,src);ok(!r.missing&&r.texels&&r.bytes.byteLength===264*264*4&&r.water.length===WATER_GRID*WATER_GRID*4,'texels and planar grid present');
 let inner=0,outer=0,wrongInner=0,wrongOuter=0;const G=WATER_GRID;
 const cellSize=R/128/2**page.level;
 for(let cy=0;cy<G;cy++)for(let cx=0;cx<G;cx++){
  const [u,v]=heightTexelToChart(page,3+cx*8+4,3+cy*8+4),d=dist(chartToDirection(page.face,u,v),dirC);
  const value=r.water[(cy*G+cx)*4];
  if(d<radius-cellSize*8){inner++;if(value!==371)wrongInner++;}
  if(d>radius+cellSize*32){outer++;if(value!==NO_WATER)wrongOuter++;}
 }
 ok(inner>10&&outer>50&&wrongInner===0&&wrongOuter===0,`inner ${inner} wrong ${wrongInner}, outer ${outer} wrong ${wrongOuter}`);
 // Texels: under water inside the lake, dry outside it, and the surface (height plus excess) at the level.
 const u16=new Uint16Array(r.bytes);let wetOut=0,dryIn=0,surface=0;
 for(let j=3;j<259;j+=4)for(let i=3;i<259;i+=4){const [u,v]=heightTexelToChart(page,i,j),d=dist(chartToDirection(page.face,u,v),dirC),k=j*264+i,e=rs.waterExcessValue(u16[264*264+k]),h=r.offset+r.scale*u16[k];
  if(d<radius-cellSize*8){if(!(e>0))dryIn++;else surface=Math.max(surface,Math.abs(h+e-371));}if(d>radius+cellSize*8&&e>0)wetOut++;}
 ok(dryIn===0&&wetOut===0&&surface<.01,`texels: dry inside ${dryIn}, wet outside ${wetOut}, surface error ${surface} m`);
 const plain=(s,z,x,y)=>{const heights=new Float32Array(65536).fill(500);return {heights,width:256,height:256,water:null};};
 const none=rs.buildHeightPage(page,plain,src);ok(none.water.length===1&&none.water[0]===NO_WATER,'one value for a page with no water');
});
// A tile whose land carries the pixel noise real land has, from a small hash: the only thing that tells it from sea when both lie low.
const rough=(i,j,amount=0.12)=>{let v=Math.imul(i+1,0x27d4eb2d)^Math.imul(j+1,0x165667b1);v^=v>>>15;v=Math.imul(v,0x2c1b3c6d);v^=v>>>12;return ((v>>>0)/4294967295-.5)*2*amount;};
const seaTile=(w,f)=>{const heights=new Float32Array(w*w);for(let j=0;j<w;j++)for(let i=0;i<w;i++)heights[j*w+i]=f(i,j);return {heights,width:w,height:w};};
await t('seabed: sea is found at either kind of data, and low land is told from it by curvature, at no cost to a shore',async()=>{
 const {findSea,fillSeabed,seaHasZeros}=await import('../web/field/seabed.js');
 const w=256,z=12,x=2064,y=1384,at=(s,i,j)=>s.mask[j*w+i]===1;
 // Real depths: a smooth, sloping floor, as at the Somme. Nothing in it reads zero.
 const depths=seaTile(w,(i,j)=>i<128?-20+0.03*i+0.01*j:30+rough(i,j));let s=findSea(depths,z,x,y);
 ok(at(s,60,60)&&at(s,5,200),'smooth depths are sea');ok(!at(s,200,60),'land is not');ok(!seaHasZeros(depths,s),'and need no floor from a coarser tile');
 const before=depths.heights.slice();ok(fillSeabed(depths,s,null,z,x,y,10)>0&&depths.heights[60*w+60]===before[60*w+60],'and keep the depths they have');
 // A flat zero with rounding noise, as at Portofino.
 const zeros=seaTile(w,(i,j)=>i<128?((i*7+j*13)%97===0?(i%2?1:-1)/256:0):30+rough(i,j));s=findSea(zeros,z,x,y);
 ok(at(s,60,60),'a flat zero is sea');ok(seaHasZeros(zeros,s),'and needs a floor');
 const coarse={heights:new Float32Array(64).fill(-600),width:8,height:8};fillSeabed(zeros,s,coarse,z,x,y,10);ok(zeros.heights[60*w+60]<-3,'which comes from the coarser tile: '+zeros.heights[60*w+60]);
 const none=seaTile(16,()=>0);fillSeabed(none,findSea(none,z,x,y),null,z,x,y,10);ok(none.heights.every(v=>v===-3),'or at the shallow floor with none');
 // Land below sea level: rough, however low, as in Flevoland.
 const polder=seaTile(w,(i,j)=>-3+rough(i,j));ok(findSea(polder,z,x,y).mask.every(v=>v===0),'a polder is not sea');
 // Deep and rough is sea all the same: a steep coast's floor.
 const steep=seaTile(w,(i,j)=>-500+rough(i,j,30));ok(findSea(steep,z,x,y).mask.every(v=>v===1),'deep rough floor is sea');
 // A rough fringe along the shore belongs to the sea beside it.
 const fringe=seaTile(w,(i,j)=>i<100?-20:i<108?-1+rough(i,j):30+rough(i,j));s=findSea(fringe,z,x,y);ok(at(s,104,128),'a rough low fringe is sea');ok(!at(s,120,128),'the land behind it is not');
 // A rough patch in open sea stays sea, where a polder with land around it does not.
 const patch=seaTile(w,(i,j)=>Math.hypot(i-128,j-128)<20?-4+rough(i,j):-12+0.01*i);s=findSea(patch,z,x,y);ok(at(s,128,128),'a rough patch closed in by sea is sea');
 const inland=seaTile(w,(i,j)=>i<60?-20:Math.hypot(i-180,j-128)<40?-4+rough(i,j):30+rough(i,j));s=findSea(inland,z,x,y);ok(!at(s,180,128),'a polder behind land is not');
 // A small smooth patch on land is a pond or a flat field, not the sea.
 const pond=seaTile(w,(i,j)=>Math.hypot(i-128,j-128)<6?-1:30+rough(i,j));ok(findSea(pond,z,x,y).mask.every(v=>v===0),'a small low patch inside a tile is not sea');
});
await t('seabed: a shared border gets the same answer from both tiles, whichever holds the seed',async()=>{
 const {findSea}=await import('../web/field/seabed.js');
 // Sea and low land cut by a tile border, where the old rule, spreading inside one tile, gave a square.
 const w=256,z=12,y=1384,field=(gx,gy)=>gx<256+40+0.3*gy?-5+0.01*gx:-2+rough(gx,gy);
 const left=findSea(seaTile(w,(i,j)=>field(i,j)),z,2064,y),right=findSea(seaTile(w,(i,j)=>field(i+w,j)),z,2065,y);
 let differ=0,both=0;for(let j=0;j<w;j++){if(field(w-1,j)>0||field(w,j)>0)continue;both++;if(left.mask[j*w+w-1]!==right.mask[j*w])differ++;}
 ok(both===w&&differ===0,'differ '+differ+' of '+both);
 // Open sea with no seed in the tile by the old rule: all of it is sea, in a tile of depths only.
 const shallow=findSea(seaTile(w,(i,j)=>-2-0.002*i),z,2064,y);ok(shallow.mask.every(v=>v===1),'a shallow tile with no land is all sea');
});
await t('seabed: inland basins are not the sea, and dry land is held above the water',async()=>{
 const {findSea,liftDryLand,LOW_LAND}=await import('../web/field/seabed.js');
 const {flatRegions,applyWater,NO_WATER}=await import('../web/field/water.js');
 const w=256,tileAt=(lon,lat,z)=>{const n=2**z,s=Math.sin(lat*Math.PI/180);return [Math.floor((lon+180)/360*n),Math.floor((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n)];};
 // Death Valley: below sea level and rough, deep enough to pass for sea anywhere else.
 let [x,y]=tileAt(-116.85,36.25,12);const valley=seaTile(w,(i,j)=>-80+rough(i,j));const dv=findSea(valley,12,x,y);ok(dv.mask.every(v=>v===0),'Death Valley is not sea');
 const measured=valley.heights.slice();liftDryLand(valley,dv,()=>false);ok(valley.heights.every((v,o)=>v===measured[o]),'and keeps its measured heights');
 // The Dead Sea: flat, so a lake if flat, and never sea.
 [x,y]=tileAt(35.5,31.5,12);const dead=seaTile(w,()=>-412);const ds=findSea(dead,12,x,y);ok(ds.mask.every(v=>v===0),'the Dead Sea is not sea');ok(flatRegions(dead,12,y,ds.mask).length===1,'it is a flat region');
 // The Caspian stands at its own level, whatever its data reads.
 [x,y]=tileAt(50,42,12);const caspian=seaTile(w,(i,j)=>-20+0.01*i);const cs=findSea(caspian,12,x,y);ok(cs.mask.every(v=>v===1)&&cs.levels[100]===-28,'the Caspian stands at -28');
 applyWater(caspian,{z:12,x,y,seabedZoom:10,sea:cs,parent:null,lakes:[],neighbours:new Map()});ok(caspian.water[100]===-28&&caspian.heights[100]<=-31,'with its bed below that: '+caspian.heights[100]);
 // Elsewhere, what stays dry below the water is held above it, smoothly, and high ground does not move.
 [x,y]=tileAt(5.5,52.5,12);const low=seaTile(w,(i,j)=>i<128?-3+rough(i,j):0.2*(i-128)+rough(i,j));const ls=findSea(low,12,x,y);const raw=low.heights.slice();
 applyWater(low,{z:12,x,y,seabedZoom:10,sea:ls,parent:null,lakes:[],neighbours:new Map()});
 ok(low.heights[60*w+60]>=LOW_LAND&&low.water===null,'a polder stands above sea level: '+low.heights[60*w+60]);
 let up=0;for(let o=0;o<low.heights.length;o++)if(raw[o]>=LOW_LAND+3)up=Math.max(up,Math.abs(low.heights[o]-raw[o]));ok(up===0,'ground from 3.5 m up does not move: '+up);
 let most=0;for(let o=0;o<low.heights.length;o++)if(raw[o]>0)most=Math.max(most,low.heights[o]-raw[o]);ok(most<=0.68,'land above sea level moves little: '+most);
 ok(NO_WATER<-1000);
});
await t('seabed: the shoreline follows imagery past the height data\'s coast, and stops at any edge',async()=>{
 const {findSea,shoreFromImage,fillSeabed,tileSeeds,seaColour}=await import('../web/field/seabed.js');
 const {applyWater}=await import('../web/field/water.js');
 const applyWaterForTest=(tile,sea,z,x,y)=>applyWater(tile,{z,x,y,seabedZoom:10,sea,parent:null,lakes:[],neighbours:new Map()});
 const w=256,z=12,x=2064,y=1384,sand=[190,170,130,255],field=[24,40,22,255],deep=[8,20,30,255];
 const image=f=>{const rgba=new Uint8Array(w*w*4);for(let j=0;j<w;j++)for(let i=0;i<w;i++)rgba.set(f(i,j),(j*w+i)*4);return {rgba,width:w,height:w};};
 // The height data's coast at column 80, the real shore at column 120: sea-coloured imagery on dry land between them, then a beach and land.
 const heights=(i,j)=>i<80?-12+0.1*i:i<140?4+rough(i,j,1.5):30+rough(i,j);
 const photo=(i,j)=>i<120?deep:i<126?sand:field;
 const tile=seaTile(w,heights),sea=findSea(tile,z,x,y);ok(!sea.mask[128*w+100],'before: the strip is dry');
 ok(shoreFromImage(tile,sea,image(photo),z,y)>0,'pixels added');
 ok(sea.mask[128*w+100]&&sea.mask[128*w+118],'the strip is water up to the real shore');ok(!sea.mask[128*w+122]&&!sea.mask[128*w+200],'the beach and land are not');
 fillSeabed(tile,sea,null,z,x,y,10);ok(tile.heights[128*w+100]<0,'its bed is under water: '+tile.heights[128*w+100]);
 ok(tile.heights[128*w+119]>tile.heights[128*w+100],'and falls away from the new shore');
 // The land meets the water low, so that the waterline is a contour, whatever stands behind it.
 const cliff=seaTile(w,(i,j)=>i<120?-20:i<121?40+rough(i,j):150+rough(i,j)),cs=findSea(cliff,z,x,y);shoreFromImage(cliff,cs,image((i,j)=>i<120?deep:sand),z,y);
 ok(cs.beach&&cs.beach[128*w+120]===1&&!cs.beach[128*w+125],'the first land pixel is the beach');
 applyWaterForTest(cliff,cs,z,x,y);ok(cliff.heights[128*w+120]<=1.1&&cliff.heights[128*w+125]>100,'it stands low, and the land behind it does not: '+cliff.heights[128*w+120]);
 // At a coarse zoom a pixel is kilometres wide: the same slope, not a metre of beach that flattens the coast's mountains.
 const coarseCliff=seaTile(w,(i,j)=>i<120?-20:400+rough(i,j)),ccs=findSea(coarseCliff,6,32,21);shoreFromImage(coarseCliff,ccs,image((i,j)=>i<120?deep:sand),6,21);applyWaterForTest(coarseCliff,ccs,6,32,21);
 ok(coarseCliff.heights[128*w+120]>10&&coarseCliff.heights[128*w+120]<200,'a coarse beach scales with its pixel: '+coarseCliff.heights[128*w+120]);
 // A cliff in the same colour stays land, and so does dark land past an edge, however close its colour.
 const high=seaTile(w,(i,j)=>i<80?-12:200+rough(i,j)),hs=findSea(high,z,x,y);shoreFromImage(high,hs,image((i,j)=>deep),z,y);ok(!hs.mask[128*w+120],'ground far above the sea is not lowered');
 const edge=seaTile(w,(i,j)=>i<80?-12:4+rough(i,j)),es=findSea(edge,z,x,y);
 shoreFromImage(edge,es,image((i,j)=>i<100?deep:[deep[0]+7,deep[1]+7,deep[2]+7,255]),z,y);ok(es.mask[128*w+95]&&!es.mask[128*w+105],'an edge in the colour stops it');
 // A tile wholly inside the strip has no sea of its own: it starts from the tile above, or it would be a dry square.
 const inside=seaTile(w,(i,j)=>4+rough(i,j,1.5)),own=findSea(inside,z,x,y);ok(!own.mask.includes(1),'no sea of its own');
 const parent=new Uint8Array(w*w).fill(1),seeds=tileSeeds(parent,w,z,x,y,10,w,w);ok(seeds.every(v=>v===1),'seeds from above');
 ok(shoreFromImage(inside,own,image((i,j)=>deep),z,y,seeds)>0&&own.mask.every(v=>v===1),'and it is all water');
 ok(seaColour(image((i,j)=>deep),parent,w,w).median[2]===deep[2],'sea colour is read from the sea');
 // Green and muddy water is water by matching its own sea, which dark green land does not.
 const green=[44,79,53,255],greenTile=seaTile(w,(i,j)=>i<80?-12+0.01*i:2+rough(i,j,1.5)),gs=findSea(greenTile,z,x,y);
 shoreFromImage(greenTile,gs,image((i,j)=>green),z,y);ok(gs.mask[128*w+100],'green water matching its sea is water');
 const fields=seaTile(w,(i,j)=>i<80?-12+0.01*i:2+rough(i,j,1.5)),fs=findSea(fields,z,x,y);
 shoreFromImage(fields,fs,image((i,j)=>i<80?deep:field),z,y);ok(!fs.mask[128*w+100],'dark green fields beside dark blue sea are not');
});
await t('seabed: the review of the shore: basins by the pixel, cliffs kept, the ramp only beside the shore, seeds inside the sea above',async()=>{
 const {findSea,shoreFromImage,mayHoldShore,tileSeeds}=await import('../web/field/seabed.js');const {applyWater,NO_WATER}=await import('../web/field/water.js');
 const w=256,deep=[8,20,30,255],sand=[190,170,130,255],image=f=>{const rgba=new Uint8Array(w*w*4);for(let j=0;j<w;j++)for(let i=0;i<w;i++)rgba.set(f(i,j),(j*w+i)*4);return {rgba,width:w,height:w};};
 const tileAt=(lon,lat,z)=>{const n=2**z,s=Math.sin(lat*Math.PI/180);return [Math.floor((lon+180)/360*n),Math.floor((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n)];};
 // A tile touching a basin keeps the shore of the real sea in it: z7 at Alexandria also holds Qattara.
 {const [x,y]=tileAt(29.5,31,7),t=seaTile(w,(i,j)=>j<60?-200+0.1*i:4+rough(i,j,1.5));const s=findSea(t,7,x,y);ok(s.basins!==null,'the tile touches a basin');ok(mayHoldShore(t,s,7,y),'it may still hold a shore');
  ok(shoreFromImage(t,s,image((i,j)=>j<63?deep:sand),7,y)>0,'and the strip beside the sea is found');ok(s.mask[62*w+128]===1,'water up to the real shore');}
 // A real cliff is not flattened by a low strip of the same tile.
 const z=12,x=2064,y=1384;
 {const t=seaTile(w,(i,j)=>i<100?-30:(j<128?150+rough(i,j):i<110?5+rough(i,j):150+rough(i,j))),s=findSea(t,z,x,y);shoreFromImage(t,s,image((i,j)=>i<100?deep:sand),z,y);applyWater(t,{z,x,y,seabedZoom:10,sea:s,parent:null,lakes:[]});
  ok(t.heights[60*w+100]>100,'a cliff at the water keeps its height: '+t.heights[60*w+100]);ok(t.heights[200*w+100]<=1.1,'low ground at the water stands low: '+t.heights[200*w+100]);}
 // Past the ramp the sea keeps its measured depth, at a coarse zoom too.
 {const [cx,cy]=tileAt(20,59.5,5),t=seaTile(w,(i,j)=>i<200?-20-0.01*i:40+rough(i,j)),s=findSea(t,5,cx,cy);shoreFromImage(t,s,image((i,j)=>i<200?deep:sand),5,cy);const raw=t.heights[128*w+60];applyWater(t,{z:5,x:cx,y:cy,seabedZoom:10,sea:s,parent:null,lakes:[]});
  ok(t.heights[128*w+60]===raw,'far from any shore the bed is the data: '+t.heights[128*w+60]+' against '+raw);ok(t.heights[128*w+199]<t.heights[128*w+60]||t.heights[128*w+199]<=-20,'beside the shore it falls away');}
 // Seeds lie inside the sea above, a coarse pixel in from its edge.
 {const P=8,parent=new Uint8Array(P*P);for(let v=0;v<P;v++)for(let u=0;u<4;u++)parent[v*P+u]=1;const seeds=tileSeeds(parent,P,1,0,0,0,w,w);
  ok(seeds[128*w+10]===1,'inside');ok(seeds[128*w+200]===0,'the coarse pixel at the edge of the sea is left to growth');ok(tileSeeds(parent,P,1,1,0,0,w,w).every(v=>v===0),'and land is not a seed');}
 ok(NO_WATER<-1000);
});
await t('field worker: a page built from the disk is the same, and asks nothing',async()=>{
 const caches=fakeCaches(),net=fakeTerrariumFetch(),page=pageAt(6.63,46.52,10),store={caches,budgetBytes:1e8,setTimer:noTimer};
 const once=async fetch=>{const h=harness(NO_BUDGETS,{fetch,poolSize:0,tileStore:store});h.send({type:'want',pages:[wantH(1,page)],cancel:[]});const m=await h.until(()=>h.msgs.find(x=>x.id===1&&(x.type==='page'||x.type==='failed')),8000);await tick();await tick();await tick();await new Promise(r=>setTimeout(r,30));const st=h.msgs.findLast(x=>x.type==='stats');h.done();await new Promise(r=>setTimeout(r,30));return {m,st};};
 const first=await once(net.fetch),asked=net.calls?.length??net.count?.()??null;
 ok(first.m.type==='page','built from the network');
 let later=0;const counting=async(...a)=>{later++;return net.fetch(...a);};
 const second=await once(counting);
 ok(second.m.type==='page','and again from the disk');ok(later===0,'with nothing asked of the network: '+later);
 ok(Buffer.compare(Buffer.from(first.m.bytes),Buffer.from(second.m.bytes))===0,'and the same bytes');
 // A disk that fails is the same as none.
 const broken={caches:{open:async()=>{throw new Error('no storage');}}};const h=harness(NO_BUDGETS,{fetch:net.fetch,poolSize:0,tileStore:broken});h.send({type:'want',pages:[wantH(1,page)],cancel:[]});const m=await h.until(()=>h.msgs.find(x=>x.id===1&&(x.type==='page'||x.type==='failed')),8000);h.done();ok(m.type==='page','a store that will not open changes nothing');
});
await t('field worker: pages do not depend on the order tiles were prepared in, and a lost tile is retried, not latched',async()=>{
 // One coast through every zoom, from a function of position. Sea-coloured dry ground lies between the height data's coast and the real one.
 const lonAt=(z,x,i)=>(x+(i+.5)/256)/2**z*360-180;
 const heightPng=(z,x,y)=>{const data=Buffer.alloc(256*256*3);for(let j=0;j<256;j++)for(let i=0;i<256;i++){const lon=lonAt(z,x,i),v=lon<2.0?-15+(lon-2)*40:lon<2.02?4+((i*7+j*13)%5)*0.2:40+((i*3+j*11)%7);const e=Math.round((v+32768)*256),o=(j*256+i)*3;data[o]=(e>>16)&255;data[o+1]=(e>>8)&255;data[o+2]=e&255;}return new Uint8Array(encodePng({w:256,h:256,color:2,data}));};
 const fails=new Map();
 const makeFetch=log=>async(url,{signal}={})=>{log.push(url);if(signal?.aborted)throw Object.assign(new Error('aborted'),{name:'AbortError'});
  const m=/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url),n=/\/g\/(\d+)\/(\d+)\/(\d+)\.jpg/.exec(url);
  if(n&&fails.get('image')>0){fails.set('image',fails.get('image')-1);return {ok:false,status:503,arrayBuffer:async()=>new ArrayBuffer(0)};}
  if(n&&+n[1]===10&&+n[2]===347&&fails.get('z10')>0){fails.set('z10',fails.get('z10')-1);return {ok:false,status:503,arrayBuffer:async()=>new ArrayBuffer(0)};}
  if(m){const b=heightPng(+m[1],+m[2],+m[3]);return {ok:true,status:200,arrayBuffer:async()=>b.slice().buffer};}
  if(n){const b=Buffer.alloc(16);b.writeUInt32LE(+n[1],0);b.writeUInt32LE(+n[3],4);return {ok:true,status:200,arrayBuffer:async()=>new Uint8Array(b).buffer};}
  return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};};
 // Imagery of the same coast, by the stub's own tile address, through the decoder's two browser calls.
 class Canvas{constructor(){this.rgba=null;}getContext(){const self=this;return {drawImage(b){self.rgba=b.rgba;},getImageData(){return {data:self.rgba};}};}}
 const decodeImage={OffscreenCanvas:Canvas,createImageBitmap:async blob=>{const v=new DataView(await blob.arrayBuffer()),z=v.getUint32(0,true),x=v.getUint32(4,true),rgba=new Uint8ClampedArray(256*256*4);for(let j=0;j<256;j++)for(let i=0;i<256;i++){const lon=lonAt(z,x,i),c=lon<2.02?[8,20,30,255]:lon<2.03?[200,180,140,255]:[60,70,40,255];rgba.set(c,(j*256+i)*4);}return {width:256,height:256,rgba,close(){}};}};
 const fine=pageAt(2.01,50,11),coarse=pageAt(2.01,50,9);
 const run=async order=>{const log=[],h=harness(NO_BUDGETS,{fetch:makeFetch(log),poolSize:0,decodeImage});let id=1;const got=new Map();
  for(const page of order){const want=id++;h.send({type:'want',pages:[wantH(want,page)],cancel:[]});const m=await h.until(()=>h.msgs.find(x=>x.id===want&&(x.type==='page'||x.type==='failed'||x.type==='missing')),8000);got.set(page,m);}
  h.done();return got;};
 const a=await run([coarse,fine]),b=await run([fine,coarse]);
 const same=(x,y)=>x.type==='page'&&y.type==='page'&&Buffer.compare(Buffer.from(x.bytes),Buffer.from(y.bytes))===0&&x.offset===y.offset&&x.scale===y.scale&&Buffer.compare(Buffer.from(x.water.buffer),Buffer.from(y.water.buffer))===0;
 const differs=(x,y)=>{if(x.type!=='page'||y.type!=='page')return x.type+'/'+y.type+' '+(x.reason||'')+' '+(y.reason||'');const p=new Uint16Array(x.bytes),q=new Uint16Array(y.bytes);let n=0;for(let o=0;o<p.length;o++)if(p[o]!==q[o])n++;let c=0;for(let o=0;o<x.water.length;o++)if(x.water[o]!==y.water[o])c++;return 'texels '+n+' cells '+c+' offset '+x.offset+'/'+y.offset+' scale '+x.scale+'/'+y.scale;};
 ok(same(a.get(fine),b.get(fine)),'the fine page is the same whichever was prepared first: '+differs(a.get(fine),b.get(fine)));ok(same(a.get(coarse),b.get(coarse)),'and so is the coarse page: '+differs(a.get(coarse),b.get(coarse)));
 // A lost image fails the page, so that it is asked for again, and the retry gives the page a clean run would.
 fails.set('image',20);const log=[],h=harness(NO_BUDGETS,{fetch:makeFetch(log),poolSize:0,decodeImage});
 h.send({type:'want',pages:[wantH(1,fine)],cancel:[]});const first=await h.until(()=>h.msgs.find(x=>x.id===1&&(x.type==='page'||x.type==='failed')),8000);ok(first.type==='failed','a lost image fails the page: '+first.type);
 fails.set('image',0);h.send({type:'want',pages:[wantH(2,fine)],cancel:[]});const second=await h.until(()=>h.msgs.find(x=>x.id===2&&(x.type==='page'||x.type==='failed')),8000);h.done();
 ok(second.type==='page'&&same(second,a.get(fine)),'the retry equals a run with no failure: '+second.type);
 // A host holding back on its budget. The height page does not wait for the image: it goes up at once, marked provisional, with the shore its heights give. Asked for again, it waits, and is the page a clean run gives.
 {const log3=[],late=harness(ONE_AT_A_TIME,{fetch:makeFetch(log3),poolSize:0,decodeImage});
  late.send({type:'want',pages:[wantH(1,fine)],cancel:[]});const up=await late.until(()=>late.msgs.find(x=>x.id===1&&(x.type==='page'||x.type==='failed')),8000);
  ok(up.type==='page'&&up.provisional===true,'a page whose image would wait goes up provisional: '+up.type+' '+up.provisional);ok(!same(up,a.get(fine)),'and it is not yet the final page');
  late.send({type:'want',pages:[{...wantH(2,fine),refresh:true}],cancel:[]});const final=await late.until(()=>late.msgs.find(x=>x.id===2&&(x.type==='page'||x.type==='failed')),8000);
  ok(final.type==='page'&&final.provisional===false,'asked for again it waits for the image: '+final.type+' '+final.provisional);ok(same(final,a.get(fine)),'and equals a run with no budget: '+differs(final,a.get(fine)));
  late.send({type:'want',pages:[wantH(3,fine)],cancel:[]});const third=await late.until(()=>late.msgs.find(x=>x.id===3&&(x.type==='page'||x.type==='failed')),8000);late.done();
  ok(third.type==='page'&&third.provisional===false&&same(third,a.get(fine)),'and any later page reads the final tile');}
 // Two pages on different tiles under one z10 tile, asked for together. One of them runs that tile's attempt, whose image fails through all its retries. That loss is its own: the other, waiting on the attempt, makes its own and finishes.
 const near=pageAt(2.01,49.887,11);
 {fails.set('z10',3);const log2=[],both=harness(NO_BUDGETS,{fetch:makeFetch(log2),poolSize:0,decodeImage});both.send({type:'want',pages:[wantH(1,fine),wantH(2,near)],cancel:[]});
  const one=await both.until(()=>both.msgs.find(x=>x.id===1&&(x.type==='page'||x.type==='failed')),8000),two=await both.until(()=>both.msgs.find(x=>x.id===2&&(x.type==='page'||x.type==='failed')),8000);both.done();
  const fineTiles=new Set(log2.filter(u=>/terrarium.12.2070.13(88|89)/.test(u))),nearTiles=new Set(log2.filter(u=>/terrarium.12.2070.139[01]/.test(u)));ok(fineTiles.size>0&&nearTiles.size>0,'the two pages read different tiles under one z10 tile: '+fineTiles.size+' '+nearTiles.size);
  ok([one.type,two.type].sort().join()==='failed,page','one image lost fails only the page that ran the attempt: '+one.type+' '+two.type);
  ok(fails.get('z10')===0,'and it was lost');}
 // The steps run in the pool, so that fetching does not wait for them. Two pages sharing tiles at once, in either order, give the same bytes as the worker alone.
 const decodeInPool=async bytes=>{const v=new DataView(bytes instanceof ArrayBuffer?bytes:bytes.buffer,bytes.byteOffset||0),z=v.getUint32(0,true),x=v.getUint32(4,true),rgba=new Uint8ClampedArray(256*256*4);for(let j=0;j<256;j++)for(let i=0;i<256;i++){const lon=lonAt(z,x,i),c=lon<2.02?[8,20,30,255]:lon<2.03?[200,180,140,255]:[60,70,40,255];rgba.set(c,(j*256+i)*4);}return {width:256,height:256,rgba};};
 const inPool=async order=>{const workers=[],h=harness(NO_BUDGETS,{fetch:makeFetch([]),poolSize:2,spawn:()=>{const w=loopbackWorker({decodeImage:decodeInPool});workers.push(w);return w;}});
  h.send({type:'want',pages:order.map((page,k)=>wantH(k+1,page)),cancel:[]});const got=new Map();
  for(const [k,page] of order.entries())got.set(page,await h.until(()=>h.msgs.find(x=>x.id===k+1&&(x.type==='page'||x.type==='failed'||x.type==='missing')),8000));
  await h.until(()=>h.msgs.findLast?.(x=>x.type==='stats'&&x.waterTiles>0),2000);const stat=h.msgs.findLast(x=>x.type==='stats'),steps=workers.flatMap(w=>w.log).filter(o=>o==='water').length;h.done();return {got,stat,steps};};
 // A page built from a provisional tile is provisional, even when a refresh finishes that tile while the page is in the build queue. Otherwise it goes up marked final with the heights' shore, and is never asked for again.
 {const fineNeeds=new Set(rs.requiredTiles(fine,D_SRC.height).map(n=>`${n.z}/${n.x}/${n.y}`));let other=null;
  for(let k=1;k<40&&!other;k++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const p=pageAt(2.01+dx*k*.004,50+dy*k*.004,11);if((p.x!==fine.x||p.y!==fine.y||p.face!==fine.face)&&rs.requiredTiles(p,D_SRC.height).every(n=>fineNeeds.has(`${n.z}/${n.x}/${n.y}`))){other=p;break;}}
  ok(other,'a second page reads only tiles the first reads');
  let hold=false,held=null;const spawn=()=>{const w=loopbackWorker({decodeImage:decodeInPool}),post=w.postMessage;w.postMessage=(m,tr)=>{if(m.op==='build'&&hold){hold=false;held=()=>post(m,tr);return;}post(m,tr);};return w;};
  const race=harness(ONE_AT_A_TIME,{fetch:makeFetch([]),poolSize:2,spawn});
  race.send({type:'want',pages:[wantH(1,fine)],cancel:[]});const up=await race.until(()=>race.msgs.find(x=>x.id===1&&(x.type==='page'||x.type==='failed')),8000);ok(up.type==='page'&&up.provisional===true,'the first page goes up provisional: '+up.type+' '+up.provisional);
  hold=true;race.send({type:'want',pages:[wantH(2,other)],cancel:[]});await race.until(()=>held,8000);
  race.send({type:'want',pages:[{...wantH(3,fine),refresh:true}],cancel:[]});const done=await race.until(()=>race.msgs.find(x=>x.id===3&&(x.type==='page'||x.type==='failed')),8000);ok(done.type==='page'&&done.provisional===false,'a refresh finishes the tiles while the second page is held: '+done.type+' '+done.provisional);
  held();const second=await race.until(()=>race.msgs.find(x=>x.id===2&&(x.type==='page'||x.type==='failed')),8000);race.done();
  ok(second.type==='page'&&second.provisional===true,'and the second page, built from the provisional form, says so: '+second.type+' '+second.provisional);}
 for(const order of [[fine,coarse],[coarse,fine]]){
  const {got,stat,steps}=await inPool(order);
  ok(same(got.get(fine),a.get(fine))&&same(got.get(coarse),a.get(coarse)),'in the pool the pages are the same: '+differs(got.get(fine),a.get(fine)));
  ok(steps>0&&stat.waterTiles>0,'and the steps ran there: '+steps);
 }
});
await t('water: the flat terraces of sea floor data are not lakes',async()=>{
 const {flatRegions}=await import('../web/field/water.js');const {findSea}=await import('../web/field/seabed.js');
 // Real data: thousands of such terraces at the Somme and in Flanders, once accepted as lakes at -23 m and -19 m.
 const w=256,z=12,x=2064,y=1384,tile=seaTile(w,(i,j)=>-20-Math.floor((i+j)/40));
 ok(flatRegions(tile,z,y,null).length>0,'they are flat');ok(flatRegions(tile,z,y,findSea(tile,z,x,y).mask).length===0,'and are sea');
});
await t('water: source coverage does not flood neighbouring low terrain',async()=>{
 const {NO_WATER,WATER_GRID}=await import('../web/field/water.js');
 const page=pageAt(6.7,46.45,10),src=D_SRC.height,G=WATER_GRID,R=6371000,dirC=lonLatToDirection(6.7*D2R,46.45*D2R),radius=2500;
 const pix=(z,x,y,i,j)=>{const X=(x+(i+.5)/256)/2**z,Y=(y+(j+.5)/256)/2**z;return lonLatToDirection((X-.5)*2*Math.PI,Math.atan(Math.sinh(Math.PI*(1-2*Y))));};
 const dist=(a,b)=>Math.acos(Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))*R;
 const build=(outside,bank=false)=>{const cache=new Map();return rs.buildHeightPage(page,(s,z,x,y)=>{const k=z+'/'+x+'/'+y;if(!cache.has(k)){const heights=new Float32Array(65536),water=new Float32Array(65536).fill(NO_WATER);for(let j=0;j<256;j++)for(let i=0;i<256;i++){const d=dist(pix(z,x,y,i,j),dirC),inside=d<radius;heights[j*256+i]=inside?340:bank&&d<radius+1500?400:outside;if(inside)water[j*256+i]=371;}cache.set(k,{heights,width:256,height:256,water});}return cache.get(k);},src).water;};
 const count=g=>{let n=0;for(let c=0;c<G*G;c++)if(g[c]>NO_WATER)n++;return n;};
 const above=count(build(400)),below=count(build(300)),barrier=count(build(300,true));ok(below>0&&below<=above&&above<G*G&&barrier===above,'support cells: '+above+' behind dry banks, '+below+' beside lower dry land, '+barrier+' with a separate lower basin beyond the bank');
});
await t('water: river support cannot propagate into dry valleys or extrapolate above banks',async()=>{
 const {NO_WATER}=await F('water.js'),{extendWaterSupport}=rs;
 const river=new Float32Array(8192);for(let c=0;c<1024;c++)river[c*4]=NO_WATER;
 for(let y=0;y<32;y++){const k=(y*32+16)*4;river[k]=400;river[k+3]=2;}
 const original=river.slice(),wet=g=>Array.from({length:1024},(_,c)=>g[c*4]).filter(v=>v>NO_WATER).length;
 const lower=extendWaterSupport(river,new Float32Array(264*264).fill(398));
 ok(wet(lower)===32,'a 32-cell river used to flood all 1024 lower cells: '+wet(lower));
 const bank=extendWaterSupport(river,new Float32Array(264*264).fill(405));
 ok(wet(bank)===96,'hidden overlap stops after one neighbour: '+wet(bank));
 ok(river.every((v,i)=>v===original[i]),'the source remains immutable');
 const sloping=river.slice();for(let y=0;y<32;y++)sloping[(y*32+16)*4+1]=3;
 const slope=extendWaterSupport(sloping,new Float32Array(264*264).fill(430));
 ok(slope[(16*32+17)*4]===NO_WATER,'an extrapolated plane corner above the bank must not create water');
 ok(slope[(16*32+15)*4]>NO_WATER,'the lower, hidden side retains its geometry support');
});
await t('field worker: pack pages stream as id 0 and never delay wants; attribution is passed on; failures land in stats',async()=>{
 const net=fakeTerrariumFetch(),workers=[],page=pageAt(6.63,46.52,10);let seen=null,release=null;
 const importPack=async()=>({loadPack:async(base,onPage,opts)=>{
  seen=base;await (await opts.fetch(base+'manifest.json')).json();
  const dec=await opts.decodePng(net.png.subarray(0));
  await onPage({face:0,level:0,x:0,y:0,channel:'height',source:'pack',offset:3,scale:4,bytes:new Uint16Array(4).buffer});
  await new Promise(r=>{release=r;}); // the rest of the pack is slow
  return {pages:1,levels:{},failures:[{level:2,reason:'sha256 mismatch'}]};
 }});
 const h=harness({pack:'pack/pack-earth-v1/'},{fetch:net.fetch,poolSize:2,siteRoot:'https://site.test/',importPack,spawn:()=>{const w=loopbackWorker();workers.push(w);return w;}});
 await h.until(()=>h.msgs.some(m=>m.type==='page'&&m.id===0));
 const pk=h.msgs.find(m=>m.type==='page'&&m.id===0);ok(pk.source==='pack'&&pk.channel===0&&pk.offset===3&&pk.scale===4&&pk.bytes.byteLength===8&&pk.face===0);
 ok(seen==='https://site.test/pack/pack-earth-v1/','resolved against the site root: '+seen);
 ok(workers.some(w=>w.log.includes('decode:png')),'pack blob decoded in the pool');
 const att=await h.until(()=>h.msgs.findLast(m=>m.type==='attribution'&&m.sources.includes('Pack credit A')));ok(att.sources.includes('Pack credit B')&&att.sources.some(s=>/Terrain Tiles/.test(s)));
 h.send({type:'want',pages:[wantH(1,page)],cancel:[]});await h.until(()=>h.msgs.some(m=>m.type==='page'&&m.id===1)); // pack still loading
 let st=await h.until(()=>h.msgs.findLast(m=>m.type==='stats'&&m.packPages===1));ok(st.packDone===false,'pack still running while a live page arrived');
 release();await h.f.packDone;st=await h.until(()=>h.msgs.findLast(m=>m.type==='stats'&&m.packDone));ok(/sha256 mismatch/.test(st.packError)&&st.packPages===1,JSON.stringify(st));h.done();
 // pack module missing: reported, streaming continues
 const h2=harness({pack:'pack/x/'},{fetch:net.fetch,poolSize:1,importPack:async()=>{throw Error("Failed to fetch dynamically imported module: pack.js");},spawn:()=>loopbackWorker()});
 await h2.f.packDone;h2.send({type:'want',pages:[wantH(1,page)],cancel:[]});await h2.until(()=>h2.msgs.some(m=>m.type==='page'&&m.id===1));
 st=await h2.until(()=>h2.msgs.findLast(m=>m.type==='stats'&&m.packDone&&m.completed===1));ok(/dynamically imported/.test(st.packError)&&st.packPages===0&&st.completed===1,JSON.stringify(st));h2.done();
});

await t('baked bodies publish their own detail ceiling before any demand',async()=>{
 for(const level of [3,4,5,6]){
  const h=harness({manifest:{baked:true,body:'fixture'},pack:'pack/fixture-v1/'},{
   fetch:async()=>({ok:true,json:async()=>({finest_level:level})}),
   importPack:async()=>({loadPack:async()=>({failures:[]})}),poolSize:0,
  });
  try{
   const m=await h.until(()=>h.msgs.find(m=>m.type==='sourceLimits'));
   ok(m.height===level&&m.albedo===level,JSON.stringify(m));
   h.send({type:'want',pages:[wantH(1,{face:0,level:level+1,x:0,y:0})],cancel:[]});
   const missing=await h.until(()=>h.msgs.find(m=>m.type==='missing'));
   ok(missing.reason==='beyond the data',JSON.stringify(missing));
  }finally{h.done();}
 }
});
await t('baked fine pages are byte ranges of their face bundle: one index read per face, one read per page, refusals and absences answered',async()=>{
 // One-page level files (STPK) and a level-4 bundle of face 2 holding two of its 256 pages, as crates/solar-bake/src/pack.rs writes them.
 const png=new Uint8Array(encodePng({w:4,h:4,color:2,data:Buffer.alloc(4*4*3,7)}));
 const record=(face,level,x,y,offset,scale)=>{const albedo=new Uint8Array([1,2,3]),b=Buffer.alloc(8+26+png.length+albedo.length);b.write('STPK',0,'latin1');b.writeUInt32LE(1,4);
  b[8]=face;b[9]=level;b.writeUInt32LE(x,10);b.writeUInt32LE(y,14);b.writeFloatLE(offset,18);b.writeFloatLE(scale,22);b.writeUInt32LE(png.length,26);b.writeUInt32LE(albedo.length,30);
  b.set(png,34);b.set(albedo,34+png.length);return b;};
 const n=16,head=16+8*n*n,pages=new Map([[5*n+3,record(2,4,3,5,100,2)],[5*n+4,record(2,4,4,5,-50,0.5)]]);
 const index=Buffer.alloc(head);index.write('STPB',0,'latin1');index.writeUInt32LE(1,4);index[8]=4;index[9]=2;index.writeUInt32LE(n,12);
 let at=head;const body=[];for(let i=0;i<n*n;i++){const p=pages.get(i);if(!p)continue;index.writeUInt32LE(at,16+8*i);index.writeUInt32LE(p.length,20+8*i);at+=p.length;body.push(p);}
 const bundle=Buffer.concat([index,...body]);
 const log=[];let aborted=0;
 const fetch=async(url,opts={})=>{
  const range=opts.headers?.Range??null;log.push({url,range});
  if(url.endsWith('manifest.json'))return {ok:true,status:200,json:async()=>({finest_level:4})};
  if(url.endsWith('pages/4/face-1.bin')){opts.signal?.addEventListener('abort',()=>aborted++);return {ok:true,status:200,arrayBuffer:async()=>bundle.buffer.slice(0)};} // a host ignoring ranges
  if(!url.endsWith('pages/4/face-2.bin'))return {ok:false,status:404};
  const m=/^bytes=(\d+)-(\d+)$/.exec(range);if(!m)return {ok:true,status:200,arrayBuffer:async()=>bundle.buffer.slice(0)};
  const s=bundle.subarray(+m[1],+m[2]+1);return {ok:true,status:206,arrayBuffer:async()=>s.buffer.slice(s.byteOffset,s.byteOffset+s.length)};
 };
 const real=await F('pack.js');
 const importPack=async()=>({...real,heightBytes:(rgba,w,h)=>new Uint16Array([w,h]).buffer,albedoBytes:(rgba,w,h)=>new Uint8Array([w,h]).buffer});
 const h=harness({manifest:{baked:true,body:'fixture'},pack:'pack/fixture-v1/'},{fetch,importPack,siteRoot:'https://site.test/',poolSize:1,spawn:()=>loopbackWorker({decodeImage:async()=>({rgba:new Uint8Array(4),width:1,height:1})})});
 try{
  await h.until(()=>h.msgs.find(m=>m.type==='sourceLimits'));
  const at4=(id,face,x,y,channel='height')=>({id,face,level:4,x,y,channel,priority:0});
  h.send({type:'want',pages:[at4(1,2,3,5),at4(2,2,3,5,'albedo'),at4(3,2,4,5),at4(4,2,0,0),at4(5,0,3,5),at4(6,1,3,5)],cancel:[]});
  const got=id=>h.msgs.find(m=>m.id===id&&['page','missing','failed'].includes(m.type));
  await h.until(()=>[1,2,3,4,5,6].every(got));
  const p1=got(1),p2=got(2),p3=got(3);
  ok(p1.type==='page'&&p1.source==='pack'&&p1.offset===100&&p1.scale===2&&new Uint16Array(p1.bytes)[0]===4,JSON.stringify({...p1,bytes:undefined}));
  ok(p2.type==='page'&&p2.offset===0&&p2.scale===1,'albedo of the same page: '+JSON.stringify({...p2,bytes:undefined}));
  ok(p3.type==='page'&&p3.offset===-50&&p3.scale===0.5,'second page of the face: '+JSON.stringify({...p3,bytes:undefined}));
  ok(got(4).type==='missing'&&got(4).reason==='not baked','empty index entry: '+JSON.stringify(got(4)));
  ok(got(5).type==='missing'&&got(5).reason==='not baked','no bundle for the face: '+JSON.stringify(got(5)));
  ok(got(6).type==='failed'&&/ignored the byte range/.test(got(6).reason)&&aborted===1,'a whole-file answer is stopped, not read: '+JSON.stringify(got(6))+' aborted '+aborted);
  const face2=log.filter(r=>r.url==='https://site.test/pack/fixture-v1/pages/4/face-2.bin');
  ok(face2.every(r=>r.range),'every bundle read is a range');
  ok(face2.filter(r=>r.range===`bytes=0-${head-1}`).length===1,'one index read for the face: '+JSON.stringify(face2));
  ok(face2.length===3,'index, then one read per page shared by its two channels: '+JSON.stringify(face2));
  // The other channel of a page asked for after its first one has come in: answered from the bytes kept, no request.
  h.send({type:'want',pages:[at4(7,2,4,5,'albedo')],cancel:[]});
  await h.until(()=>got(7));
  ok(got(7).type==='page'&&log.filter(r=>r.url.endsWith('pages/4/face-2.bin')).length===3,'a later want of a kept page sends nothing: '+JSON.stringify(log.slice(-2)));
 }finally{h.done();}
});
console.log(`\n${passed} passed, ${failed} failed`);
if(globalThis.__cost)console.log(`resample cost per page (Node ${process.version}): ${globalThis.__cost}`);
process.exit(failed?1:0);

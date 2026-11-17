// Candidate tone curves applied offline to the same linear frames (tools/Capture-HDR.mjs), so a choice is made on identical
// pixels: today's per-channel Reinhard, the two ACES fits (Narkowicz 2016; Hill's RRT+ODT fit), AgX (the Rec.2020 form three.js
// and Filament take from Blender, plain and with the "punchy" look), Khronos PBR Neutral, and Tony McMapface (its 48^3 table).
// Sources, licences and the reference code: docs/HDR-FINISH.md. Each curve's exposure is set so that scene mid grey (0.18) lands
// where today's curve puts it at the frame's exposure; the factors are printed. Then the display's 2.2 power.
//   node tools/Tone-Curves.mjs --in DIR --out DIR [--lut tony_mc_mapface.dds] [--only reinhard,agx] [--scenes earth-day,sun-2r]
// Writes <scene>-<curve>.png, and with ImageMagick on the path a sheet per scene and one overview.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {png} from './Explorer-Test-Lib.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=resolve(arg('in','evidence/local/hdr')),out=resolve(arg('out',join(dir,'curves')));mkdirSync(out,{recursive:true});
const lutPath=arg('lut','');
// Half floats to numbers, by table.
const HALF=new Float32Array(65536);{const b=new ArrayBuffer(4),f=new Float32Array(b),u=new Uint32Array(b);for(let h=0;h<65536;h++){const s=h>>15,e=(h>>10)&31,m=h&1023;let v;if(e===0)v=m*2**-24;else if(e===31)v=m?NaN:Infinity;else v=(1+m/1024)*2**(e-15);HALF[h]=s?-v:v;}void f;void u;}
const mul=(m,r,g,b)=>[m[0]*r+m[1]*g+m[2]*b,m[3]*r+m[4]*g+m[5]*b,m[6]*r+m[7]*g+m[8]*b];
const sat=v=>v<0?0:v>1?1:v;
// Row-major matrices (rows of the HLSL source; the GLSL sources' columns transposed).
const ACES_IN=[0.59719,0.35458,0.04823,0.07600,0.90834,0.01566,0.02840,0.13383,0.83777];
const ACES_OUT=[1.60475,-0.53108,-0.07367,-0.10208,1.10813,-0.00605,-0.00327,-0.07276,1.07602];
const SRGB_TO_2020=[0.6274,0.3293,0.0433,0.0691,0.9195,0.0113,0.0164,0.0880,0.8956];
const R2020_TO_SRGB=[1.6605,-0.5876,-0.0728,-0.1246,1.1329,-0.0083,-0.0182,-0.1006,1.1187];
const AGX_INSET=[0.856627153315983,0.0951212405381588,0.0482516061458583,0.137318972929847,0.761241990602591,0.101439036467562,0.11189821299995,0.0767994186031903,0.811302368396859];
const AGX_OUTSET=[1.1271005818144368,-0.11060664309660323,-0.016493938717834573,-0.1413297634984383,1.157823702216272,-0.016493938717834257,-0.14132976349843826,-0.11060664309660294,1.2519364065950405];
const AGX_MIN=-12.47393,AGX_MAX=4.026069;
const agxContrast=x=>{const x2=x*x,x4=x2*x2;return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;};
const rrtOdt=v=>(v*(v+0.0245786)-0.000090537)/(v*(0.983729*v+0.4329510)+0.238081);
function agx(r,g,b,power=1,chroma=1){
 [r,g,b]=mul(SRGB_TO_2020,r,g,b);[r,g,b]=mul(AGX_INSET,r,g,b);
 const enc=v=>agxContrast(sat((Math.log2(Math.max(v,1e-10))-AGX_MIN)/(AGX_MAX-AGX_MIN)));
 r=enc(r);g=enc(g);b=enc(b);
 if(power!==1||chroma!==1){ // A look, as Wrensch's: a power, then saturation about the luminance. "Punchy" is 1.35 and 1.4.
  r=Math.max(r,0)**power;g=Math.max(g,0)**power;b=Math.max(b,0)**power;const l=0.2126*r+0.7152*g+0.0722*b;r=l+chroma*(r-l);g=l+chroma*(g-l);b=l+chroma*(b-l);}
 [r,g,b]=mul(AGX_OUTSET,r,g,b);r=Math.max(r,0)**2.2;g=Math.max(g,0)**2.2;b=Math.max(b,0)**2.2;
 [r,g,b]=mul(R2020_TO_SRGB,r,g,b);return [sat(r),sat(g),sat(b)];
}
function neutral(r,g,b){
 const start=0.8-0.04,des=0.15;const x=Math.min(r,g,b),offset=x<0.08?x-6.25*x*x:0.04;r-=offset;g-=offset;b-=offset;
 const peak=Math.max(r,g,b);if(peak<start)return [r,g,b];
 const d=1-start,np=1-d*d/(peak+d-start),k=np/peak;r*=k;g*=k;b*=k;const t=1-1/(des*(peak-np)+1);
 return [r+(np-r)*t,g+(np-g)*t,b+(np-b)*t];
}
// Tony McMapface: a 48^3 table of shared-exponent texels (R9G9B9E5), trilinear, addressed by x / (1 + x).
let TONY=null;
if(lutPath&&existsSync(lutPath)){const f=readFileSync(lutPath);if(f.readUInt32LE(0)!==0x20534444||f.length!==148+48**3*4)throw Error('not the 48^3 R9G9B9E5 table');
 TONY=new Float32Array(48**3*3);for(let i=0;i<48**3;i++){const v=f.readUInt32LE(148+i*4),e=2**((v>>>27)-24);TONY[i*3]=(v&511)*e;TONY[i*3+1]=((v>>>9)&511)*e;TONY[i*3+2]=((v>>>18)&511)*e;}}
function tony(r,g,b){
 const N=48,p=[r/(r+1),g/(g+1),b/(b+1)].map(v=>sat(v)*(N-1)),i=p.map(v=>Math.min(Math.floor(v),N-2)),f=p.map((v,k)=>v-i[k]);const o=[0,0,0];
 for(let c=0;c<8;c++){const x=i[0]+(c&1),y=i[1]+((c>>1)&1),z=i[2]+(c>>2),w=((c&1)?f[0]:1-f[0])*(((c>>1)&1)?f[1]:1-f[1])*((c>>2)?f[2]:1-f[2]),at=((z*N+y)*N+x)*3;o[0]+=TONY[at]*w;o[1]+=TONY[at+1]*w;o[2]+=TONY[at+2]*w;}
 return o;
}
const CURVES={
 reinhard:['Reinhard per channel (today)',(r,g,b)=>[r/(1+r),g/(1+g),b/(1+b)]],
 narkowicz:['ACES, Narkowicz fit',(r,g,b)=>[r,g,b].map(x=>sat((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14)))],
 hill:['ACES, Hill RRT+ODT fit',(r,g,b)=>mul(ACES_OUT,...mul(ACES_IN,r,g,b).map(rrtOdt)).map(sat)],
 agx:['AgX',(r,g,b)=>agx(r,g,b)],
 agxmid:['AgX, half the punchy look (1.18, 1.2)',(r,g,b)=>agx(r,g,b,1.18,1.2)],
 agxpunchy:['AgX, punchy look (1.35, 1.4)',(r,g,b)=>agx(r,g,b,1.35,1.4)],
 neutral:['Khronos PBR Neutral',(r,g,b)=>neutral(r,g,b).map(sat)],
 ...(TONY?{tony:['Tony McMapface',(r,g,b)=>tony(r,g,b).map(sat)]}:{}),
};
const names=(arg('only','')||Object.keys(CURVES).join(',')).split(',').filter(k=>CURVES[k]);
// The exposure that puts scene mid grey where today's curve puts it at the frame's exposure.
const EXPOSURE=+arg('exposure','1.3'),grey=CURVES.reinhard[1](0.18*EXPOSURE,0.18*EXPOSURE,0.18*EXPOSURE)[1];
const gain={};for(const k of names){let lo=0.01,hi=100;for(let i=0;i<60;i++){const m=Math.sqrt(lo*hi),v=CURVES[k][1](0.18*m,0.18*m,0.18*m)[1];if(v<grey)lo=m;else hi=m;}gain[k]=Math.sqrt(lo*hi);}
console.log('exposure per curve (mid grey matched to today):',JSON.stringify(Object.fromEntries(Object.entries(gain).map(([k,v])=>[k,+v.toFixed(3)]))));
// A chart no scene gives: hue across; the upper half fully saturated, the lower half mixed half with white; in each half the
// level falls from 60 at the top to 0.02 at the bottom, evenly in stops.
function chart(w,h){const d=new Float32Array(w*h*3),half=h/2;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const hue=x/w*6,s=y<half?1:0.5,v=60*(0.02/60)**((y%half)/half);
  for(let k=0;k<3;k++){const q=(hue+2*k)%6,c=sat(Math.abs(q-3)-1);d[(y*w+x)*3+k]=v*(1-s+s*c);}}
 return d;}
const meta=existsSync(join(dir,'hdr.json'))?JSON.parse(readFileSync(join(dir,'hdr.json'),'utf8')):{rows:[]};
let scenes=meta.rows.map(r=>({name:r.name,w:r.width,h:r.height}));scenes.push({name:'chart',w:960,h:540});
if(arg('scenes',''))scenes=scenes.filter(s=>arg('scenes','').split(',').includes(s.name));
const magick=(...a)=>{try{execFileSync('magick',a,{stdio:'ignore'});return true;}catch{return false;}};
for(const s of scenes){
 let lin;
 if(s.name==='chart')lin=chart(s.w,s.h);
 else{const raw=readFileSync(join(dir,`${s.name}.hdr16`)),u=new Uint16Array(raw.buffer,raw.byteOffset,raw.length/2);lin=new Float32Array(s.w*s.h*3);for(let i=0;i<s.w*s.h;i++)for(let k=0;k<3;k++){const v=HALF[u[i*4+k]];lin[i*3+k]=v>0?v:0;}}
 for(const k of names){const f=CURVES[k][1],e=gain[k],px=Buffer.alloc(s.w*s.h*4);
  for(let i=0;i<s.w*s.h;i++){const c=f(lin[i*3]*e,lin[i*3+1]*e,lin[i*3+2]*e);px[i*4]=Math.round(255*sat(c[0])**(1/2.2));px[i*4+1]=Math.round(255*sat(c[1])**(1/2.2));px[i*4+2]=Math.round(255*sat(c[2])**(1/2.2));px[i*4+3]=255;}
  writeFileSync(join(out,`${s.name}-${k}.png`),png(px,s.w,s.h));}
 const cells=names.flatMap(k=>['-label',CURVES[k][0],join(out,`${s.name}-${k}.png`)]);
 magick('montage','-background','#111','-fill','white','-pointsize','30',...cells,'-tile','4x','-geometry','960x540+6+6',join(out,`SHEET-${s.name}.jpg`));
 console.log(s.name);
}
// Overview: scenes down, curves across.
const over=scenes.flatMap(s=>names.map(k=>join(out,`${s.name}-${k}.png`)));
magick('montage','-background','#111',...over,'-tile',`${names.length}x`,'-geometry','384x216+3+3',join(out,'OVERVIEW.jpg'));
writeFileSync(join(out,'curves.json'),JSON.stringify({exposure:EXPOSURE,gain,curves:Object.fromEntries(names.map(k=>[k,CURVES[k][0]])),scenes:scenes.map(s=>s.name)},null,1));

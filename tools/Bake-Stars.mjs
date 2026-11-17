// The brightest stars for the space pass, as points on top of the sky map, from the Yale Bright Star Catalogue, 5th revision
// (FK5 J2000, which agrees with ICRF far under a pixel), with proper motion so that they follow the date. Everything fainter stays
// in the map. 8 floats each: unit direction, visual magnitude; then the direction's change per Julian century, and the colour
// packed in three bytes.
//   node tools/Bake-Stars.mjs BSC5 OUT.bin [--faintest 4.5]
import {readFileSync,writeFileSync} from 'node:fs';
const [input,out]=process.argv.slice(2);if(!input||!out)throw Error('usage: Bake-Stars.mjs BSC5 OUT.bin');
const i0=process.argv.indexOf('--faintest'),FAINTEST=i0<0?4.5:+process.argv[i0+1];
const b=readFileSync(input),count=Math.abs(b.readInt32LE(8)),rows=[];
// Header 28 bytes. Entries 32 bytes: f32 number, f64 RA, f64 Dec, 2 chars spectral type, i16 magnitude x 100, f32 pm, f32 pm.
// Colour (16 November 2026): by the same rule as the star disks (crates/solar-core/src/stars.rs), so a point star and the same
// kind of star seen up close agree. The class letter and subclass give a temperature by Mamajek's mean dwarf sequence
// (version 2022.04.16; Pecaut & Mamajek 2013): the binary catalogue carries no luminosity class, so a giant is read as a dwarf of
// its class (a K0 giant is about 500 K cooler than this says). The blackbody at that temperature, integrated against the CIE 1931
// colour-matching functions (Wyman, Sloan and Shirley 2013) and taken to linear sRGB, scaled so its largest channel is 1, as the
// former table by class letter was. A class it cannot read keeps white.
const SEQUENCE=[['O5',41400],['O9',33300],['B0',31400],['B2',20600],['B5',15700],['B8',12300],['A0',9700],['A2',8800],['A5',8100],['A8',7590],['F0',7220],['F2',6820],['F5',6550],['F8',6180],['G0',5930],['G2',5770],['G5',5660],['G8',5480],['K0',5270],['K2',5100],['K5',4440],['K7',4100],['M0',3850],['M2',3560],['M4',3210],['M5',3060],['M6',2810],['M8',2570],['M9',2380]];
const classNumber=c=>{const l='OBAFGKM'.indexOf(c[0]);if(l<0)return null;const d=/^[0-9]/.test(c[1]||'')?Number(c[1]):0;return l*10+d;};
const teffOf=c=>{const n=classNumber(c);if(n===null)return null;const rows=SEQUENCE.map(([k,t])=>[classNumber(k),t]);if(n<=rows[0][0])return rows[0][1];for(let i=1;i<rows.length;i++)if(n<=rows[i][0]){const f=(n-rows[i-1][0])/(rows[i][0]-rows[i-1][0]);return rows[i-1][1]+f*(rows[i][1]-rows[i-1][1]);}return rows.at(-1)[1];};
const lobe=(x,m,a,b)=>Math.exp(-0.5*((x-m)/(x<m?a:b))**2);
const cmf=x=>[1.056*lobe(x,599.8,37.9,31.0)+0.362*lobe(x,442.0,16.0,26.7)-0.065*lobe(x,501.1,20.4,26.2),0.821*lobe(x,568.8,46.9,40.5)+0.286*lobe(x,530.9,16.3,31.1),1.217*lobe(x,437.0,11.8,36.0)+0.681*lobe(x,459.0,26.0,13.8)];
const planck=(nm,t)=>{const l=nm*1e-9;return 2*6.62607015e-34*299792458**2/l**5/Math.expm1(6.62607015e-34*299792458/(l*1.380649e-23*t));};
const colourOf=t=>{const xyz=[0,0,0];for(let nm=360;nm<=830;nm++){const b=planck(nm,t),c=cmf(nm);for(let i=0;i<3;i++)xyz[i]+=b*c[i];}const [x,y,z]=xyz;const rgb=[3.2406*x-1.5372*y-0.4986*z,-0.9689*x+1.8758*y+0.0415*z,0.0557*x-0.2040*y+1.0570*z].map(v=>Math.max(0,v));const m=Math.max(...rgb);return rgb.map(v=>v/m);};
const tints=new Map();const tintOf=c=>{if(!tints.has(c)){const t=teffOf(c);tints.set(c,t?colourOf(t):[1,1,1]);}return tints.get(c);};
for(let i=0;i<count;i++){
 const at=28+i*32,ra=b.readDoubleLE(at+4),dec=b.readDoubleLE(at+12),type=String.fromCharCode(b[at+20],b[at+21]),mag=b.readInt16LE(at+22)/100;
 // Radians per year, both along their own axes, the first in right ascension itself.
 const pmRa=b.readFloatLE(at+24),pmDec=b.readFloatLE(at+28);
 if(!(mag>-2&&mag<FAINTEST))continue;
 const c=tintOf(type);
 const east=[-Math.sin(ra),Math.cos(ra),0],north=[-Math.sin(dec)*Math.cos(ra),-Math.sin(dec)*Math.sin(ra),Math.cos(dec)],a=pmRa*Math.cos(dec)*100,d=pmDec*100;
 const packed=Math.round(c[0]*255)*65536+Math.round(c[1]*255)*256+Math.round(c[2]*255);
 rows.push(Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec),mag,east[0]*a+north[0]*d,east[1]*a+north[1]*d,east[2]*a+north[2]*d,packed);
}
writeFileSync(out,Buffer.from(new Float32Array(rows).buffer));
console.log(`${rows.length/8} stars of ${count}, ${rows.length*4} bytes`);

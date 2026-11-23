// Named surface features of the solar system's bodies, from the IAU Gazetteer of Planetary Nomenclature (USGS
// Astrogeology, public domain): one file per body the explorer draws, web/landmarks/<naif>.json, largest first.
// Source: the per-body center-point shapefiles at https://planetarynames.wr.usgs.gov/GIS_Downloads, unpacked into
// $SOLAR_DATA/sources/iau-nomenclature/x (the attribute tables, .dbf, are all this reads). Coordinates there are
// planetocentric latitude and east-positive longitude in degrees (each file's metadata says so), the convention the
// explorer's maps and jump_over use. Every entry in the downloads is IAU-adopted; anything else would be skipped.
// Usage: node tools/Bake-Landmarks.mjs [sourceDir] [outDir]
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {resolve,basename} from 'node:path';
const source=resolve(process.argv[2]||(process.env.SOLAR_DATA||'data')+'/sources/iau-nomenclature/x');
const out=resolve(process.argv[3]||'web/landmarks');
// Gazetteer targets the explorer draws, by NAIF id.
const BODIES={MERCURY:199,VENUS:299,MOON:301,MARS:499,PHOBOS:401,DEIMOS:402,IO:501,EUROPA:502,GANYMEDE:503,CALLISTO:504,
 MIMAS:601,ENCELADUS:602,TETHYS:603,DIONE:604,RHEA:605,TITAN:606,IAPETUS:608,ARIEL:701,UMBRIEL:702,TITANIA:703,OBERON:704,
 MIRANDA:705,TRITON:801,PLUTO:999,CHARON:901};
// dBASE III: field descriptors, then fixed-width records; text is UTF-8 (the .cpg says so).
function readDbf(path){
 const b=readFileSync(path);const n=b.readUInt32LE(4),hlen=b.readUInt16LE(8),rlen=b.readUInt16LE(10);
 const fields=[];for(let o=32;b[o]!==0x0d;o+=32)fields.push({name:b.toString('latin1',o,o+11).replace(/\0.*$/,''),type:String.fromCharCode(b[o+11]),len:b[o+16]});
 const rows=[];for(let i=0;i<n;i++){const s=hlen+i*rlen;if(b[s]===0x2a)continue;let o=s+1;const r={};
  for(const f of fields){const v=b.toString('utf8',o,o+f.len).trim();r[f.name]=f.type==='N'||f.type==='F'?(v===''?null:Number(v)):v;o+=f.len;}rows.push(r);}
 return rows;
}
mkdirSync(out,{recursive:true});
const types={},index=[];let skipped=0;
for(const file of readdirSync(source).filter(f=>f.endsWith('_nomenclature_center_pts.dbf')).sort()){
 const target=basename(file).replace('_nomenclature_center_pts.dbf','');const id=BODIES[target];
 const rows=readDbf(resolve(source,file));
 if(!id){index.push({target,features:rows.length,drawn:false});continue;}
 const features=[];
 for(const r of rows){
  if(r.approval!=='Adopted by IAU'||!Number.isFinite(r.center_lat)||!Number.isFinite(r.center_lon)){skipped++;continue;}
  types[r.code]=r.type;
  const lon=((r.center_lon%360)+540)%360-180;
  // Preserve the positional fields consumed by navigation. The year is the IAU
  // naming decision, distinct from the date of discovery or formation.
  features.push([r.clean_name||r.name,+r.center_lat.toFixed(4),+lon.toFixed(4),+(r.diameter||0).toFixed(2),r.code,Number((r.link.match(/Feature\/(\d+)/)||[])[1]||0),r.origin,
   Number(r.approvaldt?.match(/^\d{4}/)?.[0])||0,r.quad_name||'',r.quad_code||'']);
 }
 features.sort((a,b)=>b[3]-a[3]||a[0].localeCompare(b[0]));
 writeFileSync(resolve(out,`${id}.json`),JSON.stringify({body:id,target,features}));
 index.push({target,id,features:features.length,drawn:true});
}
const fetched=new Date(statSync(source).mtimeMs).toISOString().slice(0,10);
writeFileSync(resolve(out,'index.json'),JSON.stringify({source:'IAU Working Group for Planetary System Nomenclature, Gazetteer of Planetary Nomenclature (USGS Astrogeology Science Center), public domain. https://planetarynames.wr.usgs.gov/',fetched,feature:'https://planetarynames.wr.usgs.gov/Feature/',types,bodies:index.filter(b=>b.drawn).map(b=>b.id)}));
console.log(JSON.stringify({out,fetched,skipped,drawn:index.filter(b=>b.drawn).map(b=>`${b.target} ${b.features}`),not_drawn:index.filter(b=>!b.drawn).map(b=>b.target)}));

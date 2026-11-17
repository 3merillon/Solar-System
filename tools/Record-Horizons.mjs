// Record reference positions from JPL Horizons, once, for the ephemeris test. Bounded: one request per
// body, sequential, a pause between them, and it refuses to go past its budget or overwrite a record.
// The output is a small file of public numbers the test reads with no network.
//   node tools/Record-Horizons.mjs OUT.json
import {writeFileSync,existsSync} from 'node:fs';
const out=process.argv[2];if(!out)throw Error('usage: Record-Horizons.mjs OUT.json');
if(existsSync(out))throw Error(`${out} exists: a record is made once`);
const HOST='https://ssd.jpl.nasa.gov/api/horizons.api';
// Target against centre, in NAIF codes, as the table holds them. Epochs: Julian dates, TDB, off every fitting grid.
const PAIRS=[[199,10],[299,10],[399,10],[301,399],[499,10],[401,499],[402,499],[599,10],[501,599],[502,599],[503,599],[504,599],[699,10],[601,699],[602,699],[603,699],[604,699],[605,699],[606,699],[608,699],[799,10],[701,799],[702,799],[703,799],[704,799],[705,799],[899,10],[801,899],[999,10],[901,999]];
const EPOCHS_WIDE=[2415385.3,2422345.7,2430011.1,2433283.9,2440587.5,2444240.2,2447892.8,2451545.0,2453371.4,2456293.6,2458849.3,2460310.9,2461710.2,2463132.5,2465000.8,2469807.6,2473459.1,2488069.4];
const EPOCHS_SATELLITE=[2450083.1,2451545.0,2453371.4,2456293.6,2458849.3,2460310.9,2461710.2,2463132.5,2465000.8,2467000.3,2469807.6];
const BUDGET=PAIRS.length;let spent=0;
const results=[];
for(const [target,center] of PAIRS){
 if(spent++>=BUDGET)throw Error('budget spent');
 const epochs=center===10||target===301?EPOCHS_WIDE:EPOCHS_SATELLITE;
 const q=new URLSearchParams({format:'text',COMMAND:`'${target}'`,OBJ_DATA:'NO',MAKE_EPHEM:'YES',EPHEM_TYPE:'VECTORS',CENTER:`'500@${center}'`,REF_PLANE:'FRAME',REF_SYSTEM:'ICRF',VEC_TABLE:'2',OUT_UNITS:'KM-S',CSV_FORMAT:'YES',VEC_LABELS:'NO',TLIST_TYPE:'JD',TIME_TYPE:'TDB',TLIST:epochs.map(e=>`'${e}'`).join(' ')});
 const response=await fetch(`${HOST}?${q}`);
 const text=await response.text();
 const block=/\$\$SOE([\s\S]*?)\$\$EOE/.exec(text);
 if(!response.ok||!block){console.error(target,center,response.status,text.slice(0,400));process.exitCode=1;results.push({target,center,error:text.slice(0,200)});}
 else{
  const rows=block[1].trim().split('\n').map(l=>l.split(',').map(s=>s.trim()));
  const version=/Revised:.*|Ephemeris \/ API_USER.*|EPHEMERIS.*/.exec(text)?.[0]||'';
  results.push({target,center,rows:rows.map(r=>({jd:Number(r[0]),position_km:[Number(r[2]),Number(r[3]),Number(r[4])],velocity_km_s:[Number(r[5]),Number(r[6]),Number(r[7])]}))});
  console.error(target,center,rows.length,version.slice(0,50));
 }
 await new Promise(r=>setTimeout(r,1500));
}
writeFileSync(out,JSON.stringify({recorded:new Date().toISOString(),source:HOST,frame:'ICRF, vectors, TDB, centres at the body',requests:spent,results},null,0));

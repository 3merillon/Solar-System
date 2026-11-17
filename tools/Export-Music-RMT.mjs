// Write a stretch of a piece of the score as a Relative Music Theory module: a JSON file that RMT Compose (rmt.world,
// repository rmt-compose-poc) opens with Load Module. Pure Node: no browser, no sound.
// Usage: node tools/Export-Music-RMT.mjs --mood nocturne --seed 7 --base 10/9 [--from 0] [--bars 16] [--out file.json] [--mirror 1] [--root web]
// --place NAME takes the base note and the orrery of a body instead (Sun, Earth, Jupiter, Europa ...).
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const root=resolve(arg('root','web')),load=f=>import(pathToFileURL(resolve(root,f)).href);
const {Q,fold}=await load('music-theory.js'),{makeTheme}=await load('music-composer.js'),{toModule}=await load('music-rmt.js'),D=await load('music-director.js');
const NAIF={sun:10,mercury:199,venus:299,earth:399,moon:301,mars:499,phobos:401,deimos:402,jupiter:599,io:501,europa:502,ganymede:503,callisto:504,saturn:699,mimas:601,enceladus:602,tethys:603,dione:604,rhea:605,titan:606,iapetus:608,
 uranus:799,ariel:701,umbriel:702,titania:703,oberon:704,miranda:705,neptune:899,triton:801,pluto:999,charon:901};
const place=arg('place',''),id=NAIF[place.toLowerCase()],mood=arg('mood','nocturne'),seed=+arg('seed',1);
if(place&&!id)throw Error(`No body named ${place}`);
const theme=makeTheme({mood,seed,hz:D.BASE_HZ,base:id?D.noteOf(id):Q.of(arg('base','1')),orbit:id?D.orreryOf(id):null,light:id?D.TRAITS[D.kindOf(id)].light:0,mirror:arg('mirror','0')==='1'});
const from=+arg('from',0),bars=+arg('bars',Math.min(16,theme.length)),module=toModule(theme,{from,bars,energy:+arg('energy',.5)});
const out=resolve(arg('out',`${mood}-${seed}.json`));
await writeFile(out,JSON.stringify(module,null,2));
console.log(`${theme.label}\n${place?`${place}: ${fold(theme.place,1)} of the Sun's note (${theme.place} with its octaves)\n`:''}bars ${from} to ${from+bars} of ${theme.length}: ${module.notes.length} notes, tempo ${module.baseNote.tempo}, BaseNote ${module.baseNote.frequency} Hz\n${out}`);

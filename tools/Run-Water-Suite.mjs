// The water test suite: every recorded water fixture and view through Test-River-Overflow, serially, against one
// served build. Used for the baseline (docs/WATER-LAYER.md, phase 0) and for each later phase against the same
// fixtures, so before and after are the same cases.
//   node tools/Run-Water-Suite.mjs --base http://127.0.0.1:5201 --out $SOLAR_DATA/water-layer-2026-11-03/phase0/base
//   [--only classes,waves,flicker,shadow,timing]  subsets (default all)   [--fixtures wupper,rhine,douro,leixoes]
//   [--extra "--layer"]  arguments added to every run (the water layer: docs/WATER-LAYER.md)
// Timing runs at 1920 x 1080; read the GPU's 3D engine use by other processes before and after (the suite does not).
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const base=arg('base','http://127.0.0.1:5201'),out=resolve(arg('out','evidence/local/water-suite')),only=new Set(arg('only','classes,waves,flicker,shadow,timing').split(','));
const fixtures=new Set(arg('fixtures','wupper,rhine,douro,leixoes').split(',')),extraArgs=(arg('extra','')||'').split(' ').filter(Boolean);
const F={
 wupper:[],
 rhine:['--fixture-path',(process.env.SOLAR_DATA||'data')+'/water-fixtures/rhine/fixture.json'],
 douro:['--fixture','douro'],
 leixoes:['--fixture-path',(process.env.SOLAR_DATA||'data')+'/water-fixtures/leixoes/fixture.json','--sea'],
};
const runs=[
 ['classes','wupper','bank,near,mid,far,junction,steep',[]],
 ['classes','rhine','bank,near,mid,far,junction,steep',[]],
 ['classes','douro','coast,under,near,mid,far',[]],
 ['classes','leixoes','coast,under,near,mid,far',[]],
 ['waves','wupper','bank,near',['--waves','8']],
 ['waves','douro','coast,under',['--waves','8']],
 ['waves','leixoes','coast',['--waves','8']],
 ['flicker','wupper','near',['--flicker']],
 ['flicker','douro','coast,under',['--flicker']],
 ['shadow','wupper','near,bank',['--shadows','--sun-elevation','12','--shadow-diagnostic','1','--flicker']],
 ['timing','wupper','near,mid,far',['--timing','300','--width','1920','--height','1080']],
 ['timing','rhine','near,mid,far',['--timing','300','--width','1920','--height','1080']],
 ['timing','douro','coast,under,far',['--timing','300','--width','1920','--height','1080']],
 ['timing','leixoes','coast,mid',['--timing','300','--width','1920','--height','1080']],
];
await mkdir(out,{recursive:true});
const summary={base,extra:extraArgs,started:new Date().toISOString(),runs:[]};
for(const [kind,fixture,views,extra] of runs){
 if(!only.has(kind)||!fixtures.has(fixture))continue;
 const dir=resolve(out,`${kind}-${fixture}`),t0=Date.now();
 const r=spawnSync(process.execPath,['tools/Test-River-Overflow.mjs','--base',base,'--out',dir,'--views',views,...F[fixture],...extra,...extraArgs],{encoding:'utf8',timeout:3600000,maxBuffer:64*1024*1024});
 let report=null;try{report=JSON.parse(await readFile(resolve(dir,'report.json'),'utf8'));}catch{}
 const views_=report?Object.fromEntries(Object.entries(report.views).map(([k,v])=>[k,{...v}])):null;
 // Arrival from round 3: round 1 is always flooded (camera under the 400 m placeholder roots).
 const arrival=report?.arrival?.filter(a=>a.round>=3).map(a=>a.spill)??[];
 const row={kind,fixture,views:views_,arrival_from_round3:arrival.length?{max:Math.max(...arrival),median:arrival.sort((a,b)=>a-b)[arrival.length>>1]}:null,status:r.status,ms:Date.now()-t0,fatal:report?.fatal??null,stderr:r.status?r.stderr.slice(-2000):undefined};
 summary.runs.push(row);console.log(JSON.stringify({kind,fixture,status:r.status,ms:row.ms,arrival:row.arrival_from_round3}));
 await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,1));
}
summary.finished=new Date().toISOString();await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,1));

// Audit the shipped catalogs and the live selection paths. The first part
// also runs without a browser: node tools/Test-Landmark-Guide.mjs --catalog
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {describeLandmark,landmarkNeighborhood} from '../web/landmark-guide.js';
import {headless} from './Headless.mjs';
import {ready} from './Explorer-Test-Lib.mjs';

const json=async path=>JSON.parse(await readFile(new URL('../web/landmarks/'+path+'.json',import.meta.url),'utf8'));
const [index,guide,notes]=await Promise.all(['index','guide','field-notes'].map(json));
const counts={bodies:0,features:0,articles:0,depths:0,radar:0,mapCenters:0,altimetry:0,direct:0};
const ids=new Set(), examples={};
for(const body of index.bodies){
  const [{features,target},{articles},survey,geology]=await Promise.all([json(body),json('articles/'+body),
    [301,299].includes(body)?json('surveys/'+body):{},[301,299,499].includes(body)?json('geology/'+body):{}]);
  const places=landmarkNeighborhood(features,notes);
  counts.bodies++;counts.articles+=Object.keys(articles).length;
  const bodyIds=new Set(features.map(f=>String(f[5])));
  for(const dataset of [articles,survey,geology.centers||{},geology.elevations||{}]){
    assert.ok(Object.keys(dataset).every(id=>bodyIds.has(id)),'orphaned source on body '+body);
  }
  for(const f of features){
    const id=f[5];
    ids.add(String(id));counts.features++;
    assert.ok(guide.types[f[4]] && f[7]>1900,'catalog identity or classification missing for '+f[0]);
    if (articles[id]) assert.ok(articles[id][1]>0 && articles[id][2].length>15);
    if (survey[id]) counts[body===301?'depths':'radar']++;
    if (geology.centers?.[id]) {
      counts.mapCenters++;
      assert.ok(geology.units[geology.centers[id]]);
    }
    if (Number.isFinite(geology.elevations?.[id])) counts.altimetry++;
    if (articles[id] || notes[id] || survey[id] || geology.centers?.[id] || Number.isFinite(geology.elevations?.[id])) counts.direct++;
    const entry=describeLandmark(body,f,{guide,notes,articles,survey,geology,places,radius:body===301?1737400:1e6,bodyName:target});
    assert.ok(entry.paragraphs.join(' ').length>100 && entry.summary.length>45,f[0]);
    assert.doesNotMatch(entry.paragraphs.join(' '),/\b(undefined|NaN)\b/);
    assert.ok(entry.links.some(([,url])=>url.endsWith('/Feature/'+id)));
    if ([4453,6163,3787,9931,2478].includes(id)) examples[id]={f,entry};
  }
}
assert.ok(Object.keys(notes).every(id=>ids.has(id)));
assert.match(examples[4453].entry.summary,/largest volcano in the Solar System/);
assert.match(examples[6163].entry.paragraphs.join(' '),/5\.0 km below the rim/);
assert.match(examples[3787].entry.paragraphs.join(' '),/multiple rings/);
assert.match(examples[9931].entry.paragraphs.join(' '),/takes its name from Herschel/);
assert.equal(counts.bodies,25);
console.log(counts);

if (!process.argv.includes('--catalog')){
  const b=await headless('evidence/local/landmark-guide');
  try{
    const base=process.env.SOLAR_TEST_URL || 'http://127.0.0.1:5198/';
    await b.send('Page.navigate',{url:new URL('index.html?test=1',base).href});
    await ready(b);
    // Select a lunar crater then Mars without waiting for either reference file.
    // Only the latest selection may finish updating the two reading surfaces.
    await b.evaluate(`solarFlight.landmarks.show(301,${JSON.stringify(examples[6163].f)});solarFlight.landmarks.show(499,${JSON.stringify(examples[4453].f)});`);
    const check=async pattern=>{
      for(let i=0;i<120;i++){
        const view=await b.evaluate(`(()=>{const hud=document.querySelector('#selection-entry');return {name:hud.querySelector('strong').textContent,hud:hud.textContent,description:document.querySelector('#landmark-description').textContent,links:[...document.querySelectorAll('#landmark-link a')].map(a=>a.href),passive:getComputedStyle(hud).pointerEvents};})()`);
        if(pattern.test(view.description)) return view;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('The selection did not load its reference text');
    };
    const mars=await check(/largest volcano/);
    assert.equal(mars.name,'Olympus Mons');assert.match(mars.hud,/largest volcano/);
    assert.equal(mars.passive,'none');assert.ok(mars.links.some(l=>l.includes('esa.int')));
    assert.ok(mars.links.some(l=>l.includes('oldid=')));
    assert.ok(await b.evaluate("document.querySelector('#landmark-description details summary').textContent.includes('Olympus Mons')"));
    await b.evaluate(`solarFlight.landmarks.show(301,${JSON.stringify(examples[9931].f)})`);
    const moon=await check(/below the rim/);
    assert.ok(moon.links.some(l=>l.includes('zenodo')));assert.match(moon.description,/Herschel/);
    await b.evaluate(`solarFlight.landmarks.show(601,${JSON.stringify(examples[2478].f)});solarFlight.landmarks.clear();`);
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.ok(await b.evaluate("document.querySelector('#selection-entry').hidden && !solarFlight.landmarks.selected"));
    console.log('Desktop HUD, reference links, rapid selections and dismissal passed.');
  }finally{await b.close();}
}

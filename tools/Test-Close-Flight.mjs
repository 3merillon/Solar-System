// Grazing rays through Saturn's deck, a skim within the solar photosphere, and
// meter recovery looking into the Galactic centre. Capture identical camera moves.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {headless} from './Headless.mjs';
import {ready,runFrames,capture} from './Explorer-Test-Lib.mjs';
import {giantShot} from './Giant-Flight.mjs';

const [base='http://127.0.0.1:5348',folder='evidence/local/close-flight',mode='current']=process.argv.slice(2);
const out=resolve(folder), w=1280,h=720;
await mkdir(out,{recursive:true});
const browser=await headless(join(out,'browser'));
const cam='solarExplorer.camera=solarFlight.frame(0,new Set(),0);';
const report={mode,shots:{}};
// Row-to-row curvature after averaging 32 horizontal pixels. A long contour
// registers strongly, while dither and individual bright points average out.
function horizontalStriping(pixels) {
  const curvature=[];
  for(let x=0;x+32<=w;x+=32){
    let last=0,previous=0;
    for(let y=0;y<h;y++){
      let sum=0;
      for(let i=0;i<32;i++)sum+=pixels[4*(y*w+x+i)+1];
      if(y>=2)curvature.push(Math.abs(sum-2*last+previous)/32);
      previous=last;last=sum;
    }
  }
  curvature.sort((a,b)=>a-b);
  return curvature[Math.floor(curvature.length*.99)];
}
async function shot(name) {
  const pixels=await capture(browser,join(out,name+'.png'),w,h);
  const values=[];
  // Average a tile before evaluating the sky. Isolated stars cannot stand in for diffuse light.
  for(let y=0;y+16<=h;y+=16)for(let x=0;x+16<=w;x+=16){
    let sum=0;for(let j=0;j<16;j++)for(let i=0;i<16;i++)sum+=pixels[((y+j)*w+x+i)*4+1];values.push(sum/256);
  }
  values.sort((a,b)=>a-b);
  const stats={p10:values[Math.floor(.1*values.length)],median:values[Math.floor(.5*values.length)],p90:values[Math.floor(.9*values.length)]};
  stats.stripe_p99=horizontalStriping(pixels);
  report.shots[name]=stats;return stats;
}
try {
  await browser.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url:base+'/index.html?body=solar&test=1&at=699&quality=high'});
  await ready(browser);
  await browser.evaluate(`solarExplorer.resize(${w},${h});solarFlight.setTime(432000000);
    for(const id of ['solar-labels','solar-trails'])document.getElementById(id).checked=false;`);
  await runFrames(browser,90,cam);
  await browser.evaluate(giantShot(699,.67));
  const day=await browser.evaluate('solarFlight.flight.packet(1280,720)[36]');
  await browser.evaluate(`solarExplorer.configure({auto_exposure:false,exposure:${1.3/day}})`);
  await runFrames(browser,24,'window.giantFlight(.42);'+cam);
  const grazing=await shot('cloud-grazing');
  await browser.evaluate('window.giantFlight(.67)');
  await runFrames(browser,36,cam);
  await shot('cloud-entry');
  await browser.evaluate("document.getElementById('solar-trails').checked=true");
  await runFrames(browser,20,cam);
  await shot('cloud-guides');
  await browser.evaluate("document.getElementById('solar-trails').checked=false");
  await runFrames(browser,90,'window.giantFlight(.51+i*.0035);'+cam);
  await shot('cloud-moving');
  await browser.evaluate(`window.solarSkim=(height,offset=0)=>{const f=solarFlight.flight,r=f.constructor.body_radius(10);
    const z=r+height,pitch=Math.acos(r/z)+.16;f.jump_camera(10,new Float64Array([0,offset,z,1000*Math.cos(pitch),offset,z-1000*Math.sin(pitch),0,0,1]));};
    solarSkim(200);solarExplorer.configure({auto_exposure:false,exposure:.065});`);
  await runFrames(browser,30,cam);
  const skim=await shot('sun-200m');
  await runFrames(browser,90,'solarSkim(120000*Math.exp(-i/16),i*100);'+cam);
  const moving=await shot('sun-moving');
  // Recover ICRF -> body-fixed axes from the ordinary flight packet while looking at Sol.
  await browser.evaluate(`{const f=solarFlight.flight;f.jump_near(10,1e10);f.look_at(10);
    const p=f.packet(1280,720),header=p.length-39*p[26]-p[31];let r;
    for(let i=0;i<p[26];i++){const b=p.slice(header+39*i,header+39*(i+1));if(b[10]===1&&b[38]===10)r=b;}
    const centre=[-.054876,-.873437,-.483835],north=[-.867666,-.198076,.455984];
    const rotate=v=>[16,19,22].map(k=>r[k]*v[0]+r[k+1]*v[1]+r[k+2]*v[2]);
    const dir=rotate(centre),up=rotate(north),eye=dir.map(v=>v*1.2e12);
    f.jump_camera(10,new Float64Array([...eye,...eye.map((v,i)=>v+dir[i]*1e5),...up]));
    solarExplorer.configure({auto_exposure:false,exposure:1.3});}`);
  await runFrames(browser,12,cam);
  const locked=await shot('galaxy-daylight');
  await browser.evaluate('solarExplorer.configure({auto_exposure:true,exposure:1.3})');
  await runFrames(browser,360,cam);
  const adapted=await shot('galaxy-adapted');
  await browser.evaluate("document.getElementById('solar-trails').checked=true");
  await runFrames(browser,120,cam);
  const guides=await shot('galaxy-guides');
  if(mode!=='baseline'){
    assert(grazing.stripe_p99<4 && grazing.p90-grazing.median>4 && grazing.p90-grazing.p10>75,
      'cloud-top skim retains weather and horizon contrast without long horizontal sampling bands');
    for(const disk of [skim,moving]){
      assert(disk.stripe_p99<1 && disk.p90-disk.p10>6,'resolved photosphere without long horizontal terraces');
    }
    assert(adapted.median>=8 && adapted.p90-adapted.p10>=10,'observable diffuse galactic structure');
    assert(adapted.p90>locked.p90+8,'recovery from daylight');
    assert(guides.median>=8 && guides.p90-guides.p10>=10,'diffuse galactic structure with orbit guides');
  }
  console.log(JSON.stringify(report));
} finally {await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}

// The director: where the player is decides what is played. It turns the flight report into a place, the place into a
// note (an exact fraction of the Sun's), a family of moods and a seed, and says when to change piece.
// Pure: no Web Audio and no page in here. update() is given plain numbers and answers with plain actions.
import {Q,q,ONE,fold,hash,rng,clamp} from './music-theory.js';
import {makeTheme} from './music-composer.js';
import {apart} from './music-harmony.js';

// The BaseNote of the whole score: the Sun. 263 Hz is the base the owner's own modules start from; three octaves down
// it is a note a room can stand on.
export const BASE_HZ=263/8;

// Each body's note is a fraction of its parent's: the ratio of their orbital frequencies (how many times the body goes
// round while its parent goes round once), as the nearest simple fraction to the measured period ratio (prime limit 13,
// within 0.6%). Earth hangs from the Sun by the Sun's own rotation (25.38 days against the year). True resonances are
// exact by nature and marked: Io, Europa and Ganymede 4:2:1 (Laplace), Neptune and Pluto 3:2, Enceladus and Dione 2:1,
// Mimas and Tethys 2:1. docs/MUSIC.md lists every period, fraction and error.
export const ORBITS={
 399:[10,'5/72'],199:[399,'25/6'],299:[399,'13/8'],499:[399,'8/15'],599:[399,'27/320'],699:[399,'3/88'],799:[399,'1/84'],899:[399,'7/1152'],999:[899,'2/3'],
 301:[399,'40/3'],401:[499,'10752/5'],402:[401,'16/63'],
 501:[599,'12288/5'],502:[501,'1/2'],503:[502,'1/2'],504:[503,'3/7'],
 606:[699,'672'],605:[606,'39/11'],604:[605,'33/20'],603:[604,'13/9'],602:[604,'2'],601:[603,'2'],608:[606,'1/5'],
 703:[799,'24576/7'],704:[703,'9/14'],702:[703,'21/10'],701:[702,'18/11'],705:[701,'16/9'],
 801:[899,'10240'],901:[999,'212992/15'],
};
const NAMES={10:'Sun',199:'Mercury',299:'Venus',399:'Earth',301:'Moon',499:'Mars',401:'Phobos',402:'Deimos',599:'Jupiter',501:'Io',502:'Europa',503:'Ganymede',504:'Callisto',699:'Saturn',601:'Mimas',602:'Enceladus',603:'Tethys',
 604:'Dione',605:'Rhea',606:'Titan',608:'Iapetus',799:'Uranus',701:'Ariel',702:'Umbriel',703:'Titania',704:'Oberon',705:'Miranda',899:'Neptune',801:'Triton',999:'Pluto',901:'Charon'};
const isStar=id=>id===10||(id>=10000&&id%100===0);
// A body's number from its name (for tools).
export const bodyNamed=name=>+Object.keys(NAMES).find(id=>NAMES[id].toLowerCase()===String(name).toLowerCase())||0;
const starOf=id=>id>=10000?Math.floor(id/100)*100:10;
// The nearest simple fraction to a number (for a star's note: the ratio of its temperature to the Sun's, since the
// frequency at which a star shines most is proportional to its temperature).
export function simple(x,tolerance=.012){
 let best=null;
 for(let d=1;d<=32;d++){const n=Math.round(x*d);if(n<1)continue;const err=Math.abs(n/d/x-1);if(err>tolerance)continue;const f=q(n,d),cost=Number(f.n*f.d);if(!best||cost<best.cost)best={f,cost};}
 return best?best.f:q(Math.round(x*16),16);
}
const WORLDS=['1','9/8','5/4','4/3','3/2','5/3','15/8'].map(x=>Q.of(x));
// A body's note as an exact fraction of the Sun's, octaves and all. `teff`: the temperature of a star other than the Sun.
export function noteOf(id,teff=5772){
 if(id===10)return ONE;
 if(isStar(id))return simple(teff/5772);
 if(id>=10000)return noteOf(starOf(id),teff).mul(WORLDS[(id%100)%WORLDS.length]);   // invented worlds: steps of the pure major scale over their star
 const o=ORBITS[id];return o?noteOf(o[0]).mul(Q.of(o[1])):ONE;
}
// The orrery of a place: the bodies that go round the same parent, as fractions of one of them. Real period ratios.
const SYSTEMS={
 10:[['Mercury','25/6'],['Venus','13/8'],['Earth','1'],['Mars','8/15'],['Jupiter','27/320'],['Saturn','3/88']],
 399:[['Moon','1'],['Sun turning','14/13'],['Earth, the year','3/40']],
 499:[['Phobos','1'],['Deimos','16/63']],
 599:[['Io','4'],['Europa','2'],['Ganymede','1'],['Callisto','3/7']],
 699:[['Mimas','169/10'],['Enceladus','117/10'],['Tethys','169/20'],['Dione','117/20'],['Rhea','39/11'],['Titan','1'],['Iapetus','1/5']],
 799:[['Miranda','336/55'],['Ariel','189/55'],['Umbriel','21/10'],['Titania','1'],['Oberon','9/14']],
 899:[['Neptune','3'],['Pluto','2']],999:[['Neptune','3'],['Pluto','2']],
};
// A moon's system is its planet's (NAIF numbers: moons x01 to x98 go round planet x99); a planet without moons, the Sun
// and deep space have the planets'; the worlds of other stars are invented, so their orreries are too (none here).
export function orreryOf(id){
 if(id>=10000)return null;
 const planet=id>100?Math.floor(id/100)*100+99:10,s=SYSTEMS[planet]||SYSTEMS[10];
 return s.map(([name,by])=>({name,by:Q.of(by)}));
}

// What kind of place a body is, and what that asks of the music.
const KIND={199:'rock',301:'rock',401:'rock',402:'rock',503:'rock',504:'rock',608:'rock',702:'rock',704:'rock',
 502:'ice',601:'ice',602:'ice',603:'ice',604:'ice',605:'ice',701:'ice',703:'ice',705:'ice',801:'ice',901:'ice',999:'ice',
 599:'giant',699:'giant',799:'giant',899:'giant',501:'fire',299:'fire',499:'air',606:'air',399:'earth'};
export const kindOf=id=>id===0?'space':isStar(id)?'star':id>=10000?'alien':KIND[id]||'rock';
// Moods by kind of place, with weights. The piece for speed (the etude) is multiplied by `drive` below.
const FAMILIES={
 star:{sunrise:3,chorale:2,vigil:1.5,orrery:1.5,consolation:1},
 giant:{orrery:2.5,passacaglia:2,chorale:2,vigil:1.5,elegy:1,prelude:1},
 ice:{consolation:2.5,prelude:2,nocturne:1.5,berceuse:1.5,vigil:1},
 rock:{elegy:2.5,passacaglia:1.5,nocturne:1.5,prelude:1.5,vigil:1,chorale:1},
 fire:{elegy:2,passacaglia:2,chorale:1,prelude:1,etude:1},
 air:{nocturne:2,aria:2,berceuse:1.5,prelude:1.5,consolation:1,etude:1},
 earth:{nocturne:2.5,aria:2,prelude:2,berceuse:1.5,consolation:1.5,chorale:1,elegy:1,passacaglia:1,etude:1,orrery:.5},
 space:{vigil:3,prelude:1.5,chorale:1.5,orrery:1.5,nocturne:1,consolation:1,etude:1},
 // Among the rings of Saturn: ice and many small things going round. Inside the asteroid belt: sparse, stony, far apart.
 rings:{orrery:3,consolation:2,berceuse:2,prelude:1.5},
 belt:{vigil:2.5,elegy:1.5,prelude:1.5,passacaglia:1},
 alien:{consolation:2,vigil:2,sunrise:1.5,nocturne:1.5,elegy:1.5,prelude:1},
};
// What a kind of place leans to: light toward major (+) or minor (-), heat how bright the sound, rich whether the far
// harmonics of the series may be heard there (a star).
export const TRAITS={star:{light:.5,heat:.8,rich:true},giant:{light:-.1,heat:.45},ice:{light:.25,heat:.75},rock:{light:-.25,heat:.4},fire:{light:-.7,heat:.3},air:{light:.1,heat:.5},
 earth:{light:.45,heat:.6},space:{light:0,heat:.5},alien:{light:0,heat:.6,rich:true},rings:{light:.3,heat:.8},belt:{light:-.15,heat:.45}};
const BEATS={etude:1};
// Two pieces may sound together for the length of a crossfade only if their keys go together: the tonics a fifth or a
// third apart (or the same), and no two tones of their tonic chords nearer than a semitone. So: the same key, a key and
// its dominant, a key and its relative. Otherwise the first is let go before the second begins: no two unrelated keys
// at once (the notes of two bodies are whatever their orbits make them).
const NEAR=['1','3/2','4/3','5/4','8/5','6/5','5/3'].map(x=>Q.of(x));
export function blends(a,b){
 const key=T=>T&&T.keys&&T.keys[0],triad=k=>{const t=fold(k.t,1);return [t,t.mul(k.minor?q(6,5):q(5,4)),t.mul(q(3,2))];},A=key(a),B=key(b);
 if(!A||!B)return false;
 const rel=fold(B.t.div(A.t),1);if(!NEAR.some(n=>n.eq(rel)))return false;
 for(const p of triad(A))for(const s of triad(B)){const c=apart(p,s);if(c>3&&c<100)return false;}
 return true;
}

// Radii within which a body takes over the music, and beyond which it lets go; seconds a new place must hold.
const ENTER=6,EXIT=10,DWELL=4;
export function createDirector({salt=1,lite=false}={}){
 const visits=new Map(),heard=new Set(),bags=new Map();
 let zone=null,candidate=null,candidateSince=0,piece=0,energy=.4,tripping=false,jumping=false,silentUntil=0,mirror=false,current=null,forced=false;
 // A shuffle bag per kind of place: every mood of the family comes round before one repeats, heavier ones more often.
 function draw(kind,r,drive){
  const family=FAMILIES[kind]||FAMILIES.space;let bag=bags.get(kind);
  if(!bag||!bag.length){bag=[];for(const [mood,weight] of Object.entries(family))for(let i=0;i<Math.max(1,Math.round(weight*2));i++)bag.push(mood);bag=r.shuffle(bag);bags.set(kind,bag);}
  // Pieces with a beat are for speed: common when the craft is moving fast or low, rare otherwise.
  for(let i=0;i<bag.length;i++){const mood=bag[i];if(mood===(current&&current.mood)&&bag.length>1)continue;if(BEATS[mood]&&r()>(drive?.9:.2))continue;bag.splice(i,1);return mood;}
  return bag.shift();
 }
 function where(info){
  const system=info.system||10,h=info.radius>0?info.clear/info.radius:Infinity;
  // Saturn's rings reach from 0.11 to 1.33 of its radii above the cloud tops; the band is entered a little inside that and
  // left a little outside. (The report has no latitude: this is the rings' height, not their plane.)
  if(info.near===699){const inside=zone&&zone.key==='rings:699';if(h>(inside?.08:.15)&&h<(inside?1.5:1.3))return 'rings:699';}
  if(zone&&zone.body===info.near&&zone.body&&h<EXIT&&zone.key.startsWith('body:'))return zone.key;
  if(info.near&&h<ENTER)return `body:${info.near}`;
  return info.belt&&system===10?'belt:10':`space:${system}`;
 }
 function compose(key,info){
  const rings=key.startsWith('rings:'),belt=key.startsWith('belt:'),body=key.startsWith('body:')?+key.slice(5):rings?699:0,system=key.startsWith('space:')?+key.slice(6):belt?10:starOf(body),alien=system!==10;
  const kind=rings?'rings':belt?'belt':body?kindOf(body):alien?'alien':'space',traits=TRAITS[kind],visit=visits.get(key)||0,seed=hash(salt,key,visit,piece),r=rng(seed);
  const teff=info.teff||5772,note=body?noteOf(body,teff):noteOf(system,teff),mood=draw(kind,r,energy>.6);
  // A hotter star is brighter in harmony and in sound; a cooler one darker.
  const warmth=isStar(body)||!body?clamp((teff-5772)/4000,-1,1)*.4:0;
  const theme=makeTheme({mood,seed,hz:BASE_HZ,base:note,light:clamp(traits.light+warmth,-1,1),heat:clamp(traits.heat+warmth*.3,0,1),rich:!!traits.rich,orbit:orreryOf(body||system),
   octave:body===501?1:body===503||body===504?-1:0,mirror,lite,avoid:heard});
  if(theme.print)heard.add(theme.print);
  const name=rings?'Saturn\u2019s rings':belt?'the asteroid belt':body?(NAMES[body]||info.name||`world ${body}`):alien?(info.systemName?`${info.systemName} space`:'deep space'):'deep space';
  theme.place=name;theme.note=note;
  const of=fold(note,1);
  theme.line=`${name} · ${!of.eq(ONE)?`${of} of the Sun`:body===10?'the BaseNote, 263/8 Hz':'on the Sun’s note'} · ${theme.label}`;
  return {theme,key,body,kind};
 }
 return {
  // info: {near, clear, radius, speed, landed, system, teff, name, systemName, trip (a Go trip under way), jump (the
  // hyperdrive showing), rate (the clock's), belt (the page is drawing the asteroid field round the eye)}; now: seconds; playing: {bar, length, barSeconds} of the piece sounding.
  // Returns a list of actions: {play: theme, fade, dip}, {accent: kind, seconds, base}, {hush: seconds}. `dip`: seconds the
  // new piece waits after the old one has begun to fade (keys that cannot sound together: see blends()).
  update(info,now,playing){
   const out=[],play=(theme,fade,before)=>out.push({play:theme,fade,dip:before&&!blends(before,theme)?fade*.7:0});
   // Speed, height and the clock shape the energy; the composer opens and closes its busier layers with it.
   const speed=Math.log10(1+Math.abs(info.speed||0))/8,low=info.radius>0&&info.clear/info.radius<.02&&(info.speed||0)>30?.2:0,clock=Math.abs(info.rate||1)>1?Math.min(.15,Math.log10(Math.abs(info.rate))/40):0;
   energy+=(clamp(.22+speed*.6+low+clock-(info.landed?.1:0),0,1)-energy)*.25;
   // The clock running backward turns the music over: every mode mirrored, every tune inverted.
   const rate=info.rate??1,back=rate<0;
   if(info.trip&&!tripping)out.push({accent:'riser',seconds:5,base:(zone&&zone.note)||ONE});
   if(info.jump&&!jumping)out.push({accent:'jump',seconds:1.5,base:(zone&&zone.note)||ONE});
   const arrived=(tripping&&!info.trip)||(jumping&&!info.jump);tripping=!!info.trip;jumping=!!info.jump;
   const key=where(info);
   if(key!==candidate){candidate=key;candidateSince=now;}
   // A new place takes over after it has held for a few seconds (a skim past a moon changes nothing); a trip's end, at once.
   const moved=(!zone||key!==zone.key)&&!tripping&&!jumping&&(arrived||!zone||now-candidateSince>=DWELL);
   const ended=zone&&playing&&playing.length>0&&playing.bar>=playing.length-Math.max(1,Math.round(8/playing.barSeconds));
   // A stopped clock is neither forward nor backward: the music stays as it was.
   const turned=zone&&rate!==0&&back!==mirror&&!tripping;
   if(moved||turned||forced){
    const before=zone,sounding=current;mirror=back;if(moved){visits.set(key,(visits.get(key)||0)+1);piece=0;}else piece++;
    const made=compose(key,info);zone={key,body:made.body,kind:made.kind,note:made.theme.note};current=made.theme;silentUntil=0;forced=false;
    const fade=arrived?4:moved?clamp(made.theme.bar*2,5,10):6;
    // An arrival by trip is marked by a gong; a place flown into is announced by its own note, held through the change.
    if(arrived)out.push({accent:'arrive',base:made.theme.note});else if(moved&&made.body&&before&&before.body!==made.body)out.push({accent:'enter',base:made.theme.note,seconds:fade});
    play(made.theme,fade,sounding);
   }else if(arrived&&zone){
    // A trip that ends in the place it began (to a landmark, say) still arrives.
    out.push({accent:'arrive',base:zone.note});
   }else if(silentUntil){
    // In a silence: nothing is sounding, so nothing can "end"; the next piece begins when the silence has run.
    if(now>=silentUntil&&!tripping){silentUntil=0;piece++;const made=compose(zone.key,info);current=made.theme;play(made.theme,clamp(made.theme.bar*2,6,12),null);}
   }else if(ended&&!tripping){
    // The piece is ending. In deep space, sometimes let it fade to near silence first, then begin the next out of that.
    if((zone.kind==='space'||zone.kind==='belt')&&rng(hash(salt,zone.key,piece,'gap'))()<.45){silentUntil=now+10+10*rng(hash(salt,piece,'len'))();out.push({hush:8});}
    else{piece++;const sounding=current,made=compose(zone.key,info);current=made.theme;play(made.theme,clamp(made.theme.bar*2,6,12),sounding);}
   }
   return out;
  },
  // Ask for another piece in the same place.
  next(){forced=true;},
  get energy(){return energy;},
  get line(){return current?current.line:'';},
  get zone(){return zone;},
  // In one of deep space's silences (nothing sounding, on purpose).
  get silent(){return silentUntil>0;},
 };
}

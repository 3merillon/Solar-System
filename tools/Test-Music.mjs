// The score's composer, harmony and director are pure JavaScript: this runs them in Node, with no browser and no sound.
// It checks what can be checked without ears: the arithmetic is exact, the same seed gives the same notes, every note is
// playable, every chord is a pure one, every piece comes home to the key it left, every change of key goes through a
// chord or a tone the two keys share exactly, no two tones a comma apart ever sound together, low chords are not mud,
// the tune stands on the harmony, the director changes piece when and only when it should. It also times the composer.
// Usage: node tools/Test-Music.mjs [--root web] [--seeds 12] [--verbose]
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const root=resolve(arg('root','web')),seeds=+arg('seeds',12),load=f=>import(pathToFileURL(resolve(root,f)).href);
const {Q,q,ONE,TWO,fold,hash,rng}=await load('music-theory.js');
const H=await load('music-harmony.js');
const {makeTheme,composeBar,harmonyAt,MOOD_NAMES,composeAccent}=await load('music-composer.js');
const D=await load('music-director.js');
const R=await load('music-rmt.js');

let passed=0,failed=0;const fails=[];
const verbose=process.argv.includes('--verbose');
const ok=(cond,what)=>{if(cond){passed++;if(verbose)console.log('  ok   '+what);}else{failed++;fails.push(what);console.log('  FAIL '+what);}};
const section=name=>console.log('\n'+name);
const sign=notes=>notes.map(e=>`${e.v}|${e.q?e.q:e.f.toFixed(3)}|${e.t.toFixed(6)}|${e.d.toFixed(6)}|${e.g.toFixed(6)}`).join('\n');
const UNPITCHED=new Set(['kick','snare','hat','clap','tom','wind','cloud','glide','metal']);
const sameChord=(a,b)=>a.pcs.length===b.pcs.length&&a.pcs.every(x=>b.pcs.some(y=>y.eq(x)));

section('Fractions and chords');
{
 const big=q(81,80).pow(400),back=big.mul(q(80,81).pow(400));
 ok(back.eq(ONE),'81/80 to the 400th and back is exactly 1');
 ok(Math.abs(big.value-Math.exp(400*Math.log(81/80)))/big.value<1e-9,'a 764-digit fraction still gives the right number');
 ok(fold(q(3,2).pow(12),1).eq(q(531441,524288)),'twelve fifths overshoot seven octaves by the Pythagorean comma, exactly');
 ok(fold(q(5,4).pow(3),1).eq(q(125,64))&&TWO.div(q(125,64)).eq(q(128,125)),'three major thirds fall short of the octave by 128/125: why a walk of keys is closed by plan and not by luck');
 const C={t:q(10,9),minor:false},G={t:q(10,9).mul(q(3,2)),minor:false},a={t:q(10,9).mul(q(5,3)),minor:true};
 ok(sameChord(H.chord(C,'vi'),H.chord(G,'ii')),'vi of a major key is exactly ii of its dominant key (both stand on 5/3)');
 ok(sameChord(H.chord(C,'ii'),H.chord(a,'iv'))&&sameChord(H.chord(C,'IV'),H.chord(a,'VI')),'ii and IV of a major key are exactly iv and VI of its relative minor');
 ok(H.chord(C,'V:7').tones.map(String).join(' ')==='1 5/4 3/2 7/4'&&H.chord(C,'V:7s').tones.map(String).join(' ')==='1 5/4 3/2 16/9','a dominant seventh is the harmonics 4:5:6:7 of its root, or has its seventh two fifths down (16/9)');
 ok(H.chord(C,'V:7s').pcs[3].eq(fold(C.t.mul(q(4,3)),1)),'the seventh two fifths down over the dominant is exactly the fourth step of the key');
 {const g=H.chord(C,'Ger'),v=H.chord(C,'V');ok(g.pcs[3].eq(fold(v.F.mul(q(15,16)),1))&&q(225,128).div(q(7,4)).eq(q(225,224)),'the augmented sixth is the leading tone of the dominant (a 16/15 below it); it lies 225/224 above the harmonic seventh');
  ok(H.shared(g,H.chord({t:C.t.mul(q(16,15)),minor:false},'V:7')).length===3,'the German sixth of a key and the dominant seventh of the key a semitone above hold three tones in common exactly');}
 // Every chord of every cell and of every modulation exists in its key and is made of primes 3, 5 and (for what leans) 7.
 let chords=0,odd=0,missing=0;
 for(const mode of ['M','m'])for(const role of Object.keys(H.CELLS[mode]))for(const cell of H.CELLS[mode][role])for(const token of cell.split('|')[0].split(' ')){
  try{const c=H.chord({t:ONE,minor:mode==='m'},token);chords++;for(const t of c.tones){const p=H.limitOf(t);if(p>7||(p===7&&!['7','9'].includes(c.quality)))odd++;}}catch{missing++;console.log('  missing '+token);}
 }
 for(const E of H.EDGES)for(const cell of E.cells)for(const token of cell.split(' ')){
  try{H.chord({t:ONE,minor:(token[0]==='<'?E.from:E.to)==='m'},token.replace('<',''));chords++;}catch{missing++;console.log('  missing '+token+' in '+cell);}
 }
 ok(missing===0&&odd===0,`${chords} chord symbols in the cells and the modulations: all exist in their key; nothing above the seventh harmonic, and that only in dominant sevenths and ninths`);
 // Every modulation of the table, tried in a key: its first new-key chord is a chord of the old key, or holds a tone of the old tonic chord.
 let doors=0,good=0;
 for(const E of H.EDGES)for(const cell of E.cells){
  const from={t:q(10,9),minor:E.from==='m'},to={t:q(10,9).mul(E.f),minor:E.to==='m'},tokens=cell.split(' '),i=tokens.findIndex(t=>t[0]!=='<'),first=H.chord(to,tokens[i]),before=i>0?H.chord(from,tokens[i-1].slice(1)):H.chord(from,E.from==='m'?'i':'I');
  let pivot=false;for(const sym of ['I','i','ii','iii','IV','iv','V','v','vi','VI','III','bIII','bVI','VII','bVII','N','Ger','V:7','I:7','i:7'])try{if(sameChord(H.chord(from,sym),first))pivot=true;}catch{}
  doors++;if(pivot||H.shared(before,first).length)good++;else console.log(`  no door: ${E.f} ${E.from}>${E.to} ${cell}`);
  const end=H.chord(to,tokens[3]);if(!(end.sym==='I'||end.sym==='i'))console.log('  does not end on the new tonic: '+cell);
 }
 ok(good===doors,`${good} of ${doors} modulations enter the new key by a chord of the old key or by a tone held exactly`);
 const r=rng(11);let walks=0,closed=0,kinds=new Set();
 for(let i=0;i<400;i++){const w=H.planWalk(r,i%2===0,1+i%3,{fifth:1,third:1,par:.4,semi:.2,tone:.3});if(!w.length)continue;walks++;let f=ONE;for(const E of w){f=f.mul(E.f);kinds.add(`${E.f}${E.from}${E.to}`);}if(fold(f,1).eq(ONE)&&w[w.length-1].to===(i%2===0?'m':'M'))closed++;}
 ok(walks>350&&closed===walks,`${closed} of ${walks} walks through one to three other keys come home exactly (${kinds.size} kinds of key change used)`);
}

section('Every mood: playable notes, exact pitch, the same seed the same music');
const timing={};
for(const mood of MOOD_NAMES){
 let notes=0,bad=0,inexact=0,low=1e9,high=0,ms=0,worst=0,bars=0,same=true,order=true,differs=0,prints=new Set(),peakCost=0,make=0;
 for(let s=0;s<seeds;s++){
  const spec={mood,seed:1000+s,base:[ONE,q(3,2),q(10,9),q(5,4)][s%4],light:(s%5-2)/2.5,rich:s%6===5,mirror:s%7===6,lite:s%4===3,orbit:mood==='orrery'&&s%2?D.orreryOf(599):null};
  const m0=performance.now(),A=makeTheme(spec);make+=performance.now()-m0;const B=makeTheme(spec);
  // B is composed back to front: nothing may depend on the order bars are asked for.
  const backward=[];for(let b=A.length+1;b>=0;b--)backward[b]=sign(composeBar(B,b,.5));
  const sounding=[];
  for(let b=0;b<A.length+2;b++){
   const t0=performance.now(),ev=composeBar(A,b,.5),dt=performance.now()-t0;ms+=dt;worst=Math.max(worst,dt);bars++;
   if(sign(ev)!==backward[b])order=false;
   for(const e of ev){
    notes++;if(!(e.f>15&&e.f<20000)||!(e.t>=0&&e.t<A.bar+1e-6)||!(e.d>0)||!(e.g>0&&e.g<1.5)||!Number.isFinite(e.f+e.t+e.d+e.g))bad++;
    if(e.q){if(Math.abs(e.f-A.hz*e.q.value)>1e-9*e.f)inexact++;low=Math.min(low,e.f);high=Math.max(high,e.f);}
    sounding.push([b*A.bar+e.t,b*A.bar+e.t+e.d+(e.r??1)*.6]);
   }
  }
  // How many notes sound at once, at worst (a note counts until most of its release has gone).
  const edges=[];for(const [a,b] of sounding){edges.push([a,1]);edges.push([b,-1]);}edges.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);let cur=0;for(const [,d] of edges){cur+=d;peakCost=Math.max(peakCost,cur);}
  const C=makeTheme({...spec,seed:5000+s});if(A.print&&C.print){if(A.print!==C.print)differs++;prints.add(A.print);}
  if(sign(composeBar(makeTheme(spec),3,.5))!==sign(composeBar(A,3,.5)))same=false;
 }
 timing[mood]={msPerBar:ms/bars,worst,make:make/seeds};
 ok(bad===0,`${mood}: ${notes} notes, none unplayable, none starting outside its bar`);
 ok(inexact===0,`${mood}: every pitch is the BaseNote times its fraction`);
 ok(same&&order,`${mood}: same seed and bar, same notes, in whatever order bars are asked for`);
 ok(low>=20&&high<=9000,`${mood}: pitches between ${low.toFixed(0)} and ${high.toFixed(0)} Hz`);
 if(prints.size)ok(differs===seeds&&prints.size===seeds,`${mood}: ${seeds} salts, ${prints.size} different tunes`);
 console.log(`  ${mood.padEnd(11)} ${String(notes).padStart(6)} notes  ${low.toFixed(0).padStart(4)}-${high.toFixed(0).padEnd(5)} Hz  compose ${(ms/bars).toFixed(3)} ms a bar (worst ${worst.toFixed(2)})  at most ${peakCost} notes at once`);
}

section('Harmony: keys, cadences, doors');
const TONAL=MOOD_NAMES.filter(m=>makeTheme({mood:m,seed:1}).harm.type==='tonal');
{
 let pieces=0,home=0,changes=0,through=0,pivots=0,kept=0,joins=0,held=0,primes=0,chords=0,relations=new Set(),moved=0,cadences=0,full=0,keysUsed=0,sevenths=0,harmonic=0,loose=0,soft=0;
 for(const mood of TONAL)for(let s=0;s<seeds;s++){
  const T=makeTheme({mood,seed:2000+s,base:q(10,9),light:(s%5-2)/2.5}),S=T.spine,first=S[0],last=S[S.length-1];
  pieces++;keysUsed+=T.keys.length;
  // Home again: the last chord is the tonic chord of the first key, on the very same pitch.
  if(last.key===first.key&&last.K.eq(first.K)&&last.F.eq(first.F)&&['I','i'].includes(last.sym)&&['I','i'].includes(first.sym))home++;
  for(const k of T.keys){if(k!==T.keys[0])relations.add(`${k.rel}${k.minor?'m':''}`);}
  if(T.keys.length>1)moved++;
  for(let k=0;k<S.length;k++){
   const A=S[k],P=S[k-1];chords++;
   for(const t of A.tones){const p=H.limitOf(t);if(p>7||(p===7&&!['7','9'].includes(A.quality)))primes++;}
   // A harmonic seventh: a clean chord (its bass one of its own tones) whose next different root is a fifth below.
   if(['7','9','7s','9s'].includes(A.quality)){sevenths++;let j=k+1;while(S[j]&&S[j].F.eq(A.F))j++;const falls=!S[j]||fold(A.F.div(S[j].F),1).eq(q(3,2)),clean=A.pcs.some(x=>x.eq(A.bass));
    if(A.quality.length===1){harmonic++;if(!(falls&&clean))loose++;}else{soft++;if(falls&&clean)loose++;}}
   if(!P)continue;
   if(P.key!==A.key){changes++;if(A.door.pivot||A.door.held.length)through++;if(A.door.pivot)pivots++;if(A.door.held.length)kept++;}
   else if(!A.cont){joins++;if(H.shared(P,A).length)held++;}
  }
  for(const ph of T.phrases)if(ph.cad==='auth'){cadences++;const end=S[ph.from+ph.len-1];if(end.fn==='T'&&end.K.eq(first.K))full++;}
 }
 ok(home===pieces,`${home} of ${pieces} pieces end on the tonic chord of the key they began in, on exactly the same pitch`);
 ok(primes===0,`${chords} chords: every one a pure chord of the table (primes 3 and 5; 7 only in dominant sevenths and ninths)`);
 ok(loose===0&&harmonic>0&&soft>0,`${sevenths} dominant sevenths: ${harmonic} harmonic (4:5:6:7), every one a clean chord whose root then falls a fifth; ${soft} with the seventh two fifths down (over a pedal, or not resolving)`);
 ok(changes>0&&through===changes,`${through} of ${changes} changes of key are made through a chord of the key being left (${pivots}) or a tone held exactly (${kept})`);
 ok(moved>pieces*.5&&relations.size>=12,`${moved} of ${pieces} pieces leave their key; ${relations.size} different other keys visited: ${[...relations].sort().join(' ')}`);
 ok(full===cadences&&cadences>0,`${full} of ${cadences} full closes land on a tonic`);
 console.log(`  inside a key ${held} of ${joins} chord changes keep at least one tone exactly (the rest are steps: IV to V, a deceptive close)`);
}

section('What sounds together: no commas, no mud');
const listen={};
{
 // Every half second of every piece: the notes sounding (until their written end; releases and the room are not counted).
 // A comma: two of them neither the same note nor different notes, 4 to 60 cents apart with octaves folded away.
 const pair=(f1,a1,f2,a2)=>{const lo=Math.min(f1,f2),d=Math.abs(f1-f2),s=.24/(.021*lo+19);return Math.min(a1,a2)*(Math.exp(-3.5*s*d)-Math.exp(-5.75*s*d));};
 const rough=notes=>{const f=[],a=[];for(const n of notes)for(let h=1;h<=4;h++){f.push(n.f*h);a.push(n.g*.7**(h-1));}let sum=0,amp=0;for(const x of a)amp+=x;for(let i=0;i<f.length;i++)for(let j=i+1;j<f.length;j++)sum+=pair(f[i],a[i],f[j],a[j]);return amp?sum/amp:0;};
 let commas=0,instants=0,mud=0,lowTones=0;
 for(const mood of MOOD_NAMES){
  const all=[],dens=[];let moodCommas=0;
  for(let s=0;s<Math.min(seeds,8);s++){
   const T=makeTheme({mood,seed:7000+s,base:[ONE,q(3,2),q(10,9)][s%3],light:(s%5-2)/2.5,rich:s%2===0}),notes=[];
   for(let b=0;b<T.length;b++)for(const e of composeBar(T,b,.5))if(!UNPITCHED.has(e.v))notes.push({t0:b*T.bar+e.t,t1:b*T.bar+e.t+e.d,t2:b*T.bar+e.t+e.d+(e.r??1)*.35,f:e.f,g:e.g,v:e.v,d:e.d,k:e.k});
   for(let t=1;t<T.length*T.bar;t+=.5){
    const now=notes.filter(n=>n.t0<=t&&n.t1>t+.02),ring=notes.filter(n=>n.t0<=t&&n.t2>t);instants++;all.push(rough(ring));dens.push(ring.length);
    for(let i=0;i<now.length;i++)for(let j=i+1;j<now.length;j++){let c=Math.abs(1200*Math.log2(now[i].f/now[j].f))%1200;if(c>600)c=1200-c;if(c>4&&c<60){commas++;moodCommas++;if(commas<6)console.log(`  comma: ${mood} seed ${7000+s} at ${t.toFixed(1)} s: ${now[i].v} ${now[i].f.toFixed(2)} Hz with ${now[j].v} ${now[j].f.toFixed(2)} Hz (${c.toFixed(0)} cents)`);}}
    // Mud: two long tones closer than a minor third, both under 180 Hz.
    const low=now.filter(n=>n.v!=='sub'&&n.d>1.5&&n.f<180);lowTones+=low.length;for(let i=0;i<low.length;i++)for(let j=i+1;j<low.length;j++){const r=Math.max(low[i].f,low[j].f)/Math.min(low[i].f,low[j].f);if(r>1.01&&r<1.19){mud++;if(mud<4)console.log(`  mud: ${mood} seed ${7000+s} at ${t.toFixed(1)} s: ${low[i].v} ${low[i].f.toFixed(1)} Hz with ${low[j].v} ${low[j].f.toFixed(1)} Hz`);}}
   }
  }
  all.sort((a,b)=>a-b);dens.sort((a,b)=>a-b);const at=(x,k)=>x[Math.floor(x.length*k)];
  listen[mood]={p50:at(all,.5),p95:at(all,.95),notes:at(dens,.5),notes95:at(dens,.95),commas:moodCommas};
  console.log(`  ${mood.padEnd(11)} roughness median ${at(all,.5).toFixed(3)}, 95th ${at(all,.95).toFixed(3)}; notes sounding at once median ${at(dens,.5)}, 95th ${at(dens,.95)}; commas ${moodCommas}`);
 }
 ok(commas===0,`${instants} instants heard: ${commas} with two tones a comma apart`);
 ok(mud===0,`no two long tones closer than a minor third sound together below 180 Hz (${lowTones} low tones checked)`);
 ok(MOOD_NAMES.every(m=>listen[m].p95<.25),`every mood stays smooth: the roughest 95th percentile is ${Math.max(...MOOD_NAMES.map(m=>listen[m].p95)).toFixed(3)} (limit 0.25)`);
 ok(MOOD_NAMES.every(m=>listen[m].notes<=10),`few things at once: at most ${Math.max(...MOOD_NAMES.map(m=>listen[m].notes))} notes sounding in the median instant of any mood (limit 10)`);
 ok(H.roughness([110,137.5,165])>3*H.roughness([440,550,660]),'the roughness measure calls a low close triad several times rougher than the same triad two octaves up');
}

section('The tune');
{
 let strong=0,onChord=0,leaned=0,leaps=0,steps=0,moves=0,repeats=0,ends=0,endsHome=0,returns=0,alike=0,span=0,tunes=0,commaSteps=0;
 for(const mood of TONAL)for(let s=0;s<seeds;s++){
  const T=makeTheme({mood,seed:2500+s,base:q(3,2),light:(s%5-2)/2.5});if(!T.tune)continue;
  const line=[];for(let b=0;b<T.length;b++)for(const n of T.tune.get(b)||[])line.push({...n,bar:b,hz:T.hz*n.F.value,A:T.spine[n.k]});
  if(!line.length)continue;tunes++;
  let lo=1e9,hi=0;
  for(let i=0;i<line.length;i++){
   const n=line[i],pc=fold(n.F,1),chordal=n.A.pcs.some(p=>p.eq(pc)),next=line[i+1];lo=Math.min(lo,n.hz);hi=Math.max(hi,n.hz);
   if(n.strong){strong++;if(chordal)onChord++;else if(next&&next.phrase===n.phrase&&Math.abs(1200*Math.log2(next.hz/n.hz))<240&&next.A.pcs.some(p=>p.eq(fold(next.F,1))))leaned++;}
   if(next&&next.phrase===n.phrase){const c=Math.abs(1200*Math.log2(next.hz/n.hz));moves++;if(c<5)repeats++;else if(c<60)commaSteps++;else if(c<240)steps++;if(c>1210)leaps++;}
   if(n.end){const ph=T.phrases[n.phrase];if(ph.cad==='auth'){ends++;if(fold(n.F.div(n.A.K),1).eq(ONE))endsHome++;}}
  }
  span+=Math.log2(hi/lo);
  // The theme comes back: the first half of the first phrase marked A and of the last one are the same notes.
  const As=T.phrases.map((p,i)=>[p,i]).filter(([p,i])=>p.theme==='A'&&line.some(n=>n.phrase===i));
  if(As.length>1){const [a,ai]=As[0],[z,zi]=As[As.length-1],take=pi=>line.filter(n=>n.phrase===pi&&n.k<T.phrases[pi].from+3).map(n=>String(n.F)+'@'+n.len).join(' ');
   if(mood!=='berceuse'&&mood!=='passacaglia'){returns++;if(take(ai)===take(zi))alike++;}}
 }
 ok(onChord+leaned>=strong*.98,`${onChord} of ${strong} notes on a strong beat are tones of the chord, ${leaned} more lean on it and resolve by step`);
 ok(leaps===0,`no leap wider than an octave in ${moves} moves; ${(100*steps/moves).toFixed(0)}% are steps, ${(100*repeats/moves).toFixed(0)}% repeat a note`);
 ok(commaSteps===0,`no tune moves by a comma (the same step of the scale as two chords tune it): ${commaSteps} of ${moves} moves`);
 ok(repeats<moves*.12,`a note is seldom said twice running (${repeats} of ${moves})`);
 ok(endsHome>=ends*.85,`${endsHome} of ${ends} full closes end the tune on the tonic itself`);
 ok(returns>0&&alike===returns,`${alike} of ${returns} pieces bring their opening back note for note when the theme returns`);
 console.log(`  ${tunes} tunes, each within ${(span/tunes).toFixed(2)} octaves on average`);
}

section('Written out as RMT modules');
{
 let modules=0,notes=0,wrong=0,forward=0,chained=0,mistimed=0;
 for(const mood of MOOD_NAMES)for(let s=0;s<3;s++){
  const T=makeTheme({mood,seed:3000+s,base:q(10,9)}),M=R.toModule(T,{from:s*2,bars:6}),base=q(263,8),beat=q(60).div(Q.of(M.baseNote.tempo.replace(/[()]/g,'').includes('.')?Math.round(+M.baseNote.tempo*10000):M.baseNote.tempo.replace(/[()]/g,''),M.baseNote.tempo.includes('.')?10000:1));
  // Evaluate every expression of the module in id order, as RMT Compose would, and compare with what the composer wrote.
  const values=new Map([[0,{f:base,t:q(0)}]]),want=[],when=[],heard=new Map();
  for(let bar=s*2;bar<s*2+6;bar++)for(const e of composeBar(T,bar,.5))if(e.q&&e.at!==undefined&&!UNPITCHED.has(e.v)){want.push(String(e.q));when.push([String(e.q),((bar-s*2)*T.bar+e.t)/T.beat]);}
  const got=[];let seen=0;
  for(const n of M.notes){
   for(const x of [n.startTime,n.duration,n.frequency])for(const m of x.matchAll(/\[(\d+)\]/g))if(+m[1]>=n.id)forward++;
   if(n.id<=seen)forward++;seen=n.id;
   const v={t:R.evaluate(n.startTime,values,beat),d:R.evaluate(n.duration,values,beat),f:R.evaluate(n.frequency,values,beat)};values.set(n.id,v);
   if(/^\[\d+\]\.f/.test(n.frequency))chained++;
   // Starts are seconds in the module (beats times the beat); back to beats, beside the pitch.
   {const key=String(v.f.div(base));if(!heard.has(key))heard.set(key,[]);heard.get(key).push(v.t.div(beat).value);}
   got.push(String(v.f.div(base)));
   notes++;
  }
  // The module holds the composer's notes (plus one root per chord): every composed fraction must be found in it.
  const pool=new Map();for(const g of got)pool.set(g,(pool.get(g)||0)+1);
  for(const w of want){const c=pool.get(w)||0;if(c>0)pool.set(w,c-1);else wrong++;}
  // A start the composer gave as a plain number is written to the nearest 1/96 of a beat.
  for(const [pitch,beats] of when)if(!(heard.get(pitch)||[]).some(b=>Math.abs(b-beats)<=1/96+1e-6))mistimed++;
  modules++;
 }
 ok(wrong===0,`${modules} modules, ${notes} notes: every composed pitch is in its module, as the same exact fraction`);
 ok(mistimed===0,`every note starts where the composer put it, to 1/96 of a beat (${mistimed} do not)`);
 ok(forward===0,'every expression refers only to notes written before it');
 ok(chained>notes*.2,`${chained} of ${notes} frequencies are written as fractions of another note, not of the BaseNote`);
}

section('Director');
{
 ok(fold(D.noteOf(599),1).eq(q(3,2)),`Jupiter's note folds to 3/2 of the Sun's (${D.noteOf(599)})`);
 ok(D.noteOf(502).eq(D.noteOf(501).div(TWO))&&D.noteOf(503).eq(D.noteOf(502).div(TWO)),'Io, Europa, Ganymede are octaves (4:2:1)');
 ok(D.noteOf(999).eq(D.noteOf(899).mul(q(2,3))),'Pluto is 2/3 of Neptune');
 ok(D.noteOf(799).eq(D.noteOf(399).div(q(84))),'Uranus is 1/84 of Earth');
 const notes=Object.keys(D.ORBITS).map(id=>String(fold(D.noteOf(+id),1)));
 console.log('  notes of the bodies, folded into one octave: '+Object.keys(D.ORBITS).map((id,i)=>`${id} ${notes[i]}`).join('  '));
 const info=(near,radii,extra={})=>({near,clear:radii*7e7,radius:7e7,speed:1000,system:10,rate:1,...extra});
 let d=D.createDirector({salt:42}),t=0,plays=0,acts=[];
 const step=(i,dt=.5,playing=null)=>{t+=dt;const a=d.update(i,t,playing);for(const x of a){acts.push(x);if(x.play)plays++;}return a;};
 step(info(0,1e9));ok(plays===1&&d.zone.key==='space:10','starts in deep space with one piece');
 for(let i=0;i<4;i++)step(info(599,5));ok(plays===1,'a body inside its range does not take over before it has held for four seconds');
 acts=[];for(let i=0;i<6;i++)step(info(599,5));ok(plays===2&&d.zone.key==='body:599','it takes over after the dwell');
 ok(acts.some(a=>a.accent==='enter'),'a place flown into is announced by its own note');
 for(let i=0;i<20;i++)step(info(599,9));ok(plays===2,'between 6 and 10 radii the body keeps the music (hysteresis)');
 for(let i=0;i<3;i++)step(info(599,30));ok(plays===2,'a brief excursion beyond 10 radii changes nothing');
 for(let i=0;i<12;i++)step(info(599,30));ok(plays===3&&d.zone.key==='space:10','beyond 10 radii, held, deep space returns');
 acts=[];step(info(599,30,{trip:true}));ok(acts.some(a=>a.accent==='riser'),'a Go trip starts with the riser');
 for(let i=0;i<8;i++)step(info(301,2,{trip:true}));ok(plays===3,'no change of piece during the trip');
 acts=[];step(info(301,2));ok(acts.some(a=>a.accent==='arrive')&&acts.some(a=>a.play)&&d.zone.key==='body:301','arrival: the stinger and the new place at once');
 const before=plays;acts=[];step(info(301,2,{rate:-10}));ok(plays===before+1,'the clock running backward turns the piece over');
 {const turned=acts.find(a=>a.play).play;ok(turned.mirror===true,'turned over: major for minor, the tune upside down');}
 acts=[];step(info(301,2,{rate:-10}),.5,{bar:999,length:20,barSeconds:6});ok(acts.some(a=>a.play),'a piece that reaches its end is followed by another');
 d.next();acts=[];step(info(301,2,{rate:-10}));ok(acts.some(a=>a.play),'next() asks for another piece in the same place');
 // Saturn's rings and the asteroid belt are places of their own.
 {const x=D.createDirector({salt:5});let now=0,keys=[];const at=(i)=>{for(let k=0;k<12;k++)x.update(i,now+=.5,{bar:1,length:20,barSeconds:6});keys.push(x.zone.key);};
  at(info(0,1e9));at(info(0,1e9,{belt:true}));at(info(0,1e9));at(info(699,3));at(info(699,.6));at(info(699,1.4));at(info(699,1.7));
  ok(keys.join(' ')==='space:10 belt:10 space:10 body:699 rings:699 rings:699 body:699',`zones in turn: ${keys.join(', ')}`);}
 // Two sessions, two salts: different pieces in the same place.
 const first=s=>{const x=D.createDirector({salt:s});return x.update(info(399,1),1,null).find(y=>y.play).play;},a=first(1),b=first(2);
 ok(a.seed!==b.seed,'another session, another piece in the same place');
 // A long stay: the family's moods come round, none twice in a row. Two pieces overlap only when their keys go together.
 d=D.createDirector({salt:7});t=0;const moods=[];let again=0,crossed=0,dipped=0,wrongDip=0,last=null;
 for(let i=0;i<60;i++){const a=d.update(info(i<40?399:i<50?301:599,1),t+=6,{bar:999,length:20,barSeconds:4});for(const x of a)if(x.play){if(moods.at(-1)===x.play.mood&&i<40)again++;if(i<40)moods.push(x.play.mood);
  if(last){const A=last.keys[0],B=x.play.keys[0],tri=k=>[fold(k.t,1),fold(k.t,1).mul(k.minor?q(6,5):q(5,4)),fold(k.t,1).mul(q(3,2))],rel=fold(B.t.div(A.t),1);let near=!['1','3/2','4/3','5/4','8/5','6/5','5/3'].some(n=>Q.of(n).eq(rel));for(const p of tri(A))for(const s of tri(B)){const c=H.apart(p,s);if(c>3&&c<100)near=true;}
   if(x.dip>0)dipped++;else crossed++;if(near!==(x.dip>0))wrongDip++;}
  last=x.play;}}
 ok(again===0&&new Set(moods).size>=6,`forty pieces at Earth: ${new Set(moods).size} moods, never the same twice running`);
 ok(wrongDip===0&&dipped>0&&crossed>0,`changes of piece: ${crossed} crossfaded (keys that go together), ${dipped} with the old piece let go first (keys that do not)`);
 ok(['riser','jump','arrive','enter'].every(k=>{const f=composeAccent(k,1,q(3,2));return f.length>2&&f.every(e=>e.f>0&&e.d>0&&e.g>0);}),'the figures of a trip and of a place coming into range compose');
 // Deep space: a piece that ends is followed by another, at once or after a silence of 10 to 20 seconds; never by nothing.
 let silences=0,resumed=0,stuck=0;
 for(let salt=1;salt<=40;salt++){
  const x=D.createDirector({salt});let now=0;x.update(info(0,1e9),now+=1,null);
  const a=x.update(info(0,1e9),now+=1,{bar:999,length:20,barSeconds:6});
  if(a.some(y=>y.hush)){silences++;let played=false;for(let i=0;i<60&&!played;i++)played=x.update(info(0,1e9),now+=.5,null).some(y=>y.play);if(played&&now>11&&now<24)resumed++;else stuck++;}
  else if(!a.some(y=>y.play))stuck++;
 }
 ok(silences>5&&resumed===silences&&stuck===0,`deep space, 40 sessions: ${silences} pieces ended in a silence, and all ${resumed} were followed by a new piece 10 to 20 s later`);
}

section('Every place: five pieces each, composed without a fault');
{
 // All the bodies with a note, the Sun, deep space, and another star with two of its invented worlds; hot and cool stars.
 const places=[10,...Object.keys(D.ORBITS).map(Number)].map(id=>({near:id,clear:1e6,radius:1e6,system:10})).concat([{near:0,clear:1e12,radius:0,system:10},{near:10200,clear:1e6,radius:1e6,system:10200,teff:3300},{near:10203,clear:1e6,radius:1e6,system:10200,teff:3300},{near:0,clear:1e12,radius:0,system:10300,teff:9000},{near:10301,clear:1e6,radius:1e6,system:10300,teff:9000}]);
 let pieces=0,faults=0,bad=0,lines=new Set(),moods=new Set();
 for(const [i,p] of places.entries()){
  const x=D.createDirector({salt:900+i,lite:i%5===4});let now=0;
  for(let k=0;k<5;k++){
   try{
    const a=x.update({...p,speed:k*3000,rate:k===3?-1:1},now+=30,{bar:999,length:20,barSeconds:6}).concat(x.update({...p,speed:k*3000,rate:k===3?-1:1},now+=30,null)),made=a.filter(y=>y.play);
    for(const m of made){pieces++;lines.add(m.play.line);moods.add(m.play.mood);for(const b of [0,1,Math.floor(m.play.length/2),m.play.length-1,m.play.length+1])for(const e of composeBar(m.play,b,.3+.15*k))if(!(e.f>15&&e.f<20000&&e.d>0&&e.g>0))bad++;}
   }catch(e){faults++;if(faults<3)console.log('  fault at place '+p.near+': '+String(e.stack||e).split(String.fromCharCode(10)).slice(0,3).join(' | '));}
  }
 }
 ok(faults===0&&bad===0&&pieces>=places.length*3,`${places.length} places, ${pieces} pieces in ${moods.size} moods: no fault, no unplayable note`);
 ok(lines.size>=pieces*.9,`${lines.size} different lines for the panel among ${pieces} pieces`);
}

section('Composer cost (this machine, Node)');
for(const [mood,v] of Object.entries(timing))console.log(`  ${mood.padEnd(11)} a new piece ${v.make.toFixed(2)} ms; ${v.msPerBar.toFixed(3)} ms a bar, worst ${v.worst.toFixed(2)} ms`);

console.log(`\n${passed} passed, ${failed} failed`);
if(failed){console.log(fails.map(f=>' - '+f).join('\n'));process.exit(1);}

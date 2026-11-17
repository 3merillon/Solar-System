// The harmonic language of the score: tonal harmony, from Bach and Mozart through Chopin, Liszt and Rachmaninov toward
// Scriabin, written in pure intervals. Nothing is tempered and nothing is approximate:
//   a key is a tonic (an exact fraction of the place's note) and a mode;
//   a chord is a root (a fraction of the tonic: IV is 4/3, vi is 5/3, the Neapolitan 16/15) and a quality (fractions of
//   the root: a major triad is 4:5:6, a minor one 10:12:15; a dominant seventh is the harmonics 4:5:6:7 where the chord
//   is clean and its root then falls a fifth, and has its seventh two fifths down, 16/9, everywhere else);
//   a modulation multiplies the tonic by a fraction (a fifth 3/2, a major third 5/4, a minor third 6/5 ...) and is made
//   through a chord that is exactly a chord of both keys, or through a tone that is exactly the same pitch in both.
// Simple relationships come first: fifths (prime 3) carry the functions, thirds (prime 5) the colour and the Romantic
// key changes, the seventh harmonic only a dominant about to resolve. Every plan of keys is a closed walk on that lattice,
// so a piece comes home to the very pitch it left.
// Tension is measured, not guessed: harmonic distance (Tenney) and roughness (Plomp and Levelt, in Sethares's fit).
// Pure: no Web Audio and no clock.
import {Q,q,ONE,TWO,Qs,fold,clamp} from './music-theory.js';

const PRIMES=[3n,5n,7n,11n,13n,17n,19n,23n];
// The highest prime in a fraction, leaving 2 out (octaves cost nothing here).
export function limitOf(f){
 let hi=1;
 for(let x of [f.n<0n?-f.n:f.n,f.d]){while(x%2n===0n&&x>0n)x/=2n;for(const p of PRIMES)while(x%p===0n){x/=p;hi=Math.max(hi,Number(p));}if(x>1n)hi=99;}
 return hi;
}
const bits=x=>x.toString(2).length;
// Harmonic distance of an interval: log2(numerator x denominator). An octave is 1, a fifth 2.6, 11/8 is 6.5.
export function distance(f){const n=f.n<0n?-f.n:f.n;return n<(1n<<50n)&&f.d<(1n<<50n)?Math.log2(Number(n)*Number(f.d)):bits(n)+bits(f.d)-1;}
// Tension of a chord given as fractions of any common note: the mean distance over all pairs, octaves folded away.
export function tension(tones){
 let sum=0,count=0;
 for(let i=0;i<tones.length;i++)for(let j=i+1;j<tones.length;j++){const r=fold(tones[j].div(tones[i]),1);if(r.eq(ONE))continue;sum+=distance(r);count++;}
 return count?sum/count:0;
}
// Roughness of tones sounding together (Hz), each with a few harmonics: what makes a low close chord muddy.
export function roughness(freqs,harmonics=6,rolloff=.8){
 const f=[],a=[];for(const hz of freqs)for(let h=1;h<=harmonics;h++){f.push(hz*h);a.push(rolloff**(h-1));}
 let sum=0;
 for(let i=0;i<f.length;i++)for(let j=i+1;j<f.length;j++){const lo=Math.min(f[i],f[j]),d=Math.abs(f[i]-f[j]),s=.24/(.021*lo+19);sum+=Math.min(a[i],a[j])*(Math.exp(-3.5*s*d)-Math.exp(-5.75*s*d));}
 return sum/freqs.length;
}
// How far apart two pitches are as notes, octaves folded away: 0 to 600 cents. Two tones between about 5 and 60 cents
// apart are neither one note nor two: the rub this score is written to avoid.
export function apart(a,b){const c=Math.abs(1200*Math.log2(a.value/b.value))%1200;return c>600?1200-c:c;}

// Chord qualities, as fractions of the root. `7` and `9` are the harmonics 4:5:6:7:9 of their root: the harmonic seventh
// is only right in a clean chord whose root then falls a fifth (progression() sees to that). `7s` and `9s` have the
// seventh two fifths down, 16/9: over a dominant that is the key's own fourth step, pure with the tonic. `A6` is the
// augmented sixth: its top tone is 225/128, the leading tone of the dominant; it lies 225/224 (7.7 cents) above the
// harmonic seventh, which is why the two chords can be taken for each other. `q` is three notes a pure fifth apart.
export const QUALITY=Object.fromEntries(Object.entries({M:'1 5/4 3/2',m:'1 6/5 3/2',7:'1 5/4 3/2 7/4',9:'1 5/4 3/2 7/4 9/4','7s':'1 5/4 3/2 16/9','9s':'1 5/4 3/2 16/9 9/4',A6:'1 5/4 3/2 225/128',M7:'1 5/4 3/2 15/8',M6:'1 5/4 3/2 5/3',M9:'1 5/4 3/2 9/4',
 m7:'1 6/5 3/2 9/5',m6:'1 6/5 3/2 5/3',m9:'1 6/5 3/2 9/4',s4:'1 4/3 3/2',s2:'1 9/8 3/2',q:'1 3/2 9/4'}).map(([k,v])=>[k,Qs(v)]));
// The scales a tune walks on between chord tones: major, natural minor, and the minor as it rises over its dominant
// (its sixth step is then the pure ninth of that dominant).
export const SCALE={M:Qs('1 9/8 5/4 4/3 3/2 5/3 15/8'),m:Qs('1 9/8 6/5 4/3 3/2 8/5 9/5'),h:Qs('1 9/8 6/5 4/3 3/2 27/16 15/8')};
// The chords of a key: root as a fraction of the tonic, quality, function (Tonic, Subdominant, Dominant) and, where the
// chord is borrowed, the scale it brings with it. The supertonic of a major key stands on 10/9, so that it is pure with
// the subdominant; the second step of the scale under the dominant is 9/8. They differ by 81/80 and are never sounded
// together (the composer ends a tone early when its near neighbour is coming).
const DEG={
 M:{I:['1','M','T'],ii:['10/9','m','S'],iii:['5/4','m','T'],IV:['4/3','M','S'],V:['3/2','M','D'],vi:['5/3','m','T'],
  i:['1','m','T','m'],iv:['4/3','m','S','m'],v:['3/2','m','D','m'],bIII:['6/5','M','T','m'],bVI:['8/5','M','S','m'],bVII:['16/9','M','S','m'],N:['16/15','M','S','m'],Ger:['8/5','A6','S','m'],
  II:['9/8','M','D'],III:['5/4','M','D'],VI:['5/3','M','D']},
 m:{i:['1','m','T'],iv:['4/3','m','S'],v:['3/2','m','D'],V:['3/2','M','D','h'],III:['6/5','M','T'],VI:['8/5','M','S'],VII:['9/5','M','D'],bVII:['16/9','M','S'],N:['16/15','M','S'],Ger:['8/5','A6','S'],
  I:['1','M','T','M'],IV:['4/3','M','S']},
};
const WANT={T:.18,S:.42,D:.62};
// One chord of a key. key: {t: the tonic as a fraction of the BaseNote, minor}. token: a symbol of the key, optionally
// `:quality` and `/bass`: `V:7`, `ii:m7`, `I/3` (third in the bass), `I/5`, `V:7/T` (over the tonic, a pedal), `N/3`.
// `V>vi` is the dominant seventh of another chord of the key: a pure fifth above its root, whatever that root is.
// (Which seventh a dominant has, harmonic or two fifths down, is settled by what follows it: see progression().)
// Returns the root F and each tone as exact fractions of the BaseNote (folded into one octave: where a tone sounds is
// the voice's business), the bass, and the seven-step scale a melody walks on while the chord sounds: the key's scale,
// with the steps that are chord tones moved to exactly where the chord has them.
export function chord(key,token){
 const [head,inv]=token.split('/'),[sym,qual]=head.split(':'),table=DEG[key.minor?'m':'M'];
 let root,quality,fn,scale=key.minor?'m':'M',heat=0;
 if(sym.startsWith('V>')){const t=table[sym.slice(2)];if(!t)throw Error(`No ${sym} in a ${key.minor?'minor':'major'} key`);root=fold(Q.of(t[0]).mul(q(3,2)),1);quality='7';fn='D';heat=.12;}
 else{const t=table[sym];if(!t)throw Error(`No ${sym} in a ${key.minor?'minor':'major'} key`);root=Q.of(t[0]);quality=t[1];fn=t[2];if(t[3]){scale=t[3];heat=t[3]==='h'?0:.08;}}
 if(qual)quality=qual;
 const tones=QUALITY[quality];if(!tones)throw Error(`No chord quality ${quality}`);
 const K=fold(key.t,1),F=fold(K.mul(root),1),pcs=tones.map(t=>fold(F.mul(t),1)),base=SCALE[scale],sc=base.slice(),is=new Array(7).fill(false);
 for(const t of tones){
  const pc=fold(root.mul(t),1),c=pc.cents;let best=0,err=9999;
  for(let d=0;d<7;d++){let e=c-base[d].cents;if(e>600)e-=1200;if(e<-600)e+=1200;if(Math.abs(e)<Math.abs(err)){err=e;best=d;}}
  const off=c-base[best].cents;sc[best]=off>600?pc.div(TWO):off<-600?pc.mul(TWO):pc;is[best]=true;
 }
 const bass=inv==='3'?pcs[1]:inv==='5'?pcs[2]:inv==='7'?pcs[3]:inv==='T'?K:inv==='D'?fold(K.mul(q(3,2)),1):pcs[0];
 const want=clamp(WANT[fn]+heat+(['7','9','7s','9s'].includes(quality)?.12:0)+(sym==='Ger'?.2:sym==='N'?.1:0),0,1);
 return {token,sym,quality,fn,key,K,minor:key.minor,F,tones,pcs,bass,scale:sc,is,want,tension:tension(tones)};
}
// Tones two chords share: the very same pitch, octaves apart or not.
export function shared(a,b){const out=[];for(const x of a.pcs)if(b.pcs.some(y=>y.eq(x)))out.push(x);return out;}
const same=(a,b)=>a.pcs.length===b.pcs.length&&shared(a,b).length===a.pcs.length;

// ---------------------------------------------------------------------------------------------------------------------
// Cells: four chords that belong together, written the way a harmony book writes them. A phrase is two cells: one that
// opens and one that closes on a cadence. After the bar: whose manner it is: b Bach, c Classical (Mozart), r Romantic
// (Chopin, Liszt, Rachmaninov), l late (toward Scriabin).
export const CELLS={
 M:{
  open:['I I IV I|c','I IV I V|bc','I vi IV V|cr','I V/3 vi I/5|br','I iii IV V|r','I iii vi IV|r','I vi ii V:7|bc','I V>vi vi IV|r','I V>IV IV iv|r','I IV/T V:7/T I|bc','I:M9 IV:M6/T I V:7/T|r',
   'I bVII IV I|r','I V vi iii|b','I III IV iv|rl','I I/3 IV V|c','I:M7 IV:M7 I:M7 IV:M6|l','I bVI I V|rl','I:M6 ii:m7 V:9 I:M9|l'],
  cont:['IV I IV V|bc','vi iii IV V|br','IV I/3 ii V:7|bc','vi V>V V V:7|cr','iii vi ii V:7|bc','V>vi vi V>V V|r','IV V iii vi|b','V>ii ii V>V V|r','IV iv I V|r','bVI bVII I V|rl','ii V:7 I vi|bc','IV:M7 iii:m7 ii:m7 V:9|l'],
  half:['IV I/5 V V|c','vi V>V V V|cr','I IV V V|bc','ii/3 V V:s4 V|bc','iv V V V|r','Ger V V:s4 V|r','IV V:s4 V V|bc','vi ii V V:7|bc'],
  auth:['ii V:7 I I|bc','IV V:7 I I|bc','ii/3 I/5 V:7 I|c','IV I/5 V:7 I|c','V>V V:7 I I|cr','ii:m7 V:9 I:M9 I|rl','iv V:7 I I|r','iv I/5 V:7 I|r','N/3 I/5 V:7 I|r','Ger I/5 V:7 I|r','vi ii V:7 I|bc',
   'IV:M6 V:s4 V:7 I|cr','bVI V:7 I I|r','vi IV V:7 I|cr'],
  dec:['ii V:7 vi vi|bc','IV V:7 vi IV|cr','IV V:7 bVI bVI|r','ii V:7 vi iii|b'],
  coda:['I IV I I|bc','IV I IV I|bc','I iv I I|r','I:M9 IV:M6/T I I|r','I bVI I I|rl','IV iv I I|r','I V:7/T I I|bc','bVII IV I I|r','I:q IV:M6/T I:M9 I|l'],
  stay:['I IV/T V:7/T I|bc','I:M9 IV:M6/T I V:s4/T|r','I vi IV I|c','I I/3 IV I|c','I V>IV IV I|r','I iii vi I/5|r','I:M6 IV:M7 I:M6 V:s4|l','I bVII IV I|r','I:q IV:q/T I:M9 V:q/T|l','I V/3 vi iii|b','I:q IV:M6/T I:q V:s4/T|l'],
 },
 m:{
  open:['i iv i V|bc','i iv V i|bc','i VI iv V|r','i VII VI V|br','i v/3 iv/3 V|br','i iv VII III|br','i III iv V|r','i VI III VII|r','i iv/T V:7/T i|bc','i N/3 V:7 i|r','i V>iv iv V|r','i i/3 iv V|c','i VI i V|r',
   'i V/3 V>iv/7 IV/3|r','i:m9 iv:m6/T i V:s4/T|rl'],
  cont:['VI iv V i|bc','VI III iv V|r','iv VII III VI|b','III VII i V|r','iv i V i|bc','VI VII i V|r','iv/3 V i V|b','V>III III V>VI VI|r','iv:m7 VII III:M7 VI|l'],
  half:['iv V V V|bc','VI Ger V V|r','i iv V V|bc','iv/3 V V:s4 V|br','N/3 V V:s4 V|r','iv i/5 V V|c'],
  auth:['iv V:7 i i|bc','iv i/5 V:7 i|c','VI V:7 i i|r','iv:m6 V:7 i i|br','N/3 V:7 i i|r','N/3 i/5 V:7 i|r','Ger i/5 V:7 i|r','VI iv V:7 i|bcr','iv V:s4 V:7 i|bc','V>V V:7 i i|cr','iv/3 V V:7 i|br'],
  dec:['iv V:7 VI VI|br','iv V:7 VI iv|r'],
  coda:['i iv i i|bc','iv i iv i|bc','i VI i i|r','i iv I I|br','i N/3 i i|r','i iv/T V:7/T i|bc','VI iv i i|r'],
  stay:['i iv/T V:7/T i|bc','i VI iv i|r','i III VI i|r','i v/3 VI i|r','i:m7 iv:m7 i:m7 V:s4|l','i:m9 iv:m6/T i V:s4/T|rl','i iv i i/3|c','i VII VI i|r','i:m9 iv:m6/T i:m7 v:s4/T|l'],
 },
};
// Modulations. Each line: the new tonic as a fraction of the old one, the old mode, the new mode, a family, and cells
// that make the change and end on the new tonic chord. A symbol is read in the new key unless it starts with `<` (the
// old key). The first new-key chord is a pivot (exactly a chord of the old key: vi of C is ii of G, both on 5/3) or
// holds a tone of the chord before it exactly. The lines with `Ger` turn on the augmented sixth: the tonic chord of the
// old key with 225/128 added is the German sixth of the key a major third above, and a dominant seventh chord is,
// within 225/224, the German sixth of the key a semitone below: three tones held exactly, the fourth read anew.
const DEV=[
 ['3/2','M','M','fifth',['ii V:7 I I','IV ii V:7 I','vi ii V:7 I','IV V:7 I I']],
 ['4/3','M','M','fifth',['<I V:7 I I','iii V:7 I I']],
 ['5/3','M','m','fifth',['iv V:7 i i','VI iv V:7 i','III V:7 i i']],
 ['5/4','M','m','fifth',['iv V:7 i i','VI iv V:7 i','<I Ger V:7 i']],
 ['4/3','M','m','fifth',['<I V:7 i i']],
 ['1','M','m','par',['<V V:7 i i','<I i V:7 i','iv V:7 i i']],
 ['5/4','M','M','third',['i V:7 I I','<I I V:7 I','<I Ger V:7 I']],
 ['8/5','M','M','third',['<i I V:7 I','vi ii V:7 I','<I I V:7 I']],
 ['6/5','M','M','third',['<i IV V:7 I','vi V:7 I I','<I I V:7 I']],
 ['5/3','M','M','third',['i V:7 I I','<I I V:7 I']],
 ['16/15','M','M','semi',['<I V:7 I I']],
 ['15/16','M','M','semi',['<V Ger V:7 I']],
 ['15/16','M','m','semi',['<V Ger V:7 i']],
 ['9/8','M','M','tone',['IV V:7 I I']],
 ['16/9','M','M','tone',['V V:7 I I']],
 ['10/9','M','m','tone',['III V:7 i i']],
 ['6/5','m','M','fifth',['ii V:7 I I','IV V:7 I I','vi IV V:7 I']],
 ['3/2','m','M','fifth',['iv V:7 I I']],
 ['8/5','m','M','third',['iii IV V:7 I','vi V:7 I I','<i V:7 I I']],
 ['1','m','M','par',['<V V:7 I I','<iv V:7 I I']],
 ['9/5','m','M','tone',['IV V:7 I I']],
 ['16/15','m','M','semi',['<i V:7 I I']],
 ['3/2','m','m','fifth',['iv V:7 i i','VI iv V:7 i']],
 ['4/3','m','m','fifth',['<i V:7 i i']],
 ['9/8','m','m','tone',['iv V:7 i i']],
 ['16/9','m','m','tone',['v V:7 i i']],
];
const power=(f,p)=>{let e=0,n=f.n,d=f.d;while(n%p===0n){n/=p;e++;}while(d%p===0n){d/=p;e--;}return e;};
// The same table as edges on the lattice of keys: how many fifths (prime 3) and thirds (prime 5) each one moves.
export const EDGES=DEV.map(([ratio,from,to,family,cells])=>{const f=Q.of(ratio);return {f,from,to,family,cells,e3:power(f,3n),e5:power(f,5n)};});
// A walk through `n` other keys and home again: closed on the lattice (the fifths and the thirds each add up to
// nothing), so the last tonic is exactly the first. `fam` weighs the families of key change.
export function planWalk(r,minor,n,fam){
 const home=minor?'m':'M';
 for(let attempt=0;attempt<60&&n>0;attempt++){
  let cur=home,e3=0,e5=0,ok=true;const path=[],seen=new Set([`0,0,${home}`]);
  for(let i=0;i<n&&ok;i++){
   const opts=EDGES.filter(E=>E.from===cur&&!seen.has(`${e3+E.e3},${e5+E.e5},${E.to}`));
   if(!opts.length){ok=false;break;}
   const E=r.weighted(opts.map(E=>[E,fam[E.family]||1e-4]));
   path.push(E);e3+=E.e3;e5+=E.e5;cur=E.to;seen.add(`${e3},${e5},${cur}`);
  }
  if(!ok)continue;
  const close=EDGES.filter(E=>E.from===cur&&E.to===home&&E.e3===-e3&&E.e5===-e5);
  if(close.length){path.push(r.weighted(close.map(E=>[E,(fam[E.family]||.05)+.2])));return path;}
 }
 return [];
}

// What a cell begins and ends on, read once in a key of 1.
const parsed=new Map();
function cellsOf(mode,role){
 const id=mode+role;let list=parsed.get(id);
 if(!list){const key={t:ONE,minor:mode==='m'};list=CELLS[mode][role].map(text=>{const [body,tags]=text.split('|'),tokens=body.split(' '),first=chord(key,tokens[0]),last=chord(key,tokens[3]);return {tokens,tags,head:first.fn,headBass:first.bass,tail:last.fn,text:body};});parsed.set(id,list);}
 return list;
}
// A cell of a role in a manner, fitted to what came before: a dominant is answered by a tonic, and a bass that can
// go on by step is preferred (the falling basses of Bach's Air and of every lament come out of this by themselves).
function pickCell(r,minor,role,tags,prev,avoid){
 const all=cellsOf(minor?'m':'M',role);let list=all.filter(c=>[...c.tags].some(t=>tags.includes(t)));if(!list.length)list=all;
 return r.weighted(list.map(c=>{
  let w=1;
  if(prev){
   if(prev.fn==='D'&&c.head!=='T')w*=.03;
   if(prev.fn==='S'&&c.head==='S')w*=.6;
   const step=apart(prev.bassRel,c.headBass);if(step>60&&step<215)w*=2.5;
  }
  if(avoid&&avoid.includes(c.text))w*=.08;
  return [c,w];
 }));
}

// The harmony of a whole piece: its keys, its phrases and its chords, one per slot.
//   tonic: the place's note; minor; tags: the manners allowed; fam: weights of the families of key change;
//   regions: how many other keys; phrases: how many phrases of eight chords; intro: chords before the first phrase;
//   still: no strong cadences inside a key (the pieces that stay and look around); script: phrases written out
//   ([{tokens, minor, theme}]) for the pieces whose harmony is a fixed ground.
// The form is A (home: a phrase to a half cadence, its answer), B (the other keys, one or two phrases each, each
// ending with the change into the next), A again at home with a full close, and a coda on the tonic.
export function progression(r,{tonic,minor,tags='bcr',fam={fifth:1,third:1,par:.3,semi:.1,tone:.2},regions=1,phrases=4,intro=0,still=false,script=null}){
 const home={t:fold(tonic,1),minor,rel:ONE},anchors=[],plan=[],keys=[home],cache=new Map(),used=[];
 const made=(key,token)=>{const id=keys.indexOf(key)+'|'+token;let c=cache.get(id);if(!c){c=chord(key,token);cache.set(id,c);}return c;};
 const push=(key,token,meta)=>{const a={...made(key,token),...meta};anchors.push(a);return a;};
 const last=()=>{const a=anchors[anchors.length-1];return a?{fn:a.fn,bassRel:fold(a.bass.div(a.K),1)}:null;};
 const role=x=>still?({open:'stay',cont:'stay',half:'stay',auth:'coda',dec:'stay'})[x]||x:x;
 const cell=(key,what,meta,fixed)=>{const c=fixed||pickCell(r,key.minor,role(what),tags,last(),used.slice(-3));used.push(c.text);c.tokens.forEach((t,i)=>push(key,t,{...meta,pos:meta.pos+i}));return c;};
 if(script){
  let other=null;
  for(const [p,s] of script.entries()){
   let key=home;if(s.minor!==undefined&&s.minor!==minor){if(!other){other={t:home.t,minor:!minor,rel:ONE};keys.push(other);}key=other;}
   plan.push({from:anchors.length,len:s.tokens.length,theme:s.theme||'A',cad:s.cad||'auth',sect:s.sect||'A',key});s.tokens.forEach((t,i)=>push(key,t,{phrase:p,pos:i}));
  }
 }else{
  const n=Math.max(0,Math.min(regions,phrases-2)),walk=planWalk(r,minor,n,fam),m=Math.max(0,walk.length-1);
  let key=home,extra=phrases-(m?m+2:1);const two=[];
  // Where the phrases beyond the frame go: first the statement before the answer, then a second phrase in each other
  // key, then phrases that stay at home and look around.
  const first=extra>0;if(first)extra--;
  for(let j=0;j<m&&extra>0;j++){two[j]=true;extra--;}
  const around=Math.max(0,extra);
  for(let i=0;i<intro;i++)push(home,cellsOf(minor?'m':'M','stay')[still?1:0].tokens[i%4],{phrase:-1,pos:i});
  const O=pickCell(r,minor,role('open'),tags,null,null);
  const phrase=(K,theme,sect,cad,a,b)=>{const p=plan.length;plan.push({from:anchors.length,len:8,theme,cad,sect,key:K});a(p);b(p);};
  const change=(E,closing)=>p=>{
   const from=key,rel=fold(from.rel.mul(E.f),1);
   // Home is home: the closing change of the walk lands on the first key itself, not on a copy of it.
   let dest=home;if(!closing){dest={t:fold(home.t.mul(rel),1),minor:E.to==='m',rel};keys.push(dest);}
   r.pick(E.cells).split(' ').forEach((t,i)=>t[0]==='<'?push(from,t.slice(1),{phrase:p,pos:4+i}):push(dest,t,{phrase:p,pos:4+i}));key=dest;
  };
  if(first)phrase(home,'A','A','half',p=>cell(home,'open',{phrase:p,pos:0},O),p=>cell(home,'half',{phrase:p,pos:4}));
  for(let i=0;i<around;i++)phrase(home,'N'+i,'A',i%2?'half':'dec',p=>cell(home,i%2?'cont':'stay',{phrase:p,pos:0}),p=>cell(home,i%2?'half':'dec',{phrase:p,pos:4}));
  if(m){
   phrase(home,'A','A','mod',p=>cell(home,'open',{phrase:p,pos:0},O),change(walk[0],false));
   for(let j=0;j<m;j++){
    const K=key;
    if(two[j])phrase(K,'B'+j,'B',j%2?'dec':'half',p=>cell(K,'open',{phrase:p,pos:0}),p=>cell(K,j%2?'dec':'half',{phrase:p,pos:4}));
    phrase(K,two[j]?'C'+j:'B'+j,'B','mod',p=>cell(K,two[j]?'cont':'open',{phrase:p,pos:0}),change(walk[j+1],j===m-1));
   }
  }
  phrase(home,'A','R','auth',p=>cell(home,'open',{phrase:p,pos:0},O),p=>cell(home,'auth',{phrase:p,pos:4}));
  const p=plan.length;cell(home,'coda',{phrase:p,pos:0});const end=anchors[anchors.length-1].sym;push(home,end,{phrase:p,pos:4});push(home,end,{phrase:p,pos:5});
 }
 // Which seventh. The harmonic seventh (7/4) is kept where the chord is clean (its bass one of its own tones, no pedal
 // under it) and the next different root lies a fifth below: there it melts into the resolution. Anywhere else (over a
 // pedal, before a deceptive close, left hanging) the seventh is two fifths down, 16/9.
 for(let k=0;k<anchors.length;k++){
  const A=anchors[k];if(A.quality!=='7'&&A.quality!=='9')continue;
  let j=k+1;while(anchors[j]&&anchors[j].F.eq(A.F))j++;
  const N=anchors[j],clean=A.pcs.some(p=>p.eq(A.bass))&&(!N||fold(A.F.div(N.F),1).eq(q(3,2)));
  if(clean)continue;
  const [head,inv]=A.token.split('/'),sym=head.split(':')[0];
  anchors[k]={...A,...chord(A.key,sym+':'+A.quality+'s'+(inv?'/'+inv:''))};
 }
 // What each chord asks of the players: its function, and where the piece is in its arc (the crest about two thirds through).
 const N=anchors.length,crest=.62,doors=[];
 for(let k=0;k<N;k++){
  const A=anchors[k],x=N>1?k/(N-1):0,arc=x<crest?x/crest:1-(x-crest)/(1-crest),P=anchors[k-1];
  A.index=k;A.x=x;A.want=clamp(A.want*.6+(.15+.65*arc*arc*(3-2*arc))*.4,0,1);A.all=A.pcs.some(p=>p.eq(A.bass))?A.pcs:[...A.pcs,A.bass];
  A.cont=!!P&&P.key===A.key&&P.token===A.token;A.run=1;A.bcont=!!P&&P.bass.eq(A.bass);A.brun=1;
  if(P&&P.key!==A.key){
   // The door between two keys: the tones held exactly, and whether the chord is a chord of the key being left.
   const held=shared(P,A),table=DEG[P.key.minor?'m':'M'];let pivot=false;
   for(const sym of Object.keys(table))if(!pivot)for(const qual of ['',':7'])if(same(chord(P.key,sym+qual),A)){pivot=true;break;}
   A.door={held,pivot};doors.push({k,tone:held[0]||null,pivot,held:held.length});
  }
 }
 for(let k=N-2;k>=0;k--){if(anchors[k+1].cont)anchors[k].run=anchors[k+1].run+1;if(anchors[k+1].bcont)anchors[k].brun=Math.min(4,anchors[k+1].brun+1);}
 anchors[N-1].final=true;
 return {anchors,phrases:plan,keys,home,doors};
}

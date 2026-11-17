// The composer: a theme (one piece) from a seed, and the notes of any bar of it.
// Written in the owner's Relative Music Theory: the only frequency is the BaseNote (the Sun). The place is a fraction of
// it, a key a fraction of the place, a chord root a fraction of the key's tonic, a note a fraction of its chord's root;
// starts and lengths are fractions of the beat. Fractions stay exact (web/music-theory.js Q) until a note is handed to
// the loudspeaker. The harmony is tonal (web/music-harmony.js): phrases, cadences, modulations, all in pure intervals.
// A piece is few things at once: a bass, one accompaniment figure, one tune, at most a quiet bed of held chords.
// Pure: no Web Audio, no clock. composeBar(theme, bar, energy) gives the same notes for the same arguments.
//
// A note: {v voice, t seconds from the bar line, d seconds held, f Hz, q its exact fraction of the BaseNote, at and len in
// beats (exact where the music is), g peak gain, bus, pan, a attack, r release, b brightness, pri priority, k its chord's
// index} plus what its voice reads (beat, f2, ratio, wave, shim, drift, ph).
import {Q,q,ONE,TWO,Qs,fold,near,hash,rng,noise,clamp,lerp,smooth,mod} from './music-theory.js';
import {progression,apart,tension} from './music-harmony.js';

const TAU=Math.PI*2;
const num=x=>typeof x==='number'?x:x.value;
// The copy of a fraction, by octaves, that sounds in [hz, 2 hz) or nearest to hz.
const reg=(T,F,hz)=>fold(F,hz/T.hz);
const at=(T,F,hz)=>near(F,hz/T.hz);
// One note out. `F` exact fraction of the BaseNote; `start` and `len` in beats from the bar line (fractions or numbers).
function put(T,out,e,F,start,len){e.q=F;e.f=T.hz*F.value;e.at=start;e.len=len;e.t=num(start)*T.beat;e.d=num(len)*T.beat;out.push(e);}

// ---------------------------------------------------------------------------------------------------------------------
// The spine: one chord per slot of `T.slot` beats, made for the whole piece when the piece is made.

// The chord of slot k. Past the end of the piece its last chords go on (the director has normally changed piece by then).
function anchor(T,k){const S=T.spine,n=S.length;return S[k<0?0:k<n?k:n-1-((k-n)%T.tail)];}
const anchorAt=(T,bar)=>anchor(T,Math.floor(bar*T.beats/T.slot+1e-9));
// The slots that begin in a bar.
function slotsIn(T,bar){const S=T.slot,b0=bar*T.beats,out=[];for(let k=Math.ceil(b0/S-1e-9);k*S<b0+T.beats-1e-9;k++)out.push(k);return out;}
// A tone that the next chord has a near neighbour of (a comma away: 10/9 before 9/8, 4/3 before 21/16) must be gone
// before that chord sounds, or the two rub.
const rubs=(F,N)=>(N.all||N.pcs).some(p=>{const c=apart(p,F);return c>3&&c<60;});

// ---------------------------------------------------------------------------------------------------------------------
// Layers: each writes the notes that START in one bar. `x` is the position in the piece (0 at its start, 1 at its end).

const LAYERS={
 // The bass of each chord: its root, or the tone the harmony puts under it (an inversion, a pedal). A bass that stays
 // is held, and struck again every four chords.
 bass(T,L,li,bar,x,e,out){
  for(const k of slotsIn(T,bar)){
   const inside=k<T.spine.length,A=anchor(T,k),start=q(k*T.slot-bar*T.beats),F=at(T,A.bass,L.hz);
   if(L.style==='beat'){const step=L.every||1;for(let b=0;b<T.slot;b+=step)put(T,out,{v:L.voice,g:L.gain*(b?.78:1),b:clamp((L.b??.35)+e*.3,0,1),bus:L.bus||'bass',pri:3,a:.008,r:.15,k},F,start.add(q(b)),step*.85);continue;}
   if(inside&&A.bidx%4)continue;
   put(T,out,{v:L.voice,g:L.gain,a:L.attack??.06,r:Math.min(L.release??1.2,T.slot*T.beat*.45),b:L.b??.3,bus:L.bus||'bass',pri:3,drift:L.drift||0,k},F,start,T.slot*(inside?Math.min(4-0,A.bleft+1):1)*.98);
  }
 },
 // The chord, held: each tone in the octave nearest the layer's register, so a tone two chords share stays where it is
 // and the others move by the smallest step. Of a chord of four or five tones the fifth is the first to be left out.
 pad(T,L,li,bar,x,e,out){
  for(const k of slotsIn(T,bar)){
   const inside=k<T.spine.length,A=anchor(T,k);if(inside&&A.cont)continue;
   const run=inside?A.run:1,N=anchor(T,k+run),order=L.tones||(A.pcs.length>3?[0,1,3,2,4]:[0,1,2]),size=Math.min(T.lite?3:L.size||4,order.length,A.pcs.length),used=[],len=T.slot*run,start=q(k*T.slot-bar*T.beats);
   for(let j=0;j<size;j++){
    const i=order[j];let F=at(T,A.pcs[i],L.hz*(i===0&&L.rootLow?.5:1));
    // Below about 170 Hz a third or a second is mud (the roughness measure in music-harmony.js): lift it an octave.
    if(i>0&&T.hz*F.value<(L.floor||170))F=F.mul(TWO);
    while(used.some(u=>u.eq(F)))F=F.mul(TWO);
    if(T.hz*F.value>(L.top||1800))continue;
    used.push(F);
    const rub=N!==A&&rubs(F,N);
    put(T,out,{v:L.voice,g:L.gain*(i===0?1:.85)/Math.max(1,(size-2)**.4),a:L.attack??Math.min(1.6,len*T.beat*.25),r:rub?.3:Math.min(L.release??2,T.slot*T.beat*.45)*clamp(T.hz*F.value/420,.4,1),b:clamp((L.b??.45)+(e-.4)*.3,0,1),
     pan:clamp((j-(size-1)/2)*.4,-1,1),bus:L.bus||'mid',pri:3,shim:L.shim||0,drift:L.drift||0,vib:j%2,k},F,start,len*(rub?.9:L.hold||.98));
   }
  }
 },
 // The accompaniment: the chord broken into a figure. The ladder is the bass and the chord's tones above it, spaced as
 // the harmonic series spaces them when `open` (nothing closer to the bass than a fifth); the pattern says which rung
 // sounds on each step of the beat. It starts again with every chord, so the bass falls where the harmony changes.
 figure(T,L,li,bar,x,e,out){
  const S=T.slot,div=L.div,b0=bar*T.beats*div,steps=T.beats*div,pat=L.pattern,thin=T.lite&&div>=4?2:1;let at0=-1,A=null,lad=null,N=null;
  for(let i=0;i<steps;i+=thin){
   const k=Math.floor((b0+i)/(S*div)+1e-9),local=b0+i-k*S*div;
   if(k!==at0){A=anchor(T,k);N=anchor(T,k+1);lad=ladderOf(T,A,L,li);at0=k;}
   const p=pat[local%pat.length];if(p==null)continue;
   const left=(S*div-local)/div;
   for(const rung of Array.isArray(p)?p:[p]){
    const F=lad[Math.min(rung,lad.length-1)],rub=N!==A&&rubs(F,N);
    put(T,out,{v:L.voice,g:L.gain*(local===0?1:local%div===0?.82:.68)*(.92+.08*noise(T.seed,li,bar,i)),b:clamp((L.b??.4)+e*.25,0,1),pan:clamp(Math.sin(rung*1.7+li)*(L.spread??.35),-1,1),
     bus:L.bus||'mid',pri:2,a:L.attack,r:rub?.12:L.release??.5,ratio:L.ratio,k},F,q(i,div),Math.min(left*(rub?.9:.98),L.ring||.9/div));
   }
  }
 },
 // The tune, as it was made with the piece (buildTune): here it is only given its voice. `quint` adds the note's third
 // harmonic above it, quietly, as an organ's mixture does: a twelfth, pure, heard as colour and not as a second line.
 melody(T,L,li,bar,x,e,out){
  const notes=T.tune&&T.tune.get(bar);if(!notes)return;
  for(const n of notes){
   if(L.sect&&!L.sect.includes(n.sect))continue;
   const F=L.shift?n.F.mul(L.shift):n.F,hz=T.hz*F.value,len=n.len.value*(n.end?.8:L.legato||.95),g=L.gain*(n.strong?1:.86)*(.93+.07*noise(T.seed,li,bar,n.i));
   put(T,out,{v:L.voice,g,a:L.attack,r:n.end?(L.release??1.5)*1.5:L.release,b:clamp((L.b??.5)+e*.2,0,1),pan:L.pan||0,bus:L.bus||'wet',pri:2,vib:1,shim:L.shim||0,ratio:L.ratio,drift:L.drift||0,k:n.k},F,n.at,len);
   if(L.quint&&!T.lite&&hz*3<5000&&!rubs(F.mul(q(3)),anchor(T,n.k)))put(T,out,{v:'partial',g:g*L.quint,a:Math.max(.05,L.attack||.05),r:L.release??1.5,pan:-(L.pan||0),bus:'far',pri:1,k:n.k},F.mul(q(3)),n.at,len);
   if(L.octave&&hz*2<4200&&x>=L.octave)put(T,out,{v:L.voice,g:g*.5,a:L.attack,r:L.release,b:.4,pan:.3,bus:L.bus||'wet',pri:1,vib:0,ratio:L.ratio,k:n.k},F.mul(TWO),n.at,len);
  }
 },
 // Bells. `toll`: the bass of the chord, low, where a phrase begins. Otherwise now and then a tone of the chord, high and far.
 bells(T,L,li,bar,x,e,out){
  if(L.toll){
   for(const k of slotsIn(T,bar)){const A=anchor(T,k);if(A.pos%L.toll||k>=T.spine.length)continue;put(T,out,{v:L.voice,g:L.gain,r:L.ring,ratio:L.ratio||2,b:L.b??.35,bus:L.bus||'wet',pri:2,k},at(T,A.bass,L.hz),q(k*T.slot-bar*T.beats),.3);}
   return;
  }
  const r=rng(hash(T.seed,li,bar)),A=anchorAt(T,bar);
  if(!r.chance(L.density*(.6+.8*e)))return;
  let F=at(T,r.pick(A.pcs),L.hz);if(r.chance(.3))F=F.mul(TWO);while(T.hz*F.value>4400)F=F.div(TWO);
  put(T,out,{v:L.voice,g:L.gain*r.range(.5,1),r:L.ring*r.range(.7,1.3),ratio:r.pick(L.ratios||[2,3,4]),b:r.range(.2,.7)*(L.b??1),pan:r.range(-.8,.8),bus:L.bus||'far',pri:1,shim:L.shim||0,a:L.attack,k:A.index},
   F,q(r.int(0,T.beats*2-1),2),L.hold||.2);
 },
 // The thread: where the key changes, the tone the two keys share is sounded alone, from before the change until after
 // it, so that one note is heard to stay while everything round it becomes something else.
 thread(T,L,li,bar,x,e,out){
  for(const d of T.doors){
   const from=d.k*T.slot-L.lead;if(Math.floor(from/T.beats)!==bar)continue;
   put(T,out,{v:L.voice,g:L.gain,a:L.lead*T.beat*.85,r:L.release??3,b:.4,pan:d.k%2?.3:-.3,bus:L.bus||'wet',pri:2,shim:L.shim??.5,vib:d.k%2,k:d.k},at(T,d.tone,L.hz),from-bar*T.beats,L.lead+(L.hold||2));
  }
 },
 // The harmonic series of the root, arriving partial by partial; every interval is exact because every note is root x n.
 series(T,L,li,bar,x,e,out){
  const r=rng(hash(T.seed,li,bar)),A=anchorAt(T,bar),root=reg(T,A.F,L.hz);
  // How much of the series is open: rises after the layer enters, holds, thins at the end of the piece.
  const open=p=>p-L.from<L.rise?smooth((p-L.from)/L.rise):p>.86?lerp(1,.35,smooth((p-.86)/.14)):1;
  const upTo=p=>clamp(1+Math.floor((L.order.length-1)*open(p)),1,L.order.length);
  const count=upTo(x),pool=L.order.slice(0,count),newest=pool[count-1],arriving=count>upTo(x-1/T.length);
  const want=clamp(Math.round(L.voices*(.45+.55*open(x))+(e-.4)*2),1,count),chosen=new Set();
  if(arriving)chosen.add(newest);
  // Partials of the chord sounding now come first; the rest fill in from the open part of the series.
  if(L.chordal)for(const n of A.set)if(chosen.size<want&&pool.includes(n))chosen.add(n);
  for(let guard=0;chosen.size<want&&guard<40;guard++)chosen.add(pool[Math.floor(r()**.8*count)]);
  // A partial does not ring across a change of root: partials of two roots a third apart can lie a comma from each other.
  const k=Math.floor(bar*T.beats/T.slot+1e-9),moves=!anchor(T,k+1).F.eq(A.F),ends=(k+1)*T.slot-bar*T.beats;
  for(const n of chosen){
   const fresh=arriving&&n===newest,long=T.beats*r.range(.9,1.9),a=r.range(.35,.5),rel=r.range(2.5,5),pan=clamp((n%2?1:-1)*r.range(.1,.75),-1,1),gain=r.range(.7,1),start=r.range(0,.55)*T.beats,cut=moves&&start+long>ends;
   if(cut&&ends-start<1.5)continue;
   const len=cut?(ends-start)*.9:long;
   put(T,out,{v:L.voice,g:L.gain*(fresh?1.5:1)*gain/n**.38,a:len*T.beat*a,r:cut?.8:rel,pan,bus:L.bus||'wet',pri:n<=2?3:2,b:.4,
    shim:n>=4&&n<=10?L.shim||0:0,drift:L.drift||0,vib:n%2,k:A.index},root.mul(q(n)),start,len);
  }
 },
 // Rhythm from fractions: a voice sounds `by` times per cycle. With the real period ratios of a planet's moons this is an
 // orrery you can hear: every stroke is one orbit. The pitches are the tones of one chord of the place's key, so that
 // whichever strokes fall together are a consonance.
 pulses(T,L,li,bar,x,e,out){
  const b0=bar*T.beats,b1=b0+T.beats,A=anchorAt(T,bar),cycle=q(L.cycle);
  for(let i=0;i<L.voices.length;i++){
   const V=L.voices[i];if(x<(V.from||0))continue;
   const P=cycle.div(V.by),Pv=P.value,F=reg(T,A.F,L.hz).mul(V.tone);
   for(let k=Math.ceil(b0/Pv-1e-9);k*Pv<b1-1e-9;k++){
    const s=P.mul(q(k)),together=mod(k,Math.max(1,Math.round(V.by.value)))===0;
    put(T,out,{v:V.voice,g:V.gain*(together?1.25:1)*(.85+.15*noise(T.seed,li,i,k)),r:V.ring,ratio:V.ratio||2,b:V.b??.5,pan:V.pan,bus:V.bus||'far',pri:V.slow?3:2,shim:V.shim||0,a:V.attack,big:V.slow,k:A.index},
     F,s.sub(q(b0)),Math.min(Pv*.9,V.len||.25));
   }
  }
 },
};
// The rungs of an accompaniment figure for a chord: the bass near the layer's register, then the chord's tones above it.
function ladderOf(T,A,L,li){
 const cache=A.lad||(A.lad=new Map());let lad=cache.get(li);if(lad)return lad;
 const low=at(T,A.bass,L.hz),lo=low.value,above=[];
 for(const p of A.pcs){let F=fold(p,lo);for(let o=0;o<5;o++,F=F.mul(TWO)){const rel=F.value/lo;if(rel<1.001||(L.open&&rel<1.45)||T.hz*F.value>(L.top||1400))continue;above.push(F);}}
 above.sort((a,b)=>a.value-b.value);
 // Low down, two rungs closer than a minor third are mud (a ninth beside its root): the upper one waits for its octave.
 lad=[low];for(const F of above){if(lad.length>=(L.reach||5))break;const under=lad[lad.length-1];if(T.hz*F.value<260&&F.value/under.value<1.19)continue;lad.push(F);}
 cache.set(li,lad);return lad;
}

// ---------------------------------------------------------------------------------------------------------------------
// The tune. A phrase has a skeleton: one tone of each chord, chosen so that the line moves by small steps along an arch
// and lands where its cadence asks (the tonic at a full close, a tone of the dominant at a half close). Between those
// tones the surface is a rhythm (a motif of the piece) filled with passing and neighbour notes of the scale, each next
// skeleton tone approached by step. The phrases marked with the same theme begin alike: the opening comes back.

// Rhythms of one unit of melody (a bar, or a chord where chords are shorter): `start:length` in beats. Keyed by the
// unit's length and whether the beat divides in two or in three.
const RHYTHM={
 '4d':['0:4','0:3 3:1','0:2 2:2','0:2 2:1 3:1','0:1 1:1 2:2','0:3/2 3/2:1/2 2:2','0:2 2:3/2 7/2:1/2','0:1 1:2 3:1','0:1 1:1 2:1 3:1','0:3/2 3/2:1/2 2:1 3:1','0:1 1:1/2 3/2:1/2 2:2','0:1 1:1 2:1/2 5/2:1/2 3:1'],
 '4t':['0:4','0:2 2:2','0:3 3:1','0:2 2:1 3:2/3 11/3:1/3','0:1 1:2/3 5/3:1/3 2:2','0:2 2:2/3 8/3:1/3 3:1','0:5/3 5/3:1/3 2:2','0:1 1:1 2:1 3:2/3 11/3:1/3','0:2 2:1 3:1/3 10/3:1/3 11/3:1/3'],
 '3d':['0:3','0:2 2:1','0:1 1:2','0:1 1:1 2:1','0:3/2 3/2:1/2 2:1','0:2 2:1/2 5/2:1/2','0:1 1:1/2 3/2:1/2 2:1'],
 '2d':['0:2','0:1 1:1','0:3/2 3/2:1/2','0:1 1:1/2 3/2:1/2','0:1/2 1/2:1/2 1:1'],
 '2t':['0:2','0:4/3 4/3:2/3','0:1 1:1','0:1 1:2/3 5/3:1/3','0:2/3 2/3:1/3 1:1','0:1 1:1/3 4/3:1/3 5/3:1/3'],
};
const rhythms=new Map();
const rhythm=id=>{let c=rhythms.get(id);if(!c){c=(RHYTHM[id]||RHYTHM['4d']).map(t=>t.split(' ').map(s=>{const [b,l]=s.split(':');return {b:Q.of(b),len:Q.of(l)};}));rhythms.set(id,c);}return c;};
// `n` notes that lead from rung i0 of a scale toward rung i1 (which the next unit begins on): passing notes when the two
// are apart, neighbour notes when they are the same; the last of them is a step from where the line is going, and no
// note is said twice running. Where the distance and the number of notes do not fit by steps, the line begins with a
// skip of a third.
function fill(rr,L,i0,i1,n){
 if(n<=0)return [];
 const dir=Math.sign(i1-i0),gap=Math.abs(i1-i0),out=[];
 if(gap===0){const s=rr.chance(.65)?1:-1,shape=[[s],[s,-s],[s,2*s,s],[s,2*s,s,-s],[s,2*s,s,-s,-2*s]][Math.min(n,5)-1];for(let m=0;m<n;m++)out.push(i0+(shape[m]??-s));}
 else{
  const last=gap>=2?i1-dir:rr.chance(.6)?i1+dir:i0-dir;let cur=i0;
  for(let m=1;m<=n;m++){
   // `left` notes, this one included, to be on `last`: straight there when it is far, round by a neighbour when there
   // are notes to spare, by a third when steps alone cannot arrive on time.
   const left=n-m+1,D=last-cur,far=Math.abs(D),sg=Math.sign(D)||dir;
   const s=left===1?(D||sg):far>=left?sg*Math.max(1,Math.round(far/left)):(left-far)%2===0?-sg:2*sg;
   cur+=s;out.push(cur);
  }
 }
 return out.map(i=>clamp(i,0,L.length-1));
}
// o: {hz: the middle of the tune's range, density: notes wanted per unit (a number, or a function of the phrase),
// app: how often an appoggiatura leans on a beat, feel: 'd' beats in two or 't' in three, vary: each phrase its own
// surface over the theme's skeleton (variations), rest: how often a unit is left silent, skip: phrases without a tune}.
function buildTune(T,r,o){
 const U=Math.min(T.slot,T.beats),per=T.slot/U,pool=rhythm(`${U}${o.feel||'d'}`),tune=new Map(),lads=new Map(),lo=o.hz/(o.down||1.8),hi=o.hz*(o.up||2.1),flip=T.mirror?-1:1,prints=[];
 // The scale under a chord, over the tune's range: each step with whether it is a tone of the chord.
 // (Kept by the chord's scale: every chord of the same name in the same key has the same one.)
 const ladder=A=>{let L=lads.get(A.scale);if(!L){L=[];for(let d=0;d<7;d++){let F=A.K.mul(A.scale[d]);for(let oct=0;oct<8;oct++,F=F.mul(TWO)){const hz=T.hz*F.value;if(hz>=lo&&hz<=hi)L.push({F,c:1200*Math.log2(hz/o.hz),chord:A.is[d],d});}}L.sort((a,b)=>a.c-b.c);lads.set(A.scale,L);}return L;};
 const nearest=(L,c)=>{let b=0,err=1e9;for(let i=0;i<L.length;i++){const d=Math.abs(L[i].c-c);if(d<err){err=d;b=i;}}return b;};
 // Half a phrase of skeleton: several are drawn and the smoothest kept (small steps, the arch followed, one high point).
 // A step of a comma is no step: where two chords have the same scale step a comma apart (the fourth step, then the
 // harmonic seventh of the dominant), the tune does not go from the one to the other.
 const half=(rr,units,from,shape,endRule)=>{
  let best=null;
  for(let c=0;c<14;c++){
   let cur=from,score=0,before=null,top=-1e9,tops=0;const path=[];
   for(let j=0;j<units.length;j++){
    const L=ladder(units[j]),goal=shape(j),end=j===units.length-1&&endRule,opts=[];
    for(let i=0;i<L.length;i++){const n=L[i];if(!n.chord)continue;const d=n.c-cur;
     opts.push([i,1e-9+Math.exp(-((d/340)**2))*Math.exp(-(((n.c-goal)/420)**2))*(Math.abs(d)<5?(before!==null&&Math.abs(before)<5?.12:.5):1)*(Math.abs(d)>710?.02:1)*(Math.abs(d)>4&&Math.abs(d)<60?1e-7:1)*(end?end(n):1)]);}
    const i=rr.weighted(opts),n=L[i];score+=Math.log(opts.find(x=>x[0]===i)[1]);path.push(i);before=n.c-cur;cur=n.c;
    if(n.c>top+5){top=n.c;tops=1;}else if(Math.abs(n.c-top)<=5)tops++;
   }
   score-=(tops-1)*.6;
   if(!best||score>best.score)best={score,path,end:cur};
  }
  return best;
 };
 const pickRhythm=(rr,want)=>rr.weighted(pool.map(c=>[c,Math.exp(-(((c.length-want)/.9)**2))]));
 const motifs=new Map(),motif=(id,dens)=>{let m=motifs.get(id);if(!m){const rr=rng(hash(T.seed,'motif',id));m={a:pickRhythm(rr,dens),b:pickRhythm(rr,dens+.6),c:pickRhythm(rr,dens-.3),d:pickRhythm(rr,Math.min(2,dens)),start:rr.range(-250,250),amp:rr.range(450,850)};motifs.set(id,m);}return m;};
 for(const [pi,ph] of T.phrases.entries()){
  if(o.skip&&o.skip(ph,pi))continue;
  const n=ph.len*per,dens=typeof o.density==='function'?o.density(pi,ph):o.density,shapeOf=motif(ph.theme,dens),M=o.vary?motif(ph.theme+'|'+pi,dens):shapeOf,units=[];
  for(let j=0;j<n;j++)units.push(anchor(T,ph.from+Math.floor(j/per)));
  const lift=ph.sect==='B'?120:ph.sect==='R'?60:0,h=Math.ceil(n/2),shape=j=>flip*(shapeOf.start+(j>=h||ph.theme!=='A'?lift:0)+shapeOf.amp*Math.sin(Math.PI*(((j+.5)/n)**1.3)));
  const endRule=ph.cad==='auth'?(e=>e.d===0?7:e.d===2?1.2:.25):ph.cad==='half'?(e=>e.d===1?3:e.d===4?2:1):ph.cad==='mod'?(e=>e.d===2?3:e.d===4?2:.8):null;
  const first=half(rng(hash(T.seed,'tune',ph.theme)),units.slice(0,h),flip*shapeOf.start,shape,null);
  const second=half(rng(hash(T.seed,'tune',o.vary?ph.theme:pi,2)),units.slice(h),first.end,j=>shape(j+h),endRule),path=[...first.path,...second.path];
  const rs=rng(hash(T.seed,'surface',o.vary?ph.theme+'|'+pi:ph.theme)),rs2=rng(hash(T.seed,'surface',pi,2)),line=[];
  for(let j=0;j<n;j++){
   const rr=j<h?rs:rs2,A=units[j],L=ladder(A),i0=path[j],last=j===n-1;
   const cell=last?pool[0]:j===n-2?M.d:j<h?(j%2?M.b:M.a):(j%2?M.a:M.c);
   const next=last?i0:nearest(L,ladder(units[j+1])[path[j+1]].c);
   let idx=[i0,...fill(rr,L,i0,next,cell.length-1)];
   // An appoggiatura: the step above leans on the beat and falls to the chord's tone.
   if(cell.length>=2&&!last&&j>0&&cell[0].len.value<=U/2&&rr.chance(o.app||0)&&i0+1<L.length)idx=[i0+1,i0,...fill(rr,L,i0,next,cell.length-2)];
   for(let m=1;m<cell.length;m++){const i=clamp(idx[m],0,L.length-1);if(cell[m].len.value>=Math.min(2,U/2)&&!L[i].chord&&!(m===1&&idx[0]!==i0)){const to=Math.sign(next-i)||1;for(const s of [to,-to,2*to,-2*to]){const t=i+s;if(t>=0&&t<L.length&&L[t].chord&&t!==idx[m-1]){idx[m]=t;break;}}}}
   if(o.rest&&j>0&&!last&&j!==n-2&&rr.chance(o.rest))continue;
   const B=ph.from*T.slot+j*U,bar=Math.floor(B/T.beats+1e-9);
   line.push({L,idx:idx.map(i=>clamp(i,0,L.length-1)),cell,bar,inBar:B-bar*T.beats,k:ph.from+Math.floor(j/per),last});
  }
  // No step of a comma anywhere in the line (a passing note left on the old chord's tuning of a step the next chord
  // tunes otherwise, or the same across a rest): the earlier note moves a rung if it is a passing one, else the later
  // one takes another tone of its chord.
  const flat=[];for(const u of line)for(let m=0;m<u.cell.length;m++)flat.push({u,m});
  const shift=(x,other,chordal)=>{const L=x.u.L,i0=x.u.idx[x.m];for(const d of [1,-1,2,-2,3,-3]){const t=i0+d;if(t<0||t>=L.length||(chordal&&!L[t].chord))continue;if(Math.abs(L[t].c-other)>60){x.u.idx[x.m]=t;return;}}};
  for(let pass=0;pass<2;pass++)for(let i=0;i+1<flat.length;i++){
   const x=flat[i],y=flat[i+1],cx=x.u.L[x.u.idx[x.m]].c,cy=y.u.L[y.u.idx[y.m]].c,d=Math.abs(cy-cx);
   if(d>4&&d<60){if(x.m>0)shift(x,cy,false);else shift(y,cx,y.m===0);}
  }
  for(const u of line){
   let arr=tune.get(u.bar);if(!arr){arr=[];tune.set(u.bar,arr);}
   for(let m=0;m<u.cell.length;m++){
    const n2=u.L[u.idx[m]];
    arr.push({at:q(u.inBar).add(u.cell[m].b),len:u.cell[m].len,F:n2.F,k:u.k,strong:m===0,end:u.last,i:arr.length,sect:ph.sect,phrase:pi});
    if(prints.length<28)prints.push(n2.d+7*Math.round(n2.c/1200)+':'+u.cell[m].b);
   }
  }
 }
 T.tune=tune;T.print=prints.join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared by the moods.

// How many bars a piece runs when its harmony is not made of phrases: drawn from its seed, unless the caller fixed it.
function bars(T,r,lo,hi){const n=r.int(lo,hi);return T.fixed||n;}
function timed(T,bpm,beats){T.bpm=bpm;T.beats=beats;T.beat=60/bpm;T.step=T.beat/4;T.bar=T.beat*beats;T.free=false;}
function free(T,seconds){timed(T,240/seconds,4);T.free=true;}
// A tonal piece: tempo, the harmony of the whole of it (music-harmony.js progression), and where its sections begin.
// o: {bpm, beats, slot (beats to a chord), minor (else drawn: darker places lean minor), tags, fam, regions [lo, hi],
// phrases [lo, hi], intro (chords), still, script}. The clock running backward (T.mirror) turns major into minor and
// minor into major, and the tune upside down.
function tonal(T,r,o){
 timed(T,o.bpm,o.beats);T.slot=o.slot;
 const minor=(o.minor??r.chance(clamp(.5-.4*T.lean+(o.dark||0),.06,.94)))!==T.mirror,per=8*T.slot/T.beats;
 let P=r.int(o.phrases[0],o.phrases[1]);const regions=r.int(o.regions[0],o.regions[1]);
 // A length fixed by the caller (a sketch) is the whole form squeezed: fewer phrases, fewer keys.
 if(T.fixed)P=clamp(Math.round((T.fixed-((o.intro||0)+6)*T.slot/T.beats)/per),1,12);
 const G=progression(r,{tonic:T.base,minor,tags:o.tags,fam:o.fam,regions,phrases:P,intro:o.intro||0,still:!!o.still,script:o.script?o.script(minor,P):null});
 const S=G.anchors;T.spine=S;T.phrases=G.phrases;T.keys=G.keys;T.doors=G.doors.filter(d=>d.tone);T.minor=minor;T.tail=1;T.harm={type:'tonal',span:T.slot/T.beats};
 T.length=Math.ceil(S.length*T.slot/T.beats);
 // A bass that stays (a pedal, a repeated root) is held: where each run of it begins and how long it has to go.
 for(let k=0;k<S.length;k++)S[k].bidx=S[k].bcont?S[k-1].bidx+1:0;
 for(let k=S.length-1;k>=0;k--)S[k].bleft=k+1<S.length&&S[k+1].bcont?S[k+1].bleft+1:0;
 T.key=`${minor?'minor':'major'}${G.keys.length>1?' · keys '+[...G.keys,G.keys[0]].map(k=>k.rel+(k.minor?'m':'')).join(' → '):''}`;
 const xOf=k=>k*T.slot/T.beats/T.length,from=f=>{const p=G.phrases.find(f);return p?xOf(p.from):2;},end=G.phrases[G.phrases.length-1];
 T.mark={first:xOf(G.phrases[0].from),second:G.phrases[1]?xOf(G.phrases[1].from):2,B:from(p=>p.sect==='B'),R:from(p=>p.sect==='R'),coda:xOf(end.from+(end.sect==='R'?8:0))};
 return G;
}
// The accompaniment figures: steps to the beat, and which rung of the chord's ladder sounds on each step.
const FIG={
 prelude:{div:4,pattern:[0,1,2,3,4,2,3,4]},alberti:{div:2,pattern:[0,2,1,2]},
 nocturne:[{div:3,pattern:[0,1,3,4,3,1]},{div:3,pattern:[0,2,3,4,3,2]},{div:3,pattern:[0,1,2,3,2,1]}],
 harp:{div:3,pattern:[0,1,2,3,4,5,4,3,2,3,4,3]},rock:{div:3,pattern:[0,2,3,1,3,2]},
 etude:[{div:4,pattern:[0,1,2,3,4,3,2,1]},{div:4,pattern:[0,2,1,3,2,4,3,1]},{div:4,pattern:[0,1,2,3,4,5,4,3,2,3,4,5,4,3,2,1]}],
 ground:{div:2,pattern:[0,2,3,1,2,3]},
};

// ---------------------------------------------------------------------------------------------------------------------
// Moods: the genres the harmony comes from, each a different way of being few things at once.
// T.base is the place's note as a fraction of the BaseNote; T.lean leans it minor or major; T.heat is how bright it sounds.

export const MOODS={
 // Four parts moving chord by chord, as in a Bach chorale: sung, bowed, or on an organ with its twelfth drawn.
 chorale(T,r){
  const kind=r.pick(['choir','choir','strings','organ']),voice=kind==='choir'?'choir':kind==='strings'?'string':'pad',sung=kind==='choir';
  tonal(T,r,{bpm:r.range(46,56),beats:4,slot:2,tags:r.pick(['b','b','bc']),fam:{fifth:1,third:.15,par:.25,tone:.15,semi:.02},regions:[1,2],phrases:[6,9]});T.title='Chorale';
  buildTune(T,r,{hz:r.pick([392,440,494]),density:1.25,app:.06});
  T.fx={level:1.02,ir:'cathedral',wet:.55,chorus:.25,tone:lerp(5200,9000,T.heat),...(sung?{vowelsA:r.shuffle(['a','o','u','o']),vowelsB:r.shuffle(['o','a','e','a']),voiceA:'tenor',voiceB:'soprano',breath:.3}:{})};
  T.layers.push({type:'bass',voice:'sub',hz:55,gain:.082,from:0,to:2});
  T.layers.push({type:'bass',voice,bus:sung?'choirA':'mid',hz:110,gain:sung?.3:voice==='pad'?.08:.1,attack:.3,release:1.4,drift:2,from:0,to:2});
  T.layers.push({type:'pad',voice,bus:sung?'choirA':'mid',size:3,hz:247,gain:sung?.17:voice==='pad'?.07:.085,attack:.35,release:1.6,drift:2,from:0,to:2});
  T.layers.push({type:'melody',voice,bus:sung?'choirB':'wet',gain:sung?.19:voice==='pad'?.13:.16,attack:.3,release:1.6,legato:1,drift:2,quint:kind==='organ'?.12:0,from:0,to:2});
  T.ensemble=kind;
 },
 // One figure, chord after chord, as in Bach's first prelude: the harmony is the whole of the music.
 prelude(T,r){
  tonal(T,r,{bpm:r.range(58,72),beats:4,slot:4,tags:r.pick(['b','bc','bcr','cr']),fam:{fifth:1,third:.5,par:.3,tone:.2,semi:.05},regions:[1,2],phrases:[5,7],intro:2});T.title='Prelude';
  buildTune(T,r,{hz:r.pick([523,587,659]),density:1.1,rest:.25});
  const voice=r.pick(['piano','piano','pluck','bell']);
  T.fx={level:1.23,ir:'hall',wet:.5,chorus:.25,tone:lerp(6500,11000,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:55,gain:.085,from:0,to:2});
  T.layers.push({type:'figure',voice,...FIG.prelude,open:true,reach:5,hz:r.pick([110,131]),ring:voice==='pluck'?1.2:1.5,release:voice==='bell'?1.6:voice==='pluck'?.9:.6,ratio:2,gain:voice==='bell'?.2:voice==='pluck'?.4:.15,from:0,to:2});
  T.layers.push({type:'pad',voice:'string',size:3,hz:330,gain:.05,drift:2,from:T.mark.B,to:T.mark.coda});
  T.layers.push({type:'melody',voice:'glass',gain:.15,attack:.3,release:2.5,legato:1,shim:.4,from:T.mark.second,to:T.mark.coda});
 },
 // A singing line over a murmuring bass, in clear periods: Mozart.
 aria(T,r){
  const beats=r.pick([4,4,3]);
  tonal(T,r,{bpm:r.range(64,78),beats,slot:beats,tags:r.pick(['c','c','bc']),fam:{fifth:1,third:.2,par:.45,tone:.1,semi:.02},regions:[1,2],phrases:[5,7],intro:2});T.title='Aria';
  buildTune(T,r,{hz:r.pick([523,587]),density:2.6,app:.16});
  const voice=r.pick(['glass','string','glass']);
  T.fx={level:1.18,ir:'hall',wet:.42,chorus:.2,tone:lerp(7000,12000,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:55,gain:.09,from:0,to:2});
  T.layers.push({type:'figure',voice:'piano',div:2,pattern:beats===3?[0,2,1,2,1,2]:[0,2,1,2],reach:3,hz:r.pick([147,165]),ring:.5,release:.4,gain:.14,from:0,to:2});
  T.layers.push({type:'melody',voice,gain:voice==='string'?.2:.15,attack:voice==='string'?.12:.06,release:1.2,shim:.3,octave:T.mark.R,from:T.mark.first,to:T.mark.coda});
 },
 // Chopin's night music: wide broken chords in the left hand, a tune that leans and sighs above them.
 nocturne(T,r){
  const slot=r.pick([4,4,2]);
  tonal(T,r,{bpm:r.range(46,58),beats:4,slot,tags:r.pick(['r','r','cr','rl']),fam:{fifth:.7,third:1,par:.5,semi:.15,tone:.15},regions:[1,2],phrases:slot===2?[8,11]:[5,7],intro:slot===2?4:2});T.title='Nocturne';
  buildTune(T,r,{hz:r.pick([494,523,587]),density:slot===2?1.5:2.4,app:.3,feel:'t'});
  const voice=r.pick(['glass','piano','string','glass']),fig=r.pick(FIG.nocturne);
  T.fx={level:1.08,ir:'hall',wet:.5,chorus:.25,tone:lerp(6000,11000,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:49,gain:.08,from:0,to:2});
  T.layers.push({type:'figure',voice:'piano',...fig,open:true,reach:6,hz:r.pick([73,82,98]),ring:1.3,release:.6,gain:.14,from:0,to:2});
  T.layers.push({type:'pad',voice:'string',size:3,hz:294,gain:.055,drift:2,need:.3,from:T.mark.B,to:T.mark.coda});
  T.layers.push({type:'melody',voice,gain:voice==='piano'?.32:voice==='string'?.2:.15,attack:voice==='piano'?undefined:.08,release:voice==='piano'?1.2:1.6,shim:.35,quint:r.chance(.4)?.08:0,octave:T.mark.R,from:T.mark.first,to:T.mark.coda});
  T.layers.push({type:'thread',voice:'glass',hz:587,gain:.11,lead:1.5,hold:2,from:0,to:2});
 },
 // A cradle song: the bass never leaves the tonic, the harmony rocks between rest and leaning, and the line above
 // grows finer with each return (Chopin's Berceuse).
 berceuse(T,r){
  const script=(minor,P)=>{
   const I=minor?'i':'I',rock=`${I} V:7/T ${I} V:7/T ${I} V:7/T ${I} V:7/T`.split(' '),warm=(minor?'i iv/T i V:7/T i:m7 iv:m6/T V:7/T i':'I IV/T I V:7/T I:M6 IV:M6/T V:7/T I').split(' '),
    dusk=(minor?'i V:7/T i V>iv iv/T iv:m6/T i i':'I V:7/T I V>IV IV/T iv/T I I').split(' '),out=[];
   for(let i=0;i<P;i++)out.push({tokens:i===P-1?dusk:i%3===2?warm:rock,theme:i%3===2?'B':'A',sect:i===P-1?'R':'A',cad:i===P-1||i%3===2?'auth':'half'});
   return out;
  };
  tonal(T,r,{bpm:r.range(40,48),beats:2,slot:2,phrases:[6,9],regions:[0,0],script,dark:-.25});T.title='Berceuse';
  buildTune(T,r,{hz:r.pick([587,659,698]),density:(pi)=>Math.min(4.2,1.3+pi*.55),app:.2,feel:'t',vary:true,skip:(ph,pi)=>pi===0});
  const voice=r.pick(['glass','bell','piano']);
  T.fx={level:1.17,ir:'hall',wet:.5,chorus:.25,tone:lerp(6500,11000,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:49,gain:.09,from:0,to:2});
  T.layers.push({type:'figure',voice:'piano',...FIG.rock,open:true,reach:5,hz:r.pick([73,82,98]),ring:1.2,release:.7,gain:.14,from:0,to:2});
  T.layers.push({type:'melody',voice,gain:voice==='glass'?.14:voice==='bell'?.26:.28,attack:voice==='glass'?.06:undefined,release:1.5,ratio:2,shim:.4,from:0,to:2});
 },
 // Liszt consoling: a harp of pure fifths and tenths, a long tune with its twelfth for a halo, keys a third apart
 // joined by the one tone they share.
 consolation(T,r){
  tonal(T,r,{bpm:r.range(52,64),beats:4,slot:4,tags:r.pick(['r','rl','rl']),fam:{third:1.2,fifth:.5,par:.4,semi:.2,tone:.1},regions:[1,3],phrases:[5,7],intro:2,dark:-.2});T.title='Consolation';
  buildTune(T,r,{hz:r.pick([523,587,659]),density:1.8,app:.2});
  T.fx={level:1.24,ir:'hall',wet:.55,chorus:.3,tone:lerp(7000,12500,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:49,gain:.085,from:0,to:2});
  T.layers.push({type:'figure',voice:'pluck',...FIG.harp,open:true,reach:7,hz:r.pick([73,82]),ring:1,release:1.2,b:.35,gain:.34,spread:.6,from:0,to:2});
  T.layers.push({type:'pad',voice:'pad',size:4,hz:294,gain:.045,shim:.3,drift:2,from:T.mark.second,to:2});
  T.layers.push({type:'melody',voice:'glass',gain:.12,attack:.1,release:2,legato:1,shim:.5,quint:.1,octave:T.mark.R,from:T.mark.first,to:T.mark.coda});
  T.layers.push({type:'thread',voice:'partial',hz:880,gain:.12,lead:2,hold:2.5,from:0,to:2});
  T.layers.push({type:'bells',voice:'bell',hz:1320,density:.12,ring:4,gain:.14,need:.3,from:T.mark.B,to:T.mark.coda});
 },
 // Rachmaninov's grief: the minor, low strings, a bell that tolls where each phrase begins.
 elegy(T,r){
  const beats=r.pick([4,4,3]);
  tonal(T,r,{bpm:r.range(44,54),beats,slot:beats,minor:true,tags:r.pick(['r','br','r']),fam:{fifth:1,third:.7,par:.5,tone:.3,semi:.1},regions:[1,2],phrases:[5,6],intro:2});T.title='Elegy';
  const voice=r.pick(['string','piano','string']);
  buildTune(T,r,{hz:voice==='string'?r.pick([294,330]):r.pick([392,440]),density:2.6,app:.25});
  T.fx={level:1.2,ir:'hall',wet:.5,chorus:.2,tone:lerp(4500,8500,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:49,gain:.085,from:0,to:2});
  T.layers.push({type:'pad',voice:'string',size:4,hz:196,rootLow:true,gain:.09,drift:2.5,from:0,to:2});
  T.layers.push({type:'bells',voice:'bell',toll:8,hz:98,ring:7,ratio:2,gain:.14,from:T.mark.first,to:2});
  T.layers.push({type:'melody',voice,gain:voice==='string'?.2:.36,attack:voice==='string'?.15:undefined,release:1.6,legato:1,drift:2,from:T.mark.first,to:T.mark.coda});
  T.layers.push({type:'thread',voice:'glass',hz:392,gain:.12,lead:1.5,hold:2,from:0,to:2});
 },
 // For speed: a figure that does not stop, over harmony that moves by fifths.
 etude(T,r){
  const slot=r.pick([4,4,2]);
  tonal(T,r,{bpm:r.range(92,112),beats:4,slot,tags:r.pick(['bc','bcr','b']),fam:{fifth:1,tone:.5,third:.4,par:.3,semi:.05},regions:[1,3],phrases:slot===2?[12,16]:[7,10],intro:2});T.title='Étude';
  buildTune(T,r,{hz:r.pick([587,659]),density:1.2,rest:.15});
  const voice=r.pick(['pluck','piano','pluck']),fig=r.pick(FIG.etude);
  T.fx={level:1.09,ir:r.pick(['hall','plate']),wet:.38,chorus:.3,tone:lerp(7000,12000,T.heat)};
  T.layers.push({type:'bass',voice:'bass',hz:55,style:'beat',every:2,gain:.11,from:T.mark.first,to:T.mark.coda});
  T.layers.push({type:'bass',voice:'sub',hz:55,gain:.08,from:0,to:2});
  T.layers.push({type:'figure',voice,...fig,reach:7,hz:r.pick([165,196]),ring:voice==='piano'?.5:.45,release:voice==='piano'?.3:.5,b:.45,gain:voice==='piano'?.15:.5,spread:.5,from:0,to:2});
  T.layers.push({type:'pad',voice:'pad',size:3,hz:294,gain:.05,from:T.mark.second,to:2});
  T.layers.push({type:'melody',voice:'glass',gain:.16,attack:.08,release:1.6,legato:1,shim:.4,from:T.mark.second,to:T.mark.coda});
 },
 // Variations on a ground: the same eight chords, each time dressed differently; once in the other mode.
 passacaglia(T,r){
  const pick=minor=>(minor?r.pick(['i v/3 iv/3 V i iv V:7 i','i VII VI V i iv/3 V:7 i','i V/3 V>iv/7 IV/3 iv/3 i/5 V:7 i','i iv VII III VI iv V:7 i']):r.pick(['I V/3 vi I/5 IV I/3 ii V:7','I V vi iii IV I IV V','I IV/T V:7/T I vi ii V:7 I'])).split(' ');
  const script=(minor,P)=>{
   const G=pick(minor),other=pick(!minor),turn=P>=5?Math.floor(P*.6):-1,out=[];
   for(let v=0;v<P;v++)out.push({tokens:v===turn?other:G,minor:v===turn?!minor:minor,theme:v===0?'G':'A',sect:v===turn?'B':'A',cad:'half'});
   out.push({tokens:(minor?'i iv i i i i':'I IV I I I I').split(' '),theme:'Z',sect:'R',cad:'auth'});
   return out;
  };
  tonal(T,r,{bpm:r.range(56,68),beats:3,slot:3,phrases:[6,8],regions:[0,0],script,dark:.25});T.title='Passacaglia';
  buildTune(T,r,{hz:r.pick([392,440,494]),density:(pi)=>[0,1.2,2.2,1.6,2.8,2,1.4,2.4,1.5][pi%9],app:.15,vary:true,skip:ph=>ph.theme!=='A'});
  const last=T.phrases.length-2,xOf=p=>T.phrases[Math.min(p,T.phrases.length-1)].from*T.slot/T.beats/T.length,voice=r.pick(['string','glass','piano']);
  T.fx={level:1.05,ir:'cathedral',wet:.5,chorus:.2,tone:lerp(5000,9500,T.heat)};
  T.layers.push({type:'bass',voice:'string',hz:92,gain:.11,attack:.12,release:.7,drift:2,from:0,to:2});
  T.layers.push({type:'bass',voice:'sub',hz:46,gain:.07,from:0,to:2});
  T.layers.push({type:'pad',voice:r.pick(['string','pad']),size:3,hz:247,gain:.088,drift:2,from:xOf(1),to:2});
  T.layers.push({type:'melody',voice,gain:voice==='glass'?.14:voice==='piano'?.3:.2,attack:voice==='piano'?undefined:.12,release:1.5,legato:1,shim:.3,from:0,to:2});
  T.layers.push({type:'figure',voice:'pluck',...FIG.ground,open:true,reach:5,hz:165,ring:.8,release:.9,b:.35,gain:.3,from:xOf(Math.max(2,last-2)),to:xOf(last)});
 },
 // Deep space: the tonic underneath for a long time, chords turning slowly above it, a few far bells. The pieces that
 // stay in a key and look around; the open fifths stacked on one another (1 : 3/2 : 9/4) are at home here.
 vigil(T,r){
  tonal(T,r,{bpm:r.range(36,44),beats:4,slot:4,tags:r.pick(['rl','l','r']),fam:{third:1,fifth:.4,par:.4,semi:.05,tone:.1},regions:[0,1],phrases:[3,5],still:true});T.title='Vigil';
  buildTune(T,r,{hz:r.pick([523,587,659]),density:1,rest:.4,skip:(ph,pi)=>pi===0});
  const bed=r.pick(['pad','string','pad']);
  T.fx={level:1.32,ir:r.pick(['cathedral','void']),wet:.65,chorus:.35,tone:lerp(5000,10000,T.heat)};
  T.layers.push({type:'bass',voice:'sub',hz:41,gain:.095,attack:1.5,release:3,from:0,to:2});
  T.layers.push({type:'pad',voice:bed,size:4,hz:247,gain:.085,attack:T.bar*.4,release:T.bar*.5,shim:.3,drift:2.5,from:0,to:2});
  T.layers.push({type:'melody',voice:'glass',gain:.12,attack:.6,release:3.5,legato:1,shim:.6,quint:.1,from:T.mark.second,to:T.mark.coda});
  T.layers.push({type:'bells',voice:r.pick(['bell','piano','bell']),hz:880,density:.35,ring:6,gain:.12,from:.08,to:2,shim:.4});
  T.layers.push({type:'thread',voice:'partial',hz:587,gain:.12,lead:2,hold:3,from:0,to:2});
 },
 // A deep fundamental and its harmonic series, partial by partial: the chord a string carries in itself. The
 // fundamental moves by a fifth or a third, re-reading a partial that is sounding. At its crest the chord takes the
 // seventh, ninth, eleventh and thirteenth partials: Scriabin's chord, as the series gives it.
 sunrise(T,r){
  free(T,r.range(5,7.5));T.length=bars(T,r,22,30);T.title='Sunrise';
  const hold=r.int(5,8),sets=[[1,2,3],[2,3,4],[2,3,4,5],[4,5,6],[4,5,6,8],[4,5,6,7],[4,6,7,9],[4,5,6,7,9],[8,9,10,12,15],[8,9,10,11,14],[8,9,10,11,13,14]],moves=[[3,2,3],[4,3,3],[2,3,3],[3,4,3],[5,4,1.5],[4,5,1.5],[6,5,1],[5,6,1],[3,5,1],[5,3,1]];
  const n=Math.max(2,Math.ceil(T.length/hold)),S=[],top=T.rich?sets.length-1:sets.length-3,home={t:T.base,minor:false,rel:ONE};let w=ONE,before=null;
  for(let i=0;i<n;i++){
   const x=(i+.5)/n,rise=x<.62?x/.62:1-(x-.62)/.38,set=i===0?sets[0]:sets[clamp(Math.round(rise*top+(r()-.5)*1.6),1,top)];
   // The root moves by re-reading a partial: partial a of the old root is partial b of the new, a/b a fifth or a third.
   if(before&&r.chance(.75)){const fits=moves.filter(([a,b])=>before.includes(a)&&set.includes(b));if(fits.length){const [a,b]=r.weighted(fits.map(m=>[m,m[2]]));w=w.mul(q(a,b));}}
   const low=2**Math.floor(Math.log2(Math.min(...set))),tones=set.map(v=>q(v,low)),F=fold(T.base.mul(w),1);
   S.push({token:set.join(':'),sym:'series',F,K:F,key:home,minor:false,tones,pcs:tones.map(t=>fold(F.mul(t),1)),bass:F,set,want:clamp(.12+.7*rise,0,1),tension:tension(tones),index:i,x,cont:false,run:1,bidx:0,bleft:0,pos:0});before=set;
  }
  T.spine=S;T.slot=hold*T.beats;T.tail=Math.max(1,Math.floor(n/2));T.harm={type:'series',span:hold};T.phrases=[];T.doors=[];T.keys=[home];T.minor=false;
  const order=[1,2,3,4,5,6,8,7,9,10,12,11,14,13,15,16];
  for(let i=3;i<order.length-1;i++)if(r.chance(.3))[order[i],order[i+1]]=[order[i+1],order[i]];
  T.fx={level:1.34,ir:'hall',wet:.55,chorus:.3,tone:lerp(6000,12000,T.heat),vowelsA:['o','a','o','u'],vowelsB:['a','o','e','a'],voiceA:'tenor',voiceB:'soprano',breath:0};
  T.layers.push({type:'bass',voice:'sub',hz:39,gain:.12,attack:hold*T.bar*.2,release:hold*T.bar*.4,from:0,to:2});
  T.layers.push({type:'series',voice:'partial',hz:55,order:T.rich?order:order.filter(v=>v<=12&&v!==11),rise:r.range(.5,.68),voices:T.lite?4:r.int(4,6),gain:.2,from:0,to:2,shim:.35,chordal:true});
  // The blaze: voices and strings take the low partials once enough of the series is up.
  const blaze=r.pick(['choir','string','pad']);
  T.layers.push({type:'series',voice:blaze,bus:blaze==='choir'?(r.chance(.5)?'choirA':'choirB'):'wet',hz:110,order:[1,2,3,4,5,6],rise:.2,voices:2,gain:.18,from:r.range(.3,.42),to:.9,drift:3});
  T.layers.push({type:'bells',voice:'bell',hz:880,density:.6,ring:6,ratios:[2,3,4],gain:.16,bus:'far',from:r.range(.25,.45),to:2,shim:.4});
  T.key='the harmonic series of one note';
 },
 // An orrery you can hear: each voice sounds as often as its fraction says. Round a planet the fractions are its moons'
 // real orbital periods; elsewhere they are a chord's own numbers. The bells are the five tones of the place's key that
 // are pure with one another whichever of them meet.
 orrery(T,r){
  free(T,r.range(5,7));T.length=bars(T,r,20,28);T.title='Orrery';
  const minor=r.chance(clamp(.5-.4*T.lean,.1,.9))!==T.mirror,five=Qs(minor?'1 6/5 4/3 3/2 9/5':'1 9/8 5/4 3/2 5/3'),home={t:T.base,minor,rel:ONE};
  const invented=r.pick(['1 3/2 2 5/2 7/2','1 2 3 5','1 5/4 3/2 7/4 2 3','1 4/3 2 8/3 4','1 3/2 9/4 7/2','2/3 1 5/3 7/3 3']);
  const bodies=T.orbit&&T.orbit.length>1?T.orbit:Qs(invented).map((by,i)=>({name:`voice ${i+1}`,by}));
  // The slowest orbit sets the cycle so the quickest voice is neither a blur nor a void.
  const rates=bodies.map(b=>b.by.value),fast=Math.max(...rates),cycle=clamp(Math.round(fast*r.range(.9,1.6)),2,48),ranked=rates.slice().sort((a,b)=>a-b),tonic=fold(T.base,1),chordOf={token:minor?'i':'I',sym:minor?'i':'I',F:tonic,K:tonic,key:home,minor,tones:five,pcs:five.map(t=>fold(tonic.mul(t),1)),bass:tonic,want:.3,tension:tension(five),cont:false,run:1,bidx:0,bleft:0,pos:0};
  T.spine=[];for(let i=0;i<Math.ceil(T.length/2);i++)T.spine.push({...chordOf,index:i});
  T.slot=2*T.beats;T.tail=1;T.harm={type:'still',span:2};T.phrases=[];T.doors=[];T.keys=[home];T.minor=minor;
  T.fx={level:2.2,ir:r.pick(['hall','void']),wet:.6,chorus:.3,tone:lerp(7000,13000,T.heat)};
  const voices=bodies.map((b,i)=>{
   const period=cycle/b.by.value*T.beat,slow=period>9,quick=period<1.2,rank=ranked.indexOf(b.by.value),step=Math.round(rank*(bodies.length>1?11/(bodies.length-1):0))+(T.octave||0)*2;
   return {name:b.name,by:b.by,tone:five[mod(step,5)].mul(TWO.pow(Math.floor(step/5))),voice:slow?'bell':quick?r.pick(['pluck','bell']):r.pick(['bell','glass','piano']),slow,
    gain:slow?.2:quick?.11:.15,ring:slow?10:quick?1.2:clamp(period*1.4,2,7),len:slow?.4:.2,pan:clamp((i-(bodies.length-1)/2)*.5,-.9,.9),bus:slow?'wet':quick?'mid':'far',shim:quick?0:.4,ratio:r.pick([2,3]),from:i<2?0:r.range(0,.25)};
  });
  T.layers.push({type:'pulses',cycle,hz:98,voices,from:0,to:2});
  T.layers.push({type:'bass',voice:'sub',hz:41,gain:.06,attack:T.bar*.6,release:T.bar*.8,from:0,to:2});
  T.layers.push({type:'pad',voice:'pad',tones:[0,3],size:2,hz:196,gain:.05,attack:T.bar*.6,release:T.bar*.8,b:.25,shim:.3,drift:2,from:.12,to:2});
  T.key=`${minor?'minor':'major'} · ${bodies.map(b=>b.by).join(' : ')}${T.orbit&&T.orbit.length>1?' (orbital periods)':''}`;T.voices=voices.map(v=>`${v.name} ${v.by}`);
 },
};
export const MOOD_NAMES=Object.keys(MOODS);

// ---------------------------------------------------------------------------------------------------------------------

// One piece. spec: {mood, seed, hz: the BaseNote in Hz, base: the place's note as a fraction of it, light -1..1 (toward
// minor or major), heat 0..1 (how bright the sound), rich (the far harmonics allowed: a star), orbit [{name, by}],
// octave, mirror, lite (the phone profile), length (optional: the whole form squeezed into about that many bars),
// avoid: a Set of tunes already heard}.
export function makeTheme(spec){
 const build=MOODS[spec.mood];if(!build)throw Error(`No mood ${spec.mood}`);
 let T;
 for(let attempt=0;attempt<6;attempt++){
  T={mood:spec.mood,seed:hash(spec.seed,spec.mood,attempt),hz:spec.hz||263/8,base:fold(Q.of(spec.base||ONE),1),place:Q.of(spec.base||ONE),lite:!!spec.lite,lean:spec.light??0,heat:spec.heat??.5,
   rich:!!spec.rich,orbit:spec.orbit||null,octave:spec.octave||0,mirror:!!spec.mirror,fixed:spec.length||0,layers:[],fx:{},cloud:null,spine:[],phrases:[],doors:[],tune:null,print:''};
  build(T,rng(T.seed));
  if(!T.print||!spec.avoid||!spec.avoid.has(T.print))break;
 }
 T.label=`${T.title} · ${T.key} · ${T.free?'free time':Math.round(T.bpm)+' BPM'}`;
 return T;
}
// The notes that start in bar `bar` of a piece, in time order. `energy` 0..1 opens or closes the optional layers.
export function composeBar(T,bar,energy=.4){
 const out=[],e=Math.round(clamp(energy,0,1)*20)/20,x=Math.min(1,bar/T.length);
 for(let li=0;li<T.layers.length;li++){
  const L=T.layers[li];
  if(x<L.from||x>=L.to||e<(L.need||0))continue;
  LAYERS[L.type](T,L,li,bar,x,e,out);
 }
 // Dynamics follow the harmony: where a chord leans, and toward the crest of the piece, the notes hung from it are a
 // little louder and brighter; where it rests, softer.
 if(out.length){const w=anchorAt(T,bar).want??.5,up=.88+.24*w;for(const n of out)if(n.k!==undefined){n.g*=up;if(n.b!==undefined)n.b=clamp(n.b+.2*(w-.5),0,1);}}
 out.sort((a,b)=>a.t-b.t);
 return out;
}
// The chord sounding in a bar, for tests, for the panel and for the RMT module: its root as a fraction of the
// BaseNote, its tones, its key.
export function harmonyAt(T,bar){const A=anchorAt(T,bar);return {root:A.F,tones:A.tones,pcs:A.pcs,bass:A.bass,tension:A.tension,want:A.want,token:A.token,tonic:A.K,minor:A.minor,key:A.key,door:A.door||null,index:A.index};}
// Short figures outside any piece: the rush of a trip, the mark of an arrival, the note of a place coming into range.
// `kind`: riser, jump, arrive, enter.
// `base` is the place's note as a fraction of the BaseNote `hz`.
export function composeAccent(kind,seed,base=ONE,hz=263/8,seconds=5){
 const r=rng(hash(seed,kind)),F=fold(Q.of(base),27.5/hz),f=hz*F.value,out=[];
 if(kind==='riser'||kind==='jump'){
  // Five tones an octave apart, already under way, all rising together and growing; they are cut at the arrival.
  const k=5,rise=kind==='jump'?2.2:1.5;
  for(let j=0;j<k;j++)out.push({v:'glide',t:0,d:seconds,f:f*2*2**j,f2:f*2*2**(j+rise),g:.1,ph:j/k,ph2:Math.min(1,(j+rise)/k),swell:1,wave:j%2?'sine':'glottal',bus:'wet',pan:j%2?-.4:.4,pri:2});
  out.push({v:'wind',t:0,d:seconds,f:260,f2:5200,g:.11,a:seconds*.93,r:.35,bus:'wet',pri:2});
  out.push({v:'sub',t:0,d:seconds,f:f*2,g:.16,a:seconds*.9,r:.5,bus:'dry',pri:3});
 }else if(kind==='enter'){
  // Coming within range of a place without a trip: its own note, held through the change of piece, with its fifth.
  const G=fold(Q.of(base),392/hz);
  out.push({v:'glass',t:0,d:seconds,f:hz*G.value,q:G,g:.07,a:seconds*.4,r:4,bus:'wet',pri:2,shim:.6,vib:0});
  out.push({v:'partial',t:seconds*.25,d:seconds*.8,f:hz*G.value*1.5,q:G.mul(q(3,2)),g:.035,a:seconds*.4,r:4,pan:.4,bus:'wet',pri:1});
  out.push({v:'partial',t:seconds*.1,d:seconds*.9,f:hz*G.value/2,q:G.div(TWO),g:.05,a:seconds*.4,r:4,pan:-.4,bus:'wet',pri:2});
 }else{
  // Arrival: a low gong, a sub that settles, and above it the place's note in open fifths (partials 2, 3, 4, 6, 9 of
  // it: prime 3 alone, so the chord is right whether the piece that follows is major or minor).
  out.push({v:'gong',t:0,d:.2,f:f*4,g:.2,r:9,bus:'wet',pri:3,big:true});
  out.push({v:'glide',t:0,d:5,f:f*4,f2:f*2,g:.2,ph:.35,ph2:1,wave:'sine',bus:'dry',pri:3});
  const chord=r.pick([[4,6,8,12],[4,6,9,12],[6,8,9,12],[4,6,8,9]]);
  for(let i=0;i<chord.length;i++)out.push({v:'partial',t:.15+i*.22,d:3,f:f*2*chord[i],q:F.mul(q(2*chord[i])),g:.05,a:1.6,r:5,pan:(i%2?1:-1)*.5,bus:'wet',pri:2,shim:.4});
  out.push({v:'bell',t:.05,d:.2,f:f*16*r.pick([1,1.5,2]),g:.06,r:6,ratio:3,b:.7,bus:'far',pri:1});
 }
 return out.sort((a,b)=>a.t-b.t);
}

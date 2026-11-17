// The instruments and the room: everything here is Web Audio nodes, built from a note the composer wrote.
// No samples and no downloads; reverbs are computed once and kept. A voice is a handful of nodes that stop themselves;
// the engine's one sweep (web/music-engine.js) disconnects them afterwards, so there is no timer or callback per note.
import {hash,clamp} from './music-theory.js';

const perContext=new WeakMap();
// Wave shapes and noise shared by every voice of a context.
export function shared(ac){
 let S=perContext.get(ac);if(S)return S;
 const wave=amp=>{const n=33,re=new Float32Array(n),im=new Float32Array(n);for(let i=1;i<n;i++)im[i]=amp(i);return ac.createPeriodicWave(re,im);};
 const noise=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),d=noise.getChannelData(0);let x=0x9e3779b1|0;
 for(let i=0;i<d.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;d[i]=(x>>>0)/2147483648-1;}
 const bell=new Float32Array(65);for(let i=0;i<65;i++)bell[i]=.5-.5*Math.cos(2*Math.PI*i/64);
 const fadeIn=new Float32Array(33),fadeOut=new Float32Array(33);for(let i=0;i<33;i++){fadeIn[i]=Math.sin(Math.PI/2*i/32);fadeOut[i]=Math.cos(Math.PI/2*i/32);}
 const drive=new Float32Array(257);for(let i=0;i<257;i++){const v=i/128-1;drive[i]=Math.tanh(v*1.6)/Math.tanh(1.6);}
 // Linear to 0.7, then bending to 1: nothing leaves the page louder than full scale, whatever arrives.
 const ceiling=new Float32Array(1025);for(let i=0;i<1025;i++){const v=i/512-1,a=Math.abs(v);ceiling[i]=Math.sign(v)*(a<.7?a:.7+.3*Math.tanh((a-.7)/.3)/Math.tanh(1));}
 S={noise,bell,fadeIn,fadeOut,drive,ceiling,waves:{
  // Every harmonic, falling gently: a voice before the mouth shapes it (the octave world: every partial has its octave).
  glottal:wave(n=>1/n**1.15),
  warm:wave(n=>1/n**1.6),
  soft:wave(n=>1/n**2.1),
  // Nearly a sine, with a little of the third and fifth harmonics: a rubbed glass.
  glass:wave(n=>[1,.07,.16,.02,.06,.01,.02][n-1]||0),
  // Odd harmonics only: the hollow spectrum in which a twelfth (3/1), not an octave, is the nearest relation.
  reed:wave(n=>n%2?1/n**1.2:0),
 }};
 perContext.set(ac,S);return S;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rooms: impulse responses made of decaying noise that darkens as it decays, with a few early echoes.

export const ROOMS={
 hall:{seconds:2.8,t60:2.7,bloom:.012,damp:1.1,bright:.75,pre:.012,early:.5},
 cathedral:{seconds:3,t60:3.6,bloom:.06,damp:1.6,bright:.55,pre:.03,early:.25},
 plate:{seconds:1.5,t60:1.3,bloom:.004,damp:.5,bright:.95,pre:.002,early:.2},
 // No wall at all: the sound blooms late and bright, like light arriving.
 void:{seconds:3,t60:3.8,bloom:.18,damp:.7,bright:.9,pre:.02,early:0},
};
const roomData=new Map();
// The work is cut into steps so a live page can spread it over several turns of the event loop.
function* roomSteps(name,rate,chunk){
 const R=ROOMS[name],n=Math.floor(R.seconds*rate),pre=Math.floor(R.pre*rate),out=[new Float32Array(n),new Float32Array(n)];
 let energy=0,done=0;
 for(let c=0;c<2;c++){
  const data=out[c];let x=(hash(name,c,77)|1)>>>0,y=0;
  for(let i=pre;i<n;i++){
   const t=(i-pre)/rate;x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;
   const white=x/2147483648-1,a=clamp(R.bright*Math.exp(-t*R.damp)+.05,.02,1);
   y+=a*(white-y);
   const v=y*(1-Math.exp(-t/R.bloom))*Math.exp(-t*6.908/R.t60)*Math.min(1,(n-i)/(rate*.08));
   data[i]=v;energy+=v*v;
   if(++done%chunk===0)yield null;
  }
  // Early echoes: a few single returns before the wash.
  for(let k=0;k<8&&R.early;k++){x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;const at=pre+Math.floor((.006+.085*(x/4294967296))*rate),v=R.early*(k%2?-1:1)*Math.exp(-k*.35)*.05;if(at<n){energy+=2*data[at]*v+v*v;data[at]+=v;}}
 }
 // Unit energy per channel: the wet level of a room is then set by the deck, not by the room's length.
 const scale=Math.sqrt(2/Math.max(energy,1e-9));for(const data of out)for(let i=0;i<n;i++)data[i]*=scale;
 return out;
}
export function buildRoom(name,rate){
 const key=`${name}@${rate}`;if(roomData.has(key))return roomData.get(key);
 const it=roomSteps(name,rate,1e12);let r=it.next();while(!r.done)r=it.next();roomData.set(key,r.value);return r.value;
}
// The same, a slice at a time: no slice holds the main thread for more than a millisecond or two.
export async function prepareRoom(name,rate){
 const key=`${name}@${rate}`;if(roomData.has(key))return roomData.get(key);
 const it=roomSteps(name,rate,12000);let r=it.next();while(!r.done){await new Promise(f=>setTimeout(f,0));r=it.next();}
 if(!roomData.has(key))roomData.set(key,r.value);return roomData.get(key);
}
export const roomReady=(name,rate)=>roomData.has(`${name}@${rate}`);
const roomBuffers=new WeakMap();
export function roomBuffer(ac,name){
 let m=roomBuffers.get(ac);if(!m){m=new Map();roomBuffers.set(ac,m);}
 if(!m.has(name)){const data=buildRoom(name,ac.sampleRate),b=ac.createBuffer(2,data[0].length,ac.sampleRate);b.copyToChannel(data[0],0);b.copyToChannel(data[1],1);m.set(name,b);}
 return m.get(name);
}
// A loop of soft grains on the harmonics of one note: a cloud that is in tune with the piece.
export function cloudBuffer(ac,spec){
 const rate=ac.sampleRate,n=Math.floor(rate*3.5),b=ac.createBuffer(1,n,rate),d=b.getChannelData(0);let x=(spec.seed|1)>>>0;
 const rnd=()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};
 for(let g=0;g<70;g++){
  const f=spec.hz*(1+Math.floor(rnd()*12))*(rnd()<.3?2:1),len=Math.floor(rate*(.05+.14*rnd())),start=Math.floor(rnd()*n),amp=.3+.7*rnd();
  // A sine by recurrence (two multiplies a sample), under a raised-cosine window; grains wrap round the loop's end.
  const w=2*Math.PI*f/rate,k=2*Math.cos(w);let s1=0,s2=-Math.sin(w);
  const wk=2*Math.cos(2*Math.PI/len);let c1=1,c2=Math.cos(2*Math.PI/len);
  for(let i=0;i<len;i++){const s=k*s1-s2;s2=s1;s1=s;const c=wk*c1-c2;c2=c1;c1=c;d[(start+i)%n]+=amp*s*(.5-.5*c);}
 }
 let peak=1e-9;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(d[i]));for(let i=0;i<n;i++)d[i]*=.9/peak;
 return b;
}

// ---------------------------------------------------------------------------------------------------------------------
// The rack of one deck: buses the voices play into, a choir's mouth (formants), reverb, echo, chorus, duck, tone, fader.

// Formants of sung vowels: frequencies, levels, widths (Hz).
const VOWELS={
 soprano:{a:[[800,1150,2900,3900],[1,.5,.03,.1],[80,90,120,130]],e:[[350,2000,2800,3600],[1,.1,.18,.01],[60,100,120,150]],o:[[450,800,2830,3800],[1,.28,.08,.08],[70,80,100,130]],u:[[325,700,2700,3800],[1,.16,.02,.01],[50,60,170,180]]},
 tenor:{a:[[650,1080,2650,2900],[1,.5,.45,.4],[80,90,120,130]],e:[[400,1700,2600,3200],[1,.2,.25,.2],[70,80,100,120]],o:[[400,800,2600,2800],[1,.32,.25,.25],[40,80,100,120]],u:[[350,600,2700,2900],[1,.1,.14,.2],[40,60,100,120]]},
 bass:{a:[[600,1040,2250,2450],[1,.45,.35,.35],[60,70,110,120]],e:[[400,1620,2400,2800],[1,.25,.35,.25],[40,80,100,120]],o:[[400,750,2400,2600],[1,.28,.09,.1],[40,80,100,120]],u:[[350,600,2400,2675],[1,.1,.03,.04],[40,80,100,120]]},
};
export function createRack(ac,S,fx,{lite=false,cloud=null,room=null}={}){
 const g=(v=1)=>{const n=ac.createGain();n.gain.value=v;return n;},nodes=[],sources=[];
 const keep=n=>{nodes.push(n);return n;};
 const out=keep(g(0)),tone=keep(ac.createBiquadFilter()),sum=keep(g(1)),duck=keep(g(1)),sus=keep(g(1)),revIn=keep(g(1)),dlyIn=keep(g(1));
 tone.type='lowpass';tone.frequency.value=fx.tone||14000;tone.Q.value=.2;
 sus.connect(duck);duck.connect(sum);
 if(fx.drive){const sh=keep(ac.createWaveShaper()),pre=keep(g(1+fx.drive*2)),post=keep(g(1/(1+fx.drive*1.2)));sh.curve=S.drive;sh.oversample=lite?'none':'2x';sum.connect(pre);pre.connect(sh);sh.connect(post);post.connect(tone);}
 else sum.connect(tone);
 // Air: the top two octaves lifted a little, the bottom one held back, so long tails stay clear and small speakers are not asked for what they cannot give.
 const air=keep(ac.createBiquadFilter()),floor=keep(ac.createBiquadFilter());air.type='highshelf';air.frequency.value=3600;air.gain.value=fx.air??4;floor.type='lowshelf';floor.frequency.value=70;floor.gain.value=-3;
 // Each mood's own level, set from measurement so that every piece sits at about the same loudness.
 const level=keep(g(fx.level??1));
 tone.connect(air);air.connect(floor);floor.connect(level);level.connect(out);
 // The room. A dry path always exists: the room is added to the sound, never substituted for it. The convolver itself is
 // the engine's, shared by every deck that uses that room (`room` is its input): giving a convolver its impulse response
 // costs about 10 ms of main thread, too much to pay at every change of piece. `send` follows the deck's fader.
 const wet=keep(g((fx.wet??.5)*(fx.level??1))),send=keep(g(0));
 revIn.connect(wet);wet.connect(send);if(room)send.connect(room);
 // Echo: left, then right, in time with the piece.
 if(fx.delay){
  const time=clamp(fx.delay.time,.05,2.4),dl=keep(ac.createDelay(2.5)),dr=keep(ac.createDelay(2.5)),fb=keep(g(Math.min(.6,fx.delay.feedback))),lp=keep(ac.createBiquadFilter()),pl=keep(ac.createStereoPanner()),pr=keep(ac.createStereoPanner()),dw=keep(g(fx.delay.wet)),toRoom=keep(g(.25));
  dl.delayTime.value=dr.delayTime.value=time;lp.type='lowpass';lp.frequency.value=3800;pl.pan.value=-.7;pr.pan.value=.7;
  dlyIn.connect(dl);dl.connect(pl);dl.connect(dr);dr.connect(pr);dr.connect(lp);lp.connect(fb);fb.connect(dl);pl.connect(dw);pr.connect(dw);dw.connect(sus);dw.connect(toRoom);toRoom.connect(revIn);
 }
 const lfo=(hz,depth)=>{const o=ac.createOscillator(),d=keep(g(depth));o.frequency.value=hz;o.connect(d);o.start();sources.push(o);return d;};
 // Chorus: two short delays, slowly wavering, either side.
 let chorusIn=null;
 if(fx.chorus&&!lite){
  chorusIn=keep(g(1));const level=keep(g(fx.chorus*.5));
  for(const [ms,hz,pan] of [[17,.31,-.8],[23,.47,.8]]){const d=keep(ac.createDelay(.1)),p=keep(ac.createStereoPanner());d.delayTime.value=ms/1000;p.pan.value=pan;lfo(hz,.0009).connect(d.delayTime);chorusIn.connect(d);d.connect(p);p.connect(level);}
  level.connect(sus);
 }
 // The buses: each a fixed blend of dry, room and echo, so a voice needs no send nodes of its own.
 const input=(dry,rev,dly,cho,target=sus)=>{const n=keep(g(1));if(dry===1)n.connect(target);else if(dry>0){const d=keep(g(dry));n.connect(d);d.connect(target);}
  if(rev>0){const r=keep(g(rev));n.connect(r);r.connect(revIn);}if(dly>0&&fx.delay){const d=keep(g(dly));n.connect(d);d.connect(dlyIn);}if(cho&&chorusIn)n.connect(chorusIn);return n;};
 const inp={dry:input(1,.06,0,0),mid:input(1,.3,.1,1),wet:input(.8,.65,.2,1),far:input(.3,1,.15,0),echo:input(.9,.3,.6,0),bass:input(1,0,0,0),drum:input(1,.07,0,0,sum)};
 // The choir's mouth: voices are raw buzzes until they pass through a vowel's formants. Two mouths, so two vowels at once.
 const mouths={};
 if(fx.vowelsA){
  const count=lite?3:4,result=input(.55,.85,0,1);
  for(const [bus,kind,first] of [['choirA',fx.voiceA||'tenor',fx.vowelsA[0]],['choirB',fx.voiceB||'soprano',fx.vowelsB[0]]]){
   const into=keep(g(1)),body=keep(ac.createBiquadFilter()),bodyGain=keep(g(.5)),V=VOWELS[kind][first],bands=[];
   body.type='lowpass';body.frequency.value=420;into.connect(body);body.connect(bodyGain);bodyGain.connect(result);
   for(let i=0;i<count;i++){const f=keep(ac.createBiquadFilter()),a=keep(g(V[1][i]*3.2));f.type='bandpass';f.frequency.value=V[0][i];f.Q.value=V[0][i]/V[2][i]*.6;into.connect(f);f.connect(a);a.connect(result);bands.push([f,a]);}
   mouths[bus]={kind,bands};inp[bus]=into;
  }
  // Breath: a little noise through the same mouth, so the choir is made of air as well as pitch.
  if(fx.breath){const n=ac.createBufferSource(),level=keep(g(.012*fx.breath));n.buffer=S.noise;n.loop=true;n.connect(level);level.connect(inp.choirA);level.connect(inp.choirB);n.start();sources.push(n);}
 }
 const vib=lite?null:[lfo(5.1,3),lfo(5.9,3.6)];
 // The whole deck's brightness breathing slowly in time with the piece (the electro moods).
 if(fx.wobble)lfo(fx.wobble.hz,(fx.tone||14000)*fx.wobble.depth).connect(tone.frequency);
 return {
  // `cloud`: the piece's loop of grains, already built (the engine's prepare()), or its description to build now.
  in:inp,out,send,lite,vib,cloud:!cloud?null:typeof cloud.getChannelData==='function'?cloud:cloudBuffer(ac,cloud),tone,
  // Move a mouth to another vowel over `seconds`.
  vowel(bus,name,t,seconds){const m=mouths[bus];if(!m)return;const V=VOWELS[m.kind][name];if(!V)return;
   m.bands.forEach(([f,a],i)=>{f.frequency.setTargetAtTime(V[0][i],t,seconds/3);a.gain.setTargetAtTime(V[1][i]*3.2,t,seconds/3);});},
  // The pad breathes with the kick: down at once, back within a beat.
  duckAt(t,depth,beat){duck.gain.setTargetAtTime(1-depth,t,.006);duck.gain.setTargetAtTime(1,t+.04,beat*.22);},
  dispose(){for(const s of sources){try{s.stop();}catch{}}for(const n of nodes){try{n.disconnect();}catch{}}},
 };
}
// The end of the chain: volume, a limiter with its make-up gain taken back out, and a ceiling.
export function createMaster(ac){
 const input=ac.createGain(),volume=ac.createGain(),limit=ac.createDynamicsCompressor(),trim=ac.createGain(),ceiling=ac.createWaveShaper();
 volume.gain.value=0;limit.threshold.value=-9;limit.knee.value=6;limit.ratio.value=14;limit.attack.value=.004;limit.release.value=.2;
 // The compressor adds a fixed make-up gain (Web Audio: the inverse of its gain at full scale, to the power 0.6). Undo it, so
 // quiet music passes at its own level and only peaks are held.
 const knee=6,t=-9,ratio=14,full=t+knee+(0-t-knee)/ratio-(knee*(1-1/ratio))/2,makeup=10**(-full*.6/20);
 trim.gain.value=1/makeup;ceiling.curve=shared(ac).ceiling;
 input.connect(volume);volume.connect(limit);limit.connect(trim);trim.connect(ceiling);ceiling.connect(ac.destination);
 return {input,volume,close(){for(const n of [input,volume,limit,trim,ceiling]){try{n.disconnect();}catch{}}}};
}

// ---------------------------------------------------------------------------------------------------------------------
// Voices. Each takes a note `e`, a start time `t`, and the gain node `amp` its sound must pass through; it returns the
// time at which it is silent. Sources are started and stopped here and now; nothing is left to a callback.

const osc=(ac,w,f,t,end,cents=0)=>{const o=ac.createOscillator();if(typeof w==='string')o.type=w;else o.setPeriodicWave(w);o.frequency.value=f;if(cents)o.detune.value=cents;o.start(t);o.stop(end);return o;};
const lowpass=(ac,f,Q=.5)=>{const b=ac.createBiquadFilter();b.type='lowpass';b.frequency.value=clamp(f,30,18000);b.Q.value=Q;return b;};
// A bowed or sung note: slow in (in two slopes), held, away by decades.
function swell(p,t,d,peak,a,r){a=Math.max(.004,Math.min(a,Math.max(d,.004)));const hold=t+Math.max(d,a);p.setValueAtTime(0,t);p.linearRampToValueAtTime(peak*.35,t+a*.5);p.linearRampToValueAtTime(peak,t+a);p.setValueAtTime(peak,hold);p.exponentialRampToValueAtTime(peak*.001,hold+r);return hold+r;}
// A struck note: there at once, then dying.
function strike(p,t,peak,a,decay){p.setValueAtTime(0,t);p.linearRampToValueAtTime(peak,t+a);p.exponentialRampToValueAtTime(peak*.001,t+a+decay);return t+a+decay;}
// A played note: attack, a fall to a sustain level, held, released.
function gate(p,t,d,peak,a,fall,sustain,r){const hold=t+Math.max(d,a+.005);p.setValueAtTime(0,t);p.linearRampToValueAtTime(peak,t+a);const at=Math.min(t+a+fall,hold),level=peak*sustain**((at-t-a)/fall);
 p.exponentialRampToValueAtTime(Math.max(level,1e-5),at);p.setValueAtTime(Math.max(level,1e-5),hold);p.exponentialRampToValueAtTime(Math.max(level*.001,1e-7),hold+r);return hold+r;}
// The mouths' vibrato, shared: connected to a voice's pitch and remembered so the sweep can let go of it.
function waver(R,V,o,which){if(!R.vib)return;const l=R.vib[which?1:0];l.connect(o.detune);(V.mods||(V.mods=[])).push(l,o.detune);}
// An octave above, late and quiet, into the room only: the shimmer on glass and bells.
function shimmer(ac,R,V,e,t,end,peak){
 if(!e.shim||R.lite||e.f>2400)return;
 const o=osc(ac,'sine',e.f*2,t,end,3),a=ac.createGain(),rise=Math.min(1.5,(end-t)*.4);
 a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(peak*e.shim*.28,t+rise);a.gain.setValueAtTime(peak*e.shim*.28,Math.max(t+rise,end-(end-t)*.5));a.gain.linearRampToValueAtTime(0,end);
 o.connect(a);a.connect(R.in.far);V.tails.push(a);V.cost+=.5;
}
const VOICES={
 // One pure tone, with a twin a fraction of a hertz away: two partials beating slowly.
 partial(ac,S,R,e,t,amp,V){
  const end=swell(amp.gain,t,e.d,e.g*.8,e.a??e.d*.4,e.r??3),o=osc(ac,'sine',e.f,t,end);o.connect(amp);
  if(e.beat&&!R.lite){const b=osc(ac,'sine',e.f+e.beat,t,end),h=ac.createGain();h.gain.value=.55;b.connect(h);h.connect(amp);}
  shimmer(ac,R,V,e,t,end,e.g);return end;
 },
 sub(ac,S,R,e,t,amp){
  // The second and third harmonics carry the note on speakers too small for the fundamental.
  const end=swell(amp.gain,t,e.d,e.g,e.a??e.d*.3,e.r??2),o=osc(ac,'sine',e.f,t,end),o2=osc(ac,'sine',e.f*2+(e.beat||0),t,end),o3=osc(ac,'sine',e.f*3,t,end),h=ac.createGain(),h3=ac.createGain();
  h.gain.value=.4;h3.gain.value=.14;o.connect(amp);o2.connect(h);h.connect(amp);o3.connect(h3);h3.connect(amp);return end;
 },
 pad(ac,S,R,e,t,amp,V){
  const a=Math.min(e.a??Math.min(2.5,e.d*.35),Math.max(e.d,.004)),r=e.r??2.5,end=swell(amp.gain,t,e.d,e.g*.5,a,r),top=clamp(e.f*(2.5+9*(e.b??.5)),300,12000),f=lowpass(ac,top*.45,.4);
  f.frequency.setValueAtTime(top*.45,t);f.frequency.linearRampToValueAtTime(top,t+a);f.frequency.setValueAtTime(top,Math.max(t+a,end-r));f.frequency.exponentialRampToValueAtTime(top*.4,end);
  // The three oscillators are a fortieth of a semitone apart, no more: the chords are pure and must be heard to be.
  // Outside the octave world the instruments take the odd-harmonic spectrum, in which a twelfth fuses as an octave does here.
  for(const c of R.lite?[-2.5,2.5]:[-3,0,2.6]){const o=osc(ac,e.reed?S.waves.reed:S.waves.warm,e.f,t,end,c+(e.drift||0)*(c<0?-.3:.3));o.connect(f);}
  f.connect(amp);shimmer(ac,R,V,e,t,end,e.g);return end;
 },
 // A singer: a buzz on its way to a mouth. The pitch leans a few cents over the note, and no two lean alike.
 choir(ac,S,R,e,t,amp,V){
  const end=swell(amp.gain,t,e.d,e.g*.75,e.a??e.d*.4,e.r??3),drift=e.drift||0,o=osc(ac,S.waves.glottal,e.f,t,end);
  if(drift){o.detune.setValueAtTime(-drift*.5,t);o.detune.linearRampToValueAtTime(drift,t+(end-t)*.45);o.detune.linearRampToValueAtTime(-drift*.3,end);}
  waver(R,V,o,e.vib);o.connect(amp);
  if(!R.lite){const o2=osc(ac,S.waves.glottal,e.f,t,end,4-drift),h=ac.createGain();h.gain.value=.6;waver(R,V,o2,!e.vib);o2.connect(h);h.connect(amp);V.cost+=.5;}
  return end;
 },
 glass(ac,S,R,e,t,amp,V){
  const end=swell(amp.gain,t,e.d,e.g,e.a??.4,e.r??3),o=osc(ac,S.waves.glass,e.f,t,end);waver(R,V,o,e.vib);o.connect(amp);shimmer(ac,R,V,e,t,end,e.g);return end;
 },
 string(ac,S,R,e,t,amp,V){
  const a=e.a??.25,r=e.r??1.5,end=swell(amp.gain,t,e.d,e.g*.55,a,r),f=lowpass(ac,clamp(e.f*(3+4*(e.b??.5)),400,5200),.6);
  for(const c of [-3,2.6]){const o=osc(ac,e.reed?S.waves.reed:S.waves.warm,e.f,t,end,c+(e.drift||0)*(c<0?-.4:.4));waver(R,V,o,c>0);o.connect(f);}
  f.connect(amp);shimmer(ac,R,V,e,t,end,e.g);return end;
 },
 // A bell by frequency modulation: bright at the stroke, pure as it rings.
 bell(ac,S,R,e,t,amp,V){
  const ring=e.r??4,end=strike(amp.gain,t,e.g,.003,ring),c=osc(ac,'sine',e.f,t,end),m=osc(ac,'sine',e.f*(e.ratio||3.5),t,end),depth=ac.createGain(),index=e.f*(.8+3.2*(e.b??.5));
  depth.gain.setValueAtTime(index,t);depth.gain.exponentialRampToValueAtTime(index*.04,t+Math.min(ring*.5,1.2));m.connect(depth);depth.connect(c.frequency);c.connect(amp);
  shimmer(ac,R,V,e,t,end,e.g*.6);return end;
 },
 // A large bell or gong by addition: partials that are not harmonics, the low ones outlasting the high (Risset's recipe).
 gong(ac,S,R,e,t,amp){
  const ring=e.r??8,end=t+ring+.01;amp.gain.setValueAtTime(e.g*.3,t);
  const P=R.lite?[[.56,1,1],[.92,.8,.65],[1.19,1.1,.33],[2,.9,.25]]:[[.56,1,1],[.563,.6,.9],[.92,.8,.65],[1.19,1.2,.33],[1.7,.75,.35],[2,.9,.25],[2.74,.6,.2],[3.76,.4,.1]];
  for(const [ratio,level,life] of P){const o=osc(ac,'sine',e.f*ratio,t,t+ring*life+.01),a=ac.createGain();strike(a.gain,t,level,.004,ring*life);o.connect(a);a.connect(amp);}
  return end;
 },
 // A felt piano: soft hammer, quick fall, long quiet ring, darker as it fades.
 piano(ac,S,R,e,t,amp){
  const hold=Math.max(e.d,.05),ringing=clamp(2.5*(220/e.f)**.35,.8,5),r=e.r??.5,end=gate(amp.gain,t,hold,e.g*.6,.006,ringing,.12,r),top=clamp(e.f*7,500,7000),f=lowpass(ac,top,.5);
  f.frequency.setValueAtTime(top,t);f.frequency.exponentialRampToValueAtTime(clamp(e.f*2.2,300,3000),t+.7);
  for(const c of [-2.5,2.5]){const o=osc(ac,S.waves.soft,e.f,t,end,c);o.connect(f);}
  f.connect(amp);return end;
 },
 pluck(ac,S,R,e,t,amp){
  const life=Math.max(.12,e.d+(e.r??.25)),end=strike(amp.gain,t,e.g*.75,.004,life),top=clamp(e.f*(4+12*(e.b??.5)),400,14000),f=lowpass(ac,top,3.5);
  f.frequency.setValueAtTime(top,t);f.frequency.exponentialRampToValueAtTime(clamp(e.f*1.5,150,4000),t+Math.min(life,.28));
  osc(ac,e.reed?'square':'sawtooth',e.f,t,end).connect(f);f.connect(amp);return end;
 },
 bass(ac,S,R,e,t,amp){
  const end=gate(amp.gain,t,e.d,e.g,.008,.3,.7,e.r??.12),top=clamp(180+2200*(e.b??.4),120,4000),f=lowpass(ac,top,1.4),h=ac.createGain();
  f.frequency.setValueAtTime(top,t);f.frequency.exponentialRampToValueAtTime(top*.4,t+.18);h.gain.value=.5;
  osc(ac,'sawtooth',e.f,t,end).connect(h);h.connect(f);f.connect(amp);osc(ac,'sine',e.f,t,end).connect(amp);return end;
 },
 lead(ac,S,R,e,t,amp){
  const end=gate(amp.gain,t,e.d,e.g*.95,e.a??.015,.4,.75,e.r??.4),f=lowpass(ac,clamp(e.f*(3+8*(e.b??.5)),600,11000),1.5);
  for(const c of R.lite?[-4,4]:[-5,0,4.4])osc(ac,e.reed?'square':'sawtooth',e.f,t,end,c).connect(f);
  f.connect(amp);return end;
 },
 kick(ac,S,R,e,t,amp){
  const end=strike(amp.gain,t,e.g,.002,.32),o=ac.createOscillator();o.frequency.setValueAtTime(e.f*3,t);o.frequency.exponentialRampToValueAtTime(e.f,t+.09);o.start(t);o.stop(end);o.connect(amp);
  if(e.duck)R.duckAt(t,e.duck,.5);return end;
 },
 snare(ac,S,R,e,t,amp){
  const end=strike(amp.gain,t,e.g,.002,.17),n=ac.createBufferSource(),f=ac.createBiquadFilter(),tone=osc(ac,'triangle',e.f,t,t+.09),h=ac.createGain();
  n.buffer=S.noise;n.loop=true;f.type='highpass';f.frequency.value=1500;n.connect(f);f.connect(amp);n.start(t,(t*7.3)%1.5);n.stop(end);strike(h.gain,t,.6,.002,.07);tone.connect(h);h.connect(amp);return end;
 },
 clap(ac,S,R,e,t,amp){
  const end=t+.22,n=ac.createBufferSource(),f=ac.createBiquadFilter();n.buffer=S.noise;n.loop=true;f.type='bandpass';f.frequency.value=1300;f.Q.value=.9;n.connect(f);f.connect(amp);n.start(t,(t*3.1)%1.5);n.stop(end);
  const p=amp.gain;p.setValueAtTime(0,t);for(let i=0;i<3;i++){p.linearRampToValueAtTime(e.g*2.2,t+i*.012+.002);p.linearRampToValueAtTime(e.g*.45,t+i*.012+.011);}p.exponentialRampToValueAtTime(e.g*.001,end);return end;
 },
 hat(ac,S,R,e,t,amp){
  const end=strike(amp.gain,t,e.g,.001,Math.max(.03,e.d)),n=ac.createBufferSource(),f=ac.createBiquadFilter();n.buffer=S.noise;n.loop=true;f.type='highpass';f.frequency.value=e.f;n.connect(f);f.connect(amp);n.start(t,(t*5.7)%1.5);n.stop(end);return end;
 },
 tom(ac,S,R,e,t,amp){
  const end=strike(amp.gain,t,e.g,.003,e.r??.5),o=ac.createOscillator();o.frequency.setValueAtTime(e.f*1.7,t);o.frequency.exponentialRampToValueAtTime(e.f,t+.12);o.start(t);o.stop(end);o.connect(amp);return end;
 },
 // Struck metal: two square waves in no simple relation, through a narrow band.
 metal(ac,S,R,e,t,amp){
  const end=strike(amp.gain,t,e.g*1.1,.002,e.r??2),f=ac.createBiquadFilter();f.type='bandpass';f.frequency.value=clamp(e.f*3.1,300,9000);f.Q.value=2.5;
  osc(ac,'square',e.f,t,end).connect(f);osc(ac,'square',e.f*1.483,t,end).connect(f);f.connect(amp);return end;
 },
 // One tone of an endless glissando: its pitch slides the whole way while its loudness follows a bell curve, so it enters
 // and leaves unheard. `ph`..`ph2` is the part of the curve this note covers.
 glide(ac,S,R,e,t,amp){
  const end=t+e.d,o=osc(ac,e.wave==='glottal'?S.waves.glottal:'sine',e.f,t,end+.02),from=e.ph||0,to=e.ph2??1,curve=new Float32Array(33);
  for(let i=0;i<33;i++){const u=i/32,p=from+(to-from)*u;curve[i]=e.g*(.5-.5*Math.cos(2*Math.PI*p))*(e.swell?.3+.7*u:1)*Math.min(1,u*12)*(to<1?Math.min(1,(1-u)*10):1);}
  o.frequency.setValueAtTime(e.f,t);o.frequency.exponentialRampToValueAtTime(e.f2,end);amp.gain.setValueCurveAtTime(curve,t,e.d);o.connect(amp);return end+.02;
 },
 cloud(ac,S,R,e,t,amp){
  if(!R.cloud)return t;
  const end=swell(amp.gain,t,e.d,e.g,e.a??e.d*.4,e.r??3),n=ac.createBufferSource(),f=ac.createBiquadFilter();n.buffer=R.cloud;n.loop=true;f.type='bandpass';f.frequency.value=e.f;f.Q.value=.5;n.connect(f);f.connect(amp);n.start(t,(t*.37)%3);n.stop(end);return end;
 },
 // Wind: noise through a band that moves.
 wind(ac,S,R,e,t,amp){
  const end=swell(amp.gain,t,e.d,e.g,e.a??e.d*.6,e.r??1),n=ac.createBufferSource(),f=ac.createBiquadFilter();n.buffer=S.noise;n.loop=true;f.type='bandpass';f.Q.value=1.1;
  f.frequency.setValueAtTime(e.f,t);f.frequency.exponentialRampToValueAtTime(e.f2||e.f,t+e.d);n.connect(f);f.connect(amp);n.start(t,(t*1.9)%1.5);n.stop(end);return end;
 },
};
// What a voice costs against the budget (roughly its oscillators).
const COST={partial:1,sub:1,pad:2,choir:1,glass:1,string:2,bell:1.5,gong:4,piano:2,pluck:1,bass:1.5,lead:2.5,kick:.7,snare:1.2,clap:.8,hat:.6,tom:.7,metal:1.5,glide:1,cloud:1,wind:1};
// In the light profile the pad and the lead have two oscillators, not three.
const LIGHT_COST={pad:1.5,lead:1.8};
export const voiceCost=(e,lite)=>(lite&&LIGHT_COST[e.v])||COST[e.v]||1;
// Build one note at time `t` on a rack. Returns its record for the engine's sweep: {start, end, cost, pri, tails, mods}.
export function spawn(ac,S,R,e,t){
 const build=VOICES[e.v];if(!build||!(e.g>0)||!(e.f>0))return null;
 let bus=e.bus;if(e.v==='choir'&&!(bus==='choirA'||bus==='choirB'))bus='choirA';
 const dest=R.in[bus]||(bus==='choirA'||bus==='choirB'?R.in.wet:R.in.mid),amp=ac.createGain();amp.gain.value=0;let tail=amp;
 if(e.pan&&bus!=='bass'){const p=ac.createStereoPanner();p.pan.value=clamp(e.pan,-1,1);amp.connect(p);tail=p;}
 tail.connect(dest);
 const V={start:t,end:t,cost:voiceCost(e,R.lite),pri:e.pri||1,tails:[tail],mods:null};
 V.end=build(ac,S,R,e,t,amp,V)+.05;
 return V;
}
// Let go of a finished note: its last node leaves the bus, shared vibrato lets go of its pitch.
export function release(V){for(const n of V.tails){try{n.disconnect();}catch{}}if(V.mods)for(let i=0;i<V.mods.length;i+=2){try{V.mods[i].disconnect(V.mods[i+1]);}catch{}}}

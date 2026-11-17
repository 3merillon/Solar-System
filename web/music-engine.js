// The engine: decks of composed bars, scheduled a little ahead on the audio clock.
// A deck is one piece with its own rack of effects. Changing piece starts a new deck on the old one's bar line and
// crossfades the two at equal power (or lets the old one go first, when their keys do not go together). One timer drives everything; it does nothing unless the context is running, so a
// suspended, interrupted or closed context costs nothing and cannot spin. Finished voices are let go by one sweep.
import {composeBar,composeAccent} from './music-composer.js';
import {shared,createRack,createMaster,spawn,release,voiceCost,prepareRoom,roomBuffer,cloudBuffer} from './music-synth.js';

const clamp=(x,lo,hi)=>x<lo?lo:x>hi?hi:x;
export function createEngine(ac,{lite=false,offline=false}={}){
 // The budget, in voice units (about an oscillator and a half each). The figures of a trip (its rush, its arrival) have an
 // allowance of their own, so an arrival does not push the new place's first notes out; it holds the rush still ringing
 // and the whole arrival at once (measured live: at 18 units the arrival's bell was dropped).
 const S=shared(ac),master=createMaster(ac),decks=[],live=[],figures=[],budget=lite?28:60,allowance=lite?14:28;
 const stats={peak:0,dropped:0,spawned:0,late:0,retimed:0,stalls:0,ticks:0,tickMs:0,maxTickMs:0,composeMs:0,bars:0};
 let energy=.4,look=.5,timer=null,volume=.24,accents=null,closed=false;
 const clouds=new WeakMap(),rooms=new Map(),turn=()=>new Promise(r=>setTimeout(r,0));
 // One convolver per kind of room for the whole engine, made the first time the room is wanted (in prepare(), in a turn
 // of its own) and fed by every deck that uses it.
 function roomInput(name){
  let r=rooms.get(name);
  if(!r){const input=ac.createGain(),conv=ac.createConvolver();conv.normalize=false;conv.buffer=roomBuffer(ac,name);input.connect(conv);conv.connect(master.input);r={input,conv};rooms.set(name,r);}
  return r.input;
 }

 const used=(t,pool=live)=>{let c=0;for(const v of pool)if(v.start<=t&&v.end>t)c+=v.cost;return c;};
 // The budget: a note that would take the deck past it is dropped, unless it is the ground (bass, pad, drone), which may
 // run over by a third; ornaments are dropped first.
 function sound(rack,e,t,pool=live,cap=budget){
  const cost=voiceCost(e,lite),now=used(t,pool),pri=e.pri||1;
  if(now+cost>cap*(pri>=3?1.3:pri===2?1:.85)){stats.dropped++;return;}
  const V=spawn(ac,S,rack,e,t);if(!V)return;
  pool.push(V);stats.spawned++;if(pool===live&&now+V.cost>stats.peak)stats.peak=now+V.cost;
 }
 // Where a deck's fader is at time t (the fades are equal-power curves; this is the same arithmetic).
 function levelAt(d,t){const f=d.fade;if(!f)return d.level;const u=clamp((t-f.start)/f.seconds,0,1);return f.up?f.from+(f.to-f.from)*Math.sin(Math.PI/2*u):f.to+(f.from-f.to)*Math.cos(Math.PI/2*u);}
 function fadeTo(d,to,at,seconds){
  const now=ac.currentTime,f=d.fade;let start=Math.max(at,now),from=d.level,cancelAt=null,setAt=null,part=null;
  if(f&&start<f.start+f.seconds){
   // The fade before this one will not have finished when this one begins.
   if(now>=f.start){
    // It is under way: stop it where it is and turn from there, now.
    from=levelAt(d,now);cancelAt=now;setAt=now;start=now+.006;
   }else{
    // It has not begun (a deck waiting for its bar line, or an offline script written all at once): keep the part of it
    // that comes before this one, then turn.
    from=levelAt(d,start);cancelAt=f.start;
    if(start-f.start>.02){part=new Float32Array(17);for(let i=0;i<17;i++)part[i]=levelAt(d,f.start+(start-f.start)*i/16);}
   }
  }else if(f)from=f.to;
  const up=to>from,curve=new Float32Array(33);
  for(let i=0;i<33;i++){const u=i/32;curve[i]=up?from+(to-from)*Math.sin(Math.PI/2*u):to+(from-to)*Math.cos(Math.PI/2*u);}
  // The deck's own output and its send into the shared room move together.
  for(const p of [d.rack.out.gain,d.rack.send.gain]){
   if(cancelAt!==null)p.cancelScheduledValues(cancelAt);
   if(setAt!==null)p.setValueAtTime(from,setAt);
   if(part)p.setValueCurveAtTime(part,f.start,start-f.start-.005);
   p.setValueCurveAtTime(curve,start,seconds);
  }
  d.fade={from,to,start,seconds,up};d.level=to;
 }
 function makeDeck(theme,at){
  const rack=createRack(ac,S,theme.fx,{lite,cloud:clouds.get(theme)||theme.cloud,room:roomInput(theme.fx.ir||'hall')});rack.out.connect(master.input);
  return {theme,rack,origin:at,bar:0,queue:[],qi:0,until:Infinity,gone:Infinity,fade:null,level:0};
 }
 // Start a piece. With one already playing, the new one enters on its next bar line (if that is near) and the two cross
 // over `fade` seconds. `when` fixes the time instead (offline renders). `dip`: the new piece begins that many seconds
 // after the old one has started to fade, for two pieces whose keys must not be heard together.
 function start(theme,{fade=6,when=null,dip=0}={}){
  const now=ac.currentTime,current=decks.find(d=>d.until===Infinity);let at=when??now+.12;
  if(when==null&&current){const len=current.theme.bar,next=current.origin+Math.ceil((now+.2-current.origin)/len)*len;if(next-now<=Math.min(3,len))at=next;}
  for(const d of decks)if(d.until===Infinity){d.until=at+fade;d.gone=at+fade+12;fadeTo(d,0,at,fade);}
  const begin=at+(current?dip:0),deck=makeDeck(theme,begin);decks.push(deck);fadeTo(deck,1,begin,current?fade:Math.min(fade,3));
  return deck;
 }
 // Fade everything out (the director's silences).
 function hush(fade=6){const now=ac.currentTime;for(const d of decks)if(d.until===Infinity){d.until=now+fade;d.gone=now+fade+12;fadeTo(d,0,now+.01,fade);}}
 // Compose and schedule everything that starts before `horizon`.
 function pump(horizon){
  for(const d of decks){
   const T=d.theme,end=Math.min(horizon,d.until);
   while(d.origin+d.bar*T.bar<end){
    const c0=offline?0:performance.now(),notes=composeBar(T,d.bar,energy),base=d.bar*T.bar;
    for(const e of notes){e.B=base+e.t;d.queue.push(e);}
    // The choir's mouths move to the next vowel over the bar.
    if(T.fx.vowelsA){const at=Math.max(d.origin+base,ac.currentTime);d.rack.vowel('choirA',T.fx.vowelsA[d.bar%T.fx.vowelsA.length],at,T.bar);d.rack.vowel('choirB',T.fx.vowelsB[d.bar%T.fx.vowelsB.length],at,T.bar);}
    d.bar++;stats.bars++;if(!offline)stats.composeMs+=performance.now()-c0;
   }
   while(d.qi<d.queue.length){
    const e=d.queue[d.qi];let t=d.origin+e.B;if(t>=horizon)break;
    d.qi++;if(t>=d.until)continue;
    // A piece on its way out keeps its ground and its main voices; its ornaments stop at once.
    if(d.until!==Infinity&&(e.pri||1)<2)continue;
    if(!offline){const now=ac.currentTime;if(t<now+.005){if(now-t>.08&&e.d<1){stats.late++;continue;}t=now+.005;stats.retimed++;}}
    sound(d.rack,e,t);
   }
   if(d.qi>96){d.queue.splice(0,d.qi);d.qi=0;}
  }
 }
 function sweep(now){
  for(const pool of [live,figures]){let w=0;for(let i=0;i<pool.length;i++){const v=pool[i];if(v.end<now)release(v);else pool[w++]=v;}pool.length=w;}
  for(let i=decks.length-1;i>=0;i--)if(decks[i].gone<now){decks[i].rack.dispose();decks.splice(i,1);}
 }
 function tick(){
  if(closed||ac.state!=='running')return;
  const t0=performance.now(),now=ac.currentTime;
  // If what is due next is already in the past, the page was held up (a long frame, a throttled timer). A little late:
  // look further ahead from now on. Very late: slide the decks forward, so the music resumes where it was, not where it
  // would have been.
  let lag=0;
  for(const d of decks){if(d.until<now)continue;const due=d.qi<d.queue.length?d.origin+d.queue[d.qi].B:d.origin+d.bar*d.theme.bar;if(now-due>lag)lag=now-due;}
  if(lag>.25){for(const d of decks)d.origin+=lag+.05;stats.stalls++;look=Math.min(1.6,look*1.5);}
  else if(lag>0)look=Math.min(1.6,look*1.25);
  else look=Math.max(.5,look*.998);
  pump(now+look);sweep(now);
  const ms=performance.now()-t0;stats.ticks++;stats.tickMs+=ms;if(ms>stats.maxTickMs)stats.maxTickMs=ms;
 }
 // Figures outside any piece (a trip's rush, an arrival) play on a small rack of their own.
 function accent(kind,{seed=1,base,hz,seconds=5,when=null}={}){
  if(!accents){accents=createRack(ac,S,{ir:'hall',wet:.55,tone:12000},{lite,room:roomInput('hall')});accents.out.gain.value=1;accents.send.gain.value=1;accents.out.connect(master.input);}
  const at=when??ac.currentTime+.06;for(const e of composeAccent(kind,seed,base,hz,seconds))sound(accents,e,at+e.t,figures,allowance);
 }
 return {
  start,hush,accent,
  // Rooms are computed in slices before the first deck that needs them; a deck is only started once its room exists.
  // Everything heavy is made here, each part in its own turn of the event loop, so that starting the deck afterwards is
  // only making its nodes: the room's impulse response (in slices), its audio buffer, its convolver (once per kind of
  // room for the whole session), the piece's cloud of grains.
  async prepare(theme){
   await prepareRoom(theme.fx.ir||'hall',ac.sampleRate);await prepareRoom('hall',ac.sampleRate);
   await turn();roomBuffer(ac,theme.fx.ir||'hall');roomBuffer(ac,'hall');
   await turn();roomInput(theme.fx.ir||'hall');await turn();roomInput('hall');
   if(theme.cloud&&!lite&&!clouds.has(theme)){await turn();clouds.set(theme,cloudBuffer(ac,theme.cloud));}
   await turn();
  },
  run(){if(closed||timer)return;timer=setInterval(tick,100);tick();},
  halt(){clearInterval(timer);timer=null;},
  get running(){return !!timer;},
  setVolume(v,seconds=.12){volume=v;master.volume.gain.setTargetAtTime(v*2.5,ac.currentTime,seconds);},
  // Fade the whole output (pause, hidden tab) without touching the decks.
  mute(seconds=.15){master.volume.gain.setTargetAtTime(0,ac.currentTime,seconds/3);},
  unmute(seconds=.4){master.volume.gain.setTargetAtTime(volume*2.5,ac.currentTime,seconds/3);},
  // Energy opens and closes the composer's busier layers, and brightens or darkens what is sounding (a slow turn of each
  // deck's tone filter). Offline renders keep the tone as written.
  setEnergy(e){e=clamp(e,0,1);if(Math.abs(e-energy)<.02)return;energy=e;if(!offline&&ac.state==='running')for(const d of decks)d.rack.tone.frequency.setTargetAtTime(clamp((d.theme.fx.tone||14000)*(.7+.6*e),1500,18000),ac.currentTime,1.5);},
  get current(){return decks.find(d=>d.until===Infinity)||null;},
  report(){const now=ac.currentTime,d=decks.find(x=>x.until===Infinity);return {state:ac.state,running:!!timer,label:d?d.theme.label:'',mood:d?d.theme.mood:'',bar:d?Math.max(0,Math.floor((now-d.origin)/d.theme.bar)):0,length:d?d.theme.length:0,
   decks:decks.length,voices:used(now),figures:used(now,figures),budget,energy,look,...stats};},
  // Everything up to `seconds`, at once, for an OfflineAudioContext: the same decks, composer and voices as live.
  // script: [{at, theme, fade}] and [{at, accent, base, hz, seconds, seed}].
  render(script,seconds,vol=.24){
   master.volume.gain.value=vol*2.5;
   for(const s of script){if(s.theme)start(s.theme,{when:s.at,fade:s.fade??6,dip:s.dip||0});else if(s.accent)accent(s.accent,{...s,when:s.at});else if(s.hush)for(const d of decks)if(d.until===Infinity){d.until=s.at+s.hush;fadeTo(d,0,s.at,s.hush);}}
   // In steps of a second across all decks, so the voice count sees notes in time order; nothing is released (it has not played yet).
   for(let h=1;h<=seconds+1;h++){pump(Math.min(h,seconds));let w=0;for(let i=0;i<live.length;i++)if(live[i].end>h-3)live[w++]=live[i];live.length=w;}
   return stats;
  },
  close(){closed=true;clearInterval(timer);timer=null;for(const v of live)release(v);for(const v of figures)release(v);live.length=0;figures.length=0;for(const d of decks)d.rack.dispose();decks.length=0;if(accents)accents.dispose();for(const r of rooms.values()){try{r.input.disconnect();r.conv.disconnect();}catch{}}master.close();},
 };
}

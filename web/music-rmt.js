// A stretch of a piece written out as a Relative Music Theory module: the JSON that RMT Compose (rmt.world) loads.
// The score is composed in fractions of notes, so this is a transcription, not a conversion: every frequency, start
// and length below is an expression of another note, with the same exact fractions the composer used.
// One note per chord carries the root; each root is the root before it times a fraction (a fifth, a third: the
// harmony's own step), and starts when the one before ends. The notes of a chord are fractions of their root; the rest are fractions of the BaseNote.
// Drums, noise and the endless glissando are left out: they are not notes of this kind.
// Pure: no Web Audio. Used by tools/Export-Music-RMT.mjs and by window.solarMusic.module().
import {Q,q,ONE,fold} from './music-theory.js';
import {limitOf} from './music-harmony.js';
import {composeBar,harmonyAt} from './music-composer.js';

const INSTRUMENT={piano:'piano',string:'violin',bell:'vibraphone',gong:'vibraphone',glass:'vibraphone',pad:'organ',choir:'organ',pluck:'fm-epiano',lead:'sawtooth-wave',partial:'sine-wave',sub:'sine-wave',bass:'triangle-wave',metal:'square-wave',tom:'sine-wave'};
// A colour per prime limit: 3 plain (fifths), 5 warm (thirds), 7 blue (the dominant's seventh), 11 green, 13 violet.
const COLOUR={1:'rgba(200,200,200,0.7)',3:'rgba(225,225,235,0.7)',5:'rgba(242,167,27,0.7)',7:'rgba(70,120,230,0.7)',11:'rgba(60,190,110,0.7)',13:'rgba(170,90,220,0.7)'};
const colourOf=f=>COLOUR[limitOf(f)]||'rgba(220,60,60,0.7)';
// Beats as an exact fraction: the composer's own where it has one; a plain number is taken to the nearest 1/96 of a beat.
const exact=x=>x instanceof Q?x:Q.of(Math.round(x*96),96);
const times=(what,f)=>f.eq(ONE)?what:`${what} * ${f.dsl}`;
// T: a theme from makeTheme. from, bars: the stretch. Returns {baseNote, notes}, ready for JSON.stringify.
export function toModule(T,{from=0,bars=8,energy=.5}={}){
 const notes=[],roots=new Map(),span=T.harm.span,first=Math.floor(from/span),origin=q(from*T.beats);
 let id=0,last=null;
 // The tempo as an exact fraction when the piece took it from its own note (the beating of two tones), else as it is.
 const tempo=T.tempoOf?Q.of(263,8).mul(T.tempoOf).dsl:String(+T.bpm.toFixed(4));
 for(let k=first;k*span<from+bars;k++){
  const h=harmonyAt(T,k*span),F=fold(h.root,2),start=q(k*span*T.beats).sub(origin),root={id:++id,F,start};
  notes.push({id:root.id,startTime:last?`[${last.id}].t + [${last.id}].d`:start.n===0n?'base.t':`base.t + beat(base) * ${start.dsl}`,duration:times('beat(base)',q(span*T.beats)),
   frequency:last?times(`[${last.id}].f`,F.div(last.F)):times('base.f',F),color:colourOf(last?fold(F.div(last.F),1):fold(F,1)),instrument:'sine-wave'});
  roots.set(k,root);last=root;
 }
 for(let bar=from;bar<from+bars;bar++){
  for(const e of composeBar(T,bar,energy)){
   if(!e.q||e.at===undefined||!INSTRUMENT[e.v])continue;
   const start=q(bar*T.beats).add(exact(e.at)).sub(origin),len=exact(e.len),root=e.k!==undefined?roots.get(e.k):null,note={id:++id};
   if(root){const offset=start.sub(root.start);note.startTime=offset.n===0n?`[${root.id}].t`:`[${root.id}].t + beat(base) * ${offset.dsl}`;note.frequency=times(`[${root.id}].f`,e.q.div(root.F));note.color=colourOf(fold(e.q.div(root.F),1));}
   else{note.startTime=start.n===0n?'base.t':`base.t + beat(base) * ${start.dsl}`;note.frequency=times('base.f',e.q);note.color=colourOf(fold(e.q,1));}
   note.duration=times('beat(base)',len.n>0n?len:q(1,96));note.instrument=INSTRUMENT[e.v];
   notes.push(note);
   // RMT Compose loads at most 10 000 notes a module.
   if(notes.length>=9990)return {baseNote:{frequency:'(263/8)',startTime:'0',tempo,beatsPerMeasure:String(T.beats),instrument:'sine-wave'},notes};
  }
 }
 return {baseNote:{frequency:'(263/8)',startTime:'0',tempo,beatsPerMeasure:String(T.beats),instrument:'sine-wave'},notes};
}
// The value of one of the expressions written above, as exact fractions: enough of the RMT language to check a module
// against the notes it came from (tools/Test-Music.mjs). `values` maps a note id to {f, t, d}; id 0 is the BaseNote.
export function evaluate(expression,values,beat){
 let total=null;
 for(const term of expression.split(' + ')){
  const [head,...factors]=term.split(' * ');let v;
  const ref=/^\[(\d+)\]\.([ftd])$/.exec(head);
  if(ref)v=values.get(+ref[1])[ref[2]];else if(head==='base.f')v=values.get(0).f;else if(head==='base.t')v=values.get(0).t;else if(head==='beat(base)')v=beat;else v=Q.of(head.replace(/[()]/g,''));
  for(const f of factors)v=v.mul(Q.of(f.replace(/[()]/g,'')));
  total=total?total.add(v):v;
 }
 return total;
}

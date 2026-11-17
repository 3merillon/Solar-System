// The score's arithmetic, after the owner's Relative Music Theory (rmt.world): nothing is a pitch, everything
// is a relationship. A note's frequency, start and length are exact fractions of another note's; the only number in Hz is
// the BaseNote. Fractions are kept on BigInt, so a chain of a thousand fifths is still exactly a chain of a thousand fifths.
// Pure: no Web Audio and no clock in here (tools/Test-Music.mjs runs it in Node).

const gcd=(a,b)=>{if(a<0n)a=-a;if(b<0n)b=-b;while(b){[a,b]=[b,a%b];}return a;};
const SAFE=9007199254740991n;
// An exact fraction. Immutable; every operation returns a new one in lowest terms.
export class Q{
 constructor(n,d){this.n=n;this.d=d;this.v=undefined;}
 static of(n,d=1){
  if(n instanceof Q)return n;
  if(typeof n==='string'){const [a,b='1']=n.split('/');return Q.of(BigInt(a),BigInt(b));}
  n=BigInt(n);d=BigInt(d);if(d===0n)throw Error('A fraction over zero');
  if(d<0n){n=-n;d=-d;}const g=gcd(n,d)||1n;return new Q(n/g,d/g);
 }
 mul(o){o=Q.of(o);return Q.of(this.n*o.n,this.d*o.d);}
 div(o){o=Q.of(o);return Q.of(this.n*o.d,this.d*o.n);}
 add(o){o=Q.of(o);return Q.of(this.n*o.d+o.n*this.d,this.d*o.d);}
 sub(o){o=Q.of(o);return Q.of(this.n*o.d-o.n*this.d,this.d*o.d);}
 inv(){return Q.of(this.d,this.n);}
 pow(k){let out=ONE,b=k<0?this.inv():this;for(let i=Math.abs(k);i>0;i--)out=out.mul(b);return out;}
 eq(o){o=Q.of(o);return this.n===o.n&&this.d===o.d;}
 // As a number: only for the loudspeaker and for comparisons. Large terms are scaled first so the division cannot overflow.
 get value(){
  if(this.v!==undefined)return this.v;
  const {n,d}=this,a=n<0n?-n:n;
  if(a<=SAFE&&d<=SAFE)return this.v=Number(n)/Number(d);
  const bn=a.toString(2).length,bd=d.toString(2).length,sn=Math.max(0,bn-60),sd=Math.max(0,bd-60);
  return this.v=Number(n>>BigInt(sn))/Number(d>>BigInt(sd))*2**(sn-sd);
 }
 get cents(){return 1200*Math.log2(this.value);}
 toString(){return this.d===1n?`${this.n}`:`${this.n}/${this.d}`;}
 // As the RMT expression language writes a fraction.
 get dsl(){return `(${this.n}/${this.d})`;}
}
export const q=(n,d=1)=>Q.of(n,d);
export const ONE=new Q(1n,1n),TWO=new Q(2n,1n),ZERO=new Q(0n,1n);
// A row of fractions from text: Qs('1 9/8 5/4').
export const Qs=text=>text.trim().split(/\s+/).map(s=>Q.of(s));
// Move a fraction by octaves (exactly: times or over two) until it lies in [lo, 2 lo). `lo` is a plain number.
export function fold(f,lo=1,period=TWO){let v=f.value;const p=period.value;while(v>=lo*p){f=f.div(period);v/=p;}while(v<lo){f=f.mul(period);v*=p;}return f;}
// The copy of `f`, by octaves (or by the period given), whose value is nearest `target` (a plain number).
export function near(f,target,period=TWO){return fold(f,target/Math.sqrt(period.value),period);}

// 32-bit mix of any numbers and strings (FNV-1a over the values, then an avalanche).
export function hash(...values){
 let h=2166136261;
 for(const v of values){
  if(typeof v==='string'){for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619);}}
  else{let k=Math.floor(v)|0;for(let i=0;i<4;i++){h^=k&255;h=Math.imul(h,16777619);k>>>=8;}}
  h^=0x9e;h=Math.imul(h,16777619);
 }
 h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;
 return h>>>0;
}
// mulberry32: small, fast, and good enough for music (not a sin() hash).
export function rng(seed){
 let a=seed>>>0;
 const next=()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
 next.range=(lo,hi)=>lo+(hi-lo)*next();
 next.int=(lo,hi)=>lo+Math.floor(next()*(hi-lo+1));
 next.chance=p=>next()<p;
 next.pick=list=>list[Math.floor(next()*list.length)];
 next.weighted=pairs=>{let sum=0;for(const p of pairs)sum+=p[1];let x=next()*sum;for(const p of pairs){x-=p[1];if(x<=0)return p[0];}return pairs[pairs.length-1][0];};
 next.shuffle=list=>{const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 return next;
}
// One value in [0,1) for a position, with no generator object: for per-note decisions inside a bar.
export const noise=(...v)=>hash(...v)/4294967296;
export const clamp=(x,lo,hi)=>x<lo?lo:x>hi?hi:x;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export const mod=(a,n)=>((a%n)+n)%n;

const NOTE_NAMES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
// The nearest note name of the piano for a frequency: for a reader's orientation only; nothing is tuned to it.
export function noteName(hz){const m=Math.round(69+12*Math.log2(hz/440));return NOTE_NAMES[mod(m,12)];}

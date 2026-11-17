// Estimate the fully inlined size of a Naga-emitted WGSL program: browser
// compilers (Tint -> HLSL -> DXC/FXC) inline every call, so compile time
// follows the expanded statement count, not the source bytes. Prints the
// functions contributing most expanded lines to the entry point.
//   node tools/Inline-Cost.mjs <program.wgsl> [entry] [--top n]
import {readFile} from 'node:fs/promises';
const file=process.argv[2];const src=await readFile(file,'utf8');
const top=+(process.argv[process.argv.indexOf('--top')+1]||25);
const fns=new Map();
const re=/^(?:@[^\n]*\n)*fn ([A-Za-z_][A-Za-z0-9_]*)\(/gm;let m;const starts=[];
while((m=re.exec(src)))starts.push({name:m[1],at:m.index});
for(let i=0;i<starts.length;i++){
 const s=starts[i],body=src.slice(s.at,i+1<starts.length?starts[i+1].at:src.length);
 const end=body.search(/^}/m);const text=end<0?body:body.slice(0,end+1);
 const lines=text.split('\n').filter(l=>l.trim()&&!l.trim().startsWith('//')).length;
 const calls=new Map();
 for(const c of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\(/g)){if(c[1]!==s.name)calls.set(c[1],(calls.get(c[1])||0)+1);}
 // Loops multiply nothing here: drivers usually keep loops, but unrolled
 // constant loops would; report loops separately.
 const loops=(text.match(/\bloop\s*{/g)||[]).length;
 fns.set(s.name,{lines,calls,loops,entry:/@(compute|vertex|fragment)/.test(text.slice(0,200))||/^@/.test(src.slice(Math.max(0,s.at-40),s.at).split('\n').pop())});
}
const memo=new Map();
function expanded(name,stack=new Set()){
 if(memo.has(name))return memo.get(name);const f=fns.get(name);if(!f)return 0;if(stack.has(name))return 0;stack.add(name);
 let n=f.lines;for(const [c,k] of f.calls)if(fns.has(c))n+=k*expanded(c,stack);
 stack.delete(name);memo.set(name,n);return n;
}
const entries=[...src.matchAll(/@(?:compute|vertex|fragment)[^\n]*\n(?:@[^\n]*\n)*fn ([A-Za-z0-9_]+)/g)].map(x=>x[1]);
const entry=process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:null;
for(const e of entry?[entry]:entries){
 console.log(`entry ${e}: expanded ${expanded(e)} lines (source functions ${fns.size})`);
 // contribution: number of times each function gets instantiated in the expansion, times its own lines
 const count=new Map();
 const walk=(name,mult,stack)=>{const f=fns.get(name);if(!f||stack.has(name))return;count.set(name,(count.get(name)||0)+mult);stack.add(name);for(const [c,k] of f.calls)walk(c,mult*k,stack);stack.delete(name);};
 walk(e,1,new Set());
 const rows=[...count].map(([n,k])=>({n,k,own:fns.get(n).lines,total:k*fns.get(n).lines,exp:expanded(n),loops:fns.get(n).loops})).sort((a,b)=>b.total-a.total).slice(0,top);
 for(const r of rows)console.log(`  ${r.n.padEnd(42)} x${String(r.k).padStart(5)}  own ${String(r.own).padStart(4)}  inst-lines ${String(r.total).padStart(7)}  expanded-each ${r.exp}${r.loops?' loops '+r.loops:''}`);
}

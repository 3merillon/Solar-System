// Decoder pool: N workers that decode fetched tiles and build pages. It lives in the field worker, which stays the
// scheduler, fetcher and tile LRU. Jobs wait here (not inside a decoder worker) until a worker has room, so a cancelled
// page that has not started never starts. A worker that fails is dropped and its jobs reject with name 'PoolFailed';
// the caller then falls back to doing the work itself. spawn(index) returns a Worker-like {postMessage,terminate,onmessage,onerror}.
//   to a decoder:   {op:'init',manifest} | {op:'decode',id,kind:'terrarium'|'png'|'image',mime,bytes} | {op:'build',id,kind,overlayId,page,tiles} | {op:'water',id,step,args}
//   from a decoder: {op:'decoded',id,tile} | {op:'built',id,result,ms} | {op:'watered',id,out,ms} | {op:'error',id,message}
const failure=(name,message)=>{const e=new Error(message);e.name=name;return e;};
export const poolSizeFor=cores=>Math.max(1,Math.min(4,(Number.isFinite(cores)?cores:4)-2));

export function createPool({spawn,size,manifest=null,maxDepth=2}){
 const workers=[],queue=[],inflight=new Map();
 let nextId=1,seq=0,failed=0,lastError=null,completed=0;
 const alive=()=>workers.filter(w=>w.alive);
 function drop(wk,reason){
  if(!wk.alive)return;
  wk.alive=false;failed++;lastError=String(reason);
  try{wk.w.terminate?.();}catch{}
  for(const [id,job] of inflight)if(job.wk===wk){inflight.delete(id);job.reject(failure('PoolFailed',lastError));}
  wk.busy=0;
  if(!alive().length){for(const job of queue.splice(0))job.reject(failure('PoolFailed',lastError));}
  else pump();
 }
 for(let i=0;i<size;i++){
  try{
   const wk={w:spawn(i),busy:0,sent:0,alive:true,index:i};
   wk.w.onmessage=({data})=>onMessage(wk,data);
   wk.w.onerror=e=>{e?.preventDefault?.();drop(wk,e?.message||e?.error?.message||'decoder worker error');};
   wk.w.onmessageerror=()=>drop(wk,'decoder worker message error');
   wk.w.postMessage({op:'init',manifest});
   workers.push(wk);
  }catch(e){failed++;lastError=String(e?.message||e);}
 }
 function onMessage(wk,data){
  const job=inflight.get(data?.id);if(!job)return;
  inflight.delete(data.id);wk.busy--;completed++;
  if(data.op==='error')job.reject(failure('DecodeFailed',data.message));
  else job.resolve(data);
  pump();
 }
 function pump(){
  while(queue.length){
   let wk=null;
   for(const c of workers)if(c.alive&&c.busy<maxDepth&&(!wk||c.busy<wk.busy||(c.busy===wk.busy&&c.sent<wk.sent)))wk=c;
   if(!wk)return;
   let bi=-1;
   for(let i=0;i<queue.length;i++){const q=queue[i],b=bi<0?null:queue[bi];if(!b||q.cls<b.cls||(q.cls===b.cls&&(q.priority<b.priority||(q.priority===b.priority&&q.seq<b.seq))))bi=i;}
   const job=queue.splice(bi,1)[0];
   if(job.isCancelled?.()){job.reject(failure('Cancelled','cancelled before it started'));continue;}
   job.wk=wk;wk.busy++;wk.sent++;inflight.set(job.id,job);
   try{wk.w.postMessage({...job.msg,id:job.id},job.transfer);}
   catch(e){inflight.delete(job.id);wk.busy--;job.reject(failure('PoolFailed',String(e?.message||e)));drop(wk,e?.message||e);}
  }
 }
 // cls: 0 decode and water steps (they unblock pages), 1 build. Within a class: lower priority number first, then arrival order.
 function submit(cls,priority,isCancelled,msg,transfer){
  return new Promise((resolve,reject)=>{
   if(!alive().length){reject(failure('PoolFailed',lastError||'no decoder workers'));return;}
   queue.push({id:nextId++,cls,priority,seq:seq++,isCancelled,msg,transfer,resolve,reject,wk:null});
   pump();
  });
 }
 return {
  get alive(){return alive().length;},
  // Takes ownership of bytes (transferred). Resolves to the decoded tile {width,height,heights|rgba}.
  async decode(kind,mime,bytes,{priority=0,isCancelled}={}){
   const r=await submit(0,priority,isCancelled,{op:'decode',kind,mime,bytes},[bytes]);
   return r.tile;
  },
  // Tiles are copied into the worker (the caller's LRU keeps its own). Resolves to {result,ms}.
  async build({kind,overlayId=null,page,tiles,rivers=[],opts={}},{priority=0,isCancelled}={}){
   const r=await submit(1,priority,isCancelled,{op:'build',kind,overlayId,page,tiles,rivers,opts},[]);
   return {result:r.result,ms:r.ms};
  },
  // One step of preparing a tile for water (water-steps.js). Its arguments are copied into the worker. Resolves to {out,ms}.
  async water(step,args,{priority=0,isCancelled}={}){
   const r=await submit(0,priority,isCancelled,{op:'water',step,args},[]);
   return {out:r.out,ms:r.ms};
  },
  stats:()=>({poolSize:alive().length,poolBusy:inflight.size,poolQueued:queue.length,poolFailed:failed,poolError:lastError,poolCompleted:completed}),
  close(){for(const wk of workers){wk.alive=false;try{wk.w.terminate?.();}catch{}}for(const j of queue.splice(0))j.reject(failure('PoolFailed','closed'));},
 };
}

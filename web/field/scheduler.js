// Request scheduler. The design (per-host limit, global limit, priority heap that bumps the lowest request
// when full) is credited to CesiumJS's RequestScheduler; the code is our own. Lower priority number = more urgent.
export const hostOf=url=>/^https?:\/\/([^/?#]+)/.exec(url)?.[1]||'';
// A host's budget, so that what is asked of a free service stays modest and the most useful tile goes first. What can show spends from a bucket that allows the burst of a cold view. What nothing
// on screen reads trickles in behind it, and never takes the bucket below half. A host that keeps refusing is left alone for a while with its rate and its burst halved, then asked one request at a time.
// EOX's FAQ: "our servers will automatically slow down or temporarily block sudden traffic spikes", and "spread out your requests rather than sending large batches all at once".
const REFUSALS_TO_PAUSE=3,PAUSE_FIRST_MS=4000,PAUSE_MOST_MS=30000,RATE_FLOOR=1,BURST_FLOOR=12,RECOVERY_PER_TILE=0.02,REQUEUES_WHEN_REFUSED=5,LOOK_AGAIN_MS=50;
// Binary min-heap with entry indices, so cancellation and re-prioritisation are O(log n).
function makeHeap(){
 const a=[],less=(p,q)=>p.priority<q.priority||(p.priority===q.priority&&p.seq<q.seq);
 const swap=(i,j)=>{[a[i],a[j]]=[a[j],a[i]];a[i].heapIndex=i;a[j].heapIndex=j;};
 const up=i=>{while(i>0){const p=(i-1)>>1;if(!less(a[i],a[p]))break;swap(i,p);i=p;}};
 const down=i=>{for(;;){let m=i;const l=2*i+1,r=l+1;if(l<a.length&&less(a[l],a[m]))m=l;if(r<a.length&&less(a[r],a[m]))m=r;if(m===i)break;swap(i,m);i=m;}};
 return {
  get size(){return a.length;},
  push(e){e.heapIndex=a.length;a.push(e);up(e.heapIndex);},
  pop(){const top=a[0];this.remove(top);return top;},
  remove(e){const i=e.heapIndex,last=a.pop();e.heapIndex=-1;if(last!==e){a[i]=last;last.heapIndex=i;up(i);down(last.heapIndex);}},
  fix(e){up(e.heapIndex);down(e.heapIndex);},
  worst(){let w=null;for(const e of a)if(!w||less(w,e))w=e;return w;},
 };
}
const abortError=()=>{const e=new Error('request cancelled');e.name='AbortError';return e;};
// Statuses that are final: the server answered and asking again will not help. 408 and 429 are retried.
const final=s=>s>=400&&s<500&&s!==408&&s!==429;
export function createScheduler({fetch:fetchFn=globalThis.fetch?.bind(globalThis),perHost=6,global=18,maxQueue=4096,retries=2,backoffMs=250,
 random=Math.random,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,ewma=0.3,hostLimits={},unseenRank=Infinity}={}){
 const heap=makeHeap(),hostRunning=new Map(),stat={completed:0,failed:0,cancelled:0,bumped:0,notFound:0,retried:0,bytes:0};
 let running=0,waiting=0,seq=0,bytesPerSecond=0,lastEvent=0,pumping=false,lookAgain=null;
 // One budget per limited host. A host with none is not limited here, and its failures only retry.
 const budgets=new Map(Object.entries(hostLimits).filter(([,c])=>c).map(([host,c])=>[host,{tilesPerSecond:c.tilesPerSecond,unseenPerSecond:c.unseenPerSecond,burstMost:c.burst,rate:c.tilesPerSecond,unseenRate:c.unseenPerSecond,burst:c.burst,tokens:c.burst,unseenTokens:1,last:now(),refused:0,pausedUntil:0,pause:PAUSE_FIRST_MS,probing:false,pauses:0,asked:0,refusedTiles:0}]));
 const refill=(b,t)=>{const seconds=Math.max(0,t-b.last)/1000;b.last=t;b.tokens=Math.min(b.burst,b.tokens+seconds*b.rate);b.unseenTokens=Math.min(1,b.unseenTokens+seconds*b.unseenRate);};
 // Whether this request may start now. held says why not, when the wait will not end by a request finishing.
 const held={byBudget:false};
 function mayStart(r,t){
  const b=budgets.get(r.host),busy=hostRunning.get(r.host)||0;
  if(!b)return busy<perHost;
  if(t<b.pausedUntil){held.byBudget=true;return false;}
  if(busy>=(b.probing?1:perHost))return false;
  refill(b,t);
  const allowed=r.priority>=unseenRank?b.unseenTokens>=1&&b.tokens>=b.burst*0.5:b.tokens>=1;
  if(!allowed)held.byBudget=true;
  return allowed;
 }
 const spend=r=>{const b=budgets.get(r.host);if(!b)return;b.asked++;b.tokens-=1;if(r.priority>=unseenRank)b.unseenTokens-=1;};
 const settle=(r,state)=>{r.state=state;};
 function dispatch(r){
  spend(r);
  running++;hostRunning.set(r.host,(hostRunning.get(r.host)||0)+1);
  if(running===1)lastEvent=now();
  r.state='running';r.controller=new AbortController();
  (async()=>{
   try{
    const res=await fetchFn(r.url,{signal:r.controller.signal});
    if(!res.ok){const e=new Error(`HTTP ${res.status}`);e.status=res.status;throw e;}
    const buffer=await res.arrayBuffer();
    if(r.state!=='running')return;
    // Aggregate throughput: bytes of a completed body over the time since the previous completion
    // (or since the network went from idle to busy), so overlapping fetches add up.
    const t=now(),dt=Math.max(t-lastEvent,1)/1000;lastEvent=t;
    bytesPerSecond=bytesPerSecond?bytesPerSecond*(1-ewma)+buffer.byteLength/dt*ewma:buffer.byteLength/dt;
    const b=budgets.get(r.host);
    if(b){b.refused=0;if(b.probing){b.probing=false;b.pause=Math.max(PAUSE_FIRST_MS,b.pause/2);}const recovered=RECOVERY_PER_TILE/b.tilesPerSecond;b.rate=Math.min(b.tilesPerSecond,b.rate+recovered*b.tilesPerSecond);b.unseenRate=Math.min(b.unseenPerSecond,b.unseenRate+recovered*b.unseenPerSecond);b.burst=Math.min(b.burstMost,b.burst+recovered*b.burstMost);}
    stat.bytes+=buffer.byteLength;stat.completed++;settle(r,'done');r.resolve({bytes:buffer,status:res.status,url:r.url});
   }catch(e){
    if(r.state!=='running')return; // cancelled while in flight: already rejected
    const status=e.status??0,b=budgets.get(r.host);
    if(b){
     // What a refusal looks like. Where the answer carries no CORS header, as a 403 from a rate limit may not, the browser hides the status and only a failed fetch is seen.
     if(status===0||status===403||status===429||status>=500){
      b.refused++;const t=now();
      if(t>=b.pausedUntil&&(b.probing||b.refused>=REFUSALS_TO_PAUSE)){
       b.pausedUntil=t+b.pause*(1+random()*0.25);b.pause=Math.min(PAUSE_MOST_MS,b.pause*2);b.refused=0;b.probing=true;b.pauses++;
       b.rate=Math.max(RATE_FLOOR,b.rate*0.5);b.unseenRate=Math.max(RATE_FLOOR*0.25,b.unseenRate*0.5);b.burst=Math.max(BURST_FLOOR,b.burst*0.5);b.tokens=Math.min(b.tokens,b.burst);
      }
      // While the host is left alone a tile keeps its place and spends none of its retries. A host that never comes back still fails it, in the end.
      if(t<b.pausedUntil&&r.requeued<REQUEUES_WHEN_REFUSED){r.requeued++;b.refusedTiles++;r.state='queued';heap.push(r);return;}
     }else b.refused=0;
    }
    if(!final(status)&&r.attempt<retries){
     r.attempt++;stat.retried++;r.state='waiting';waiting++;
     const delay=backoffMs*2**(r.attempt-1)*(1+random());
     r.timer=setTimer(()=>{waiting--;r.timer=null;r.state='queued';heap.push(r);pump();},delay);
    }else{if(status===404)stat.notFound++;else stat.failed++;settle(r,'failed');const err=e.name==='AbortError'?new Error('fetch aborted'):e;err.status=status;err.failed=true;r.reject(err);}
   }finally{
    running--;hostRunning.set(r.host,hostRunning.get(r.host)-1);
    if(running===0)lastEvent=now();
    pump();
   }
  })();
 }
 function pump(){
  if(pumping)return;pumping=true;
  try{
   while(running<global&&heap.size){
    const back=[];let pick=null;const t=now();
    while(heap.size){const r=heap.pop();if(mayStart(r,t)){pick=r;break;}back.push(r);}
    for(const h of back)heap.push(h);
    if(!pick)break;
    dispatch(pick);
   }
   // Held by a budget or a pause, nothing finishing need wake this, so look again shortly.
   if(held.byBudget&&heap.size&&lookAgain===null)lookAgain=setTimer(()=>{lookAgain=null;pump();},LOOK_AGAIN_MS);
   held.byBudget=false;
  }finally{pumping=false;}
 }
 // request(url,{priority,host}) -> {promise: Promise<{bytes,status}>, cancel(), setPriority(p)}
 function request(url,{priority=0,host=hostOf(url)}={}){
  const r={url,host,priority,seq:seq++,state:'queued',attempt:0,requeued:0,heapIndex:-1,timer:null,controller:null};
  const promise=new Promise((resolve,reject)=>{r.resolve=resolve;r.reject=reject;});
  heap.push(r);
  if(heap.size>maxQueue){ // full: drop the least urgent waiting request (possibly this one)
   const w=heap.worst();heap.remove(w);stat.bumped++;settle(w,'bumped');const e=new Error('bumped from a full queue');e.name='Bumped';w.reject(e);
  }
  pump();
  return {
   promise,
   cancel(){
    if(r.state==='queued'){heap.remove(r);}
    else if(r.state==='waiting'){clearTimer(r.timer);waiting--;}
    else if(r.state==='running'){r.controller.abort();}
    else return;
    stat.cancelled++;settle(r,'cancelled');r.reject(abortError());
   },
   setPriority(p){r.priority=p;if(r.state==='queued')heap.fix(r);},
   get priority(){return r.priority;},
   get state(){return r.state;},
  };
 }
 // Whether a request to this host would wait on its budget or a pause, wherever it stood in the queue.
 const stalled=host=>{const b=budgets.get(host);if(!b)return false;const t=now();if(t<b.pausedUntil||b.probing)return true;refill(b,t);return b.tokens<1;};
 // What each limited host is being asked, and whether it is being left alone, so that a lower quality is never silent.
 const stats=()=>{const t=now();return {inFlight:running,queued:heap.size+waiting,...stat,bytesPerSecond,hosts:Object.fromEntries([...budgets].map(([host,b])=>[host,{rate:b.rate,burst:Math.round(b.burst),tokens:Math.floor(b.tokens),asked:b.asked,pauses:b.pauses,refusedTiles:b.refusedTiles,pausedMs:Math.max(0,b.pausedUntil-t)}]))};};
 return {request,stats,stalled};
}

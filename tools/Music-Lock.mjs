// One headless run at a time on this machine, across sessions: the lock is a directory ($SOLAR_DATA/gpu.lock), made
// atomically, with an owner.txt saying who holds it and for how long, and removed only by the run that made it.
// If it is held, this waits and tries again every minute (up to 45), printing the holder once.
// SOLAR_DATA names the data folder, as for the other tools (default ./data): sessions that share a machine must share it.
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {rmSync} from 'node:fs';
const data=process.env.SOLAR_DATA||'data',sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function withLock(what,minutes,work){
 // A run started by a chain that already holds the lock (SOLAR_LOCK_HELD) goes straight on.
 if(process.env.SOLAR_LOCK_HELD)return work();
 const dir=data+'/gpu.lock';
 for(let waited=0;;waited++){
  try{await mkdir(dir);break;}catch(e){
   if(e.code!=='EEXIST')throw e;
   if(waited===0)console.error('Lock held by: '+(await readFile(dir+'/owner.txt','utf8').catch(()=>'(no owner.txt)')).replace(/\s+/g,' '));
   if(waited>=45)throw Error('The lock was still held after 45 minutes');
   await sleep(60000);
  }
 }
 // Whatever ends this process (an error thrown elsewhere, Ctrl-C), the lock it made goes with it.
 const drop=()=>{try{rmSync(dir,{recursive:true,force:true});}catch{}};process.once('exit',drop);process.once('SIGINT',()=>process.exit(130));
 try{await writeFile(dir+'/owner.txt',`music session\n${what}\nstarted ${new Date().toISOString()}\nexpected ${minutes} min\n`);return await work();}
 finally{process.off('exit',drop);await rm(dir,{recursive:true,force:true});}
}

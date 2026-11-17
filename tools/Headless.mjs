// Own private browser only; never attach to the owner's browser or desktop.
import {spawn} from 'node:child_process';
import {existsSync,createWriteStream} from 'node:fs';
import {readFile, mkdir, mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function headless(directory) {
  const executable = [process.env.SOLAR_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
  if (!executable) throw Error('Set SOLAR_BROWSER to a Chromium executable');
  await mkdir(directory, {recursive:true});
  // A reused profile can retain DevToolsActivePort from a finished browser.
  const profile = await mkdtemp(resolve(directory, 'profile-'));
  const log=createWriteStream(resolve(directory,'browser-events.log'),{flags:'a'});
  const browser = spawn(executable, ['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync','--disable-background-timer-throttling','--disable-renderer-backgrounding','--enable-unsafe-webgpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], {windowsHide:true,stdio:['ignore','ignore','pipe']});
  browser.stderr.on('data',data=>log.write(data));
  let launchError; browser.once('error', e => launchError=e);
  let address;
  for(let i=0;i<100;i++) {
    if(launchError) throw launchError;
    try { const [port,path]=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/); address=`ws://127.0.0.1:${Number(port)}${path}`;break; }
    catch { await new Promise(r=>setTimeout(r,200)); }
  }
  if(!address) { browser.kill();throw Error('Private browser startup timeout'); }
  const ws=new WebSocket(address);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
  let sequence=0;const pending=new Map(),listeners=new Set();
  ws.onmessage=e=>{const value=JSON.parse(e.data),p=pending.get(value.id);if(!p){for(const listener of listeners)listener(value);if(['Runtime.exceptionThrown','Runtime.consoleAPICalled','Log.entryAdded'].includes(value.method))log.write(JSON.stringify(value)+'\n');return;}pending.delete(value.id);clearTimeout(p.timer);value.error?p.no(Error(JSON.stringify(value.error))):p.ok(value.result);};
  const send=(method,params={},sessionId)=>new Promise((ok,no)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);no(Error(`${method} timeout`));},method==='Browser.close'?5000:180000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Page.bringToFront',{},sessionId);
  await send('Runtime.enable',{},sessionId);await send('Log.enable',{},sessionId);
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  return {send:(m,p)=>send(m,p,sessionId),browserSend:send,onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},evaluate,version:await send('Browser.getVersion'),close:async()=>{
    try{await send('Browser.close');}catch{}finally{ws.close();for(const p of pending.values()){clearTimeout(p.timer);p.no(Error('Browser closed'));}if(browser.exitCode===null)browser.kill();log.end();}
  }};
}

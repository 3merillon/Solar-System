// Static development server for web/. Defaults to the loopback preview on
// port 5198. `--host 0.0.0.0 --port N` serves the LAN; `--https DIR` (a
// directory holding cert.pem and key.pem) adds TLS, which WebGPU needs on any
// origin other than localhost: browsers only expose navigator.gpu in a secure
// context, so a phone on the Wi-Fi needs the https address.
// Byte ranges (one range per request) are answered with 206, as the page bundles
// of a pack are read. `--cors` adds Access-Control-Allow-Origin: * so a page on
// another origin can read the files, standing in for a pack host; a preflight is
// not answered (405), as on a plain static host.
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { readFile, readFileSync, createReadStream } from 'node:fs';
import { readFile as read, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, extname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const host = arg('host', '127.0.0.1'), port = Number(arg('port', 5198)), https = arg('https', null);
const cors = process.argv.includes('--cors') ? { 'Access-Control-Allow-Origin':'*' } : {};
// --log FILE: one line per request, epoch milliseconds and path, for counting a test's requests per second at the server.
const requestLog = arg('log', null) ? (await import('node:fs')).createWriteStream(arg('log', null), { flags:'a' }) : null;
// --root DIR serves an immutable snapshot, so a measurement cannot be invalidated by a later edit of web/.
const root = arg('root', null) ? resolve(arg('root', null)) : fileURLToPath(new URL('../web/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.wasm':'application/wasm', '.glb':'model/gltf-binary', '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
// Explicit q=0 wins over wildcard; identity is acceptable unless explicitly refused.
export function encodings(header='') {
 const q=new Map(header.toLowerCase().split(',').filter(Boolean).map(part=>{const [name,...params]=part.trim().split(';');const v=params.find(p=>p.trim().startsWith('q='));return [name.trim(),v?Math.max(0,Math.min(1,Number(v.trim().slice(2))||0)):1];}));
 const quality=e=>q.get(e)??(e==='identity'?1:(q.get('*')??0));
 return ['br','gzip','identity'].filter(e=>quality(e)>0).sort((a,b)=>quality(b)-quality(a));
}
async function handle(request, response) {
  try {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    requestLog?.write(`${Date.now()} ${path}${request.headers.range ? ' ' + request.headers.range : ''}\n`);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    const child = relative(root, file);
    if (child.startsWith('..') || isAbsolute(child)) { response.writeHead(403).end(); return; }
    if (request.headers.range && await sendRange(request, response, file)) return;
    let bytes,encoding;
    for(const candidate of encodings(request.headers['accept-encoding'])) {
      try { bytes=await read(file+(candidate==='br'?'.br':candidate==='gzip'?'.gz':''));encoding=candidate;break; } catch {}
    }
    if(!bytes){try{await read(file);}catch{response.writeHead(404,cors).end('Not found.');return;}response.writeHead(406,cors).end('No acceptable encoding');return;}
    response.writeHead(200, { 'Content-Type':types[extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store', 'Content-Length':bytes.length, 'Vary':'Accept-Encoding', ...cors, ...(encoding!=='identity'?{'Content-Encoding':encoding}:{'Accept-Ranges':'bytes'}) });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404,cors).end('Not found. Build the web package first.'); }
}
// One range of the file as stored (no transport encoding). Returns false to serve the whole file instead,
// as RFC 9110 allows for a Range header this server does not take (several ranges, another unit).
async function sendRange(request, response, file) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range.trim());
  if (!m || (m[1] === '' && m[2] === '')) return false;
  let size;
  try { const s = await stat(file); if (!s.isFile()) return false; size = s.size; } catch { return false; }
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2])); }
  if (start >= size || end < start) { response.writeHead(416, { 'Content-Range':`bytes */${size}`, ...cors }).end(); return true; }
  response.writeHead(206, { 'Content-Type':types[extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store', 'Accept-Ranges':'bytes', 'Content-Range':`bytes ${start}-${end}/${size}`, 'Content-Length':end - start + 1, ...cors });
  if (request.method === 'HEAD') { response.end(); return true; }
  createReadStream(file, { start, end }).on('error', () => response.destroy()).pipe(response);
  return true;
}
const banner = () => console.log(`Solar-System v2 probe: ${https ? 'https' : 'http'}://${host === '0.0.0.0' ? '<lan-address>' : host}:${port}`);
if (!https) { createServer(handle).listen(port, host, banner); }
else {
  // One port for both: a TLS record starts with 0x16, so plain-http requests
  // (an address typed without https://) are answered with a redirect instead
  // of a dropped connection (ERR_EMPTY_RESPONSE on the phone).
  const secure = createSecureServer({ cert: readFileSync(resolve(https, 'cert.pem')), key: readFileSync(resolve(https, 'key.pem')) }, handle);
  const plain = createServer((request, response) => { response.writeHead(301, { Location: `https://${request.headers.host ?? 'localhost'}${request.url}` }); response.end(); });
  createNetServer(socket => {
    socket.once('data', chunk => { socket.pause(); socket.unshift(chunk); (chunk[0] === 0x16 ? secure : plain).emit('connection', socket); process.nextTick(() => socket.resume()); });
    socket.on('error', () => {});
  }).listen(port, host, banner);
}
void readFile;

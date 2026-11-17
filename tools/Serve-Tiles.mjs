// Recording and replay server for public map tile services, so that load, motion and
// timing tests of a browser renderer replay recorded tiles instead of stressing live services.
//
//   node tools/Serve-Tiles.mjs --replay DIR [--port 5200] [--host 127.0.0.1] [--web web/]
//   node tools/Serve-Tiles.mjs --record DIR --allow-hosts a.example,b.example --max-requests N
//        [--max-concurrency 4 (clamped to 8)] [--max-bytes 2147483648]
//   Injection (applies to /proxy/ only): --bandwidth-mbit N --latency-ms N --jitter-ms J
//        --fail-rate P [--fail-hosts a,b] --notfound-rate P --seed S --abort-tracking
//        --limit-hosts a,b --limit-rate N --limit-burst N [--limit-block-s S]: a rate limit as a real host answers one, 403 with no CORS header, so that a browser sees only a failed fetch
//   Control: GET /__stats, GET /__control?bandwidth=&latency=&jitter=&fail=&notfound=&seed=, GET /__reset
//   --request-log keeps every /proxy/ request since the last reset, for GET /__requests: {t, ms, host, path, bytes, status}, t in ms from the reset.
//
// The browser rewrites https://HOST/PATH?QUERY to http://127.0.0.1:PORT/proxy/HOST/PATH?QUERY.
// Storage key: DIR/HOST/ab/SHA.{bin,json}, SHA = sha256 hex of the request target "/PATH?QUERY"
// (leading slash included, exactly as sent), ab = its first two characters. A ':' in HOST (a port)
// is stored as '_' because Windows forbids it in directory names.
// --upstream-scheme exists only for the self-test (its stub upstream speaks plain http); real use is https.
// Fully served responses are stored whole: 200/404/410 are recorded; 5xx, redirects and other
// statuses are passed through to the client, never stored and never retried.
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const has = k => process.argv.includes('--' + k);
const usage = m => { console.error((m ? m + '\n' : '') + 'Usage: Serve-Tiles.mjs (--replay DIR | --record DIR --allow-hosts h1,h2 --max-requests N) [--port 5200] [--host 127.0.0.1] [--web DIR]\n  [--max-concurrency 4] [--max-bytes 2147483648] [--bandwidth-mbit N] [--latency-ms N] [--jitter-ms J] [--fail-rate P] [--fail-hosts h] [--notfound-rate P] [--seed S] [--abort-tracking]'); process.exit(2); };

const replayDir = arg('replay', null), recordDir = arg('record', null);
if (!replayDir && !recordDir) usage('Choose --replay DIR or --record DIR.');
if (replayDir && recordDir) usage('--replay and --record are mutually exclusive.');
const record = !!recordDir, dir = resolve(record ? recordDir : replayDir);
const list = s => (s ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const num = (v, d) => { const n = Number(v ?? d); if (!Number.isFinite(n)) usage(`Not a number: ${v}`); return n; };
const cfg = {
  mode: record ? 'record' : 'replay', dir, host: arg('host', '127.0.0.1'), port: num(arg('port'), 5200),
  bandwidthMbit: num(arg('bandwidth-mbit'), 0), latencyMs: num(arg('latency-ms'), 0), jitterMs: num(arg('jitter-ms'), 0),
  failRate: num(arg('fail-rate'), 0), failHosts: list(arg('fail-hosts')), notFoundRate: num(arg('notfound-rate'), 0),
  limitHosts: list(arg('limit-hosts')), limitRate: num(arg('limit-rate'), 0), limitBurst: num(arg('limit-burst'), 0), limitBlockS: num(arg('limit-block-s'), 0),
  seed: String(arg('seed', '1')), abortTracking: has('abort-tracking'), upstreamScheme: arg('upstream-scheme', 'https'),
  allowHosts: list(arg('allow-hosts')), maxConcurrency: 4, maxRequests: 0, maxBytes: 0,
};
if (record) {
  if (!cfg.allowHosts.length) usage('--record requires --allow-hosts.');
  if (arg('max-requests') === undefined) usage('--record requires --max-requests (hard budget of upstream fetches).');
  cfg.maxRequests = Math.max(0, Math.floor(num(arg('max-requests'))));
  cfg.maxBytes = num(arg('max-bytes'), 2 * 1024 ** 3);
  const want = Math.floor(num(arg('max-concurrency'), 4));
  cfg.maxConcurrency = Math.min(8, Math.max(1, want));
  if (cfg.maxConcurrency !== want) console.log(`--max-concurrency ${want} clamped to ${cfg.maxConcurrency} (limit 8, minimum 1)`);
}
if (!['http', 'https'].includes(cfg.upstreamScheme)) usage('--upstream-scheme must be http or https.');
const webRoot = resolve(arg('web', fileURLToPath(new URL('../web/', import.meta.url))));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.wasm':'application/wasm', '.bin':'application/octet-stream', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg' };

// ---- statistics -------------------------------------------------------------------------
const EDGES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const newStats = () => ({ requests:0, served:0, bytes:0, status:{}, misses:0, injected404:0, injected503:0, droppedConnections:0, aborted:0, blockedHosts:0, refusedBudget:0, upstreamErrors:0, staticRequests:0, peakInFlight:0, upstreamFetches:0, upstreamBytes:0, hosts:{}, ttlb:{} });
let stats = newStats(), inFlight = 0, requestLog = [], logStart = performance.now();
const keepLog = has('request-log');
const attempts = new Map();
const hostStat = h => stats.hosts[h] ??= { requests: 0, bytes: 0 };
const bucket = ms => { const e = EDGES.find(x => ms <= x); return e === undefined ? '>10000ms' : `<=${e}ms`; };
const snapshot = () => ({ mode: cfg.mode, config: cfg, ...stats, inFlight, upstreamBudgetLeft: record ? { requests: cfg.maxRequests - stats.upstreamFetches, bytes: cfg.maxBytes - stats.upstreamBytes } : undefined });

// ---- deterministic randomness, throttle ----------------------------------------------
const u = (...parts) => createHash('sha256').update(parts.join('\0')).digest().readUInt32BE(0) / 4294967296;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BURST = 32 * 1024, CHUNK = 16 * 1024;
let tokens = BURST, last = performance.now();
// One bucket shared by every response; a caller reserves its bytes (the balance may go negative) and sleeps off the debt.
async function take(n) {
  if (!(cfg.bandwidthMbit > 0)) return;
  const rate = cfg.bandwidthMbit * 125000, now = performance.now();
  // Timers on Windows wake about 15 ms late. A burst smaller than that much traffic throws the
  // credit away and caps a fast link far below its setting, so the burst scales with the rate.
  tokens = Math.min(Math.max(BURST, rate * 0.03), tokens + (now - last) / 1000 * rate); last = now; tokens -= n;
  if (tokens < 0) await sleep(-tokens / rate * 1000);
}
const drained = res => new Promise(r => { const f = () => { res.off('drain', f); res.off('close', f); r(); }; res.on('drain', f); res.on('close', f); });

// ---- storage ------------------------------------------------------------------------------
const hostDir = h => h.replace(/:/g, '_');
const base = (h, pq) => { const sha = createHash('sha256').update(pq).digest('hex'); return { sha, path: join(dir, hostDir(h), sha.slice(0, 2), sha) }; };
async function lookup(h, pq) {
  const b = base(h, pq);
  try { const meta = JSON.parse(await readFile(b.path + '.json', 'utf8')); return { ...meta, body: await readFile(b.path + '.bin') }; }
  catch { return null; }
}
let tmpSeq = 0;
async function atomic(file, data) { const t = `${file}.tmp-${process.pid}-${tmpSeq++}`; await writeFile(t, data); await rename(t, file); }
async function store(h, pq, status, contentType, body) {
  const b = base(h, pq); await mkdir(join(b.path, '..'), { recursive: true });
  const meta = { url: `${cfg.upstreamScheme}://${h}${pq}`, status, contentType, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), recordedUtc: new Date().toISOString() };
  await atomic(b.path + '.bin', body); await atomic(b.path + '.json', JSON.stringify(meta));   // json last: it marks the entry complete
  return { ...meta, body };
}

// ---- recorder ---------------------------------------------------------------------------
let active = 0; const waiters = []; const pending = new Map(); let warned = false;
const acquire = async () => { if (active >= cfg.maxConcurrency) await new Promise(r => waiters.push(r)); active++; };
const release = () => { active--; waiters.shift()?.(); };
const loud = m => { if (!warned) { warned = true; console.error(`!!! RECORDER BUDGET REACHED: ${m}. Further missing keys return 429.`); } };
function upstreamGet(h, pq) {
  return new Promise((ok, bad) => {
    const mod = cfg.upstreamScheme === 'https' ? { request: httpsRequest } : { request: httpRequest };
    const [hostname, p] = h.split(':');
    const r = mod.request({ hostname, port: p ? Number(p) : undefined, path: pq, method: 'GET', agent: false, timeout: 30000, headers: { 'User-Agent': 'solar-system-v2-fixture-recorder (private test fixture; low volume)', Accept: '*/*', Connection: 'close' } }, ok);
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', bad); r.end();
  });
}
async function fetchUpstream(h, pq) {
  if (stats.upstreamFetches >= cfg.maxRequests) { loud(`--max-requests ${cfg.maxRequests} used`); return { refuse: 429, why: 'refused-budget' }; }
  if (stats.upstreamBytes >= cfg.maxBytes) { loud(`--max-bytes ${cfg.maxBytes} used`); return { refuse: 429, why: 'refused-budget' }; }
  stats.upstreamFetches++;                                   // reserved before queueing so the budget is hard
  await acquire();
  try {
    const res = await upstreamGet(h, pq), parts = []; let over = false;
    for await (const c of res) { stats.upstreamBytes += c.length; parts.push(c); if (stats.upstreamBytes > cfg.maxBytes) { over = true; res.destroy(); break; } }
    if (over) { loud(`--max-bytes ${cfg.maxBytes} exceeded`); return { refuse: 429, why: 'refused-budget' }; }
    const body = Buffer.concat(parts), st = res.statusCode, ct = res.headers['content-type'] ?? 'application/octet-stream';
    if (st === 200 || st === 404 || st === 410) return { entry: { ...(await store(h, pq, st, ct, body)), fresh: true } };
    stats.upstreamErrors++;
    return { passthrough: st, body, ct };                    // 5xx, 3xx, other 4xx: not stored, not retried
  } catch (e) { stats.upstreamErrors++; return { refuse: 502, why: 'upstream-error', text: String(e.message) }; }
  finally { release(); }
}
const resolveEntry = async (h, pq) => {
  const hit = await lookup(h, pq); if (hit) return { entry: hit };
  if (!record) { stats.misses++; return { refuse: 404, why: 'miss' }; }
  const key = h + pq; if (!pending.has(key)) pending.set(key, fetchUpstream(h, pq).finally(() => pending.delete(key)));
  return pending.get(key);
};

// ---- responses ---------------------------------------------------------------------------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'x-solar-fixture, Content-Range, Content-Length, Accept-Ranges, Content-Type', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, Content-Type' };
function parseRange(h, len) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((h ?? '').trim()); if (!m || (m[1] === '' && m[2] === '')) return null;   // absent, multi-range or malformed: serve whole body
  let s, e;
  if (m[1] === '') { const n = Number(m[2]); if (n === 0 || len === 0) return 'bad'; s = Math.max(0, len - n); e = len - 1; }
  else { s = Number(m[1]); e = m[2] === '' ? len - 1 : Math.min(Number(m[2]), len - 1); if (m[2] !== '' && Number(m[2]) < s) return null; if (s >= len) return 'bad'; }
  return { s, e };
}
async function proxy(req, res) {
  stats.requests++;
  const rest = req.url.slice('/proxy/'.length), slash = rest.indexOf('/');
  const h = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase(), pq = slash < 0 ? '/' : rest.slice(slash);
  const t0 = performance.now(); let closed = false, left = false, killed = false, sent = 0;
  const hs = hostStat(h); hs.requests++;
  inFlight++; stats.peakInFlight = Math.max(stats.peakInFlight, inFlight);
  const leave = () => { if (!left) { left = true; inFlight--; } };
  res.on('error', () => {});
  res.on('close', () => { closed = true; if (!left) { if (cfg.abortTracking && !killed && !res.writableFinished) stats.aborted++; leave(); } });
  const dead = () => cfg.abortTracking && closed;
  const end = () => { stats.served++; const ms = performance.now() - t0; const b = bucket(ms); stats.ttlb[b] = (stats.ttlb[b] ?? 0) + 1; if (keepLog) requestLog.push({ t: t0 - logStart, ms, host: h, path: pq, bytes: sent, status: res.statusCode }); leave(); };
  const head = (status, extra, fixture) => { stats.status[status] = (stats.status[status] ?? 0) + 1; res.writeHead(status, { ...CORS, 'Cache-Control': 'no-store', 'x-solar-fixture': fixture, ...extra }); };
  const small = (status, fixture, text = fixture) => { head(status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) }, fixture); res.end(req.method === 'HEAD' ? undefined : text); end(); };
  async function body(buf) {
    if (req.method === 'HEAD') { res.end(); return end(); }
    for (let o = 0; o < buf.length;) {
      const n = Math.min(buf.length - o, cfg.bandwidthMbit > 0 ? CHUNK : 262144);
      await take(n); if (dead()) return; if (closed) { o += n; continue; }   // untracked aborts keep consuming bandwidth
      const ok = res.write(buf.subarray(o, o + n)); o += n; sent += n; stats.bytes += n; hs.bytes += n;
      if (!ok) await drained(res); if (dead()) return;
    }
    res.end(); end();
  }
  try {
    if (!/^[a-z0-9._:\[\]-]+$/.test(h) || h.includes('..')) return small(400, 'bad-host');
    const delay = Math.max(0, cfg.latencyMs + (cfg.jitterMs > 0 ? (u('lat', cfg.seed, h + pq) * 2 - 1) * cfg.jitterMs : 0));
    if (delay > 0) await sleep(delay);
    if (dead()) return;
    const key = h + pq;
    if (cfg.limitHosts.includes(h) && !withinLimit(h)) { stats.refusedByLimit = (stats.refusedByLimit ?? 0) + 1; stats.status[403] = (stats.status[403] ?? 0) + 1; res.writeHead(403, { 'Content-Type': 'text/html', 'Content-Length': 9 }); res.end('forbidden'); return end(); }
    if (cfg.notFoundRate > 0 && u('nf', cfg.seed, key) < cfg.notFoundRate) { stats.injected404++; return small(404, 'injected-404'); }
    let drop = false;
    if (cfg.failRate > 0 && (!cfg.failHosts.length || cfg.failHosts.includes(h))) {
      const a = attempts.get(key) ?? 0; attempts.set(key, a + 1);
      if (u('fail', cfg.seed, key, a) < cfg.failRate) { if (u('kind', cfg.seed, key, a) < 0.5) { stats.injected503++; return small(503, 'injected-503'); } drop = true; }
    }
    if (record && !cfg.allowHosts.includes(h)) { stats.blockedHosts++; return small(403, 'blocked-host', `host ${h} is not in --allow-hosts`); }
    const r = await resolveEntry(h, pq);
    if (dead()) return;
    if (r.refuse) { if (r.why === 'refused-budget') stats.refusedBudget++; return small(r.refuse, r.why, r.text ?? r.why); }
    if (r.passthrough) { head(r.passthrough, { 'Content-Type': r.ct, 'Content-Length': r.body.length }, 'upstream-error'); res.end(req.method === 'HEAD' ? undefined : r.body); return end(); }
    const e = r.entry, fixture = e.fresh ? 'recorded' : 'hit', ct = e.contentType ?? 'application/octet-stream';
    if (drop) {
      stats.droppedConnections++; killed = true;
      res.writeHead(e.status, { ...CORS, 'Content-Type': ct, 'Content-Length': e.body.length, 'x-solar-fixture': 'injected-drop' });
      return res.write(e.body.subarray(0, Math.max(1, e.body.length >> 1)), () => { res.destroy(); leave(); });
    }
    const rg = e.status === 200 ? parseRange(req.headers.range, e.body.length) : null;
    if (rg === 'bad') { head(416, { 'Content-Range': `bytes */${e.body.length}`, 'Content-Length': 0 }, fixture); res.end(); return end(); }
    if (rg) { const part = e.body.subarray(rg.s, rg.e + 1); head(206, { 'Content-Type': ct, 'Content-Length': part.length, 'Content-Range': `bytes ${rg.s}-${rg.e}/${e.body.length}`, 'Accept-Ranges': 'bytes' }, fixture); return await body(part); }
    head(e.status, { 'Content-Type': ct, 'Content-Length': e.body.length, 'Accept-Ranges': 'bytes' }, fixture);
    await body(e.body);
  } catch (err) { console.error('proxy error', err); if (!res.headersSent) { try { small(500, 'server-error', String(err.message)); } catch {} } else res.destroy(); leave(); }
}
// A token bucket per limited host. Past it every request is refused, and with a block time, every request for that long.
const limitBuckets = new Map();
function withinLimit(h) {
  const t = performance.now(); let b = limitBuckets.get(h);
  if (!b) { b = { tokens: cfg.limitBurst, last: t, blockedUntil: 0 }; limitBuckets.set(h, b); }
  b.tokens = Math.min(cfg.limitBurst, b.tokens + (t - b.last) / 1000 * cfg.limitRate); b.last = t;
  if (t < b.blockedUntil) return false;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  b.blockedUntil = t + cfg.limitBlockS * 1000;
  return false;
}
async function serveStatic(req, res) {
  stats.staticRequests++;
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(webRoot, '.' + (path === '/' ? '/index.html' : path)), c = relative(webRoot, file);
    if (c.startsWith('..') || isAbsolute(c)) { res.writeHead(403, CORS).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { ...CORS, 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404, CORS).end('Not found.'); }
}
const json = (res, o, status = 200) => { const s = JSON.stringify(o, null, 1); res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(s); };
function control(url, res) {
  const map = { bandwidth: 'bandwidthMbit', latency: 'latencyMs', jitter: 'jitterMs', fail: 'failRate', notfound: 'notFoundRate' };
  for (const [k, v] of url.searchParams) {
    if (k === 'seed') { cfg.seed = v; attempts.clear(); }
    else if (map[k]) { const n = Number(v); if (!Number.isFinite(n) || n < 0) return json(res, { error: `bad value for ${k}` }, 400); cfg[map[k]] = n; }
    else return json(res, { error: `unknown parameter ${k}` }, 400);
  }
  json(res, cfg);
}
const server = createServer((req, res) => {
  req.on('error', () => {});
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '600' }).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { ...CORS, Allow: 'GET, HEAD, OPTIONS' }).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__stats') return json(res, snapshot());
  if (url.pathname === '/__control') return control(url, res);
  if (url.pathname === '/__reset') { stats = newStats(); attempts.clear(); requestLog = []; logStart = performance.now(); return json(res, { ok: true }); }
  if (url.pathname === '/__requests') return json(res, requestLog);
  if (req.url.startsWith('/proxy/')) return void proxy(req, res);
  void serveStatic(req, res);
});
server.keepAliveTimeout = 2000;
// A browser limits connections per host and port, so replay gives each upstream host its own port.
for (let i = 1; i <= num(arg('extra-ports'), 0); i++) createServer(server.listeners('request')[0]).listen(cfg.port + i, cfg.host);
server.listen(cfg.port, cfg.host, () => console.log(`Solar-System v2 tiles: http://${cfg.host}:${cfg.port} (${cfg.mode} ${dir}; web ${webRoot})`));
void unlink;

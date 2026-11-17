// Rebuild the data packs from their public sources, on this machine, with one command. It downloads each source once
// (resumably, one connection at a time) and checks it against tools/rebake.json, builds crates/solar-bake, runs every bake
// with the options recorded in that file, and finishes by checking every file it made against tools/packs.json, the list of
// the published packs. Run it again after an interruption: verified sources and finished products are not redone.
// Node 22 or later and Rust through rustup (the pinned toolchain installs itself); no packages. docs/BAKING.md explains it.
//   node tools/Rebake-Packs.mjs                       everything: about 23 GB of sources, 2.5 GB of packs into web/pack/
//   node tools/Rebake-Packs.mjs --plan                say what it would download and bake, and how much disk, then stop
//   node tools/Rebake-Packs.mjs --only small          a subset: product names (moon, sky, ...), pack folders (moon-v1, mars-v2),
//                                                     or the groups small, bodies, solar, all
//   node tools/Rebake-Packs.mjs --sources DIR         where the sources go (default: rebake-sources/ in the repository)
//   node tools/Rebake-Packs.mjs --out DIR             where the packs go (default: web/pack/)
//   node tools/Rebake-Packs.mjs --remove-sources      delete the downloaded sources once every product asked for matches
//   node tools/Rebake-Packs.mjs --check               only compare OUT with tools/packs.json
//   node tools/Rebake-Packs.mjs --threads N           baker threads (the output does not depend on it)
//   node tools/Rebake-Packs.mjs --ephemeris-from-kernels  fit solar/solar-v1.bin from the NAIF kernels (4.6 GB more) instead
//                                                     of copying the fit kept in crates/solar-core/data; the result is the same file
import {createHash, X509Certificate} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {createReadStream, createWriteStream, statfsSync} from 'node:fs';
import {copyFile, mkdir, readFile, rename, rm, stat, writeFile, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {totalmem} from 'node:os';
// The app's own table of pack versions: a rebake writes the folders the app reads.
import {PACK_VERSION, packFolder, mapFile} from '../web/pack-base.js';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const has = k => process.argv.includes('--' + k);
const recipe = JSON.parse(await readFile(join(here, 'rebake.json'), 'utf8'));
const published = JSON.parse(await readFile(join(here, 'packs.json'), 'utf8')).files;
const sourcesDir = resolve(arg('sources', join(repo, 'rebake-sources'))), out = resolve(arg('out', join(repo, 'web', 'pack')));
const threads = arg('threads', null);
const AGENT = 'solar-system-rebake/1 (+https://github.com/3merillon/Solar-System)';
const gb = n => (n / 1e9).toFixed(n < 1e10 ? 2 : 1) + ' GB', mb = n => (n / 1e6).toFixed(1) + ' MB';
const size = n => n >= 1e9 ? gb(n) : mb(n);
const exists = p => stat(p).then(s => s, () => null);
const sha256 = file => new Promise((ok, no) => { const h = createHash('sha256'); createReadStream(file, {highWaterMark: 1 << 22}).on('data', d => h.update(d)).on('error', no).on('end', () => ok(h.digest('hex'))); });
const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);

// Every product, what it reads and what it writes (paths as in tools/packs.json).
const products = recipe.products.map(p => {
  if (p.kernels && has('ephemeris-from-kernels')) p = {...p, kind: 'solar'};
  if (p.kind === 'body') p = {...p, version: PACK_VERSION[p.name] || 1, folder: packFolder(p.name).slice(0, -1)};
  const files = p.kind === 'body' ? [`${p.folder}/`, mapFile(p.name)]
    : p.kind === 'earth' ? ['pack-earth-v1/'] : p.kind === 'sky' ? ['solar/sky-'] : [p.output];
  const reads = [p.image, p.height, p.etopo, p.marble, p.jpeg, p.exr, p.stars, p.input, ...(p.kind === 'solar' ? p.kernels : [])].filter(Boolean);
  for (const s of reads) if (!recipe.sources[s]) throw Error(`${p.id}: no source ${s} in tools/rebake.json`);
  const expected = published.filter(f => files.some(x => x.endsWith('/') || x.endsWith('-') ? f.path.startsWith(x) : f.path === x));
  return {...p, reads, expected, outputs: files, bytes: expected.reduce((a, f) => a + f.bytes, 0)};
});
const sourceBytes = p => p.reads.reduce((a, s) => a + (recipe.sources[s].bytes || 0), 0);
const groups = {
  all: () => products, bodies: () => products.filter(p => p.kind === 'body'),
  solar: () => products.filter(p => !['body', 'earth'].includes(p.kind)),
  small: () => products.filter(p => sourceBytes(p) < 1e9),
};
const only = arg('only', 'all').split(',').filter(Boolean);
const chosen = [...new Set(only.flatMap(name => groups[name]?.() ?? products.filter(p => p.id === name || p.folder === name || (p.kind === 'earth' && name === 'pack-earth-v1'))))];
for (const name of only) if (!groups[name] && !products.some(p => p.id === name || p.folder === name || (p.kind === 'earth' && name === 'pack-earth-v1')))
  throw Error(`--only ${name}: no such product or group (groups: ${Object.keys(groups).join(', ')}; products: ${products.map(p => p.id).join(', ')})`);
chosen.sort((a, b) => products.indexOf(a) - products.indexOf(b));

// Compare what is in OUT with the published list. A manifest records the bake's wall time (bake.seconds) and, for Earth,
// the day its sources were downloaded: those fields can never match, so a manifest is also compared without them.
async function verify(list) {
  const rows = [];
  for (const p of list) {
    // A pack the app reads (web/pack-base.js) that the published list does not hold: the two disagree.
    if (!p.expected.length) rows.push([p.outputs.join(', '), 'NOT PUBLISHED']);
    for (const f of p.expected) {
    const path = join(out, f.path), s = await exists(path);
    if (!s) { rows.push([f.path, 'missing']); continue; }
    if (s.size === f.bytes && await sha256(path) === f.sha256) { rows.push([f.path, 'match']); continue; }
    if (f.path.endsWith('/manifest.json')) {
      const m = JSON.parse(await readFile(path, 'utf8'));
      if (m.bake) delete m.bake.seconds;
      for (const src of Object.values(m.sources || {})) { delete src.retrieved; delete src.retrieved_unix; }
      const want = recipe.manifests[f.path.split('/')[0]];
      if (want && createHash('sha256').update(canonical(m)).digest('hex') === want) { rows.push([f.path, 'match, times aside']); continue; }
    }
    rows.push([f.path, 'DIFFERS' + (p.differs ? ` (expected: ${p.differs})` : '')]);
  } }
  return rows;
}
function report(rows) {
  const count = {};
  for (const [path, verdict] of rows) { const key = verdict.split(' (')[0]; count[key] = (count[key] || 0) + 1; if (!verdict.startsWith('match')) console.log(`  ${verdict.padEnd(9)} ${path}`); }
  console.log(`checked ${rows.length} files against tools/packs.json: ` + Object.entries(count).map(([k, v]) => `${v} ${k}`).join(', '));
  return rows.every(r => r[1].startsWith('match'));
}

if (has('check')) process.exit(report(await verify(chosen)) ? 0 : 1);

// State: which sources were verified (by size and time, so a re-run does not hash 23 GB again) and which products finished.
const verifiedPath = join(sourcesDir, '.verified.json'), statePath = join(out, '.rebake-state.json');
const verified = JSON.parse(await readFile(verifiedPath, 'utf8').catch(() => '{}'));
const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
// What decides a product's bytes: its entry less the notes and measurements, and the hashes of what it reads.
const recipeHash = ({why, seconds, memory_gb, differs, expected, bytes, reads, ...p}) =>
  createHash('sha256').update(canonical({...p, reads: reads.map(s => recipe.sources[s].sha256 ?? recipe.sources[s].url)})).digest('hex').slice(0, 16);
const isDone = async p => { const s = state[p.id]; if (!s || s.recipe !== recipeHash(p)) return false; for (const [f, n] of Object.entries(s.files)) if ((await exists(join(out, f)))?.size !== n) return false; return true; };
const isVerified = async id => { const src = recipe.sources[id], s = await exists(join(sourcesDir, src.file)), v = verified[src.file]; return !!s && !!v && v.bytes === s.size && v.mtime === s.mtimeMs && v.sha256 === src.sha256; };

const todo = [];
for (const p of chosen) if (!(await isDone(p))) todo.push(p);
const needed = [...new Set(todo.flatMap(p => p.reads))];
let toDownload = 0, have = 0;
for (const id of needed) { const src = recipe.sources[id], s = await exists(join(sourcesDir, src.file)); if (src.bytes && s?.size === src.bytes) have += src.bytes; else toDownload += Math.max(0, (src.bytes || 0) - ((await exists(join(sourcesDir, src.file) + '.part'))?.size || 0)); }
const outBytes = todo.reduce((a, p) => a + p.bytes, 0);
const free = dir => { for (let d = dir; ; d = dirname(d)) { try { const s = statfsSync(d); return s.bavail * s.bsize; } catch { if (dirname(d) === d) return Infinity; } } };
const memory = Math.max(0, ...todo.map(p => p.memory_gb || 0));
console.log(`Rebake: ${chosen.length} products asked, ${chosen.length - todo.length} already done, ${todo.length} to bake.`);
console.log(`  sources ${sourcesDir}: ${needed.length} files, ${gb(have + toDownload)} in all, ${gb(toDownload)} still to download`);
console.log(`  packs   ${out}: ${gb(outBytes)} to write`);
console.log(`  disk: ${gb(toDownload + outBytes)} more needed; free ${gb(free(sourcesDir))} (sources), ${gb(free(out))} (packs)`);
if (memory) console.log(`  memory: the largest bake here peaked at ${memory} GB on the machine that recorded it; this one has ${gb(totalmem())}`);
const minutes = todo.reduce((a, p) => a + (p.seconds || 0), 0) / 60;
if (minutes) console.log(`  baking took about ${Math.ceil(minutes)} min on the machine that recorded it, plus the downloads`);
for (const p of todo) console.log(`    ${p.id.padEnd(12)} ${p.reads.map(s => recipe.sources[s].file.split('/').pop()).join(', ')}`);
if (free(sourcesDir) < toDownload + (sourcesDir.slice(0, 2) === out.slice(0, 2) ? outBytes : 0)) throw Error('not enough free disk for the sources (see above); use --sources and --out elsewhere');
if (memory && totalmem() < memory * 1e9) console.log(`  WARNING: less memory than the largest bake used; it may fail or swap. --only small avoids it.`);
if (has('plan')) process.exit(0);
await mkdir(sourcesDir, {recursive: true}); await mkdir(out, {recursive: true});

// A GET that follows redirects. Some hosts send their certificate without the intermediate that links it to a trusted root
// (NASA SVS did on 17 November 2026); a browser fetches the missing one from the address the certificate names, and so does
// this: the chain is then verified against Node's own roots as usual, nothing is trusted that was not before.
const intermediates = new Map();
const request = (url, headers, ca) => new Promise((ok, no) => {
  const u = new URL(url), mod = u.protocol === 'http:' ? http : https;
  mod.get(u, {headers, ...(ca ? {ca} : {})}, ok).on('error', no);
});
async function issuerOf(url) {
  const u = new URL(url);
  const cert = await new Promise((ok, no) => { const s = tls.connect({host: u.hostname, port: u.port || 443, servername: u.hostname, rejectUnauthorized: false}, () => { const c = s.getPeerCertificate(); s.end(); ok(c); }); s.on('error', no); });
  // Follow each certificate's stated issuer until one is signed by a root Node trusts (at most four steps).
  const roots = new Set(tls.rootCertificates.map(pem => new X509Certificate(pem).subject)), chain = [];
  let at = cert.infoAccess?.['CA Issuers - URI']?.[0];
  for (let step = 0; step < 4; step++) {
    if (!at) throw Error(`${u.hostname}: incomplete certificate chain, and the certificate names no issuer to fetch`);
    const issuer = new X509Certificate(Buffer.concat(await (await request(at, {'User-Agent': AGENT})).toArray()));
    chain.push(issuer.toString());
    console.log(`  ${u.hostname} sends no intermediate certificate; fetched ${issuer.subject.split('\n').pop()} from ${at}`);
    if (roots.has(issuer.issuer)) return [...tls.rootCertificates, ...chain];
    at = issuer.infoAccess?.split('\n').find(l => l.startsWith('CA Issuers - URI:'))?.slice(17);
  }
  throw Error(`${u.hostname}: no trusted root reached through its certificate's issuers`);
}
async function open(url, headers, hops = 0) {
  const host = new URL(url).host;
  let res;
  try { res = await request(url, headers, intermediates.get(host)); } catch (e) {
    if (e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' && !intermediates.has(host)) { intermediates.set(host, await issuerOf(url)); return open(url, headers, hops); }
    if (/CERT|SELF_SIGNED|UNABLE_TO/.test(e.code || '')) throw Object.assign(Error(`${url}: certificate refused (${e.code}); stopping`), {fatal: true});
    throw e;
  }
  if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
    res.resume();
    if (hops > 8) throw Error(`${url}: too many redirects`);
    return open(new URL(res.headers.location, url).href, headers, hops + 1);
  }
  return res;
}
// Downloads: one at a time, resumed from the .part file with an HTTP range. Returns false where the host has no such file.
async function download(url, path, bytes, label) {
  const part = path + '.part';
  for (let attempt = 1; ; attempt++) {
    const start = (await exists(part))?.size || 0;
    if (!(bytes && start === bytes)) try {
      const response = await open(url, {'User-Agent': AGENT, ...(start ? {Range: `bytes=${start}-`} : {})});
      const status = response.statusCode;
      if (status === 404) { response.resume(); return false; }
      if ([401, 403, 429].includes(status)) { response.resume(); throw Object.assign(Error(`${url}: HTTP ${status}: the host refused; stopping (run again later)`), {fatal: true}); }
      if (status === 416 && bytes && start === bytes) { response.resume(); break; }
      if (status < 200 || status >= 300) { response.resume(); throw Error(`HTTP ${status}`); }
      const resumed = status === 206;
      if (start && !resumed) console.log(`  ${label}: the host ignored the range, starting again`);
      const sink = createWriteStream(part, {flags: resumed ? 'a' : 'w'});
      let got = resumed ? start : 0, shown = Date.now();
      try {
        for await (const chunk of response) {
          if (!sink.write(chunk)) await new Promise(r => sink.once('drain', r));
          got += chunk.length;
          if (Date.now() - shown > 30000) { shown = Date.now(); console.log(`  ${label}: ${size(got)}${bytes ? ` of ${size(bytes)}` : ''}`); }
        }
      } finally { await new Promise(r => sink.end(r)); }
      if (bytes && got !== bytes) throw Error(`${got} bytes, expected ${bytes}`);
    } catch (e) {
      if (e.fatal) throw e;
      if (attempt >= 8) throw Object.assign(Error(`${label}: download did not complete (${e.message}); run again to resume`), {fatal: true});
      console.log(`  ${label}: ${e.message}; resuming in ${10 * attempt} s`);
      await new Promise(r => setTimeout(r, 10000 * attempt));
      continue;
    }
    break;
  }
  await rename(part, path);
  return true;
}
// A source that has no recorded copy to download (or whose copy is gone) can come from its live service instead, if it names
// one; the products made from it are then reported as differing.
const live = new Set();
const livePath = id => join(sourcesDir, recipe.sources[id].file.replace(/(\.\w+)?$/, '.live$1'));
async function fetchSource(id) {
  const s = recipe.sources[id], path = join(sourcesDir, s.file), label = s.file.split('/').pop();
  if (await isVerified(id)) return;
  await mkdir(dirname(path), {recursive: true});
  if (!(await exists(path)) && !(s.url && await download(s.url, path, s.bytes, label))) {
    if (!s.live) throw Error(`${label}: ${s.url} is not there (404). The source has moved or been withdrawn: report it.`);
    console.log(`  ${label}: no recorded copy ${s.url ? `at ${s.url}` : 'is published'}; asking the live service, whose answer has changed since the bake`);
    if (!(await exists(livePath(id)))) await download(s.live, livePath(id), null, label);
    live.add(id);
    return;
  }
  const st = await stat(path), hash = await sha256(path);
  if (st.size !== s.bytes || hash !== s.sha256)
    throw Error(`${path} is not the recorded file (${st.size} bytes, sha256 ${hash}); delete it to download again. If a fresh download differs too, the source changed upstream: report it.`);
  verified[s.file] = {bytes: st.size, mtime: st.mtimeMs, sha256: hash};
  await writeFile(verifiedPath, JSON.stringify(verified, null, 1));
  console.log(`  ${label}: ${size(st.size)}, checked`);
}

const run = (cmd, args, opts = {}) => new Promise((ok, no) => {
  const child = spawn(cmd, args, {stdio: ['ignore', 'inherit', 'pipe'], cwd: repo, ...opts});
  let tail = '';
  child.stderr.on('data', d => { const text = d.toString(); tail = (tail + text).slice(-4000); for (const line of text.split(/\r?\n/)) if (line && !/^baked \d+\/\d+ pages$/.test(line)) process.stderr.write(`    ${line}\n`); });
  child.on('error', no);
  child.on('exit', code => code === 0 ? ok() : no(Error(`${cmd} ${args.slice(0, 2).join(' ')} failed (${code}):\n${tail}`)));
});
const src = id => live.has(id) ? livePath(id) : join(sourcesDir, recipe.sources[id].file);
const flags = options => Object.entries(options || {}).flatMap(([k, v]) => v === true ? [k] : [k, String(v)]);

const started = Date.now();
if (todo.length) {
  console.log('Sources:');
  // A file that is not the recorded one does not stop the other downloads; nothing is baked until every source is right.
  const wrong = [];
  for (const id of needed) await fetchSource(id).catch(e => { if (e.fatal) { console.log(e.message); process.exit(1); } wrong.push(e.message); console.log(`  ${e.message}`); });
  if (wrong.length) { console.log(`${wrong.length} source${wrong.length > 1 ? 's are' : ' is'} not as recorded; nothing baked.`); process.exit(1); }
}
let baker = null;
if (todo.some(p => ['body', 'earth', 'map', 'schematic', 'sky', 'solar'].includes(p.kind))) {
  console.log('Building the baker (cargo build --release -p solar-bake):');
  await run('cargo', ['build', '--release', '--locked', '-p', 'solar-bake']);
  baker = join(repo, 'target', 'release', process.platform === 'win32' ? 'solar-bake.exe' : 'solar-bake');
}
const work = join(out, '.rebake-work');
for (const p of todo) {
  const t0 = Date.now(), tmp = join(work, p.id);
  console.log(`Baking ${p.id}${p.why ? ` (${Object.keys(p.why).length} recorded option${Object.keys(p.why).length === 1 ? '' : 's'})` : ''}:`);
  await rm(tmp, {recursive: true, force: true});
  await mkdir(join(tmp, 'solar', 'maps'), {recursive: true});
  const t = threads ? ['--threads', threads] : [];
  if (p.kind === 'body') await run(baker, ['body', '--name', p.name, '--image', src(p.image), ...(p.height ? ['--height', src(p.height)] : []),
    '--out', join(tmp, p.folder), '--map', join(tmp, mapFile(p.name)), '--credit', p.credit, '--image-is', p.image_is,
    '--finest', String(p.finest), '--version', String(p.version), ...flags(p.options), ...t]);
  else if (p.kind === 'earth') {
    // The baker's own ledger: it finds both files in place, checks them and records their credits and terms for the manifest.
    await run(baker, ['fetch', '--dir', sourcesDir]);
    await run(baker, ['pack', '--etopo', src(p.etopo), '--marble', src(p.marble), '--out', join(tmp, 'pack-earth-v1'), '--ledger', join(sourcesDir, 'ledger.json'), ...flags(p.options), ...t]);
  } else if (p.kind === 'map') await run(baker, ['map', '--jpeg', src(p.jpeg), '--map', join(tmp, p.output)]);
  else if (p.kind === 'schematic') await run(baker, ['schematic', '--name', p.name, '--map', join(tmp, p.output)]);
  else if (p.kind === 'sky') await run(baker, ['sky', '--exr', src(p.exr), '--stars', src(p.stars), '--out', join(tmp, 'solar')]);
  else if (p.kind === 'node') await run(process.execPath, [join(here, p.script), src(p.input), join(tmp, p.output), ...flags(p.options)]);
  else if (p.kind === 'copy') await copyFile(join(repo, p.from), join(tmp, p.output));
  else if (p.kind === 'solar') {
    // Every kernel sits in one folder, as the baker expects; it writes its fit errors beside the table (solar-v1.log.json).
    const dirs = new Set(p.kernels.map(id => dirname(src(id))));
    if (dirs.size !== 1) throw Error('the kernels must share one folder');
    await run(baker, ['solar', '--kernels', [...dirs][0], '--out', join(tmp, p.output)]);
  }
  else throw Error(`${p.id}: unknown kind ${p.kind}`);
  // Move the finished files into place, replacing a whole body pack so no file of an older bake stays in it.
  const files = {};
  const walk = async dir => { for (const e of await readdir(join(tmp, dir), {withFileTypes: true})) { const rel = dir ? `${dir}/${e.name}` : e.name; if (e.isDirectory()) await walk(rel); else files[rel] = (await stat(join(tmp, rel))).size; } };
  await walk('');
  for (const x of p.kind === 'body' ? [p.folder] : p.kind === 'earth' ? ['pack-earth-v1'] : []) await rm(join(out, x), {recursive: true, force: true});
  for (const rel of Object.keys(files)) { await mkdir(dirname(join(out, rel)), {recursive: true}); await rm(join(out, rel), {force: true}); await rename(join(tmp, rel), join(out, rel)); }
  await rm(tmp, {recursive: true, force: true});
  // Made from a live answer: not marked done, so a later run with the recorded source bakes it again.
  if (p.reads.some(id => live.has(id))) delete state[p.id];
  else state[p.id] = {recipe: recipeHash(p), files, seconds: Math.round((Date.now() - t0) / 1000)};
  await writeFile(statePath, JSON.stringify(state, null, 1));
  console.log(`  ${p.id}: ${Object.keys(files).length} files in ${Math.round((Date.now() - t0) / 1000)} s`);
}
await rm(work, {recursive: true, force: true});
if (todo.length) console.log(`Baked ${todo.length} products in ${Math.round((Date.now() - started) / 60000)} min.`);
console.log('Checking against tools/packs.json:');
const ok = report(await verify(chosen));
for (const p of chosen.filter(p => p.differs)) console.log(`  note: ${p.id}: ${p.differs}`);
for (const id of live) console.log(`  note: ${recipe.sources[id].file} came from the live service; what was made from it differs from the published file`);
if (ok && has('remove-sources')) {
  for (const id of new Set(chosen.flatMap(p => p.reads))) { await rm(src(id), {force: true}); delete verified[recipe.sources[id].file]; }
  await writeFile(verifiedPath, JSON.stringify(verified, null, 1));
  console.log(`removed the sources of these products from ${sourcesDir}`);
}
process.exit(ok ? 0 : 1);

// The data packs for a local build: downloads them from this repository's release into web/pack/ and checks every file
// against tools/packs.json (size and SHA-256). Run again to resume: files already there and correct are skipped.
// Node 22 or later, no packages.
//   node tools/Fetch-Packs.mjs                      download into web/pack/ (about 2.5 GB)
//   node tools/Fetch-Packs.mjs --out DIR            download somewhere else (then link or copy it to web/pack)
//   node tools/Fetch-Packs.mjs --check              verify what is there, download nothing
//   node tools/Fetch-Packs.mjs --only solar,moon-v1 only the packs whose folder is named
//   node tools/Fetch-Packs.mjs --write-index DIR [--release TAG]   for whoever publishes: list DIR into tools/packs.json;
//                                                   a file new or changed since the last list is marked as in release TAG
// A file is in the release its entry names ("release"), or else in the list's own release. A changed pack is published
// under a new folder name in a new release, so the files of every earlier release stay as they were.
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const here = dirname(fileURLToPath(import.meta.url)), indexPath = join(here, 'packs.json');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const has = k => process.argv.includes('--' + k);
// A release asset has one flat name: the pack path with its slashes written as two underscores.
export const assetName = path => path.replaceAll('/', '__');
const sha256 = file => new Promise((ok, no) => { const h = createHash('sha256'); createReadStream(file).on('data', d => h.update(d)).on('error', no).on('end', () => ok(h.digest('hex'))); });
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';

if (has('write-index')) {
  const root = resolve(arg('write-index')), files = [];
  const walk = async dir => { for (const e of (await readdir(join(root, dir), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) await walk(path);
    else if (!/\.(log|log\.json|txt)$/.test(e.name)) files.push({path, bytes: (await stat(join(root, path))).size, sha256: await sha256(join(root, path))}); } };
  await walk('');
  const names = new Set(files.map(f => assetName(f.path))); if (names.size !== files.length) throw Error('two files would share a release asset name');
  const previous = JSON.parse(await readFile(indexPath, 'utf8').catch(() => '{}'));
  const release = previous.release || arg('release', 'packs-v1'), fresh = arg('release', release);
  const known = new Map((previous.files || []).map(f => [f.path, f]));
  for (const f of files) { const p = known.get(f.path), at = p && p.sha256 === f.sha256 ? p.release || release : fresh; if (at !== release) f.release = at; }
  const index = {release, repository: previous.repository || 'https://github.com/3merillon/Solar-System', files};
  await writeFile(indexPath, JSON.stringify(index, null, 1) + '\n');
  const inFresh = files.filter(f => (f.release || release) === fresh);
  console.log(`${files.length} files, ${mb(files.reduce((a, f) => a + f.bytes, 0))} listed in tools/packs.json; ${inFresh.length} (${mb(inFresh.reduce((a, f) => a + f.bytes, 0))}) in release ${fresh}`);
  process.exit(0);
}

const index = JSON.parse(await readFile(indexPath, 'utf8'));
const out = resolve(arg('out', join(here, '..', 'web', 'pack'))), only = arg('only', '').split(',').filter(Boolean), checkOnly = has('check');
// --base: one mirror that holds every file under its flat name, instead of the releases.
const base = f => arg('base', `${index.repository}/releases/download/${f.release || index.release}/`);
const wanted = index.files.filter(f => !only.length || only.includes(f.path.split('/')[0]));
if (!wanted.length) throw Error('nothing to fetch: tools/packs.json lists no such pack');
const total = wanted.reduce((a, f) => a + f.bytes, 0);
console.log(`${wanted.length} files, ${mb(total)}, releases ${[...new Set(wanted.map(f => f.release || index.release))].join(', ')} -> ${out}`);
const good = async f => { const s = await stat(join(out, f.path)).catch(() => null); return !!s && s.size === f.bytes && await sha256(join(out, f.path)) === f.sha256; };
let done = 0, fetched = 0, bad = 0;
for (const f of wanted) {
  const target = join(out, f.path);
  if (await good(f)) { done += f.bytes; continue; }
  if (checkOnly) { bad++; console.log(`missing or different: ${f.path}`); continue; }
  await mkdir(dirname(target), {recursive: true});
  let error = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(base(f) + assetName(f.path), {redirect: 'follow'});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const hash = createHash('sha256'); let bytes = 0;
      await pipeline(Readable.fromWeb(response.body), async function* (source) { for await (const chunk of source) { hash.update(chunk); bytes += chunk.length; yield chunk; } }, createWriteStream(target + '.part'));
      if (bytes !== f.bytes || hash.digest('hex') !== f.sha256) throw Error(`wrong content (${bytes} bytes)`);
      await rename(target + '.part', target); error = null; break;
    } catch (e) { error = e; await rm(target + '.part', {force: true}); }
  }
  if (error) { bad++; console.log(`FAILED ${f.path}: ${error.message}`); continue; }
  done += f.bytes; fetched++;
  console.log(`${String(Math.round(100 * done / total)).padStart(3)}%  ${f.path}  ${mb(f.bytes)}`);
}
console.log(bad ? `${bad} files ${checkOnly ? 'missing or different' : 'failed'}; run again to retry` : checkOnly ? 'every file is present and correct' : `done: ${fetched} downloaded, ${wanted.length - fetched} already there`);
process.exit(bad ? 1 : 0);

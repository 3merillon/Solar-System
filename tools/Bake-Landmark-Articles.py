"""Bake English Wikipedia leads for exact Gazetteer ID matches in Wikidata.

Run from any directory with Python 3. Sources are cached under evidence/local.
Delete that cache to take a fresh snapshot. The app serves the result offline.
"""
import concurrent.futures
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "web/landmarks"
CACHE = ROOT / "evidence/local/landmark-sources"
OUTPUT = CATALOG / "articles"
AGENT = "SolarSystemLandmarkAtlas/1.0 (https://github.com/3merillon/Solar-System)"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def api(url, parameters):
    request = Request(url + "?" + urlencode(parameters), headers={"User-Agent": AGENT, "Accept": "application/json"})
    for attempt in range(5):
        delay = 2 ** attempt
        try:
            with urlopen(request, timeout=90) as response:
                result = json.load(response)
            if "error" not in result:
                return result
            if result["error"]["code"] != "maxlag":
                raise ValueError(result["error"])
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504):
                raise
            delay = max(delay, int(error.headers.get("Retry-After", 0)))
        except (TimeoutError, URLError):
            if attempt == 4:
                raise
        time.sleep(delay)
    raise RuntimeError("Could not retrieve " + url)


def matches():
    path = CACHE / "matches.json"
    if not path.exists():
        query = """SELECT ?feature ?article ?item WHERE {
            ?item wdt:P2824 ?feature .
            ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
        }"""
        rows = api("https://query.wikidata.org/sparql", {"query": query, "format": "json"})["results"]["bindings"]
        save(path, [[r[k]["value"] for k in ("feature", "article", "item")] for r in rows])
    return read(path)


def articles(titles):
    key = hashlib.sha256("\n".join(titles).encode()).hexdigest()
    path = CACHE / (key + ".json")
    if path.exists():
        return read(path)
    response = api("https://en.wikipedia.org/w/api.php", {
        "action": "query", "format": "json", "formatversion": 2, "maxlag": 5,
        "prop": "extracts|info|pageprops", "exintro": 1, "explaintext": 1, "exlimit": len(titles),
        "ppprop": "wikibase_item|disambiguation", "titles": "|".join(titles),
    })
    records = []
    for p in response["query"]["pages"]:
        props = p.get("pageprops", {})
        if not p.get("extract") or "disambiguation" in props or not props.get("wikibase_item"):
            continue
        paragraphs = [s.strip() for s in p["extract"].splitlines() if s.strip()]
        # Keep complete sentences and ignore empty section headings, reference
        # numbers and pronunciation placeholders left by plain-text extraction.
        text = " ".join(s for s in paragraphs if not s.startswith("=="))
        text = re.sub(r"\[\d+\]|\(\s*\)", "", text)
        text = re.sub(r"\s+([,.;)])", r"\1", re.sub(r"\s+", " ", text)).strip()
        if len(text) > 1200:
            ends = list(re.finditer(r'[.!?](?=["”]?\s|$)', text[:1201]))
            if ends:
                text = text[:ends[-1].end()]
        if text:
            records.append([props["wikibase_item"], p["title"], p["lastrevid"], text])
    save(path, records)
    time.sleep(0.25)
    return records


def display_excerpt(text):
    # TextExtracts can expose both visual forms of one coordinates widget, or
    # leave a separator behind when a pronunciation audio widget is omitted.
    text = re.sub(r"\ufeff\s*/\s*[−+-]?\d+(?:\.\d+)?\s*;\s*[−+-]?\d+(?:\.\d+)?", "", text)
    return re.sub(r"\(\s*[;,]\s*", "(", text.replace("\ufeff", "")).strip()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(exist_ok=True)
    bodies = read(CATALOG / "index.json")["bodies"]
    catalogs = {body: read(CATALOG / f"{body}.json")["features"] for body in bodies}
    known = {str(f[5]) for rows in catalogs.values() for f in rows}
    pairs = {}
    titles = set()
    for feature, url, entity in matches():
        if feature not in known:
            continue
        title = unquote(urlparse(url).path.removeprefix("/wiki/")).replace("_", " ")
        if title.startswith(("List of ", "Lists of ")) or urlparse(url).fragment:
            continue
        titles.add(title)
        pairs.setdefault(feature, set()).add(entity.split("/")[-1])
    ordered = sorted(titles)
    chunks = [ordered[i:i+16] for i in range(0, len(ordered), 16)]
    by_item = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for records in pool.map(articles, chunks):
            for item, title, revision, excerpt in records:
                by_item[item] = [title, revision, display_excerpt(excerpt)]
    total = 0
    for body, features in catalogs.items():
        notes = {}
        for f in features:
            items = pairs.get(str(f[5]), set())
            if len(items) == 1 and (item := next(iter(items))) in by_item:
                notes[str(f[5])] = by_item[item]
        save(OUTPUT / f"{body}.json", {"license": "CC BY-SA 4.0", "articles": notes})
        total += len(notes)
        print(body, len(notes), flush=True)
    print(f"{total} articles across {len(bodies)} bodies.")


if __name__ == "__main__":
    main()

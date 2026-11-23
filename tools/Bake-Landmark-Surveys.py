"""Crossmatch official lunar topography and Venus radar surveys to named features.

Usage: python tools/Bake-Landmark-Surveys.py (Python 3.11+ with Pillow). Raw research tables stay in the
local cache. Only unique, position- and size-checked identifications ship.
"""
import csv
import hashlib
import json
import math
import shutil
import struct
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "web/landmarks"
CACHE = ROOT / "evidence/local/landmark-sources"
OUT = CATALOG / "surveys"


def source(name, url, digest=None):
    path = CACHE / name
    if not path.exists():
        temp = path.with_suffix(".part")
        with urlopen(url, timeout=120) as response, temp.open("wb") as out:
            shutil.copyfileobj(response, out)
        temp.replace(path)
    if digest:
        with path.open("rb") as data:
            if hashlib.file_digest(data, "md5").hexdigest() != digest:
                raise ValueError("Unexpected source checksum: " + name)
    return path


def distance(lat, lon, f, radius):
    d = math.pi / 180
    a = math.sin((lat-f[1])*d/2)**2 + math.cos(lat*d)*math.cos(f[1]*d)*math.sin((lon-f[2])*d/2)**2
    return 2*radius*math.asin(min(1, math.sqrt(a)))


def lunar(features):
    table = source("lunar-depths.csv", "https://zenodo.org/api/records/21500453/files/LunarCraterDepths_072226.csv/content?download=1",
                   "8ef8b93c2ba3fe1eee1e9e76113da2ba")
    radius = 1737.4
    bins = defaultdict(list)
    for f in features:
        if f[4] not in ("AA", "SF") or f[3] <= 0:
            continue
        arc = math.degrees(min(3, .07*f[3])/radius)
        polar = min(90, abs(f[1])+arc)
        width = min(180, arc / max(1e-8, math.cos(math.radians(polar))))
        xs = {x % 360 for x in range(math.floor(f[2]-width), math.floor(f[2]+width)+1)}
        for y in range(math.floor(f[1]-arc), math.floor(f[1]+arc)+1):
            for x in xs:
                bins[y,x].append(f)
    candidates = defaultdict(list)
    counts = defaultdict(int)
    with table.open(newline="", encoding="utf-8-sig") as data:
        for r in csv.DictReader(data):
            lat, lon, diam = map(float, (r["LAT_CIRC_IMG"],r["LON_CIRC_IMG"],r["DIAM_CIRC_IMG"]))
            for f in bins.get((math.floor(lat), math.floor(lon)%360), ()):
                if not .90 <= diam/f[3] <= 1.10 or distance(lat,lon,f,radius) > min(3, .07*f[3]):
                    continue
                # Check uniqueness before discarding candidates without usable depths.
                key = r["CRATER_ID"]
                counts[key] += 1
                depth = float(r["DEPTH_RIMFLR_DTM"] or 0)
                supported = all(float(r[k] or 0) >= 3 for k in ("PTS_RIM_DTM", "PTS_FLR_DTM"))
                candidates[f[5]].append((key, round(depth*1000), supported and 0 < depth < .4*diam))
    return {fid: [key, metres] for fid, rows in candidates.items() if len(rows)==1
            for key, metres, usable in rows if usable and metres>0 and counts[key]==1}


def venus(features):
    table = source("venus-craters.txt", "https://www.lpi.usra.edu/venus/craters/rel3main.txt")
    def name(s):
        return "".join(c for c in unicodedata.normalize("NFKD",s.casefold()) if c.isalnum())
    named = defaultdict(list)
    for f in features:
        if f[4]=="AA":
            named[name(f[0])].append(f)
    matches = defaultdict(list)
    with table.open(encoding="latin-1",newline="") as data:
        next(data); next(data)
        for row in csv.DictReader(data,delimiter="\t"):
            if row["Co"] != "1":
                continue
            for f in named.get(name(row["Name"]), ()):
                if not .75 <= float(row["D"])/f[3] <= 1.25 or distance(float(row["Lat"]),float(row["Lon"]),f,6051.8)>max(5,.16*f[3]):
                    continue
                matches[f[5]].append([row["#"],row["Mo"],row["Wa"],row["Fr"],row["Pf"]])
    return {fid: rows[0] for fid,rows in matches.items() if len(rows)==1}


def venus_elevations(features):
    from PIL import Image
    table = source("venus-magellan.tif", "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif")
    elevations={}
    with Image.open(table) as image, table.open("rb") as raw:
        tags=image.tag_v2
        if (image.size != (8192,4096) or raw.read(2)!=b"II" or tags[259]!=1 or tags[278]!=1
                or tags[258]!=(16,) or tags[339]!=(2,) or "SimpleCylindrical Venus" not in tags[34737]):
            raise ValueError("Unexpected Magellan grid or sample format")
        # Global pixel-is-area raster, -180 to 180 east, north at row zero.
        strips=tags[273]
        for f in features:
            x=math.floor((f[2]+180)*image.width/360)%image.width
            y=min(image.height-1,math.floor((90-f[1])*image.height/180))
            raw.seek(strips[y]+x*2)
            elevation=struct.unpack("<h",raw.read(2))[0]
            if elevation!=int(tags[42113]):
                elevations[f[5]]=elevation
    return elevations


if __name__ == "__main__":
    CACHE.mkdir(parents=True,exist_ok=True)
    OUT.mkdir(exist_ok=True)
    for body, survey in [(301,lunar),(299,venus)]:
        craters = survey(json.loads((CATALOG / f"{body}.json").read_text(encoding="utf-8"))["features"])
        (OUT / f"{body}.json").write_text(json.dumps(craters,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
        print(body,len(craters))
        if body==299:
            elevations=venus_elevations(json.loads((CATALOG/"299.json").read_text(encoding="utf-8"))["features"])
            directory=CATALOG/"geology"
            directory.mkdir(exist_ok=True)
            (directory/"299.json").write_text(json.dumps({"elevations":elevations},sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
            print("Magellan elevations",len(elevations))

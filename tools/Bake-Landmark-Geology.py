"""Sample published USGS map units at named features' centers (bake only).

Requires Python, Shapely 2 and pyshp. Run after Bake-Landmarks.mjs.
Coordinates on Mars are east-positive degrees. The lunar shapefile uses
equirectangular metres about 0° on a sphere of radius 1,737,400 m.
"""
import csv
import io
import json
import math
import shutil
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.request import Request, urlopen

import shapefile
from shapely import Point, STRtree
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "web/landmarks"
CACHE = ROOT / "evidence/local/landmark-sources"
MARS = "https://astrogeology.usgs.gov/pygeoapi/collections/mars/sim3292_global_geologic_map/units/items"
MOON = "https://asc-astropedia.s3.us-west-2.amazonaws.com/Moon/Geology/Unified_Geologic_Map_of_the_Moon_GIS_v2.zip"


def fetch(url, timeout=90):
    return urlopen(Request(url, headers={"User-Agent":"SolarSystemLandmarkAtlas/1.0 (https://github.com/3merillon/Solar-System)"}), timeout=timeout)


def mars_units():
    directory = CACHE / "mars-map"
    directory.mkdir(parents=True, exist_ok=True)
    with fetch(MARS+"?f=json&limit=1&resulttype=hits") as result:
        count = json.load(result)["numberMatched"]
    for offset in range(0,count,20):
        path = directory / f"{offset}.json"
        if not path.exists():
            with fetch(f"{MARS}?f=json&limit=20&offset={offset}",timeout=90) as result:
                rows = json.load(result)["features"]
            path.write_text(json.dumps(rows,separators=(",",":")),encoding="utf-8")
        for row in json.loads(path.read_text(encoding="utf-8")):
            prop = row["properties"]
            yield prop["unit"],prop["unitdesc"],shape(row["geometry"])


def moon_units():
    path = CACHE / "lunar-geology.zip"
    if not path.exists():
        with fetch(MOON,timeout=120) as response, path.open("wb") as output:
            shutil.copyfileobj(response,output)
    with zipfile.ZipFile(path) as archive:
        base = next(p[:-3] for p in archive.namelist() if p.endswith("/GeoUnits.shp"))
        prj = archive.read(base+"prj").decode()
        if "Moon2000_EquidistantCylindrical_clon0" not in prj or "1737400" not in prj:
            raise ValueError("Unexpected lunar coordinate reference system")
        legend = next(p for p in archive.namelist() if p.endswith("DOMU_descriptions.csv"))
        names = {r["Unit"]:r["Name"] for r in csv.DictReader(io.StringIO(archive.read(legend).decode("utf-8-sig")))}
        with shapefile.Reader(**{ext:io.BytesIO(archive.read(base+ext)) for ext in ("shp","shx","dbf")}) as reader:
            for record in reader.iterShapeRecords():
                code=record.record[0]
                yield code,names.get(code,record.record[1]+" "+record.record[2]),shape(record.shape.__geo_interface__)


if __name__=="__main__":
    out=CATALOG/"geology"
    out.mkdir(exist_ok=True)
    for body,units in [(499,mars_units),(301,moon_units)]:
        features=json.loads((CATALOG/f"{body}.json").read_text(encoding="utf-8"))["features"]
        scale=math.radians(1)*1737400 if body==301 else 1
        points=STRtree([Point(f[2]*scale,f[1]*scale) for f in features])
        matches=defaultdict(set)
        labels={}
        for code,label,polygon in units():
            labels[code]=label.strip()
            for index in points.query(polygon,predicate="contains"):
                matches[features[index][5]].add(code)
        # At boundaries or overlap leave the interpretation open.
        centers={key:next(iter(values)) for key,values in matches.items() if len(values)==1}
        (out/f"{body}.json").write_text(json.dumps({"units":labels,"centers":centers},sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
        print(body,len(centers),len(labels),flush=True)

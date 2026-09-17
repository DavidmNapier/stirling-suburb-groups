"""
Fetch OSM road centrelines for the City of Stirling LGA and merge them into
data/stirling_data.json under a new "roads" key.

Source: OpenStreetMap, via the Overpass API, ODbL licence.
Usage: python3 tools/build_roads.py
"""
import json, os, pathlib, urllib.request, urllib.parse
import shapely
from shapely.geometry import LineString

BASE = pathlib.Path(__file__).resolve().parent.parent
CACHE = BASE / 'tools' / '.cache'
DATA_PATH = BASE / 'data' / 'stirling_data.json'

# south, west, north, east — same LGA bounding box as the rest of the project
BBOX = (-31.9446, 115.7507, -31.8420, 115.8935)
GRID = 1e-5          # same grid the suburb geometry is snapped to (~1.1 m)
SIMPLIFY_TOL = 0.00003  # ~3 m — trims vertex count on long straight runs

# overpass-api.de blocks this environment's egress; this mirror answers with
# live data as of writing. If it goes dark, swap in another from
# https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
MIRROR = 'https://overpass.openstreetmap.fr/api/interpreter'

ARTERIAL = ['motorway', 'trunk', 'primary', 'secondary',
            'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']
RESIDENTIAL = ['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street']


def fetch(classes, cache_name):
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / cache_name
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding='utf-8'))
    regex = '^(' + '|'.join(classes) + ')$'
    q = ('[out:json][timeout:90];way["highway"~"%s"](%s,%s,%s,%s);out geom;'
         % (regex, *BBOX))
    body = urllib.parse.urlencode({'data': q}).encode()
    req = urllib.request.Request(MIRROR, data=body, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    cache_file.write_bytes(raw)
    return json.loads(raw)


def process(elements):
    out = []
    for el in elements:
        if el.get('type') != 'way' or 'geometry' not in el:
            continue
        coords = [(g['lon'], g['lat']) for g in el['geometry']]
        if len(coords) < 2:
            continue
        line = LineString(coords)
        if SIMPLIFY_TOL:
            line = line.simplify(SIMPLIFY_TOL, preserve_topology=False)
        line = shapely.set_precision(line, GRID)
        cs = list(line.coords)
        if len(cs) < 2:
            continue
        dedup = [cs[0]]
        for c in cs[1:]:
            if c != dedup[-1]:
                dedup.append(c)
        if len(dedup) < 2:
            continue
        out.append({
            'pts': [[round(x, 5), round(y, 5)] for x, y in dedup],
            'cls': el['tags'].get('highway', ''),
        })
    return out


print('fetching arterial ways…')
arterial_raw = fetch(ARTERIAL, 'roads_arterial.json')
print('fetching residential ways…')
residential_raw = fetch(RESIDENTIAL, 'roads_residential.json')

arterial = process(arterial_raw['elements'])
residential = process(residential_raw['elements'])

print('arterial:', len(arterial), 'ways')
print('residential:', len(residential), 'ways')

d = json.loads(DATA_PATH.read_text(encoding='utf-8'))
d['roads'] = {'arterial': arterial, 'residential': residential}
d['meta']['roads_source'] = 'OpenStreetMap contributors, via Overpass API'
d['meta']['roads_licence'] = 'ODbL 1.0'

txt = json.dumps(d, separators=(',', ':'))
DATA_PATH.write_text(txt, encoding='utf-8')
print('wrote', DATA_PATH, round(len(txt) / 1024), 'KB total')

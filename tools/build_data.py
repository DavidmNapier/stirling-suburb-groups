import json, math
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import unary_union
import shapely

GRID = 1e-5  # ~1.1 m; snapping every geometry to one grid keeps shared edges identical

SRC = 'data/Australia_Geo_Suburbs-main/WA.geojson'
d = json.load(open(SRC))

CORE = ['Balcatta','Balga','Carine','Churchlands','Coolbinia','Dianella','Doubleview',
        'Glendalough','Gwelup','Hamersley','Herdsman','Inglewood','Innaloo','Joondanna',
        'Karrinyup','Menora','Mirrabooka','Mount Lawley','Nollamara','North Beach',
        'Osborne Park','Scarborough','Stirling','Trigg','Tuart Hill','Watermans Bay',
        'Wembley Downs','Westminster','Woodlands','Yokine','Wembley']
CORE_UP = {c.upper(): c for c in CORE}

feats = {}
for f in d['features']:
    up = (f['properties'].get('suburb_name') or '').strip()
    g = shape(f['geometry'])
    if not g.is_valid:
        g = g.buffer(0)
    if up in feats:
        feats[up] = unary_union([feats[up], g])
    else:
        feats[up] = g

missing = [c for c in CORE if c.upper() not in feats]
print('missing:', missing)

core = {CORE_UP[u]: feats[u] for u in CORE_UP if u in feats}
study = unary_union(list(core.values()))
minx, miny, maxx, maxy = study.bounds
print('bounds', [round(v, 5) for v in (minx, miny, maxx, maxy)])

halo = study.buffer(0.013)
ctx_names = [u for u, g in feats.items() if u not in CORE_UP and g.intersects(halo)]
print('context suburbs:', len(ctx_names))


def rings(geom, tol, prec=5):
    """-> list of polygons; each polygon is [exterior_ring, hole1, hole2, ...]"""
    if tol:
        geom = geom.simplify(tol, preserve_topology=True)
    geom = shapely.set_precision(geom, GRID)
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.geom_type == 'GeometryCollection':
        geom = unary_union([g for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
    if geom.is_empty:
        return []
    out = []
    polys = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    for p in polys:
        if p.is_empty or p.area < 1e-9:
            continue
        poly = []
        for ring in [p.exterior] + list(p.interiors):
            cs = [[round(x, prec), round(y, prec)] for x, y in ring.coords]
            dedup = [cs[0]]
            for c in cs[1:]:
                if c != dedup[-1]:
                    dedup.append(c)
            if dedup[0] != dedup[-1]:
                dedup.append(dedup[0])
            if len(dedup) >= 4:
                poly.append(dedup)
        if poly:
            out.append(poly)
    return out


def label_point(geom):
    polys = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    big = max(polys, key=lambda p: p.area)
    pt = big.representative_point()
    for b in (0.006, 0.004, 0.002, 0.001, 0.0005):
        try:
            sh = big.buffer(-b)
            if not sh.is_empty:
                parts = list(sh.geoms) if sh.geom_type == 'MultiPolygon' else [sh]
                pt = max(parts, key=lambda q: q.area).representative_point()
                break
        except Exception:
            pass
    return [round(pt.x, 5), round(pt.y, 5)]


latm = math.cos(math.radians((miny + maxy) / 2))


def area_km2(g):
    return round(g.area * (111.32 ** 2) * latm, 2)


for tol in (0, 0.000012, 0.00002, 0.00004):
    p = [{'n': n, 'r': rings(core[n], tol)} for n in CORE]
    v = sum(len(rg) for s in p for pl in s['r'] for rg in pl)
    print(f'tol={tol}: {len(json.dumps(p, separators=(",", ":")))/1024:.0f} KB, {v} vertices')

TOL = 0  # full resolution — we have the budget, street alignment matters
CTX_TOL = 0.00012   # context suburbs can be coarser

suburbs = []
for n in CORE:
    g = core[n]
    suburbs.append({
        'n': n,
        'lga': 'Cambridge' if n == 'Wembley' else 'Stirling',
        'r': rings(g, TOL),
        'c': label_point(g),
        'km2': area_km2(g),
    })

clip = halo.buffer(0.005)
ctx = []
for u in sorted(ctx_names):
    g = feats[u].intersection(clip)
    if g.is_empty or g.geom_type not in ('Polygon', 'MultiPolygon'):
        continue
    r = rings(g, CTX_TOL)
    if r:
        ctx.append({'n': u.title().replace(' Of ', ' of '), 'r': r})

lga = rings(unary_union([core[n] for n in CORE if n != 'Wembley']).buffer(0.00001), 0.00002)

out = {
    'meta': {
        'source': 'Geoscape Administrative Boundaries (Localities), via data.gov.au',
        'licence': 'CC BY 4.0',
        'bounds': [round(v, 5) for v in (minx, miny, maxx, maxy)],
    },
    'suburbs': suburbs,
    'context': ctx,
    'lga': lga,
}
txt = json.dumps(out, separators=(',', ':'))
open('stirling_data.json', 'w').write(txt)
print('\nFINAL', round(len(txt) / 1024), 'KB')
print('core vertices', sum(len(rg) for s in suburbs for p in s['r'] for rg in p))
print('context features', len(ctx), 'lga rings', len(lga))

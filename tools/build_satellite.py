"""
Fetch and stitch a satellite basemap covering the City of Stirling LGA from
Esri World Imagery tiles, crop it exactly to the LGA bounding box, and save
it as data/satellite.jpg. Records the image's precise geographic bounds in
data/stirling_data.json's meta so the renderer can place it correctly.

Source: Esri World Imagery (public, free, no key). Usage: python3 tools/build_satellite.py
"""
import io, json, math, pathlib, time, urllib.request

BASE = pathlib.Path(__file__).resolve().parent.parent
DATA_PATH = BASE / 'data' / 'stirling_data.json'
OUT_PATH = BASE / 'data' / 'satellite.jpg'
CACHE = BASE / 'tools' / '.cache' / 'tiles'

# south, west, north, east — same LGA bounding box as the rest of the project
BBOX = (-31.9446, 115.7507, -31.8420, 115.8935)
Z = 15
TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def tile_lonlat(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


south, west, north, east = BBOX
x0f, y1f = tile_xy(south, west, Z)
x1f, y0f = tile_xy(north, east, Z)
x0, x1 = math.floor(x0f), math.ceil(x1f)
y0, y1 = math.floor(y0f), math.ceil(y1f)
print('tiles: x', x0, '-', x1, ' y', y0, '-', y1, ' total', (x1 - x0) * (y1 - y0))

from PIL import Image

CACHE.mkdir(parents=True, exist_ok=True)
TS = 256
canvas = Image.new('RGB', ((x1 - x0) * TS, (y1 - y0) * TS))

n_tiles = (x1 - x0) * (y1 - y0)
done = 0
for ty in range(y0, y1):
    for tx in range(x0, x1):
        cache_file = CACHE / f'{Z}_{tx}_{ty}.jpg'
        if not cache_file.exists():
            url = TILE_URL.format(z=Z, x=tx, y=ty)
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=20) as r:
                        cache_file.write_bytes(r.read())
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    time.sleep(1)
        img = Image.open(cache_file).convert('RGB')
        canvas.paste(img, ((tx - x0) * TS, (ty - y0) * TS))
        done += 1
        if done % 20 == 0:
            print(' ', done, '/', n_tiles)

print('stitched', canvas.size)

# crop to the exact bbox — convert bbox corners to pixel offsets in the stitched canvas
def px_of(lat, lon):
    x, y = tile_xy(lat, lon, Z)
    return (x - x0) * TS, (y - y0) * TS

left, top = px_of(north, west)
right, bottom = px_of(south, east)
crop_box = (round(left), round(top), round(right), round(bottom))
cropped = canvas.crop(crop_box)
print('cropped', cropped.size)

# exact geographic bounds of the CROPPED image (pixel-accurate, for alignment)
w_lon, n_lat = tile_lonlat(x0 + crop_box[0] / TS, y0 + crop_box[1] / TS, Z)
e_lon, s_lat = tile_lonlat(x0 + crop_box[2] / TS, y0 + crop_box[3] / TS, Z)

cropped.save(OUT_PATH, 'JPEG', quality=82, optimize=True)
print('wrote', OUT_PATH, round(OUT_PATH.stat().st_size / 1024), 'KB')

d = json.loads(DATA_PATH.read_text(encoding='utf-8'))
d['meta']['satellite'] = {
    'w': round(w_lon, 6), 's': round(s_lat, 6), 'e': round(e_lon, 6), 'n': round(n_lat, 6),
    'source': 'Esri World Imagery', 'zoom': Z,
}
DATA_PATH.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8')
print('recorded bounds in', DATA_PATH)

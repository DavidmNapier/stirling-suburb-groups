/* ============================================================
   Suburb Groups — core engine
   ============================================================ */
const APP = {};
(function () {
'use strict';

/* ---------- projection (Web Mercator) ---------- */
const R = 6378137, D2R = Math.PI / 180;
const px = lng => lng * D2R * R;
const py = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
const ux = x => x / R / D2R;
const uy = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D2R;
APP.proj = { px, py, ux, uy };

/* ---------- defaults ---------- */
const PALETTE = ['#c0392b', '#2471a3', '#1e8449', '#d35400', '#7d3c98', '#117a65',
                 '#b7950b', '#a93226', '#1f618d', '#148f77'];

const DEFAULT_GROUPS = [
  { name: 'Group 1 — Coastal & Carine',   subs: ['Watermans Bay','North Beach','Trigg','Carine','Karrinyup','Gwelup','Hamersley'] },
  { name: 'Group 2 — Scarborough',        subs: ['Scarborough','Doubleview'] },
  { name: 'Group 3 — Innaloo & Wembley',  subs: ['Innaloo','Woodlands','Wembley Downs','Churchlands','Herdsman','Osborne Park','Glendalough','Wembley'] },
  { name: 'Group 4 — Balcatta & Stirling',subs: ['Balcatta','Stirling','Nollamara'] },
  { name: 'Group 5 — Balga & Mirrabooka', subs: ['Balga','Mirrabooka','Westminster','Dianella'] },
  { name: 'Group 6 — Yokine & Inglewood', subs: ['Tuart Hill','Yokine','Joondanna','Coolbinia','Menora','Inglewood','Mount Lawley'] },
];

const THEMES = {
  light:  { land:'#f4f3ef', ctx:'#e7e6e1', edge:'#d4d2cb', edgeW:0.9,
            lga:'#9c968a', text:'#5c6166', halo:'#ffffffdd', sea:'#dde6ea', furn:'#ffffff', furnInk:'#23292e',
            rc:'#cec7b6', rf:'#ffffff', rm:'#e9e5da' },
  street: { land:'#f7f4ee', ctx:'#efece5', edge:'#ddd7c8', edgeW:0.9,
            lga:'#8d8676', text:'#4e535a', halo:'#ffffffee', sea:'#b9d6e2', furn:'#ffffff', furnInk:'#23292e',
            rc:'#c2a968', rf:'#fff6e0', rm:'#f4eddc' },
  dark:   { land:'#2c3338', ctx:'#242a2e', edge:'#434d54', edgeW:1.1,
            lga:'#6d7a83', text:'#c2cbd1', halo:'#1b2024cc', sea:'#1b262c', furn:'#232a2f', furnInk:'#e9edef',
            rc:'#171c1f', rf:'#4c565d', rm:'#3a4348' },
  plain:  { land:'#ffffff', ctx:'#fafafa', edge:'#dcdcdc', edgeW:0.8,
            lga:'#b0b0b0', text:'#555555', halo:'#ffffffee', sea:'#f2f6f8', furn:'#ffffff', furnInk:'#222222',
            rc:'#d6d6d6', rf:'#ffffff', rm:'#eeeeee' },
  satellite: { land:'#3a3f38', ctx:'#3a3f38', edge:'#ffffff59', edgeW:0.8,
            lga:'#ffe066', text:'#ffffff', halo:'#00000099', sea:'#12242c', furn:'#232a2f', furnInk:'#e9edef',
            rc:'#00000070', rf:'#ffe9a8', rm:'#ffffffb0' },
};
APP.THEMES = THEMES; APP.PALETTE = PALETTE;

/* ---------- state ---------- */
const S = {
  groups: [],
  texts: [],
  shapes: [],
  measure: null,
  view: { cx: 0, cy: 0, scale: 1 },
  theme: 'light',
  layers: { streets:true, roads:true, subs:true, ctx:true, lga:true, fill:true,
            legend:true, scale:true, north:true, titleBlk:true, grpLab:true },
  legendPos: 'br',
  title: 'Suburb groups',
  subtitle: 'City of Stirling',
  by: '',
  underlay: null,          // {img, cx, cy, w, h, op, locked}
  tool: 'pan',
  selGroup: 0,
  selText: null,
  selShape: null,
  draft: null,             // in-progress drawn shape / measure
};
APP.S = S;

/* ---------- data prep ---------- */
const SUB = {}, SUBS = [];
let CTX = [], LGA = [];
const ROADS = { arterial: [], residential: [] };
let SAT = null;

function bboxOf(polys) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
  }
  return [a, b, c, d];
}

function lineBbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}
function bboxHit(a, b) { return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]); }

APP.initData = function (DATA) {
  for (const s of DATA.suburbs) {
    s.bbox = bboxOf(s.r);
    s.proj = s.r.map(poly => poly.map(ring => ring.map(([x, y]) => [px(x), py(y)])));
    s.cp = [px(s.c[0]), py(s.c[1])];
    SUB[s.n] = s; SUBS.push(s);
  }
  CTX = DATA.context.map(c => ({ n: c.n, proj: c.r.map(p => p.map(r => r.map(([x, y]) => [px(x), py(y)]))) }));
  LGA = DATA.lga.map(p => p.map(r => r.map(([x, y]) => [px(x), py(y)])));
  APP.SUB = SUB; APP.SUBS = SUBS; APP.CTX = CTX; APP.LGA = LGA;
  APP.meta = DATA.meta;

  if (DATA.roads) {
    for (const kind of ['arterial', 'residential']) {
      ROADS[kind] = (DATA.roads[kind] || []).map(r => {
        const proj = r.pts.map(([x, y]) => [px(x), py(y)]);
        return { cls: r.cls, pts: r.pts, proj, bbox: lineBbox(proj) };  // bbox in projected units — matches visibleBBox
      });
    }
  }
  APP.ROADS = ROADS;

  if (DATA.meta && DATA.meta.satellite) {
    const m = DATA.meta.satellite;
    const x0 = px(m.w), x1 = px(m.e), y0 = py(m.s), y1 = py(m.n);
    SAT = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, img: null };
  }
  APP.SAT = SAT;

  buildSnapIndex();
};

/* snap index — every suburb-boundary and road vertex, in a coarse grid hash */
const SNAP = new Map(); const CELL = 0.0006;
const key = (x, y) => ((x / CELL) | 0) + ':' + ((y / CELL) | 0);
function addSnap(v) {
  const k = key(v[0], v[1]);
  let a = SNAP.get(k); if (!a) SNAP.set(k, a = []);
  a.push(v);
}
function buildSnapIndex() {
  SNAP.clear();
  for (const s of SUBS) for (const poly of s.r) for (const ring of poly) for (const v of ring) addSnap(v);
  for (const kind of ['arterial', 'residential']) for (const r of ROADS[kind]) for (const v of r.pts) addSnap(v);
}
/* nearest boundary vertex to a lng/lat, within tolerance (degrees) */
APP.snapTo = function (lng, lat, tolDeg) {
  const cx = (lng / CELL) | 0, cy = (lat / CELL) | 0;
  let best = null, bd = tolDeg * tolDeg;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = SNAP.get((cx + i) + ':' + (cy + j)); if (!a) continue;
    for (const v of a) {
      const dx = v[0] - lng, dy = v[1] - lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = v; }
    }
  }
  return best ? [best[0], best[1]] : null;
};

/* ---------- geometry helpers ---------- */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolys(x, y, polys) {
  for (const poly of polys) {
    if (!pointInRing(x, y, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(x, y, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
APP.pointInPolys = pointInPolys;

APP.suburbAt = function (lng, lat) {
  for (const s of SUBS) {
    const b = s.bbox;
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pointInPolys(lng, lat, s.r)) return s;
  }
  return null;
};

/* haversine metres */
APP.dist = function (a, b) {
  const p1 = a[1] * D2R, p2 = b[1] * D2R, dp = p2 - p1, dl = (b[0] - a[0]) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/* ---------- groups ---------- */
let gid = 1;
APP.makeGroup = function (name, subs, i) {
  return {
    id: 'g' + (gid++),
    name: name,
    subs: subs.slice(),
    line: PALETTE[i % PALETTE.length],
    width: 2.6,
    dash: 0,
    fill: PALETTE[i % PALETTE.length],
    opacity: 0.16,
    visible: true,
    custom: null,      // hand-edited outline, [[ring,...],...] in lng/lat
    _out: null,        // cached dissolve
    _lab: null,
  };
};
APP.resetGroups = function () {
  gid = 1;
  S.groups = DEFAULT_GROUPS.map((g, i) => APP.makeGroup(g.name, g.subs, i));
  S.groups.forEach(dissolve);
};

/* dissolve a group's suburbs into one outline using polygon-clipping */
function dissolve(g) {
  if (g.custom) { g._out = g.custom; g._lab = poleOf(g._out); project(g); return; }
  const parts = [];
  for (const n of g.subs) { const s = SUB[n]; if (s) for (const poly of s.r) parts.push(poly); }
  if (!parts.length) { g._out = []; g._lab = null; g._proj = []; return; }
  let out;
  try {
    out = polygonClipping.union(parts[0], ...parts.slice(1));
  } catch (e) {
    console.warn('union failed for ' + g.name, e);
    out = parts.map(p => p);          // fall back to un-merged suburb outlines
  }
  g._out = out.map(poly => poly.map(ring => ring.map(v => [v[0], v[1]])));
  g._lab = poleOf(g._out);
  project(g);
}
function project(g) {
  g._proj = g._out.map(poly => poly.map(ring => ring.map(([x, y]) => [px(x), py(y)])));
  g._lp = g._lab ? [px(g._lab[0]), py(g._lab[1])] : null;
}
APP.dissolve = dissolve;

/* rough pole of inaccessibility for a label */
function poleOf(polys) {
  if (!polys.length) return null;
  let big = polys[0], ba = 0;
  for (const p of polys) {
    const r = p[0]; let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
    a = Math.abs(a / 2); if (a > ba) { ba = a; big = p; }
  }
  const r = big[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of r) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; }
  const N = 16; let best = null, bd = -1;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const x = x0 + (x1 - x0) * i / N, y = y0 + (y1 - y0) * j / N;
    if (!pointInPolys(x, y, [big])) continue;
    let d = Infinity;
    for (const v of r) { const q = (v[0] - x) ** 2 + (v[1] - y) ** 2; if (q < d) d = q; }
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best || [(x0 + x1) / 2, (y0 + y1) / 2];
}

/* ---------- view maths ---------- */
APP.fitView = function (W, H, pad) {
  pad = pad == null ? 44 : pad;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const s of SUBS) for (const poly of s.proj) for (const v of poly[0]) {
    if (v[0] < a) a = v[0]; if (v[0] > c) c = v[0];
    if (v[1] < b) b = v[1]; if (v[1] > d) d = v[1];
  }
  const sc = Math.min((W - pad * 2) / (c - a), (H - pad * 2) / (d - b));
  return { cx: (a + c) / 2, cy: (b + d) / 2, scale: sc };
};
APP.visibleBBox = function (W, H, v) {
  const hw = W / 2 / v.scale, hh = H / 2 / v.scale;
  return [v.cx - hw, v.cy - hh, v.cx + hw, v.cy + hh];
};

/* ---------- renderer ---------- */
function T(v, W, H) {
  return {
    x: wx => (wx - v.cx) * v.scale + W / 2,
    y: wy => (v.cy - wy) * v.scale + H / 2,
    ix: sx => (sx - W / 2) / v.scale + v.cx,
    iy: sy => v.cy - (sy - H / 2) / v.scale,
  };
}
APP.T = T;

function tracePolys(ctx, polys, t) {
  ctx.beginPath();
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) {
      const X = t.x(ring[i][0]), Y = t.y(ring[i][1]);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  }
}

/* ---------- real street network ---------- */
const RESIDENTIAL_MIN_SCALE = 0.15;   // v.scale below this: skip residential/tertiary roads
const ROAD_W = {                       // stroke width in px at k=1, casing pass adds a margin on top
  motorway: 5.2, motorway_link: 4.2, trunk: 5.0, trunk_link: 4.0,
  primary: 4.0, primary_link: 3.2, secondary: 3.0, secondary_link: 2.4,
  tertiary: 1.6, tertiary_link: 1.3, unclassified: 1.1, residential: 1.1, living_street: 1.0,
};
function strokePath(ctx, pts, t) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const X = t.x(pts[i][0]), Y = t.y(pts[i][1]);
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }
  ctx.stroke();
}
/* casing then fill, so casings never paint over an already-drawn fill at a junction */
function drawRoadSet(ctx, list, t, k, vbb, casingColor, fillColor, casingExtra) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (casingColor) {
    ctx.strokeStyle = casingColor;
    for (const r of list) {
      if (!bboxHit(r.bbox, vbb)) continue;
      ctx.lineWidth = ((ROAD_W[r.cls] || 2.6) + casingExtra) * k;
      strokePath(ctx, r.proj, t);
    }
  }
  ctx.strokeStyle = fillColor;
  for (const r of list) {
    if (!bboxHit(r.bbox, vbb)) continue;
    ctx.lineWidth = (ROAD_W[r.cls] || 1.1) * k;
    strokePath(ctx, r.proj, t);
  }
}

function label(ctx, text, X, Y, size, col, halo, weight, align) {
  ctx.font = (weight || 500) + ' ' + size + "px 'IBM Plex Sans','Segoe UI',system-ui,sans-serif";
  ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
  if (halo) {
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.26);
    ctx.strokeStyle = halo; ctx.strokeText(text, X, Y);
  }
  ctx.fillStyle = col; ctx.fillText(text, X, Y);
}
APP.label = label;

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
APP.hexA = hexA;

/**
 * Draw the whole scene. Used for the screen and, at a larger size, for exports.
 * o.k scales line weights and type so an export looks like the screen.
 */
APP.draw = function (ctx, W, H, v, o) {
  o = o || {};
  const k = o.k || 1, kf = o.kf || k, th = THEMES[S.theme] || THEMES.light, L = S.layers;
  const t = T(v, W, H);
  const bottomInset = o.bottomInset || 0;

  const satActive = S.theme === 'satellite' && SAT && SAT.img;

  ctx.save();
  ctx.fillStyle = th.sea; ctx.fillRect(0, 0, W, H);

  /* satellite basemap */
  if (satActive && !S.underlay) {
    const x0 = t.x(SAT.cx - SAT.w / 2), y0 = t.y(SAT.cy + SAT.h / 2);
    ctx.drawImage(SAT.img, x0, y0, SAT.w * v.scale, SAT.h * v.scale);
  }

  /* underlay image */
  if (S.underlay && S.underlay.img) {
    const u = S.underlay;
    ctx.globalAlpha = u.op;
    const x0 = t.x(u.cx - u.w / 2), y0 = t.y(u.cy + u.h / 2);
    ctx.drawImage(u.img, x0, y0, u.w * v.scale, u.h * v.scale);
    ctx.globalAlpha = 1;
  }

  /* context suburbs */
  if (L.ctx && !S.underlay && !satActive) {
    ctx.fillStyle = th.ctx; ctx.strokeStyle = th.edge; ctx.lineWidth = 0.6 * k;
    for (const c of CTX) { tracePolys(ctx, c.proj, t); ctx.fill('evenodd'); ctx.stroke(); }
  }

  /* land */
  if (!S.underlay && !satActive) {
    ctx.fillStyle = th.land;
    for (const s of SUBS) { tracePolys(ctx, s.proj, t); ctx.fill('evenodd'); }
  }

  /* group shading */
  if (L.fill) {
    for (const g of S.groups) {
      if (!g.visible || !g._proj || !g._proj.length || g.opacity <= 0) continue;
      ctx.fillStyle = hexA(g.fill, g.opacity);
      tracePolys(ctx, g._proj, t); ctx.fill('evenodd');
    }
  }

  /* real street network — arterial always, residential once zoomed in */
  if (L.streets && !S.underlay) {
    const vbb = APP.visibleBBox(W, H, v);
    drawRoadSet(ctx, ROADS.arterial, t, k, vbb, th.rc, th.rf, 2.2);
    if (v.scale >= RESIDENTIAL_MIN_SCALE) drawRoadSet(ctx, ROADS.residential, t, k, vbb, null, th.rm, 0);
  }

  /* suburb boundary lines */
  if (L.roads && !S.underlay) {
    ctx.strokeStyle = th.edge; ctx.lineWidth = th.edgeW * k;
    for (const s of SUBS) { tracePolys(ctx, s.proj, t); ctx.stroke(); }
  }

  /* highlight */
  if (o.hoverSub) {
    ctx.fillStyle = 'rgba(227,167,78,.30)'; ctx.strokeStyle = '#e3a74e'; ctx.lineWidth = 1.8 * k;
    tracePolys(ctx, o.hoverSub.proj, t); ctx.fill('evenodd'); ctx.stroke();
  }

  /* council boundary */
  if (L.lga) {
    ctx.save();
    ctx.strokeStyle = th.lga; ctx.lineWidth = 1.4 * k; ctx.setLineDash([9 * k, 5 * k]);
    tracePolys(ctx, LGA, t); ctx.stroke();
    ctx.restore();
  }

  /* drawn shapes */
  for (const sh of S.shapes) {
    if (sh.visible === false) continue;
    ctx.save();
    ctx.beginPath();
    sh.pts.forEach(([a, b], i) => { const X = t.x(px(a)), Y = t.y(py(b)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    if (sh.closed) ctx.closePath();
    if (sh.closed && sh.opacity > 0) { ctx.fillStyle = hexA(sh.fill, sh.opacity); ctx.fill(); }
    if (sh.dash) ctx.setLineDash([sh.dash * k, sh.dash * 0.7 * k]);
    ctx.strokeStyle = sh.line; ctx.lineWidth = sh.width * k;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    if (sh === o.selShape) {
      ctx.setLineDash([4 * k, 4 * k]); ctx.strokeStyle = '#e3a74e'; ctx.lineWidth = 1.2 * k; ctx.stroke();
    }
    ctx.restore();
  }

  /* group outlines */
  for (const g of S.groups) {
    if (!g.visible || !g._proj || !g._proj.length) continue;
    ctx.save();
    if (g.dash) ctx.setLineDash([g.dash * k, g.dash * 0.7 * k]);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = g.line; ctx.lineWidth = g.width * k;
    tracePolys(ctx, g._proj, t); ctx.stroke();
    ctx.restore();
  }

  /* ---- labels, with simple collision avoidance ----
     Priority: the user's own text, then group names, then suburb names. */
  const taken = [];
  const clash = b => taken.some(o => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]));
  const boxAt = (X, Y, w, h) => [X - w / 2, Y - h / 2, X + w / 2, Y + h / 2];

  const grpLabels = [];
  if (L.grpLab) for (const g of S.groups) {
    if (!g.visible || !g._lp) continue;
    const X = t.x(g._lp[0]), Y = t.y(g._lp[1]) - 16 * k;
    if (X < -200 || X > W + 200 || Y < -40 || Y > H + 40) continue;
    const short = g.name.split('\u2014')[0].trim();
    ctx.font = '700 ' + (17 * k) + "px 'IBM Plex Sans','Segoe UI',system-ui,sans-serif";
    const w = ctx.measureText(short).width + 14 * k;
    grpLabels.push({ g, short, X, Y, w, h: 23 * k });
    taken.push(boxAt(X, Y, w, 23 * k));
  }
  for (const tx of S.texts) {
    const X = t.x(px(tx.lng)), Y = t.y(py(tx.lat));
    const lines = String(tx.text || '').split('\n'), fs = tx.size * k;
    ctx.font = (tx.bold ? 700 : 500) + ' ' + fs + "px 'IBM Plex Sans','Segoe UI',system-ui,sans-serif";
    let mw = 0; for (const l of lines) mw = Math.max(mw, ctx.measureText(l).width);
    taken.push(boxAt(X, Y, mw + fs * 0.7, lines.length * fs * 1.22 + fs * 0.4));
  }

  /* suburb names — bigger suburbs win a contested spot */
  if (L.subs) {
    const fs = Math.max(7, Math.min(15, v.scale * 2600)) * k;
    if (fs > 6.5 * k) {
      ctx.font = "400 " + fs + "px 'IBM Plex Sans','Segoe UI',system-ui,sans-serif";
      const cands = [];
      for (const s of SUBS) {
        const X = t.x(s.cp[0]), Y = t.y(s.cp[1]);
        if (X < -60 || X > W + 60 || Y < -20 || Y > H + 20) continue;
        cands.push({ s, X, Y, w: ctx.measureText(s.n).width + 5 * k });
      }
      cands.sort((a, b) => b.s.km2 - a.s.km2);
      for (const c of cands) {
        const b = boxAt(c.X, c.Y, c.w, fs * 1.25);
        if (clash(b)) continue;
        taken.push(b);
        label(ctx, c.s.n, c.X, c.Y, fs, th.text, th.halo, 400);
      }
    }
  }

  /* group labels, on a soft plate so they stay readable over anything */
  for (const gl of grpLabels) {
    ctx.fillStyle = th.furn === '#ffffff' ? 'rgba(255,255,255,.82)' : 'rgba(35,42,47,.82)';
    roundRect(ctx, gl.X - gl.w / 2, gl.Y - gl.h / 2, gl.w, gl.h, 4 * k); ctx.fill();
    label(ctx, gl.short, gl.X, gl.Y, 17 * k, gl.g.line, null, 700);
  }

  /* text boxes */
  for (const tx of S.texts) {
    const X = t.x(px(tx.lng)), Y = t.y(py(tx.lat));
    const lines = String(tx.text || '').split('\n');
    const fs = tx.size * k, lh = fs * 1.22;
    ctx.font = (tx.bold ? 700 : 500) + ' ' + fs + "px 'IBM Plex Sans','Segoe UI',system-ui,sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (tx.bg) {
      let mw = 0; for (const l of lines) mw = Math.max(mw, ctx.measureText(l).width);
      const pd = fs * 0.4, bw = mw + pd * 2, bh = lines.length * lh + pd * 1.4;
      ctx.fillStyle = tx.bgCol || '#ffffffea';
      roundRect(ctx, X - bw / 2, Y - bh / 2, bw, bh, 4 * k); ctx.fill();
    }
    const y0 = Y - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => label(ctx, l, X, y0 + i * lh, fs, tx.col, tx.halo ? '#ffffffee' : null, tx.bold ? 700 : 500));
    if (tx === o.selText) {
      let mw = 0; for (const l of lines) mw = Math.max(mw, ctx.measureText(l).width);
      const bw = mw + fs * 0.9, bh = lines.length * lh + fs * 0.6;
      ctx.save(); ctx.setLineDash([4 * k, 3 * k]); ctx.strokeStyle = '#e3a74e'; ctx.lineWidth = 1.3 * k;
      ctx.strokeRect(X - bw / 2, Y - bh / 2, bw, bh); ctx.restore();
    }
  }

  /* measuring */
  if (S.measure && S.measure.pts.length) {
    const m = S.measure;
    ctx.save();
    ctx.beginPath();
    m.pts.forEach(([a, b], i) => { const X = t.x(px(a)), Y = t.y(py(b)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.strokeStyle = '#e3a74e'; ctx.lineWidth = 2 * k; ctx.setLineDash([6 * k, 4 * k]); ctx.stroke();
    ctx.setLineDash([]);
    for (const [a, b] of m.pts) {
      ctx.beginPath(); ctx.arc(t.x(px(a)), t.y(py(b)), 4 * k, 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#e3a74e'; ctx.lineWidth = 2 * k; ctx.stroke();
    }
    let tot = 0; for (let i = 1; i < m.pts.length; i++) tot += APP.dist(m.pts[i - 1], m.pts[i]);
    if (tot > 0) {
      const last = m.pts[m.pts.length - 1];
      const txt = tot >= 1000 ? (tot / 1000).toFixed(2) + ' km' : Math.round(tot) + ' m';
      label(ctx, txt, t.x(px(last[0])), t.y(py(last[1])) - 16 * k, 13 * k, '#2a1d07', '#e3a74eee', 600);
    }
    ctx.restore();
  }

  /* vertex handles */
  if (o.handles && o.handles.length) {
    for (const h of o.handles) {
      ctx.beginPath(); ctx.rect(h.X - 4, h.Y - 4, 8, 8);
      ctx.fillStyle = h.hot ? '#e3a74e' : '#ffffff';
      ctx.fill(); ctx.strokeStyle = h.hot ? '#2a1d07' : '#2b3138'; ctx.lineWidth = 1.4; ctx.stroke();
    }
  }

  /* ---- furniture ---- */
  const HB = H - bottomInset;
  if (o.furniture !== false) {
    if (L.titleBlk) drawTitleBlock(ctx, W, HB, kf, th, o);
    if (L.scale) drawScaleBar(ctx, W, HB, kf, th, v, o);
    if (L.north) drawNorth(ctx, W, HB, kf, th, o);
    if (L.legend) drawLegend(ctx, W, HB, kf, th, o);
  }
  ctx.restore();
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function tbHeight(k, o) { return (o.titleBlockH || 62) * k; }

function drawTitleBlock(ctx, W, H, k, th, o) {
  const h = tbHeight(k, o), y = H - h;
  ctx.fillStyle = th.furn; ctx.fillRect(0, y, W, h);
  ctx.strokeStyle = th.edge; ctx.lineWidth = 1 * k;
  ctx.beginPath(); ctx.moveTo(0, y + .5 * k); ctx.lineTo(W, y + .5 * k); ctx.stroke();
  const pad = 16 * k;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = th.furnInk;
  ctx.font = 600 + ' ' + (17 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillText(S.title || '', pad, y + 26 * k);
  ctx.font = 400 + ' ' + (11.5 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillStyle = th.text;
  ctx.fillText(S.subtitle || '', pad, y + 42 * k);
  const bits = [];
  if (S.by) bits.push('Prepared by ' + S.by);
  bits.push(new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }));
  ctx.textAlign = 'right';
  ctx.font = 400 + ' ' + (11 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillText(bits.join('   ·   '), W - pad, y + 26 * k);
  ctx.font = 400 + ' ' + (9.2 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillStyle = th.text;
  ctx.globalAlpha = .75;
  ctx.fillText('Boundaries: ' + (APP.meta ? APP.meta.source : '') + ' · ' + (APP.meta ? APP.meta.licence : ''), W - pad, y + 42 * k);
  ctx.globalAlpha = 1;
}

function niceLen(m) {
  const steps = [10,20,50,100,200,250,500,1000,2000,2500,5000,10000,20000,25000,50000];
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i] <= m) return steps[i];
  return 10;
}
function drawScaleBar(ctx, W, H, k, th, v, o) {
  const lat = uy(v.cy) * D2R;
  const pxPerM = v.scale / Math.cos(lat);
  const target = 150 * k;
  const m = niceLen(target / pxPerM);
  const w = m * pxPerM;
  const x = 16 * k, y = H - (S.layers.titleBlk ? tbHeight(k, o) : 0) - 22 * k;
  ctx.save();
  ctx.fillStyle = th.furn; ctx.globalAlpha = .88;
  roundRect(ctx, x - 6 * k, y - 15 * k, w + 12 * k, 27 * k, 4 * k); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.furnInk; ctx.lineWidth = 1.6 * k;
  ctx.beginPath();
  ctx.moveTo(x, y - 5 * k); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5 * k);
  ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y - 3.5 * k);
  ctx.stroke();
  ctx.fillStyle = th.furnInk; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 500 + ' ' + (10.5 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillText(m >= 1000 ? (m / 1000) + ' km' : m + ' m', x + w / 2, y + 10 * k);
  ctx.restore();
}
function drawNorth(ctx, W, H, k, th, o) {
  const x = W - 34 * k, y = H - (S.layers.titleBlk ? tbHeight(k, o) : 0) - 44 * k;
  ctx.save();
  ctx.fillStyle = th.furn; ctx.globalAlpha = .88;
  ctx.beginPath(); ctx.arc(x, y, 19 * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = th.edge; ctx.lineWidth = 1 * k; ctx.stroke();
  ctx.fillStyle = th.furnInk;
  ctx.beginPath();
  ctx.moveTo(x, y - 12 * k); ctx.lineTo(x + 6 * k, y + 7 * k); ctx.lineTo(x, y + 3 * k);
  ctx.lineTo(x - 6 * k, y + 7 * k); ctx.closePath(); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 700 + ' ' + (9 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillText('N', x, y - 13 * k);
  ctx.restore();
}
function drawLegend(ctx, W, H, k, th, o) {
  const vis = S.groups.filter(g => g.visible && g.subs.length);
  if (!vis.length) return;
  const pad = 12 * k, row = 19 * k, fs = 11.5 * k;
  ctx.font = 500 + ' ' + fs + "px 'IBM Plex Sans',system-ui,sans-serif";
  let wmax = 0;
  const rows = vis.map(g => {
    const txt = g.name + '  (' + g.subs.length + ')';
    wmax = Math.max(wmax, ctx.measureText(txt).width);
    return { g, txt };
  });
  ctx.font = 600 + ' ' + (12 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  wmax = Math.max(wmax, ctx.measureText('Groups').width);
  const bw = wmax + pad * 2 + 24 * k, bh = pad * 2 + 20 * k + rows.length * row;
  const m = 14 * k, tb = S.layers.titleBlk ? tbHeight(k, o) : 0;
  let x, y;
  if (S.legendPos === 'tl') { x = m; y = m; }
  else if (S.legendPos === 'tr') { x = W - bw - m; y = m; }
  else if (S.legendPos === 'bl') { x = m; y = H - tb - bh - m - (S.layers.scale ? 34 * k : 0); }
  else { x = W - bw - m; y = H - tb - bh - m - (S.layers.north ? 78 * k : 0); }
  ctx.save();
  ctx.fillStyle = th.furn; ctx.globalAlpha = .94;
  roundRect(ctx, x, y, bw, bh, 6 * k); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = th.edge; ctx.lineWidth = 1 * k; ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = th.furnInk;
  ctx.font = 600 + ' ' + (12 * k) + "px 'IBM Plex Sans',system-ui,sans-serif";
  ctx.fillText('Groups', x + pad, y + pad + 7 * k);
  rows.forEach((r, i) => {
    const ry = y + pad + 22 * k + i * row + row / 2 - 2 * k;
    ctx.fillStyle = hexA(r.g.fill, Math.max(.28, r.g.opacity));
    roundRect(ctx, x + pad, ry - 6 * k, 15 * k, 12 * k, 2.5 * k); ctx.fill();
    ctx.strokeStyle = r.g.line; ctx.lineWidth = Math.max(1.3, r.g.width * .75) * k; ctx.stroke();
    ctx.fillStyle = th.furnInk;
    ctx.font = 500 + ' ' + fs + "px 'IBM Plex Sans',system-ui,sans-serif";
    ctx.fillText(r.txt, x + pad + 24 * k, ry);
  });
  ctx.restore();
}

/* ---------- serialise ---------- */
APP.snapshot = function () {
  return {
    v: 2,
    title: S.title, subtitle: S.subtitle, by: S.by,
    theme: S.theme, layers: Object.assign({}, S.layers), legendPos: S.legendPos,
    view: { cx: S.view.cx, cy: S.view.cy, scale: S.view.scale },
    groups: S.groups.map(g => ({
      name: g.name, subs: g.subs.slice(), line: g.line, width: g.width, dash: g.dash,
      fill: g.fill, opacity: g.opacity, visible: g.visible,
      custom: g.custom ? g.custom.map(p => p.map(r => r.map(c => [+c[0].toFixed(5), +c[1].toFixed(5)]))) : null,
    })),
    texts: S.texts.map(t => Object.assign({}, t)),
    shapes: S.shapes.map(s => Object.assign({}, s, { pts: s.pts.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]) })),
  };
};
APP.restore = function (d) {
  if (!d || !d.groups) throw new Error('That file does not look like a saved map.');
  S.title = d.title || ''; S.subtitle = d.subtitle || ''; S.by = d.by || '';
  S.theme = THEMES[d.theme] ? d.theme : 'light';
  Object.assign(S.layers, d.layers || {});
  S.legendPos = d.legendPos || 'br';
  gid = 1;
  S.groups = d.groups.map((g, i) => {
    const ng = APP.makeGroup(g.name || 'Group ' + (i + 1), g.subs || [], i);
    ng.line = g.line || ng.line; ng.width = g.width ?? ng.width; ng.dash = g.dash || 0;
    ng.fill = g.fill || ng.fill; ng.opacity = g.opacity ?? ng.opacity;
    ng.visible = g.visible !== false;
    ng.custom = g.custom || null;
    dissolve(ng);
    return ng;
  });
  S.texts = (d.texts || []).map(t => Object.assign({}, t));
  S.shapes = (d.shapes || []).map(s => Object.assign({}, s));
  if (d.view && isFinite(d.view.scale)) Object.assign(S.view, d.view);
  S.selText = null; S.selShape = null; S.selGroup = 0;
};

/* GeoJSON out — for loading straight into the council's own GIS */
APP.geojson = function () {
  const fs = [];
  for (const g of S.groups) {
    if (!g._out || !g._out.length) continue;
    fs.push({
      type: 'Feature',
      properties: { group: g.name, suburbs: g.subs.join('; '), suburb_count: g.subs.length,
                    line_colour: g.line, hand_edited: !!g.custom },
      geometry: { type: 'MultiPolygon', coordinates: g._out },
    });
  }
  for (const s of S.shapes) {
    fs.push({
      type: 'Feature',
      properties: { label: s.label || 'Drawn shape', kind: s.closed ? 'area' : 'line' },
      geometry: s.closed
        ? { type: 'Polygon', coordinates: [s.pts.concat([s.pts[0]])] }
        : { type: 'LineString', coordinates: s.pts },
    });
  }
  for (const t of S.texts) {
    fs.push({ type: 'Feature', properties: { label: t.text, kind: 'text' },
              geometry: { type: 'Point', coordinates: [t.lng, t.lat] } });
  }
  return { type: 'FeatureCollection',
           crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
           metadata: { title: S.title, subtitle: S.subtitle, generated: new Date().toISOString(),
                       source: APP.meta && APP.meta.source },
           features: fs };
};
})();

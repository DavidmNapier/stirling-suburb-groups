/* ============================================================
   Suburb Groups — interaction, panels, export, saving
   ============================================================ */
(function () {
'use strict';
const S = APP.S, P = APP.proj;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const cv = $('#map'), ctx = cv.getContext('2d', { alpha: false });
let W = 0, H = 0, dpr = 1, need = true, handles = [], hoverSub = null;

/* ---------- plumbing ---------- */
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._t); t._t = setTimeout(() => t.className = '', err ? 5200 : 2600);
}
const paint = () => { need = true; };

let goodFit = false;

/* The frame's height is not something we can assume. Read it from whichever
   source answers sensibly, and write it back onto #app as real pixels so a
   frame that sizes itself to its content converges instead of collapsing. */
function viewportH() {
  const c = [window.visualViewport && window.visualViewport.height,
             window.innerHeight, document.documentElement.clientHeight];
  const h = Math.max.apply(null, c.map(n => (typeof n === 'number' && isFinite(n)) ? n : 0));
  return h > 200 ? Math.round(h) : 760;      // 760 = a workable default when nobody knows
}
function sizeShell() {
  const app = document.getElementById('app');
  if (app) app.style.height = viewportH() + 'px';
}

/* If the map still has no room, say so on screen with the actual numbers
   rather than showing an empty rectangle. */
function diagnose() {
  const mw = cv.parentElement.getBoundingClientRect();
  const el = document.getElementById('diag');
  if (!el) return;
  if (mw.height > 60) { el.hidden = true; return; }
  const n = v => Math.round(v || 0);
  el.innerHTML = '<b>The map area has no height in this frame.</b><br>build b3 · ' + [
    'innerHeight ' + n(window.innerHeight),
    'clientHeight ' + n(document.documentElement.clientHeight),
    'visualViewport ' + (window.visualViewport ? n(window.visualViewport.height) : 'n/a'),
    'body ' + n(document.body.getBoundingClientRect().height),
    'app ' + n(document.getElementById('app').getBoundingClientRect().height),
    'main ' + n(document.querySelector('main').getBoundingClientRect().height),
    'mapwrap ' + n(mw.height) + '×' + n(mw.width),
    'canvas ' + n(cv.width) + '×' + n(cv.height),
    'dpr ' + (window.devicePixelRatio || 1),
  ].join(' · ') + '<br>Send this line back to Claude.';
  el.hidden = false;
  document.body.style.overflow = 'auto';
}

function resize() {
  sizeShell();
  const r = cv.parentElement.getBoundingClientRect();
  let w = Math.round(r.width), h = Math.round(r.height);
  if (w < 2 || h < 2) {
    /* Some mobile web views report zero until the frame has settled.
       Fall back to the viewport and try again on the next frame. */
    const hd = document.querySelector('header');
    const hh = hd ? hd.getBoundingClientRect().height || 46 : 46;
    w = Math.round(document.documentElement.clientWidth || window.innerWidth || 360);
    h = Math.round((window.innerHeight || document.documentElement.clientHeight || 640) - hh);
    if (!resize._retry) { resize._retry = 1; requestAnimationFrame(() => { resize._retry = 0; resize(); }); }
  }
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, w); H = Math.max(1, h);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  if (!goodFit && W > 60 && H > 60 && APP.SUBS && APP.SUBS.length) {
    goodFit = true; Object.assign(S.view, APP.fitView(W, H - 90));
  }
  paint();
}

function frame() {
  if (need) {
    need = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.tool === 'vertex') computeHandles(); else handles = [];
    APP.draw(ctx, W, H, S.view, {
      k: 1, hoverSub, handles, selText: S.selText, selShape: S.selShape, bottomInset: 26,
    });
  }
  requestAnimationFrame(frame);
}

const t = () => APP.T(S.view, W, H);
const toLngLat = (sx, sy) => { const tt = t(); return [P.ux(tt.ix(sx)), P.uy(tt.iy(sy))]; };
const toScreen = (lng, lat) => { const tt = t(); return [tt.x(P.px(lng)), tt.y(P.py(lat))]; };

/* ---------- vertex handles ---------- */
function computeHandles() {
  handles = [];
  const g = S.groups[S.selGroup]; if (!g || !g._out || !g._out.length) return;
  const tt = t(); let n = 0;
  for (let pi = 0; pi < g._out.length; pi++) {
    const poly = g._out[pi];
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      for (let vi = 0; vi < ring.length - 1; vi++) {
        const X = tt.x(P.px(ring[vi][0])), Y = tt.y(P.py(ring[vi][1]));
        if (X < -10 || X > W + 10 || Y < -10 || Y > H + 10) continue;
        if (++n > 900) { handles._many = true; return; }
        handles.push({ pi, ri, vi, X, Y, hot: drag && drag.kind === 'vertex' && drag.pi === pi && drag.ri === ri && drag.vi === vi });
      }
    }
  }
}
function ensureCustom(g) {
  if (!g.custom) g.custom = g._out.map(p => p.map(r => r.map(v => [v[0], v[1]])));
  g._out = g.custom;
}

/* ---------- pointer interaction ---------- */
let drag = null, moved = false;

cv.addEventListener('pointerdown', e => {
  if (e.button === 2) return;
  cv.setPointerCapture(e.pointerId);
  const [sx, sy] = local(e); moved = false;

  if (S.tool === 'vertex') {
    const g = S.groups[S.selGroup];
    if (g) {
      const h = pickHandle(sx, sy);
      if (h) {
        if (e.altKey) { deleteVertex(g, h); paint(); return; }
        ensureCustom(g);
        drag = { kind: 'vertex', pi: h.pi, ri: h.ri, vi: h.vi, g }; return;
      }
      const seg = pickSegment(g, sx, sy);
      if (seg) {
        ensureCustom(g);
        const ll = toLngLat(sx, sy);
        const snap = snapOn() ? APP.snapTo(ll[0], ll[1], degPerPx(12)) : null;
        g.custom[seg.pi][seg.ri].splice(seg.vi + 1, 0, snap || ll);
        APP.dissolve(g);
        drag = { kind: 'vertex', pi: seg.pi, ri: seg.ri, vi: seg.vi + 1, g }; paint(); return;
      }
    }
  }

  if (S.tool === 'pan' || S.tool === 'vertex') {
    const tx = pickText(sx, sy);
    if (tx) { drag = { kind: 'text', tx, ox: sx, oy: sy, l0: tx.lng, t0: tx.lat }; S.selText = tx; S.selShape = null; renderAnn(); paint(); return; }
  }

  if (S.underlay && !S.underlay.locked && S.tool === 'pan') {
    drag = e.shiftKey
      ? { kind: 'imgscale', ox: sx, oy: sy, w0: S.underlay.w, h0: S.underlay.h }
      : { kind: 'img', ox: sx, oy: sy, cx0: S.underlay.cx, cy0: S.underlay.cy };
    return;
  }

  drag = { kind: 'pan', ox: sx, oy: sy, cx0: S.view.cx, cy0: S.view.cy };
  cv.classList.add('dragging');
});

cv.addEventListener('pointermove', e => {
  const [sx, sy] = local(e);
  const ll = toLngLat(sx, sy);
  $('#stCoord').textContent = ll[1].toFixed(5) + ', ' + ll[0].toFixed(5);

  if (drag) {
    if (Math.abs(sx - drag.ox) + Math.abs(sy - drag.oy) > 3) moved = true;
    if (drag.kind === 'pan') {
      S.view.cx = drag.cx0 - (sx - drag.ox) / S.view.scale;
      S.view.cy = drag.cy0 + (sy - drag.oy) / S.view.scale;
    } else if (drag.kind === 'vertex') {
      const snap = (snapOn() && !e.shiftKey) ? APP.snapTo(ll[0], ll[1], degPerPx(11)) : null;
      drag.g.custom[drag.pi][drag.ri][drag.vi] = snap || ll;
      const ring = drag.g.custom[drag.pi][drag.ri];
      if (drag.vi === 0) ring[ring.length - 1] = [ring[0][0], ring[0][1]];
      APP.dissolve(drag.g);
      $('#stMode').textContent = snap ? 'Snapped to a street centreline' : 'Free point — release Shift to snap again';
    } else if (drag.kind === 'text') {
      const a = toLngLat(drag.ox, drag.oy);
      drag.tx.lng = drag.l0 + (ll[0] - a[0]); drag.tx.lat = drag.t0 + (ll[1] - a[1]);
    } else if (drag.kind === 'img') {
      S.underlay.cx = drag.cx0 - (sx - drag.ox) / S.view.scale;
      S.underlay.cy = drag.cy0 + (sy - drag.oy) / S.view.scale;
    } else if (drag.kind === 'imgscale') {
      const f = Math.max(.15, 1 + (sx - drag.ox) / 260);
      S.underlay.w = drag.w0 * f; S.underlay.h = drag.h0 * f;
    }
    paint(); return;
  }

  /* hover */
  const hv = $('#hover');
  if (S.tool === 'pan') {
    const s = APP.suburbAt(ll[0], ll[1]);
    if (s !== hoverSub) { hoverSub = s; paint(); }
    if (s) {
      const g = S.groups.find(g => g.subs.includes(s.n));
      hv.innerHTML = '<div>' + s.n + '</div><div class="h2">' + (g ? g.name : 'Not in a group') +
                     ' · ' + s.km2 + ' km²' + (s.lga !== 'Stirling' ? ' · ' + s.lga : '') + '</div>';
      hv.style.display = 'block';
      hv.style.left = Math.min(W - 190, sx + 14) + 'px'; hv.style.top = (sy + 16) + 'px';
    } else hv.style.display = 'none';
  } else {
    if (hoverSub) { hoverSub = null; paint(); }
    hv.style.display = 'none';
    if (S.tool === 'vertex') {
      const h = pickHandle(sx, sy);
      cv.style.cursor = h ? 'move' : 'crosshair';
    }
  }
});

function endDrag(e) {
  cv.classList.remove('dragging');
  if (drag && !moved) click(...local(e));
  if (drag && drag.kind === 'vertex') { autosave(); }
  drag = null; paint();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', () => { drag = null; cv.classList.remove('dragging'); });
cv.addEventListener('pointerleave', () => { $('#hover').style.display = 'none'; if (hoverSub) { hoverSub = null; paint(); } });

function snapOn() { const el = $('#snapOn'); return !el || el.checked; }
function local(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function degPerPx(n) { return n / S.view.scale / 111320; }

function click(sx, sy) {
  const ll = toLngLat(sx, sy);
  if (S.tool === 'pan') {
    const tx = pickText(sx, sy);
    if (tx) { S.selText = tx; openTextEditor(tx, sx, sy); return; }
    const sh = pickShape(sx, sy);
    if (sh) { S.selShape = sh; S.selText = null; renderAnn(); paint(); return; }
    const s = APP.suburbAt(ll[0], ll[1]);
    if (s) toggleSuburb(s.n);
    else { S.selText = null; S.selShape = null; closeTextEditor(); renderAnn(); paint(); }
  } else if (S.tool === 'text') {
    const tx = { id: 'x' + Date.now(), lng: ll[0], lat: ll[1], text: 'New label',
                 size: 15, col: '#1d2226', bold: true, halo: true, bg: false };
    S.texts.push(tx); S.selText = tx; setTool('pan'); renderAnn(); paint();
    openTextEditor(tx, sx, sy); autosave();
  } else if (S.tool === 'draw') {
    if (!S.draft) {
      S.draft = { pts: [] };
      S.draft._live = { id: 'd' + Date.now(), pts: S.draft.pts, closed: false,
                        line: '#c0392b', width: 2.6, dash: 0, fill: '#c0392b', opacity: 0, label: 'Drawn line' };
      S.shapes.push(S.draft._live);
    }
    const snapped = snapOn() ? APP.snapTo(ll[0], ll[1], degPerPx(11)) : null;
    S.draft.pts.push(snapped || ll);
    $('#stMode').textContent = 'Click to keep adding points · Enter to finish as a line · C to close the shape · Esc to cancel';
    paint();
  } else if (S.tool === 'measure') {
    if (!S.measure) S.measure = { pts: [] };
    S.measure.pts.push(ll);
    paint();
  }
}

function toggleSuburb(name) {
  const g = S.groups[S.selGroup]; if (!g) return;
  const from = S.groups.find(x => x.subs.includes(name));
  if (from === g) { g.subs = g.subs.filter(n => n !== name); }
  else {
    if (from) { from.subs = from.subs.filter(n => n !== name); if (from.custom) { from.custom = null; } APP.dissolve(from); }
    g.subs.push(name);
  }
  if (g.custom) { g.custom = null; toast('Hand-drawn edits on this group were cleared'); }
  APP.dissolve(g); renderGroups(); autosave(); paint();
}

function pickText(sx, sy) {
  for (let i = S.texts.length - 1; i >= 0; i--) {
    const tx = S.texts[i], [X, Y] = toScreen(tx.lng, tx.lat);
    const lines = String(tx.text || '').split('\n');
    ctx.font = (tx.bold ? 700 : 500) + ' ' + tx.size + "px 'IBM Plex Sans',system-ui,sans-serif";
    let mw = 0; for (const l of lines) mw = Math.max(mw, ctx.measureText(l).width);
    const bw = mw / 2 + 8, bh = lines.length * tx.size * 1.22 / 2 + 6;
    if (Math.abs(sx - X) < bw && Math.abs(sy - Y) < bh) return tx;
  }
  return null;
}
function pickShape(sx, sy) {
  for (let i = S.shapes.length - 1; i >= 0; i--) {
    const sh = S.shapes[i];
    for (let j = 1; j < sh.pts.length; j++) {
      const a = toScreen(sh.pts[j - 1][0], sh.pts[j - 1][1]), b = toScreen(sh.pts[j][0], sh.pts[j][1]);
      if (distSeg(sx, sy, a[0], a[1], b[0], b[1]) < 7) return sh;
    }
  }
  return null;
}
function pickHandle(sx, sy) {
  let best = null, bd = 100;
  for (const h of handles) {
    const d = (h.X - sx) ** 2 + (h.Y - sy) ** 2;
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function pickSegment(g, sx, sy) {
  if (!g._out) return null;
  const tt = t();
  for (let pi = 0; pi < g._out.length; pi++) for (let ri = 0; ri < g._out[pi].length; ri++) {
    const ring = g._out[pi][ri];
    for (let vi = 0; vi < ring.length - 1; vi++) {
      const ax = tt.x(P.px(ring[vi][0])), ay = tt.y(P.py(ring[vi][1]));
      const bx = tt.x(P.px(ring[vi + 1][0])), by = tt.y(P.py(ring[vi + 1][1]));
      if (Math.min(ax, bx) - 8 > sx || Math.max(ax, bx) + 8 < sx) continue;
      if (Math.min(ay, by) - 8 > sy || Math.max(ay, by) + 8 < sy) continue;
      if (distSeg(sx, sy, ax, ay, bx, by) < 6) return { pi, ri, vi };
    }
  }
  return null;
}
function distSeg(px_, py_, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let tt = l ? ((px_ - ax) * dx + (py_ - ay) * dy) / l : 0;
  tt = Math.max(0, Math.min(1, tt));
  return Math.hypot(px_ - (ax + tt * dx), py_ - (ay + tt * dy));
}
function deleteVertex(g, h) {
  ensureCustom(g);
  const ring = g.custom[h.pi][h.ri];
  if (ring.length <= 5) { toast('That outline is already as simple as it can get', true); return; }
  ring.splice(h.vi, 1);
  if (h.vi === 0) ring[ring.length - 1] = [ring[0][0], ring[0][1]];
  APP.dissolve(g); autosave();
}

/* zoom */
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const [sx, sy] = local(e);
  zoomAt(sx, sy, Math.pow(1.0016, -e.deltaY * (e.deltaMode === 1 ? 18 : 1)));
}, { passive: false });
function zoomAt(sx, sy, f) {
  const tt = t(), wx = tt.ix(sx), wy = tt.iy(sy);
  S.view.scale = Math.max(0.0008, Math.min(1.2, S.view.scale * f));
  const t2 = APP.T(S.view, W, H);
  S.view.cx += wx - t2.ix(sx); S.view.cy += wy - t2.iy(sy);
  paint();
}
$('#btnZin').onclick = () => zoomAt(W / 2, H / 2, 1.45);
$('#btnZout').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.45);
$('#btnFit').onclick = () => { Object.assign(S.view, APP.fitView(W, H - 90)); paint(); };

/* pinch */
let pinch = null;
cv.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const r = cv.getBoundingClientRect();
    pinch = { d: tdist(e), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
              cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
    drag = null;
  }
}, { passive: true });
cv.addEventListener('touchmove', e => {
  if (pinch && e.touches.length === 2) {
    e.preventDefault();
    const d = tdist(e); zoomAt(pinch.cx, pinch.cy, d / pinch.d); pinch.d = d;
  }
}, { passive: false });
cv.addEventListener('touchend', () => { pinch = null; }, { passive: true });
function tdist(e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }

/* ---------- tools ---------- */
const MODES = {
  pan: 'Click a suburb to move it in or out of the selected group',
  vertex: 'Drag a handle to reshape · click a line to add a point · Alt-click to remove one',
  text: 'Click on the map to drop a text box',
  draw: 'Click to place points · Enter finishes a line · C closes it into an area',
  measure: 'Click along the route · Esc clears',
};
function updateStatus() {
  const g = S.groups[S.selGroup], base = MODES[S.tool] || '';
  $('#stMode').textContent = (S.tool === 'pan' || S.tool === 'vertex') && g
    ? g.name.split('\u2014')[0].trim() + ' · ' + base : base;
}
function setTool(tl) {
  if (S.tool === 'draw' && tl !== 'draw') finishDraw(false);
  if (tl !== 'measure') S.measure = null;
  S.tool = tl;
  $$('#rail .tool').forEach(b => b.classList.toggle('on', b.dataset.tool === tl));
  cv.classList.toggle('pick', tl !== 'pan');
  updateStatus();
  if (tl === 'vertex' && !S.groups[S.selGroup]) toast('Pick a group in the panel first');
  paint();
}
$$('#rail .tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));

function finishDraw(close) {
  if (!S.draft) return;
  const live = S.draft._live;
  if (live && S.draft.pts.length >= 2) {
    live.closed = !!close;
    if (close) { live.opacity = 0.12; live.label = 'Drawn area'; }
    S.selShape = live;
  } else { S.shapes = S.shapes.filter(x => x !== live); }
  S.draft = null; renderAnn(); autosave(); paint();
}

/* ---------- keyboard ---------- */
addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === 'Escape') {
    if (S.draft) { S.shapes = S.shapes.filter(x => x !== S.draft._live); S.draft = null; }
    else if (S.measure) S.measure = null;
    else if (S.underlay && !S.underlay.locked) { S.underlay.locked = true; $('#imgLock').checked = true; }
    else { S.selText = null; S.selShape = null; closeTextEditor(); }
    $$('.modal.show').forEach(m => m.classList.remove('show'));
    renderAnn(); paint(); return;
  }
  if (e.key === 'Enter' && S.draft) { finishDraw(false); setTool('pan'); return; }
  if ((e.key === 'c' || e.key === 'C') && S.draft) { finishDraw(true); setTool('pan'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (S.selText) { S.texts = S.texts.filter(x => x !== S.selText); S.selText = null; closeTextEditor(); }
    else if (S.selShape) { S.shapes = S.shapes.filter(x => x !== S.selShape); S.selShape = null; }
    renderAnn(); autosave(); paint(); return;
  }
  if (e.key >= '1' && e.key <= '9') { const i = +e.key - 1; if (S.groups[i]) { S.selGroup = i; renderGroups(); paint(); } }
  if (e.key === 'f' || e.key === 'F') $('#btnFit').click();
  if (e.key === '+' || e.key === '=') $('#btnZin').click();
  if (e.key === '-') $('#btnZout').click();
  if (e.key === 'v' || e.key === 'V') setTool('vertex');
  if (e.key === 'p' || e.key === 'P') setTool('pan');
  if (e.key === 't' || e.key === 'T') setTool('text');
});

/* ---------- sidebar: groups ---------- */
function renderGroups() {
  const box = $('#grpList'); box.innerHTML = '';
  S.groups.forEach((g, i) => {
    const el = document.createElement('div');
    el.className = 'grp' + (i === S.selGroup ? ' sel open' : '');
    el.innerHTML =
      '<div class="grphead"><span class="swatch" style="background:' + APP.hexA(g.fill, Math.max(.35, g.opacity)) + ';border-color:' + g.line + '"></span>' +
      '<span class="grpname"></span><span class="grpmeta">' + g.subs.length + '</span>' +
      '<button class="eye' + (g.visible ? '' : ' off') + '" title="Show or hide"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>' +
      '<div class="grpbody">' +
        '<input type="text" class="gname" value="">' +
        '<div class="row"><label>Line colour</label><input type="color" class="gline" value="' + g.line + '"></div>' +
        '<div class="rowv"><label>Line width</label><input type="range" class="gwidth" min="0.5" max="9" step="0.5" value="' + g.width + '"><span class="val">' + g.width + '</span></div>' +
        '<div class="row"><label>Line style</label><select class="gdash"><option value="0">Solid</option><option value="8">Dashed</option><option value="3">Dotted</option></select></div>' +
        '<div class="row"><label>Shading</label><input type="color" class="gfill" value="' + g.fill + '"></div>' +
        '<div class="rowv"><label>Shade depth</label><input type="range" class="gop" min="0" max="60" step="1" value="' + Math.round(g.opacity * 100) + '"><span class="val">' + Math.round(g.opacity * 100) + '</span></div>' +
        '<div><span class="fieldlab">Suburbs — click to remove</span><div class="chips gchips"></div></div>' +
        '<div class="btnrow"><button class="minibtn grev" style="display:' + (g.custom ? 'block' : 'none') + '">Undo hand edits</button>' +
        '<button class="minibtn warn gdel" style="margin-left:auto">Delete group</button></div>' +
      '</div>';
    el.querySelector('.grpname').textContent = g.name;
    el.querySelector('.gname').value = g.name;
    el.querySelector('.gdash').value = String(g.dash || 0);
    const chips = el.querySelector('.gchips');
    g.subs.slice().sort().forEach(n => {
      const c = document.createElement('button');
      c.className = 'chip'; c.innerHTML = '<span></span><span class="x">×</span>';
      c.firstChild.textContent = n;
      c.onclick = ev => { ev.stopPropagation(); g.subs = g.subs.filter(x => x !== n); g.custom = null; APP.dissolve(g); renderGroups(); autosave(); paint(); };
      chips.appendChild(c);
    });
    el.querySelector('.grphead').onclick = ev => {
      if (ev.target.closest('.eye')) { g.visible = !g.visible; renderGroups(); autosave(); paint(); return; }
      S.selGroup = i; renderGroups(); paint();
    };
    const on = (sel, ev, fn) => el.querySelector(sel).addEventListener(ev, fn);
    on('.gname', 'input', e => { g.name = e.target.value; el.querySelector('.grpname').textContent = g.name; paint(); autosave(); });
    on('.gline', 'input', e => { g.line = e.target.value; paint(); autosave(); });
    on('.gfill', 'input', e => { g.fill = e.target.value; paint(); autosave(); });
    on('.gwidth', 'input', e => { g.width = +e.target.value; e.target.nextElementSibling.textContent = g.width; paint(); autosave(); });
    on('.gop', 'input', e => { g.opacity = +e.target.value / 100; e.target.nextElementSibling.textContent = e.target.value; paint(); autosave(); });
    on('.gdash', 'change', e => { g.dash = +e.target.value; paint(); autosave(); });
    on('.grev', 'click', () => { g.custom = null; APP.dissolve(g); renderGroups(); autosave(); paint(); toast('Back to the suburb boundaries'); });
    on('.gdel', 'click', ev => {
      const b = ev.target;
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1'; b.textContent = 'Really delete?';
        setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Delete group'; } }, 3500);
        return;
      }
      S.groups.splice(i, 1); S.selGroup = Math.max(0, Math.min(S.selGroup, S.groups.length - 1));
      renderGroups(); autosave(); paint(); toast('Group deleted — its suburbs are now unassigned');
    });
    box.appendChild(el);
  });
  updateStatus();
  $('#grpCount').textContent = S.groups.length;
  const assigned = new Set(S.groups.flatMap(g => g.subs));
  const un = APP.SUBS.filter(s => !assigned.has(s.n));
  $('#unCount').textContent = un.length;
  const ul = $('#unList'); ul.innerHTML = '';
  if (!un.length) ul.innerHTML = '<p class="hint">Every suburb belongs to a group.</p>';
  un.forEach(s => {
    const c = document.createElement('button'); c.className = 'chip';
    c.textContent = s.n + ' +';
    c.title = 'Add to ' + (S.groups[S.selGroup] ? S.groups[S.selGroup].name : 'the selected group');
    c.onclick = () => toggleSuburb(s.n);
    ul.appendChild(c);
  });
}

$('#btnAddGrp').onclick = () => {
  S.groups.push(APP.makeGroup('Group ' + (S.groups.length + 1), [], S.groups.length));
  S.selGroup = S.groups.length - 1; renderGroups(); autosave(); paint();
};
$('#btnAllRed').onclick = () => { $('#allCol').value = S.groups[0] ? S.groups[0].line : '#c0392b'; $('#allCol').click(); };
$('#allCol').oninput = e => { S.groups.forEach(g => g.line = e.target.value); renderGroups(); autosave(); paint(); };

/* ---------- sidebar: annotations ---------- */
function renderAnn() {
  const box = $('#annList'); box.innerHTML = '';
  const items = [...S.texts.map(x => ({ t: 'text', x })), ...S.shapes.map(x => ({ t: 'shape', x }))];
  $('#annCount').textContent = items.length || '';
  if (!items.length) { box.innerHTML = '<p class="hint">Nothing added yet.</p>'; return; }
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'plan'; el.style.marginBottom = '6px';
    const nm = it.t === 'text' ? (it.x.text || '(empty)').split('\n')[0] : (it.x.label || 'Shape');
    el.innerHTML = '<span class="nm"></span><button class="minibtn warn" style="padding:3px 7px">Remove</button>';
    el.querySelector('.nm').textContent = (it.t === 'text' ? '“' + nm + '”' : nm + ' · ' + it.x.pts.length + ' points');
    if (it.x === S.selText || it.x === S.selShape) el.style.borderColor = 'var(--accent)';
    el.querySelector('.nm').onclick = () => {
      if (it.t === 'text') { S.selText = it.x; S.selShape = null; renderAnn(); const [X, Y] = toScreen(it.x.lng, it.x.lat); openTextEditor(it.x, X, Y); }
      else { S.selShape = it.x; S.selText = null; renderAnn(); }
      paint();
    };
    el.querySelector('button').onclick = () => {
      if (it.t === 'text') S.texts = S.texts.filter(x => x !== it.x); else S.shapes = S.shapes.filter(x => x !== it.x);
      S.selText = S.selShape = null; closeTextEditor(); renderAnn(); autosave(); paint();
    };
    box.appendChild(el);
  });
  if (S.selShape) openShapeEditor(S.selShape);
}
function openShapeEditor(sh) {
  const box = $('#annList');
  const el = document.createElement('div');
  el.className = 'grp open'; el.style.marginTop = '8px';
  el.innerHTML = '<div class="grpbody" style="display:flex">' +
    '<input type="text" class="slab" value="">' +
    '<div class="row"><label>Line colour</label><input type="color" class="sline" value="' + sh.line + '"></div>' +
    '<div class="rowv"><label>Line width</label><input type="range" class="swidth" min="0.5" max="9" step="0.5" value="' + sh.width + '"><span class="val">' + sh.width + '</span></div>' +
    '<div class="row"><label>Line style</label><select class="sdash"><option value="0">Solid</option><option value="8">Dashed</option><option value="3">Dotted</option></select></div>' +
    '<div class="rowv"><label>Shading</label><input type="range" class="sop" min="0" max="60" value="' + Math.round(sh.opacity * 100) + '"><span class="val">' + Math.round(sh.opacity * 100) + '</span></div>' +
    '</div>';
  el.querySelector('.slab').value = sh.label || '';
  el.querySelector('.sdash').value = String(sh.dash || 0);
  el.querySelector('.slab').oninput = e => { sh.label = e.target.value; autosave(); };
  el.querySelector('.sline').oninput = e => { sh.line = e.target.value; sh.fill = e.target.value; paint(); autosave(); };
  el.querySelector('.swidth').oninput = e => { sh.width = +e.target.value; e.target.nextElementSibling.textContent = sh.width; paint(); autosave(); };
  el.querySelector('.sdash').onchange = e => { sh.dash = +e.target.value; paint(); autosave(); };
  el.querySelector('.sop').oninput = e => { sh.opacity = +e.target.value / 100; if (sh.opacity > 0) sh.closed = true; e.target.nextElementSibling.textContent = e.target.value; paint(); autosave(); };
  box.appendChild(el);
}

/* ---------- text editor popover ---------- */
function openTextEditor(tx, sx, sy) {
  const p = $('#tedit'); p.style.display = 'block';
  p.style.left = Math.max(8, Math.min(W - 244, sx - 116)) + 'px';
  p.style.top = Math.max(8, Math.min(H - 250, sy + 18)) + 'px';
  $('#teText').value = tx.text; $('#teSize').value = tx.size; $('#teSizeV').textContent = tx.size;
  $('#teCol').value = tx.col; $('#teHalo').checked = !!tx.halo; $('#teBold').checked = !!tx.bold;
  $('#teText').focus(); $('#teText').select();
  p._tx = tx;
}
function closeTextEditor() { $('#tedit').style.display = 'none'; $('#tedit')._tx = null; }
$('#teText').oninput = e => { const tx = $('#tedit')._tx; if (tx) { tx.text = e.target.value; renderAnn(); paint(); } };
$('#teSize').oninput = e => { const tx = $('#tedit')._tx; if (tx) { tx.size = +e.target.value; $('#teSizeV').textContent = tx.size; paint(); } };
$('#teCol').oninput = e => { const tx = $('#tedit')._tx; if (tx) { tx.col = e.target.value; paint(); } };
$('#teHalo').onchange = e => { const tx = $('#tedit')._tx; if (tx) { tx.halo = e.target.checked; paint(); } };
$('#teBold').onchange = e => { const tx = $('#tedit')._tx; if (tx) { tx.bold = e.target.checked; paint(); } };
$('#teDel').onclick = () => { const tx = $('#tedit')._tx; S.texts = S.texts.filter(x => x !== tx); S.selText = null; closeTextEditor(); renderAnn(); autosave(); paint(); };
$('#teDone').onclick = () => { closeTextEditor(); autosave(); };

/* ---------- layers & furniture ---------- */
function bindTog(id, key) {
  const el = $(id); el.checked = S.layers[key];
  el.onchange = () => { S.layers[key] = el.checked; paint(); autosave(); };
}
['lyStreets:streets','lyRoads:roads','lySub:subs','lyCtx:ctx','lyLga:lga','lyFill:fill','lyLegend:legend',
 'lyScale:scale','lyNorth:north','lyTitleBlk:titleBlk','lyGrpLab:grpLab']
  .forEach(s => { const [a, b] = s.split(':'); bindTog('#' + a, b); });

function seg(id, get, set) {
  const box = $(id);
  const sync = () => $$(id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === String(get())));
  box.onclick = e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); sync(); paint(); autosave(); };
  sync(); return sync;
}
const syncBase = seg('#segBase', () => S.theme, v => S.theme = v);
const syncLeg = seg('#segLeg', () => S.legendPos, v => S.legendPos = v);
$('#mTitle').value = S.title; $('#mSub').value = S.subtitle;
$('#mTitle').oninput = e => { S.title = e.target.value; paint(); autosave(); };
$('#mSub').oninput = e => { S.subtitle = e.target.value; paint(); autosave(); };

/* ---------- underlay image ---------- */
$('#btnImg').onclick = () => $('#fileImg').click();
$('#fileImg').onchange = e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const bb = APP.visibleBBox(W, H, S.view);
      const vw = (bb[2] - bb[0]) * 0.92, vh = vw * img.height / img.width;
      S.underlay = { img, cx: S.view.cx, cy: S.view.cy, w: vw, h: vh, op: 1, locked: false };
      $('#imgCtl').style.display = 'block'; $('#btnImgClear').style.display = 'block';
      $('#imgLock').checked = false;
      toast('Drag the image to line it up, then lock it');
      paint();
    };
    img.onerror = () => toast('That image could not be read', true);
    img.src = rd.result;
  };
  rd.onerror = () => toast('That image could not be read', true);
  rd.readAsDataURL(f);
  e.target.value = '';
};
$('#btnImgClear').onclick = () => {
  S.underlay = null; $('#imgCtl').style.display = 'none'; $('#btnImgClear').style.display = 'none'; paint();
};
$('#imgOp').oninput = e => { if (S.underlay) { S.underlay.op = +e.target.value / 100; $('#imgOpV').textContent = e.target.value; paint(); } };
$('#imgLock').onchange = e => { if (S.underlay) S.underlay.locked = e.target.checked; };

/* ---------- modals ---------- */
function open(id) { $(id).classList.add('show'); }
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('show'));
$$('.modal').forEach(m => m.onclick = e => { if (e.target === m) m.classList.remove('show'); });
$('#btnSide').onclick = () => {
  if (innerWidth <= 900) document.body.classList.toggle('side-open');
  else document.body.classList.toggle('side-closed');
  setTimeout(resize, 30);
};
$('#scrim').onclick = () => document.body.classList.remove('side-open');

/* ---------- export ---------- */
const PAGES = { a4: [297, 210], a3: [420, 297] };
let expCfg = { page: 'a3', orient: 'l', dpi: 300 };
seg('#segPage', () => expCfg.page, v => { expCfg.page = v; expDims(); });
seg('#segOrient', () => expCfg.orient, v => { expCfg.orient = v; expDims(); });
seg('#segDpi', () => expCfg.dpi, v => { expCfg.dpi = +v; expDims(); });

function pageMM() {
  if (expCfg.page === 'screen') return null;
  const [a, b] = PAGES[expCfg.page];
  return expCfg.orient === 'l' ? [a, b] : [b, a];
}
function expSize() {
  const mm = pageMM();
  if (!mm) return { w: Math.round(W * 2), h: Math.round((H - 26) * 2), mm: null };
  let w = Math.round(mm[0] / 25.4 * expCfg.dpi), h = Math.round(mm[1] / 25.4 * expCfg.dpi);
  const MAX = 86e6;
  if (w * h > MAX) { const f = Math.sqrt(MAX / (w * h)); w = Math.round(w * f); h = Math.round(h * f); }
  return { w, h, mm };
}
function expDims() {
  const s = expSize();
  $('#expDims').innerHTML = '<span style="font-size:12px;color:var(--tx-dim)">' + s.w + ' × ' + s.h + ' pixels' +
    (s.mm ? ' · ' + s.mm[0] + ' × ' + s.mm[1] + ' mm' : '') + '</span>';
  drawPreview();
}

/* build the export view: fit what is on screen into the target page */
function exportView(w, h, tbH) {
  const bb = APP.visibleBBox(W, H - 26, S.view);
  const pad = w * 0.02;
  const availH = h - tbH - pad * 2, availW = w - pad * 2;
  const sc = Math.min(availW / (bb[2] - bb[0]), availH / (bb[3] - bb[1]));
  return { cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 - (tbH / 2) / sc, scale: sc };
}
function renderExport(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { alpha: false });
  const kf = Math.max(0.35, Math.min(w / W, h / (H - 26)));
  const tbH = S.layers.titleBlk ? 62 * kf : 0;
  const v = exportView(w, h, tbH);
  const k = Math.max(0.3, Math.min(v.scale / S.view.scale, kf * 1.8));
  APP.draw(x, w, h, v, { k, kf, titleBlockH: 62, furniture: true });
  return c;
}
let prevTimer = null;
function drawPreview() {
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => {
    const s = expSize(), box = $('#expPrev');
    const bw = Math.min(box.clientWidth || 640, 640), bh = Math.round(bw * s.h / s.w);
    const c = renderExport(bw, bh);
    c.style.width = '100%'; c.style.display = 'block';
    box.innerHTML = ''; box.appendChild(c);
  }, 60);
}
$('#btnExport').onclick = async () => { $('#expBy').value = S.by; open('#mdExport'); await fontsReady(); expDims(); };
$('#expBy').oninput = e => { S.by = e.target.value; drawPreview(); autosave(); };

async function saveFile(name, data) {
  const d = await dl();
  if (!d) { toast('Downloads are not available in this view — try opening the artifact in its own tab', true); return; }
  try {
    await d.save({ filename: name, data });
    toast('Saved ' + name);
  } catch (err) {
    const c = err && err.code;
    if (c === 'declined') return;
    if (c === 'too_large') toast('That file is too big for the destination — try a lower dpi', true);
    else if (c === 'rate_limited') toast('One download at a time — try again in a moment', true);
    else toast('That download did not go through' + (err && err.message ? ': ' + err.message : ''), true);
  }
}
const stamp = () => new Date().toISOString().slice(0, 10);
const slug = () => (S.title || 'suburb-groups').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'map';

$('#expPng').onclick = async () => {
  await fontsReady();
  const s = expSize(), c = renderExport(s.w, s.h);
  c.toBlob(b => saveFile(slug() + '-' + stamp() + '.png', b), 'image/png');
};
$('#expPdf').onclick = async () => {
  await fontsReady();
  const s = expSize();
  const mm = s.mm || [Math.round(s.w / 300 * 25.4), Math.round(s.h / 300 * 25.4)];
  const btn = $('#expPdf'); const old = btn.innerHTML;
  btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
  try {
    const c = renderExport(s.w, s.h);
    const big = s.w * s.h > 22e6;
    const data = big ? c.toDataURL('image/jpeg', 0.94) : c.toDataURL('image/png');
    const JS = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const pdf = new JS({ orientation: mm[0] >= mm[1] ? 'landscape' : 'portrait', unit: 'mm', format: [mm[0], mm[1]], compress: true });
    pdf.addImage(data, big ? 'JPEG' : 'PNG', 0, 0, mm[0], mm[1], undefined, 'FAST');
    pdf.setProperties({ title: S.title || 'Suburb groups', subject: S.subtitle || '', creator: 'Suburb Groups' });
    await saveFile(slug() + '-' + stamp() + '.pdf', pdf.output('blob'));
  } catch (err) {
    toast('The PDF could not be built: ' + (err.message || err), true);
  } finally { btn.innerHTML = old; btn.disabled = false; }
};
$('#expGeo').onclick = () => saveFile(slug() + '-' + stamp() + '.json',
  new Blob([JSON.stringify(APP.geojson())], { type: 'application/json' }));
$('#expSvg').onclick = () => {
  const s = expSize();
  saveFile(slug() + '-' + stamp() + '.svg', new Blob([buildSVG(s.w, s.h)], { type: 'image/svg+xml' }));
};

/* SVG export — vector, for the design team */
function buildSVG(w, h) {
  const k0 = Math.max(0.35, Math.min(w / W, h / (H - 26)));
  const tbH = S.layers.titleBlk ? 62 * k0 : 0;
  const v = exportView(w, h, tbH), tt = APP.T(v, w, h);
  const k = Math.max(0.3, Math.min(v.scale / S.view.scale, k0 * 1.8));
  const th = APP.THEMES[S.theme];
  const esc = t => String(t).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = polys => polys.map(p => p.map(r =>
    'M' + r.map(pt => tt.x(pt[0]).toFixed(1) + ',' + tt.y(pt[1]).toFixed(1)).join('L') + 'Z').join('')).join('');
  let o = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
    '" viewBox="0 0 ' + w + ' ' + h + '"><rect width="' + w + '" height="' + h + '" fill="' + th.sea + '"/>';
  o += '<g id="context" fill="' + th.ctx + '" stroke="' + th.edge + '" stroke-width="' + (0.6 * k) + '">';
  if (S.layers.ctx) for (const c of APP.CTX) o += '<path d="' + d(c.proj) + '" fill-rule="evenodd"/>';
  o += '</g><g id="suburbs" fill="' + th.land + '" stroke="' + th.edge + '" stroke-width="' + (th.edgeW * k) + '">';
  for (const s of APP.SUBS) o += '<path d="' + d(s.proj) + '" fill-rule="evenodd"/>';
  o += '</g>';
  if (S.layers.lga) o += '<path id="council" d="' + d(APP.LGA) + '" fill="none" stroke="' + th.lga +
    '" stroke-width="' + (1.4 * k) + '" stroke-dasharray="' + (9 * k) + ' ' + (5 * k) + '"/>';
  o += '<g id="groups">';
  for (const g of S.groups) {
    if (!g.visible || !g._proj || !g._proj.length) continue;
    const p = d(g._proj);
    o += '<g><title>' + esc(g.name) + '</title>';
    if (S.layers.fill && g.opacity > 0) o += '<path d="' + p + '" fill="' + g.fill + '" fill-opacity="' + g.opacity + '" fill-rule="evenodd"/>';
    o += '<path d="' + p + '" fill="none" stroke="' + g.line + '" stroke-width="' + (g.width * k) +
         '" stroke-linejoin="round"' + (g.dash ? ' stroke-dasharray="' + (g.dash * k) + ' ' + (g.dash * .7 * k) + '"' : '') + '/></g>';
  }
  o += '</g><g id="shapes">';
  for (const sh of S.shapes) {
    const pts = sh.pts.map(p => tt.x(P.px(p[0])).toFixed(1) + ',' + tt.y(P.py(p[1])).toFixed(1)).join(' ');
    o += '<' + (sh.closed ? 'polygon' : 'polyline') + ' points="' + pts + '" fill="' +
      (sh.closed && sh.opacity > 0 ? sh.fill : 'none') + '" fill-opacity="' + (sh.opacity || 0) +
      '" stroke="' + sh.line + '" stroke-width="' + (sh.width * k) + '" stroke-linejoin="round"/>';
  }
  o += '</g><g id="labels" font-family="IBM Plex Sans, Segoe UI, sans-serif" text-anchor="middle">';
  if (S.layers.subs) {
    const fs = Math.max(7, Math.min(15, v.scale * 2600)) * k;
    for (const s of APP.SUBS) o += '<text x="' + tt.x(s.cp[0]).toFixed(1) + '" y="' + (tt.y(s.cp[1]) + fs * .35).toFixed(1) +
      '" font-size="' + fs.toFixed(1) + '" fill="' + th.text + '">' + esc(s.n) + '</text>';
  }
  if (S.layers.grpLab) for (const g of S.groups) {
    if (!g.visible || !g._lp) continue;
    o += '<text x="' + tt.x(g._lp[0]).toFixed(1) + '" y="' + (tt.y(g._lp[1]) - 16 * k).toFixed(1) + '" font-size="' +
      (17 * k).toFixed(1) + '" font-weight="700" fill="' + g.line + '">' + esc(g.name.split('—')[0].trim()) + '</text>';
  }
  for (const tx of S.texts) {
    const X = tt.x(P.px(tx.lng)), Y = tt.y(P.py(tx.lat)), fs = tx.size * k, lines = String(tx.text).split('\n');
    lines.forEach((l, i) => {
      o += '<text x="' + X.toFixed(1) + '" y="' + (Y + (i - (lines.length - 1) / 2) * fs * 1.22 + fs * .35).toFixed(1) +
        '" font-size="' + fs.toFixed(1) + '" font-weight="' + (tx.bold ? 700 : 500) + '" fill="' + tx.col + '">' + esc(l) + '</text>';
    });
  }
  o += '</g>';
  if (S.layers.titleBlk) {
    o += '<g id="titleblock"><rect x="0" y="' + (h - tbH) + '" width="' + w + '" height="' + tbH + '" fill="' + th.furn + '"/>' +
      '<text x="' + (16 * k0) + '" y="' + (h - tbH + 26 * k0) + '" font-family="IBM Plex Sans, sans-serif" font-size="' + (17 * k0) +
      '" font-weight="600" fill="' + th.furnInk + '">' + esc(S.title) + '</text>' +
      '<text x="' + (16 * k0) + '" y="' + (h - tbH + 42 * k0) + '" font-family="IBM Plex Sans, sans-serif" font-size="' + (11.5 * k0) +
      '" fill="' + th.text + '">' + esc(S.subtitle) + '</text></g>';
  }
  return o + '</svg>';
}

/* ---------- capabilities ---------- */
let _dl, _db, _user;
const dl = async () => _dl !== undefined ? _dl : (_dl = window.claude && await claude.use('downloads'));
const getDb = async () => _db !== undefined ? _db : (_db = window.claude && await claude.use('db'));
const getUser = async () => _user !== undefined ? _user : (_user = window.claude && await claude.use('user'));

/* ---------- saving ---------- */
$('#btnSave').onclick = () => { open('#mdSave'); loadPlans(); };
$$('#saveTabs button').forEach(b => b.onclick = () => {
  $$('#saveTabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('#mdSave [data-pane]').forEach(p => p.style.display = p.dataset.pane === b.dataset.t ? '' : 'none');
});
async function loadPlans() {
  const box = $('#planList');
  const db = await getDb();
  if (!db) { box.innerHTML = '<div class="empty">Shared saving is not available in this view. Use the file tab instead.</div>'; return; }
  try {
    const snap = await db.collection('plans').orderBy('savedAt', 'desc').limit(40).get();
    if (snap.empty) { box.innerHTML = '<div class="empty">No saved versions yet. Save one and everyone with the link sees it.</div>'; return; }
    const u = await getUser();
    const ids = [...new Set(snap.docs.map(d => d.data().byId).filter(Boolean))];
    let profs = {};
    if (u && ids.length) { try { profs = await u.profiles(ids); } catch (e) {} }
    box.innerHTML = '';
    snap.docs.forEach(doc => {
      const d = doc.data();
      const el = document.createElement('div'); el.className = 'plan';
      const who = (profs[d.byId] && profs[d.byId].name) || d.byName || '';
      el.innerHTML = '<span class="nm"></span><span class="dt"></span>' +
        '<button class="minibtn ld">Open</button><button class="minibtn warn rm">Delete</button>';
      el.querySelector('.nm').textContent = d.name || '(unnamed)';
      el.querySelector('.dt').textContent = new Date(d.savedAt || 0).toLocaleDateString('en-AU',
        { day: 'numeric', month: 'short' }) + (who ? ' · ' + who : '');
      el.querySelector('.ld').onclick = () => {
        try { APP.restore(d.state); afterLoad(); $('#mdSave').classList.remove('show'); toast('Opened “' + (d.name || '') + '”'); }
        catch (err) { toast(err.message, true); }
      };
      el.querySelector('.rm').onclick = async ev => {
        const b = ev.target;
        if (b.dataset.armed !== '1') {
          b.dataset.armed = '1'; b.textContent = 'Really?';
          setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Delete'; } }, 3500);
          return;
        }
        try { await db.doc('plans/' + doc.id).delete(); toast('Deleted'); loadPlans(); }
        catch (e) { toast('You do not have permission to delete that one', true); }
      };
      box.appendChild(el);
    });
  } catch (e) {
    box.innerHTML = '<div class="empty">Could not read the shared versions. The file tab always works.</div>';
  }
}
$('#btnPlanSave').onclick = async () => {
  const name = $('#planName').value.trim();
  if (!name) { toast('Give the version a name first', true); return; }
  const db = await getDb();
  if (!db) { toast('Shared saving is not available here — use the file tab', true); return; }
  const btn = $('#btnPlanSave'), old = btn.innerHTML;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const u = await getUser();
    let byId = null; try { byId = u && u.id ? await u.id() : null; } catch (e) {}
    const state = APP.snapshot();
    const size = JSON.stringify(state).length;
    if (size > 240000) throw new Error('This version is too big to share (hand-drawn edits add up). Use the file tab.');
    await db.collection('plans').add({ name, savedAt: Date.now(), byId, state });
    $('#planName').value = ''; toast('Saved — anyone with the link can open it'); loadPlans();
  } catch (e) {
    toast(e.message || 'Could not save that version', true);
  } finally { btn.innerHTML = old; }
};
$('#btnFileSave').onclick = () => saveFile(slug() + '-' + stamp() + '.json',
  new Blob([JSON.stringify(APP.snapshot(), null, 1)], { type: 'application/json' }));
$('#btnFileLoad').onclick = () => $('#fileLoad').click();
$('#fileLoad').onchange = e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { APP.restore(JSON.parse(rd.result)); afterLoad(); $('#mdSave').classList.remove('show'); toast('Loaded ' + f.name); }
    catch (err) { toast('That file could not be read: ' + err.message, true); }
  };
  rd.readAsText(f); e.target.value = '';
};
function afterLoad() {
  renderGroups(); renderAnn(); syncBase(); syncLeg();
  $('#mTitle').value = S.title; $('#mSub').value = S.subtitle;
  ['lyStreets:streets','lyRoads:roads','lySub:subs','lyCtx:ctx','lyLga:lga','lyFill:fill','lyLegend:legend',
   'lyScale:scale','lyNorth:north','lyTitleBlk:titleBlk','lyGrpLab:grpLab']
    .forEach(s => { const [a, b] = s.split(':'); $('#' + a).checked = S.layers[b]; });
  autosave(); paint();
}

/* per-viewer autosave, so a refresh does not lose work */
let asT = null;
function autosave() {
  clearTimeout(asT);
  asT = setTimeout(() => { try { localStorage.setItem('stirling.groups.v2', JSON.stringify(APP.snapshot())); } catch (e) {} }, 700);
}

/* ---------- help ---------- */
const HELP = {
start: `<div class="note"><p>Everything you change is kept in this browser automatically. To share it with someone else, use <strong>Save</strong> or export a file.</p></div>
<h3>What you are looking at</h3>
<p>All 30 City of Stirling suburbs, plus Wembley, drawn from the official locality boundaries. The heavy coloured lines are your six groups; a group's outline is simply the outside edge of the suburbs in it, so it always follows real boundaries.</p>
<h3>Moving a suburb between groups</h3>
<ul><li>Click a group in the panel to select it.</li><li>Click any suburb on the map to pull it into that group. Click it again to take it out.</li><li>The outline redraws straight away.</li></ul>
<h3>Getting around</h3>
<ul><li>Drag to pan, scroll or pinch to zoom.</li><li><kbd>F</kbd> zooms to fit, <kbd>+</kbd> and <kbd>−</kbd> zoom, <kbd>1</kbd>–<kbd>9</kbd> pick a group.</li><li>Hover a suburb to see its group and area.</li></ul>`,
lines: `<h3>Moving a line onto a different street</h3>
<p>Choose the group, then pick the <strong>reshape</strong> tool (second in the toolbar, or press <kbd>V</kbd>). Small square handles appear along that group's outline.</p>
<ul><li>Drag a handle to move that point.</li><li>Click anywhere along the line to add a new point there.</li><li><kbd>Alt</kbd> + click a handle removes it.</li><li>Zoom in for finer control — handles only appear for the part of the outline you can see.</li></ul>
<h3>Snapping</h3>
<p>While you drag, the point jumps onto the nearest boundary corner or real street vertex (from OpenStreetMap) when you get close, so your line lands on an actual road rather than near it. The status bar tells you when a point has snapped.</p>
<div class="note"><p>Once you reshape a group by hand, it stops following its suburbs. <strong>Undo hand edits</strong> in the group's settings puts it back.</p></div>
<h3>Line appearance</h3>
<p>Open a group in the panel for its colour, width, and solid, dashed or dotted style, plus how strongly the area is shaded. <strong>All lines one colour</strong> sets every group to the same colour if you want the plain red look.</p>`,
annot: `<h3>Text boxes</h3>
<p>Pick the <strong>T</strong> tool and click where you want the label. A small editor opens for the wording, size, colour, bold, and a white outline that keeps text readable over dark areas. Drag a label to move it; select it and press <kbd>Delete</kbd> to remove it.</p>
<h3>Free-form lines and areas</h3>
<p>The <strong>draw</strong> tool places points one click at a time. <kbd>Enter</kbd> finishes it as a line, <kbd>C</kbd> closes it into a shaded area, <kbd>Esc</kbd> throws it away. Drawn points snap to boundary corners too, so you can trace a street without a group having to change.</p>
<h3>Measuring</h3>
<p>The ruler tool adds up the distance as you click along a route. <kbd>Esc</kbd> clears it.</p>
<h3>An aerial photo underneath</h3>
<p>Under <strong>Base map</strong>, <strong>Load image…</strong> puts any picture behind the map — an aerial export from your own GIS, for example. Drag it to line it up, <kbd>Shift</kbd> + drag to resize, then tick <strong>Lock position</strong>. The image stays on your machine and is never uploaded.</p>`,
out: `<h3>Export</h3>
<p><strong>Export</strong> opens a preview of exactly what you will get. It captures whatever is on screen, so zoom and pan first.</p>
<ul><li><strong>PDF</strong> — A4 or A3, portrait or landscape, up to 600 dpi. This is the one to send to print.</li><li><strong>PNG</strong> — the same image for slides or a report.</li><li><strong>SVG</strong> — vector, so your designers can restyle it in Illustrator or InDesign without it going fuzzy.</li><li><strong>GeoJSON</strong> — the group boundaries as real geography, ready to open in QGIS or ArcGIS. It arrives with a <code>.json</code> ending; rename it to <code>.geojson</code> if your software wants that.</li></ul>
<h3>Sharing your work</h3>
<ul><li><strong>Save → Shared with the team</strong> keeps a named version with this artifact. Anyone you share the link with sees the same list and can open any version.</li><li><strong>Save → File on my computer</strong> downloads the whole setup as a small file. Load it back here any time, or send it to a colleague. This works even when you are signed out.</li></ul>
<h3>Printing well</h3>
<p>A3 landscape at 300 dpi suits a wall map or a council report. Turn off <strong>Group shading</strong> for a cleaner line drawing, and pick the <strong>Plain</strong> base map if the print is black and white.</p>`,
data: `<h3>Where the boundaries come from</h3>
<p id="dsrc"></p>
<p>Each group outline is computed from those polygons, so lines land on the surveyed locality boundary rather than being traced by eye. Boundaries carry roughly a metre of precision here, which is well inside what a strategic map needs.</p>
<h3>Two things worth knowing</h3>
<ul><li><strong>Wembley</strong> sits in the Town of Cambridge, not the City of Stirling. It is included because it was on your list; remove it from Group 3 if the map is meant to stop at the council boundary.</li><li><strong>Churchlands</strong> and <strong>Mount Lawley</strong> straddle a council boundary in real life. The locality dataset gives each suburb whole, so the whole suburb is drawn.</li></ul>
<h3>What this tool does not have</h3>
<p>There is no live aerial or street imagery, because a shared Claude artifact cannot fetch map tiles from the internet. The base maps here are drawn from the boundary data itself, and the <strong>Load image…</strong> option covers the case where you want a real aerial behind the lines.</p>
<h3>Not an authority</h3>
<p>This is a planning and communication tool. For anything with legal or statutory weight, check against the council's own corporate GIS.</p>`,
};
$('#btnHelp').onclick = () => { showHelp('start'); open('#mdHelp'); };
$$('#helpTabs button').forEach(b => b.onclick = () => showHelp(b.dataset.t));
function showHelp(t) {
  $$('#helpTabs button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  $('#helpBody').innerHTML = HELP[t];
  const d = $('#dsrc'); if (d) d.textContent = APP.meta.source + ', released under ' + APP.meta.licence + '. These are the gazetted locality boundaries that Landgate and the ABS both publish.' +
    (APP.meta.roads_source ? ' Streets are from ' + APP.meta.roads_source + ' (' + APP.meta.roads_licence + ').' : '') +
    (APP.meta.satellite ? ' Satellite imagery is ' + APP.meta.satellite.source + ', captured before this map was built — it will not reflect recent changes on the ground.' : '');
}

/* ---------- boot ---------- */
async function fontsReady() { try { await document.fonts.ready; } catch (e) {} }

APP.boot = async function () {
  resize();
  try { new ResizeObserver(resize).observe(cv.parentElement); } catch (e) {}
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 220));
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
  [120, 400, 1200, 2500].forEach(ms => setTimeout(resize, ms));
  setTimeout(diagnose, 1500); setTimeout(diagnose, 3000);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  APP.resetGroups();
  let restored = false;
  try {
    const raw = localStorage.getItem('stirling.groups.v2');
    if (raw) { APP.restore(JSON.parse(raw)); restored = true; }
  } catch (e) {}

  if (goodFit) Object.assign(S.view, APP.fitView(W, H - 90));
  renderGroups(); renderAnn(); syncBase(); syncLeg();
  $('#mTitle').value = S.title; $('#mSub').value = S.subtitle;
  $('#srcNote').textContent = APP.meta.source + ' · ' + APP.meta.licence +
    ' · 31 suburbs, ' + APP.SUBS.reduce((a, s) => a + s.r.reduce((b, p) => b + p[0].length, 0), 0).toLocaleString() + ' boundary points.' +
    (APP.meta.roads_source ? ' Streets: ' + APP.meta.roads_source + ', ' + APP.meta.roads_licence + '.' : '') +
    (APP.meta.satellite ? ' Satellite: ' + APP.meta.satellite.source + '.' : '');
  if (APP.SAT && typeof SATELLITE_B64 !== 'undefined' && SATELLITE_B64) {
    const img = new Image();
    img.onload = () => { APP.SAT.img = img; paint(); };
    img.src = 'data:image/jpeg;base64,' + SATELLITE_B64;
  }
  setTool('pan');
  window.__booted = true;
  paint(); frame();                         // first paint now, not after fonts
  fontsReady().then(paint);                 // refine once the typeface lands
  if (restored) toast('Picked up where you left off');
  if (innerWidth <= 900) document.body.classList.remove('side-open');
};
})();

global.polygonClipping = require('../vendor/polygon-clipping.umd.min.js');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
require('vm').runInThisContext(fs.readFileSync(path.join(ROOT,'src/02_core.js'),'utf8'));
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT,'data/stirling_data.json'),'utf8'));

APP.initData(DATA);
console.log('suburbs loaded:', APP.SUBS.length, '| context:', APP.CTX.length);

console.time('dissolve all groups');
APP.resetGroups();
console.timeEnd('dissolve all groups');

let ok = true;
for (const g of APP.S.groups) {
  const parts = g._out.length;
  const verts = g._out.reduce((a,p)=>a+p.reduce((b,r)=>b+r.length,0),0);
  console.log(`  ${g.name.padEnd(34)} subs=${String(g.subs.length).padStart(2)} parts=${parts} verts=${String(verts).padStart(4)} label=${g._lab?g._lab.map(v=>v.toFixed(4)).join(','):'none'}`);
  if (parts !== 1) { ok = false; console.log('    !! expected a single merged part'); }
  if (!g._lab) ok = false;
}

// label points must sit inside their own outline
for (const g of APP.S.groups) {
  if (!APP.pointInPolys(g._lab[0], g._lab[1], g._out)) { ok=false; console.log('!! label outside outline:', g.name); }
}

// hit testing
const tests = [[115.7900,-31.8700,'Carine'],[115.7600,-31.8950,'Trigg'],[115.8700,-31.9300,'Mount Lawley'],[115.8350,-31.8600,'Balga']];
for (const [ln,lt,exp] of tests) {
  const s = APP.suburbAt(ln,lt);
  const got = s?s.n:'(none)';
  console.log('  hit', ln, lt, '->', got, got===exp?'ok':'EXPECTED '+exp);
}

// snapping
const v = DATA.suburbs[5].r[0][0][10];
const near = APP.snapTo(v[0]+0.00002, v[1]+0.00002, 0.0002);
console.log('snap:', near ? 'found exact vertex ' + (near[0]===v[0]&&near[1]===v[1]) : 'MISS');
console.log('snap far:', APP.snapTo(116.5,-31.9,0.0002) === null ? 'correctly null' : 'FALSE HIT');

// round-trip
const snap = APP.snapshot();
const before = APP.S.groups.map(g=>g.subs.join(','));
APP.restore(JSON.parse(JSON.stringify(snap)));
const after = APP.S.groups.map(g=>g.subs.join(','));
console.log('round-trip groups identical:', JSON.stringify(before)===JSON.stringify(after));
console.log('snapshot size:', Math.round(JSON.stringify(snap).length/1024), 'KB');

// hand-edited outline path
const g0 = APP.S.groups[0];
g0.custom = g0._out.map(p=>p.map(r=>r.map(c=>[c[0],c[1]])));
g0.custom[0][0][5] = [g0.custom[0][0][5][0]+0.001, g0.custom[0][0][5][1]];
APP.dissolve(g0);
console.log('custom outline honoured:', g0._out === g0.custom);
const snap2 = APP.snapshot();
console.log('snapshot with one hand-edited group:', Math.round(JSON.stringify(snap2).length/1024), 'KB');
const all = APP.S.groups.map(g=>{g.custom=g._out.map(p=>p.map(r=>r.map(c=>[c[0],c[1]])));return 1;});
console.log('snapshot if ALL groups hand-edited:', Math.round(JSON.stringify(APP.snapshot()).length/1024), 'KB  (db limit 256 KB)');

// geojson
APP.restore(snap);
const gj = APP.geojson();
console.log('geojson features:', gj.features.length, '| valid types:', gj.features.every(f=>f.geometry&&f.geometry.coordinates));
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');

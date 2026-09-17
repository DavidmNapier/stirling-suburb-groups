global.polygonClipping = require('../vendor/polygon-clipping.umd.min.js');
const fs = require('fs'), path = require('path'), {createCanvas} = require('canvas');
const ROOT = path.join(__dirname, '..');
require('vm').runInThisContext(fs.readFileSync(path.join(ROOT,'src/02_core.js'),'utf8'));
APP.initData(JSON.parse(fs.readFileSync(path.join(ROOT,'data/stirling_data.json'),'utf8')));
APP.resetGroups();
const S = APP.S;
S.title='Service delivery groups'; S.subtitle='City of Stirling · six operational areas'; S.by='Amy';

// a couple of annotations, as a user would add
S.texts.push({id:'t1',lng:115.7800,lat:-31.8560,text:'Depot catchment\nreview area',size:15,col:'#1d2226',bold:true,halo:true,bg:false});
S.shapes.push({id:'s1',pts:[[115.8100,-31.9050],[115.8300,-31.9050],[115.8300,-31.8900],[115.8100,-31.8900]],
               closed:true,line:'#1b4f8a',width:3,dash:8,fill:'#1b4f8a',opacity:0.18,label:'Proposed depot zone'});

function shot(name, W, H, mut) {
  const before = JSON.stringify({theme:S.theme, layers:S.layers});
  if (mut) mut();
  const c = createCanvas(W,H), x = c.getContext('2d');
  const v = APP.fitView(W, H-70);
  APP.draw(x, W, H, v, {k:1, kf:1, titleBlockH:62});
  fs.writeFileSync(name, c.toBuffer('image/png'));
  const st = JSON.parse(before); S.theme = st.theme; Object.assign(S.layers, st.layers);
  console.log('rendered', name, W+'x'+H);
}

shot('r_light.png', 1280, 860);
shot('r_street.png', 1280, 860, ()=>{ S.theme='street'; });
shot('r_dark.png',  1280, 860, ()=>{ S.theme='dark'; });
shot('r_plain.png', 1280, 860, ()=>{ S.theme='plain'; S.layers.fill=false; S.layers.subs=false; });
// print-style export proportions: A3 landscape
shot('r_a3.png', 1684, 1191, ()=>{ S.theme='light'; });
console.log('\nSVG bytes (sanity):', 'n/a here');

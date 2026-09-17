import base64, json, os, pathlib

BASE  = pathlib.Path(__file__).resolve().parent.parent
shell = (BASE / 'src/01_shell.html').read_text(encoding='utf-8')
core  = (BASE / 'src/02_core.js').read_text(encoding='utf-8')
ui    = (BASE / 'src/03_ui.js').read_text(encoding='utf-8')
pc    = (BASE / 'vendor/polygon-clipping.umd.min.js').read_text(encoding='utf-8')
jspdf = (BASE / 'vendor/jspdf.umd.min.js').read_text(encoding='utf-8')
data  = (BASE / 'data/stirling_data.json').read_text(encoding='utf-8')

sat_path = BASE / 'data/satellite.jpg'
sat_b64 = base64.b64encode(sat_path.read_bytes()).decode('ascii') if sat_path.exists() else ''

# strip sourcemap comments so nothing tries to fetch a file that isn't there
for tag in ('//# sourceMappingURL=polygon-clipping.umd.min.js.map',
            '//# sourceMappingURL=jspdf.umd.min.js.map'):
    pc = pc.replace(tag, ''); jspdf = jspdf.replace(tag, '')

guard = '''<script>
/* Surface a start-up failure instead of leaving a blank screen. */
(function(){
  function show(msg){
    try{
      var c=document.getElementById('crash');
      if(!c||!c.hidden) return;
      document.getElementById('crashmsg').textContent=String(msg).slice(0,400);
      c.hidden=false;
    }catch(e){}
  }
  addEventListener('error',function(e){ if(!window.__booted) show(e.message||'Script error'); });
  addEventListener('unhandledrejection',function(e){
    if(!window.__booted) show('Unhandled: '+((e.reason&&e.reason.message)||e.reason));
  });
  window.__showCrash=show;
})();
</script>
'''

bundle = (
    guard +
    '<script>/* polygon-clipping 0.15.7 — MIT */\n' + pc + '\n</script>\n'
    '<script>/* jsPDF 2.5.2 — MIT */\n' + jspdf + '\n</script>\n'
    '<script>const STIRLING_DATA = ' + data + ';</script>\n'
    '<script>const SATELLITE_B64 = "' + sat_b64 + '";</script>\n'
    '<script>\n' + core + '\n</script>\n'
    '<script>\n' + ui + '\n</script>\n'
    '<script>try{ APP.initData(STIRLING_DATA); APP.boot(); }'
    'catch(e){ window.__showCrash && window.__showCrash(e && e.message || e); throw e; }</script>\n'
)

out = shell.replace('</body>', bundle + '</body>')
dest = BASE / 'dist'
dest.mkdir(parents=True, exist_ok=True)
p = dest / 'stirling-suburb-groups.html'
p.write_text(out, encoding='utf-8')
print('wrote', p, round(len(out) / 1024), 'KB')

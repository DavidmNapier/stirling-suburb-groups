# Suburb Groups — City of Stirling

A map viewer that draws outlines around groups of suburbs in the City of Stirling,
Western Australia. Built for a council officer who needs to define service-delivery
groupings, adjust the boundary lines by hand, annotate them and export print-ready
maps.

Everything compiles to one self-contained HTML file. There is no framework, no
bundler and no runtime dependency on the network.

---

## Where this came from

It was built in a claude.ai chat, which publishes to a sandboxed artifact that
**cannot make any network request**. That single constraint shaped every decision
below, and it is the reason the work has moved here. Your machine has no such
restriction, which unblocks the one thing that was impossible before: real street
data.

Read "The open task" before doing anything else.

---

## Current state

Working and verified:

- 31 suburb polygons (all 30 City of Stirling localities plus Wembley), full
  resolution, snapped to a 1.1 m grid so adjacent suburbs share identical edges.
- Six preset groups matching the client's list. Clicking a suburb moves it between
  groups and the outline re-dissolves via `polygon-clipping`.
- Per-group line colour, width, solid/dashed/dotted, fill colour and opacity.
- Vertex editing with snapping, on a per-group "custom outline" that overrides the
  dissolve until reverted.
- Text boxes, free-form drawn lines/areas, a measure tool.
- Four base map styles, an optional user-supplied image underlay.
- Auto legend, scale bar, north arrow, title block, label collision avoidance.
- Export: PDF (A4/A3, to 600 dpi), PNG, SVG, GeoJSON.
- Saving: shared versions via the artifact `db` capability, plus a JSON file, plus
  per-viewer `localStorage` autosave.

Verified headlessly with `node tools/test_core.js` (dissolve, hit-testing against
shapely ground truth, snapping, serialisation round-trip) and
`node tools/test_render.js` (all four themes through the real draw code, via
node-canvas). **Pointer interaction and the download prompts have never been
exercised in a real browser.** That is the first thing to check here.

### Known-unresolved

The published artifact renders its header but the map area comes up blank on at
least one mobile client and one desktop browser. Three fixes have been attempted:

1. `position: fixed` on `#app` — probably counterproductive, since it removes the
   app from flow and a frame that sizes itself to its content then measures zero.
   Reverted.
2. Current approach: push a height out rather than inherit one. `min-height: 600px`
   in CSS as a no-JS floor, and `sizeShell()` writes the measured viewport height
   onto `#app` in pixels.
3. A `#diag` panel that prints the real measurements when `#mapwrap` ends up under
   60 px tall, and a `#crash` panel for uncaught errors before boot.

**This may already be fixed — it was never confirmed.** Serve `dist/` locally and
look before assuming there is still a bug. If the map area has height but does not
draw, the fault is the canvas, not the layout, and the two need different fixes.

---

## Layout

```
src/01_shell.html   markup + all CSS. The <body> content only; the build injects
                    scripts before </body>.
src/02_core.js      projection, state, data prep, spatial index, dissolve,
                    the canvas renderer, serialisation, GeoJSON export.
                    Exposes one global, APP. No DOM access anywhere.
src/03_ui.js        pointer interaction, panels, tools, export, persistence,
                    help text, boot.
data/               the compiled suburb geometry, inlined at build time.
tools/build_data.py regenerates data/ from a source dataset (see below).
tools/assemble.py   concatenates everything into dist/.
vendor/             polygon-clipping and jsPDF, inlined rather than CDN-loaded.
```

Commands:

```bash
npm install                    # canvas is only needed for the render test
python3 tools/assemble.py      # -> dist/stirling-suburb-groups.html
node tools/test_core.js        # geometry + serialisation
node tools/test_render.js      # writes r_*.png to inspect
python3 -m http.server 8000 --directory dist
```

`tools/build_data.py` expects the source GeoJSON at
`data/Australia_Geo_Suburbs-main/WA.geojson` — full-resolution Geoscape
Administrative Boundaries (Localities), via data.gov.au, CC BY 4.0. You only need
it if you are changing the simplification or adding suburbs.

---

## The open task: real streets

The client's brief asked for a selectable street overlay and for boundary lines
that can be dragged onto specific streets. Neither is properly delivered.

What ships today is the locality boundaries restyled to look like roads. Because
locality boundaries in Perth run down arterial centrelines, this gives you
Karrinyup Road, Scarborough Beach Road, Reid Highway, Wanneroo Road, Alexander
Drive and so on — but no residential streets, and snapping targets boundary
vertices rather than actual road geometry.

Two ways to fix it. They are not exclusive.

### A. Embed road centrelines (keeps the shareable artifact)

Fetch OSM road data for the City of Stirling and inline it the same way the suburb
geometry is inlined. Overpass or a Geofabrik extract both work from here.

Rough plan:

1. Pull `highway=*` ways within the LGA bounding box
   (`115.7507, -31.9446, 115.8935, -31.8420`).
2. Split by classification. Motorway/trunk/primary/secondary for the arterial
   layer; residential/tertiary as a separate, zoom-gated layer.
3. Simplify and snap to the same 1e-5 grid the suburbs use, round to 5 dp.
4. Emit the same shape as `data/stirling_data.json` and add a `roads` key.
5. Render in `APP.draw` under the group outlines, with casing, styled per class.
6. Point `APP.snapTo` at road vertices instead of (or as well as) boundary
   vertices — this is the change that makes "snap to roads" literally true.

Budget: the artifact ceiling is 16 MB and the current file is ~0.7 MB, so several
megabytes of road geometry is affordable. Arterials alone should be well under
1 MB. Gate the residential layer on zoom so it does not swamp a city-wide view.

### B. An intranet build with live tiles

The CSP only applies to the published artifact. A standalone HTML file opened
locally or served from the council network can load tiles freely. Leaflet or
MapLibre over the existing canvas layer, with the group outlines as an overlay.

For a WA council, **Landgate's imagery and base map services are the right choice**
over OSM or Esri — the council will already have entitlements, and it is the
imagery their GIS team recognises. Confirm the service URLs and any token
requirement before building against them.

This variant gives up the one-click share link, so treat it as a second output
rather than a replacement.

---

## Things that will bite you

- **Published-artifact CSP.** Scripts only from cdnjs, jsdelivr, cdn.tailwindcss
  and code.jquery; stylesheets only from fonts.googleapis. No remote images, no
  fetch to anywhere. Everything else fails silently. This is why the libraries are
  vendored rather than CDN-loaded. It does not apply to a locally served file.
- **Canvas, not SVG.** Both screen and export go through one `APP.draw`. Exports
  therefore get real fonts and correct DPI, which an SVG-serialised-to-image path
  would not. Keep it that way.
- **Two scale factors.** `o.k` scales map line weights (ratio of map zoom);
  `o.kf` scales furniture (ratio of canvas size). Conflating them makes exports
  look wrong at non-screen aspect ratios.
- **`db` documents cap at 256 kB.** A snapshot with every group hand-edited is
  ~95 kB, so there is headroom, but added road geometry must not go into the
  snapshot — only group membership and custom outlines do.
- **Download extension allowlist.** `.geojson` is not permitted; GeoJSON exports
  as `.json`. Full list is in the `downloads` capability docs.
- **Hand-edited outlines detach from suburbs.** Setting `group.custom` freezes the
  outline; changing membership clears it. That is deliberate — do not "fix" it
  without deciding what the alternative should be.
- **`APP.dissolve` is called on every pointermove during vertex drags.** It is
  cheap only because a group with `custom` set skips the union and just reprojects.
  Keep that early return.

---

## Data notes worth keeping straight

- Wembley is in the Town of Cambridge, not the City of Stirling. It is included
  because the client listed it. The dashed council boundary shows where the LGA
  actually stops.
- Churchlands and Mount Lawley straddle a council boundary in reality. The
  locality dataset gives each suburb whole, so the whole suburb is drawn.
- The client's original list said "Menorah"; the gazetted name is Menora.
- Boundaries are gazetted localities, not a statutory record. The help text says
  so and should keep saying so.

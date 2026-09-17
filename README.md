# Suburb Groups — City of Stirling

Open this folder in Claude Code and it reads `CLAUDE.md` automatically, which
explains the state of the project and the outstanding work.

    cd stirling-suburb-groups
    claude

To build and look at it right now, without Claude Code:

    python3 tools/assemble.py
    python3 -m http.server 8000 --directory dist
    # then open http://localhost:8000/stirling-suburb-groups.html

`dist/stirling-suburb-groups.html` is already built and can be opened directly.

The first useful prompt is probably:

    Read CLAUDE.md. Serve dist/ and confirm whether the blank-map problem
    is still there. Then start on task A: fetch OSM road centrelines for the
    City of Stirling and inline them as a new layer.

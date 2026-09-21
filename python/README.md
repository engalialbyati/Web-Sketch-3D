# WebSketch 3D Python Engine

Local computation service for the web app: builds rebar geometry with
**exact OCCT B-Rep** through FreeCAD (the same `makePipeShell` construction
FreeCAD-Reinforcement uses), tessellates it, and serves the meshes to the
browser. The app's JS engine remains the fallback when this service or
FreeCAD is absent.

## Run it

Any Python 3.10+ works for the service itself (stdlib only):

    python engine.py

For exact FreeCAD geometry, FreeCAD must be importable. The most reliable
way on Windows is to run the engine with **FreeCAD's own Python** (version
match guaranteed):

    "C:\Program Files\FreeCAD 1.0\bin\python.exe" engine.py

Alternatively install the conda-forge build and use that environment's
python. Verify with:

    curl http://127.0.0.1:8765/health      # -> {"freecad": true, ...}

## Endpoints

- `GET /health` — engine status + FreeCAD availability/version
- `POST /pipes` — `{ "bars": [{ "points": [[x,y,z],...], "diameter": 0.008,
  "tolerance": 0.0016, "debug": false }] }` → `{ "bars": [{ "ok": true,
  "vertices": [[x,y,z],...], "facets": [[i,j,k],...] }] }`
  - `tolerance` — tessellation deviation (default max(1.5 mm, 0.2·d)
  - `debug: true` — pure-Python 12-sided sweep, for testing the pipeline
    on machines without FreeCAD

## In the app

Enable **View ▸ Python Engine (FreeCAD)** and create reinforcement as
usual — bars built while the engine is online come from Python (tagged
`engine: freecad` in their metadata). If the service is down the app
automatically uses its built-in JS engine.

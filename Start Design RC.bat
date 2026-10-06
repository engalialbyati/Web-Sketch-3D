@echo off
rem Design RC launcher: serves the repo root locally and opens the
rem Design RC app (design-rc/index.html). 100% local JavaScript - no
rem internet, no backend - but it must be served over http:// so the
rem browser loads the current scripts.
cd /d "%~dp0"
start "" http://127.0.0.1:8935/design-rc/
python -m http.server 8935 --bind 127.0.0.1

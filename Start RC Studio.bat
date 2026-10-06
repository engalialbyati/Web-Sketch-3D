@echo off
rem RC Studio launcher: serves the repo root and opens the ETABS-style app.
cd /d "%~dp0"
start "" http://127.0.0.1:8935/etabs-rc/
python -m http.server 8935 --bind 127.0.0.1

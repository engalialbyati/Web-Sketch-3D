@echo off
rem WebSketch 3D launcher: serves the app folder locally and opens the
rem browser. The app itself is 100% local JavaScript - no internet, no
rem backend - but it must be served over http:// (not opened as a file)
rem so the browser loads the CURRENT scripts: the auto-update check and
rem several loading paths are blocked on file:// pages.
cd /d "%~dp0"
start "" http://127.0.0.1:8642/
python -m http.server 8642 --bind 127.0.0.1

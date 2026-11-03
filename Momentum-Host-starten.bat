@echo off
title Momentum-Host
cd /d "%~dp0"
echo.
echo  Momentum-Host  (App + Bridge-Weiterleitung + Push)
echo  ------------------------------------------------
if not exist node_modules (
  echo  Installiere Abhaengigkeiten ...
  call npm install || goto :fehler
)
echo  Baue die App ...
call npm run build || goto :fehler
set BRIDGE_URL=https://muttchen.tail91b057.ts.net:8443
set MOMENTUM_PORT=5180
echo.
echo  Auf diesem PC:   http://localhost:5180
echo  Auf dem Handy:   https://muttchen.tail91b057.ts.net:10000   (nach "tailscale serve", siehe README)
echo  Fenster offen lassen - Strg+C beendet den Host.
echo.
node host\server.mjs
goto :eof
:fehler
echo.
echo  Da ist etwas schiefgegangen - siehe Meldungen oben.
pause

@echo off
title Momentum-Host
cd /d "%~dp0"
echo.
echo  Momentum-Host  (Browser-App + Auto-Update + Push)
echo  -------------------------------------------------
if not exist node_modules\web-push\package.json (
  echo  Installiere Abhaengigkeiten ...
  call npm install || goto :fehler
)
set BRIDGE_URL=https://muttchen.tail91b057.ts.net:8443
set MOMENTUM_PORT=5180
echo.
echo  Momentum im Browser (PC und Handy):
echo    https://muttchen.tail91b057.ts.net:8443/momentum/
echo  Dort redet die App direkt mit Bridge. Neue Versionen holt der Host
echo  automatisch von GitHub - die App zeigt dann "Aktualisieren".
echo  Fenster offen lassen - Strg+C beendet den Host.
echo.
node host\server.mjs
goto :eof
:fehler
echo.
echo  Da ist etwas schiefgegangen - siehe Meldungen oben.
pause

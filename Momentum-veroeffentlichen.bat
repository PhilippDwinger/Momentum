@echo off
setlocal
title Momentum veroeffentlichen
cd /d "%~dp0"
echo.
echo  Momentum veroeffentlichen: laedt die neuesten Aenderungen zu GitHub hoch.
echo  GitHub baut daraus eine neue Version - die App auf dem Handy aktualisiert
echo  sich beim naechsten Oeffnen selbst.
echo.
git push origin master || goto :fehler
for /f "delims=" %%u in ('git remote get-url origin') do set "ORIGIN=%%u"
set "PAGE=%ORIGIN:.git=%"
echo.
echo  Hochgeladen. Build-Status: %PAGE%/actions
start "" "%PAGE%/actions"
pause
goto :eof
:fehler
echo.
echo  Hochladen fehlgeschlagen - siehe Meldungen oben. (Noch nicht eingerichtet?
echo  Dann zuerst Momentum-GitHub-einrichten.bat ausfuehren.)
pause
exit /b 1

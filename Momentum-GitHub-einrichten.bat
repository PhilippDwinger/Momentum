@echo off
setlocal
title Momentum auf GitHub einrichten
cd /d "%~dp0"
echo.
echo  Momentum auf GitHub einrichten (einmalig)
echo  -----------------------------------------
echo  Legt das Repo "momentum-app" in deinem GitHub-Konto an, hinterlegt den
echo  Signatur-Schluessel als Secret und laedt den Code hoch. GitHub baut danach
echo  automatisch die Android-App (Momentum.apk).
echo.
if not exist signing\momentum-release.jks.b64 (
  echo  FEHLER: signing\momentum-release.jks.b64 fehlt.
  goto :fehler
)
where git >nul 2>nul
if errorlevel 1 (
  echo  Installiere Git ...
  winget install --id Git.Git -e --source winget || goto :fehler
  set "PATH=%PATH%;C:\Program Files\Git\cmd"
)
where gh >nul 2>nul
if errorlevel 1 (
  echo  Installiere GitHub CLI ...
  winget install --id GitHub.cli -e --source winget || goto :fehler
  set "PATH=%PATH%;C:\Program Files\GitHub CLI"
)
gh auth status >nul 2>nul
if errorlevel 1 (
  echo  Melde dich jetzt im Browser bei GitHub an ...
  gh auth login --hostname github.com --git-protocol https --web --scopes workflow || goto :fehler
)
gh auth status 2>&1 | findstr /c:"workflow" >nul
if errorlevel 1 (
  echo  GitHub braucht noch die Berechtigung "workflow" ...
  gh auth refresh --hostname github.com --scopes workflow || goto :fehler
)
gh auth setup-git || goto :fehler
for /f "delims=" %%u in ('gh api user --jq .login') do set "GHUSER=%%u"
if "%GHUSER%"=="" goto :fehler
echo  GitHub-Konto: %GHUSER%
gh repo view "%GHUSER%/momentum-app" >nul 2>nul
if errorlevel 1 (
  gh repo create momentum-app --public --description "Momentum - Habit- und Motivationsplaner (Android-App)" || goto :fehler
)
gh secret set ANDROID_KEYSTORE_B64 --repo "%GHUSER%/momentum-app" < signing\momentum-release.jks.b64 || goto :fehler
gh secret set ANDROID_KEYSTORE_PASSWORD --repo "%GHUSER%/momentum-app" < signing\keystore-passwort.txt || goto :fehler
git config --global --add safe.directory "%CD:\=/%"
git remote remove origin >nul 2>nul
git remote add origin "https://github.com/%GHUSER%/momentum-app.git" || goto :fehler
git push -u origin master || goto :fehler
echo.
echo  Fertig! GitHub baut jetzt die App (ca. 5-10 Minuten):
echo    https://github.com/%GHUSER%/momentum-app/actions
echo  Danach auf dem Handy oeffnen und Momentum.apk installieren:
echo    https://github.com/%GHUSER%/momentum-app/releases/latest
start "" "https://github.com/%GHUSER%/momentum-app/actions"
echo.
pause
goto :eof
:fehler
echo.
echo  Da ist etwas schiefgegangen - siehe Meldungen oben.
pause
exit /b 1

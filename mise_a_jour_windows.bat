@echo off
:: Mes Comptes — Mise à jour Windows
:: Double-cliquez pour récupérer les dernières mises à jour

cd /d "%~dp0"

echo.
echo  ========================================
echo     Mise a jour de Mes Comptes
echo  ========================================
echo.

git fetch origin 2>nul
if errorlevel 1 (
    echo  Erreur : impossible de contacter le serveur.
    echo  Verifiez votre connexion internet.
    pause
    exit /b 1
)

for /f %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set UPDATES=%%i
if "%UPDATES%"=="0" (
    echo  Vous avez deja la derniere version !
) else (
    echo  %UPDATES% mise(s) a jour disponible(s)...
    git pull origin main
    echo.
    echo  Application mise a jour avec succes !
)

echo.
pause

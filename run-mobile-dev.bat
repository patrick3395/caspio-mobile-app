@echo off
cls
echo ================================================
echo    Caspio Mobile App - Development Server
echo ================================================
echo.
echo Starting development server...
echo.

REM Try to build first
echo Building app...
call npm run build --silent

REM Start the dev server
node dev-server.js

pause
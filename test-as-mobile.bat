@echo off
echo ===============================================
echo    Caspio Mobile App - Mobile Testing Mode
echo ===============================================
echo.
echo This will launch your app in the browser but
echo simulate a mobile environment for testing.
echo.
echo Starting server with mobile test mode...
echo.

REM Start the development server
start cmd /k "ionic serve"

REM Wait for server to start
timeout /t 5 /nobreak >nul

REM Open browser with mobile test mode
start "" "http://localhost:8100/?mobile-test=true"

echo.
echo ===============================================
echo Mobile Test Mode is now running!
echo.
echo The browser will open with:
echo - Mobile platform detection enabled
echo - API call logging
echo - Mobile viewport simulation
echo.
echo To test mobile-specific features:
echo 1. Press F12 to open DevTools
echo 2. Click device toggle (phone icon)
echo 3. Select a mobile device
echo.
echo All API calls will be logged to console.
echo ===============================================
pause
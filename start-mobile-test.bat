@echo off
echo ========================================
echo Caspio Mobile App Testing Environment
echo ========================================
echo.
echo Choose testing method:
echo 1. Android Emulator with Live Reload
echo 2. Android Emulator (Standard Build)
echo 3. Browser with Mobile Device Mode
echo 4. Connect to Physical Android Device
echo.
set /p choice="Enter choice (1-4): "

if "%choice%"=="1" (
    echo Starting Android Emulator with Live Reload...
    echo Your changes will update automatically!
    call ionic cap run android -l --external
) else if "%choice%"=="2" (
    echo Building and running on Android Emulator...
    call npx cap sync android
    call npx cap run android
) else if "%choice%"=="3" (
    echo Starting browser testing...
    echo After browser opens: Press F12, click device toggle icon
    call ionic serve
) else if "%choice%"=="4" (
    echo Connecting to physical device...
    echo Make sure USB debugging is enabled on your phone
    adb devices
    echo.
    call ionic cap run android -l --external --target device
) else (
    echo Invalid choice
)

pause
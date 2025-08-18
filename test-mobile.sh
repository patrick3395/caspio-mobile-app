#!/bin/bash

echo "Starting Ionic Mobile Testing Environment..."
echo "==========================================="
echo ""
echo "Choose testing method:"
echo "1) Browser with Device Emulation"
echo "2) Ionic Lab (iOS/Android Preview)"
echo "3) Android Emulator"
echo "4) iOS Simulator (Mac only)"
echo "5) Live Reload on Connected Device"
echo ""
read -p "Enter choice (1-5): " choice

case $choice in
  1)
    echo "Starting browser with device emulation..."
    echo "After browser opens: Press F12 → Click device icon → Select a phone"
    ionic serve
    ;;
  2)
    echo "Starting Ionic Lab..."
    npm install -g @ionic/lab 2>/dev/null
    ionic serve --lab
    ;;
  3)
    echo "Building for Android emulator..."
    ionic capacitor build android
    ionic capacitor run android
    ;;
  4)
    echo "Building for iOS simulator..."
    ionic capacitor build ios
    ionic capacitor run ios
    ;;
  5)
    echo "Starting live reload on device..."
    echo "Make sure your phone is connected via USB with developer mode enabled"
    read -p "Android (a) or iOS (i)? " platform
    if [ "$platform" = "a" ]; then
      ionic capacitor run android -l --external
    else
      ionic capacitor run ios -l --external
    fi
    ;;
  *)
    echo "Invalid choice"
    ;;
esac
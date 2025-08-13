#!/bin/bash

echo "Building Caspio Mobile App..."

# Check Node version
NODE_VERSION=$(node -v)
echo "Current Node version: $NODE_VERSION"

# Build the app
echo "Building production app..."
npm run build

# Check if www directory exists
if [ ! -d "www" ]; then
    echo "Error: www directory not found. Please check angular.json output path."
    exit 1
fi

# Initialize Capacitor if not already done
if [ ! -f "capacitor.config.ts" ]; then
    echo "Initializing Capacitor..."
    npx cap init "Caspio Mobile" com.caspio.mobileapp --web-dir=www
fi

# Add Android platform if not already added
if [ ! -d "android" ]; then
    echo "Adding Android platform..."
    npx cap add android
fi

# Copy web assets to Android
echo "Copying assets to Android..."
npx cap copy android

# Sync Android project
echo "Syncing Android project..."
npx cap sync android

echo "Build complete! Opening Android Studio..."
npx cap open android

echo ""
echo "Next steps in Android Studio:"
echo "1. Wait for Gradle sync to complete"
echo "2. Connect your Android device or start an emulator"
echo "3. Click the Run button (green play icon)"
echo ""
echo "To generate APK: Build → Build Bundle(s) / APK(s) → Build APK(s)"
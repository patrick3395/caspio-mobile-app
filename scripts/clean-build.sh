#!/bin/bash

echo "🧹 Clean Build Script for Caspio Mobile App"
echo "==========================================="
echo ""

# Clean all build artifacts
echo "1. Cleaning build artifacts..."
rm -rf www/
rm -rf .angular/
rm -rf node_modules/.cache/

# Clean iOS build
echo "2. Cleaning iOS build..."
rm -rf ios/App/App/public/
rm -rf ios/App/build/
rm -rf ios/App/DerivedData/

# Clean Android build  
echo "3. Cleaning Android build..."
rm -rf android/app/src/main/assets/public/
rm -rf android/app/build/
rm -rf android/.gradle/

# Rebuild
echo "4. Running fresh build..."
npm run build:prod

# Sync with Capacitor
echo "5. Syncing with Capacitor..."
npx cap sync

echo ""
echo "✅ Clean build complete!"
echo ""
echo "IMPORTANT: Live Updates are DISABLED in this build"
echo "This prevents corruption and flashing issues"
echo ""
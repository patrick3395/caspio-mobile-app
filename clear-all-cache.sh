#!/bin/bash

echo "🧹 Aggressive Cache Clear for Caspio Mobile App"
echo "================================================"
echo ""

# 1. Clear Angular cache
echo "1. Clearing Angular cache..."
rm -rf .angular/
rm -rf dist/
rm -rf www/
rm -rf node_modules/.cache/

# 2. Clear TypeScript cache
echo "2. Clearing TypeScript cache..."
rm -rf *.tsbuildinfo
find . -name "*.tsbuildinfo" -type f -delete

# 3. Clear npm cache
echo "3. Clearing npm cache..."
npm cache clean --force

# 4. Clear Capacitor cache
echo "4. Clearing Capacitor cache..."
rm -rf ios/App/App/public/
rm -rf ios/App/build/
rm -rf ios/App/DerivedData/
rm -rf android/app/src/main/assets/public/
rm -rf android/app/build/
rm -rf android/.gradle/

# 5. Clear temporary files
echo "5. Clearing temporary files..."
find . -name ".DS_Store" -type f -delete
find . -name "Thumbs.db" -type f -delete

# 6. Clear node_modules (optional - uncomment if needed)
# echo "6. Reinstalling node_modules..."
# rm -rf node_modules/
# npm install

echo ""
echo "✅ Cache clearing complete!"
echo ""
echo "Now run: npm run build"
echo ""
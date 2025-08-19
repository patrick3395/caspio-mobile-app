# Caspio Mobile App - Development Setup

## Quick Development (No TestFlight Needed!)

### Option 1: Live Reload in Browser (Fastest)
```bash
# Fix npm first (one time)
npm cache clean --force
npm install

# Then run live development server
ionic serve
# OR if ionic isn't working:
npm start
```

Open http://localhost:8100 in Chrome
- Press F12 for DevTools
- Click device toggle (📱)
- Select iPhone 14 Pro
- Edit any file in src/ and see changes instantly!

### Option 2: Live Reload on Your iPhone (No TestFlight!)
```bash
# Make sure your phone and computer are on same WiFi
ionic capacitor run ios -l --external

# This will:
# 1. Open Xcode
# 2. Run app on your connected iPhone
# 3. Point the app to your local dev server
# 4. Any code changes appear instantly on your phone!
```

### Option 3: Quick Copy (When npm is broken)
```bash
# After making changes to your code:
npx cap copy ios

# Then in Xcode, just hit Run (⌘R)
# No need to archive or upload to TestFlight
```

## When You MUST Rebuild for TestFlight

Only rebuild and upload to TestFlight when you:
- ❌ Add new Capacitor plugins
- ❌ Change app permissions (camera, location, etc.)
- ❌ Update app icons or splash screens
- ❌ Change iOS settings in Info.plist

## When You DON'T Need TestFlight

You DON'T need TestFlight for:
- ✅ UI changes (HTML/CSS)
- ✅ Logic changes (TypeScript/JavaScript)
- ✅ Adding new pages or components
- ✅ Updating existing features
- ✅ Styling changes
- ✅ API integration changes

## Current Development Workflow

1. Make changes to any file in `src/`
2. Save the file
3. See changes instantly in browser or on device
4. No build needed!
5. No TestFlight needed!
6. No waiting!

## Fixing npm/Ionic Issues

If you get build errors:
```bash
# Clean everything
rm -rf node_modules
rm package-lock.json
npm cache clean --force

# Reinstall
npm install
npm install -g @ionic/cli

# Try again
ionic serve
```

## Your Current Features

Your app now includes:
- ✅ Project creation with address autocomplete
- ✅ Service selection with checkboxes
- ✅ Multiple service instances
- ✅ Date of inspection per service
- ✅ Document management
- ✅ File uploads
- ✅ Auto-save functionality
- ✅ All features from caspio-dev-server.js

All these work with live reload - no rebuilding needed!
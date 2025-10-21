# Rebuild Mobile App - Instructions

## Issue: Multi-Select Shows as Dropdown on Mobile

The multi-select checkboxes are implemented in the source code, but the mobile app is using **cached/old code**. You need to rebuild the app.

---

## Quick Fix: Clear Cache & Rebuild

### **Option 1: Full Clean Rebuild** (Recommended)
```bash
# 1. Clean all build artifacts
npm run clean

# 2. Remove platforms
rm -rf ios/App/App/public

# 3. Build fresh web assets
ionic build --prod

# 4. Sync to iOS
npx cap sync ios

# 5. Open in Xcode and rebuild
npx cap open ios
```

### **Option 2: Fast Rebuild** (Usually works)
```bash
# 1. Build web assets
ionic build --prod

# 2. Sync to iOS
npx cap sync ios

# 3. In Xcode: Product → Clean Build Folder (Cmd+Shift+K)
# 4. Then: Product → Build (Cmd+B)
# 5. Run on device
```

### **Option 3: Force Clear Cache**
```bash
# 1. Clear Ionic cache
rm -rf www

# 2. Build fresh
ionic build --prod

# 3. Copy to iOS
npx cap copy ios

# 4. Open and rebuild in Xcode
npx cap open ios
```

---

## For Android
```bash
# Build web assets
ionic build --prod

# Sync to Android
npx cap sync android

# Open in Android Studio
npx cap open android

# In Android Studio: Build → Clean Project
# Then: Build → Rebuild Project
```

---

## Verification Steps

After rebuilding:

1. ✅ **Open mobile app** on device/simulator
2. ✅ **Navigate to Engineers Foundation**
3. ✅ **Check Project Information section**
4. ✅ **In Attendance** should show:
   ```
   ☐ Owner
   ☐ Buyer
   ☐ Buyer's Agent
   ☐ Selling Agent
   ☐ Tenants
   ☐ None
   ☐ Other: [input field]
   ```

5. ✅ **Check Foundation Details section**
6. ✅ **Second Foundation Rooms** should show checkboxes
7. ✅ **Third Foundation Rooms** should show checkboxes

---

## Why This Happens

### **Web App**
- Runs directly from source
- Changes appear immediately on refresh
- No build step needed for development

### **Mobile App (iOS/Android)**
- Bundles web assets into native app
- Uses `www/` folder (compiled assets)
- Requires rebuild to pick up changes
- Old assets cached in app bundle

---

## Quick Commands Reference

```bash
# Full rebuild pipeline
ionic build --prod && npx cap sync ios && npx cap open ios

# For Android
ionic build --prod && npx cap sync android && npx cap open android

# Clear everything and start fresh
rm -rf www ios/App/App/public && ionic build --prod && npx cap sync ios
```

---

## Troubleshooting

### **Still Showing Old Code After Rebuild?**

1. **Hard delete app from device**
   - Long press app icon → Delete
   - Reinstall fresh from Xcode/Android Studio

2. **Clear derived data (iOS)**
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData
   ```

3. **Clean Gradle cache (Android)**
   ```bash
   cd android
   ./gradlew clean
   cd ..
   ```

4. **Nuclear option**
   ```bash
   rm -rf node_modules www ios/App/App/public android/app/build
   npm install
   ionic build --prod
   npx cap sync
   ```

---

## Expected Result

After rebuilding, all three multi-select fields should display as **checkboxes** (not dropdowns) on both mobile and web:

- ✅ In Attendance
- ✅ Second Foundation Rooms
- ✅ Third Foundation Rooms

The functionality will be **identical** across platforms! 📱💻



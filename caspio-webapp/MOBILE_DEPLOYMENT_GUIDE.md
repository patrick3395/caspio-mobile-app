# Mobile Deployment Guide for Caspio App

## Prerequisites

### System Requirements
- **Node.js**: Version 20.x or higher required (currently you have 18.19.1)
- **Android Studio** (for Android builds)
- **Xcode** (for iOS builds - Mac only)
- **Java JDK 17** or higher

### Update Node.js
```bash
# For Windows (using chocolatey)
choco install nodejs

# Or download from https://nodejs.org/
```

## Step 1: Build the Web App

```bash
# Install dependencies
npm install

# Build for production
npm run build
```

## Step 2: Set up Capacitor

```bash
# Initialize Capacitor (after updating Node.js)
npx cap init "Caspio Mobile" com.caspio.mobileapp --web-dir=www

# Add platforms
npx cap add android
npx cap add ios
```

## Step 3: Configure for Mobile

### Update angular.json
Modify the output path in `angular.json`:
```json
"outputPath": "www"
```

### Create capacitor.config.ts
```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caspio.mobileapp',
  appName: 'Caspio Mobile',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};

export default config;
```

## Step 4: Android Deployment

### Build for Android
```bash
# Build the web app
npm run build

# Copy web assets to native project
npx cap copy android

# Sync project dependencies
npx cap sync android

# Open in Android Studio
npx cap open android
```

### In Android Studio:
1. Wait for Gradle sync to complete
2. Connect Android device or start emulator
3. Click "Run" (green play button)

### Generate APK for Testing
1. In Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)
2. APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

### Generate Release APK
1. Create signing key:
```bash
keytool -genkey -v -keystore caspio-release-key.keystore -alias caspio-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

2. Configure signing in `android/app/build.gradle`
3. Build → Generate Signed Bundle / APK

## Step 5: iOS Deployment (Mac only)

### Build for iOS
```bash
# Build the web app
npm run build

# Copy web assets to native project
npx cap copy ios

# Sync project dependencies
npx cap sync ios

# Open in Xcode
npx cap open ios
```

### In Xcode:
1. Select your Apple Developer account
2. Configure bundle identifier
3. Select target device/simulator
4. Click "Run"

### Distribute to TestFlight
1. Product → Archive
2. Follow App Store Connect upload process

## Step 6: Live Reload During Development

```bash
# For Android
ionic capacitor run android -l --external

# For iOS
ionic capacitor run ios -l --external
```

## Step 7: Update Script for package.json

Add these scripts to your `package.json`:
```json
{
  "scripts": {
    "build:mobile": "ng build --configuration production",
    "android": "npm run build:mobile && npx cap copy android && npx cap open android",
    "ios": "npm run build:mobile && npx cap copy ios && npx cap open ios",
    "sync": "npm run build:mobile && npx cap sync"
  }
}
```

## Environment Configuration

### Update src/environments/environment.prod.ts
Ensure production API endpoints are configured:
```typescript
export const environment = {
  production: true,
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2',
    clientId: 'YOUR_PROD_CLIENT_ID',
    clientSecret: 'YOUR_PROD_CLIENT_SECRET'
  }
};
```

## Troubleshooting

### Common Issues:

1. **CORS errors on device**: Add your app's origin to Caspio's allowed origins
2. **API calls failing**: Ensure HTTPS is used and certificates are valid
3. **White screen**: Check browser console using Chrome DevTools (for Android)
4. **Build failures**: Clear caches with `npm cache clean --force`

### Debug on Device:

**Android:**
- Connect device with USB debugging enabled
- Open Chrome and navigate to `chrome://inspect`
- Click "inspect" on your app

**iOS:**
- Connect device to Mac
- Open Safari → Develop → [Your Device] → [Your App]

## Next Steps

1. Update Node.js to version 20.x or higher
2. Follow steps 1-4 for Android deployment
3. Test on real devices
4. Configure app icons and splash screens
5. Submit to app stores

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Ionic Documentation](https://ionicframework.com/docs)
- [Android Publishing Guide](https://developer.android.com/studio/publish)
- [iOS App Store Guide](https://developer.apple.com/app-store/submissions/)
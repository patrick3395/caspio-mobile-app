# Version Update Instructions

## Current Version: 1.1.0

### Version updated in:
✅ package.json: 1.1.0

### When you add platforms, update these:

## iOS (when you run `npx cap add ios`):
1. In `ios/App/App/Info.plist`:
   - CFBundleShortVersionString: 1.1.0 (version number)
   - CFBundleVersion: 3 (build number - increment for each TestFlight upload)

2. Or use Capacitor config:
```json
// capacitor.config.json
{
  "ios": {
    "version": "1.1.0",
    "buildNumber": "3"
  }
}
```

## Android (when you run `npx cap add android`):
1. In `android/app/build.gradle`:
```gradle
android {
    defaultConfig {
        versionCode 3  // Increment for each release
        versionName "1.1.0"
    }
}
```

## Important for iOS TestFlight:
- Each upload to TestFlight must have a UNIQUE build number
- Build number must be higher than previous uploads
- Version can stay the same, but build number MUST increment

## Version History:
- 1.0.0 - Initial release
- 1.0.1 - Bug fixes
- 1.0.2 - iOS build fixes
- 1.0.3 - TestFlight deployment fixes
- 1.1.0 - Major update with Caspio integration, template forms, file uploads

## Next Steps Before Deployment:
```bash
# 1. Add platforms if not already added
npx cap add ios
npx cap add android

# 2. Build the app
npm run build:prod

# 3. Sync with native projects
npx cap sync

# 4. Update native version numbers as shown above

# 5. Open in native IDEs
npx cap open ios
npx cap open android
```
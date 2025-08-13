# Ionic Appflow Setup for iOS Build

## Prerequisites
1. **Update Node.js to v20+** (Required!)
2. Apple Developer Account ($99/year)
3. Ionic Appflow account
4. Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Update Node.js and Build

```bash
# After installing Node.js 20+
node --version  # Should show v20.x.x or higher

# Install dependencies
npm ci

# Build the app
npm run build:prod

# Add iOS platform
npx cap add ios
```

## Step 2: Initialize Git Repository

```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit for Caspio Mobile App"

# Add your remote repository (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/caspio-mobile.git

# Push to repository
git push -u origin main
```

## Step 3: Configure App for iOS

### Update capacitor.config.ts (already created)
- App ID: `com.caspio.mobileapp`
- App Name: `Caspio Mobile`

### Create App Icons and Splash Screens
Create these folders and add your images:
```
resources/
  ├── icon.png (1024x1024px)
  └── splash.png (2732x2732px)
```

## Step 4: Set Up Appflow

1. **Import App in Appflow**
   - Go to Appflow Dashboard
   - Click "Import existing app"
   - Select "Capacitor" as app type
   - Connect your Git repository

2. **Configure iOS Build**
   - Go to Build > iOS
   - Select build type: "App Store" or "Development"
   - Choose Xcode version (latest stable)

3. **Set Up Signing Certificate**
   - Generate a Certificate Signing Request (CSR) in Appflow
   - Upload to Apple Developer Portal
   - Download certificate and upload to Appflow

4. **Create Provisioning Profile**
   - In Apple Developer Portal:
     - Create App ID with `com.caspio.mobileapp`
     - Create provisioning profile
   - Upload to Appflow

## Step 5: Environment Variables for Appflow

Create `.env.prod` file (add to .gitignore):
```bash
CAPACITOR_APP_ID=com.caspio.mobileapp
CAPACITOR_APP_NAME=Caspio Mobile
```

## Step 6: Build Configuration

### Add to package.json:
```json
{
  "scripts": {
    "appflow:build": "npm ci && npm run build:prod && npx cap sync ios"
  }
}
```

### Create ionic.config.json (if not exists):
```json
{
  "name": "Caspio Mobile",
  "integrations": {
    "capacitor": {}
  },
  "type": "angular"
}
```

## Step 7: Trigger Build in Appflow

1. Commit and push all changes
2. In Appflow, go to Builds
3. Click "Start build"
4. Select:
   - Platform: iOS
   - Build type: Development/App Store
   - Target: Your commit
5. Click "Build"

## Step 8: Testing on iPhone

### For Development Build:
1. Download the .ipa file from Appflow
2. Use Apple Configurator 2 or Xcode to install on device

### For TestFlight:
1. Build with "App Store" type
2. Upload to App Store Connect
3. Distribute via TestFlight

## Troubleshooting

### Common Issues:

1. **Build fails with "Missing dist folder"**
   - Ensure `npm run build:prod` runs successfully
   - Check that `www` folder is created

2. **Provisioning profile errors**
   - Verify App ID matches exactly: `com.caspio.mobileapp`
   - Ensure devices are added to profile (for development)

3. **Code signing errors**
   - Check certificate is valid and not expired
   - Ensure certificate matches provisioning profile

### Build Scripts for Appflow

Add to root directory as `appflow-build.sh`:
```bash
#!/bin/bash
npm ci
npm run build:prod
npx cap sync ios
```

## Next Steps

1. Update Node.js to v20+
2. Run the build commands locally
3. Push to your Git repository
4. Import in Appflow
5. Configure certificates and profiles
6. Start your first iOS build!

## Resources

- [Appflow Documentation](https://ionic.io/docs/appflow)
- [iOS Code Signing Guide](https://ionic.io/docs/appflow/signing-certs)
- [Apple Developer Portal](https://developer.apple.com)
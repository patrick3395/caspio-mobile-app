# 🚀 Live Deploy Setup - Push to GitHub, Update TestFlight WITHOUT Rebuilding!

## What This Does
- Push code changes to GitHub
- Changes appear on TestFlight devices automatically
- NO rebuild required for HTML/CSS/JS changes
- Only rebuild for native plugin changes

## Step 1: Sign Up for Ionic Appflow
1. Go to: https://ionic.io/appflow
2. Sign up for free account (Hobby plan is free)
3. Create a new app in Appflow
4. Get your App ID (looks like: `abcd1234`)

## Step 2: Install Deploy Plugin

In your project directory, run:
```bash
# Add the deploy plugin
npm install cordova-plugin-ionic --save
```

Or if npm is broken, add to package.json:
```json
"dependencies": {
  "cordova-plugin-ionic": "^5.5.3"
}
```

## Step 3: Configure Your App

Add to `capacitor.config.ts` or `capacitor.config.json`:
```json
{
  "appId": "io.ionic.caspioapp",
  "appName": "Caspio Mobile",
  "plugins": {
    "Deploy": {
      "appId": "YOUR_APPFLOW_APP_ID",
      "channel": "Production",
      "updateMethod": "background",
      "maxVersions": 2
    }
  }
}
```

## Step 4: Update Your App Code

Add to `src/app/app.component.ts`:
```typescript
import { Deploy } from 'cordova-plugin-ionic/dist/ngx';

export class AppComponent {
  constructor(private deploy: Deploy) {
    this.checkForUpdate();
  }

  async checkForUpdate() {
    try {
      const update = await this.deploy.checkForUpdate();
      if (update.available) {
        await this.deploy.downloadUpdate((progress) => {
          console.log('Download progress:', progress);
        });
        await this.deploy.extractUpdate();
        await this.deploy.reloadApp();
      }
    } catch (err) {
      console.log('No update available');
    }
  }
}
```

## Step 5: Build Once with Deploy Enabled

```bash
# Build your app
npm run build

# Copy to iOS
npx cap copy ios

# Sync
npx cap sync ios
```

## Step 6: Set Up GitHub Action for Auto Deploy

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Appflow

on:
  push:
    branches: [main, master]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node
        uses: actions/setup-node@v2
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build
        run: npm run build
        
      - name: Deploy to Appflow
        run: |
          npx ionic deploy manifest
          npx ionic deploy upload --channel=Production
        env:
          IONIC_TOKEN: ${{ secrets.IONIC_TOKEN }}
```

## Step 7: Add Ionic Token to GitHub

1. In Appflow, go to Settings → Personal Access Tokens
2. Create a new token
3. In GitHub repo, go to Settings → Secrets
4. Add new secret: `IONIC_TOKEN` with your token value

## Step 8: How It Works

### First Time (One-Time Setup):
1. Build app with Deploy plugin → TestFlight
2. Users install from TestFlight

### Every Update After:
1. Make changes to your code
2. Push to GitHub
3. GitHub Action builds and uploads to Appflow
4. App automatically downloads update on launch
5. NO TestFlight rebuild needed!

## What Can Be Updated Without Rebuild:
✅ HTML changes
✅ CSS/SCSS changes  
✅ TypeScript/JavaScript logic
✅ Images and assets
✅ API endpoints
✅ App flow and navigation

## What REQUIRES TestFlight Rebuild:
❌ New Capacitor/Cordova plugins
❌ Native iOS permissions
❌ App icons or splash screens
❌ iOS configuration (Info.plist)
❌ Native code changes

## Alternative: CodePush (Microsoft)

If Appflow doesn't work, use CodePush:
```bash
# Install CodePush
npm install cordova-plugin-code-push

# Add to app
ionic cordova plugin add cordova-plugin-code-push

# Configure with your key
code-push app add CaspioMobile ios react-native
```

## Testing Live Updates

1. Build and deploy to TestFlight once
2. Install on your phone
3. Make a small change (like changing text)
4. Push to GitHub
5. Close and reopen app on phone
6. See changes without TestFlight update!

---

## Quick Start Commands

```bash
# One-time setup
npm install cordova-plugin-ionic --save
npx cap sync

# After making changes
git add .
git commit -m "Update UI"
git push

# Changes appear on phones automatically!
```

Your app will now update itself without going through TestFlight for web asset changes!
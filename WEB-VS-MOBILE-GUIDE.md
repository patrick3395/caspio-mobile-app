# Web vs Mobile: Separate Builds Guide

## Overview

Your app now has **two separate builds**:

1. **Mobile Build** (`npm run build:mobile`) - For iOS/Android apps
   - Uses `environment.prod.ts` with `isWeb: false`
   - Outputs to `www/` folder
   - For Capacitor/mobile deployment

2. **Web Build** (`ng build --configuration web`) - For Vercel/web deployment
   - Uses `environment.web.ts` with `isWeb: true`
   - Outputs to `dist/web/` folder
   - For Vercel/Squarespace

## How to Use in Your Code

### Method 1: Use PlatformDetectionService (Recommended)

Inject the service into any component:

```typescript
import { PlatformDetectionService } from '../services/platform-detection.service';

export class YourComponent {
  constructor(private platform: PlatformDetectionService) {}

  ngOnInit() {
    if (this.platform.isWeb()) {
      console.log('Running on WEB');
      // Web-specific code
    } else {
      console.log('Running on MOBILE');
      // Mobile-specific code
    }
  }
}
```

### Method 2: Use Environment Flag Directly

```typescript
import { environment } from '../environments/environment';

export class YourComponent {
  isWebVersion = environment.isWeb;

  ngOnInit() {
    if (this.isWebVersion) {
      // Web-only code
    } else {
      // Mobile-only code
    }
  }
}
```

### Method 3: In HTML Templates

```html
<div *ngIf="platform.isWeb()">
  <!-- Web-only content -->
  <button>This only shows on web</button>
</div>

<div *ngIf="!platform.isWeb()">
  <!-- Mobile-only content -->
  <button>This only shows on mobile</button>
</div>
```

## Common Use Cases

### 1. Hide/Show Features

```typescript
export class YourPage {
  constructor(private platform: PlatformDetectionService) {}

  showFeature(): boolean {
    // Only show this feature on web
    return this.platform.isWeb();
  }
}
```

### 2. Different Styling

**In TypeScript:**
```typescript
export class YourPage {
  constructor(private platform: PlatformDetectionService) {}

  getButtonClass(): string {
    return this.platform.isWeb() ? 'web-button' : 'mobile-button';
  }
}
```

**In SCSS:**
```scss
.web-button {
  // Web-specific styles
  padding: 20px;
  font-size: 18px;
}

.mobile-button {
  // Mobile-specific styles
  padding: 12px;
  font-size: 14px;
}
```

### 3. Different Navigation

```typescript
async navigateToPage() {
  if (this.platform.isWeb()) {
    // Web: open in new tab
    window.open('/some-page', '_blank');
  } else {
    // Mobile: use Ionic navigation
    await this.navController.navigateForward('/some-page');
  }
}
```

### 4. Conditional Camera Access

```typescript
async takePhoto() {
  if (this.platform.isWeb()) {
    // Web: use file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => this.handleFileSelect(e);
    input.click();
  } else {
    // Mobile: use native camera
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera
    });
  }
}
```

## Build Commands

### For Mobile (iOS/Android):
```bash
npm run build:mobile
# Outputs to: www/
# Uses: environment.prod.ts (isWeb: false)
```

### For Web (Vercel/Squarespace):
```bash
ng build --configuration web
# Outputs to: dist/web/
# Uses: environment.web.ts (isWeb: true)
```

### Vercel Automatic Build:
Vercel uses the command in `vercel.json`:
```json
"buildCommand": "npm install && ng build --configuration web"
```

This automatically builds the **web version** when you push to GitHub.

## Example: Page with Web/Mobile Differences

```typescript
import { Component, OnInit } from '@angular/core';
import { PlatformDetectionService } from '../../services/platform-detection.service';

@Component({
  selector: 'app-example',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>
          {{ platform.isWeb() ? 'Web App' : 'Mobile App' }}
        </ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Web-only section -->
      <div *ngIf="platform.isWeb()" class="web-notice">
        You're using the web version!
      </div>

      <!-- Mobile-only section -->
      <div *ngIf="platform.isMobile()" class="mobile-notice">
        You're using the mobile app!
      </div>

      <!-- Shared content -->
      <div class="shared-content">
        This appears on both platforms
      </div>
    </ion-content>
  `,
  styles: [`
    .web-notice {
      background: #e3f2fd;
      padding: 20px;
      margin: 20px;
      border-radius: 8px;
    }

    .mobile-notice {
      background: #f3e5f5;
      padding: 12px;
      margin: 12px;
      border-radius: 8px;
    }
  `]
})
export class ExamplePage implements OnInit {
  constructor(public platform: PlatformDetectionService) {}

  ngOnInit() {
    console.log('Platform:', this.platform.getPlatform());
    console.log('Is Web:', this.platform.isWeb());
    console.log('Is Mobile:', this.platform.isMobile());
  }

  async doSomething() {
    if (this.platform.isWeb()) {
      // Web-specific logic
      alert('Web version');
    } else {
      // Mobile-specific logic
      console.log('Mobile version');
    }
  }
}
```

## Testing

### Test Web Build Locally:
```bash
ng build --configuration web
cd dist/web
npx http-server -p 8080
# Visit: http://localhost:8080
```

### Test Mobile Build Locally:
```bash
npm run build:mobile
cd www
npx http-server -p 8080
# Visit: http://localhost:8080
```

## Deployment

### Mobile Deployment (No Changes):
```bash
npm run build:mobile
npx cap sync
npx cap open ios
# Build in Xcode and submit to App Store
```

### Web Deployment (Vercel):
```bash
git add .
git commit -m "Your changes"
git push origin master
# Vercel automatically builds and deploys
```

## Key Points

✅ **Mobile build** → `environment.prod.ts` → `www/` → App Store
✅ **Web build** → `environment.web.ts` → `dist/web/` → Vercel
✅ **Changes to web won't affect mobile** (separate builds)
✅ **Shared code works on both** (unless you add platform checks)

## Troubleshooting

**Q: How do I know which build is running?**
A: Check the console:
```typescript
console.log('Is Web:', environment.isWeb);
console.log('Platform:', Capacitor.getPlatform());
```

**Q: My changes appear on both platforms!**
A: You need to add platform checks using `PlatformDetectionService` or `environment.isWeb`

**Q: How do I test the web build before deploying?**
A: Build locally and serve:
```bash
ng build --configuration web
cd dist/web
npx http-server -p 8080
```

---

Now you have complete separation between web and mobile builds!

# Technology Stack

**Analysis Date:** 2026-01-23

## Languages

**Primary:**
- TypeScript 5.8.0 - All source code, components, services, pages

**Secondary:**
- HTML5 - Templates (Angular components)
- SCSS - Styling with variables theme system

## Runtime

**Environment:**
- Node.js (via npm scripts)
- Web browser (Angular dev server on localhost:4200)
- Native platforms (iOS, Android via Capacitor)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Angular 20.0.0 - Full framework (platform-browser, router, forms, animations, CDK)
- Ionic 8.0.0 - Mobile UI framework and native bridge
- Capacitor 7.4.2 - Native runtime bridge (iOS 7.4.2, Android 7.4.2)

**Testing:**
- Jasmine 5.1.0 - Test runner and assertions
- Karma 6.4.0 - Test execution environment
- Playwright 1.50.0 - End-to-end testing with UI and debugging support

**Build/Dev:**
- Angular CLI 20.1.6 - Build and serve tools
- @angular-devkit/build-angular 20.0.0 - Angular build pipeline
- TypeScript Compiler 5.8.0 - TypeScript compilation
- @angular/language-service 20.0.0 - IDE support

## Key Dependencies

**Critical:**
- amazon-cognito-identity-js 6.3.16 - AWS Cognito authentication for user login
- dexie 4.2.1 - Client-side IndexedDB abstraction for offline-first architecture
- rxjs 7.8.0 - Reactive programming for streams and async operations
- @capacitor/live-updates 0.4.0 - Over-the-air app updates (Ionic feature)

**Infrastructure:**
- @capacitor/camera 7.0.0 - Camera access for photo capture
- @capacitor/filesystem 7.1.6 - File system access for local storage
- fabric 6.9.1 - Canvas drawing library (annotations)
- chart.js 4.5.1 - Charts for data visualization
- html2canvas 1.4.1 - Canvas rendering from HTML
- html2pdf.js 0.12.1 - PDF generation from HTML
- jspdf 2.5.1 + jspdf-autotable 3.8.0 - PDF generation with tables
- ngx-extended-pdf-viewer 25.6.0-alpha.2 - PDF viewing component
- browser-image-compression 2.0.2 - Client-side image compression
- ionicons 7.0.0 - Icon library

## Configuration

**Environment:**
- `src/environments/environment.ts` - Development configuration (isWeb: true, API Gateway enabled)
- `src/environments/environment.prod.ts` - Production configuration (isWeb: false, API Gateway enabled)
- `src/environments/environment.web.ts` - Web-specific build configuration
- Environment variables used: Caspio credentials, AWS API Gateway URL, Cognito credentials, S3 bucket, API keys

**Build:**
- `angular.json` - Angular CLI configuration with production/development/ci/web configurations
- `tsconfig.json` - TypeScript compiler options (strict mode enabled)
- `tsconfig.app.json` - App-specific TypeScript configuration
- `tsconfig.spec.json` - Test TypeScript configuration
- `tsconfig.worker.json` - Web Worker TypeScript configuration
- `karma.conf.js` - Karma test runner configuration
- `.eslintrc.json` - ESLint linting rules
- `playwright.config.ts` - E2E test configuration

## Platform Requirements

**Development:**
- Node.js with npm
- TypeScript 5.8.0
- Angular CLI 20.1.6
- For native: Xcode (iOS) and Android Studio (Android)

**Production:**
- iOS 12+ (via App Store)
- Android 7+ (via Google Play)
- Web deployment (AWS, CloudFront possible from environment config)

---

*Stack analysis: 2026-01-23*

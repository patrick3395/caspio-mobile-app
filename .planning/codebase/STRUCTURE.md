# Codebase Structure

**Analysis Date:** 2026-01-23

## Directory Layout

```
C:\Users\Owner\Caspio\
├── src/                           # Application source code
│   ├── app/                       # Angular app module and features
│   │   ├── components/            # Reusable UI components
│   │   ├── pages/                 # Feature pages and routing
│   │   ├── services/              # Business logic and data access (60+ services)
│   │   ├── guards/                # Route guards (auth, unsaved changes)
│   │   ├── interceptors/          # HTTP interceptors (auth, Caspio, error handling)
│   │   ├── pipes/                 # Custom pipes
│   │   ├── directives/            # Custom directives
│   │   ├── modals/                # Modal components
│   │   ├── utils/                 # Utility functions
│   │   ├── workers/               # Web workers
│   │   ├── routing/               # Routing strategies
│   │   ├── app.component.ts       # Root component
│   │   ├── app.module.ts          # Root module
│   │   └── app-routing.module.ts  # Root routing
│   ├── environments/              # Environment configs (prod, dev, web, apigateway)
│   ├── assets/                    # Static assets (images, fonts, icons)
│   ├── theme/                     # Global theme variables and styles
│   ├── styles/                    # Global styles
│   ├── main.ts                    # App bootstrap entry point
│   ├── index.html                 # HTML template
│   ├── global.scss                # Global styles
│   ├── polyfills.ts               # Polyfills
│   ├── sw.ts                      # Service worker
│   └── zone-flags.ts              # Zone.js configuration
├── backend/                       # AWS SAM backend (Lambda functions)
├── e2e/                           # Playwright E2E tests
├── docs/                          # Documentation
├── ios/                           # iOS native platform files
├── android/                       # Android native platform files (generated)
├── www/                           # Built output (generated)
├── angular.json                   # Angular CLI config
├── tsconfig.json                  # TypeScript base config
├── tsconfig.app.json              # TypeScript app config
├── tsconfig.spec.json             # TypeScript test config
├── tsconfig.worker.json           # TypeScript web worker config
├── capacitor.config.json          # Capacitor config
├── ionic.config.json              # Ionic CLI config
├── karma.conf.js                  # Karma test runner config
├── .eslintrc.json                 # ESLint config
├── package.json                   # NPM dependencies
└── .planning/codebase/            # GSD planning documents
```

## Directory Purposes

**`src/app/components/`:**
- Purpose: Reusable UI components (not page-specific)
- Contains: Standalone components, shared UI widgets
- Key files:
  - `error-boundary/` - Error boundary wrapper
  - `theme-toggle/` - Theme switcher
  - `sync-toggle/` - Offline sync controls
  - `sync-status-widget/` - Sync status display
  - `image-annotator/` - Image annotation tool
  - `photo-annotator/` - Photo drawing/markup tool (Fabric.js)
  - `pdf-viewer-modal/` - PDF viewing modal
  - `fabric-photo-annotator/` - Fabric.js photo annotation
  - `upload-progress/` - Upload progress tracker
  - `offline-indicator/` - Offline status indicator
  - `virtual-scroll/` - Optimized list rendering
  - `skip-link/` - Accessibility skip link
  - `help-modal/` - Help system
  - `sync-details-modal/` - Sync status details

**`src/app/pages/`:**
- Purpose: Feature pages mapped to routes
- Contains: Page components and feature-specific services/modules
- Key subdirectories:
  - `active-projects/` - Active projects list (lazy-loaded module)
  - `all-projects/` - All projects list (lazy-loaded module)
  - `hud/` - HUD inspection module (eager-loaded for offline)
    - `hud-main/` - Category selection page
    - `hud-project-details/` - Project info form
    - `hud-category-detail/` - Category data entry
    - `hud-container/` - Container with shared state
    - `services/` - HudStateService, HudValidationService
  - `dte/` - Damaged Truss Evaluation module (eager-loaded)
    - `dte-main/` - DTE category hub
    - `dte-project-details/` - Project info
    - `dte-categories/` - Category list
    - `dte-category-detail/` - Category detail
    - `dte-container/` - Container with shared state
    - `services/` - DteStateService, DteValidationService, DteDataService
  - `lbw/` - Load Bearing Walls module (eager-loaded)
    - `lbw-main/` - Main page
    - `lbw-categories/` - Category list
    - `lbw-category-detail/` - Category detail
    - `lbw-container/` - Container
    - `services/` - LbwStateService, LbwValidationService
  - `engineers-foundation/` - Structural engineering module (eager-loaded)
    - `engineers-foundation-main/` - Main hub
    - `structural-systems/` - Structural categories
    - `elevation-plot-hub/` - Elevation plots
    - `project-details/` - Project details
    - `services/` - Engineers foundation state and validation
  - `project-detail/` - Project overview page (lazy-loaded)
  - `new-project/` - Create new project page
  - `login/` - Login page
  - `template-form/` - Generic template form (lazy-loaded)
  - `hud-template/` - HUD-specific template
  - `company/` - Company info page
  - `help-guide/` - Help documentation

**`src/app/services/`:**
- Purpose: Business logic, API communication, state management
- Contains: 60+ services organized by concern
- Key services:
  - **API & Data Access:**
    - `caspio.service.ts` - Caspio REST API client with token management
    - `api-gateway.service.ts` - AWS API Gateway integration
    - `indexed-db.service.ts` - Dexie IndexedDB wrapper
  - **Caching & Offline:**
    - `cache.service.ts` - In-memory and localStorage cache
    - `offline-data-cache.service.ts` - Template and service data caching
    - `offline.service.ts` - Offline detection and request queuing
    - `offline-restore.service.ts` - Data restoration on reconnection
    - `operations-queue.service.ts` - Queued operation management
    - `background-sync.service.ts` - Background sync orchestration
  - **Mutation & Optimization:**
    - `mutation-tracking.service.ts` - Track data mutations for cache invalidation
    - `optimistic-update.service.ts` - Optimistic UI updates
    - `request-deduplication.service.ts` - Prevent duplicate requests
  - **Utilities & Features:**
    - `projects.service.ts` - Project CRUD operations
    - `cache.service.ts` - Generic caching
    - `camera.service.ts` - Capacitor camera integration
    - `pdf-generator.service.ts` - PDF generation (jsPDF)
    - `fabric.service.ts` - Fabric.js initialization
    - `image-compression.service.ts` - Browser-side image compression
    - `background-photo-upload.service.ts` - Background photo uploads
    - `fast-image-upload.service.ts` - Optimized image uploads
    - `image-loading-queue.service.ts` - Image load queue
    - `connection-monitor.service.ts` - Network connectivity monitoring
    - `platform-detection.service.ts` - Mobile/web detection
    - `theme.service.ts` - Theme management
    - `performance-monitor.service.ts` - Performance tracking
    - `global-error-handler.service.ts` - Global error handling
  - **Validation & Processing:**
    - `model-generator.service.ts` - Dynamic model generation
    - `table-analyzer.service.ts` - Table schema analysis
    - `smart-sync.service.ts` - Intelligent sync strategy
    - `service-efe.service.ts` - EFE service data

**`src/app/guards/`:**
- Purpose: Route protection and navigation guards
- Contains:
  - `auth.guard.ts` - Protects routes, redirects to login
  - `unsaved-changes.guard.ts` - Prevents navigation with unsaved changes

**`src/app/interceptors/`:**
- Purpose: HTTP request/response processing
- Contains:
  - `auth.interceptor.ts` - Adds Caspio token to requests
  - `caspio.interceptor.ts` - Handles Caspio-specific response formats and retries

**`src/app/pipes/`:**
- Purpose: Data transformation in templates
- Contains:
  - `safe-url.pipe.ts` - Bypasses DomSanitizer for trusted URLs

**`src/app/utils/`:**
- Purpose: Utility functions and helpers
- Contains:
  - `annotation-utils.ts` - Compression/decompression for annotation data
  - `lazy-loading.ts` - Lazy load components/modules

**`src/app/workers/`:**
- Purpose: Web workers for background processing
- Contains:
  - `image-processor.worker.ts` - Off-thread image processing

**`src/app/modals/`:**
- Purpose: Modal/dialog components
- Contains:
  - `paypal-payment-modal/` - Payment processing modal
  - `add-custom-visual-modal/` - Add custom visual element
  - `annotation-modal/` - Annotation interface

**`src/app/tabs/`:**
- Purpose: Bottom tab navigation (main app navigation)
- Contains:
  - `tabs.page.ts` - Tab component
  - `tabs-routing.module.ts` - Tab child routes

**`src/app/routing/`:**
- Purpose: Custom routing strategies
- Contains:
  - `selective-preloading-strategy.service.ts` - Selective module preloading based on route metadata

**`src/environments/`:**
- Purpose: Environment-specific configuration
- Contains:
  - `environment.ts` - Development config
  - `environment.prod.ts` - Production config
  - `environment.web.ts` - Web build config
  - `environment.apigateway.ts` - AWS API Gateway config

**`src/assets/`:**
- Purpose: Static files (images, fonts, icons)
- Contains: SVG icons, app icons, images

**`src/theme/`:**
- Purpose: Ionic theme variables and customization
- Contains: `variables.scss` with color, typography, spacing variables

**`backend/`:**
- Purpose: AWS Serverless Application Model (SAM) deployment
- Contains: Lambda functions for API gateway endpoints

**`e2e/`:**
- Purpose: End-to-end testing
- Contains: Playwright test files and configurations

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

## Key File Locations

**Entry Points:**
- `src/main.ts` - Angular bootstrap (registers service worker)
- `src/index.html` - HTML template
- `src/app/app.component.ts` - Root component (icons, theme, performance)
- `src/app/app.module.ts` - Root module (HTTP interceptors, error handler)

**Configuration:**
- `angular.json` - Angular CLI build config (budgets, paths, assets)
- `tsconfig.app.json` - TypeScript compiler settings
- `karma.conf.js` - Test runner config
- `capacitor.config.json` - Capacitor native bridge config
- `.eslintrc.json` - Linting rules

**Core Logic:**
- `src/app/services/caspio.service.ts` - API client with token management
- `src/app/services/cache.service.ts` - Three-tier caching strategy
- `src/app/services/offline.service.ts` - Offline detection and queueing
- `src/app/services/background-sync.service.ts` - Sync orchestration
- `src/app/pages/*/services/*-state.service.ts` - Feature state management

**Testing:**
- `src/test.ts` - Karma test setup
- `e2e/` - Playwright E2E tests
- `src/app/**/*.spec.ts` - Component/service unit tests

## Naming Conventions

**Files:**
- Services: `{feature}.service.ts` (e.g., `projects.service.ts`, `cache.service.ts`)
- Pages: `{feature}.page.ts` and `{feature}.page.html` (e.g., `hud-main.page.ts`)
- Components: `{name}.component.ts` and `{name}.component.html` (e.g., `image-annotator.component.ts`)
- Modules: `{feature}.module.ts` (e.g., `hud.module.ts`)
- Routing: `{feature}-routing.module.ts`
- State services: `{feature}-state.service.ts`
- Validation services: `{feature}-validation.service.ts`
- Tests: `{name}.spec.ts`

**Directories:**
- Feature folders: lowercase with hyphens (e.g., `photo-annotator`, `pdf-viewer-modal`)
- Multi-word features: kebab-case (e.g., `engineers-foundation`, `hud-template`)
- Shared groups: plural (e.g., `services/`, `components/`, `pages/`)

**Classes & Interfaces:**
- Classes: PascalCase (e.g., `ProjectsService`, `HudStateService`)
- Interfaces: PascalCase with `I` prefix or without (e.g., `Project`, `HudProjectData`)
- Enums: PascalCase (e.g., `MutationType`)

## Where to Add New Code

**New Feature Page:**
- Create directory: `src/app/pages/{feature-name}/`
- Add page component: `src/app/pages/{feature-name}/{feature-name}.page.ts`
- Add routing module: `src/app/pages/{feature-name}/{feature-name}-routing.module.ts`
- Add shared page module: `src/app/pages/{feature-name}/{feature-name}.module.ts`
- If needs state: `src/app/pages/{feature-name}/services/{feature-name}-state.service.ts`
- If needs validation: `src/app/pages/{feature-name}/services/{feature-name}-validation.service.ts`
- Add route to `src/app/app-routing.module.ts`
- Use lazy loading via `loadChildren` unless offline support required (then eager load)

**New Component (reusable):**
- Create directory: `src/app/components/{component-name}/`
- Add component: `src/app/components/{component-name}/{component-name}.component.ts`
- Add template: `src/app/components/{component-name}/{component-name}.component.html`
- Add styles: `src/app/components/{component-name}/{component-name}.component.scss`
- Make standalone (import `CommonModule`, `IonicModule`)
- Export from barrel file if used in multiple places

**New Service:**
- Location: `src/app/services/{service-name}.service.ts`
- Decorator: `@Injectable({ providedIn: 'root' })`
- If feature-specific: `src/app/pages/{feature}/services/{service-name}.service.ts`
- If uses HTTP: Inject `HttpClient`, use `CaspioService` for API calls
- If caches data: Inject `CacheService` and use `.set()/.get()`
- If offline-aware: Inject `OfflineService` and queue via `OperationsQueueService`

**New Validation Rule:**
- Location: `src/app/pages/{feature}/services/{feature}-validation.service.ts`
- Pattern: Return validation result object with `isValid` boolean and `errors` map
- Usage: Called from page component or form validator

**New Utility Function:**
- Location: `src/app/utils/{utility-name}.ts`
- Export as named export (e.g., `export function compressData()`)
- Keep pure (no side effects) unless file name indicates side effects (e.g., `*-utils.ts`)

**New Environment Variable:**
- Update all files:
  - `src/environments/environment.ts`
  - `src/environments/environment.prod.ts`
  - `src/environments/environment.web.ts`
  - `src/environments/environment.apigateway.ts`
- Declare interface in each file's `environment` object
- Usage: `import { environment } from '../environments/environment'`

## Special Directories

**`src/assets/`:**
- Purpose: Static files bundled with app
- Generated: No (manually managed)
- Committed: Yes
- Contents: SVG icons, app images, logos

**`www/`:**
- Purpose: Built Angular app output
- Generated: Yes (by `ng build`)
- Committed: No (in `.gitignore`)
- Used by: Capacitor native build

**`dist/`:**
- Purpose: Web-only build output
- Generated: Yes (by `ng build --configuration web`)
- Committed: No
- Used by: Web deployment

**`node_modules/`:**
- Purpose: NPM package dependencies
- Generated: Yes (by `npm install`)
- Committed: No
- Excluded: Cached by Angular CLI

**`.angular/cache/`:**
- Purpose: Angular CLI build cache
- Generated: Yes
- Committed: No
- Purpose: Speed up subsequent builds

**`ios/` and `android/`:**
- Purpose: Native platform files
- Generated: Partially (by `npx cap copy/open`)
- Committed: Yes (ios/ for custom code, android/ structure)
- Purpose: Native app configuration and custom code

---

*Structure analysis: 2026-01-23*

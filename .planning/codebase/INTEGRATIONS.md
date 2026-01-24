# External Integrations

**Analysis Date:** 2026-01-23

## APIs & External Services

**AWS API Gateway (Primary Backend):**
- Service: Express.js backend on AWS Lambda via API Gateway
- What it's used for: Primary backend for Caspio API proxy, file uploads, and business logic
- Endpoint: `https://45qxu5joc6.execute-api.us-east-1.amazonaws.com`
- SDK/Client: Built-in HttpClient (via `src/app/services/api-gateway.service.ts`)
- Authentication: AWS Cognito JWT tokens
- Configuration location: `environment.ts`, `environment.prod.ts`

**Caspio Direct API (Fallback):**
- Service: Caspio REST API v2
- What it's used for: Direct database table access (fallback when API Gateway disabled)
- Endpoints:
  - Token: `https://c2hcf092.caspio.com/oauth/token`
  - API: `https://c2hcf092.caspio.com/rest/v2`
- SDK/Client: Built-in HttpClient (via `src/app/services/caspio.service.ts`)
- Auth: OAuth 2.0 client credentials flow
- Configuration: `src/environments/environment.ts` and `environment.prod.ts` (includes clientId, clientSecret)
- Tables accessed: LPS_Services_Visuals_Attach, Services_EFE_Points, LPS_Services_Visuals, and others

**Google Maps:**
- Service: Google Maps JavaScript API
- What it's used for: Location display and places autocomplete
- API Key: Configured in `environment.ts` and `environment.prod.ts`
- SDK/Client: google-maps-loader.service.ts script injection
- Libraries loaded: `places`
- Script URL pattern: `https://maps.googleapis.com/maps/api/js`

**PayPal:**
- Service: PayPal JavaScript SDK
- What it's used for: Payment processing (referenced in environment config)
- Client ID: `Ab5YsZla-pIyZZmxfKgb3k0GwWe3NoCqxIcfwefzzbutjjRgD15vdDcIIIABkNpbuFxlwS6Huu9uZgMq`
- Currency: USD
- Implementation: `src/app/modals/paypal-payment-modal/paypal-payment-modal.component.ts`
- Configuration: `environment.ts`, `environment.prod.ts`

## Data Storage

**Primary Database:**
- Service/Type: Caspio Database
- Connection: OAuth 2.0 credentials to `c2hcf092.caspio.com/rest/v2`
- Client: HTTP client with custom `src/app/services/caspio.service.ts`

**Offline-First Cache:**
- Type: IndexedDB (via Dexie 4.2.1)
- Database instance: `src/app/services/caspio-db.ts` exports global `db` instance
- Purpose: Local-first architecture for offline functionality and sync
- Stores (tables):
  - `localImages` - Photo metadata and base64 data
  - `localBlobs` - Large binary file storage
  - `uploadOutbox` - Queued uploads
  - `pendingRequests` - Operations to sync when online
  - `cachedServiceData` - Template cache
  - `efeFields` - EFE room data
  - `serviceMetadata` - Service-level tracking
  - `tempIdMappings` - Temporary ID resolution
  - `queuedOperations` - Operation queue with dependencies

**File Storage:**
- Service: AWS S3
- Bucket: `lps-field-app`
- Region: `us-east-1`
- Purpose: Photo and document storage for inspections
- Implementation: `src/app/services/hud-s3-upload.service.ts`, `src/app/services/offline-s3-upload.service.ts`
- Upload flow: 3-step process (create Caspio record → upload to S3 → update with S3 key)

**Caching:**
- In-memory: RxJS BehaviorSubject and ReplaySubject streams
- HTTP layer: `src/app/services/api-cache.service.ts` with invalidation patterns
- Image cache: `src/app/services/fabric.service.ts`, `src/app/services/thumbnail.service.ts`

## Authentication & Identity

**Auth Provider:**
- Service: AWS Cognito
- User Pool ID: `us-east-1_jefJY80nY`
- Client ID: `j044eki6ektqi155srd1a6ke9`
- Region: `us-east-1`
- Implementation: `src/app/services/cognito-auth.service.ts`
- SDK: amazon-cognito-identity-js 6.3.16
- Token storage: localStorage (`cognito_access_token`, `cognito_id_token`)
- Auth pattern: JWT tokens returned to client, passed in HTTP Authorization headers

**Fallback Authentication:**
- Caspio OAuth 2.0 client credentials
- Used when API Gateway is disabled
- Managed by: `src/app/services/caspio.service.ts`

## Monitoring & Observability

**Error Tracking:**
- Type: None detected (no Sentry, Rollbar integration found)
- Console-based debugging available with environment flags

**Logs:**
- Approach: Console logging throughout services
- Debug mode: Controlled by `environment.production` flag
- Service-specific logging: Most services include debug output with `console.log()`

**Performance Monitoring:**
- Service: `src/app/services/performance-monitor.service.ts`
- Metrics: Custom performance tracking for operation timing

## CI/CD & Deployment

**Hosting:**
- Platform: iOS App Store and Google Play (native mobile)
- Web version: AWS (API Gateway endpoint suggests CloudFront or similar)
- App ID: `com.nes.dcp`
- Build output: `www/` directory

**Live Updates:**
- Service: Ionic Live Updates (Capacitor plugin)
- Configuration: `src/capacitor.config.ts`
- App ID: `1e8beef6`
- Channel: `Caspio Mobile App`
- Strategy: Differential updates with background sync
- Update timeout: 30 seconds with 3 max retries
- Service: `src/app/services/ionic-deploy.service.ts`, `src/app.component.ts`

**CI Pipeline:**
- Type: None detected in source
- Build scripts: `npm run build` (production), `npm run build:mobile` (mobile)
- Android/iOS builds via Capacitor: `npx cap copy android|ios && npx cap open android|ios`

## Environment Configuration

**Required env vars (development):**
- `environment.apiGatewayUrl` - AWS API Gateway endpoint
- `environment.cognito.*` - Cognito pool and client IDs
- `environment.caspio.*` - Caspio credentials (clientId, clientSecret, endpoints)
- `environment.s3.bucketName` - AWS S3 bucket name
- `environment.googleMapsApiKey` - Google Maps API key
- `environment.paypal.clientId` - PayPal client ID

**Secrets location:**
- Committed in: `src/environments/environment.ts`, `src/environments/environment.prod.ts`
- WARNING: Credentials are checked into source (Caspio clientSecret, Cognito IDs visible in environment files)

## Webhooks & Callbacks

**Incoming:**
- Caspio record update webhooks: Possible via Caspio API but not explicitly configured in source

**Outgoing:**
- S3 upload callbacks: Implicit (form POST to S3 presigned URLs)
- Caspio API calls: Direct REST calls from `caspio.service.ts` and API Gateway

## Network Resilience

**Offline Handling:**
- Connection monitoring: `src/app/services/connection-monitor.service.ts`
- Offline service: `src/app/services/offline.service.ts`
- Queue management: `src/app/services/operations-queue.service.ts`, page-specific queue services
- Sync strategy: `src/app/services/smart-sync.service.ts`, `src/app/services/background-sync.service.ts`

**Retry Logic:**
- Exponential backoff: Up to 3 retries in `api-gateway.service.ts`
- Retry notification: `src/app/services/retry-notification.service.ts`
- Request deduplication: `src/app/services/request-deduplication.service.ts`

## Background Operations

**Mobile Background Sync:**
- Service: Background Sync API (via Capacitor)
- Implementation: `src/app/services/background-sync.service.ts`
- Purpose: Sync queued operations when app is backgrounded
- Trigger: App lifecycle events, connection state changes

**Photo Upload Processing:**
- Queue: `src/app/services/background-photo-upload.service.ts`
- Image compression: `src/app/services/image-compression.service.ts`
- Annotations: Fabric.js canvas handling in `src/app/services/fabric.service.ts`

---

*Integration audit: 2026-01-23*

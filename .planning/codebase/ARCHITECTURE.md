# Architecture

**Analysis Date:** 2026-01-23

## Pattern Overview

**Overall:** Layered MVC with service-driven state management, offline-first architecture using Dexie IndexedDB, and selective module/component preloading.

**Key Characteristics:**
- Angular 20 + Ionic 8 framework for mobile/web hybrid
- Multi-service architecture (60+ services) managing distinct concerns
- Offline-first strategy with IndexedDB caching and sync queues
- Feature-based routing with lazy-loaded and eager-loaded modules
- RxJS-driven reactive data flow with caching layers
- Capacitor integration for native mobile features (camera, filesystem)

## Layers

**Presentation Layer:**
- Purpose: UI components, pages, and templates
- Location: `src/app/pages/`, `src/app/components/`, `src/app/modals/`
- Contains: Page components (standalone or module-based), reusable UI components
- Depends on: Services, state management, routing
- Used by: Angular template bindings, user interactions

**Service Layer:**
- Purpose: Business logic, data access, cross-cutting concerns
- Location: `src/app/services/`
- Contains: 60+ services organized by concern (Caspio API, caching, offline, sync, validation, etc.)
- Depends on: HttpClient, RxJS, Dexie, localStorage
- Used by: Pages, components, other services

**Data Access Layer:**
- Purpose: API communication and local data persistence
- Location: `src/app/services/caspio.service.ts`, `src/app/services/indexed-db.service.ts`
- Contains: HTTP interceptors, Caspio API client, IndexedDB adapter
- Depends on: HttpClient, Dexie, native platform APIs
- Used by: ProjectsService, offline cache service, mutation tracking

**State Management:**
- Purpose: Shared reactive state across pages/components
- Location: `src/app/pages/*/services/*-state.service.ts` (per-feature) and root services
- Contains: BehaviorSubject-based stores (HudStateService, DteStateService, etc.)
- Depends on: RxJS, service-to-service dependency injection
- Used by: Pages, form components, validation services

**Infrastructure/Platform:**
- Purpose: Platform detection, native capabilities, sync orchestration
- Location: `src/app/services/platform-detection.service.ts`, `src/app/services/background-sync.service.ts`
- Contains: Mobile/web detection, Capacitor integrations, sync queue processor
- Depends on: Capacitor, platform APIs
- Used by: App initialization, background operations

## Data Flow

**Online Data Flow (Caspio-First):**

1. User action (form submit, list navigation) triggers page/component
2. Component calls service method (e.g., `projectsService.createProject()`)
3. Service routes through `CaspioService.post/put/get()`
4. HTTP request with Auth/Caspio interceptors added
5. If `useApiGateway` enabled: routed through AWS API Gateway
6. Response cached in `CacheService` (memory) or `IndexedDbService` (persistent)
7. MutationTrackingService notified of mutations
8. BehaviorSubject updated in state service
9. Template re-renders via change detection

**Offline Data Flow (Cache-First):**

1. OfflineService detects offline state
2. Request queued in `OperationsQueueService`
3. Local cache checked: IndexedDB → localStorage → in-memory cache
4. Cached data returned to component
5. When online: queued operations processed by background-sync.service
6. Mutations tracked for conflict resolution
7. Sync status tracked in `SyncStatusWidget`

**Background Sync Flow:**

1. `BackgroundSyncService` monitors connection status
2. When online, processes queue from `OperationsQueueService`
3. Deduplication via `RequestDeduplicationService`
4. Retry logic with exponential backoff
5. Conflict resolution via `MutationTrackingService`
6. UI updates via BehaviorSubject notifications
7. Optimistic updates via `OptimisticUpdateService`

**State Management:**
- Each feature page maintains its own state service (e.g., `HudStateService`, `DteStateService`)
- BehaviorSubjects expose reactive observables for components
- Cache invalidation triggered by mutation tracking
- Validation state maintained separately in validation services

## Key Abstractions

**Service (60+ implementations):**
- Purpose: Encapsulate domain logic and side effects
- Examples: `ProjectsService`, `CaspioService`, `OfflineDataCacheService`, `CacheService`
- Pattern: Dependency injection, observable-returning methods, error handling

**State Service (per-feature):**
- Purpose: Centralized reactive state for a feature module
- Examples: `HudStateService`, `DteStateService`, `LbwStateService`
- Pattern: BehaviorSubject subjects with public observables, immutable updates

**Validation Service:**
- Purpose: Form validation and business rule checking
- Examples: `DteValidationService`, `HudValidationService`
- Pattern: Methods returning validation result objects with field-level errors

**Page Component (standalone or module-based):**
- Purpose: Route-mapped view with life cycle hooks
- Examples: `HudMainPage`, `DteMainPage`, `ProjectDetailsPage`
- Pattern: Dependency injection of services, async pipe in templates, form binding

## Entry Points

**App Bootstrap:**
- Location: `src/main.ts`
- Triggers: Browser page load
- Responsibilities: Service worker registration, AppModule bootstrap, platform initialization

**AppComponent:**
- Location: `src/app/app.component.ts`
- Triggers: Angular app initialization
- Responsibilities: Icon registration, theme initialization, performance monitoring, background sync startup, live updates check

**Router:**
- Location: `src/app/app-routing.module.ts`
- Triggers: URL changes, authentication checks
- Responsibilities: Route matching, module lazy-loading, guard evaluation, selective preloading

**Tabs Page:**
- Location: `src/app/tabs/tabs.page.ts` and `src/app/tabs/tabs-routing.module.ts`
- Triggers: Post-login navigation
- Responsibilities: Tab navigation, active projects/all projects/help/company routing

**Feature Container Pages:**
- Location: `src/app/pages/{hud,dte,lbw,engineers-foundation}/{feature}-container/`
- Triggers: Service selection from project page
- Responsibilities: Load shared state, preload templates, initialize child routes

## Error Handling

**Strategy:** Multi-layer error handling with global fallback

**Patterns:**
- HTTP errors caught by `AuthInterceptor` (401/403) and `CaspioInterceptor` (retry logic)
- Service-level errors caught with RxJS `catchError()` operator
- Global errors caught by `GlobalErrorHandlerService` (configured in AppModule)
- Form validation errors tracked in validation services and displayed in components
- Offline errors queued and retried by `BackgroundSyncService`
- Network errors detected by `ConnectionMonitorService` and `OfflineService`

## Cross-Cutting Concerns

**Logging:**
- Approach: Console logging with prefixes (e.g., `[OfflineCache]`, `[App]`, `[HUD]`)
- Debug mode controlled by `environment.production` flag (disabled in production)
- CaspioService avoids logging sensitive tokens/data

**Validation:**
- Approach: Synchronous validators in ValidationService, async form validators in form components
- Pattern: Return validation result objects with field-level error maps
- Usage: DTE, HUD, LBW, and Engineers Foundation each have custom validation services

**Authentication:**
- Approach: Token-based (Cognito client credentials)
- Pattern: CaspioService manages token lifecycle (refresh, expiration)
- Guards: AuthGuard checks token presence, AuthInterceptor adds token to requests
- Offline: Token cached in localStorage for offline page loads

**Caching:**
- Approach: Three-tier cache (in-memory → localStorage → IndexedDB)
- Pattern: CacheService for API responses, OfflineDataCacheService for templates, mutations invalidate cache
- TTL strategy: Different times for different data types (1min-24hrs)

**Offline Support:**
- Approach: OfflineService detects connectivity, queues requests when offline
- Pattern: OperationsQueueService maintains queue, BackgroundSyncService processes on reconnect
- IndexedDB: Dexie wrapper for template caching, service data, and pending operations

**Performance Monitoring:**
- Approach: PerformanceMonitorService tracks metrics
- Pattern: Lightweight instrumentation at service entry points
- Usage: Identifies slow operations for optimization

---

*Architecture analysis: 2026-01-23*

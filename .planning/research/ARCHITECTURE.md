# Architecture Patterns: Dexie-First Mobile Template Migration

**Domain:** Engineers-Foundation to HUD Template Migration
**Researched:** 2026-01-23
**Confidence:** HIGH (based on direct codebase analysis)

## Executive Summary

The engineers-foundation template implements a mature Dexie-first mobile architecture for offline-capable data management. The HUD template has partial implementation of this pattern. This document maps the component hierarchy, data flow, and file organization to guide the migration.

## Source vs Target Comparison

### File Structure Comparison

| Component | engineers-foundation | hud | Status |
|-----------|---------------------|-----|--------|
| **Container** | engineers-foundation-container.page.ts | hud-container.page.ts | SIMILAR - HUD has template loading but missing rehydration |
| **Main Page** | engineers-foundation-main.page.ts | hud-main.page.ts | SIMILAR - HUD missing EfeFieldRepo/VisualFieldRepo usage |
| **Data Service** | engineers-foundation-data.service.ts (~2200 lines) | hud-data.service.ts (~940 lines) | GAP - HUD has basic structure, missing 60% functionality |
| **Field Repo** | efe-field-repo.service.ts + visual-field-repo.service.ts | hud-field-repo.service.ts | EXISTS - HUD has full implementation |
| **State Service** | engineers-foundation-state.service.ts | hud-state.service.ts | SIMILAR - Both are basic BehaviorSubject patterns |
| **Routing** | 7 routes (main, project-details, structural hub, category, visual, elevation hub, room) | 4 routes (main, project-details, category) | SIMPLER - HUD has fewer pages |
| **Operations Queue** | (uses background-sync.service.ts directly) | hud-operations-queue.service.ts | EXISTS - HUD has dedicated queue |

### Key Findings

1. **HUD Container Already Has Loading Overlay**: The template loading pattern is implemented but missing rehydration logic
2. **HUD Data Service Needs Enhancement**: Has platform-aware code but missing cache invalidation subscriptions
3. **HUD Field Repo is Complete**: Full Dexie-first implementation with seeding, merging, live queries
4. **Missing Service Instance Tracking**: HUD container lacks the service instance numbering for multiple services

---

## Component Hierarchy

### Engineers-Foundation (Reference Implementation)

```
engineers-foundation/
├── engineers-foundation-container/          # Entry point, template loading
│   ├── engineers-foundation-container.page.ts
│   ├── engineers-foundation-container.page.html
│   └── engineers-foundation-container.page.scss
├── engineers-foundation-main/               # Hub with navigation cards
│   ├── engineers-foundation-main.page.ts
│   ├── engineers-foundation-main.page.html
│   └── engineers-foundation-main.page.scss
├── project-details/                         # Project metadata form
├── structural-systems/                      # Visual items hub + category detail + visual detail
│   ├── structural-systems-hub/
│   ├── category-detail/
│   └── visual-detail/
├── elevation-plot-hub/                      # Rooms list
├── room-elevation/                          # Individual room with points
├── services/                                # Feature-specific services
│   ├── engineers-foundation-state.service.ts
│   ├── engineers-foundation-validation.service.ts
│   └── engineers-foundation-pdf.service.ts
├── engineers-foundation-data.service.ts     # Main data orchestration
└── engineers-foundation-routing.module.ts   # Route definitions
```

### HUD (Target - Current State)

```
hud/
├── hud-container/                           # Entry point, template loading (partial)
│   ├── hud-container.page.ts
│   ├── hud-container.page.html
│   └── hud-container.page.scss
├── hud-main/                                # Hub with navigation cards
│   ├── hud-main.page.ts
│   ├── hud-main.page.html
│   └── hud-main.page.scss
├── hud-project-details/                     # Project metadata form
├── hud-category-detail/                     # Category items (Comments/Limitations/Deficiencies)
├── services/                                # Feature-specific services
│   ├── hud-state.service.ts
│   ├── hud-validation.service.ts
│   ├── hud-pdf.service.ts
│   ├── hud-field-repo.service.ts            # EXISTS - Full Dexie-first
│   ├── hud-operations-queue.service.ts      # EXISTS - Dedicated queue
│   └── hud-s3-upload.service.ts             # EXISTS - Photo uploads
├── hud-data.service.ts                      # Needs enhancement
└── hud-routing.module.ts                    # Route definitions
```

---

## Data Flow Patterns

### Dexie-First Architecture (engineers-foundation)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONTAINER PAGE (Entry Point)                      │
│  1. Check lastLoadedServiceId (static) to skip re-download           │
│  2. Show loading overlay (templateReady = false)                     │
│  3. Check needsRehydration() - restore data if purged                │
│  4. Download template data via OfflineTemplateService                │
│  5. Set templateReady = true, render child routes                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA SERVICE (Orchestration)                      │
│  - In-memory cache layer (5-minute TTL)                              │
│  - Subscribes to BackgroundSyncService events                        │
│  - Debounced cache invalidation (1 second)                           │
│  - cacheInvalidated$ Subject for page refresh                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│  FIELD REPO       │   │  OFFLINE TEMPLATE │   │  LOCAL IMAGE      │
│  (Dexie Tables)   │   │  SERVICE          │   │  SERVICE          │
│  - hudFields      │   │  - IndexedDB cache│   │  - localImages    │
│  - efeFields      │   │  - templates      │   │  - localBlobs     │
│  - visualFields   │   │  - service data   │   │  - uploadOutbox   │
└───────────────────┘   └───────────────────┘   └───────────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKGROUND SYNC SERVICE                           │
│  - Processes pending operations                                      │
│  - Emits completion events (visualSyncComplete$, photoUploadComplete$)│
│  - Updates caches after sync                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Data Flow Steps

**1. Template Entry (Container)**
```typescript
// engineers-foundation-container.page.ts pattern:
async ngOnInit() {
  this.route.params.subscribe(async params => {
    const isNewService = EngineersFoundationContainerPage.lastLoadedServiceId !== newServiceId;

    if (isNewService || isFirstLoad) {
      // Rehydration check
      if (!environment.isWeb && this.offlineService.isOnline()) {
        const needsRehydration = await this.foundationData.needsRehydration(newServiceId);
        if (needsRehydration) {
          await this.foundationData.rehydrateService(newServiceId);
        }
      }

      // Download template data
      await this.downloadTemplateData();
      EngineersFoundationContainerPage.lastLoadedServiceId = newServiceId;
    }
  });
}
```

**2. Field Repository Pattern**
```typescript
// Mobile: Read from Dexie, write-through with dirty flag
async setField(serviceId, category, templateId, patch) {
  if (!this.isDexieFirstEnabled()) return;

  await db.transaction('rw', db.hudFields, async () => {
    const existing = await db.hudFields.where('key').equals(key).first();
    if (existing) {
      await db.hudFields.update(existing.id!, {
        ...patch,
        rev: existing.rev + 1,
        updatedAt: Date.now(),
        dirty: true  // Mark for sync
      });
    }
  });

  // Track activity for smart purging
  this.serviceMetadata.touchService(serviceId);
  this.serviceMetadata.incrementLocalRevision(serviceId);
}
```

**3. Sync Event Subscription**
```typescript
// engineers-foundation-data.service.ts pattern:
private subscribeToSyncEvents(): void {
  // Visual sync
  this.backgroundSync.visualSyncComplete$.subscribe(event => {
    this.invalidateCachesForService(event.serviceId, 'visual_sync');
  });

  // Photo sync - CRITICAL: Don't emit cacheInvalidated$ (race condition)
  this.backgroundSync.photoUploadComplete$.subscribe(event => {
    this.visualAttachmentsCache.clear();
    this.imageCache.clear();
    // NO cacheInvalidated$.next() - page handles directly
  });

  // Background refresh
  this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
    this.visualsCache.delete(event.serviceId);
    this.debouncedCacheInvalidation(event.serviceId, `background_refresh_${event.dataType}`);
  });
}
```

---

## Gap Analysis: What HUD Needs

### 1. Container Page Gaps

| Feature | engineers-foundation | hud | Action |
|---------|---------------------|-----|--------|
| Static lastLoadedServiceId | YES | YES | DONE |
| Service instance numbering | YES | NO | ADD |
| Rehydration check | YES | NO | ADD |
| Template download | YES | YES | DONE |
| Sync event subscription | YES | YES | DONE |

**Code to Add (rehydration pattern):**
```typescript
// HUD Container needs this before downloadTemplateData():
if (!environment.isWeb && this.offlineService.isOnline()) {
  const needsRehydration = await this.hudData.needsRehydration(newServiceId);
  if (needsRehydration) {
    this.templateReady = false;
    this.downloadProgress = 'Restoring data from server...';
    await this.hudData.rehydrateService(newServiceId);
  }
}
```

### 2. Data Service Gaps

| Feature | engineers-foundation | hud | Action |
|---------|---------------------|-----|--------|
| cacheInvalidated$ Subject | YES | NO | ADD |
| debouncedCacheInvalidation() | YES | NO | ADD |
| subscribeToSyncEvents() comprehensive | YES | PARTIAL | ENHANCE |
| Background refresh subscription | YES | NO | ADD |
| verifyCacheHealth() | YES | NO | ADD |
| needsRehydration() | YES | NO | ADD |
| rehydrateService() | YES | NO | ADD |
| invalidateCachesForService() | YES | NO | ADD |

**Priority methods to add to hud-data.service.ts:**
1. `cacheInvalidated$` - Subject for page refresh triggers
2. `debouncedCacheInvalidation()` - Batch sync events
3. `subscribeToSyncEvents()` - Full subscription set
4. `needsRehydration()` / `rehydrateService()` - Data restoration

### 3. Main Page Gaps

| Feature | engineers-foundation | hud | Action |
|---------|---------------------|-----|--------|
| OfflineTemplateService usage | YES | NO | ADD for status options |
| EfeFieldRepo / VisualFieldRepo | YES | NO | N/A (HUD uses HudFieldRepo) |
| checkIfFinalized() offline-first | YES | NO | UPDATE to use cached data |
| Dexie record cleanup on finalize | YES | NO | ADD markAllCleanForService call |

### 4. Category Detail Gaps (Likely Complete)

The hud-category-detail.page.ts appears to have full Dexie-first implementation:
- LiveQuery subscription (subscribeToLiveHudFields)
- Sync event subscriptions
- Platform-aware mobile detection
- HudFieldRepo integration

---

## Suggested Migration Order

Based on dependency analysis and risk assessment:

### Phase 1: Data Service Enhancement (Foundation)
**Files:** `hud-data.service.ts`
**Add:**
- cacheInvalidated$ Subject and debounced emission
- Full sync event subscription (following EF pattern)
- needsRehydration() and rehydrateService() methods
- invalidateCachesForService() method
- verifyCacheHealth() method

**Rationale:** This is the foundation that all pages depend on. Must be solid before touching pages.

### Phase 2: Container Enhancement (Entry Point)
**Files:** `hud-container.page.ts`
**Add:**
- Rehydration check before template download
- (Optional) Service instance numbering for multiple HUD services

**Rationale:** Container controls the data loading flow. Once data service is ready, container orchestrates it.

### Phase 3: Main Page Enhancement (Finalization)
**Files:** `hud-main.page.ts`
**Update:**
- Use OfflineTemplateService for status options (offline-first)
- Add Dexie cleanup on finalization (markAllCleanForService)
- Improve finalization sync flow (match EF timeout pattern)

**Rationale:** Main page benefits from enhanced data service; finalization needs cleanup.

### Phase 4: Validation (Optional)
**Files:** `hud-validation.service.ts`
**Review:** Ensure validation reads from Dexie cache on mobile

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Emitting cacheInvalidated$ on Photo Sync
**What:** Triggering a full reload when a photo syncs
**Why bad:** Race condition - page may not have updated AttachID from temp to real, causing duplicate photos
**Instead:** Clear in-memory caches only; let page's direct photoUploadComplete$ subscription handle UI update

### Anti-Pattern 2: Using *ngIf on router-outlet
**What:** Conditionally rendering router-outlet based on templateReady
**Why bad:** Destroys all child components and their state, causing what looks like hard refresh
**Instead:** Always mount router-outlet, use CSS classes to hide content during loading

### Anti-Pattern 3: Checking templateReady in Same-Service Navigation
**What:** Re-showing loading overlay when navigating within same service
**Why bad:** Unnecessary UX disruption; data is already loaded
**Instead:** Only check lastLoadedServiceId, not templateReady state

### Anti-Pattern 4: Forgetting to Mark Records Clean After Finalization
**What:** Not calling markAllCleanForService() on finalization
**Why bad:** Leaves dirty flags set, causing unnecessary re-sync attempts
**Instead:** Always clean up Dexie records after successful sync/finalization

---

## Dexie Table Usage

### engineers-foundation Uses:
| Table | Purpose | Service |
|-------|---------|---------|
| `efeFields` | Elevation plot rooms/points | EfeFieldRepoService |
| `visualFields` | Structural system items | VisualFieldRepoService |
| `localImages` | Photo storage | LocalImageService |
| `localBlobs` | Binary photo data | LocalImageService |
| `uploadOutbox` | Pending uploads | BackgroundSyncService |
| `pendingRequests` | Pending API calls | BackgroundSyncService |
| `serviceMetadata` | Activity tracking | ServiceMetadataService |

### hud Uses (Already Implemented):
| Table | Purpose | Service |
|-------|---------|---------|
| `hudFields` | HUD items | HudFieldRepoService |
| `localImages` | Photo storage | LocalImageService |
| `localBlobs` | Binary photo data | LocalImageService |
| `uploadOutbox` | Pending uploads | BackgroundSyncService |
| `serviceMetadata` | Activity tracking | ServiceMetadataService |

**No new tables needed** - HUD already has the necessary Dexie infrastructure.

---

## Shared Services (Both Templates Use)

| Service | Location | Purpose |
|---------|----------|---------|
| OfflineTemplateService | services/offline-template.service.ts | Template caching, data download |
| OfflineService | services/offline.service.ts | Online/offline detection |
| BackgroundSyncService | services/background-sync.service.ts | Pending operation sync |
| LocalImageService | services/local-image.service.ts | Photo capture and sync |
| IndexedDbService | services/indexed-db.service.ts | Low-level Dexie operations |
| ServiceMetadataService | services/service-metadata.service.ts | Activity tracking for purge |
| PlatformDetectionService | services/platform-detection.service.ts | Mobile vs webapp detection |

---

## Sources

All findings are from direct codebase analysis:
- `src/app/pages/engineers-foundation/` - Reference implementation
- `src/app/pages/hud/` - Target implementation
- `src/app/services/caspio-db.ts` - Dexie schema definitions
- `src/app/services/efe-field-repo.service.ts` - EFE field pattern
- `src/app/services/background-sync.service.ts` - Sync event patterns

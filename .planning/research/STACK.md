# Technology Stack: Dexie-First Mobile HUD Implementation

**Project:** HUD Template Dexie-First Migration
**Researched:** 2026-01-23
**Confidence:** HIGH (direct source code analysis)

## Executive Summary

The engineers-foundation template implements a mature Dexie-first mobile architecture that HUD must replicate. The pattern centers on:

1. **Platform bifurcation** - Mobile uses Dexie/IndexedDB; webapp uses direct API
2. **Field-level granularity** - Each form field is a row in Dexie, not documents
3. **Write-through with dirty flags** - Immediate local writes, background sync
4. **Local-first photos** - Photos stored locally first, uploaded silently
5. **Operations queue** - Batched, deduplicated server operations with retry

HUD already has the core services (`HudFieldRepoService`, `HudOperationsQueueService`, `HudDataService`) implemented. The migration requires connecting the category-detail page to use these services instead of direct API calls.

---

## Recommended Stack (Already Implemented)

### Core Dexie Infrastructure

| Technology | Location | Purpose | Status |
|------------|----------|---------|--------|
| Dexie | `src/app/services/caspio-db.ts` | IndexedDB wrapper with live queries | SHARED |
| `CaspioDatabase` | `caspio-db.ts` | Dexie database class with all tables | SHARED |
| `db.hudFields` | `caspio-db.ts` v11 | HUD field-level storage table | EXISTS |

### HUD-Specific Services (Mobile Path)

| Service | Location | Purpose | Status |
|---------|----------|---------|--------|
| `HudFieldRepoService` | `hud/services/hud-field-repo.service.ts` | Field-level CRUD with dirty tracking | COMPLETE |
| `HudOperationsQueueService` | `hud/services/hud-operations-queue.service.ts` | Batched/deduplicated API operations | COMPLETE |
| `HudDataService` | `hud/hud-data.service.ts` | Platform-aware data orchestration | COMPLETE |

### Shared Infrastructure Services

| Service | Location | Purpose | Used By |
|---------|----------|---------|---------|
| `OfflineTemplateService` | `services/offline-template.service.ts` | Template download, data caching | Both EFE/HUD |
| `LocalImageService` | `services/local-image.service.ts` | Local-first photo storage | Both EFE/HUD |
| `IndexedDbService` | `services/indexed-db.service.ts` | Low-level IndexedDB operations | Both EFE/HUD |
| `BackgroundSyncService` | `services/background-sync.service.ts` | Sync events, upload processing | Both EFE/HUD |
| `PlatformDetectionService` | `services/platform-detection.service.ts` | Mobile vs webapp detection | Both EFE/HUD |
| `OperationsQueueService` | `services/operations-queue.service.ts` | Generic queue with executors | Both EFE/HUD |

---

## Architecture Pattern: Dexie-First Mobile

### Pattern Overview

```
MOBILE PATH (Capacitor Native):
  User Action
       |
       v
  HudFieldRepoService  <-- Write to Dexie immediately (dirty=true)
       |
       v
  liveQuery$           <-- UI auto-updates via Observable
       |
       v
  HudOperationsQueueService  <-- Queue API operation (deduped)
       |
       v
  BackgroundSyncService  <-- Process queue when online
       |
       v
  Mark field synced (dirty=false)

WEBAPP PATH (Browser):
  User Action
       |
       v
  Direct API call (CaspioService)
       |
       v
  In-memory cache (5 min TTL)
```

### Key Pattern Details

#### 1. Platform Detection Gate

Every Dexie-touching method MUST check platform first:

```typescript
// From HudFieldRepoService
isDexieFirstEnabled(): boolean {
  return this.platform.isMobile();
}

async setField(...) {
  if (!this.isDexieFirstEnabled()) {
    console.log('[HudFieldRepo] setField - Skipping (WEBAPP mode)');
    return;
  }
  // Dexie operations...
}
```

**Critical:** Webapp mode bypasses Dexie entirely. Only mobile uses the field repo.

#### 2. Field-Level Granularity

Each form field is its own Dexie row with compound key:

```typescript
// HudField schema
interface HudField {
  id?: number;                    // Auto-increment PK
  key: string;                    // Compound: `${serviceId}:${category}:${templateId}`
  serviceId: string;
  category: string;
  templateId: number;
  templateName: string;
  templateText: string;
  kind: 'Comment' | 'Limitation' | 'Deficiency';
  answerType: number;
  dropdownOptions?: string[];
  isSelected: boolean;            // Checkbox state
  answer: string;                 // User's answer
  otherValue: string;             // For "Other" dropdown selections
  hudId: string | null;           // Real server ID after sync
  tempHudId: string | null;       // Operation ID while pending
  photoCount: number;
  rev: number;                    // Revision counter
  updatedAt: number;              // Timestamp
  dirty: boolean;                 // Needs sync?
}
```

#### 3. Seeding Pattern

On category entry (first time), seed Dexie from cached templates:

```typescript
// Called in category-detail page ngOnInit
await this.hudFieldRepo.seedFromTemplates(serviceId, category, templates, dropdownData);
await this.hudFieldRepo.mergeExistingHudRecords(serviceId, category, existingHudRecords);
```

Seeding is **idempotent** - won't overwrite user data if fields already exist.

#### 4. Write-Through Pattern

Every user input immediately writes to Dexie:

```typescript
async setField(serviceId, category, templateId, patch) {
  await db.transaction('rw', db.hudFields, async () => {
    const existing = await db.hudFields.where('key').equals(key).first();
    if (existing) {
      await db.hudFields.update(existing.id!, {
        ...patch,
        rev: existing.rev + 1,
        updatedAt: Date.now(),
        dirty: true  // <-- Mark for sync
      });
    }
  });
}
```

#### 5. Reactive UI via liveQuery

Pages subscribe to Dexie changes:

```typescript
// In category-detail component
this.fields$ = this.hudFieldRepo.liveHudFields$(serviceId, category);

// Template
*ngFor="let field of fields$ | async"
```

`liveQuery` auto-emits whenever underlying data changes - no manual refresh needed.

#### 6. Operations Queue for API Calls

API calls are queued, not immediate:

```typescript
// Enqueue create operation (returns immediately)
const opId = await this.hudOpsQueue.enqueueCreateHudVisual(
  serviceId, category, templateId, hudData, fieldKey
);

// Executor runs later when queue processes
this.operationsQueue.setExecutor('CREATE_HUD_VISUAL', async (data) => {
  const response = await this.caspioService.createServicesHUD(data).toPromise();
  // On success, mark field synced
  await this.hudFieldRepo.markSynced(fieldKey, response.HUDID);
});
```

Features:
- **Deduplication** via `dedupeKey` - prevents duplicate create/update ops
- **Dependencies** - photo uploads wait for visual creation
- **Retry with backoff** - failed ops retry automatically
- **Callbacks** - `onSuccess`/`onError` for post-processing

#### 7. Local-First Photos

Photos stored in `LocalImages` table, uploaded silently:

```typescript
// Capture and store locally (instant)
const localImage = await this.localImageService.captureImage(
  file, 'hud', hudId, serviceId, caption, drawings
);

// Return immediately with local blob URL
return {
  imageId: localImage.imageId,     // Stable UUID for trackBy
  Photo: displayUrl,                // Local blob URL
  isPending: true,
  isLocalFirst: true
};

// BackgroundSync uploads when online, updates status
```

---

## What HUD Has vs What It Needs

### Already Complete

| Component | Status | Notes |
|-----------|--------|-------|
| `HudFieldRepoService` | COMPLETE | Full Dexie CRUD, seeding, dirty tracking |
| `HudOperationsQueueService` | COMPLETE | Executors registered, enqueue methods |
| `HudDataService` | COMPLETE | Platform bifurcation, mobile/webapp paths |
| `HudContainerPage` | COMPLETE | Template download, loading overlay |
| `db.hudFields` table | COMPLETE | Schema in caspio-db.ts v11 |

### Needs Migration (Category Detail Page)

The `hud-category-detail.page.ts` needs to:

1. **Seed on entry**: Call `seedFromTemplates()` and `mergeExistingHudRecords()` in `ngOnInit`
2. **Subscribe to liveQuery**: Use `liveHudFields$(serviceId, category)` instead of API
3. **Write-through on change**: Call `setField()` on every input change
4. **Queue operations on blur/save**: Enqueue via `HudOperationsQueueService`
5. **Photo integration**: Use `LocalImageService.captureImage()` for photos

### Implementation Checklist

```
[ ] Import HudFieldRepoService into category-detail
[ ] Call seedFromTemplates() in ionViewWillEnter (after templates loaded)
[ ] Call mergeExistingHudRecords() with existing API data
[ ] Replace this.loadData() with this.hudFieldRepo.liveHudFields$()
[ ] Replace API save calls with this.hudFieldRepo.setField()
[ ] Replace photo capture with LocalImageService flow
[ ] Subscribe to sync events for visual refresh on sync complete
[ ] Test offline: modify field, verify Dexie has data, go online, verify sync
```

---

## Database Schema Reference

### HudField Table (db.hudFields)

```typescript
// Index definition in caspio-db.ts
hudFields: '++id, key, [serviceId+category], [serviceId+category+templateId], serviceId, dirty, updatedAt'
```

Key queries:
- `where('[serviceId+category]').equals([serviceId, category])` - Get all fields for a category
- `where('dirty').equals(1)` - Get all dirty fields for sync
- `where('key').equals(key)` - Get single field by compound key

### LocalImages Table

```typescript
localImages: '++id, imageId, entityType, entityId, serviceId, status, createdAt'
```

Used for photo storage with `entityType: 'hud'` and `entityId: hudId`.

---

## Integration Points

### Sync Events to Subscribe

```typescript
// In category-detail page
this.backgroundSync.hudSyncComplete$.subscribe(event => {
  if (event.serviceId === this.serviceId) {
    // Optional: trigger any UI refresh beyond liveQuery
  }
});

this.backgroundSync.hudPhotoUploadComplete$.subscribe(event => {
  // Photo uploaded - status updated in LocalImages automatically
});
```

### Service Dependencies

```
HudCategoryDetailPage
  |-- HudFieldRepoService (Dexie CRUD)
  |-- HudOperationsQueueService (API batching)
  |-- HudDataService (platform routing)
  |-- LocalImageService (photos)
  |-- BackgroundSyncService (sync events)
  |-- IndexedDbService (templates cache)
```

---

## Sources

All findings derived from direct source code analysis:

| File | Key Patterns Extracted |
|------|----------------------|
| `src/app/pages/hud/services/hud-field-repo.service.ts` | Dexie-first architecture, seeding, write-through |
| `src/app/pages/hud/services/hud-operations-queue.service.ts` | Queue executors, deduplication, dependencies |
| `src/app/pages/hud/hud-data.service.ts` | Platform bifurcation, mobile vs webapp paths |
| `src/app/services/caspio-db.ts` | Dexie schema, hudFields table, liveQuery methods |
| `src/app/pages/engineers-foundation/engineers-foundation-container.page.ts` | Container pattern, template download flow |
| `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts` | Mature offline-first patterns, local image integration |

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| Dexie schema | HIGH | Direct db.hudFields schema in caspio-db.ts |
| HudFieldRepoService API | HIGH | Complete service with JSDoc |
| Operations queue pattern | HIGH | Full executor implementation |
| Platform bifurcation | HIGH | Explicit isMobile() checks throughout |
| Integration points | HIGH | Existing sync event subscriptions |
| Category-detail migration | MEDIUM | Pattern clear, implementation not started |

**Overall confidence: HIGH** - The stack is already implemented and documented in code.

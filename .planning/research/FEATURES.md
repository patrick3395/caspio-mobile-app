# Feature Landscape: Dexie-First Mobile Implementation

**Domain:** Dexie-first mobile template migration (engineers-foundation to hud)
**Researched:** 2026-01-23
**Confidence:** HIGH (direct codebase analysis)

## Overview

This document catalogs all features and behaviors in the engineers-foundation Dexie-first implementation that must be copied to the hud template. The analysis is based on direct examination of the source code.

---

## Table Stakes (Must Copy Exactly)

Features that the hud template MUST have to achieve Dexie-first parity with engineers-foundation.

### 1. Container-Level Template Loading

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| Template loading overlay | Blocks UI until offline data ready | Low | `engineers-foundation-container.page.ts` |
| Static lastLoadedServiceId tracking | Prevents redundant re-downloads on navigation | Low | Container class |
| CSS-based hiding (not *ngIf) | Prevents router-outlet destruction on state change | Low | Container HTML |
| Rehydration check | Restores data after smart purge | Medium | Container ngOnInit |
| Template verification | Confirms cached data exists before proceeding | Medium | `verifyCachedDataExists()` |

**Implementation Pattern:**
```typescript
// CRITICAL: Static property persists across component recreation
private static lastLoadedServiceId: string = '';

// In ngOnInit route.params subscription:
const isNewService = ContainerPage.lastLoadedServiceId !== newServiceId;
const isFirstLoad = !ContainerPage.lastLoadedServiceId;

// Rehydration check (before template download)
if (!environment.isWeb && this.offlineService.isOnline()) {
  const needsRehydration = await this.dataService.needsRehydration(newServiceId);
  if (needsRehydration) {
    await this.dataService.rehydrateService(newServiceId);
  }
}

// Only download for NEW service
if (isNewService || isFirstLoad) {
  await this.downloadTemplateData();
  ContainerPage.lastLoadedServiceId = newServiceId;
} else {
  this.templateReady = true;
}
```

**Status in HUD:** Partially implemented - has loading overlay but MISSING rehydration check.

---

### 2. Sync Event Subscriptions

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| Visual sync subscription | Refresh cache when visuals sync | Low | Container |
| Photo upload subscription | Update UI when photos sync | Low | Container |
| Service data sync subscription | Refresh when project data syncs | Low | Container |

**Implementation Pattern:**
```typescript
private subscribeToSyncEvents(): void {
  const visualSub = this.backgroundSync.visualSyncComplete$.subscribe(event => {
    if (event.serviceId === this.serviceId) {
      // Cache automatically refreshed by BackgroundSyncService
    }
  });
  this.syncSubscriptions.push(visualSub);

  const photoSub = this.backgroundSync.photoUploadComplete$.subscribe(event => {
    // Cache automatically refreshed
  });
  this.syncSubscriptions.push(photoSub);

  const serviceSub = this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
    if (event.serviceId === this.serviceId || event.projectId === this.projectId) {
      // Cache automatically refreshed
    }
  });
  this.syncSubscriptions.push(serviceSub);
}
```

**Status in HUD:** Implemented with HUD-specific events (`hudSyncComplete$`, `hudPhotoUploadComplete$`).

---

### 3. Service Instance Number Tracking

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| Multiple service detection | Shows "HUD #1", "HUD #2" in header | Medium | `loadServiceInstanceNumber()` |
| serviceInstanceLoaded flag | Prevents breadcrumb updates before load | Low | Container |

**Status in HUD:** NOT IMPLEMENTED - HUD container lacks service instance tracking.

---

### 4. Data Service Platform Awareness

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| `isMobile()` / `isWebapp()` methods | Determines Dexie-first vs API-direct path | Low | Data service |
| Platform-specific read paths | Mobile reads Dexie first, webapp calls API | Medium | `getVisualsByService()` |
| Platform-specific write paths | Mobile queues operations, webapp calls directly | Medium | `createVisual()`, `updateVisual()` |
| In-memory cache with TTL | 5-minute cache for webapp mode | Low | Data service |

**Status in HUD:** FULLY IMPLEMENTED in `hud-data.service.ts`.

---

### 5. Field Repository Service (Dexie-First Core)

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| `seedFromTemplates()` | Initialize Dexie from cached templates | High | `hud-field-repo.service.ts` |
| `mergeExistingHudRecords()` | Apply existing selections to fields | High | Field repo |
| `liveHudFields$()` | Reactive Observable for UI updates | Medium | Field repo |
| `setField()` with dirty flag | Write-through with sync tracking | Medium | Field repo |
| `markSynced()` | Clear dirty flag after sync | Low | Field repo |
| IndexedDB connection recovery | Handle connection drops gracefully | Medium | Field repo |
| In-memory cache fallback | Return cached data on DB errors | Medium | Field repo |

**Status in HUD:** FULLY IMPLEMENTED in `hud-field-repo.service.ts`.

---

### 6. Operations Queue Service

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| Executor registration | Register CREATE/UPDATE/DELETE/UPLOAD handlers | High | `hud-operations-queue.service.ts` |
| Deduplication keys | Prevent duplicate operations | Medium | Queue service |
| Dependency resolution | Photos wait for parent visual creation | High | Queue service |
| Temp ID mapping | Resolve temp IDs to real IDs after sync | High | Queue service |
| `syncComplete$` event | Notify UI when operations complete | Medium | Queue service |

**Status in HUD:** FULLY IMPLEMENTED in `hud-operations-queue.service.ts`.

---

### 7. Local-First Photo Handling

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| `LocalImageService` integration | Store photos locally with stable UUIDs | High | Data service |
| Merged attachments (local + server) | Display both local and synced photos | High | `getVisualAttachments()` |
| Silent sync (no uploading indicators) | Photos appear normal, sync in background | Medium | Photo methods |
| Pending caption queue | Queue caption updates for background sync | Medium | `queueCaptionUpdate()` |

**Status in HUD:** FULLY IMPLEMENTED in `hud-data.service.ts`.

---

### 8. Rehydration System

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| `needsRehydration()` | Check if service was purged | Low | Data service |
| `rehydrateService()` | Restore data from server after purge | High | Data service |
| Service metadata tracking | Track purge state and revision | Medium | `ServiceMetadataService` |

**Status in HUD:** NOT IMPLEMENTED - HUD container does not call rehydration check.

---

### 9. Cache Invalidation System

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| `cacheInvalidated$` Subject | Notify pages when caches are cleared | Medium | Data service |
| Debounced invalidation | Batch rapid sync events into one UI refresh | Medium | Data service |
| Per-service cache clearing | Clear only affected service caches | Low | Data service |
| Background refresh handling | Update in-memory caches when IndexedDB refreshes | Medium | Data service |

**Status in HUD:** PARTIALLY IMPLEMENTED - HUD has basic cache clearing but not full invalidation system.

---

### 10. Cache Health Verification

| Feature | Why Required | Complexity | Source File |
|---------|--------------|------------|-------------|
| `verifyCacheHealth()` | Check all required data types are cached | Medium | Data service |
| `ensureDataCached()` | Fetch and cache if missing | Medium | Data service |

**Status in HUD:** NOT IMPLEMENTED - HUD has simpler `verifyCachedDataExists()`.

---

## Implementation Details That Matter

### CSS Loading Overlay Pattern

The loading overlay MUST use CSS visibility, NOT `*ngIf`:

```html
<!-- CORRECT: CSS-based hiding -->
<div class="template-loading-overlay" [class.hidden]="templateReady">
  ...
</div>

<div class="router-wrapper" [class.loading]="!templateReady">
  <router-outlet></router-outlet>
</div>
```

**Why:** Using `*ngIf` on `router-outlet` destroys ALL child components, causing data loss and what looks like a hard refresh.

---

### Static Service ID Pattern

The `lastLoadedServiceId` MUST be static:

```typescript
// CORRECT: Static persists across component recreation
private static lastLoadedServiceId: string = '';

// WRONG: Instance variable resets when Ionic recreates page
private lastLoadedServiceId: string = '';
```

**Why:** Ionic destroys/recreates page components on navigation. Instance variables reset to defaults, causing unnecessary re-downloads.

---

### LiveQuery Subscription Pattern

For mobile, pages should subscribe to liveQuery for reactive updates:

```typescript
// In ngOnInit
if (this.isMobile) {
  this.subscribeToLiveHudFields();
}

private subscribeToLiveHudFields(): void {
  this.hudFieldsSubscription = this.hudFieldRepo
    .liveHudFields$(this.serviceId, this.category)
    .subscribe(fields => {
      this.updateUIFromFields(fields);
    });
}
```

---

### Photo Upload Flow

1. User takes photo -> `LocalImageService.captureImage()` stores blob + metadata atomically
2. Photo appears immediately in UI with local blob URL
3. `BackgroundSyncService.processUploadOutbox()` handles upload silently
4. After sync, `LocalImageService` updates status to 'verified'
5. Local blob continues displaying until remote URL verified

---

## Behaviors That Define Dexie-First

### 1. No Loading Screens Within Template

Once inside a template (past the container), pages should:
- Render immediately from Dexie
- Show data instantly without "Loading..." screens
- Background refresh happens silently

### 2. Offline Capability

When offline:
- All reads work from Dexie
- All writes queue for later sync
- UI never blocks or shows errors
- Photos display from local blobs

### 3. Background Sync

- 60-second sync interval for batched operations
- High-priority operations (creates) sync first
- Photo uploads processed in parallel
- Caption updates batched and synced

### 4. Data Never Lost

- Dexie is always source of truth
- Dirty flags track what needs sync
- Pending operations persist across app restarts
- Local images stored with stable UUIDs

---

## Anti-Features (What NOT to Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Blocking API calls in ngOnInit | Causes loading delays | Read from Dexie first |
| `*ngIf` on router-outlet | Destroys child components | Use CSS visibility |
| Instance variable for lastLoadedServiceId | Resets on page recreation | Use static property |
| Showing upload spinners on photos | Breaks "offline normal" illusion | Silent sync in background |
| Re-downloading template on same-service navigation | Causes unnecessary delays | Check static lastLoadedServiceId |

---

## Feature Dependencies

```
Template Download (container)
    |
    +--> Rehydration Check (if online + previously purged)
    |
    +--> Field Repo Seeding (from cached templates)
    |
    +--> Merge Existing Records (apply user selections)
    |
    +--> LiveQuery Subscription (reactive UI updates)
          |
          +--> Operations Queue (write-through)
          |
          +--> Background Sync (silent persistence)
```

---

## Gap Analysis: HUD vs Engineers-Foundation

### Fully Implemented in HUD

- [x] HudDataService with platform awareness
- [x] HudFieldRepoService with Dexie-first pattern
- [x] HudOperationsQueueService with executors
- [x] Local-first photo handling
- [x] Sync event subscriptions (HUD-specific)
- [x] Loading overlay in container
- [x] CSS-based visibility for overlay

### Missing from HUD

- [ ] **Rehydration check in container** - Critical for smart purge recovery
- [ ] **Service instance number tracking** - Shows "HUD #1", "HUD #2" in header
- [ ] **Cache health verification methods** - `verifyCacheHealth()`, `ensureDataCached()`
- [ ] **Full cache invalidation system** - `cacheInvalidated$` Subject with debouncing
- [ ] **Background refresh handling** - Subscribe to `backgroundRefreshComplete$`

### Differences (Intentional)

| Aspect | Engineers-Foundation | HUD |
|--------|---------------------|-----|
| Template type | EFE + Visual templates | HUD templates (TypeID=2) |
| Data tables | LPS_Services_Visuals, LPS_Services_EFE | LPS_Services_HUD |
| Attachment tables | LPS_Services_Visuals_Attach, LPS_Services_EFE_Points_Attach | LPS_Services_HUD_Attach |
| Sync events | `visualSyncComplete$`, `photoUploadComplete$` | `hudSyncComplete$`, `hudPhotoUploadComplete$` |

---

## MVP Recommendation

For HUD Dexie-first parity, prioritize:

1. **Add rehydration check to HUD container** - Prevents data loss after smart purge
2. **Add service instance tracking** - Better UX for multiple HUD services
3. **Add cache invalidation Subject** - Enables proper reactive updates

Defer to post-MVP:
- Full cache health verification system - Current simpler approach works
- Background refresh subscription - Sync events already handle this

---

## Sources

All findings based on direct codebase analysis:

- `src/app/pages/engineers-foundation/engineers-foundation-container/engineers-foundation-container.page.ts`
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts`
- `src/app/pages/engineers-foundation/services/engineers-foundation-state.service.ts`
- `src/app/pages/hud/hud-container/hud-container.page.ts`
- `src/app/pages/hud/hud-data.service.ts`
- `src/app/pages/hud/services/hud-field-repo.service.ts`
- `src/app/pages/hud/services/hud-operations-queue.service.ts`
- `src/app/pages/hud/services/hud-state.service.ts`
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`

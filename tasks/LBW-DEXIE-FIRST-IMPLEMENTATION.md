# LBW Mobile Template - DEXIE-First Implementation Tasks

## Overview

This document outlines the tasks required to implement full DEXIE-first mobile functionality for the LBW (Lead-Based Paint/Windows) template. The implementation should mirror the HUD template patterns exactly.

**Reference Implementation:** `src/app/pages/hud/`

**Target Implementation:** `src/app/pages/lbw/`

---

## Current State Assessment

### What Exists
- Basic LBW page structure (`lbw-container`, `lbw-main`, `lbw-category-detail`, `lbw-visual-detail`)
- `lbw-data.service.ts` with partial DEXIE-first patterns
- Basic photo upload functionality
- Integration with `BackgroundSyncService` for photo uploads

### What's Missing/Incomplete
- Full offline-first record creation with temp IDs
- Proper cache invalidation and debouncing
- Complete photo management with stable UUIDs
- Custom statement creation flow
- VisualFields normalization for LBW
- Silent sync patterns (no spinners)
- Complete caption/annotation queueing
- 4-tier photo fallback pattern in all pages

---

## Task Breakdown

### Phase 1: Data Service Foundation

#### Task 1.1: Review and Audit `lbw-data.service.ts`
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Compare `lbw-data.service.ts` against `hud-data.service.ts` to identify missing patterns.

**Checklist:**
- [ ] Verify `subscribeToSyncEvents()` has all required subscriptions:
  - [ ] `visualSyncComplete$` for LBW records
  - [ ] `lbwPhotoUploadComplete$` for photo uploads
  - [ ] `indexedDb.imageChange$` for image changes
  - [ ] `offlineTemplate.backgroundRefreshComplete$` for cache refresh
- [ ] Verify `debouncedCacheInvalidation()` is implemented with 1-second debounce
- [ ] Verify `cacheInvalidated$` subject exists for pages to subscribe
- [ ] Check that all cache maps are properly declared:
  - [ ] `lbwCache: Map<string, any[]>`
  - [ ] `lbwAttachmentsCache: Map<string, any[]>`

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` lines 1-150 (subscriptions)

---

#### Task 1.2: Implement `createVisual()` Offline-First Pattern
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure `createVisual()` follows the complete offline-first pattern.

**Checklist:**
- [ ] Generate temp ID using `tempId.generateTempId('lbw')`
- [ ] Create placeholder with all required fields:
  ```typescript
  {
    LBWID: tempId,
    PK_ID: tempId,
    _tempId: tempId,
    _localOnly: true,
    _syncing: true,
    _createdAt: Date.now()
  }
  ```
- [ ] Queue CREATE request in `pendingRequests`
- [ ] Cache placeholder to `'lbw_records'` cache immediately
- [ ] Return placeholder synchronously (never await network)

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` `createVisual()` method

---

#### Task 1.3: Implement `updateVisual()` Offline-First Pattern
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure updates are cached locally first, then queued for sync.

**Checklist:**
- [ ] Distinguish temp IDs vs real IDs for different queue behavior
- [ ] For temp IDs: update `pendingRequests` data directly
- [ ] For real IDs: queue UPDATE request
- [ ] Update `'lbw_records'` cache with `_localUpdate: true` flag
- [ ] Clear in-memory caches after update

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` `updateVisual()` method

---

#### Task 1.4: Implement `getVisualsByService()` with Cache-First Pattern
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure data loading uses cache-first approach with background refresh.

**Checklist:**
- [ ] Check in-memory cache first (`lbwCache`)
- [ ] Check IndexedDB cache second (`'lbw_records'`)
- [ ] Merge cached data with pending records (temp IDs)
- [ ] Return cached data immediately
- [ ] Trigger background refresh if online
- [ ] Protect local updates during background refresh

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`
- `src/app/services/offline-template.service.ts` (if `getLbwByService` needs updates)

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` `getHudByService()` method

---

### Phase 2: Photo Management

#### Task 2.1: Implement `uploadVisualPhoto()` with Stable UUIDs
**Priority:** High
**Estimated Complexity:** High

**Description:**
Ensure photo uploads use stable UUIDs and local-first storage.

**Checklist:**
- [ ] Use `LocalImageService.captureImage()` for photo storage
- [ ] Return stable `imageId` (format: `img_<uuid>`)
- [ ] Store photo with correct entity references:
  ```typescript
  {
    entityType: 'lbw',
    entityId: lbwIdStr,
    serviceId: effectiveServiceId
  }
  ```
- [ ] Return photo data immediately (local blob URL)
- [ ] Set flags for silent sync:
  ```typescript
  {
    _syncing: false,      // SILENT: Don't show syncing indicator
    uploading: false,     // SILENT: Don't show upload spinner
    isLocalFirst: true
  }
  ```

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` `uploadVisualPhoto()` method

---

#### Task 2.2: Implement `getVisualAttachments()` with Local-First Pattern
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure photo retrieval checks local storage first.

**Checklist:**
- [ ] Check `LocalImageService.getImagesForEntity('lbw', lbwId)` first
- [ ] Convert local images to attachment format
- [ ] Merge with cached attachments from `'lbw_attachments'`
- [ ] De-duplicate by imageId/attachId
- [ ] Return combined results immediately

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` `getVisualAttachments()` method

---

#### Task 2.3: Implement Caption/Annotation Queueing
**Priority:** Medium
**Estimated Complexity:** Medium

**Description:**
Ensure caption updates are never lost.

**Checklist:**
- [ ] Implement `queueCaptionUpdate()` method
- [ ] Update local cache immediately with `_localUpdate` flag
- [ ] Queue in `pendingCaptions` table (ALWAYS, even if online)
- [ ] Update `LocalImages` table with caption
- [ ] WEBAPP: Try API call if online, queue on failure

**Files to Modify:**
- `src/app/pages/lbw/lbw-data.service.ts`

**Reference:**
- `src/app/pages/hud/hud-data.service.ts` `queueCaptionUpdate()` method

---

### Phase 3: Background Sync Integration

#### Task 3.1: Add LBW Case to `BackgroundSyncService` Photo Upload
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure background sync handles LBW photo uploads.

**Checklist:**
- [ ] Add `lbwPhotoUploadComplete$` subject (if not exists)
- [ ] Add `'lbw'` case in photo upload switch statement
- [ ] Call `createServicesLBWAttachWithFile()` for LBW photos
- [ ] Emit `lbwPhotoUploadComplete$` after successful upload
- [ ] Update `tempIdMappings` with real AttachID

**Files to Modify:**
- `src/app/services/background-sync.service.ts`

**Reference:**
- Look for `'hud'` case in `processPhotoUpload()` method

---

#### Task 3.2: Add LBW Case to Record Sync Processing
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure background sync processes LBW CREATE/UPDATE requests.

**Checklist:**
- [ ] Add `'lbw'` case in pending request processing
- [ ] Handle CREATE requests: POST to `LPS_Services_LBW`
- [ ] Handle UPDATE requests: PUT to `LPS_Services_LBW`
- [ ] Update `tempIdMappings` with real LBWID
- [ ] Update `cachedServiceData` with server response
- [ ] Emit sync completion event

**Files to Modify:**
- `src/app/services/background-sync.service.ts`

**Reference:**
- Look for `'hud'` case in `processPendingRequest()` method

---

### Phase 4: Category Detail Page

#### Task 4.1: Implement `loadDataFromCache()` for MOBILE Mode
**Priority:** High
**Estimated Complexity:** High

**Description:**
Implement cache-first data loading without spinners.

**Checklist:**
- [ ] Check for MOBILE mode (`!environment.isWeb`)
- [ ] Load templates from `getCachedTemplates('lbw')`
- [ ] Load records from `getLbwByService()` (cache-first)
- [ ] Build `organizedData` from templates + visuals
- [ ] Load Dexie `visualFields` for local changes
- [ ] Build `templateToVisualMap` for ID matching
- [ ] Merge Dexie field data (title, text, answer, otherValue)
- [ ] Handle custom visuals (negative templateIds)
- [ ] Build `lastConvertedFields` for photo matching
- [ ] Call `populatePhotosFromDexie()`
- [ ] Subscribe to `visualFieldsSubscription`
- [ ] Set `initialLoadComplete = true`

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` `loadDataFromCache()` method

---

#### Task 4.2: Implement `populatePhotosFromDexie()` with 4-Tier Fallback
**Priority:** High
**Estimated Complexity:** High

**Description:**
Implement robust photo lookup that never loses photos.

**Checklist:**
- [ ] Add mutex to prevent concurrent calls (`isPopulatingPhotos`)
- [ ] Query `LocalImageService.getImagesForService(serviceId, 'lbw')`
- [ ] Group images by `entityId` in Map
- [ ] For each field, implement 4-tier lookup:
  1. **TIER 1:** Lookup by `realId` (visualId)
  2. **TIER 2:** Lookup by `tempId` (tempVisualId)
  3. **TIER 3:** Check `getRealId(tempId)` mapping
  4. **TIER 4:** Reverse lookup via `getTempId(realId)`
- [ ] Convert `LocalImage` to photo display format
- [ ] Check for cached annotated images
- [ ] Update `visualPhotos[key]` array
- [ ] Update `photoCountsByKey[key]`

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` `populatePhotosFromDexie()` method

---

#### Task 4.3: Implement `subscribeToVisualFieldChanges()`
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Subscribe to Dexie liveQuery for reactive updates.

**Checklist:**
- [ ] Subscribe to `visualFieldRepo.getAllFieldsForService$(serviceId)`
- [ ] Update `lastConvertedFields` on each emission
- [ ] Update `visualRecordIds` with fresh IDs
- [ ] Update custom item names from Dexie `templateName`
- [ ] Call `populatePhotosFromDexie()` with fresh fields
- [ ] Trigger change detection

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` `subscribeToVisualFieldChanges()` method

---

#### Task 4.4: Subscribe to Photo Upload Completion Events
**Priority:** Medium
**Estimated Complexity:** Low

**Description:**
Update UI when photos finish uploading in background.

**Checklist:**
- [ ] Subscribe to `backgroundSync.lbwPhotoUploadComplete$`
- [ ] Find photo in `visualPhotos` by `imageId`
- [ ] Update photo with real `AttachID`
- [ ] Set `uploading: false`, `queued: false`, `isLocal: false`
- [ ] Trigger change detection

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` subscription in `subscribeToUploadUpdates()`

---

### Phase 5: Visual Detail Page

#### Task 5.1: Implement `subscribeToVisualFieldChanges()` in Visual Detail
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Track sync completion and update item name/text.

**Checklist:**
- [ ] Subscribe to `visualFields` liveQuery for this template
- [ ] Track `lastKnownLbwId` to detect sync completion
- [ ] When `visualId` changes from temp to real:
  - [ ] Update `item.id` reference
  - [ ] Reload photos with new ID
- [ ] Update `item.name` and `item.text` from Dexie

**Files to Modify:**
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` `subscribeToVisualFieldChanges()` method

---

#### Task 5.2: Implement `loadPhotos()` with 4-Tier Fallback
**Priority:** High
**Estimated Complexity:** Medium

**Description:**
Ensure photos are found after sync updates entityIds.

**Checklist:**
- [ ] Use `tempVisualId || visualId` as primary lookup
- [ ] **Fallback 1:** Try alternate ID if both exist
- [ ] **Fallback 2:** Check `getRealId()` for temp->real mapping
- [ ] **Fallback 3:** Reverse lookup via `getTempId()`
- [ ] Log which tier found the photos

**Files to Modify:**
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` `loadPhotos()` method

---

#### Task 5.3: Update `ionViewWillEnter()` for MOBILE Mode
**Priority:** Medium
**Estimated Complexity:** Low

**Description:**
Reload data when returning to page (sync may have completed).

**Checklist:**
- [ ] Check for MOBILE mode
- [ ] If `initialLoadComplete`, repopulate from Dexie
- [ ] Merge Dexie visual fields
- [ ] Reload photos if needed

**Files to Modify:**
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` `ionViewWillEnter()` method

---

### Phase 6: Custom Statement Creation

#### Task 6.1: Implement Custom Visual Creation Flow
**Priority:** Medium
**Estimated Complexity:** High

**Description:**
Allow users to create custom statements with photos.

**Checklist:**
- [ ] Create visual record via `hudData.createVisual()` (gets temp LBWID)
- [ ] Generate negative `templateId` for custom items (e.g., `-Date.now()`)
- [ ] Upload photos BEFORE calling `setField()` (DEXIE-FIRST)
- [ ] Use `LocalImageService.captureImage()` for each photo
- [ ] Create `visualFields` entry with `isSelected: true`
- [ ] Add to `organizedData` appropriate section
- [ ] Update `visualRecordIds` and `selectedItems`

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Reference:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` `createCustomVisualWithPhotos()` method

---

#### Task 6.2: Implement Add Custom Visual Modal
**Priority:** Medium
**Estimated Complexity:** Medium

**Description:**
Modal for capturing custom statement details and photos.

**Checklist:**
- [ ] Create modal component (or reuse existing)
- [ ] Fields: Name, Text, Kind (Comment/Limitation/Deficiency)
- [ ] Photo capture/selection
- [ ] Annotation support
- [ ] Return processed data to parent

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`
- May need new modal component

**Reference:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` Add modal implementation

---

### Phase 7: Cleanup and Polish

#### Task 7.1: Remove Loading Spinners for Local Operations
**Priority:** Medium
**Estimated Complexity:** Low

**Description:**
Ensure no spinners appear for local operations.

**Checklist:**
- [ ] Remove `loading = true` for MOBILE mode data loads
- [ ] Remove upload spinners on photos (use `uploading: false`)
- [ ] Remove "Saving..." indicators for local saves
- [ ] Only show spinners for WEBAPP mode API calls

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

---

#### Task 7.2: Add Proper ngOnDestroy Cleanup
**Priority:** Low
**Estimated Complexity:** Low

**Description:**
Clean up subscriptions to prevent memory leaks.

**Checklist:**
- [ ] Unsubscribe from `visualFieldsSubscription`
- [ ] Clear timeout timers (`localOperationCooldownTimer`, etc.)
- [ ] Unsubscribe from sync event subscriptions

**Files to Modify:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

---

#### Task 7.3: Add LbwField Interface to Dexie Schema
**Priority:** Low
**Estimated Complexity:** Medium

**Description:**
Add normalized field storage for LBW (like HudField).

**Checklist:**
- [ ] Define `LbwField` interface in `caspio-db.ts`
- [ ] Add `lbwFields` table to Dexie schema
- [ ] Add indexes: `[serviceId+category]`, `templateId`, `lbwId`
- [ ] Create `LbwFieldRepoService` (or extend `VisualFieldRepoService`)

**Files to Modify:**
- `src/app/services/caspio-db.ts`
- May need new `lbw-field-repo.service.ts`

**Reference:**
- `src/app/services/caspio-db.ts` `HudField` interface

---

## Verification Checklist

After completing all tasks, verify the following scenarios work correctly:

### Offline Scenario Testing
- [ ] Create new LBW visual item while offline
- [ ] Item appears immediately in UI
- [ ] Take photos while offline - photos appear instantly
- [ ] Edit caption while offline - caption saves locally
- [ ] Go online - items sync in background
- [ ] Photos sync without spinners or interruption
- [ ] After sync, photos still visible (not disappeared)
- [ ] Item names show correct custom name (not "Custom Item")

### Navigation Testing
- [ ] Navigate away from category-detail and back - data persists
- [ ] Navigate away from visual-detail and back - photos persist
- [ ] Close app and reopen - all data restored from Dexie
- [ ] Force sync - no data loss during sync

### Sync Completion Testing
- [ ] Temp IDs update to real IDs after sync
- [ ] Photos remain visible after entityId changes
- [ ] Captions persist after sync
- [ ] Annotations persist after sync

---

## Dependencies

### Services Used
- `LbwDataService` - Data operations
- `LocalImageService` - Photo capture and storage
- `IndexedDbService` - Local storage
- `BackgroundSyncService` - Background sync
- `OfflineTemplateService` - Cache management
- `TempIdService` - Temp ID generation
- `VisualFieldRepoService` - Field normalization

### Dexie Tables
- `localImages` - Photo metadata
- `localBlobs` - Photo binary data
- `uploadOutbox` - Photo upload queue
- `pendingRequests` - Record CREATE/UPDATE queue
- `cachedServiceData` - Service data cache (`lbw_records`)
- `pendingCaptions` - Caption update queue
- `tempIdMappings` - Temp to real ID mapping
- `visualFields` - Visual field normalization

---

## Notes

- **NEVER** show loading spinners for MOBILE mode local operations
- **ALWAYS** return synchronously from create/update methods
- **NEVER** wait for network in user-facing operations
- Photos should appear instantly after capture
- Sync should be completely silent (no UI indicators)
- Data should never be lost, even during sync failures

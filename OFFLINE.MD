# Engineers Foundation Offline-First Implementation Review

## Overview

This document provides a comprehensive review of the offline-first functionality implemented for the Engineers Foundation module, including what has been achieved, current architecture, and remaining challenges.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Components                             │
│  (category-detail.page.ts, room-elevation.page.ts, etc.)        │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Engineers Foundation Data Service                   │
│  (engineers-foundation-data.service.ts)                         │
│  - In-memory caches (visualsCache, attachmentsCache, etc.)      │
│  - Cache invalidation events (cacheInvalidated$)                │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Offline Template Service                         │
│  (offline-template.service.ts)                                  │
│  - CACHE-FIRST data access pattern                              │
│  - Background refresh when online                               │
│  - Preserves local updates during merge                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IndexedDB Service                           │
│  (indexed-db.service.ts)                                        │
│  - Persistent storage for all offline data                      │
│  - Pending requests queue                                       │
│  - Photo file storage                                           │
│  - Cached images (base64)                                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Background Sync Service                         │
│  (background-sync.service.ts)                                   │
│  - Processes pending requests when online                       │
│  - Exponential backoff retry logic                              │
│  - Temp ID resolution                                           │
│  - Emits sync completion events                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS API Gateway Proxy                         │
│  → Caspio REST API                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implemented Features ✅

### 1. Cache-First Data Access Pattern

All data retrieval methods now follow a **CACHE-FIRST** pattern for instant responsiveness:

```typescript
// Example: getVisualsByService() in offline-template.service.ts
async getVisualsByService(serviceId: string): Promise<any[]> {
  // 1. Read from cache IMMEDIATELY
  const cached = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
  
  // 2. Merge with pending offline visuals
  const pending = await this.getPendingVisuals(serviceId);
  const merged = [...cached, ...pending];
  
  // 3. Return immediately if we have data
  if (merged.length > 0) {
    // 4. Background refresh (non-blocking) when online
    if (this.offlineService.isOnline()) {
      this.refreshVisualsInBackground(serviceId);
    }
    return merged;
  }
  
  // 5. Only block for API if cache is empty
  // ...
}
```

**Methods Updated:**
- `getVisualsByService()`
- `getVisualAttachments()`
- `getEFERooms()`
- `getEFEPoints()`
- `getEFEPointAttachments()`

### 2. Background Sync System

The `BackgroundSyncService` handles all offline operations:

- **Pending Request Queue**: All CREATE, UPDATE, DELETE operations are queued in IndexedDB
- **Automatic Retry**: Exponential backoff (30s → 1m → 2m → 5m → 10m → 30m → 1h)
- **Temp ID Resolution**: Offline-created records use `temp_xxx` IDs, resolved to real IDs after sync
- **Sync Events**: Emits events for UI updates after successful syncs

**Key Events:**
- `visualSyncComplete$` - Visual record synced
- `photoUploadComplete$` - Photo uploaded to S3
- `efeRoomSyncComplete$` - EFE room synced
- `efePointSyncComplete$` - EFE point synced
- `serviceDataSyncComplete$` - Service/project data synced

### 3. Local Update Preservation

The `_localUpdate` flag prevents server data from overwriting local changes:

```typescript
// When user makes offline changes:
return { ...visual, ...updates, _localUpdate: true };

// During background refresh, local versions are preserved:
const localUpdates = new Map<string, any>();
for (const visual of existingCache) {
  if (visual._localUpdate || hasPendingUpdate) {
    localUpdates.set(visualId, visual);
  }
}

// Merge preserves local versions:
const mergedVisuals = freshVisuals.map(serverVisual => {
  const localVersion = localUpdates.get(serverVisual.VisualID);
  return localVersion || serverVisual;
});
```

### 4. Offline Photo Handling

Photos are stored locally and uploaded when online:

- **Immediate Display**: Photos appear instantly using blob URLs
- **IndexedDB Storage**: Photo files stored with metadata (visualId, caption, drawings)
- **Background Upload**: Photos uploaded to S3 via API Gateway proxy
- **Annotation Caching**: Annotated images cached separately for thumbnail display

**Key Methods:**
- `indexedDb.storePhotoFile()` - Store photo for later upload
- `indexedDb.cachePhoto()` - Cache downloaded images as base64
- `indexedDb.cacheAnnotatedImage()` - Cache annotated thumbnails

### 5. Visual Selection/Deselection (Recently Fixed)

Visual deselection now works reliably with these fixes:

1. **VisualTemplateID Storage**: Visuals now store their template ID for reliable matching
2. **Template ID Matching**: `loadExistingVisualsFromCache()` matches by VisualTemplateID first
3. **Collision Prevention**: Tracks assigned keys to prevent multiple visuals overwriting each other
4. **HIDDEN Notes Handling**: Deselected visuals have `Notes: 'HIDDEN'` and remain deselected

```typescript
// Visual creation now includes VisualTemplateID
const visualData = {
  ServiceID: serviceIdNum,
  Category: category,
  Kind: item.type,
  Name: item.name,
  Text: item.text,
  Notes: '',
  VisualTemplateID: item.templateId  // CRITICAL for reliable matching
};
```

### 6. Debounced Cache Invalidation

Prevents UI flickering from rapid sync events:

```typescript
// 500ms debounce on cache invalidation
this.cacheInvalidationDebounceTimer = setTimeout(async () => {
  await this.reloadVisualsAfterSync();
}, 500);

// 3-second cooldown during user operations
private startLocalOperationCooldown() {
  this.ignoreInvalidationUntil = Date.now() + 3000;
}
```

### 7. Cross-Platform Image Fetching

XMLHttpRequest used for reliable image downloading on mobile:

```typescript
private fetchImageAsBase64(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = 30000;
    
    xhr.onload = () => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(xhr.response);
    };
    
    xhr.send();
  });
}
```

### 8. Static Imports for Offline Modal Loading

Changed dynamic imports to static imports for components needed offline:

```typescript
// BEFORE (failed offline due to ChunkLoadError)
const { AddCustomVisualModalComponent } = await import('...');

// AFTER (works offline)
import { AddCustomVisualModalComponent } from '...';
```

### 9. EFE (Elevation Plot) Offline Support

Room Elevation section supports offline operations:

- Create/edit rooms offline
- Add photos to points offline
- Photos queued and uploaded when online
- Pending photos grouped efficiently: `getAllPendingPhotosGroupedByPoint()`

---

## Data Flow Diagrams

### Offline Visual Deselection Flow

```
User Deselects Visual
        │
        ▼
toggleItemSelection(category, itemId)
        │
        ▼
Get visualId from visualRecordIds[key]
        │
        ▼
foundationData.updateVisual(visualId, { Notes: 'HIDDEN' })
        │
        ├──► offlineTemplate.updateVisual()
        │           │
        │           ├──► Update IndexedDB cache with _localUpdate: true
        │           └──► Add pending UPDATE request
        │
        └──► backgroundSync.triggerSync()
                    │
                    ▼ (when online)
            Process pending UPDATE request
                    │
                    ▼
            API PUT /LPS_Services_Visuals/records
                    │
                    ▼
            clearVisualLocalUpdateFlag()
                    │
                    ▼
            Server now has Notes: 'HIDDEN'
```

### Photo Upload Flow

```
User Takes Photo
        │
        ▼
Create blob URL for immediate display
        │
        ▼
Store in IndexedDB (storePhotoFile)
        │
        ▼
Add pending VISUAL_PHOTO_UPLOAD request
        │
        ▼
backgroundSync.triggerSync()
        │
        ▼ (when online)
syncVisualPhotoUpload()
        │
        ├──► Re-read latest drawings/caption from IndexedDB
        │
        ├──► Upload to S3 via API Gateway
        │
        ├──► Create attachment record in Caspio
        │
        └──► Refresh attachments cache
```

---

## Known Issues & Remaining Challenges ⚠️

### 1. Visual Selection Unpredictability (PARTIALLY FIXED)

**Issue**: Deselecting visuals sometimes affects wrong visuals or reverts on page reload.

**Root Cause**: The matching system relied on visual Name instead of template ID.

**Fix Applied**: 
- Added `VisualTemplateID` to visual creation
- Changed matching to use template ID first
- Added collision detection and orphan handling

**Remaining Risk**: 
- Old visuals created before this fix won't have `VisualTemplateID`
- These fall back to name matching which can be unreliable

### 2. Annotations Not Persisting on Thumbnail Display

**Issue**: Annotations don't show on thumbnails after page reload.

**Status**: Partially fixed with `cacheAnnotatedImage()` system.

**Remaining Issues**:
- Cached annotated images may not be found if `visualIdForCache` is incorrect
- Race conditions during annotation save can cause blank thumbnails

### 3. Caption Sync Race Conditions

**Issue**: Captions added offline may not sync correctly.

**Status**: Fixed by re-reading latest caption from IndexedDB before upload.

**Remaining Risk**: If user edits caption multiple times quickly while offline, only the last one syncs.

### 4. Mobile-Specific Issues

**Issue**: Mobile app behavior differs from webapp.

**Known Differences**:
- `fetch()` CORS handling differs on Capacitor
- Image caching may fail silently on some devices
- IndexedDB storage limits vary by device

**Workaround**: Using XMLHttpRequest instead of fetch for image downloads.

### 5. LocalStorage Quota Exceeded

**Issue**: LocalStorage quota errors when caching API responses.

```
Failed to persist cache to localStorage: QuotaExceededError
```

**Impact**: Non-critical, IndexedDB is the primary cache.

**Recommendation**: Remove localStorage API response caching.

### 6. Template Download First-Load Requirement

**Issue**: App must download templates while online before offline mode works.

**Current Behavior**: Shows "Template Download Complete" banner on first load.

**Risk**: User may go offline before download completes, leading to empty pages.

### 7. Sync Timing Visibility

**Issue**: User has no visibility into sync status or queued operations.

**Recommendation**: Add sync status indicator showing:
- Number of pending operations
- Last successful sync time
- Any failed operations

---

## Performance Optimizations Implemented

### 1. Single IndexedDB Read Pattern

Templates and visuals read once at page load, passed to subsequent functions:

```typescript
// Read ONCE at top of loadData()
const allTemplates = await this.indexedDb.getCachedTemplates('visual') || [];

// Pass to functions instead of re-reading
this.loadCategoryTemplatesFromCache(allTemplates);
```

### 2. Background Photo Loading

Photos load after page render, not blocking initial display:

```typescript
// Show page immediately with skeletons
this.loading = false;
this.changeDetectorRef.detectChanges();

// Then load photos in background
this.loadAllPhotosInBackground(visuals);
```

### 3. Grouped Pending Photo Retrieval

EFE photos retrieved in one IndexedDB call instead of N+1:

```typescript
// BEFORE: N+1 reads
for (const point of points) {
  const photos = await getPendingPhotosForPoint(point.id);
}

// AFTER: Single read
const allPending = await getAllPendingPhotosGroupedByPoint();
for (const point of points) {
  const photos = allPending[point.id] || [];
}
```

---

## Files Modified

### Core Services
- `src/app/services/background-sync.service.ts`
- `src/app/services/caspio.service.ts`
- `src/app/services/indexed-db.service.ts`
- `src/app/services/offline-template.service.ts`

### Data Service
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts`

### UI Pages
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts`
- `src/app/pages/engineers-foundation/structural-systems/structural-systems-hub/structural-systems-hub.page.ts`
- `src/app/pages/engineers-foundation/room-elevation/room-elevation.page.ts`
- `src/app/pages/engineers-foundation/elevation-plot-hub/elevation-plot-hub.page.ts`
- `src/app/pages/engineers-foundation/engineers-foundation.page.ts`

### Modals
- `src/app/modals/add-custom-visual-modal/add-custom-visual-modal.component.ts`

---

## Recommendations for Future Work

### High Priority

1. **Migrate Old Visuals**: Add migration script to populate `VisualTemplateID` for existing visuals
2. **Sync Status UI**: Add visible indicator for pending sync operations
3. **Error Recovery**: Improve handling of failed syncs with user notification

### Medium Priority

4. **Remove LocalStorage Caching**: Eliminate API response caching that causes quota errors
5. **Preload Critical Chunks**: Ensure all offline-needed JS chunks are cached by service worker
6. **Conflict Resolution**: Handle cases where server and local data diverge

### Low Priority

7. **Offline Indicator**: Show when user is offline with queued operation count
8. **Sync Log**: Maintain history of sync operations for debugging
9. **Selective Sync**: Allow user to choose what data to sync for offline

---

## Testing Checklist

### Visual Selection/Deselection
- [ ] Select visual online → persists on reload
- [ ] Deselect visual online → persists on reload
- [ ] Select visual offline → persists on reload → syncs when online
- [ ] Deselect visual offline → persists on reload → syncs when online
- [ ] Multiple rapid selections/deselections → all sync correctly

### Photo Operations
- [ ] Add photo online → appears immediately → syncs
- [ ] Add photo offline → appears immediately → queued → syncs when online
- [ ] Add annotation online → persists on reload
- [ ] Add annotation offline → persists on reload → syncs when online
- [ ] Add caption online → persists on reload
- [ ] Add caption offline → persists on reload → syncs when online

### Navigation
- [ ] Navigate away and back → data persists
- [ ] Reload page → data persists
- [ ] Close and reopen app → data persists (offline)

### Mobile Specific
- [ ] All above tests pass on iOS
- [ ] All above tests pass on Android
- [ ] Images display correctly when offline

---

*Last Updated: December 16, 2025*


# Photo Upload & Offline System - Current State

**Last Updated**: December 11, 2025

## Overview

The photo upload system uses IndexedDB as the primary persistence layer for reliability. All photos go through IndexedDB first, then are uploaded via the BackgroundSyncService. This ensures photos are never lost, even with poor or intermittent connectivity.

---

## Architecture

### Upload Flow (Camera & Gallery)

```
User takes/selects photo
       ↓
Store photo file in IndexedDB (pendingImages store)
       ↓
Queue upload request in IndexedDB (pendingRequests store)
       ↓
Trigger BackgroundSyncService
       ↓
BackgroundSyncService processes queue:
  1. Creates record in Caspio (LPS_Services_Visuals_Attach)
  2. Uploads file to S3
  3. Updates Caspio record with S3 key
  4. Deletes from IndexedDB on success
       ↓
UI updated via photoUploadComplete$ event
```

### Key Services

| Service | Purpose |
|---------|---------|
| `IndexedDbService` | Persistent storage for photos and pending requests |
| `BackgroundSyncService` | Processes IndexedDB queue, handles retries with exponential backoff |
| `CaspioService` | API calls to Caspio, S3 uploads |
| `FabricService` | Fabric.js for photo annotations (statically imported for offline) |

### IndexedDB Stores

| Store | Purpose |
|-------|---------|
| `pendingImages` | Photo files (keyPath: `imageId`) |
| `pendingRequests` | Upload/API request queue |
| `tempIdMappings` | Maps temp IDs to real Caspio IDs after sync |

---

## What's Working

### Photo Capture & Upload
- Camera photos stored in IndexedDB immediately
- Gallery photos stored in IndexedDB immediately
- Photos persist through app restarts and navigation
- Uploads resume automatically when connectivity returns
- Duplicate record prevention via idempotency checks

### Offline Support
- Photos can be taken while completely offline
- Visuals can be selected while offline
- Annotations can be added while offline
- Everything syncs when connectivity returns
- Fabric.js works offline (static import, no chunk loading)

### Photo Editor (Annotations)
- Fabric.js canvas for drawing/annotating
- Blob URLs converted to data URLs for reliable loading
- Works with both S3 images and IndexedDB images
- Annotations compressed and stored in Drawings field

### Visual Selection
- Visuals persist across page navigation
- Cache cleared on page load to ensure fresh data after sync
- Case-insensitive matching for visual names

---

## Recent Fixes (This Session)

### 9. Project Details Sync Endpoint Fix
**Problem**: When syncing Project Details changes offline, BackgroundSync failed with:
1. `ERR_NAME_NOT_RESOLVED` - malformed URLs missing `/` separator
2. `404 Not Found` - route not found on backend
3. UI showing blank after sync - cache not properly maintained

**Root Cause**:
- Backend routes are mounted at `/api` prefix (see app.ts line 47)
- The caspio-proxy route is at `/api/caspio-proxy/*` (not `/caspio-proxy/*`)
- CaspioService uses pattern: `/api/caspio-proxy${endpoint}` (see caspio.service.ts line 581)
- Route param is `PK_ID` not `ServiceID`
- Cache wasn't updated when no existing record existed
- Cache wasn't refreshed after sync completed

**Fix**:
1. Updated endpoints to match CaspioService pattern:
   - `updateService()`: `/api/caspio-proxy/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`
   - `updateProject()`: `/api/caspio-proxy/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`

2. Always update cache even if no existing record:
   ```typescript
   const updatedService = existingService
     ? { ...existingService, ...updates }
     : { PK_ID: serviceId, ...updates };
   await this.indexedDb.cacheServiceRecord(serviceId, updatedService);
   ```

3. Refresh cache after sync with server response:
   ```typescript
   if (request.type === 'UPDATE' && result) {
     await this.updateCacheAfterSync(request, result);
   }
   ```

**Files Changed**:
- `src/app/services/offline-template.service.ts` - Fixed endpoints, always update cache
- `src/app/services/background-sync.service.ts` - Added updateCacheAfterSync() method, serviceDataSyncComplete$ event
- `src/app/pages/engineers-foundation/project-details/project-details.page.ts` - Subscribe to sync event to reload data

### 7. Offline Navigation (ChunkLoadError)
**Problem**: When offline, navigating to structural systems, categories, or any template pages resulted in ChunkLoadError because these modules were lazy-loaded.

**Fix**: Converted all template modules from lazy loading to eager loading. All components are now bundled in the main chunk and available offline.

**Files Changed**:
- `src/app/app-routing.module.ts` - Routes now use direct component references instead of `loadChildren`/`loadComponent`
- `src/app/pages/engineers-foundation/engineers-foundation-routing.module.ts` - Direct imports
- `src/app/pages/hud/hud-routing.module.ts` - Direct imports
- `src/app/pages/lbw/lbw-routing.module.ts` - Direct imports
- `src/app/pages/dte/dte-routing.module.ts` - Direct imports

### 8. TRUE OFFLINE-FIRST ARCHITECTURE
**Problem**: Template categories and rooms weren't showing when offline. App required network for reads.

**Solution**: Complete offline-first architecture where **IndexedDB is the PRIMARY data source**.

**New Service**: `src/app/services/offline-template.service.ts`
- Downloads complete template data when service is opened (while online)
- All reads come from IndexedDB (instant, no network needed)
- All writes go to IndexedDB first, then queue for background sync
- Handles temp ID → real ID mapping after sync

**How It Works**:
```
User Opens Service (online)
        ↓
Download ALL template data to IndexedDB (~100-200KB)
- Visual templates (categories, fields)
- EFE templates (room definitions)
- Service visuals (existing items)
- EFE rooms and points
- Service record
        ↓
User Works (online OR offline)
        ↓
All READS from IndexedDB (instant, no network)
All WRITES to IndexedDB + sync queue
        ↓
BackgroundSync pushes to server when online
```

**Files Changed**:
- `src/app/services/offline-template.service.ts` - **NEW**: Complete offline-first service
- `src/app/services/indexed-db.service.ts` - Added: cacheServiceRecord, markTemplateDownloaded, updatePendingRequestData
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts` - Now reads from IndexedDB first
- All container pages - Trigger full template download on entry

**Storage Impact**: ~100-200KB for templates. Photos handled separately (deleted after S3 upload).

---

### 1. Duplicate Photo Records (Blank Rows)
**Problem**: When online, photos were being uploaded via TWO paths:
- IndexedDB → BackgroundSyncService
- BackgroundPhotoUploadService (in-memory)

This caused duplicate records, with one being blank.

**Fix**: Removed BackgroundPhotoUploadService usage. All uploads now go through IndexedDB → BackgroundSyncService only.

**Files Changed**:
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts`

### 2. Photo Editor Not Loading IndexedDB Images After Navigation
**Problem**: Thumbnails showed correctly but photo editor displayed blank square.

**Fix**: Convert blob URLs to data URLs before loading in Fabric.js. Blob URLs can become unreliable, but data URLs are self-contained.

**Files Changed**:
- `src/app/components/fabric-photo-annotator/fabric-photo-annotator.component.ts`
  - Added `blobUrlToDataUrl()` method
  - Convert blob URLs before `fabric.Image.fromURL()`

### 3. Fabric.js Offline (ChunkLoadError)
**Problem**: Fabric.js was dynamically imported, creating a lazy-loaded chunk not available offline.

**Fix**: Changed to static import.

**Files Changed**:
- `src/app/services/fabric.service.ts`

### 4. Idempotent Uploads
**Problem**: If S3 upload failed after Caspio record creation, retry created duplicate records.

**Fix**: Check for orphaned records (VisualID exists but Attachment is empty) and reuse them.

**Files Changed**:
- `src/app/services/caspio.service.ts` (uploadVisualsAttachWithS3, uploadDTEAttachWithS3, uploadLBWAttachWithS3, uploadHUDAttachWithS3)

### 5. Empty File Validation
**Problem**: Blank rows being created in database, possibly from empty/corrupted files.

**Fix**: Added validation to reject empty or missing files before upload attempt. Also added comprehensive logging.

**Files Changed**:
- `src/app/services/caspio.service.ts`
  - Added file size validation at start of `uploadVisualsAttachWithS3`
  - Added detailed logging (VisualID, file name, file size, drawings length)

### 6. Unified Upload Path
**Problem**: Camera and gallery uploads used different paths when online vs offline, causing inconsistency and potential duplicate uploads.

**Fix**: Both camera and gallery now ALWAYS use IndexedDB → BackgroundSyncService path, regardless of online/offline status. This ensures reliability with poor connectivity.

**Files Changed**:
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts`
  - Camera upload: Always stores in IndexedDB, triggers BackgroundSyncService
  - Gallery upload: Always stores in IndexedDB, triggers BackgroundSyncService when online

---

## Known Considerations

### IndexedDB is Primary
- ALL photos go to IndexedDB first, regardless of online/offline status
- This handles poor connectivity (not just no connectivity)
- BackgroundSyncService processes the queue with retries

### Blob URLs vs Data URLs
- Blob URLs can become stale after page navigation
- Photo editor converts blob URLs to data URLs for reliability
- Thumbnails can use blob URLs (img tags handle them well)

### Visual Record IDs
- New visuals get temp IDs (e.g., `temp_visual_123`)
- BackgroundSyncService resolves temp IDs to real Caspio IDs
- Photos reference the temp ID until sync completes

---

## File Locations

### Category Detail Pages (Photo Upload Logic)
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts`
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
- `src/app/pages/dte/dte-category-detail/dte-category-detail.page.ts`
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

### Services
- `src/app/services/indexed-db.service.ts` - IndexedDB operations
- `src/app/services/background-sync.service.ts` - Queue processing
- `src/app/services/caspio.service.ts` - API calls, S3 uploads
- `src/app/services/fabric.service.ts` - Fabric.js provider
- `src/app/services/background-photo-upload.service.ts` - **NOT USED for main uploads anymore**

### Components
- `src/app/components/fabric-photo-annotator/` - Photo editor with annotations

---

## Testing Checklist

### Online Upload
- [ ] Take photo with camera - should upload successfully
- [ ] Select photos from gallery - should upload successfully
- [ ] No duplicate records in database
- [ ] No blank rows in database

### Offline → Online
- [ ] Take photos while in airplane mode
- [ ] Photos show in UI with "queued" status
- [ ] Turn off airplane mode
- [ ] Photos sync automatically
- [ ] UI updates to show synced photos

### Photo Editor
- [ ] Open editor for S3 photo - image loads
- [ ] Open editor for IndexedDB photo - image loads
- [ ] Navigate away and back - IndexedDB photos still editable
- [ ] Annotations save correctly

### Poor Connectivity
- [ ] Photos stored in IndexedDB even with poor signal
- [ ] Failed uploads retry automatically
- [ ] Photos never lost

---

## Debug Logging

Key log prefixes to watch:
- `[CAMERA UPLOAD]` - Camera photo capture and queuing
- `[GALLERY UPLOAD]` - Gallery photo selection and queuing
- `[BACKGROUND SYNC]` - Queue processing
- `[VISUALS ATTACH S3]` - S3 upload operations
- `[FabricAnnotator]` - Photo editor operations
- `[IndexedDB]` - Database operations
- `[PHOTO SYNC]` - Upload completion events

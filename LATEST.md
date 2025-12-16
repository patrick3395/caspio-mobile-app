# Engineers-Foundation Offline System - Current State

**Last Updated**: December 16, 2025

## Overview

The Engineers-Foundation template uses a complete **offline-first architecture**. When you open a template, ALL data is downloaded to IndexedDB so you can work entirely offline. Photos are cached as base64 images. Background sync handles all server communication with automatic retry.

---

## Architecture

### Template Download Flow (On Open)

```
User Opens Template
       ↓
Show "Preparing Template" loading screen
       ↓
Download ALL data to IndexedDB:
  1. Visual Templates (structural categories, comments, limitations, deficiencies)
  2. EFE Templates (room elevation definitions)
  3. Service Visuals (existing items for this service)
  4. Visual Attachments (photo metadata)
  5. Actual Images (downloaded and cached as base64)
  6. EFE Rooms and Points
  7. EFE Point Attachments + Images
  8. Service Record
  9. Project Record
  10. Dropdown Options (Services_Drop, Projects_Drop, Status)
       ↓
Template Ready - User can work offline
```

### Read Flow (Always Offline-First)

```
Page Needs Data
       ↓
Read from IndexedDB FIRST
       ↓
If not in cache AND online → fetch from API → cache result
       ↓
Return data to UI
```

### Write Flow (Offline-Capable)

```
User Makes Change
       ↓
Update IndexedDB immediately (UI updates instantly)
       ↓
Queue request for BackgroundSyncService
       ↓
BackgroundSync processes when online:
  - Sends to server
  - Updates cache with server response
  - Downloads any new images
       ↓
UI stays in sync
```

---

## Key Services

| Service | Purpose |
|---------|---------|
| `OfflineTemplateService` | Downloads complete template, provides offline-first data access |
| `IndexedDbService` | All IndexedDB operations (7 object stores) |
| `BackgroundSyncService` | Processes sync queue, refreshes cache after sync |
| `EngineersFoundationDataService` | Data layer for EF module, delegates to OfflineTemplateService |

### IndexedDB Stores (v3)

| Store | Purpose |
|-------|---------|
| `pendingRequests` | Queued API requests for sync |
| `pendingImages` | Photo files pending upload |
| `tempIdMappings` | Maps temp IDs → real IDs after sync |
| `cachedTemplates` | Visual and EFE templates |
| `cachedServiceData` | Service visuals, attachments, EFE rooms/points |
| `pendingEFEData` | Offline-created EFE rooms/points |
| `cachedPhotos` | **NEW** - Actual images cached as base64 |

---

## What's Working

### Complete Offline Support
- ✅ All template data downloaded on first open
- ✅ Categories, comments, limitations, deficiencies load offline
- ✅ Photos cached as base64 for offline viewing
- ✅ Structural systems hub shows all categories offline
- ✅ Category detail pages show all items offline
- ✅ Project details work offline with all dropdowns
- ✅ Elevation plot data works offline

### Photo System
- ✅ Photos stored in IndexedDB immediately (camera or gallery)
- ✅ Photos display offline from base64 cache
- ✅ Annotations work offline (Fabric.js statically imported)
- ✅ Photos sync automatically when online
- ✅ Cache refreshed after photo upload completes

### Data Sync
- ✅ All writes queued in IndexedDB
- ✅ BackgroundSync processes queue with exponential backoff
- ✅ Cache refreshed from server after sync completes
- ✅ New images downloaded and cached after sync
- ✅ Temp IDs mapped to real IDs automatically

### Background Refresh
- ✅ When online and template cached, refreshes data in background
- ✅ Visual cache refreshed after visual CREATE sync
- ✅ Attachments cache refreshed after photo upload sync
- ✅ Images downloaded and cached after sync

---

## Key Files

### Services
```
src/app/services/
├── offline-template.service.ts    # Core offline-first service
├── indexed-db.service.ts          # IndexedDB operations
├── background-sync.service.ts     # Queue processing + cache refresh
├── offline.service.ts             # Online/offline detection
└── offline-data-cache.service.ts  # Legacy cache service
```

### Engineers-Foundation Pages
```
src/app/pages/engineers-foundation/
├── engineers-foundation-container/  # Downloads template on entry
├── engineers-foundation-main/       # Main hub
├── project-details/                 # Project/service info (offline dropdowns)
├── structural-systems/
│   ├── structural-systems-hub/      # Category list (offline)
│   └── category-detail/             # Items + photos (offline)
└── elevation-plot/                  # EFE rooms/points (offline)
```

### Data Service
```
src/app/pages/engineers-foundation/engineers-foundation-data.service.ts
  - Delegates to OfflineTemplateService for offline-first access
```

---

## Download Summary (Console Output)

When template downloads, you'll see:
```
╔════════════════════════════════════════════════════════════════╗
║         OFFLINE TEMPLATE DOWNLOAD STARTING                      ║
║  Service: 499        | Type: EFE   | Key: EFE_499              ║
╚════════════════════════════════════════════════════════════════╝

[1/8] 📋 Downloading VISUAL TEMPLATES...
    ✅ Visual Templates: 99 templates cached
[2/8] 🏠 Downloading EFE TEMPLATES...
    ✅ EFE Templates: 15 room templates cached
[3/8] 🔍 Downloading SERVICE VISUALS...
    ✅ Service Visuals: 2 existing items cached
    📸 Caching photo attachments for 2 visuals...
    ✅ Visual Attachments: 6 attachment records cached
    🖼️ Downloading 6 actual images for offline...
    📸 Image caching complete: 6 succeeded, 0 failed
[4/8] 📐 Downloading EFE DATA...
    ✅ EFE Rooms: 3 rooms cached
    ✅ EFE Points: 12 points cached
[5/8] 📝 Downloading SERVICE RECORD...
[6/8] 📋 Downloading SERVICES_DROP...
[7/8] 📋 Downloading PROJECTS_DROP...
[8/8] 🏷️ Downloading STATUS OPTIONS...

╔════════════════════════════════════════════════════════════════╗
║            📦 TEMPLATE DOWNLOAD COMPLETE                        ║
║  ✅ TEMPLATE IS READY FOR OFFLINE USE                           ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Sync Events

The system emits events when data syncs:

| Event | When | Effect |
|-------|------|--------|
| `visualSyncComplete$` | Visual CREATE completes | Refreshes visuals + attachments + images cache |
| `photoUploadComplete$` | Photo upload completes | Refreshes attachments cache |
| `serviceDataSyncComplete$` | Service/Project UPDATE completes | Refreshes service/project cache |
| `efeRoomSyncComplete$` | EFE room CREATE completes | Updates room with real ID |
| `efePointSyncComplete$` | EFE point CREATE completes | Updates point with real ID |

---

## Testing Checklist

### Initial Load (Online)
- [ ] Open template → "Preparing Template" screen appears
- [ ] Console shows all 8 download steps completing
- [ ] Console shows image download progress
- [ ] Template ready message appears

### Offline Usage
- [ ] Enable airplane mode
- [ ] Navigate to Structural Systems → all 10 categories show
- [ ] Open Foundations category → all comments, limitations, deficiencies show
- [ ] Previously uploaded photos display correctly
- [ ] Can select items and add photos (queued for sync)

### Sync After Offline Work
- [ ] Disable airplane mode
- [ ] Pending count decreases as items sync
- [ ] Console shows cache refresh after each sync
- [ ] Refresh page → all synced data shows immediately

### Photo Workflow
- [ ] Take photo offline → shows in UI with "queued" indicator
- [ ] Go online → photo syncs automatically
- [ ] Photo displays correctly after sync
- [ ] No duplicate photos created

---

## Known Behaviors

### First Load Takes Time
- Downloads ~1-5MB depending on existing photos
- Shows loading screen until complete
- Subsequent visits are instant (uses cache)

### Background Refresh
- When online and cache exists, refreshes data in background
- Does NOT block UI - uses cached data immediately
- New data appears on next page visit

### Photo Caching
- Images stored as base64 data URLs
- Works offline without network requests
- ~100KB-500KB per photo in IndexedDB

### Sync Queue
- Processes every 30 seconds when online
- Exponential backoff on failures (30s → 1m → 2m → 5m → 10m → 30m → 1h max)
- Never gives up - keeps retrying forever

---

## Debug Logging

Key log prefixes:
- `[OfflineTemplate]` - Template download and data access
- `[IndexedDB]` - Database operations
- `[BackgroundSync]` - Sync queue processing
- `[EF Container]` - Container page lifecycle
- `[CategoryDetail]` - Category page data loading
- `[LOAD PHOTO]` - Photo loading and caching
- `[PHOTO SYNC]` - Photo upload completion

---

## Recent Session Changes (December 16, 2025)

1. **Photo Caching During Download**
   - Images now downloaded as base64 during initial template load
   - Stored in new `cachedPhotos` IndexedDB store
   - Photos display correctly offline

2. **Cache Refresh After Sync**
   - `BackgroundSyncService.refreshVisualsCache()` - refreshes visuals + attachments + downloads images
   - `BackgroundSyncService.downloadAndCachePhotos()` - downloads and caches new images after sync
   - Visual sync emits `visualSyncComplete$` event

3. **Container Page Enhancements**
   - Subscribes to sync events for cache updates
   - Background refresh when online with existing cache
   - Proper cleanup on destroy

4. **IndexedDB v3**
   - Added `cachedPhotos` store for base64 images
   - Added `cachePhoto()`, `getCachedPhoto()` methods
   - Added `clearCachedPhotosForService()`, `clearAllCachedPhotos()`
   - Added `clearCachedServiceData()`, `removeTemplateDownloadStatus()`

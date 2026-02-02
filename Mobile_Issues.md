# Mobile Issues Tracker

This document tracks mobile-specific issues across all templates (DTE, HUD, LBW, Engineers Foundation) and attempts at resolving them.

---

## Issue #1: Annotations Get Flattened Into Images (Non-Editable on Reload)

**Status:** EFE RESOLVED | HUD, LBW, DTE PENDING
**Affected Templates:** HUD, Engineers Foundation (EFE), potentially DTE and LBW
**Severity:** HIGH
**Date Identified:** 2026-01-30
**Date Resolved (EFE):** 2026-01-30

### Description

Annotations sometimes get "flattened" into the image, meaning when the image is reloaded, the annotations are visually present but are no longer editable (the annotation data is lost).

### Expected Behavior

- Annotations should be stored separately in the `Drawings` field (JSON data)
- The original image (`originalUrl`) should always point to the base image WITHOUT annotations
- When re-editing, the original image is loaded and annotations are overlaid from the `Drawings` JSON
- The `displayUrl`/`thumbnailUrl` shows the flattened version for display purposes only

### Root Cause Analysis

The annotation system has multiple code paths where annotations can be saved:

1. **Add modal (new photo with annotations)**
2. **Direct to synced image (re-edit existing photo)**
3. **Direct to unsynced image (offline photo)**
4. **On upload of camera image (immediate annotation)**

The flattening issue appears to occur when:

1. **The `annotatedBlob` (flattened image) is saved as the source image** - The FabricPhotoAnnotator returns both the raw annotation JSON (`annotationData`) and a flattened blob (`annotatedBlob`). If the flattened blob is uploaded to S3 and replaces the original, future edits will be on top of already-baked annotations.

2. **The `originalUrl` gets overwritten** - When loading images, if the code sets `originalUrl` to the flattened/display URL instead of the base image URL, future annotation edits will apply on top of the flattened version.

3. **The `Drawings` field is not saved/loaded properly** - If the annotation JSON is not persisted to the database `Drawings` field, or is not loaded on re-edit, the system has no separate annotation data and can only show the flattened image.

4. **Race conditions during sync** - When a temp photo syncs to a real ID while the user is annotating, the annotation save might fail to find the correct record.

### Key Code Paths Involved

| File | Purpose |
|------|---------|
| `fabric-photo-annotator.component.ts:1320-1388` | Exports both `annotatedBlob` and `annotationData` |
| `annotation-utils.ts:230-275` | `compressAnnotationData()` - compresses JSON for storage |
| `annotation-utils.ts:205-228` | `decompressAnnotationData()` - loads JSON for editing |
| `hud-category-detail.page.ts:7631-7677` | Loads existing annotations from multiple sources |
| `hud-category-detail.page.ts:7773-7803` | Saves annotations (synced photos) |
| `hud-category-detail.page.ts:7826-7932` | Saves annotations (offline/temp photos) |
| `hud-category-detail.page.ts:7965-8050` | `saveAnnotationToDatabase()` method |
| `efe/category-detail.page.ts:6832` | EFE annotation save |
| `efe/category-detail.page.ts:7020` | EFE `saveAnnotationToDatabase()` |

### Diagnostic Logging Points

The code has extensive logging with prefixes:
- `[VIEW PHOTO]` - Loading/opening photos
- `[SAVE]` - Saving annotations (synced)
- `[SAVE OFFLINE]` - Saving annotations (unsynced/temp)
- `[Fabric Save]` - Annotator component save

---

## Attempt #1: Ensure originalUrl Preservation

**Date:** 2026-01-30
**Approach:** Add validation to ensure `originalUrl` is never overwritten with annotated/display URLs

### Problem Identified

In the annotation save flow, the code correctly separates:
- `originalUrl` - base image without annotations
- `displayUrl` - flattened image with annotations for display
- `url` - should remain as base image

However, there are multiple places where `originalUrl` could be corrupted:

1. When loading from server, if `Drawings` is empty but image was previously annotated (flattened image in S3)
2. When photo rehydrates from IndexedDB after sync
3. Race conditions where display URL gets copied to original URL

### Changes Made

**File: `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`**

1. Added flattening detection in `viewPhoto` method (after line 7679):
```typescript
// ANNOTATION FLATTENING DETECTION (Attempt #1 - Issue #1 in Mobile_Issues.md)
if (photo.hasAnnotations && !existingAnnotations) {
  console.warn('[VIEW PHOTO] ⚠️ POTENTIAL ANNOTATION FLATTENING DETECTED');
  // ... detailed logging of which annotation sources were checked
}
```

2. Added verification in `saveAnnotationToDatabase` method (after line 8209):
```typescript
// ANNOTATION FLATTENING PREVENTION (Attempt #1 - Issue #1 in Mobile_Issues.md)
// Verify annotation data is properly saved and can be decompressed
if (!updateData.Drawings || updateData.Drawings === EMPTY_COMPRESSED_ANNOTATIONS) {
  // Warn if we had annotation objects but they weren't saved
}
// Verify saved data can be decompressed back
const verifyDecompressed = decompressAnnotationData(updateData.Drawings);
// Log verification result
```

**File: `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts`**

1. Added same flattening detection in `viewPhoto` method (after line 6735)
2. Added same verification in `saveAnnotationToDatabase` method (after line 7264)

### Files Modified

1. ✅ `hud-category-detail.page.ts` - Flattening detection + save verification
2. ✅ `efe/structural-systems/category-detail.page.ts` - Flattening detection + save verification
3. ✅ `lbw-category-detail.page.ts` - Flattening detection + save verification
4. ✅ `dte-category-detail.page.ts` - Flattening detection + save verification

### Testing Checklist

- [ ] Add annotation to new photo via camera - reload and verify editable
- [ ] Add annotation to existing synced photo - reload and verify editable
- [ ] Add annotation to offline photo - sync and verify editable
- [ ] Re-edit existing annotations - verify original annotations load
- [ ] Navigate away and back - verify annotations persist
- [ ] Force close app and reopen - verify annotations persist

### Result

**Status:** PENDING TESTING

---

## Attempt #2: Race Condition Fixes

**Date:** 2026-01-30
**Approach:** Address race conditions between annotation caching and upload processes

### Root Cause Analysis (Updated)

After deeper investigation, the flattening happens **randomly** due to **race conditions** between async operations:

- **`localBlobs` store** - Holds ORIGINAL image data (used for S3 upload)
- **`cachedPhotos` store** - Holds ANNOTATED image for display (thumbnails)

When these operations interleave incorrectly, the annotated blob can be uploaded to S3 instead of the original.

**Race Condition #1:** Annotation caching during upload - If user saves annotations while background sync is uploading, the wrong blob could be retrieved.

**Race Condition #2:** URL assignment bug - `originalUrl` was being set to the same value as `displayUrl` (the annotated version), causing re-edits to use the flattened image.

### Changes Made

#### Fix #1: Add Upload Lock to Prevent Race Conditions

**File: `src/app/services/indexed-db.service.ts`**

Added upload lock mechanism:
```typescript
private uploadingImageIds: Set<string> = new Set();

lockImageForUpload(imageId: string): void {
  this.uploadingImageIds.add(imageId);
}

unlockImageAfterUpload(imageId: string): void {
  this.uploadingImageIds.delete(imageId);
}

isImageLockedForUpload(imageId: string): boolean {
  return this.uploadingImageIds.has(imageId);
}

// In cacheAnnotatedImage() - skip caching if upload in progress
if (this.isImageLockedForUpload(attachId)) {
  console.warn('[IndexedDB] ⚠️ Skipping annotated cache - image is being uploaded');
  return null;
}
```

**File: `src/app/services/background-sync.service.ts`**

Added lock/unlock around upload:
```typescript
this.indexedDb.lockImageForUpload(item.imageId);
try {
  // ... upload logic
} finally {
  this.indexedDb.unlockImageAfterUpload(item.imageId);
}
```

#### Fix #2: Separate Original URL from Display URL

**Files Modified:**
- `hud-category-detail.page.ts`
- `efe/category-detail.page.ts`
- `lbw-category-detail.page.ts`
- `dte-category-detail.page.ts`

Changed from (buggy):
```typescript
const annotatedDisplayUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : URL.createObjectURL(blob);
const tempPhotoEntry = {
  url: annotatedDisplayUrl,
  displayUrl: annotatedDisplayUrl,
  originalUrl: annotatedDisplayUrl,  // ❌ Wrong - uses flattened image
  thumbnailUrl: annotatedDisplayUrl,
};
```

To (fixed):
```typescript
const originalBlobUrl = URL.createObjectURL(blob);
const annotatedDisplayUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : originalBlobUrl;
const tempPhotoEntry = {
  url: originalBlobUrl,              // Base image reference
  displayUrl: annotatedDisplayUrl,   // Annotated for thumbnails
  originalUrl: originalBlobUrl,      // ✅ Keep original for re-editing
  thumbnailUrl: annotatedDisplayUrl, // Annotated for display
};
```

#### Fix #6: Validate Original URL on Re-Edit

**Files Modified:**
- `hud-category-detail.page.ts`
- `efe/category-detail.page.ts`
- `lbw-category-detail.page.ts`
- `dte-category-detail.page.ts`

Added validation before opening annotator:
```typescript
let originalImageUrl = photo.originalUrl || photo.url || imageUrl;

// ANNOTATION FLATTENING FIX #6: Validate original URL on re-edit
if (originalImageUrl === photo.displayUrl && photo.hasAnnotations && photo.Attachment) {
  console.warn('[VIEW PHOTO] ⚠️ originalUrl same as displayUrl - may be flattened');

  // Try to get base image from S3 (the authoritative source)
  if (this.caspioService.isS3Key(photo.Attachment)) {
    try {
      const s3OriginalUrl = await this.caspioService.getS3FileUrl(photo.Attachment);
      if (s3OriginalUrl && s3OriginalUrl !== originalImageUrl) {
        console.log('[VIEW PHOTO] ✅ Fetched original from S3');
        originalImageUrl = s3OriginalUrl;
      }
    } catch (e) {
      console.error('[VIEW PHOTO] Failed to fetch from S3:', e);
    }
  }
}
```

### Files Modified Summary

| File | Changes |
|------|---------|
| `indexed-db.service.ts` | Upload lock mechanism |
| `background-sync.service.ts` | Lock/unlock around upload |
| `hud-category-detail.page.ts` | URL separation + re-edit validation |
| `efe/category-detail.page.ts` | URL separation + re-edit validation |
| `lbw-category-detail.page.ts` | URL separation + re-edit validation |
| `dte-category-detail.page.ts` | URL separation + re-edit validation |

### Testing Checklist

- [ ] Take camera photo, add annotations, save → reload → verify can re-edit annotations
- [ ] While background sync is running, add annotations → verify no flattening
- [ ] Check console for "[SAVE] ✅ ANNOTATION VERIFICATION PASSED" messages
- [ ] Check for NO "⚠️ FLATTENING" or "⚠️ WRONG BLOB" warnings
- [ ] Check for "[IndexedDB] ⚠️ Skipping annotated cache - image is being uploaded" during uploads (expected)

### Result

**Status:** PENDING TESTING

---

## Attempt #3: Complete Image/Annotation Separation + Thumbnail Fix (EFE ONLY)

**Date:** 2026-01-30
**Approach:** Remove ALL annotated blob caching, ensure full-resolution images for annotator
**Template:** Engineers Foundation (EFE) ONLY - HUD, LBW, DTE pending standardization

### Root Cause (Final)

The flattening issue had TWO root causes:

1. **Annotated blobs were being cached** - The system cached "annotated blobs" (images with annotations baked in) for display. When these cached blobs were used as the base for re-editing, annotations got flattened.

2. **Thumbnail used instead of full-resolution** - When full-res blob was purged from storage (soft-purge), `getDisplayUrl()` fell back to thumbnail blob, causing the annotator to receive a tiny image.

### Solution: Strict Image/Annotation Separation

**Principle:** Images and annotations must ALWAYS remain separate:
- **Images** = Original camera/gallery photo (stored in `localBlobs`, uploaded to S3)
- **Annotations** = JSON data only (stored in `Drawings` column, never baked into image)
- **NO annotated blobs** = Never cache or store images with annotations rendered on them

### Changes Made (EFE Template Only)

**File: `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts`**

#### 1. Removed ALL `cacheAnnotatedImage()` calls (5 locations)
- Camera capture flow
- Save annotation flow (synced)
- Save annotation flow (offline)
- WEBAPP photo load
- Image error fallback

#### 2. Removed ALL `bulkAnnotatedImagesMap.get()` usage
- All display URLs now point to ORIGINAL images
- Thumbnails show original image (tradeoff for consistency)

#### 3. All URLs point to original image
```typescript
const photoEntry = {
  url: displayUrl,           // Always original
  displayUrl: displayUrl,    // Always original - no annotated cache
  originalUrl: displayUrl,   // For re-editing
  thumbnailUrl: displayUrl,  // Always original - no annotated cache
};
```

#### 4. Full-resolution image for annotator (THUMBNAIL FIX)
```typescript
// ANNOTATION FIX: For the annotator, we MUST get the FULL RESOLUTION image
// Do NOT use getDisplayUrl() as it may return a thumbnail when full-res is purged

// First try: Get full-resolution blob directly
if (localImage.localBlobId) {
  fullResUrl = await this.localImageService.getOriginalBlobUrl(localImage.localBlobId);
  if (fullResUrl) {
    photo._hasFullResBlob = true;  // Flag to skip S3 fetch later
  }
}

// Second try: If no full-res blob (purged), fetch from S3
if (!fullResUrl && localImage.remoteS3Key) {
  fullResUrl = await this.caspioService.getS3FileUrl(localImage.remoteS3Key);
}

// Third try: Fall back to getDisplayUrl (may be thumbnail - last resort)
if (!fullResUrl) {
  fullResUrl = await this.localImageService.getDisplayUrl(localImage);
}
```

#### 5. S3 safeguard for synced photos
```typescript
// THUMBNAIL FIX: For synced photos that might have thumbnails, fetch from S3
const mightBeThumbnail = isLocalFirstPhoto || (
  originalImageUrl?.startsWith('blob:') && !photo._hasFullResBlob
);

if (s3Key && this.caspioService.isS3Key(s3Key) && mightBeThumbnail) {
  const s3FullResUrl = await this.caspioService.getS3FileUrl(s3Key);
  if (s3FullResUrl) {
    originalImageUrl = s3FullResUrl;
  }
}
```

### Files Modified (EFE Only)

| File | Status |
|------|--------|
| `efe/structural-systems/category-detail/category-detail.page.ts` | ✅ COMPLETE |
| `hud-category-detail.page.ts` | ❌ PENDING |
| `hud-visual-detail.page.ts` | ❌ PENDING |
| `lbw-category-detail.page.ts` | ❌ PENDING |
| `lbw-visual-detail.page.ts` | ❌ PENDING |
| `dte-category-detail.page.ts` | ❌ PENDING |
| `dte-visual-detail.page.ts` | ❌ PENDING |

### Testing Checklist (EFE)

- [x] Take camera photo, add annotations, save → Re-edit → Image is full-size in editor
- [x] Sync photo to S3 → Re-edit → Image is full-size in editor
- [x] Annotations persist after sync
- [x] No flattening on re-edit

### Result

**Status:** ✅ SUCCESS (EFE Template)

### Next Steps

Apply the same standardized annotation handling to:
1. HUD Category Detail + Visual Detail
2. LBW Category Detail + Visual Detail
3. DTE Category Detail + Visual Detail

All templates should follow the EXACT same pattern for consistency.

---

## Attempt #4: Complete Annotation Thumbnail Implementation (EFE - FINAL)

**Date:** 2026-01-30
**Status:** ✅ SUCCESS
**Template:** Engineers Foundation (EFE) - Use as reference for HUD, LBW, DTE

### Problem Solved

1. **Annotation thumbnails not showing immediately** - Thumbnails only showed annotations after sync + page refresh
2. **Second annotation not persisting** - Adding a second annotation would lose the first one
3. **LocalImage photos not detected correctly** - Gallery uploads (img_ prefix) were treated as synced photos

### Architecture: Offline-First (Dexie)

**CRITICAL:** This implementation is 100% offline-first. All operations write to IndexedDB/Dexie first, then queue for background sync. NO direct API calls on mobile.

**Data Flow:**
1. User saves annotation → `bulkAnnotatedImagesMap` (in-memory) + `cacheAnnotatedImage()` (IndexedDB)
2. Drawings saved → `updateLocalImage()` (Dexie `localImages` table) OR `updatePendingPhotoData()` (legacy)
3. Sync queued → `queueCaptionAndAnnotationUpdate()` (Dexie `pendingCaptions` table)
4. Background sync picks up when online → calls API → updates server

### Key Implementation Details

#### 1. Photo Type Detection

Photos come in three types that need different handling:

```typescript
// Detect if this is an unsynced photo (temp_ prefix OR img_ prefix OR LocalImage flags)
const isLocalImagePhoto = currentPhoto.isLocalFirst || currentPhoto.isLocalImage ||
  String(currentAttachId).startsWith('img_');
const isLegacyTempPhoto = String(currentAttachId).startsWith('temp_');
const isUnsyncedPhoto = isLocalImagePhoto || isLegacyTempPhoto;

// Check if photo has a real server ID (numeric)
const hasRealServerId = currentPhoto.attachId &&
  !String(currentPhoto.attachId).startsWith('temp_') &&
  !String(currentPhoto.attachId).startsWith('img_') &&
  /^\d+$/.test(String(currentPhoto.attachId));
```

**Photo Types:**
| Type | ID Pattern | Flags | Save Method |
|------|-----------|-------|-------------|
| LocalImage (gallery/camera) | `img_xxx` | `isLocalFirst`, `isLocalImage` | `updateLocalImage()` |
| Legacy Temp | `temp_xxx` | `isPending` | `updatePendingPhotoData()` |
| Synced | numeric (e.g., `12345`) | none | `saveAnnotationToDatabase()` |

#### 2. Save Flow Routing

```typescript
// Route to correct save flow based on photo type
if (currentAttachId && !isUnsyncedPhoto) {
  // SYNCED PHOTO: Save to database + IndexedDB cache
  // ... synced photo save logic
} else if (isUnsyncedPhoto) {
  // UNSYNCED PHOTO: Save to Dexie LocalImages or pendingPhotos
  if (isLocalImagePhoto) {
    // LocalImage: Use updateLocalImage()
    await this.indexedDb.updateLocalImage(localImageId, {
      caption: data.caption || '',
      drawings: compressedDrawings
    });
  } else {
    // Legacy temp: Use updatePendingPhotoData()
    await this.indexedDb.updatePendingPhotoData(pendingFileId, {
      caption: data.caption || '',
      drawings: compressedDrawings
    });
  }
}
```

#### 3. Immediate UI Update (Critical for UX)

The thumbnail must update IMMEDIATELY when the user saves, before any database operations complete.

```typescript
// STEP 1: Create blob URL for annotated image
const newUrl = URL.createObjectURL(annotatedBlob);

// STEP 2: Update photo object with new URLs
const updatedPhoto = {
  ...currentPhoto,
  originalUrl: currentPhoto.originalUrl || currentPhoto.url,  // Keep original for re-editing
  displayUrl: newUrl,           // Annotated thumbnail - IMMEDIATE
  thumbnailUrl: newUrl,         // Annotated thumbnail - IMMEDIATE
  hasAnnotations: hasActualAnnotations || !!compressedDrawings,
  annotations: annotationsData,
  Drawings: compressedDrawings,
  rawDrawingsString: compressedDrawings,
  _annotationVersion: Date.now()  // Force change detection
};

// STEP 3: Create NEW array reference (CRITICAL for Angular change detection)
const newPhotosArray = [...this.visualPhotos[key]];
newPhotosArray[photoIndex] = updatedPhoto;
this.visualPhotos[key] = newPhotosArray;

// STEP 4: Cache in memory for instant lookup
this.bulkAnnotatedImagesMap.set(String(photoId), newUrl);

// STEP 5: Trigger change detection
this.changeDetectorRef.detectChanges();

// STEP 6: Save to database in BACKGROUND (non-blocking)
this.saveAnnotationToDatabase(...).then(...).catch(...);
```

#### 4. getPhotosForVisual() Enhancement

This is the **KEY FIX** for immediate thumbnail updates. The method is called on every render, so we apply cached annotated URLs here:

```typescript
getPhotosForVisual(category: string, itemId: string | number): any[] {
  const key = `${category}_${itemId}`;
  const photos = this.visualPhotos[key] || [];

  // ANNOTATION THUMBNAIL FIX: Apply cached annotated URLs from bulkAnnotatedImagesMap
  if (photos.length > 0 && this.bulkAnnotatedImagesMap.size > 0) {
    for (const photo of photos) {
      // Check multiple ID keys for cached annotated image
      const photoIds = [
        photo.imageId,
        photo.localImageId,
        photo.AttachID,
        photo.attachId,
        photo.id
      ].filter(id => id);

      for (const id of photoIds) {
        const cachedAnnotatedUrl = this.bulkAnnotatedImagesMap.get(String(id));
        if (cachedAnnotatedUrl && cachedAnnotatedUrl !== photo.displayUrl) {
          // Apply cached annotated URL to photo for display
          photo.displayUrl = cachedAnnotatedUrl;
          photo.thumbnailUrl = cachedAnnotatedUrl;
          photo.hasAnnotations = true;
          break;
        }
      }
    }
  }

  return photos;
}
```

#### 5. Sync Completion Handler

When a photo syncs, the ID changes from temp/img_ to a real numeric ID. We must update caches:

```typescript
// In photoUploadComplete$ subscription handler:

// Update bulkAnnotatedImagesMap with new AttachID
if (existingPhoto.displayUrl && existingPhoto.hasAnnotations) {
  this.bulkAnnotatedImagesMap.set(String(realAttachId), existingPhoto.displayUrl);

  // Also migrate IndexedDB cache
  const oldCacheId = existingPhoto.imageId || existingPhoto._pendingFileId || event.tempFileId;
  if (oldCacheId && oldCacheId !== String(realAttachId)) {
    this.indexedDb.getCachedAnnotatedImage(oldCacheId).then(async (cachedImage) => {
      if (cachedImage) {
        const response = await fetch(cachedImage);
        const blob = await response.blob();
        await this.indexedDb.cacheAnnotatedImage(String(realAttachId), blob);
      }
    });
  }
}

// Create NEW array reference for change detection
const newPhotosArray = [...this.visualPhotos[key]];
newPhotosArray[photoIndex] = updatedPhoto;
this.visualPhotos[key] = newPhotosArray;
```

#### 6. Annotation Loading for Re-Edit

When opening the photo editor, load existing annotations from multiple sources:

```typescript
const annotationSources = [
  photo.annotations,        // Raw Fabric.js object (in-memory)
  photo.annotationsData,    // Alternative property name
  photo.rawDrawingsString,  // Compressed string
  photo.Drawings            // Compressed string (from server/Dexie)
];

for (const source of annotationSources) {
  if (!source) continue;
  try {
    if (typeof source === 'string') {
      existingAnnotations = decompressAnnotationData(source);
    } else {
      existingAnnotations = source;  // Already an object
    }
    if (existingAnnotations) break;
  } catch (e) {
    console.error('[VIEW PHOTO] Error loading annotations:', e);
  }
}
```

### Files Modified (EFE Template)

| File | Changes |
|------|---------|
| `efe/category-detail.page.ts` | Complete annotation implementation |

### Key Line Numbers (EFE category-detail.page.ts)

| Feature | Lines |
|---------|-------|
| Photo type detection | 7088-7099 |
| Save flow routing | 7108, 7182 |
| Synced photo save | 7108-7180 |
| Unsynced photo save | 7182-7325 |
| LocalImage save | 7244-7253 |
| UI update + cache | 7119-7156 (synced), 7201-7239 (unsynced) |
| `getPhotosForVisual()` enhancement | 5295-5318 |
| Sync completion handler | 1691-1755 |
| `saveAnnotationToDatabase()` | 7350-7600 |

### Testing Checklist

- [x] Take camera photo, add annotation → Thumbnail updates immediately
- [x] Add second annotation to same photo → Both annotations visible
- [x] Gallery upload photo, add annotation → Thumbnail updates immediately
- [x] Sync photo → Annotations persist
- [x] Page refresh after sync → Annotations still visible on thumbnail
- [x] Re-edit annotations → All existing annotations load in editor
- [x] Offline annotation save → Queued for sync, shows on thumbnail

### Console Logging

Look for these log messages to verify correct behavior:

```
[SAVE] Annotation data received from modal: {hasAnnotationData: true, objectCount: 3}
[SAVE] Has actual annotations: true
[SAVE] Updated photo with: {displayUrl: "blob:...", hasAnnotations: true, drawingsLength: 1234}
[SAVE] ✅ UI updated IMMEDIATELY with annotated thumbnail - array reference replaced
[SAVE] ✅ Database save completed in background
[SAVE OFFLINE] ✅ Updated LocalImage with drawings
```

### Implementation Guide for Other Templates

To apply this pattern to HUD, LBW, DTE:

1. **Add photo type detection** - Detect `img_` prefix and LocalImage flags
2. **Update save flow routing** - Route to correct save method based on photo type
3. **Add LocalImage save path** - Use `updateLocalImage()` for `img_` photos
4. **Enhance `getPhotosForVisual()`** - Apply cached URLs from `bulkAnnotatedImagesMap`
5. **Update sync completion handler** - Migrate cache keys when ID changes
6. **Create new array references** - Always use `[...array]` when updating photos
7. **Call `changeDetectorRef.detectChanges()`** - Force Angular to update view

### Result

**Status:** ✅ SUCCESS - Ready for standardization across all templates

---

## Issue Template

```markdown
## Issue #N: [Title]

**Status:** [OPEN | IN PROGRESS | RESOLVED | WONT FIX]
**Affected Templates:** [DTE | HUD | LBW | EFE | ALL]
**Severity:** [LOW | MEDIUM | HIGH | CRITICAL]
**Date Identified:** YYYY-MM-DD

### Description
[Detailed description of the issue]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Steps to Reproduce
1. Step 1
2. Step 2
3. ...

### Root Cause Analysis
[Technical analysis of why this happens]

### Related Code
[File paths and line numbers]

---

## Attempt #N: [Approach Name]

**Date:** YYYY-MM-DD
**Approach:** [Brief description]

### Changes Made
[Detailed changes]

### Result
[SUCCESS | PARTIAL | FAILED | PENDING TESTING]

### Notes
[Any additional observations]
```

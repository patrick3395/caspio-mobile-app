# Making Your Upload System Persistent

## Current System (Excellent Foundation)

You ALREADY have a sophisticated upload system with:
- ✅ Instant previews (optimistic UI)
- ✅ Background upload queue
- ✅ Parallel uploads (max 2)
- ✅ Retry logic (operationsQueue)
- ✅ S3 integration

**The ONLY issue:** Everything is in-memory (lost on app close/refresh)

## Goal: Make It Persistent (No Behavior Changes)

**Same user experience, but survives:**
- App close
- Browser refresh
- Extended offline periods
- System crashes

## Implementation: 3 Small Enhancements

### Enhancement 1: Store Photos in IndexedDB

**Location:** `hud.page.ts` line ~5496

**Current:**
```typescript
const objectUrl = URL.createObjectURL(photo);
const tempId = `temp_${Date.now()}_${Math.random()}`;
```

**Add:**
```typescript
const objectUrl = URL.createObjectURL(photo);
const tempId = `temp_${Date.now()}_${Math.random()}`;

// PERSIST: Store file in IndexedDB
await this.indexedDb.storePhotoFile(tempId, photo, actualVisualId, caption);
```

**Effect:** Photo file persists even if app closes

---

### Enhancement 2: Persist Upload Tasks

**Location:** `hud.page.ts` line ~5710

**Current:**
```typescript
this.backgroundUploadQueue.push(async () => {
  // ... upload logic
});
```

**Add:**
```typescript
// Store upload task in IndexedDB
const uploadTaskId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

await this.indexedDb.addPendingRequest({
  requestId: uploadTaskId,
  type: 'UPLOAD_FILE',
  endpoint: 'HUD_PHOTO_S3_UPLOAD',
  method: 'POST',
  data: {
    attachId,
    visualIdNum,
    fileId: tempId,
    hasAnnotations: !!annotationData,
    caption,
  },
  dependencies: [],
  status: 'pending',
  priority: 'high',
});

// Still add to in-memory queue for immediate processing
this.backgroundUploadQueue.push(async () => {
  try {
    const uploadResponse = await this.caspioService.updateServicesHUDAttachPhoto(
      attachId,
      photo,
      originalPhoto || undefined
    ).toPromise();

    // SUCCESS: Mark as synced in IndexedDB
    await this.indexedDb.updateRequestStatus(uploadTaskId, 'synced');
    await this.indexedDb.deleteStoredFile(tempId);

    // ... existing UI update code ...

  } catch (uploadError: any) {
    // FAILURE: Keep in IndexedDB for retry
    await this.indexedDb.incrementRetryCount(uploadTaskId);
    
    // ... existing retry logic ...
  }
});
```

**Effect:** Upload queue persists across app restarts

---

### Enhancement 3: Restore on App Start

**Location:** `hud.page.ts` ngOnInit()

**Add:**
```typescript
async ngOnInit() {
  // ... existing initialization ...

  // RESTORE: Load pending uploads from IndexedDB
  await this.restorePendingUploads();
}

private async restorePendingUploads() {
  console.log('[HUD] Restoring pending uploads from IndexedDB...');

  // Get pending upload tasks
  const pendingUploads = await this.indexedDb.getPendingRequests();
  const hudUploads = pendingUploads.filter(r => r.type === 'UPLOAD_FILE' && r.endpoint === 'HUD_PHOTO_S3_UPLOAD');

  console.log(`[HUD] Found ${hudUploads.length} pending photo uploads`);

  for (const upload of hudUploads) {
    const { attachId, visualIdNum, fileId, caption } = upload.data;

    // Get stored file from IndexedDB
    const file = await this.indexedDb.getStoredFile(fileId);
    if (!file) {
      console.warn('[HUD] File not found for upload:', fileId);
      continue;
    }

    // Recreate thumbnail from stored file
    const objectUrl = URL.createObjectURL(file);
    const key = this.findKeyForVisual(visualIdNum);

    if (key && !this.visualPhotos[key]?.some((p: any) => p.AttachID === attachId)) {
      // Add back to UI
      if (!this.visualPhotos[key]) {
        this.visualPhotos[key] = [];
      }

      this.visualPhotos[key].push({
        AttachID: attachId,
        id: attachId,
        name: file.name,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        isObjectUrl: true,
        uploading: true,
        caption,
      });
    }

    // Re-queue the upload task
    this.backgroundUploadQueue.push(async () => {
      try {
        const uploadResponse = await this.caspioService.updateServicesHUDAttachPhoto(
          attachId,
          file
        ).toPromise();

        // Mark as synced
        await this.indexedDb.updateRequestStatus(upload.requestId, 'synced');
        await this.indexedDb.deleteStoredFile(fileId);

        // Update UI (same as existing code)
        this.ngZone.run(() => {
          const photoIndex = this.visualPhotos[key]?.findIndex((p: any) => p.AttachID === attachId);
          if (photoIndex !== -1 && this.visualPhotos[key]) {
            this.visualPhotos[key][photoIndex].uploading = false;
            this.visualPhotos[key][photoIndex].url = uploadResponse.Attachment; // S3 URL
            this.changeDetectorRef.detectChanges();
          }
        });

      } catch (error) {
        await this.indexedDb.incrementRetryCount(upload.requestId);
        console.error('[HUD] Upload failed, will retry:', error);
      }
    });
  }

  // Start processing restored queue
  if (this.backgroundUploadQueue.length > 0) {
    console.log(`[HUD] Starting processing of ${this.backgroundUploadQueue.length} restored uploads`);
    this.processBackgroundUploadQueue();
  }
}

private findKeyForVisual(visualId: number): string | null {
  for (const [key, id] of Object.entries(this.visualRecordIds)) {
    if (parseInt(String(id)) === visualId) {
      return key;
    }
  }
  return null;
}
```

---

## The Magic: Always Works the Same

### User Takes Photo (Online):

```
1. Store in IndexedDB
2. Show thumbnail (object URL)
3. Queue upload
4. Upload completes in ~2 seconds
5. Update UI with S3 URL
6. Remove from IndexedDB
```

**User sees:** Instant photo, brief "uploading" indicator

### User Takes Photo (Offline):

```
1. Store in IndexedDB  
2. Show thumbnail (object URL)
3. Queue upload
4. Upload fails (no network)
5. Stays in IndexedDB queue
6. Background retries every 30s, 1m, 2m, 5m, 10m...
7. Eventually gets signal
8. Upload succeeds
9. Update UI with S3 URL
10. Remove from IndexedDB
```

**User sees:** Instant photo, "uploading" indicator (longer), eventual success

**Same code path! No if/else for online/offline!**

---

## Implementation Steps

### Step 1: Add to HUD Page Constructor

```typescript
constructor(
  // ... existing dependencies
  private indexedDb: IndexedDbService
) {}
```

### Step 2: Modify uploadPhotoForVisual

Add 3 lines:
1. After creating object URL: `await this.indexedDb.storePhotoFile(...)`
2. After adding to queue: `await this.indexedDb.addPendingRequest(...)`
3. After success: `await this.indexedDb.updateRequestStatus(..., 'synced')`

### Step 3: Add ngOnInit Enhancement

```typescript
async ngOnInit() {
  // ... existing code ...
  
  await this.restorePendingUploads();  // NEW
}
```

### Step 4: Copy Same Pattern to Other Pages

- engineers-foundation.page.ts
- lbw.page.ts
- dte.page.ts

**Same 3 enhancements in each!**

---

## Benefits

✅ **Zero code changes** to upload logic  
✅ **Same user experience** (instant previews)  
✅ **Survives app close** (IndexedDB persists)  
✅ **Survives offline periods** (queues persist)  
✅ **Rolling retry** (background sync never gives up)  
✅ **No data loss** (everything in IndexedDB until synced)  

**Estimated time:** 2-3 hours for all pages

Want me to implement this for HUD page first as a complete working example?


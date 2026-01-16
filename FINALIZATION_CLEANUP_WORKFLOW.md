# Report Finalization Cleanup Workflow

**Date**: January 2026
**Status**: Planned for future implementation
**Purpose**: Free up IndexedDB storage (~75-95MB per report) when a report is finalized

---

## Problem Statement

Each report with ~100 photos consumes approximately:
- `localBlobs`: ~75MB (compressed binary images)
- `cachedPhotos`: ~10-20MB (annotated thumbnails as base64)
- **Total: ~75-95MB per report**

With 10 uncleaned reports, storage can reach 750-950MB, potentially exceeding device quotas.

---

## Solution: Finalization Cleanup

When a user finalizes/submits a report, clean up local storage since:
1. All data has been synced to the server
2. User no longer needs instant offline access
3. Images can be re-fetched from S3 URLs if needed

---

## Trigger Points

Cleanup should be triggered when:
- User marks report as "Complete" or "Submitted"
- Report status changes to finalized state in the system
- User explicitly chooses to "Clear offline data" for a report

---

## Pre-Cleanup Validation

Before cleaning, verify:

```typescript
async canCleanupReport(serviceId: string): Promise<{ canClean: boolean; blockers: string[] }> {
  const blockers: string[] = [];

  // 1. Check all images are synced
  const images = await db.localImages.where('serviceId').equals(serviceId).toArray();
  const unsyncedImages = images.filter(img => img.status !== 'verified');
  if (unsyncedImages.length > 0) {
    blockers.push(`${unsyncedImages.length} images not yet synced`);
  }

  // 2. Check no pending requests for this service
  const pendingRequests = await db.pendingRequests
    .filter(r => r.data?.serviceId === serviceId && r.status === 'pending')
    .toArray();
  if (pendingRequests.length > 0) {
    blockers.push(`${pendingRequests.length} pending sync requests`);
  }

  // 3. Check no items in upload outbox
  const outboxItems = await db.uploadOutbox.toArray();
  const serviceOutbox = [];
  for (const item of outboxItems) {
    const img = await db.localImages.get(item.imageId);
    if (img?.serviceId === serviceId) {
      serviceOutbox.push(item);
    }
  }
  if (serviceOutbox.length > 0) {
    blockers.push(`${serviceOutbox.length} photos still uploading`);
  }

  // 4. Check no pending captions
  const pendingCaptions = await db.pendingCaptions
    .where('serviceId').equals(serviceId)
    .filter(c => c.status !== 'synced')
    .toArray();
  if (pendingCaptions.length > 0) {
    blockers.push(`${pendingCaptions.length} captions not yet synced`);
  }

  return {
    canClean: blockers.length === 0,
    blockers
  };
}
```

---

## Cleanup Implementation

### Main Cleanup Function

```typescript
async cleanupFinalizedReport(serviceId: string): Promise<CleanupResult> {
  const result = {
    blobsDeleted: 0,
    blobsBytesFreed: 0,
    cachedPhotosDeleted: 0,
    cachedPhotosBytesFreed: 0,
    errors: [] as string[]
  };

  try {
    // Validate before cleanup
    const validation = await this.canCleanupReport(serviceId);
    if (!validation.canClean) {
      throw new Error(`Cannot cleanup: ${validation.blockers.join(', ')}`);
    }

    // 1. Get all images for this service
    const images = await db.localImages
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    // 2. Collect blob IDs to delete
    const blobIds = images
      .map(img => img.localBlobId)
      .filter((id): id is string => !!id);

    // 3. Calculate bytes to be freed (for reporting)
    for (const blobId of blobIds) {
      const blob = await db.localBlobs.get(blobId);
      if (blob) {
        result.blobsBytesFreed += blob.sizeBytes || 0;
      }
    }

    // 4. Delete blobs in batches (avoid memory issues)
    const BATCH_SIZE = 50;
    for (let i = 0; i < blobIds.length; i += BATCH_SIZE) {
      const batch = blobIds.slice(i, i + BATCH_SIZE);
      await db.localBlobs.bulkDelete(batch);
      result.blobsDeleted += batch.length;
    }

    // 5. Clear localBlobId references in localImages
    await db.transaction('rw', db.localImages, async () => {
      for (const img of images) {
        if (img.localBlobId) {
          await db.localImages.update(img.imageId, { localBlobId: null });
        }
      }
    });

    // 6. Delete cached photos for this service
    const cachedPhotos = await db.cachedPhotos
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    for (const photo of cachedPhotos) {
      result.cachedPhotosBytesFreed += photo.imageData?.length || 0;
    }

    await db.cachedPhotos.where('serviceId').equals(serviceId).delete();
    result.cachedPhotosDeleted = cachedPhotos.length;

    // 7. Also delete annotated photos (serviceId = 'annotated', but attachId matches)
    const imageIds = images.map(img => img.imageId);
    const attachIds = images.map(img => img.attachId).filter(Boolean);

    // Delete annotated entries by key pattern
    const allCachedPhotos = await db.cachedPhotos.toArray();
    const annotatedToDelete = allCachedPhotos.filter(p =>
      p.photoKey.startsWith('annotated_') &&
      (imageIds.includes(p.attachId) || attachIds.includes(p.attachId))
    );

    for (const photo of annotatedToDelete) {
      result.cachedPhotosBytesFreed += photo.imageData?.length || 0;
      await db.cachedPhotos.delete(photo.photoKey);
      result.cachedPhotosDeleted++;
    }

    // 8. Clean up synced pending requests for this service
    const syncedRequests = await db.pendingRequests
      .filter(r => r.data?.serviceId === serviceId && r.status === 'synced')
      .toArray();
    await db.pendingRequests.bulkDelete(syncedRequests.map(r => r.requestId));

    // 9. Clean up synced captions for this service
    const syncedCaptions = await db.pendingCaptions
      .where('serviceId')
      .equals(serviceId)
      .filter(c => c.status === 'synced')
      .toArray();
    await db.pendingCaptions.bulkDelete(syncedCaptions.map(c => c.captionId));

    console.log(`[Cleanup] Report ${serviceId} cleaned:`, {
      blobsDeleted: result.blobsDeleted,
      blobsMBFreed: (result.blobsBytesFreed / 1024 / 1024).toFixed(2),
      cachedPhotosDeleted: result.cachedPhotosDeleted,
      cachedMBFreed: (result.cachedPhotosBytesFreed / 1024 / 1024).toFixed(2),
      totalMBFreed: ((result.blobsBytesFreed + result.cachedPhotosBytesFreed) / 1024 / 1024).toFixed(2)
    });

    return result;

  } catch (error: any) {
    result.errors.push(error.message);
    console.error('[Cleanup] Failed:', error);
    return result;
  }
}
```

---

## Tables Affected

| Table | Action | Data Removed |
|-------|--------|--------------|
| `localBlobs` | Delete rows | Binary image data (~75MB) |
| `localImages` | Update rows | Set `localBlobId: null` (keep metadata) |
| `cachedPhotos` | Delete rows | Base64 thumbnails + annotated images (~10-20MB) |
| `pendingRequests` | Delete synced | Old sync records for service |
| `pendingCaptions` | Delete synced | Old caption sync records |
| `efeFields` | Keep | Room/point data (small, useful for reference) |
| `visualFields` | Keep | Visual data (small, useful for reference) |

---

## What Stays After Cleanup

- `localImages` metadata (imageId, S3 keys, status) - ~1KB per image
- `efeFields` room data - useful if user reopens report
- `visualFields` visual data - useful if user reopens report
- `cachedServiceData` - can be cleaned separately if needed

---

## Re-fetching Images After Cleanup

After cleanup, images display using remote S3 URLs:

```typescript
async getDisplayUrl(localImage: LocalImage): Promise<string | null> {
  // 1. Try local blob first (will be null after cleanup)
  if (localImage.localBlobId) {
    const blob = await db.localBlobs.get(localImage.localBlobId);
    if (blob?.data) {
      return URL.createObjectURL(new Blob([blob.data]));
    }
  }

  // 2. Fall back to remote URL (used after cleanup)
  if (localImage.remoteS3Key) {
    return await this.fetchFromS3(localImage.remoteS3Key);
  }

  return null;
}
```

---

## UI Integration Points

### 1. Report Completion Screen
```typescript
// When user clicks "Finalize Report"
async onFinalizeReport(serviceId: string) {
  // Show confirmation
  const confirm = await this.alertCtrl.create({
    header: 'Finalize Report',
    message: 'This will sync all data and clear offline storage for this report. Continue?',
    buttons: ['Cancel', { text: 'Finalize', handler: () => true }]
  });

  await confirm.present();
  const { role } = await confirm.onDidDismiss();

  if (role === 'cancel') return;

  // Ensure everything is synced first
  await this.backgroundSync.syncNow();

  // Validate and cleanup
  const validation = await this.canCleanupReport(serviceId);
  if (!validation.canClean) {
    await this.showAlert('Cannot Finalize', validation.blockers.join('\n'));
    return;
  }

  const result = await this.cleanupFinalizedReport(serviceId);

  await this.showAlert('Report Finalized',
    `Freed ${((result.blobsBytesFreed + result.cachedPhotosBytesFreed) / 1024 / 1024).toFixed(1)} MB of storage`
  );
}
```

### 2. Storage Management Screen (Optional)
Allow users to manually cleanup old synced reports:
```typescript
async showStorageManagement() {
  const reports = await this.getReportsWithLocalData();

  // Show list with storage usage per report
  // Allow selective cleanup of synced reports
}
```

---

## Edge Cases to Handle

1. **Partial sync failure**: Don't cleanup if any images failed to sync
2. **Network loss during cleanup**: Transaction should be atomic
3. **User reopens report after cleanup**: Images re-fetch from S3 (slower but works)
4. **Annotations after cleanup**: Would need to re-download base image first
5. **Multiple devices**: Each device manages its own local storage independently

---

## Testing Checklist

- [ ] Verify all images synced before cleanup allowed
- [ ] Verify blobs actually deleted from IndexedDB
- [ ] Verify localBlobId set to null in localImages
- [ ] Verify cachedPhotos deleted for service
- [ ] Verify annotated photos deleted
- [ ] Verify images still display via S3 URL after cleanup
- [ ] Verify storage actually freed (check navigator.storage.estimate)
- [ ] Verify cleanup blocked if pending uploads exist
- [ ] Verify cleanup blocked if pending captions exist
- [ ] Test on iOS and Android devices
- [ ] Test with 100+ photos per report

---

## Future Enhancements

1. **Auto-cleanup**: Automatically cleanup reports older than X days that are synced
2. **Selective cleanup**: Allow keeping specific reports offline
3. **Storage warnings**: Alert user when approaching quota
4. **Background cleanup**: Run cleanup during idle time
5. **Compression of cached thumbnails**: Reduce cachedPhotos size further

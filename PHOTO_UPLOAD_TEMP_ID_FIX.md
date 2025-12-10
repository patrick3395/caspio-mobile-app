# Fix: Photo Uploads with Temp Visual IDs

## The Problem

When Visual is created offline:
- Visual gets temp ID: `temp_visual_123`
- User tries to upload photo
- Code does: `parseInt(temp_visual_123)` → NaN
- Upload rejected: "Invalid visual ID"

## The Solution

**Handle temp IDs in photo upload:**

### In Photo Upload Code (engineers-foundation.page.ts, hud.page.ts, etc.)

**Find where it checks Visual ID (around line ~5480-5540):**

**Current:**
```typescript
const visualIdNum = parseInt(actualVisualId, 10);

if (isNaN(visualIdNum)) {
  console.error('[GALLERY UPLOAD] Invalid visual ID:', actualVisualId);
  return;
}
```

**Replace with:**
```typescript
// Check if Visual ID is temporary
const isTempVisualId = String(actualVisualId).startsWith('temp_visual_');

if (isTempVisualId) {
  console.log('[GALLERY UPLOAD] Visual has temp ID, queuing photo for later upload');
  
  // Store photo with temp Visual ID
  const tempPhotoId = `temp_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const objectUrl = URL.createObjectURL(photo);

  // Show in UI immediately
  if (!this.visualPhotos[key]) {
    this.visualPhotos[key] = [];
  }

  this.visualPhotos[key].push({
    AttachID: tempPhotoId,
    id: tempPhotoId,
    name: photo.name,
    url: objectUrl,
    thumbnailUrl: objectUrl,
    isObjectUrl: true,
    uploading: false,
    queued: true,  // Waiting for Visual to sync
    caption: caption || '',
    _pendingVisualId: actualVisualId,  // Remember which Visual this belongs to
  });

  // Store in IndexedDB with dependency on Visual
  await this.indexedDb.storePhotoFile(tempPhotoId, photo, actualVisualId, caption);

  await this.indexedDb.addPendingRequest({
    type: 'UPLOAD_FILE',
    tempId: tempPhotoId,
    endpoint: 'PHOTO_UPLOAD_AFTER_VISUAL',
    method: 'POST',
    data: {
      tempVisualId: actualVisualId,
      fileId: tempPhotoId,
      caption,
      fileName: photo.name,
    },
    dependencies: await this.findVisualCreationRequest(actualVisualId),  // Wait for Visual
    status: 'pending',
    priority: 'normal',
  });

  this.showToast('Photo queued (waiting for visual to sync)', 'warning');
  this.changeDetectorRef.detectChanges();
  return;
}

// Continue with normal upload if Visual ID is real
const visualIdNum = parseInt(actualVisualId, 10);

if (isNaN(visualIdNum)) {
  console.error('[GALLERY UPLOAD] Invalid visual ID:', actualVisualId);
  return;
}
```

### Add Helper Method:

```typescript
private async findVisualCreationRequest(tempVisualId: string): Promise<string[]> {
  const pending = await this.indexedDb.getPendingRequests();
  const visualRequest = pending.find(r => r.tempId === tempVisualId);
  return visualRequest ? [visualRequest.requestId] : [];
}
```

## Result

**User workflow (offline):**
```
1. Create Visual → Gets temp_visual_123 ✅
2. Upload photo → Queued with dependency ✅
3. Shows placeholder thumbnail ✅
4. Badge shows "Waiting for sync" ✅

When online:
5. Background sync creates Visual → Gets real ID 456
6. Maps temp_visual_123 → 456
7. Uploads photo with VisualID: 456
8. Updates UI ✅
```

**No more "Invalid visual ID" errors!**

## Alternative: Simpler Approach

**Prevent photo upload until Visual synced:**

```typescript
if (String(actualVisualId).startsWith('temp_')) {
  this.showToast('Visual is syncing, please wait before adding photos', 'warning');
  return;
}
```

**Pros:** Much simpler  
**Cons:** User must wait for sync

**Which approach do you prefer?**

1. Queue photos with dependencies (complex, better UX)
2. Wait for Visual to sync before photos (simple, okay UX)


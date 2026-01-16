# Storage Pitfall Analysis: Dexie-First Architecture

**Date**: January 2026
**Issue**: 0MB → 55MB after adding 3 images
**Expected**: ~2-3MB for 3 compressed images

---

## Executive Summary

Your Dexie-first architecture is well-designed for offline-first performance, but has several storage pitfalls causing 10-20x bloat. The primary suspects for your 55MB observation are:

1. **Silent compression failure** - returning original 6MB files when WebP compression errors
2. **Double storage** - every image stored as binary blob AND base64 cache
3. **No proactive cleanup** - cleanup only triggers at 70% quota

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/services/caspio-db.ts` | 794 | Dexie schema (14 tables) |
| `src/app/services/indexed-db.service.ts` | 2918 | Storage CRUD operations |
| `src/app/services/local-image.service.ts` | 2077 | Image lifecycle management |
| `src/app/services/image-compression.service.ts` | 128 | WebP compression |
| `src/app/services/background-sync.service.ts` | 3300+ | Sync and cleanup logic |

---

## CRITICAL PITFALLS

### 1. Silent Compression Failure (MOST LIKELY CAUSE)

**File**: `src/app/services/image-compression.service.ts:52-55`

```typescript
async compressImage(file: File | Blob, customOptions?: any): Promise<Blob> {
  try {
    // ... compression logic
  } catch (error) {
    console.error('Error compressing image:', error);
    return file;  // ⚠️ Returns ORIGINAL uncompressed file!
  }
}
```

**Problem**: When compression fails (WebP not supported, memory issues, etc.), the original 4-8MB camera photo is stored instead of the expected 250KB compressed version.

**Evidence**: 55MB ÷ 3 images = ~18MB average per image, matching uncompressed camera photos with base64 overhead.

**Fix**:
```typescript
async compressImage(file: File | Blob, customOptions?: any): Promise<Blob> {
  try {
    const options = { ...this.defaultOptions, ...customOptions };
    const compressedFile = await imageCompression(fileToCompress, options);

    // Add compression verification
    const ratio = ((1 - compressedFile.size / file.size) * 100);
    console.log(`[Compression] ${file.size} → ${compressedFile.size} (${ratio.toFixed(1)}% reduction)`);

    // Warn if compression didn't work
    if (compressedFile.size > file.size * 0.9) {
      console.warn('[Compression] Minimal reduction - possible failure');
    }

    return compressedFile;
  } catch (error) {
    console.error('[Compression] FAILED:', error);
    // Option A: Throw to prevent storing huge files
    throw new Error('Image compression failed - cannot store uncompressed image');
    // Option B: Try JPEG fallback
    // return this.compressAsJpegFallback(file);
  }
}
```

---

### 2. Double Storage of Every Image

**Files**:
- `src/app/services/indexed-db.service.ts:2464-2524` (createLocalImage)
- `src/app/services/background-sync.service.ts:2448-2480` (cachePhotoFromLocalBlob)

**Storage Flow**:
```
User captures image
    ↓
compressImage() → 250KB WebP (if working)
    ↓
createLocalImage() → localBlobs table (binary ArrayBuffer)
    ↓
[Later, after sync]
    ↓
cachePhotoFromLocalBlob() → cachedPhotos table (base64 string, +33% larger)
```

**Tables Affected**:
| Table | Format | Purpose | Size Impact |
|-------|--------|---------|-------------|
| `localBlobs` | ArrayBuffer | Local-first display before sync | 250KB |
| `cachedPhotos` | Base64 string | Offline viewing after blob pruned | 333KB (+33%) |

**Total per image**: 583KB (working) or 14MB+ (compression failed)

**Fix Options**:

**Option A: Don't cache if blob exists** (Quick fix)
```typescript
// In background-sync.service.ts cachePhotoFromLocalBlob()
private async cachePhotoFromLocalBlob(imageId: string, ...): Promise<void> {
  const image = await this.indexedDb.getLocalImage(imageId);

  // Skip caching if blob still exists - we don't need the base64 copy yet
  if (image?.localBlobId) {
    console.log('[BackgroundSync] Skipping cache - blob exists:', imageId);
    return;
  }
  // ... rest of caching logic
}
```

**Option B: Store cache as Blob, not base64** (Better long-term)
```typescript
// In indexed-db.service.ts
async cachePhoto(attachId: string, serviceId: string, blob: Blob, s3Key?: string): Promise<void> {
  const photoData = {
    photoKey: `photo_${attachId}`,
    attachId,
    serviceId,
    imageData: blob,  // Store Blob directly, not base64 string
    s3Key: s3Key || '',
    cachedAt: Date.now()
  };
  await db.cachedPhotos.put(photoData);
}
```

---

### 3. Cleanup Only at 70% Quota

**File**: `src/app/services/background-sync.service.ts:3195-3197`

```typescript
// performStorageCleanup()
if (usagePercent > 70) {
  const deleted = await this.indexedDb.cleanupOldCachedPhotos(activeServiceIds, 30);
}
```

**Problem**: On mobile devices with ~100MB IndexedDB quota, 70MB of photos can accumulate before any cleanup runs.

**Fix**:
```typescript
// More aggressive cleanup schedule
private async performStorageCleanup(): Promise<void> {
  const stats = await this.indexedDb.getStorageStats();
  const usagePercent = stats.percent;

  // Always prune verified blobs older than 24 hours
  await this.pruneOldVerifiedBlobs(24 * 60 * 60 * 1000);

  // Cleanup cached photos based on usage level
  const activeServiceIds = await this.getActiveServiceIds();

  if (usagePercent > 50) {
    // Aggressive: 7-day retention
    await this.indexedDb.cleanupOldCachedPhotos(activeServiceIds, 7);
  } else if (usagePercent > 30) {
    // Moderate: 14-day retention
    await this.indexedDb.cleanupOldCachedPhotos(activeServiceIds, 14);
  }
  // Below 30%: let photos accumulate normally (30-day default)
}
```

---

## HIGH PRIORITY PITFALLS

### 4. Blob Pruning Requires UI Interaction

**File**: `src/app/services/local-image.service.ts:594-596`

```typescript
async pruneLocalBlob(imageId: string): Promise<boolean> {
  const image = await this.getImage(imageId);
  if (!image || image.status !== 'verified' || !image.remoteLoadedInUI) {
    return false;  // ⚠️ Won't prune unless user viewed synced image!
  }
  // ... pruning logic
}
```

**Problem**: If a user uploads photos but never views them again after sync, the local blobs persist forever.

**Fix**: Add time-based pruning fallback:
```typescript
async pruneLocalBlob(imageId: string): Promise<boolean> {
  const image = await this.getImage(imageId);
  if (!image || !image.localBlobId) return false;

  const now = Date.now();
  const ageMs = now - (image.remoteVerifiedAt || image.createdAt);
  const ageHours = ageMs / (1000 * 60 * 60);

  // Can prune if:
  // 1. Verified + user has viewed remote, OR
  // 2. Verified for 24+ hours (even without UI view)
  const canPrune = image.status === 'verified' &&
    (image.remoteLoadedInUI || ageHours > 24);

  if (!canPrune) return false;

  // ... rest of pruning logic
}
```

---

### 5. Base64 Storage Overhead (33%)

**File**: `src/app/services/indexed-db.service.ts:862-868`

```typescript
const photoData = {
  photoKey: photoKey,
  attachId: attachId,
  serviceId: serviceId,
  imageData: imageDataUrl,  // ⚠️ Base64 string - 33% larger than binary
  s3Key: s3Key || '',
  cachedAt: Date.now()
};
```

**Problem**: Base64 encoding adds 33% overhead. A 250KB image becomes 333KB.

**Fix**: Store as Blob directly (requires schema migration):
```typescript
// New schema (Dexie v10)
cachedPhotos: 'photoKey, attachId, serviceId, cachedAt'

// Store as Blob
const photoData = {
  photoKey: `photo_${attachId}`,
  attachId,
  serviceId,
  imageBlob: blob,  // Binary Blob, not base64 string
  s3Key: s3Key || '',
  cachedAt: Date.now()
};

// Read and convert to URL when needed
async getCachedPhotoUrl(attachId: string): Promise<string | null> {
  const cached = await db.cachedPhotos.get(`photo_${attachId}`);
  if (!cached?.imageBlob) return null;
  return URL.createObjectURL(cached.imageBlob);
}
```

---

## MEDIUM PRIORITY PITFALLS

### 6. Annotated Images Double-Cached

**File**: `src/app/services/indexed-db.service.ts:955-965`

When a user annotates an image, both versions are cached:
- `photo_{attachId}` - original (~333KB)
- `annotated_{attachId}` - with drawings (~400KB)

**Fix**: Replace original with annotated version:
```typescript
async cacheAnnotatedImage(attachId: string, blob: Blob): Promise<string | null> {
  // Delete original if exists
  await db.cachedPhotos.delete(`photo_${attachId}`);

  // Store annotated version with standard key
  const photoKey = `photo_${attachId}`;  // Not 'annotated_'
  const photoData = {
    photoKey,
    attachId,
    serviceId: 'annotated',
    imageData: await this.blobToBase64(blob),
    isAnnotated: true,
    cachedAt: Date.now()
  };
  await db.cachedPhotos.put(photoData);
}
```

---

### 7. PendingCaptions Never Cleaned

**Table**: `pendingCaptions`

Caption updates with `status: 'synced'` remain in the table forever.

**Fix**: Add cleanup to `cleanupSyncedRequests()`:
```typescript
async cleanupSyncedRequests(olderThanDays: number = 7): Promise<number> {
  const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

  // Existing: cleanup pendingRequests
  const deletedRequests = await this.cleanupOldSyncedRequests(cutoffTime);

  // NEW: cleanup synced captions
  const syncedCaptions = await db.pendingCaptions
    .where('status')
    .equals('synced')
    .toArray();

  const oldCaptions = syncedCaptions.filter(c => c.createdAt < cutoffTime);
  await db.pendingCaptions.bulkDelete(oldCaptions.map(c => c.captionId));

  return deletedRequests + oldCaptions.length;
}
```

---

## Storage Math Summary

| Scenario | localBlobs | cachedPhotos | Total (3 images) |
|----------|-----------|--------------|------------------|
| **Working compression** | 750KB | 1MB | ~2MB |
| **Failed compression** | 18MB | 24MB | 42MB |
| **+ IndexedDB overhead** | - | - | **~55MB** |

---

## Implementation Order

### Phase 1: Diagnose (No code changes)
1. Add console.log to verify compression is actually running
2. Check browser console for compression errors
3. Verify WebP support on target devices

### Phase 2: Quick Wins
1. Lower cleanup threshold from 70% to 30%
2. Add time-based blob pruning (24-hour fallback)
3. Skip base64 caching when blob exists

### Phase 3: Structural Fixes
1. Add compression failure handling (throw or fallback)
2. Migrate cachedPhotos from base64 to Blob storage
3. Consolidate annotated image caching

---

## Testing Verification

After implementing fixes, verify:

1. **Compression working**: Console shows "250KB → X reduction"
2. **Single storage**: Only localBlobs OR cachedPhotos, not both
3. **Cleanup running**: Console shows cleanup messages at <70% usage
4. **Blob pruning**: Blobs deleted after 24 hours even without UI view
5. **Storage stable**: Adding 10 photos should use <5MB total

---

## Files to Modify

| File | Line(s) | Change |
|------|---------|--------|
| `image-compression.service.ts` | 52-55 | Add failure handling |
| `background-sync.service.ts` | 3195-3197 | Lower cleanup threshold |
| `background-sync.service.ts` | 2448-2480 | Skip cache if blob exists |
| `local-image.service.ts` | 594-596 | Add time-based pruning |
| `indexed-db.service.ts` | 862-868 | Blob storage (optional) |
| `indexed-db.service.ts` | 955-965 | Consolidate annotated cache |

---

## Dexie-First Architecture: What's Working Well

The architecture itself is solid:
- Instant page switching via liveQuery
- No stale cache issues
- Proper offline-first design
- Write-through to Dexie
- Background sync with retry

The storage issues are implementation details, not architectural flaws. All fixes preserve the core Dexie-first pattern.

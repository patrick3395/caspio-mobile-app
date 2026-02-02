# WEBAPP Image Matching Fix

## Problem
In WEBAPP mode, cached annotated images were being displayed even when they were stale or from different photos. This caused "photo mismatch" issues where the wrong image appeared for a visual.

## Root Cause
The code was checking for cached annotated images **before** verifying if the server actually had annotations (Drawings field). This meant:
1. A photo could be annotated, cached locally with key `attachId`
2. Later, the annotations could be cleared or a different photo could have the same `attachId`
3. The stale cached image would still be displayed because the cache lookup happened first

## Console Log Symptom
```
First attachment: {...,"Drawings":"",..."} // Server has NO drawings
[IndexedDB] Cached annotated image found (legacy): 635
[LbwVisualDetail] WEBAPP: Using cached annotated image for 635 // Used stale cache anyway!
```

## The Fix

### 1. Visual Detail Page (`lbw-visual-detail.page.ts`)
Only use cached annotated image **if server also has Drawings**. If cache exists but server has no Drawings, **delete the stale cache**.

```typescript
// WEBAPP FIX: Check for cached annotated image, but ONLY use if server also has annotations
// This prevents stale cached images from appearing when annotations were cleared
// or when the cache has an image from a different photo with the same attachId
try {
  const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(attachId);
  if (cachedAnnotated && hasServerAnnotations) {
    // Server has annotations AND we have a cached image - use the cached version
    thumbnailUrl = cachedAnnotated;
    hasAnnotations = true;
    console.log(`[LbwVisualDetail] WEBAPP: Using cached annotated image for ${attachId} (server has Drawings)`);
  } else if (cachedAnnotated && !hasServerAnnotations) {
    // Cached image exists but server has NO annotations - cache is stale, clear it
    console.log(`[LbwVisualDetail] WEBAPP: Clearing stale cached annotated image for ${attachId} (server has no Drawings)`);
    await this.indexedDb.deleteCachedAnnotatedImage(attachId);
  } else if (hasServerAnnotations && displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
    // No cached image but server has Drawings - render annotations on the fly
    // ... render and cache logic
  }
} catch (annotErr) {
  console.warn(`Failed to process annotations for ${attachId}:`, annotErr);
}
```

### 2. IndexedDB Service (`indexed-db.service.ts`)
Added `deleteCachedAnnotatedImage()` method to clean up stale cached images:

```typescript
/**
 * Delete cached annotated image
 * Used when server indicates no annotations exist (stale cache cleanup)
 */
async deleteCachedAnnotatedImage(attachId: string): Promise<void> {
  const photoKey = `annotated_${attachId}`;

  try {
    // Get the record first to check if it has a blobKey pointer
    const result = await db.cachedPhotos.get(photoKey);

    if (result?.blobKey) {
      // Also delete the referenced blob
      await db.localBlobs.delete(result.blobKey);
    }

    // Delete the cachedPhotos record
    await db.cachedPhotos.delete(photoKey);
    console.log('[IndexedDB] Deleted stale annotated cache:', attachId);
  } catch (error) {
    console.warn('[IndexedDB] Error deleting cached annotated image:', attachId, error);
  }
}
```

## Behavior Matrix

| Server Drawings | Cache Exists | Action |
|-----------------|--------------|--------|
| Yes | Yes | Use cached image |
| Yes | No | Render annotations, then cache |
| No | Yes | **Delete stale cache**, use original S3 image |
| No | No | Use original S3 image |

## Key Principle
**The server is the source of truth for whether annotations exist.** The local cache is only valid if the server confirms annotations are present (Drawings field has content).

## Related Files
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`
- `src/app/pages/engineers-foundation/structural-systems/visual-detail/visual-detail.page.ts`
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts`
- `src/app/pages/dte/dte-visual-detail/dte-visual-detail.page.ts`
- `src/app/services/indexed-db.service.ts`

## Applies To
- LBW template (implemented)
- Engineers Foundation template (implemented)
- HUD template (implemented)
- DTE template (implemented)

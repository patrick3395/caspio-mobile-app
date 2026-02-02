# Issue: HUD Visual Detail Page - Title/Text Edits Not Saving to Backend

## Status: RESOLVED ✓

## Problem Description
When editing the Title or Text fields on the HUD visual detail page (`/hud/:projectId/:serviceId/category/hud/visual/:templateId`), the changes appear to save successfully (green success banner shows), but the data is NOT being updated in the backend database (LPS_Services_HUD table).

## Root Cause
The visual-detail page was querying HUD records using `serviceId` from route params (which is `PK_ID` from the Services table), but HUD records are stored with the `ServiceID` field as the foreign key. These are different values.

Category-detail correctly loaded the service record to get `actualServiceId`, but visual-detail was not receiving this value and used the wrong ID for queries, causing `getHudByService()` to return 0 records.

## Solution
1. Category-detail now passes `actualServiceId` in query params when navigating to visual-detail
2. Visual-detail extracts `actualServiceId` from query params and uses it for all HUD queries

## Files Modified
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - Pass actualServiceId in query params
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` - Use actualServiceId for HUD queries

---

# Issue: HUD Visual Deselected After Reload When Text is Changed

## Status: RESOLVED ✓

## Problem Description
After changing the Text field on the HUD visual detail page (which now successfully updates the backend), when the page is reloaded, the visual appears deselected. This is because the visual lookup by Name + Category is no longer matching the record.

## Environment
- **Page URL Example:** `/hud/2006/645/category/hud/visual/630`
- **Mode:** Webapp (not mobile)
- **Table:** LPS_Services_HUD

## Expected Behavior
1. User edits Text field
2. Data saves to backend successfully
3. User reloads page
4. Visual is still selected and shows updated data

## Actual Behavior
1. User edits Text field
2. Data saves to backend successfully
3. User reloads page
4. Visual appears deselected (isSelected = false)
5. Falls back to template data instead of HUD record data

## Suspected Cause
The visual lookup in `loadVisualData()` matches by `Name + Category`:
```typescript
visual = hudRecords.find((v: any) =>
  v.Name === template.Name && v.Category === template.Category
);
```

If the user edited the Name field, the lookup would fail because `v.Name` no longer matches `template.Name`.

However, user reports this happens when editing **Text** field, not Name. Need to investigate:
1. Is the Name field being accidentally modified?
2. Is there a case sensitivity issue?
3. Is Category matching correctly?

## Files Involved
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts`
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`

## Fix Applied
Changed visual lookup priority in `loadVisualData()`:

**Before:** Only matched by Name + Category (fails if Name was edited)
```typescript
visual = hudRecords.find((v: any) =>
  v.Name === template.Name && v.Category === template.Category
);
```

**After:** First try HUDID from query params, then fall back to Name + Category
```typescript
// PRIORITY 1: Find by HUDID from query params (most reliable)
if (hudIdFromQueryParams) {
  visual = hudRecords.find((v: any) =>
    String(v.HUDID || v.PK_ID) === String(hudIdFromQueryParams)
  );
}

// PRIORITY 2: Fall back to Name + Category matching
if (!visual && template && template.Name) {
  visual = hudRecords.find((v: any) =>
    v.Name === template.Name && v.Category === template.Category
  );
}
```

**Attempt 1 Result:** FAILED - Visual still shows deselected after editing title and going back to category-detail page. The issue is not just in visual-detail lookup, but also in category-detail's determination of selected state.

---

## Attempt 2: Use Dexie mappings in category-detail's loadDataFromAPI

**Hypothesis:** Category-detail's `loadDataFromAPI` only matches visuals by Name + Category. When the Name is edited, the match fails. However, when visuals are created, the templateId -> visualId mapping is stored in Dexie via `visualFieldRepo.setField()`. We should use this mapping to find visuals even when Name has changed.

**Changes Made:**

In `hud-category-detail.page.ts` `loadDataFromAPI()`:
1. Load Dexie visualFields for this serviceId
2. Build a templateId -> visualId map from Dexie fields
3. When matching visuals to templates:
   - PRIORITY 1: Find by HUDID from Dexie mapping
   - PRIORITY 2: Fall back to Name + Category matching

```typescript
// Load Dexie fields to get templateId -> visualId mappings
const dexieFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

// Build templateId -> visualId map from Dexie
const templateToVisualMap = new Map<number, string>();
for (const field of dexieFields) {
  const visualId = field.visualId || field.tempVisualId;
  if (visualId && field.templateId) {
    templateToVisualMap.set(field.templateId, visualId);
  }
}

// First try Dexie mapping
const dexieVisualId = templateToVisualMap.get(templateId);
if (dexieVisualId) {
  visual = (visuals || []).find((v: any) =>
    String(v.HUDID || v.PK_ID) === String(dexieVisualId)
  );
}
```

**Attempt 2 Result:** SUCCESS ✓ - Visual stays selected and shows edited title.

**Additional Fix:**
Changed item name assignment to use visual's Name if available:
```typescript
// Before:
name: template.Name || '',

// After:
name: visual?.Name || template.Name || '',
```

---

## Attempt 3: Apply same fix to Mobile mode (loadDataFromCache)

**Context:** The Attempt 2 fix resolved the issue in WEBAPP mode (`loadDataFromAPI`). However, mobile mode uses `loadDataFromCache()` which had the same problem - only matching visuals by Name + Category.

**Changes Made to `hud-category-detail.page.ts` `loadDataFromCache()`:**

1. Load Dexie visualFields FIRST (before the template loop):
```typescript
// TITLE EDIT FIX: Load Dexie visualFields FIRST to get templateId -> visualId mappings
const dexieFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

const templateToVisualMap = new Map<number, string>();
for (const field of dexieFields) {
  const visualId = field.visualId || field.tempVisualId;
  if (visualId && field.templateId) {
    templateToVisualMap.set(field.templateId, visualId);
  }
}
```

2. Use Dexie mapping as PRIORITY 1 for visual lookup in template loop:
```typescript
// PRIORITY 1: Find by HUDID from Dexie mapping
const dexieVisualId = templateToVisualMap.get(template.HUDTemplateID || template.VisualTemplateID);
if (dexieVisualId) {
  visual = (visuals || []).find((v: any) =>
    String(v.HUDID || v.PK_ID) === String(dexieVisualId)
  );
}

// PRIORITY 2: Fall back to templateId matching
if (!visual) {
  visual = (visuals || []).find((v: any) =>
    v.HUDTemplateID === template.HUDTemplateID ||
    v.VisualTemplateID === template.VisualTemplateID ||
    v.TemplateID === template.HUDTemplateID
  );
}

// PRIORITY 3: Final fallback to Name matching
if (!visual && template.Name) {
  visual = (visuals || []).find((v: any) => v.Name === template.Name);
}
```

3. Changed item name to use visual's edited name if available:
```typescript
// Before:
name: template.Name || '',

// After:
name: visual?.Name || template.Name || '',
```

**Attempt 3 Result:** TESTING - Awaiting user verification

---

# Issue: Visual Detail Back Button Navigates to HUD Main Hub

## Status: RESOLVED ✓

## Problem Description
The back button on the HUD visual detail page navigates to the HUD main hub instead of going back one page to the category-detail page.

## Attempt 1: Explicit route navigation with routeCategory
**Result:** FAILED

Changes made:
- Added `routeCategory` property to store the original route category
- Changed `goBack()` to explicitly navigate using router.navigate()

The navigation still doesn't work correctly. Possible issues with projectId, serviceId, or routeCategory values not being set correctly from route params.

---

## Attempt 2: Use Angular Location service (browser history)
**Changes:**
- Import `Location` from `@angular/common`
- Inject `Location` in constructor
- Changed `goBack()` to use `this.location.back()`

**Result:** FAILED - Still not navigating correctly in webapp mode.

---

## Attempt 3: Fix container's goBack() method (ROOT CAUSE FOUND)

**Root Cause:** The back button is in `hud-container.page.html`, not in visual-detail. The container's `goBack()` method was checking `if (url.includes('/category/'))` and navigating to HUD main. But `/category/` is in BOTH category-detail AND visual-detail URLs, so visual-detail was incorrectly going to HUD main.

**Fix:** Following EFE pattern, check for `/visual/` FIRST before checking `/category/`:

```typescript
// IMPORTANT: Check for /visual/ first since it also contains /category/
if (url.includes('/category/') && url.includes('/visual/')) {
  // On visual-detail page - navigate back to category-detail page
  const categoryMatch = url.match(/\/category\/([^\/]+)/);
  if (categoryMatch) {
    this.router.navigate(['/hud', this.projectId, this.serviceId, 'category', categoryMatch[1]]);
  }
} else if (url.includes('/category/')) {
  // On category detail page - navigate to HUD main
  this.router.navigate(['/hud', this.projectId, this.serviceId]);
}
```

**Attempt 3 Result:** SUCCESS ✓ - Back button now correctly navigates from visual-detail to category-detail.

## Files Involved
- `src/app/pages/hud/hud-container/hud-container.page.ts` (the actual fix)
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` (previous attempts, not the issue)

---

# Issue: Annotations Not Showing in Thumbnail on Category Page

## Status: RESOLVED ✓

## Problem Description
Annotations added in the HUD visual detail page are not showing in the thumbnail on the category-detail (main) page. This is a HUD webapp-only issue.

## Environment
- **Page URL Example:** `/hud/:projectId/:serviceId/category/hud`
- **Mode:** Webapp only (not mobile)
- **Tables:** LPS_Services_HUD

## Expected Behavior
1. User adds annotations to a visual in the detail page
2. User navigates back to category-detail page
3. Thumbnail shows the image WITH annotations overlaid

## Actual Behavior
1. User adds annotations to a visual in the detail page
2. User navigates back to category-detail page
3. Thumbnail shows only the base image WITHOUT annotations

## Files to Investigate
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.html`
- `src/app/pages/engineers-foundation/structural-systems/category-detail/` (EFE reference)

## Root Cause Analysis
The `refreshLocalState()` method in `hud-category-detail.page.ts` regenerates blob URLs for base images using `localImageService.refreshBlobUrlsForImages()`, but it doesn't load cached annotated images. When returning from visual-detail:

1. `mergePendingCaptions()` correctly sets `hasAnnotations: true` on photos with annotations
2. BUT the `displayUrl` is still pointing to the base image, not the annotated image
3. The annotated image IS cached in IndexedDB via `indexedDb.cacheAnnotatedImage()` in visual-detail
4. But `refreshLocalState()` never loads these cached annotated images to update `displayUrl`

## Files Involved
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - `refreshLocalState()` method
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` - saves annotations correctly

## Attempt 1: Add annotated image refresh to refreshLocalState()

**Hypothesis:** After `mergePendingCaptions()` sets `hasAnnotations: true`, we need to also load the cached annotated images and update `displayUrl` with them.

**Changes:**
1. Added call to `refreshAnnotatedImageUrls()` after `mergePendingCaptions()` in `refreshLocalState()`
2. Created new method `refreshAnnotatedImageUrls()` that:
   - Loads all cached annotated images from IndexedDB into `bulkAnnotatedImagesMap`
   - Iterates through all photos in `visualPhotos`
   - For photos with `hasAnnotations: true`, looks up cached annotated image by attachId or localImageId
   - Updates `displayUrl` and `thumbnailUrl` with the annotated image (keeps `url` as original for re-editing)

```typescript
private async refreshAnnotatedImageUrls(): Promise<void> {
  // First, refresh the bulkAnnotatedImagesMap from IndexedDB
  const annotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService();
  this.bulkAnnotatedImagesMap = annotatedImages;

  // Update in-memory photos with annotated image URLs
  for (const [key, photos] of Object.entries(this.visualPhotos)) {
    for (const photo of photos as any[]) {
      const hasAnnotations = photo.hasAnnotations || (photo.Drawings && photo.Drawings.length > 10);
      if (!hasAnnotations) continue;

      const attachId = photo.AttachID || photo.attachId || photo.id || '';
      const localImageId = photo.localImageId || photo.imageId;

      let annotatedImage = this.bulkAnnotatedImagesMap.get(attachId);
      if (!annotatedImage && localImageId) {
        annotatedImage = this.bulkAnnotatedImagesMap.get(localImageId);
      }

      if (annotatedImage) {
        photo.displayUrl = annotatedImage;
        photo.thumbnailUrl = annotatedImage;
      }
    }
  }
}
```

**Result:** FAILED - Did not resolve the issue. The fix was incomplete.

---

## Attempt 2: Fix WEBAPP mode annotation handling

**Root Cause Analysis (deeper):**
1. In WEBAPP mode, `photo.id` is the Caspio `AttachID` (e.g., "632"), not a localImage ID
2. `db.localImages.update("632", ...)` fails silently because no localImage with that ID exists
3. `db.localImages.get("632")` returns null, so annotation update to Caspio is never queued
4. The cached annotated image IS saved correctly (with key "632")
5. BUT in `_loadPhotosForVisualImpl`, the lookup only checked for cached annotations if `attach.Drawings` existed from server
6. Since annotation wasn't synced to server yet, `attach.Drawings` is empty, so cache lookup was skipped

**Changes Made:**

**File 1: `hud-visual-detail.page.ts` - Fix WEBAPP mode annotation saving**
- Added separate code path for WEBAPP mode (`environment.isWeb && !photo.isLocal`)
- In WEBAPP mode: directly queue annotation update to Caspio using `photo.id` (which IS the AttachID)
- Cache annotated image with `photo.id` (AttachID) as the key
- Mobile mode continues to use localImages table

**File 2: `hud-category-detail.page.ts` - Fix annotation lookup in `_loadPhotosForVisualImpl`**
- Changed to ALWAYS check for cached annotated image, not just when server has Drawings
- This catches locally-added annotations that haven't synced yet

```typescript
// BEFORE: Only checked if server had Drawings
const hasAnnotations = !!(attach.Drawings && attach.Drawings.length > 10);
if (hasAnnotations) {
  const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
  ...
}

// AFTER: Always check cache (catches local-only annotations)
const hasServerAnnotations = !!(attach.Drawings && attach.Drawings.length > 10);
let hasAnnotations = hasServerAnnotations;
const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
if (cachedAnnotated) {
  thumbnailUrl = cachedAnnotated;
  hasAnnotations = true;
}
```

**Result:** SUCCESS ✓ - Annotations now show in thumbnails on category-detail page after being added in visual-detail.

---

# Issue: Adding New Image in Visual Detail Page Not Loading on Backend

## Status: RESOLVED ✓

## Problem Description
Adding a new image in the HUD visual detail page (webapp) is not uploading to the backend. The photo upload process needs to match how it works on the category-detail (main) page.

## Environment
- **Page URL Example:** `/hud/:projectId/:serviceId/category/hud/visual/:templateId`
- **Mode:** Webapp only (not mobile)
- **Tables:** LPS_Services_HUD_Attachments

## Expected Behavior
1. User clicks Camera/Gallery button in visual detail page
2. Image is selected
3. Image uploads to S3 and Caspio attachment record is created
4. Image appears in the visual detail page photo list

## Actual Behavior
1. User clicks Camera/Gallery button in visual detail page
2. Image is selected
3. Image does NOT upload to backend
4. Image may appear locally but not persist

## Files to Investigate
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts` - current upload implementation
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - working upload implementation to reference

## Root Cause
The `processAndSavePhoto()` method in visual-detail only used `localImageService.captureImage()` which is designed for mobile/offline mode (stores locally, syncs in background). In WEBAPP mode, this doesn't upload directly to S3.

The category-detail page has separate code paths:
- WEBAPP: Uses `localImageService.uploadImageDirectToS3()` for direct S3 upload
- Mobile: Uses `localImageService.captureImage()` for local-first storage

## Attempt 1: Add WEBAPP mode direct S3 upload

**Changes to `hud-visual-detail.page.ts` `processAndSavePhoto()`:**
1. Check if `environment.isWeb`
2. WEBAPP mode:
   - Create temp photo entry with loading state
   - Call `localImageService.uploadImageDirectToS3()` directly
   - Replace temp photo with real photo after upload completes
   - Handle errors by removing temp photo
3. Mobile mode: Keep existing `captureImage()` approach

```typescript
if (environment.isWeb) {
  // Create temp entry with uploading: true
  // Call uploadImageDirectToS3()
  // Replace temp with real photo after success
} else {
  // Existing captureImage() flow
}
```

**Result:** SUCCESS ✓ - Photos now upload directly to S3 in WEBAPP mode and appear correctly.

---

# Issue: Multi-Select Items Missing Action Buttons

## Status: RESOLVED ✓

## Problem Description
Multi-select items (answerType === 2) in the HUD category-detail page do not have the same 4 action buttons (Camera, Gallery, View, Details) that appear under other visual items (answerType === 0). They should function exactly the same way.

## Environment
- **Page URL Example:** `/hud/:projectId/:serviceId/category/hud`
- **Mode:** Webapp
- **Affected:** Multi-select question types (answerType === 2)

## Expected Behavior
1. When a multi-select item is selected, show the 4 action buttons below:
   - Camera - take photo
   - Gallery - select from gallery
   - View (X) - expand/collapse photo thumbnails
   - Details - navigate to visual detail page
2. Photos section should expand/collapse like other visuals
3. All photo functionality should match answerType === 0 items

## Actual Behavior
1. Multi-select items only show the checkbox options
2. No action buttons appear
3. Cannot add photos or navigate to details

## Files to Investigate
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.html` - template with action buttons

## Attempt 1: Add action buttons and image preview to multi-select items

**Changes to `hud-category-detail.page.html`:**

Updated all 3 multi-select sections (Information, Limitations, Deficiencies) to match the structure of answerType === 0 items:

1. Added selection checkbox at the start of the item
2. Added photo count indicator (right-aligned)
3. Added saving spinner
4. Added action button grid (Camera, Gallery, View, Details) - shown when item is selected
5. Added image preview section with all photo functionality - shown when photos are expanded

The multi-select options remain visible and functional alongside the new photo features.

**Result:** SUCCESS ✓ - Multi-select items now have all 4 action buttons and photo functionality.

---

# Issue: Photo Uploads Failing When Synced (HUD Mobile App)

## Status: OPEN

## Problem Description
Photo uploads in the HUD mobile app are failing when synced. The syncing process needs to follow the same upload procedures as the EFE mobile app, but using HUD tables and HUDID instead of EFE tables.

## Environment
- **Platform:** Mobile app (iOS/Android)
- **Mode:** Mobile (offline-first with background sync)
- **Tables:** LPS_Services_HUD, LPS_Services_HUD_Attachments

## Expected Behavior
1. User takes/selects photo in HUD mobile app
2. Photo is stored locally in IndexedDB/Dexie
3. When sync occurs, photo uploads to S3
4. Attachment record is created in LPS_Services_HUD_Attachments with correct HUDID
5. Photo appears in webapp after sync

## Actual Behavior
1. User takes/selects photo in HUD mobile app
2. Photo is stored locally
3. Sync fails - photos do not upload correctly
4. Photos do not appear in webapp

## Files to Investigate
- `src/app/services/background-sync.service.ts` - Background sync service
- `src/app/services/local-image.service.ts` - Local image handling
- `src/app/pages/hud/hud-data.service.ts` - HUD data service
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts` - EFE reference

## Reference: EFE Mobile Upload Flow
Need to review EFE's mobile upload/sync flow and ensure HUD follows the same pattern with:
- Correct table names (LPS_Services_HUD_Attachments vs LPS_Services_EFE_Attachments)
- Correct ID field (HUDID vs VisualID)
- Correct entity type ('hud' vs 'efe')

## Root Cause
In `background-sync.service.ts` `processUploadOutboxItem()` method, the switch statement that handles different entity types only had cases for:
- `'visual'` - EFE visuals
- `'efe_point'` - EFE measurement points
- `'fdf'` - FDF photos

There was **NO case for `'hud'`**, so HUD photos fell through to the default case which threw: `Unsupported entity type: hud`

## Attempt 1: Add HUD entity type handler to background sync

**Changes to `background-sync.service.ts`:**

1. Added `case 'hud':` to the switch statement in `processUploadOutboxItem()`:
```typescript
case 'hud':
  // HUD photos are stored in LPS_Services_HUD_Attach table
  console.log('[BackgroundSync] HUD photo upload starting:', item.imageId, 'hudId:', entityId);
  result = await uploadWithTimeout(
    this.caspioService.createServicesHUDAttachWithFile(
      parseInt(entityId),
      image.caption || '',
      file,
      image.drawings || ''
    ).toPromise(),
    `hud upload for ${item.imageId}`
  );
  console.log('[BackgroundSync] HUD photo upload completed:', item.imageId, 'result:', result);
  break;
```

2. Added HUD photo upload completion event emission:
```typescript
else if (image.entityType === 'hud') {
  this.ngZone.run(() => {
    this.hudPhotoUploadComplete$.next({
      imageId: item.imageId,
      attachId: attachId,
      s3Key: s3Key,
      hudId: entityId
    });
  });
}
```

**Result:** SUCCESS ✓ - HUD photos now sync properly from mobile app.

---

# Issue: HUD Mobile - Image Not Showing Immediately After Upload

## Status: RESOLVED ✓

## Problem Description
In the HUD mobile template, after uploading an image it does not immediately show in the UI. The image only appears after sync completes. This should follow the DEXIE-first local approach where images appear immediately from local storage.

## Environment
- **Platform:** Mobile app (iOS/Android)
- **Template:** HUD
- **Mode:** Mobile (offline-first)

## Expected Behavior (matching EFE)
1. User takes/selects photo
2. Photo immediately appears in UI from local Dexie storage
3. Photo shows "uploading" indicator
4. After sync, photo remains visible with synced status

## Actual Behavior
1. User takes/selects photo
2. Photo does NOT appear in UI immediately
3. Photo only appears after sync completes

## Files to Investigate
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - HUD photo handling
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts` - EFE reference

## Root Cause Found
In `subscribeToLocalImagesChanges()`, the liveQuery was filtering by wrong entity type:
```typescript
// WRONG - filtering by 'visual' but HUD photos use 'hud' entity type
db.liveLocalImages$(this.serviceId, 'visual').subscribe(
```

HUD photos are captured with entity type `'hud'` (line 5780), but the liveQuery subscription was filtering for `'visual'`. This means:
1. LiveQuery never sees HUD photos
2. Photos added to UI during capture don't get reactive updates
3. After sync, `populatePhotosFromDexie` may not find the photos correctly

## Attempt 1: Fix liveQuery entity type filter

**Changes to `hud-category-detail.page.ts` line 1944:**
```typescript
// BEFORE:
db.liveLocalImages$(this.serviceId, 'visual').subscribe(

// AFTER:
db.liveLocalImages$(this.serviceId, 'hud').subscribe(
```

**Result:** FAILED - Photos still don't show immediately and show broken after sync. Need deeper investigation of EFE implementation.

---

# Issue: HUD Mobile - Broken Image After Sync

## Status: RESOLVED ✓

## Problem Description
In the HUD mobile template, after sync completes, the uploaded image shows as a broken image. The image URL/blob reference is not being maintained properly through the sync process.

## Environment
- **Platform:** Mobile app (iOS/Android)
- **Template:** HUD
- **Mode:** Mobile (offline-first)

## Expected Behavior (matching EFE)
1. Photo syncs successfully
2. Photo continues to display correctly using local blob OR signed S3 URL
3. No broken image icons

## Actual Behavior
1. Photo syncs successfully
2. Photo shows as broken image
3. Image URL/reference is invalid after sync

## Root Cause (suspected)
The photo's displayUrl is not being updated properly after sync. Need to follow EFE's DEXIE-first approach where:
- Local blob URLs are maintained for display
- After sync, the local image record is updated with attachId
- Display continues from local blob until explicitly refreshed

## Files to Investigate
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts` - EFE reference

## Root Cause (same as Issue above)
The liveQuery subscription was filtering by `'visual'` entity type instead of `'hud'`. When sync completes and liveQuery fires, it couldn't find HUD photos, causing `populatePhotosFromDexie` to fail to refresh displayUrls properly.

## Attempt 1: Fix liveQuery entity type filter (same fix as above)

The same fix in `subscribeToLocalImagesChanges()` should resolve both issues:
- Photos will now appear immediately because liveQuery correctly monitors 'hud' entity type
- After sync, liveQuery will properly detect changes and refresh displayUrls from local blobs

**Result:** FAILED - Same root cause fix didn't resolve the broken image issue. Need deeper investigation.

## Attempt 2: Fix wrong event subscription and event shape

**Root Cause Analysis (deep dive):**

After thorough investigation comparing EFE and HUD implementations:

1. **Wrong Event Subscription**: HUD's `subscribeToUploadUpdates()` subscribes to `photoUploadComplete$` (line 1663), but that's the EFE event for 'visual' entity type photos. HUD photos use 'hud' entity type and emit to `hudPhotoUploadComplete$`.

2. **Event Shape Mismatch**: The current handler expects:
   - `event.tempFileId` and `event.result` (EFE event shape)

   But `hudPhotoUploadComplete$` provides:
   - `imageId` - the localImage ID
   - `attachId` - the real Caspio AttachID
   - `s3Key` - the S3 key
   - `hudId` - the HUD record ID

3. **Why Photos Don't Show Immediately**: Photos ARE being added to `visualPhotos` correctly by the camera code, but liveQuery was filtering by 'hud' entity type, which should work. However, the sync completion handler was never firing because it was subscribed to the wrong event.

4. **Why Broken Image After Sync**: When sync completes, `hudPhotoUploadComplete$` fires but HUD isn't subscribed to it. The EFE `photoUploadComplete$` never fires for HUD photos. Without the sync completion handler updating the photo's AttachID, the photo lookup fails after liveQuery refresh.

**Changes Made:**

**File: `hud-category-detail.page.ts`**

1. Changed subscription from `photoUploadComplete$` to `hudPhotoUploadComplete$`
2. Updated event handler to use HUD event shape:
   - `event.imageId` instead of `event.tempFileId`
   - `event.attachId` directly instead of extracting from `event.result`

**Result:** FAILED - Same issues persist. Photos still don't show immediately and show broken after sync.

## Attempt 3: Populate lastConvertedFields for photo matching (Dexie-first architecture fix)

**Root Cause Analysis (deep dive):**

After thorough comparison with EFE's mobile implementation, found critical differences:

1. **EFE Mobile Mode:**
   - Uses `visualFieldsSubscription = visualFieldRepo.getFieldsForCategory$()` (reactive)
   - When fields change, calls `convertFieldsToOrganizedData(fields)` which sets `lastConvertedFields`
   - When a visual is created, Dexie update triggers liveQuery, which updates `lastConvertedFields`
   - `populatePhotosFromDexie()` iterates over `lastConvertedFields` to find photos by `field.visualId`/`field.tempVisualId`

2. **HUD Mobile Mode (BROKEN):**
   - Uses `loadDataFromCache()` which builds `organizedData` directly
   - NEVER populates `lastConvertedFields`
   - When `subscribeToLocalImagesChanges()` fires and calls `populatePhotosFromDexie()`, it iterates over empty/stale `lastConvertedFields`
   - Photos can't be matched because there are no fields with visualIds

**Changes Made:**

**File: `hud-category-detail.page.ts`**

1. **Added `buildConvertedFieldsFromOrganizedData()` method** (~line 786):
   - Converts `organizedData` items into `VisualField`-like objects
   - Sets `visualId` and `tempVisualId` from `visualRecordIds[key]`
   - Enables `populatePhotosFromDexie()` to find photos by entityId

2. **Added call to build lastConvertedFields in `loadDataFromCache()`** (line 757-759):
   ```typescript
   this.lastConvertedFields = this.buildConvertedFieldsFromOrganizedData(organizedData);
   ```

3. **Added lastConvertedFields update in `saveVisualSelection()`** (added earlier):
   - When a new visual is created, updates the corresponding field in `lastConvertedFields`
   - Ensures `populatePhotosFromDexie()` can find newly captured photos

**Result:** FAILED - Same issues persist.

## Attempt 4: Debug with alerts to trace exact mobile flow

**Debug alerts added at these key points:**

1. **[HUD DEBUG 1]** - MOBILE CAPTURE START: key, visualId, serviceId
2. **[HUD DEBUG 2]** - LocalImage CREATED: imageId, entityType, entityId, localBlobId, status
3. **[HUD DEBUG 3]** - PHOTO ADDED TO UI: key, imageId, displayUrl type, total photos
4. **[HUD DEBUG 4]** - AFTER detectChanges: visualPhotos count, expandedPhotos state
5. **[HUD DEBUG 5]** - LIVEQUERY FIRED: images count, entityIds, isCameraCaptureInProgress, lastConvertedFields.length
6. **[HUD DEBUG 5b]** - LIVEQUERY SUPPRESSED (if camera in progress)
7. **[HUD DEBUG 6]** - Calling populatePhotosFromDexie with field count
8. **[HUD DEBUG 6b]** - SKIPPING populatePhotosFromDexie (if no lastConvertedFields)
9. **[HUD DEBUG 7]** - populatePhotosFromDexie START: fields.length, first 3 fields with visualId/tempVisualId
10. **[HUD DEBUG 8]** - LocalImages Query: total images, unique entityIds, first 5 entityIds
11. **[HUD DEBUG INIT]** - lastConvertedFields BUILT on page load
12. **[HUD DEBUG SAVE_VISUAL]** - lastConvertedFields UPDATED when visual created

**These alerts will reveal:**
- Whether mobile mode is being triggered (vs WEBAPP mode)
- What entityId LocalImages are being stored with
- Whether liveQuery is finding images
- Whether lastConvertedFields has the correct visualIds for matching
- Whether photos are being added to visualPhotos array

**Initial Debug Results:**
- Camera shows debug alerts, works initially, breaks after sync/reload
- Gallery shows NO debug alerts (may be going to WEBAPP path)
- On reload: `lastConvertedFields BUILT count:18, First 3: tid=630 vid=124 tvid=null`

**Additional Debug Alerts Added:**

**Gallery Path:**
- **[HUD DEBUG GALLERY 0]** - Gallery entry point: shows `environment.isWeb` value (CRITICAL - may explain why gallery doesn't hit mobile path)
- **[HUD DEBUG GALLERY 1]** - Gallery MOBILE mode start

**Photo Matching on Reload:**
- **[HUD DEBUG 9]** - NO IMAGES found for field (shows visualId lookup attempts)
- **[HUD DEBUG 10]** - FOUND IMAGES for field (shows imageId, entityId, localBlobId)
- **[HUD DEBUG 11]** - displayUrl generated (shows type: BLOB, DATA, PLACEHOLDER, or OTHER)
- **[HUD DEBUG 12]** - NEW PHOTO ADDED to visualPhotos
- **[HUD DEBUG 13]** - populatePhotosFromDexie COMPLETE summary

**What to look for:**
1. **Gallery not working:** Check if `[HUD DEBUG GALLERY 0]` shows `environment.isWeb: true` - this would explain why mobile path is skipped
2. **Photos break on reload:** Check `[HUD DEBUG 10]` - if `localBlobId: null`, the blob was purged after sync
3. **Placeholder images:** Check `[HUD DEBUG 11]` - if `displayUrl type: PLACEHOLDER`, the blob lookup failed

**Result:** FAILED - Same issues persist. Gallery shows no images, camera shows image then breaks after sync.

## Attempt 5: Complete EFE mobile image lifecycle replication and entity type filter

**Analysis Findings:**

After thorough comparison of EFE and HUD mobile image handling:

1. **Entity Type Filter Missing**: HUD's `populatePhotosFromDexie` called `getImagesForService(serviceId)` WITHOUT the 'hud' entity type filter. This could cause issues if multiple entity types exist for the same service.

2. **Photo Lifecycle Differences**:
   - EFE uses 'visual' entity type
   - HUD uses 'hud' entity type (correct)
   - Both liveQuery subscriptions correctly filter by their entity type
   - Both use the same displayUrl preservation logic in sync handlers

3. **Blob URL Management**:
   - After sync, `softPurgeImage` may delete full-res blob but generates thumbnail first
   - `getDisplayUrl` falls back to: thumbBlobId → cached annotated → cached base64 → S3 URL
   - If ALL fallbacks fail, placeholder is returned

4. **Potential Root Causes**:
   - Thumbnail generation might be failing silently
   - Soft purge might run before UI can display the image
   - The cachedPhotos pointer system requires blob to exist (if blob deleted, pointer fails)

**Changes Made:**

**File: `hud-category-detail.page.ts`**

1. **Added 'hud' entity type filter to `populatePhotosFromDexie`** (line 1418):
   ```typescript
   // BEFORE:
   const allLocalImages = await this.localImageService.getImagesForService(this.serviceId);

   // AFTER:
   const allLocalImages = await this.localImageService.getImagesForService(this.serviceId, 'hud');
   ```

2. **Enhanced DEBUG 10 alert** to show full LocalImage details:
   - status (local_only, uploading, uploaded, verified)
   - localBlobId (if NULL, blob was purged)
   - thumbBlobId (thumbnail fallback)
   - attachId (for cached photo lookup)
   - remoteS3Key (for S3 URL fallback)

3. **Enhanced DEBUG 11 alert** to show getDisplayUrl result with URL type analysis:
   - BLOB (local) = good, using local blob
   - DATA (cached) = good, using cached base64
   - S3 URL = using remote, may be slow
   - PLACEHOLDER (BROKEN!) = all fallbacks failed

4. **Added DEBUG 11b alert** when placeholder is returned (indicates broken image)

5. **Enhanced DEBUG 12 alert** for new photos added

6. **Added outer try-catch and console.log to gallery method** to catch any errors before the alert

**What to Look For When Testing:**

1. **DEBUG 10** - If `localBlobId: NULL!` after sync, the blob was purged too soon
2. **DEBUG 11** - If `URL TYPE: PLACEHOLDER (BROKEN!)`, trace which fields are NULL:
   - `localBlobId: NULL` + `thumbBlobId: NULL` = no local fallback
   - `attachId: NULL` = can't use cached photo
   - `remoteS3Key: NULL` = can't use S3 URL
3. **DEBUG 11b** - If this appears, existing photo preserved its old displayUrl (may be stale)
4. **Gallery alerts** - If `[HUD GALLERY]` console.log appears but no alert, there's an error

**Result:** FAILED - Camera shows LocalImage CREATED debug, but gallery shows no debugs. Images still show as broken links.

## Attempt 6: Add missing debug alerts to gallery mobile path + path indicators

**Analysis:**

The camera mobile path has DEBUG 1 and DEBUG 2 alerts, but the gallery mobile path was MISSING the equivalent "LocalImage CREATED" debug alert. The gallery only had console.log statements, no alerts.

More importantly, we need to determine if gallery is going to WEBAPP path instead of MOBILE path.

**Changes Made:**

**File: `hud-category-detail.page.ts`**

1. **Added WEBAPP path indicator to Gallery** (line ~6103):
   ```typescript
   alert(`[HUD DEBUG GALLERY WEBAPP] environment.isWeb = TRUE\nGoing to WEBAPP path...`);
   ```

2. **Added "LocalImage CREATED" debug to Gallery mobile path** (line ~6293):
   ```typescript
   alert(`[HUD DEBUG GALLERY 2] LocalImage CREATED\nimageId: ${localImage.imageId}\nentityType:...`);
   ```

3. **Added WEBAPP path indicator to Camera** (line ~5746):
   ```typescript
   alert(`[HUD DEBUG CAMERA WEBAPP] environment.isWeb = TRUE\nGoing to WEBAPP path...`);
   ```

**What to Look For When Testing:**

1. **If you see `[HUD DEBUG GALLERY WEBAPP]`** → Gallery is incorrectly going to WEBAPP path
   - This means `environment.isWeb` is TRUE on mobile, which is wrong
   - Camera must also be going to WEBAPP path (but you said it shows LocalImage CREATED)

2. **If you see `[HUD DEBUG GALLERY 0]` then `[HUD DEBUG GALLERY 1]` then `[HUD DEBUG GALLERY 2]`** → Gallery is correctly going to MOBILE path
   - LocalImage should be created
   - Photo should appear immediately

3. **If you see NO alerts at all from gallery** → The method isn't being called or crashing before any alerts

**Result:** FAILED - Camera shows LocalImage CREATED debug, but gallery shows no debugs. All images show as broken links after sync.

## Attempt 7: Add sync completion debug alert

**Analysis:**

User confirmed:
1. Camera capture creates LocalImage correctly (entityType: hud, localBlobId exists)
2. Gallery upload shows NO debug alerts (possibly going to WEBAPP path?)
3. ALL images show as broken links - even camera photos break after sync

The issue is specifically **after sync** - photos work initially but break when sync completes.

**Changes Made:**

1. **Added WEBAPP path indicator alerts** to both camera and gallery:
   - `[HUD DEBUG CAMERA WEBAPP]` - if camera goes to WEBAPP path
   - `[HUD DEBUG GALLERY WEBAPP]` - if gallery goes to WEBAPP path (would explain no mobile debugs)

2. **Added "LocalImage CREATED" debug to gallery mobile path** (line ~6293):
   - `[HUD DEBUG GALLERY 2]` - matching camera's DEBUG 2

3. **Added sync completion debug alert** (line ~1850):
   - `[HUD DEBUG SYNC COMPLETE]` - shows displayUrl value right after sync handler updates photo
   - This will show if displayUrl is preserved or broken during sync

**What to Look For When Testing:**

1. **Gallery Path:** If you see `[HUD DEBUG GALLERY WEBAPP]`, gallery is incorrectly going to WEBAPP mode
2. **Sync Handler:** After sync, `[HUD DEBUG SYNC COMPLETE]` should show:
   - `displayUrl: blob:...` = GOOD, local blob preserved
   - `displayUrl: assets/img/photo-placeholder.png` = BAD, displayUrl was lost
   - `displayUrl: undefined` = VERY BAD, photo was lost entirely

**Result:** FAILED - No debug after sync fires. Camera photos show immediately but break on reload (before sync). Gallery shows no debug alerts at all.

## Attempt 8: Comprehensive mobile photo lifecycle fix

**Analysis Findings:**

Based on thorough code review:

1. **Gallery Issue**: The `addPhotoFromGallery` method has debug alerts but user sees NONE. Either:
   - Method isn't being called
   - Crashing before first alert
   - `environment.isWeb` is true (going to WEBAPP path that doesn't create LocalImage)

2. **Reload Issue**: Camera photos work initially but break on reload BEFORE sync:
   - LocalImage is created with `localBlobId` pointing to blob in `db.localBlobs`
   - On reload, `populatePhotosFromDexie` finds LocalImage
   - `getDisplayUrl` returns placeholder - meaning blob lookup fails
   - This happens BEFORE sync, so NOT related to soft purge

3. **Root Cause Hypothesis**:
   - The blob data may not be persisting correctly in IndexedDB
   - OR the blob lookup is using wrong key
   - OR there's a timing issue with Dexie transactions

**Changes Made:**

**File 1: `indexed-db.service.ts` - Add blob verification method (line ~3032)**

Added `verifyBlobExists()` method that checks if a blob actually exists in IndexedDB:
```typescript
async verifyBlobExists(blobId: string): Promise<{exists: boolean, sizeBytes: number, hasData: boolean}> {
  const blob = await db.localBlobs.get(blobId);
  const hasData = !!(blob && blob.data && blob.data.byteLength > 0);
  return { exists: !!blob, sizeBytes: blob?.sizeBytes || 0, hasData };
}
```

**File 2: `local-image.service.ts` - Enhanced getDisplayUrl with blob verification (line ~169)**

Added blob verification BEFORE attempting to get blob URL in Rule 1:
```typescript
if (image.localBlobId) {
  // ATTEMPT 8: Verify blob exists before trying to get URL
  const blobCheck = await this.indexedDb.verifyBlobExists(image.localBlobId);
  if (!blobCheck.hasData) {
    console.error('[LocalImage] ATTEMPT 8: BLOB MISSING in IndexedDB!', ...);
  }
  // ... rest of blob URL logic
}
```

**File 3: `hud-category-detail.page.ts` - Gallery ultra-early debug (line ~6059)**

Added ultra-early alert at FIRST line of `addPhotoFromGallery`:
```typescript
async addPhotoFromGallery(category: string, itemId: string | number) {
  alert(`[HUD GALLERY ULTRA-EARLY] Method invoked!\ncat: ${category}\nitem: ${itemId}`);
  // ... rest of method
}
```

**File 4: `hud-category-detail.page.ts` - Blob verification in populatePhotosFromDexie (line ~1520)**

Added blob check for each LocalImage before processing:
```typescript
if (localImage.localBlobId) {
  const blobCheck = await this.indexedDb.verifyBlobExists(localImage.localBlobId);
  if (!blobCheck.hasData) {
    alert(`[HUD DEBUG BLOB MISSING]\nimageId: ${imageId}\nblobId: ${localImage.localBlobId}...`);
  }
} else {
  alert(`[HUD DEBUG NO BLOBID]\nimageId: ${imageId}\nlocalBlobId is NULL!`);
}
```

**File 5: `hud-category-detail.page.ts` - Camera capture blob verification (line ~5900)**

Enhanced DEBUG 2 alert to include blob verification immediately after captureImage:
```typescript
const blobCheck = await this.indexedDb.verifyBlobExists(localImage.localBlobId);
alert(`[HUD DEBUG 2] LocalImage CREATED\n...BLOB CHECK:\nexists: ${blobCheck.exists}\nhasData: ${blobCheck.hasData}`);
```

**File 6: `hud-category-detail.page.ts` - Gallery mobile blob verification (line ~6318)**

Enhanced GALLERY 2 alert with same blob verification:
```typescript
const galleryBlobCheck = await this.indexedDb.verifyBlobExists(localImage.localBlobId);
alert(`[HUD DEBUG GALLERY 2] LocalImage CREATED\n...BLOB CHECK:\nexists: ${galleryBlobCheck.exists}...`);
```

**What to Look For When Testing:**

1. **Gallery**:
   - If `[HUD GALLERY ULTRA-EARLY]` shows → Method IS being called, continue investigating
   - If it doesn't show → Method isn't being invoked (check template binding, button click handler)
   - If `[HUD DEBUG GALLERY WEBAPP]` shows → `environment.isWeb` is TRUE on mobile (build config issue)

2. **Camera Capture**:
   - `[HUD DEBUG 2]` should show `BLOB CHECK: exists=true, hasData=true, size=XXX`
   - If `hasData=false` → Blob failed to save to IndexedDB

3. **Reload (CRITICAL)**:
   - `[HUD DEBUG BLOB MISSING]` → Blob data NOT persisting in IndexedDB across page reload
   - `[HUD DEBUG NO BLOBID]` → LocalImage record has NULL localBlobId
   - `[HUD DEBUG 11] URL TYPE: PLACEHOLDER` → All fallbacks failed, photo will be broken

4. **Console logs**: Check for `[LocalImage] ATTEMPT 8: BLOB MISSING` errors which show exactly which fallback is failing

**Result:** FAILED - Debug alerts confirmed blob data exists, but photos still showing broken.

## Attempt 9: Fix root causes found during debugging

**Analysis Findings:**

After extensive debugging with alerts, identified THREE root causes:

### Root Cause 1: Gallery `batchUploadImageIds` Bug
In `addPhotoFromGallery`, the `batchUploadImageIds.add(localImage.imageId)` was called BEFORE the duplicate check:
```typescript
// Line 6329 - WRONG: adds to tracking BEFORE the check
this.batchUploadImageIds.add(localImage.imageId);
// ...
// Line 6378 - Check fails because ID is already in set
const alreadyTracked = this.batchUploadImageIds.has(localImage.imageId);  // TRUE!
if (existingIndex === -1 && !alreadyTracked) {  // Never enters - photo never added!
```

**Fix:** Removed the premature add. The add now only happens INSIDE the if block after the check passes.

### Root Cause 2: `loadPhotosFromDexie` Using Blob IDs as URLs
The `loadPhotosFromDexie()` method was setting `displayUrl` to blob IDs (like `blob_abc123`) instead of proper blob URLs:
```typescript
// WRONG - using blob IDs directly as URLs
displayUrl: p.thumbBlobId || p.localBlobId || p.remoteS3Key
```

**Fix:** Changed to properly call `localImageService.getDisplayUrl(localImage)` which:
1. Retrieves the blob from IndexedDB by blobId
2. Creates a Blob object
3. Creates a proper blob URL using `URL.createObjectURL()`

### Root Cause 3: VisualFields Not Restored on Reload
On page reload, `visualRecordIds` was only populated from server data. For unsynced photos, the temp_visual_xxx ID wasn't restored, causing `populatePhotosFromDexie` to fail matching.

**Fix:** Added code to load VisualFields from Dexie before building `lastConvertedFields`, restoring the `tempVisualId` for unsynced photos.

### Root Cause 4: Debug Alerts Blocking Execution
The 20+ `alert()` calls were blocking JavaScript execution and disrupting async flows.

**Fix:** Removed all debug alerts and unnecessary blob verification code.

**Changes Made:**

**File: `hud-category-detail.page.ts`**
1. Fixed `batchUploadImageIds` bug - moved add() inside the if block
2. Fixed `loadPhotosFromDexie()` to use `getDisplayUrl()` for proper blob URLs
3. Added VisualField restoration from Dexie before building lastConvertedFields
4. Removed all debug alerts
5. Removed ATTEMPT 8 blob verification code

**File: `local-image.service.ts`**
- Removed ATTEMPT 8 blob verification in getDisplayUrl

**File: `indexed-db.service.ts`**
- Removed `verifyBlobExists()` method

**Result:** SUCCESS ✓ - Gallery and camera photos now:
1. Appear immediately after capture/selection
2. Persist through page reloads (before and after sync)
3. Continue displaying correctly after sync completes

---

# Issue: HUD Visual Detail - Title/Description Loading Blank on Mobile

## Status: RESOLVED ✓

## Problem Description
On the HUD mobile app, when navigating to the visual detail page, the Title and Description fields load blank instead of showing the values from the selected visual.

## Environment
- **Platform:** Mobile app (iOS/Android)
- **Page:** HUD Visual Detail (`/hud/:projectId/:serviceId/category/hud/visual/:templateId`)
- **Mode:** Mobile (Dexie-first)

## Expected Behavior
1. User taps "Details" on a visual item in category-detail
2. Visual detail page opens
3. Title field shows the visual's name (user-edited or template default)
4. Description field shows the visual's text (user-edited or template default)

## Actual Behavior
1. User taps "Details" on a visual item in category-detail
2. Visual detail page opens
3. Title field is BLANK
4. Description field is BLANK

## Root Cause Analysis
In mobile mode, `loadVisualData()` loads from:
1. `db.visualFields` → uses `field.templateName` and `field.templateText`
2. Falls back to `cachedTemplates` → uses `template.Name` and `template.Text`

The problem is that `visualFields` stores TEMPLATE data, not user's edited values. When a user edits the title/description in category-detail, those edits are stored in the HUD record (cached 'hud' data via `hudData.getHudByService()`), not in visualFields.

In WEBAPP mode, the code correctly loads HUD records and uses `visual.Name` and `visual.Text`.

## Attempt 1: Load from cached HUD records in mobile mode

**Hypothesis:** Mobile mode should load from cached HUD records (like category-detail does) to get user's edited Title/Description, then fall back to template values if no HUD record exists.

**Changes to `hud-visual-detail.page.ts` `loadVisualData()` MOBILE MODE:**

1. Load cached HUD records via `hudData.getHudByService()`
2. Find matching HUD record by HUDID (from query params) or Name+Category
3. If found: use `visual.Name` and `visual.Text` (contains user edits)
4. If not found: fall back to template values (current behavior)

**Result:** PARTIAL - Title loads from HUD records but not from local Dexie edits.

---

## Attempt 2: Load from Dexie visualFields as PRIORITY 1

**Problem Found:** Attempt 1 loaded from cached HUD records, but when user edits title via `saveTitle()`, it's saved to `visualFieldRepo.setField()` which updates `db.visualFields` - NOT the HUD records cache. So subsequent loads don't see the edited title.

**Changes to `hud-visual-detail.page.ts` `loadVisualData()` MOBILE MODE:**

1. Load visualField from Dexie FIRST (before HUD records):
```typescript
const visualField = await db.visualFields
  .where('[serviceId+templateId]')
  .equals([this.serviceId, this.templateId])
  .first();
```

2. Added PRIORITY 2 lookup using visualField's visualId:
```typescript
if (!visual && visualField) {
  const dexieVisualId = visualField.visualId || visualField.tempVisualId;
  if (dexieVisualId) {
    visual = hudRecords.find((v: any) =>
      String(v.HUDID || v.PK_ID) === String(dexieVisualId)
    );
  }
}
```

3. Changed title/text assignment to use visualField as PRIORITY 1:
```typescript
// DEXIE-FIRST: visualField values take priority (local edits)
const titleValue = visualField?.templateName || visual.Name || template?.Name || '';
const textValue = visualField?.templateText || visual.Text || template?.Text || '';
```

4. Updated fallback case to handle visualField without HUD record:
```typescript
} else if (visualField || template) {
  // No HUD record - use visualField (local edits) or template
  const titleValue = visualField?.templateName || template?.Name || '';
```

**Result:** FAILED - Compound index query `where('[serviceId+templateId]')` caused "Error Loading Visual Data". Dexie may not have this compound index defined.

---

## Attempt 3: Fix query syntax - use filter instead of compound index

**Problem:** Attempt 2 used `db.visualFields.where('[serviceId+templateId]').equals([...])` which requires a compound index that may not exist in the Dexie schema.

**Fix:** Use simple query with filter instead of compound index.

**Result:** PARTIAL - Query works but title still shows "Custom Item" instead of template name.

---

## Attempt 4: Skip "Custom Item" fallback value in title lookup

**Problem Found:** The HUD record has Name = "Custom Item" (a fallback value from category-detail). The title lookup chain was using this value instead of falling back to the template name.

**Fix:** Modified title lookup to skip "Custom Item" and use template name instead:
```typescript
// IMPORTANT: Skip "Custom Item" fallback value - use template name instead
const visualName = (visual.Name && visual.Name !== 'Custom Item') ? visual.Name : '';
const titleValue = visualField?.templateName || visualName || template?.Name || '';
```

**Result:** FAILED - Still showing "Custom Item"

---

## Attempt 5: Match EFE mobile mode pattern exactly

**Analysis:** Reviewed EFE visual-detail.page.ts and found it uses a much simpler approach:
1. Load from `db.visualFields` first → use `field.templateName`
2. Fallback to cached templates → use `template.Name`
3. Does NOT try to load from visual/HUD records at all

**Changes:** Rewrote HUD mobile mode to match EFE exactly:
```typescript
// MOBILE MODE: Match EFE pattern exactly
const allFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

const field = allFields.find(f => f.templateId === this.templateId);

if (field) {
  // Found field in Dexie - use convertFieldToItem (which uses field.templateName)
  this.item = this.convertFieldToItem(field);
  this.editableTitle = this.item.name;
} else {
  // FALLBACK: Load from cached templates
  const template = cachedTemplates.find(...);
  if (template) {
    this.item = { name: template.Name, ... };
    this.editableTitle = this.item.name;
  }
}
```

**Root Cause Found:** The visualField was being created with only `tempVisualId`, but NOT `templateName`. EFE works because when items are selected, `templateName` is stored in the visualField. HUD was missing this.

**Additional Fix in `hud-category-detail.page.ts`:**

Updated all places where visuals are created to also store `templateName` and `templateText`:

1. `saveVisualSelection()` (line ~6774)
2. `onOptionChange()` (line ~5218)
3. `onOtherInputChange()` (line ~5309)
4. `addOtherToList()` (line ~5438)

```typescript
await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
  tempVisualId: visualId,
  templateName: item.name || '',  // NEW: Store template name
  templateText: item.text || item.originalText || '',  // NEW: Store template text
  category: item.category || category,
  kind: item.type || 'Comment',
  isSelected: true
});
```

**Result:** FAILED - Title still showing "Custom Item". The visualField may not have templateName populated for existing items.

---

## Attempt 6: Handle empty templateName in existing visualFields

**Root Cause Found:**
- EFE uses `seedFromTemplates()` which pre-populates visualFields with `templateName: template.Name`
- HUD doesn't seed visualFields this way
- When a visualField exists (item was selected before our fix) but `templateName` is empty, the code was using the field with empty name instead of falling back to template

**Fix Applied to `hud-visual-detail.page.ts`:**

Now handles 3 cases:
1. `field` exists AND `field.templateName` has value → use field directly
2. `field` exists BUT `templateName` is empty → merge field data with `template.Name`
3. No `field` exists → use template directly

```typescript
// ALWAYS load cached templates - needed for fallback when field.templateName is empty
const cachedTemplates = await this.indexedDb.getCachedTemplates('hud') || [];
const template = cachedTemplates.find(...);

if (field && field.templateName) {
  // Use field directly
  this.item = this.convertFieldToItem(field);
} else if (field && template) {
  // Field exists but templateName empty - merge with template.Name
  this.item = {
    name: template.Name || '',  // Use template name
    text: field.templateText || template.Text || '',
    // ... other field data
  };
} else if (template) {
  // No field - use template
  this.item = { name: template.Name, ... };
}
```

**Result:** PARTIAL - Title loads correctly but editing title causes visual deselection.

---

## Attempt 7: Fix categoryName mismatch in saveTitle

**Problem Found:** When `saveTitle()` is called, it uses:
```typescript
const actualCategory = this.item?.category || this.categoryName;
```

But `this.categoryName` was NOT being updated to the actual category (e.g., "Mobile/Manufactured Homes") - it still had the route param value ("hud"). This caused `setField` to build a WRONG key and create a NEW field instead of updating the existing one.

**Fix:** Update `this.categoryName` to the actual category when loading data in mobile mode:
```typescript
// CRITICAL: Update categoryName to actual category (needed for saveTitle to find correct Dexie field)
this.categoryName = field.category || this.categoryName;
// or
this.categoryName = actualCategory;
```

Added this update in all 3 branches:
1. When loading from field with templateName
2. When merging field + template
3. When loading from template only

**Result:** SUCCESS ✓ - Title now persists and visual stays selected after editing.

---

# Issue: HUD Mobile - Visual Deselected After Title Edit

## Status: RESOLVED ✓

## Problem Description
After editing the Title field on the HUD mobile visual detail page, when the user navigates back to the category-detail page, the visual appears deselected. This is the same issue that was fixed in WEBAPP mode (Attempt 2 above), but now affecting mobile mode.

## Root Cause
Mobile mode uses `loadDataFromCache()` which only matched visuals by Name + Category (or TemplateID). When the Name is edited, the lookup fails.

## Attempt 1: Apply WEBAPP fix to mobile mode

**Changes:** Applied the same Dexie visualFields mapping fix to `loadDataFromCache()`:
1. Load Dexie visualFields before template loop
2. Build templateId -> visualId map
3. Use PRIORITY 1: Dexie mapping, PRIORITY 2: templateId, PRIORITY 3: Name
4. Use `visual?.Name || template.Name` to show edited title

See "Attempt 3" in the "HUD Visual Deselected After Reload When Text is Changed" issue above for full details.

**Result:** SUCCESS ✓ - Visual stays selected and title persists after editing (combined with Attempts 6-7 in Title/Description issue above)

---

# Issue: LBW Category Data Not Loading in Webapp

## Status: RESOLVED ✓

## Problem Description
The data in each category is not loading for the LBW template in the webapp. The LBW category-detail page should work like the HUD category-detail page, but using LBW-specific tables.

## Environment
- **Page URL Example:** `/lbw/:projectId/:serviceId/category/:category`
- **Mode:** Webapp
- **Tables Required:**
  - `LPS_Services_LBW_Template` (templates) - NOT `LPS_Services_LBW_Templates`
  - `LPS_Services_LBW_Drop` (dropdown options)
  - `LPS_Services_LPS` (main service records) - NOT `LPS_Services_LBW`
  - `LPS_Services_LPS_Attach` (attachments) - NOT `LPS_Services_LBW_Attach`
- **ID Field:** `LBWID` (similar to `HUDID` for HUD)

## Expected Behavior
1. User navigates to LBW category (e.g., "Target wall")
2. Templates for that category load from `LPS_Services_LBW_Template`
3. Existing visual records load from `LPS_Services_LPS` table
4. Photos load from `LPS_Services_LPS_Attach` table
5. User can select items, add photos, etc.

## Actual Behavior
1. User navigates to LBW category
2. Categories show but data doesn't load
3. Likely due to incorrect table names in API calls

## Root Cause
The Caspio service is using incorrect table names:
- Using `LPS_Services_LBW_Templates` instead of `LPS_Services_LBW_Template`
- Using `LPS_Services_LBW` instead of `LPS_Services_LPS`
- Using `LPS_Services_LBW_Attach` instead of `LPS_Services_LPS_Attach`

## Files to Modify
- `src/app/services/caspio.service.ts` - Fix table names
- `src/app/pages/lbw/lbw-data.service.ts` - May need updates
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts` - Verify field names

## Attempt 1: Fix table names in caspio.service.ts

**Result:** REVERTED - Table names were correct. The issue was elsewhere.

---

## Attempt 2: Fix route parameter retrieval in lbw-category-detail

**Root Cause Found:** The `lbw-category-detail.page.ts` was using `this.route.parent?.parent?.params` to get projectId/serviceId, but according to the routing module, the container is only 1 level up (direct parent), not 2 levels.

**Route Structure:**
```
Container (path: '') - has projectId, serviceId via parent route
  └── LbwCategoryDetailPage (path: 'category/:category')
```

**Fix Applied to `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`:**

Changed:
```typescript
this.route.parent?.parent?.params.subscribe(parentParams => {
```

To:
```typescript
this.route.parent?.params.subscribe(parentParams => {
```

**Result:** SUCCESS ✓ - Data now loads correctly.

---

## Attempt 3: Add WEBAPP mode for image uploads

**Problem Found:** After data loading was fixed, image uploads in WEBAPP mode were not working. The LBW page only had mobile-first upload code (using IndexedDB and background sync), but no direct S3 upload path for WEBAPP mode like HUD has.

**Changes Made:**

**File 1: `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`**
- Added WEBAPP mode handling to `addPhotoFromCamera()` - uses `uploadImageDirectToS3()` with 'lbw' entity type
- Added WEBAPP mode handling to `addPhotoFromGallery()` - uses `uploadImageDirectToS3()` with 'lbw' entity type
- Added `LocalImageService` import and injection
- Both methods now check `environment.isWeb` and take appropriate code path:
  - WEBAPP: Direct S3 upload (immediate)
  - Mobile: Local-first with background sync
- Added `_pendingFileId: undefined` to uploaded photos to prevent false "pending" detection

**File 2: `src/app/services/local-image.service.ts`**
- Added 'lbw' entity type support to `uploadImageDirectToS3()` method
- Uses `caspioService.createServicesLBWAttachWithFile()` to upload to `LPS_Services_LBW_Attach` table

**Result:** SUCCESS ✓ - Image uploads now work in WEBAPP mode.

---

# Issue: LBW WEBAPP - Photo Placeholder Error on Page Reload

## Status: RESOLVED ✓

## Problem Description
After uploading images in the LBW webapp and reloading the page, photos show a broken image error because the system is trying to load `assets/img/photo-placeholder.png` which doesn't exist or returns a 404 error.

## Environment
- **Page URL Example:** `/lbw/:projectId/:serviceId/category/:category`
- **Mode:** Webapp
- **Error:** `Cannot GET /assets/img/photo-placeholder.png`

## Expected Behavior
1. User uploads photos in LBW category
2. User reloads the page
3. Photos load correctly from S3 URLs stored in the database

## Actual Behavior
1. User uploads photos in LBW category
2. User reloads the page
3. Photos show as broken images
4. Console shows error: `Cannot GET /assets/img/photo-placeholder.png`

## Root Cause
The code across the codebase referenced `photo-placeholder.png` but the actual asset file is `photo-placeholder.svg`. The placeholder image path was incorrect in 25+ files.

## Solution
Updated all references from `photo-placeholder.png` to `photo-placeholder.svg` across 25 source files:
- LBW pages (category-detail, main)
- HUD pages (category-detail, visual-detail, container, template)
- EFE pages (engineers-foundation, structural-systems, room-elevation)
- DTE pages (main, category-detail)
- Services (local-image.service.ts)
- Directives (lazy-image.directive.ts)

**Files Modified:** 25 files with placeholder references corrected

**Result:** SUCCESS ✓ - Photos now display correctly after page reload

---

# Issue: LBW WEBAPP - Photos Not Loading After Page Reload

## Status: RESOLVED ✓

## Problem Description
After uploading images in the LBW webapp and reloading the page, photos still show as placeholder images instead of the actual uploaded photos. The placeholder path fix (`.png` → `.svg`) was applied but photos still don't load from S3.

## Environment
- **Page URL Example:** `/lbw/:projectId/:serviceId/category/:category`
- **Mode:** Webapp
- **Issue:** Photos show placeholder instead of S3 images after reload

## Expected Behavior
1. User uploads photos in LBW category
2. User reloads the page
3. Photos load correctly from S3 URLs stored in the database

## Actual Behavior
1. User uploads photos in LBW category
2. User reloads the page
3. Photos show as placeholder images (not the actual uploaded photos)

## Root Cause Analysis
Two potential issues identified:

1. **S3 Key Detection**: The `preloadAndTransition` method had two code paths - one for S3 and one for legacy. If the S3 key didn't start with 'uploads/', it would try the legacy path which calls `hudData.getImage()` instead of `getS3FileUrl()`.

2. **Field Name Mismatch**: The attachment records from the API might use different field names than expected (e.g., `attachment` vs `Attachment`).

## Attempt 1: Fix S3 URL loading and field name detection

**Changes to `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`:**

1. **Updated `preloadAndTransition`** to always use `getS3FileUrl()` regardless of `isS3` flag (matching HUD's approach):
```typescript
// All LBW photos should be S3 now - always use getS3FileUrl
if (imageKey) {
  const s3Url = await this.caspioService.getS3FileUrl(imageKey);
  const preloaded = await this.preloadImage(s3Url);
  if (!preloaded) throw new Error('Preload failed');
  imageDataUrl = await this.fetchAsDataUrl(s3Url);
} else {
  throw new Error('No image key provided');
}
```

2. **Updated `loadSinglePhoto`** to try multiple possible field names for the S3 key:
```typescript
// Try multiple possible field names for S3 key (Caspio may use different casing)
const s3Key = attach.Attachment || attach.attachment || attach.S3Key || attach.s3Key || attach.Photo || attach.photo || '';
```

3. **Added detailed logging** to debug what attachment fields are being received:
```typescript
console.log('[LOAD PHOTO] Attachment record fields:', Object.keys(attach).join(', '));
```

**Result:** PARTIAL - S3 URL loading fixed but photos still disappear on page re-entry

## Attempt 2: Add dedicated WEBAPP photo loading method

**Root Cause Found:** When the user navigates away and back to the LBW page, the photos disappear because:

1. LBW's `ionViewWillEnter` only set `this.loading = false` - it didn't reload photos
2. LBW used async `preloadAndTransition` (background loading) instead of synchronous photo loading
3. When returning to the page, `visualPhotos` might be empty if the component was destroyed

**Comparison with EFE:**
- EFE has a dedicated `loadPhotosFromAPI()` method for WEBAPP mode that:
  - Gets all selected visual IDs
  - Fetches attachments from API synchronously
  - Gets signed S3 URLs for each attachment (awaited)
  - Stores photos directly in `visualPhotos`
- EFE's `ionViewWillEnter` has smart reload logic for page re-entry

**Fix Applied to `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`:**

1. **Added `loadPhotosFromAPI()` method** (mirrors EFE's implementation):
```typescript
private async loadPhotosFromAPI(): Promise<void> {
  for (const [key, lbwId] of Object.entries(this.visualRecordIds)) {
    const attachments = await this.hudData.getVisualAttachments(lbwId);
    const photos: any[] = [];
    for (const att of attachments || []) {
      const rawPhotoValue = att.Attachment || att.attachment || att.Photo || ...;
      let displayUrl = rawPhotoValue || 'assets/img/photo-placeholder.svg';
      if (displayUrl.startsWith('uploads/')) {
        displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
      }
      photos.push({ id, displayUrl, url, ... });
    }
    this.visualPhotos[key] = photos;
    this.photoCountsByKey[key] = photos.length;
  }
}
```

2. **Updated `loadExistingVisuals()`** to use batch photo loading for WEBAPP:
```typescript
// MOBILE MODE: Load photos individually
if (!environment.isWeb) {
  await this.loadPhotosForVisual(LBWID, key);
}
// After loop - WEBAPP MODE: Load all photos in batch
if (environment.isWeb) {
  await this.loadPhotosFromAPI();
}
```

3. **Updated `ionViewWillEnter()`** to reload photos on page return:
```typescript
async ionViewWillEnter() {
  if (environment.isWeb && this.serviceId && this.categoryName) {
    if (Object.keys(this.visualRecordIds).length > 0) {
      await this.loadPhotosFromAPI();
    }
  }
}
```

**Result:** SUCCESS ✓ - Photos now persist when navigating away and back

---

# Issue: HUD Mobile - Multi-Select Options Not Persisting in UI

## Status: RESOLVED ✓

## Problem Description
In the HUD mobile app, multi-select (answerType === 2) options are not persisting in the UI. The selection is saved on the backend correctly, but when navigating out and back into the section, the selected options appear unchecked.

## Environment
- **Page URL Example:** `/hud/:projectId/:serviceId/category/hud`
- **Mode:** Mobile App
- **Affected:** Multi-select question types (answerType === 2)

## Root Cause
HUD's `loadDataFromCache()` was loading `answer` from `visual?.Answers` (cached HUD records from server), but multi-select changes made on mobile are saved to Dexie via `visualFieldRepo.setField()`. The cached HUD record doesn't get updated until sync happens, so on page reload, the local Dexie changes were ignored.

**EFE Comparison:** EFE uses `answer: field.answer` directly from Dexie fields in `convertFieldsToOrganizedData()`, which preserves local changes.

## Attempt 1: Merge Dexie field data into items

**Changes to `hud-category-detail.page.ts` `loadDataFromCache()`:**

The existing code only used Dexie fields to restore `visualRecordIds`. Updated to also merge:
- `answer` - multi-select selections (Dexie takes precedence over cached HUD record)
- `otherValue` - "Other" input value
- `isSelected` - selection state
- `dropdownOptions` - custom options added via "Other"

```typescript
// Build a map for quick lookup by templateId
const dexieFieldMap = new Map<number, any>();
for (const field of savedFields) {
  dexieFieldMap.set(field.templateId, field);
}

// Merge Dexie field data into items
for (const section of [organizedData.comments, organizedData.limitations, organizedData.deficiencies]) {
  for (const item of section) {
    const dexieField = dexieFieldMap.get(item.templateId);
    if (dexieField) {
      // MULTI-SELECT FIX: Restore answer from Dexie if it has local changes
      if (dexieField.answer !== undefined && dexieField.answer !== null && dexieField.answer !== '') {
        item.answer = dexieField.answer;
      }
      // Also restore otherValue, isSelected, dropdownOptions
    }
  }
}
```

**Result:** PARTIAL SUCCESS - Multi-select options persist on initial load. However, when returning to the page (after navigating away), only some options appear selected.

## Attempt 2: Add Dexie merge to loadData()

**Problem:** User reported that "when I select multiple options they are not showing in the UI seemingly random. They are showing up in the backend properly but not in the UI only one is showing."

**Root Cause Discovered:**
- `loadDataFromCache()` (called on initial page load via `initializeVisualFields()`) DOES merge Dexie fields ✓
- `loadData()` (called on subsequent visits via `ionViewWillEnter()`) does NOT merge Dexie fields ✗

The page has two load paths:
1. **Initial load:** `ngOnInit` → `initializeVisualFields()` → `loadDataFromCache()` → Dexie merge happens ✓
2. **Return visit:** `ionViewWillEnter()` → `loadData()` → `loadExistingVisualsFromCache()` → NO Dexie merge ✗

`loadExistingVisualsFromCache()` only reads `item.answer` from `visual.Answers` (cached HUD records), not from Dexie. So multi-select changes saved to Dexie were lost on return visits.

**Fix Applied:**
Added Dexie merge code to `loadData()` after `loadExistingVisualsFromCache()`:

```typescript
// ===== STEP 2.5: MULTI-SELECT FIX - Merge Dexie fields for local changes =====
try {
  const savedFields = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, this.categoryName);
  if (savedFields.length > 0) {
    const dexieFieldMap = new Map<number, any>();
    for (const field of savedFields) {
      dexieFieldMap.set(field.templateId, field);
    }
    for (const section of [this.organizedData.comments, this.organizedData.limitations, this.organizedData.deficiencies]) {
      for (const item of section) {
        const dexieField = dexieFieldMap.get(item.templateId);
        if (dexieField && dexieField.answer) {
          item.answer = dexieField.answer;
          // Also restore otherValue, isSelected, dropdownOptions
        }
      }
    }
  }
}
```

**Result:** FAILED - Multiple HUD records were being created for the same visual (see screenshot: HUDID 150, 151, 152 all for "Photo(s) of wheels and tongue"). The issue is a key mismatch.

## Attempt 3: Fix Key Mismatch in Multi-Select Methods

**Problem:** User reported multiple HUD records being created for the same visual. Instead of updating existing records, new records were created for each option toggle.

**Root Cause Discovered (KEY MISMATCH):**
The `visualRecordIds` map uses keys with `item.templateId`, but the multi-select methods were using `item.id`:

| Location | Key Format | Example |
|----------|-----------|---------|
| `visualRecordIds` storage | `${category}_${item.templateId}` | `Mobile/Manufactured Homes_630` |
| `onOptionToggle` lookup | `${category}_${item.id}` | `Mobile/Manufactured Homes_150` |

When `item.id` (HUDID like "150") ≠ `item.templateId` (template ID like "630"), the lookup fails, causing a NEW visual record to be created.

**Additional Issue:** The route param `categoryName` is "hud", but items have actual categories like "Mobile/Manufactured Homes". Dexie fields were stored with the wrong category.

**Fix Applied:**

1. **Fixed `onOptionToggle()`** - Use `item.templateId` and `item.category`:
```typescript
const actualCategory = item.category || category;
const key = `${actualCategory}_${item.templateId}`;
```

2. **Fixed `onMultiSelectOtherChange()`** - Same key fix

3. **Fixed `addMultiSelectOther()`** - Same key fix

4. **Fixed Dexie merge queries** - Query by each item's actual category instead of route param:
```typescript
// Collect unique categories from items
const uniqueCategories = new Set<string>();
for (const item of allItems) {
  if (item.category) uniqueCategories.add(item.category);
}

// Query Dexie for each category
for (const cat of uniqueCategories) {
  const fieldsForCat = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, cat);
  // ... merge fields
}
```

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `onOptionToggle()` - use item.templateId and item.category for key
  - `onMultiSelectOtherChange()` - same fix
  - `addMultiSelectOther()` - same fix
  - `loadData()` Step 2.5 - query by item categories, not route param
  - `loadDataFromCache()` - same fix for Dexie query

**Result:** PARTIAL - Multi-select works, but editing title in visual-detail still causes deselection.

## Attempt 4: Fix toggleItemSelection and onAnswerChange key mismatch

**Problem:** User reported that editing a title in visual-detail page causes the visual to become deselected. The HUD record exists on backend but UI shows deselected.

**Root Cause:** Same category mismatch issue as multi-select:
- `toggleItemSelection` was using `category` parameter (route param "hud") for the key
- But Dexie merge queries by item's actual category (e.g., "Mobile/Manufactured Homes")
- So the Dexie field was stored with wrong category, not found on merge

**Additional methods with same issue:**
- `onAnswerChange()` - Yes/No dropdowns
- `isItemSaving()` - saving indicator

**Fix Applied:**

1. **Fixed `toggleItemSelection()`:**
```typescript
const item = this.findItemByTemplateId(templateId);
const actualCategory = item?.category || category;
const key = `${actualCategory}_${itemId}`;
// Store full field data including category
await this.visualFieldRepo.setField(this.serviceId, actualCategory, templateId, {
  isSelected: newState,
  category: actualCategory,  // Store actual category for proper lookup
  templateName: item?.name || '',
  templateText: item?.text || '',
  kind: item?.type || 'Comment'
});
```

2. **Fixed `onAnswerChange()`:**
```typescript
const actualCategory = item.category || category;
const key = `${actualCategory}_${item.templateId}`;
```

3. **Fixed `isItemSaving()`:** Added fallback to check item's actual category

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`

**Result:** PARTIAL - Visual stays selected, but edited title not showing on main page.

## Attempt 5: Merge templateName and templateText from Dexie

**Problem:** User reported that after editing a title in visual-detail:
- Visual stays selected ✓
- Title shows correctly in visual-detail ✓
- Title NOT updated on category-detail main page ✗

**Root Cause:** The Dexie merge code in both `loadData()` and `loadDataFromCache()` was merging:
- `answer` ✓
- `otherValue` ✓
- `isSelected` ✓
- `dropdownOptions` ✓

But NOT merging:
- `templateName` (title) ✗
- `templateText` (text) ✗

**Fix Applied:**
Added `templateName` and `templateText` merge to both methods:

```typescript
// TITLE/TEXT FIX: Restore edited name and text from Dexie
if (dexieField.templateName && dexieField.templateName !== item.name) {
  item.name = dexieField.templateName;
}
if (dexieField.templateText && dexieField.templateText !== item.text) {
  item.text = dexieField.templateText;
}
```

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `loadData()` Step 2.5 - added templateName/templateText merge
  - `loadDataFromCache()` - added templateName/templateText merge

**Result:** SUCCESS ✓

---

# Issue: HUD Mobile - Custom Visual Not Showing in UI After Adding

## Status: RESOLVED ✓

## Problem Description
When adding a visual using the Add Modal in HUD mobile, the visual is saved to the backend correctly but does not appear in the UI until page reload.

## Root Cause
In `createCustomVisualWithPhotos()`:
- **WEBAPP mode**: Had explicit code to add `customItem` to `organizedData` (lines 8394-8408)
- **MOBILE mode**: Did NOT add to `organizedData` - relied on liveQuery which HUD doesn't use

HUD mobile doesn't use liveQuery for reactive updates like EFE does, so the custom visual was persisted to Dexie but never added to the UI's data structure.

## Fix Applied
Modified `createCustomVisualWithPhotos()` in `hud-category-detail.page.ts`:
- Moved the code that adds `customItem` to `organizedData` OUTSIDE the `if (environment.isWeb)` block
- Now both WEBAPP and MOBILE modes explicitly add the custom item to `organizedData`
- Also added `category` field to the Dexie setField call for proper category lookup

```typescript
// CRITICAL FIX: Add custom item to organizedData for BOTH webapp AND mobile modes
// HUD mobile doesn't use liveQuery like EFE does, so we must explicitly add the item
if (kind === 'Comment') {
  this.organizedData.comments.push(customItem);
} else if (kind === 'Limitation') {
  this.organizedData.limitations.push(customItem);
} else if (kind === 'Deficiency') {
  this.organizedData.deficiencies.push(customItem);
} else {
  this.organizedData.comments.push(customItem);
}
this.changeDetectorRef.detectChanges();
```

**Result:** SUCCESS ✓

---

# Issue: HUD Mobile - Custom Visual Disappears After Navigate Away/Back

## Status: RESOLVED ✓

## Problem Description
When adding a visual via the Add Modal, it shows immediately but disappears when navigating out and back.

## Root Cause
Custom visuals created via Add Modal have negative templateIds (like `-1706486400000`).

**On creation:**
- Key = `${category}_${customTemplateId}` (negative number)
- `visualRecordIds[key] = visualId`
- Item added to `organizedData` ✓

**On reload:**
- `loadCategoryTemplatesFromCache()` only loads template items (positive IDs)
- `loadExistingVisualsFromCache()` creates items with key `${category}_custom_${visualId}`
- KEY MISMATCH! Photos and selection stored under wrong key
- Dexie merge only updates EXISTING items, doesn't add new ones

**Result:** Custom visuals not restored from Dexie on reload.

## Fix Applied
Added code to both `loadData()` and `loadDataFromCache()` to restore custom visuals from Dexie:

```typescript
// CUSTOM VISUAL FIX: Add custom visuals from Dexie that aren't in organizedData
// Custom visuals have negative templateIds (created via Add Modal)
for (const [templateId, dexieField] of dexieFieldMap.entries()) {
  if (templateId < 0 && dexieField.isSelected) {
    const existingItem = allItems.find(item => item.templateId === templateId);
    if (!existingItem) {
      // Create custom item from Dexie field
      const customItem: VisualItem = {
        id: dexieField.tempVisualId || dexieField.visualId || templateId,
        templateId: templateId,
        name: dexieField.templateName || 'Custom Item',
        // ... other fields
      };

      // Add to appropriate section based on kind
      organizedData.comments.push(customItem);

      // Set up tracking with consistent key
      const key = `${dexieField.category}_${templateId}`;
      this.visualRecordIds[key] = visualId;
      this.selectedItems[key] = true;
    }
  }
}
```

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `loadData()` Step 2.5 - added custom visual restoration
  - `loadDataFromCache()` - added custom visual restoration

**Result:** SUCCESS ✓

---

# Issue: LBW WEBAPP - Visual Detail Page Not Opening (Was Alert Dialog)

## Status: RESOLVED ✓

## Problem Description
When clicking the "Details" button on an LBW item in the webapp, it opened an alert dialog popup instead of navigating to a dedicated visual detail page like HUD and EFE.

## Environment
- **Page URL Example:** `/lbw/:projectId/:serviceId/category/:category`
- **Mode:** Webapp
- **Button:** "Details" button on visual items

## Solution Applied
Created a dedicated LBW visual-detail page by copying from HUD and updating all references to use LBW tables and LBWID:

### Files Created
1. **`src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`**
   - Standalone Angular component based on HUD's visual-detail
   - Uses `LbwDataService` instead of `HudDataService`
   - Uses `lbwId` instead of `hudId` for photo attachments
   - WEBAPP mode: Loads photos via API with S3 signed URLs
   - MOBILE mode: Uses Dexie/IndexedDB for offline support
   - Full implementation with photo upload, caption editing, annotations

2. **`src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.html`**
   - Same structure as HUD visual-detail page
   - Title/Description edit sections
   - Photo grid with Camera/Gallery buttons
   - Lazy image loading directive

3. **`src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.scss`**
   - Same styling as HUD visual-detail page
   - Full-screen layout, responsive design

### Files Modified
4. **`src/app/pages/lbw/lbw-routing.module.ts`**
   - Added import for `LbwVisualDetailPage`
   - Updated route structure to include nested visual route:
   ```typescript
   {
     path: 'category/:category',
     children: [
       { path: '', component: LbwCategoryDetailPage },
       { path: 'visual/:templateId', component: LbwVisualDetailPage }
     ]
   }
   ```

5. **`src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`**
   - Changed `openVisualDetail()` to navigate to visual-detail page instead of showing alert
   - Passes `lbwId` in query params for photo lookup:
   ```typescript
   openVisualDetail(category: string, item: any): void {
     const key = `${category}_${item.templateId}`;
     const lbwId = this.visualRecordIds[key] || '';
     this.router.navigate(['visual', item.templateId], {
       relativeTo: this.route.parent,
       queryParams: { lbwId }
     });
   }
   ```

### Navigation Flow (After Fix)
| Feature | LBW (Now) | HUD | EFE |
|---------|-----------|-----|-----|
| Detail View | Dedicated Page ✓ | Dedicated Page | Dedicated Page |
| Photo Management | In visual-detail page ✓ | In visual-detail page | In visual-detail page |
| Navigation | `/visual/:templateId` ✓ | `/visual/:templateId` | `/visual/:templateId` |

---

# Issue: HUD Mobile - Custom Visual Disappears After Page REFRESH

## Status: RESOLVED ✓

## Problem Description
When adding a visual via the Add Modal, it shows immediately and persists when navigating away/back, but disappears when doing a full PAGE REFRESH (browser refresh or app restart).

## Root Cause
Custom visuals created via Add Modal are stored in Dexie with `category = "hud"` (the route param categoryName), NOT with the actual template category like "Mobile/Manufactured Homes".

On page refresh, the Dexie query logic only queried categories that exist in template items:
```typescript
const uniqueCategories = new Set<string>();
for (const item of allItems) {
  if (item.category) {
    uniqueCategories.add(item.category);
  }
}
// "hud" was never added to uniqueCategories!
```

Since templates have actual categories but custom visuals use "hud", the `getFieldsForCategory(serviceId, "hud")` query was never executed, and custom visuals were never restored from Dexie.

## Fix Applied
Added the route param category to the query list in both `loadDataFromCache()` and `loadData()`:

```typescript
// CUSTOM VISUAL FIX: Also query the route param category ("hud")
// Custom visuals created via Add Modal are stored with category=categoryName (route param)
// Without this, custom visuals won't be restored on page refresh
if (this.categoryName) {
  uniqueCategories.add(this.categoryName);
}
```

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `loadDataFromCache()` - added categoryName to uniqueCategories
  - `loadData()` Step 2.5 - added categoryName to uniqueCategories

**Result:** SUCCESS ✓

---

# Issue: HUD Mobile - Custom Visual Photos Not Loading After Page REFRESH

## Status: RESOLVED ✓

## Problem Description
After adding a custom visual via Add Modal, the visual persists after page refresh but the photos associated with it do not appear in the UI. The photos are synced to the backend correctly, they just don't load in the UI.

## Root Cause
When restoring custom visuals from Dexie, the `customItem` object was missing the `key` property. The `loadPhotosFromDexie()` method checks:

```typescript
if (!item.isSelected || !item.key) continue;
```

Since `item.key` was undefined for custom visuals, photo loading was skipped entirely.

## Fix Applied
Moved the key calculation BEFORE creating the customItem, then set `key` on the item:

```typescript
// PHOTO FIX: Calculate key FIRST so it can be set on the item
// Without item.key, loadPhotosFromDexie() skips photo loading
const key = `${dexieField.category}_${templateId}`;
const visualId = dexieField.tempVisualId || dexieField.visualId;

const customItem: VisualItem = {
  // ... other fields ...
  key: key  // CRITICAL: Set key for photo loading to work
};
```

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `loadDataFromCache()` - added key property to customItem
  - `loadData()` Step 2.5 - added key property to customItem

**Result:** SUCCESS ✓

---

# Issue: HUD Mobile - Custom Visual Photos Disappear After Sync

## Status: RESOLVED ✓ (Attempt 6)

## Problem Description
Photos for custom visuals (added via Add Modal) display correctly before sync, but disappear after sync completes. The photos are synced to the backend correctly, they just don't appear in the UI.

## Root Cause
In MOBILE mode, when a custom visual is created via Add Modal:
1. `createVisual()` returns a temp ID (e.g., `temp_hud_1706486400000`)
2. Photos are uploaded with `entityId = temp_hud_xxx`
3. VisualField is saved with `tempVisualId = temp_hud_xxx`

When sync completes:
1. `reloadVisualsAfterSync()` runs
2. LocalImages' `entityId` is updated from `temp_hud_xxx` to the real ID (e.g., `157`)
3. BUT the VisualField update was skipped because `templateId` from backend is null for custom visuals

The code at line 2391 only updated VisualField if `templateId` was truthy:
```typescript
if (templateId) {  // NULL for custom visuals!
  this.visualFieldRepo.setField(...);
}
```

So `lastConvertedFields` still had `tempVisualId = temp_hud_xxx` while LocalImages had `entityId = 157`. The lookup failed and photos didn't appear.

## Fix Applied (Attempt 1 - Partial)
Modified `reloadVisualsAfterSync()` to use `existingItem.templateId` (the negative number) for custom visuals.

**PROBLEM:** Initial fix set `tempVisualId = null` in `lastConvertedFields`, but this broke the US-002 fallback lookup because `updateEntityIdForImages()` runs asynchronously. When liveQuery fires, LocalImages still have `entityId = temp_hud_xxx`, so:
- Lookup by `realId = "157"` → no photos found
- Fallback by `tempId = null` → skipped!
- Photos disappeared!

## Fix Applied (Attempt 2 - Correct)
Keep `tempVisualId` in `lastConvertedFields` for fallback lookup:

```typescript
const effectiveTemplateId = templateId || existingItem.templateId;
if (effectiveTemplateId) {
  const effectiveCategory = existingItem.category || this.categoryName;
  // Persist to Dexie with real visualId (for future page loads)
  this.visualFieldRepo.setField(this.serviceId, effectiveCategory, effectiveTemplateId, {
    visualId: visualId,
    tempVisualId: null  // OK to clear in Dexie for future loads
  });

  // Update lastConvertedFields in-memory - but KEEP tempVisualId for fallback!
  const fieldToUpdate = this.lastConvertedFields.find(f => f.templateId === effectiveTemplateId);
  if (fieldToUpdate) {
    fieldToUpdate.visualId = visualId;
    // DON'T clear tempVisualId - needed for US-002 fallback until LocalImages are updated
    // fieldToUpdate.tempVisualId = null;  // REMOVED - breaks fallback!
  }
}
```

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `reloadVisualsAfterSync()` - use existingItem.templateId for custom visuals
  - Keep tempVisualId in lastConvertedFields for US-002 fallback lookup

**Result:** FAILED - `lastConvertedFields` gets rebuilt via `buildConvertedFieldsFromOrganizedData()` which loses the temp ID

## Fix Applied (Attempt 3 - Correct)
The real issue: `buildConvertedFieldsFromOrganizedData()` loses the temp ID when `visualRecordIds[key]` has the real ID after sync. We need a **reverse lookup** in `tempIdToRealIdCache` to find and preserve the temp ID.

**Root Cause (lines 986-987 before fix):**
```typescript
// After sync, visualRecordIds[key] = "157" (real ID)
visualId: visualId && !String(visualId).startsWith('temp_') ? visualId : null,  // "157"
tempVisualId: visualId && String(visualId).startsWith('temp_') ? visualId : null,  // NULL!
```

**Fix:** In `buildConvertedFieldsFromOrganizedData()`, when `visualRecordIds[key]` has a real ID, perform reverse lookup in `tempIdToRealIdCache` to find and preserve the original temp ID:

```typescript
if (visualId) {
  const visualIdStr = String(visualId);
  if (visualIdStr.startsWith('temp_')) {
    effectiveTempVisualId = visualIdStr;
  } else {
    effectiveVisualId = visualIdStr;
    // CRITICAL FIX: Reverse lookup to preserve tempVisualId for fallback
    for (const [tempId, mappedRealId] of this.tempIdToRealIdCache.entries()) {
      if (mappedRealId === visualIdStr) {
        effectiveTempVisualId = tempId;
        break;
      }
    }
  }
}
```

**Why This Works:**
1. When sync completes, `tempIdToRealIdCache` has mapping: `temp_hud_xxx -> 157`
2. `buildConvertedFieldsFromOrganizedData()` now finds this mapping via reverse lookup
3. Field gets both `visualId = "157"` AND `tempVisualId = "temp_hud_xxx"`
4. `populatePhotosFromDexie()` fallback works: if LocalImages still have `entityId = temp_hud_xxx`, the fallback lookup succeeds

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `buildConvertedFieldsFromOrganizedData()` - added reverse lookup in tempIdToRealIdCache to preserve tempVisualId

**Result:** FAILED - Photos still disappear after sync. The reverse lookup in buildConvertedFieldsFromOrganizedData is not sufficient because `tempIdToRealIdCache` is an IN-MEMORY cache that's empty on page refresh.

## Fix Applied (Attempt 4 - Persistent Reverse Lookup)
The issue with Attempt 3: `tempIdToRealIdCache` is an in-memory cache populated only during `reloadVisualsAfterSync()`. On page refresh after sync, the cache is empty and the reverse lookup fails.

**Solution:** Use the PERSISTED `tempIdMappings` table in Dexie for reverse lookup in `populatePhotosFromDexie()`:

1. Added `getTempId(realId)` function to `IndexedDbService` - queries `tempIdMappings` table by `realId` to find original `tempId`
2. Added 4th fallback in `populatePhotosFromDexie()`: if no photos found with `realId`, no `tempId` available, do reverse lookup in Dexie to find `tempId` from `realId`

**New code in `populatePhotosFromDexie()`:**
```typescript
// ATTEMPT 4 FIX: If no photos found, have realId but no tempId, do REVERSE lookup
if (localImages.length === 0 && realId && !tempId) {
  const reverseLookupTempId = await this.indexedDb.getTempId(realId);
  if (reverseLookupTempId) {
    localImages = localImagesMap.get(reverseLookupTempId) || [];
  }
}
```

**Why This Works:**
1. `tempIdMappings` table persists across page refreshes (stored in Dexie/IndexedDB)
2. When sync completes, `mapTempId(tempId, realId, 'hud')` is called, persisting the mapping
3. On page refresh: `field.visualId = "157"`, `field.tempVisualId = null` (from buildConvertedFieldsFromOrganizedData)
4. `populatePhotosFromDexie()` tries `realId` lookup → fails (LocalImages still have `temp_hud_xxx`)
5. `tempId` fallback skipped (it's null)
6. NEW: Reverse lookup finds `temp_hud_xxx` from Dexie → photos found!

**Files Modified:**
- `src/app/services/indexed-db.service.ts`
  - Added `getTempId(realId)` for reverse lookup in `tempIdMappings` table
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - Added 4th fallback in `populatePhotosFromDexie()` using persistent reverse lookup

**Result:** FAILED - Photos still disappear after sync. Need to analyze EFE implementation and replicate exactly.

## Fix Applied (Attempt 5 - Match EFE Pattern)
After thorough analysis comparing EFE and HUD implementations, found the ROOT CAUSE:

**EFE Pattern (WORKS):**
1. Subscribes to `visualFieldRepo.getFieldsForCategory$()` - reactive subscription to VisualFields table
2. When sync updates VisualField with real ID, the liveQuery fires with FRESH data
3. `populatePhotosFromDexie(fields)` receives fresh fields with correct `visualId`/`tempVisualId`
4. Photos are matched correctly

**HUD Pattern (BROKEN):**
1. Only subscribes to `db.liveLocalImages$()` - reactive subscription to LocalImages table
2. When sync completes, HUD uses STALE `lastConvertedFields` built from in-memory `organizedData`
3. `lastConvertedFields` has outdated `visualId`/`tempVisualId` (not refreshed from Dexie)
4. Photo matching fails because IDs don't match

**Fix:** Added `refreshLastConvertedFieldsFromDexie()` method that:
1. Fetches fresh VisualFields from Dexie for all categories in `lastConvertedFields`
2. Updates `lastConvertedFields` with fresh `visualId`/`tempVisualId` values
3. Called BEFORE `populatePhotosFromDexie()` in the LocalImages liveQuery callback

**Code changes:**
```typescript
// In subscribeToLocalImagesChanges() liveQuery callback:
// ATTEMPT 5 FIX: Refresh lastConvertedFields from Dexie before populating photos
await this.refreshLastConvertedFieldsFromDexie();

// Then call populatePhotosFromDexie with fresh data
await this.populatePhotosFromDexie(this.lastConvertedFields);
```

**Why This Works:**
1. When sync completes, `reloadVisualsAfterSync()` calls `visualFieldRepo.setField()` to update VisualField with real ID
2. LocalImages liveQuery fires (because `updateEntityIdForImages()` updates LocalImages)
3. NEW: `refreshLastConvertedFieldsFromDexie()` fetches fresh VisualField data from Dexie
4. `lastConvertedFields` now has correct `visualId` values
5. `populatePhotosFromDexie()` can match photos correctly

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - Added `refreshLastConvertedFieldsFromDexie()` method
  - Called it before `populatePhotosFromDexie()` in LocalImages liveQuery callback

**Result:** FAILED - Photos still disappear after sync. Need to add proper VisualFields subscription like EFE.

## Fix Applied (Attempt 6 - Proper VisualFields Subscription)
The issue with Attempt 5: `refreshLastConvertedFieldsFromDexie()` runs when LocalImages liveQuery fires, but `setField()` might not have completed yet (race condition).

**Root Cause Confirmed:**
1. `reloadVisualsAfterSync()` calls `setField()` (async, NOT awaited)
2. `updateEntityIdForImages()` triggers LocalImages liveQuery
3. LocalImages liveQuery calls `refreshLastConvertedFieldsFromDexie()` + `populatePhotosFromDexie()`
4. BUT `setField()` hasn't completed yet! VisualField still has old visualId!
5. Photos can't be matched → disappear

**EFE Pattern (WORKS):**
- EFE has `visualFieldsSubscription` that subscribes to `visualFieldRepo.getFieldsForCategory$()`
- When `setField()` completes and updates Dexie, the subscription fires with fresh data
- `convertFieldsToOrganizedData(fields)` uses the fresh data
- `populatePhotosFromDexie(fields)` gets correct IDs

**FIX:** Added `subscribeToVisualFieldChanges()` method that:
1. Subscribes to `visualFieldRepo.getAllFieldsForService$(serviceId)` - watches ALL VisualFields for the service
2. When `setField()` completes, subscription fires with fresh fields
3. Updates `lastConvertedFields` with fresh `visualId`/`tempVisualId` from liveQuery
4. Calls `populatePhotosFromDexie()` with correct IDs

**Why This Works:**
- VisualFields liveQuery fires AFTER `setField()` commits to Dexie
- `lastConvertedFields` gets updated with correct real IDs
- `populatePhotosFromDexie()` can now match photos by correct `visualId`
- No race condition because we're reacting to Dexie changes, not guessing

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - Added `subscribeToVisualFieldChanges()` method (mirrors EFE's `visualFieldsSubscription`)
  - Called it in `loadDataFromCache()` after building `lastConvertedFields`

**Result:** RESOLVED ✓ - Photos now persist correctly after sync!

---

# Issue: LBW WEBAPP - Annotations Disappear on Page Reload

## Status: RESOLVED ✓

## Problem Description
In the LBW WEBAPP mode, annotations added to photos would display correctly when first added, but would disappear when the page was reloaded.

## Root Cause
The code was only checking for cached annotated images when `hasAnnotations` was true (based on server-side `Drawings` field). But if annotations haven't synced to the server yet, `attach.Drawings` is empty, so the cache lookup was skipped entirely.

This was the same issue previously solved for HUD (documented above).

## Solution
Changed to ALWAYS check the cached annotated images FIRST, regardless of server-side Drawings:

```typescript
// BEFORE: Only checked cache if server had Drawings
const hasAnnotations = !!(att.Drawings && att.Drawings.length > 10);
if (hasAnnotations) {
  const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
  // ...
}

// AFTER: Always check cache first (catches local-only annotations)
const hasServerAnnotations = !!(att.Drawings && att.Drawings.length > 10);
let hasAnnotations = hasServerAnnotations;
const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
if (cachedAnnotated) {
  thumbnailUrl = cachedAnnotated;
  hasAnnotations = true;  // Even if server has no Drawings yet
}
```

## Files Modified
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`
  - `loadPhotosFromAPI()`: Always check cache first, then render if server has Drawings
  - `loadSinglePhoto()`: Always check cache first in WEBAPP mode
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`
  - `loadPhotos()`: Check `getCachedAnnotatedImage()` first, then render if needed

**Result:** RESOLVED ✓ - Annotations now persist correctly after page reload!

---

# Issue: HUD Mobile - Custom Visual Title Shows "Custom Item" After Navigation

## Status: TESTING

## Problem Description
After opening the project details page and navigating back, custom visuals on the HUD category-detail page show "Custom Item" as the title instead of the correct custom name. Clicking into the visual details shows the correct title, but the main category-detail page displays "Custom Item".

## Root Cause
In `loadExistingVisualsFromCache()`, when creating custom items at line 3903, the code uses:
```typescript
name: visual.Name || 'Custom Item'
```

The problem is that `visual.Name` comes from the HUD cache (server data via `bulkVisualsCache`). When `refreshHudInBackground()` fetches fresh data from the server after navigation, if the server returns empty/null Name for a custom visual, the local cache gets overwritten.

When the page reloads, `loadExistingVisualsFromCache()` creates custom items using the empty `visual.Name`, which falls back to "Custom Item".

**Why it works in `loadDataFromCache()`:**
- That method builds a `dexieFieldMap` from VisualFields stored in Dexie
- Custom visuals use `dexieField.templateName || 'Custom Item'` (line 890)
- `templateName` is preserved in Dexie and not affected by server refreshes

## Fix Applied
Added the same `dexieFieldMap` pattern to `loadExistingVisualsFromCache()`:

1. Build `dexieFieldMap` at the start of the method by querying VisualFields from Dexie:
```typescript
const dexieFieldMap = new Map<string, any>();
if (this.serviceId) {
  const dexieFields = await this.visualFieldRepo.getAllFieldsForService(this.serviceId);
  for (const field of dexieFields) {
    if (field.visualId) {
      dexieFieldMap.set(String(field.visualId), field);
    }
    if (field.tempVisualId) {
      dexieFieldMap.set(String(field.tempVisualId), field);
    }
  }
}
```

2. When creating custom items, use `dexieField.templateName` as fallback:
```typescript
const dexieField = dexieFieldMap.get(visualId);
const customName = visual.Name || (dexieField?.templateName) || 'Custom Item';
```

**Why This Works:**
1. `templateName` is stored in Dexie VisualFields when the custom visual is created
2. Dexie data persists and is not overwritten by server refreshes
3. When `visual.Name` is empty (from server cache), we fall back to `dexieField.templateName`
4. Custom visuals display with the correct name

**Files Modified:**
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts`
  - `loadExistingVisualsFromCache()`: Added dexieFieldMap for name fallback lookup
  - Custom item creation uses `visual.Name || dexieField?.templateName || 'Custom Item'`
  - Orphaned item creation uses the same pattern

**Result:** FAILED - Synced photos not showing in visual details page, and title changes to "Custom Item" when making changes. The dexieFieldMap lookup broke things.

## Attempt 2 - Copy EFE Implementation Exactly

Reverted `loadExistingVisualsFromCache()` to match EFE exactly:
- Removed dexieFieldMap lookup at start of method
- Removed dexieField name fallback for custom items
- Custom items now use `visual.Name || 'Custom Item'` directly (same as EFE)
- Fixed key format: `const key = \`${category}_${item.id}\`;` (matches EFE line 3091)
- Fixed hidden key format: `const hiddenKey = \`${category}_${item.id}\`;` (matches EFE line 3051)

**Also fixed:**
- `subscribeToVisualFieldChanges()`: Now follows EFE pattern exactly:
  - Stores fresh fields as `lastConvertedFields` (not trying to match by templateId)
  - Updates `visualRecordIds` from fresh fields
  - **CRITICAL**: Updates custom items in `organizedData` with correct `templateId` from Dexie
    - Custom items from cache have `templateId: 0`
    - Dexie VisualFields have negative `templateId` (e.g., -1706486400000)
    - Template uses `getPhotosForVisual(category, item.templateId)` to find photos
    - Without this fix, photos stored at `${category}_${-1706486400000}` can't be found by key `${category}_0`
  - Calls `populatePhotosFromDexie(fields)` with fresh fields directly
- `reloadVisualsAfterSync()`: Uses `item.id` for key (matches EFE pattern)

**Result:** TESTING

---

# Issue: HUD Visual Detail - Photos Disappear & Title Shows "Custom Item" After Sync

## Status: RESOLVED ✓

## Problem Description
In the HUD visual detail page (`src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts`), after sync completes:
1. Photos that were visible before sync disappear
2. The title changes to "Custom Item" instead of the actual visual name

This is the EXACT same issue that was working correctly in EFE visual detail page.

## Environment
- **Page:** `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts`
- **Mode:** Mobile (DEXIE-FIRST)
- **Reference:** `src/app/pages/engineers-foundation/structural-systems/visual-detail/visual-detail.page.ts` (WORKS CORRECTLY)

## Attempt 1 - Replace localImageService with direct Dexie query

**Hypothesis:** HUD uses `localImageService.getImagesForEntity()` wrapper while EFE queries Dexie DIRECTLY.

**Changes Made:**
- Updated `loadPhotos()` to use direct Dexie query: `db.localImages.where('entityId').equals(this.hudId)`
- Added manual blob URL creation from `db.localBlobs`
- Updated `subscribeToVisualFieldChanges()` to also update `item.name` from Dexie `templateName`

**Result:** FAILED - Same issues persist. Photos still disappear after sync, title still shows "Custom Item".

**Root Cause Analysis (Post-Failure):**

Comparing EFE vs HUD more carefully reveals TWO critical bugs:

### Bug 1: Wrong ID priority order in `loadVisualData()`

**HUD (WRONG - lines 323-324, 353-354):**
```typescript
if (!this.hudId) {
  this.hudId = field.visualId || field.tempVisualId || '';  // WRONG ORDER!
}
```

**EFE (CORRECT - line 379):**
```typescript
this.visualId = field?.tempVisualId || field?.visualId || '';  // tempVisualId FIRST!
```

After sync:
- `visualField.visualId` = "157" (real ID from server)
- `visualField.tempVisualId` = "temp_hud_xxx" (original temp ID)
- `localImages.entityId` = "temp_hud_xxx" (photos stored with original temp ID)

HUD uses `visualId` first → "157" → no photos found for entityId "157"
EFE uses `tempVisualId` first → "temp_hud_xxx" → photos found!

### Bug 2: loadPhotos() has `if (!this.hudId)` guard that skips re-query

**HUD (WRONG - lines 478-490):**
```typescript
if (!this.hudId) {
  // query visualFields and set hudId
}
// hudId already set by loadVisualData() with WRONG value, so this is skipped!
```

**EFE (CORRECT - lines 370-379):**
```typescript
// NO guard - ALWAYS re-queries and OVERWRITES visualId
const fields = await db.visualFields...
const field = fields.find(f => f.templateId === this.templateId);
this.visualId = field?.tempVisualId || field?.visualId || '';  // ALWAYS overwrites
```

EFE ALWAYS re-queries visualFields in `loadPhotos()` and OVERWRITES `this.visualId`.
HUD's `if (!this.hudId)` guard means it uses the stale/wrong value from `loadVisualData()`.

## Attempt 2 - Apply Bug 1 & Bug 2 fixes

**Changes Made:**
- Removed `if (!this.hudId)` guard in `loadPhotos()`
- Changed ID priority to `tempVisualId || visualId` (tempVisualId FIRST)
- Added comments noting EFE pattern

**Result:** FAILED - Photos still disappear after sync, title still shows incorrect value.

**Post-Failure Analysis:**

Comparing EFE visual-detail vs HUD visual-detail more carefully reveals additional differences:

### Finding 1: EFE does NOT have reactive subscription to visual field changes

Both EFE and HUD visual-detail pages only load data ONCE on init. There's no liveQuery subscription to react when Dexie data changes after sync. This means:
- If user is on the page when sync happens, data doesn't refresh
- When navigating BACK to the page, ionViewWillEnter doesn't reload data in MOBILE mode

### Finding 2: HUD's convertFieldToItem differs from EFE

**EFE (line 307-308):**
```typescript
id: field.id || field.templateId,  // Uses Dexie auto-increment ID
```

**HUD (line 398-399):**
```typescript
id: field.tempVisualId || field.visualId || field.templateId,  // Uses visual ID
```

The comment says "EFE PATTERN" but the implementation is DIFFERENT. This shouldn't affect photo loading (which uses `this.hudId`), but indicates the code wasn't actually copied from EFE.

### Finding 3: ionViewWillEnter doesn't reload in MOBILE mode

**EFE visual-detail ionViewWillEnter (lines 100-107):**
```typescript
ionViewWillEnter() {
  // WEBAPP: Clear loading state when returning to this page
  if (environment.isWeb) {
    this.loading = false;
    this.saving = false;
    this.changeDetectorRef.detectChanges();
  }
}
```

**HUD has the SAME code** - only handles WEBAPP mode. In MOBILE mode, returning to the page doesn't reload data. If sync happened while on a different page and user navigates back, stale data is shown.

### Root Cause Hypothesis

The real issue is that HUD visual-detail lacks a **liveQuery subscription** to react to Dexie changes after sync. When sync updates the visualField, the page doesn't know about it and continues showing stale data.

**Solution:** Add a liveQuery subscription to visualFields in HUD visual-detail, matching the pattern used in category-detail pages.

---

## Attempt 3 - Add liveQuery subscription for reactive updates

**Hypothesis:** The page needs to reactively update when Dexie visualFields change after sync.

**Changes Made to `hud-visual-detail.page.ts`:**

1. Added `visualFieldsSubscription` and `lastKnownHudId` properties to track subscription and detect changes

2. Updated `ionViewWillEnter()` to reload data in MOBILE mode:
```typescript
} else {
  // MOBILE: Reload data when returning to this page (sync may have happened)
  if (this.serviceId && this.templateId) {
    this.loadVisualData();
  }
}
```

3. Added `subscribeToVisualFieldChanges()` method that:
   - Creates a liveQuery subscription to visualFields
   - When field changes, updates `this.item.name` and `this.item.text` from field data
   - Detects when hudId changes (sync assigned real ID) and reloads photos
   - Only runs in MOBILE mode (WEBAPP loads from server)

4. Updated `loadPhotos()` to set `lastKnownHudId` after setting `this.hudId`:
```typescript
this.hudId = field?.tempVisualId || field?.visualId || '';
this.lastKnownHudId = this.hudId;  // Track for change detection
```

5. Updated `ngOnDestroy()` to unsubscribe from `visualFieldsSubscription`

**Result:** FAILED - Same issues persist. Photos still disappear after sync, title still shows incorrect value.

---

## Attempt 4 - Add debug alerts and deeper investigation

**Approach:** Add alert popups at key points in the code to understand what's happening during load and after sync.

**Changes Made to `hud-visual-detail.page.ts`:**

1. Added `showDebugAlert()` helper method that shows alert popups with debug data (MOBILE mode only)

2. Added debug alert in `loadVisualData()` MOBILE mode after field lookup:
   - Shows: fieldFound, templateName, tempVisualId, visualId, templateFound, templateNameFromTemplate

3. Added debug alert in `loadPhotos()` MOBILE mode after photo query:
   - Shows: hudId, tempVisualId, visualId, photosFound, photoEntityIds (first 3)

4. Added debug alert in `liveQuery` subscription when field changes:
   - Shows: templateName, tempVisualId, visualId, currentHudId, lastKnownHudId, hudIdChanged, currentItemName

**Expected debug flow:**
1. On page load: "loadVisualData MOBILE" alert shows field data
2. After loadVisualData: "loadPhotos MOBILE" alert shows hudId and photo count
3. When sync updates field: "liveQuery UPDATE" alert shows the change

**Result:** FAILED

**Critical Finding from Debug:**
- `tempVisualId: temp_hud_xxx` - Field has temp ID
- `allEntityIds: 186` - Photos stored with entityId "186" (REAL server ID, not temp ID!)

**ROOT CAUSE IDENTIFIED:** Photos are being saved with the WRONG entityId. The HUD code is using a real server ID instead of tempVisualId when capturing photos. This is why photos can't be found - they're stored under a different key than what we're querying.

---

## Attempt 5 - Add getRealId() fallback lookup (from category-detail pattern)

**Analysis:**

The debug revealed the smoking gun:
- Dexie field has `tempVisualId: temp_hud_xxx` and `visualId: (none)`
- Photos have `entityId: 186` (REAL server ID!)

This happens because:
1. User creates visual in category-detail which loads from cache with real HUDID "186"
2. `visualRecordIds[key]` stores "186" (real ID from cache)
3. Photo captured uses entityId = visualRecordIds[key] = "186"
4. Dexie field created with tempVisualId = temp_hud_xxx (from createVisual in MOBILE mode)
5. visual-detail queries photos with entityId = tempVisualId = "temp_hud_xxx"
6. NO MATCH - photos have entityId "186" but we're looking for "temp_hud_xxx"

**Solution:** `hud-category-detail.populatePhotosFromDexie()` has sophisticated fallback at lines 1694-1713:
```typescript
// US-002 FIX: If still no photos and we have tempId, check IndexedDB for temp-to-real mapping
if (localImages.length === 0 && tempId) {
  mappedRealId = await this.indexedDb.getRealId(tempId);
  if (mappedRealId) {
    localImages = localImagesMap.get(mappedRealId) || [];
  }
}
```

`hud-visual-detail.loadPhotos()` is MISSING this fallback. It only has a simple check when BOTH tempVisualId AND visualId exist.

**Changes Made to `hud-visual-detail.page.ts` `loadPhotos()`:**

Added tempIdMappings fallback lookup after the simple alternate ID check:

```typescript
// FALLBACK 2: If no photos found and we have tempVisualId, check tempIdMappings for mapped realId
// This handles the case where photos were captured with REAL server ID (from cache)
// but Dexie field has tempVisualId (from createVisual in MOBILE mode)
if (localImages.length === 0 && field?.tempVisualId) {
  const mappedRealId = await this.indexedDb.getRealId(field.tempVisualId);
  if (mappedRealId) {
    console.log('[HudVisualDetail] MOBILE: Trying mapped realId:', mappedRealId);
    localImages = await db.localImages
      .where('entityId')
      .equals(mappedRealId)
      .toArray();
    if (localImages.length > 0) {
      console.log('[HudVisualDetail] MOBILE: Found', localImages.length, 'photos with mapped realId');
      // Update VisualField with realId so future lookups work directly
      this.visualFieldRepo.setField(this.serviceId, this.categoryName, this.templateId, {
        visualId: mappedRealId
      }).catch(err => console.error('[HudVisualDetail] Failed to update visualId:', err));
    }
  }
}
```

Also removed debug alerts as they were blocking and no longer needed.

**Result:** SUCCESS ✓ - Photos now load correctly by using tempIdMappings fallback to find photos stored with real server ID when Dexie field has tempVisualId.

---

# Issue: LBW MOBILE - Visuals and Images Not Persisting After Page Navigation

## Status: RESOLVED ✓ (2026-01-29)

## Problem Description
In LBW MOBILE mode, visuals and images are not persisting correctly:

1. **Visuals not persisting**: When selecting a visual, navigating away, and returning, the visual appears deselected
2. **Loading screens appearing**: Page movement shows loading spinners instead of instant display (should match HUD behavior)
3. **Images not displaying**: Photos captured may show placeholders or disappear on page reload
4. **Multi-select options "jumping"**: Multi-select values don't show instantly like HUD

## Environment
- **Template:** LBW (Load Bearing Wall)
- **Mode:** MOBILE (not WEBAPP)
- **Tables:** LPS_Services_LBW, LPS_Services_LBW_Attach

## Expected Behavior (matches HUD)
1. Visuals persist after selection - shown as selected on page reload
2. Page transitions are instant with no loading spinners (DEXIE-first)
3. Photos display immediately from local storage and persist through sync
4. Multi-select options update instantly without UI jumping

## Actual Behavior
1. Visuals show deselected after page navigation
2. Loading spinners appear during page transitions
3. Photos disappear or show placeholders
4. UI jumps/flashes during multi-select changes

## Investigation Log

### Attempt 1 - Add refreshLastConvertedFieldsFromDexie() (2026-01-29)

**Hypothesis:** The LBW template was missing the `refreshLastConvertedFieldsFromDexie()` method that HUD uses to refresh `lastConvertedFields` with fresh visualId/tempVisualId from Dexie before populating photos.

**Changes Made:**
1. Added `refreshLastConvertedFieldsFromDexie()` method to `lbw-category-detail.page.ts` (matching HUD pattern)
2. Updated `subscribeToLocalImagesChanges()` to call `refreshLastConvertedFieldsFromDexie()` before `populatePhotosFromDexie()`
3. Updated `ionViewWillEnter()` MOBILE path to:
   - Set up deferred `localImagesSubscription` if not already done
   - Call `refreshLastConvertedFieldsFromDexie()` before `populatePhotosFromDexie()`

**Result:** FAILED - Issues still persist. Need deeper investigation.

---

### Attempt 2 - Fix Visual Matching After Sync (2026-01-29)

**Root Cause Analysis:**

After deep investigation, the root cause was identified:

1. **After sync, Dexie VisualField NOT updated:** When a visual syncs (temp_lbw_xxx → real LBWID 456):
   - Background sync updates the 'lbw_records' cache with real LBWID
   - Background sync stores temp→real mapping in `tempIdMappings` table
   - **BUT Dexie VisualField still has `tempVisualId: temp_lbw_xxx`, `visualId: null`**
   - LBW was missing the `reloadVisualsAfterSync()` mechanism that HUD has

2. **PRIORITY 1 matching fails:** In `loadDataFromCache()`:
   - Gets dexieVisualId from Dexie: `temp_lbw_xxx`
   - Tries to find visual in cache where LBWID = `temp_lbw_xxx`
   - But cache has LBWID = `456` → **NO MATCH!**
   - PRIORITY 2 fails because LBW visuals don't have TemplateID
   - PRIORITY 3 fallback to name matching is fragile

**Fixes Applied to `lbw-category-detail.page.ts`:**

**Fix 1: Update PRIORITY 1 matching to resolve temp IDs (lines ~1107-1125)**

Added temp ID resolution before matching:
```typescript
// TITLE EDIT FIX: PRIORITY 1 - Find by LBWID from Dexie mapping
let visual: any = null;
const dexieVisualId = templateToVisualMap.get(templateId);
if (dexieVisualId) {
  // SYNC FIX: If dexieVisualId is a temp ID, check if it maps to a real LBWID
  // After sync, Dexie still has tempVisualId but cache has real LBWID
  let effectiveVisualId = String(dexieVisualId);
  if (effectiveVisualId.startsWith('temp_')) {
    const mappedRealId = await this.indexedDb.getRealId(effectiveVisualId);
    if (mappedRealId) {
      console.log(`[LBW CategoryDetail] MOBILE: Resolved temp ID ${effectiveVisualId} -> real ID ${mappedRealId}`);
      effectiveVisualId = mappedRealId;
    }
  }
  visual = (categoryVisuals || []).find((v: any) =>
    String(v.LBWID || v.PK_ID) === effectiveVisualId
  );
  // ...
}
```

**Fix 2: Subscribe to lbwSyncComplete$ to update Dexie VisualField (lines ~360-420)**

Added subscription in `subscribeToUploadUpdates()`:
```typescript
// SYNC FIX: Subscribe to LBW visual sync completions
// When a visual syncs, update the Dexie VisualField with the real LBWID
this.backgroundSync.lbwSyncComplete$.subscribe(async (event) => {
  if (event.operation !== 'create') return;
  if (!event.serviceId || event.serviceId !== this.serviceId) return;

  // Find which key this visual belongs to
  for (const [key, visualId] of Object.entries(this.visualRecordIds)) {
    if (!String(visualId).startsWith('temp_')) continue;

    const mappedRealId = await this.indexedDb.getRealId(String(visualId));
    if (mappedRealId && mappedRealId === event.lbwId) {
      // Update visualRecordIds with real ID
      this.visualRecordIds[key] = event.lbwId;

      // Cache temp->real mapping for synchronous lookup
      this.tempIdToRealIdCache.set(String(visualId), event.lbwId);

      // Update Dexie VisualField with real LBWID
      await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
        visualId: event.lbwId
      });

      // Update LocalImages.entityId from temp to real
      this.indexedDb.updateEntityIdForImages(String(visualId), event.lbwId);

      break;
    }
  }
});
```

**Key Differences from HUD:**
- HUD has `reloadVisualsAfterSync()` triggered by `cacheInvalidated$` events
- LBW now has direct subscription to `lbwSyncComplete$` for more targeted update
- Both achieve the same goal: update Dexie VisualField with real ID after sync

**Result:** FAILED - Visuals still being unselected on page reload.

---

### Attempt 3 - Use getFieldsForCategory() Like HUD (2026-01-29)

**Root Cause Found (from ISSUES.md analysis):**

HUD's successful Attempt 2 and 3 used `visualFieldRepo.getFieldsForCategory()` which queries using the compound index `[serviceId+category]`. LBW was using direct Dexie query with JavaScript filter:

**HUD (Working):**
```typescript
const dexieFieldMap = new Map<number, any>();
for (const cat of uniqueCategories) {
  const fieldsForCat = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, cat);
  for (const field of fieldsForCat) {
    dexieFieldMap.set(field.templateId, field);
  }
}
```

**LBW (Not Working):**
```typescript
const dexieFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

// Later filters with JavaScript
for (const field of dexieFields.filter(f => f.category === this.categoryName)) {
```

The difference: HUD uses the compound index lookup which is reliable, LBW was querying all fields then filtering which may have category matching issues.

**Fixes Applied to `lbw-category-detail.page.ts`:**

**Fix 1: Update loadDataFromCache() to use getFieldsForCategory() (lines ~1141-1155)**
```typescript
// Before:
const dexieFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

// After:
const dexieFields = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, this.categoryName);
```

**Fix 2: Remove redundant category filter (lines ~1244-1246)**
Since `getFieldsForCategory()` already filters by category, removed the JavaScript filter:
```typescript
// Before:
for (const field of dexieFields.filter(f => f.category === this.categoryName)) {

// After:
for (const field of dexieFields) {
```

**Fix 3: Update mergeDexieVisualFields() to use getFieldsForCategory() (lines ~613-626)**
```typescript
// Before:
const dexieFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

// After:
const dexieFields = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, this.categoryName);
```

**Fix 4: Use item.templateId for keys instead of item.id (CRITICAL)**

**Root Cause Found:** HTML template passes `item.id` to methods like `toggleItemSelection(category, item.id)`.
- `item.id` = `template.PK_ID` (from loadCategoryTemplates)
- `item.templateId` = `template.TemplateID || template.PK_ID`

When these values differ, the key used to SAVE to Dexie doesn't match the key used to LOOKUP from Dexie.

**Files and methods updated:**
- `toggleItemSelection()` - use `item.templateId` for key
- `isItemSelected()` - use `item.templateId` for key
- `isItemSaving()` - use `item.templateId` for key
- `createVisualRecord()` - use `item.templateId` for key
- `deleteVisualRecord()` - use `item.templateId` for key
- `getPhotosForVisual()` - use `item.templateId` for key
- `isLoadingPhotosForVisual()` - use `item.templateId` for key
- `getSkeletonArray()` - use `item.templateId` for key
- `isUploadingPhotos()` - use `item.templateId` for key
- `getUploadingCount()` - use `item.templateId` for key
- `getTotalPhotoCount()` - use `item.templateId` for key
- `addPhotoFromCamera()` - use `item.templateId` for key
- `addPhotoFromGallery()` - use `item.templateId` for key
- `viewPhoto()` - use `item.templateId` for key
- `deletePhoto()` - use `item.templateId` for key

Pattern applied:
```typescript
// Before:
const key = `${category}_${itemId}`;

// After:
const item = this.findItemById(itemId);
const templateId = item?.templateId ?? itemId;
const key = `${category}_${templateId}`;
```

**Result:** PENDING VERIFICATION

---

## Next Debugging Steps

Based on patterns from resolved HUD issues (see "HUD Visual Detail - Photos Disappear" issue), investigate:

### 1. Check entityId mismatch
The most common cause is photos being stored with a DIFFERENT entityId than what we query:
- Photos might be stored with REAL server ID (from cache)
- But Dexie field has tempVisualId (from createVisual)
- Query uses tempVisualId → no match

**Debug:** Add logging in camera capture to show:
```
console.log('[LBW DEBUG] Capturing photo with entityId:', entityId);
```

### 2. Check visualRecordIds population
When does `visualRecordIds[key]` get populated and with what ID?
- Is it using temp_lbw_xxx or real LBWID?
- Does it match what's in Dexie VisualField?

**Debug:** Add logging in `loadDataFromCache()`:
```
console.log('[LBW DEBUG] visualRecordIds[key]:', key, '=', visualId);
console.log('[LBW DEBUG] Dexie field:', field.tempVisualId, field.visualId);
```

### 3. Check tempIdMappings table
Is the temp->real ID mapping being stored correctly in `tempIdMappings` table?

**Debug:**
```
const mappedId = await this.indexedDb.getRealId(tempVisualId);
console.log('[LBW DEBUG] tempIdMappings lookup:', tempVisualId, '->', mappedId);
```

### 4. Check createVisual flow
When a visual is created/selected in MOBILE mode:
- What ID is generated?
- Is it stored in both Dexie VisualField and cached LBW records?

### 5. Check isSelected persistence
When visual is selected via `toggleItemSelection()`:
- Is `item.isSelected` being set correctly?
- Is it persisted to Dexie VisualField?
- Is `mergeDexieVisualFields()` restoring it on page reload?

## Files to Investigate
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`
  - `loadDataFromCache()` - How visuals are loaded and matched
  - `toggleItemSelection()` / `saveVisualSelection()` - How selection is saved
  - `addPhotoFromCamera()` / `addPhotoFromGallery()` - What entityId is used
  - `populatePhotosFromDexie()` - 4-tier fallback working?
  - `mergeDexieVisualFields()` - Is isSelected being restored?

- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`
  - `loadVisualData()` - Is field being found?
  - `loadPhotos()` - 4-tier fallback working?

- `src/app/pages/lbw/lbw-data.service.ts`
  - `createVisual()` - What temp ID is generated?
  - `uploadVisualPhoto()` - What entityId is passed to LocalImageService?

- `src/app/services/background-sync.service.ts`
  - `lbwPhotoUploadComplete$` - Is this being emitted and handled?

## Reference: Resolved HUD Pattern
The HUD issue "Photos Disappear After Sync" was resolved by:
1. Using 4-tier fallback in `loadPhotos()`: realId → tempId → getRealId(tempId) → getTempId(realId)
2. Proper `subscribeToVisualFieldChanges()` that updates `lastConvertedFields` with fresh IDs
3. Ensuring photos are captured with consistent entityId (either always temp or always real)

---

### Attempt 4 - US-001 FIX: Images Showing as Placeholders (2026-01-29)

**Problem:** After visual persistence was fixed (Attempt 3 Fix 4), images captured from camera/gallery were showing as placeholder images instead of the actual captured photos.

**Root Cause Analysis:**
When capturing a photo in MOBILE mode:
1. `localImageService.captureImage()` stores blob to Dexie and returns LocalImage
2. `localImageService.getDisplayUrl(localImage)` is called immediately after
3. Due to timing issues, the Dexie transaction may not have fully committed
4. `getDisplayUrl()` can't find the blob → returns placeholder
5. Photo entry is created with placeholder URL → user sees placeholder image

Additionally, the annotated image was being cached AFTER the photo was added to UI, meaning subsequent `getDisplayUrl()` calls from liveQuery couldn't find the cached annotated image.

**Fixes Applied:**

**File 1: `lbw-category-detail.page.ts` - `addPhotoFromCamera()` (lines ~3527-3618)**

1. **Moved annotated image caching BEFORE getDisplayUrl calls:**
```typescript
// US-001 FIX: Cache annotated image FIRST (before getDisplayUrl calls)
if (annotationsData && annotatedBlob) {
  await this.indexedDb.cacheAnnotatedImage(localImage.imageId, annotatedBlob);
}
```

2. **Added fallback to direct blob URL if getDisplayUrl returns placeholder:**
```typescript
let displayUrl = await this.localImageService.getDisplayUrl(localImage);

// US-001 FIX: If getDisplayUrl returns placeholder, create blob URL directly
if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
  console.warn('[CAMERA UPLOAD] US-001 FIX: getDisplayUrl returned placeholder, creating direct blob URL');
  displayUrl = URL.createObjectURL(compressedFile);
}
```

**File 2: `lbw-category-detail.page.ts` - `addPhotoFromGallery()` (lines ~3899-3906)**

Same fix applied:
```typescript
let displayUrl = await this.localImageService.getDisplayUrl(localImage);

// US-001 FIX: If getDisplayUrl returns placeholder, create blob URL directly
if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
  displayUrl = URL.createObjectURL(compressedFile);
}
```

**File 3: `lbw-data.service.ts` - `uploadVisualPhoto()` (lines ~563-580)**

Same fix applied for CREATE CUSTOM flow:
```typescript
let displayUrl = await this.localImageService.getDisplayUrl(localImage);

// US-001 FIX: If getDisplayUrl returns placeholder, create blob URL directly
if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
  displayUrl = URL.createObjectURL(file);
}
```

**Why This Works:**
1. The compressed file/blob is still in memory at this point
2. `URL.createObjectURL(compressedFile)` creates a valid blob URL directly
3. This URL works immediately without needing to read from Dexie
4. Photos display instantly after capture
5. Later, `populatePhotosFromDexie()` will refresh from Dexie when the blob is available

**Result:** FAILED - Images still showing placeholder immediately, not appearing in sync modal queue, not syncing to backend. The issue appears to be that LocalImage/UploadOutboxItem are not being created at all.

---

### Attempt 5 - Debug Logging to Trace Code Path (2026-01-29)

**Problem:** Images showing placeholder, not in sync queue, not syncing. Need to determine which code path is being executed.

**Hypothesis:** The most likely cause is that `environment.isWeb` is returning `true` even in mobile mode, causing the code to go to WEBAPP path instead of MOBILE path.

**Debug Logging Added:**

**File 1: `lbw-category-detail.page.ts` - `addPhotoFromCamera()` (lines ~3368-3378)**
```typescript
console.log('[CAMERA UPLOAD] ========== PATH DETECTION ==========');
console.log('[CAMERA UPLOAD] environment.isWeb:', environment.isWeb);
console.log('[CAMERA UPLOAD] visualId:', visualId);
console.log('[CAMERA UPLOAD] key:', key);
console.log('[CAMERA UPLOAD] Path:', environment.isWeb ? 'WEBAPP' : 'MOBILE');
console.log('[CAMERA UPLOAD] ====================================');
```

**File 2: `lbw-data.service.ts` - `createVisual()` (lines ~360-368)**
```typescript
console.log('[LBW Data] ========== createVisual PATH DETECTION ==========');
console.log('[LBW Data] environment.isWeb:', environment.isWeb);
console.log('[LBW Data] Path:', environment.isWeb ? 'WEBAPP (API)' : 'MOBILE (OFFLINE-FIRST)');
console.log('[LBW Data] ===================================================');
```

**File 3: `lbw-data.service.ts` - `uploadVisualPhoto()` (lines ~565-572)**
```typescript
console.log('[LBW Photo] ========== uploadVisualPhoto START ==========');
console.log('[LBW Photo] LBWID:', lbwId);
console.log('[LBW Photo] ServiceID:', serviceId);
console.log('[LBW Photo] File size:', file?.size, 'bytes');
```

**What to Check:**
1. If `[CAMERA UPLOAD] Path: WEBAPP` appears → Code is going to wrong path
2. If `[LBW Data] Path: WEBAPP (API)` appears → Visual creation going to wrong path
3. If neither MOBILE log appears → Error before reaching camera upload code
4. Check if `environment.ts` has `isWeb: true` (should be `isWeb: false` for mobile builds)

**Environment Files:**
- `environment.ts` (dev): `isWeb: true` ← **This is the issue for dev testing!**
- `environment.prod.ts` (mobile build): `isWeb: false` ← Correct for production mobile

**Potential Fix:** For mobile development/testing, need to either:
1. Build with `environment.prod.ts` configuration
2. Create `environment.mobile-dev.ts` with `isWeb: false`
3. Temporarily change `environment.ts` to `isWeb: false`

**Result:** FAILED - Console logs not visible on mobile. Updated to use alert() popups.

---

### Attempt 6 - Alert Popups for Mobile Debugging (2026-01-29)

**Problem:** Console logs not visible on mobile device. Need visual debugging.

**Debug Alerts Added to `lbw-category-detail.page.ts` - `addPhotoFromCamera()`:**

1. **[LBW DEBUG 0]** - Shows if visualId failed to be obtained (early return)
2. **[LBW DEBUG 1]** - PATH DETECTION: Shows `environment.isWeb` value and which path (WEBAPP/MOBILE)
3. **[LBW DEBUG 2]** - Shows if code is going to WEBAPP path (wrong for mobile)
4. **[LBW DEBUG 3]** - Shows if code is going to MOBILE path (correct)
5. **[LBW DEBUG 4]** - Shows captureImage result (SUCCESS with imageId/status OR FAILED with error)
6. **[LBW DEBUG 5]** - Shows photo added to UI with displayUrl type (BLOB/DATA/PLACEHOLDER)

**Expected Flow on Mobile:**
1. [LBW DEBUG 1] should show `environment.isWeb: false`, `Path: MOBILE`
2. [LBW DEBUG 3] should appear (MOBILE PATH)
3. [LBW DEBUG 4] should show captureImage SUCCESS with imageId and localBlobId
4. [LBW DEBUG 5] should show displayUrl type: BLOB

**If [LBW DEBUG 1] shows `environment.isWeb: true`:**
- The mobile build is using wrong environment configuration
- Fix: Ensure build uses `environment.prod.ts` with `isWeb: false`

**If [LBW DEBUG 0] appears:**
- visualId not obtained, check if item selection/creation is working

**If [LBW DEBUG 4] shows FAILED:**
- captureImage is throwing error, error message will be shown

**Result:** PARTIAL SUCCESS ✓ - Images now showing immediately and persisting. However, **sync to backend is FAILING**.

---

### Attempt 7 - LBW Photo Sync to Backend Failing (2026-01-29)

**Problem:** Images appear correctly in UI and persist locally. They also appear in the sync modal queue. However, the sync to backend is FAILING - photos are not being uploaded to `LPS_Services_LBW_Attach` table.

**Investigation:**

1. Compared LBW photo upload code with HUD photo upload code in `background-sync.service.ts`
2. Verified 'lbw' case exists and looks correct (lines 3468-3481)
3. Checked `createServicesLBWAttachWithFile` method in `caspio.service.ts`
4. Found LBW upload method was missing robustness features that HUD has

**Root Causes Found:**

1. **Missing File Validation**: LBW upload didn't reject empty files
2. **Missing Image Compression**: HUD compresses images >1MB to avoid 413 errors; LBW didn't
3. **Missing S3 Retry Logic**: HUD has 3 retries with exponential backoff; LBW had single attempt
4. **Missing Logging**: LBW upload had minimal logging, making debugging difficult

**Fixes Applied:**

**File 1: `background-sync.service.ts` - Debug Alerts (lines ~3371-3400, ~3468-3495)**

Added debug alerts for LBW sync process:
- `[LBW SYNC DEBUG] WAITING FOR VISUAL` - When parent visual hasn't synced yet
- `[LBW SYNC DEBUG 0] PRE-UPLOAD CHECK` - Shows entityType, entityId, temp ID resolution
- `[LBW SYNC DEBUG 1] UPLOAD STARTING` - Shows entityId, parsedId, fileSize
- `[LBW SYNC DEBUG 2] UPLOAD SUCCESS/FAILED` - Shows result or error message

**File 2: `caspio.service.ts` - `uploadLBWAttachWithS3()` (lines ~2561-2680)**

Added robustness features matching HUD:

1. **File Validation:**
```typescript
if (!file || file.size === 0) {
  console.error('[LBW ATTACH S3] ❌ REJECTING: Empty or missing file!');
  throw new Error('Cannot upload empty or missing file');
}
```

2. **Image Compression (for files >1MB):**
```typescript
if (file.size > MAX_SIZE_MB * 1024 * 1024) {
  const compressedBlob = await this.imageCompression.compressImage(file, {
    maxSizeMB: MAX_SIZE_MB,
    maxWidthOrHeight: 1920,
    useWebWorker: true
  });
  fileToUpload = new File([compressedBlob], file.name, { type: compressedBlob.type || 'image/jpeg' });
}
```

3. **S3 Retry Logic (3 attempts with exponential backoff):**
```typescript
for (let attempt = 1; attempt <= MAX_S3_RETRIES; attempt++) {
  try {
    // Upload attempt
  } catch (err) {
    if (attempt < MAX_S3_RETRIES) {
      const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
```

4. **Better Logging:**
- File size, LBWID, caption, drawings length
- Upload attempt number
- Compression details
- Error messages with context

**What to Check in Debug Alerts:**

1. **[LBW SYNC DEBUG] WAITING FOR VISUAL**
   - Means parent LBW visual hasn't synced yet
   - Photo will retry in 30 seconds

2. **[LBW SYNC DEBUG 0] PRE-UPLOAD CHECK**
   - `wasTempId: true` + `resolvedEntityId: <number>` → Temp ID resolved correctly
   - `resolvedEntityId: NaN` → Problem with ID resolution

3. **[LBW SYNC DEBUG 1] UPLOAD STARTING**
   - `parsedId: NaN` → Invalid entityId, will fail
   - `fileSize: 0` → Empty file, will be rejected

4. **[LBW SYNC DEBUG 2] UPLOAD FAILED**
   - Error message will identify the specific failure point

**Result:** SUCCESS ✓ - Camera uploads working. Gallery uploads fixed in Attempt 8.

---

### Attempt 8 - Gallery Uploads Failing Due to parseInt Validation (2026-01-29)

**Problem:** Camera uploads now work perfectly, but Gallery uploads:
- Show immediate placeholder image (not actual photo)
- Don't add to sync modal queue
- Don't sync to backend

**Root Cause Found:**

In `addPhotoFromGallery()` (line ~3732-3745), there was a validation check:

```typescript
const visualIdNum = parseInt(visualId, 10);
if (isNaN(visualIdNum)) {
  console.error('[GALLERY UPLOAD] Invalid HUD ID:', visualId);
  // Mark all skeleton photos as failed
  ...
  return;  // <-- EARLY RETURN!
}
```

In MOBILE mode, `visualId` can be a temp ID like `temp_lbw_xxx`. When `parseInt('temp_lbw_xxx', 10)` is called, it returns `NaN`, causing the code to exit early with "Invalid HUD ID" error.

The camera upload code doesn't have this validation - it just uses `String(visualId)` directly.

**Fixes Applied to `lbw-category-detail.page.ts`:**

**Fix 1: Updated parseInt validation to allow temp IDs (lines ~3732-3755)**

```typescript
// Before (BROKEN):
const visualIdNum = parseInt(visualId, 10);
if (isNaN(visualIdNum)) {
  // Early return - FAILS for temp_lbw_xxx IDs!
}

// After (FIXED):
const isTempId = String(visualId).startsWith('temp_');
const visualIdNum = parseInt(visualId, 10);

// Only validate as number for WEBAPP mode or if it's not a temp ID
if (!isTempId && isNaN(visualIdNum) && environment.isWeb) {
  // Early return - but temp IDs are now allowed!
}
```

**Fix 2: Added debug alerts to gallery path**

- `[LBW GALLERY DEBUG 1]` - PATH DETECTION: Shows environment.isWeb, visualId, and path
- `[LBW GALLERY DEBUG ERROR]` - If validation fails
- `[LBW GALLERY DEBUG 2]` - MOBILE PATH: Confirms entering DEXIE-FIRST capture
- `[LBW GALLERY DEBUG 3]` - captureImage SUCCESS/FAILED with details

**What to Check When Testing:**

1. **[LBW GALLERY DEBUG 1]** should show:
   - `environment.isWeb: false` (MOBILE mode)
   - `visualId: temp_lbw_xxx` or a real numeric ID
   - `Path: MOBILE`

2. **[LBW GALLERY DEBUG 2]** should appear (MOBILE PATH)

3. **[LBW GALLERY DEBUG 3]** should show:
   - `captureImage SUCCESS` with imageId, status, localBlobId, entityId
   - OR `captureImage FAILED` with error message

**Result:** SUCCESS ✓ - Gallery uploads now working. All debug alerts removed.

---

# Issue: DTE Visual Detail - Title/Description Not Showing Updated Values in WEBAPP Mode

**Status:** RESOLVED ✓

**Problem:**
In the DTE WEBAPP template, when navigating from category-detail to visual-detail page, the title and description fields show the ORIGINAL template values instead of the user's edited values. The edits are correctly saved to the backend and display correctly on the category-detail page, but visual-detail shows stale data.

**Symptoms:**
1. User edits title/description in visual-detail and saves
2. Changes are saved to Caspio backend correctly
3. Category-detail page shows the updated title correctly
4. User clicks into visual-detail again
5. Visual-detail shows the ORIGINAL template title/description, not the updated values

**Technical Analysis:**

The data flow has multiple issues:

1. **Wrong DTEID being passed**: The `visualRecordIds` map stores an ID that doesn't match the actual DTEID in the database
2. **Wrong field in API query**: The old code queries by `PK_ID` instead of `DTEID` (these are different fields with different values)
3. **Fallback matching fails**: When direct ID lookup fails, the fallback uses template data which has original values

**Console Log Evidence:**
```
[DTE CategoryDetail] WEBAPP: Passing dteId: 748
[CaspioService] getServicesDTEById called with DTEID=748
[CaspioService] ✅ Using AWS API Gateway for GET /tables/LPS_Services_DTE/records?q.where=PK_ID=748
[DTE Data] Sample HUD record data: {PK_ID: 400, DTEID: 399, ...}
[DteVisualDetail] WEBAPP: DTE record not found, using template data
```

Note: The dteId passed is 748, but actual DTEID in database is 399. Query uses PK_ID field instead of DTEID field.

---

### Attempt 1 - Cache Clearing and Query Field Fix (2026-01-29)

**Changes Made:**

1. **caspio.service.ts - getServicesDTEById()**: Changed query from `PK_ID` to `DTEID` field with cache-busting:
```typescript
return this.get<any>(`/tables/LPS_Services_DTE/records?q.where=DTEID=${dteId}&_cb=${cacheBuster}`, false)
```

2. **dte-data.service.ts - updateVisual()**: Now clears BOTH `hudCache` and `hudAttachmentsCache` after updates

3. **dte-category-detail.page.ts - ionViewWillEnter()**: Added WEBAPP-specific logic to clear caches and reload fresh data

4. **dte-category-detail.page.ts - Visual matching**: Added category checks to prevent matching visuals from different categories with same name:
   - Hidden visual matching now checks `visual.Category === this.categoryName`
   - PRIORITY 2 Name matching now checks category
   - `processVisualsUpdate()` now skips visuals from other categories

**Result:** FAILED - The app was not rebuilt after changes. Even after rebuild, the wrong DTEID (748) is being stored in `visualRecordIds` when the actual DTEID is 399. The root cause is that `item.id` is being used to construct the key, but `item.id` appears to be set incorrectly during the visual matching process.

---

### Attempt 2 - App Not Rebuilt / Old Code Running (2026-01-29)

**Critical Finding:**
The user's console logs show OLD code is still running:
- Log shows `itemId: 748` but updated code logs `key:` and `dteId:`
- Query uses `q.where=PK_ID=748` but updated code uses `q.where=DTEID=...`
- Line numbers don't match (3309 vs 3342)

**Evidence the old code has a bug:**
- `item.id` = 748 (template's PK_ID from LPS_Services_DTE_Templates table)
- `item.templateId` = 526 (template's TemplateID)
- Actual `DTEID` in database = 399 (from LPS_Services_DTE table)
- Old code passes `dteId=748` which is the template PK_ID, NOT the visual's DTEID

**The old code likely has a fallback like:**
```typescript
const dteId = this.visualRecordIds[key] || item.id;  // BUG: falls back to template PK_ID
```

**Current code (correct):**
```typescript
const key = `${this.categoryName}_${item.id}`;
const dteId = this.visualRecordIds[key];  // No fallback - undefined if not found
```

**Action Required:**
USER MUST REBUILD THE APPLICATION to pick up the fixes from Attempt 1.

**What the rebuilt app should show:**
1. Log format: `[DTE CategoryDetail] Navigating to visual detail for templateId: 526 category: Foundation below key: Foundation below_748 dteId: 399`
2. Query: `q.where=DTEID=399` (not PK_ID)
3. Result: Record found with updated Name/Text values

---

### Attempt 2 - Resolution (2026-01-29)

**Result:** SUCCESS ✓

After rebuilding the app with the fixes from Attempt 1, the issue was resolved.

**Root Causes Fixed:**
1. **Wrong API field**: Query used `PK_ID` instead of `DTEID` - these are different fields with different values
2. **Missing category check**: Visuals from other categories with the same name could overwrite the correct DTEID
3. **Cache not cleared**: `hudCache` wasn't cleared after updates, causing stale data

**Key Fixes Applied:**
1. `caspio.service.ts` - `getServicesDTEById()` now uses `q.where=DTEID=...` with cache-busting
2. `dte-data.service.ts` - `updateVisual()` clears both `hudCache` and `hudAttachmentsCache`
3. `dte-category-detail.page.ts` - Added `visual.Category === this.categoryName` checks to:
   - Hidden visual matching
   - PRIORITY 2 Name matching
   - `processVisualsUpdate()` method
4. `dte-category-detail.page.ts` - `ionViewWillEnter()` now clears caches and reloads for WEBAPP mode

**Applied to Other Templates:**
Same fixes applied to HUD, LBW, and EFE webapp templates.

---

# RESOLVED ISSUES: 25 | OPEN ISSUES: 1

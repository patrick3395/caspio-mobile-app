# Web Issues Tracking

This document tracks web-specific issues and their solutions across the webapp templates.

---

## Issue #1: Image Loading Shimmer Effect Consistency

**Date Identified:** 2026-01-30

**Status:** Resolved

### Description
When adding/loading images in templates, a shimmer effect should display over images while they load. This provides visual feedback that content is loading. LBW template has this implemented correctly, but other templates (DTE, HUD, Engineers-Foundation) need the same treatment.

### Expected Behavior
- When an image is uploading: Show shimmer overlay with reduced image opacity
- When an image is loading from remote: Show shimmer overlay
- Smooth 1.5s ease-in-out animation for shimmer effect
- Consistent look across all templates

### LBW Implementation Reference

**1. CSS Shimmer Animation (in SCSS files):**
```scss
// Shimmer animation for loading states
@keyframes image-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

&.uploading,
&.loading-image {
  position: relative;

  // Shimmer overlay
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 16px;
    background: linear-gradient(90deg,
      rgba(240, 240, 240, 0.1) 25%,
      rgba(255, 255, 255, 0.4) 50%,
      rgba(240, 240, 240, 0.1) 75%
    );
    background-size: 200% 100%;
    animation: image-shimmer 1.5s ease-in-out infinite;
    z-index: 5;
    pointer-events: none;
  }

  img {
    opacity: 0.7;
  }
}
```

**2. HTML Classes Applied:**
```html
<div class="image-preview structural-photo-preview"
     [class.uploading]="photo.uploading"
     [class.loading-image]="photo.loading">
```

**3. TypeScript Photo States:**
- `photo.uploading` - Image is being uploaded
- `photo.loading` - Image is loading from remote
- `photo.displayState === 'remote_loading'` - Alternative loading state check

### Templates to Update
- [x] DTE (dte-category-detail, dte-visual-detail)
- [x] HUD (hud-category-detail, hud-visual-detail)
- [x] Engineers-Foundation (category-detail, visual-detail in structural-systems)

### Solution Attempts

#### Attempt 1 (2026-01-30)
**Approach:** Review existing implementations in each template and add missing shimmer CSS/HTML classes

**Files Updated:**

**SCSS Files (added shimmer animation and overlay):**
- `src/app/pages/dte/dte-category-detail/dte-category-detail.page.scss`
- `src/app/pages/dte/dte-visual-detail/dte-visual-detail.page.scss`
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.scss`
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.scss`
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.scss`
- `src/app/pages/engineers-foundation/structural-systems/visual-detail/visual-detail.page.scss`

**HTML Files (added `[class.loading-image]` binding):**
- `src/app/pages/dte/dte-category-detail/dte-category-detail.page.html`
- `src/app/pages/dte/dte-visual-detail/dte-visual-detail.page.html`
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.html`
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.html`
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.html`
- `src/app/pages/engineers-foundation/structural-systems/visual-detail/visual-detail.page.html`

**Changes Made:**

1. **SCSS**: Replaced simple `opacity: 0.6` loading style with full shimmer effect:
   - Added `@keyframes image-shimmer` animation
   - Added `&.uploading, &.loading-image` selector with:
     - `::before` pseudo-element shimmer overlay
     - Gradient animation (1.5s ease-in-out infinite)
     - `z-index: 5` to show over image
     - `pointer-events: none` to allow click-through

2. **HTML**: Added `[class.loading-image]="photo.loading"` binding to photo div elements

**Result:** SUCCESS - All templates now have consistent shimmer effect matching LBW

---

## Issue #2: Gallery Images Disappear After Page Reload (WEBAPP)

**Date Identified:** 2026-01-30

**Status:** Resolved

### Description
When adding gallery images in WEBAPP mode, the image uploads successfully and shows "synced" on the backend (Caspio database), but after reloading the page, the images disappear. This is caused by the `visualId` (lbwId/hudId/dteId) not being properly restored from Dexie when query params are missing or empty on page reload.

### Expected Behavior
- When user adds an image in visual-detail page, it should upload with the correct visualId
- After page reload, images should still be visible
- The visualId used for photo retrieval should match the one used during upload

### Actual Behavior
- Image uploads successfully with correct visualId
- Page reload loses the visualId from query params
- Visual lookup falls back to Priority 2/3 (TemplateID or Name+Category matching) which may find a different visual record
- Photo query uses the wrong visualId, returning no results

### Root Cause Analysis
1. When navigating from category-detail to visual-detail, the `visualId` is passed as a query parameter (e.g., `?lbwId=123`)
2. On page reload, if query params are lost/empty, `loadVisualData()` sets `lbwIdFromQueryParams` to empty string
3. The visual lookup tries Priority 2 (TemplateID) or Priority 3 (Name+Category) which might find a different visual
4. `this.lbwId` is set from the found visual's LBWID, which may be different from the original
5. Photo query returns empty because photos are attached to a different LBWID

### Templates Affected
- [x] LBW (lbw-visual-detail)
- [x] HUD (hud-visual-detail)
- [x] DTE (dte-visual-detail)
- [ ] Engineers-Foundation (uses different approach - service mapping)

### Solution Attempts

#### Attempt 1 (2026-01-30)
**Approach:** Read stored `visualId` from Dexie when query params are empty

**Files Updated:**
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`
- `src/app/pages/hud/hud-visual-detail/hud-visual-detail.page.ts`
- `src/app/pages/dte/dte-visual-detail/dte-visual-detail.page.ts`

**Changes Made:**
Added code in `loadVisualData()` to restore visualId from Dexie when query params are empty:

```typescript
// WEBAPP FIX: If query params don't have lbwId, try to read from Dexie
// This ensures photos are found after page reload even if query params were lost
if (environment.isWeb && !lbwIdFromQueryParams && this.serviceId && this.templateId) {
  try {
    // Key format: ${serviceId}_${category}_${templateId}
    const fieldKey = `${this.serviceId}_${this.categoryName}_${this.templateId}`;
    const dexieField = await this.visualFieldRepo.getField(fieldKey);
    if (dexieField?.visualId) {
      lbwIdFromQueryParams = dexieField.visualId;
      this.lbwId = dexieField.visualId;
      console.log('[LbwVisualDetail] WEBAPP: Restored lbwId from Dexie:', lbwIdFromQueryParams);
    }
  } catch (e) {
    console.warn('[LbwVisualDetail] WEBAPP: Could not restore lbwId from Dexie:', e);
  }
}
```

**How It Works:**
1. When a photo is uploaded, the visualId is already saved to Dexie at lines 309-319 in lbw-visual-detail
2. On page reload with empty query params, we now read from Dexie using the field key
3. The stored visualId is used for photo retrieval, ensuring photos are found

**Result:** FAILED - Images still disappear after page reload. The Dexie restore approach didn't solve the issue.

#### Attempt 2 (2026-01-30)
**Approach:** Preserve query param lbwId even when visual lookup finds a different record

**Root Cause Hypothesis:**
The visual lookup (Priority 2/3) may find a different visual record than the one photos were uploaded to. When this happens, `this.lbwId` is overwritten with the wrong value, causing photo retrieval to fail.

**Files Updated:**
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

**Changes Made:**
1. Added detailed debug logging for upload and retrieval lbwId values
2. Added mismatch detection: if query param lbwId differs from found visual's LBWID, keep using the query param value
3. Added console warnings to identify when mismatches occur

**Code Change:**
```typescript
// WEBAPP FIX: If we had lbwId from query params, ALWAYS use that for photo queries
// This prevents photos from disappearing when visual lookup finds a different record
if (lbwIdFromQueryParams && lbwIdFromQueryParams !== visualLbwId) {
  console.log('[LbwVisualDetail] WEBAPP: ⚠️ MISMATCH DETECTED - Query param lbwId:', lbwIdFromQueryParams, '!= Visual LBWID:', visualLbwId);
  console.log('[LbwVisualDetail] WEBAPP: Using query param lbwId for photo queries to preserve photos');
  this.lbwId = lbwIdFromQueryParams;
} else {
  this.lbwId = visualLbwId;
}
```

**Debug Logging Added:**
- `[LbwVisualDetail] WEBAPP: ⚠️ UPLOAD DEBUG - Using lbwId: X for photo upload`
- `[LbwVisualDetail] WEBAPP: ⚠️ RETRIEVAL DEBUG - About to load photos with lbwId: X`
- `[LbwVisualDetail] WEBAPP: ⚠️ MISMATCH DETECTED` - Shows when query param differs from visual lookup

**Testing Instructions:**
1. Open browser console (F12 -> Console tab)
2. Navigate to LBW visual-detail page and add a photo via Gallery
3. Note the lbwId shown in "UPLOAD DEBUG" log
4. Reload the page
5. Check "RETRIEVAL DEBUG" log - the lbwId should match the upload lbwId
6. If "MISMATCH DETECTED" appears, that indicates the root cause

**Result:** FAILED - Debug logging helped identify HUD attachment data appearing on LBW page (see Attempt 3).

#### Attempt 3 (2026-01-30)
**Approach:** Investigated confusing variable naming in lbw-category-detail

**Initial Hypothesis (INCORRECT):**
Console logs showed `{HUDID: 114, Annotation: "",…}` on LBW page reload, suggesting HUD data was being loaded.

**Investigation Finding:**
The variable `hudData` in `lbw-category-detail.page.ts` is **confusingly named but correctly typed** as `LbwDataService`:
```typescript
constructor(
  ...
  private hudData: LbwDataService,  // Confusing name but correct type!
  ...
)
```

The service `LbwDataService.getVisualAttachments()` correctly queries `LPS_Services_LBW_Attach` table via `caspioService.getServiceLBWAttachByLBWId()`.

**Attempted Fix (REVERTED):**
Initially changed `this.hudData.getVisualAttachments()` to `this.lbwData.getVisualAttachments()` but this caused TypeScript errors because `lbwData` doesn't exist as a property.

**Current Status:**
- Reverted to original `this.hudData.getVisualAttachments()` which is correct
- Added type annotation `(a: any)` to fix implicit any error at line 2100
- The source of `{HUDID: 114...}` payload in console still needs investigation

**Files Updated:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts` (minor type fix)

**Open Questions:**
1. Where is the `{HUDID: 114...}` console output coming from?
2. Is there browser caching of previous API responses?
3. Is there an issue in the API/proxy layer?
4. Could there be a different code path loading HUD data?

**Result:** NEEDS FURTHER INVESTIGATION - Variable naming was a red herring

#### Attempt 4 (2026-01-30)
**Approach:** Fix cache bypass for WEBAPP mode - CaspioService was returning stale data

**Root Cause Identified:**
User confirmed caching issue - deleted LBW visuals still showing in system. Network tab showed:
- `records?q.where=LBWID=463` (OLD/DELETED record being queried)
- `records?q.where=LBWID=464` (CORRECT record)

The issue was multi-layered:
1. **CaspioService cache**: `get()` method defaults to `useCache: true`, so API responses were cached
2. **Dexie visualFields**: Stored stale `visualId` values that pointed to deleted records

**Files Updated:**

1. **`src/app/services/caspio.service.ts`**
   - Added `bypassCache` parameter to `getServicesLBWByServiceId()`
   - Added `bypassCache` parameter to `getServiceLBWAttachByLBWId()`

2. **`src/app/services/offline-template.service.ts`**
   - WEBAPP mode now calls `getServicesLBWByServiceId(serviceId, true)` to bypass cache

3. **`src/app/pages/lbw/lbw-data.service.ts`**
   - WEBAPP mode now calls `getServiceLBWAttachByLBWId(lbwIdStr, true)` to bypass cache

4. **`src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`**
   - `mergeDexieVisualFields()` now skips setting visualId from Dexie in WEBAPP mode
   - Server data is now source of truth for visualIds

5. **`src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`**
   - Removed Dexie restore for lbwId in WEBAPP mode (was restoring stale values)
   - Simplified lbwId assignment to always use server data

**Changes Made:**

```typescript
// CaspioService - added bypassCache parameter
getServicesLBWByServiceId(serviceId: string, bypassCache: boolean = false): Observable<any[]> {
  return this.get<any>(`/tables/LPS_Services_LBW/records?...`, !bypassCache).pipe(...);
}

// WEBAPP mode now bypasses cache
const freshLbw = await firstValueFrom(this.caspioService.getServicesLBWByServiceId(serviceId, true));
```

**Why This Fixes The Issue:**
1. WEBAPP mode now always fetches fresh data from server (no cached stale data)
2. Dexie visualFields no longer override server visualIds in WEBAPP mode
3. Deleted records won't appear because they're not in fresh server response
4. Photo queries use correct LBWID from server data

**Result:** PARTIAL - Cache bypass implemented, additional fixes needed

#### Attempt 5 (2026-01-30)
**Approach:** Fix visual matching and add fallback in lbw-visual-detail

**Root Cause Hypothesis:**
Even with cache bypass, the visual matching (Priority 2/3) might fail to find the correct visual record, leaving `this.lbwId` empty and photos unable to load.

**Issues Fixed:**

1. **Type mismatch in TemplateID comparison**
   - Priority 2 was using strict equality (`===`) for TemplateID matching
   - If one is a number and one is string, matching fails
   - Fixed by converting both to strings before comparison

2. **Added Priority 4 fallback**
   - If Priority 1-3 all fail but we have visuals in the category, use the most recent one
   - This ensures photos are found even if matching logic fails

**Files Updated:**
- `src/app/pages/lbw/lbw-visual-detail/lbw-visual-detail.page.ts`

**Changes Made:**
```typescript
// Priority 2 - Fixed type comparison
const templateIdToMatch = String(template.TemplateID || template.PK_ID);
visual = lbwRecords.find((v: any) =>
  String(v.LBWTemplateID) === templateIdToMatch ||
  String(v.VisualTemplateID) === templateIdToMatch ||
  String(v.TemplateID) === templateIdToMatch
);

// Priority 4 - New fallback for WEBAPP
if (!visual && template) {
  const categoryVisuals = lbwRecords.filter((v: any) => v.Category === template.Category);
  if (categoryVisuals.length > 0) {
    // Use most recent visual in category
    visual = categoryVisuals.sort((a, b) => b.LBWID - a.LBWID)[0];
  }
}
```

**Result:** PENDING USER TESTING

#### Attempt 6 (2026-01-30)
**Approach:** Fix key mismatch in lbw-category-detail - photos stored with item.id but looked up with templateId

**Root Cause Identified:**
Console logs showed:
```
[LBW] WEBAPP: Stored 1 photos for key Target wall_676
```
But `getPhotosForVisual()` was looking up with key `Target wall_454` (using templateId instead of item.id).

The issue was:
1. `loadExistingVisuals()` stores keys using `${category}_${item.id}` (e.g., "Target wall_676")
2. `loadPhotosFromAPI()` uses keys from `visualRecordIds`, so photos stored at same keys
3. But `getPhotosForVisual()` was building keys using `${category}_${templateId}` (e.g., "Target wall_454")
4. Since item.id (676) !== templateId (454), photo lookup returned empty array

**Files Updated:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Functions Fixed (WEBAPP mode now uses itemId directly):**
1. `getPhotosForVisual()` - photo retrieval
2. `isLoadingPhotosForVisual()` - loading state check
3. `getSkeletonArray()` - skeleton placeholder generation
4. `isUploadingPhotos()` - upload state check
5. `getUploadingCount()` - upload count
6. `getTotalPhotoCount()` - total photo count
7. `isItemSelected()` - selection state check
8. `isItemSaving()` - saving state check
9. `createVisualRecord()` - visual record creation
10. `deleteVisualRecord()` - visual record deletion
11. `addPhotoFromGallery()` - gallery upload
12. Camera upload function (handleFileInputChange context)
13. `viewPhoto()` - photo annotator
14. `deletePhoto()` - photo deletion

**Code Change Pattern:**
```typescript
// BEFORE (inconsistent - uses templateId for key):
const item = this.findItemById(itemId);
const templateId = item?.templateId ?? itemId;
const key = `${category}_${templateId}`;

// AFTER (WEBAPP uses itemId to match storage pattern):
const item = this.findItemById(itemId);
const key = environment.isWeb
  ? `${category}_${itemId}`
  : `${category}_${item?.templateId ?? itemId}`;
```

**Why This Fixes The Issue:**
1. Photos are stored with key `${category}_${item.id}` in `loadExistingVisuals` and `loadPhotosFromAPI`
2. Now all photo operations use the same key pattern in WEBAPP mode
3. Template calls functions with `item.id`, so using `itemId` directly gives correct key
4. MOBILE mode still uses `templateId` to match Dexie lookup pattern

**Result:** SUCCESS - User confirmed fix works. Images now persist after page reload in WEBAPP mode.

**Note:** HUD, DTE, and Engineers-Foundation templates were already using the correct `itemId` pattern - no changes needed. LBW was the only template with the templateId lookup bug.

---

## Issue #3: Multi-Select Photo Upload - First Photo Disappears (WEBAPP)

**Date Identified:** 2026-01-30

**Status:** Resolved

### Description
When adding a multi-select option and then adding a photo in the multi-select, the photo shows briefly and then immediately disappears. When doing it a second time, the photo uploads and appears in the UI correctly. After page refresh, both photos are visible (correct).

### Expected Behavior
- Select a multi-select option
- Click Gallery to add a photo
- Photo should upload and remain visible immediately

### Actual Behavior
- Select a multi-select option
- Click Gallery to add a photo
- Photo appears briefly then disappears
- Second attempt works correctly
- Page refresh shows both photos

### Root Cause
The `onOptionToggle` function (and related multi-select functions) was using `item.templateId` for building keys, but the photo functions (fixed in Issue #2) use `item.id`. This caused a key mismatch:

1. User selects multi-select option → `onOptionToggle` stores: `visualRecordIds["Target wall_454"]` (using templateId)
2. User clicks Gallery (HTML passes `item.id`) → `addPhotoFromGallery` looks for: `visualRecordIds["Target wall_676"]` (using item.id) - NOT FOUND!
3. `addPhotoFromGallery` creates a NEW visual record at the wrong key
4. Photo stored at different key, then disappears when state updates

### Solution

**Files Updated:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Functions Fixed (WEBAPP mode now uses item.id for keys):**
1. `onOptionToggle()` - multi-select option toggle
2. `addMultiSelectOther()` - custom "Other" option addition
3. `onAnswerChange()` - Yes/No answer changes
4. `toggleItemSelection()` - checkbox item selection
5. `openVisualDetail()` - navigation to visual detail page

**Code Change Pattern:**
```typescript
// BEFORE (inconsistent - uses item.templateId):
const key = `${actualCategory}_${item.templateId}`;

// AFTER (WEBAPP uses item.id to match photo functions):
const key = environment.isWeb
  ? `${actualCategory}_${item.id}`
  : `${actualCategory}_${item.templateId}`;
```

**Result:** SUCCESS - All visual/selection functions now use the same key pattern as photo functions in WEBAPP mode, preventing key mismatches.

**Cross-Template Standardization (2026-01-30):**
Applied the same WEBAPP fix to HUD template for consistency:

**HUD Functions Fixed:**
1. `onAnswerChange()` - Yes/No answer changes
2. `onOptionToggle()` - multi-select option toggle
3. `addMultiSelectOther()` - custom "Other" option addition
4. `openVisualDetail()` - navigation to visual detail page

**Templates Already Correct (no changes needed):**
- **DTE** - Already uses `item.id` consistently in all functions
- **Engineers-Foundation** - Already uses `item.id` consistently in all functions

**Result:** All WEBAPP templates now use consistent `item.id` key pattern for visual/selection/photo operations.

---

## Issue #4: Multi-Select Shows "Custom Item" Title After Page Reload (WEBAPP)

**Date Identified:** 2026-01-30

**Status:** In Progress

### Description
In the LBW WEBAPP, when adding a multi-select item, the backend correctly stores the TemplateID. However, after page reload, the title displays as "Custom Item" instead of the actual template name.

### Expected Behavior
- Select multi-select options
- Page stores visual with correct TemplateID
- After page reload, the multi-select item shows its original template name

### Actual Behavior
- Select multi-select options
- Page stores visual with correct TemplateID
- After page reload, item shows "Custom Item" as title

### Root Cause
In `loadExistingVisuals()`, the matching logic had:
1. **Priority 1**: In-memory mappings (empty on fresh page load)
2. **Priority 2**: Match by `visual.Name === item.name`

For multi-select items, the visual's Name may not exactly match the template name (especially if the Name field stores something different). Without a TemplateID match, the visual falls through to "Custom Item" creation.

### Solution Attempts

#### Attempt 1 (2026-01-30)
**Approach:** Added Priority 3 TemplateID matching in `loadExistingVisuals()`

**Code Added:**
```typescript
// WEBAPP FIX - PRIORITY 3: Match by TemplateID
const visualTemplateId = visual.LBWTemplateID || visual.VisualTemplateID || visual.TemplateID;
if (!item && environment.isWeb && visualTemplateId) {
  const templateIdToMatch = String(visualTemplateId);
  item = allItems.find(i => String(i.templateId) === templateIdToMatch);
}
```

**Result:** FAILED - User reported issue persists after page reload.

#### Attempt 2 (2026-01-30)
**Approach:** Multiple fixes to address potential race conditions and matching issues

**Fixes Applied:**

1. **Fixed race condition in WEBAPP ionViewWillEnter:**
   - Added `this.initialLoadComplete` flag check to prevent `loadExistingVisuals()` from running before templates are loaded
   - Added `initialLoadComplete = true` at end of WEBAPP `loadData()` path

2. **Enhanced Priority 3 TemplateID matching:**
   - Added `FK_Template` as another possible field name (used in validation service)
   - Now checks: `visual.LBWTemplateID || visual.VisualTemplateID || visual.TemplateID || visual.FK_Template`

3. **Added case-insensitive Priority 2 Name matching:**
   - First tries exact match: `i.name === visual.Name`
   - Falls back to case-insensitive: `i.name.toLowerCase() === visual.Name.toLowerCase()`

4. **Added comprehensive debug logging for custom item fallback:**
   - Logs ALL fields of visual when creating custom item
   - Logs available template items for comparison
   - This will help identify why matching is failing

**Files Updated:**
- `src/app/pages/lbw/lbw-category-detail/lbw-category-detail.page.ts`

**Changes Made:**
```typescript
// 1. WEBAPP ionViewWillEnter now checks initialLoadComplete
if (environment.isWeb && this.serviceId && this.categoryName && this.initialLoadComplete) {
  await this.loadExistingVisuals(false);
}

// 2. Set initialLoadComplete after WEBAPP loadData completes
this.loading = false;
this.initialLoadComplete = true;

// 3. Enhanced Priority 3 with FK_Template
const visualTemplateId = visual.LBWTemplateID || visual.VisualTemplateID || visual.TemplateID || visual.FK_Template;

// 4. Case-insensitive Priority 2 matching
if (!item && visualName) {
  item = allItems.find(i => (i.name || '').trim().toLowerCase() === visualName);
}

// 5. Debug logging for custom item fallback
console.log('[LOAD EXISTING] VISUAL ALL FIELDS:', JSON.stringify(visual, null, 2));
console.log('[LOAD EXISTING] AVAILABLE TEMPLATES:', allItems.map(i => ({name, id, templateId, answerType})));
```

**Testing Instructions:**
1. Open browser console (F12 -> Console)
2. Add a multi-select item and select some options
3. Reload the page
4. Look for `[LOAD EXISTING]` logs to see:
   - What fields the visual has
   - Why Priority 2 (Name matching) failed
   - Why Priority 3 (TemplateID matching) failed
   - What the available templates are

**Result:** PENDING USER TESTING - User should check console logs to identify root cause.

---

## Issue Template

### Issue #X: [Title]

**Date Identified:** YYYY-MM-DD

**Status:** Open | In Progress | Resolved | Won't Fix

### Description
[Detailed description of the issue]

### Expected Behavior
[What should happen]

### Actual Behavior
[What is happening]

### Solution Attempts

#### Attempt N (YYYY-MM-DD)
**Approach:** [Description of approach]
**Result:** [Success/Failure and notes]

---

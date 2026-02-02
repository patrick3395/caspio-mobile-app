# Attempts to Fix HUD Visual Detail Save Issue

## Status: RESOLVED (Attempt 3)

## Attempt 1: Added HUDTemplateID to createVisual calls
**Date:** Current session
**Hypothesis:** Visual records weren't being found because they lacked HUDTemplateID field for lookup
**Changes Made:**
- Added `HUDTemplateID: item.templateId` to all `createVisual` visualData objects in `hud-category-detail.page.ts`

**Result:** FAILED - User reported this breaks the API because HUDTemplateID field doesn't exist in LPS_Services_HUD table

**Reverted:** Yes - removed all HUDTemplateID additions

---

## Attempt 2: Changed visual lookup to use Name + Category
**Date:** Current session
**Hypothesis:** Visual lookup was failing because it tried to match by HUDTemplateID (doesn't exist)
**Changes Made:**

### In `hud-visual-detail.page.ts`:
- Removed lookup by `v.HUDTemplateID || v.TemplateID`
- Changed to match by `v.Name === template.Name && v.Category === template.Category`
- Optimized to reuse already-loaded template instead of loading twice
- Fixed `visual.Answer` to `visual.Answers` (correct field name)

### In `hud-category-detail.page.ts`:
- Removed lookup by `v.HUDTemplateID || v.VisualTemplateID || v.TemplateID`
- Changed to match by `v.Name === templateName && v.Category === templateCategory`

**Result:** FAILED - User reports save still not working (green banner shows but backend not updated)

**Reverted:** No - changes kept as they align with EFE pattern

---

## Attempt 3: Fix ServiceID mismatch between route param and HUD FK
**Date:** Current session
**Hypothesis:** Visual-detail queries HUD records using `serviceId` from route params (which is `PK_ID` from Services table), but HUD records are stored with `ServiceID` field as the foreign key. Category-detail correctly handles this by loading the service record to get `actualServiceId`, but visual-detail was not doing this.

**Root Cause Discovery:**
- Console log showed `getHudByService(645)` returned 0 records
- But category-detail found HUDID 114 for the same visual
- Category-detail uses `this.actualServiceId || this.serviceId` for queries
- Visual-detail only used `this.serviceId` (which is PK_ID, not the FK)
- The HUD records are stored with `ServiceID` field, not `PK_ID`

**Changes Made:**

### In `hud-category-detail.page.ts`:
- Updated `openVisualDetail()` to pass `actualServiceId` in query params:
```typescript
{ queryParams: { hudId: hudId, actualServiceId: this.actualServiceId || this.serviceId } }
```

### In `hud-visual-detail.page.ts`:
- Added `actualServiceId` property
- Extract `actualServiceId` from query params in `loadRouteParams()`
- Changed HUD query to use `actualServiceId || serviceId`:
```typescript
const queryServiceId = this.actualServiceId || this.serviceId;
const hudRecords = await this.hudData.getHudByService(queryServiceId);
```
- Updated all `updateVisual()` calls to use `actualServiceId || serviceId`

**Result:** SUCCESS - Backend now updates correctly when editing Title/Text fields

---

## New Issue Discovered

After fixing the save issue, a new problem was identified: After changing the Text field and reloading the page, the visual appears deselected. This is tracked in the ISSUE file under "HUD Visual Deselected After Reload When Text is Changed".

---

## Debugging Steps Needed

### 1. Verify hudId is being set during page load
Add console.log in visual-detail after visual lookup:
```typescript
console.log('[DEBUG] Visual found:', !!visual);
console.log('[DEBUG] this.hudId after load:', this.hudId);
```

### 2. Verify hudId is valid when saving
Add console.log in saveTitle/saveText:
```typescript
console.log('[DEBUG] this.hudId at save time:', this.hudId);
console.log('[DEBUG] isValidHudId result:', this.isValidHudId(this.hudId));
```

### 3. Verify API call is being made
Check browser Network tab for PUT request to:
`/api/caspio-proxy/tables/LPS_Services_HUD/records?q.where=HUDID=XXX`

### 4. Verify API response
Check if the PUT request returns success and actually updates records

### 5. Check category-detail visualRecordIds
Add console.log when navigating:
```typescript
console.log('[DEBUG] visualRecordIds:', this.visualRecordIds);
console.log('[DEBUG] key being looked up:', key);
console.log('[DEBUG] hudId found:', hudId);
```

---

## Questions to Answer
1. Is the visual being found during visual-detail page load?
2. Is `this.hudId` being set to a valid value?
3. Is `isValidHudId()` returning true?
4. Is the API call being made (check Network tab)?
5. What is the API response?
6. Does the HUDID in the API call match an actual record in the database?

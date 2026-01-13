# PRD: Sync and Image Caching Bug Fixes

## Overview
Fix three related bugs affecting image display and sync functionality in the mobile app, causing data loss and degraded user experience.

## Priority
**High** - Users experiencing data loss/corruption

## Bug Descriptions

### Bug #1: Elevation Plot Images Disappear on Navigation
**Location:** `src/app/pages/engineers-foundation/room-elevation/room-elevation.page.ts`

**Problem:** Elevation Plot images disappear when users navigate away from the page and return while a sync is in progress. The images are lost from view even though they exist in storage.

**Root Cause:** Missing caching and lifecycle management that exists in the Structural Systems section.

**Solution:** Implement the same pattern used in Structural Systems:
- Use LocalImageService for caching blob URLs
- Use IndexedDB for offline persistence
- Add proper lifecycle hooks (ionViewWillEnter/ionViewDidEnter) to restore images on navigation return

**Reference Implementation:** Copy pattern from structural-systems page component

---

### Bug #2: FDF Photos Not Syncing
**Location:** Investigate both `background-sync.service.ts` and any dedicated FDF service files

**Problem:** FDF photos appear in the sync queue but never actually sync to the server. Clicking "Sync Now" has no effect.

**Root Cause:** Unknown - requires investigation of:
- FDF entity handling in background-sync.service.ts
- Any dedicated FDF sync logic
- Queue processing for FDF photo type

**Solution:** TBD after investigation - likely missing or broken sync handler for FDF photos

---

### Bug #3: FDF Captions Stuck in Sync Queue
**Location:** Same as Bug #2

**Problem:** FDF captions (stored as metadata on photo records) remain stuck in the sync queue indefinitely.

**Dependency:** This bug depends on Bug #2 being fixed first, as captions are part of the photo record sync.

**Solution:** Will be resolved as part of Bug #2 fix, or may require additional caption-specific handling after photo sync works.

---

## Technical Approach

### Bug #1 Implementation Steps
1. Review structural-systems page implementation for caching pattern
2. Add LocalImageService integration to room-elevation.page.ts
3. Implement IndexedDB caching for elevation plot images
4. Add ionViewWillEnter lifecycle hook to restore cached images
5. Ensure blob URLs are properly managed and cleaned up

### Bug #2 Investigation & Fix Steps
1. Search for FDF sync handling in background-sync.service.ts
2. Identify any dedicated FDF service files
3. Trace the sync queue processing for FDF entity type
4. Identify why "Sync Now" action fails to trigger sync
5. Implement fix based on findings

### Bug #3 Fix Steps
1. Verify fix after Bug #2 is complete
2. If captions still don't sync, investigate caption-specific handling
3. Ensure photo metadata (including captions) is included in sync payload

---

## Files to Modify
- `src/app/pages/engineers-foundation/room-elevation/room-elevation.page.ts`
- `src/app/services/background-sync.service.ts` (likely)
- `src/app/services/local-image.service.ts` (possibly)
- `src/app/services/indexed-db.service.ts` (possibly)
- Additional FDF-related service files (TBD after investigation)

## Testing
- Manual testing on device
- Test scenarios:
  1. **Bug #1:** Navigate to Elevation Plot, add/view images, navigate away, return - images should persist
  2. **Bug #2:** Add FDF photo, trigger sync, verify photo uploads to server
  3. **Bug #3:** Add FDF photo with caption, sync, verify caption appears on server

## Success Criteria
1. Elevation Plot images remain visible after navigation round-trip during sync
2. FDF photos successfully sync when "Sync Now" is clicked
3. FDF captions sync along with their associated photos
4. No items stuck indefinitely in sync queue

## Out of Scope
- Local testing/builds (per project requirements)
- Automated unit tests
- Other sync-related issues not listed above
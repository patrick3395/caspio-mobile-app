# Elevation Plot Dexie-First Implementation Plan

## Overview

This document outlines the step-by-step implementation of Dexie-first architecture for the Elevation Plot sections (`elevation-plot-hub` and `room-elevation`). Each step is intentionally small to catch issues early and includes debugging checkpoints.

**Key Lessons from Structural Systems Implementation:**
- ID mismatches (temp_visual_xxx vs real IDs like "1107") caused photos to disappear
- Always check BOTH temp and real IDs when looking up photos
- Store temp-to-real ID mappings during sync for photo restoration on reload
- Use `alert()` for debugging on mobile (not `console.log`)

---

## CRITICAL: Mobile vs Web IndexedDB Differences

**Discovered during Phase 1 implementation - January 2025:**

The liveQuery subscription was failing on **mobile only** with:
```
UnknownError: An internal error was encountered in the IndexedDB server
```

### Root Cause: Race Condition in Operation Order

**Original (broken) order:**
1. Subscribe to liveQuery
2. `await loadElevationPoints()` - runs AFTER subscription created
3. liveQuery fires BEFORE data is ready → IndexedDB conflict on mobile

**Fixed order (matches working Structural Systems pattern):**
1. `await loadElevationPoints()` - load ALL data first
2. THEN subscribe to liveQuery - for reactive updates only
3. No concurrent operations → no conflict

### Key Implementation Rules for Mobile Compatibility

1. **Load data BEFORE subscribing to liveQuery**
   - Structural Systems: `initializeVisualFields()` loads data, THEN subscribes
   - Room-Elevation must follow same pattern

2. **Use simple indexes over compound indexes in liveQuery**
   - Compound index `[serviceId+roomName]` caused issues
   - Simple `key` index (format: `serviceId:roomName`) is more reliable
   - Non-reactive queries with compound indexes work fine

3. **Avoid async/await inside liveQuery callback**
   - Working: `liveQuery(() => this.table.where(...).first())`
   - Problematic: `liveQuery(async () => { await ... })`

4. **Set loading flags after data operations complete**
   - `isLoadingPoints = false` must be set in Dexie path
   - UI waits for this flag before rendering inputs

---

## Phase 1: Room-Elevation Basic Dexie Read (COMPLETED WITH FIXES)

### Step 1.1: Remove Debug Alerts ✅
- Remove all existing US-004 debug alerts from room-elevation.page.ts
- **Debugging:** Verify no alerts appear when navigating to rooms

### Step 1.2: Add Dexie Subscription Property ✅
- Add `efeFieldSubscription` property
- Add `efeFieldSeeded` flag
- **Debugging:** Verify properties exist (no compile errors)

### Step 1.3: Create initializeFromDexie() Method ✅ (WITH CRITICAL FIXES)
- Create method that reads from `efeFieldRepo.getFieldByRoom()`
- Falls back to `loadRoomData()` if room not in Dexie
- **CRITICAL FIX:** Populate `roomData` immediately from `existingField` before subscribing

**Correct Implementation Pattern:**
```typescript
private async initializeFromDexie(): Promise<void> {
  // 1. Get field from Dexie (non-reactive, one-time read)
  const existingField = await this.efeFieldRepo.getFieldByRoom(serviceId, roomName);

  if (!existingField) {
    await this.loadRoomData();  // Fallback
    return;
  }

  // 2. Populate roomData IMMEDIATELY (before any subscriptions)
  this.roomData = {
    roomName: existingField.roomName,
    // ... populate from existingField
  };

  // 3. Load elevation points FIRST (before liveQuery subscription)
  await this.loadElevationPoints();
  this.isLoadingPoints = false;  // CRITICAL: UI waits for this

  // 4. THEN subscribe to liveQuery for reactive updates ONLY
  this.efeFieldSubscription = this.efeFieldRepo
    .getFieldByRoom$(serviceId, roomName)
    .subscribe({
      next: (field) => { /* Update roomData reactively */ },
      error: (err) => { /* Non-fatal - initial data already loaded */ }
    });
}
```

### Step 1.4: Wire Up ngOnInit ✅
- Replace `loadRoomData()` with `initializeFromDexie()` in ngOnInit
- **Debugging:** Verify room loads (may be slow if fallback is used)

### Issues Fixed in Phase 1:

| Issue | Symptom | Fix |
|-------|---------|-----|
| liveQuery fails on mobile | IndexedDB internal error | Load data BEFORE subscribing |
| Blank screen after liveQuery error | roomData never populated | Populate roomData from existingField immediately |
| Infinite loading spinner | isLoadingPoints never set false | Set `isLoadingPoints = false` after loadElevationPoints() |

---

## Phase 2: Ensure EfeField is Populated (Seeding)

### Step 2.1: Check elevation-plot-hub Seeding
**Goal:** Verify EfeFields are seeded when entering elevation-plot-hub

**Files:** `elevation-plot-hub.page.ts`

**Changes:**
1. Check if `efeFieldRepo.seedFromTemplates()` is called
2. Check if `efeFieldRepo.mergeExistingRooms()` is called after API data loads

**Debugging:**
```typescript
alert(`[SEED DEBUG] EfeFields seeded: ${await this.efeFieldRepo.hasFieldsForService(this.serviceId)}`);
```

### Step 2.2: Verify Seeding Creates Correct Data
**Goal:** Ensure seeded EfeFields have correct structure

**Debugging:**
```typescript
const fields = await this.efeFieldRepo.getFieldsForService(this.serviceId);
alert(`[SEED DEBUG] Fields count: ${fields.length}\n` +
  `First room: ${fields[0]?.roomName}\n` +
  `Has efeId: ${!!fields[0]?.efeId}\n` +
  `Has tempEfeId: ${!!fields[0]?.tempEfeId}`);
```

---

## Phase 3: Room-Elevation Write-Through

### Step 3.1: Notes Field Write-Through
**Goal:** When user types in notes, immediately write to Dexie

**Files:** `room-elevation.page.ts`

**Changes:**
1. In `onNotesChange()` or similar, call `efeFieldRepo.setRoomNotes()`
2. Debounce to avoid excessive writes (300ms)

**Debugging:**
```typescript
alert(`[WRITE DEBUG] Notes saved to Dexie: ${notes.substring(0, 30)}...`);
```

### Step 3.2: FDF Dropdown Write-Through
**Goal:** When user selects FDF option, immediately write to Dexie

**Changes:**
1. In FDF change handler, call `efeFieldRepo.setRoomFdf()`

**Debugging:**
```typescript
alert(`[WRITE DEBUG] FDF saved to Dexie: ${fdfValue}`);
```

### Step 3.3: Location Field Write-Through
**Goal:** When user types location, immediately write to Dexie

**Changes:**
1. In location change handler, call `efeFieldRepo.setRoomLocation()`

**Debugging:**
```typescript
alert(`[WRITE DEBUG] Location saved to Dexie: ${location}`);
```

### Step 3.4: Point Value Write-Through
**Goal:** When user enters elevation point value, immediately write to Dexie

**Changes:**
1. In point value change handler, call `efeFieldRepo.setPointValue()`

**Debugging:**
```typescript
alert(`[WRITE DEBUG] Point ${pointNumber} value saved: ${value}`);
```

---

## Phase 4: Photo Population from Dexie (CRITICAL)

### Step 4.1: Create populatePhotosFromDexie() Method
**Goal:** Load photos from LocalImages table, matching by entityId

**Files:** `room-elevation.page.ts`

**Key Considerations:**
- Photos are stored in `LocalImages` table with `entityId` = point ID
- Must check BOTH `pointId` (real) AND `tempPointId` (temp)
- Must also check `tempIdMappings` table for temp-to-real mapping

**Changes:**
```typescript
private async populatePhotosFromDexie(elevationPoints: any[]): Promise<void> {
  const allLocalImages = await this.localImageService.getImagesForService(this.serviceId);

  // Group by entityId
  const localImagesMap = new Map<string, LocalImage[]>();
  for (const img of allLocalImages) {
    if (!img.entityId) continue;
    const entityId = String(img.entityId);
    if (!localImagesMap.has(entityId)) {
      localImagesMap.set(entityId, []);
    }
    localImagesMap.get(entityId)!.push(img);
  }

  for (const point of elevationPoints) {
    const realId = point.pointId;
    const tempId = point.tempPointId;

    // Try real ID first, then temp ID, then mapped ID
    let localImages = realId ? (localImagesMap.get(realId) || []) : [];
    if (localImages.length === 0 && tempId) {
      localImages = localImagesMap.get(tempId) || [];
    }
    if (localImages.length === 0 && tempId) {
      const mappedRealId = await this.indexedDb.getRealId(tempId);
      if (mappedRealId) {
        localImages = localImagesMap.get(mappedRealId) || [];
      }
    }

    // Populate photos...
  }
}
```

**Debugging:**
```typescript
alert(`[PHOTO DEBUG] populatePhotosFromDexie:\n` +
  `Total LocalImages: ${allLocalImages.length}\n` +
  `Points with photos: ${pointsWithPhotos}\n` +
  `entityIds in LocalImages: ${Array.from(localImagesMap.keys()).slice(0, 5).join(', ')}`);
```

### Step 4.2: Call populatePhotosFromDexie After Dexie Load
**Goal:** Photos appear immediately after room data loads from Dexie

**Changes:**
1. In `initializeFromDexie()`, after populating roomData, call `populatePhotosFromDexie()`

**Debugging:**
```typescript
alert(`[PHOTO DEBUG] After populatePhotosFromDexie:\n` +
  `Points: ${this.roomData.elevationPoints.length}\n` +
  `Points with photos: ${this.roomData.elevationPoints.filter(p => p.photos?.length > 0).length}`);
```

### Step 4.3: Handle Photo Upload - Store with Correct EntityId
**Goal:** When photo is uploaded, LocalImage.entityId must match point's ID

**Files:** `room-elevation.page.ts`

**Key Consideration:**
- If point has `pointId` (real), use that
- If point only has `tempPointId`, use that
- DO NOT use `temp_point_xxx` if real ID exists

**Debugging (on photo upload):**
```typescript
alert(`[UPLOAD DEBUG] Photo entityId: ${localImage.entityId}\n` +
  `Point realId: ${point.pointId}\n` +
  `Point tempId: ${point.tempPointId}`);
```

---

## Phase 5: Sync ID Mapping (CRITICAL)

### Step 5.1: Store Point temp-to-real ID Mapping During Sync
**Goal:** When point syncs, store mapping so photos can be found on reload

**Files:** `background-sync.service.ts`

**Check:** Verify `mapTempId()` is called for EFE points (should already exist at line ~733)

**Debugging:**
```typescript
console.log(`[SYNC] Stored point mapping: ${tempId} -> ${realId}`);
```

### Step 5.2: Update LocalImage.entityId After Point Syncs
**Goal:** After point syncs, update LocalImages to use real ID

**Files:** `room-elevation.page.ts` (in sync handler)

**Changes:**
```typescript
// In efePointSyncComplete$ handler
await this.indexedDb.updateEntityIdForImages(tempPointId, realPointId);
```

**Debugging:**
```typescript
alert(`[SYNC DEBUG] Updated LocalImages entityId:\n` +
  `From: ${tempPointId}\n` +
  `To: ${realPointId}`);
```

### Step 5.3: Update EfeField.pointId After Point Syncs
**Goal:** After point syncs, update EfeField in Dexie with real pointId

**Changes:**
```typescript
await this.efeFieldRepo.setPointId(this.serviceId, this.roomName, pointNumber, realPointId);
```

**Debugging:**
```typescript
alert(`[SYNC DEBUG] Updated EfeField pointId:\n` +
  `Point ${pointNumber}: ${realPointId}`);
```

---

## Phase 6: FDF Photo Handling

### Step 6.1: Populate FDF Photos from Dexie
**Goal:** FDF photos (top, bottom, threshold) load from LocalImages

**Key Consideration:**
- FDF photos use `entityId` = room ID (not point ID)
- Must check both `efeId` and `tempEfeId`

**Debugging:**
```typescript
alert(`[FDF DEBUG] FDF photos from Dexie:\n` +
  `Room efeId: ${this.roomId}\n` +
  `Top photo: ${!!fdfPhotos.top}\n` +
  `Bottom photo: ${!!fdfPhotos.bottom}`);
```

### Step 6.2: Handle FDF Photo Upload EntityId
**Goal:** FDF photos stored with correct room entityId

**Debugging:**
```typescript
alert(`[FDF UPLOAD DEBUG] entityId: ${localImage.entityId}\n` +
  `Room efeId: ${this.roomId}\n` +
  `Room tempEfeId: ${this.tempRoomId}`);
```

---

## Phase 7: Room Sync ID Mapping

### Step 7.1: Store Room temp-to-real ID Mapping During Sync
**Goal:** When room syncs, store mapping for FDF photos

**Check:** Verify `mapTempId()` is called for EFE rooms in background-sync.service.ts

### Step 7.2: Update LocalImage.entityId After Room Syncs
**Goal:** After room syncs, update FDF LocalImages to use real room ID

### Step 7.3: Update EfeField.efeId After Room Syncs
**Goal:** After room syncs, update EfeField in Dexie with real efeId

---

## Phase 8: Elevation-Plot-Hub Dexie-First

### Step 8.1: Replace Room List Loading with Dexie
**Goal:** Room list loads instantly from EfeFields

**Changes:**
1. Subscribe to `efeFieldRepo.getFieldsForService$()`
2. Filter to only `isSelected: true` rooms

### Step 8.2: Room Creation Writes to Dexie First
**Goal:** When creating room, write to Dexie immediately

### Step 8.3: Room Deletion Updates Dexie
**Goal:** When deleting room, update Dexie immediately

---

## Testing Checklist

### For Each Step:
- [ ] Debug alert shows expected values
- [ ] No TypeScript compilation errors
- [ ] App builds successfully
- [ ] Feature works on mobile device (CRITICAL - test mobile, not just browser)

### Photo Persistence Tests:
- [ ] Photo shows immediately after upload
- [ ] Photo persists on page reload (before sync)
- [ ] Photo persists after sync completes
- [ ] Photo persists on page reload (after sync)
- [ ] Annotations/captions persist

### ID Matching Tests:
- [ ] Before sync: Photos found by tempId
- [ ] After sync: Photos found by realId (via mapping)
- [ ] Reload after sync: Photos found by realId

---

## Rollback Plan

If a step causes issues:
1. Revert the specific commit
2. Add more granular debugging
3. Identify the exact ID mismatch
4. Fix and re-test

---

## Notes

- Always use `alert()` for mobile debugging
- Remove debug alerts after each phase is verified working
- Commit after each successful step
- **Test on actual mobile device, not just browser** - IndexedDB behaves differently!
- Follow Structural Systems pattern for operation order (load data → then subscribe)

---

## Commits Reference (Phase 1 Fixes)

1. `e97116ad` - Add debug alerts for blank screen diagnosis
2. `236eddba` - Fix blank screen: populate roomData immediately from existingField
3. `f50afb2c` - Add Dexie debug mode and global error handlers
4. `5d28755a` - Fix mobile liveQuery: use simple 'key' index
5. `4bc47189` - Fix race condition: load elevation points BEFORE subscribing to liveQuery
6. `8608d24a` - Fix infinite loading: set isLoadingPoints=false after loadElevationPoints


# Elevation Plot Dexie-First Implementation Plan

## Overview

This document outlines the step-by-step implementation of Dexie-first architecture for the Elevation Plot sections (`elevation-plot-hub` and `room-elevation`). Each step is intentionally small to catch issues early and includes debugging checkpoints.

**Key Lessons from Structural Systems Implementation:**
- ID mismatches (temp_visual_xxx vs real IDs like "1107") caused photos to disappear
- Always check BOTH temp and real IDs when looking up photos
- Store temp-to-real ID mappings during sync for photo restoration on reload
- Use `alert()` for debugging on mobile (not `console.log`)

---

## CRITICAL PRINCIPLE: True Dexie-First Architecture

**The core principle:** ALL data operations go through Dexie FIRST. The backend is just a sync target.

**WRONG approach (what we were doing):**
1. Read from Dexie to check if data exists
2. If points don't have IDs, create them via API/pending queue
3. Load data from multiple sources

**CORRECT approach (Dexie-first):**
1. When room is ADDED → Create room AND all points immediately with temp IDs
2. Store everything in Dexie with temp IDs
3. Queue everything for background sync
4. When entering room-elevation → Read ONLY from Dexie
5. All data has IDs (temp or real) → instant display, all buttons enabled

---

## Phase 1: Room-Elevation Dexie-First (REWRITE)

### The Correct Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ROOM ADDED (elevation-plot-hub)                   │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. User clicks "Add Room"                                               │
│ 2. Create room record → queue for sync → gets tempEfeId                 │
│ 3. For EACH template point:                                             │
│    - Create point record → queue for sync → gets tempPointId            │
│    - Link point to room via tempEfeId                                   │
│ 4. Store in Dexie EfeField:                                             │
│    - room.tempEfeId = "temp_efe_xxx"                                    │
│    - point[0].tempPointId = "temp_point_xxx"                            │
│    - point[1].tempPointId = "temp_point_yyy"                            │
│    - etc.                                                               │
│ 5. UI shows room immediately (optimistic)                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     ENTER ROOM (room-elevation)                          │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Read EfeField from Dexie (ONLY source of truth)                      │
│ 2. room.tempEfeId exists → roomId = tempEfeId                           │
│ 3. Each point has tempPointId → buttons enabled                         │
│ 4. Instant render - NO API calls, NO point creation                     │
│ 5. Subscribe to liveQuery for reactive updates                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     BACKGROUND SYNC (automatic)                          │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Sync room: tempEfeId → realEfeId                                     │
│ 2. Update Dexie: EfeField.efeId = realEfeId                             │
│ 3. Sync each point: tempPointId → realPointId                           │
│ 4. Update Dexie: EfePoint.pointId = realPointId                         │
│ 5. UI auto-updates via liveQuery subscription                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step 1.1: Add createPointRecordsForRoom() to EfeFieldRepo

**Goal:** Create a method that generates temp point records and stores them in Dexie

**File:** `src/app/services/efe-field-repo.service.ts`

**Changes:**
```typescript
/**
 * Create point records for a room when it's first added
 * This generates tempPointIds and queues points for sync
 * Called from elevation-plot-hub when user adds a room
 */
async createPointRecordsForRoom(
  serviceId: string,
  roomName: string,
  tempEfeId: string,
  foundationDataService: any  // For creating pending records
): Promise<EfePoint[]> {
  const key = `${serviceId}:${roomName}`;
  const existing = await db.efeFields.where('key').equals(key).first();

  if (!existing) {
    throw new Error(`EfeField not found for room: ${roomName}`);
  }

  const updatedPoints: EfePoint[] = [];

  for (const point of existing.elevationPoints) {
    // Generate tempPointId
    const tempPointId = `temp_point_${Date.now()}_${point.pointNumber}`;

    // Create pending record for sync
    const pointData = {
      EFEID: tempEfeId,  // Link to room via tempEfeId
      PointName: point.name
    };

    // Queue for sync via foundationDataService
    await foundationDataService.createEFEPoint(pointData, tempEfeId);

    updatedPoints.push({
      ...point,
      tempPointId,
      pointId: null  // Will be set after sync
    });
  }

  // Update Dexie with tempPointIds
  await db.efeFields.update(existing.id!, {
    elevationPoints: updatedPoints,
    updatedAt: Date.now()
  });

  return updatedPoints;
}
```

### Step 1.2: Modify addRoomTemplate() in elevation-plot-hub

**Goal:** When room is added, create room AND all points with temp IDs

**File:** `src/app/pages/engineers-foundation/elevation-plot-hub/elevation-plot-hub.page.ts`

**Changes:**
1. After room is created, call `createPointRecordsForRoom()`
2. Store tempEfeId in Dexie
3. All points get tempPointIds stored in Dexie

**Key Code:**
```typescript
// After room is created (line ~1747)
const response = await this.foundationDataService.createServicesEFE(roomData);
const tempEfeId = response._tempId || `temp_efe_${Date.now()}`;
const efeId = response.EFEID || response.PK_ID;

// Update Dexie with room IDs
await this.efeFieldRepo.setRoomSelected(
  this.serviceId,
  roomName,
  true,
  efeId || null,
  tempEfeId
);

// Create ALL elevation points now (with tempPointIds)
await this.efeFieldRepo.createPointRecordsForRoom(
  this.serviceId,
  roomName,
  tempEfeId || efeId,
  this.foundationDataService
);
```

### Step 1.3: Rewrite initializeFromDexie() in room-elevation

**Goal:** Pure Dexie read - NO point creation, NO API calls

**File:** `src/app/pages/engineers-foundation/room-elevation/room-elevation.page.ts`

**The CORRECT implementation:**
```typescript
private async initializeFromDexie(): Promise<void> {
  // 1. Read from Dexie (ONLY source)
  const field = await this.efeFieldRepo.getFieldByRoom(this.serviceId, this.roomName);

  if (!field) {
    // Room not in Dexie - shouldn't happen if flow is correct
    console.error('Room not found in Dexie - this indicates a bug');
    return;
  }

  // 2. Set roomId from Dexie (prefer real ID, fallback to temp)
  this.roomId = field.efeId || field.tempEfeId || '';

  // 3. Populate roomData DIRECTLY from Dexie
  this.roomData = {
    roomName: field.roomName,
    templateId: field.templateId,
    notes: field.notes || '',
    fdf: field.fdf || '',
    location: field.location || '',
    elevationPoints: field.elevationPoints.map(ep => ({
      name: ep.name,
      pointId: ep.pointId || ep.tempPointId,  // Use real or temp ID
      pointNumber: ep.pointNumber,
      value: ep.value || '',
      photos: [],  // Will be populated from LocalImages
      expanded: false
    })),
    fdfPhotos: { ... }
  };

  // 4. All points have IDs (temp or real) - buttons are enabled
  this.isLoadingPoints = false;

  // 5. Load photos from LocalImages (separate from point data)
  await this.populatePhotosFromLocalImages();

  // 6. Subscribe to liveQuery for reactive updates
  this.efeFieldSubscription = this.efeFieldRepo
    .getFieldByRoom$(this.serviceId, this.roomName)
    .subscribe({ ... });
}
```

### Step 1.4: Create populatePhotosFromLocalImages() method

**Goal:** Load photos from LocalImages table, matching by point ID (temp or real)

```typescript
private async populatePhotosFromLocalImages(): Promise<void> {
  // Get all LocalImages for this service
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

  // Populate photos for each point
  for (const point of this.roomData.elevationPoints) {
    const pointId = point.pointId;  // Already has temp or real ID
    if (!pointId) continue;

    // Check direct ID match
    let photos = localImagesMap.get(String(pointId)) || [];

    // Also check temp-to-real mapping
    if (photos.length === 0) {
      const mappedRealId = await this.indexedDb.getRealId(pointId);
      if (mappedRealId) {
        photos = localImagesMap.get(mappedRealId) || [];
      }
    }

    // Convert LocalImages to photo objects
    point.photos = await Promise.all(photos.map(async (img) => ({
      imageId: img.imageId,
      attachId: img.attachId || img.imageId,
      photoType: img.photoType || 'Measurement',
      displayUrl: await this.localImageService.getDisplayUrl(img),
      caption: img.caption || '',
      // ... other fields
    })));
  }
}
```

---

## Phase 2: Sync Integration

### Step 2.1: Ensure Room Sync Updates Dexie

When room syncs (tempEfeId → realEfeId), update Dexie:
```typescript
// In background-sync.service.ts after room sync
await this.efeFieldRepo.updateEfeId(serviceId, roomName, realEfeId);
```

### Step 2.2: Ensure Point Sync Updates Dexie

When point syncs (tempPointId → realPointId), update Dexie:
```typescript
// In background-sync.service.ts after point sync
await this.efeFieldRepo.setPointId(serviceId, roomName, pointNumber, realPointId);
```

### Step 2.3: Update LocalImage.entityId After Point Sync

Photos stored with tempPointId need entityId updated:
```typescript
await this.indexedDb.updateEntityIdForImages(tempPointId, realPointId);
```

---

## Phase 3: Write-Through (Same as Before)

### Step 3.1-3.4: Notes, FDF, Location, Point Values
Write-through to Dexie on every change (already implemented in EfeFieldRepo).

---

## Testing Checklist

### Dexie-First Verification:
- [ ] Add room → room AND all points appear in sync queue immediately
- [ ] Enter room-elevation → instant display (no loading, no API calls)
- [ ] All camera/album buttons enabled (points have tempPointIds)
- [ ] Refresh page → same instant display from Dexie
- [ ] Background sync completes → IDs update from temp to real
- [ ] Photos persist across sync (entityId mapping works)

### Mobile-Specific:
- [ ] Test on actual mobile device
- [ ] No IndexedDB errors
- [ ] Buttons not grayed out

---

## Key Files to Modify

1. **`efe-field-repo.service.ts`** - Add `createPointRecordsForRoom()`
2. **`elevation-plot-hub.page.ts`** - Call point creation when room is added
3. **`room-elevation.page.ts`** - Rewrite to pure Dexie read
4. **`background-sync.service.ts`** - Ensure sync updates Dexie

---

## Rollback Plan

If issues occur:
1. The old `loadElevationPoints()` logic still exists as fallback
2. Can revert to `loadRoomData()` path if Dexie path fails
3. Debug with `alert()` on mobile

---

## Notes

- **NO point creation in room-elevation** - all points created when room is added
- **Dexie is THE source of truth** - backend is just sync target
- **Temp IDs enable everything** - buttons, photos, all work with temp IDs
- **Test on mobile device** - IndexedDB behaves differently than desktop browser


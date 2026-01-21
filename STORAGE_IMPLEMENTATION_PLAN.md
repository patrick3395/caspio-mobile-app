# Storage Bloat Prevention Implementation Plan

## Overview
Implement the STORAGE_BLOAD.md strategy for the engineers-foundation template to prevent IndexedDB bloat while maintaining instant page navigation and offline reliability.

**Key decisions:**
- Service = Inspection (serviceId is the primary key)
- Thumbnail size: 200px (matches existing ThumbnailService)
- Unsynced data: Block auto-purge, allow manual purge with warning

---

## Phase 1: Schema Changes (v10)

### 1.1 Add ServiceMetadata Table
**File:** `src/app/services/caspio-db.ts`

Add new interface and table for service-level tracking:

```typescript
export interface ServiceMetadata {
  serviceId: string;              // Primary key
  templateVersion: number;        // Version of templates used
  isOpen: boolean;                // Currently being viewed/edited
  lastTouchedAt: number;          // Epoch ms when user last interacted
  lastLocalRevision: number;      // Monotonic counter for local changes
  lastServerAckRevision: number;  // Last revision server confirmed
  purgeState: 'ACTIVE' | 'ARCHIVED' | 'PURGED';
  estimatedLocalBytes?: number;   // For debugging
  createdAt: number;
  updatedAt: number;
}
```

### 1.2 Add thumbBlobId to LocalImage
**File:** `src/app/services/indexed-db.service.ts`

Extend LocalImage interface:
```typescript
thumbBlobId: string | null;  // FK to localBlobs for 200px thumbnail
```

### 1.3 Schema Migration
**File:** `src/app/services/caspio-db.ts`

```typescript
this.version(10).stores({
  // ... existing tables unchanged ...
  serviceMetadata: 'serviceId, lastTouchedAt, purgeState, [purgeState+lastTouchedAt]'
}).upgrade(tx => {
  // Add thumbBlobId: null to existing localImages
  return tx.table('localImages').toCollection().modify(img => {
    img.thumbBlobId = null;
  });
});
```

---

## Phase 2: Thumbnail Infrastructure

### 2.1 Persist Thumbnails on Capture
**File:** `src/app/services/local-image.service.ts`

Modify `captureImage()` to generate and store thumbnail blob:

1. After creating full-res LocalBlob, generate 200px thumbnail
2. Store thumbnail as separate LocalBlob with `thumb_${imageId}` key
3. Set `thumbBlobId` on LocalImage record

### 2.2 Update ThumbnailService
**File:** `src/app/services/thumbnail.service.ts`

Add method to persist thumbnail to IndexedDB instead of just memory cache.

### 2.3 Display URL Resolution
**File:** `src/app/services/local-image.service.ts`

Modify `getDisplayUrl()` logic:
1. If `localBlobId` exists → use full-res local blob
2. Else if `thumbBlobId` exists → use thumbnail blob (for pruned images)
3. Else if `remoteS3Key` exists → fetch from S3
4. Else → placeholder

---

## Phase 3: Service Metadata Tracking

### 3.1 Create ServiceMetadataService
**New file:** `src/app/services/service-metadata.service.ts`

Methods:
- `initService(serviceId)` — Create metadata record when service first accessed
- `touchService(serviceId)` — Update `lastTouchedAt` on any user interaction
- `incrementLocalRevision(serviceId)` — Bump counter on local changes
- `setServerAckRevision(serviceId, rev)` — Update after sync confirmation
- `setOpen(serviceId, isOpen)` — Track when service is being viewed
- `getOutboxCount(serviceId)` — Query pending mutations for service
- `isPurgeSafe(serviceId)` — Check all 3 purge eligibility rules

### 3.2 Integrate Touch Tracking
**Files to modify:**
- `engineers-foundation.page.ts` — Call `touchService()` on page enter
- `visual-detail.page.ts` — Call `touchService()` on field edits
- `efe-detail.page.ts` — Call `touchService()` on room/point edits
- `visual-field-repo.service.ts` — Call `incrementLocalRevision()` on `setField()`
- `efe-field-repo.service.ts` — Call `incrementLocalRevision()` on `setField()`

### 3.3 Server ACK Integration
**File:** `src/app/services/background-sync.service.ts`

After successful sync, update `lastServerAckRevision` to match `lastLocalRevision`.

---

## Phase 4: Two-Stage Purge Implementation

### 4.1 Stage 1: Soft Purge (After Upload ACK)
**File:** `src/app/services/background-sync.service.ts`

Trigger: When `photoUploadComplete$` fires with verified status.

Action:
```typescript
async softPurgeImage(imageId: string): Promise<void> {
  const image = await this.indexedDb.getLocalImage(imageId);
  if (image.status !== 'verified') return;
  if (!image.thumbBlobId) {
    // Generate thumbnail before deleting full-res
    await this.generateAndStoreThumbnail(imageId);
  }
  // Delete full-res blob, keep thumbnail
  await this.indexedDb.deleteLocalBlob(image.localBlobId);
  await this.indexedDb.updateLocalImage(imageId, { localBlobId: null });
}
```

### 4.2 Stage 2: Hard Purge (After 3-Day Inactivity)
**File:** `src/app/services/background-sync.service.ts`

New method `hardPurgeInactiveServices()`:

```typescript
async hardPurgeInactiveServices(): Promise<{ purged: string[], skipped: string[] }> {
  const PURGE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  const cutoff = Date.now() - PURGE_AFTER_MS;

  const services = await this.serviceMetadata.getInactiveServices(cutoff);
  const purged = [], skipped = [];

  for (const svc of services) {
    if (!await this.serviceMetadata.isPurgeSafe(svc.serviceId)) {
      skipped.push(svc.serviceId);
      continue;
    }
    await this.purgeServiceData(svc.serviceId);
    await this.serviceMetadata.setPurgeState(svc.serviceId, 'ARCHIVED');
    purged.push(svc.serviceId);
  }
  return { purged, skipped };
}
```

### 4.3 Purge Eligibility Gate
**File:** `src/app/services/service-metadata.service.ts`

```typescript
async isPurgeSafe(serviceId: string): Promise<boolean> {
  const meta = await this.getServiceMetadata(serviceId);
  if (!meta) return false;

  // Rule 1: No pending uploads
  const outboxCount = await this.getOutboxCount(serviceId);
  if (outboxCount > 0) return false;

  // Rule 2: Server has latest
  if (meta.lastServerAckRevision < meta.lastLocalRevision) return false;

  // Rule 3: Not currently open
  if (meta.isOpen) return false;

  return true;
}
```

---

## Phase 5: Storage Pressure Handling

### 5.1 Re-enable Blob Pruning
**File:** `src/app/services/background-sync.service.ts`

Remove early returns in:
- `pruneVerifiedBlobs()` (line ~3107)
- `performStorageCleanup()` (line ~3204)

Replace with proper guards that check thumbnail exists before pruning.

### 5.2 Quota-Based Eviction
**File:** `src/app/services/background-sync.service.ts`

Modify `performStorageCleanup()`:

```typescript
async performStorageCleanup(): Promise<void> {
  const { usage, quota } = await navigator.storage.estimate();
  const usagePercent = (usage / quota) * 100;

  if (usagePercent < 75) return; // No pressure

  // Stage 1: Soft purge all uploaded images first
  await this.softPurgeAllVerified();

  // Stage 2: If still over 80%, hard purge oldest eligible services
  const newUsage = await navigator.storage.estimate();
  if ((newUsage.usage / newUsage.quota) >= 0.80) {
    await this.hardPurgeInactiveServices();
  }
}
```

---

## Phase 6: Unsynced Data Warning UI

### 6.1 Add Warning Banner Component
**File:** `src/app/components/sync-warning-banner/`

Display persistent banner when service has unsynced changes:
- Text: "Unsynced changes — connect to sync"
- Show when `outboxCount > 0` OR `lastServerAckRevision < lastLocalRevision`

### 6.2 Manual Purge Option
**File:** `src/app/pages/engineers-foundation/engineers-foundation.page.ts`

Add settings option for manual purge with confirmation dialog:
- Warning: "This will delete local data that hasn't been synced. Continue?"
- Only enabled when `isPurgeSafe()` returns false due to unsynced data

---

## Phase 7: Rehydration Support

### 7.1 On-Demand Rehydration
**File:** `src/app/services/engineers-foundation-data.service.ts`

When opening a PURGED/ARCHIVED service:

```typescript
async rehydrateService(serviceId: string): Promise<void> {
  const meta = await this.serviceMetadata.getServiceMetadata(serviceId);
  if (meta?.purgeState !== 'PURGED' && meta?.purgeState !== 'ARCHIVED') return;

  // Fetch full data from server
  await this.fetchAndCacheVisuals(serviceId);
  await this.fetchAndCacheEfeRooms(serviceId);
  await this.fetchAndCacheAttachments(serviceId);

  // Update state
  await this.serviceMetadata.setPurgeState(serviceId, 'ACTIVE');
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/services/caspio-db.ts` | Schema v10, ServiceMetadata interface |
| `src/app/services/indexed-db.service.ts` | Add thumbBlobId to LocalImage, new methods |
| `src/app/services/local-image.service.ts` | Thumbnail generation on capture, display URL logic |
| `src/app/services/thumbnail.service.ts` | Persist thumbnail to IndexedDB |
| `src/app/services/background-sync.service.ts` | Re-enable pruning, two-stage purge, pressure handling |
| `src/app/services/visual-field-repo.service.ts` | Call incrementLocalRevision |
| `src/app/services/efe-field-repo.service.ts` | Call incrementLocalRevision |
| `src/app/pages/engineers-foundation/*.ts` | Touch tracking, isOpen tracking |

**New files:**
| File | Purpose |
|------|---------|
| `src/app/services/service-metadata.service.ts` | Service-level metadata tracking |
| `src/app/components/sync-warning-banner/` | Unsynced changes UI warning |

---

## Verification Plan

1. **Schema migration test:** Verify v10 upgrade doesn't lose existing data
2. **Thumbnail generation:** Capture photo, verify both full-res and thumb blobs created
3. **Soft purge:** Upload photo, verify full-res deleted and thumb retained after ACK
4. **Hard purge:** Leave service inactive 3+ days, verify data purged (except thumbnails and metadata)
5. **Purge safety:** Create unsynced changes, verify auto-purge blocked
6. **Rehydration:** Open archived service, verify data fetched from server
7. **Storage pressure:** Fill storage to 80%, verify cleanup triggers correctly
8. **Manual purge:** Test force-purge with unsynced data after user confirmation

---

## Risk Mitigation

1. **Data loss prevention:** All purge operations check `isPurgeSafe()` gate
2. **Backwards compatibility:** Schema migration preserves existing data
3. **Gradual rollout:** Can enable soft purge first, then hard purge later
4. **Fallback:** Remote S3 URLs always available if local data missing

---

## Implementation Progress

### Phase 1: Schema Changes (v10)

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 1.1 Add ServiceMetadata interface | ✅ DONE | 2026-01-21 | Added to `caspio-db.ts` lines 46-64. Includes PurgeState type. |
| 1.2 Add thumbBlobId to LocalImage | ✅ DONE | 2026-01-21 | Added to `indexed-db.service.ts` line 105. |
| 1.3 Schema v10 migration | ✅ DONE | 2026-01-21 | Added to `caspio-db.ts` lines 331-375. Adds serviceMetadata table + thumbBlobId migration. |

### Phase 2: Thumbnail Infrastructure

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 2.1 persistThumbnail() in ThumbnailService | ⬜ TODO | | |
| 2.2 Modify captureImage() for thumbnails | ⬜ TODO | | |
| 2.3 Add thumbnail fallback to getDisplayUrl() | ⬜ TODO | | |

### Phase 3: Service Metadata Tracking

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 3.1 Create ServiceMetadataService | ⬜ TODO | | |
| 3.2 Add touchService() to pages | ⬜ TODO | | |
| 3.3 Add setOpen() to page lifecycle | ⬜ TODO | | |
| 3.4 Wire incrementLocalRevision | ⬜ TODO | | |
| 3.5 Wire setServerAckRevision | ⬜ TODO | | |

### Phase 4: Two-Stage Purge

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 4.1 Implement isPurgeSafe() | ⬜ TODO | | |
| 4.2 Implement softPurgeImage() | ⬜ TODO | | |
| 4.3 Implement hardPurgeInactiveServices() | ⬜ TODO | | |

### Phase 5: Storage Pressure Handling

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 5.1 Modify performStorageCleanup() | ⬜ TODO | | |
| 5.2 Re-enable pruneVerifiedBlobs() | ⬜ TODO | | |

### Phase 6: Warning UI

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 6.1 Create sync-warning-banner | ⬜ TODO | | |
| 6.2 Add manual purge option | ⬜ TODO | | |

### Phase 7: Rehydration

| Task | Status | Date | Notes |
|------|--------|------|-------|
| 7.1 Implement rehydrateService() | ⬜ TODO | | |

### Decision Log

| Decision | Rationale |
|----------|-----------|
| Thumbnail size: 200px (longest edge) | Matches existing ThumbnailService default (200x200 max, aspect ratio preserved) |
| Pre-v10 photos: Leave alone | Photos captured before v10 won't have thumbnails; will use cachedPhoto fallback or S3 |
| Inactivity threshold: 3 days | As specified in original plan |

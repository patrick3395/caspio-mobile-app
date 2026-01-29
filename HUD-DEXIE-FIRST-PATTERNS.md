# HUD Template - DEXIE-First Implementation Patterns

This document provides a comprehensive reference of all DEXIE-first patterns used in the HUD template. These patterns should be replicated **exactly** in the LBW template.

---

## Table of Contents
1. [Core Architecture](#core-architecture)
2. [Category Detail Page](#category-detail-page)
3. [Visual Detail Page](#visual-detail-page)
4. [Data Service Layer](#data-service-layer)
5. [Photo Handling](#photo-handling)
6. [Key Properties and Flags](#key-properties-and-flags)
7. [LBW Implementation Checklist](#lbw-implementation-checklist)

---

## Core Architecture

### DEXIE-First Principle
- **Load from Dexie first** for instant display (no loading spinners)
- **Sync in background** (non-blocking)
- **liveQuery subscriptions** for reactive updates when Dexie data changes
- **Never wait for network** - UI always responds instantly

### Entity Naming Convention
- HUD: `temp_hud_xxx` prefix for temp IDs
- LBW: `temp_lbw_xxx` prefix for temp IDs
- Entity types: `'hud'` for HUD, `'lbw'` for LBW

---

## Category Detail Page

### File: `hud-category-detail.page.ts`

### Key Properties (Lines 117-173)
```typescript
// DEXIE-FIRST: Dexie liveQuery subscription for reactive LocalImages updates
private localImagesSubscription?: Subscription;
// Debounce timer for liveQuery updates
private liveQueryDebounceTimer: any = null;

// DEXIE-FIRST: Reactive subscription to visualFields
private visualFieldsSubscription?: Subscription;
private visualFieldsSeeded: boolean = false;
// Store fields reference for reactive photo updates
private lastConvertedFields: VisualField[] = [];

// Cooldown after local operations to prevent immediate reload
private localOperationCooldown = false;
private localOperationCooldownTimer: any = null;

// Track if initial load is complete (for ionViewWillEnter)
private initialLoadComplete: boolean = false;

// MUTEX: Prevent concurrent populatePhotosFromDexie calls
private isPopulatingPhotos = false;
// Suppress liveQuery during camera capture
private isCameraCaptureInProgress = false;
```

### ngOnInit Flow (Lines 267-360)
```typescript
async ngOnInit() {
  // 1. Get route params
  // 2. Load actualServiceId from service record
  // 3. Initialize visual fields (DEXIE-FIRST)
  await this.initializeVisualFields();
  // 4. Mark initial load complete
  this.initialLoadComplete = true;
}
```

### ionViewWillEnter - Smart Reload Logic (Lines 366-467)
```typescript
async ionViewWillEnter() {
  // Set up deferred subscriptions on first entry
  if (!this.uploadSubscription) {
    this.subscribeToUploadUpdates();
  }
  if (!this.localImagesSubscription && this.serviceId) {
    this.subscribeToLocalImagesChanges();
  }

  // Skip if initial load not complete
  if (!this.initialLoadComplete || !this.serviceId) return;

  // Check if data is fresh
  const hasDataInMemory = Object.keys(this.visualPhotos).length > 0;
  const isDirty = this.backgroundSync.isSectionDirty(sectionKey);
  const serviceOrCategoryChanged = this.lastLoadedServiceId !== this.serviceId;

  // Early return if data is fresh
  if (hasDataInMemory && !isDirty && !serviceOrCategoryChanged) {
    // SKIP FULL RELOAD but refresh local state
    await this.refreshLocalState();
    // DEXIE-FIRST: Always reload photos from Dexie
    if (this.lastConvertedFields.length > 0) {
      await this.populatePhotosFromDexie(this.lastConvertedFields);
      this.changeDetectorRef.detectChanges();
    }
    return;
  }

  // Full reload if needed
  await this.loadData();
}
```

### loadDataFromCache - MOBILE Mode (Lines 669-960)
```typescript
private async loadDataFromCache(): Promise<void> {
  // STEP 0: Load templates and records from cache IN PARALLEL
  const [templates, visuals] = await Promise.all([
    this.indexedDb.getCachedTemplates('hud'),
    this.hudData.getHudByService(this.actualServiceId || this.serviceId)
  ]);

  // STEP 1: Load Dexie visualFields for templateId -> visualId mappings
  const dexieFields = await db.visualFields
    .where('serviceId')
    .equals(this.serviceId)
    .toArray();

  // STEP 2: Build templateId -> visualId map
  const templateToVisualMap = new Map<number, string>();
  for (const field of dexieFields) {
    const visualId = field.visualId || field.tempVisualId;
    if (visualId && field.templateId) {
      templateToVisualMap.set(field.templateId, visualId);
    }
  }

  // STEP 3: Build organizedData from templates
  // STEP 3.5: Merge Dexie field data (title, text, answer, isSelected)
  // STEP 3.6: Display page immediately (loading = false)
  this.loading = false;
  this.changeDetectorRef.detectChanges();

  // STEP 3.7: Build lastConvertedFields for photo matching
  this.lastConvertedFields = this.buildConvertedFieldsFromOrganizedData(organizedData);

  // STEP 4: Load photos from Dexie (NON-BLOCKING)
  await this.loadPhotosFromDexie();

  // STEP 5: Subscribe to VisualFields changes
  this.subscribeToVisualFieldChanges();

  // Update tracking variables
  this.initialLoadComplete = true;
}
```

### subscribeToLocalImagesChanges (Lines 2224-2278)
```typescript
private subscribeToLocalImagesChanges(): void {
  if (this.localImagesSubscription) {
    this.localImagesSubscription.unsubscribe();
  }

  if (!this.serviceId) return;

  // Subscribe to LocalImages for this service + entity type
  this.localImagesSubscription = db.liveLocalImages$(this.serviceId, 'hud').subscribe(
    async (localImages) => {
      // Suppress during camera capture to prevent duplicates
      if (this.isCameraCaptureInProgress) return;

      // Update bulkLocalImagesMap reactively
      this.updateBulkLocalImagesMap(localImages);

      // CRITICAL: Refresh lastConvertedFields from Dexie before populating
      await this.refreshLastConvertedFieldsFromDexie();

      // Populate photos with fresh data
      if (this.lastConvertedFields.length > 0) {
        await this.populatePhotosFromDexie(this.lastConvertedFields);
      }

      // Debounced change detection
      if (this.liveQueryDebounceTimer) clearTimeout(this.liveQueryDebounceTimer);
      this.liveQueryDebounceTimer = setTimeout(() => {
        this.changeDetectorRef.detectChanges();
      }, 100);
    }
  );
}
```

### subscribeToVisualFieldChanges (Lines 2300-2372)
```typescript
private subscribeToVisualFieldChanges(): void {
  if (this.visualFieldsSubscription) {
    this.visualFieldsSubscription.unsubscribe();
  }

  if (!this.serviceId) return;

  // Subscribe to ALL VisualFields for this service
  this.visualFieldsSubscription = this.visualFieldRepo
    .getAllFieldsForService$(this.serviceId)
    .subscribe({
      next: async (fields) => {
        // Store fresh fields as lastConvertedFields
        this.lastConvertedFields = fields;

        // Update visualRecordIds with correct IDs
        for (const field of fields) {
          const key = `${field.category}_${field.templateId}`;
          const visualId = field.visualId || field.tempVisualId;
          if (visualId) {
            this.visualRecordIds[key] = visualId;
          }
        }

        // Populate photos with fresh fields
        await this.populatePhotosFromDexie(fields);
        this.changeDetectorRef.detectChanges();
      }
    });
}
```

### populatePhotosFromDexie - 4-Tier Fallback (Lines 1616-1889)
```typescript
private async populatePhotosFromDexie(fields: VisualField[]): Promise<void> {
  // MUTEX: Prevent concurrent calls
  if (this.isPopulatingPhotos) return;
  this.isPopulatingPhotos = true;

  try {
    // Query ALL LocalImages for this service filtered by entity type
    const allLocalImages = await this.localImageService.getImagesForService(
      this.serviceId,
      'hud'  // LBW should use 'lbw'
    );

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

    for (const field of fields) {
      const realId = field.visualId;
      const tempId = field.tempVisualId;
      const visualId = realId || tempId;
      if (!visualId) continue;

      // ===== 4-TIER FALLBACK PATTERN =====

      // TIER 1: Lookup by real ID first
      let localImages = realId ? (localImagesMap.get(realId) || []) : [];

      // TIER 2: Try tempId lookup
      if (localImages.length === 0 && tempId && tempId !== realId) {
        localImages = localImagesMap.get(tempId) || [];
      }

      // TIER 3: Check IndexedDB for temp-to-real mapping
      if (localImages.length === 0 && tempId) {
        const mappedRealId = await this.indexedDb.getRealId(tempId);
        if (mappedRealId) {
          localImages = localImagesMap.get(mappedRealId) || [];
          // Update VisualField with real ID for future lookups
          if (localImages.length > 0) {
            this.visualFieldRepo.setField(...);
          }
        }
      }

      // TIER 4: REVERSE lookup - realId -> tempId
      if (localImages.length === 0 && realId && !tempId) {
        const reverseLookupTempId = await this.indexedDb.getTempId(realId);
        if (reverseLookupTempId) {
          localImages = localImagesMap.get(reverseLookupTempId) || [];
        }
      }

      // Add photos to visualPhotos array
      for (const localImage of localImages) {
        // Check for duplicates
        // Get display URL
        // Add to array
      }
    }
  } finally {
    this.isPopulatingPhotos = false;
  }
}
```

### buildConvertedFieldsFromOrganizedData (Lines 966-1021)
```typescript
private buildConvertedFieldsFromOrganizedData(data): VisualField[] {
  const fields: VisualField[] = [];
  const allItems = [...data.comments, ...data.limitations, ...data.deficiencies];

  for (const item of allItems) {
    const key = item.key || `${item.category}_${item.templateId}`;
    const visualId = this.visualRecordIds[key];

    // Determine visualId and tempVisualId
    let effectiveVisualId: string | null = null;
    let effectiveTempVisualId: string | null = null;

    if (visualId) {
      const visualIdStr = String(visualId);
      if (visualIdStr.startsWith('temp_')) {
        effectiveTempVisualId = visualIdStr;
      } else {
        effectiveVisualId = visualIdStr;
        // Reverse lookup for tempVisualId
        for (const [tempId, mappedRealId] of this.tempIdToRealIdCache.entries()) {
          if (mappedRealId === visualIdStr) {
            effectiveTempVisualId = tempId;
            break;
          }
        }
      }
    }

    fields.push({
      key: `${this.serviceId}:${item.category}:${item.templateId}`,
      serviceId: this.serviceId,
      category: item.category,
      templateId: item.templateId,
      // ... other fields
      visualId: effectiveVisualId,
      tempVisualId: effectiveTempVisualId,
    });
  }

  return fields;
}
```

---

## Visual Detail Page

### File: `hud-visual-detail.page.ts`

### Key Properties (Lines 79-84)
```typescript
private routeSubscription?: Subscription;
private localImagesSubscription?: Subscription;
private visualFieldsSubscription?: { unsubscribe: () => void };  // Dexie liveQuery

// Track last known ID to detect changes after sync
private lastKnownHudId: string = '';
```

### ionViewWillEnter - MOBILE Reload (Lines 107-121)
```typescript
ionViewWillEnter() {
  if (environment.isWeb) {
    // WEBAPP: Clear loading state
    this.loading = false;
  } else {
    // MOBILE: Reload data (sync may have happened)
    if (this.serviceId && this.templateId) {
      this.loadVisualData();
    }
  }
}
```

### loadVisualData - MOBILE Mode (Lines 303-401)
```typescript
// MOBILE MODE: Load from Dexie visualFields first
const allFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

const field = allFields.find(f => f.templateId === this.templateId);

// Load cached templates for fallback
const cachedTemplates = await this.indexedDb.getCachedTemplates('hud');
const template = cachedTemplates.find(t =>
  Number(t.TemplateID || t.PK_ID) === this.templateId
);

// Use field data if available (has templateName)
if (field && field.templateName) {
  this.item = this.convertFieldToItem(field);
  // Update categoryName from field
  this.categoryName = field.category || this.categoryName;
}
// Merge field + template if field exists but templateName empty
else if (field && template) {
  // Use template.Name since field.templateName is empty
}
// Use template only if no field
else if (template) {
  // Item not yet selected
}

// Load photos
await this.loadPhotos();

// Subscribe to visualField changes
this.subscribeToVisualFieldChanges();
```

### subscribeToVisualFieldChanges (Lines 416-478)
```typescript
private subscribeToVisualFieldChanges() {
  if (environment.isWeb) return;

  this.visualFieldsSubscription?.unsubscribe();

  // Store current ID to detect changes
  this.lastKnownHudId = this.hudId;

  // Subscribe to visualFields changes
  const observable = liveQuery(() =>
    db.visualFields
      .where('serviceId')
      .equals(this.serviceId)
      .toArray()
  );

  this.visualFieldsSubscription = observable.subscribe({
    next: async (fields) => {
      const field = fields.find(f => f.templateId === this.templateId);
      if (!field) return;

      // Get current ID from field
      const currentHudId = field.tempVisualId || field.visualId || '';

      // Check if ID changed (sync completed)
      const hudIdChanged = currentHudId !== this.lastKnownHudId && this.lastKnownHudId !== '';

      // Update item name/text from field
      if (field.templateName && this.item) {
        if (this.item.name !== field.templateName) {
          this.item.name = field.templateName;
          this.editableTitle = field.templateName;
        }
      }

      // If ID changed, reload photos
      if (hudIdChanged) {
        this.lastKnownHudId = currentHudId;
        await this.loadPhotos();
        this.changeDetectorRef.detectChanges();
      }
    }
  });
}
```

### loadPhotos - 4-Tier Fallback (Lines 551-704)
```typescript
// MOBILE MODE: Always re-query visualFields and OVERWRITE entityId
const allFields = await db.visualFields
  .where('serviceId')
  .equals(this.serviceId)
  .toArray();

const field = allFields.find(f => f.templateId === this.templateId);

// Use tempVisualId FIRST (photos stored with original temp ID)
this.hudId = field?.tempVisualId || field?.visualId || '';
this.lastKnownHudId = this.hudId;

// Query LocalImages
let localImages = await db.localImages
  .where('entityId')
  .equals(this.hudId)
  .toArray();

// FALLBACK 1: Try alternate ID
if (localImages.length === 0 && field?.tempVisualId && field?.visualId) {
  const alternateId = (this.hudId === field.tempVisualId) ? field.visualId : field.tempVisualId;
  localImages = await db.localImages.where('entityId').equals(alternateId).toArray();
}

// FALLBACK 2: Check tempIdMappings for mapped realId
if (localImages.length === 0 && field?.tempVisualId) {
  const mappedRealId = await this.indexedDb.getRealId(field.tempVisualId);
  if (mappedRealId) {
    localImages = await db.localImages.where('entityId').equals(mappedRealId).toArray();
    // Update VisualField with realId
    if (localImages.length > 0) {
      this.visualFieldRepo.setField(..., { visualId: mappedRealId });
    }
  }
}

// FALLBACK 3: REVERSE lookup (realId -> tempId)
if (localImages.length === 0 && field?.visualId && !field?.tempVisualId) {
  const reverseLookupTempId = await this.indexedDb.getTempId(field.visualId);
  if (reverseLookupTempId) {
    localImages = await db.localImages.where('entityId').equals(reverseLookupTempId).toArray();
  }
}
```

---

## Data Service Layer

### File: `hud-data.service.ts`

### createVisual - MOBILE Mode (Lines 751-841)
```typescript
async createVisual(visualData: any): Promise<any> {
  if (environment.isWeb) {
    // WEBAPP: Direct API call
  }

  // MOBILE: Offline-first
  // 1. Generate temp ID
  const tempId = this.tempId.generateTempId('hud');  // LBW uses 'lbw'

  // 2. Create placeholder
  const placeholder = {
    ...visualData,
    HUDID: tempId,        // LBW uses LBWID
    VisualID: tempId,
    PK_ID: tempId,
    _tempId: tempId,
    _localOnly: true,
    _syncing: true,
  };

  // 3. Store in IndexedDB for background sync
  await this.indexedDb.addPendingRequest({
    type: 'CREATE',
    tempId: tempId,
    endpoint: '/api/caspio-proxy/tables/LPS_Services_HUD/records?response=rows',  // LBW table
    method: 'POST',
    data: visualData,
    status: 'pending',
  });

  // 4. Cache placeholder to Dexie
  const existingRecords = await this.indexedDb.getCachedServiceData(serviceIdStr, 'hud') || [];
  await this.indexedDb.cacheServiceData(serviceIdStr, 'hud', [...existingRecords, placeholder]);

  // 5. Return immediately
  return placeholder;
}
```

### uploadVisualPhoto (Lines 1007-1071)
```typescript
async uploadVisualPhoto(visualId, file, caption, drawings, originalFile, serviceId): Promise<any> {
  // Use LocalImageService.captureImage()
  const localImage = await this.localImageService.captureImage(
    file,
    'hud',           // LBW uses 'lbw'
    visualIdStr,
    effectiveServiceId,
    caption || '',
    drawings || ''
  );

  // Get display URL
  const displayUrl = await this.localImageService.getDisplayUrl(localImage);

  // Return with stable imageId
  return {
    imageId: localImage.imageId,
    AttachID: localImage.imageId,
    HUDID: visualIdStr,   // LBW uses LBWID
    entityType: 'hud',    // LBW uses 'lbw'
    displayUrl: displayUrl,
    status: localImage.status,
    isLocalFirst: true,
  };
}
```

### getHudByService (Lines 424-439)
```typescript
async getHudByService(serviceId: string): Promise<any[]> {
  // Delegates to OfflineTemplateService (Dexie-first)
  const hudRecords = await this.offlineTemplate.getHudByService(serviceId);
  return hudRecords;
}
```

---

## Photo Handling

### Camera Capture Flow (addPhotoFromCamera in category-detail)

1. **Set flag**: `this.isCameraCaptureInProgress = true`
2. **Capture image**: `Camera.getPhoto()`
3. **Compress**: `imageCompression.compressImage()`
4. **Create LocalImage**: `localImageService.captureImage('hud', visualId, serviceId)`
5. **Get display URL**: `localImageService.getDisplayUrl()`
6. **Cache annotated image**: `indexedDb.cacheAnnotatedImage()` (if annotated)
7. **Push to visualPhotos array manually** (not via liveQuery)
8. **Cooldown**: `startLocalOperationCooldown()` (3 seconds)
9. **Clear flag**: `this.isCameraCaptureInProgress = false`

### Gallery Upload Flow
- Similar but **does NOT** set `isCameraCaptureInProgress`
- Relies on **liveQuery** to update UI after LocalImage is created

---

## Key Properties and Flags

### Cooldown Timer
```typescript
private localOperationCooldown = false;
private localOperationCooldownTimer: any = null;

private startLocalOperationCooldown() {
  if (this.localOperationCooldownTimer) clearTimeout(this.localOperationCooldownTimer);
  if (this.cacheInvalidationDebounceTimer) clearTimeout(this.cacheInvalidationDebounceTimer);

  this.localOperationCooldown = true;

  this.localOperationCooldownTimer = setTimeout(() => {
    this.localOperationCooldown = false;
  }, 3000);  // 3 second cooldown
}
```

### Mutex Flag
```typescript
private isPopulatingPhotos = false;

// In populatePhotosFromDexie:
if (this.isPopulatingPhotos) return;
this.isPopulatingPhotos = true;
try {
  // ... do work
} finally {
  this.isPopulatingPhotos = false;
}
```

### Camera Capture Flag
```typescript
private isCameraCaptureInProgress = false;

// In liveQuery handler:
if (this.isCameraCaptureInProgress) return;
```

---

## LBW Implementation Checklist

### 1. lbw-category-detail.page.ts

- [ ] Add `localImagesSubscription` property
- [ ] Add `visualFieldsSubscription` property
- [ ] Add `lastConvertedFields` property
- [ ] Add `isPopulatingPhotos` mutex flag
- [ ] Add `isCameraCaptureInProgress` flag
- [ ] Add `localOperationCooldown` and timer
- [ ] Add `liveQueryDebounceTimer`
- [ ] Implement `subscribeToLocalImagesChanges()` using `db.liveLocalImages$(serviceId, 'lbw')`
- [ ] Implement `subscribeToVisualFieldChanges()` using `visualFieldRepo.getAllFieldsForService$()`
- [ ] Implement `populatePhotosFromDexie()` with 4-tier fallback
- [ ] Implement `buildConvertedFieldsFromOrganizedData()`
- [ ] Implement `refreshLastConvertedFieldsFromDexie()`
- [ ] Update `loadDataFromCache()` to match HUD pattern
- [ ] Update `ionViewWillEnter()` to use smart reload logic
- [ ] Update `addPhotoFromCamera()` to use LocalImageService.captureImage('lbw', ...)
- [ ] Update camera capture to set `isCameraCaptureInProgress` flag
- [ ] Call subscriptions in `ionViewWillEnter()` (deferred from ngOnInit)
- [ ] Unsubscribe in `ngOnDestroy()`

### 2. lbw-visual-detail.page.ts

- [ ] Add `visualFieldsSubscription` property (liveQuery)
- [ ] Add `lastKnownLbwId` property
- [ ] Implement `subscribeToVisualFieldChanges()` with liveQuery
- [ ] Update `loadVisualData()` for MOBILE mode (Dexie-first)
- [ ] Update `loadPhotos()` with 4-tier fallback pattern
- [ ] Implement `ionViewWillEnter()` MOBILE reload
- [ ] Unsubscribe in `ngOnDestroy()`

### 3. lbw-data.service.ts (if exists) or background-sync.service.ts

- [ ] Add `lbwPhotoUploadComplete$` subject
- [ ] Add `LbwPhotoUploadComplete` interface
- [ ] Add 'lbw' case in photo upload switch
- [ ] Use `createServicesLBWAttachWithFile()` for uploads
- [ ] Emit `lbwPhotoUploadComplete$` event after upload

### 4. Background Sync Integration

- [ ] Ensure 'lbw' case handles temp ID mapping
- [ ] Update `updateEntityIdForImages()` calls for LBW
- [ ] Ensure `tempIdMappings` table used for LBW sync

---

## Key Differences from HUD

| Aspect | HUD | LBW |
|--------|-----|-----|
| Entity Type | `'hud'` | `'lbw'` |
| Temp ID Prefix | `temp_hud_` | `temp_lbw_` |
| Primary Key | `HUDID` | `LBWID` |
| Table | `LPS_Services_HUD` | `LPS_Services_LBW` |
| Attach Table | `LPS_Services_HUD_Attach` | `LPS_Services_LBW_Attach` |
| Cache Key | `'hud'` | `'lbw'` |

---

## Critical Patterns to Preserve

1. **Two-Phase Rendering**: Display page immediately (loading=false), load photos in background
2. **liveQuery Subscriptions**: React to Dexie changes without polling
3. **4-Tier ID Fallback**: realId -> tempId -> mappedId -> reverseMapping
4. **Mutex Protection**: Prevent concurrent populatePhotosFromDexie calls
5. **Camera Flag**: Suppress liveQuery during camera capture
6. **Cooldown Timer**: Prevent UI flashing during local operations
7. **Deferred Subscriptions**: Set up in ionViewWillEnter (after first paint)

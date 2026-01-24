# Domain Pitfalls: HUD Dexie-First Mobile Migration

**Domain:** Copying Dexie-first mobile implementation from engineers-foundation to hud
**Researched:** 2026-01-23
**Source Analysis:** Direct code inspection of both implementations
**Confidence:** HIGH (based on actual codebase analysis)

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or major functional breakage.

### Pitfall 1: TypeID Mismatch in Template Filtering

**What goes wrong:** HUD templates use `TypeID = 2` but copying EFE code that filters for `TypeID = 1` will load zero templates.

**Why it happens:**
- EFE uses Visual templates (`TypeID = 1`) from `LPS_Services_Visuals_Templates`
- HUD uses HUD templates (`TypeID = 2`) from `LPS_Services_HUD_Templates`
- The `HudFieldRepoService.seedFromTemplates()` already correctly filters `t.TypeID === 2`
- BUT if any copied code references visual templates or wrong TypeID, seeding fails silently

**Consequences:**
- Empty category lists in UI
- No items to select
- User thinks service is broken

**Prevention:**
- Search all copied code for `TypeID` references and verify `=== 2` for HUD
- Verify template loading path uses `getServicesHUDTemplates()` not `getServicesVisualsTemplates()`

**Detection (warning signs):**
- Categories show 0 items when expected to have many
- Console logs show "No templates to seed for this category"
- `getCachedTemplates('hud')` returns empty array

**Phase to Address:** Phase 1 - Core Container Implementation

---

### Pitfall 2: Incorrect Table/Endpoint References

**What goes wrong:** Copying EFE code retains references to Visual tables instead of HUD tables.

**Why it happens:** EFE and HUD use completely different API endpoints and Caspio tables:

| EFE (Visuals) | HUD | Purpose |
|---------------|-----|---------|
| `LPS_Services_Visuals` | `LPS_Services_HUD` | Data records |
| `LPS_Services_Visuals_Attach` | `LPS_Services_HUD_Attach` | Photo attachments |
| `LPS_Services_Visuals_Templates` | `LPS_Services_HUD_Templates` | Item templates |
| N/A | `LPS_Services_HUD_Drop` | Dropdown options |
| `VisualID` | `HUDID` | Primary key field name |

**Consequences:**
- Data saved to wrong tables
- Photos not associating with correct records
- Cross-contamination between inspection types
- API errors (404 or field not found)

**Prevention:**
- Create a table of ALL endpoint/table name substitutions before starting
- Global find-replace with manual verification
- Search for patterns: `Visuals`, `VisualID`, `visualId`, `visual`

**Detection (warning signs):**
- API errors mentioning "VisualID" when working with HUD
- Photos not appearing after upload
- Data appearing in wrong inspection type

**Phase to Address:** Phase 1 - Core Container Implementation

---

### Pitfall 3: Entity Type Mismatch in LocalImageService

**What goes wrong:** Photo uploads use wrong `entityType`, causing photos to not appear or be orphaned.

**Why it happens:** The `LocalImageService` uses `entityType` to categorize photos:
- EFE Visuals use: `entityType: 'visual'`
- EFE Points use: `entityType: 'efe_point'`
- HUD should use: `entityType: 'hud'`

The existing `HudDataService.uploadVisualPhoto` already correctly uses `'hud'` as entityType (line 662):
```typescript
const localImage = await this.localImageService.captureImage(
  file,
  'hud',  // CORRECT
  String(hudId),
  serviceId,
  caption,
  drawings || ''
);
```

**Consequences:**
- Photos stored but not retrieved (wrong entityType query)
- Duplicate photos appearing
- Photos missing from attachments list

**Prevention:**
- Verify all `captureImage()` calls use `'hud'` entity type
- Check `getImagesForEntity()` calls match
- Ensure `ImageEntityType` includes `'hud'` (already does per caspio-db.ts line 14)

**Detection (warning signs):**
- Photo count increments but photos don't display
- Console logs show 0 local images for HUD
- Photos appear after full refresh but not immediately

**Phase to Address:** Phase 2 - Category Detail Implementation

---

### Pitfall 4: Missing Dexie Table for HUD Fields

**What goes wrong:** Operations reference `db.hudFields` but it's not properly indexed or seeded.

**Why it happens:**
- `hudFields` table was added in Dexie schema version 11 (caspio-db.ts line 456)
- Existing installations may not have migrated
- Index structure must match query patterns

**Current Schema:**
```typescript
hudFields: '++id, key, [serviceId+category], [serviceId+category+templateId], serviceId, dirty, updatedAt'
```

**Consequences:**
- Queries fail silently and return empty arrays
- Fields not persisting between app restarts
- Slow queries if indexes don't match WHERE clauses

**Prevention:**
- Verify Dexie version migration runs on app startup
- Test on device with existing data to verify migration
- Use compound index `[serviceId+category]` for category queries (already implemented correctly)

**Detection (warning signs):**
- `db.hudFields.count()` returns 0 after seeding
- Console IndexedDB errors during queries
- Slow page loads in category detail

**Phase to Address:** Phase 1 - Core Container Implementation

---

### Pitfall 5: Rehydration Logic Missing for HUD

**What goes wrong:** After purging/archiving service data, HUD doesn't restore from server.

**Why it happens:**
- EFE Container has explicit rehydration check (lines 145-167):
  ```typescript
  const needsRehydration = await this.foundationData.needsRehydration(newServiceId);
  if (needsRehydration) {
    // ... restore data from server
  }
  ```
- HUD Container currently lacks this (would need `HudDataService.needsRehydration()`)

**Consequences:**
- User returns to previously-worked service, all data appears gone
- User re-enters data that already exists on server
- Data duplication when old + new both sync

**Prevention:**
- Implement `HudDataService.needsRehydration()`
- Implement `HudDataService.rehydrateService()`
- Add rehydration check in `HudContainerPage.ngOnInit()` before download

**Detection (warning signs):**
- Service that was previously complete now shows empty
- Console shows "No HUD templates cached" for known-good service
- ServiceMetadata shows `purgeState: 'PURGED'` for service

**Phase to Address:** Phase 3 - Background Sync Integration

---

## Moderate Pitfalls

Mistakes that cause delays, bugs, or technical debt.

### Pitfall 6: Background Sync Event Subscription Mismatch

**What goes wrong:** HUD container subscribes to wrong sync events or misses HUD-specific events.

**Why it happens:** EFE and HUD have different sync event streams:

| EFE Events | HUD Events |
|------------|------------|
| `visualSyncComplete$` | `hudSyncComplete$` |
| `photoUploadComplete$` | `hudPhotoUploadComplete$` |
| `efeRoomSyncComplete$` | N/A |
| `efePointSyncComplete$` | N/A |

**Current HUD Container** already correctly subscribes to HUD events (lines 166-188):
```typescript
private subscribeToSyncEvents(): void {
  const hudSyncSub = this.backgroundSync.hudSyncComplete$.subscribe(...);
  const photoSub = this.backgroundSync.hudPhotoUploadComplete$.subscribe(...);
  const serviceSub = this.backgroundSync.serviceDataSyncComplete$.subscribe(...);
}
```

**Prevention:**
- Verify all sync subscriptions reference HUD-specific subjects
- Don't copy EFE-specific subscriptions (efeRoomSyncComplete$, efePointSyncComplete$)
- Test sync completion triggers UI refresh

**Detection (warning signs):**
- Data syncs but UI doesn't update
- Must manually refresh to see synced data
- Console shows sync complete but cache not invalidated

**Phase to Address:** Phase 3 - Background Sync Integration

---

### Pitfall 7: Cache Key Collision Between Templates

**What goes wrong:** HUD and EFE templates stored under same cache key, causing wrong templates to load.

**Why it happens:** IndexedDB caching uses type-based keys:
- Visual templates: `getCachedTemplates('visual')`
- EFE templates: `getCachedTemplates('efe')`
- HUD templates: `getCachedTemplates('hud')`
- HUD dropdown: `getCachedTemplates('hud_dropdown')`

If copy-paste error uses `'visual'` instead of `'hud'`, wrong templates load.

**Prevention:**
- Verify all `getCachedTemplates()` and `cacheTemplates()` calls use `'hud'` or `'hud_dropdown'`
- The OfflineTemplateService already has correct HUD-specific methods

**Detection (warning signs):**
- HUD categories showing visual template items
- Template names don't match HUD inspection type
- Missing HUD-specific fields like AnswerType=2 dropdowns

**Phase to Address:** Phase 1 - Core Container Implementation

---

### Pitfall 8: Operations Queue Executor Registration Timing

**What goes wrong:** HUD operations fail because executors not registered before first operation.

**Why it happens:**
- `HudOperationsQueueService.registerExecutors()` must be called before any `enqueue*()` calls
- Current implementation calls it in `syncDirtyFields()` (line 547)
- If operations are queued before sync runs, they fail

**Existing Implementation:**
```typescript
async syncDirtyFields(serviceId: string): Promise<number> {
  // ...
  // Ensure executors are registered
  this.registerExecutors();
  // ...
}
```

**Prevention:**
- Call `registerExecutors()` during app initialization (not on-demand)
- OR ensure first sync happens before any user interactions queue operations
- Add guard in `enqueue*` methods to register if needed

**Detection (warning signs):**
- First HUD operation fails with "Unknown operation type"
- Subsequent operations work after first sync
- Queue shows operations stuck in 'pending' status

**Phase to Address:** Phase 3 - Background Sync Integration

---

### Pitfall 9: Service Instance Number Logic Not Applicable

**What goes wrong:** Copying EFE's multi-service instance numbering code that doesn't apply to HUD.

**Why it happens:**
- EFE allows multiple EFE services per project (shows "EFE #1", "EFE #2")
- EFE Container has `loadServiceInstanceNumber()` method (lines 250-316)
- HUD typically doesn't have multiple instances per project
- Copying this logic adds complexity without benefit

**Current HUD Container** does NOT have this logic (correctly).

**Prevention:**
- Don't copy `loadServiceInstanceNumber()` or `serviceInstanceNumber`/`totalEFEServices` variables
- Keep simple "HUD/Manufactured Home" title without instance numbers
- If multi-instance needed later, implement as separate enhancement

**Detection (warning signs):**
- Code references `totalEFEServices` in HUD context
- Header shows "HUD #1" when only one HUD service
- Extra API calls loading all services just for numbering

**Phase to Address:** Phase 1 - Core Container Implementation (don't copy this)

---

### Pitfall 10: Different Data Structures - No Elevation Plot Equivalent

**What goes wrong:** Attempting to copy EFE Elevation Plot functionality to HUD which doesn't have it.

**Why it happens:**
- EFE has complex nested structure: Service -> Rooms -> Points -> Photos
- EFE uses `EfeField` with `elevationPoints` array, FDF photos, etc.
- HUD is simpler: Service -> Categories -> Items -> Photos
- HUD uses `HudField` without room/point nesting

**Structural Differences:**

| EFE | HUD |
|-----|-----|
| `Services_EFE` (rooms) | N/A |
| `Services_EFE_Points` | N/A |
| `Services_EFE_Points_Attach` | N/A |
| `Services_Visuals` (structural) | `Services_HUD` (items) |
| `efeFields` Dexie table | `hudFields` Dexie table |
| `EfeFieldRepoService` | `HudFieldRepoService` |

**Prevention:**
- Don't copy: `ElevationPlotHubPage`, `RoomElevationPage`, `BaseStationPage`
- Don't copy: `EfeFieldRepoService` methods for points/FDF
- Don't reference: `efe_rooms`, `efe_points`, `efe_point_attachments`
- HUD only needs: Container, Main, ProjectDetails, CategoryDetail

**Detection (warning signs):**
- Code references "rooms" or "points" in HUD context
- Import statements for EFE-specific components
- Dexie queries for `efeFields` instead of `hudFields`

**Phase to Address:** N/A (don't copy these features)

---

## Minor Pitfalls

Mistakes that cause annoyance but are easily fixable.

### Pitfall 11: Console Log Prefixes Not Updated

**What goes wrong:** Console logs show "[EF Container]" or "[Visual Data]" when running HUD code.

**Why it happens:** Copy-paste of log statements without updating prefixes.

**Prevention:**
- Find-replace `[EF ` with `[HUD ` and `[Visual ` with `[HUD `
- Review all console.log/warn/error statements

**Detection:** Misleading console output during debugging

**Phase to Address:** All phases (ongoing)

---

### Pitfall 12: Icon Mapping Inconsistencies

**What goes wrong:** Wrong icons display for HUD categories.

**Why it happens:**
- EFE's `getCategoryIcon()` maps structural category names
- HUD's existing `getCategoryIcon()` (lines 309-326) already has correct HUD icons
- If copied EFE version overwrites, wrong icons appear

**Current HUD Implementation (correct):**
```typescript
private getCategoryIcon(categoryName: string): string {
  const iconMap: { [key: string]: string } = {
    'Site': 'globe-outline',
    'Foundation': 'business-outline',
    'Exterior': 'home-outline',
    // ... HUD-specific icons
  };
  return iconMap[categoryName] || 'document-text-outline';
}
```

**Prevention:**
- Don't overwrite existing `getCategoryIcon()` in HUD container
- Verify icon map matches actual HUD category names

**Detection:** Visual - wrong icons next to categories

**Phase to Address:** Phase 1 - Core Container Implementation

---

### Pitfall 13: Breadcrumb Path Structure Differences

**What goes wrong:** Breadcrumb navigation goes to wrong routes.

**Why it happens:**
- EFE breadcrumbs use: `/structural/category/{name}`, `/elevation/room/{name}`
- HUD breadcrumbs use: `/category/{name}`
- Different URL depth and structure

**Current HUD Breadcrumbs (correct):**
```typescript
// Check for category detail
const categoryMatch = url.match(/\/category\/([^\/]+)/);
if (categoryMatch) {
  this.breadcrumbs.push({
    label: categoryName,
    path: `category/${categoryMatch[1]}`,
    icon: categoryIcon
  });
}
```

**Prevention:**
- Keep HUD's simpler breadcrumb structure
- Don't copy EFE's structural/elevation path logic

**Detection:** Clicking breadcrumb navigates to wrong page or 404

**Phase to Address:** Phase 1 - Core Container Implementation

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|----------------|------------|
| 1 | Container Setup | TypeID mismatch | Verify all template queries use TypeID=2 |
| 1 | Container Setup | Table name refs | Global search for "Visuals" in copied code |
| 1 | Container Setup | Instance numbering | Don't copy loadServiceInstanceNumber() |
| 2 | Category Detail | EntityType for photos | Verify 'hud' used in LocalImageService calls |
| 2 | Category Detail | Field repo seeding | Test seedFromTemplates() on fresh install |
| 3 | Background Sync | Event subscriptions | Map EFE events to HUD equivalents |
| 3 | Background Sync | Rehydration | Implement needsRehydration() for HUD |
| 3 | Background Sync | Executor timing | Register executors at app init |
| N/A | Don't Copy | Elevation Plot | No rooms/points in HUD architecture |

## Checklist Before Each Phase

### Phase 1 Checklist
- [ ] All `TypeID` references verified as `=== 2`
- [ ] All table names changed from `Visuals` to `HUD`
- [ ] All `VisualID` references changed to `HUDID`
- [ ] Cache keys use `'hud'` not `'visual'`
- [ ] No instance numbering code copied
- [ ] Console log prefixes updated

### Phase 2 Checklist
- [ ] `entityType: 'hud'` in all photo operations
- [ ] `HudFieldRepoService` methods work correctly
- [ ] Template seeding creates expected items
- [ ] Photo count updates after capture

### Phase 3 Checklist
- [ ] Sync event subscriptions use HUD subjects
- [ ] Executor registration happens before operations
- [ ] Rehydration logic implemented
- [ ] Cache invalidation triggers UI updates

## Sources

- Direct code analysis:
  - `src/app/pages/engineers-foundation/engineers-foundation-container/engineers-foundation-container.page.ts`
  - `src/app/pages/hud/hud-container/hud-container.page.ts`
  - `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts`
  - `src/app/pages/hud/hud-data.service.ts`
  - `src/app/pages/hud/services/hud-field-repo.service.ts`
  - `src/app/pages/hud/services/hud-operations-queue.service.ts`
  - `src/app/services/caspio-db.ts`
  - `src/app/services/caspio.service.ts`
  - `src/app/services/offline-template.service.ts`
  - `src/app/services/background-sync.service.ts`

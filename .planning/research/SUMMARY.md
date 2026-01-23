# Project Research Summary

**Project:** HUD Template Dexie-First Migration
**Domain:** Ionic/Angular Mobile Offline-First Architecture Migration
**Researched:** 2026-01-23
**Confidence:** HIGH

## Executive Summary

The HUD template needs to adopt the Dexie-first mobile architecture already successfully implemented in the engineers-foundation template. This is not a greenfield project - it's copying a proven pattern within the same codebase. The research reveals that HUD already has 70% of the required infrastructure (HudFieldRepoService, HudOperationsQueueService, HudDataService), but the category-detail page and container lack critical integration points.

The engineers-foundation template demonstrates a mature offline-first pattern: field-level Dexie storage with dirty flags, write-through caching, queued API operations with deduplication, and local-first photo handling. The architecture bifurcates cleanly - mobile uses Dexie/IndexedDB while webapp uses direct API calls with in-memory caching. HUD must replicate this exact pattern to achieve feature parity.

The main risk is copy-paste errors that cause table name mismatches (Visuals vs HUD), TypeID filtering mistakes (1 vs 2), or entity type confusion. These silent failures cause empty screens or data loss. Prevention requires careful validation at each integration point and systematic search-and-replace of domain-specific references.

## Key Findings

### Recommended Stack

The HUD migration doesn't choose new technologies - it adopts existing ones already proven in engineers-foundation.

**Core technologies:**
- **Dexie.js** (IndexedDB wrapper) - Already implemented in `caspio-db.ts` with `hudFields` table (v11 schema). Provides live queries for reactive UI updates without manual refresh loops.
- **HudFieldRepoService** - Complete implementation exists. Handles field-level CRUD, seeding from cached templates, merging existing server records, and dirty flag tracking for sync.
- **HudOperationsQueueService** - Complete implementation with executors registered. Provides deduplication, dependency resolution, temp ID mapping, and retry logic for batched API operations.
- **LocalImageService** - Shared service for local-first photo storage. Uses stable UUIDs, stores blobs in IndexedDB, queues uploads for background sync with `entityType: 'hud'`.
- **BackgroundSyncService** - Shared service that processes pending operations on 60-second intervals, emits `hudSyncComplete$` and `hudPhotoUploadComplete$` events for UI refresh.

**Critical version requirements:**
- Dexie schema v11 or higher (adds `hudFields` table)
- Compound indexes: `[serviceId+category]`, `[serviceId+category+templateId]` for efficient queries

### Expected Features

**Must have (table stakes):**
- **Immediate local writes** - Every field change writes to Dexie instantly (dirty=true), no loading states within template
- **Offline capability** - All CRUD operations work offline, queued for later sync
- **Local-first photos** - Photos appear immediately with local blob URLs, upload silently in background
- **Template loading overlay** - Container blocks UI until offline data ready, prevents "data appearing to load twice" UX issue
- **Rehydration after purge** - Restore service data from server if previously archived/purged
- **Reactive UI** - LiveQuery subscriptions auto-update UI when underlying Dexie data changes
- **Platform bifurcation** - Mobile uses Dexie path, webapp uses direct API with 5-min in-memory cache

**Should have (competitive):**
- **Service instance tracking** - Display "HUD #1", "HUD #2" for multiple HUD services on same project (engineers-foundation has this)
- **Cache invalidation Subject** - Debounced `cacheInvalidated$` Subject for coordinated page refreshes after sync events
- **Cache health verification** - `verifyCacheHealth()` and `ensureDataCached()` methods for robust template validation

**Defer (v2+):**
- Advanced queue visualizations (operation status indicators)
- Manual sync triggers (let automatic 60s interval handle it)
- Granular sync status per field (binary dirty flag sufficient)

### Architecture Approach

The Dexie-first architecture follows a clear container-first pattern: the HudContainer downloads templates to IndexedDB, child pages (category-detail) seed Dexie from cached templates, subscribe to liveQuery for reactive updates, and write changes immediately to Dexie with dirty flags. Background sync processes the operations queue, updating server and clearing dirty flags. The pattern cleanly separates mobile (Dexie-first) from webapp (API-direct) using platform detection guards.

**Major components:**

1. **HudContainerPage** - Entry point, orchestrates template download, rehydration check, loading overlay, static lastLoadedServiceId tracking to prevent redundant re-downloads, sync event subscriptions
2. **HudFieldRepoService** - Dexie CRUD layer, `seedFromTemplates()` for initial population, `mergeExistingHudRecords()` to apply selections, `liveHudFields$()` for reactive queries, `setField()` for write-through with dirty tracking
3. **HudOperationsQueueService** - API batching layer, `enqueueCreateHudVisual()`, `enqueueUpdateHudVisual()`, `enqueueDeleteHudVisual()`, executor registration with deduplication keys and dependency resolution
4. **HudDataService** - Platform-aware orchestration, `isMobile()` / `isWebapp()` routing, in-memory cache for webapp mode, rehydration logic, cache invalidation subscriptions, photo attachment merging (local + server)
5. **HudCategoryDetailPage** - UI layer, subscribes to `liveHudFields$()`, calls `setField()` on input changes, queues operations on save/blur, integrates LocalImageService for photos

### Critical Pitfalls

1. **TypeID mismatch in template filtering** - HUD uses `TypeID = 2`, engineers-foundation uses `TypeID = 1`. Copying EFE code without changing TypeID causes zero templates to load, empty category screens. Prevention: Global search for `TypeID` references, verify all equal `2` for HUD. Detection: Categories show 0 items when expected populated.

2. **Incorrect table/endpoint references** - HUD uses `LPS_Services_HUD`, `LPS_Services_HUD_Attach`, `HUDID` fields. EFE uses `LPS_Services_Visuals`, `LPS_Services_Visuals_Attach`, `VisualID`. Copy-paste without substitution saves data to wrong tables or causes API 404s. Prevention: Create substitution table, global find-replace with verification.

3. **Missing rehydration check in container** - After smart purge, service appears empty until rehydration restores from server. HUD container lacks `needsRehydration()` / `rehydrateService()` calls that EFE has. Prevention: Implement rehydration methods in HudDataService, call in container before template download.

4. **Entity type mismatch in LocalImageService** - Photos must use `entityType: 'hud'` not `'visual'` or `'efe_point'`. Wrong entity type causes photos to not appear or be orphaned. Prevention: Verify all `captureImage()` and `getImagesForEntity()` calls use correct type. HudDataService already correct (line 662).

5. **Cache key collision between templates** - `getCachedTemplates('hud')` vs `getCachedTemplates('visual')` - using wrong key loads wrong templates. Prevention: Verify all IndexedDB cache calls use `'hud'` or `'hud_dropdown'` types.

## Implications for Roadmap

Based on research, suggested phase structure follows dependency order and risk mitigation:

### Phase 1: Container Enhancements (Foundation)
**Rationale:** Container controls data loading flow - must be solid before child pages depend on it. This phase adds missing rehydration logic and service instance tracking without touching complex category-detail page logic.

**Delivers:** Robust template loading with rehydration, service instance numbering for multi-HUD projects, verified cache health checks

**Addresses:**
- Rehydration after smart purge (FEATURES.md - table stakes)
- Service instance tracking (FEATURES.md - should have)
- Template download reliability (ARCHITECTURE.md - container responsibility)

**Avoids:**
- Pitfall #3: Missing rehydration causing data loss
- Pitfall #5: Service appearing empty after purge

**Implementation:**
- Add `HudDataService.needsRehydration()` and `rehydrateService()`
- Add rehydration check in container ngOnInit before downloadTemplateData()
- Add `loadServiceInstanceNumber()` for "HUD #1" header display
- Add `verifyCacheHealth()` for template validation

### Phase 2: Data Service Enhancement (Sync Infrastructure)
**Rationale:** Data service is the orchestration layer between Dexie, API, and UI. Must have cache invalidation and comprehensive sync subscriptions before pages rely on it for refresh coordination.

**Delivers:** Full cache invalidation system, debounced sync event handling, background refresh subscriptions

**Uses:**
- BackgroundSyncService events (STACK.md - shared infrastructure)
- Cache invalidation Subject pattern (STACK.md - data service layer)

**Implements:**
- Cache invalidation architecture (ARCHITECTURE.md - component #4)
- Sync event subscription pattern (ARCHITECTURE.md - data flow step 3)

**Avoids:**
- Pitfall #6: Sync event subscription mismatch
- Race conditions from photo sync (PITFALLS.md - anti-pattern #1)

**Implementation:**
- Add `cacheInvalidated$` Subject to HudDataService
- Add `debouncedCacheInvalidation()` with 1-second debounce
- Enhance `subscribeToSyncEvents()` with full event set (following EF pattern)
- Add background refresh subscription from OfflineTemplateService
- Add `invalidateCachesForService()` method

### Phase 3: Category Detail Integration (UI Layer)
**Rationale:** With container and data service solid, wire up the UI layer to use Dexie-first pattern. This is the most complex change but has minimal risk since services are already complete.

**Delivers:** Fully functional offline-first category detail page with reactive updates, local-first photos, write-through field changes

**Addresses:**
- Field-level granular storage (FEATURES.md - table stakes)
- Immediate local writes (FEATURES.md - table stakes)
- Offline capability (FEATURES.md - table stakes)
- Local-first photos (FEATURES.md - table stakes)
- Reactive UI (FEATURES.md - table stakes)

**Uses:**
- HudFieldRepoService (STACK.md - already complete)
- HudOperationsQueueService (STACK.md - already complete)
- LocalImageService (STACK.md - shared infrastructure)

**Implements:**
- Field repository pattern (ARCHITECTURE.md - component #2)
- Operations queue pattern (ARCHITECTURE.md - component #3)

**Avoids:**
- Pitfall #1: TypeID mismatch (verify seedFromTemplates uses TypeID=2)
- Pitfall #2: Table name references (use HUDID not VisualID)
- Pitfall #4: Entity type for photos (use 'hud' entity type)

**Implementation:**
- Import HudFieldRepoService into category-detail
- Call `seedFromTemplates()` in ionViewWillEnter after templates loaded
- Call `mergeExistingHudRecords()` with existing API data
- Replace loadData() with subscription to `liveHudFields$()`
- Replace API save calls with `setField()` write-through
- Replace photo capture with LocalImageService flow
- Subscribe to sync events for visual refresh on sync complete
- Test offline: modify field, verify Dexie has data, go online, verify sync

### Phase 4: Validation and Polish (Refinement)
**Rationale:** With core Dexie-first pattern complete, ensure edge cases handled and UX polished.

**Delivers:** Finalization cleanup, validation from cached data, comprehensive error handling

**Addresses:**
- Data never lost (FEATURES.md - table stakes)
- Background sync reliability (FEATURES.md - table stakes)

**Implementation:**
- Update finalization to call `markAllCleanForService()`
- Update validation to read from Dexie cache on mobile
- Add IndexedDB connection recovery in field repo
- Test app restart persistence, offline operation, sync recovery

### Phase Ordering Rationale

- **Container first** because it controls template download and rehydration - child pages depend on this data being ready
- **Data service second** because it orchestrates cache invalidation and sync events - pages subscribe to these for coordinated refreshes
- **Category detail third** because it's the complex UI layer that consumes both container data and data service events - needs stable foundation
- **Validation last** because it's polish work that doesn't block core functionality - can iterate after Dexie-first proven working

This ordering minimizes risk by building foundation layers first, avoiding situations where UI code tries to use incomplete service methods. Each phase has clear completion criteria based on specific service methods or component integrations.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Category Detail):** Checkbox and dropdown state management in liveQuery subscriptions may need component-level state analysis - verify two-way binding doesn't conflict with reactive updates
- **Phase 4 (Validation):** Finalization sync timeout patterns - engineers-foundation has specific retry/timeout logic that may need adaptation for HUD's simpler data structure

Phases with standard patterns (skip research-phase):
- **Phase 1 (Container):** Direct copy-paste from engineers-foundation with HUD-specific substitutions - pattern is proven and well-documented in source code
- **Phase 2 (Data Service):** Cache invalidation pattern is standard Observable Subject with debounce - no novel patterns needed

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies already implemented and working in codebase (engineers-foundation template). Direct source code analysis of HudFieldRepoService, HudOperationsQueueService shows complete implementations. |
| Features | HIGH | Feature set derived from working engineers-foundation implementation and existing partial HUD implementation. All "must have" features already exist in EF, just need copying. |
| Architecture | HIGH | Component hierarchy, data flow, and integration points documented in source code. Dependency graph clear from service injection and method calls. |
| Pitfalls | HIGH | All pitfalls identified from actual code differences between EF and HUD implementations. Table name mismatches, TypeID values, entity types all verified in source. |

**Overall confidence: HIGH**

This is internal architecture replication, not external domain research. All findings based on direct codebase analysis rather than external sources. The pattern is proven working in engineers-foundation and partially implemented in HUD.

### Gaps to Address

- **Multi-service instance numbering** - Unknown if HUD projects actually have multiple HUD services. Container has logic for this in EF but may not be needed. Validation: Check production data for projects with >1 HUD service.

- **Cache health verification depth** - Unclear how comprehensive verifyCacheHealth() needs to be for HUD. EF checks multiple data types; HUD simpler structure may not need full checks. Decision: Implement basic version, enhance if issues arise.

- **Finalization timeout values** - EF uses specific retry/timeout values for finalization sync. Unknown if HUD needs same values or can use simpler approach. Testing: Use EF values initially, adjust based on HUD-specific behavior.

## Sources

### Primary (HIGH confidence)
- `src/app/pages/engineers-foundation/engineers-foundation-container/engineers-foundation-container.page.ts` - Container pattern, rehydration logic, template loading
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts` - Cache invalidation, sync subscriptions, platform bifurcation (~2200 lines, mature implementation)
- `src/app/pages/hud/services/hud-field-repo.service.ts` - Complete Dexie-first field repository (existing implementation)
- `src/app/pages/hud/services/hud-operations-queue.service.ts` - Complete operations queue with executors (existing implementation)
- `src/app/pages/hud/hud-data.service.ts` - Partial data service (~940 lines, needs enhancement)
- `src/app/services/caspio-db.ts` - Dexie schema v11, hudFields table definition, indexes
- `src/app/services/background-sync.service.ts` - Sync events, upload processing, queue execution

### Secondary (MEDIUM confidence)
- `src/app/pages/hud/hud-container/hud-container.page.ts` - Existing partial container implementation (has loading overlay, missing rehydration)
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - Existing category detail (appears to have liveQuery subscriptions but needs verification)

### Tertiary (LOW confidence)
- Production usage patterns for multi-HUD services - assumption that multiple HUD services per project exist, not verified with actual data

---
*Research completed: 2026-01-23*
*Ready for roadmap: yes*

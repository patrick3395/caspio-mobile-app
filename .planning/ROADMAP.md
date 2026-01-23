# Roadmap: HUD Template Migration

## Overview

This roadmap delivers the Dexie-first mobile implementation to the HUD template by copying the proven pattern from engineers-foundation. The work progresses from foundation (container rehydration and template loading) through orchestration (data service sync events) to UI integration (category detail with liveQuery), concluding with validation of the complete offline-first system. Each phase builds on the previous, ensuring stable infrastructure before dependent code relies on it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (e.g., 2.1): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Container Enhancements** - Foundation layer with rehydration, service tracking, and table mapping
- [ ] **Phase 2: Data Service Enhancement** - Orchestration layer with cache invalidation and sync subscriptions
- [ ] **Phase 3: Category Detail Integration** - UI layer with liveQuery, write-through, and mobile styling
- [ ] **Phase 4: Validation and Polish** - Finalization cleanup and end-to-end verification

## Phase Details

### Phase 1: Container Enhancements
**Goal**: HUD container reliably loads templates from Dexie cache, handles rehydration after purge, and tracks service instances
**Depends on**: Nothing (first phase)
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, MAP-01, MAP-02, MAP-03
**Success Criteria** (what must be TRUE):
  1. HUD container loads data from Dexie cache before making API calls
  2. HUD container shows loading overlay until offline data is ready
  3. HUD container recovers data correctly after smart purge (rehydration works)
  4. HUD container displays correct service instance number (HUD #1, #2) for multi-service projects
  5. All table references use HUD tables (not EFE/Visuals tables) with TypeID=2 filtering
**Plans**: TBD

Plans:
- [ ] 01-01: TBD (to be defined during planning)

### Phase 2: Data Service Enhancement
**Goal**: HudDataService coordinates cache invalidation and sync events for reactive page updates
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. HudDataService emits cache invalidation events that pages can subscribe to
  2. Sync events are debounced to prevent UI thrashing during rapid operations
  3. Background sync completion triggers coordinated page refresh
  4. Photo upload completion properly refreshes affected components
**Plans**: TBD

Plans:
- [ ] 02-01: TBD (to be defined during planning)

### Phase 3: Category Detail Integration
**Goal**: Category detail pages use Dexie-first pattern with reactive updates, write-through changes, and mobile-responsive styling
**Depends on**: Phase 2
**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, STYLE-01, STYLE-02, STYLE-03
**Success Criteria** (what must be TRUE):
  1. Category detail loads fields from Dexie liveQuery (reactive, not manual refresh)
  2. Field changes write to Dexie immediately (user sees instant feedback)
  3. Changes queue to Caspio API via HudOperationsQueueService (background sync)
  4. Photos appear immediately with local blob URLs before upload completes
  5. Mobile styling matches engineers-foundation layout and spacing exactly
**Plans**: TBD

Plans:
- [ ] 03-01: TBD (to be defined during planning)

### Phase 4: Validation and Polish
**Goal**: Complete system works end-to-end with proper finalization sync and error recovery
**Depends on**: Phase 3
**Requirements**: (Validation phase - verifies all prior requirements work together)
**Success Criteria** (what must be TRUE):
  1. Data persists correctly after app restart (IndexedDB survives)
  2. Offline operations sync correctly when connectivity returns
  3. Finalization reads from Dexie cache and syncs changes before completing
  4. IndexedDB connection errors recover gracefully without data loss
**Plans**: TBD

Plans:
- [ ] 04-01: TBD (to be defined during planning)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Container Enhancements | 0/? | Not started | - |
| 2. Data Service Enhancement | 0/? | Not started | - |
| 3. Category Detail Integration | 0/? | Not started | - |
| 4. Validation and Polish | 0/? | Not started | - |

---
*Roadmap created: 2026-01-23*
*Last updated: 2026-01-23*

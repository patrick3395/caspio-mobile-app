# Roadmap: HUD Template Migration

## Milestones

- [x] **v1.0 HUD Template Migration** - Phases 1-4 (shipped 2026-01-23)
- [ ] **v1.1 HUD Page Structure Refactor** - Phases 5-7 (in progress)

## Phases

<details>
<summary>v1.0 HUD Template Migration (Phases 1-4) - SHIPPED 2026-01-23</summary>

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
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Add rehydration methods to HudDataService + service instance tracking to container
- [x] 01-02-PLAN.md — Integrate rehydration check in ngOnInit + update breadcrumbs with instance numbers

### Phase 2: Data Service Enhancement
**Goal**: HudDataService coordinates cache invalidation and sync events for reactive page updates
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. HudDataService emits cache invalidation events that pages can subscribe to
  2. Sync events are debounced to prevent UI thrashing during rapid operations
  3. Background sync completion triggers coordinated page refresh
  4. Photo upload completion properly refreshes affected components
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — Add cacheInvalidated$ Subject, debounced emission, and comprehensive Dexie subscriptions

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
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Add race condition guards and debounce patterns to TypeScript
- [x] 03-02-PLAN.md — Update SCSS to edge-to-edge mobile styling with CSS Grid photos
- [x] 03-03-PLAN.md — Wire toggleItemSelection to mobile write-through path (gap closure)

### Phase 4: Validation and Polish
**Goal**: Complete system works end-to-end with proper finalization sync and error recovery
**Depends on**: Phase 3
**Requirements**: (Validation phase - verifies all prior requirements work together)
**Success Criteria** (what must be TRUE):
  1. Data persists correctly after app restart (IndexedDB survives)
  2. Offline operations sync correctly when connectivity returns
  3. Finalization reads from Dexie cache and syncs changes before completing
  4. IndexedDB connection errors recover gracefully without data loss
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — Add missing finalization sync steps (forceSyncAllPendingForService + dirty flag cleanup)
- [x] 04-02-PLAN.md — End-to-end device validation checkpoint

</details>

### v1.1 HUD Page Structure Refactor (In Progress)

**Milestone Goal:** Refactor HUD template from tab-based navigation to button-based page navigation matching engineers-foundation pattern

**Phase Numbering:**
- Integer phases (5, 6, 7): Planned milestone work
- Decimal phases (e.g., 5.1): Urgent insertions (marked with INSERTED)

- [x] **Phase 5: Navigation Refactor** - Replace tabs with button-based page navigation
- [x] **Phase 6: Project Details Page** - Copy Project Details from engineers-foundation exactly
- [ ] **Phase 7: HUD Category Detail** - Wire HUD detail page with correct tables and Dexie-first pattern

## Phase Details

### Phase 5: Navigation Refactor
**Goal**: Main page displays navigation buttons instead of tabs, enabling direct page navigation
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):
  1. Main page shows exactly 2 navigation buttons (no tab bar visible)
  2. Tapping "Project Details" button navigates to Project Details page
  3. Tapping "HUD / Mobile Manufactured" button navigates to HUD detail page
  4. Back button on sub-pages returns user to main page
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Update HUD main page cards array (2 items) and fix navigateTo path
- [x] 05-02-PLAN.md — Update HUD container goBack() for URL-based hierarchical navigation

### Phase 6: Project Details Page
**Goal**: Project Details page matches engineers-foundation layout, styling, and functionality exactly
**Depends on**: Phase 5
**Requirements**: PROJ-01, PROJ-02, PROJ-03
**Success Criteria** (what must be TRUE):
  1. Project Details page layout is visually identical to engineers-foundation
  2. Project Details page styling (fonts, colors, spacing) matches engineers-foundation
  3. Project Details page displays correct project data and allows editing
  4. Changes persist and sync correctly (Dexie-first pattern)
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — Verify HUD Project Details matches EFE (file parity + visual/functional verification)
- [x] 06-02-PLAN.md — Fix HUD container router-outlet (gap closure - critical routing fix)

### Phase 7: HUD Category Detail
**Goal**: HUD detail page loads from correct tables, displays templates, and pushes selections with Dexie-first pattern
**Depends on**: Phase 6
**Requirements**: HUD-01, HUD-02, HUD-03, HUD-04, HUD-05, DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. HUD page layout matches structural-systems/category-detail pattern
  2. HUD page loads inspection templates from LPS_Services_HUD_Templates table
  3. HUD page pushes user selections to LPS_Services_HUD table
  4. HUD page uses LPS_Services_HUD_Attach for photo attachments
  5. HUD page styling matches engineers-foundation category-detail exactly
  6. All table references use HUD tables (no EFE references remain)
  7. Dexie-first pattern works on mobile (offline reads, queued writes)
  8. Data persists offline and syncs when connectivity returns
**Plans**: 6 plans (2 original + 4 gap closure)

Plans:
- [x] 07-01-PLAN.md — Fix template loading to use ensureHudTemplatesReady (HUD templates)
- [x] 07-02-PLAN.md — Add HUDID fallback to all VisualID references (~36 locations)
- [ ] 07-03-PLAN.md — Fix MOBILE cache type references (visual -> hud) [GAP CLOSURE]
- [ ] 07-04-PLAN.md — Create getHudByService() method for HUD data loading [GAP CLOSURE]
- [ ] 07-05-PLAN.md — Wire page to use getHudByService() instead of getVisualsByService() [GAP CLOSURE]
- [ ] 07-06-PLAN.md — Fix photo upload routing to use entityType 'hud' [GAP CLOSURE]

## Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Container Enhancements | v1.0 | 2/2 | Complete | 2026-01-23 |
| 2. Data Service Enhancement | v1.0 | 1/1 | Complete | 2026-01-23 |
| 3. Category Detail Integration | v1.0 | 3/3 | Complete | 2026-01-23 |
| 4. Validation and Polish | v1.0 | 2/2 | Complete | 2026-01-24 |
| 5. Navigation Refactor | v1.1 | 2/2 | Complete | 2026-01-24 |
| 6. Project Details Page | v1.1 | 2/2 | Complete | 2026-01-25 |
| 7. HUD Category Detail | v1.1 | 2/6 | Gap Closure | - |

---
*Roadmap created: 2026-01-23*
*Last updated: 2026-01-25 (Phase 7 gap closure plans created)*

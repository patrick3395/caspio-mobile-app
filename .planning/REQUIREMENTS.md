# Requirements: HUD Template Migration

**Defined:** 2026-01-23
**Core Value:** HUD must have identical Dexie-first mobile behavior to engineers-foundation

## v1 Requirements

Requirements for copying engineers-foundation Dexie-first implementation to HUD. Each maps to roadmap phases.

### Container Layer

- [x] **CONT-01**: HUD container loads data from Dexie cache first (rehydration)
- [x] **CONT-02**: HUD container syncs with Caspio after Dexie load
- [x] **CONT-03**: HUD container tracks service instance numbers
- [x] **CONT-04**: HUD container shows loading overlay during rehydration
- [x] **CONT-05**: HUD container handles TypeID 2 filtering (HUD-specific)

### Data Service Layer

- [x] **DATA-01**: HudDataService has cache invalidation Subject
- [x] **DATA-02**: HudDataService has debounced sync events
- [x] **DATA-03**: HudDataService has comprehensive Dexie subscriptions
- [x] **DATA-04**: HudDataService coordinates refresh across components

### Category Detail Pages

- [x] **CAT-01**: Category detail pages use liveQuery for reactive Dexie queries
- [x] **CAT-02**: Field changes write to Dexie first (write-through pattern)
- [x] **CAT-03**: Changes queue to Caspio via HudOperationsQueueService
- [x] **CAT-04**: Photos stored locally first before upload
- [x] **CAT-05**: UI updates reactively from Dexie changes

### Mobile Styling

- [x] **STYLE-01**: Copy all mobile-responsive CSS from engineers-foundation
- [x] **STYLE-02**: Adapt component labels from EFE to HUD terminology
- [x] **STYLE-03**: Maintain exact same layout and spacing

### Table Mapping

- [x] **MAP-01**: Map all EFE table references to HUD equivalents
- [x] **MAP-02**: Update TypeID filtering from 1 (EFE) to 2 (HUD)
- [x] **MAP-03**: Update entity type references throughout

## v2 Requirements

Deferred to future release. Not in current roadmap.

(None - this is a focused copy implementation)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New features beyond EF | Goal is exact copy, not enhancement |
| Modifying engineers-foundation | Source template stays unchanged |
| Backend/Caspio changes | Frontend template work only |
| Performance optimizations | Copy first, optimize later if needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONT-01 | Phase 1 | Complete |
| CONT-02 | Phase 1 | Complete |
| CONT-03 | Phase 1 | Complete |
| CONT-04 | Phase 1 | Complete |
| CONT-05 | Phase 1 | Complete |
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| CAT-01 | Phase 3 | Complete |
| CAT-02 | Phase 3 | Complete |
| CAT-03 | Phase 3 | Complete |
| CAT-04 | Phase 3 | Complete |
| CAT-05 | Phase 3 | Complete |
| STYLE-01 | Phase 3 | Complete |
| STYLE-02 | Phase 3 | Complete |
| STYLE-03 | Phase 3 | Complete |
| MAP-01 | Phase 1 | Complete |
| MAP-02 | Phase 1 | Complete |
| MAP-03 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

**Phase Distribution:**
- Phase 1 (Container Enhancements): 8 requirements
- Phase 2 (Data Service Enhancement): 4 requirements
- Phase 3 (Category Detail Integration): 8 requirements
- Phase 4 (Validation and Polish): 0 (validation phase)

---
*Requirements defined: 2026-01-23*
*Traceability updated: 2026-01-23 after Phase 3 completion*

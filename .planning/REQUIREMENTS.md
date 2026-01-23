# Requirements: HUD Template Migration

**Defined:** 2026-01-23
**Core Value:** HUD must have identical Dexie-first mobile behavior to engineers-foundation

## v1 Requirements

Requirements for copying engineers-foundation Dexie-first implementation to HUD. Each maps to roadmap phases.

### Container Layer

- [ ] **CONT-01**: HUD container loads data from Dexie cache first (rehydration)
- [ ] **CONT-02**: HUD container syncs with Caspio after Dexie load
- [ ] **CONT-03**: HUD container tracks service instance numbers
- [ ] **CONT-04**: HUD container shows loading overlay during rehydration
- [ ] **CONT-05**: HUD container handles TypeID 2 filtering (HUD-specific)

### Data Service Layer

- [ ] **DATA-01**: HudDataService has cache invalidation Subject
- [ ] **DATA-02**: HudDataService has debounced sync events
- [ ] **DATA-03**: HudDataService has comprehensive Dexie subscriptions
- [ ] **DATA-04**: HudDataService coordinates refresh across components

### Category Detail Pages

- [ ] **CAT-01**: Category detail pages use liveQuery for reactive Dexie queries
- [ ] **CAT-02**: Field changes write to Dexie first (write-through pattern)
- [ ] **CAT-03**: Changes queue to Caspio via HudOperationsQueueService
- [ ] **CAT-04**: Photos stored locally first before upload
- [ ] **CAT-05**: UI updates reactively from Dexie changes

### Mobile Styling

- [ ] **STYLE-01**: Copy all mobile-responsive CSS from engineers-foundation
- [ ] **STYLE-02**: Adapt component labels from EFE to HUD terminology
- [ ] **STYLE-03**: Maintain exact same layout and spacing

### Table Mapping

- [ ] **MAP-01**: Map all EFE table references to HUD equivalents
- [ ] **MAP-02**: Update TypeID filtering from 1 (EFE) to 2 (HUD)
- [ ] **MAP-03**: Update entity type references throughout

## v2 Requirements

Deferred to future release. Not in current roadmap.

(None — this is a focused copy implementation)

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
| CONT-01 | Phase 1 | Pending |
| CONT-02 | Phase 1 | Pending |
| CONT-03 | Phase 1 | Pending |
| CONT-04 | Phase 1 | Pending |
| CONT-05 | Phase 1 | Pending |
| DATA-01 | Phase 2 | Pending |
| DATA-02 | Phase 2 | Pending |
| DATA-03 | Phase 2 | Pending |
| DATA-04 | Phase 2 | Pending |
| CAT-01 | Phase 3 | Pending |
| CAT-02 | Phase 3 | Pending |
| CAT-03 | Phase 3 | Pending |
| CAT-04 | Phase 3 | Pending |
| CAT-05 | Phase 3 | Pending |
| STYLE-01 | Phase 3 | Pending |
| STYLE-02 | Phase 3 | Pending |
| STYLE-03 | Phase 3 | Pending |
| MAP-01 | Phase 1-3 | Pending |
| MAP-02 | Phase 1-3 | Pending |
| MAP-03 | Phase 1-3 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-23*
*Last updated: 2026-01-23 after initial definition*

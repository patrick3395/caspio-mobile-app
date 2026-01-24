# Requirements: HUD Template v1.1

**Defined:** 2026-01-24
**Core Value:** Field engineers can complete HUD inspections on mobile with offline capability

## v1.1 Requirements

Requirements for HUD page structure refactor. Each maps to roadmap phases.

### Navigation Structure

- [ ] **NAV-01**: Main page displays 2 navigation buttons (not tabs)
- [ ] **NAV-02**: "Project Details" button navigates to Project Details page
- [ ] **NAV-03**: "HUD / Mobile Manufactured" button navigates to HUD detail page
- [ ] **NAV-04**: Back button returns to main page from sub-pages

### Project Details Page

- [ ] **PROJ-01**: Project Details page layout matches engineers-foundation exactly
- [ ] **PROJ-02**: Project Details page styling matches engineers-foundation exactly
- [ ] **PROJ-03**: Project Details page functionality matches engineers-foundation

### HUD Category Detail Page

- [ ] **HUD-01**: HUD page layout matches structural-systems/category-detail
- [ ] **HUD-02**: HUD page loads templates from LPS_Services_HUD_Templates
- [ ] **HUD-03**: HUD page pushes selections to LPS_Services_HUD
- [ ] **HUD-04**: HUD page uses LPS_Services_HUD_Attach for photos
- [ ] **HUD-05**: HUD page styling matches engineers-foundation category-detail

### Data Layer

- [ ] **DATA-01**: All EFE table references replaced with HUD equivalents
- [ ] **DATA-02**: Dexie-first pattern functional on mobile
- [ ] **DATA-03**: Offline data persists and syncs correctly

## Future Requirements

Deferred to future milestones. Not in current roadmap.

(None - focused refactor milestone)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multiple HUD categories | HUD has single category, direct navigation |
| Elevation Plot section | Not needed for HUD inspections |
| New features beyond EF parity | Goal is pattern match, not enhancement |
| Backend/Caspio schema changes | Frontend refactor only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NAV-01 | Phase 5 | Pending |
| NAV-02 | Phase 5 | Pending |
| NAV-03 | Phase 5 | Pending |
| NAV-04 | Phase 5 | Pending |
| PROJ-01 | Phase 6 | Pending |
| PROJ-02 | Phase 6 | Pending |
| PROJ-03 | Phase 6 | Pending |
| HUD-01 | Phase 7 | Pending |
| HUD-02 | Phase 7 | Pending |
| HUD-03 | Phase 7 | Pending |
| HUD-04 | Phase 7 | Pending |
| HUD-05 | Phase 7 | Pending |
| DATA-01 | Phase 7 | Pending |
| DATA-02 | Phase 7 | Pending |
| DATA-03 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-01-24*
*Last updated: 2026-01-24 after roadmap creation*

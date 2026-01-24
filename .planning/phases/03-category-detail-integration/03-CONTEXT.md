# Phase 3: Category Detail Integration - Context

**Gathered:** 2026-01-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Category detail pages use Dexie-first pattern with reactive updates (liveQuery), write-through changes to local DB with background API sync, and mobile-responsive styling that matches engineers-foundation exactly. This phase delivers the UI layer that consumes the data service infrastructure from Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Field editing UX
- Match engineers-foundation exactly — no deviations
- Same timing pattern for Dexie writes (copy EFE approach)
- Same validation error display (copy EFE approach)
- HUD fields behave identically to EFE fields — no HUD-specific differences

### Photo handling
- Photo layout matches EFE exactly (grid, carousel, or whatever EFE uses)
- Upload state display matches EFE exactly (placeholder, spinner, badge — whatever EFE does)
- Photo capture trigger matches EFE exactly (FAB, inline button — whatever EFE uses)
- Photo deletion flow matches EFE exactly (confirmation, swipe — whatever EFE does)

### Offline indicators
- Sync status visibility matches EFE exactly
- Pending changes indicator matches EFE exactly
- Sync error handling matches EFE exactly
- Connectivity feedback matches EFE exactly

### Mobile layout
- **Pixel-perfect match to EFE** — same spacing, font sizes, margins, users shouldn't notice any difference
- HUD is simpler than EFE — no unique elements requiring new styling decisions
- Scroll behavior matches EFE exactly (sticky headers if present, etc.)
- Breakpoint matches EFE exactly

### Claude's Discretion
- None — all decisions locked to "match EFE exactly"

</decisions>

<specifics>
## Specific Ideas

- **Core principle:** The implementation strategy is to copy engineers-foundation patterns exactly. The researcher should identify what EFE does for each area, and the planner should replicate it.
- HUD is a simpler template than EFE (no rooms/points), so this is about taking a subset of EFE functionality, not extending it.
- Pixel-perfect mobile styling is required — this is not "similar feel" but exact match.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-category-detail-integration*
*Context gathered: 2026-01-23*

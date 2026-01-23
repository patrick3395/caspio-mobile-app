# HUD Template Migration

## What This Is

A migration project to copy the complete Dexie-first mobile implementation from the engineers-foundation template to the hud template. The hud template currently has a basic skeleton and needs the full implementation pattern — Dexie-first data loading, mobile-responsive styling, and component structure — with only the table endpoints and labels changed (EFE tables → HUD tables).

## Core Value

The hud template must have identical Dexie-first mobile behavior to engineers-foundation — same offline-first loading pattern, same responsive styling, same user experience.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Copy Dexie-first data loading pattern from engineers-foundation to hud
- [ ] Copy mobile-responsive styling from engineers-foundation to hud
- [ ] Copy component structure/hierarchy from engineers-foundation to hud
- [ ] Adapt table references from EFE tables to HUD tables
- [ ] Adapt component labels from EFE terminology to HUD terminology

### Out of Scope

- Modifying engineers-foundation — source template stays unchanged
- Adding new features beyond what engineers-foundation has
- Backend/Caspio changes — only frontend template work

## Context

**Source template:** `src/app/pages/engineers-foundation`
- Fully working Dexie-first mobile implementation
- Reference implementation to copy from

**Target template:** `src/app/pages/hud`
- Currently a basic skeleton
- Needs complete implementation copy

**Key pattern:** Dexie-first means loading from local Dexie cache first, then syncing with Caspio backend. This provides offline capability and faster perceived performance on mobile.

## Constraints

- **Pattern fidelity**: Must match engineers-foundation exactly (same approach, not a new interpretation)
- **Table mapping**: EFE table references must map to corresponding HUD tables
- **Existing codebase**: Follow established patterns in the Caspio codebase

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Exact copy approach | User wants identical implementation, not reimplementation | — Pending |
| Table-only differences | Only table endpoints and labels change between templates | — Pending |

---
*Last updated: 2026-01-23 after initialization*

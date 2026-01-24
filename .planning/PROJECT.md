# HUD Template

## What This Is

A mobile-first HUD (Mobile Manufactured Home) inspection template for field engineers. The template allows users to navigate through Project Details and HUD inspection categories, select visual items from templates, attach photos, and sync data offline-first via Dexie/IndexedDB.

## Core Value

Field engineers can complete HUD inspections on mobile devices with offline capability — data persists locally and syncs when connectivity returns.

## Current Milestone: v1.1 HUD Page Structure Refactor

**Goal:** Refactor HUD template from tab-based to button-based navigation with proper page hierarchy matching engineers-foundation patterns.

**Target features:**
- Button-based main page (Project Details + HUD/Mobile Manufactured)
- Proper page navigation (tap button → enter page → back to return)
- Project Details page matching engineers-foundation exactly
- HUD category-detail page with correct table references
- Dexie-first pattern working on mobile

## Requirements

### Validated

<!-- Shipped and confirmed valuable from v1.0 HUD Template Migration -->

- ✓ HUD container loads data from Dexie cache first (rehydration) — v1.0
- ✓ HUD container syncs with Caspio after Dexie load — v1.0
- ✓ HUD container tracks service instance numbers — v1.0
- ✓ HUD container shows loading overlay during rehydration — v1.0
- ✓ HudDataService has cache invalidation Subject — v1.0
- ✓ HudDataService has debounced sync events — v1.0
- ✓ HudDataService has comprehensive Dexie subscriptions — v1.0
- ✓ Category detail pages use liveQuery for reactive Dexie queries — v1.0
- ✓ Field changes write to Dexie first (write-through pattern) — v1.0
- ✓ Changes queue to Caspio via HudOperationsQueueService — v1.0
- ✓ Photos stored locally first before upload — v1.0

### Active

<!-- Current scope for v1.1 -->

- [ ] Main page uses button navigation (not tabs)
- [ ] Main page has exactly 2 buttons: Project Details and HUD/Mobile Manufactured
- [ ] Project Details page matches engineers-foundation exactly
- [ ] HUD page uses category-detail layout from engineers-foundation
- [ ] HUD page pulls templates from LPS_Services_HUD_Templates
- [ ] HUD page pushes selections to LPS_Services_HUD
- [ ] HUD page uses LPS_Services_HUD_Attach for photos
- [ ] All EFE table references replaced with HUD table references
- [ ] Dexie-first pattern functional on mobile devices

### Out of Scope

- Multiple HUD categories (HUD has single category, goes directly to detail)
- Elevation Plot section (not needed for HUD)
- New features beyond engineers-foundation parity
- Backend/Caspio schema changes

## Context

**Source template:** `src/app/pages/engineers-foundation`
- Reference implementation for page structure and styling
- Project Details, Structural Systems, Elevation Plot sections
- Button-based navigation into sub-pages

**Target template:** `src/app/pages/hud`
- Currently has tab-based navigation (wrong)
- Currently pulls from EFE tables (wrong)
- Needs refactor to match engineers-foundation patterns

**Table Mapping:**

| Engineers-Foundation | HUD | Purpose |
|---------------------|-----|---------|
| `LPS_Services_EFE_Templates` | `LPS_Services_HUD_Templates` | Template definitions |
| `LPS_Services_Visuals` | `LPS_Services_HUD` | User selections |
| `LPS_Services_Visuals_Attach` | `LPS_Services_HUD_Attach` | Photo attachments |

**Key pattern:** Dexie-first means loading from local Dexie cache first, then syncing with Caspio backend. This provides offline capability and faster perceived performance on mobile.

## Constraints

- **Pattern fidelity**: Must match engineers-foundation navigation and layout patterns
- **Table mapping**: All EFE references must map to corresponding HUD tables
- **Existing services**: Use existing HudFieldRepoService, HudOperationsQueueService, HudDataService

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Exact copy approach | User wants identical implementation to engineers-foundation | ✓ Good |
| Table-only differences | Only table endpoints and labels change between templates | ✓ Good |
| Button navigation over tabs | Match engineers-foundation pattern, better mobile UX | — Pending |
| Single HUD category | HUD doesn't need category selection, goes direct to detail | — Pending |

---
*Last updated: 2026-01-24 after milestone v1.1 initialization*

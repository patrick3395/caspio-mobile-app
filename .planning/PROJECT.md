# HUD Template

## What This Is

A mobile-first HUD (Mobile Manufactured Home) inspection template for field engineers. The template allows users to navigate through Project Details and HUD inspection categories via button-based navigation, select visual items from templates, attach photos, and sync data offline-first via Dexie/IndexedDB.

## Core Value

Field engineers can complete HUD inspections on mobile devices with offline capability — data persists locally and syncs when connectivity returns.

## Current State

**Version:** v1.1 shipped (2026-01-25)
**Next milestone:** Planning

### What's Built

- Button-based navigation (Project Details + HUD / Mobile Manufactured)
- Router-outlet container pattern for child route rendering
- Project Details page matching engineers-foundation exactly
- HUD category-detail page with correct table references
- Dexie-first offline pattern on mobile
- Background sync with queued operations

### Tech Stack

- Ionic/Angular mobile app
- Dexie.js for IndexedDB (offline storage)
- Caspio backend (API + tables)
- S3 for photo storage

## Requirements

### Validated

<!-- Shipped and confirmed valuable -->

**v1.0 HUD Template Migration:**
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

**v1.1 HUD Page Structure Refactor:**
- ✓ Main page uses button navigation (not tabs) — v1.1
- ✓ Main page has exactly 2 buttons: Project Details and HUD/Mobile Manufactured — v1.1
- ✓ Project Details page matches engineers-foundation exactly — v1.1
- ✓ HUD page uses category-detail layout from engineers-foundation — v1.1
- ✓ HUD page pulls templates from LPS_Services_HUD_Templates — v1.1
- ✓ HUD page pushes selections to LPS_Services_HUD — v1.1
- ✓ HUD page uses LPS_Services_HUD_Attach for photos — v1.1
- ✓ All EFE table references replaced with HUD table references — v1.1
- ✓ Dexie-first pattern functional on mobile devices — v1.1

### Active

<!-- Current scope - empty until next milestone defined -->

(None — defining next milestone)

### Out of Scope

- Multiple HUD categories (HUD has single category, goes directly to detail)
- Elevation Plot section (not needed for HUD)
- Backend/Caspio schema changes

## Context

**Source template:** `src/app/pages/engineers-foundation`
- Reference implementation for page structure and styling
- Project Details, Structural Systems, Elevation Plot sections
- Button-based navigation into sub-pages

**Target template:** `src/app/pages/hud`
- Now matches engineers-foundation patterns
- Uses correct HUD tables throughout
- Dexie-first offline support working

**Table Mapping:**

| Engineers-Foundation | HUD | Purpose |
|---------------------|-----|---------|
| `LPS_Services_EFE_Templates` | `LPS_Services_HUD_Templates` | Template definitions |
| `LPS_Services_Visuals` | `LPS_Services_HUD` | User selections |
| `LPS_Services_Visuals_Attach` | `LPS_Services_HUD_Attach` | Photo attachments |

## Constraints

- **Pattern fidelity**: Must match engineers-foundation navigation and layout patterns
- **Table mapping**: All EFE references must map to corresponding HUD tables
- **Existing services**: Use existing HudFieldRepoService, HudOperationsQueueService, HudDataService

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Exact copy approach | User wants identical implementation to engineers-foundation | ✓ Good |
| Table-only differences | Only table endpoints and labels change between templates | ✓ Good |
| Button navigation over tabs | Match engineers-foundation pattern, better mobile UX | ✓ Good |
| Single HUD category | HUD doesn't need category selection, goes direct to detail | ✓ Good |
| Router-outlet container | Enables child route rendering without *ngIf destruction | ✓ Good |
| CSS visibility toggle | Prevents Angular from destroying components during loading | ✓ Good |
| ensureHudTemplatesReady() | HUD-specific template loading with TypeID=2 | ✓ Good |
| 'hud' cache type | Separates HUD cache from visuals cache in IndexedDB | ✓ Good |
| entityType 'hud' for photos | Routes uploads to LPS_Services_HUD_Attach | ✓ Good |

---
*Last updated: 2026-01-25 after v1.1 milestone*

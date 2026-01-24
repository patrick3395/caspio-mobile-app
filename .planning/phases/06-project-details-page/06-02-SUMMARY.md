---
phase: 06-project-details-page
plan: 02
type: gap-closure
gap_closure: true
completed: 2026-01-24

subsystem: HUD Container
tags: [router-outlet, navigation, gap-closure, angular-routing]

dependency_graph:
  requires: ["05-02"]
  provides: ["HUD container with router-outlet for child route rendering"]
  affects: ["06-03", "07-xx"]

tech_stack:
  patterns:
    - "Router-outlet container pattern (matches EFE)"
    - "CSS visibility toggle for loading states (not *ngIf)"
    - "Breadcrumb navigation with responsive display"

key_files:
  modified:
    - src/app/pages/hud/hud-container/hud-container.page.html
    - src/app/pages/hud/hud-container/hud-container.page.ts
    - src/app/pages/hud/hud-container/hud-container.page.scss

decisions:
  - id: 06-02-01
    description: "Use CSS visibility toggle instead of *ngIf for router-outlet wrapper"
    rationale: "Prevents Angular from destroying child components during loading state changes"
  - id: 06-02-02
    description: "Match EFE container pattern exactly for consistency"
    rationale: "Established pattern works well, reduces cognitive load for developers"
  - id: 06-02-03
    description: "isGeneratingPDF as getter returning isPDFGenerating"
    rationale: "Template uses isGeneratingPDF but component already has isPDFGenerating - getter provides compatibility"

metrics:
  duration: "3 min"
  completed: "2026-01-24"
---

# Phase 06 Plan 02: HUD Container Router-Outlet Gap Closure Summary

**One-liner:** HUD container refactored from monolithic form to router-outlet container, enabling child route rendering

## What Was Done

### Task 1: Refactor HUD container HTML to router-outlet pattern
**Commit:** `82317df0`

- Replaced entire monolithic form template (~2100 lines) with router-outlet container pattern
- Added loading overlay with CSS visibility toggle (`[class.hidden]="templateReady"`)
- Added router-wrapper with CSS class toggle (`[class.loading]="!templateReady"`)
- Added breadcrumb footer navigation with responsive icons/text
- Preserved offline warning banner and sync status widget functionality

### Task 2: Add required properties and imports to HUD container TypeScript
**Commit:** `8c626468`

- Added `NavigationEnd` import and `filter` from rxjs/operators
- Added `RouterModule` and `SyncStatusWidgetComponent` to component imports
- Added `Breadcrumb` interface
- Added router-outlet support properties:
  - `templateReady`, `downloadProgress`, `breadcrumbs`
  - `currentPageTitle`, `currentPageShortTitle`, `isSubPage`, `isWeb`
  - `serviceInstanceNumber`, `totalHUDServices`, `serviceInstanceLoaded`
  - Static `lastLoadedServiceId` for navigation optimization
- Added navigation methods:
  - `navigateToHome()` - Navigate to project detail page
  - `navigateToCrumb()` - Navigate to breadcrumb path
  - `updateBreadcrumbs()` - Update breadcrumbs based on current URL
- Updated `ngOnInit()` to:
  - Subscribe to NavigationEnd events for breadcrumb updates
  - Set `templateReady = true` after data loading completes
  - Use `lastLoadedServiceId` pattern to prevent unnecessary re-downloads
- Added `isGeneratingPDF` getter returning existing `isPDFGenerating` state

### Task 3: Add router-wrapper and loading overlay styles to HUD container SCSS
**Commit:** `2efc23c2`

- Added `ion-content` background color
- Added `.template-loading-overlay` with opacity transition and `.hidden` modifier
- Added `.router-wrapper` with visibility toggle and `.loading` modifier
- Added `ion-toolbar` styles matching EFE pattern
- Added responsive title handling (full/short titles)
- Added `.breadcrumb-footer` styles with responsive icons/text
- Added breadcrumb container with horizontal scroll and hover states

### Task 4: Verify routing works end-to-end
**Verified existing configuration is correct:**

- `app-routing.module.ts` has correct HUD routes with children:
  - `path: 'hud/:projectId/:serviceId'` -> `HudContainerPage`
  - `path: ''` -> `HudMainPage`
  - `path: 'project-details'` -> `HudProjectDetailsPage`
  - `path: 'category/:category'` -> `HudCategoryDetailPage`
- All child page components exist and are properly imported
- `hud-routing.module.ts` exists as fallback but app-routing handles routes directly

## Key Technical Decisions

1. **CSS visibility toggle instead of *ngIf on router-outlet**
   - When `*ngIf` removes/adds router-outlet, Angular destroys ALL child components
   - CSS visibility toggle preserves child component state across loading changes
   - This matches the EFE pattern and is the correct Angular approach

2. **Static lastLoadedServiceId for navigation optimization**
   - Prevents unnecessary re-downloads when navigating within same service
   - Made static to persist across component recreation (Ionic destroys/recreates pages)

3. **isGeneratingPDF as getter**
   - Template uses `isGeneratingPDF` but component already has `isPDFGenerating`
   - Getter provides compatibility without duplicating state management

## Files Modified

| File | Changes |
|------|---------|
| `hud-container.page.html` | Complete replacement - monolithic form to router-outlet container |
| `hud-container.page.ts` | Added imports, properties, methods for router-outlet support |
| `hud-container.page.scss` | Added loading overlay, router-wrapper, breadcrumb styles |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Status

All success criteria met:
- [x] HUD container HTML has router-outlet tag
- [x] No *ngIf on router-outlet or its wrapper
- [x] Loading overlay uses [class.hidden] pattern
- [x] Router wrapper uses [class.loading] pattern
- [x] templateReady property exists and is set after data loads
- [x] breadcrumbs array exists with updateBreadcrumbs() method
- [x] All HUD routes correctly configured in app-routing.module.ts

## Next Steps

Child routes will now render correctly:
- `/hud/{projectId}/{serviceId}` - HudMainPage (2 navigation cards)
- `/hud/{projectId}/{serviceId}/project-details` - HudProjectDetailsPage
- `/hud/{projectId}/{serviceId}/category/{category}` - HudCategoryDetailPage

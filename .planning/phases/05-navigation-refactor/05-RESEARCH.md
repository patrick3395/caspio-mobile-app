# Phase 5: Navigation Refactor - Research

**Researched:** 2026-01-24
**Domain:** Ionic/Angular Navigation (button-based page navigation)
**Confidence:** HIGH

## Summary

Phase 5 refactors the HUD main page from displaying 3 navigation cards (copied from engineers-foundation) to 2 HUD-specific cards. The infrastructure is already in place - the HUD pages exist and routes are configured in app-routing.module.ts. This phase requires minimal code changes:

1. Update `hud-main.page.ts` cards array (3 items -> 2 items with correct routes/titles)
2. Fix hardcoded navigation path in `navigateTo()` (currently routes to `/engineers-foundation` instead of `/hud`)
3. Verify back button behavior in `hud-container` (may need `goBack()` method like EFE container)

The existing architecture follows the container + router-outlet pattern from engineers-foundation. Routes are already configured at lines 109-119 of app-routing.module.ts.

**Primary recommendation:** Update the cards array in hud-main.page.ts to show 2 buttons and fix the navigation path from `/engineers-foundation` to `/hud`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @angular/router | ^20.0.0 | Client-side routing | Angular's official router, already in use |
| @ionic/angular | ^8.0.0 | Mobile UI components | Project's existing UI framework |
| NavController | 8.x | Ionic navigation controller | Handles back navigation, history management |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| NavigationHistoryService | (custom) | Web browser back/forward support | Web platform only, defers to Ionic on mobile |
| Location | @angular/common | Browser history manipulation | When NavigationHistoryService is used |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom button navigation | ion-tabs | Tabs show persistent tab bar; buttons give full-page feel |
| Router.navigate | NavController.navigateBack | Router for forward navigation, NavController for back animation |

**Installation:**
```bash
# No additional packages needed - all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/app/pages/hud/
├── hud-container/           # Shell with header, breadcrumbs, router-outlet
├── hud-main/                # Main page with navigation buttons
├── hud-project-details/     # Project details sub-page
└── hud-category-detail/     # Category detail sub-page
```

### Pattern 1: Container + Router-Outlet Pattern
**What:** Parent container provides shell (header, footer) and child routes render into router-outlet
**When to use:** Multi-page flows within a service/feature (engineers-foundation, HUD, LBW, DTE all use this)
**Example:**
```typescript
// Source: engineers-foundation-container.page.html (existing codebase)
<ion-header>
  <ion-toolbar>
    <ion-buttons slot="start">
      <ion-button (click)="goBack()">
        <ion-icon slot="icon-only" name="arrow-back"></ion-icon>
      </ion-button>
    </ion-buttons>
    <ion-title>{{ currentPageTitle }}</ion-title>
  </ion-toolbar>
</ion-header>

<ion-content>
  <router-outlet></router-outlet>
</ion-content>

<ion-footer class="breadcrumb-footer">
  <!-- breadcrumbs -->
</ion-footer>
```

### Pattern 2: NavigationCard Array Pattern
**What:** Define navigation options as typed array, render with *ngFor
**When to use:** Main pages with multiple navigation destinations
**Example:**
```typescript
// Source: engineers-foundation-main.page.ts (existing codebase)
interface NavigationCard {
  title: string;
  icon: string;
  route: string;
  description: string;
  completed: boolean;
}

cards: NavigationCard[] = [
  {
    title: 'Project Details',
    icon: 'document-text-outline',
    route: 'project-details',
    description: 'Property information, people, and environmental conditions',
    completed: false
  },
  // ... more cards
];
```

### Pattern 3: Hierarchical Back Navigation (goBack method)
**What:** Back button navigates up the URL hierarchy, not browser history
**When to use:** Container pages managing sub-page navigation
**Example:**
```typescript
// Source: engineers-foundation-container.page.ts (existing codebase)
goBack() {
  const url = this.router.url;

  if (url.includes('/project-details') || url.includes('/structural') || url.includes('/elevation')) {
    // Sub-page: navigate to main page
    this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId]);
  } else {
    // Main page: navigate to project detail
    this.navigateToHome();
  }
}
```

### Anti-Patterns to Avoid
- **Hardcoding base route in child pages:** The HUD main page currently hardcodes `/engineers-foundation` instead of `/hud`. Use template base route variable.
- **Using *ngIf on router-outlet:** Never conditionally render router-outlet - destroys child component state. Use CSS visibility instead.
- **Mixing browser history and router navigation:** For back buttons, use explicit route navigation, not `location.back()`.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Back button navigation | Custom history stack | Router URL parsing + explicit navigation | URL-based is stateless, survives refresh |
| Loading overlay | Custom spinner + *ngIf | CSS visibility toggle | *ngIf destroys router-outlet state |
| Navigation animation | Custom transitions | NavController.navigateBack() | Ionic handles platform-specific animations |

**Key insight:** The engineers-foundation pattern is battle-tested. Copy it exactly rather than inventing new navigation patterns.

## Common Pitfalls

### Pitfall 1: Hardcoded Route Base Path
**What goes wrong:** Copying code from engineers-foundation and leaving `/engineers-foundation` hardcoded
**Why it happens:** Find-and-replace misses dynamic route construction
**How to avoid:** Search for ALL occurrences of the base route string in the file
**Warning signs:** Navigation goes to wrong page (EFE instead of HUD)

### Pitfall 2: Back Button Goes to Wrong Page
**What goes wrong:** Back button navigates to project list instead of main page
**Why it happens:** goBack() method not adapted for HUD's URL structure
**How to avoid:** Verify goBack() parses `/hud/` URLs correctly
**Warning signs:** Tapping back from project-details takes user to home, not HUD main

### Pitfall 3: Cards Array Still Has 3 Items
**What goes wrong:** HUD shows "Elevation Plot" button that doesn't exist
**Why it happens:** Copied array from engineers-foundation without trimming
**How to avoid:** Explicitly verify card count matches requirement (2 buttons)
**Warning signs:** UI shows button that leads to 404 or undefined route

### Pitfall 4: Router-Outlet Missing in Container
**What goes wrong:** Sub-pages don't render, or page shows accordion-style layout
**Why it happens:** hud-container uses old monolithic template, not new container pattern
**How to avoid:** Verify container HTML has `<router-outlet></router-outlet>` not accordion sections
**Warning signs:** Navigating to `/hud/:id/:sid/project-details` shows blank content

## Code Examples

Verified patterns from existing codebase:

### HUD Cards Array (Target State)
```typescript
// Target configuration for hud-main.page.ts
cards: NavigationCard[] = [
  {
    title: 'Project Details',
    icon: 'document-text-outline',
    route: 'project-details',
    description: 'Property information, people, and environmental conditions',
    completed: false
  },
  {
    title: 'HUD / Mobile Manufactured',
    icon: 'construct-outline',
    route: 'category/hud',  // or appropriate category route
    description: 'HUD inspection checklist items and photos',
    completed: false
  }
];
```

### Navigation Method (Fixed)
```typescript
// Source: Fixed navigateTo() for HUD
navigateTo(card: NavigationCard) {
  console.log('[HUD Main] Navigating to:', card.route, 'projectId:', this.projectId, 'serviceId:', this.serviceId);

  // Use absolute navigation with correct base route
  if (this.projectId && this.serviceId) {
    this.router.navigate(['/hud', this.projectId, this.serviceId, card.route]);
  } else {
    // Fallback to relative navigation
    this.router.navigate([card.route], { relativeTo: this.route.parent });
  }
}
```

### Container goBack Implementation
```typescript
// Adapted goBack() for HUD container (simpler than EFE - no visual/room depth)
goBack() {
  const url = this.router.url;

  if (url.includes('/category/')) {
    // On category detail - navigate to HUD main
    this.router.navigate(['/hud', this.projectId, this.serviceId]);
  } else if (url.includes('/project-details')) {
    // On project details - navigate to HUD main
    this.router.navigate(['/hud', this.projectId, this.serviceId]);
  } else {
    // On main page - navigate to project detail
    this.router.navigate(['/project', this.projectId]);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ion-tabs for service pages | Container + router-outlet | v1.0 (2026-01) | Consistent with EFE pattern |
| Accordion sections in one page | Separate routed pages | v1.0 (2026-01) | Better code organization |
| *ngIf on router-outlet | CSS visibility toggle | v1.0 (2026-01) | Preserves child component state |

**Deprecated/outdated:**
- Old hud-container.page.html (accordion-style): Still exists but not used by new route structure. The new `/hud/:projectId/:serviceId` route uses HudContainerPage which needs router-outlet added.

## Open Questions

Things that couldn't be fully resolved:

1. **HUD container HTML structure**
   - What we know: Route is configured to use `HudContainerPage` with child routes
   - What's unclear: Current hud-container.page.html has accordion sections (old style), not router-outlet (new style)
   - Recommendation: Need to verify if container needs complete rewrite or just router-outlet addition. Check if HudContainerPage at lines 23-26 of app-routing.module.ts is the new one or old one.

2. **Category route parameter**
   - What we know: Route defined as `category/:category` at line 117 of app-routing.module.ts
   - What's unclear: What value should `:category` be for HUD (e.g., "hud", specific category name, or numeric ID)
   - Recommendation: Check HudCategoryDetailPage to see how it parses the category param

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis - engineers-foundation-container.page.ts, engineers-foundation-main.page.ts
- app-routing.module.ts - Route configuration at lines 109-119

### Secondary (MEDIUM confidence)
- Pattern matching from LBW/DTE implementations (same container pattern)

### Tertiary (LOW confidence)
- None - all findings verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified from package.json and existing usage
- Architecture: HIGH - Patterns extracted from working engineers-foundation code
- Pitfalls: HIGH - Identified by analyzing differences between current hud-main.page.ts and expected behavior

**Research date:** 2026-01-24
**Valid until:** 60 days (stable patterns, no framework changes expected)

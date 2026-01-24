# Phase 6: Project Details Page - Research

**Researched:** 2026-01-24
**Domain:** Angular/Ionic Page Styling and Functionality Parity
**Confidence:** HIGH

## Summary

Phase 6 ensures HUD's Project Details page matches engineers-foundation's Project Details page in layout, styling, and functionality. After thorough comparison, the HUD Project Details page is already an exact copy of the EFE version with only necessary differences:

1. **Class name:** `ProjectDetailsPage` vs `HudProjectDetailsPage`
2. **Selector:** `app-project-details` vs `app-hud-project-details`
3. **File references:** Different paths for template/style files
4. **State service:** `EngineersFoundationStateService` vs `HudStateService`

The HTML template and SCSS styling are **byte-for-byte identical**. The TypeScript logic is functionally identical with only naming/import differences.

**Primary recommendation:** Verify the existing implementation is working correctly. Phase 6 may already be complete pending verification.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @angular/core | ^20.0.0 | Component framework | Project's existing framework |
| @ionic/angular | ^8.0.0 | Mobile UI components | Provides form elements, icons |
| @angular/forms | ^20.0.0 | FormsModule for ngModel | Two-way data binding |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| OfflineTemplateService | (custom) | Offline-first data access | Mobile mode IndexedDB operations |
| CaspioService | (custom) | Backend API access | Web mode direct API calls |
| BackgroundSyncService | (custom) | Mobile sync coordination | Real-time UI updates on mobile |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom state service | Shared state service | Would require refactor; current approach isolates HUD state cleanly |

**Installation:**
```bash
# No additional packages needed - all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/app/pages/hud/
├── hud-project-details/
│   ├── hud-project-details.page.ts     # Component logic (matches EFE)
│   ├── hud-project-details.page.html   # Template (identical to EFE)
│   ├── hud-project-details.page.scss   # Styles (identical to EFE)
│   └── hud-project-details.module.ts   # (if modular, not needed for standalone)
├── services/
│   └── hud-state.service.ts            # HUD-specific state management
└── ...
```

### Pattern 1: Offline-First Data Loading
**What:** Load from IndexedDB first (mobile), fall back to API only when cache empty
**When to use:** All data loading on mobile devices for offline capability
**Example:**
```typescript
// Source: hud-project-details.page.ts lines 219-262
private async loadProjectData() {
  let project: any = null;

  // WEBAPP MODE: Load directly from API (no IndexedDB caching)
  if (environment.isWeb) {
    project = await firstValueFrom(this.caspioService.getProject(this.projectId, false));
  } else {
    // MOBILE MODE: Try IndexedDB first
    project = await this.offlineTemplate.getProject(this.projectId);

    if (!project) {
      // Only fetch from API if IndexedDB has nothing
      const freshProject = await this.caspioService.getProject(this.projectId, false).toPromise();
      if (freshProject) {
        await this.indexedDb.cacheProjectRecord(this.projectId, freshProject);
        project = freshProject;
      }
    }
  }

  this.projectData = project || {};
}
```

### Pattern 2: Dropdown Options with "Other" Handling
**What:** Load dropdown options from API, handle custom "Other" values with inline text input
**When to use:** Any dropdown that allows custom values
**Example:**
```typescript
// Source: hud-project-details.page.ts lines 391-413
if (optionsByService['WeatherConditions']?.length > 0) {
  const currentValue = this.serviceData?.WeatherConditions;
  this.weatherConditionsOptions = optionsByService['WeatherConditions'];

  if (!this.weatherConditionsOptions.includes('Other')) {
    this.weatherConditionsOptions.push('Other');
  }

  // Handle current value - normalize to match option OR show as "Other"
  if (currentValue && currentValue !== 'Other') {
    const matchingOption = this.weatherConditionsOptions.find(opt =>
      this.normalizeForComparison(opt) === this.normalizeForComparison(currentValue)
    );
    if (!matchingOption) {
      // Value not in options - show "Other" and populate text field
      this.weatherConditionsOtherValue = currentValue;
      this.serviceData.WeatherConditions = 'Other';
    }
  }
}
```

### Pattern 3: Auto-Save with Dual Mode
**What:** Save directly to API (web) or IndexedDB with deferred sync (mobile)
**When to use:** All field changes that need persistence
**Example:**
```typescript
// Source: hud-project-details.page.ts lines 1310-1357
private async autoSaveServiceField(fieldName: string, value: any) {
  // Update local data immediately (for instant UI feedback)
  this.serviceData[fieldName] = value;

  // WEBAPP MODE: Save directly to API
  if (environment.isWeb) {
    await firstValueFrom(this.caspioService.updateService(this.serviceId, { [fieldName]: value }));
    this.showSaveStatus(`${fieldName} saved`, 'success');
    return;
  }

  // MOBILE MODE: Update IndexedDB cache, sync later
  await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });

  const isOnline = this.offlineService.isOnline();
  this.showSaveStatus(`${fieldName} saved${isOnline ? '' : ' offline'}`, 'success');
  // Sync will happen on next 60-second interval (batched sync)
}
```

### Anti-Patterns to Avoid
- **Direct API calls on mobile:** Always go through OfflineTemplateService for offline capability
- **Missing change detection:** Call `this.changeDetectorRef.detectChanges()` after async data updates
- **Hardcoded service references:** Use HudStateService, not EngineersFoundationStateService

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dropdown value normalization | Custom string matching | normalizeForComparison() | Handles degree symbols, whitespace |
| Multi-select state management | Array manipulation | Existing inAttendanceSelections pattern | Handles None exclusivity, Other custom values |
| Offline data loading | Custom caching | OfflineTemplateService | Already handles IndexedDB, sync timing |

**Key insight:** The existing EFE Project Details page has already solved all these problems. Copy the patterns exactly.

## Common Pitfalls

### Pitfall 1: Character Encoding Differences
**What goes wrong:** Degree symbols display differently or comparisons fail
**Why it happens:** Different Unicode code points for similar-looking characters
**How to avoid:** Use normalizeForComparison() for all value matching
**Warning signs:** Temperature dropdown shows "Other" when value should match

### Pitfall 2: State Service Mismatch
**What goes wrong:** Importing EngineersFoundationStateService instead of HudStateService
**Why it happens:** Copy-paste from EFE without updating imports
**How to avoid:** Verify import statements reference `hud-state.service`
**Warning signs:** Build errors, wrong service instantiated

### Pitfall 3: Missing Route Parameters
**What goes wrong:** projectId or serviceId not available from parent route
**Why it happens:** Route structure doesn't match EFE container pattern
**How to avoid:** Access params via `this.route.parent?.snapshot?.params`
**Warning signs:** Data doesn't load, console shows undefined IDs

### Pitfall 4: CSS Not Applied
**What goes wrong:** Page doesn't match EFE styling
**Why it happens:** SCSS file not imported or wrong path
**How to avoid:** Verify styleUrls in @Component decorator
**Warning signs:** Unstyled form elements, missing borders/colors

## Code Examples

Verified patterns from existing codebase:

### Form Section Structure
```html
<!-- Source: hud-project-details.page.html (identical to EFE) -->
<div class="info-group">
  <h3 class="group-title">
    <ion-icon name="people-outline"></ion-icon>
    People
  </h3>
  <div class="form-grid three-col">
    <div class="form-group" [class.filled]="projectData.ClientName">
      <label>
        <ion-icon name="person-outline"></ion-icon>
        Client Name<span class="required">*</span>
      </label>
      <input type="text" [(ngModel)]="projectData.ClientName"
             (ngModelChange)="onProjectFieldChange('ClientName', $event)"
             placeholder="Enter client name"
             required
             class="styled-input">
    </div>
  </div>
</div>
```

### Multi-Select Checkbox Pattern
```html
<!-- Source: hud-project-details.page.html lines 48-78 -->
<div class="multi-select-container-inline">
  <div class="multi-select-options-inline">
    <div class="option-item-inline" *ngFor="let option of inAttendanceOptions">
      <ion-checkbox
        [checked]="isInAttendanceSelected(option)"
        (ionChange)="onInAttendanceToggle(option, $event)">
      </ion-checkbox>
      <ion-label>{{ option }}</ion-label>
    </div>
  </div>
  <!-- Custom input for "Other" option -->
  <div class="other-input-container" *ngIf="isInAttendanceSelected('Other')">
    <input type="text"
           [(ngModel)]="inAttendanceOtherValue"
           (keyup.enter)="addInAttendanceOther()"
           placeholder="Type name and press Enter or Add..."
           class="styled-input other-input">
    <ion-button size="small" (click)="addInAttendanceOther()">
      <ion-icon name="add-outline" slot="start"></ion-icon>
      Add
    </ion-button>
  </div>
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate templates per service | Copy-exact from EFE | v1.0 (2026-01) | Consistent UX across services |
| Direct API in forms | Offline-first with sync | v1.0 (2026-01) | Works offline on mobile |

**Deprecated/outdated:**
- None specific to Project Details page

## Open Questions

Things that couldn't be fully resolved:

1. **HudStateService usage**
   - What we know: HudStateService is injected but only used minimally (constructor injection)
   - What's unclear: Whether HudStateService needs additional methods
   - Recommendation: Current implementation works; HudStateService provides placeholder for future needs

## Verification Requirements

To confirm Phase 6 is complete, verify:

1. **Layout parity:** HUD Project Details visually matches EFE Project Details
2. **Styling parity:** Same fonts, colors, spacing, responsive behavior
3. **Functional parity:**
   - All form fields load data correctly
   - All dropdowns populate options from API
   - "Other" values display inline text input
   - Multi-select checkboxes work (In Attendance, Foundation Rooms)
   - Changes auto-save (web: API, mobile: IndexedDB)
   - ionViewWillEnter refreshes data when returning to page

## Sources

### Primary (HIGH confidence)
- `src/app/pages/engineers-foundation/project-details/project-details.page.ts` - Reference implementation
- `src/app/pages/hud/hud-project-details/hud-project-details.page.ts` - HUD implementation
- Direct file comparison showing identical HTML/SCSS

### Secondary (MEDIUM confidence)
- Phase 5 verification confirming navigation works

### Tertiary (LOW confidence)
- None - all findings verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified from existing implementation
- Architecture: HIGH - Patterns extracted from working EFE code already copied to HUD
- Pitfalls: HIGH - Identified from prior phase experience

**Research date:** 2026-01-24
**Valid until:** 90 days (stable patterns, files already identical)

## Key Finding: Implementation Already Complete

**Critical insight:** The HUD Project Details page (`hud-project-details.page.*`) files are already exact copies of the EFE Project Details page with only necessary adaptations:

| File | EFE vs HUD Comparison |
|------|----------------------|
| `.page.ts` | Class name, selector, service import changed (required) |
| `.page.html` | **Identical** (no differences) |
| `.page.scss` | **Identical** (no differences) |

**Implications for Planning:**
- No code changes may be needed
- Phase 6 should focus on **verification**, not implementation
- Success criteria can be validated through testing/inspection

**Recommended plan structure:**
1. Verify existing implementation works correctly
2. Test all form functionality
3. Compare visual output between EFE and HUD
4. Document any gaps found and fix them

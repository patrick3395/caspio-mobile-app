# Phase 7: HUD Category Detail - Research

**Researched:** 2026-01-25
**Domain:** Angular/Ionic Category Detail Page with Dexie-First Pattern
**Confidence:** HIGH

## Summary

Phase 7 implements the HUD category-detail page following the exact copy approach from engineers-foundation's structural-systems/category-detail. After thorough codebase analysis, the current hud-category-detail page is already a copy of the EFE version with HudDataService injected, BUT has critical issues:

1. **Field Name Mismatch:** The page uses `VisualID` throughout, but HUD tables use `HUDID` as the primary key field
2. **Template Loading Path:** Uses `hudData.getVisualsTemplates()` which loads from `LPS_Services_Visuals_Templates` (EFE templates, TypeID=1), NOT `LPS_Services_HUD_Templates` (TypeID=2)
3. **Dropdown Loading:** References `LPS_Services_HUD_Drop` correctly, but dropdown options may not populate if templates aren't loading

The HTML and SCSS are byte-for-byte identical to the EFE version (verified), which is correct. The TypeScript needs targeted fixes for table references and field names.

**Primary recommendation:** Fix the template loading path to use HUD templates (TypeID=2), and update all `VisualID` references to handle both `VisualID` and `HUDID` field names for compatibility with the LPS_Services_HUD table.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @angular/core | ^20.0.0 | Component framework | Project's existing framework |
| @ionic/angular | ^8.0.0 | Mobile UI components | Provides ions, form elements |
| @angular/forms | ^20.0.0 | FormsModule for ngModel | Two-way data binding |
| Dexie.js | ^4.0.0 | IndexedDB wrapper | Dexie-first architecture |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| HudDataService | (custom) | HUD-specific data operations | All HUD data CRUD operations |
| VisualFieldRepoService | (custom) | Dexie field seeding/queries | Field state management (needs TypeID fix) |
| LocalImageService | (custom) | Local photo storage | Offline photo capture |
| BackgroundSyncService | (custom) | Offline sync coordination | Queue sync operations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HudDataService | CaspioService direct | Would bypass offline-first architecture |
| VisualFieldRepoService | HudFieldRepoService | HudFieldRepoService is a stub; could be completed instead |

**Installation:**
```bash
# No additional packages needed - all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/app/pages/hud/
├── hud-category-detail/
│   ├── hud-category-detail.page.ts     # Component logic (fix VisualID/HUDID)
│   ├── hud-category-detail.page.html   # Template (IDENTICAL to EFE - correct)
│   ├── hud-category-detail.page.scss   # Styles (IDENTICAL to EFE - correct)
├── hud-data.service.ts                 # HUD API operations (partially correct)
└── services/
    ├── hud-field-repo.service.ts       # STUB - needs implementation or bypass
    └── hud-state.service.ts            # HUD-specific state
```

### Pattern 1: Template Loading with Correct TypeID
**What:** Load templates from LPS_Services_HUD_Templates (TypeID=2) not Visuals (TypeID=1)
**When to use:** All template loading for HUD pages
**Example:**
```typescript
// Source: offline-template.service.ts lines 207-298
// CORRECT: ensureHudTemplatesReady() loads from LPS_Services_HUD_Templates
async ensureHudTemplatesReady(): Promise<any[]> {
  // WEBAPP: Network-first with no local caching
  if (environment.isWeb) {
    const templates = await firstValueFrom(this.caspioService.getServicesHUDTemplates());
    return templates || [];
  }
  // MOBILE: Dexie-first with 24-hour TTL
  const cachedMeta = await this.indexedDb.getCachedTemplateWithMeta('hud');
  // ... caching logic
}

// WRONG: getVisualsTemplates() loads EFE templates (TypeID=1)
async getVisualsTemplates(): Promise<any[]> {
  // This loads from LPS_Services_Visuals_Templates - WRONG for HUD!
}
```

### Pattern 2: Field Name Handling (VisualID vs HUDID)
**What:** HUD tables use `HUDID` as primary key, not `VisualID`
**When to use:** All record creation, update, and lookup operations
**Example:**
```typescript
// Source: hud-template.page.ts (old implementation) - CORRECT approach
const visualId = visual.HUDID || visual.PK_ID || visual.id;

// Source: hud-category-detail.page.ts (current) - INCORRECT
const visualId = visual.VisualID || visual.PK_ID;  // Missing HUDID!

// CORRECTED pattern for HUD pages:
const recordId = visual.HUDID || visual.VisualID || visual.PK_ID || visual.id;
```

### Pattern 3: Dexie-First with Reactive Subscriptions
**What:** Subscribe to Dexie liveQuery for reactive updates, write-through on changes
**When to use:** All data loading and field state management
**Example:**
```typescript
// Source: category-detail.page.ts lines 310-340
async ngOnInit() {
  // DEXIE-FIRST: Seed templates and subscribe to reactive updates
  await this.initializeVisualFields();
}

private async initializeVisualFields(): Promise<void> {
  // Get HUD templates (CRITICAL: Must use ensureHudTemplatesReady, not getVisualsTemplates)
  const templates = await this.offlineTemplate.ensureHudTemplatesReady();

  // Seed fields from templates (CRITICAL: VisualFieldRepoService filters TypeID=1)
  // For HUD, need to either:
  // 1. Use HudFieldRepoService with TypeID=2 filtering
  // 2. Or bypass field repo and load templates directly
}
```

### Anti-Patterns to Avoid
- **Using getVisualsTemplates() for HUD:** Loads wrong templates (TypeID=1 instead of 2)
- **Assuming VisualID field exists:** HUD uses HUDID; always check both
- **Missing null coalescing:** Always use `record.HUDID || record.VisualID || record.PK_ID`
- **TypeID=1 filtering:** VisualFieldRepoService.seedFromTemplates() filters TypeID=1; wrong for HUD

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template loading | Manual API call | `ensureHudTemplatesReady()` | Handles caching, offline, TTL |
| Photo storage | Direct IndexedDB | `LocalImageService` | Handles blob URLs, sync status |
| Field sync | Manual queue | `BackgroundSyncService` | Handles batching, dependencies |
| Cache invalidation | Manual clear | `cacheInvalidated$` subscription | Debounced, coordinates UI refresh |

**Key insight:** The offline-first architecture requires using existing services that handle the Dexie-first pattern. Direct API calls bypass offline capability.

## Common Pitfalls

### Pitfall 1: Wrong Template Loading Path
**What goes wrong:** Page loads zero templates because it calls `getVisualsTemplates()` which loads EFE templates (TypeID=1), not HUD templates (TypeID=2).
**Why it happens:** The hud-category-detail was copied from EFE code which uses visual templates.
**How to avoid:**
- Use `offlineTemplate.ensureHudTemplatesReady()` instead of `hudData.getVisualsTemplates()`
- Verify templates load from `LPS_Services_HUD_Templates` table
**Warning signs:**
- Categories show 0 items
- Console logs show "No templates to seed for this category"
- `getCachedTemplates('hud')` returns empty array

### Pitfall 2: Field Name Mismatch (VisualID vs HUDID)
**What goes wrong:** Record lookups fail, photos don't associate correctly, updates don't save.
**Why it happens:** EFE uses `VisualID` as primary key, HUD uses `HUDID`. Code copied from EFE references `VisualID` exclusively.
**How to avoid:**
- Always use fallback pattern: `record.HUDID || record.VisualID || record.PK_ID`
- Search for all `VisualID` references in hud-category-detail.page.ts and add HUDID fallback
**Warning signs:**
- "Invalid VisualID" errors
- Photos not appearing after upload
- Records created but can't be found

### Pitfall 3: VisualFieldRepoService TypeID Filtering
**What goes wrong:** Field seeding returns 0 fields because VisualFieldRepoService filters `TypeID === 1`.
**Why it happens:** VisualFieldRepoService was built for EFE visuals, not HUD.
**How to avoid:**
- Either: Implement HudFieldRepoService with TypeID=2 filtering
- Or: Bypass field repo entirely and convert templates to UI items directly in loadDataFromAPI()
**Warning signs:**
- No items displayed despite templates loading
- "No templates to seed for this category" even though templates exist

### Pitfall 4: API Endpoint Field Names
**What goes wrong:** API updates fail with "field not found" errors.
**Why it happens:** HudDataService.updateVisual() uses `q.where=VisualID=${visualId}` but HUD table has HUDID field.
**How to avoid:**
- Verify HUD table schema uses which field
- If HUDID, update API endpoints to use `q.where=HUDID=${hudId}`
**Warning signs:**
- PUT/UPDATE requests return 404 or field errors
- Records update silently but changes don't persist

## Code Examples

Verified patterns from the codebase:

### Loading HUD Templates (CORRECT)
```typescript
// Source: offline-template.service.ts lines 207-298
async ensureHudTemplatesReady(): Promise<any[]> {
  // WEBAPP: Network-first
  if (environment.isWeb) {
    const templates = await firstValueFrom(this.caspioService.getServicesHUDTemplates());
    return templates || [];
  }
  // MOBILE: Dexie-first with 24-hour TTL
  const cachedMeta = await this.indexedDb.getCachedTemplateWithMeta('hud');
  if (cachedMeta?.templates?.length > 0) {
    return cachedMeta.templates;
  }
  // Fetch and cache if not present
  const templates = await firstValueFrom(this.caspioService.getServicesHUDTemplates());
  await this.indexedDb.cacheTemplates('hud', templates, HUD_TEMPLATE_VERSION);
  return templates;
}
```

### HUD Dropdown Loading (CORRECT)
```typescript
// Source: caspio.service.ts line 1283
getServicesHUDDrop(): Observable<any[]> {
  return this.get<any>('/tables/LPS_Services_HUD_Drop/records').pipe(
    map((response: any) => response?.Result || [])
  );
}
```

### Field Name Fallback Pattern (REQUIRED)
```typescript
// Source: hud-template.page.ts - reference for correct approach
// HUD tables use HUDID, not VisualID
const recordId = record.HUDID || record.VisualID || record.PK_ID || record.id;

// For photo attachment association
const photoEntityId = photo.HUDID || photo.VisualID || photo.entityId;
```

### Photo Upload for HUD (CORRECT entityType)
```typescript
// Source: hud-data.service.ts line 662 (documented in PITFALLS.md)
const localImage = await this.localImageService.captureImage(
  file,
  'hud',  // CORRECT entityType for HUD, not 'visual'
  String(hudId),
  serviceId,
  caption,
  drawings || ''
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| API-first | Dexie-first | Phase 1 | Offline capability |
| Tab navigation | Button navigation | Phase 5 | UX consistency with EFE |
| Separate load functions | Bulk parallel load | Phase 3 | Faster initial render |

**Deprecated/outdated:**
- Tab-based navigation for HUD main page (replaced with button navigation)
- Direct CaspioService calls for data loading (use HudDataService for offline-first)

## Table Reference Mapping

Critical field and table differences between EFE and HUD:

| EFE (Visuals) | HUD | Purpose |
|---------------|-----|---------|
| `LPS_Services_Visuals` | `LPS_Services_HUD` | Data records |
| `LPS_Services_Visuals_Attach` | `LPS_Services_HUD_Attach` | Photo attachments |
| `LPS_Services_Visuals_Templates` | `LPS_Services_HUD_Templates` | Item templates |
| `LPS_Services_Visuals_Drop` | `LPS_Services_HUD_Drop` | Dropdown options |
| `VisualID` | `HUDID` | Primary key field |
| `VisualTemplateID` | `HUDTemplateID` or `TemplateID` | Template reference |
| `entityType: 'visual'` | `entityType: 'hud'` | LocalImageService type |
| `TypeID = 1` | `TypeID = 2` | Template filtering |

## Implementation Approach

Based on the analysis, Phase 7 requires these specific fixes:

### Fix 1: Template Loading Path
Change `hudData.getVisualsTemplates()` to use HUD templates:
```typescript
// In loadDataFromAPI():
const templates = await this.offlineTemplate.ensureHudTemplatesReady();
// Instead of: await this.hudData.getVisualsTemplates();
```

### Fix 2: Field Name References
Add HUDID fallback to all VisualID references (approximately 45 locations):
```typescript
// Find and replace pattern:
// BEFORE: visual.VisualID || visual.PK_ID
// AFTER:  visual.HUDID || visual.VisualID || visual.PK_ID
```

### Fix 3: VisualFieldRepoService Bypass
The current VisualFieldRepoService filters `TypeID === 1`. For HUD, either:
1. Create HudFieldRepoService with `TypeID === 2` filtering
2. Bypass field repo and use direct template conversion in loadDataFromAPI()

Option 2 is simpler since loadDataFromAPI() already handles template conversion.

## Open Questions

Things that need verification during implementation:

1. **HUD Table Schema Verification**
   - What we know: HUDID is used in hud-template.page.ts
   - What's unclear: Does HUD table also have VisualID field for backwards compatibility?
   - Recommendation: Test API response to confirm field names

2. **HudFieldRepoService Usage**
   - What we know: Current implementation is a stub returning false/empty
   - What's unclear: Was it intended to be implemented or is direct template loading preferred?
   - Recommendation: Bypass field repo, use direct template loading for simpler implementation

3. **Template Type Field**
   - What we know: EFE uses VisualTemplateID, HUD may use HUDTemplateID or TemplateID
   - What's unclear: Exact field name in HUD templates
   - Recommendation: Check both during template-to-visual matching

## Sources

### Primary (HIGH confidence)
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - Current implementation analyzed
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts` - Reference implementation
- `src/app/services/offline-template.service.ts` - Template loading service with HUD support
- `src/app/pages/hud-template/hud-template.page.ts` - Old HUD implementation showing correct HUDID usage

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` - Documented pitfalls from Phase 1 research
- `.planning/PROJECT.md` - Table mapping documentation

### Tertiary (LOW confidence)
- None - all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified in codebase
- Architecture: HIGH - Patterns verified in working EFE implementation
- Pitfalls: HIGH - All pitfalls verified against actual code differences
- Table mapping: HIGH - Verified in CaspioService and old HUD implementation

**Research date:** 2026-01-25
**Valid until:** 2026-02-25 (30 days - stable architecture)

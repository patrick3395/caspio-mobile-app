# Phase 3: Category Detail Integration - Research

**Researched:** 2026-01-23
**Domain:** Dexie-first UI Pattern + Mobile Responsive Styling
**Confidence:** HIGH

## Summary

This phase integrates the Dexie-first pattern into HUD category detail pages, copying the exact patterns from engineers-foundation's category-detail.page.ts. The research examined both implementations in detail to identify the specific code patterns, SCSS styling, and reactive subscription patterns that must be copied.

The key finding is that HUD category-detail already has PARTIAL Dexie-first implementation (liveQuery subscriptions exist), but is missing:
1. **Edge-to-edge mobile styling** - HUD uses traditional card-based layout while EFE uses flat, edge-to-edge design
2. **liveQuery debounce pattern** - HUD lacks the debounce timer to prevent UI thrashing
3. **Photo grid layout** - HUD uses flexbox while EFE uses CSS Grid for consistent 3-per-row
4. **Field expansion state management** - HUD lacks lazy photo loading patterns
5. **Multiple race condition guards** - HUD is missing several guards from EFE

The mobile styling difference is significant: EFE has ~1500 lines of SCSS while HUD has ~1150. The EFE styling is flat, edge-to-edge with no padding on page-container, while HUD has 20px padding and rounded cards.

**Primary recommendation:** Copy the EFE category-detail.page.scss edge-to-edge styling exactly to HUD, then copy the missing TypeScript patterns (debounce timers, race condition guards, batch upload tracking).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Dexie liveQuery | 3.x | Reactive DB queries | Already in use in both EFE and HUD |
| RxJS Subscription | 7.x | Event management | Angular standard, cleanup on destroy |
| CSS Grid | native | Photo layout | 3-per-row consistent, responsive |
| Angular ChangeDetectorRef | 17.x | Manual change detection | Required for liveQuery updates |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| setTimeout/clearTimeout | native | Debounce implementation | liveQuery update batching |
| Set<string> | native | Batch tracking | Prevent duplicate photos during upload |
| Map<string, Promise> | native | Concurrent guard | Prevent duplicate loadPhotosForVisual |

### No New Dependencies Needed
This phase only involves copying patterns that already exist in the codebase.

## Architecture Patterns

### Pattern 1: Edge-to-Edge Mobile Layout
**What:** Flat design with no card rounding, no page padding, edge-to-edge content
**When to use:** All mobile category detail pages

**Source (EFE category-detail.page.scss lines 8-27):**
```scss
// EDGE-TO-EDGE FULL-SCREEN LAYOUT
.page-container {
  padding: 0;
  margin: 0;
  background: #f5f5f5;
  min-height: 100vh;
  scroll-behavior: auto !important;
}

.content-section {
  background: #f5f5f5;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  min-height: 200px;
  scroll-behavior: auto !important;
}
```

**Current HUD (hud-category-detail.page.scss lines 8-24):**
```scss
// NEEDS CHANGE: Traditional card layout
.page-container {
  padding: 20px;          // REMOVE: edge-to-edge
  max-width: 1200px;      // REMOVE: no max-width
  margin: 0 auto;
  background: #f5f5f5;
  min-height: 100vh;
}

.content-section {
  background: white;      // CHANGE: to #f5f5f5
  border-radius: 16px;    // CHANGE: to 0
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);  // CHANGE: to none
  padding: 24px;          // CHANGE: to 0
}
```

### Pattern 2: CSS Grid Photo Layout
**What:** 3-column grid for photos with consistent sizing
**When to use:** Image preview sections

**Source (EFE category-detail.page.scss lines 672-678):**
```scss
.image-preview-container {
  display: grid !important;
  grid-template-columns: repeat(3, 1fr) !important;
  gap: 6px !important;
  align-items: start;
  min-height: 0;
  overflow: visible;
  width: 100% !important;
}
```

**Current HUD uses flexbox (lines 75-81):**
```scss
// NEEDS CHANGE: Flexbox to Grid
.image-preview-container {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
```

### Pattern 3: LiveQuery Debounce Guard
**What:** Debounce timer to batch rapid liveQuery updates
**When to use:** All liveQuery subscriptions that trigger UI updates

**Source (EFE category-detail.page.ts lines 119-120):**
```typescript
// Debounce timer for liveQuery updates to prevent multiple rapid change detections
private liveQueryDebounceTimer: any = null;
```

**Source Usage (lines 1780-1786):**
```typescript
if (this.liveQueryDebounceTimer) {
  clearTimeout(this.liveQueryDebounceTimer);
}
this.liveQueryDebounceTimer = setTimeout(() => {
  this.liveQueryDebounceTimer = null;
  // Process updates...
}, 100); // 100ms debounce for liveQuery
```

**HUD is MISSING this pattern** - needs to be added.

### Pattern 4: Batch Upload Image Tracking
**What:** Set to track imageIds during multi-image upload to prevent duplicates
**When to use:** Camera capture and gallery multi-select

**Source (EFE category-detail.page.ts lines 167-168):**
```typescript
// Track imageIds in current batch to prevent duplicates even if liveQuery fires
private batchUploadImageIds = new Set<string>();
```

**Source Usage (lines 5826-5870):**
```typescript
// Before adding photo:
this.batchUploadImageIds.add(imageId);

// In liveQuery handler, check:
if (this.batchUploadImageIds.has(imageId)) {
  console.log('[SKIP] Already in batch');
  continue;
}
```

**HUD is MISSING this pattern** - causes duplicate photos.

### Pattern 5: Concurrent Load Guard
**What:** Promise map to prevent concurrent loadPhotosForVisual calls for same key
**When to use:** Photo loading operations

**Source (EFE category-detail.page.ts lines 157-158):**
```typescript
// Guard to prevent concurrent/duplicate loadPhotosForVisual calls for the same key
private loadingPhotoPromises: Map<string, Promise<void>> = new Map();
```

**HUD is MISSING this pattern** - needs to be added.

### Pattern 6: Camera Capture Flag
**What:** Boolean to suppress liveQuery during camera capture
**When to use:** Camera operations where manual UI update is needed

**Source (EFE category-detail.page.ts lines 165-166):**
```typescript
// Separate flag for camera captures - suppresses liveQuery to prevent duplicates with annotated photos
// Gallery uploads use liveQuery for UI updates, but camera needs manual push for annotated URLs
private isCameraCaptureInProgress = false;
```

**HUD is MISSING this pattern** - causes duplicate photos from camera.

### Pattern 7: Flat Accordion Design
**What:** Full-width accordion headers with no card styling
**When to use:** Type sections (Comments/Limitations/Deficiencies)

**Source (EFE category-detail.page.scss lines 29-161):**
```scss
.simple-accordion {
  border: none;
  border-radius: 0;
  margin-bottom: 0;
  overflow: hidden;
  background: transparent;

  .simple-accordion-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: #909090;
    // ... gray header styling
  }
}
```

**HUD uses ion-accordion-group** which has different styling - needs to match EFE.

### Anti-Patterns to Avoid
- **Emitting without debounce:** Causes UI thrashing, multiple change detections
- **Missing batch tracking:** Causes duplicate photos during multi-upload
- **Padding on page-container:** Not edge-to-edge, doesn't match EFE
- **Flexbox for photo grid:** Inconsistent photo sizing, not 3-per-row
- **No concurrent load guard:** Can cause race conditions in photo loading

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Photo layout | Custom flex grid | CSS Grid 3-column | EFE pattern, consistent |
| Duplicate prevention | Manual checks | Set<string> tracking | Already proven in EFE |
| Load debouncing | Manual setTimeout | Debounce timer pattern | Already proven in EFE |
| Concurrent guard | Boolean flags | Promise Map | Prevents race conditions |

**Key insight:** All the patterns needed already exist in EFE category-detail. The HUD implementation is partially there but missing several guards and optimizations.

## Common Pitfalls

### Pitfall 1: Duplicate Photos from LiveQuery Race
**What goes wrong:** Photos appear twice - once from manual push, once from liveQuery
**Why it happens:** Camera capture writes to Dexie, liveQuery fires before manual UI push
**How to avoid:** Set `isCameraCaptureInProgress = true` before Dexie write, false after manual push
**Warning signs:** Duplicate photos after camera capture, especially with annotations

### Pitfall 2: UI Thrashing from Rapid LiveQuery Updates
**What goes wrong:** Page flickers, multiple loading states during multi-image upload
**Why it happens:** Each Dexie write triggers liveQuery, no debounce
**How to avoid:** Use 100ms debounce timer on liveQuery handler
**Warning signs:** Flicker during batch operations, rapid change detection cycles

### Pitfall 3: Inconsistent Photo Sizing on Mobile
**What goes wrong:** Photos have different sizes, layout breaks
**Why it happens:** Flexbox with percentage widths vs CSS Grid
**How to avoid:** Use CSS Grid with `repeat(3, 1fr)` for consistent 3-per-row
**Warning signs:** Photos different sizes, layout shifts on content change

### Pitfall 4: Padding Breaking Edge-to-Edge
**What goes wrong:** White gaps on sides, doesn't look like EFE
**Why it happens:** page-container has padding, content-section has padding
**How to avoid:** Set padding: 0 on both, use item-level padding instead
**Warning signs:** Visible gutters, content not touching screen edges

### Pitfall 5: Concurrent Photo Load Race
**What goes wrong:** Same photos loaded multiple times, duplicates
**Why it happens:** Multiple calls to loadPhotosForVisual for same key
**How to avoid:** Use `loadingPhotoPromises` Map to dedupe concurrent calls
**Warning signs:** Duplicate photos when expanding quickly, network requests duplicated

## Code Examples

### 1. LiveQuery Debounce Pattern (TypeScript)
```typescript
// Source: category-detail.page.ts lines 1780-1788

// In liveQuery subscription handler:
if (this.liveQueryDebounceTimer) {
  clearTimeout(this.liveQueryDebounceTimer);
}
this.liveQueryDebounceTimer = setTimeout(() => {
  this.liveQueryDebounceTimer = null;

  // Safe to process updates now
  this.updateBulkLocalImagesMap(images);
  this.ngZone.run(() => {
    this.changeDetectorRef.detectChanges();
  });
}, 100);
```

### 2. Batch Upload Tracking (TypeScript)
```typescript
// Source: category-detail.page.ts lines 5764-5880

// Before batch upload:
this.isMultiImageUploadInProgress = true;
this.batchUploadImageIds.clear();

try {
  for (const file of files) {
    const imageId = await this.localImageService.createFromFile(...);
    this.batchUploadImageIds.add(imageId);  // Track it

    // Manually add to visualPhotos immediately
    this.visualPhotos[key].push({
      imageId,
      ...photoData
    });
  }
} finally {
  this.isMultiImageUploadInProgress = false;
  this.batchUploadImageIds.clear();
}
```

### 3. Camera Capture Guard (TypeScript)
```typescript
// Source: category-detail.page.ts lines 5422-5536

async capturePhoto(key: string) {
  // Suppress liveQuery during capture
  this.isCameraCaptureInProgress = true;

  try {
    // Capture and process photo...
    const imageId = await this.localImageService.createFromFile(...);

    // Manually push to visualPhotos with annotated URL
    this.visualPhotos[key].push({
      imageId,
      imageUrl: annotatedBlobUrl,  // Use annotated, not original
      // ...
    });
  } finally {
    // Re-enable liveQuery after manual push complete
    this.isCameraCaptureInProgress = false;
  }
}
```

### 4. Concurrent Load Guard (TypeScript)
```typescript
// Source: category-detail.page.ts uses loadingPhotoPromises Map

async loadPhotosForVisual(key: string, visualId: string): Promise<void> {
  // Check if already loading
  if (this.loadingPhotoPromises.has(key)) {
    return this.loadingPhotoPromises.get(key);
  }

  const loadPromise = this.doLoadPhotos(key, visualId).finally(() => {
    this.loadingPhotoPromises.delete(key);
  });

  this.loadingPhotoPromises.set(key, loadPromise);
  return loadPromise;
}
```

### 5. Edge-to-Edge SCSS (Styling)
```scss
// Source: category-detail.page.scss lines 8-27

// HUD category-detail.page.scss should be updated to:
.page-container {
  padding: 0;
  margin: 0;
  background: #f5f5f5;
  min-height: 100vh;
  scroll-behavior: auto !important;
}

.content-section {
  background: #f5f5f5;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  min-height: 200px;
  scroll-behavior: auto !important;
}
```

### 6. CSS Grid Photo Layout (Styling)
```scss
// Source: category-detail.page.scss lines 672-810

.image-preview-section {
  padding: 16px;
  background: white;
  border-top: none;
  border-radius: 0;

  .image-preview-container {
    display: grid !important;
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 6px !important;

    .image-preview.structural-photo-preview {
      position: relative !important;
      width: 100% !important;
      padding-bottom: 30px !important;

      img {
        width: 100% !important;
        aspect-ratio: 1 / 1 !important;
        height: auto !important;
        border-radius: 16px !important;
        object-fit: cover !important;
        border: 2px solid #ddd !important;
      }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flexbox photo grid | CSS Grid 3-column | 2025 | Consistent sizing |
| No liveQuery debounce | 100ms debounce | 2025 | Prevents UI thrashing |
| No batch tracking | Set<string> tracking | 2025 | Prevents duplicates |
| Card-based layout | Edge-to-edge flat | 2025 | Modern mobile UX |

**Deprecated/outdated:**
- **Card-based mobile layout:** Replaced by edge-to-edge design for better mobile UX
- **Flexbox photo grids:** Replaced by CSS Grid for consistent sizing
- **Unguarded liveQuery:** Always use debounce + batch tracking now

## Open Questions

Things that couldn't be fully resolved:

1. **HTML Template Differences**
   - What we know: EFE category-detail.page.html is 333KB (very large file)
   - What's unclear: Exact structural differences vs HUD HTML
   - Recommendation: Read HTML in sections during implementation, copy structural patterns

2. **Simple Accordion vs ion-accordion**
   - What we know: EFE uses custom `.simple-accordion` div structure, HUD uses `ion-accordion-group`
   - What's unclear: Whether to keep ion-accordion or switch to custom div
   - Recommendation: Keep ion-accordion but copy exact styling to match EFE appearance

3. **Lazy Photo Loading**
   - What we know: EFE has `expandedPhotos` tracking for lazy load
   - What's unclear: Whether HUD needs this or can load all photos
   - Recommendation: Copy pattern for consistency, even if HUD has fewer photos

## Sources

### Primary (HIGH confidence)
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.ts` - lines 100-180 (guards), 1739-1790 (liveQuery), 5422-5900 (photo capture)
- `src/app/pages/engineers-foundation/structural-systems/category-detail/category-detail.page.scss` - lines 1-1516 (all styling)
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.ts` - lines 1-450 (current implementation)
- `src/app/pages/hud/hud-category-detail/hud-category-detail.page.scss` - lines 1-1169 (current styling)

### Secondary (MEDIUM confidence)
- Phase 2 Research (02-RESEARCH.md) - cacheInvalidated$ pattern
- `.planning/REQUIREMENTS.md` - CAT-01 through CAT-05, STYLE-01 through STYLE-03

### Tertiary (LOW confidence)
- None - all patterns verified in codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - using existing Dexie/RxJS/Angular patterns
- Architecture: HIGH - copying proven engineers-foundation implementation
- Pitfalls: HIGH - documented from actual race conditions observed in EFE development

**Research date:** 2026-01-23
**Valid until:** 60 days (stable patterns, internal implementation)

---

## Implementation Checklist

Based on research, Phase 3 should address:

### TypeScript Changes (hud-category-detail.page.ts)
- [ ] Add `liveQueryDebounceTimer` property
- [ ] Add `batchUploadImageIds` Set property
- [ ] Add `isCameraCaptureInProgress` flag
- [ ] Add `loadingPhotoPromises` Map
- [ ] Add `isMultiImageUploadInProgress` flag
- [ ] Add `isPopulatingPhotos` mutex flag
- [ ] Implement debounce in liveQuery subscription handler
- [ ] Implement batch tracking in multi-photo upload
- [ ] Implement camera capture guard
- [ ] Implement concurrent load guard

### SCSS Changes (hud-category-detail.page.scss)
- [ ] Remove padding from .page-container
- [ ] Remove max-width from .page-container
- [ ] Change .content-section to flat design (no shadow, no radius, no padding)
- [ ] Change .image-preview-container to CSS Grid
- [ ] Update photo sizing to use aspect-ratio: 1/1
- [ ] Copy accordion header styling for flat design
- [ ] Ensure consistent spacing matches EFE exactly

### Verification
- [ ] Photos display in 3-column grid
- [ ] No duplicate photos on camera capture
- [ ] No UI flickering during multi-upload
- [ ] Edge-to-edge layout on mobile
- [ ] Visual match to engineers-foundation

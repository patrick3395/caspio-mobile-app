# Phase 2: Data Service Enhancement - Research

**Researched:** 2026-01-23
**Domain:** RxJS Event Coordination + Dexie Change Detection
**Confidence:** HIGH

## Summary

This phase enhances HudDataService to match the cache invalidation and reactive update patterns from EngineersFoundationDataService. The research examined both implementations in detail to identify specific code patterns that must be copied.

The key difference is that engineers-foundation has a centralized `cacheInvalidated$` Subject that pages subscribe to, with comprehensive Dexie change detection (via `backgroundRefreshComplete$` and `imageChange$`). HudDataService currently subscribes to sync events but only clears internal caches - it doesn't emit events for pages to react to.

The engineers-foundation pattern provides:
1. A single `cacheInvalidated$` Subject that all pages subscribe to
2. Debounced emission (1 second) to batch rapid sync events and prevent UI thrashing
3. Comprehensive subscriptions to ALL Dexie change sources (not just sync events)
4. CRITICAL: Photo sync events do NOT emit cacheInvalidated$ (pages handle directly to avoid race conditions)

**Primary recommendation:** Add `cacheInvalidated$` Subject to HudDataService, implement `debouncedCacheInvalidation()` method, subscribe to `backgroundRefreshComplete$` and `imageChange$`, and document the photo sync exception pattern.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rxjs Subject | 7.x | Event emission | Standard Angular reactive pattern |
| rxjs Subscription | 7.x | Event management | Cleanup on destroy |
| Dexie liveQuery (indirect) | 3.x | Reactive DB queries | Via service events |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| setTimeout | native | Debounce implementation | 1 second debounce window |
| clearTimeout | native | Cancel pending debounce | On new event or destroy |

### No New Dependencies Needed
This phase only involves adding RxJS patterns that already exist in the codebase.

## Architecture Patterns

### Pattern 1: Cache Invalidation Subject
**What:** A public Subject that emits when caches are invalidated and pages should reload
**When to use:** Any time IndexedDB data changes (sync, background refresh, local image changes)

**Source Implementation (engineers-foundation-data.service.ts line 37):**
```typescript
// Event emitted when caches are invalidated - pages should reload their data
public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();
```

**HUD Adaptation:**
```typescript
// Add to HudDataService after the cache declarations:
// Event emitted when caches are invalidated - pages should reload their data
public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();

// Debounce timer for cache invalidation to batch multiple sync events
private cacheInvalidationTimer: any = null;
private pendingInvalidationServiceId: string | undefined = undefined;
```

### Pattern 2: Debounced Cache Invalidation
**What:** Batches rapid sync events into a single UI refresh after 1 second of quiet
**When to use:** All cache invalidation triggers except photo sync

**Source Implementation (engineers-foundation-data.service.ts lines 179-204):**
```typescript
/**
 * Debounced cache invalidation to batch multiple sync events into one UI refresh
 * This prevents rapid UI flickering when multiple items sync in quick succession
 */
private debouncedCacheInvalidation(serviceId?: string, reason: string = 'batch_sync'): void {
  // Track the service ID (use most recent if multiple)
  if (serviceId) {
    this.pendingInvalidationServiceId = serviceId;
  }

  // Clear any existing timer
  if (this.cacheInvalidationTimer) {
    clearTimeout(this.cacheInvalidationTimer);
  }

  // Set a new timer - emit after 1 second of no new sync events
  this.cacheInvalidationTimer = setTimeout(() => {
    console.log(`[DataService] Debounced cache invalidation fired (reason: ${reason})`);
    this.cacheInvalidated$.next({
      serviceId: this.pendingInvalidationServiceId,
      reason: reason
    });
    this.cacheInvalidationTimer = null;
    this.pendingInvalidationServiceId = undefined;
  }, 1000); // 1 second debounce
}
```

### Pattern 3: Comprehensive Dexie Subscriptions
**What:** Subscribe to ALL Dexie change sources, not just sync complete events
**When to use:** In service constructor, store subscriptions for cleanup

**Source Implementation (engineers-foundation-data.service.ts lines 65-177):**

**Three subscription categories:**

1. **Sync Complete Events** (already in HUD but need modification):
   - `backgroundSync.hudSyncComplete$` - Clear cache, debounced emit
   - `backgroundSync.hudPhotoUploadComplete$` - Clear cache ONLY, NO emit (critical!)
   - `backgroundSync.serviceDataSyncComplete$` - Clear cache, debounced emit

2. **Background Refresh Complete** (MISSING from HUD):
   - `offlineTemplate.backgroundRefreshComplete$` - Clear specific cache, debounced emit
   - Example: When fresh data downloaded in background, notify pages

3. **IndexedDB Image Changes** (MISSING from HUD):
   - `indexedDb.imageChange$` - Clear attachment caches, debounced emit
   - Provides real-time UI updates when images are created/updated

**CRITICAL EXCEPTION - Photo Sync (lines 74-88):**
```typescript
// When a photo syncs, clear attachment caches
// CRITICAL FIX: Do NOT emit cacheInvalidated$ here - it causes a race condition
// The page's direct photoUploadComplete$ subscription handles the UI update
// Emitting cacheInvalidated$ triggers reloadVisualsAfterSync() BEFORE the page
// has updated the photo's AttachID from temp to real, causing duplicate photos
// or loss of local updates like captions
this.syncSubscriptions.push(
  this.backgroundSync.photoUploadComplete$.subscribe(event => {
    console.log('[DataService] Photo synced, clearing in-memory caches only (no reload trigger)');
    this.hudAttachmentsCache.clear();
    this.imageCache.clear();
    // DO NOT call: this.cacheInvalidated$.next({ reason: 'photo_sync' });
    // The page handles photoUploadComplete$ directly for seamless UI updates
  })
);
```

### Pattern 4: Subscription Cleanup
**What:** Track all subscriptions and clean up on destroy
**When to use:** OnDestroy lifecycle hook

**Implementation:**
```typescript
private syncSubscriptions: Subscription[] = [];

// In constructor: Add to array
this.syncSubscriptions.push(subscription);

// OnDestroy: Clean up
ngOnDestroy(): void {
  this.syncSubscriptions.forEach(sub => sub.unsubscribe());
  if (this.cacheInvalidationTimer) {
    clearTimeout(this.cacheInvalidationTimer);
  }
}
```

### Anti-Patterns to Avoid
- **Emitting cacheInvalidated$ on photo sync:** Causes race condition with temp ID updates, duplicate photos
- **Direct setTimeout without tracking:** Leads to memory leaks, multiple timers
- **Subscribing without cleanup:** Memory leaks, stale event handlers
- **Non-debounced emission:** UI thrashing during rapid sync operations

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounce | Custom debounce | setTimeout pattern from EF | Proven, simple, no extra deps |
| Event bus | Custom EventEmitter | RxJS Subject | Already in stack, type-safe |
| Subscription management | Manual tracking | Subscription[] array | Simple, reliable cleanup |

**Key insight:** The pattern is already proven in engineers-foundation. Copy it exactly, adapting only the HUD-specific cache names and event sources.

## Common Pitfalls

### Pitfall 1: Photo Sync Race Condition
**What goes wrong:** Emitting `cacheInvalidated$` on photo sync causes duplicate photos or lost captions
**Why it happens:** The page's reload happens before the AttachID temp-to-real mapping completes
**How to avoid:** NEVER emit `cacheInvalidated$` on photo sync - only clear internal caches
**Warning signs:** Photos duplicating, captions disappearing after sync

### Pitfall 2: UI Thrashing from Rapid Events
**What goes wrong:** Multiple data reloads in quick succession cause flickering
**Why it happens:** Sync events fire rapidly (multiple items syncing)
**How to avoid:** Use 1 second debounce on all cacheInvalidated$ emissions
**Warning signs:** Data flickering, loading spinners appearing repeatedly

### Pitfall 3: Missing Change Sources
**What goes wrong:** Pages don't update when IndexedDB changes from background operations
**Why it happens:** Only subscribed to sync events, not background refresh or imageChange$
**How to avoid:** Subscribe to ALL three sources: sync, backgroundRefreshComplete$, imageChange$
**Warning signs:** Data out of sync, need manual refresh to see updates

### Pitfall 4: Memory Leaks from Timers
**What goes wrong:** setTimeout continues after service destroyed, ghost events
**Why it happens:** Timer not cleared on ngOnDestroy
**How to avoid:** Store timer reference, clearTimeout in ngOnDestroy
**Warning signs:** Console logs after navigation away, unexpected events

## Code Examples

### Complete HudDataService Enhancement

The following shows the additions needed to HudDataService:

**1. Add Properties (after existing cache declarations):**
```typescript
// Source: engineers-foundation-data.service.ts lines 37-43

// Event emitted when caches are invalidated - pages should reload their data
public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();

private syncSubscriptions: Subscription[] = [];

// Debounce timer for cache invalidation to batch multiple sync events into one UI refresh
private cacheInvalidationTimer: any = null;
private pendingInvalidationServiceId: string | undefined = undefined;
```

**2. Add Debounced Invalidation Method:**
```typescript
// Source: engineers-foundation-data.service.ts lines 179-204

/**
 * Debounced cache invalidation to batch multiple sync events into one UI refresh
 * This prevents rapid UI flickering when multiple items sync in quick succession
 */
private debouncedCacheInvalidation(serviceId?: string, reason: string = 'batch_sync'): void {
  // Track the service ID (use most recent if multiple)
  if (serviceId) {
    this.pendingInvalidationServiceId = serviceId;
  }

  // Clear any existing timer
  if (this.cacheInvalidationTimer) {
    clearTimeout(this.cacheInvalidationTimer);
  }

  // Set a new timer - emit after 1 second of no new sync events
  this.cacheInvalidationTimer = setTimeout(() => {
    console.log(`[HUD DataService] Debounced cache invalidation fired (reason: ${reason})`);
    this.cacheInvalidated$.next({
      serviceId: this.pendingInvalidationServiceId,
      reason: reason
    });
    this.cacheInvalidationTimer = null;
    this.pendingInvalidationServiceId = undefined;
  }, 1000); // 1 second debounce
}
```

**3. Modify subscribeToSyncEvents() to use debounced emission:**
```typescript
// Source: engineers-foundation-data.service.ts lines 65-177

private subscribeToSyncEvents(): void {
  // Only subscribe on mobile
  if (!this.isMobile()) {
    return;
  }

  console.log('[HUD Data] Mobile mode - subscribing to sync events for cache invalidation');

  // Subscribe to HUD sync complete events
  this.syncSubscriptions.push(
    this.backgroundSync.hudSyncComplete$.subscribe((event: HudSyncComplete) => {
      console.log('[HUD Data] Sync complete event received:', event.operation, 'for', event.fieldKey);

      // Clear cache for the affected service
      this.hudCache.delete(event.serviceId);

      // Mark section dirty for smart reload
      const category = event.fieldKey.split(':')[1];
      if (category) {
        this.backgroundSync.markSectionDirty(`${event.serviceId}_${category}`);
      }

      // Debounced emit for page refresh
      this.debouncedCacheInvalidation(event.serviceId, 'hud_sync');
    })
  );

  // CRITICAL: Photo sync - clear caches but DO NOT emit cacheInvalidated$
  // Pages handle photoUploadComplete$ directly to avoid race conditions
  this.syncSubscriptions.push(
    this.backgroundSync.hudPhotoUploadComplete$.subscribe((event: HudPhotoUploadComplete) => {
      console.log('[HUD Data] Photo synced, clearing in-memory caches only (no reload trigger)');
      this.hudAttachmentsCache.delete(event.hudId);
      this.imageCache.clear();
      // DO NOT call: this.debouncedCacheInvalidation(...);
      // The page handles hudPhotoUploadComplete$ directly for seamless UI updates
    })
  );

  // MISSING: Subscribe to background refresh complete
  this.syncSubscriptions.push(
    this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
      console.log('[HUD Data] Background refresh complete:', event.dataType, 'for', event.serviceId);

      // Clear the corresponding in-memory cache
      if (event.dataType === 'hud_records') {
        this.hudCache.delete(event.serviceId);
      } else if (event.dataType === 'hud_attachments') {
        this.hudAttachmentsCache.delete(event.serviceId);
      }

      // Debounced emit for page refresh
      this.debouncedCacheInvalidation(event.serviceId, `background_refresh_${event.dataType}`);
    })
  );

  // MISSING: Subscribe to IndexedDB image changes
  this.syncSubscriptions.push(
    this.indexedDb.imageChange$.subscribe(event => {
      console.log('[HUD Data] IndexedDB image change:', event.action, event.key, 'entity:', event.entityType, event.entityId);

      // Clear attachment caches if this is a HUD image
      if (event.entityType === 'hud') {
        this.hudAttachmentsCache.clear();
      }

      // Debounced emit for page refresh
      this.debouncedCacheInvalidation(event.serviceId, `indexeddb_${event.action}_${event.entityType}`);
    })
  );
}
```

**4. Add ngOnDestroy cleanup:**
```typescript
ngOnDestroy(): void {
  this.syncSubscriptions.forEach(sub => sub.unsubscribe());
  this.syncSubscriptions = [];

  if (this.cacheInvalidationTimer) {
    clearTimeout(this.cacheInvalidationTimer);
    this.cacheInvalidationTimer = null;
  }
}
```

### Page Subscription Pattern

Pages will subscribe to `cacheInvalidated$` rather than individual sync events:

```typescript
// Source: engineers-foundation category-detail.page.ts lines 1682-1685

// In setupSubscriptions():
this.cacheInvalidationSubscription = this.hudData.cacheInvalidated$.subscribe(event => {
  console.log('[HUD Category] Cache invalidated:', event);

  // Skip if in local operation cooldown (prevents flash when syncing)
  if (this.localOperationCooldown) {
    console.log('[HUD Category] Skipping - in local operation cooldown');
    return;
  }

  // Skip if not for our service
  if (event.serviceId && event.serviceId !== this.serviceId) {
    return;
  }

  // Reload data from Dexie (not from API)
  this.loadCategoryData();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct sync subscriptions | Centralized cacheInvalidated$ | 2025 | Pages don't manage multiple subscriptions |
| Immediate event emission | 1 second debounced | 2025 | Prevents UI thrashing |
| Sync events only | + backgroundRefresh + imageChange | 2025 | Complete Dexie reactivity |

**Current best practice:**
- All change detection flows through data service
- Pages subscribe to single `cacheInvalidated$` Subject
- Photo sync is the exception (pages subscribe directly to avoid race conditions)

## Open Questions

Things that couldn't be fully resolved:

1. **backgroundRefreshComplete$ for HUD data types**
   - What we know: OfflineTemplateService emits for visuals/efe types
   - What's unclear: Whether it already emits for HUD-specific types or needs extension
   - Recommendation: Check if HUD refresh is already handled; if not, may need Phase 3 work

2. **Existing page subscriptions**
   - What we know: hud-category-detail.page.ts already subscribes to hudSyncComplete$ and hudPhotoUploadComplete$
   - What's unclear: Whether to migrate pages to cacheInvalidated$ in this phase or Phase 3
   - Recommendation: Add cacheInvalidated$ in Phase 2, migrate pages in Phase 3

## Sources

### Primary (HIGH confidence)
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts` - lines 37-204
- `src/app/pages/hud/hud-data.service.ts` - current implementation
- `src/app/services/background-sync.service.ts` - event definitions
- `src/app/services/indexed-db.service.ts` - imageChange$ definition

### Secondary (MEDIUM confidence)
- Phase 1 Research (01-RESEARCH.md) - container patterns context

### Tertiary (LOW confidence)
- None - all patterns verified in codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - using existing RxJS/Angular patterns
- Architecture: HIGH - copying proven engineers-foundation implementation
- Pitfalls: HIGH - documented from actual bugs fixed in engineers-foundation

**Research date:** 2026-01-23
**Valid until:** 60 days (stable patterns, internal implementation)

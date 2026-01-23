# Phase 1: Container Enhancements - Research

**Researched:** 2026-01-23
**Domain:** Angular/Ionic Container Pattern + Dexie-First Architecture
**Confidence:** HIGH

## Summary

This phase copies the proven Dexie-first container pattern from engineers-foundation to hud. The research examined both implementations in detail and identified specific gaps in the HUD container that need to be addressed.

The engineers-foundation container has a mature implementation with:
1. Rehydration support (restoring purged service data from server)
2. Service instance tracking (showing "EFE #1", "EFE #2" for multiple services)
3. CaspioService integration for API calls needed by instance tracking
4. Robust loading overlay with rehydration-aware messaging

The HUD container currently has the basic template loading overlay but is missing rehydration support and service instance tracking. The implementation is simpler because HUD doesn't have the same EFE rooms/points structure - it only has HUD records.

**Primary recommendation:** Copy the missing features from engineers-foundation-container.page.ts to hud-container.page.ts: rehydration check, service instance loading, and CaspioService injection. Adapt for HUD-specific tables (LPS_Services_HUD instead of LPS_Services_Visuals/LPS_Services_EFE).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @angular/core | 17.x | Component framework | Already in use |
| @ionic/angular | 7.x | UI framework | Already in use |
| dexie | 3.x | IndexedDB wrapper | Dexie-first architecture |
| rxjs | 7.x | Reactive patterns | Standard Angular dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| firstValueFrom | rxjs | Convert Observable to Promise | Async/await patterns in ngOnInit |

### No New Dependencies Needed
This phase only involves copying and adapting existing patterns - no new libraries required.

## Architecture Patterns

### Pattern 1: Container Component with Template Loading
**What:** A parent container that wraps child routes and handles:
- Template data pre-loading (Dexie cache population)
- Loading overlay while preparing offline data
- Service instance tracking for multiple services of same type
- Rehydration after purge

**When to use:** All service templates (EFE, HUD, LBW, DTE)

**Source Implementation:**
```typescript
// From engineers-foundation-container.page.ts
// Key properties:
serviceInstanceNumber: number = 1;
totalEFEServices: number = 1;
private serviceInstanceLoaded: boolean = false;
templateReady: boolean = false;
downloadProgress: string = 'Preparing template for offline use...';
private static lastLoadedServiceId: string = ''; // CRITICAL: Static to persist across recreation
```

### Pattern 2: Rehydration Check (MISSING from HUD)
**What:** On service open, check if the service was purged and needs data restored from server
**When to use:** Mobile mode only, before template download

**Source Implementation:**
```typescript
// From engineers-foundation-container.page.ts lines 142-167
if (!environment.isWeb && this.offlineService.isOnline()) {
  try {
    const needsRehydration = await this.foundationData.needsRehydration(newServiceId);
    if (needsRehydration) {
      console.log('[EF Container] Service needs rehydration - starting...');
      this.templateReady = false;
      this.downloadProgress = 'Restoring data from server...';
      this.changeDetectorRef.detectChanges();
      const result = await this.foundationData.rehydrateService(newServiceId);
      if (result.success) {
        console.log(`[EF Container] Rehydration complete`);
      }
    }
  } catch (err) {
    console.error('[EF Container] Rehydration check failed:', err);
  }
}
```

### Pattern 3: Service Instance Loading (MISSING from HUD)
**What:** When multiple services of same type exist on a project, show instance numbers ("HUD #1", "HUD #2")
**When to use:** Always - provides clear identification

**Source Implementation:**
```typescript
// From engineers-foundation-container.page.ts lines 250-316
private async loadServiceInstanceNumber(): Promise<void> {
  // Get current service to find TypeID
  let currentService = await this.offlineTemplate.getService(this.serviceId);
  if (!currentService) {
    currentService = await firstValueFrom(this.caspioService.getService(this.serviceId, false));
  }

  const currentTypeId = String(currentService.TypeID);

  // Get all services for project, filter to same TypeID
  const allServices = await firstValueFrom(this.caspioService.getServicesByProject(this.projectId));
  const sameTypeServices = (allServices || [])
    .filter((s: any) => String(s.TypeID) === currentTypeId)
    .sort((a: any, b: any) => parseInt(a.PK_ID) - parseInt(b.PK_ID));

  this.totalEFEServices = sameTypeServices.length;
  const currentIndex = sameTypeServices.findIndex((s: any) =>
    String(s.PK_ID || s.ServiceID) === String(this.serviceId)
  );
  this.serviceInstanceNumber = currentIndex >= 0 ? currentIndex + 1 : 1;
  this.serviceInstanceLoaded = true;
  this.updateBreadcrumbs();
}
```

### Pattern 4: Loading Overlay with CSS Visibility (ALREADY IN HUD)
**What:** Use CSS class-based visibility instead of *ngIf to prevent router-outlet destruction
**When to use:** Always - prevents child component destruction during loading state changes

**Current Implementation (both EFE and HUD have this):**
```html
<!-- Loading overlay - uses [class.hidden] -->
<div class="template-loading-overlay" [class.hidden]="templateReady">
  ...
</div>

<!-- Router wrapper - uses [class.loading] -->
<div class="router-wrapper" [class.loading]="!templateReady">
  <router-outlet></router-outlet>
</div>
```

### Anti-Patterns to Avoid
- **Using *ngIf on router-outlet:** Destroys all child components and state, causing hard refresh appearance
- **Checking templateReady for skip logic:** Only check lastLoadedServiceId - templateReady can be temporarily false
- **Non-static lastLoadedServiceId:** Ionic recreates components - use static to persist

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rehydration logic | Custom fetch/restore | HudDataService.rehydrateService() | Need to add this method |
| Service metadata | Custom tracking | ServiceMetadataService | Already tracks purge state |
| Template caching | Custom IndexedDB | OfflineTemplateService | Already handles all templates |
| Instance tracking | Custom query | CaspioService.getServicesByProject() | Already exists |

**Key insight:** The pattern exists in engineers-foundation - copy and adapt the method signatures to use HUD-specific tables.

## Common Pitfalls

### Pitfall 1: Static vs Instance Variables
**What goes wrong:** lastLoadedServiceId resets when Ionic recreates the component, causing unnecessary re-downloads
**Why it happens:** Ionic destroys/recreates page components during navigation
**How to avoid:** Use `private static lastLoadedServiceId` instead of instance variable
**Warning signs:** Loading overlay appears on back navigation within same service

### Pitfall 2: Missing CaspioService Import
**What goes wrong:** Cannot load service instance number without CaspioService
**Why it happens:** HUD container doesn't import CaspioService (EFE does)
**How to avoid:** Add CaspioService to constructor injection and imports
**Warning signs:** "HUD" instead of "HUD #1" when multiple HUD services exist

### Pitfall 3: Forgetting Rehydration Runs Every Time
**What goes wrong:** Rehydration check only on new service, missing purge that happened while on same service
**Why it happens:** Putting rehydration inside `if (isNewService || isFirstLoad)` block
**How to avoid:** Rehydration check runs BEFORE the isNewService check (see EFE implementation)
**Warning signs:** User has to navigate away and back after a purge to get data restored

### Pitfall 4: TypeID Mismatch
**What goes wrong:** Service instance counting includes wrong service types
**Why it happens:** EFE uses TypeID=1, HUD uses TypeID=2
**How to avoid:** Verify TypeID filtering uses correct value (2 for HUD)
**Warning signs:** Instance count includes non-HUD services

## Code Examples

### HUD Container - Missing Code to Add

#### 1. New Properties Needed
```typescript
// Service instance tracking for multiple HUD services on same project
serviceInstanceNumber: number = 1;
totalHUDServices: number = 1;
private serviceInstanceLoaded: boolean = false;
```

#### 2. Constructor Injection Additions
```typescript
// Add to constructor
import { CaspioService } from '../../../services/caspio.service';

constructor(
  // ... existing injections ...
  private caspioService: CaspioService  // ADD THIS
) {
```

#### 3. Load Service Instance Method (Copy from EFE, adapt names)
```typescript
private async loadServiceInstanceNumber(): Promise<void> {
  try {
    let currentService = await this.offlineTemplate.getService(this.serviceId);
    if (!currentService) {
      currentService = await firstValueFrom(this.caspioService.getService(this.serviceId, false));
    }
    if (!currentService) return;

    const currentTypeId = String(currentService.TypeID);
    const allServices = await firstValueFrom(this.caspioService.getServicesByProject(this.projectId));

    const sameTypeServices = (allServices || [])
      .filter((s: any) => String(s.TypeID) === currentTypeId)
      .sort((a: any, b: any) => parseInt(a.PK_ID || a.ServiceID) - parseInt(b.PK_ID || b.ServiceID));

    this.totalHUDServices = sameTypeServices.length;
    const currentIndex = sameTypeServices.findIndex((s: any) =>
      String(s.PK_ID || s.ServiceID) === String(this.serviceId)
    );
    this.serviceInstanceNumber = currentIndex >= 0 ? currentIndex + 1 : 1;
    this.serviceInstanceLoaded = true;
    this.updateBreadcrumbs();
    this.changeDetectorRef.detectChanges();
  } catch (error) {
    console.warn('[HUD Container] Error loading service instance number:', error);
    this.serviceInstanceLoaded = true;
    this.updateBreadcrumbs();
    this.changeDetectorRef.detectChanges();
  }
}
```

#### 4. Rehydration Check in ngOnInit (Add Before Download)
```typescript
// Add BEFORE the isNewService check in route.params subscription
// ========== REHYDRATION CHECK (runs every time) ==========
if (!environment.isWeb && this.offlineService.isOnline()) {
  try {
    const needsRehydration = await this.hudData.needsRehydration(newServiceId);
    if (needsRehydration) {
      console.log('[HUD Container] Service needs rehydration - starting...');
      this.templateReady = false;
      this.downloadProgress = 'Restoring data from server...';
      this.changeDetectorRef.detectChanges();
      const result = await this.hudData.rehydrateService(newServiceId);
      if (result.success) {
        console.log(`[HUD Container] Rehydration complete`);
      }
    }
  } catch (err) {
    console.error('[HUD Container] Rehydration check failed:', err);
  }
}
```

#### 5. Updated Breadcrumb Logic
```typescript
private updateBreadcrumbs() {
  this.breadcrumbs = [];
  const url = this.router.url;

  // Reset to default title - include instance number if multiple HUD services exist
  if (this.totalHUDServices > 1) {
    this.currentPageTitle = `HUD/Manufactured Home #${this.serviceInstanceNumber}`;
    this.currentPageShortTitle = `HUD #${this.serviceInstanceNumber}`;
  } else {
    this.currentPageTitle = 'HUD/Manufactured Home';
    this.currentPageShortTitle = 'HUD';
  }

  // ... rest of breadcrumb logic ...
}
```

### HudDataService - Methods to Add

#### needsRehydration Method
```typescript
async needsRehydration(serviceId: string): Promise<boolean> {
  const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);
  if (!metadata) {
    return false; // New service, doesn't need rehydration
  }
  return metadata.purgeState === 'PURGED' || metadata.purgeState === 'ARCHIVED';
}
```

#### rehydrateService Method (Simplified for HUD)
```typescript
async rehydrateService(serviceId: string): Promise<{
  success: boolean;
  restored: { hudRecords: number; hudAttachments: number };
  error?: string;
}> {
  const result = {
    success: false,
    restored: { hudRecords: 0, hudAttachments: 0 },
    error: undefined as string | undefined
  };

  if (!this.offlineService.isOnline()) {
    result.error = 'Cannot rehydrate while offline.';
    return result;
  }

  try {
    // Clear caches
    this.clearServiceCaches(serviceId);

    // Fetch HUD records from server
    const hudRecords = await firstValueFrom(this.caspioService.getServicesHUDByServiceId(serviceId));
    if (hudRecords && hudRecords.length > 0) {
      // Cache the data
      await this.indexedDb.cacheServiceData(serviceId, 'hud_records', hudRecords);
      result.restored.hudRecords = hudRecords.length;

      // Restore attachments for each HUD record
      for (const hud of hudRecords) {
        const hudId = hud.HUDID || hud.PK_ID;
        if (hudId) {
          const attachments = await firstValueFrom(
            this.caspioService.getServiceHUDAttachByHUDId(String(hudId))
          );
          if (attachments && attachments.length > 0) {
            result.restored.hudAttachments += attachments.length;
          }
        }
      }
    }

    // Update purge state
    await this.serviceMetadata.setPurgeState(serviceId, 'ACTIVE');
    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Unknown error';
  }

  return result;
}
```

## Table Mapping: EFE to HUD

| EFE Table | HUD Equivalent | Notes |
|-----------|---------------|-------|
| LPS_Services_Visuals | LPS_Services_HUD | Main records table |
| LPS_Services_Visuals_Attach | LPS_Services_HUD_Attach | Photo attachments |
| LPS_Services_Visuals_Templates | LPS_Services_HUD_Templates | Template definitions |
| LPS_Services_EFE | N/A | HUD doesn't have rooms |
| LPS_Services_EFE_Points | N/A | HUD doesn't have points |
| LPS_Services_EFE_Points_Attach | N/A | HUD doesn't have point attachments |

### TypeID Values
| Template Type | TypeID | Description |
|---------------|--------|-------------|
| EFE | 1 | Engineers Foundation Evaluation |
| HUD | 2 | HUD/Manufactured Housing |

## Current State Comparison

### Features in engineers-foundation-container NOT in hud-container

| Feature | EFE Line(s) | HUD Status | Action |
|---------|-------------|------------|--------|
| serviceInstanceNumber property | 45-46 | MISSING | Add |
| totalEFEServices property | 46 | MISSING | Add as totalHUDServices |
| serviceInstanceLoaded flag | 47 | MISSING | Add |
| loadServiceInstanceNumber() | 250-316 | MISSING | Copy and adapt |
| CaspioService injection | 81-82 | MISSING | Add to constructor |
| Rehydration check in ngOnInit | 142-167 | MISSING | Copy and adapt |
| Instance number in breadcrumbs | 323-348 | MISSING | Add to updateBreadcrumbs |
| foundationData.needsRehydration | 147 | MISSING | Add to HudDataService |
| foundationData.rehydrateService | 156 | MISSING | Add to HudDataService |

### Features ALREADY matching between both containers

| Feature | Status |
|---------|--------|
| templateReady flag | PRESENT |
| downloadProgress string | PRESENT |
| static lastLoadedServiceId | PRESENT |
| Loading overlay HTML | PRESENT |
| Loading overlay CSS | PRESENT |
| router-wrapper pattern | PRESENT |
| downloadTemplateData() method | PRESENT |
| verifyCachedDataExists() method | PRESENT |
| verifyDownloadedData() method | PRESENT |

## Open Questions

None - all questions resolved through code analysis.

## Sources

### Primary (HIGH confidence)
- `src/app/pages/engineers-foundation/engineers-foundation-container/engineers-foundation-container.page.ts` - Full container implementation
- `src/app/pages/hud/hud-container/hud-container.page.ts` - Current HUD container
- `src/app/pages/engineers-foundation/engineers-foundation-data.service.ts` - Rehydration methods
- `src/app/pages/hud/hud-data.service.ts` - Current HUD data service
- `src/app/services/caspio.service.ts` - API method signatures

### Secondary (MEDIUM confidence)
- `src/app/pages/hud/services/hud-field-repo.service.ts` - TypeID=2 filtering reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Existing codebase, no external research needed
- Architecture: HIGH - Direct code comparison between EFE and HUD
- Pitfalls: HIGH - Documented in source code comments

**Research date:** 2026-01-23
**Valid until:** 60 days (stable internal codebase patterns)

# Template Creation Guide: Copying HUD to LBW

This guide documents the complete process of creating the Load Bearing Wall (LBW) template by copying and adapting the HUD (Mobile/Manufactured Home) template.

**Use this as a reference when creating new templates from existing ones.**

---

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Database Tables Setup](#step-1-database-tables-setup)
4. [Step 2: Directory Structure](#step-2-directory-structure)
5. [Step 3: Copy Files](#step-3-copy-files)
6. [Step 4: Rename Files](#step-4-rename-files)
7. [Step 5: Update Code References](#step-5-update-code-references)
8. [Step 6: API Methods](#step-6-api-methods)
9. [Step 7: Routing Configuration](#step-7-routing-configuration)
10. [Step 8: Navigation Integration](#step-8-navigation-integration)
11. [Step 9: Verification](#step-9-verification)
12. [Common Issues](#common-issues)

---

## Overview

**Goal:** Create a new template (LBW) based on an existing template (HUD)

**Key Principle:** Complete separation - the new template must use its own database tables and not interfere with the source template.

**Templates Involved:**
- **Source:** HUD (Mobile/Manufactured Home)
- **Target:** LBW (Load Bearing Wall)

---

## Prerequisites

### Required Database Tables

Before starting, ensure these tables exist in Caspio:

| Source Table | New Table | Purpose |
|--------------|-----------|---------|
| `LPS_Services_HUD` | `LPS_Services_LBW` | Main records |
| `LPS_Services_HUD_Templates` | `LPS_Services_LBW_Templates` | Template items |
| `LPS_Services_HUD_Drop` | `LPS_Services_LBW_Drop` | Dropdown options |
| `LPS_Services_HUD_Attach` | `LPS_Services_LBW_Attach` | Photo attachments |

### Required Fields

Ensure field names match the pattern:
- **Primary Key Field:** `HUDID` → `LBWID` (or `[TEMPLATE]ID`)
- **Foreign Key:** `ServiceID` (same across all templates)
- **Category Field:** `Category` (groups template items)
- **Kind Field:** `Kind` (Comment/Limitation/Deficiency)

---

## Step 1: Database Tables Setup

### 1.1 Create Tables

Copy the structure from HUD tables:

```sql
-- Example structure (adjust for your DB)
LPS_Services_LBW:
  - LBWID (AutoNumber, Primary Key)
  - ServiceID (Number)
  - Category (Text)
  - Kind (Text)
  - Name (Text)
  - Text (Text)
  - Notes (Text)
  - Answers (Text)
  - Hidden (Yes/No)

LPS_Services_LBW_Templates:
  - TemplateID (Number, Primary Key)
  - TypeID (Number)
  - Required (Yes/No)
  - Auto (Yes/No)
  - Category (Text)
  - AnswerType (Number: 0=text, 1=Yes/No, 2=multi-select)
  - Kind (Text: Comment/Limitation/Deficiency)
  - Name (Text)
  - Text (Text)

LPS_Services_LBW_Drop:
  - TemplateID (Number)
  - Dropdown (Text)

LPS_Services_LBW_Attach:
  - AttachID (AutoNumber, Primary Key)
  - LBWID (Number, Foreign Key)
  - Photo (File)
  - Annotation (Text)
  - Drawings (Text)
```

### 1.2 Populate Template Data

Import your template items into `LPS_Services_LBW_Templates`:
- Set appropriate `Category` values
- Set `Kind` values (Comment, Limitation, or Deficiency)
- Set `AnswerType` (0, 1, or 2)
- Link dropdown options in `LPS_Services_LBW_Drop` using `TemplateID`

---

## Step 2: Directory Structure

### 2.1 Create Main Directory

```bash
src/app/pages/lbw/
```

### 2.2 Create Subdirectories

```bash
src/app/pages/lbw/
├── lbw-main/              # Main navigation hub
├── lbw-container/         # Container with header/breadcrumbs
├── lbw-project-details/   # Project details form
├── lbw-categories/        # Categories list
├── lbw-category-detail/   # Category detail with items
└── services/              # Shared services
    ├── lbw-state.service.ts
    └── lbw-pdf.service.ts
```

**PowerShell Command:**
```powershell
New-Item -ItemType Directory -Path `
  "src\app\pages\lbw\lbw-main", `
  "src\app\pages\lbw\lbw-container", `
  "src\app\pages\lbw\lbw-project-details", `
  "src\app\pages\lbw\lbw-categories", `
  "src\app\pages\lbw\lbw-category-detail", `
  "src\app\pages\lbw\services" -Force
```

---

## Step 3: Copy Files

### 3.1 Copy Root Files

```powershell
Copy-Item "src\app\pages\hud\hud.page.ts" "src\app\pages\lbw\lbw.page.ts"
Copy-Item "src\app\pages\hud\hud.page.html" "src\app\pages\lbw\lbw.page.html"
Copy-Item "src\app\pages\hud\hud.page.scss" "src\app\pages\lbw\lbw.page.scss"
Copy-Item "src\app\pages\hud\hud-routing.module.ts" "src\app\pages\lbw\lbw-routing.module.ts"
Copy-Item "src\app\pages\hud\hud-data.service.ts" "src\app\pages\lbw\lbw-data.service.ts"
```

### 3.2 Copy Sub-Pages

```powershell
# Main page
Copy-Item "src\app\pages\hud\hud-main\*" "src\app\pages\lbw\lbw-main\" -Force
Rename-Item "src\app\pages\lbw\lbw-main\hud-main.page.ts" "lbw-main.page.ts"
Rename-Item "src\app\pages\lbw\lbw-main\hud-main.page.html" "lbw-main.page.html"
Rename-Item "src\app\pages\lbw\lbw-main\hud-main.page.scss" "lbw-main.page.scss"

# Container
Copy-Item "src\app\pages\hud\hud-container\*" "src\app\pages\lbw\lbw-container\" -Force
Rename-Item "src\app\pages\lbw\lbw-container\hud-container.page.ts" "lbw-container.page.ts"
Rename-Item "src\app\pages\lbw\lbw-container\hud-container.page.html" "lbw-container.page.html"
Rename-Item "src\app\pages\lbw\lbw-container\hud-container.page.scss" "lbw-container.page.scss"

# Project Details
Copy-Item "src\app\pages\hud\hud-project-details\*" "src\app\pages\lbw\lbw-project-details\" -Force
Rename-Item "src\app\pages\lbw\lbw-project-details\hud-project-details.page.ts" "lbw-project-details.page.ts"
Rename-Item "src\app\pages\lbw\lbw-project-details\hud-project-details.page.html" "lbw-project-details.page.html"
Rename-Item "src\app\pages\lbw\lbw-project-details\hud-project-details.page.scss" "lbw-project-details.page.scss"

# Category Detail
Copy-Item "src\app\pages\hud\hud-category-detail\*" "src\app\pages\lbw\lbw-category-detail\" -Force
Rename-Item "src\app\pages\lbw\lbw-category-detail\hud-category-detail.page.ts" "lbw-category-detail.page.ts"
Rename-Item "src\app\pages\lbw\lbw-category-detail\hud-category-detail.page.html" "lbw-category-detail.page.html"
Rename-Item "src\app\pages\lbw\lbw-category-detail\hud-category-detail.page.scss" "lbw-category-detail.page.scss"

# Services
Copy-Item "src\app\pages\hud\services\*" "src\app\pages\lbw\services\" -Force
Rename-Item "src\app\pages\lbw\services\hud-state.service.ts" "lbw-state.service.ts"
Rename-Item "src\app\pages\lbw\services\hud-pdf.service.ts" "lbw-pdf.service.ts"
```

---

## Step 4: Rename Files

All files should be renamed from `hud-*` to `lbw-*` (or your new template prefix).

**Pattern:**
- `hud-*.page.ts` → `lbw-*.page.ts`
- `hud-*.page.html` → `lbw-*.page.html`
- `hud-*.page.scss` → `lbw-*.page.scss`
- `hud-*.service.ts` → `lbw-*.service.ts`

---

## Step 5: Update Code References

### 5.1 Class Names

Replace all class names throughout the code:

| Source | Target |
|--------|--------|
| `HudPage` | `LbwPage` |
| `HudMainPage` | `LbwMainPage` |
| `HudContainerPage` | `LbwContainerPage` |
| `HudProjectDetailsPage` | `LbwProjectDetailsPage` |
| `HudCategoryDetailPage` | `LbwCategoryDetailPage` |
| `HudRoutingModule` | `LbwRoutingModule` |
| `HudDataService` | `LbwDataService` |
| `HudStateService` | `LbwStateService` |
| `HudPdfService` | `LbwPdfService` |

**Example PowerShell Replace:**
```powershell
(Get-Content "src\app\pages\lbw\lbw.page.ts" -Raw) `
  -replace 'HudPage','LbwPage' `
  | Set-Content "src\app\pages\lbw\lbw.page.ts"
```

### 5.2 Component Selectors

In `@Component` decorators:

```typescript
// Before
selector: 'app-hud-main'
templateUrl: './hud-main.page.html'
styleUrls: ['./hud-main.page.scss']

// After
selector: 'app-lbw-main'
templateUrl: './lbw-main.page.html'
styleUrls: ['./lbw-main.page.scss']
```

### 5.3 Interface Names

```typescript
// Before
export interface HudProjectData { ... }
export interface HudCategoryData { ... }
interface ServicesHudRecord { ... }

// After
export interface LbwProjectData { ... }
export interface LbwCategoryData { ... }
interface ServicesLbwRecord { ... }
```

### 5.4 Import Paths

Update all relative imports:

```typescript
// Before
import { HudDataService } from './hud-data.service';
import { HudStateService } from '../services/hud-state.service';

// After
import { LbwDataService } from './lbw-data.service';
import { LbwStateService } from '../services/lbw-state.service';
```

### 5.5 Variable Names

```typescript
// Before
private hudDataService: HudDataService
this.hudDataService.method()

// After
private lbwDataService: LbwDataService
this.lbwDataService.method()
```

### 5.6 Display Text

Update all user-facing text:

```typescript
// Before
currentPageTitle = 'HUD/Manufactured Home'
currentPageShortTitle = 'HUD'
projectName: 'HUD/Manufactured Home'

// After
currentPageTitle = 'LBW/Load Bearing Wall'
currentPageShortTitle = 'LBW'
projectName: 'LBW/Load Bearing Wall'
```

### 5.7 Route Paths

```typescript
// Before
this.router.navigate(['/hud', this.projectId, this.serviceId])

// After
this.router.navigate(['/lbw', this.projectId, this.serviceId])
```

### 5.8 Console Log Messages

```typescript
// Before
console.log('[HUD Data] Creating record...')
console.log('[HUD CATEGORY] Loading...')

// After
console.log('[LBW Data] Creating record...')
console.log('[LBW CATEGORY] Loading...')
```

---

## Step 6: API Methods

### 6.1 Add Template-Specific API Methods to CaspioService

**Location:** `src/app/services/caspio.service.ts`

Add these methods (replace `LBW` with your template prefix):

```typescript
// ============================================
// LBW (Load Bearing Wall) API Methods
// ============================================

// Templates
getServicesLBWTemplates(): Observable<any[]> {
  return this.get<any>('/tables/LPS_Services_LBW_Templates/records').pipe(
    map(response => response.Result || []),
    catchError(error => {
      console.error('LBW templates error:', error);
      return of([]);
    })
  );
}

// Dropdown Options
getServicesLBWDrop(): Observable<any[]> {
  return this.get<any>('/tables/LPS_Services_LBW_Drop/records').pipe(
    map(response => {
      if (response && response.Result) {
        return response.Result;
      }
      return [];
    })
  );
}

// Main Records (CRUD)
createServicesLBW(lbwData: any): Observable<any> {
  return this.post<any>('/tables/LPS_Services_LBW/records?response=rows', lbwData).pipe(
    tap(response => {
      if (response && response.Result && response.Result.length > 0) {
        console.log('✅ LBW record created:', response.Result[0]);
      }
    }),
    catchError(error => {
      console.error('❌ Failed to create Services_LBW:', error);
      return throwError(() => error);
    })
  );
}

updateServicesLBW(lbwId: string, lbwData: any): Observable<any> {
  const url = `/tables/LPS_Services_LBW/records?q.where=LBWID=${lbwId}`;
  return this.put<any>(url, lbwData).pipe(
    catchError(error => {
      console.error('❌ Failed to update Services_LBW:', error);
      return throwError(() => error);
    })
  );
}

getServicesLBWByServiceId(serviceId: string): Observable<any[]> {
  return this.get<any>(`/tables/LPS_Services_LBW/records?q.where=ServiceID=${serviceId}&q.limit=1000`).pipe(
    map(response => response.Result || [])
  );
}

deleteServicesLBW(lbwId: string): Observable<any> {
  return this.delete<any>(`/tables/LPS_Services_LBW/records?q.where=PK_ID=${lbwId}`);
}

// Attachments (Photos)
getServiceLBWAttachByLBWId(lbwId: string): Observable<any[]> {
  return this.get<any>(`/tables/LPS_Services_LBW_Attach/records?q.where=LBWID=${lbwId}&q.limit=1000`).pipe(
    map(response => response.Result || [])
  );
}

createServicesLBWAttachWithFile(lbwId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
  return new Observable(observer => {
    this.uploadLBWAttachWithFilesAPI(lbwId, annotation, file, drawings, originalFile)
      .then(result => {
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        observer.error(error);
      });
  });
}

updateServicesLBWAttach(attachId: string, data: any): Observable<any> {
  const url = `/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`;
  return this.put<any>(url, data);
}

deleteServicesLBWAttach(attachId: string): Observable<any> {
  return this.delete<any>(`/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`);
}
```

### 6.2 Add Helper Methods

Add private helper methods for file uploads (copy from HUD equivalents and rename):

```typescript
private async uploadLBWAttachWithFilesAPI(lbwId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Promise<any> {
  // Copy logic from uploadHUDAttachWithFilesAPI
  // Replace all "hud" with "lbw", "HUDID" with "LBWID"
  // Update table name to LPS_Services_LBW_Attach
}

private async uploadAndUpdateLBWAttachPhoto(attachId: number, file: File, originalFile?: File): Promise<any> {
  // Copy logic from uploadAndUpdateHUDAttachPhoto
  // Replace all references
}

private async createLBWAttachRecordOnly(lbwId: number, annotation: string, drawings?: string): Promise<any> {
  // Copy logic from createHUDAttachRecordOnly
  // Replace HUDID with LBWID
  // Update table name
}
```

---

## Step 7: Routing Configuration

### 7.1 Update App Routing Module

**File:** `src/app/app-routing.module.ts`

Add the route for your new template:

```typescript
const routes: Routes = [
  // ... existing routes ...
  {
    path: 'hud/:projectId/:serviceId',
    loadChildren: () => import('./pages/hud/hud-routing.module')
      .then(m => m.HudRoutingModule),
    canActivate: [AuthGuard],
    data: { preload: false }
  },
  {
    path: 'lbw/:projectId/:serviceId',  // ← Add this
    loadChildren: () => import('./pages/lbw/lbw-routing.module')
      .then(m => m.LbwRoutingModule),
    canActivate: [AuthGuard],
    data: { preload: false }
  }
];
```

### 7.2 Update Template Routing Module

**File:** `src/app/pages/lbw/lbw-routing.module.ts`

```typescript
const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./lbw-container/lbw-container.page')
      .then(m => m.LbwContainerPage),
    children: [
      {
        path: '',
        loadComponent: () => import('./lbw-main/lbw-main.page')
          .then(m => m.LbwMainPage)
      },
      {
        path: 'project-details',
        loadComponent: () => import('./lbw-project-details/lbw-project-details.page')
          .then(m => m.LbwProjectDetailsPage)
      },
      {
        path: 'categories',
        loadComponent: () => import('./lbw-categories/lbw-categories.page')
          .then(m => m.LbwCategoriesPage)
      },
      {
        path: 'category/:category',
        loadComponent: () => import('./lbw-category-detail/lbw-category-detail.page')
          .then(m => m.LbwCategoryDetailPage)
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LbwRoutingModule { }
```

---

## Step 8: Navigation Integration

### 8.1 Add Template Detection

**File:** `src/app/pages/project-detail/project-detail.page.ts`

In the `openTemplate()` method, add detection for your new template:

```typescript
// Check for LBW template - Load Bearing Wall
const isLBWTemplate =
  service.typeName?.toLowerCase().includes('lbw') ||
  service.typeName?.toLowerCase().includes('load bearing wall') ||
  service.typeName?.toLowerCase().includes('load-bearing wall');

// Add routing logic
if (isHUDTemplate) {
  // ... existing HUD routing ...
} else if (isLBWTemplate) {
  const url = `/lbw/${this.projectId}/${service.serviceId}`;
  const extras: any = { replaceUrl: false };
  if (openPdf) {
    extras.queryParams = { openPdf: '1' };
  }

  this.router.navigate(['lbw', this.projectId, service.serviceId], extras)
    .catch(error => {
      console.error('Router navigation failed, using fallback:', error);
      const finalUrl = openPdf ? `${url}?openPdf=1` : url;
      window.location.assign(finalUrl);
    });
} else if (isEngineersFoundation) {
  // ... existing Engineers Foundation routing ...
}
```

### 8.2 Create Categories List Page

Since we want a hierarchical structure (Main → Categories → Category Detail), create the categories list page:

**File:** `src/app/pages/lbw/lbw-categories/lbw-categories.page.ts`

```typescript
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../services/caspio.service';

interface CategoryCard {
  title: string;
  icon: string;
  count: number;
}

@Component({
  selector: 'app-lbw-categories',
  templateUrl: './lbw-categories.page.html',
  styleUrls: ['./lbw-categories.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class LbwCategoriesPage implements OnInit {
  categories: CategoryCard[] = [];
  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService
  ) {}

  async ngOnInit() {
    this.route.parent?.params.subscribe(async params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
      await this.loadCategories();
      this.loading = false;
    });
  }

  async loadCategories() {
    try {
      const templates = await this.caspioService.getServicesLBWTemplates().toPromise();
      
      // Extract unique categories in database order (don't sort!)
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];
      const categoryCounts = new Map<string, number>();
      
      (templates || []).forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
        if (template.Category) {
          const count = categoryCounts.get(template.Category) || 0;
          categoryCounts.set(template.Category, count + 1);
        }
      });

      // Preserve database order
      this.categories = categoriesOrder.map(title => ({
        title,
        icon: 'construct-outline',
        count: categoryCounts.get(title) || 0
      }));
    } catch (error) {
      console.error('[LBW Categories] Error loading categories:', error);
    }
  }

  navigateToCategory(category: CategoryCard) {
    this.router.navigate(['..', 'category', category.title], { relativeTo: this.route });
  }

  getCategoryIcon(categoryName: string): string {
    // Add custom icon mapping as needed
    return 'construct-outline';
  }
}
```

---

## Step 9: Verification

### 9.1 Run Linter

```bash
# Check for TypeScript errors
ng lint

# Or check specific directory
read_lints(["src/app/pages/lbw"])
```

### 9.2 Verify No HUD References

Search for any remaining HUD references:

```bash
grep -r "HUDID\|Services_HUD\|getServicesHUD" src/app/pages/lbw/
```

**Expected:** Zero results

### 9.3 Verify LBW References

```bash
grep -r "LBWID\|Services_LBW\|getServicesLBW" src/app/pages/lbw/
```

**Expected:** Many results showing proper usage

### 9.4 Test Navigation Flow

1. Create a service with type name containing "LBW" or "Load Bearing Wall"
2. Click the Report button → Should navigate to LBW template
3. Verify breadcrumbs work correctly
4. Test category navigation
5. Test item selection and photo upload

---

## Common Issues

### Issue 1: Syntax Errors with Quotes

**Problem:** Curly quotes ('') instead of straight quotes ('')

**Fix:**
```typescript
// WRONG
this.currentPageShortTitle = ''LBW';
this.router.navigate(['/'LBW', ...]);

// CORRECT
this.currentPageShortTitle = 'LBW';
this.router.navigate(['/lbw', ...]);
```

### Issue 2: Import References Not Updated

**Problem:** Importing HudProjectData instead of LbwProjectData

**Fix:**
```typescript
// WRONG
import { LbwStateService, HudProjectData } from '../services/lbw-state.service';

// CORRECT
import { LbwStateService, LbwProjectData } from '../services/lbw-state.service';
```

### Issue 3: Missing API Methods

**Problem:** TypeScript errors about missing methods

**Fix:** Ensure ALL these methods are added to CaspioService:
- `getServicesLBWTemplates()`
- `getServicesLBWDrop()`
- `createServicesLBW()`
- `updateServicesLBW()`
- `getServicesLBWByServiceId()`
- `deleteServicesLBW()`
- `getServiceLBWAttachByLBWId()`
- `createServicesLBWAttachWithFile()`
- `updateServicesLBWAttach()`
- `deleteServicesLBWAttach()`

### Issue 4: Incorrect Table References

**Problem:** Still calling HUD tables from LBW template

**Fix:** Use PowerShell to bulk replace:
```powershell
(Get-Content "file.ts" -Raw) `
  -replace 'createServicesHUD','createServicesLBW' `
  -replace 'updateServicesHUD','updateServicesLBW' `
  -replace 'HUDID','LBWID' `
  | Set-Content "file.ts"
```

### Issue 5: Routes Not Working

**Problem:** 404 errors when navigating to template

**Fix:** Verify:
1. Route added to `app-routing.module.ts`
2. Template routing module properly configured
3. Component names match in lazy-loaded imports
4. Navigation detection in `project-detail.page.ts` includes your template

---

## Complete Replacement Checklist

Use this checklist for your next template copy:

- [ ] **Database Tables Created**
  - [ ] Main table (`LPS_Services_[TEMPLATE]`)
  - [ ] Templates table (`LPS_Services_[TEMPLATE]_Templates`)
  - [ ] Dropdown table (`LPS_Services_[TEMPLATE]_Drop`)
  - [ ] Attachments table (`LPS_Services_[TEMPLATE]_Attach`)

- [ ] **Directory Structure Created**
  - [ ] Main directory (`src/app/pages/[template]/`)
  - [ ] All subdirectories (main, container, project-details, categories, category-detail, services)

- [ ] **Files Copied and Renamed**
  - [ ] Root files (page.ts, page.html, page.scss, routing.module.ts, data.service.ts)
  - [ ] Sub-page files (all subdirectories)
  - [ ] Service files (state.service.ts, pdf.service.ts)

- [ ] **Code References Updated**
  - [ ] Class names (e.g., HudPage → LbwPage)
  - [ ] Component selectors (e.g., app-hud → app-lbw)
  - [ ] Interface names (e.g., HudProjectData → LbwProjectData)
  - [ ] Import paths (e.g., ./hud-data.service → ./lbw-data.service)
  - [ ] Variable names (e.g., hudDataService → lbwDataService)
  - [ ] Display text (e.g., "HUD/Manufactured Home" → "LBW/Load Bearing Wall")
  - [ ] Route paths (e.g., /hud → /lbw)
  - [ ] Console log messages
  - [ ] Comments

- [ ] **API Methods Added**
  - [ ] getServices[TEMPLATE]Templates()
  - [ ] getServices[TEMPLATE]Drop()
  - [ ] createServices[TEMPLATE]()
  - [ ] updateServices[TEMPLATE]()
  - [ ] getServices[TEMPLATE]ByServiceId()
  - [ ] deleteServices[TEMPLATE]()
  - [ ] getService[TEMPLATE]AttachBy[TEMPLATE]Id()
  - [ ] createServices[TEMPLATE]AttachWithFile()
  - [ ] updateServices[TEMPLATE]Attach()
  - [ ] deleteServices[TEMPLATE]Attach()
  - [ ] Private helper methods for file uploads

- [ ] **Routing Configured**
  - [ ] Route added to app-routing.module.ts
  - [ ] Template routing module updated
  - [ ] Container breadcrumbs updated
  - [ ] Back button navigation logic updated

- [ ] **Navigation Integration**
  - [ ] Template detection added to project-detail.page.ts
  - [ ] Navigation logic added to openTemplate() method
  - [ ] Service type name matching configured

- [ ] **Verification**
  - [ ] No linter errors
  - [ ] Zero source template references in new template
  - [ ] All imports resolve correctly
  - [ ] Navigation flows work end-to-end
  - [ ] Database operations use correct tables

---

## Quick Reference: PowerShell Bulk Replace

When copying files, use these patterns for bulk replacement:

```powershell
# Pattern for replacing class names and references
(Get-Content "file.ts" -Raw) `
  -replace 'HudDataService','LbwDataService' `
  -replace 'HudStateService','LbwStateService' `
  -replace 'HudPdfService','LbwPdfService' `
  -replace 'HudPage','LbwPage' `
  -replace 'HudMainPage','LbwMainPage' `
  -replace 'HudContainerPage','LbwContainerPage' `
  -replace 'HudProjectDetailsPage','LbwProjectDetailsPage' `
  -replace 'HudCategoryDetailPage','LbwCategoryDetailPage' `
  -replace 'HudRoutingModule','LbwRoutingModule' `
  | Set-Content "file.ts"

# Pattern for API calls
(Get-Content "file.ts" -Raw) `
  -replace 'createServicesHUD','createServicesLBW' `
  -replace 'updateServicesHUD','updateServicesLBW' `
  -replace 'deleteServicesHUD','deleteServicesLBW' `
  -replace 'getServicesHUDTemplates','getServicesLBWTemplates' `
  -replace 'getServicesHUDDrop','getServicesLBWDrop' `
  -replace 'createServicesHUDAttach','createServicesLBWAttach' `
  -replace 'updateServicesHUDAttach','updateServicesLBWAttach' `
  -replace 'deleteServicesHUDAttach','deleteServicesLBWAttach' `
  | Set-Content "file.ts"

# Pattern for ID fields
(Get-Content "file.ts" -Raw) `
  -replace 'HUDID','LBWID' `
  -replace '\bhudId\b','lbwId' `
  -replace 'HudId','LbwId' `
  | Set-Content "file.ts"

# Pattern for table names
(Get-Content "file.ts" -Raw) `
  -replace 'Services_HUD','Services_LBW' `
  -replace 'LPS_Services_HUD','LPS_Services_LBW' `
  | Set-Content "file.ts"

# Pattern for display text
(Get-Content "file.ts" -Raw) `
  -replace 'HUD/Manufactured Home','LBW/Load Bearing Wall' `
  -replace 'HUD main','LBW main' `
  -replace '/hud','/lbw' `
  | Set-Content "file.ts"
```

---

## Template Naming Convention

When creating a new template, follow these conventions:

### File Names
- **Directory:** Lowercase with hyphens (e.g., `load-bearing-wall`, `lbw`)
- **Files:** `[template]-[component].page.[ext]`

### Class Names
- **Pattern:** PascalCase with full words
- **Example:** `LbwPage`, `LoadBearingWallPage`

### Database Tables
- **Pattern:** `LPS_Services_[TEMPLATE]`
- **Example:** `LPS_Services_LBW`, `LPS_Services_LoadBearingWall`

### ID Fields
- **Pattern:** `[TEMPLATE]ID` (uppercase)
- **Example:** `LBWID`, `LoadBearingWallID`

### Component Selectors
- **Pattern:** `app-[template]-[component]`
- **Example:** `app-lbw-main`, `app-load-bearing-wall-main`

---

## Summary: Files Created for LBW Template

Total: **22 files** across **7 directories**

### Root Level (5 files)
- `lbw.page.ts` (8,981 lines)
- `lbw.page.html`
- `lbw.page.scss`
- `lbw-routing.module.ts`
- `lbw-data.service.ts`

### Sub-Pages (15 files)
- `lbw-main/` (3 files)
- `lbw-container/` (3 files)
- `lbw-project-details/` (3 files)
- `lbw-categories/` (3 files)
- `lbw-category-detail/` (3 files)

### Services (2 files)
- `services/lbw-state.service.ts`
- `services/lbw-pdf.service.ts`

---

## Success Criteria

Your template copy is complete when:

✅ All files copied and renamed
✅ Zero linter errors
✅ Zero references to source template tables/IDs
✅ All API methods created and referenced correctly
✅ Routing works end-to-end
✅ Navigation from project detail works
✅ Breadcrumbs display correctly
✅ Categories load from correct template table
✅ Dropdown options load from correct drop table
✅ Items organized by Kind (Comment/Limitation/Deficiency)
✅ Photo uploads work with correct attachment table
✅ PDF generation configured (if applicable)

---

## Notes for Future Templates

1. **Always use dedicated database tables** - Never share tables between templates
2. **Update ALL references** - Use bulk replace commands to ensure completeness
3. **Test navigation thoroughly** - Verify all routes and back buttons work
4. **Preserve database order** - Don't sort categories alphabetically unless intended
5. **Match styling exactly** - Copy SCSS files completely to maintain visual consistency
6. **Use word boundary regex** - When replacing, use `\b` to avoid partial matches (e.g., `\bhudId\b`)

---

## Estimated Time

For a template of similar complexity to HUD/LBW:

- **Database Setup:** 30-60 minutes
- **File Copying:** 15 minutes
- **Code Updates:** 60-90 minutes
- **API Methods:** 30-45 minutes
- **Routing:** 15-30 minutes
- **Testing:** 30-60 minutes

**Total:** 3-5 hours for a complete template copy

---

*Created: December 3, 2025*
*Template: HUD → LBW*
*Version: 1.0*



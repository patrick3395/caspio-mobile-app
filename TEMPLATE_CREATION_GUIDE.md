# Template Creation Guide

This guide explains how to create new inspection templates following the established pattern used for HUD, EFE, etc.

## Template Structure

All templates consist of **2 sections**:
1. **Project Details** - Identical across all templates (no changes needed)
2. **Custom Section** - Template-specific inspection categories

## Quick Start: Copy from Engineers Foundation

The engineers-foundation template is the source template. Copy it and rename the table references.

## Step-by-Step Process

### 1. Create Database Tables

Create the following tables in Caspio (replace `XXX` with your template code, e.g., "HUD", "EFE"):

```
LPS_Services_XXX                    # Main records (replaces Services_EFE)
LPS_Services_XXX_Templates          # Template definitions (replaces Services_EFE_Templates)
LPS_Services_XXX_Attach             # Photo attachments (replaces Services_EFE_Points_Attach)
LPS_Services_XXX_Drop               # Dropdown options (replaces Services_EFE_Drop)
```

**Required Columns**:
- `LPS_Services_XXX`: XXXID (autonumber), ServiceID, Name, Category, Kind, Text, Notes, etc.
- `LPS_Services_XXX_Templates`: PK_ID, Category, Name, Text, Kind, OrderID, AnswerType, TemplateID, Required
- `LPS_Services_XXX_Attach`: AttachID (autonumber), XXXID, Photo, Annotation, Drawings
- `LPS_Services_XXX_Drop`: TemplateID, Dropdown

**OrderID Column**: Items within each category are sorted by OrderID (lowest first)

### 2. Copy Template Files

```bash
# Copy from engineers-foundation to your new template folder
cp -r src/app/pages/engineers-foundation src/app/pages/xxx

# Files to copy:
# - xxx.page.ts
# - xxx.page.html
# - xxx.page.scss
# - xxx-data.service.ts
```

### 3. Global Find & Replace

Use your IDE's find/replace across the new template folder:

| Find | Replace | Notes |
|------|---------|-------|
| `EngineersFoundationPage` | `XxxPage` | Class name |
| `EngineersFoundationDataService` | `XxxDataService` | Data service class |
| `engineers-foundation` | `xxx` | Component selector, file paths |
| `Services_EFE` | `Services_XXX` | Table name in code |
| `LPS_Services_EFE` | `LPS_Services_XXX` | Full table name |
| `Services_Visuals` | `Services_XXX` | Visual records table |
| `VisualID` | `XXXID` | Primary key field |
| `EFEID` | `XXXID` | If copying from EFE |
| `getServicesEFE` | `getServicesXXX` | API methods |
| `createServicesEFE` | `createServicesXXX` | API methods |
| `getServicesVisualsTemplates` | `getServicesXXXTemplates` | Templates method |
| `getServicesVisualsDrop` | `getServicesXXXDrop` | Dropdown method |

### 4. Update Component Metadata

**xxx.page.ts** - Update the @Component decorator:

```typescript
@Component({
  selector: 'app-xxx',
  templateUrl: './xxx.page.html',
  styleUrls: ['./xxx.page.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [/* ... */]
})
export class XxxPage implements OnInit, OnDestroy {
```

### 5. Update Section Title

**xxx.page.html** - Change the second section title:

```html
<!-- Change from "Structural Systems" or "Elevation Plot" to your section name -->
<div class="section-header" (click)="toggleSection('structural')">
  <h3>Your Custom Section Name</h3>
</div>
```

### 6. Add Caspio Service Methods

**src/app/services/caspio.service.ts** - Add CRUD methods:

```typescript
// Services XXX Templates methods
getServicesXXXTemplates(): Observable<any[]> {
  return this.get<any>('/tables/LPS_Services_XXX_Templates/records').pipe(
    map(response => response.Result || []),
    catchError(error => {
      console.error('XXX templates error:', error);
      return of([]);
    })
  );
}

// Services XXX methods (for main records)
createServicesXXX(xxxData: any): Observable<any> {
  return this.post<any>('/tables/LPS_Services_XXX/records?response=rows', xxxData).pipe(
    map(response => {
      if (response && response.Result && response.Result.length > 0) {
        return response.Result[0];
      }
      return response;
    })
  );
}

updateServicesXXX(xxxId: string, xxxData: any): Observable<any> {
  const url = `/tables/LPS_Services_XXX/records?q.where=XXXID=${xxxId}`;
  return this.put<any>(url, xxxData);
}

getServicesXXXByServiceId(serviceId: string): Observable<any[]> {
  return this.get<any>(`/tables/LPS_Services_XXX/records?q.where=ServiceID=${serviceId}&q.limit=1000`).pipe(
    map(response => response.Result || [])
  );
}

deleteServicesXXX(xxxId: string): Observable<any> {
  return this.delete<any>(`/tables/LPS_Services_XXX/records?q.where=PK_ID=${xxxId}`);
}

// Services_XXX_Attach methods (for photos)
getServiceXXXAttachByXXXId(xxxId: string): Observable<any[]> {
  return this.get<any>(`/tables/LPS_Services_XXX_Attach/records?q.where=XXXID=${xxxId}`).pipe(
    map(response => response.Result || [])
  );
}

createServicesXXXAttachWithFile(xxxId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
  return new Observable(observer => {
    this.uploadXXXAttachWithFilesAPI(xxxId, annotation, file, drawings, originalFile)
      .then(result => {
        observer.next(result);
        observer.complete();
      })
      .catch(error => observer.error(error));
  });
}

private async uploadXXXAttachWithFilesAPI(xxxId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Promise<any> {
  const token = await firstValueFrom(this.getValidToken());
  const API_BASE_URL = environment.caspio.apiBaseUrl;
  const formData = new FormData();
  formData.append('XXXID', xxxId.toString());
  formData.append('Annotation', annotation || '');
  if (drawings) {
    formData.append('Drawings', drawings);
  }
  formData.append('Photo', file, file.name);

  const response = await fetch(`${API_BASE_URL}/tables/LPS_Services_XXX_Attach/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`XXX attach upload failed: ${response.statusText}`);
  }

  return await response.json();
}

updateServicesXXXAttachPhoto(attachId: number, file: File, originalFile?: File): Observable<any> {
  return new Observable(observer => {
    this.uploadAndUpdateXXXAttachPhoto(attachId, file, originalFile)
      .then(result => {
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        observer.error(error);
      });
  });
}

private async uploadAndUpdateXXXAttachPhoto(attachId: number, file: File, originalFile?: File): Promise<any> {
  const accessToken = this.tokenSubject.value;
  const API_BASE_URL = environment.caspio.apiBaseUrl;

  try {
    let filePath = '';
    let originalFilePath = '';

    // Upload original file first if present
    if (originalFile) {
      const originalFormData = new FormData();
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = originalFile.name.split('.').pop() || 'jpg';
      const originalFileName = `xxx_attach_${attachId}_original_${timestamp}_${randomId}.${fileExt}`;
      originalFormData.append('file', originalFile, originalFileName);

      const originalUploadResponse = await fetch(`${API_BASE_URL}/files`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        body: originalFormData
      });

      if (originalUploadResponse.ok) {
        const originalUploadResult = await originalUploadResponse.json();
        originalFilePath = `/${originalUploadResult.Name || originalFileName}`;
      }
    }

    // Upload main file to Files API
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileExt = file.name.split('.').pop() || 'jpg';
    const uniqueFilename = `xxx_attach_${attachId}_${timestamp}_${randomId}.${fileExt}`;

    const formData = new FormData();
    formData.append('file', file, uniqueFilename);

    const uploadResponse = await fetch(`${API_BASE_URL}/files`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: formData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Files API upload failed:', errorText);
      throw new Error('Failed to upload file to Files API: ' + errorText);
    }

    const uploadResult = await uploadResponse.json();
    filePath = `/${uploadResult.Name || uniqueFilename}`;

    // Update the XXX attach record with the photo path
    const updateData: any = {
      Photo: originalFilePath || filePath
    };

    const updateResponse = await fetch(`${API_BASE_URL}/tables/LPS_Services_XXX_Attach/records?q.where=AttachID=${attachId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to update Services_XXX_Attach record:', errorText);
      throw new Error('Failed to update record: ' + errorText);
    }

    return {
      AttachID: attachId,
      Photo: originalFilePath || filePath,
      OriginalPhoto: originalFilePath
    };

  } catch (error) {
    console.error('Error in uploadAndUpdateXXXAttachPhoto:', error);
    throw error;
  }
}

createServicesXXXAttachRecord(xxxId: number, annotation: string, drawings?: string): Observable<any> {
  return new Observable(observer => {
    this.createXXXAttachRecordOnly(xxxId, annotation, drawings)
      .then(result => {
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        observer.error(error);
      });
  });
}

private async createXXXAttachRecordOnly(xxxId: number, annotation: string, drawings?: string): Promise<any> {
  const token = await firstValueFrom(this.getValidToken());
  const API_BASE_URL = environment.caspio.apiBaseUrl;
  const payload = {
    XXXID: xxxId,
    Annotation: annotation || '',
    Drawings: drawings || ''
  };

  const response = await fetch(`${API_BASE_URL}/tables/LPS_Services_XXX_Attach/records?response=rows`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`XXX attach record creation failed: ${response.statusText}`);
  }

  const result = await response.json();
  if (result && result.Result && result.Result.length > 0) {
    return result.Result[0];
  }
  return result;
}

// Get Services_XXX_Drop for dropdown options
getServicesXXXDrop(): Observable<any[]> {
  return this.get<any>('/tables/LPS_Services_XXX_Drop/records').pipe(
    map(response => {
      if (response && response.Result) {
        return response.Result;
      }
      return [];
    })
  );
}
```

### 7. Update Data Service

**xxx-data.service.ts**:

```typescript
@Injectable({ providedIn: 'root' })
export class XxxDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private xxxCache = new Map<string, CacheEntry<any[]>>();
  private xxxAttachmentsCache = new Map<string, CacheEntry<any[]>>();

  constructor(private readonly caspioService: CaspioService) {}

  async getVisualsByService(serviceId: string): Promise<any[]> {
    if (!serviceId) {
      console.warn('[XXX Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[XXX Data] Loading existing XXX records for ServiceID:', serviceId);
    const xxxRecords = await this.resolveWithCache(this.xxxCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesXXXByServiceId(serviceId))
    );
    console.log('[XXX Data] API returned XXX records:', xxxRecords.length, 'records');
    return xxxRecords;
  }

  async getVisualAttachments(xxxId: string | number): Promise<any[]> {
    if (!xxxId) {
      return [];
    }
    const key = String(xxxId);
    return this.resolveWithCache(this.xxxAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceXXXAttachByXXXId(String(xxxId)))
    );
  }

  clearAllCaches(): void {
    console.log('[XXX Data Service] Clearing ALL caches to force fresh data load');
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.xxxCache.clear();
    this.xxxAttachmentsCache.clear();
    this.caspioService.clearServicesCache();
  }

  clearServiceCaches(serviceId: string): void {
    console.log('[XXX Data Service] Clearing caches for ServiceID:', serviceId);
    this.xxxCache.delete(serviceId);
  }

  // Keep resolveWithCache and isExpired methods unchanged
}
```

### 8. Add Routing

**src/app/app-routing.module.ts**:

```typescript
{
  path: 'xxx/:projectId/:serviceId',
  loadComponent: () => import('./pages/xxx/xxx.page').then( m => m.XxxPage),
  canActivate: [AuthGuard],
  data: { preload: false }
}
```

### 9. Update Navigation

**src/app/pages/project-detail/project-detail.page.ts** - Add navigation logic:

```typescript
// Determine if this is an XXX template
const isXXXTemplate = serviceType?.toLowerCase().includes('xxx');

if (isXXXTemplate) {
  const url = `/xxx/${this.projectId}/${service.serviceId}`;
  const extras: any = { replaceUrl: false };
  if (openPdf) {
    extras.queryParams = { openPdf: '1' };
  }

  this.router.navigate(['xxx', this.projectId, service.serviceId], extras).catch(error => {
    console.error('Router navigation failed, using fallback:', error);
    const finalUrl = openPdf ? `${url}?openPdf=1` : url;
    window.location.assign(finalUrl);
  });
  return;
}
```

## What Stays the Same

These elements remain **identical** across all templates:

- **Project Details section** - No changes needed
- **Photo upload functionality** - Camera, gallery, annotations
- **Operations queue** - Offline-first architecture
- **Change detection strategy** - OnPush
- **Caching mechanisms** - 5-minute TTL
- **PDF generation** - Report export functionality
- **UI patterns** - Accordions, checkboxes, multi-select

## What Changes

Only update these elements:

- **Table names** - All database table references
- **Primary key field** - XXXID instead of VisualID/EFEID/HUDID
- **Component names** - Class names, selectors, file names
- **Section title** - Custom section name in HTML
- **API methods** - Caspio service CRUD operations

## Testing Checklist

- [ ] Template loads without errors
- [ ] Categories display in correct OrderID order
- [ ] Dropdown options load from LPS_Services_XXX_Drop
- [ ] Photos upload successfully
- [ ] Photos display with captions centered
- [ ] Album allows multiple photo selection
- [ ] Data saves to correct tables (Services_XXX, Services_XXX_Attach)
- [ ] PDF export includes template data
- [ ] Navigation from project detail works
- [ ] Cache clearing works on page leave/return

## Common Pitfalls

1. **Forgot to update XXXID** - Search for old ID field names (VisualID, EFEID, HUDID)
2. **Wrong table name in API calls** - Verify all Caspio service methods use new table names
3. **Missing dropdown table** - Ensure LPS_Services_XXX_Drop exists with TemplateID column
4. **OrderID not set** - Templates without OrderID will default to 0 (appear first)
5. **Wrong primary key in responses** - Update all `response.XXXID` references

## Quick Reference

```bash
# Pattern for all table-related replacements:
Services_EFE → Services_XXX
LPS_Services_EFE → LPS_Services_XXX
EFEID → XXXID
getServicesEFE → getServicesXXX
createServicesEFE → createServicesXXX
```

Replace `XXX` with your template code (e.g., HUD, EFE, WDO, etc.)

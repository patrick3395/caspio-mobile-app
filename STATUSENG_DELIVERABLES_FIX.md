# StatusEng Deliverables Display Fix

## Issue
The StatusEng column in the Deliverables table was not showing the StatusEng value from the Services table. Two problems were identified:

1. **Fallback Logic**: StatusEng was falling back to Status field when empty
2. **Dropdown Options**: Dropdown was using wrong field from Status table (`status.Status` instead of `status.StatusAdmin`)

## Problems Identified

### Problem 1: Incorrect Fallback Logic
In `project-detail.page.ts`, when loading services:
```typescript
// BEFORE - Fallback to Status if StatusEng not present
StatusEng: service.StatusEng || service.Status || '',
```

This meant if StatusEng was empty in the database, it would show the Status value instead, making it impossible to see what was actually in the StatusEng field.

### Problem 2: Wrong Dropdown Fields
In `project-detail.page.html`, the StatusEng dropdown was using:
```html
<!-- BEFORE - Wrong fields from Status table -->
<option *ngFor="let status of statusOptions" [value]="status.Status">
  {{ status.Status }}
</option>
```

The Status table has `StatusClient` and `StatusAdmin` fields, not a `Status` field. This made the dropdown non-functional.

## Solutions Implemented

### Fix 1: Removed Fallback Logic

**Updated `project-detail.page.ts` (Line 579):**
```typescript
// AFTER - Show actual StatusEng value from database
StatusEng: service.StatusEng || '',  // Don't fallback to Status - show what's actually in StatusEng field
```

**Added Better Logging (Lines 550-563):**
```typescript
// Debug logging for status and datetime
if (service.Status || service.StatusEng) {
  console.log('[ProjectDetail] Service Status/StatusEng Data:', {
    typeName: offer?.TypeName,
    Status: service.Status,
    StatusEng: service.StatusEng,
    StatusDateTime: service.StatusDateTime,
    rawServiceFields: {
      PK_ID: service.PK_ID,
      Status: service.Status,
      StatusEng: service.StatusEng,
      StatusDateTime: service.StatusDateTime
    }
  });
}
```

This logging will help verify what values are being loaded from the database.

### Fix 2: Corrected Dropdown Fields

**Updated Desktop Deliverables Table (Lines 111-112):**
```html
<!-- AFTER - Correct fields from Status table -->
<option *ngFor="let status of statusOptions" [value]="status.StatusAdmin">
  {{ status.StatusClient }}
</option>
```

**Updated Mobile Modal (Lines 653-654):**
```html
<!-- AFTER - Correct fields from Status table -->
<option *ngFor="let status of statusOptions" [value]="status.StatusAdmin">
  {{ status.StatusClient }}
</option>
```

## How It Works Now

### Service Creation Flow
1. **Service created** with StatusEng = "Created"
2. **Database stores** StatusEng = "Created"
3. **Page loads** services from database
4. **StatusEng field** shows "Created" (actual value from database)
5. **Dropdown** displays user-friendly StatusClient labels

### Dropdown Behavior
- **Value stored**: StatusAdmin (internal database value)
- **Label displayed**: StatusClient (user-friendly label)
- **Example**: If user selects "Created", stores the StatusAdmin value for "Created"

## Files Modified

1. **`src/app/pages/project-detail/project-detail.page.ts`**
   - Removed fallback from StatusEng to Status
   - Added comprehensive logging for Status and StatusEng fields

2. **`src/app/pages/project-detail/project-detail.page.html`**
   - Fixed desktop deliverables table dropdown (line 111-112)
   - Fixed mobile modal dropdown (line 653-654)

## Expected Behavior After Fix

### ✅ Deliverables Table - Desktop
- StatusEng column shows value from Services.StatusEng field
- For newly created services: Shows "Created"
- For existing services: Shows actual StatusEng value from database
- Dropdown displays user-friendly labels (StatusClient)
- Dropdown saves internal values (StatusAdmin)

### ✅ Deliverables Modal - Mobile
- Same behavior as desktop table
- StatusEng dropdown works correctly
- Values save to Services.StatusEng field

## Testing Instructions

### Test 1: Existing Services
1. Open project-detail page
2. Look at Deliverables table
3. **Verify**: StatusEng column shows values (e.g., "Created")
4. **Check Console**: Should see logging with StatusEng values

### Test 2: Newly Created Services
1. Create a new service
2. Check Deliverables table
3. **Verify**: StatusEng shows "Created"
4. **Verify**: Value persists after page reload

### Test 3: Dropdown Functionality
1. Click on StatusEng dropdown
2. **Verify**: Dropdown shows user-friendly labels (StatusClient values)
3. Select a value
4. **Verify**: Value saves to database
5. Reload page
6. **Verify**: Selected value displays correctly

### Test 4: Console Logging
1. Open browser console
2. Load project-detail page
3. **Verify**: See logging like:
```
[ProjectDetail] Service Status/StatusEng Data: {
  typeName: "Engineer's Foundation Evaluation",
  Status: "[StatusAdmin value]",
  StatusEng: "Created",
  StatusDateTime: "2025-11-04T...",
  rawServiceFields: { ... }
}
```

## Database Fields

### Services Table
- **Status**: Contains StatusAdmin value (e.g., internal code for "In Progress")
- **StatusEng**: Contains StatusAdmin value (e.g., "Created")
- **StatusDateTime**: Timestamp of last status change

### Status Table (Lookup)
- **StatusClient**: User-friendly label (e.g., "Created", "In Progress")
- **StatusAdmin**: Internal database value
- Used by dropdown to show friendly labels while storing admin values

## Related Changes

This fix is part of the overall Status management system:
1. ✅ Service creation sets StatusEng = "Created"
2. ✅ Report finalization does NOT change StatusEng
3. ✅ StatusEng displays correctly in Deliverables table
4. ✅ Dropdown uses correct Status table fields

## Summary

✅ StatusEng now shows actual value from Services.StatusEng field  
✅ Removed incorrect fallback to Status field  
✅ Dropdown uses correct StatusAdmin/StatusClient fields  
✅ Added comprehensive logging for debugging  
✅ Works on both desktop and mobile views  
✅ No linter errors  
✅ Consistent with Status management architecture  

The Deliverables table will now properly display StatusEng values from the Services table.


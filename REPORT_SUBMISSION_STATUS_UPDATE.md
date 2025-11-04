# Report Submission Status Update

## Issue
When a report is submitted, only the Status field was being updated. The StatusEng field was not being updated to reflect submission.

## Requirements
When a report is submitted:
- **Status** should be updated to "Under Review" (using Status_Admin from Status table)
- **StatusEng** should be updated to "Submitted" (using Status_Admin from Status table)
- **StatusDateTime** should be updated to current timestamp

## Solution

### 1. Updated `processReportSubmission()` Function

**File**: `src/app/pages/project-detail/project-detail.page.ts` (Lines 5175-5200)

**Before:**
```typescript
// Get current date/time in ISO format
const submittedDateTime = new Date().toISOString();

// Update Status to "Under Review" and save submission date
const updateData = {
  Status: 'Under Review',  // ❌ Hardcoded string
  StatusDateTime: submittedDateTime
  // ❌ StatusEng not updated
};

// Update local service object
service.Status = 'Under Review';  // ❌ Hardcoded string
service.StatusDateTime = submittedDateTime;
// ❌ StatusEng not updated locally
```

**After:**
```typescript
// Get current date/time in ISO format
const submittedDateTime = new Date().toISOString();

// Get Status_Admin values from Status table
const underReviewStatus = this.getStatusAdminByClient("Under Review");
const submittedStatus = this.getStatusAdminByClient("Submitted");

// Update Status to "Under Review" and StatusEng to "Submitted"
const updateData = {
  Status: underReviewStatus,        // ✅ Status_Admin for "Under Review"
  StatusEng: submittedStatus,       // ✅ Status_Admin for "Submitted"
  StatusDateTime: submittedDateTime
};

console.log('[Submit Report] Update data:', {
  Status: { StatusClient: "Under Review", StatusAdmin: underReviewStatus },
  StatusEng: { StatusClient: "Submitted", StatusAdmin: submittedStatus },
  StatusDateTime: submittedDateTime
});

// Update local service object
service.Status = underReviewStatus;     // ✅ Status_Admin value
service.StatusEng = submittedStatus;    // ✅ Status_Admin value
service.StatusDateTime = submittedDateTime;
```

### 2. Updated Status Check in `showSubmitDisabledExplanation()`

**File**: `src/app/pages/project-detail/project-detail.page.ts` (Lines 5094-5097)

**Before:**
```typescript
// If service is already "Under Review", button is grayed
if (service.Status === 'Under Review') {  // ❌ Hardcoded string
  header = 'Update Not Available';
  message = 'There have been no changes to the project so there is no need to update the submission.';
}
```

**After:**
```typescript
// If service is already "Under Review", button is grayed
// Check using Status_Admin value from Status table
const underReviewStatus = this.getStatusAdminByClient("Under Review");
if (service.Status === underReviewStatus) {  // ✅ Uses Status_Admin value
  header = 'Update Not Available';
  message = 'There have been no changes to the project so there is no need to update the submission.';
}
```

## Database Updates

When a report is submitted, the Services table will be updated with:

```sql
UPDATE Services
SET 
  Status = '[Status_Admin for "Under Review"]',
  StatusEng = '[Status_Admin for "Submitted"]',
  StatusDateTime = '2025-11-04T12:34:56.789Z'
WHERE PK_ID = '[service ID]'
```

## Status Flow

### Service Creation
- Status = Status_Admin for "In Progress"
- StatusEng = Status_Admin for "Created"

### Report Finalization
- Status = Status_Admin for "Finalized"
- StatusEng = **Unchanged** (remains "Created")

### Report Submission
- Status = Status_Admin for "Under Review"
- StatusEng = Status_Admin for "Submitted" ✅ **NEW**

### Report Update (Subsequent Finalization)
- Status = Status_Admin for "Updated"
- StatusEng = **Unchanged** (remains "Submitted" or "Created")

## UI Changes

### Deliverables Table
After submission, the StatusEng dropdown will show:
- The Status_Admin value for "Submitted"
- Example: "Submitted" or "SB" (depending on Status table)

### Reports Section
After submission, the Status display will show:
- The Status_Admin value for "Under Review"
- Example: "Under Review" or "UR" (depending on Status table)

## Console Logging

When submitting a report, you'll see:
```javascript
[Submit Report] Submitting service: 12345 "Engineer's Foundation Evaluation"
[Status Lookup] Looking for Status_Client: "Under Review"
[Status Lookup] Returning Status_Admin: "UR"  // or whatever your value is
[Status Lookup] Looking for Status_Client: "Submitted"
[Status Lookup] Returning Status_Admin: "SB"  // or whatever your value is

[Submit Report] Update data: {
  Status: { 
    StatusClient: "Under Review", 
    StatusAdmin: "UR" 
  },
  StatusEng: { 
    StatusClient: "Submitted", 
    StatusAdmin: "SB" 
  },
  StatusDateTime: "2025-11-04T12:34:56.789Z"
}
```

## Status Table Requirements

The Status table must have these records:

| Status_Client | Status_Admin |
|--------------|--------------|
| Created | [your admin value] |
| In Progress | [your admin value] |
| Finalized | [your admin value] |
| Updated | [your admin value] |
| Under Review | [your admin value] |
| **Submitted** | [your admin value] |

**Note**: The "Submitted" record is required for StatusEng updates.

## Testing Instructions

### Test 1: Submit New Report
1. Create a new service
2. Finalize the report
3. Submit the report
4. **Verify in Deliverables table**:
   - StatusEng = Status_Admin for "Submitted"
5. **Verify in Reports section**:
   - Status = Status_Admin for "Under Review"
6. **Verify in database**:
   - Services.Status = Status_Admin for "Under Review"
   - Services.StatusEng = Status_Admin for "Submitted"

### Test 2: Console Logs
1. Open browser console
2. Submit a report
3. **Verify logs show**:
   - Status lookup for "Under Review"
   - StatusEng lookup for "Submitted"
   - Both Status_Admin values returned

### Test 3: UI Display
1. After submission, check UI
2. **Deliverables dropdown**: Shows Submitted value
3. **Reports section**: Shows Under Review value
4. Both should match Status_Admin values

## Files Modified

1. **`src/app/pages/project-detail/project-detail.page.ts`**
   - Lines 5175-5200: Updated `processReportSubmission()` to set both Status and StatusEng
   - Lines 5094-5097: Updated status check to use Status_Admin value

## Summary

✅ Report submission now updates both Status and StatusEng fields  
✅ Status = Status_Admin for "Under Review"  
✅ StatusEng = Status_Admin for "Submitted"  
✅ Uses Status table lookup (no hardcoded values)  
✅ Enhanced logging for debugging  
✅ Consistent with overall Status architecture  
✅ No linter errors  

When a report is submitted, both the Status and StatusEng fields will be properly updated using values from the Status table.


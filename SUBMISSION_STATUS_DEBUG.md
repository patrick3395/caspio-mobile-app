# Report Submission Status Debugging Guide

## Expected Behavior

When submitting a report:
- **Status** field should be set to Status_Admin value for "Under Review"
- **StatusEng** field should be set to Status_Admin value for "Submitted"

## Current Code

```typescript
const underReviewStatus = this.getStatusAdminByClient("Under Review");
const submittedStatus = this.getStatusAdminByClient("Submitted");

const updateData = {
  Status: underReviewStatus,        // Should be Status_Admin for "Under Review"
  StatusEng: submittedStatus,       // Should be Status_Admin for "Submitted"
  StatusDateTime: submittedDateTime
};
```

## Enhanced Logging Added

When you submit a report, check the browser console for these logs:

```javascript
[Submit Report] Looking up Status_Admin for "Under Review"...
[Status Lookup] Looking for Status_Client: "Under Review"
[Status Lookup] Found record: {...}
[Status Lookup] Returning Status_Admin: "..."
[Submit Report] Under Review Status_Admin value: "..."

[Submit Report] Looking up Status_Admin for "Submitted"...
[Status Lookup] Looking for Status_Client: "Submitted"
[Status Lookup] Found record: {...}
[Status Lookup] Returning Status_Admin: "..."
[Submit Report] Submitted Status_Admin value: "..."

[Submit Report] ===== FINAL UPDATE DATA =====
[Submit Report] Status field will be set to: "..."
[Submit Report] StatusEng field will be set to: "..."
[Submit Report] StatusDateTime: "..."
[Submit Report] Full updateData object: {...}
```

## Debugging Steps

### Step 1: Check Console Logs

After submitting a report, look for:

1. **"Under Review" lookup**:
   ```
   [Submit Report] Under Review Status_Admin value: "???"
   ```
   - What value do you see here?
   - Should be the Status_Admin value for "Under Review" (e.g., "UR" or "Under Review")

2. **"Submitted" lookup**:
   ```
   [Submit Report] Submitted Status_Admin value: "???"
   ```
   - What value do you see here?
   - Should be the Status_Admin value for "Submitted" (e.g., "SB" or "Submitted")

3. **Final update data**:
   ```
   [Submit Report] Status field will be set to: "???"
   [Submit Report] StatusEng field will be set to: "???"
   ```
   - Are these values different?
   - Or are they both the same?

### Step 2: Check Status Table

Verify your Status table has these records:

#### Required Record 1: Under Review
- **Status_Client**: "Under Review" (exact spelling, case-sensitive)
- **Status_Admin**: [Your admin code for Under Review]

#### Required Record 2: Submitted
- **Status_Client**: "Submitted" (exact spelling, case-sensitive)
- **Status_Admin**: [Your admin code for Submitted]

### Step 3: Verify Database After Submission

After submitting a report:
1. Open Caspio Services table
2. Find the submitted service record
3. Check both fields:
   - **Status** column: Should contain Status_Admin value for "Under Review"
   - **StatusEng** column: Should contain Status_Admin value for "Submitted"

## Common Issues

### Issue 1: Both Fields Have Same Value

**Symptom:**
```
[Submit Report] Status field will be set to: "Submitted"
[Submit Report] StatusEng field will be set to: "Submitted"
```

**Possible Causes:**
1. Status table doesn't have "Under Review" record
2. "Under Review" lookup is falling back to "Under Review" string
3. Both Status_Admin values are actually the same

**Solution:**
Add "Under Review" record to Status table with unique Status_Admin value.

### Issue 2: Fallback Values Being Used

**Symptom:**
```
[Status] Status_Admin not found for Status_Client "Under Review", using Status_Client as fallback
[Submit Report] Under Review Status_Admin value: "Under Review"
```

**Cause:**
Status table doesn't have record with Status_Client = "Under Review"

**Solution:**
Add record to Status table:
- Status_Client: "Under Review"
- Status_Admin: [Your unique code like "UR"]

### Issue 3: Values Are Swapped

**Symptom:**
- Status = "Submitted"
- StatusEng = "Under Review"

**Cause:**
Variables might be swapped in code (though current code looks correct)

**Solution:**
Verify the code matches:
```typescript
Status: underReviewStatus,    // ← Should be "Under Review" lookup
StatusEng: submittedStatus,   // ← Should be "Submitted" lookup
```

## Testing Checklist

- [ ] Clear browser cache
- [ ] Reload project-detail page
- [ ] Open browser console (F12)
- [ ] Submit a report
- [ ] Check console logs (copy/paste the output)
- [ ] Check Status table in Caspio (verify "Under Review" and "Submitted" records exist)
- [ ] Check Services table in Caspio (verify Status and StatusEng values after submission)
- [ ] Take screenshots of console logs
- [ ] Take screenshots of database values

## Expected Console Output (Correct)

```javascript
[Submit Report] Looking up Status_Admin for "Under Review"...
[Status Lookup] Looking for Status_Client: "Under Review"
[Status Lookup] Found record: { Status_Client: "Under Review", Status_Admin: "UR" }
[Status Lookup] Returning Status_Admin: "UR"
[Submit Report] Under Review Status_Admin value: "UR"

[Submit Report] Looking up Status_Admin for "Submitted"...
[Status Lookup] Looking for Status_Client: "Submitted"
[Status Lookup] Found record: { Status_Client: "Submitted", Status_Admin: "SB" }
[Status Lookup] Returning Status_Admin: "SB"
[Submit Report] Submitted Status_Admin value: "SB"

[Submit Report] ===== FINAL UPDATE DATA =====
[Submit Report] Status field will be set to: "UR"          ← Different value
[Submit Report] StatusEng field will be set to: "SB"       ← Different value
[Submit Report] StatusDateTime: "2025-11-04T12:34:56.789Z"
```

## Next Steps

1. Submit a report
2. Copy the entire console output
3. Share the console logs
4. Verify Status table has both "Under Review" and "Submitted" records
5. Check what values are in Status_Admin for each

This will help identify exactly where the issue is.


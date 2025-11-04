# StatusEng Diagnostic Guide

## Issue Description
StatusEng dropdown is showing Status_Client values when it should be using Status_Admin values for the database field.

## Diagnostic Steps

### Step 1: Check Browser Console Logs

After loading the project-detail page, check the console for these logs:

#### A. Status Table Loading
```javascript
[Status Table] Loaded status options: [...]
[Status Table] Sample record structure: {...}
[Status Table] "Created" record found: {...}
[Status Table] "In Progress" record found: {...}
```

**What to look for:**
- Verify the record structure has `Status_Client` and `Status_Admin` fields (with underscores)
- Verify "Created" record exists
- Verify "In Progress" record exists

**Example of CORRECT structure:**
```javascript
{
  Status_Client: "Created",
  Status_Admin: "C"  // or whatever your admin code is
}
```

**Example of WRONG structure:**
```javascript
{
  StatusClient: "Created",  // ❌ Missing underscore
  StatusAdmin: "C"          // ❌ Missing underscore
}
```

or

```javascript
{
  Status: "Created"  // ❌ Wrong field name entirely
}
```

#### B. Service Creation Logs
When creating a new service, look for:
```javascript
[Status Lookup] Looking for Status_Client: "Created"
[Status Lookup] Available options: [...]
[Status Lookup] Found record: {...}
[Status Lookup] Returning Status_Admin: "..."
```

**What to check:**
- Does "Created" get found?
- What Status_Admin value is returned?
- Is it a short code (like "C") or the full text (like "Created")?

### Step 2: Check What's in the Database

After creating a service, check the Services table in Caspio:

1. Find the newly created service record
2. Look at the `StatusEng` column
3. **What should be there:**
   - Status_Admin value (e.g., "C", "IP", "CR", etc.)
   - NOT the full Status_Client text (e.g., "Created", "In Progress")

### Step 3: Check the Dropdown Binding

The dropdown should be configured as:
```html
<select [(ngModel)]="service.StatusEng">
  <option *ngFor="let status of statusOptions" [value]="status.Status_Admin">
    {{ status.Status_Client }}
  </option>
</select>
```

This means:
- **Displayed to user**: Status_Client (e.g., "Created", "In Progress")
- **Stored in service.StatusEng**: Status_Admin (e.g., "C", "IP")

## Common Issues and Solutions

### Issue 1: Status Table Missing "Created" Record

**Symptom:**
```javascript
[Status Table] "Created" record found: undefined
[Status] Status_Admin not found for Status_Client "Created", using Status_Client as fallback
```

**Solution:**
Add a record to the Status table:
- Status_Client: "Created"
- Status_Admin: Your admin code (e.g., "C" or "CR")

### Issue 2: Status Table Has Wrong Field Names

**Symptom:**
```javascript
[Status Table] Sample record structure: { StatusClient: "...", StatusAdmin: "..." }
```
(No underscores in field names)

**Solution:**
The Status table columns must be named:
- `Status_Client` (with underscore)
- `Status_Admin` (with underscore)

If your table has different column names, you need to either:
1. Rename the columns in Caspio to use underscores, OR
2. Update the code to match your actual column names

### Issue 3: StatusEng Contains Status_Client Value

**Symptom:**
- Database shows StatusEng = "Created" (full text)
- Should show StatusEng = "C" or short code

**Cause:**
The fallback is being used because "Created" wasn't found in Status table.

**Solution:**
Ensure Status table has the record with exact spelling:
```
Status_Client: "Created"  // Must match exactly, including capitalization
Status_Admin: "C"         // Your admin code
```

### Issue 4: Dropdown Shows Blank

**Symptom:**
- Dropdown options appear but selected value is blank
- Console shows StatusEng has a value

**Cause:**
The value in service.StatusEng doesn't match any option's value.

**Example:**
- service.StatusEng = "Created" (Status_Client value)
- Dropdown options have [value]="C" (Status_Admin value)
- No match found, so dropdown shows blank

**Solution:**
Ensure service.StatusEng contains Status_Admin value, not Status_Client value.

## Testing Checklist

### Test 1: Verify Status Table Structure
- [ ] Open browser console
- [ ] Load project-detail page
- [ ] Check `[Status Table]` logs
- [ ] Verify field names have underscores
- [ ] Verify "Created" record exists
- [ ] Note the Status_Admin value for "Created"

### Test 2: Create New Service
- [ ] Create a new service
- [ ] Check console for `[Status Lookup]` logs
- [ ] Verify "Created" is found
- [ ] Verify Status_Admin value is returned (not "Created")
- [ ] Check Deliverables table
- [ ] Dropdown should show "Created"

### Test 3: Database Verification
- [ ] Open Caspio Services table
- [ ] Find the newly created service
- [ ] Check StatusEng column value
- [ ] Should contain Status_Admin value (short code)
- [ ] Should NOT contain "Created" (full text)

### Test 4: Dropdown Functionality
- [ ] Click StatusEng dropdown
- [ ] Verify options display Status_Client values
- [ ] Select a different value
- [ ] Check what value gets saved to database
- [ ] Should be Status_Admin value

## Expected Console Output (Correct)

```javascript
[Status Table] Loaded status options: [
  { Status_Client: "Created", Status_Admin: "C" },
  { Status_Client: "In Progress", Status_Admin: "IP" },
  { Status_Client: "Under Review", Status_Admin: "UR" },
  // ... more records
]

[Status Table] Sample record structure: {
  Status_Client: "Created",
  Status_Admin: "C"
}

[Status Table] "Created" record found: {
  Status_Client: "Created",
  Status_Admin: "C"
}

[Status Table] "In Progress" record found: {
  Status_Client: "In Progress",
  Status_Admin: "IP"
}

// When creating service:
[Status Lookup] Looking for Status_Client: "Created"
[Status Lookup] Available options: [...]
[Status Lookup] Found record: { Status_Client: "Created", Status_Admin: "C" }
[Status Lookup] Returning Status_Admin: "C"

🔧 Creating service with data: {
  serviceData: {
    Status: "IP",      // Status_Admin for "In Progress"
    StatusEng: "C"     // Status_Admin for "Created"
  }
}
```

## Next Steps

1. **Clear your browser cache** and reload
2. **Check console logs** following the steps above
3. **Take screenshots** of:
   - Console logs showing Status table structure
   - Console logs when creating a service
   - Caspio Services table showing StatusEng value
4. **Report findings** with screenshots

This will help identify exactly where the issue is occurring.


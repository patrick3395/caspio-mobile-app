# IMPORTANT REMINDERS FOR CLAUDE

## 🚨 CRITICAL - NEVER CHANGE THE FILE UPLOAD METHOD 🚨
**THE FILE UPLOAD METHOD BELOW IS TESTED AND WORKING. DO NOT MODIFY IT UNDER ANY CIRCUMSTANCES.**

## CRITICAL - DO THIS EVERY SESSION

### 1. UPDATE VERSION HEADER
**ALWAYS** update the version header in the main page before pushing to git:
- Location: Look for "Version X.X.XX" in the app
- Format: `Version 1.1.XX - BRIEF DESCRIPTION OF CHANGES`
- Example: `Version 1.1.87 - Fixed attachment uploads with popup`
- This tells the user what the current build contains

### 2. CASPIO API REQUIREMENTS
- **Attach Table Fields**: AttachID, ProjectID, TypeID, Title, Notes, Link, Attachment
- **NO ServiceID field** in Attach table - never try to send it
- **Services Table Fields**: ProjectID, TypeID, DateOfInspection (NO OffersID field)
- **Use response=rows** parameter to get created records back immediately
- APIs are instantaneous - no need for temp IDs or waiting

### 3. 🔒 FILE UPLOAD METHOD (PROVEN WORKING - NEVER CHANGE THIS!)
**⚠️ WARNING: This method is confirmed working as of v1.3.20. DO NOT MODIFY! ⚠️**

**The ONLY correct way to upload files to Caspio:**

```javascript
// STEP 1: Upload file to Caspio Files API
const formData = new FormData();
formData.append('file', fileBlob, fileName);

const uploadResponse = await fetch(`https://${account}.caspio.com/rest/v2/files`, {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});

const uploadResult = await uploadResponse.json();
// Returns: { Name: "filename.jpg" }

// STEP 2: Create Attach record with the file PATH (not the file itself!)
const filePath = `/${uploadResult.Name}`;  // e.g., "/IMG_1234.jpg"

const recordResponse = await fetch(`https://${account}.caspio.com/rest/v2/tables/Attach/records`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    ProjectID: projectId,      // Integer
    TypeID: typeId,            // Integer
    Title: title,              // String
    Notes: notes,              // String
    Link: fileName,            // String (original filename)
    Attachment: filePath       // String (PATH from Files API, e.g., "/filename.jpg")
    // NO ServiceID - this field DOES NOT EXIST
  })
});
```

**Key Points - NEVER FORGET:**
- **Attachment field stores a PATH STRING**, not the actual file
- **Files go to Files API first**, then the path goes in the database
- **Never try to PUT file directly to Attachment field** - this does not work
- **Never use base64** for the Attachment field
- **Never send ServiceID** - this field does not exist in Attach table
- **The working implementation is in `twoStepUploadForAttach` method**

**Viewing files:**
- Use `/files/path?filePath=${encodedPath}` endpoint to retrieve files
- The getAttachmentWithImage method handles this correctly

### 4. UI/UX RULES
- **Green color ONLY in Required Documents table** - never in service selector
- Service selections must persist when leaving/returning to page
- No unnecessary delays or "waiting for verification" messages
- Services are created instantly - use real IDs immediately

### 5. GIT COMMIT RULES
- Always commit with clear message about what was fixed
- Include the robot emoji and co-author line:
```
🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 6. TESTING COMMANDS
- Run lint: `npm run lint`
- Run typecheck: `npm run typecheck` (if available)
- Build: `npm run build`

### 7. COMMON ISSUES TO AVOID
- Don't add fields that don't exist in Caspio tables
- Don't use ServiceID for attachments (it doesn't exist)
- Don't use OffersID when creating services (Services table doesn't have it)
- Don't create temporary IDs - Caspio returns real IDs instantly
- Don't remove confirmation popups without user request

### 8. PROJECT SPECIFICS
- Company: Noble Property Inspections (CompanyID: 1)
- Main tables: Projects, Services, Attach, Offers, Types, Templates
- Navigation: /tabs/active-projects, /project/:id, /template-form/:projectId/:offersId

## REMEMBER: UPDATE THE VERSION HEADER EVERY TIME!
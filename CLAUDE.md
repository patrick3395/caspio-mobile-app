# IMPORTANT REMINDERS FOR CLAUDE

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

### 3. FILE UPLOAD METHOD (WORKING - DO NOT CHANGE)
- **Two-step process that WORKS**:
  1. Upload file to Caspio Files API: PUT to `/files` with FormData
  2. Create Attach record with file path: POST to `/tables/Attach/records` with path in Attachment field
- **Important field mappings**:
  - ProjectID: Use `project.ProjectID` NOT `project.PK_ID` or route ID
  - TypeID: From the service type
  - Title: Document title
  - Link: Filename (stored automatically)
  - Attachment: File path from Files API (e.g., `/filename.jpg`)
- **Files API returns**: `{ Name: "filename.jpg" }` - use this for the path
- **Viewing files**: Use getAttachmentWithImage to fetch from `/files/path` endpoint
- **Multiple uploads**: Filter attachments by TypeID and Title to find all files
- NO ServiceID field in Attach table - never send it

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
# IMPORTANT REMINDERS FOR CLAUDE

## 🚨 CRITICAL - NEVER CHANGE THE FILE UPLOAD METHOD 🚨
**THE FILE UPLOAD METHOD BELOW IS TESTED AND WORKING. DO NOT MODIFY IT UNDER ANY CIRCUMSTANCES.**

## 🚨 CRITICAL - THIS IS A MOBILE APP, NOT A WEB APP 🚨
**THIS IS A NATIVE iOS/ANDROID MOBILE APPLICATION, NOT A WEB APPLICATION**
- User has NO browser console access - debugging must be visible in the UI
- All debug statements MUST include a "Copy Debug Info" button for sharing
- Use `await this.showToast('Debug: ' + message, 'info')` for quick debug output
- Use AlertController with copy button for detailed debug information:
  ```typescript
  const debugText = `Debug Info:\n${details}`;
  const alert = await this.alertController.create({
    header: 'Debug Info',
    message: htmlFormattedMessage,
    buttons: [
      { text: 'Copy Debug Info', handler: () => { /* copy logic */ } },
      { text: 'OK', role: 'cancel' }
    ]
  });
  ```
- NEVER rely on console.log alone - user cannot see it
- Always provide fallback clipboard methods for WebView compatibility

## CURRENT APP STATE (as of December 2024)

### ✅ Working Features:
- **Photo Upload System**: Complete photo upload to Services_Visuals_Attach using VisualID
- **Multi-Photo Capture Loop**: Native iOS file picker + automatic "Take Another Photo" prompt after single photo
- **Native iOS Photo Selection**: Uses native file picker (Photo Library, Take Photo, Choose File)
- **Custom Visual Comments**: Add custom visuals with photos directly in creation popup
- **Photo Annotation System**: Full annotation with drawing tools (pen, arrows, circles, rectangles, text)
- **Photo Previews**: Working for all sections (Comments, Limitations, Deficiencies)
- **Photo Viewer**: Modal-based viewer without popup blockers
- **Engineers Foundation Template**: Complete visual selection and management
- **Floating Back-to-Top Button**: Smart detection of current section/accordion for precise navigation
- **Section Accordion Navigation**: Scrolls to expanded accordion headers (e.g., Basements) not just main sections
- **iOS Build**: Proper permissions (NSPhotoLibraryUsageDescription, NSCameraUsageDescription)
- **Appflow Deployment**: Auto-adds iOS platform if missing, sets build numbers
- **Angular Build Budgets**: Increased to 40KB for component styles to accommodate Engineers Foundation page

### 📦 Key Components:
- **PhotoAnnotatorComponent**: Canvas-based annotation with touch support
- **PhotoViewerComponent**: Modal photo viewer
- **Engineers Foundation Page**: Visual management with photo uploads

### 🔧 Services & APIs:
- **Services_Visuals**: Uses VisualID (NOT PK_ID) for foreign key
- **Services_Visuals_Attach**: VisualID links to photos
- **Response Format**: Always use `?response=rows` to get created records

## CRITICAL RULES - NEVER BREAK THESE

### 1. VERSION UPDATES
**ALWAYS** update ALL THREE version locations before commits:

1. **package.json version:**
   - Location: `/mnt/c/Users/Owner/Caspio/package.json`
   - Current: 1.4.80+
   - Format: Major.Minor.Patch
   
2. **Active Projects page version (MAIN VERSION TO UPDATE):**
   - Location: `/mnt/c/Users/Owner/Caspio/src/app/pages/active-projects/active-projects.page.ts`
   - Look for: `appVersion = '1.4.XX'; // Update this to match package.json version`
   - This shows in the banner: "Version X.X.XX - Company Debug Mode"
   - THIS IS THE MAIN VERSION USERS SEE
   
3. **Engineers Foundation page header (optional):**
   - Location: `/mnt/c/Users/Owner/Caspio/src/app/pages/engineers-foundation/engineers-foundation.page.html`
   - Look for: `<div class="version-header">Version X.X.XX`
   - Update with brief description of changes

### 2. 🔒 FILE UPLOAD METHOD (PROVEN WORKING - NEVER CHANGE!)
**⚠️ WARNING: This method is confirmed working. DO NOT MODIFY! ⚠️**

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

### 3. SERVICES_VISUALS CRITICAL POINTS:
- **Use VisualID from response**, NOT PK_ID
- **Services_Visuals_Attach** requires VisualID (integer)
- **Text field** is included for visual descriptions
- **Always check response?.VisualID first**, then fallback to PK_ID

### 4. PHOTO ANNOTATION:
- **PhotoAnnotatorComponent** is standalone with FormsModule
- **Drawing tools**: pen, arrow, rectangle, circle, text
- **Touch support** for mobile devices
- **Single photos** get annotation option, batch uploads skip it
- **Saves as JPEG** at 0.9 quality

### 5. iOS BUILD CONFIGURATION:
- **Build number** in `ios-build-config.json`
- **Permissions** auto-added by `scripts/set-ios-permissions.js`
- **Platform** auto-created by `appflow-ios-build.js` if missing
- **Increment build number** for each App Store submission

### 6. CASPIO TABLE STRUCTURE:
```
Attach Table:
- AttachID, ProjectID, TypeID, Title, Notes, Link, Attachment
- NO ServiceID field

Services Table:
- ProjectID, TypeID, DateOfInspection
- NO OffersID field

Services_Visuals:
- VisualID (primary key)
- ServiceID, Category, Kind, Name, Text, Notes

Services_Visuals_Attach:
- VisualID (foreign key)
- Annotation, Photo
```

### 7. UI/UX RULES:
- **Green color** ONLY in Required Documents table
- **Service selections** persist when navigating
- **No temp IDs** - Caspio returns real IDs instantly
- **Photo previews** show immediately after upload
- **Debug popups** removed for production

### 8. GIT COMMIT RULES:
```bash
git commit -m "Brief description of changes

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 9. TESTING COMMANDS:
```bash
npm run lint          # Check code style
npm run build         # Build for production
npm run build:ios-local  # Local iOS build with platform creation
```

### 10. COMMON PITFALLS TO AVOID:
- ❌ Don't use ServiceID for attachments (doesn't exist)
- ❌ Don't use OffersID for services (doesn't exist)
- ❌ Don't use PK_ID for Services_Visuals foreign keys (use VisualID)
- ❌ Don't modify file upload method (it works perfectly)
- ❌ Don't send base64 to Attachment field (use file path)
- ❌ Don't forget FormsModule for components using ngModel
- ❌ Don't create temp IDs (Caspio returns real ones instantly)
- ❌ Don't use console.log for debugging (user is on mobile - use toasts/alerts)
- ❌ Don't create custom action sheets for photo selection (use native iOS picker)
- ❌ Don't send RoomName when creating Services_Rooms (only send ServiceID)
- ❌ Don't call methods uploadPhotoToVisual (correct: uploadPhotoForVisual)

### 11. PROJECT SPECIFICS:
- **Company**: Noble Property Inspections (CompanyID: 1)
- **Main Tables**: Projects, Services, Attach, Offers, Types, Templates
- **Navigation**: /tabs/active-projects, /project/:id, /template-form/:projectId/:offersId
- **Live Updates**: appId: 1e8beef6

### 12. RECENT UI/UX IMPROVEMENTS (Version 1.3.80+):
- **Multi-Photo Loop**: When user takes single photo via native iOS picker, automatically prompts "Take Another Photo" or "Done"
- **Native iOS File Picker**: Removed custom action sheets - uses native iOS popup for photo selection
- **Compact Photo Selector**: Orange-text iOS-style alerts for photo continuation
- **Smart Scroll Navigation**: Floating button detects current accordion/room and scrolls to appropriate header
- **Elevation Room Headers**: Show PointCount from Services_Rooms_Templates
- **No Success Toasts**: Removed green success messages when adding visuals for cleaner UX
- **Action Sheet Auto-Dismiss**: Photo selection popups dismiss immediately after selection

### 13. CURRENT FOCUS AREAS:
- ✅ Photo uploads working perfectly
- ✅ Custom visuals with inline photo option
- ✅ Photo annotation system complete
- ✅ iOS deployment configuration fixed
- ✅ Native iOS UI integration for photo selection
- 🔧 Accordion scroll detection (improved but may need refinement)
- 🔧 SCSS file size optimization (increased budget to 40KB)

## REMEMBER: INCREMENT VERSION IN PACKAGE.JSON FOR EVERY MEANINGFUL CHANGE!

## 14. OMNARA INTEGRATION SETUP:
**OMNARA API KEY AND COMMANDS FOR MOBILE ACCESS**

### Omnara API Key (Updated Dec 2024):
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMjdkNGNlNi02OWJjLTQxOGMtYmU0NC0wZDIyOWFkZDViZjciLCJpYXQiOjE3NTY0MTEzMjB9.7zs-JQwE7-WbTjYQp2LNN-O2uBAMj5IIerXGiMtVZsyX24heNACzkEl14_Ejg1skDCxgyxfakUM7TwZg23xYgA
```

### Commands to Start Omnara Session:

**WORKING COMMAND - Start Omnara session (connects to phone app):**
```bash
./omnara_env/bin/omnara --api-key "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMjdkNGNlNi02OWJjLTQxOGMtYmU0NC0wZDIyOWFkZDViZjciLCJpYXQiOjE3NTY0MTEzMjB9.7zs-JQwE7-WbTjYQp2LNN-O2uBAMj5IIerXGiMtVZsyX24heNACzkEl14_Ejg1skDCxgyxfakUM7TwZg23xYgA"
```
This creates an interactive Claude Code session that alerts your Omnara phone app and allows control from your phone.

3. **Check Omnara server status:**
```bash
ps aux | grep omnara
```

4. **Install/Update Omnara if needed:**
```bash
./omnara_env/bin/pip install --upgrade omnara
```

### Server Details:
- **Local Port**: 6662 (http://localhost:6662)
- **Tunnel**: Cloudflare tunnel auto-created when not using --no-tunnel flag
- **Mobile Access**: Use tunnel URL provided in server output

## 15. CURRENT WORK (December 2024 - v1.4.165):
- **Template Navigation**: Fixed issue where template required 3 clicks to open
- **Room Selection**: Fixed checkbox state management when canceling room deletion  
- **FDF Dropdown**: Using Services_Rooms_Drop table with Dropdown column for FDF options
  - Room-specific options: Checks RoomName field for room-specific dropdowns
  - FDF options: Falls back to rows where RoomName='FDF' for default options
- **Replace Photo**: Added to project detail page with debug popups
  - Updates Projects table PrimaryPhoto column
  - Shows project ID being updated in debug popup
- **Room Numbering**: Automatic #1, #2 numbering for duplicate room names
- **Photo Upload**: All uploads use proven method from section 2 above
- **PDF Viewer TEST Header**: Added red TEST banner to document viewer component (v1.4.163) to verify correct component is being edited for mobile app deployment
- **Support Documents Preview**: Added document preview with thumbnails for PDFs, images, and documents. Click-to-view functionality opens in modal viewer. Fixed build error by using getAttachmentWithImage instead of non-existent getAttachmentDetails
- **PDF Preview TEST Header**: Added red TEST banner to the Engineers Foundation PDF preview component (v1.4.164) - the one that generates the actual PDF report with all visual data and elevation plots
- **Elevation Plot Redesign**: Completely redesigned Elevation Plot section to match Structural Systems format (v1.4.165)
  - Each room is now displayed as an accordion box like visual categories
  - Sections within each room: Inputs (FDF), Points (with photos), and Notes
  - Consistent styling with type-headers and visual-item-containers
  - Photo previews match the Structural Systems image preview format
  - Camera button styling matches the orange theme throughout
- whenever you compact read Claude.md. After every command I give you update CLAUDE.md to track where we are at with the app building process.
- whenever a new claude session is started in this project read CLAUDE.MD
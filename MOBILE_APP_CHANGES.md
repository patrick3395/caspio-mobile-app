# Mobile App Changes - Version 1.1.22

## Latest Updates (2025-01-20)

### Version 1.1.22 - Document Table Redesign
1. **Document Table UI Improvements**
   - Removed Status column - cleaner 3-column layout
   - Uploaded documents now show in green text for instant visual feedback
   - Fixed content overflow with proper text truncation
   - Status shown as small badge next to document name (Required/Optional)
   - Remove link positioned inline for optional documents

2. **Document Upload Fixes**
   - Enhanced validation for integer IDs before upload
   - Improved AttachID retrieval after record creation
   - Better error handling and detailed logging
   - Fixed Files API endpoint communication issues

### Version 1.1.21 - Layout Fixes
1. **Document Table Layout**
   - Resolved table bleeding off screen with responsive grid columns
   - Implemented flexible column widths using CSS minmax() function
   - Service column now properly spans multiple document rows
   - Improved visual hierarchy with extended background for service names

2. **Project Creation & Navigation**
   - Fixed navigation to project details page after creation
   - Added retry logic to ensure newly created projects are found
   - Better handling of project ID retrieval

3. **Code Improvements**
   - Fixed missing RxJS operators (of, tap) import
   - Enhanced error handling in project search logic

## Previous Critical Fixes (Version 1.1.20)
- StateID issue resolved - now correctly sends numeric IDs instead of abbreviations
- State dropdown shows "--Select--" as default with proper validation
- Google Places autocomplete properly maps states to StateID values
- Live Updates unpack error fixed by removing automatic resetConfig calls

## Key Features Working
- Project creation with proper Caspio field mapping
- Document upload and management
- Service selection with inspection dates
- Google Places address autocomplete
- Live Updates via Ionic Appflow
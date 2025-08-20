# Mobile App Changes - Version 1.1.21

## Latest Updates (2025-01-20)

### Fixed Issues
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
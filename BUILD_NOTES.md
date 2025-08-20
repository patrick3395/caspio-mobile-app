# Build Notes for Caspio Mobile App

## Version 1.1.20 - 2025-01-20
### Fixed
- **Build Errors**:
  - Fixed TypeScript error by allowing null in state type
  - State can now be number, string, or null
  - Optimized SCSS by removing comments
  - Reduced CSS file size to meet budget requirements

---

## Version 1.1.19 - 2025-01-20
### Fixed
- **State Dropdown Improvements**:
  - Added "--Select--" as default option (no pre-selected state)
  - State field now required - must be selected
  - No default to Texas - user must explicitly select
  - Added validation for StateID before creating project
- **Google Places Autocomplete**:
  - Properly fills state dropdown when address is selected
  - Maps state abbreviation to StateID
  - Forces Angular to update select element
  - Enhanced logging for state matching

---

## Version 1.1.18 - 2025-01-20
### Fixed
- **Document Table Strict Alignment**:
  - Complete rewrite using display: table for strict cell structure
  - Fixed column widths: Service 25%, Document 35%, Status 15%, Actions 25%
  - Table-row and table-cell display for proper alignment
  - Border-collapse for clean borders
- **Document Upload Fix**:
  - Ensure all IDs (ProjectID, TypeID, ServiceID) are integers
  - Added data type verification logging
  - Default title to 'Document' if empty
- **State Dropdown**:
  - Shows only abbreviations (TX, GA, FL) not full names
  - State data already contains just abbreviations

---

## Version 1.1.17 - 2025-01-20
### Fixed
- **StatusID and Navigation**:
  - StatusID now set to 1 (Active status) as required
  - Added StatusID to verification logging
  - Fixed navigation to project details page after creation
  - Enhanced navigation logging
  - All integer IDs verified (CompanyID, StateID, UserID, StatusID)

---

## Version 1.1.16 - 2025-01-20
### Fixed
- **Set OffersID and Fee to NULL**:
  - OffersID now set to null instead of 1
  - Fee now set to null instead of 265.00
  - StateID verified as integer with extra logging
  - Added integer verification checks for StateID
  - Updated debug output to show NULL values

---

## Version 1.1.15 - 2025-01-20
### Fixed - CRITICAL FIXES
- **StateID Now Sent as Number**:
  - State dropdown value is now StateID as number (not string)
  - Fixed form to handle state as number throughout
  - Service properly converts to integer if needed
  - Default state (Texas) set as number 1
  - Google Places autocomplete sets state as number
- **Document Table Strict Alignment**:
  - Complete rewrite of document table CSS
  - Strict grid structure with 4 columns maintained
  - All rows have proper cell structure
  - Service name only visible on first row
  - Add Document link properly positioned

---

## Version 1.1.14 - 2025-01-20
### Fixed
- **Live Updates Issue**:
  - Removed automatic resetConfig() calls that were causing corruption message
  - No longer resets configuration on startup
  - Simplified "no update available" message
  - Better handling of corrupted updates without resetting
  - Cleaner user messages for update status

---

## Version 1.1.13 - 2025-01-20
### Fixed
- **Table Alignment Issues**:
  - Fixed Date header alignment in services table (now properly centered)
  - Fixed document rows misalignment in required documents table
  - Documents now properly grouped under their service
  - Improved grid layout with proper spacing
  - Service names only show on first document row
  - Add Document link properly positioned
  - Enhanced CSS specificity for better alignment control

---

## Version 1.1.12 - 2025-01-20
### Fixed - CRITICAL DATA TYPE FIXES
- **Match Exact Caspio Table Schema**:
  - Date field now sends DateTime format (MM/DD/YYYY HH:MM:SS)
  - StateID confirmed as Integer type
  - CompanyID, UserID, OffersID all sent as Integers
  - Added required Date field with current datetime
  - InspectionDate also formatted as DateTime
  - Fee sent as Currency type (decimal)
  - All Text fields properly sized (255 chars)
  - Matches exact column structure from Projects table

---

## Version 1.1.11 - 2025-01-20
### Added
- **Enhanced Debug Logging for Project Creation**:
  - Shows exact Caspio table name and API endpoint
  - Lists all column headers with their values and data types
  - Indicates which fields are required vs optional
  - Shows full JSON payload being sent
  - Enhanced error analysis with possible issues
  - Lists what was attempted vs what Caspio expected
  - Helps identify field mapping issues

---

## Version 1.1.10 - 2025-01-20
### Fixed
- **Document Table Alignment**:
  - Fixed documents showing on wrong lines under services
  - Documents now properly grouped under their associated service
  - Removed `display: contents` CSS that was breaking grid layout
  - Service name now shows only on first document row
  - Fixed grid structure for proper column alignment
  - Add Document link properly positioned

---

## Version 1.1.9 - 2025-01-20
### Fixed
- **State Dropdown & Autocomplete**:
  - State dropdown now shows only abbreviations (TX, GA, FL, etc.)
  - Dropdown properly submits StateID (1, 2, 3...) to Caspio
  - Google Places autocomplete correctly fills state field with StateID
  - Default state set to Texas (StateID: 1)
  - Added enhanced logging for state matching
  - Removed duplicate getStateName function
  - Fixed resetConfig method (was using non-existent reset method)

---

## Version 1.1.8 - 2025-01-20
### Fixed
- **Live Updates Unpack Error**:
  - Fixed "failure occurred during the unpack step" error
  - Added automatic reset for corrupted updates
  - Refresh button now prioritizes project refresh over live updates
  - Live update check runs in background without blocking refresh
  - Added better error handling with non-critical failures
  - Auto-reset and recovery when File Manager Error occurs

---

## Version 1.1.7 - 2025-01-20
### Fixed
- **Document Upload Issues**:
  - Fixed document title showing in wrong column (removed doc-col classes)
  - Fixed "Add Document" row spanning correct columns
  - Document upload now uses caspioService.uploadFileToAttachment method
  - Added ServiceID to attachment records for proper association
  - Better error handling for AttachID retrieval
  - Added console logging for debugging upload process
- **Improved File Upload**:
  - Uses existing service method with proper authentication
  - Handles AttachID/PK_ID from response correctly
  - Better error messages

---

## Version 1.1.6 - 2025-01-20
### Fixed - CRITICAL FIX
- **StateID Issue - Root Cause of 400 Error**:
  - Now loads states from Caspio States table
  - State dropdown uses StateID (numeric) as value
  - Google Places autocomplete maps state abbreviation to StateID
  - Project creation sends StateID (1,2,3...) not abbreviation (TX,GA,FL...)
  - This was the root cause of the 400 error!
- **State Dropdown**:
  - Shows "TX - Texas" format for clarity
  - Default to Texas (StateID: 1)
  - Fallback to hardcoded states if API fails

---

## Version 1.1.5 - 2025-01-20
### Fixed
- **Table Alignment Issues**:
  - Date header now properly centered with forced centering CSS
  - Documents table columns properly aligned
  - Removed unnecessary doc-col classes for proper grid layout
  - Added Cubicasa service document mapping (Floor Plan, 3D Model, Measurements)
- **UI Improvements**:
  - Upload buttons already present for service documents
  - Better document status badges

---

## Version 1.1.4 - 2025-01-20
### Added
- **Enhanced Debugging for 400 Error**:
  - Shows each field name, value, and data type being sent
  - Displays full JSON payload
  - Shows failed request data in error handler
  - Displays Caspio's specific error message if available
  - Better formatted console output with separators

---

## Version 1.1.3 - 2025-01-20
### Fixed
- **UI Improvements**:
  - **Date Column Alignment**: Centered date header and date inputs in services table
  - **Service Removal Fix**: 
    - Fixed service removal when serviceId is temporary
    - Still removes from UI even if Caspio delete fails
    - Better error handling with fallback behavior
  - Added debug logging for service operations

---

## Version 1.1.2 - 2025-01-20
### Fixed
- **Project Creation 400 Error - Attempt 2**:
  - Simplified payload to essential fields only
  - Address validation to ensure it's not empty
  - StateID must be numeric (1 for TX, etc.)
  - Fee as decimal 265.00
  - Removed Date field (might be auto-generated)
  - Added CompanyID, StatusID, UserID back
  - Optional fields only added if they have values

---

## Version 1.1.1 - 2025-01-20
### Fixed
- **Project Creation 404/400 Errors**: Fixed by including ALL required fields per Caspio table
  - Required fields (marked with * in Caspio):
    - `Address`: Street address (required)
    - `StateID`: Numeric state ID (required - TX=1, GA=2, etc.)
    - `OffersID`: Service type ID (required - default 1)
    - `Fee`: Service fee (required - default 265.00)
  - Additional fields:
    - `CompanyID`: 1 (Noble Property Inspections)
    - `StatusID`: 1 (Active)
    - `UserID`: 1 (Default user)
    - `City`, `Zip`: Optional location fields
    - `InspectionDate`: MM/DD/YYYY format
  - Fixed StateID to use numeric values instead of abbreviations
  - Enhanced logging shows full URL and token status
  - Updated purple header to Version 1.1.1

### Changes Required for Deployment
- **iOS Build Number**: Increment build number in Xcode before uploading to TestFlight
- **Android Version Code**: Increment versionCode in build.gradle before release
- **Live Updates Channel**: Currently set to "Caspio Mobile App" in capacitor.config.ts

### Known Issues to Monitor
- Verify that new projects appear in Caspio Projects table after creation
- Ensure StateID mapping is correct for all states (TX=1, GA=2, FL=3, CO=4, CA=6, AZ=7, SC=8, TN=9)

---

## Version 1.1.0 - Previous Build
### Added
- Live Updates implementation with @capacitor/live-updates
- New Project page with City/State/Zip fields
- Google Places autocomplete for address
- Project Details service display and date editing
- Document management system

### Fixed
- Services showing "Unknown Service" 
- Date display formatting
- Autocomplete dropdown not closing
- Document table alignment
- Service sorting (alphabetical with "Other" at bottom)
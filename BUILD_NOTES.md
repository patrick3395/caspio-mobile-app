# Build Notes for Caspio Mobile App

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
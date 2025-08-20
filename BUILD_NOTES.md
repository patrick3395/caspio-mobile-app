# Build Notes for Caspio Mobile App

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
# Build Notes for Caspio Mobile App

## Version 1.1.1 - 2025-01-20
### Fixed
- **Project Creation 400 Error**: Simplified to match browser implementation
  - Sending minimal required fields only:
    - `CompanyID`: 1 (Noble Property Inspections)
    - `Address`: Street address
    - `City`: City name
    - `State`: State abbreviation (e.g., "TX")
    - `Zip`: Zip code
    - `InspectionDate`: MM/DD/YYYY format
  - Fixed date format to MM/DD/YYYY (Caspio's expected format)
  - Enhanced error logging with full error details
  - Updated purple header to show current version

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
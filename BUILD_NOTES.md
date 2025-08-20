# Build Notes for Caspio Mobile App

## Version 1.1.1 - 2025-01-20
### Fixed
- **Project Creation Not Saving to Caspio**: Fixed issue where projects were not being saved to database
  - Added ALL required fields to match browser version exactly:
    - `CompanyID`: 1 (Noble Property Inspections)
    - `UserID`: 1 (Default user)
    - `StatusID`: 1 (Active status)
    - `StateID`: Numeric ID mapped from state abbreviation
    - `Fee`: 265.00 (Default fee)
    - `OffersID`: 1 (Default service)
  - Enhanced logging to show response headers and body
  - Improved error tracking for debugging

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
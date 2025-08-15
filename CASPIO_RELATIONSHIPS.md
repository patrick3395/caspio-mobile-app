# Caspio Database Relationships Documentation

## Table Structure Overview

### Main Tables

#### Projects (Central Hub)
- **PK_ID** - Primary Key
- **ProjectID** - Project identifier
- **CompanyID** → Companies.CompanyID
- **UserID** → Users.UserID
- **OffersID** → Offers.PK_ID (determines service type)
- **StateID** → States.StateID
- **StatusID** - Project status (1 = Active)
- **Address**, **City**, **Zip** - Location details
- **Date**, **InspectionDate** - Timing
- **Fee**, **AmountDue** - Financial

#### Service_EFE (Engineer's Foundation Evaluation)
- **ServiceID** - Primary Key
- **ProjectID** → Projects.PK_ID
- Contains service-specific evaluation data

#### Service_EFE_Rooms
- **RoomID** - Primary Key (assumed)
- **ServiceID** → Service_EFE.ServiceID
- Room-specific inspection data fields

#### Service_EFE_Structural
- **StructuralID** - Primary Key (assumed)
- **ServiceID** → Service_EFE.ServiceID
- Structural evaluation data

#### Service_HESP
- **ServiceID** - Primary Key
- **ProjectID** → Projects.PK_ID
- Different service type data

### Supporting Tables

#### Companies
- **CompanyID** - Primary Key
- **CompanyName**
- Related company information

#### Users
- **UserID** - Primary Key
- **UserName**
- User account details

#### Offers
- **PK_ID** - Primary Key
- **OffersID** - Offer identifier
- **Service_Name** - Name of service
- **CompanyID** → Companies.CompanyID
- Service-specific offerings per company

#### States
- **PK_ID** - Primary Key
- **StateID** - State identifier
- **State** - Full state name
- **StateAbbreviated** - State code (e.g., TX)

## Data Flow for Template System

### 1. Project Creation
When creating a new project:
1. Insert into **Projects** table with:
   - CompanyID (from selected company)
   - UserID (from selected user)
   - OffersID (from selected service type)
   - StateID (from address state)
   - Address details
   - Dates and fees

### 2. Service Record Creation
Based on the OffersID/Service Type:
- If Engineer's Foundation Evaluation → Create **Service_EFE** record
- If HESP service → Create **Service_HESP** record
- Link using ProjectID from step 1

### 3. Detail Records Creation
For Service_EFE:
- Create multiple **Service_EFE_Rooms** records (one per room inspected)
- Create **Service_EFE_Structural** records as needed
- All linked via ServiceID from step 2

## Template Form Sections Mapping

### Information Section
#### General Subsection
- Company → Projects.CompanyID
- User → Projects.UserID
- Date of Request → Projects.Date
- Inspection Date → Projects.InspectionDate

#### Information Subsection
- Address → Projects.Address
- City → Projects.City
- State → Projects.StateID
- Zip → Projects.Zip
- Service Type → Projects.OffersID
- CalCities ID → Projects.CubicasaID (if applicable)

#### Foundation Subsection
- Will populate Service_EFE table fields
- Foundation Type → Service_EFE.[appropriate field]
- Foundation Condition → Service_EFE.[appropriate field]
- Foundation Notes → Service_EFE.[appropriate field]

### Structural Systems Section
- Will populate Service_EFE_Structural table
- Multiple records may be created
- Each linked to Service_EFE via ServiceID

### Elevation Plot Section
- Will populate specific Service_EFE fields or
- Create Service_EFE_Rooms records for room-by-room data

## Implementation Notes

1. **Transaction Flow**: 
   - Create Project first, get PK_ID
   - Create Service record, get ServiceID
   - Create detail records using ServiceID

2. **Service Type Detection**:
   - Use OffersID to determine which service tables to populate
   - Different forms/fields based on service type

3. **Data Validation**:
   - Ensure CompanyID exists in Companies
   - Ensure UserID exists in Users
   - Ensure StateID exists in States
   - Ensure OffersID exists in Offers

4. **Room Data Collection**:
   - Service_EFE_Rooms allows multiple room entries per service
   - Each room gets its own record with same ServiceID
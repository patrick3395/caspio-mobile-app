const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8100;
const HOST = '0.0.0.0';

// Read Caspio credentials from environment file
const fs = require('fs');
let caspioConfig = {};

try {
  const envContent = fs.readFileSync('src/environments/environment.ts', 'utf8');
  const clientIdMatch = envContent.match(/clientId:\s*'([^']+)'/);
  const clientSecretMatch = envContent.match(/clientSecret:\s*'([^']+)'/);
  
  if (clientIdMatch && clientSecretMatch) {
    caspioConfig.clientId = clientIdMatch[1];
    caspioConfig.clientSecret = clientSecretMatch[1];
  }
} catch (err) {
  console.error('Could not read Caspio credentials:', err.message);
}

let accessToken = null;
let tokenExpiry = null;

// Function to get Caspio access token
async function getCaspioToken() {
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
    return accessToken;
  }

  return new Promise((resolve, reject) => {
    const postData = `grant_type=client_credentials&client_id=${caspioConfig.clientId}&client_secret=${caspioConfig.clientSecret}`;
    
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            accessToken = response.access_token;
            tokenExpiry = new Date(Date.now() + (response.expires_in * 1000));
            console.log('✅ Authenticated with Caspio');
            resolve(accessToken);
          } else {
            reject(new Error('No access token received'));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Function to fetch service types from Types table
async function fetchServiceTypes() {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/Type/records',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`📋 Fetched ${response.Result ? response.Result.length : 0} service types`);
          resolve(response.Result || []);
        } catch (err) {
          console.error('Error parsing types:', err);
          resolve([]);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error fetching types:', err);
      resolve([]);
    });
    req.end();
  });
}

// Helper function to create Services record
async function createServicesRecord(projectId) {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    const serviceData = {
      ProjectID: projectId
    };
    
    const postData = JSON.stringify(serviceData);
    
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/Services/records',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          console.log('✅ Services record created for project:', projectId);
          try {
            const response = data ? JSON.parse(data) : {};
            resolve(response);
          } catch (e) {
            resolve({ success: true });
          }
        } else {
          console.error('❌ Failed to create Services record:', res.statusCode, data);
          resolve(null); // Don't reject, just log error
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error creating Services record:', err);
      resolve(null); // Don't reject, just log error
    });

    req.write(postData);
    req.end();
  });
}

// Helper function to convert state abbreviation to StateID
function getStateIDFromAbbreviation(stateAbbr) {
  // Based on the States table data we fetched:
  const stateMapping = {
    'TX': 1,    // Texas
    'GA': 2,    // Georgia
    'FL': 3,    // Florida
    'CO': 4,    // Colorado
    'CA': 6,    // California
    'AZ': 7,    // Arizona
    'SC': 8,    // South Carolina
    'TN': 9     // Tennessee
  };
  
  const stateID = stateMapping[stateAbbr?.toUpperCase()];
  console.log(`🗺️ Converting state '${stateAbbr}' to StateID: ${stateID || 'NOT FOUND'}`);
  
  return stateID || null;
}

// Function to create a new project in Caspio
async function createProject(projectData) {
  const token = await getCaspioToken();
  
  console.log('🔍 Raw project data received:', projectData);
  
  // First, let's fetch a sample project to see what fields are expected
  try {
    const sampleProjects = await fetchActiveProjects();
    if (sampleProjects && sampleProjects.length > 0) {
      console.log('📋 Sample existing project data:', JSON.stringify(sampleProjects[0], null, 2));
      console.log('🔑 Required fields from sample:', {
        ProjectID: sampleProjects[0].ProjectID,
        CompanyID: sampleProjects[0].CompanyID,
        UserID: sampleProjects[0].UserID,
        StatusID: sampleProjects[0].StatusID,
        OffersID: sampleProjects[0].OffersID,
        Fee: sampleProjects[0].Fee,
        Date: sampleProjects[0].Date,
        InspectionDate: sampleProjects[0].InspectionDate
      });
    }
  } catch (err) {
    console.log('Could not fetch sample project:', err.message);
  }
  
  // Save original data for later lookup
  const originalAddress = projectData.address;
  const originalCity = projectData.city;
  const originalDate = new Date().toISOString().split('T')[0];
  
  // Convert state abbreviation to StateID if provided
  let stateID = 1; // Default to TX
  if (projectData.state) {
    stateID = getStateIDFromAbbreviation(projectData.state) || 1;
  }
  
  // Map form fields to Caspio - matching EXACT field names and types from table
  const caspioData = {
    // DO NOT include ProjectID - it's Autonumber (auto-generated)
    CompanyID: 1, // Integer type
    StatusID: 1, // Integer type - 1 = Active
    UserID: 1, // Integer type
    // OffersID: null, // Commented out - let them select services after project creation
    // CubicasaID is optional Integer, leave it out
    // Icon is Attachment type, leave it out
    Address: originalAddress || '', // Text(255)
    City: originalCity || '', // Text(255)
    StateID: stateID, // Integer type
    Zip: projectData.zip || '', // Text(255)
    Date: new Date().toISOString(), // DateTime type - use full ISO string
    InspectionDate: projectData.inspectionDate ? new Date(projectData.inspectionDate).toISOString() : new Date().toISOString() // DateTime
    // Don't send null values or fields that don't exist in the table
  };
  
  console.log('📤 Data being sent to Caspio (with converted StateID):', caspioData);
  
  const postData = JSON.stringify(caspioData);
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/Projects/records',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        console.log('📥 Response from Caspio:', data);
        console.log('📊 Response status:', res.statusCode);
        
        if (!data || res.statusCode === 201) {
          console.log('✅ Project created successfully (201 status)');
          // After successful creation, fetch the latest project to get its PK_ID
          // Projects are sorted by PK_ID descending by default
          const latestProjects = await fetchActiveProjects();
          console.log('🔍 Looking for project with:', {
            address: originalAddress,
            city: originalCity,
            date: originalDate
          });
          
          if (latestProjects && latestProjects.length > 0) {
            // Log first few projects for debugging
            console.log('📋 Latest projects:', latestProjects.slice(0, 3).map(p => ({
              PK_ID: p.PK_ID,
              Address: p.Address,
              City: p.City,
              Date: p.Date
            })));
            
            // Find the project we just created - get the one with highest PK_ID matching our address
            const matchingProjects = latestProjects.filter(p => 
              p.Address === originalAddress && 
              p.City === originalCity
            );
            
            if (matchingProjects.length > 0) {
              // Sort by PK_ID descending and get the first (newest)
              const newProject = matchingProjects.sort((a, b) => b.PK_ID - a.PK_ID)[0];
              console.log('📍 Found new project with PK_ID:', newProject.PK_ID);
              
              // Don't create Services record automatically - let user select services
              // Services will be added when user selects them in the project details page
              
              resolve({ success: true, message: 'Project created', projectId: newProject.PK_ID });
              return;
            } else {
              console.log('⚠️ No matching project found');
            }
          }
          resolve({ success: true, message: 'Project created' });
          return;
        }
        
        try {
          const response = JSON.parse(data);
          console.log('✅ Project created:', response);
          resolve(response);
        } catch (err) {
          console.error('Error parsing response:', err);
          console.error('Raw response:', data);
          // If it's a successful status code but unparseable, treat as success
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, message: 'Project created', raw: data });
          } else {
            reject(err);
          }
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Function to fetch a single project by ID
async function fetchProjectById(projectId) {
  const token = await getCaspioToken();
  
  // First, try to fetch all projects and find by index if projectId is a number
  if (!isNaN(projectId)) {
    const allProjects = await fetchActiveProjects();
    if (allProjects[projectId]) {
      console.log(`📋 Found project by index: ${projectId}`);
      return allProjects[projectId];
    }
  }
  
  return new Promise((resolve, reject) => {
    // Try different ID field names
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: `/rest/v2/tables/Projects/records?q.where=PK_ID%3D${projectId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const project = response.Result && response.Result[0];
          console.log(`📋 Fetched project details for ID: ${projectId}`);
          if (project) {
            console.log('✅ Project found:', JSON.stringify(project).substring(0, 200));
          } else {
            console.log('❌ No project found in response. Full response:', JSON.stringify(response).substring(0, 500));
          }
          resolve(project);
        } catch (err) {
          console.error('Error parsing project:', err);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error fetching project:', err);
      resolve(null);
    });
    req.end();
  });
}

// Function to fetch attachment templates from Caspio
async function fetchAttachTemplates() {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/Attach_Templates/records',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`📋 Fetched ${response.Result ? response.Result.length : 0} attachment templates`);
          resolve(response.Result || []);
        } catch (err) {
          console.error('Error parsing attachment templates:', err);
          resolve([]);
        }
      });
    });
    req.on('error', (err) => {
      console.error('Error fetching attachment templates:', err);
      resolve([]);
    });
    req.end();
  });
}

// Function to fetch offers from Caspio
async function fetchOffers(companyId = 1) {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    // Fetch offers for the specific company
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: `/rest/v2/tables/Offers/records?q.where=CompanyID%3D${companyId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`📋 Fetched ${response.Result ? response.Result.length : 0} offers for CompanyID ${companyId}`);
          resolve(response.Result || []);
        } catch (err) {
          console.error('Error parsing offers:', err);
          resolve([]);
        }
      });
    });
    req.on('error', (err) => {
      console.error('Error fetching offers:', err);
      resolve([]);
    });
    req.end();
  });
}

// Function to fetch states from Caspio
async function fetchStates() {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/States/records',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`🏛️ Fetched ${response.Result ? response.Result.length : 0} states from Caspio`);
          
          // Log first few states to understand StateID format
          if (response.Result && response.Result.length > 0) {
            console.log('📋 States table structure:');
            console.log('Sample state fields:', Object.keys(response.Result[0]));
            console.log('📊 All states data:');
            response.Result.forEach((state, index) => {
              console.log(`  ${index + 1}. PK_ID: ${state.PK_ID}, StateID: ${state.StateID}, State: ${state.State}, StateAbbreviated: ${state.StateAbbreviated}`);
            });
            
            // Look for common state entries to understand the format
            const commonStates = ['CA', 'TX', 'FL', 'NY'];
            console.log('🔍 Looking for common states by abbreviation:');
            commonStates.forEach(abbr => {
              const foundState = response.Result.find(state => 
                (state.StateAbbreviated === abbr) || 
                (state.State && state.State.toLowerCase().includes(
                  abbr === 'CA' ? 'california' : 
                  abbr === 'TX' ? 'texas' : 
                  abbr === 'FL' ? 'florida' : 
                  abbr === 'NY' ? 'new york' : ''
                ))
              );
              if (foundState) {
                console.log(`  ${abbr}: StateID = ${foundState.StateID}, PK_ID = ${foundState.PK_ID}, State = ${foundState.State}`);
              } else {
                console.log(`  ${abbr}: Not found in States table`);
              }
            });
            
            // Summary of StateID format
            console.log('\n📝 StateID Format Analysis:');
            console.log(`   - StateID appears to be numeric: ${response.Result.map(s => s.StateID).join(', ')}`);
            console.log(`   - PK_ID values: ${response.Result.map(s => s.PK_ID).join(', ')}`);
          }
          resolve(response.Result || []);
        } catch (err) {
          console.error('Error parsing states:', err);
          resolve([]);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error fetching states:', err);
      resolve([]);
    });
    req.end();
  });
}

// Function to fetch projects from Caspio
async function fetchActiveProjects() {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/Projects/records?q.where=StatusID%3D1',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`📊 Fetched ${response.Result ? response.Result.length : 0} active projects`);
          // Log first project to see available fields
          if (response.Result && response.Result.length > 0) {
            console.log('Sample project fields:', Object.keys(response.Result[0]));
          }
          resolve(response.Result || []);
        } catch (err) {
          console.error('Error parsing projects:', err);
          resolve([]);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error fetching projects:', err);
      resolve([]);
    });
    req.end();
  });
}

// Generate new project form HTML
async function generateNewProjectHTML() {
  const googleApiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
  const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
  
  // Fetch offers for Noble Property Inspections (CompanyID = 1)
  const offers = await fetchOffers(1);
  console.log('📊 Available offers:', offers.map(o => ({
    OffersID: o.OffersID || o.PK_ID,
    TypeID: o.TypeID,
    CompanyID: o.CompanyID,
    Description: o.Description || o.OfferName
  })));
  
  // Fetch service types to get names
  const serviceTypes = await fetchServiceTypes();
  
  // Match offers with service types to get the names
  const serviceCheckboxes = offers.map((offer, index) => {
    const serviceType = serviceTypes.find(t => t.TypeID === offer.TypeID);
    const serviceName = serviceType ? serviceType.TypeName : (offer.Description || offer.OfferName || `Service ${index + 1}`);
    const offersId = offer.OffersID || offer.PK_ID;
    
    return `
    <label class="checkbox-label">
      <input type="checkbox" name="services" value="${offersId}" 
             class="checkbox-input">
      <span class="checkbox-text">${serviceName}</span>
    </label>
    `;
  }).join('');
  
  return `<!DOCTYPE html>
<html>
<head>
    <title>New Project</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background: #f8f8f8;
        }
        .header {
            background: white;
            padding: 15px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            align-items: center;
        }
        .back-button {
            text-decoration: none;
            color: #007bff;
            font-size: 24px;
            margin-right: 15px;
        }
        .header-title {
            font-size: 18px;
            font-weight: 600;
            color: #333;
        }
        .form-container {
            padding: 20px;
            max-width: 600px;
            margin: 0 auto;
        }
        .form-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #333;
        }
        .form-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            box-sizing: border-box;
        }
        .form-input:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
        }
        .form-row {
            display: flex;
            gap: 15px;
        }
        .form-row .form-group {
            flex: 1;
        }
        .submit-button {
            width: 100%;
            padding: 14px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.3s;
        }
        .submit-button:hover {
            background: #0056b3;
        }
        .submit-button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .pac-container {
            z-index: 10000;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: #666;
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .checkbox-label {
            display: flex;
            align-items: center;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .checkbox-label:hover {
            background: #e9ecef;
        }
        .checkbox-input {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            cursor: pointer;
        }
        .checkbox-text {
            flex: 1;
            color: #333;
        }
        .info-grid {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .info-row {
            display: flex;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .info-row:last-child {
            border-bottom: none;
        }
        .info-label {
            font-weight: 600;
            color: #666;
            width: 140px;
        }
        .info-value {
            color: #333;
            flex: 1;
        }
        .docs-table {
            width: 100%;
            border-collapse: collapse;
        }
        .docs-table tr {
            border-bottom: 1px solid #f0f0f0;
        }
        .docs-table tr:last-child {
            border-bottom: none;
        }
        .doc-label {
            padding: 15px 10px 15px 0;
            font-weight: 500;
            color: #333;
            width: 60%;
        }
        .doc-upload {
            padding: 15px 0;
            text-align: right;
        }
        .upload-btn {
            display: inline-block;
            padding: 8px 16px;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 14px;
        }
        .upload-btn:hover {
            background: #e9ecef;
            border-color: #adb5bd;
        }
        .upload-btn span {
            color: #495057;
        }
        .service-item {
            padding: 8px 12px;
            background: #e7f3ff;
            border-radius: 4px;
            margin-bottom: 8px;
            color: #0066cc;
        }
    </style>
</head>
<body>
    <div class="header">
        <a href="/" class="back-button">←</a>
        <div class="header-title">NEW PROJECT</div>
    </div>
    
    <div class="form-container">
        <form id="newProjectForm" class="form-card">
            <div class="section-title">Project Details</div>
            
            <div class="form-group">
                <label class="form-label" for="company">Company</label>
                <select id="company" name="company" class="form-input" required>
                    <option value="1">Noble Property Inspections</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label" for="inspectionDate">Inspection Date</label>
                <input type="date" id="inspectionDate" name="inspectionDate" 
                       class="form-input" value="${today}" required>
            </div>
            
            <div class="section-title" style="margin-top: 30px;">Property Address</div>
            
            <div class="form-group">
                <label class="form-label" for="address">Street Address</label>
                <input type="text" id="address" name="address" class="form-input" 
                       placeholder="Start typing an address..." required>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="city">City</label>
                    <input type="text" id="city" name="city" class="form-input" required>
                </div>
                
                <div class="form-group" style="max-width: 100px;">
                    <label class="form-label" for="state">State</label>
                    <select id="state" name="state" class="form-input" required>
                        <option value="">Select</option>
                        <option value="TX">TX</option>
                        <option value="GA">GA</option>
                        <option value="FL">FL</option>
                        <option value="CO">CO</option>
                        <option value="CA">CA</option>
                        <option value="AZ">AZ</option>
                        <option value="SC">SC</option>
                        <option value="TN">TN</option>
                    </select>
                </div>
                
                <div class="form-group" style="max-width: 120px;">
                    <label class="form-label" for="zip">ZIP Code</label>
                    <input type="text" id="zip" name="zip" class="form-input" pattern="[0-9]{5}" required>
                </div>
            </div>
            
            <button type="submit" class="submit-button" id="submitBtn" style="margin-top: 30px;">Create Project</button>
        </form>
        
        <!-- Active Project View (hidden initially) -->
        <div id="projectView" style="display: none;">
            <!-- Project Header with Image -->
            <div style="margin: -20px -20px 20px -20px;">
                <img id="projectImage" src="" alt="Property" 
                     style="width: 100%; height: 200px; object-fit: cover; border-radius: 8px 8px 0 0;">
            </div>
            
            <!-- Project Info Card -->
            <div class="form-card" style="margin-bottom: 20px;">
                <div class="section-title">Project Information</div>
                <div class="info-grid">
                    <div class="info-row">
                        <span class="info-label">Address:</span>
                        <span id="viewAddress" class="info-value"></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">City:</span>
                        <span id="viewCity" class="info-value"></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">State:</span>
                        <span id="viewState" class="info-value"></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">ZIP:</span>
                        <span id="viewZip" class="info-value"></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Inspection Date:</span>
                        <span id="viewInspectionDate" class="info-value"></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Status:</span>
                        <span class="info-value" style="color: #28a745; font-weight: 600;">Active</span>
                    </div>
                </div>
                
                <!-- Services Selection Section -->
                <div style="margin-top: 30px; border-top: 1px solid #e0e0e0; padding-top: 20px;">
                    <div class="section-title" style="margin-bottom: 15px;">Select Services</div>
                    <div id="servicesCheckboxList">
                        <!-- Dynamically populated service checkboxes will go here -->
                    </div>
                    
                    <!-- Selected Services with Duplicates -->
                    <div id="selectedServicesContainer" style="margin-top: 20px;">
                        <div class="section-title" style="margin-bottom: 10px; font-size: 14px;">Selected Services</div>
                        <div id="selectedServicesList" style="display: flex; flex-direction: column; gap: 10px;">
                            <!-- Selected services with plus buttons will appear here -->
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Required Documents Table -->
            <div class="form-card">
                <div class="section-title">Required Documents</div>
                <form id="documentsForm">
                    <input type="hidden" id="projectId" name="projectId">
                    
                    <table class="docs-table">
                        <tr>
                            <td class="doc-label">
                                Home Inspection Report <span style="color: red;">*</span>
                            </td>
                            <td class="doc-upload">
                                <label for="inspectionReport" class="upload-btn">
                                    <span id="inspectionReportName">Choose File</span>
                                </label>
                                <input type="file" id="inspectionReport" name="inspectionReport" 
                                       accept=".pdf,.doc,.docx" required style="display: none;"
                                       onchange="updateFileName(this, 'inspectionReportName')">
                            </td>
                        </tr>
                        
                        <tr id="cubicasaRow" style="display: none;">
                            <td class="doc-label">
                                Cubicasa Report <span style="color: red;">*</span>
                            </td>
                            <td class="doc-upload">
                                <label for="cubicasa" class="upload-btn">
                                    <span id="cubicasaName">Choose File</span>
                                </label>
                                <input type="file" id="cubicasa" name="cubicasa" 
                                       accept=".pdf,.doc,.docx" style="display: none;"
                                       onchange="updateFileName(this, 'cubicasaName')">
                            </td>
                        </tr>
                        
                        <tr>
                            <td class="doc-label">Support Document 1</td>
                            <td class="doc-upload">
                                <label for="supportDoc1" class="upload-btn">
                                    <span id="supportDoc1Name">Choose File</span>
                                </label>
                                <input type="file" id="supportDoc1" name="supportDoc1" 
                                       accept=".pdf,.doc,.docx,.jpg,.png" style="display: none;"
                                       onchange="updateFileName(this, 'supportDoc1Name')">
                            </td>
                        </tr>
                        
                        <tr>
                            <td class="doc-label">Support Document 2</td>
                            <td class="doc-upload">
                                <label for="supportDoc2" class="upload-btn">
                                    <span id="supportDoc2Name">Choose File</span>
                                </label>
                                <input type="file" id="supportDoc2" name="supportDoc2" 
                                       accept=".pdf,.doc,.docx,.jpg,.png" style="display: none;"
                                       onchange="updateFileName(this, 'supportDoc2Name')">
                            </td>
                        </tr>
                    </table>
                    
                    <div style="display: flex; gap: 10px; margin-top: 30px;">
                        <button type="submit" class="submit-button" style="flex: 1;">
                            Save Documents
                        </button>
                        <button type="button" class="submit-button" style="flex: 1; background: #6c757d;"
                                onclick="window.location.href='/'">
                            Return to Projects
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    
    <script>
        function updateFileName(input, spanId) {
            const span = document.getElementById(spanId);
            if (input.files && input.files[0]) {
                span.textContent = input.files[0].name;
                span.style.color = '#28a745';
            } else {
                span.textContent = 'Choose File';
                span.style.color = '#495057';
            }
        }
        
        function initAutocomplete() {
            const addressInput = document.getElementById('address');
            const cityInput = document.getElementById('city');
            const stateInput = document.getElementById('state');
            const zipInput = document.getElementById('zip');
            
            const autocomplete = new google.maps.places.Autocomplete(addressInput, {
                types: ['address'],
                componentRestrictions: { country: 'us' }
            });
            
            autocomplete.addListener('place_changed', function() {
                const place = autocomplete.getPlace();
                
                if (!place.geometry) {
                    return;
                }
                
                // Parse the address components
                let streetNumber = '';
                let streetName = '';
                let city = '';
                let state = '';
                let zip = '';
                
                for (const component of place.address_components) {
                    const types = component.types;
                    
                    if (types.includes('street_number')) {
                        streetNumber = component.long_name;
                    }
                    if (types.includes('route')) {
                        streetName = component.long_name;
                    }
                    if (types.includes('locality')) {
                        city = component.long_name;
                    }
                    if (types.includes('administrative_area_level_1')) {
                        state = component.short_name;
                    }
                    if (types.includes('postal_code')) {
                        zip = component.long_name;
                    }
                }
                
                // Update the form fields
                addressInput.value = streetNumber + ' ' + streetName;
                cityInput.value = city;
                stateInput.value = state;
                zipInput.value = zip;
            });
        }
        
        // Track selected services
        let hasEngineerFoundation = false;
        
        // Monitor service checkboxes
        document.addEventListener('change', function(e) {
            if (e.target.type === 'checkbox' && e.target.name === 'services') {
                const checkboxes = document.querySelectorAll('input[name="services"]:checked');
                hasEngineerFoundation = false;
                
                checkboxes.forEach(cb => {
                    const label = cb.parentElement.querySelector('.checkbox-text');
                    if (label && label.textContent.toLowerCase().includes('engineer') && 
                        label.textContent.toLowerCase().includes('foundation')) {
                        hasEngineerFoundation = true;
                    }
                });
            }
        });
        
        // Handle form submission
        document.getElementById('newProjectForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            
            // Send to server
            try {
                const response = await fetch('/create-project', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    const result = await response.json();
                    
                    // If we got the new project ID, redirect to its detail page
                    if (result.projectId) {
                        window.location.href = '/project/' + result.projectId;
                    } else {
                        // Otherwise redirect to the projects list
                        window.location.href = '/';
                    }
                } else {
                    alert('Error creating project. Please try again.');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Create Project';
                }
            } catch (error) {
                alert('Error creating project. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Project';
            }
        });
        
        // Handle document upload form
        document.getElementById('documentsForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            alert('Documents saved! (In production, these would be uploaded to Caspio)');
            window.location.href = '/';
        });
    </script>
    <script async defer
        src="https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&libraries=places&callback=initAutocomplete">
    </script>
</body>
</html>`;
}

// Generate project detail page HTML
async function generateProjectDetailHTML(project) {
  if (!project) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Project Not Found</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; }
        .error { text-align: center; padding: 40px; color: #666; }
        .back-link { display: inline-block; margin: 20px; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <a href="/" class="back-link">← Back to Projects</a>
    <div class="error">
        <h2>Project Not Found</h2>
        <p>The requested project could not be found.</p>
    </div>
</body>
</html>`;
  }
  
  // Fetch all necessary data
  let serviceName = 'Not specified';
  const types = await fetchServiceTypes();
  const offers = await fetchOffers(project.CompanyID || 1);
  const attachTemplates = await fetchAttachTemplates();
  
  if (project.OffersID) {
    try {
      const offer = offers.find(o => o.OffersID === project.OffersID);
      if (offer) {
        const type = types.find(t => t.TypeID === offer.TypeID);
        serviceName = type ? type.TypeName : 'Service #' + project.OffersID;
      }
    } catch (err) {
      console.error('Error fetching service name:', err);
    }
  }

  const googleApiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
  const fullAddress = `${project.Address || ''} ${project.City || ''}`.trim();
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x250&location=${encodeURIComponent(fullAddress)}&key=${googleApiKey}&fov=120&pitch=10`;
  const stockHomeImage = 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&h=250&fit=crop';
  
  // Format inspection date
  const inspectionDate = project.InspectionDate ? 
    new Date(project.InspectionDate).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }) : 'Not scheduled';

  // Documents list
  const documents = [
    { name: 'Home Inspection Report', field: 'InspectionReport', required: true },
    { name: 'Cubicasa', field: 'CubicasaID', required: serviceName.includes('Foundation') },
    { name: 'Support Document 1', field: 'SupportDocument1', required: false },
    { name: 'Support Document 2', field: 'SupportDocument2', required: false }
  ];

  return `<!DOCTYPE html>
<html>
<head>
    <title>Project Details - ${project.Address || ''}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background: #f8f8f8;
        }
        .header {
            background: white;
            padding: 15px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            align-items: center;
        }
        .back-button {
            text-decoration: none;
            color: #007bff;
            font-size: 24px;
            margin-right: 15px;
        }
        .header-title {
            font-size: 18px;
            font-weight: 600;
            color: #333;
        }
        .hero-image {
            width: 100%;
            height: 250px;
            object-fit: cover;
            background: #e0e0e0;
        }
        .info-section {
            background: white;
            padding: 20px;
            margin: 20px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .info-row {
            display: flex;
            padding: 12px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .info-row:last-child {
            border-bottom: none;
        }
        .info-label {
            font-weight: 600;
            color: #666;
            width: 180px;
        }
        .info-value {
            color: #333;
            flex: 1;
        }
        .section-title {
            font-size: 18px;
            font-weight: 600;
            color: #333;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #007bff;
        }
        .documents-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .documents-table th {
            text-align: left;
            padding: 14px 16px;
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6c757d;
        }
        .documents-table td {
            padding: 14px 16px;
            border-bottom: 1px solid #f0f0f0;
            font-size: 14px;
            color: #333;
        }
        .documents-table tbody tr:last-child td {
            border-bottom: none;
        }
        .documents-table tbody tr:hover {
            background: #f8f9fa;
            transition: background 0.2s;
        }
        .upload-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .upload-btn:hover {
            background: #0056b3;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0,123,255,0.3);
        }
        .template-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .template-btn:hover {
            background: #218838;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(40,167,69,0.3);
        }
        .status-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
        }
        .status-uploaded {
            background: #d4edda;
            color: #155724;
        }
        .status-pending {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .status-optional {
            background: #e7e8ea;
            color: #5a6268;
            border: 1px solid #d6d8db;
        }
        .content {
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        .project-title {
            font-size: 24px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }
        .project-subtitle {
            font-size: 16px;
            color: #666;
            margin-bottom: 20px;
        }
        .fields-container {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .field-row {
            display: flex;
            padding: 12px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .field-row:last-child {
            border-bottom: none;
        }
        .field-label {
            font-weight: 600;
            color: #555;
            width: 40%;
            min-width: 150px;
        }
        .field-value {
            color: #333;
            flex: 1;
        }
    </style>
</head>
<body>
    <div class="header">
        <a href="/" class="back-button">←</a>
        <div class="header-title">PROJECT DETAILS</div>
    </div>
    
    <img src="${streetViewUrl}" alt="Property" class="hero-image" onerror="this.src='${stockHomeImage}'">
    
    <div class="content">
        <!-- Project Info Card with Service Selection -->
        <div class="info-section" style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h2 class="section-title">Project Information</h2>
            <div class="info-row">
                <span class="info-label">Address:</span>
                <span class="info-value">${project.Address || 'Not specified'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">City, State:</span>
                <span class="info-value">${project.City || ''}, ${project.StateID ? 'TX' : ''} ${project.Zip || ''}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Inspection Date:</span>
                <span class="info-value">${inspectionDate}</span>
            </div>
            
            <!-- Services Selection Section -->
            <div style="margin-top: 30px; border-top: 1px solid #e0e0e0; padding-top: 20px;">
                <div class="section-title" style="margin-bottom: 15px; font-size: 16px;">Select Services</div>
                <div id="servicesCheckboxList">
                    <!-- Dynamically populated service checkboxes will go here -->
                </div>
                
                <!-- Selected Services with Duplicates -->
                <div id="selectedServicesContainer" style="margin-top: 20px;">
                    <div class="section-title" style="margin-bottom: 10px; font-size: 14px;">Selected Services</div>
                    <div id="selectedServicesList" style="display: flex; flex-direction: column; gap: 10px;">
                        <!-- Selected services with plus buttons will appear here -->
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Required Documents -->
        <div class="info-section">
            <h2 class="section-title">Required Documents</h2>
            <table class="documents-table">
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>Document</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="documentsTableBody">
                    <!-- Will be populated by JavaScript based on selected services -->
                </tbody>
            </table>
        </div>
        
        <!-- Templates Section -->
        <div class="info-section">
            <h2 class="section-title">Templates</h2>
            <table class="documents-table">
                <tbody id="templatesTableBody">
                    <!-- Will be populated by JavaScript based on selected services -->
                </tbody>
            </table>
        </div>
    </div>
    
    <!-- Custom Confirmation Modal -->
    <div id="confirmModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 10000; justify-content: center; align-items: center;">
        <div style="background: white; border-radius: 12px; padding: 30px; max-width: 450px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h3 style="margin: 0 0 20px 0; color: #333; font-size: 20px;" id="confirmTitle">Confirm Deletion</h3>
            <p style="color: #666; line-height: 1.6; margin: 0 0 25px 0;" id="confirmMessage"></p>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="confirmCancel" style="padding: 10px 24px; border: 1px solid #ddd; background: white; color: #666; border-radius: 6px; cursor: pointer; font-size: 15px; transition: all 0.2s;">
                    Cancel
                </button>
                <button id="confirmDelete" style="padding: 10px 24px; border: none; background: #dc3545; color: white; border-radius: 6px; cursor: pointer; font-size: 15px; transition: all 0.2s;">
                    Confirm
                </button>
            </div>
        </div>
    </div>
    
    <script>
        // Store selected services
        let selectedServices = [];
        const projectId = '${project.PK_ID}';
        const actualProjectId = '${project.ProjectID}'; // The actual ProjectID field for Services
        
        // Custom confirmation modal functions
        function showConfirmModal(message, onConfirm, onCancel) {
            const modal = document.getElementById('confirmModal');
            const messageEl = document.getElementById('confirmMessage');
            const confirmBtn = document.getElementById('confirmDelete');
            const cancelBtn = document.getElementById('confirmCancel');
            
            messageEl.textContent = message;
            modal.style.display = 'flex';
            
            // Remove old listeners
            const newConfirmBtn = confirmBtn.cloneNode(true);
            const newCancelBtn = cancelBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            
            // Add new listeners
            newConfirmBtn.addEventListener('click', () => {
                modal.style.display = 'none';
                if (onConfirm) onConfirm();
            });
            
            newCancelBtn.addEventListener('click', () => {
                modal.style.display = 'none';
                if (onCancel) onCancel();
            });
            
            // Add hover effects
            newConfirmBtn.onmouseover = () => newConfirmBtn.style.background = '#c82333';
            newConfirmBtn.onmouseout = () => newConfirmBtn.style.background = '#dc3545';
            newCancelBtn.onmouseover = () => newCancelBtn.style.background = '#f8f9fa';
            newCancelBtn.onmouseout = () => newCancelBtn.style.background = 'white';
        }
        
        // Service types data
        const serviceTypes = ${JSON.stringify(types)};
        const offers = ${JSON.stringify(offers)};
        const attachTemplates = ${JSON.stringify(attachTemplates)};
        
        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            // Load manually added documents from localStorage
            const manualDocsKey = \`project_\${projectId}_manual_docs\`;
            const savedManualDocs = localStorage.getItem(manualDocsKey);
            if (savedManualDocs) {
                try {
                    window.manualDocsAdded = JSON.parse(savedManualDocs);
                    console.log('📄 Loaded manual documents from localStorage:', window.manualDocsAdded);
                } catch (e) {
                    console.error('Error parsing manual docs:', e);
                    window.manualDocsAdded = [];
                }
            } else {
                window.manualDocsAdded = [];
            }
            
            populateServiceCheckboxes();
            loadExistingServices();
            loadExistingAttachments(); // Load existing attachments from Attach table
            updateDocumentsTable(); // Initialize documents table
            updateTemplatesTable(); // Initialize templates table
        });
        
        // Populate service checkboxes
        function populateServiceCheckboxes() {
            const container = document.getElementById('servicesCheckboxList');
            if (!container) return;
            
            let html = '';
            serviceTypes.forEach(type => {
                // Find corresponding offer for this company
                const offer = offers.find(o => o.TypeID === type.TypeID);
                if (offer) {
                    html += \`
                        <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                            <label style="display: flex; align-items: center; cursor: pointer; flex: 1;">
                                <input type="checkbox" 
                                       value="\${offer.OffersID}" 
                                       data-type-id="\${type.TypeID}"
                                       data-type-name="\${type.TypeName}"
                                       onchange="handleServiceToggle(this)"
                                       style="margin-right: 10px;">
                                <span>\${type.TypeName}</span>
                            </label>
                            <input type="date" 
                                   id="inspection-date-\${offer.OffersID}"
                                   style="display: none; padding: 5px; border: 1px solid #ddd; border-radius: 4px;"
                                   onchange="updateServiceInspectionDate('\${offer.OffersID}', this.value)">
                        </div>
                    \`;
                }
            });
            container.innerHTML = html;
        }
        
        // Update inspection date for a service
        window.updateServiceInspectionDate = async function(offersId, date) {
            // Update all instances of this service with the new date
            const servicesToUpdate = selectedServices.filter(service => service.offersId === offersId);
            
            for (const service of servicesToUpdate) {
                service.inspectionDate = date;
                
                // If we have a serviceId, update the Services record in Caspio
                if (service.serviceId) {
                    try {
                        const token = await getCaspioToken();
                        const updateData = {
                            DateOfInspection: date
                        };
                        
                        console.log(\`📝 Updating DateOfInspection for Services record ID \${service.serviceId} to \${date}\`);
                        
                        // Use query parameter to update by PK_ID
                        const response = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=PK_ID=\${service.serviceId}\`, {
                            method: 'PUT',
                            headers: {
                                'Authorization': \`Bearer \${token}\`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(updateData)
                        });
                        
                        if (response.ok) {
                            console.log(\`✅ Updated DateOfInspection for service record \${service.serviceId}\`);
                        } else {
                            const errorText = await response.text();
                            console.error(\`❌ Failed to update DateOfInspection for service \${service.serviceId}. Status: \${response.status}, Error: \${errorText}\`);
                        }
                    } catch (error) {
                        console.error('Error updating DateOfInspection:', error);
                    }
                }
            }
            
            // Update localStorage
            const storageKey = \`project_\${projectId}_services\`;
            const updatedServices = selectedServices.map(s => ({
                offersId: s.offersId,
                instanceId: s.instanceId,
                typeId: s.typeId,
                inspectionDate: s.inspectionDate,
                serviceId: s.serviceId,
                timestamp: new Date().toISOString()
            }));
            localStorage.setItem(storageKey, JSON.stringify(updatedServices));
            
            console.log(\`Updated inspection date for all instances of service \${offersId} to \${date}\`);
        }
        
        // Handle service checkbox toggle
        function handleServiceToggle(checkbox) {
            const offersId = checkbox.value;
            const typeName = checkbox.dataset.typeName;
            const typeId = checkbox.dataset.typeId;
            const dateInput = document.getElementById(\`inspection-date-\${offersId}\`);
            
            if (checkbox.checked) {
                // Show date input when checkbox is checked
                if (dateInput) {
                    dateInput.style.display = 'block';
                    // Set default to today's date
                    if (!dateInput.value) {
                        dateInput.value = new Date().toISOString().split('T')[0];
                    }
                }
                addService(offersId, typeName, typeId);
            } else {
                // Hide date input when unchecked
                if (dateInput) {
                    dateInput.style.display = 'none';
                }
                // removeService will handle the confirmation
                // If user cancels, we need to re-check the checkbox
                const originalState = checkbox.checked;
                checkbox.checked = true; // Temporarily re-check
                
                removeService(offersId).then(() => {
                    // Service was removed (user confirmed)
                    checkbox.checked = false;
                }).catch(() => {
                    // Error or user cancelled
                    checkbox.checked = true;
                });
            }
        }
        
        // Add service to selected list
        async function addService(offersId, typeName, typeId) {
            const dateInput = document.getElementById(\`inspection-date-\${offersId}\`);
            const inspectionDate = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
            
            const service = {
                offersId: offersId,
                typeName: typeName,
                typeId: typeId || '',
                inspectionDate: inspectionDate,
                instanceId: Date.now() // Unique ID for this instance
            };
            
            // Create Services record and get ServiceID
            const serviceId = await createServicesRecord(offersId, service.instanceId, typeId, inspectionDate);
            if (serviceId) {
                service.serviceId = serviceId; // Store the ServiceID for deletion later
            }
            
            selectedServices.push(service);
            updateSelectedServicesList();
            
            // Update localStorage with the serviceId
            const storageKey = \`project_\${projectId}_services\`;
            const updatedServices = selectedServices.map(s => ({
                offersId: s.offersId,
                instanceId: s.instanceId,
                typeId: s.typeId,
                inspectionDate: s.inspectionDate,
                serviceId: s.serviceId,
                timestamp: new Date().toISOString()
            }));
            localStorage.setItem(storageKey, JSON.stringify(updatedServices));
        }
        
        // Remove service from selected list
        async function removeService(offersId) {
            // Show confirmation dialog
            const serviceName = selectedServices.find(s => s.offersId === offersId)?.typeName || 'this service';
            const confirmMessage = \`Are you sure you want to delete \${serviceName}? Doing so will remove your uploaded documents and templates for this service.\`;
            
            return new Promise((resolve, reject) => {
                showConfirmModal(confirmMessage, async () => {
                    // User confirmed deletion
                    await performServiceRemoval(offersId);
                    resolve();
                }, () => {
                    // User cancelled
                    const checkbox = document.querySelector(\`input[value="\${offersId}"]\`);
                    if (checkbox) checkbox.checked = true;
                    reject();
                });
            });
        }
        
        // Perform the actual service removal
        async function performServiceRemoval(offersId) {
            
            try {
                // Instead of relying on tracked serviceIds, fetch and delete ALL Services records
                // for this project that were created for this service
                const token = await getCaspioToken();
                
                console.log('🔍 Fetching all Services records for ProjectID:', actualProjectId);
                
                // Get all Services records for this project
                const getResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ProjectID=\${actualProjectId}\`, {
                    method: 'GET',
                    headers: {
                        'Authorization': \`Bearer \${token}\`
                    }
                });
                
                if (getResponse.ok) {
                    const data = await getResponse.json();
                    const allRecords = data.Result || [];
                    console.log('Found', allRecords.length, 'Services records for this project');
                    
                    // Count how many records we need to keep for other services
                    const otherServices = selectedServices.filter(s => s.offersId !== offersId);
                    const otherServiceCount = otherServices.length;
                    
                    // Delete records until we have the right amount left
                    const recordsToDelete = allRecords.length - otherServiceCount;
                    console.log('Need to delete', recordsToDelete, 'records');
                    
                    // Delete the most recent records (they're likely the ones for this service)
                    for (let i = 0; i < recordsToDelete && i < allRecords.length; i++) {
                        const record = allRecords[allRecords.length - 1 - i]; // Start from most recent
                        const pkId = record.PK_ID || record.ServiceID;
                        
                        if (pkId) {
                            const deleteResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=PK_ID=\${pkId}\`, {
                                method: 'DELETE',
                                headers: {
                                    'Authorization': \`Bearer \${token}\`
                                }
                            });
                            
                            if (deleteResponse.status === 200 || deleteResponse.status === 204) {
                                console.log('✅ Deleted Services record with PK_ID:', pkId);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error removing service:', error);
            }
            
            // Update local state
            selectedServices = selectedServices.filter(s => s.offersId !== offersId);
            updateSelectedServicesList();
            
            // Update localStorage
            const storageKey = \`project_\${projectId}_services\`;
            const updatedServices = selectedServices.map(s => ({
                offersId: s.offersId,
                instanceId: s.instanceId,
                typeId: s.typeId,
                inspectionDate: s.inspectionDate,
                serviceId: s.serviceId,
                timestamp: new Date().toISOString()
            }));
            localStorage.setItem(storageKey, JSON.stringify(updatedServices));
        }
        
        // Add duplicate service
        async function duplicateService(offersId, typeName) {
            // Find the original service to get its typeId and inspection date
            const original = selectedServices.find(s => s.offersId === offersId);
            const dateInput = document.getElementById(\`inspection-date-\${offersId}\`);
            const inspectionDate = dateInput ? dateInput.value : (original?.inspectionDate || new Date().toISOString().split('T')[0]);
            
            const service = {
                offersId: offersId,
                typeName: typeName,
                typeId: original?.typeId || '',
                inspectionDate: inspectionDate,
                instanceId: Date.now() + Math.random() // Unique ID for this instance
            };
            
            // Create Services record and get ServiceID
            const serviceId = await createServicesRecord(offersId, service.instanceId, service.typeId, service.inspectionDate);
            if (serviceId) {
                service.serviceId = serviceId;
            }
            
            selectedServices.push(service);
            updateSelectedServicesList();
            
            // Update localStorage with the serviceId
            const storageKey = \`project_\${projectId}_services\`;
            const updatedServices = selectedServices.map(s => ({
                offersId: s.offersId,
                instanceId: s.instanceId,
                typeId: s.typeId,
                inspectionDate: s.inspectionDate,
                serviceId: s.serviceId,
                timestamp: new Date().toISOString()
            }));
            localStorage.setItem(storageKey, JSON.stringify(updatedServices));
        }
        
        // Remove the last duplicate of a service
        function removeLastDuplicate(offersId) {
            // Find all instances of this service
            const instances = selectedServices.filter(s => s.offersId === offersId);
            
            if (instances.length <= 1) {
                // Shouldn't happen, but safety check
                return;
            }
            
            // Get the last instance
            const lastInstance = instances[instances.length - 1];
            const serviceName = lastInstance.typeName || 'this service';
            
            // Show confirmation dialog
            const confirmMessage = \`Are you sure you want to delete this instance of \${serviceName}? Doing so will remove your uploaded documents and templates for this service instance.\`;
            
            showConfirmModal(confirmMessage, async () => {
                // Remove the last instance
                const indexToRemove = selectedServices.lastIndexOf(lastInstance);
                if (indexToRemove !== -1) {
                    selectedServices.splice(indexToRemove, 1);
                }
                
                // Update UI immediately
                updateSelectedServicesList();
                
                // Update localStorage
                const storageKey = \`project_\${projectId}_services\`;
                const updatedServices = selectedServices.map(s => ({
                    offersId: s.offersId,
                    instanceId: s.instanceId,
                    timestamp: new Date().toISOString()
                }));
                localStorage.setItem(storageKey, JSON.stringify(updatedServices));
                
                // Delete from Services table
                console.log('🗑️ Attempting to delete Services record for:', lastInstance);
                if (lastInstance.serviceId) {
                    console.log('Using serviceId:', lastInstance.serviceId);
                    await deleteServicesRecord(lastInstance.serviceId);
                } else {
                    console.log('No serviceId found, will delete most recent Services record');
                    const deleted = await deleteRecentServicesRecord();
                    if (deleted) {
                        console.log('✅ Services record deleted successfully');
                    } else {
                        console.error('❌ Failed to delete Services record');
                    }
                }
            }, () => {
                // User cancelled - do nothing
            });
        }
        
        // Remove a single duplicate service instance (legacy function, keeping for compatibility)
        async function removeDuplicate(offersId, instanceId) {
            // Find the service to remove
            const serviceToRemove = selectedServices.find(s => s.offersId === offersId && s.instanceId === instanceId);
            const serviceName = serviceToRemove?.typeName || 'this service';
            
            // Show confirmation dialog
            const confirmMessage = \`Are you sure you want to delete this instance of \${serviceName}? Doing so will remove your uploaded documents and templates for this service instance.\`;
            
            showConfirmModal(confirmMessage, async () => {
                // User confirmed - proceed with deletion
                console.log('Removing duplicate service:', serviceToRemove);
                
                // First, remove from local array BEFORE any async operations
                const indexToRemove = selectedServices.findIndex(s => s.offersId === offersId && s.instanceId === instanceId);
                if (indexToRemove !== -1) {
                    selectedServices.splice(indexToRemove, 1);
                }
                
                // Update UI immediately
                updateSelectedServicesList();
                
                // If this was the last instance, uncheck the checkbox
                const remaining = selectedServices.filter(s => s.offersId === offersId);
                if (remaining.length === 0) {
                    const checkbox = document.querySelector(\`input[value="\${offersId}"]\`);
                    if (checkbox) checkbox.checked = false;
                }
                
                // Update localStorage
                const storageKey = \`project_\${projectId}_services\`;
                const updatedServices = selectedServices.map(s => ({
                    offersId: s.offersId,
                    instanceId: s.instanceId,
                    timestamp: new Date().toISOString()
                }));
                localStorage.setItem(storageKey, JSON.stringify(updatedServices));
                
                // Now try to delete from Services table (async, but UI already updated)
                if (serviceToRemove && serviceToRemove.serviceId) {
                    console.log('Deleting Services record with ID:', serviceToRemove.serviceId);
                    await deleteServicesRecord(serviceToRemove.serviceId);
                } else {
                    console.log('No serviceId found, attempting to delete most recent Services record');
                    // If no serviceId, try to delete the most recent Services record for this project
                    await deleteRecentServicesRecord();
                }
            }, () => {
                // User cancelled - do nothing
            });
        }
        
        // Delete the most recent Services record for this project
        async function deleteRecentServicesRecord() {
            try {
                const token = await getCaspioToken();
                console.log('🔍 Attempting to delete most recent Services record for ProjectID:', actualProjectId);
                
                // Get all Services records for this project
                const getResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ProjectID=\${actualProjectId}\`, {
                    method: 'GET',
                    headers: {
                        'Authorization': \`Bearer \${token}\`
                    }
                });
                
                if (getResponse.ok) {
                    const data = await getResponse.json();
                    const records = data.Result || [];
                    console.log(\`Found \${records.length} Services records for ProjectID \${actualProjectId}\`);
                    
                    if (records.length > 0) {
                        // Sort by PK_ID or ServiceID to get the most recent
                        records.sort((a, b) => {
                            const aId = parseInt(a.PK_ID || a.ServiceID || 0);
                            const bId = parseInt(b.PK_ID || b.ServiceID || 0);
                            return bId - aId; // Descending order
                        });
                        
                        // Delete the most recent record
                        const mostRecent = records[0];
                        const pkId = mostRecent.PK_ID || mostRecent.ServiceID;
                        
                        console.log('🗑️ Deleting Services record:', mostRecent);
                        
                        if (pkId) {
                            // Try both PK_ID and ServiceID in case the field name varies
                            const deleteResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=PK_ID=\${pkId}\`, {
                                method: 'DELETE',
                                headers: {
                                    'Authorization': \`Bearer \${token}\`
                                }
                            });
                            
                            if (deleteResponse.status === 200 || deleteResponse.status === 204) {
                                console.log('✅ Successfully deleted Services record with PK_ID:', pkId);
                                return true;
                            } else if (deleteResponse.status === 404) {
                                // Try ServiceID if PK_ID didn't work
                                console.log('PK_ID not found, trying ServiceID...');
                                const deleteResponse2 = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ServiceID=\${pkId}\`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Authorization': \`Bearer \${token}\`
                                    }
                                });
                                
                                if (deleteResponse2.status === 200 || deleteResponse2.status === 204) {
                                    console.log('✅ Successfully deleted Services record with ServiceID:', pkId);
                                    return true;
                                } else {
                                    console.error('❌ Failed to delete Services record. Status:', deleteResponse2.status);
                                    const errorText = await deleteResponse2.text();
                                    console.error('Error details:', errorText);
                                }
                            } else {
                                console.error('❌ Failed to delete Services record. Status:', deleteResponse.status);
                                const errorText = await deleteResponse.text();
                                console.error('Error details:', errorText);
                            }
                        } else {
                            console.error('❌ No ID found for Services record');
                        }
                    } else {
                        console.log('⚠️ No Services records found for this project');
                    }
                } else {
                    console.error('❌ Failed to fetch Services records. Status:', getResponse.status);
                }
            } catch (error) {
                console.error('❌ Error deleting recent Services record:', error);
            }
            return false;
        }
        
        // Update the selected services display
        function updateSelectedServicesList() {
            const container = document.getElementById('selectedServicesList');
            if (!container) return;
            
            if (selectedServices.length === 0) {
                container.innerHTML = '<p style="color: #999;">No services selected</p>';
                updateDocumentsTable(); // Update documents table
                updateTemplatesTable(); // Update templates table
                return;
            }
            
            // Group services by type
            const grouped = {};
            selectedServices.forEach(service => {
                if (!grouped[service.offersId]) {
                    grouped[service.offersId] = {
                        typeName: service.typeName,
                        offersId: service.offersId,
                        count: 0,
                        instances: []
                    };
                }
                grouped[service.offersId].count++;
                grouped[service.offersId].instances.push(service);
            });
            
            let html = '';
            Object.values(grouped).forEach(group => {
                // Escape the typeName for use in onclick attributes
                // Using a different approach to avoid regex issues in template literals
                let escapedTypeName = group.typeName;
                escapedTypeName = escapedTypeName.split("'").join("\\\\'");
                escapedTypeName = escapedTypeName.split('"').join('&quot;');
                
                html += \`
                    <div style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 4px; margin-bottom: 5px;">
                        <span style="flex: 1;">
                            \${group.typeName} 
                            \${group.count > 1 ? '(x' + group.count + ')' : ''}
                        </span>
                        <div style="display: flex; gap: 5px;">
                            \${group.count > 1 ? \`
                                <button onclick="removeLastDuplicate('\${group.offersId}')"
                                        style="background: #dc3545; color: white; border: none; padding: 4px 8px; 
                                               border-radius: 4px; cursor: pointer;">
                                    -
                                </button>
                            \` : ''}
                            <button onclick="duplicateService('\${group.offersId}', '\${escapedTypeName}')"
                                    style="background: #28a745; color: white; border: none; padding: 4px 8px; 
                                           border-radius: 4px; cursor: pointer;">
                                +
                            </button>
                        </div>
                    </div>
                \`;
            });
            
            container.innerHTML = html;
            updateDocumentsTable(); // Update documents table when services change
            updateTemplatesTable(); // Update templates table when services change
        }
        
        // Store existing attachments
        let existingAttachments = [];
        
        // Define document types for each service (fallback for types not in Attach_Templates)
        const serviceDocuments = {
            "Engineer's Foundation Evaluation": [
                { name: "Home Inspection Report", required: true },
                { name: "Cubicasa", required: false }
            ],
            "HUD / FHA Engineering Evaluation for Manufactured/Mobile Homes": [
                { name: "Home Inspection Report", required: true },
                { name: "HUD Certification", required: true }
            ],
            "Engineer's Inspection Review": [
                { name: "Home Inspection Report", required: true },
                { name: "Review Documents", required: false }
            ],
            "Defect Cost Report": [
                { name: "Home Inspection Report", required: true },
                { name: "Cost Estimates", required: false }
            ],
            "Engineer's Load Bearing Wall Evaluation": [
                { name: "Structural Plans", required: true },
                { name: "Home Inspection Report", required: false }
            ],
            "Engineer's Damaged Truss Evaluation": [
                { name: "Truss Documentation", required: true },
                { name: "Home Inspection Report", required: false }
            ],
            "Engineer's Cost Segregation Analysis": [
                { name: "Financial Documentation", required: true },
                { name: "Property Details", required: true }
            ],
            "Engineer's WPI-8": [
                { name: "WPI-8 Form", required: true },
                { name: "Home Inspection Report", required: false }
            ],
            "Other": [
                { name: "Home Inspection Report", required: false }
            ]
        };
        
        // Load existing attachments from Attach table
        async function loadExistingAttachments() {
            try {
                const token = await getCaspioToken();
                const response = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Attach/records?q.where=ProjectID=\${actualProjectId}\`, {
                    method: 'GET',
                    headers: {
                        'Authorization': \`Bearer \${token}\`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    existingAttachments = data.Result || [];
                    console.log('📎 Loaded existing attachments:', existingAttachments);
                    updateDocumentsTable(); // Refresh the table with loaded attachments
                }
            } catch (error) {
                console.error('Error loading existing attachments:', error);
            }
        }
        
        // Update the documents table based on selected services
        function updateDocumentsTable() {
            const tbody = document.getElementById('documentsTableBody');
            if (!tbody) return;
            
            // If no services selected, show default message
            if (selectedServices.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999;">No services selected</td></tr>';
                return;
            }
            
            // Group templates by TypeID and Auto status
            const templatesByType = {};
            attachTemplates.forEach(template => {
                if (!templatesByType[template.TypeID]) {
                    templatesByType[template.TypeID] = {
                        auto: [],
                        manual: []
                    };
                }
                if (template.Auto === 'Yes' || template.Auto === true || template.Auto === 1) {
                    templatesByType[template.TypeID].auto.push(template);
                } else {
                    templatesByType[template.TypeID].manual.push(template);
                }
            });
            
            let html = '';
            
            // Group services by type to handle duplicates
            const grouped = {};
            selectedServices.forEach(service => {
                if (!grouped[service.typeName]) {
                    grouped[service.typeName] = {
                        services: [],
                        typeId: service.typeId
                    };
                }
                grouped[service.typeName].services.push(service);
            });
            
            // Create rows for each service and its documents
            Object.entries(grouped).forEach(([serviceName, group]) => {
                const typeId = group.typeId;
                const services = group.services;
                
                // Get templates for this TypeID
                const autoTemplates = templatesByType[typeId]?.auto || [];
                const manualTemplates = templatesByType[typeId]?.manual || [];
                
                // Fall back to default documents if no templates found
                let docs = [];
                if (autoTemplates.length > 0) {
                    // Use templates from Attach_Templates - Only show Auto=Yes AND Required
                    docs = autoTemplates
                        .filter(t => t.Required === 'Yes' || t.Required === true || t.Required === 1)
                        .map(t => ({
                            name: t.Title || t.AttachmentName || t.Name || 'Document',
                            required: true,
                            templateId: t.PK_ID || t.AttachmentID,
                            auto: true
                        }));
                } else {
                    // Fallback to predefined documents - ONLY show required ones
                    const fallbackDocs = serviceDocuments[serviceName] || serviceDocuments["Other"];
                    // Only include required documents
                    docs = fallbackDocs
                        .filter(d => d.required === true)
                        .map(d => ({
                            ...d,
                            auto: true
                        }));
                }
                
                // For each instance of the service (handling duplicates)
                services.forEach((service, instanceIndex) => {
                    const serviceLabel = services.length > 1 ? 
                        \`\${serviceName} #\${instanceIndex + 1}\` : 
                        serviceName;
                    
                    // Track if we need to show manual templates
                    // Always show Add button to allow adding any document type
                    let showAddButton = true;
                    
                    // Include manually added documents for this service instance
                    let allDocs = [...docs];
                    if (window.manualDocsAdded) {
                        const manualDocsForService = window.manualDocsAdded.filter(md => 
                            md.serviceInstanceId === service.instanceId
                        );
                        manualDocsForService.forEach(md => {
                            allDocs.push({
                                name: md.name,
                                required: md.required,
                                templateId: md.templateId,
                                auto: false
                            });
                        });
                    }
                    
                    let rowCount = allDocs.length;
                    
                    // Add row for each document (auto and manual)
                    allDocs.forEach((doc, docIndex) => {
                        const isFirstDoc = docIndex === 0;
                        const isLastDoc = docIndex === allDocs.length - 1;
                        
                        // Find existing attachments for this document
                        const attachmentsForDoc = existingAttachments.filter(att => 
                            att.TypeID === parseInt(typeId) && 
                            att.Title === doc.name
                        );
                        
                        // Create upload status HTML with sleeker, smaller buttons
                        let uploadStatus = '';
                        if (attachmentsForDoc.length > 0) {
                            uploadStatus = '<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">';
                            attachmentsForDoc.forEach((attachment, idx) => {
                                const fileName = attachment.Link || 'Document';
                                uploadStatus += \`
                                    <div style="display: flex; align-items: center; justify-content: space-between; background: #f8f9fa; padding: 6px 10px; border-radius: 4px; width: 100%;">
                                        <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
                                            <span style="color: #28a745; font-size: 13px; font-weight: bold;">&#10003;</span>
                                            <span style="color: #333; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${fileName}">\${fileName}</span>
                                        </div>
                                        <div style="display: flex; gap: 8px; flex-shrink: 0;">
                                            <a href="#" onclick="event.preventDefault(); replaceFile(\${attachment.AttachID}, '\${doc.name.replace(/'/g, "\\\\'")}', '\${serviceName.replace(/'/g, "\\\\'")}')" 
                                               style="color: #6c757d; font-size: 11px; text-decoration: none;">
                                                Replace
                                            </a>
                                            <a href="#" onclick="event.preventDefault(); removeAttachment(\${attachment.AttachID}, '\${fileName.replace(/'/g, "\\\\'")}')" 
                                               style="color: #dc3545; font-size: 11px; text-decoration: none;">
                                                Remove
                                            </a>
                                        </div>
                                    </div>
                                \`;
                            });
                            uploadStatus += \`
                                <div style="margin-top: 4px;">
                                    <a href="#" onclick="event.preventDefault(); handleAddMoreFiles(\${actualProjectId}, \${service.serviceId || 'null'}, \${typeId}, '\${doc.name.replace(/'/g, "\\\\'")}', '\${serviceName.replace(/'/g, "\\\\'")}')" 
                                       style="color: #007bff; font-size: 12px; text-decoration: none;">
                                        + Upload Another
                                    </a>
                                </div>
                            </div>\`;
                        } else {
                            uploadStatus = \`
                                <a href="#" onclick="event.preventDefault(); uploadNewFile(\${actualProjectId}, \${service.serviceId || 'null'}, \${typeId}, '\${doc.name.replace(/'/g, "\\\\'")}', '\${serviceName.replace(/'/g, "\\\\'")}')" 
                                   style="color: #007bff; font-size: 12px; text-decoration: none; font-weight: 500;">
                                    Upload
                                </a>
                            \`;
                        }
                        
                        // Add remove document option for optional documents without uploads
                        let removeDocOption = '';
                        if (!doc.required && attachmentsForDoc.length === 0) {
                            // For manually added documents
                            if (!doc.auto) {
                                removeDocOption = \`
                                    <a href="#" onclick="event.preventDefault(); removeManualDocument('\${doc.name.replace(/'/g, "\\\\'")}', \${service.instanceId})"
                                       style="color: #dc3545; font-size: 11px; text-decoration: none; margin-left: 10px;">
                                        Remove
                                    </a>
                                \`;
                            }
                        }
                        
                        html += \`
                            <tr>
                                \${isFirstDoc ? \`<td rowspan="\${rowCount}" style="vertical-align: top; font-weight: 600; color: #212529; font-size: 14px; background: #fafbfc; border-right: 1px solid #e9ecef;">\${serviceLabel}</td>\` : ''}
                                <td>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            \${doc.name}
                                            \${isLastDoc && showAddButton ? \`
                                                <div style="margin-top: 5px;">
                                                    <a href="#" onclick="event.preventDefault(); showManualDocuments(\${typeId}, '\${serviceName.replace(/'/g, "\\\\'")}', \${instanceIndex})" 
                                                       style="color: #007bff; font-size: 12px; text-decoration: none;">
                                                        + Add
                                                    </a>
                                                </div>
                                            \` : ''}
                                        </div>
                                        \${removeDocOption}
                                    </div>
                                </td>
                                <td>
                                    <span class="status-badge \${attachmentsForDoc.length > 0 ? 'status-uploaded' : (doc.required ? 'status-pending' : 'status-optional')}">
                                        \${attachmentsForDoc.length > 0 ? 'Uploaded' : (doc.required ? 'Required' : 'Optional')}
                                    </span>
                                </td>
                                <td id="upload-cell-\${service.instanceId}-\${docIndex}">
                                    \${uploadStatus}
                                </td>
                            </tr>
                        \`;
                    });
                    
                    // Add separator row between service instances
                    if (instanceIndex < services.length - 1) {
                        html += '<tr style="height: 5px;"><td colspan="4" style="border: none; background: transparent;"></td></tr>';
                    }
                });
                
                // Add separator between different service types
                html += '<tr style="height: 15px;"><td colspan="4" style="border: none; background: transparent;"></td></tr>';
            });
            
            tbody.innerHTML = html || '<tr><td colspan="4" style="text-align: center; color: #999;">No services selected</td></tr>';
        }
        
        // Show manual documents popup
        window.showManualDocuments = function(typeId, serviceName, instanceIndex) {
            // Get manual templates from database
            const manualTemplates = attachTemplates.filter(t => 
                t.TypeID == typeId && 
                (t.Auto === 'No' || t.Auto === false || t.Auto === 0)
            );
            
            // Get auto templates that are optional (not required)
            const optionalAutoTemplates = attachTemplates.filter(t =>
                t.TypeID == typeId &&
                (t.Auto === 'Yes' || t.Auto === true || t.Auto === 1) &&
                (t.Required === 'No' || t.Required === false || t.Required === 0)
            );
            
            let documentsToShow = [...manualTemplates, ...optionalAutoTemplates];
            
            // If no templates at all, check for fallback optional documents
            if (documentsToShow.length === 0) {
                const fallbackDocs = serviceDocuments[serviceName] || [];
                const optionalFallbackDocs = fallbackDocs
                    .filter(d => d.required === false)
                    .map(d => ({
                        Title: d.name,
                        Required: false
                    }));
                
                if (optionalFallbackDocs.length > 0) {
                    documentsToShow = optionalFallbackDocs;
                } else {
                    // Provide common optional documents when no templates exist
                    documentsToShow = [
                        { Title: 'Additional Photos', Required: false },
                        { Title: 'Supporting Documentation', Required: false },
                        { Title: 'Client Notes', Required: false },
                        { Title: 'Supplemental Report', Required: false },
                        { Title: 'Cost Estimate', Required: false },
                        { Title: 'Other Document', Required: false }
                    ];
                }
            }
            
            // Create a modal to show manual document options
            let modalHtml = \`
                <div id="manualDocsModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center;">
                    <div style="background: white; border-radius: 12px; padding: 30px; max-width: 500px; width: 90%; max-height: 70vh; overflow-y: auto;">
                        <h3 style="margin: 0 0 20px 0;">Additional Documents for \${serviceName}</h3>
                        <div style="margin-bottom: 20px;">
            \`;
            
            documentsToShow.forEach(template => {
                const docName = template.Title || template.AttachmentName || template.Name || 'Document';
                const isRequired = template.Required === 'Yes' || template.Required === true || template.Required === 1;
                modalHtml += \`
                    <div style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px; cursor: pointer; transition: background 0.2s;"
                         onmouseover="this.style.background='#f0f0f0'" 
                         onmouseout="this.style.background='white'"
                         onclick="addManualDocument(\${template.PK_ID || template.AttachmentID}, '\${docName.replace(/'/g, "\\\\'")}', \${isRequired}, '\${serviceName.replace(/'/g, "\\\\'")}', \${instanceIndex})">
                        <strong>\${docName}</strong>
                        \${isRequired ? '<span style="color: red; margin-left: 10px;">*Required</span>' : '<span style="color: #666; margin-left: 10px;">(Optional)</span>'}
                    </div>
                \`;
            });
            
            modalHtml += \`
                        </div>
                        <button onclick="document.getElementById('manualDocsModal').remove()" 
                                style="padding: 10px 24px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            Close
                        </button>
                    </div>
                </div>
            \`;
            
            // Add modal to page
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        
        // Add manual document to the table
        window.addManualDocument = function(templateId, docName, isRequired, serviceName, instanceIndex) {
            // Close modal
            const modal = document.getElementById('manualDocsModal');
            if (modal) modal.remove();
            
            // Find the services for this type
            const servicesForType = selectedServices.filter(s => s.typeName === serviceName);
            const service = servicesForType[instanceIndex];
            
            if (!service) {
                console.error('Service not found for:', serviceName, 'at index:', instanceIndex);
                return;
            }
            
            // Initialize manual docs array if needed
            if (!window.manualDocsAdded) {
                window.manualDocsAdded = [];
            }
            
            // Check if this document is already added for this service
            const existingDoc = window.manualDocsAdded.find(md => 
                md.serviceInstanceId === service.instanceId && 
                md.name === docName
            );
            
            if (existingDoc) {
                console.log('Document already added:', docName);
                return;
            }
            
            // Add the new manual document
            window.manualDocsAdded.push({
                templateId: templateId,
                name: docName,
                required: isRequired,
                serviceName: serviceName,
                serviceInstanceId: service.instanceId,
                typeId: service.typeId
            });
            
            // Save to localStorage
            const manualDocsKey = \`project_\${projectId}_manual_docs\`;
            localStorage.setItem(manualDocsKey, JSON.stringify(window.manualDocsAdded));
            
            // Refresh the documents table to show the new document
            updateDocumentsTable();
        }
        
        // Handle uploading a new file
        window.uploadNewFile = function(projectId, serviceId, typeId, docTitle, serviceName) {
            const tempInput = document.createElement('input');
            tempInput.type = 'file';
            tempInput.onchange = function() {
                handleFileUpload(tempInput, projectId, serviceId, typeId, docTitle, serviceName, null);
            };
            tempInput.click();
        }
        
        // Handle replacing an existing file
        window.replaceFile = function(attachId, docTitle, serviceName) {
            const tempInput = document.createElement('input');
            tempInput.type = 'file';
            tempInput.onchange = function() {
                handleFileUpload(tempInput, actualProjectId, null, null, docTitle, serviceName, attachId);
            };
            tempInput.click();
        }
        
        // Handle removing a manual document entirely from the table
        window.removeManualDocument = function(docName, serviceInstanceId) {
            const confirmMessage = \`Are you sure you want to remove "\${docName}" from the documents list? This will remove the document requirement entirely.\`;
            
            showConfirmModal(confirmMessage, () => {
                // Remove from the manualDocsAdded array
                if (window.manualDocsAdded) {
                    window.manualDocsAdded = window.manualDocsAdded.filter(md => 
                        !(md.serviceInstanceId === serviceInstanceId && md.name === docName)
                    );
                    
                    // Save updated list to localStorage
                    const manualDocsKey = \`project_\${projectId}_manual_docs\`;
                    localStorage.setItem(manualDocsKey, JSON.stringify(window.manualDocsAdded));
                    
                    console.log('📝 Removed manual document:', docName);
                    
                    // Refresh the documents table
                    updateDocumentsTable();
                }
            }, () => {
                // User cancelled - do nothing
                console.log('User cancelled document removal');
            });
        }
        
        // Handle removing an attachment
        window.removeAttachment = async function(attachId, fileName) {
            // Show confirmation dialog
            const confirmMessage = \`Are you sure you want to remove "\${fileName}"? This action cannot be undone.\`;
            
            showConfirmModal(confirmMessage, async () => {
                try {
                    const token = await getCaspioToken();
                    
                    console.log('🗑️ Deleting Attach record:', attachId);
                    
                    // Delete the Attach record
                    const response = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Attach/records?q.where=AttachID=\${attachId}\`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': \`Bearer \${token}\`
                        }
                    });
                    
                    if (response.ok) {
                        console.log('✅ Attachment removed successfully');
                        
                        // Reload attachments to refresh the display
                        await loadExistingAttachments();
                        
                        // Update the documents table
                        updateDocumentsTable();
                    } else {
                        const errorText = await response.text();
                        console.error('❌ Failed to remove attachment:', errorText);
                        alert('Failed to remove attachment. Please try again.');
                    }
                } catch (error) {
                    console.error('Error removing attachment:', error);
                    alert('An error occurred while removing the attachment.');
                }
            }, () => {
                // User cancelled - do nothing
                console.log('User cancelled attachment removal');
            });
        }
        
        // Handle adding more files (creates new Attach record)
        window.handleAddMoreFiles = function(projectId, serviceId, typeId, docTitle, serviceName) {
            // Create a temporary file input
            const tempInput = document.createElement('input');
            tempInput.type = 'file';
            tempInput.onchange = function() {
                handleFileUpload(tempInput, projectId, serviceId, typeId, docTitle, serviceName, null);
            };
            tempInput.click();
        }
        
        // Handle file upload
        window.handleFileUpload = async function(input, projectId, serviceId, typeId, docTitle, serviceName, replaceAttachId) {
            const file = input.files[0];
            if (!file) return;
            
            console.log('📁 Uploading file:', file.name);
            console.log('📋 For document:', docTitle);
            console.log('🏠 Project ID:', projectId);
            console.log('🔧 Service ID:', serviceId);
            console.log('📊 Type ID:', typeId);
            console.log('🔄 Replace Attach ID:', replaceAttachId);
            
            try {
                const token = await getCaspioToken();
                let attachId = replaceAttachId;
                
                if (attachId) {
                    console.log('📝 Replacing file for existing Attach record:', attachId);
                } else {
                    // Create new Attach record
                    const attachData = {
                        ProjectID: parseInt(projectId),
                        TypeID: parseInt(typeId),
                        Title: docTitle,
                        Notes: \`Uploaded for \${serviceName}\`
                    };
                    
                    console.log('📤 Creating Attach record:', attachData);
                    
                    const response = await fetch('https://c2hcf092.caspio.com/rest/v2/tables/Attach/records', {
                        method: 'POST',
                        headers: {
                            'Authorization': \`Bearer \${token}\`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(attachData)
                    });
                    
                    if (response.ok) {
                        // Get the created record ID
                        const responseText = await response.text();
                        
                        if (responseText) {
                            try {
                                const result = JSON.parse(responseText);
                                attachId = result.AttachID || result.PK_ID;
                            } catch (e) {
                                console.log('Could not parse response');
                            }
                        }
                        
                        // If we didn't get the ID from response, fetch the latest record
                        if (!attachId) {
                            const getResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Attach/records?q.where=ProjectID=\${projectId}&q.orderBy=AttachID%20DESC&q.limit=1\`, {
                                method: 'GET',
                                headers: {
                                    'Authorization': \`Bearer \${token}\`
                                }
                            });
                            
                            if (getResponse.ok) {
                                const data = await getResponse.json();
                                const records = data.Result || [];
                                if (records.length > 0) {
                                    attachId = records[0].AttachID || records[0].PK_ID;
                                }
                            }
                        }
                    } else {
                        const errorText = await response.text();
                        console.error('Failed to create Attach record:', errorText);
                        button.textContent = originalText;
                        button.disabled = false;
                        alert('Failed to create attachment record. Please try again.');
                        return;
                    }
                }
                
                // Now upload the file using our server-side endpoint
                if (attachId && file) {
                        console.log('📤 Uploading file to Attach record:', attachId);
                        
                        const formData = new FormData();
                        formData.append('Attachment', file);
                        
                        const fileResponse = await fetch(\`/api/caspio/Attach/file/\${attachId}\`, {
                            method: 'POST',
                            body: formData
                        });
                        
                        if (fileResponse.ok) {
                            const result = await fileResponse.json();
                            console.log('✅ File uploaded successfully:', result);
                            
                            // Update the Link field with the filename
                            const updateData = {
                                Link: file.name
                            };
                            
                            const updateResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Attach/records?q.where=AttachID=\${attachId}\`, {
                                method: 'PUT',
                                headers: {
                                    'Authorization': \`Bearer \${token}\`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(updateData)
                            });
                            
                            if (updateResponse.ok) {
                                console.log('✅ Updated Link field with filename:', file.name);
                            }
                            
                            // Reload attachments to refresh the display
                            await loadExistingAttachments();
                            
                            // Update the entire documents table to show new state
                            updateDocumentsTable();
                        } else {
                            const error = await fileResponse.json();
                            console.error('Failed to upload file:', error);
                            alert('Failed to upload file. Please try again.');
                        }
                    } else {
                        console.log('✅ Attach record created (no file to upload)');
                    }
            } catch (error) {
                console.error('Error uploading file:', error);
                alert('An error occurred during upload. Please try again.');
            }
            
            // Clear the file input for potential re-upload
            input.value = '';
        }
        
        // Update the templates table based on selected services
        // Function to open template - works for both web and mobile
        window.openTemplate = function(offersId, projectPkId, serviceId) {
            // For development server (web)
            if (typeof window !== 'undefined' && window.location && window.location.hostname) {
                window.open('/template/' + offersId + '/' + projectPkId + '/' + serviceId, '_blank');
            } 
            // For mobile app
            else {
                // Store the IDs for mobile navigation
                localStorage.setItem('currentOffersId', offersId);
                localStorage.setItem('currentProjectPkId', projectPkId);
                localStorage.setItem('currentServiceId', serviceId);
                
                // Get the actual ProjectID from the project data
                const actualProjectId = '${project.ProjectID}';
                localStorage.setItem('currentProjectID', actualProjectId);
                
                // Load template view for mobile
                loadTemplateView(offersId, actualProjectId, serviceId);
            }
        }
        
        function updateTemplatesTable() {
            const tbody = document.getElementById('templatesTableBody');
            if (!tbody) return;
            
            if (selectedServices.length === 0) {
                tbody.innerHTML = '<tr><td style="text-align: center; color: #999; padding: 20px;">No services selected</td></tr>';
                return;
            }
            
            let html = '';
            
            // Group services by type to handle duplicates
            const grouped = {};
            selectedServices.forEach(service => {
                if (!grouped[service.typeName]) {
                    grouped[service.typeName] = {
                        name: service.typeName,
                        offersId: service.offersId,
                        instances: []
                    };
                }
                grouped[service.typeName].instances.push(service);
            });
            
            // Create a row for each service instance with centered full-width button
            Object.values(grouped).forEach(group => {
                group.instances.forEach((service, index) => {
                    const templateName = group.instances.length > 1 ? 
                        \`\${group.name} Template #\${index + 1}\` : 
                        \`\${group.name} Template\`;
                    
                    // Use the specific serviceId to associate with the Services record
                    const serviceId = service.serviceId || service.instanceId || 'new';
                    
                    html += \`
                        <tr>
                            <td style="text-align: center; padding: 10px;">
                                <button class="template-btn" 
                                        onclick="openTemplate('\${group.offersId}', '\${projectId}', '\${serviceId}')"
                                        style="width: 100%; padding: 12px 20px; background: #007bff; color: white; border: none; 
                                               border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;
                                               transition: background 0.2s; text-align: center;"
                                        onmouseover="this.style.background='#0056b3'"
                                        onmouseout="this.style.background='#007bff'"
                                        data-service-id="\${serviceId}"
                                        title="Open template for Service ID: \${serviceId}">
                                    \${templateName}
                                </button>
                            </td>
                        </tr>
                    \`;
                });
            });
            
            tbody.innerHTML = html;
        }
        
        // Create service record in Caspio
        async function createServicesRecord(offersId, instanceId, typeId, inspectionDate) {
            try {
                // Find the service in selectedServices to get all its data
                const service = selectedServices.find(s => s.instanceId === instanceId);
                
                console.log('📝 Creating Services record:', {
                    projectId: actualProjectId,
                    offersId: offersId,
                    typeId: service?.typeId || typeId,
                    inspectionDate: service?.inspectionDate || inspectionDate,
                    instanceId: instanceId
                });
                
                // Create actual Services record in Caspio
                const token = await getCaspioToken();
                // Include ProjectID, TypeID, and DateOfInspection
                const typeIdValue = parseInt(service?.typeId || typeId || '1');
                const data = {
                    ProjectID: parseInt(actualProjectId),
                    TypeID: typeIdValue,
                    DateOfInspection: service?.inspectionDate || new Date().toISOString().split('T')[0]
                };
                
                console.log('📝 TypeID being sent:', typeIdValue, 'from typeId:', (service?.typeId || typeId));
                
                console.log('📤 Sending to Services table:', data);
                
                const response = await fetch('https://c2hcf092.caspio.com/rest/v2/tables/Services/records', {
                    method: 'POST',
                    headers: {
                        'Authorization': \`Bearer \${token}\`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                console.log('📥 Response status:', response.status);
                
                if (response.status === 201 || response.status === 200) {
                    console.log('✅ Services record created for OffersID:', offersId);
                    const responseText = await response.text();
                    console.log('Raw response:', responseText);
                    
                    // Caspio often returns empty response on 201 Created
                    // We need to fetch the created record to get its ID
                    if (!responseText || responseText === '') {
                        console.log('Empty response, fetching created record...');
                        
                        // Wait a moment for the record to be created
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // Fetch the most recent Services record for this project
                        const getResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ProjectID=\${actualProjectId}&q.orderBy=PK_ID%20DESC&q.limit=1\`, {
                            method: 'GET',
                            headers: {
                                'Authorization': \`Bearer \${token}\`
                            }
                        });
                        
                        if (getResponse.ok) {
                            const data = await getResponse.json();
                            const records = data.Result || [];
                            if (records.length > 0) {
                                const newRecord = records[0];
                                console.log('Found created record:', newRecord);
                                return newRecord.PK_ID || newRecord.ServiceID || null;
                            }
                        }
                    } else {
                        try {
                            const result = JSON.parse(responseText);
                            console.log('Parsed response:', result);
                            // Return the ServiceID or PK_ID if available
                            return result.ServiceID || result.PK_ID || null;
                        } catch (e) {
                            console.log('Could not parse response as JSON');
                        }
                    }
                    return null;
                } else {
                    const errorText = await response.text();
                    console.error('Failed to create Services record:', response.status, errorText);
                    return null;
                }
            } catch (error) {
                console.error('Error saving service selection:', error);
                return null;
            }
        }
        
        // Delete Services record from Caspio
        async function deleteServicesRecord(serviceId) {
            try {
                // If we don't have a serviceId, try to find records by ProjectID
                if (!serviceId) {
                    console.log('⚠️ No ServiceID available, searching by ProjectID:', actualProjectId);
                    const token = await getCaspioToken();
                    
                    // First, get all Services records for this project
                    const getResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ProjectID=\${actualProjectId}\`, {
                        method: 'GET',
                        headers: {
                            'Authorization': \`Bearer \${token}\`
                        }
                    });
                    
                    if (getResponse.ok) {
                        const data = await getResponse.json();
                        const records = data.Result || [];
                        console.log('Found Services records to delete:', records);
                        
                        // Delete the most recent one (we can't identify specific ones without ServiceID)
                        if (records.length > 0) {
                            const recordToDelete = records[records.length - 1];
                            const pkId = recordToDelete.PK_ID || recordToDelete.ServiceID;
                            
                            if (pkId) {
                                const deleteResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=PK_ID=\${pkId}\`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Authorization': \`Bearer \${token}\`
                                    }
                                });
                                
                                if (deleteResponse.status === 200 || deleteResponse.status === 204) {
                                    console.log('✅ Services record deleted by PK_ID:', pkId);
                                } else {
                                    console.error('Failed to delete by PK_ID:', deleteResponse.status);
                                }
                            }
                        }
                    }
                    return;
                }
                
                const token = await getCaspioToken();
                
                console.log('🗑️ Deleting Services record with ServiceID:', serviceId);
                
                // Try deleting by ServiceID first
                let response = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ServiceID=\${serviceId}\`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': \`Bearer \${token}\`
                    }
                });
                
                // If ServiceID doesn't work, try PK_ID
                if (response.status === 404 || response.status === 400) {
                    console.log('ServiceID not found, trying PK_ID:', serviceId);
                    response = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=PK_ID=\${serviceId}\`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': \`Bearer \${token}\`
                        }
                    });
                }
                
                if (response.status === 200 || response.status === 204) {
                    console.log('✅ Services record deleted:', serviceId);
                } else {
                    const errorText = await response.text();
                    console.error('Failed to delete Services record:', response.status, errorText);
                }
            } catch (error) {
                console.error('Error deleting service record:', error);
            }
        }
        
        // Get Caspio token
        async function getCaspioToken() {
            const tokenUrl = 'https://c2hcf092.caspio.com/oauth/token';
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials&client_id=${caspioConfig.clientId}&client_secret=${caspioConfig.clientSecret}'
            });
            const data = await response.json();
            return data.access_token;
        }
        
        // Load existing services for this project
        async function loadExistingServices() {
            // First, fetch actual Services records from Caspio for this project
            try {
                const token = await getCaspioToken();
                const getResponse = await fetch(\`https://c2hcf092.caspio.com/rest/v2/tables/Services/records?q.where=ProjectID=\${actualProjectId}\`, {
                    method: 'GET',
                    headers: {
                        'Authorization': \`Bearer \${token}\`
                    }
                });
                
                let caspioServices = [];
                if (getResponse.ok) {
                    const data = await getResponse.json();
                    caspioServices = data.Result || [];
                    console.log('📋 Loaded existing Services records from Caspio:', caspioServices);
                }
                
                // Load from localStorage
                const storageKey = \`project_\${projectId}_services\`;
                const savedServices = JSON.parse(localStorage.getItem(storageKey) || '[]');
                
                // Reconstruct selectedServices array
                savedServices.forEach(saved => {
                const serviceType = serviceTypes.find(t => {
                    const offer = offers.find(o => o.OffersID == saved.offersId);
                    return offer && offer.TypeID === t.TypeID;
                });
                
                if (serviceType) {
                    // Try to find matching Caspio record by TypeID
                    const matchingCaspioRecord = caspioServices.find(cs => 
                        cs.TypeID == (saved.typeId || serviceType.TypeID)
                    );
                    
                    selectedServices.push({
                        offersId: saved.offersId,
                        typeName: serviceType.TypeName,
                        instanceId: saved.instanceId,
                        typeId: saved.typeId,
                        inspectionDate: saved.inspectionDate,
                        serviceId: matchingCaspioRecord ? matchingCaspioRecord.PK_ID : saved.serviceId
                    });
                    
                    // Check the corresponding checkbox
                    const checkbox = document.querySelector(\`input[value="\${saved.offersId}"]\`);
                    if (checkbox && !checkbox.checked) {
                        checkbox.checked = true;
                    }
                    
                    // Show and set the date input
                    const dateInput = document.getElementById(\`inspection-date-\${saved.offersId}\`);
                    if (dateInput && saved.inspectionDate) {
                        dateInput.style.display = 'block';
                        dateInput.value = saved.inspectionDate;
                    }
                }
            });
            
            // Update display
            if (selectedServices.length > 0) {
                updateSelectedServicesList();
            }
            
            // Also check if project has existing OffersID
            const existingOffersId = '${project.OffersID || ''}';
            if (existingOffersId && !selectedServices.find(s => s.offersId == existingOffersId)) {
                const checkbox = document.querySelector(\`input[value="\${existingOffersId}"]\`);
                if (checkbox) {
                    checkbox.checked = true;
                    handleServiceToggle(checkbox);
                }
            }
            } catch (error) {
                console.error('Error loading existing services:', error);
            }
        }
    </script>
</body>
</html>`;
}

// Generate HTML with real data
function generateHTML(projects) {
  const googleApiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
  
  // Stock home image from Unsplash
  const stockHomeImage = 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=120&h=120&fit=crop';
  
  const projectItems = projects.map((project, index) => {
    // Create full address for Street View
    const fullAddress = `${project.Address || ''} ${project.City || ''} ${project.StateID || ''}`.trim();
    
    // Google Street View Static API URL with your API key - increased size and adjusted FOV
    const streetViewUrl = fullAddress ? 
      `https://maps.googleapis.com/maps/api/streetview?size=200x200&location=${encodeURIComponent(fullAddress)}&key=${googleApiKey}&fov=120&pitch=10` :
      '';
    
    return `
    <a href="/project/${project.PK_ID || project.ProjectID || index}" class="project-item-link">
      <div class="project-item">
        <div class="project-image">
          <img src="${streetViewUrl}" alt="Property" 
               onerror="this.src='${stockHomeImage}'"
               loading="lazy">
        </div>
        <div class="project-details">
          <div class="project-address">${project.Address || 'No address'}, ${project.City || ''}, ${project.State || ''}</div>
          <div class="project-status">Active Project</div>
        </div>
      </div>
    </a>
  `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
    <title>Caspio Mobile App</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background: #f8f8f8;
        }
        .header {
            background: white;
            padding: 20px;
            text-align: center;
            border-bottom: 1px solid #e0e0e0;
        }
        .header h1 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            letter-spacing: 0.5px;
            color: #333;
        }
        .container {
            padding: 16px;
            max-width: 600px;
            margin: 0 auto;
            padding-bottom: 80px;
        }
        .project-item-link {
            text-decoration: none;
            color: inherit;
            display: block;
        }
        .project-item {
            display: flex;
            align-items: center;
            padding: 12px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 12px;
        }
        .project-image {
            width: 60px;
            height: 60px;
            min-width: 60px;
            background: #e0e0e0;
            border-radius: 8px;
            margin-right: 16px;
            overflow: hidden;
            position: relative;
        }
        .project-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            position: absolute;
            top: 0;
            left: 0;
        }
        .project-details {
            flex: 1;
        }
        .project-address {
            font-size: 14px;
            font-weight: 500;
            color: #333;
            margin-bottom: 4px;
        }
        .project-status {
            font-size: 12px;
            color: #666;
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #999;
        }
        .new-project-container {
            margin-bottom: 20px;
        }
        .new-project-button {
            display: inline-flex;
            align-items: center;
            padding: 12px 24px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 500;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }
        .new-project-button:hover {
            background: #0056b3;
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .plus-icon {
            font-size: 20px;
            margin-right: 8px;
        }
        .bottom-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: white;
            border-top: 1px solid #e0e0e0;
            display: flex;
            justify-content: space-around;
            padding: 12px 0;
        }
        .nav-item {
            padding: 8px 16px;
            color: #666;
            text-decoration: none;
            font-size: 24px;
        }
        .nav-item.active {
            color: #ff6b35;
        }
    </style>
    <meta http-equiv="refresh" content="10">
</head>
<body>
    <div class="header">
        <h1>ACTIVE PROJECTS</h1>
    </div>
    <div class="container">
        <div class="new-project-container">
            <a href="/new-project" class="new-project-button">
                <span class="plus-icon">+</span> New Project
            </a>
        </div>
        ${projectItems || '<div class="empty-state">No active projects found</div>'}
    </div>
    
    <div class="bottom-nav">
        <a href="#" class="nav-item active">📄</a>
        <a href="#" class="nav-item">👤</a>
        <a href="#" class="nav-item">🔍</a>
        <a href="#" class="nav-item">☰</a>
    </div>
</body>
</html>`;
}

// Create server
const server = http.createServer(async (req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);
  
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;
  
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const projects = await fetchActiveProjects();
      const html = generateHTML(projects);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      console.error('Error:', err);
      res.writeHead(500);
      res.end('Error loading projects');
    }
  } else if (pathname === '/new-project') {
    try {
      const html = await generateNewProjectHTML();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      console.error('Error loading new project form:', err);
      res.writeHead(500);
      res.end('Error loading form');
    }
  } else if (pathname === '/create-project' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const projectData = JSON.parse(body);
        const result = await createProject(projectData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, result, projectId: result.projectId || result.PK_ID || 'new' }));
      } catch (err) {
        console.error('Error creating project:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } else if (pathname === '/offers') {
    // Debug route to view offers data
    try {
      const offers = await fetchOffers(1); // Noble Property Inspections
      console.log('📋 Offers table structure:', offers[0] ? Object.keys(offers[0]) : 'No offers found');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(offers));
    } catch (err) {
      console.error('Error fetching offers:', err);
      res.writeHead(500);
      res.end('Error fetching offers');
    }
  } else if (pathname === '/types') {
    // Debug route to view types data
    try {
      const types = await fetchServiceTypes();
      console.log('📋 Type table structure:', types[0] ? Object.keys(types[0]) : 'No types found');
      console.log('📊 Service types:', types.map(t => ({
        TypeID: t.TypeID || t.ID || t.PK_ID,
        TypeName: t.TypeName || t.Name,
        Description: t.Description
      })));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(types));
    } catch (err) {
      console.error('Error fetching types:', err);
      res.writeHead(500);
      res.end('Error fetching types');
    }
  } else if (pathname === '/states') {
    // Debug route to view states data
    try {
      const states = await fetchStates();
      const statesJSON = JSON.stringify(states, null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(statesJSON);
    } catch (err) {
      console.error('Error fetching states:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (pathname.startsWith('/api/caspio/Projects/') && req.method === 'GET') {
    // Get project details by PK_ID
    const pkId = pathname.replace('/api/caspio/Projects/', '');
    
    try {
      if (!accessToken) {
        await authenticate();
      }
      
      const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
      const response = await fetch(`${apiBaseUrl}/tables/Projects/records?q.where=PK_ID=${pkId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.Result && data.Result.length > 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data.Result[0]));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch project' }));
      }
    } catch (err) {
      console.error('Error fetching project:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (pathname.startsWith('/api/get-project/') && req.method === 'GET') {
    // Get project details by ProjectID
    const projectId = pathname.replace('/api/get-project/', '');
    
    try {
      if (!accessToken) {
        await authenticate();
      }
      
      const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
      const response = await fetch(`${apiBaseUrl}/tables/Projects/records?q.where=ProjectID=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.Result && data.Result.length > 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data.Result[0]));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
        }
      } else {
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch project' }));
      }
    } catch (err) {
      console.error('Error fetching project:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (pathname === '/api/save-project-field' && req.method === 'POST') {
    // Save a single project field
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { projectId, fieldName, value } = JSON.parse(body);
        
        if (!accessToken) {
          await authenticate();
        }
        
        const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
        
        // First get the PK_ID for this ProjectID
        const getResponse = await fetch(`${apiBaseUrl}/tables/Projects/records?q.where=ProjectID=${projectId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        });
        
        if (!getResponse.ok) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
          return;
        }
        
        const projectData = await getResponse.json();
        if (!projectData.Result || projectData.Result.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
          return;
        }
        
        const pkId = projectData.Result[0].PK_ID;
        
        // Update the specific field
        const updateData = { [fieldName]: value };
        
        const updateResponse = await fetch(`${apiBaseUrl}/tables/Projects/records?q.where=PK_ID=${pkId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(updateData)
        });
        
        if (updateResponse.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, fieldName, value }));
        } else {
          const errorText = await updateResponse.text();
          console.error('Error updating project field:', errorText);
          res.writeHead(updateResponse.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update project field' }));
        }
      } catch (err) {
        console.error('Error saving project field:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (pathname.match(/^\/api\/caspio\/Services\/\d+$/) && req.method === 'GET') {
    // Get specific Services record by PK_ID
    const serviceId = pathname.split('/').pop();
    
    try {
      if (!accessToken) {
        await authenticate();
      }
      
      const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
      // Use PK_ID to fetch the record since that's the actual ID we have
      const response = await fetch(`${apiBaseUrl}/tables/Services/records?q.where=PK_ID=${serviceId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (data.Result && data.Result.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          exists: true, 
          ServiceID: serviceId,
          record: data.Result[0]
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false, message: 'Services record not found' }));
      }
    } catch (err) {
      console.error('Error fetching Services:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (pathname.startsWith('/api/caspio/Services/check/') && req.method === 'GET') {
    // Check if Services record exists for a project
    // The projectId here is actually the PK_ID from Projects table (e.g., 1860)
    // We need to first get the ProjectID from the Projects table
    const pkId = pathname.replace('/api/caspio/Services/check/', '');
    
    try {
      if (!accessToken) {
        await authenticate();
      }
      
      // First get the project to find its ProjectID
      const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
      const projectResponse = await fetch(`${apiBaseUrl}/tables/Projects/records?q.where=PK_ID=${pkId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (!projectResponse.ok) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch project' }));
        return;
      }
      
      const projectData = await projectResponse.json();
      if (!projectData.Result || projectData.Result.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
        return;
      }
      
      const projectId = projectData.Result[0].ProjectID;
      console.log(`🔍 Checking Services for ProjectID: ${projectId} (from PK_ID: ${pkId})`);
      
      // Now check for Services record using the actual ProjectID
      const response = await fetch(`${apiBaseUrl}/tables/Services/records?q.where=ProjectID=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.Result && data.Result.length > 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            exists: true, 
            ServiceID: data.Result[0].ServiceID,
            record: data.Result[0]
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ exists: false }));
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to check Services' }));
      }
    } catch (err) {
      console.error('Error checking Services:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (pathname.startsWith('/icons/') && req.method === 'GET') {
    // Serve static icon files from an icons directory
    const iconName = pathname.replace('/icons/', '');
    const fs = require('fs');
    const path = require('path');
    
    // Create icons directory path (you'll need to create this directory and add your PNG files)
    const iconsPath = path.join(__dirname, 'icons', iconName);
    
    // Check if file exists
    if (fs.existsSync(iconsPath)) {
      const iconData = fs.readFileSync(iconsPath);
      const ext = path.extname(iconName).toLowerCase();
      let contentType = 'image/png';
      
      if (ext === '.svg') contentType = 'image/svg+xml';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
      });
      res.end(iconData);
    } else {
      res.writeHead(404);
      res.end('Icon not found');
    }
  } else if (pathname.startsWith('/api/caspio/files/') && req.method === 'GET') {
    // Proxy endpoint to fetch Caspio files with authentication
    const externalKey = pathname.replace('/api/caspio/files/', '');
    
    try {
      if (!accessToken) {
        await authenticate();
      }
      
      const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
      const fileResponse = await fetch(`${apiBaseUrl}/files/${externalKey}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/octet-stream'
        }
      });
      
      if (fileResponse.ok) {
        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = fileResponse.headers.get('content-type') || 'image/png';
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(buffer);
      } else {
        res.writeHead(404);
        res.end('File not found');
      }
    } catch (err) {
      console.error('Error fetching file:', err);
      res.writeHead(500);
      res.end('Error fetching file');
    }
  } else if (pathname.match(/^\/api\/caspio\/Attach\/file\/\d+$/) && req.method === 'POST') {
    // Handle file upload for Attach record
    const attachId = pathname.split('/').pop();
    
    let body = [];
    req.on('data', chunk => {
      body.push(chunk);
    });
    
    req.on('end', async () => {
      try {
        if (!accessToken) {
          await authenticate();
        }
        
        // Parse multipart form data to extract file
        const buffer = Buffer.concat(body);
        const boundary = req.headers['content-type'].split('boundary=')[1];
        
        // Split the multipart data by boundary
        const parts = buffer.toString('binary').split(`--${boundary}`);
        
        let fieldName = 'Attachment';
        let fileName = null;
        let fileContent = null;
        let contentType = 'application/octet-stream';
        
        // Find the file part
        for (const part of parts) {
          if (part.includes('Content-Disposition: form-data')) {
            // Extract filename
            const fileMatch = part.match(/filename="([^"]+)"/);
            if (fileMatch) {
              fileName = fileMatch[1];
              
              // Extract content type if present
              const typeMatch = part.match(/Content-Type: ([^\r\n]+)/);
              if (typeMatch) {
                contentType = typeMatch[1];
              }
              
              // Extract file content (after headers)
              const headerEnd = part.indexOf('\r\n\r\n');
              if (headerEnd !== -1) {
                const dataStart = headerEnd + 4;
                const dataEnd = part.lastIndexOf('\r\n');
                if (dataEnd > dataStart) {
                  fileContent = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
                }
              }
            }
          }
        }
        
        if (!fileName || !fileContent) {
          console.error('No file found in request');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No file found in request' }));
          return;
        }
        
        // Add timestamp to make filename unique
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}_${fileName}`;
        
        console.log(`Uploading file: ${uniqueFileName} (${fileContent.length} bytes) to Attach record: ${attachId}`);
        
        // Use Caspio Files API to upload directly to the Attach table
        const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
        
        // Create multipart form data for Caspio
        const formBoundary = `----FormBoundary${Date.now()}`;
        const formData = [
          `--${formBoundary}`,
          `Content-Disposition: form-data; name="file"; filename="${uniqueFileName}"`,
          `Content-Type: ${contentType}`,
          '',
          fileContent.toString('binary'),
          `--${formBoundary}--`
        ].join('\r\n');
        
        const formBuffer = Buffer.from(formData, 'binary');
        
        // For file fields, we need to store the file reference, not the actual file
        // First upload to Caspio Files API, then store the reference
        const fileResponse = await fetch(`${apiBaseUrl}/files`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/form-data; boundary=${formBoundary}`,
            'Accept': 'application/json'
          },
          body: formBuffer
        });
        
        if (fileResponse.ok || fileResponse.status === 201) {
          const fileResult = await fileResponse.json();
          console.log('File uploaded to Caspio Files:', fileResult);
          
          // Extract the file reference
          let fileUrl = '';
          let externalKey = '';
          if (fileResult.Result && fileResult.Result.length > 0) {
            externalKey = fileResult.Result[0].ExternalKey || '';
            const encodedFileName = encodeURIComponent(uniqueFileName);
            fileUrl = `https://c2hcf092.caspio.com/dp/37d2600004f63e8fb40647078302/files/${externalKey}/${encodedFileName}`;
          }
          
          // Update the Attach record with the file reference
          const updateData = {
            Attachment: fileUrl || fileName,
            Link: fileName
          };
          
          const updateResponse = await fetch(`${apiBaseUrl}/tables/Attach/records?q.where=AttachID=${attachId}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(updateData)
          });
          
          if (updateResponse.ok) {
            console.log('✅ File uploaded and linked to Attach record');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'File uploaded successfully',
              fileName: fileName,
              attachId: attachId,
              fileUrl: fileUrl
            }));
          } else {
            const errorText = await updateResponse.text();
            console.error('Failed to update Attach record with file:', errorText);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'File uploaded but record update failed',
              fileName: fileName,
              attachId: attachId
            }));
          }
        } else {
          const errorText = await fileResponse.text();
          console.error('Failed to upload file to Caspio Files:', errorText);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Failed to upload file',
            details: errorText
          }));
        }
      } catch (err) {
        console.error('Error processing file upload:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } else if (pathname.match(/^\/api\/caspio\/Services\/file\/\d+$/) && req.method === 'POST') {
    // Handle file upload for Services record
    const serviceId = pathname.split('/').pop();
    
    let body = [];
    req.on('data', chunk => {
      body.push(chunk);
    });
    
    req.on('end', async () => {
      try {
        if (!accessToken) {
          await authenticate();
        }
        
        // Parse multipart form data to extract file
        const buffer = Buffer.concat(body);
        const boundary = req.headers['content-type'].split('boundary=')[1];
        
        // Split the multipart data by boundary
        const parts = buffer.toString('binary').split(`--${boundary}`);
        
        let fieldName = null;
        let fileName = null;
        let fileContent = null;
        let contentType = 'application/octet-stream';
        
        // Find the file part
        for (const part of parts) {
          if (part.includes('Content-Disposition: form-data')) {
            // Extract field name
            const nameMatch = part.match(/name="([^"]+)"/);
            if (nameMatch) {
              fieldName = nameMatch[1];
            }
            
            // Extract filename
            const fileMatch = part.match(/filename="([^"]+)"/);
            if (fileMatch) {
              fileName = fileMatch[1];
              
              // Extract content type if present
              const typeMatch = part.match(/Content-Type: ([^\r\n]+)/);
              if (typeMatch) {
                contentType = typeMatch[1];
              }
              
              // Extract file content (after headers)
              const headerEnd = part.indexOf('\r\n\r\n');
              if (headerEnd !== -1) {
                const dataStart = headerEnd + 4;
                const dataEnd = part.lastIndexOf('\r\n');
                if (dataEnd > dataStart) {
                  fileContent = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
                }
              }
            }
          }
        }
        
        if (!fileName || !fileContent) {
          console.error('No file found in request');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No file found in request' }));
          return;
        }
        
        // Add timestamp to make filename unique
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}_${fileName}`;
        
        console.log(`Uploading file: ${uniqueFileName} (${fileContent.length} bytes) for field: ${fieldName} to Services record: ${serviceId}`);
        
        // Use Caspio Files API to upload and get URL
        const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
        
        // Create multipart form data for Caspio Files API
        const formBoundary = `----FormBoundary${Date.now()}`;
        const formData = [
          `--${formBoundary}`,
          `Content-Disposition: form-data; name="file"; filename="${uniqueFileName}"`,
          `Content-Type: ${contentType}`,
          '',
          fileContent.toString('binary'),
          `--${formBoundary}--`
        ].join('\r\n');
        
        const formBuffer = Buffer.from(formData, 'binary');
        
        // First, upload to Caspio Files API to get the file URL
        const fileResponse = await fetch(`${apiBaseUrl}/files`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/form-data; boundary=${formBoundary}`,
            'Accept': 'application/json'
          },
          body: formBuffer
        });
        
        if (fileResponse.ok) {
          const fileResult = await fileResponse.json();
          console.log('File uploaded to Caspio Files:', fileResult);
          
          // Extract the file URL from the response
          let fileUrl = '';
          let externalKey = '';
          if (fileResult.Result && fileResult.Result.length > 0) {
            externalKey = fileResult.Result[0].ExternalKey || '';
            // Construct the Caspio file URL using the external key
            // Encode the filename to handle spaces and special characters
            const encodedFileName = encodeURIComponent(uniqueFileName);
            fileUrl = `https://c2hcf092.caspio.com/dp/37d2600004f63e8fb40647078302/files/${externalKey}/${encodedFileName}`;
          }
          
          console.log(`File URL: ${fileUrl}`);
          
          // Now update the Services record with the file URL or unique filename
          const updateData = {};
          updateData[fieldName] = fileUrl || uniqueFileName;
          
          const updateResponse = await fetch(`${apiBaseUrl}/tables/Services/records?q.where=ServiceID=${serviceId}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(updateData)
          });
          
          if (updateResponse.ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'File uploaded and linked successfully',
              fileName: uniqueFileName,
              fileUrl: fileUrl
            }));
            console.log(`✅ File uploaded and linked to Services record ${serviceId}: ${uniqueFileName}`);
          } else {
            const errorText = await updateResponse.text();
            console.error('Failed to update record with file URL:', errorText);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'File uploaded to Caspio Files',
              fileName: fileName,
              fileUrl: fileUrl,
              note: 'File uploaded but could not update record. You may need to manually link it.'
            }));
          }
        } else {
          const errorText = await fileResponse.text();
          console.error('Caspio Attachments API error:', errorText);
          
          // Check if file already exists
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = { Code: 'Unknown' };
          }
          
          if (errorData.Code === 'MultipleUploadAllFilesAlreadyExist' || errorData.Code === 'FileAlreadyExists') {
            // File already exists, but we still need to update the field with the file reference
            console.log(`ℹ️ File already exists in Caspio: ${fileName}`);
            
            // For existing files, we need to construct the file reference
            // Caspio File fields typically expect the filename or a path reference
            const updateData = {};
            updateData[fieldName] = fileName;
            
            const updateResponse = await fetch(`${apiBaseUrl}/tables/Services/records?q.where=ServiceID=${serviceId}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(updateData)
            });
            
            if (updateResponse.ok) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                message: 'File reference updated successfully',
                fileName: fileName,
                note: 'File already exists in Caspio, field updated with reference'
              }));
              console.log(`✅ Updated PrimaryPhoto field with existing file: ${fileName}`);
            } else {
              const errorText = await updateResponse.text();
              console.error('Failed to update field with existing file:', errorText);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                message: 'Could not update file reference',
                fileName: fileName,
                error: errorText
              }));
            }
          } else {
            // Other error - try to save filename as reference
            const updateData = {};
            updateData[fieldName] = fileName; // Just save filename if file upload fails
            
            const updateResponse = await fetch(`${apiBaseUrl}/tables/Services/records?q.where=ServiceID=${serviceId}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(updateData)
            });
            
            if (updateResponse.ok) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                message: 'Filename saved as reference',
                fileName: fileName,
                note: 'Unable to upload file to Caspio Files at this time'
              }));
            } else {
              // Field is likely read-only, but file processing was attempted
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                message: 'File processed',
                fileName: fileName,
                note: 'File field is read-only via API. Use Caspio DataPages for file uploads.'
              }));
            }
          }
        }
        
      } catch (err) {
        console.error('Error handling file upload:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (pathname.match(/^\/api\/caspio\/Services\/\d+$/) && req.method === 'PUT') {
    // Update Services record
    const serviceId = pathname.split('/').pop();
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const updateData = JSON.parse(body);
        
        if (!accessToken) {
          await authenticate();
        }
        
        const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
        const response = await fetch(`${apiBaseUrl}/tables/Services/records?q.where=ServiceID=${serviceId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Field updated' }));
        } else {
          const errorText = await response.text();
          console.error('Caspio update error:', errorText);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update' }));
        }
      } catch (err) {
        console.error('Error updating Services:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (pathname === '/api/caspio/Services' && req.method === 'POST') {
    // Handle Services data submission to Caspio
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const serviceData = JSON.parse(body);
        
        // Ensure we have access token
        if (!accessToken) {
          await authenticate();
        }
        
        // Create Services record in Caspio
        const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
        const response = await fetch(`${apiBaseUrl}/tables/Services/records`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(serviceData)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Caspio API Error:', errorText);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Failed to save to Caspio', 
            details: errorText 
          }));
          return;
        }
        
        const result = await response.json();
        console.log('✅ Services record created:', result);
        
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          success: true, 
          ServiceID: result.ServiceID || serviceData.ServiceID,
          message: 'Services record created successfully' 
        }));
        
      } catch (err) {
        console.error('Error saving Services:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (pathname.startsWith('/template/')) {
    // Handle template page - Service-specific template
    const parts = pathname.replace('/template/', '').split('/');
    const offersId = parts[0];
    const projectId = parts[1] || '';
    const serviceId = parts[2] || ''; // ServiceID for this specific service instance
    
    try {
      // For now, just use a placeholder service name
      let serviceName = 'Template Form';
      console.log(`📝 Loading template for OffersID: ${offersId}, ProjectID: ${projectId}, ServiceID: ${serviceId}`);
      
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${serviceName} - Template Form</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        /* Custom Icon Classes - Replace with your base64 encoded PNGs */
        .icon-home {
            width: 24px;
            height: 24px;
            display: inline-block;
            /* Example: background-image: url('data:image/png;base64,YOUR_BASE64_HERE'); */
            background-size: contain;
            background-repeat: no-repeat;
        }
        
        .icon-project {
            width: 24px;
            height: 24px;
            display: inline-block;
            background-size: contain;
            background-repeat: no-repeat;
        }
        
        .icon-inspection {
            width: 24px;
            height: 24px;
            display: inline-block;
            background-size: contain;
            background-repeat: no-repeat;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f5f5;
            color: #333;
        }
        .header {
            background: #007bff;
            color: white;
            padding: 15px 20px;
            display: flex;
            align-items: center;
            gap: 20px;
        }
        .back-button {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        .back-button:hover {
            background: rgba(255,255,255,0.3);
        }
        .service-header {
            background: #0056b3;
            color: white;
            padding: 20px;
            text-align: center;
        }
        .service-header h1 {
            font-size: 24px;
            font-weight: 600;
        }
        .container {
            max-width: 800px;
            margin: 20px auto;
            padding: 0 20px;
        }
        
        /* Section cards */
        .section-card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .section-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .section-card.active {
            border: 2px solid #007bff;
        }
        .section-header {
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .section-title {
            font-size: 20px;
            font-weight: 600;
            color: #333;
        }
        .section-description {
            color: #666;
            font-size: 14px;
            margin-top: 5px;
        }
        .section-icon {
            font-size: 24px;
            color: #007bff;
        }
        .expand-icon {
            color: #999;
            transition: transform 0.3s;
        }
        .section-card.expanded .expand-icon {
            transform: rotate(180deg);
        }
        
        /* Expandable content */
        .section-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
            background: #f8f9fa;
            border-top: 1px solid #dee2e6;
        }
        .section-card.expanded .section-content {
            max-height: 2000px;
            transition: max-height 0.5s ease-in;
        }
        .section-inner {
            padding: 20px;
        }
        
        /* Form styles */
        .form-group {
            margin-bottom: 20px;
        }
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #555;
        }
        .form-input, .form-select, .form-textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        .form-textarea {
            resize: vertical;
            min-height: 100px;
        }
        .form-row {
            display: flex;
            gap: 15px;
        }
        .form-row .form-group {
            flex: 1;
        }
        .file-upload-container {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .file-button {
            background: white;
            border: 1px solid #007bff;
            color: #007bff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        .file-button:hover {
            background: #f0f8ff;
        }
        
        /* Submit section */
        .submit-card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .submit-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
        }
        .fee-display {
            font-size: 18px;
            font-weight: 600;
            color: #007bff;
        }
        .submit-button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 40px;
            border-radius: 4px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
        }
        .submit-button:hover {
            background: #0056b3;
        }
        
        /* Progress indicator */
        .progress-indicator {
            display: flex;
            justify-content: center;
            margin: 20px 0;
            gap: 10px;
        }
        .progress-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ddd;
            transition: background 0.3s;
        }
        .progress-dot.completed {
            background: #28a745;
        }
        .progress-dot.active {
            background: #007bff;
        }
        
        /* Subsection styles */
        .subsection-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .subsection-card {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .subsection-card:hover {
            border-color: #007bff;
            background: #f8f9fa;
        }
        .subsection-header {
            padding: 12px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .subsection-title-container {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .subsection-title {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
        }
        .progress-badge {
            background: #e9ecef;
            color: #495057;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .progress-badge.complete {
            background: #28a745;
            color: white;
        }
        .progress-badge.partial {
            background: #ffc107;
            color: #212529;
        }
        .subsection-expand-icon {
            color: #6c757d;
            transition: transform 0.3s;
            font-size: 12px;
        }
        
        /* Field completion styles */
        .form-group.completed .form-label {
            color: #28a745;
            font-weight: 600;
        }
        .form-group.completed .form-label::before {
            content: "✓ ";
            color: #28a745;
            font-weight: bold;
        }
        .form-input.has-value, .form-select.has-value, .form-textarea.has-value {
            border-color: #28a745;
            background-color: #f8fff9;
        }
        .subsection-card.expanded .subsection-expand-icon {
            transform: rotate(180deg);
        }
        .subsection-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
            border-top: 1px solid #dee2e6;
            background: #fafafa;
        }
        .subsection-card.expanded .subsection-content {
            max-height: 1000px;
            transition: max-height 0.3s ease-in;
        }
        .subsection-inner {
            padding: 15px;
        }
    </style>
</head>
<body>
    <div class="header">
        <a href="/project/${projectId || 'list'}" class="back-button">
            ← Back
        </a>
        <h1>${serviceName}</h1>
    </div>
    
    <div class="service-header">
        <h1>${serviceName}</h1>
        <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-top: 10px; font-size: 14px;">
            <strong>Project ID:</strong> ${projectId || 'Not Set'} | 
            <strong>Service Record ID (PK_ID):</strong> <span id="serviceIdDisplay">${serviceId || 'Not Set'}</span>
            <div style="margin-top: 5px; font-size: 12px; color: #666;">
                This template is linked to Services table record #<span id="pkIdDisplay">${serviceId || 'Not Set'}</span>
            </div>
        </div>
    </div>
    
    <div class="container">
        <!-- Progress Indicator -->
        <div class="progress-indicator">
            <div class="progress-dot" id="dot-1"></div>
            <div class="progress-dot" id="dot-2"></div>
            <div class="progress-dot" id="dot-3"></div>
        </div>
        
        <form id="templateForm">
            <!-- Project Details Section (saves to Projects table) -->
            <div class="section-card" id="project-details-section">
                <div class="section-header" onclick="toggleSection('project-details')">
                    <div>
                        <div class="section-title">
                            <!-- Icon placeholder for Project Details -->
                            <span style="display: inline-block; width: 20px; height: 20px; vertical-align: middle; margin-right: 8px; background: #4CAF50; border-radius: 3px; color: white; text-align: center; line-height: 20px; font-size: 14px;">P</span>
                            Project Details
                        </div>
                        <div class="section-description">Client and property information (saves to Projects table)</div>
                    </div>
                    <span class="expand-icon" id="project-details-icon">▼</span>
                </div>
                <div class="section-content" id="project-details-content">
                    <div class="section-inner">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Client Name</label>
                                <input type="text" class="form-input" name="ClientName" id="ClientName" 
                                       placeholder="Enter client name" onblur="saveProjectField('ClientName', this.value)">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Agent Name</label>
                                <input type="text" class="form-input" name="AgentName" id="AgentName" 
                                       placeholder="Enter agent name" onblur="saveProjectField('AgentName', this.value)">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Inspector Name</label>
                                <input type="text" class="form-input" name="InspectorName" id="InspectorName" 
                                       placeholder="Enter inspector name" onblur="saveProjectField('InspectorName', this.value)">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Year Built</label>
                                <input type="text" class="form-input" name="YearBuilt" id="YearBuilt" 
                                       placeholder="e.g., 2005" onblur="saveProjectField('YearBuilt', this.value)">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Square Feet</label>
                                <input type="text" class="form-input" name="SquareFeet" id="SquareFeet" 
                                       placeholder="e.g., 2500" onblur="saveProjectField('SquareFeet', this.value)">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Type of Building</label>
                                <select class="form-select" name="TypeOfBuilding" id="proj_TypeOfBuilding" 
                                        onchange="saveProjectField('TypeOfBuilding', this.value)">
                                    <option value="">Select Building Type</option>
                                    <option value="Single Family">Single Family</option>
                                    <option value="Multi Family">Multi Family</option>
                                    <option value="Townhouse">Townhouse</option>
                                    <option value="Condominium">Condominium</option>
                                    <option value="Commercial">Commercial</option>
                                    <option value="Mixed Use">Mixed Use</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Style</label>
                                <select class="form-select" name="Style" id="proj_Style" 
                                        onchange="saveProjectField('Style', this.value)">
                                    <option value="">Select Style</option>
                                    <option value="Ranch">Ranch</option>
                                    <option value="Two Story">Two Story</option>
                                    <option value="Split Level">Split Level</option>
                                    <option value="Colonial">Colonial</option>
                                    <option value="Contemporary">Contemporary</option>
                                    <option value="Traditional">Traditional</option>
                                    <option value="Mediterranean">Mediterranean</option>
                                    <option value="Victorian">Victorian</option>
                                    <option value="Craftsman">Craftsman</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">In Attendance</label>
                                <input type="text" class="form-input" name="InAttendance" id="proj_InAttendance" 
                                       placeholder="Names of people present" onblur="saveProjectField('InAttendance', this.value)">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Weather Conditions</label>
                                <select class="form-select" name="WeatherConditions" id="proj_WeatherConditions" 
                                        onchange="saveProjectField('WeatherConditions', this.value)">
                                    <option value="">Select Weather</option>
                                    <option value="Clear">Clear</option>
                                    <option value="Partly Cloudy">Partly Cloudy</option>
                                    <option value="Cloudy">Cloudy</option>
                                    <option value="Light Rain">Light Rain</option>
                                    <option value="Heavy Rain">Heavy Rain</option>
                                    <option value="Windy">Windy</option>
                                    <option value="Foggy">Foggy</option>
                                    <option value="Snow">Snow</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Outdoor Temperature (°F)</label>
                                <input type="text" class="form-input" name="OutdoorTemperature" id="proj_OutdoorTemperature" 
                                       placeholder="e.g., 75" onblur="saveProjectField('OutdoorTemperature', this.value)">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Occupancy/Furnishings</label>
                                <select class="form-select" name="OccupancyFurnishings" id="proj_OccupancyFurnishings" 
                                        onchange="saveProjectField('OccupancyFurnishings', this.value)">
                                    <option value="">Select Status</option>
                                    <option value="Occupied - Furnished">Occupied - Furnished</option>
                                    <option value="Occupied - Partially Furnished">Occupied - Partially Furnished</option>
                                    <option value="Vacant - Furnished">Vacant - Furnished</option>
                                    <option value="Vacant - Partially Furnished">Vacant - Partially Furnished</option>
                                    <option value="Vacant - Unfurnished">Vacant - Unfurnished</option>
                                    <option value="Under Construction">Under Construction</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">First Foundation Type</label>
                                <select class="form-select" name="FirstFoundationType" id="FirstFoundationType" 
                                        onchange="saveProjectField('FirstFoundationType', this.value)">
                                    <option value="">Select Foundation Type</option>
                                    <option value="Slab">Slab</option>
                                    <option value="Crawl Space">Crawl Space</option>
                                    <option value="Basement">Basement</option>
                                    <option value="Pier and Beam">Pier and Beam</option>
                                    <option value="Block and Base">Block and Base</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Second Foundation Type</label>
                                <select class="form-select" name="SecondFoundationType" id="SecondFoundationType" 
                                        onchange="saveProjectField('SecondFoundationType', this.value)">
                                    <option value="">Select Foundation Type</option>
                                    <option value="Slab">Slab</option>
                                    <option value="Crawl Space">Crawl Space</option>
                                    <option value="Basement">Basement</option>
                                    <option value="Pier and Beam">Pier and Beam</option>
                                    <option value="Block and Base">Block and Base</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Second Foundation Rooms</label>
                                <input type="text" class="form-input" name="SecondFoundationRooms" id="SecondFoundationRooms" 
                                       placeholder="List rooms" onblur="saveProjectField('SecondFoundationRooms', this.value)">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Third Foundation Type</label>
                                <select class="form-select" name="ThirdFoundationType" id="ThirdFoundationType" 
                                        onchange="saveProjectField('ThirdFoundationType', this.value)">
                                    <option value="">Select Foundation Type</option>
                                    <option value="Slab">Slab</option>
                                    <option value="Crawl Space">Crawl Space</option>
                                    <option value="Basement">Basement</option>
                                    <option value="Pier and Beam">Pier and Beam</option>
                                    <option value="Block and Base">Block and Base</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Third Foundation Rooms</label>
                                <input type="text" class="form-input" name="ThirdFoundationRooms" id="ThirdFoundationRooms" 
                                       placeholder="List rooms" onblur="saveProjectField('ThirdFoundationRooms', this.value)">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Owner/Occupant Interview</label>
                            <textarea class="form-input" name="OwnerOccupantInterview" id="OwnerOccupantInterview" 
                                      rows="4" placeholder="Enter interview notes" 
                                      onblur="saveProjectField('OwnerOccupantInterview', this.value)"></textarea>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Information Section -->
            <div class="section-card" id="section-1">
                <div class="section-header" onclick="toggleSection(1)">
                    <div>
                        <div class="section-title">
                            <!-- Icon placeholder for Information -->
                            <span style="display: inline-block; width: 20px; height: 20px; vertical-align: middle; margin-right: 8px; background: #2196F3; border-radius: 3px; color: white; text-align: center; line-height: 20px; font-size: 14px;">i</span>
                            Information
                        </div>
                        <div class="section-description">Project details and contact information</div>
                    </div>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <!-- Subsections within Information -->
                        <div class="subsection-container">
                            <!-- General Subsection - Services Table Fields -->
                            <div class="subsection-card" id="general-card">
                                <div class="subsection-header" onclick="toggleSubsection('general')">
                                    <div class="subsection-title-container">
                                        <span class="subsection-title">General (Services Data)</span>
                                        <span class="progress-badge" id="general-progress">0%</span>
                                    </div>
                                    <span class="subsection-expand-icon" id="general-icon">▼</span>
                                </div>
                                <div class="subsection-content" id="general-content">
                                    <div class="subsection-inner">
                                        <!-- Hidden fields -->
                                        <input type="hidden" name="ProjectID" id="ProjectID" value="${projectId || ''}">
                                        <input type="hidden" name="ServiceID" id="ServiceID" value="${serviceId || ''}">
                                        
                                        <div class="form-group">
                                            <label class="form-label">Primary Photo</label>
                                            <input type="file" class="form-input" name="PrimaryPhoto" id="PrimaryPhoto" accept="image/*" onchange="handleFieldChange(this, 'PrimaryPhoto')">
                                            <div id="PrimaryPhoto-preview" class="image-preview" style="margin-top: 10px; display: none;">
                                                <img id="PrimaryPhoto-img" src="" alt="Primary Photo Preview" style="max-width: 300px; max-height: 200px; border: 1px solid #ddd; border-radius: 4px; padding: 4px;">
                                                <p style="margin-top: 5px; font-size: 12px; color: #666;">Image uploaded successfully</p>
                                            </div>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Date of Inspection</label>
                                            <input type="date" class="form-input" name="DateOfInspection" id="DateOfInspection" onchange="handleFieldChange(this, 'DateOfInspection')">
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Type of Building</label>
                                            <select class="form-select" name="TypeOfBuilding" id="TypeOfBuilding" onchange="handleFieldChange(this, 'TypeOfBuilding')">
                                                <option value="">Select Building Type</option>
                                                <option value="Single Family">Single Family</option>
                                                <option value="Multi Family">Multi Family</option>
                                                <option value="Townhouse">Townhouse</option>
                                                <option value="Condominium">Condominium</option>
                                                <option value="Commercial">Commercial</option>
                                                <option value="Mixed Use">Mixed Use</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Style</label>
                                            <select class="form-select" name="Style" id="Style" onchange="handleFieldChange(this, 'Style')">
                                                <option value="">Select Style</option>
                                                <option value="Ranch">Ranch</option>
                                                <option value="Two Story">Two Story</option>
                                                <option value="Split Level">Split Level</option>
                                                <option value="Colonial">Colonial</option>
                                                <option value="Contemporary">Contemporary</option>
                                                <option value="Traditional">Traditional</option>
                                                <option value="Mediterranean">Mediterranean</option>
                                                <option value="Victorian">Victorian</option>
                                                <option value="Craftsman">Craftsman</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">In Attendance</label>
                                            <input type="text" class="form-input" name="InAttendance" id="InAttendance" placeholder="Names of people present" onblur="handleFieldChange(this, 'InAttendance')">
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Weather Conditions</label>
                                            <select class="form-select" name="WeatherConditions" id="WeatherConditions" onchange="handleFieldChange(this, 'WeatherConditions', this.value)">
                                                <option value="">Select Weather</option>
                                                <option value="Clear">Clear</option>
                                                <option value="Partly Cloudy">Partly Cloudy</option>
                                                <option value="Cloudy">Cloudy</option>
                                                <option value="Light Rain">Light Rain</option>
                                                <option value="Heavy Rain">Heavy Rain</option>
                                                <option value="Windy">Windy</option>
                                                <option value="Foggy">Foggy</option>
                                                <option value="Snow">Snow</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Outdoor Temperature (°F)</label>
                                            <input type="number" class="form-input" name="OutdoorTemperature" id="OutdoorTemperature" placeholder="e.g., 75" onblur="handleFieldChange(this, 'OutdoorTemperature')">
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Occupancy/Furnishings</label>
                                            <select class="form-select" name="OccupancyFurnishings" id="OccupancyFurnishings" onchange="handleFieldChange(this, 'OccupancyFurnishings', this.value)">
                                                <option value="">Select Status</option>
                                                <option value="Occupied - Furnished">Occupied - Furnished</option>
                                                <option value="Occupied - Partially Furnished">Occupied - Partially Furnished</option>
                                                <option value="Vacant - Furnished">Vacant - Furnished</option>
                                                <option value="Vacant - Partially Furnished">Vacant - Partially Furnished</option>
                                                <option value="Vacant - Unfurnished">Vacant - Unfurnished</option>
                                                <option value="Under Construction">Under Construction</option>
                                            </select>
                                        </div>
                                        
                                        <div id="saveStatus" style="margin-top: 10px; padding: 10px; border-radius: 4px; display: none;"></div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Information Subsection -->
                            <div class="subsection-card" id="information-card">
                                <div class="subsection-header" onclick="toggleSubsection('information')">
                                    <span class="subsection-title">Information</span>
                                    <span class="subsection-expand-icon" id="information-icon">▼</span>
                                </div>
                                <div class="subsection-content" id="information-content">
                                    <div class="subsection-inner">
                                        <div class="form-group">
                                            <label class="form-label">Requested Address</label>
                                            <input type="text" class="form-input" name="address" placeholder="Enter address">
                                        </div>
                                        
                                        <div class="form-row">
                                            <div class="form-group">
                                                <label class="form-label">City</label>
                                                <input type="text" class="form-input" name="city" placeholder="Missouri City">
                                            </div>
                                            <div class="form-group" style="flex: 0.3;">
                                                <label class="form-label">State</label>
                                                <select class="form-select" name="state">
                                                    <option value="TX">TX</option>
                                                </select>
                                            </div>
                                            <div class="form-group" style="flex: 0.3;">
                                                <label class="form-label">Zip</label>
                                                <input type="text" class="form-input" name="zip" placeholder="77489">
                                            </div>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Service Type</label>
                                            <select class="form-select" name="serviceType">
                                                <option value="">Select Service</option>
                                                <option value="Engineers Damaged Truss Evaluation">Engineer's Damaged Truss Evaluation</option>
                                                <option value="Engineers Foundation Evaluation">Engineer's Foundation Evaluation</option>
                                                <option value="Standard Repair Permit">Standard Repair Permit and Printing Results</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">CalCities ID</label>
                                            <input type="text" class="form-input" name="calcitiesId" placeholder="(Optional)">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Foundation Subsection -->
                            <div class="subsection-card" id="foundation-card">
                                <div class="subsection-header" onclick="toggleSubsection('foundation')">
                                    <span class="subsection-title">Foundation</span>
                                    <span class="subsection-expand-icon" id="foundation-icon">▼</span>
                                </div>
                                <div class="subsection-content" id="foundation-content">
                                    <div class="subsection-inner">
                                        <div class="form-group">
                                            <label class="form-label">Foundation Type</label>
                                            <select class="form-select" name="foundationType">
                                                <option value="">Select Foundation Type</option>
                                                <option value="Slab">Slab</option>
                                                <option value="Pier and Beam">Pier and Beam</option>
                                                <option value="Basement">Basement</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Foundation Condition</label>
                                            <select class="form-select" name="foundationCondition">
                                                <option value="">Select Condition</option>
                                                <option value="Good">Good</option>
                                                <option value="Fair">Fair</option>
                                                <option value="Poor">Poor</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label class="form-label">Foundation Notes</label>
                                            <textarea class="form-textarea" name="foundationNotes" placeholder="Enter foundation observations and notes"></textarea>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Structural Systems Section -->
            <div class="section-card" id="section-2">
                <div class="section-header" onclick="toggleSection(2)">
                    <div>
                        <div class="section-title">🏗️ Structural Systems</div>
                        <div class="section-description">Upload inspection reports and documents</div>
                    </div>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="form-group">
                            <label class="form-label">Home Inspection Report</label>
                            <div class="file-upload-container">
                                <button type="button" class="file-button">
                                    📎 Choose File
                                </button>
                                <span>No file chosen</span>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">or Home Inspection Link</label>
                            <input type="url" class="form-input" name="inspectionLink" placeholder="Enter link">
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Engineer's Evaluation Report</label>
                            <div class="file-upload-container">
                                <button type="button" class="file-button">
                                    📎 Choose File
                                </button>
                                <span>No file chosen</span>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">or Engineer's Evaluation Link</label>
                            <input type="url" class="form-input" name="evaluationLink" placeholder="Enter link">
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Support Document</label>
                            <div class="file-upload-container">
                                <button type="button" class="file-button">
                                    📎 Choose File
                                </button>
                                <span>No file chosen</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Elevation Plot Section -->
            <div class="section-card" id="section-3">
                <div class="section-header" onclick="toggleSection(3)">
                    <div>
                        <div class="section-title">📊 Elevation Plot</div>
                        <div class="section-description">Additional notes and measurements</div>
                    </div>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="form-group">
                            <label class="form-label">Notes</label>
                            <textarea class="form-textarea" name="notes" placeholder="Enter any additional notes or comments"></textarea>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Submit Section -->
            <div class="submit-card">
                <div class="submit-row">
                    <div class="fee-display">Service Fee: $285.00</div>
                    <button type="submit" class="submit-button">Submit</button>
                </div>
            </div>
        </form>
    </div>
    
    <script>
        let currentSection = 0;
        let currentServiceID = null;
        let saveTimeout = null;
        let fieldStates = {};
        
        // Function to handle field changes
        function handleFieldChange(element, fieldName) {
            const value = element.value || (element.files && element.files[0] ? element.files[0].name : '');
            
            // Update visual state
            if (value) {
                element.classList.add('has-value');
                element.closest('.form-group').classList.add('completed');
                fieldStates[fieldName] = true;
            } else {
                element.classList.remove('has-value');
                element.closest('.form-group').classList.remove('completed');
                fieldStates[fieldName] = false;
            }
            
            // Update progress
            updateSectionProgress();
            
            // Handle file upload separately
            if (element.type === 'file' && element.files && element.files[0]) {
                autoSaveFile(fieldName, element.files[0]);
            } else {
                // Auto-save regular fields
                autoSaveField(fieldName, value);
            }
        }
        
        // Function to handle file uploads
        async function autoSaveFile(fieldName, file) {
            if (!currentServiceID) {
                showSaveStatus('No service record found', 'error');
                return;
            }
            
            showSaveStatus('Uploading file...', 'info');
            
            try {
                const formData = new FormData();
                formData.append(fieldName, file);
                
                const response = await fetch('/api/caspio/Services/file/' + currentServiceID, {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const result = await response.json();
                    showSaveStatus('File uploaded', 'success');
                    
                    // Show image preview
                    if (fieldName === 'PrimaryPhoto' && file) {
                        const reader = new FileReader();
                        reader.onload = function(e) {
                            const previewDiv = document.getElementById('PrimaryPhoto-preview');
                            const previewImg = document.getElementById('PrimaryPhoto-img');
                            if (previewDiv && previewImg) {
                                // Use the data URL from FileReader for immediate preview
                                previewImg.src = e.target.result;
                                previewDiv.style.display = 'block';
                                
                                // If we got a file URL from the server, we could also use that
                                if (result.fileUrl) {
                                    // Store the Caspio URL for later use if needed
                                    previewImg.setAttribute('data-caspio-url', result.fileUrl);
                                }
                            }
                        };
                        reader.readAsDataURL(file);
                    }
                    
                    setTimeout(() => hideStatus(), 2000);
                } else {
                    showSaveStatus('Error uploading file', 'error');
                }
            } catch (error) {
                console.error('File upload error:', error);
                showSaveStatus('Error uploading file', 'error');
            }
        }
        
        // Function to save project field to Projects table
        window.saveProjectField = async function(fieldName, value) {
            const projectId = document.getElementById('ProjectID').value;
            if (!projectId) {
                console.error('No ProjectID found');
                return;
            }
            
            showSaveStatus('Saving...', 'saving');
            
            try {
                const response = await fetch('/api/save-project-field', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        projectId: projectId,
                        fieldName: fieldName,
                        value: value
                    })
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showSaveStatus('Saved', 'success');
                    
                    // Mark field as having value for progress tracking
                    if (value) {
                        const element = document.getElementById(fieldName);
                        if (element) {
                            element.classList.add('has-value');
                            element.closest('.form-group').classList.add('completed');
                        }
                    }
                    
                    setTimeout(() => hideStatus(), 2000);
                } else {
                    showSaveStatus('Error saving', 'error');
                    console.error('Error saving project field:', result.error);
                }
            } catch (error) {
                console.error('Error saving project field:', error);
                showSaveStatus('Error saving', 'error');
            }
        }
        
        // Function to calculate and update section progress
        function updateSectionProgress() {
            // General section fields
            const generalFields = ['PrimaryPhoto', 'DateOfInspection', 'TypeOfBuilding', 'Style', 
                                  'InAttendance', 'WeatherConditions', 'OutdoorTemperature', 'OccupancyFurnishings'];
            
            let generalCompleted = 0;
            generalFields.forEach(field => {
                if (fieldStates[field]) generalCompleted++;
            });
            
            const generalProgress = Math.round((generalCompleted / generalFields.length) * 100);
            const generalBadge = document.getElementById('general-progress');
            if (generalBadge) {
                generalBadge.textContent = generalProgress + '%';
                generalBadge.className = 'progress-badge';
                if (generalProgress === 100) {
                    generalBadge.classList.add('complete');
                } else if (generalProgress > 0) {
                    generalBadge.classList.add('partial');
                }
            }
        }
        
        // Function to load existing project data
        async function loadProjectData() {
            const projectId = document.getElementById('ProjectID').value;
            if (!projectId) {
                console.log('No ProjectID found');
                return;
            }
            
            try {
                const response = await fetch(\`/api/get-project/\${projectId}\`);
                if (response.ok) {
                    const data = await response.json();
                    console.log('Loaded project data:', data);
                    
                    // Populate the Project Details fields
                    const projectFields = [
                        'ClientName', 'AgentName', 'InspectorName', 'YearBuilt', 'SquareFeet',
                        'TypeOfBuilding', 'Style', 'InAttendance', 'WeatherConditions', 
                        'OutdoorTemperature', 'OccupancyFurnishings', 'FirstFoundationType',
                        'SecondFoundationType', 'SecondFoundationRooms', 'ThirdFoundationType',
                        'ThirdFoundationRooms', 'OwnerOccupantInterview'
                    ];
                    
                    projectFields.forEach(fieldName => {
                        const element = document.getElementById(fieldName);
                        if (element && data[fieldName]) {
                            element.value = data[fieldName];
                            // Mark as having value for visual feedback
                            element.classList.add('has-value');
                            element.closest('.form-group').classList.add('completed');
                        }
                    });
                }
            } catch (error) {
                console.error('Error loading project data:', error);
            }
        }
        
        // Initialize field states on page load
        function initializeFieldStates() {
            // Check all form fields for existing values
            document.querySelectorAll('.form-input, .form-select, .form-textarea').forEach(element => {
                const fieldName = element.name || element.id;
                if (element.value) {
                    element.classList.add('has-value');
                    element.closest('.form-group')?.classList.add('completed');
                    fieldStates[fieldName] = true;
                }
            });
            updateSectionProgress();
        }
        
        // Initialize or get ServiceID on page load
        window.addEventListener('load', async function() {
            const projectId = '${projectId}';
            const providedServiceId = '${serviceId}';
            
            // If ServiceID is provided, use it directly
            if (providedServiceId && providedServiceId !== 'new') {
                currentServiceID = providedServiceId;
                document.getElementById('ServiceID').value = currentServiceID;
                document.getElementById('serviceIdDisplay').textContent = currentServiceID;
                document.getElementById('pkIdDisplay').textContent = currentServiceID;
                console.log('Using Services record PK_ID:', currentServiceID);
                console.log('ProjectID:', projectId);
                
                // Load existing data for this specific Services record
                try {
                    const response = await fetch('/api/caspio/Services/' + currentServiceID);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.record) {
                            console.log('Services record loaded:', data.record);
                            console.log('  - PK_ID (record ID):', data.record.PK_ID);
                            console.log('  - ProjectID:', data.record.ProjectID);
                            console.log('  - ServiceID field:', data.record.ServiceID);
                            console.log('  - TypeID:', data.record.TypeID);
                            
                            // Update the hidden ProjectID field with the actual ProjectID
                            if (data.record.ProjectID) {
                                document.getElementById('ProjectID').value = data.record.ProjectID;
                                console.log('Updated ProjectID hidden field to:', data.record.ProjectID);
                            }
                            
                            loadExistingData(data.record);
                            setTimeout(initializeFieldStates, 100);
                        }
                    } else {
                        console.warn('Services record not found for PK_ID:', currentServiceID);
                    }
                } catch (error) {
                    console.error('Error loading Services data:', error);
                }
            } else if (projectId) {
                // If no ServiceID provided, check if we should create a new one
                // Note: We're checking by ProjectID field value, not PK_ID
                try {
                    const response = await fetch('/api/caspio/Services/check/' + projectId);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.exists && data.ServiceID) {
                            currentServiceID = data.ServiceID;
                            document.getElementById('ServiceID').value = currentServiceID;
                            console.log('Found existing Services record with ServiceID:', currentServiceID);
                            
                            // Update the hidden ProjectID field with the actual ProjectID
                            if (data.record && data.record.ProjectID) {
                                document.getElementById('ProjectID').value = data.record.ProjectID;
                                console.log('Updated ProjectID hidden field to:', data.record.ProjectID);
                            }
                            
                            // Load existing data
                            loadExistingData(data.record);
                            // Initialize field states after loading data
                            setTimeout(initializeFieldStates, 100);
                            // Load project data for Project Details section
                            loadProjectData();
                        } else {
                            console.log('No Services record found, creating new one');
                            // Create new Services record
                            await createServiceRecord();
                        }
                    }
                } catch (error) {
                    console.error('Error checking Services:', error);
                    // Create new record on error
                    await createServiceRecord();
                }
            }
        });
        
        async function createServiceRecord() {
            const pkId = '${projectId}';  // This is actually PK_ID from URL
            try {
                // First get the actual ProjectID from the Projects table
                const projectResponse = await fetch('/api/caspio/Projects/' + pkId);
                if (!projectResponse.ok) {
                    console.error('Failed to fetch project details');
                    showSaveStatus('Error: Could not fetch project', 'error');
                    return;
                }
                
                const projectData = await projectResponse.json();
                const actualProjectId = projectData.ProjectID;
                console.log('Creating Services record with ProjectID:', actualProjectId);
                
                // Update the hidden ProjectID field with the actual ProjectID
                document.getElementById('ProjectID').value = actualProjectId;
                console.log('Updated ProjectID hidden field to:', actualProjectId);
                
                const response = await fetch('/api/caspio/Services', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ProjectID: actualProjectId
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    currentServiceID = data.ServiceID;
                    document.getElementById('ServiceID').value = currentServiceID;
                    showSaveStatus('Service record created', 'success');
                    // Initialize field states
                    initializeFieldStates();
                    // Load project data for Project Details section
                    loadProjectData();
                }
            } catch (error) {
                console.error('Error creating service record:', error);
                showSaveStatus('Error creating service record', 'error');
            }
        }
        
        function loadExistingData(record) {
            console.log('Loading existing data:', record);
            
            // Load existing data into form fields
            for (const [key, value] of Object.entries(record)) {
                if (value === null || value === undefined) continue;
                
                const field = document.getElementById(key);
                
                // Handle file fields differently
                if (key === 'PrimaryPhoto' && value) {
                    console.log('Loading PrimaryPhoto:', value);
                    // Show image preview for existing photo
                    const previewDiv = document.getElementById('PrimaryPhoto-preview');
                    const previewImg = document.getElementById('PrimaryPhoto-img');
                    if (previewDiv && previewImg) {
                        // Value should already be the full URL if we saved it correctly
                        let imageUrl = value;
                        
                        // If it starts with http, it's already a full URL
                        if (imageUrl.startsWith('http')) {
                            // For Caspio files, we need to extract the ExternalKey and filename
                            // URL format: https://c2hcf092.caspio.com/dp/37d2600004f63e8fb40647078302/files/{externalKey}/{filename}
                            const urlMatch = imageUrl.match(/\\/files\\/([^\\/]+)\\/(.+)$/);
                            if (urlMatch) {
                                const externalKey = urlMatch[1];
                                const filename = urlMatch[2];
                                
                                console.log('External Key:', externalKey, 'Filename:', filename);
                                
                                // Use our proxy endpoint to fetch the image with authentication
                                const proxyUrl = '/api/caspio/files/' + externalKey;
                                
                                previewImg.onerror = function() {
                                    console.error('Failed to load image from proxy URL, trying direct URL');
                                    // Fallback to direct URL (might work for public files)
                                    previewImg.src = imageUrl;
                                };
                                
                                previewImg.onload = function() {
                                    console.log('Image loaded successfully');
                                    previewDiv.style.display = 'block';
                                };
                                
                                // Try our proxy endpoint first
                                console.log('Loading image via proxy:', proxyUrl);
                                previewImg.src = proxyUrl;
                            } else {
                                // Try the URL as-is
                                previewImg.src = imageUrl;
                                previewDiv.style.display = 'block';
                            }
                        } else {
                            // For older records that might just have the filename
                            console.log('PrimaryPhoto is not a full URL:', value);
                            previewDiv.style.display = 'none';
                        }
                        
                        // Mark field as completed if we have a value
                        if (value) {
                            fieldStates['PrimaryPhoto'] = true;
                            updateSectionProgress();
                        }
                    }
                } else if (key === 'DateOfInspection' && value && field) {
                    // Handle date fields - Caspio might return dates in different formats
                    console.log('Loading DateOfInspection:', value);
                    // Convert Caspio date format to HTML date input format (YYYY-MM-DD)
                    if (value && typeof value === 'string' && value.includes('T')) {
                        // If it's in ISO format, extract just the date part
                        field.value = value.split('T')[0];
                    } else {
                        field.value = value;
                    }
                    // Mark as completed
                    fieldStates['DateOfInspection'] = true;
                } else if (field) {
                    // Regular fields
                    field.value = value;
                    // Mark as completed if value exists
                    if (value) {
                        fieldStates[key] = true;
                    }
                }
            }
            
            // Update all section progress after loading
            updateSectionProgress();
            showSaveStatus('Existing data loaded', 'success');
        }
        
        function autoSaveField(fieldName, value) {
            // Clear existing timeout
            if (saveTimeout) {
                clearTimeout(saveTimeout);
            }
            
            // Show saving indicator
            showSaveStatus('Saving...', 'info');
            
            // Debounce the save by 1 second
            saveTimeout = setTimeout(async () => {
                if (!currentServiceID) {
                    showSaveStatus('No service record found', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/api/caspio/Services/' + currentServiceID, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            [fieldName]: value
                        })
                    });
                    
                    if (response.ok) {
                        showSaveStatus('Saved', 'success');
                        setTimeout(() => hideStatus(), 2000);
                    } else {
                        showSaveStatus('Error saving', 'error');
                    }
                } catch (error) {
                    console.error('Auto-save error:', error);
                    showSaveStatus('Error saving', 'error');
                }
            }, 1000);
        }
        
        function showSaveStatus(message, type) {
            const statusDiv = document.getElementById('saveStatus');
            statusDiv.textContent = message;
            statusDiv.style.display = 'block';
            statusDiv.style.background = type === 'success' ? '#d4edda' : 
                                        type === 'error' ? '#f8d7da' : 
                                        '#d1ecf1';
            statusDiv.style.color = type === 'success' ? '#155724' : 
                                   type === 'error' ? '#721c24' : 
                                   '#0c5460';
        }
        
        function hideStatus() {
            const statusDiv = document.getElementById('saveStatus');
            statusDiv.style.display = 'none';
        }
        
        window.toggleSection = function(sectionNum) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            
            // Handle both numeric and string section IDs
            let sectionId;
            if (sectionNum === 'project-details') {
                sectionId = 'project-details-section';
            } else {
                sectionId = 'section-' + sectionNum;
            }
            
            const section = document.getElementById(sectionId);
            if (!section) {
                console.error('Section not found:', sectionId);
                return;
            }
            const wasExpanded = section.classList.contains('expanded');
            
            // Close all sections
            document.querySelectorAll('.section-card').forEach(card => {
                card.classList.remove('expanded', 'active');
            });
            
            // Open clicked section if it wasn't already open
            if (!wasExpanded) {
                section.classList.add('expanded', 'active');
                currentSection = sectionNum;
                updateProgress(sectionNum);
            } else {
                currentSection = 0;
                updateProgress(0);
            }
        }
        
        function toggleSubsection(subsectionName) {
            event.stopPropagation(); // Prevent bubbling to parent section
            
            // Only toggle if clicking on the header, not the content
            if (event.target.closest('.subsection-content')) {
                return; // Don't toggle if clicking inside content area
            }
            
            const subsectionCard = document.getElementById(subsectionName + '-card');
            const subsectionContent = document.getElementById(subsectionName + '-content');
            const subsectionIcon = document.getElementById(subsectionName + '-icon');
            
            // Toggle the clicked subsection
            if (subsectionCard && subsectionCard.classList.contains('expanded')) {
                subsectionCard.classList.remove('expanded');
            } else if (subsectionCard) {
                subsectionCard.classList.add('expanded');
            }
        }
        
        function updateProgress(sectionNum) {
            // Reset all dots
            document.querySelectorAll('.progress-dot').forEach(dot => {
                dot.classList.remove('active', 'completed');
            });
            
            // Mark completed sections
            for (let i = 1; i < sectionNum; i++) {
                document.getElementById('dot-' + i).classList.add('completed');
            }
            
            // Mark active section
            if (sectionNum > 0) {
                document.getElementById('dot-' + sectionNum).classList.add('active');
            }
        }
        
        document.getElementById('templateForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Collect form data
            const formData = new FormData(e.target);
            const data = {};
            for (let [key, value] of formData.entries()) {
                data[key] = value;
            }
            
            // Show loading state
            const submitButton = e.target.querySelector('.submit-button');
            const originalText = submitButton.textContent;
            submitButton.textContent = 'Saving to Caspio...';
            submitButton.disabled = true;
            
            try {
                // Save to Services table
                const serviceData = {
                    ProjectID: data.ProjectID || '${projectId}',
                    ServiceID: data.ServiceID || '${offersId}',
                    YearBuilt: data.YearBuilt || '',
                    SquareFootage: data.SquareFootage || '',
                    FoundationType: data.FoundationType || '',
                    NumberOfStories: data.NumberOfStories || '',
                    ExteriorCladding: data.ExteriorCladding || '',
                    InteriorWallCovering: data.InteriorWallCovering || '',
                    RoofType: data.RoofType || '',
                    GarageType: data.GarageType || '',
                    PoolPresent: data.PoolPresent || '',
                    OutbuildingPresent: data.OutbuildingPresent || '',
                    PreviousFoundationRepair: data.PreviousFoundationRepair || '',
                    Observations: data.Observations || '',
                    Recommendations: data.Recommendations || '',
                    DateCreated: new Date().toISOString(),
                    CreatedBy: data.CreatedBy || 'User',
                    DateModified: new Date().toISOString(),
                    ModifiedBy: data.ModifiedBy || 'User'
                };
                
                // Send to Caspio via our server endpoint
                const response = await fetch('/api/caspio/Services', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(serviceData)
                });
                
                if (!response.ok) {
                    throw new Error('Failed to save to Caspio: ' + response.statusText);
                }
                
                const result = await response.json();
                
                // Show success message
                alert('Data successfully saved to Caspio!\\n\\nService Record ID: ' + (result.ServiceID || 'Created'));
                
                // Optionally redirect back to project
                if (confirm('Return to project details?')) {
                    window.location.href = '/project/${projectId}';
                }
                
            } catch (error) {
                console.error('Error saving to Caspio:', error);
                alert('Error saving data: ' + error.message);
            } finally {
                submitButton.textContent = originalText;
                submitButton.disabled = false;
            }
        });
    </script>
</body>
</html>
      `;
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      console.error('Error loading template:', err);
      res.writeHead(500);
      res.end('Error loading template');
    }
  } else if (pathname.startsWith('/project/')) {
    // Extract project ID from URL
    const projectId = pathname.replace('/project/', '');
    try {
      const project = await fetchProjectById(projectId);
      const html = await generateProjectDetailHTML(project);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      console.error('Error loading project:', err);
      res.writeHead(500);
      res.end('Error loading project details');
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`
========================================
Caspio Development Server Running!
========================================

Local:    http://localhost:${PORT}
Network:  http://172.30.107.220:${PORT}

This server fetches REAL data from Caspio!
Page auto-refreshes every 10 seconds.

Press Ctrl+C to stop the server
========================================
  `);
  
  // Fetch states to understand StateID format
  console.log('\n🔍 Checking StateID format from Caspio States table...');
  try {
    await fetchStates();
  } catch (err) {
    console.error('❌ Error fetching states:', err.message);
  }
});

// ============================================================================
// MOBILE APP FUNCTIONS - Client-side JavaScript for Mobile Deployment
// ============================================================================
// These functions should be included in your mobile app's JavaScript
// They replace server-side functionality with client-side equivalents

// Mobile App Configuration
const MOBILE_CONFIG = {
  CASPIO_API_BASE: 'https://c2hcf092.caspio.com/rest/v2',
  CLIENT_ID: 'a8e63f3e7e8f5034e4e890a0d967bc90e2df89b31e064e259e',
  CLIENT_SECRET: '49e4e8adb30e4b44af9e96f006e63c37e23e757c7c394e329e',
  ACCESS_TOKEN: null,
  TOKEN_EXPIRY: null
};

// Mobile: Authenticate with Caspio
async function mobileAuthenticate() {
  try {
    const response = await fetch('https://c2hcf092.caspio.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&client_id=' + MOBILE_CONFIG.CLIENT_ID + 
            '&client_secret=' + MOBILE_CONFIG.CLIENT_SECRET
    });
    
    if (response.ok) {
      const data = await response.json();
      MOBILE_CONFIG.ACCESS_TOKEN = data.access_token;
      MOBILE_CONFIG.TOKEN_EXPIRY = Date.now() + (data.expires_in * 1000);
      localStorage.setItem('caspio_token', data.access_token);
      localStorage.setItem('caspio_token_expiry', MOBILE_CONFIG.TOKEN_EXPIRY);
      return data.access_token;
    }
  } catch (error) {
    console.error('Mobile authentication failed:', error);
  }
}

// Mobile: Get valid token (refresh if needed)
async function getMobileToken() {
  if (MOBILE_CONFIG.ACCESS_TOKEN && MOBILE_CONFIG.TOKEN_EXPIRY > Date.now()) {
    return MOBILE_CONFIG.ACCESS_TOKEN;
  }
  return await mobileAuthenticate();
}

// Mobile: Load template view (replaces server-side template generation)
async function loadTemplateView(offersId, projectId, serviceId) {
  try {
    // Get token
    const token = await getMobileToken();
    
    // Fetch service data if serviceId provided
    let serviceData = null;
    if (serviceId && serviceId !== 'new') {
      const serviceResponse = await fetch(
        MOBILE_CONFIG.CASPIO_API_BASE + '/tables/Services/records?q.where=PK_ID=' + serviceId,
        {
          headers: { 'Authorization': 'Bearer ' + token }
        }
      );
      if (serviceResponse.ok) {
        const data = await serviceResponse.json();
        if (data.Result && data.Result.length > 0) {
          serviceData = data.Result[0];
        }
      }
    }
    
    // Generate template HTML
    const templateHTML = generateMobileTemplate(offersId, projectId, serviceId, serviceData);
    
    // Replace current view with template
    document.getElementById('app').innerHTML = templateHTML;
    
    // Initialize template functions
    initializeMobileTemplate(projectId, serviceId, serviceData);
    
  } catch (error) {
    console.error('Error loading template:', error);
    alert('Failed to load template. Please try again.');
  }
}

// Mobile: Generate template HTML (client-side)
function generateMobileTemplate(offersId, projectId, serviceId, serviceData) {
  const actualProjectId = serviceData ? serviceData.ProjectID : projectId;
  
  return `
    <div class="template-container">
      <div class="template-header">
        <button onclick="backToProject()" class="back-button">← Back</button>
        <h1>Service Template</h1>
      </div>
      
      <div class="template-info">
        <p>Project ID: <span id="projectIdDisplay">${actualProjectId}</span></p>
        <p>Service Record ID: <span id="serviceIdDisplay">${serviceId || 'New'}</span></p>
      </div>
      
      <!-- Project Details Section -->
      <div class="section-card" id="project-details-section">
        <div class="section-header" onclick="toggleMobileSection('project-details')">
          <div>
            <div class="section-title">
              <span class="icon-placeholder">P</span>
              Project Details
            </div>
            <div class="section-description">Client and property information</div>
          </div>
          <span class="expand-icon">▼</span>
        </div>
        <div class="section-content" style="display: none;">
          <div class="section-inner">
            <input type="hidden" id="ProjectID" value="${actualProjectId}">
            <input type="hidden" id="ServiceID" value="${serviceId}">
            
            <div class="form-row">
              <div class="form-group">
                <label>Client Name</label>
                <input type="text" id="ClientName" class="form-input" 
                       onblur="mobileAutoSave('ClientName', this.value)">
              </div>
              <div class="form-group">
                <label>Agent Name</label>
                <input type="text" id="AgentName" class="form-input"
                       onblur="mobileAutoSave('AgentName', this.value)">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Inspector Name</label>
                <input type="text" id="InspectorName" class="form-input"
                       onblur="mobileAutoSave('InspectorName', this.value)">
              </div>
              <div class="form-group">
                <label>Year Built</label>
                <input type="number" id="YearBuilt" class="form-input"
                       onblur="mobileAutoSave('YearBuilt', this.value)">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Square Feet</label>
                <input type="number" id="SquareFeet" class="form-input"
                       onblur="mobileAutoSave('SquareFeet', this.value)">
              </div>
              <div class="form-group">
                <label>Type of Building</label>
                <select id="TypeOfBuilding" class="form-select"
                        onchange="mobileAutoSave('TypeOfBuilding', this.value)">
                  <option value="">Select Type</option>
                  <option value="Single Family">Single Family</option>
                  <option value="Multi Family">Multi Family</option>
                  <option value="Townhouse">Townhouse</option>
                  <option value="Condominium">Condominium</option>
                  <option value="Commercial">Commercial</option>
                </select>
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Style</label>
                <select id="Style" class="form-select"
                        onchange="mobileAutoSave('Style', this.value)">
                  <option value="">Select Style</option>
                  <option value="Ranch">Ranch</option>
                  <option value="Two Story">Two Story</option>
                  <option value="Split Level">Split Level</option>
                  <option value="Colonial">Colonial</option>
                  <option value="Contemporary">Contemporary</option>
                  <option value="Traditional">Traditional</option>
                </select>
              </div>
              <div class="form-group">
                <label>In Attendance</label>
                <input type="text" id="InAttendance" class="form-input"
                       onblur="mobileAutoSave('InAttendance', this.value)">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Weather Conditions</label>
                <input type="text" id="WeatherConditions" class="form-input"
                       onblur="mobileAutoSave('WeatherConditions', this.value)">
              </div>
              <div class="form-group">
                <label>Outdoor Temperature</label>
                <input type="text" id="OutdoorTemperature" class="form-input"
                       onblur="mobileAutoSave('OutdoorTemperature', this.value)">
              </div>
            </div>
            
            <div class="form-group">
              <label>Occupancy/Furnishings</label>
              <select id="OccupancyFurnishings" class="form-select"
                      onchange="mobileAutoSave('OccupancyFurnishings', this.value)">
                <option value="">Select Status</option>
                <option value="Vacant">Vacant</option>
                <option value="Occupied">Occupied</option>
                <option value="Partially Furnished">Partially Furnished</option>
                <option value="Fully Furnished">Fully Furnished</option>
              </select>
            </div>
            
            <h3>Foundation Information</h3>
            
            <div class="form-row">
              <div class="form-group">
                <label>First Foundation Type</label>
                <select id="FirstFoundationType" class="form-select"
                        onchange="mobileAutoSave('FirstFoundationType', this.value)">
                  <option value="">Select Type</option>
                  <option value="Slab">Slab</option>
                  <option value="Crawl Space">Crawl Space</option>
                  <option value="Basement">Basement</option>
                  <option value="Pier and Beam">Pier and Beam</option>
                </select>
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Second Foundation Type</label>
                <select id="SecondFoundationType" class="form-select"
                        onchange="mobileAutoSave('SecondFoundationType', this.value)">
                  <option value="">Select Type</option>
                  <option value="Slab">Slab</option>
                  <option value="Crawl Space">Crawl Space</option>
                  <option value="Basement">Basement</option>
                  <option value="Pier and Beam">Pier and Beam</option>
                </select>
              </div>
              <div class="form-group">
                <label>Second Foundation Rooms</label>
                <input type="text" id="SecondFoundationRooms" class="form-input"
                       onblur="mobileAutoSave('SecondFoundationRooms', this.value)">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label>Third Foundation Type</label>
                <select id="ThirdFoundationType" class="form-select"
                        onchange="mobileAutoSave('ThirdFoundationType', this.value)">
                  <option value="">Select Type</option>
                  <option value="Slab">Slab</option>
                  <option value="Crawl Space">Crawl Space</option>
                  <option value="Basement">Basement</option>
                  <option value="Pier and Beam">Pier and Beam</option>
                </select>
              </div>
              <div class="form-group">
                <label>Third Foundation Rooms</label>
                <input type="text" id="ThirdFoundationRooms" class="form-input"
                       onblur="mobileAutoSave('ThirdFoundationRooms', this.value)">
              </div>
            </div>
            
            <div class="form-group">
              <label>Owner/Occupant Interview</label>
              <textarea id="OwnerOccupantInterview" class="form-input" rows="4"
                        onblur="mobileAutoSave('OwnerOccupantInterview', this.value)"></textarea>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Additional template sections would go here -->
      
      <div id="saveStatus" class="save-status" style="display: none;"></div>
    </div>
  `;
}

// Mobile: Initialize template functionality
async function initializeMobileTemplate(projectId, serviceId, serviceData) {
  // Load existing project data
  await loadMobileProjectData(projectId);
  
  // If we have service data, populate service-specific fields
  if (serviceData) {
    // Populate any service-specific fields here
    console.log('Service data loaded:', serviceData);
  }
}

// Mobile: Load project data
async function loadMobileProjectData(projectId) {
  try {
    const token = await getMobileToken();
    const response = await fetch(
      MOBILE_CONFIG.CASPIO_API_BASE + '/tables/Projects/records?q.where=ProjectID=' + projectId,
      {
        headers: { 'Authorization': 'Bearer ' + token }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      if (data.Result && data.Result.length > 0) {
        const projectData = data.Result[0];
        
        // Populate all project fields
        const fields = [
          'ClientName', 'AgentName', 'InspectorName', 'YearBuilt', 'SquareFeet',
          'TypeOfBuilding', 'Style', 'InAttendance', 'WeatherConditions',
          'OutdoorTemperature', 'OccupancyFurnishings', 'FirstFoundationType',
          'SecondFoundationType', 'SecondFoundationRooms', 'ThirdFoundationType',
          'ThirdFoundationRooms', 'OwnerOccupantInterview'
        ];
        
        fields.forEach(field => {
          const element = document.getElementById(field);
          if (element && projectData[field]) {
            element.value = projectData[field];
          }
        });
      }
    }
  } catch (error) {
    console.error('Error loading project data:', error);
  }
}

// Mobile: Auto-save function for project fields
async function mobileAutoSave(fieldName, value) {
  const projectId = document.getElementById('ProjectID').value;
  if (!projectId) {
    console.error('No ProjectID found');
    return;
  }
  
  showMobileSaveStatus('Saving...', 'saving');
  
  try {
    const token = await getMobileToken();
    
    // First get the PK_ID for this ProjectID
    const getResponse = await fetch(
      MOBILE_CONFIG.CASPIO_API_BASE + '/tables/Projects/records?q.where=ProjectID=' + projectId,
      {
        headers: { 'Authorization': 'Bearer ' + token }
      }
    );
    
    if (!getResponse.ok) {
      showMobileSaveStatus('Error: Project not found', 'error');
      return;
    }
    
    const projectData = await getResponse.json();
    if (!projectData.Result || projectData.Result.length === 0) {
      showMobileSaveStatus('Error: Project not found', 'error');
      return;
    }
    
    const pkId = projectData.Result[0].PK_ID;
    
    // Update the field
    const updateData = { [fieldName]: value };
    
    const updateResponse = await fetch(
      MOBILE_CONFIG.CASPIO_API_BASE + '/tables/Projects/records?q.where=PK_ID=' + pkId,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      }
    );
    
    if (updateResponse.ok) {
      showMobileSaveStatus('Saved', 'success');
      setTimeout(() => hideMobileSaveStatus(), 2000);
    } else {
      showMobileSaveStatus('Error saving', 'error');
    }
  } catch (error) {
    console.error('Error saving field:', error);
    showMobileSaveStatus('Error saving', 'error');
  }
}

// Mobile: Show save status
function showMobileSaveStatus(message, type) {
  const statusDiv = document.getElementById('saveStatus');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = 'save-status ' + type;
    statusDiv.style.display = 'block';
  }
}

// Mobile: Hide save status
function hideMobileSaveStatus() {
  const statusDiv = document.getElementById('saveStatus');
  if (statusDiv) {
    statusDiv.style.display = 'none';
  }
}

// Mobile: Toggle section visibility
function toggleMobileSection(sectionId) {
  const section = document.getElementById(sectionId + '-section');
  if (section) {
    const content = section.querySelector('.section-content');
    const icon = section.querySelector('.expand-icon');
    
    if (content.style.display === 'none') {
      content.style.display = 'block';
      icon.textContent = '▲';
    } else {
      content.style.display = 'none';
      icon.textContent = '▼';
    }
  }
}

// Mobile: Navigate back to project view
function backToProject() {
  // Reload the project detail view
  // This would be implemented based on your mobile app's navigation
  window.location.reload(); // Or use your app's navigation method
}

// Mobile: CSS styles for template (add to your mobile app's CSS)
const mobileTemplateStyles = `
  .template-container {
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
  }
  
  .template-header {
    display: flex;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid #e0e0e0;
  }
  
  .back-button {
    padding: 8px 16px;
    background: #6c757d;
    color: white;
    border: none;
    border-radius: 4px;
    margin-right: 20px;
    cursor: pointer;
  }
  
  .template-info {
    background: #f8f9fa;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
  }
  
  .section-card {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    margin-bottom: 20px;
    overflow: hidden;
  }
  
  .section-header {
    padding: 15px;
    background: #f8f9fa;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .section-title {
    font-size: 18px;
    font-weight: 600;
    display: flex;
    align-items: center;
  }
  
  .icon-placeholder {
    display: inline-block;
    width: 24px;
    height: 24px;
    background: #4CAF50;
    color: white;
    border-radius: 4px;
    text-align: center;
    line-height: 24px;
    margin-right: 10px;
    font-weight: bold;
  }
  
  .section-content {
    padding: 20px;
  }
  
  .form-row {
    display: flex;
    gap: 20px;
    margin-bottom: 20px;
  }
  
  .form-group {
    flex: 1;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
    color: #333;
  }
  
  .form-input, .form-select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  }
  
  .save-status {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 10px 20px;
    border-radius: 4px;
    font-weight: 500;
    z-index: 1000;
  }
  
  .save-status.saving {
    background: #ffc107;
    color: #000;
  }
  
  .save-status.success {
    background: #28a745;
    color: white;
  }
  
  .save-status.error {
    background: #dc3545;
    color: white;
  }
`;

// ============================================================================
// END MOBILE APP FUNCTIONS
// ============================================================================
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

// Helper function to create Service_EFE record
async function createServiceEFERecord(projectId) {
  const token = await getCaspioToken();
  
  return new Promise((resolve, reject) => {
    const serviceData = {
      ProjectID: projectId
    };
    
    const postData = JSON.stringify(serviceData);
    
    const options = {
      hostname: 'c2hcf092.caspio.com',
      path: '/rest/v2/tables/Service_EFE/records',
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
          console.log('✅ Service_EFE record created for project:', projectId);
          try {
            const response = data ? JSON.parse(data) : {};
            resolve(response);
          } catch (e) {
            resolve({ success: true });
          }
        } else {
          console.error('❌ Failed to create Service_EFE record:', res.statusCode, data);
          resolve(null); // Don't reject, just log error
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error creating Service_EFE record:', err);
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
  console.log('📝 State value from form:', projectData.state);
  
  // Save original data for later lookup
  const originalAddress = projectData.address;
  const originalCity = projectData.city;
  const originalDate = projectData.dateOfRequest || new Date().toISOString().split('T')[0];
  
  // Convert state abbreviation to StateID
  const stateID = getStateIDFromAbbreviation(projectData.state);
  
  if (!stateID) {
    throw new Error(`Unsupported state: ${projectData.state}. Supported states: TX, GA, FL, CO, CA, AZ, SC, TN`);
  }
  
  // Get the first selected service TypeID and use it as OffersID
  const selectedOffersID = projectData.services && projectData.services.length > 0 
    ? parseInt(projectData.services[0]) 
    : 1; // Default to 1 if none selected
  
  console.log('📝 Selected service for OffersID:', selectedOffersID);
  
  // Map form fields to Caspio fields matching the actual Caspio form
  const caspioData = {
    CompanyID: parseInt(projectData.company) || 1, // Company from dropdown
    UserID: parseInt(projectData.user) || 1, // User from dropdown
    Date: originalDate, // Date of Request
    InspectionDate: projectData.inspectionDate,
    Address: originalAddress,
    City: originalCity,
    StateID: stateID, // Now using numeric StateID from mapping
    Zip: projectData.zip,
    StatusID: 1, // Active status (1 = Active)
    Fee: parseFloat(projectData.fee) || 265.00, // Service fee from form
    Notes: projectData.notes || '', // Notes from textarea
    OffersID: selectedOffersID, // Service type stored in OffersID field
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
              
              // Create Service_EFE record for this project using ProjectID field
              console.log('📝 Creating Service_EFE record for project:', newProject.ProjectID || newProject.PK_ID);
              await createServiceEFERecord(newProject.ProjectID || newProject.PK_ID);
              
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
                <label class="form-label" for="user">User</label>
                <select id="user" name="user" class="form-input" required>
                    <option value="1">Patrick Bullock</option>
                </select>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="dateOfRequest">Date of Request</label>
                    <input type="date" id="dateOfRequest" name="dateOfRequest" 
                           class="form-input" value="${today}" readonly>
                </div>
                
                <div class="form-group">
                    <label class="form-label" for="fee">Service Fee</label>
                    <input type="number" id="fee" name="fee" class="form-input" 
                           value="265.00" step="0.01" min="0">
                </div>
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
            
            <div class="section-title" style="margin-top: 30px;">Inspection Details</div>
            
            <div class="form-group">
                <label class="form-label" for="inspectionDate">Inspection Date</label>
                <input type="date" id="inspectionDate" name="inspectionDate" 
                       class="form-input" value="${today}" required>
            </div>
            
            <div class="section-title" style="margin-top: 30px;">Services Required</div>
            
            <div class="checkbox-group">
                ${serviceCheckboxes || '<p style="color: #999;">No services available</p>'}
            </div>
            
            <div class="section-title" style="margin-top: 30px;">Additional Information</div>
            
            <div class="form-group">
                <label class="form-label" for="notes">Notes</label>
                <textarea id="notes" name="notes" class="form-input" rows="4" 
                          placeholder="Enter any additional notes..."></textarea>
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
            </div>
            
            <!-- Selected Services Card -->
            <div class="form-card" style="margin-bottom: 20px;">
                <div class="section-title">Selected Services</div>
                <div id="selectedServicesList"></div>
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
            
            // Get selected services
            const selectedServices = [];
            document.querySelectorAll('input[name="services"]:checked').forEach(cb => {
                selectedServices.push(cb.value);
            });
            data.services = selectedServices;
            
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
  
  // Fetch service name if OffersID exists
  let serviceName = 'Not specified';
  if (project.OffersID) {
    try {
      const offers = await fetchOffers(project.CompanyID || 1);
      const offer = offers.find(o => o.OffersID === project.OffersID);
      if (offer) {
        const types = await fetchServiceTypes();
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
            border-collapse: collapse;
        }
        .documents-table th {
            text-align: left;
            padding: 12px;
            background: #f8f9fa;
            border-bottom: 2px solid #dee2e6;
            font-weight: 600;
        }
        .documents-table td {
            padding: 12px;
            border-bottom: 1px solid #dee2e6;
        }
        .upload-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .upload-btn:hover {
            background: #0056b3;
        }
        .template-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .template-btn:hover {
            background: #218838;
        }
        .status-badge {
            display: inline-block;
            padding: 3px 8px;
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
        <!-- Project Information -->
        <div class="info-section">
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
            <div class="info-row">
                <span class="info-label">Service Requested:</span>
                <span class="info-value">${serviceName}</span>
            </div>
        </div>
        
        <!-- Required Documents -->
        <div class="info-section">
            <h2 class="section-title">Required Documents</h2>
            <table class="documents-table">
                <thead>
                    <tr>
                        <th>Document</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${documents.map(doc => {
                        const hasDocument = project[doc.field];
                        const status = hasDocument ? 'Uploaded' : (doc.required ? 'Required' : 'Optional');
                        const statusClass = hasDocument ? 'status-uploaded' : 'status-pending';
                        
                        return `
                        <tr>
                            <td>${doc.name}</td>
                            <td><span class="status-badge ${statusClass}">${status}</span></td>
                            <td>
                                ${hasDocument 
                                    ? `<button class="upload-btn">View</button>`
                                    : `<button class="upload-btn">Upload</button>`
                                }
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        
        <!-- Templates Section -->
        <div class="info-section">
            <h2 class="section-title">Templates</h2>
            <table class="documents-table">
                <thead>
                    <tr>
                        <th>Service Template</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${serviceName}</td>
                        <td>
                            <button class="template-btn" onclick="window.open('/template/${project.OffersID}/${project.PK_ID}', '_blank')">
                                Open Template
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
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
  } else if (pathname.startsWith('/api/caspio/Service_EFE/check/') && req.method === 'GET') {
    // Check if Service_EFE record exists for a project
    // The projectId here is actually the PK_ID from Projects table (e.g., 1860)
    // We need to first get the ProjectID from the Projects table
    const pkId = pathname.replace('/api/caspio/Service_EFE/check/', '');
    
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
      console.log(`🔍 Checking Service_EFE for ProjectID: ${projectId} (from PK_ID: ${pkId})`);
      
      // Now check for Service_EFE record using the actual ProjectID
      const response = await fetch(`${apiBaseUrl}/tables/Service_EFE/records?q.where=ProjectID=${projectId}`, {
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
        res.end(JSON.stringify({ error: 'Failed to check Service_EFE' }));
      }
    } catch (err) {
      console.error('Error checking Service_EFE:', err);
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
  } else if (pathname.match(/^\/api\/caspio\/Service_EFE\/file\/\d+$/) && req.method === 'POST') {
    // Handle file upload for Service_EFE record
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
        
        console.log(`Uploading file: ${uniqueFileName} (${fileContent.length} bytes) for field: ${fieldName} to Service_EFE record: ${serviceId}`);
        
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
          
          // Now update the Service_EFE record with the file URL or unique filename
          const updateData = {};
          updateData[fieldName] = fileUrl || uniqueFileName;
          
          const updateResponse = await fetch(`${apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`, {
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
            console.log(`✅ File uploaded and linked to Service_EFE record ${serviceId}: ${uniqueFileName}`);
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
            
            const updateResponse = await fetch(`${apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`, {
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
            
            const updateResponse = await fetch(`${apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`, {
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
  } else if (pathname.match(/^\/api\/caspio\/Service_EFE\/\d+$/) && req.method === 'PUT') {
    // Update Service_EFE record
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
        const response = await fetch(`${apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`, {
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
        console.error('Error updating Service_EFE:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (pathname === '/api/caspio/Service_EFE' && req.method === 'POST') {
    // Handle Service_EFE data submission to Caspio
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
        
        // Create Service_EFE record in Caspio
        const apiBaseUrl = 'https://c2hcf092.caspio.com/rest/v2';
        const response = await fetch(`${apiBaseUrl}/tables/Service_EFE/records`, {
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
        console.log('✅ Service_EFE record created:', result);
        
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          success: true, 
          ServiceID: result.ServiceID || serviceData.ServiceID,
          message: 'Service_EFE record created successfully' 
        }));
        
      } catch (err) {
        console.error('Error saving Service_EFE:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (pathname.startsWith('/template/')) {
    // Handle template page - NO CASPIO CONNECTION
    const parts = pathname.replace('/template/', '').split('/');
    const offersId = parts[0];
    const projectId = parts[1] || '';
    
    try {
      // For now, just use a placeholder service name
      let serviceName = 'Template Form';
      
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
    </div>
    
    <div class="container">
        <!-- Progress Indicator -->
        <div class="progress-indicator">
            <div class="progress-dot" id="dot-1"></div>
            <div class="progress-dot" id="dot-2"></div>
            <div class="progress-dot" id="dot-3"></div>
        </div>
        
        <form id="templateForm">
            <!-- Information Section -->
            <div class="section-card" id="section-1">
                <div class="section-header" onclick="toggleSection(1)">
                    <div>
                        <div class="section-title">
                            <!-- For development server -->
                            <img src="/icons/information.png" alt="" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;">
                            <!-- For mobile app deployment, use: -->
                            <!-- <img src="assets/icons/information.png" alt="" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;"> -->
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
                            <!-- General Subsection - Service_EFE Table Fields -->
                            <div class="subsection-card" id="general-card">
                                <div class="subsection-header" onclick="toggleSubsection('general')">
                                    <div class="subsection-title-container">
                                        <span class="subsection-title">General (Service_EFE Data)</span>
                                        <span class="progress-badge" id="general-progress">0%</span>
                                    </div>
                                    <span class="subsection-expand-icon" id="general-icon">▼</span>
                                </div>
                                <div class="subsection-content" id="general-content">
                                    <div class="subsection-inner">
                                        <!-- Hidden fields -->
                                        <input type="hidden" name="ProjectID" id="ProjectID" value="${projectId || ''}">
                                        <input type="hidden" name="ServiceID" id="ServiceID" value="">
                                        
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
                
                const response = await fetch('/api/caspio/Service_EFE/file/' + currentServiceID, {
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
            if (projectId) {
                // Check if a Service_EFE record already exists for this project
                // Note: We're checking by ProjectID field value, not PK_ID
                try {
                    const response = await fetch('/api/caspio/Service_EFE/check/' + projectId);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.exists && data.ServiceID) {
                            currentServiceID = data.ServiceID;
                            document.getElementById('ServiceID').value = currentServiceID;
                            console.log('Found existing Service_EFE record with ServiceID:', currentServiceID);
                            // Load existing data
                            loadExistingData(data.record);
                            // Initialize field states after loading data
                            setTimeout(initializeFieldStates, 100);
                        } else {
                            console.log('No Service_EFE record found, creating new one');
                            // Create new Service_EFE record
                            await createServiceRecord();
                        }
                    }
                } catch (error) {
                    console.error('Error checking Service_EFE:', error);
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
                console.log('Creating Service_EFE record with ProjectID:', actualProjectId);
                
                const response = await fetch('/api/caspio/Service_EFE', {
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
                    const response = await fetch('/api/caspio/Service_EFE/' + currentServiceID, {
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
            
            const section = document.getElementById('section-' + sectionNum);
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
                // Save to Service_EFE table
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
                const response = await fetch('/api/caspio/Service_EFE', {
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
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8100;

console.log('🚀 Starting Real iPhone App Server\n');

// Track changes for live reload
let clients = [];

// Watch for file changes
const watchDirs = ['src/app/pages', 'src/app/home'];
watchDirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (fs.existsSync(fullPath)) {
        fs.watch(fullPath, { recursive: true }, (event, filename) => {
            if (filename && !filename.includes('.swp')) {
                console.log(`📝 Changed: ${filename}`);
                broadcastReload();
            }
        });
    }
});

function broadcastReload() {
    clients.forEach(client => {
        client.write('data: reload\n\n');
    });
}

// Process Angular templates to clean HTML
function processTemplate(html) {
    return html
        // Remove Angular directives
        .replace(/\*ngIf="[^"]*"/g, '')
        .replace(/\*ngFor="[^"]*"/g, '')
        .replace(/\[(routerLink|disabled|checked|hidden)\]="[^"]*"/g, '')
        .replace(/\[class\.[^=]*\]="[^"]*"/g, '')
        .replace(/\[src\]="[^"]*"/g, 'src="https://via.placeholder.com/400x200"')
        .replace(/\[ngModel\]="[^"]*"/g, '')
        .replace(/\[\(ngModel\)\]="[^"]*"/g, '')
        .replace(/\(click\)="[^"]*"/g, 'onclick="console.log(\'Clicked\')"')
        .replace(/\(ionChange\)="[^"]*"/g, 'onchange="console.log(\'Changed\')"')
        .replace(/\(ngSubmit\)="[^"]*"/g, 'onsubmit="return false"')
        // Replace template expressions with sample data
        .replace(/\{\{\s*loading\s*\}\}/g, 'false')
        .replace(/\{\{\s*error\s*\}\}/g, '')
        .replace(/\{\{\s*project\.Address\s*\|\|\s*'[^']*'\s*\}\}/g, '123 Main Street')
        .replace(/\{\{\s*project\.[^}]*\}\}/g, 'Sample Data')
        .replace(/\{\{\s*formatAddress\([^)]*\)\s*\}\}/g, '123 Main St, New York, NY')
        .replace(/\{\{\s*formatDate\([^)]*\)\s*\}\}/g, 'Dec 18, 2024')
        .replace(/\{\{\s*getCityState\([^)]*\)\s*\}\}/g, 'New York, NY')
        .replace(/\{\{\s*[^}]*\}\}/g, '');
}

function generateMobileApp() {
    // Load actual page content
    const pages = {};
    
    // Load pages
    const pagesDir = path.join(__dirname, 'src/app/pages');
    if (fs.existsSync(pagesDir)) {
        fs.readdirSync(pagesDir).forEach(pageName => {
            const htmlPath = path.join(pagesDir, pageName, `${pageName}.page.html`);
            if (fs.existsSync(htmlPath)) {
                const rawHtml = fs.readFileSync(htmlPath, 'utf8');
                pages[pageName] = processTemplate(rawHtml);
            }
        });
    }
    
    // Load home page
    const homePath = path.join(__dirname, 'src/app/home/home.page.html');
    if (fs.existsSync(homePath)) {
        pages['home'] = processTemplate(fs.readFileSync(homePath, 'utf8'));
    }
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no">
    <meta name="mobile-web-app-capable" content="yes">
    <title>Caspio Mobile</title>
    
    <!-- Ionic Framework CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@7/css/ionic.bundle.css">
    
    <style>
        /* iOS Specific Styling */
        :root {
            --ion-safe-area-top: 20px;
            --ion-safe-area-bottom: 20px;
        }
        
        * {
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
        }
        
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            background: #000;
            overscroll-behavior: none;
        }
        
        /* Tab content management */
        .tab-pane {
            display: none;
            height: 100vh;
            background: #fff;
        }
        
        .tab-pane.active {
            display: flex;
            flex-direction: column;
        }
        
        /* Header styling to match iOS */
        ion-header {
            background: #fff;
            box-shadow: 0 0.5px 0 rgba(0,0,0,0.1);
        }
        
        ion-toolbar {
            --background: #fff;
            --color: #000;
            --border-width: 0;
            --min-height: 44px;
        }
        
        ion-title {
            font-size: 17px;
            font-weight: 600;
            letter-spacing: -0.4px;
        }
        
        /* Content styling */
        ion-content {
            --background: #f2f2f7;
            flex: 1;
        }
        
        /* Tab bar styling to match iOS */
        ion-tab-bar {
            --background: #f9f9f9;
            border-top: 0.5px solid rgba(0,0,0,0.1);
            height: 49px;
            padding-bottom: env(safe-area-inset-bottom);
        }
        
        ion-tab-button {
            --color: #999;
            --color-selected: #007AFF;
            font-size: 10px;
        }
        
        ion-tab-button ion-icon {
            font-size: 24px;
        }
        
        ion-tab-button ion-label {
            font-size: 10px;
            margin-top: 1px;
        }
        
        /* Form sections like iOS */
        .form-section {
            background: #fff;
            margin: 16px 16px 0;
            border-radius: 10px;
            padding: 0;
            overflow: hidden;
        }
        
        .section-title {
            font-size: 13px;
            font-weight: 400;
            color: #6c6c70;
            text-transform: uppercase;
            letter-spacing: -0.08px;
            padding: 20px 16px 8px;
            background: #f2f2f7;
            margin: 0;
        }
        
        .form-section ion-item {
            --padding-start: 16px;
            --inner-padding-end: 16px;
            --border-color: #c8c7cc;
        }
        
        /* iOS style buttons */
        .button-container {
            padding: 16px;
        }
        
        .button-container ion-button {
            --border-radius: 10px;
            --box-shadow: none;
            font-size: 17px;
            font-weight: 600;
            height: 50px;
            margin-bottom: 12px;
        }
        
        /* Service grid */
        .services-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            padding: 16px;
        }
        
        .service-item {
            background: #fff;
            border-radius: 10px;
            padding: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .service-item ion-checkbox {
            --size: 22px;
            --checkbox-background-checked: #007AFF;
        }
        
        .service-item label {
            flex: 1;
            font-size: 15px;
            color: #000;
        }
        
        /* Project cards */
        .project-card {
            background: #fff;
            margin: 12px;
            padding: 16px;
            border-radius: 10px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .project-card h3 {
            font-size: 17px;
            font-weight: 600;
            margin: 0 0 8px 0;
            color: #000;
        }
        
        .project-card p {
            font-size: 15px;
            color: #6c6c70;
            margin: 4px 0;
        }
        
        /* Info sections */
        .info-section {
            background: #fff;
            margin: 16px;
            border-radius: 10px;
            overflow: hidden;
        }
        
        .info-section h2 {
            font-size: 13px;
            font-weight: 400;
            color: #6c6c70;
            text-transform: uppercase;
            letter-spacing: -0.08px;
            padding: 12px 16px 8px;
            background: #f2f2f7;
            margin: 0;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 0.5px solid #c8c7cc;
        }
        
        .info-row:last-child {
            border-bottom: none;
        }
        
        .info-label {
            font-size: 15px;
            color: #000;
        }
        
        .info-value {
            font-size: 15px;
            color: #6c6c70;
        }
        
        /* Loading states */
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 300px;
        }
        
        .loading-container ion-spinner {
            --color: #007AFF;
        }
        
        .loading-container p {
            color: #6c6c70;
            margin-top: 16px;
        }
        
        /* Street view header image */
        .street-view-header {
            width: 100%;
            height: 200px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 18px;
        }
        
        .street-view-header img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
    </style>
</head>
<body>
    <ion-app>
        <!-- Active Projects Tab -->
        <div class="tab-pane active" id="tab-projects">
            <ion-header>
                <ion-toolbar>
                    <ion-title>Active Projects</ion-title>
                </ion-toolbar>
            </ion-header>
            <ion-content>
                <div class="loading-container">
                    <ion-spinner name="crescent"></ion-spinner>
                    <p>Loading projects...</p>
                </div>
                
                <!-- Sample Projects -->
                <div class="project-card">
                    <h3>Project Alpha</h3>
                    <p>📍 123 Main Street, New York, NY</p>
                    <p>📅 Inspection: Dec 18, 2024</p>
                    <ion-button expand="block" fill="outline">View Details</ion-button>
                </div>
                
                <div class="project-card">
                    <h3>Project Beta</h3>
                    <p>📍 456 Oak Avenue, Los Angeles, CA</p>
                    <p>📅 Inspection: Dec 20, 2024</p>
                    <ion-button expand="block" fill="outline">View Details</ion-button>
                </div>
                
                ${pages['active-projects'] || ''}
            </ion-content>
        </div>
        
        <!-- New Project Tab -->
        <div class="tab-pane" id="tab-new">
            ${pages['new-project'] || `
            <ion-header>
                <ion-toolbar>
                    <ion-title>New Project</ion-title>
                </ion-toolbar>
            </ion-header>
            <ion-content>
                <form>
                    <div class="form-section">
                        <h3 class="section-title">PROJECT DETAILS</h3>
                        <ion-item>
                            <ion-label position="stacked">Inspection Date</ion-label>
                            <ion-input type="date"></ion-input>
                        </ion-item>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="section-title">PROPERTY ADDRESS</h3>
                        <ion-item>
                            <ion-label position="stacked">Street Address</ion-label>
                            <ion-input placeholder="Start typing an address..."></ion-input>
                        </ion-item>
                    </div>
                    
                    <div class="button-container">
                        <ion-button expand="block" color="primary">Create Project</ion-button>
                    </div>
                </form>
            </ion-content>
            `}
        </div>
        
        <!-- Project Detail Tab -->
        <div class="tab-pane" id="tab-detail">
            ${pages['project-detail'] || `
            <ion-header>
                <ion-toolbar>
                    <ion-buttons slot="start">
                        <ion-button>
                            <ion-icon name="arrow-back"></ion-icon>
                        </ion-button>
                    </ion-buttons>
                    <ion-title>Project Details</ion-title>
                </ion-toolbar>
            </ion-header>
            <ion-content>
                <div class="street-view-header">
                    <span>Street View Image</span>
                </div>
                
                <div class="info-section">
                    <h2>Project Information</h2>
                    <div class="info-row">
                        <span class="info-label">Address</span>
                        <span class="info-value">123 Main Street</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">City, State</span>
                        <span class="info-value">New York, NY</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Inspection Date</span>
                        <span class="info-value">Dec 18, 2024</span>
                    </div>
                </div>
                
                <div class="info-section">
                    <h2>Services</h2>
                    <div class="services-grid">
                        <div class="service-item">
                            <ion-checkbox></ion-checkbox>
                            <label>Foundation Inspection</label>
                        </div>
                        <div class="service-item">
                            <ion-checkbox></ion-checkbox>
                            <label>Electrical Assessment</label>
                        </div>
                        <div class="service-item">
                            <ion-checkbox></ion-checkbox>
                            <label>Plumbing Review</label>
                        </div>
                        <div class="service-item">
                            <ion-checkbox></ion-checkbox>
                            <label>HVAC Inspection</label>
                        </div>
                    </div>
                </div>
            </ion-content>
            `}
        </div>
        
        <!-- Templates Tab -->
        <div class="tab-pane" id="tab-templates">
            ${pages['template-form'] || `
            <ion-header>
                <ion-toolbar>
                    <ion-title>Templates</ion-title>
                </ion-toolbar>
            </ion-header>
            <ion-content>
                <div class="form-section">
                    <h3 class="section-title">DOCUMENT TEMPLATES</h3>
                    <ion-list>
                        <ion-item>
                            <ion-label>Inspection Report Template</ion-label>
                            <ion-button slot="end" fill="clear">View</ion-button>
                        </ion-item>
                        <ion-item>
                            <ion-label>Service Agreement Template</ion-label>
                            <ion-button slot="end" fill="clear">View</ion-button>
                        </ion-item>
                    </ion-list>
                </div>
            </ion-content>
            `}
        </div>
        
        <!-- Tab Bar -->
        <ion-tab-bar>
            <ion-tab-button onclick="switchTab('projects')">
                <ion-icon name="folder-outline"></ion-icon>
                <ion-label>Projects</ion-label>
            </ion-tab-button>
            
            <ion-tab-button onclick="switchTab('new')">
                <ion-icon name="add-circle-outline"></ion-icon>
                <ion-label>New</ion-label>
            </ion-tab-button>
            
            <ion-tab-button onclick="switchTab('detail')">
                <ion-icon name="document-text-outline"></ion-icon>
                <ion-label>Details</ion-label>
            </ion-tab-button>
            
            <ion-tab-button onclick="switchTab('templates')">
                <ion-icon name="copy-outline"></ion-icon>
                <ion-label>Templates</ion-label>
            </ion-tab-button>
        </ion-tab-bar>
    </ion-app>
    
    <!-- Capacitor Mock -->
    <script>
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            isPluginAvailable: () => true,
            Plugins: {
                Keyboard: { hide: () => {}, show: () => {} }
            }
        };
        window.Keyboard = window.Capacitor.Plugins.Keyboard;
    </script>
    
    <!-- Ionic Core -->
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.js"></script>
    
    <!-- App Logic -->
    <script>
        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab-pane').forEach(tab => {
                tab.classList.remove('active');
            });
            document.getElementById('tab-' + tabName).classList.add('active');
            
            // Update tab bar
            document.querySelectorAll('ion-tab-button').forEach(btn => {
                btn.classList.remove('tab-selected');
            });
            event.currentTarget.classList.add('tab-selected');
        }
        
        // Live reload
        const evtSource = new EventSource('/events');
        evtSource.onmessage = (e) => {
            if (e.data === 'reload') {
                location.reload();
            }
        };
        
        console.log('📱 iPhone App Ready');
        console.log('Platform:', window.Capacitor.getPlatform());
    </script>
</body>
</html>`;
}

// Create server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // Live reload events
    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        clients.push(res);
        res.on('close', () => {
            clients = clients.filter(c => c !== res);
        });
        return;
    }
    
    // Serve the app
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(generateMobileApp());
});

server.listen(PORT, () => {
    console.log(`✅ Real iPhone App Server Running!\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📱 OPEN IN IPHONE SIMULATOR:\n');
    console.log('   1. Open: iphone-simulator.html');
    console.log('   2. Or visit: http://localhost:8100\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔄 LIVE RELOAD ACTIVE\n');
    console.log('Press Ctrl+C to stop\n');
});
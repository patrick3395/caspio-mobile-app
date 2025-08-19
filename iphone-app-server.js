#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8100;

console.log('🚀 Starting iPhone App Server with Live Reload\n');

// Track clients for live reload
let clients = [];
let lastReload = Date.now();

// Watch for changes
const watchDirs = ['src/app/pages', 'src/app/home', 'src/app/tabs'];
watchDirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (fs.existsSync(fullPath)) {
        fs.watch(fullPath, { recursive: true }, (event, filename) => {
            if (filename && !filename.includes('.swp')) {
                console.log(`📝 Changed: ${filename}`);
                lastReload = Date.now();
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

// Load all page content
function loadPages() {
    const pages = {};
    
    // Load from pages directory
    const pagesDir = path.join(__dirname, 'src/app/pages');
    if (fs.existsSync(pagesDir)) {
        fs.readdirSync(pagesDir).forEach(pageName => {
            const htmlPath = path.join(pagesDir, pageName, `${pageName}.page.html`);
            if (fs.existsSync(htmlPath)) {
                pages[pageName] = fs.readFileSync(htmlPath, 'utf8');
                console.log(`  ✓ Loaded ${pageName}`);
            }
        });
    }
    
    // Load home page
    const homePath = path.join(__dirname, 'src/app/home/home.page.html');
    if (fs.existsSync(homePath)) {
        pages['home'] = fs.readFileSync(homePath, 'utf8');
        console.log(`  ✓ Loaded home`);
    }
    
    return pages;
}

// Generate the complete app
function generateApp() {
    console.log('📦 Loading app components...');
    const pages = loadPages();
    
    // Get the first available page as default
    const defaultPage = pages['active-projects'] || pages['home'] || Object.values(pages)[0] || '<p>No pages found</p>';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Caspio Mobile</title>
    
    <!-- Ionic CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@7/css/ionic.bundle.css">
    
    <style>
        /* iOS Safe Areas */
        :root {
            --ion-safe-area-top: env(safe-area-inset-top);
            --ion-safe-area-bottom: env(safe-area-inset-bottom);
        }
        
        /* Reset */
        * {
            -webkit-tap-highlight-color: transparent;
            -webkit-user-select: none;
            user-select: none;
        }
        
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overscroll-behavior-y: none;
        }
        
        /* Hide all tabs by default */
        .tab-content {
            display: none;
            height: 100%;
        }
        
        .tab-content.active {
            display: block;
        }
        
        /* Custom tab bar styling */
        .custom-tab-bar {
            background: #ffffff;
            border-top: 1px solid #e0e0e0;
        }
        
        .tab-icon {
            font-size: 24px;
        }
        
        /* Content styling */
        ion-content {
            --background: #f5f5f5;
        }
        
        /* Form sections */
        .form-section {
            background: white;
            margin: 10px;
            padding: 15px;
            border-radius: 10px;
        }
        
        .section-title {
            font-size: 13px;
            font-weight: 600;
            color: #8e8e93;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 15px;
        }
        
        /* Service grid */
        .services-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 10px;
            padding: 10px;
        }
        
        .service-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px;
            background: white;
            border-radius: 8px;
            font-size: 14px;
        }
        
        /* Loading states */
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 200px;
        }
        
        ion-spinner {
            --color: #3880ff;
        }
        
        /* Project cards */
        .project-card {
            background: white;
            margin: 10px;
            padding: 15px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        /* Buttons */
        .button-container {
            padding: 20px;
        }
        
        ion-button {
            --border-radius: 10px;
            margin-bottom: 10px;
        }
        
        /* Info sections */
        .info-section {
            background: white;
            margin: 10px;
            padding: 15px;
            border-radius: 10px;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .info-label {
            color: #8e8e93;
            font-size: 14px;
        }
        
        .info-value {
            color: #000;
            font-size: 14px;
            font-weight: 500;
        }
    </style>
</head>
<body>
    <ion-app>
        <ion-tabs>
            <!-- Active Projects Tab -->
            <ion-tab tab="active-projects">
                <div class="tab-content active" id="active-projects-content">
                    <ion-header>
                        <ion-toolbar color="primary">
                            <ion-title>Active Projects</ion-title>
                        </ion-toolbar>
                    </ion-header>
                    <ion-content>
                        ${pages['active-projects'] || defaultPage}
                    </ion-content>
                </div>
            </ion-tab>
            
            <!-- New Project Tab -->
            <ion-tab tab="new-project">
                <div class="tab-content" id="new-project-content">
                    ${pages['new-project'] || '<ion-header><ion-toolbar><ion-title>New Project</ion-title></ion-toolbar></ion-header><ion-content><p>New Project Form</p></ion-content>'}
                </div>
            </ion-tab>
            
            <!-- Project Detail Tab -->
            <ion-tab tab="project-detail">
                <div class="tab-content" id="project-detail-content">
                    ${pages['project-detail'] || '<ion-header><ion-toolbar><ion-title>Project Details</ion-title></ion-toolbar></ion-header><ion-content><p>Project Details</p></ion-content>'}
                </div>
            </ion-tab>
            
            <!-- Templates Tab -->
            <ion-tab tab="templates">
                <div class="tab-content" id="templates-content">
                    ${pages['template-form'] || '<ion-header><ion-toolbar><ion-title>Templates</ion-title></ion-toolbar></ion-header><ion-content><p>Templates</p></ion-content>'}
                </div>
            </ion-tab>
            
            <!-- Tab Bar -->
            <ion-tab-bar slot="bottom" class="custom-tab-bar">
                <ion-tab-button tab="active-projects" onclick="switchTab('active-projects')">
                    <ion-icon name="folder-outline"></ion-icon>
                    <ion-label>Projects</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="new-project" onclick="switchTab('new-project')">
                    <ion-icon name="add-circle-outline"></ion-icon>
                    <ion-label>New</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="project-detail" onclick="switchTab('project-detail')">
                    <ion-icon name="document-text-outline"></ion-icon>
                    <ion-label>Details</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="templates" onclick="switchTab('templates')">
                    <ion-icon name="copy-outline"></ion-icon>
                    <ion-label>Templates</ion-label>
                </ion-tab-button>
            </ion-tab-bar>
        </ion-tabs>
    </ion-app>
    
    <!-- iOS Platform Mock -->
    <script>
        // Complete Capacitor environment
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            isPluginAvailable: () => true,
            Plugins: {
                Keyboard: {
                    show: () => Promise.resolve(),
                    hide: () => Promise.resolve(),
                    setAccessoryBarVisible: () => Promise.resolve(),
                    addListener: () => ({ remove: () => {} })
                },
                StatusBar: {
                    setStyle: () => Promise.resolve(),
                    setBackgroundColor: () => Promise.resolve()
                },
                App: {
                    getInfo: () => Promise.resolve({
                        name: 'Caspio Mobile',
                        id: 'io.ionic.caspioapp',
                        version: '1.0.0'
                    })
                },
                Device: {
                    getInfo: () => Promise.resolve({
                        model: 'iPhone',
                        platform: 'ios',
                        operatingSystem: 'ios',
                        osVersion: '17.0',
                        manufacturer: 'Apple',
                        isVirtual: false,
                        uuid: 'dev-' + Date.now()
                    })
                }
            }
        };
        
        // Mock Keyboard global
        window.Keyboard = window.Capacitor.Plugins.Keyboard;
    </script>
    
    <!-- Ionic Core -->
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.js"></script>
    
    <!-- App Logic -->
    <script>
        // Tab switching
        function switchTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Show selected tab
            const selectedTab = document.getElementById(tabName + '-content');
            if (selectedTab) {
                selectedTab.classList.add('active');
            }
            
            // Update tab bar
            document.querySelectorAll('ion-tab-button').forEach(btn => {
                btn.classList.remove('tab-active');
            });
            event.currentTarget.classList.add('tab-active');
            
            console.log('Switched to tab:', tabName);
        }
        
        // Mock data for templates
        window.mockData = {
            projects: [
                { id: 1, name: 'Project Alpha', address: '123 Main St', city: 'New York', state: 'NY' },
                { id: 2, name: 'Project Beta', address: '456 Oak Ave', city: 'Los Angeles', state: 'CA' }
            ],
            services: [
                { id: 1, name: 'Foundation Inspection', selected: false },
                { id: 2, name: 'Electrical Assessment', selected: false },
                { id: 3, name: 'Plumbing Review', selected: false },
                { id: 4, name: 'HVAC Inspection', selected: false }
            ]
        };
        
        // Initialize app
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📱 iOS App Initialized');
            console.log('Platform:', window.Capacitor.getPlatform());
            
            // Process Angular-style templates (basic)
            document.body.innerHTML = document.body.innerHTML
                .replace(/\\{\\{\\s*error\\s*\\}\\}/g, '')
                .replace(/\\{\\{[^}]*\\}\\}/g, (match) => {
                    console.log('Template expression:', match);
                    return '';
                })
                .replace(/\\*ngIf="[^"]*"/g, '')
                .replace(/\\*ngFor="[^"]*"/g, '')
                .replace(/\\(click\\)="[^"]*"/g, 'onclick="console.log(\\'Click\\')"')
                .replace(/\\[\\(ngModel\\)\\]="[^"]*"/g, '');
            
            console.log('✅ App Ready');
        });
        
        // Live reload
        const evtSource = new EventSource('/events');
        evtSource.onmessage = (event) => {
            if (event.data === 'reload') {
                console.log('🔄 Reloading...');
                location.reload();
            }
        };
    </script>
</body>
</html>`;
}

// Create server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // Server-sent events for live reload
    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        
        clients.push(res);
        res.on('close', () => {
            clients = clients.filter(c => c !== res);
        });
        
        return;
    }
    
    // Serve the app
    res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(generateApp());
});

// Start server
server.listen(PORT, () => {
    console.log(`\n✅ iPhone App Server Running!\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📱 VIEW YOUR APP:\n');
    console.log(`   Browser: http://localhost:${PORT}`);
    console.log(`   iPhone Simulator: Open iphone-simulator.html\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔄 LIVE RELOAD ACTIVE\n');
    console.log('   Edit files in src/app/pages/');
    console.log('   Changes appear instantly!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Press Ctrl+C to stop\n');
});
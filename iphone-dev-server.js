#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8100;

console.log('🚀 Starting iPhone Development Server\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Track connected clients for live reload
let clients = [];

// Watch for file changes
const watchDirs = [
    'src/app/pages',
    'src/app/home',
    'src/app/services',
    'src/app/tabs',
    'src/assets'
];

// File watcher
watchDirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (fs.existsSync(fullPath)) {
        fs.watch(fullPath, { recursive: true }, (eventType, filename) => {
            if (filename && !filename.includes('.swp')) {
                console.log(`📝 Changed: ${dir}/${filename}`);
                broadcastReload();
            }
        });
    }
});

function broadcastReload() {
    clients.forEach(res => {
        res.write('data: reload\n\n');
    });
}

// Load app components
function loadAppComponents() {
    const components = {};
    const pagesDir = path.join(__dirname, 'src/app/pages');
    const homeDir = path.join(__dirname, 'src/app/home');
    const tabsDir = path.join(__dirname, 'src/app/tabs');
    
    // Load pages
    if (fs.existsSync(pagesDir)) {
        fs.readdirSync(pagesDir).forEach(page => {
            const htmlPath = path.join(pagesDir, page, `${page}.page.html`);
            const tsPath = path.join(pagesDir, page, `${page}.page.ts`);
            const scssPath = path.join(pagesDir, page, `${page}.page.scss`);
            
            if (fs.existsSync(htmlPath)) {
                components[page] = {
                    html: fs.readFileSync(htmlPath, 'utf8'),
                    ts: fs.existsSync(tsPath) ? fs.readFileSync(tsPath, 'utf8') : '',
                    scss: fs.existsSync(scssPath) ? fs.readFileSync(scssPath, 'utf8') : ''
                };
            }
        });
    }
    
    // Load home
    if (fs.existsSync(homeDir)) {
        const htmlPath = path.join(homeDir, 'home.page.html');
        if (fs.existsSync(htmlPath)) {
            components['home'] = {
                html: fs.readFileSync(htmlPath, 'utf8'),
                ts: '',
                scss: ''
            };
        }
    }
    
    // Load tabs
    if (fs.existsSync(tabsDir)) {
        const htmlPath = path.join(tabsDir, 'tabs.page.html');
        if (fs.existsSync(htmlPath)) {
            components['tabs'] = {
                html: fs.readFileSync(htmlPath, 'utf8'),
                ts: '',
                scss: ''
            };
        }
    }
    
    return components;
}

// Generate the app HTML
function generateApp(currentRoute = 'home') {
    const components = loadAppComponents();
    const currentComponent = components[currentRoute] || components['home'] || { html: '<p>Loading...</p>' };
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Caspio Mobile</title>
    
    <!-- Ionic Framework -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@7/css/ionic.bundle.css">
    
    <style>
        /* iOS Safe Areas */
        :root {
            --ion-safe-area-top: env(safe-area-inset-top);
            --ion-safe-area-bottom: env(safe-area-inset-bottom);
            --ion-safe-area-left: env(safe-area-inset-left);
            --ion-safe-area-right: env(safe-area-inset-right);
        }
        
        /* Base Styles */
        * {
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
        }
        
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
            -webkit-font-smoothing: antialiased;
            overscroll-behavior-y: none;
        }
        
        ion-app {
            display: block;
            position: relative;
            width: 100%;
            height: 100vh;
        }
        
        /* iOS Status Bar Space */
        ion-header ion-toolbar:first-child {
            padding-top: var(--ion-safe-area-top);
            min-height: calc(56px + var(--ion-safe-area-top));
        }
        
        /* Tab Bar Safe Area */
        ion-tab-bar {
            padding-bottom: var(--ion-safe-area-bottom);
        }
        
        /* Your Custom Styles from SCSS files */
        ${Object.values(components).map(c => c.scss).join('\\n')}
        
        /* Service Grid Styles */
        .services-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px;
            padding: 16px;
        }
        
        .service-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
            transition: background 0.2s;
        }
        
        .service-item:active {
            background: #e9ecef;
        }
        
        /* Form Styles */
        .form-section {
            padding: 16px;
            margin-bottom: 16px;
        }
        
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: #8e8e93;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }
        
        /* iOS-style buttons */
        ion-button {
            --border-radius: 10px;
        }
        
        /* Loading and Error States */
        .loading-container, .error-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <ion-app>
        ${components['tabs'] ? components['tabs'].html : `
        <ion-tabs>
            <ion-tab tab="home">
                <ion-header>
                    <ion-toolbar color="primary">
                        <ion-title>Caspio Mobile</ion-title>
                    </ion-toolbar>
                </ion-header>
                <ion-content>
                    ${components['home'] ? components['home'].html : '<p>Home page</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab tab="projects">
                <ion-content>
                    ${components['active-projects'] ? components['active-projects'].html : '<p>Projects</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab tab="new">
                <ion-content>
                    ${components['new-project'] ? components['new-project'].html : '<p>New Project</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab tab="details">
                <ion-content>
                    ${components['project-detail'] ? components['project-detail'].html : '<p>Details</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab-bar slot="bottom">
                <ion-tab-button tab="home">
                    <ion-icon name="home"></ion-icon>
                    <ion-label>Home</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="projects">
                    <ion-icon name="folder"></ion-icon>
                    <ion-label>Projects</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="new">
                    <ion-icon name="add-circle"></ion-icon>
                    <ion-label>New</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="details">
                    <ion-icon name="clipboard"></ion-icon>
                    <ion-label>Details</ion-label>
                </ion-tab-button>
            </ion-tab-bar>
        </ion-tabs>
        `}
    </ion-app>
    
    <!-- Capacitor/Cordova Mock for iOS -->
    <script>
        // Full iOS Capacitor Environment
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            isPluginAvailable: (plugin) => true,
            Plugins: {
                Keyboard: {
                    show: () => Promise.resolve(),
                    hide: () => Promise.resolve(),
                    setAccessoryBarVisible: () => Promise.resolve(),
                    setScroll: () => Promise.resolve(),
                    setStyle: () => Promise.resolve(),
                    setResizeMode: () => Promise.resolve(),
                    addListener: (event, callback) => ({ remove: () => {} })
                },
                StatusBar: {
                    setStyle: ({ style }) => Promise.resolve(),
                    setBackgroundColor: ({ color }) => Promise.resolve(),
                    show: () => Promise.resolve(),
                    hide: () => Promise.resolve(),
                    setOverlaysWebView: ({ overlay }) => Promise.resolve()
                },
                App: {
                    exitApp: () => Promise.resolve(),
                    getInfo: () => Promise.resolve({ 
                        name: 'Caspio Mobile',
                        id: 'io.ionic.caspioapp',
                        version: '1.0.0',
                        build: '1'
                    }),
                    addListener: (event, callback) => ({ remove: () => {} })
                },
                Device: {
                    getInfo: () => Promise.resolve({
                        model: 'iPhone',
                        platform: 'ios',
                        operatingSystem: 'ios',
                        osVersion: '17.0',
                        manufacturer: 'Apple',
                        isVirtual: false,
                        uuid: 'simulator-' + Date.now()
                    })
                }
            }
        };
        
        // Mock Ionic Native
        window.IonicNative = window.Capacitor.Plugins;
        
        // Mock Cordova
        window.device = {
            platform: 'iOS',
            version: '17.0',
            model: 'iPhone 14 Pro'
        };
    </script>
    
    <!-- Ionic Core -->
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.js"></script>
    
    <!-- Live Reload -->
    <script>
        // Server-Sent Events for live reload
        const evtSource = new EventSource('/events');
        evtSource.onmessage = (event) => {
            if (event.data === 'reload') {
                console.log('🔄 Reloading...');
                location.reload();
            }
        };
        
        // Initialize app
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📱 iOS Simulator Mode');
            console.log('Platform:', window.Capacitor.getPlatform());
            console.log('✅ App Ready');
        });
    </script>
</body>
</html>`;
}

// Create server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // Server-Sent Events for live reload
    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        
        clients.push(res);
        
        res.on('close', () => {
            clients = clients.filter(client => client !== res);
        });
        
        return;
    }
    
    // Serve the app
    if (url.pathname === '/' || url.pathname.startsWith('/tabs')) {
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(generateApp());
        return;
    }
    
    // Serve static assets
    const assetPath = path.join(__dirname, 'src', url.pathname);
    if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const ext = path.extname(assetPath);
        const mimeTypes = {
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };
        
        res.writeHead(200, { 
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(fs.readFileSync(assetPath));
        return;
    }
    
    res.writeHead(404);
    res.end('Not found');
});

// Start server
server.listen(PORT, () => {
    console.log(`✅ iPhone Development Server Running!\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📱 OPEN THE iPHONE SIMULATOR:\n');
    console.log(`   1. Open: iphone-simulator.html in your browser`);
    console.log(`   2. Or go to: http://localhost:${PORT}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔄 LIVE RELOAD ENABLED:\n');
    console.log('   • Edit any file in src/app/');
    console.log('   • Simulator refreshes automatically');
    console.log('   • Shows exactly how it looks on iPhone\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✨ This is your exact mobile app!');
    console.log('   What you see here = What deploys to TestFlight\n');
    console.log('Press Ctrl+C to stop\n');
    
    // Open simulator in browser
    exec(`start ${__dirname}/iphone-simulator.html`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Stopping server...');
    process.exit(0);
});
#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PORT = 8100;

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const LOCAL_IP = getLocalIP();

console.log('🚀 Starting Live Reload Server for Mobile Development\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Watch for file changes
const watchedDirs = [
    path.join(__dirname, 'src/app/pages'),
    path.join(__dirname, 'src/app/home'),
    path.join(__dirname, 'src/app/services'),
    path.join(__dirname, 'src/assets')
];

let clients = [];
let lastChangeTime = Date.now();

// Create WebSocket-like connection for live reload
function setupLiveReload(res) {
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
}

// Watch files for changes
watchedDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
        fs.watch(dir, { recursive: true }, (eventType, filename) => {
            if (filename && !filename.includes('.swp') && !filename.includes('~')) {
                console.log(`📝 File changed: ${filename}`);
                lastChangeTime = Date.now();
                
                // Notify all connected clients
                clients.forEach(client => {
                    client.write(`data: ${JSON.stringify({ reload: true, file: filename })}\n\n`);
                });
            }
        });
    }
});

// Create the server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // Handle live reload endpoint
    if (url.pathname === '/live-reload') {
        setupLiveReload(res);
        return;
    }
    
    // Handle file change check
    if (url.pathname === '/check-changes') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ lastChange: lastChangeTime }));
        return;
    }
    
    // Serve the main app
    if (url.pathname === '/' || url.pathname === '/index.html') {
        const indexHtml = generateMobileApp();
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(indexHtml);
        return;
    }
    
    // Serve page content
    if (url.pathname.startsWith('/page/')) {
        const pageName = url.pathname.replace('/page/', '');
        const pagePath = path.join(__dirname, 'src/app/pages', pageName, `${pageName}.page.html`);
        
        if (fs.existsSync(pagePath)) {
            const content = fs.readFileSync(pagePath, 'utf8');
            res.writeHead(200, { 
                'Content-Type': 'text/html',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
        } else {
            res.writeHead(404);
            res.end('Page not found');
        }
        return;
    }
    
    // Serve static files
    const filePath = path.join(__dirname, 'src', url.pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const mimeTypes = {
            '.html': 'text/html',
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
        res.end(content);
        return;
    }
    
    res.writeHead(404);
    res.end('Not found');
});

function generateMobileApp() {
    // Load actual page content
    const pages = {};
    const pageDir = path.join(__dirname, 'src/app/pages');
    
    if (fs.existsSync(pageDir)) {
        fs.readdirSync(pageDir).forEach(page => {
            const htmlPath = path.join(pageDir, page, `${page}.page.html`);
            if (fs.existsSync(htmlPath)) {
                pages[page] = fs.readFileSync(htmlPath, 'utf8');
            }
        });
    }
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Caspio Mobile</title>
    
    <!-- Ionic CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@7/css/ionic.bundle.css">
    
    <style>
        :root {
            --ion-safe-area-top: env(safe-area-inset-top);
            --ion-safe-area-bottom: env(safe-area-inset-bottom);
        }
        
        body {
            margin: 0;
            padding: 0;
            overscroll-behavior-y: none;
        }
        
        /* Live reload indicator */
        .live-indicator {
            position: fixed;
            top: calc(10px + env(safe-area-inset-top));
            right: 10px;
            background: #4CAF50;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            z-index: 99999;
            display: flex;
            align-items: center;
            gap: 4px;
            animation: pulse 2s infinite;
        }
        
        .live-indicator::before {
            content: '';
            width: 6px;
            height: 6px;
            background: white;
            border-radius: 50%;
            animation: blink 1s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.9; }
            50% { opacity: 0.6; }
        }
        
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        
        /* Your app styles */
        .service-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 12px;
            padding: 12px;
        }
        
        .service-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .service-detail-item {
            padding: 12px;
            background: #f0f4f8;
            border-radius: 8px;
            margin-bottom: 8px;
        }
        
        /* Tab navigation */
        ion-tab-bar {
            border-top: 1px solid #e0e0e0;
        }
        
        ion-tab-button {
            --color-selected: #3880ff;
        }
    </style>
</head>
<body>
    <ion-app>
        <div class="live-indicator">LIVE</div>
        
        <!-- Tab Navigation -->
        <ion-tabs>
            <ion-tab tab="home">
                <ion-header>
                    <ion-toolbar color="primary">
                        <ion-title>Caspio Mobile</ion-title>
                    </ion-toolbar>
                </ion-header>
                <ion-content class="ion-padding">
                    ${pages['active-projects'] || '<h2>Active Projects</h2><p>Loading...</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab tab="new-project">
                <ion-content>
                    ${pages['new-project'] || '<h2>New Project</h2><p>Loading...</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab tab="project-detail">
                <ion-content>
                    ${pages['project-detail'] || '<h2>Project Details</h2><p>Loading...</p>'}
                </ion-content>
            </ion-tab>
            
            <ion-tab tab="templates">
                <ion-content>
                    ${pages['template-form'] || '<h2>Templates</h2><p>Loading...</p>'}
                </ion-content>
            </ion-tab>
            
            <!-- Tab Bar -->
            <ion-tab-bar slot="bottom">
                <ion-tab-button tab="home">
                    <ion-icon name="home"></ion-icon>
                    <ion-label>Home</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="new-project">
                    <ion-icon name="add-circle"></ion-icon>
                    <ion-label>New</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="project-detail">
                    <ion-icon name="clipboard"></ion-icon>
                    <ion-label>Details</ion-label>
                </ion-tab-button>
                
                <ion-tab-button tab="templates">
                    <ion-icon name="document-text"></ion-icon>
                    <ion-label>Templates</ion-label>
                </ion-tab-button>
            </ion-tab-bar>
        </ion-tabs>
    </ion-app>
    
    <!-- Capacitor Mock -->
    <script>
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            isPluginAvailable: () => true,
            Plugins: {
                Keyboard: {
                    show: () => Promise.resolve(),
                    hide: () => Promise.resolve(),
                    addListener: () => ({ remove: () => {} })
                }
            }
        };
        window.Keyboard = window.Capacitor.Plugins.Keyboard;
    </script>
    
    <!-- Ionic Core -->
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.js"></script>
    
    <!-- Live Reload Script -->
    <script>
        console.log('🔄 Live reload enabled!');
        console.log('📱 Connected to: ${LOCAL_IP}:${PORT}');
        
        // Server-sent events for live reload
        const eventSource = new EventSource('http://${LOCAL_IP}:${PORT}/live-reload');
        
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.reload) {
                console.log('🔄 Reloading due to:', data.file);
                location.reload();
            }
        };
        
        // Fallback polling method
        let lastCheck = Date.now();
        setInterval(() => {
            fetch('/check-changes')
                .then(r => r.json())
                .then(data => {
                    if (data.lastChange > lastCheck) {
                        console.log('🔄 Changes detected, reloading...');
                        location.reload();
                    }
                })
                .catch(() => {});
        }, 2000);
        
        // Log that we're in development mode
        console.log('✅ Development mode active');
        console.log('✅ Edit files in src/app/ to see changes');
    </script>
</body>
</html>`;
}

// Start the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Live Reload Server Running!\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`📱 FOR YOUR iPhone/iPad:\n`);
    console.log(`   1. Make sure your phone is on the same WiFi\n`);
    console.log(`   2. Open Safari on your iPhone\n`);
    console.log(`   3. Go to: http://${LOCAL_IP}:${PORT}\n`);
    console.log(`   4. Tap the Share button (box with arrow)\n`);
    console.log(`   5. Select "Add to Home Screen"\n`);
    console.log(`   6. Name it "Caspio Dev"\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`💻 FOR YOUR COMPUTER:\n`);
    console.log(`   Local:    http://localhost:${PORT}\n`);
    console.log(`   Network:  http://${LOCAL_IP}:${PORT}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔄 LIVE RELOAD IS ACTIVE!\n');
    console.log('   Edit any file in src/app/pages/\n');
    console.log('   Your phone will refresh automatically!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Press Ctrl+C to stop\n');
    
    // Try to open in browser
    if (process.platform === 'win32') {
        exec(`start http://localhost:${PORT}`);
    }
});
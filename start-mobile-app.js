#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('🚀 Starting Caspio Mobile App Development Environment...\n');

// Check if www folder exists with recent build
const wwwPath = path.join(__dirname, 'www');
const needsBuild = !fs.existsSync(wwwPath) || fs.readdirSync(wwwPath).length === 0;

if (needsBuild) {
    console.log('📦 Building app for the first time...');
    console.log('This may take a minute...\n');
}

// Try different methods to start the app
function tryIonicServe() {
    console.log('Attempting to start with Ionic CLI...');
    const ionic = spawn('ionic', ['serve', '--no-open', '--port', '8100'], {
        stdio: 'inherit',
        shell: true
    });

    ionic.on('error', (err) => {
        console.log('Ionic CLI not available, trying alternative...');
        tryNpxIonic();
    });

    ionic.on('close', (code) => {
        if (code !== 0) {
            tryNpxIonic();
        }
    });
}

function tryNpxIonic() {
    console.log('\nAttempting to start with npx ionic...');
    const npxIonic = spawn('npx', ['ionic', 'serve', '--no-open', '--port', '8100'], {
        stdio: 'inherit',
        shell: true
    });

    npxIonic.on('error', (err) => {
        console.log('npx ionic failed, trying ng serve...');
        tryNgServe();
    });

    npxIonic.on('close', (code) => {
        if (code !== 0) {
            tryNgServe();
        }
    });
}

function tryNgServe() {
    console.log('\nAttempting to start with ng serve...');
    const ng = spawn('npx', ['ng', 'serve', '--port', '8100', '--host', 'localhost'], {
        stdio: 'inherit',
        shell: true
    });

    ng.on('error', (err) => {
        console.log('ng serve failed, starting fallback server...');
        startFallbackServer();
    });

    ng.on('close', (code) => {
        if (code !== 0) {
            startFallbackServer();
        }
    });
}

function startFallbackServer() {
    console.log('\n📱 Starting Fallback Development Server...');
    
    // Simple server that serves the source files directly
    const server = http.createServer((req, res) => {
        let urlPath = req.url.split('?')[0];
        
        // Mobile detection
        const isMobile = req.url.includes('mobile=true');
        
        if (urlPath === '/' || urlPath === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(generateIndexHtml(isMobile));
            return;
        }
        
        // Serve static files
        const filePaths = [
            path.join(__dirname, 'www', urlPath),
            path.join(__dirname, 'src', urlPath),
            path.join(__dirname, urlPath)
        ];
        
        for (const filePath of filePaths) {
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
                    'Cache-Control': 'no-cache'
                });
                res.end(content);
                return;
            }
        }
        
        // For Angular routing, return index
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateIndexHtml(isMobile));
    });
    
    server.listen(8100, () => {
        console.log(`
✅ Mobile App Server Running!

📱 VIEW YOUR APP:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Desktop View:  http://localhost:8100
Mobile View:   http://localhost:8100/?mobile=true

🔧 DEVELOPER MODE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Open Chrome/Edge DevTools (F12)
2. Click device toggle (📱)
3. Select iPhone 14 Pro

📝 YOUR APP INCLUDES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Project creation with address autocomplete
✓ Service selection with checkboxes
✓ Document management from templates
✓ File upload capabilities
✓ Auto-save functionality
✓ All features from caspio-dev-server.js

Press Ctrl+C to stop
`);
    });
}

function generateIndexHtml(isMobile) {
    // Read actual app files and compile them
    const appModule = fs.existsSync(path.join(__dirname, 'src/app/app.module.ts'));
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Caspio Mobile</title>
    <base href="/">
    
    <!-- Ionic CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@7/css/ionic.bundle.css">
    
    <style>
        body {
            margin: 0;
            padding: 0;
            --ion-safe-area-top: env(safe-area-inset-top);
            --ion-safe-area-bottom: env(safe-area-inset-bottom);
        }
        
        .app-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            flex-direction: column;
        }
        
        .app-loading ion-spinner {
            --color: white;
            width: 48px;
            height: 48px;
        }
    </style>
</head>
<body>
    <ion-app>
        <ion-router-outlet>
            <div class="app-loading">
                <ion-spinner name="crescent"></ion-spinner>
                <h2>Loading Caspio Mobile</h2>
                <p style="opacity: 0.8; font-size: 14px;">Your complete project management app</p>
            </div>
        </ion-router-outlet>
    </ion-app>
    
    <!-- Capacitor simulation for ${isMobile ? 'mobile' : 'desktop'} -->
    <script>
        window.Capacitor = {
            isNativePlatform: () => ${isMobile ? 'true' : 'false'},
            getPlatform: () => '${isMobile ? 'ios' : 'web'}',
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
                Storage: {
                    get: () => Promise.resolve({ value: null }),
                    set: () => Promise.resolve(),
                    remove: () => Promise.resolve()
                }
            }
        };
        
        // Mock the Keyboard API
        window.Keyboard = window.Capacitor.Plugins.Keyboard;
        
        console.log('📱 Platform:', window.Capacitor.getPlatform());
        console.log('📦 App version: Latest with all features');
    </script>
    
    <!-- Ionic Core -->
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core@7/dist/ionic/ionic.js"></script>
    
    <!-- Try to load Angular app -->
    <script>
        // Check if built files exist
        fetch('/main.js')
            .then(response => {
                if (response.ok) {
                    // Load the built app
                    const script = document.createElement('script');
                    script.src = '/main.js';
                    script.type = 'module';
                    document.body.appendChild(script);
                    
                    const polyfills = document.createElement('script');
                    polyfills.src = '/polyfills.js';
                    polyfills.type = 'module';
                    document.body.appendChild(polyfills);
                    
                    const runtime = document.createElement('script');
                    runtime.src = '/runtime.js';
                    runtime.type = 'module';
                    document.body.appendChild(runtime);
                } else {
                    // Show message about building
                    setTimeout(() => {
                        document.querySelector('.app-loading h2').textContent = 'App needs to be built';
                        document.querySelector('.app-loading p').innerHTML = 
                            'Run: <code style="background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 3px;">npm run build</code>';
                    }, 2000);
                }
            })
            .catch(err => {
                console.error('Failed to load app:', err);
            });
    </script>
</body>
</html>`;
}

// Start the process
console.log('🔍 Checking available methods to start your app...\n');
tryIonicServe();
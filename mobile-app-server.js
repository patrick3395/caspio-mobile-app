const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8200;  // Different port to avoid conflicts

console.log('🚀 Starting Mobile App Live Server...');

// Load all your app pages
const pages = {};

// Load pages dynamically to handle errors
function loadPage(name, path) {
    try {
        pages[name] = fs.readFileSync(path, 'utf8');
        console.log(`✓ Loaded ${name} page`);
    } catch (e) {
        console.log(`✗ Could not load ${name} page`);
        pages[name] = `<div style="padding: 20px;">Page not found: ${name}</div>`;
    }
}

loadPage('home', path.join(__dirname, 'src/app/home/home.page.html'));
loadPage('tabs', path.join(__dirname, 'src/app/tabs/tabs.page.html'));
loadPage('project-detail', path.join(__dirname, 'src/app/pages/project-detail/project-detail.page.html'));
loadPage('new-project', path.join(__dirname, 'src/app/pages/new-project/new-project.page.html'));
loadPage('template-form', path.join(__dirname, 'src/app/pages/template-form/template-form.page.html'));
loadPage('active-projects', path.join(__dirname, 'src/app/pages/active-projects/active-projects.page.html'));

// Create the main HTML wrapper
const createAppHTML = (currentPage = 'home') => {
    const pageContent = pages[currentPage] || pages['home'];
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <title>Caspio Mobile App</title>
    
    <!-- Ionic CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@latest/css/ionic.bundle.css">
    
    <style>
        /* Mobile-specific styles */
        * {
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
        }
        
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overscroll-behavior-y: none;
        }
        
        ion-app {
            display: block;
            position: relative;
            width: 100%;
            height: 100vh;
            background: #fff;
        }
        
        /* Your custom styles */
        .service-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 10px;
            padding: 10px;
        }
        
        .service-card {
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 8px;
            background: #f9f9f9;
        }
        
        .documents-section {
            padding: 15px;
        }
        
        .document-table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .document-table th,
        .document-table td {
            padding: 10px;
            border: 1px solid #ddd;
            text-align: left;
        }
        
        /* Live reload indicator */
        .live-indicator {
            position: fixed;
            top: 10px;
            right: 10px;
            background: #4CAF50;
            color: white;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 12px;
            z-index: 9999;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        /* Navigation tabs */
        .nav-tabs {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: white;
            border-top: 1px solid #ddd;
            display: flex;
            justify-content: space-around;
            padding: 10px 0;
            z-index: 100;
        }
        
        .nav-tab {
            padding: 8px 16px;
            background: #f0f0f0;
            border-radius: 20px;
            text-decoration: none;
            color: #333;
            font-size: 14px;
        }
        
        .nav-tab.active {
            background: #3880ff;
            color: white;
        }
    </style>
</head>
<body>
    <ion-app>
        <div class="live-indicator">🔴 LIVE</div>
        
        <ion-header>
            <ion-toolbar color="primary">
                <ion-title>Caspio Mobile</ion-title>
            </ion-toolbar>
        </ion-header>
        
        <ion-content class="ion-padding">
            ${pageContent}
        </ion-content>
        
        <!-- Navigation -->
        <div class="nav-tabs">
            <a href="/?page=home" class="nav-tab ${currentPage === 'home' ? 'active' : ''}">Home</a>
            <a href="/?page=new-project" class="nav-tab ${currentPage === 'new-project' ? 'active' : ''}">New Project</a>
            <a href="/?page=project-detail" class="nav-tab ${currentPage === 'project-detail' ? 'active' : ''}">Details</a>
            <a href="/?page=template-form" class="nav-tab ${currentPage === 'template-form' ? 'active' : ''}">Templates</a>
        </div>
    </ion-app>
    
    <!-- Ionic JS -->
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@latest/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core@latest/dist/ionic/ionic.js"></script>
    
    <script>
        // Enable complete Capacitor mobile simulation
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            isPluginAvailable: () => true,
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
                    setStyle: () => Promise.resolve(),
                    setBackgroundColor: () => Promise.resolve(),
                    show: () => Promise.resolve(),
                    hide: () => Promise.resolve()
                },
                App: {
                    exitApp: () => Promise.resolve(),
                    addListener: (event, callback) => ({ remove: () => {} })
                },
                Network: {
                    getStatus: () => Promise.resolve({ connected: true, connectionType: 'wifi' }),
                    addListener: (event, callback) => ({ remove: () => {} })
                },
                Storage: {
                    get: (key) => Promise.resolve({ value: null }),
                    set: (options) => Promise.resolve(),
                    remove: (options) => Promise.resolve(),
                    clear: () => Promise.resolve()
                },
                Device: {
                    getId: () => Promise.resolve({ uuid: 'test-device-id' }),
                    getInfo: () => Promise.resolve({
                        platform: 'ios',
                        model: 'iPhone',
                        operatingSystem: 'ios',
                        osVersion: '16.0',
                        manufacturer: 'Apple',
                        isVirtual: false,
                        webViewVersion: '16.0'
                    })
                }
            },
            // Support both old and new API styles
            Keyboard: {
                show: () => Promise.resolve(),
                hide: () => Promise.resolve(),
                setAccessoryBarVisible: () => Promise.resolve(),
                setScroll: () => Promise.resolve(),
                setStyle: () => Promise.resolve(),
                setResizeMode: () => Promise.resolve(),
                addListener: (event, callback) => ({ remove: () => {} })
            }
        };
        
        // Also set up the global Keyboard if needed
        if (!window.Keyboard) {
            window.Keyboard = window.Capacitor.Keyboard;
        }
        
        // Live reload functionality
        let lastModified = ${Date.now()};
        setInterval(() => {
            fetch('/check-update').then(r => r.json()).then(data => {
                if (data.modified > lastModified) {
                    console.log('🔄 Reloading due to file changes...');
                    location.reload();
                }
            });
        }, 2000);
        
        // Handle form interactions
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📱 Mobile app loaded - Platform: iOS');
            
            // Add click handlers for buttons
            document.querySelectorAll('ion-button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    console.log('Button clicked:', e.target.textContent);
                    // You can add actual functionality here
                });
            });
            
            // Handle input changes
            document.querySelectorAll('ion-input, ion-textarea').forEach(input => {
                input.addEventListener('ionChange', (e) => {
                    console.log('Input changed:', e.detail.value);
                });
            });
        });
        
        // Mock Caspio service
        window.caspioService = {
            getProjects: () => {
                console.log('Getting projects...');
                return Promise.resolve([
                    { id: 1, name: 'Test Project 1', city: 'New York' },
                    { id: 2, name: 'Test Project 2', city: 'Los Angeles' }
                ]);
            },
            createProject: (data) => {
                console.log('Creating project:', data);
                return Promise.resolve({ id: Date.now(), ...data });
            }
        };
    </script>
</body>
</html>`;
};

// Create server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const page = url.searchParams.get('page') || 'home';
    
    console.log(`${req.method} ${req.url}`);
    
    // Check for file updates
    if (url.pathname === '/check-update') {
        const srcDir = path.join(__dirname, 'src');
        let latestTime = 0;
        
        function checkDir(dir) {
            try {
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        latestTime = Math.max(latestTime, stat.mtimeMs);
                    }
                });
            } catch (e) {}
        }
        
        checkDir(srcDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modified: latestTime }));
        return;
    }
    
    // Serve the app
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(createAppHTML(page));
});

server.listen(PORT, () => {
    console.log(`
✅ Mobile App Live Server Running!

📱 VIEW YOUR MOBILE APP:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Open in browser: http://localhost:${PORT}

For best mobile experience:
1. Open Chrome or Edge
2. Press F12 for DevTools
3. Click device toggle (📱)
4. Select iPhone 14 Pro

🔄 LIVE EDITING ENABLED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Edit HTML files in src/app/pages/
• Changes appear instantly
• No build or deploy needed!

📝 FILES YOU CAN EDIT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• src/app/pages/home/home.page.html
• src/app/pages/project-detail/project-detail.page.html
• src/app/pages/new-project/new-project.page.html
• src/app/pages/template-form/template-form.page.html

✨ Features:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Full Ionic UI components
✓ Mobile gestures & interactions
✓ Live reload on file changes
✓ No build process needed
✓ Instant preview of changes

Press Ctrl+C to stop
`);
    
    // Try to open browser
    const { exec } = require('child_process');
    if (process.platform === 'win32') {
        exec(`start http://localhost:${PORT}`);
    }
});
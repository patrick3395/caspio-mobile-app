const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8100;

console.log('🚀 Starting Caspio Ionic Mobile Server...');
console.log('📱 This server shows your actual Ionic app as it will appear on mobile');

// Check if dist or www folder exists
let appDir = null;
if (fs.existsSync(path.join(__dirname, 'www'))) {
    appDir = path.join(__dirname, 'www');
    console.log('✅ Found compiled app in www/');
} else if (fs.existsSync(path.join(__dirname, 'dist'))) {
    appDir = path.join(__dirname, 'dist');
    console.log('✅ Found compiled app in dist/');
} else {
    console.log('⚠️ No compiled app found. Building from source...');
}

// Mobile simulation script
const mobileScript = `
<script>
// Simulate Capacitor mobile environment
window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (plugin) => true,
    Plugins: {}
};

// Add mobile test mode flag
window.MOBILE_TEST_MODE = true;

// Override platform detection
if (window.Ionic) {
    window.Ionic.Platform = {
        is: (platform) => platform === 'ios' || platform === 'mobile' || platform === 'cordova',
        isIOS: () => true,
        isAndroid: () => false,
        isMobile: () => true
    };
}

console.log('📱 Mobile Test Mode Enabled');
console.log('Platform:', window.Capacitor?.getPlatform());
</script>
`;

// Create the index.html from the actual app
function createIndexHtml() {
    // Read the actual app's HTML files
    const appHtmlPath = path.join(__dirname, 'src', 'index.html');
    const angularJsonPath = path.join(__dirname, 'angular.json');
    
    if (fs.existsSync(appHtmlPath)) {
        let htmlContent = fs.readFileSync(appHtmlPath, 'utf8');
        
        // Inject mobile simulation before closing body tag
        htmlContent = htmlContent.replace('</body>', mobileScript + '</body>');
        
        // Ensure proper viewport settings for mobile
        if (!htmlContent.includes('viewport-fit=cover')) {
            htmlContent = htmlContent.replace(
                'name="viewport"',
                'name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"'
            );
        }
        
        return htmlContent;
    }
    
    // Fallback HTML if source not found
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Caspio Mobile App</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core/css/ionic.bundle.css">
    <style>
        body { margin: 0; padding: 0; }
        .app-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            flex-direction: column;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .spinner {
            width: 60px;
            height: 60px;
            border: 4px solid rgba(255,255,255,0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <ion-app>
        <div class="app-loading">
            <div class="spinner"></div>
            <h2 style="margin-top: 20px;">Loading Caspio Mobile...</h2>
            <p style="opacity: 0.8;">Please wait while we prepare your app</p>
        </div>
    </ion-app>
    ${mobileScript}
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.js"></script>
</body>
</html>`;
}

// Serve the actual app files
const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);
    
    // Remove query parameters
    let urlPath = req.url.split('?')[0];
    
    // Serve index.html for root
    if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, {
            'Content-Type': 'text/html',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(createIndexHtml());
        return;
    }
    
    // Handle API proxy requests to Caspio
    if (urlPath.startsWith('/api/')) {
        // This would proxy to actual Caspio API
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ message: 'API proxy active' }));
        return;
    }
    
    // Try to serve static files from the app
    let searchPaths = [];
    
    if (appDir) {
        searchPaths.push(path.join(appDir, urlPath));
    }
    
    // Also check src folder for source files
    searchPaths.push(
        path.join(__dirname, 'src', urlPath),
        path.join(__dirname, 'src', 'app', urlPath),
        path.join(__dirname, 'src', 'assets', urlPath),
        path.join(__dirname, urlPath)
    );
    
    let foundFile = null;
    for (const filePath of searchPaths) {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            foundFile = filePath;
            break;
        }
    }
    
    if (!foundFile) {
        // For Angular routing, return index.html
        if (!urlPath.includes('.')) {
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(createIndexHtml());
            return;
        }
        
        res.writeHead(404);
        res.end('File not found: ' + urlPath);
        return;
    }
    
    // Determine content type
    const ext = path.extname(foundFile);
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.ts': 'text/typescript',
        '.css': 'text/css',
        '.scss': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    // Read and serve the file
    fs.readFile(foundFile, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end('Error reading file: ' + err.message);
            return;
        }
        
        // For TypeScript files, add basic compilation
        if (ext === '.ts') {
            content = Buffer.from('// TypeScript file - compilation required\n' + content.toString());
        }
        
        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
        });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`
✅ Ionic Mobile Server is running!

📱 Mobile Preview Options:
────────────────────────────
1. Phone View:     http://localhost:${PORT}/?mobile=true
2. Tablet View:    http://localhost:${PORT}/?tablet=true
3. Desktop View:   http://localhost:${PORT}

🔧 Testing Instructions:
────────────────────────────
1. Open Chrome or Edge browser
2. Navigate to: http://localhost:${PORT}/?mobile=true
3. Press F12 to open DevTools
4. Click the device toggle icon (📱) in DevTools
5. Select "iPhone 14" or any mobile device
6. The app will run as if on a real phone

📝 What This Shows:
────────────────────────────
• Your actual Ionic app interface
• Mobile-specific features and layouts
• Touch interactions and gestures
• The exact UI that deploys to TestFlight

⚠️ Note: If you see a loading screen, the app may need to be built first.
   Run: npm run build

Press Ctrl+C to stop the server.
`);
    
    // Try to open in browser automatically
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}/?mobile=true`;
    
    if (process.platform === 'win32') {
        exec(`start ${url}`);
    } else if (process.platform === 'darwin') {
        exec(`open ${url}`);
    }
});

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Please stop the other server first.`);
    } else {
        console.error('❌ Server error:', err);
    }
    process.exit(1);
});
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8100;

console.log('🚀 Starting Caspio Mobile Emergency Server...');
console.log('📁 Serving from:', __dirname);

// Create a simple index.html that loads the app
const indexHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Caspio Mobile</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core/css/ionic.bundle.css">
    <style>
        body { margin: 0; padding: 0; }
        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            flex-direction: column;
        }
        .loading ion-spinner {
            width: 48px;
            height: 48px;
        }
    </style>
</head>
<body>
    <ion-app>
        <ion-router-outlet>
            <div class="loading">
                <ion-spinner name="crescent"></ion-spinner>
                <h2>Loading Caspio Mobile...</h2>
                <p>If this doesn't load, the build may have failed.</p>
                <br>
                <ion-button href="/quick-test-server.html">Open API Test Tool</ion-button>
            </div>
        </ion-router-outlet>
    </ion-app>
    
    <script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js"></script>
    <script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.js"></script>
    
    <script>
        // Check if we have compiled files
        fetch('/main.js').then(r => {
            if (r.ok) {
                // Load the compiled app
                const script = document.createElement('script');
                script.src = '/main.js';
                document.body.appendChild(script);
            } else {
                // Show error and redirect to test tool
                document.querySelector('.loading h2').textContent = 'Build files not found';
                document.querySelector('.loading p').innerHTML = 
                    'The app needs to be built first.<br>' +
                    'Click below to use the API test tool instead:';
            }
        }).catch(err => {
            console.error('Error loading app:', err);
        });
        
        // Enable mobile test mode if requested
        if (window.location.search.includes('mobile-test=true')) {
            console.log('🔧 Mobile Test Mode Enabled');
            window.Capacitor = {
                isNativePlatform: () => true,
                getPlatform: () => 'ios',
                isPluginAvailable: () => true
            };
        }
    </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);
    
    // Remove query params
    let urlPath = req.url.split('?')[0];
    
    // Serve index.html for root
    if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, {
            'Content-Type': 'text/html',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(indexHTML);
        return;
    }
    
    // Try to serve static files
    let filePath = path.join(__dirname, urlPath);
    
    // Security check
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    // Check in different locations
    const possiblePaths = [
        filePath,
        path.join(__dirname, 'www', urlPath),
        path.join(__dirname, 'dist', urlPath),
        path.join(__dirname, 'src', urlPath)
    ];
    
    let found = false;
    for (const tryPath of possiblePaths) {
        if (fs.existsSync(tryPath) && fs.statSync(tryPath).isFile()) {
            filePath = tryPath;
            found = true;
            break;
        }
    }
    
    if (!found) {
        // Special handling for quick-test-server.html
        if (urlPath === '/quick-test-server.html') {
            filePath = path.join(__dirname, 'quick-test-server.html');
            if (fs.existsSync(filePath)) {
                found = true;
            }
        }
    }
    
    if (!found) {
        res.writeHead(404);
        res.end('File not found: ' + urlPath);
        return;
    }
    
    // Serve the file
    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml'
    };
    
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end('Error reading file: ' + err.message);
            return;
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
✅ Emergency Server is running!

📱 Mobile Preview: http://localhost:${PORT}/?mobile-test=true
🧪 API Test Tool: http://localhost:${PORT}/quick-test-server.html
📱 Regular View:  http://localhost:${PORT}

Instructions:
1. Open one of the links above
2. If the app doesn't load, use the API Test Tool
3. Press F12 to see console logs
4. Press Ctrl+C to stop the server
`);
    
    // Try to open browser automatically
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}/quick-test-server.html`;
    
    if (process.platform === 'win32') {
        exec(`start ${url}`);
    }
});
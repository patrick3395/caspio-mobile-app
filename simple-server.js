const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8100;
const HOST = '0.0.0.0';

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Simple HTML for testing
const testHTML = `<!DOCTYPE html>
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
            background: #e0e0e0;
            border-radius: 8px;
            margin-right: 16px;
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
        .message {
            text-align: center;
            padding: 40px;
            color: #666;
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
</head>
<body>
    <div class="header">
        <h1>ACTIVE PROJECTS</h1>
    </div>
    <div class="container">
        <div class="project-item">
            <div class="project-image"></div>
            <div class="project-details">
                <div class="project-address">385 Lobo Way, Sugarland, TX</div>
                <div class="project-status">Active Project</div>
            </div>
        </div>
        
        <div class="project-item">
            <div class="project-image"></div>
            <div class="project-details">
                <div class="project-address">128 San Saba Way, Missouri City, TX</div>
                <div class="project-status">Active Project</div>
            </div>
        </div>
    </div>
    
    <div class="bottom-nav">
        <a href="#" class="nav-item active">📄</a>
        <a href="#" class="nav-item">👤</a>
        <a href="#" class="nav-item">🔍</a>
        <a href="#" class="nav-item">☰</a>
    </div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);
  
  // Parse URL
  const parsedUrl = url.parse(req.url);
  let pathname = `.${parsedUrl.pathname}`;
  
  // Default to index
  if (pathname === './') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(testHTML);
    return;
  }
  
  // Try to serve static files
  fs.readFile(pathname, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    
    const ext = path.extname(pathname);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`
========================================
Development server running!
========================================

Local:    http://localhost:${PORT}
Network:  http://172.30.107.220:${PORT}

View on your phone using the Network URL
(Make sure you're on the same WiFi)

Press Ctrl+C to stop the server
========================================
  `);
});
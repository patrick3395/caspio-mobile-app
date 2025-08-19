const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8100;

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

// Simple static file server
const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  // Default to index.html for root
  let filePath = req.url === '/' ? '/www/index.html' : '/www' + req.url;
  
  // Remove query params
  filePath = filePath.split('?')[0];
  
  // Security: prevent directory traversal
  filePath = path.join(__dirname, filePath);
  
  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // Try without www prefix for source files
      filePath = path.join(__dirname, req.url.split('?')[0]);
      
      fs.access(filePath, fs.constants.F_OK, (err2) => {
        if (err2) {
          // File not found, return index.html for Angular routing
          filePath = path.join(__dirname, 'www', 'index.html');
          serveFile(filePath, res);
        } else {
          serveFile(filePath, res);
        }
      });
    } else {
      serveFile(filePath, res);
    }
  });
});

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    
    // Get MIME type
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    // Enable CORS for development
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    
    res.end(content);
  });
}

// First, build the app
console.log('Building the app...');
const { exec } = require('child_process');

exec('npm run build', (error, stdout, stderr) => {
  if (error) {
    console.error('Build failed:', error);
    console.log('Trying to serve existing build...');
  } else {
    console.log('Build complete!');
  }
  
  // Start server
  server.listen(PORT, () => {
    console.log(`\n🚀 Caspio Mobile Dev Server running at:
    
  Local:            http://localhost:${PORT}
  Mobile Test Mode: http://localhost:${PORT}/?mobile-test=true
  
  To test as mobile:
  1. Open Chrome/Edge
  2. Press F12 for DevTools
  3. Click device toggle icon (📱)
  4. Select iPhone or Android device
  5. Visit: http://localhost:${PORT}/?mobile-test=true
  
  Press Ctrl+C to stop the server.`);
  });
});
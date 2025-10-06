#!/usr/bin/env node

/**
 * Build script for creating a web-embeddable version of the app
 * This builds the app and prepares it for Squarespace injection
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🌐 Building web version of Noble Property Inspections app...\n');

// Step 1: Build the app with web configuration
console.log('Step 1: Building Angular app with web configuration...');
try {
  execSync('ng build --configuration web', {
    stdio: 'inherit',
    cwd: __dirname
  });
  console.log('✅ Build complete\n');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

// Step 2: Create injection files
console.log('Step 2: Creating Squarespace injection files...');

const distPath = path.join(__dirname, 'dist', 'web');
const indexPath = path.join(distPath, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('❌ index.html not found in dist/web');
  process.exit(1);
}

// Read the built index.html
const indexHtml = fs.readFileSync(indexPath, 'utf8');

// Extract script and style tags
const scriptMatches = [...indexHtml.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)];
const styleMatches = [...indexHtml.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"[^>]*>/g)];

// Create the injection script
const injectionScript = `
<!-- Noble Property Inspections App - Injection Script -->
<!-- Place this code in your Squarespace page where you want the app to appear -->

<div id="noble-app-container" style="width: 100%; min-height: 600px;">
  <app-root></app-root>
</div>

<!-- Styles -->
${styleMatches.map(match => `<link rel="stylesheet" href="/noble-app/${match[1]}">`).join('\n')}

<!-- Scripts -->
${scriptMatches.map(match => `<script src="/noble-app/${match[1]}" type="module"></script>`).join('\n')}

<!-- Initialization -->
<script>
  // Ensure Angular app initializes properly
  if (typeof Zone === 'undefined') {
    console.error('Zone.js not loaded properly');
  }
</script>
`;

fs.writeFileSync(path.join(distPath, 'squarespace-injection.html'), injectionScript);

// Create upload instructions
const instructions = `
# Squarespace Integration Instructions

## Step 1: Upload Files

1. Go to your Squarespace dashboard
2. Navigate to Settings > Advanced > Code Injection
3. Upload all files from the \`dist/web\` folder to your Squarespace site

**Option A: Using Squarespace File Upload**
- Go to Pages > (gear icon) > Advanced
- Upload each file from dist/web to a folder called "/noble-app/"

**Option B: Using FTP/SFTP** (if available)
- Upload the entire contents of dist/web to /noble-app/ directory
- Make sure to preserve the file structure

## Step 2: Inject the Code

1. Go to the page where you want the app to appear
2. Add a "Code Block" to your page
3. Copy the contents of \`squarespace-injection.html\`
4. Paste it into the Code Block

## Step 3: Verify

Visit your page and the app should load!

## File List

All files in dist/web need to be uploaded:
${fs.readdirSync(distPath).map(file => `- ${file}`).join('\n')}

## Base URL Configuration

The app is configured to expect files at: /noble-app/

If you need to change this path:
1. Edit angular.json - change "baseHref" and "deployUrl" in the "web" configuration
2. Rebuild with: npm run build:web
3. Update the file paths in squarespace-injection.html accordingly

## Troubleshooting

**App doesn't load:**
- Check browser console for 404 errors
- Verify all files are uploaded to the correct path
- Check that file permissions allow public access

**Styling issues:**
- Make sure all CSS files are loaded
- Check for Content Security Policy restrictions in Squarespace

**Functionality issues:**
- The app requires an internet connection for Caspio API calls
- Check that JavaScript is enabled
- Verify no ad blockers are interfering

## Support

For issues, check the browser console (F12) for error messages.
`;

fs.writeFileSync(path.join(distPath, 'INTEGRATION-INSTRUCTIONS.md'), instructions);

console.log('✅ Injection files created\n');
console.log('📦 Output location: dist/web/');
console.log('📄 Integration file: dist/web/squarespace-injection.html');
console.log('📖 Instructions: dist/web/INTEGRATION-INSTRUCTIONS.md');
console.log('\n🎉 Build complete! See INTEGRATION-INSTRUCTIONS.md for next steps.\n');

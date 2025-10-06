#!/usr/bin/env node

/**
 * Creates Squarespace injection files from existing www build
 * Run this AFTER building your app (npm run build:mobile or npm run build:prod)
 */

const fs = require('fs');
const path = require('path');

console.log('🌐 Creating Squarespace injection files...\n');

const wwwPath = path.join(__dirname, 'www');
const indexPath = path.join(wwwPath, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('❌ Error: www/index.html not found');
  console.error('Please build your app first with: npm run build:prod');
  process.exit(1);
}

// Read the built index.html
const indexHtml = fs.readFileSync(indexPath, 'utf8');

// Extract script and style tags
const scriptMatches = [...indexHtml.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)];
const styleMatches = [...indexHtml.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"[^>]*>/g)];

console.log(`Found ${styleMatches.length} stylesheets and ${scriptMatches.length} scripts\n`);

// Create the injection script
const injectionScript = `<!-- Noble Property Inspections App - Squarespace Injection Code -->
<!-- Instructions:
1. Upload all files from the 'www' folder to your web hosting
2. Place them in a directory accessible at: /noble-app/
3. Add this code block to your Squarespace page where you want the app
-->

<div id="noble-app-container" style="width: 100%; min-height: 600px;">
  <app-root></app-root>
</div>

<!-- Stylesheets -->
${styleMatches.map(match => `<link rel="stylesheet" href="/noble-app/${match[1]}">`).join('\n')}

<!-- Scripts -->
${scriptMatches.map(match => {
  const isModule = match[0].includes('type="module"');
  const typeAttr = isModule ? ' type="module"' : '';
  return `<script src="/noble-app/${match[1]}"${typeAttr}></script>`;
}).join('\n')}
`;

fs.writeFileSync(path.join(wwwPath, 'squarespace-injection.html'), injectionScript);

// Create comprehensive instructions
const fileList = fs.readdirSync(wwwPath)
  .filter(f => f !== 'squarespace-injection.html' && f !== 'SQUARESPACE-INTEGRATION.md')
  .map(f => `  - ${f}`)
  .join('\n');

const instructions = `# Squarespace Integration Guide

## Quick Start

Your Noble Property Inspections app is now ready to embed in Squarespace!

## Option 1: Direct Upload to Squarespace (Simplest)

### Step 1: Upload Files

1. **Prepare files**: Zip the entire contents of the \`www\` folder
2. **In Squarespace**:
   - Go to Settings > Advanced > Import/Export
   - Or use Pages > (click page) > Settings > Advanced

### Step 2: Add Code to Your Page

1. Go to the Squarespace page where you want your app
2. Add a **Code Block**
3. Copy the contents of \`squarespace-injection.html\`
4. Paste into the Code Block
5. **Important**: Update all paths from \`/noble-app/\` to match where you uploaded the files

### Limitations
- Squarespace has file size limits
- May not support all file types

## Option 2: External Hosting (Recommended)

### Using Netlify (Free & Easy)

1. **Install Netlify CLI**:
   \`\`\`bash
   npm install -g netlify-cli
   \`\`\`

2. **Deploy**:
   \`\`\`bash
   cd www
   netlify deploy --prod
   \`\`\`

3. **Get your URL**: Netlify will give you a URL like \`https://your-app.netlify.app\`

4. **Update paths**: In \`squarespace-injection.html\`, change all \`/noble-app/\` to \`https://your-app.netlify.app/\`

5. **Add to Squarespace**: Copy updated injection code to a Code Block

### Using Vercel (Alternative)

1. **Install Vercel CLI**:
   \`\`\`bash
   npm install -g vercel
   \`\`\`

2. **Deploy**:
   \`\`\`bash
   cd www
   vercel --prod
   \`\`\`

3. Follow steps 3-5 from Netlify instructions above

### Using GitHub Pages

1. **Create a new repo** on GitHub

2. **Deploy**:
   \`\`\`bash
   cd www
   git init
   git add .
   git commit -m "Deploy Noble app"
   git branch -M gh-pages
   git remote add origin YOUR_REPO_URL
   git push -u origin gh-pages
   \`\`\`

3. **Enable GitHub Pages**: In repo settings, enable Pages from gh-pages branch

4. **Get URL**: Will be \`https://yourusername.github.io/repo-name/\`

5. Update injection code paths and add to Squarespace

## Option 3: Subdomain (Most Professional)

### Best For Production

1. **Create subdomain**: app.yourdomain.com or inspections.yourdomain.com

2. **Upload files**: Via FTP, cPanel, or hosting provider's file manager

3. **Configure DNS**: Point subdomain to your hosting

4. **Two integration options**:

   **A. Direct Link**:
   - Simply link to https://app.yourdomain.com from your main site
   - Users access full app in new tab

   **B. Iframe Embed**:
   \`\`\`html
   <iframe src="https://app.yourdomain.com"
           width="100%"
           height="800px"
           frameborder="0"
           style="border: none;">
   </iframe>
   \`\`\`

## Files to Upload

${fileList}

## Configuration

### Changing Base Path

If you need to host at a different path (e.g., \`/app/\` instead of \`/noble-app/\`):

1. Edit \`angular.json\`:
   \`\`\`json
   "web": {
     "baseHref": "/app/",
     "deployUrl": "/app/"
   }
   \`\`\`

2. Rebuild: \`npm run build:web\`

3. Update paths in injection code

### Security Notes

⚠️ **Important**: Your Caspio API credentials are embedded in the JavaScript files.

**Recommended Security Measures**:
1. Use Caspio's domain whitelisting feature
2. Implement rate limiting
3. Consider adding authentication to your app
4. Monitor API usage in Caspio dashboard

## Testing Locally

Before deploying, test locally:

\`\`\`bash
# Install http-server
npm install -g http-server

# Serve the www directory
cd www
http-server -p 8080

# Open http://localhost:8080 in your browser
\`\`\`

## Troubleshooting

### App Doesn't Load
- **Check browser console** (F12 > Console tab)
- Look for 404 errors on missing files
- Verify all file paths are correct
- Check that files are publicly accessible

### Styling Issues
- Squarespace theme CSS may conflict
- Try wrapping injection code in:
  \`\`\`html
  <div class="noble-app-isolated" style="all: initial;">
    <!-- injection code here -->
  </div>
  \`\`\`

### Features Not Working

**Camera/Photo Upload**:
- Uses file upload input on web (works in all browsers)
- Native camera works on mobile browsers

**CORS Errors**:
- Check Caspio CORS settings
- Verify API endpoints are accessible
- May need to whitelist your domain in Caspio

**Performance**:
- First load may be slow (downloading files)
- Enable compression on your web server
- Use a CDN if possible
- Browser will cache files after first visit

## Updating Your App

When you make changes:

1. Rebuild: \`npm run build:prod\`
2. Run: \`node create-web-inject.js\` (regenerates injection code)
3. Re-upload changed files
4. Clear browser cache or increment version in filename

## Support

For issues:
- **App functionality**: Check your app code
- **Squarespace integration**: Squarespace support
- **Hosting**: Your hosting provider's support

## Next Steps

After deployment:
- [ ] Test all features thoroughly
- [ ] Set up Google Analytics (optional)
- [ ] Monitor for errors with Sentry or similar (optional)
- [ ] Set up SSL/HTTPS (usually automatic with Netlify/Vercel)
- [ ] Create automated deployment pipeline (optional)

---

Built with Angular + Ionic
Version: ${require('./package.json').version}
`;

fs.writeFileSync(path.join(wwwPath, 'SQUARESPACE-INTEGRATION.md'), instructions);

console.log('✅ Files created successfully!\n');
console.log('📄 Injection code: www/squarespace-injection.html');
console.log('📖 Full instructions: www/SQUARESPACE-INTEGRATION.md');
console.log('\n📦 Next steps:');
console.log('1. Read www/SQUARESPACE-INTEGRATION.md for deployment options');
console.log('2. Choose your hosting method (Netlify recommended)');
console.log('3. Deploy your files');
console.log('4. Add injection code to Squarespace\n');

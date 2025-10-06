# Web Deployment Guide for Noble Property Inspections

## Overview

This guide shows you how to take your existing mobile app and deploy it as a web application that can be embedded in your Squarespace website or hosted standalone.

**Key Point**: Your mobile app doesn't change at all. We're using the same build output and making it work on the web.

## Quick Start (3 Steps)

### Step 1: Build Your App

```bash
npm run build:web
```

This will:
1. Build your production app (same as mobile)
2. Generate Squarespace injection code
3. Create detailed integration instructions
4. Output everything you need in the `www/` folder

### Step 2: Choose Hosting

Pick one:
- **Netlify** (recommended - free, fast, easy)
- **Vercel** (alternative - also free and easy)
- **GitHub Pages** (good for open source)
- **Your own subdomain** (most professional)
- **Squarespace directly** (simplest but limited)

### Step 3: Deploy

Follow the instructions in `www/SQUARESPACE-INTEGRATION.md` for your chosen hosting method.

## Detailed Setup

### Option A: Netlify (Recommended)

**Why Netlify?**
- Free tier is generous
- Automatic HTTPS
- Global CDN (fast worldwide)
- Easy drag-and-drop deployment
- Great for Angular apps

**Steps:**

1. **Build your app**:
   ```bash
   npm run build:web
   ```

2. **Deploy to Netlify** (choose one method):

   **Method 1: Drag and Drop** (easiest)
   - Go to [netlify.com](https://netlify.com)
   - Sign up (free)
   - Drag the `www` folder to the deploy zone
   - Done! You'll get a URL like `https://your-app.netlify.app`

   **Method 2: Netlify CLI** (for updates)
   ```bash
   npm install -g netlify-cli
   cd www
   netlify deploy --prod
   ```

3. **Add to Squarespace**:
   - Open `www/squarespace-injection.html`
   - Replace all `/noble-app/` with `https://your-app.netlify.app/`
   - Copy the updated code
   - In Squarespace, add a Code Block and paste

### Option B: Subdomain (app.yourdomain.com)

**Why a subdomain?**
- Most professional
- Full control
- Custom branding
- Best performance

**Steps:**

1. **Build your app**:
   ```bash
   npm run build:web
   ```

2. **Set up subdomain**:
   - In your domain registrar (GoDaddy, Namecheap, etc.)
   - Create subdomain: `app.yourdomain.com`
   - Point it to your web hosting

3. **Upload files**:
   - Via FTP, cPanel, or file manager
   - Upload all files from `www/` folder
   - Upload to the subdomain's root directory

4. **Integration options**:

   **Option A: Direct link** (simplest)
   ```html
   <a href="https://app.yourdomain.com">Launch Inspector App</a>
   ```

   **Option B: Embed with iframe**
   ```html
   <iframe src="https://app.yourdomain.com"
           width="100%"
           height="800px"
           frameborder="0">
   </iframe>
   ```

   **Option C: Code injection** (most integrated)
   - Use the injection code from `www/squarespace-injection.html`
   - Update paths to use your subdomain
   - Add to Squarespace Code Block

### Option C: GitHub Pages (Free)

**Why GitHub Pages?**
- 100% free
- Automatic HTTPS
- Good for open source projects
- Easy to update via git

**Steps:**

1. **Build your app**:
   ```bash
   npm run build:web
   ```

2. **Create GitHub repo** and push:
   ```bash
   cd www
   git init
   git add .
   git commit -m "Initial deploy"
   git branch -M gh-pages
   git remote add origin https://github.com/yourusername/noble-app.git
   git push -u origin gh-pages
   ```

3. **Enable GitHub Pages**:
   - Go to repo Settings > Pages
   - Source: Deploy from branch
   - Branch: gh-pages
   - Save

4. **Your URL**: `https://yourusername.github.io/noble-app/`

5. **Add to Squarespace**: Use injection code with updated paths

## Just Need the Injection Files?

If you've already built your app and just need new injection files:

```bash
npm run create-web-inject
```

This regenerates `www/squarespace-injection.html` and `www/SQUARESPACE-INTEGRATION.md` without rebuilding the app.

## Configuration

### Base Path

Your app is currently configured for `/noble-app/` path. To change:

1. Create `angular.json` web configuration (if not exists):
   ```json
   {
     "configurations": {
       "web": {
         "baseHref": "/your-path/",
         "deployUrl": "/your-path/",
         "outputPath": "www"
       }
     }
   }
   ```

2. Rebuild:
   ```bash
   npm run build:web
   ```

### Environment Variables

The app uses the same environment as your mobile build (`environment.prod.ts`). All your Caspio API settings work the same.

## Features That Work on Web

| Feature | Mobile | Web | Notes |
|---------|--------|-----|-------|
| Login | ✅ | ✅ | Identical |
| Projects | ✅ | ✅ | Identical |
| Templates | ✅ | ✅ | Identical |
| Photo Upload | Native Camera | File Picker | Works, different UI |
| Photo Annotation | ✅ | ✅ | Identical |
| PDF Generation | ✅ | ✅ | Identical |
| Offline Mode | ✅ | ✅ | Uses browser storage |
| Push Notifications | ✅ | ❌ | Mobile only |

## Security Considerations

⚠️ **Important**: Your build contains API credentials in JavaScript files.

**What to do:**

1. **Use Caspio's security features**:
   - Enable domain whitelisting in Caspio
   - Set up rate limiting
   - Monitor API usage

2. **Add authentication**:
   - Your app already has login
   - Make sure it's enforced
   - Consider adding session timeouts

3. **Don't commit sensitive data**:
   - Keep `environment.prod.ts` out of public repos
   - Use environment variables for secrets

## Testing Before Going Live

### Local Testing

```bash
# Install a simple HTTP server
npm install -g http-server

# Serve your built app
cd www
http-server -p 8080

# Open http://localhost:8080
```

### Things to Test

- [ ] Login works
- [ ] Can create/view projects
- [ ] Photo upload (uses file picker on web)
- [ ] Photo annotation
- [ ] PDF generation
- [ ] All template forms
- [ ] Mobile responsiveness
- [ ] Different browsers (Chrome, Safari, Firefox)

## Troubleshooting

### Build Errors

If `npm run build:web` fails:
```bash
# Try building mobile first to see if it's a general issue
npm run build:prod

# If mobile build works but web doesn't, check angular.json
```

### App Doesn't Load

1. **Check browser console** (F12 > Console)
2. Look for 404 errors (missing files)
3. Verify file paths in injection code
4. Check that all files were uploaded

### Styling Looks Wrong

Squarespace CSS might interfere. Wrap injection code:
```html
<div style="all: revert; width: 100%;">
  <!-- your injection code here -->
</div>
```

### CORS Errors

- Check Caspio CORS settings
- Whitelist your domain in Caspio
- Make sure API endpoints allow your domain

## Updating Your App

When you make code changes:

```bash
# 1. Make your changes
# 2. Rebuild
npm run build:web

# 3. Redeploy to your hosting
# (steps depend on your hosting choice)
```

## Performance Tips

1. **Enable compression** on your web server (gzip/brotli)
2. **Use a CDN** (Netlify/Vercel do this automatically)
3. **Browser caching** is automatic (files have hashes in names)
4. **Lazy loading** is already configured in your app

## Going Further

### Custom Domain on Netlify/Vercel

Both platforms support custom domains:
- Add your domain in their dashboard
- Update DNS records as instructed
- SSL is automatic

### Automated Deployment

Set up CI/CD to auto-deploy when you push to Git:
- Netlify: Connect to your Git repo
- Vercel: Connect to your Git repo
- GitHub Actions: Create workflow file

### Analytics

Add Google Analytics or similar:
```typescript
// In app.component.ts
declare var gtag: any;

// Track page views
this.router.events.subscribe(event => {
  if (event instanceof NavigationEnd) {
    gtag('config', 'GA_MEASUREMENT_ID', {
      page_path: event.urlAfterRedirects
    });
  }
});
```

## File Structure

After running `npm run build:web`, your `www/` folder contains:

```
www/
├── index.html                          # Main HTML file
├── main.*.js                           # Your app code (bundled)
├── polyfills.*.js                      # Browser compatibility
├── runtime.*.js                        # Webpack runtime
├── styles.*.css                        # All your styles
├── assets/                             # Images, icons, etc.
├── squarespace-injection.html          # Code to inject
└── SQUARESPACE-INTEGRATION.md          # Detailed instructions
```

## Support

For help with:
- **App features**: Check your app code
- **Build process**: Check Angular build logs
- **Hosting**: Your hosting provider's docs
- **Squarespace**: Squarespace support

## Summary

The simplest path:
1. `npm run build:web`
2. Upload `www/` folder to Netlify (drag and drop)
3. Copy injection code, update URLs to your Netlify URL
4. Paste in Squarespace Code Block

Done! Your app is now on the web.

---

Built with Angular + Ionic for Noble Property Inspections

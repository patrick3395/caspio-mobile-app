# Quick Web Deployment Guide

## The Simple Way (No Rebuilding Needed!)

Your mobile app already builds to the `www` folder for mobile deployment. That same build works perfectly for web! Here's how to deploy it:

### Step 1: Use Your Existing Mobile Build

```bash
# If you haven't built recently, build for mobile:
npm run build:mobile

# This creates the www/ folder with all your app files
```

### Step 2: Deploy to Netlify (Easiest - 2 Minutes)

1. Go to [netlify.com](https://netlify.com) and sign up (free)
2. Drag and drop your entire `www` folder onto their deploy zone
3. You'll get a URL like: `https://random-name-12345.netlify.app`
4. Done! Your app is live on the web

### Step 3: Embed in Squarespace

**Option A: Direct Link** (Simplest)
Just add a button/link in Squarespace:
```html
<a href="https://your-app.netlify.app" target="_blank" class="button">Launch App</a>
```

**Option B: Iframe** (Embedded)
Add a Code Block in Squarespace with:
```html
<iframe src="https://your-app.netlify.app"
        width="100%"
        height="800px"
        style="border: none; min-height: 600px;">
</iframe>
```

**Option C: Full Integration** (Most Seamless)
Add a Code Block with:
```html
<!-- Container for the app -->
<div id="noble-app-container" style="width: 100%; min-height: 600px;">
  <app-root></app-root>
</div>

<!-- Load the app files from Netlify -->
<script>
  // Dynamically load all scripts from your Netlify URL
  const baseUrl = 'https://your-app.netlify.app';

  // Load styles
  const styles = document.querySelectorAll('link[rel="stylesheet"]');
  fetch(baseUrl + '/index.html')
    .then(r => r.text())
    .then(html => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Inject stylesheets
      doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const newLink = document.createElement('link');
        newLink.rel = 'stylesheet';
        newLink.href = baseUrl + '/' + link.getAttribute('href');
        document.head.appendChild(newLink);
      });

      // Inject scripts
      doc.querySelectorAll('script[src]').forEach(script => {
        const newScript = document.createElement('script');
        newScript.src = baseUrl + '/' + script.getAttribute('src');
        if (script.type) newScript.type = script.type;
        document.body.appendChild(newScript);
      });
    });
</script>
```

## Alternative: Use Your Own Subdomain

### Step 1: Create Subdomain
- Create `app.yourdomain.com` in your domain settings
- Point it to your web hosting

### Step 2: Upload Files
- Upload entire `www` folder to your web hosting via FTP/cPanel
- Make sure files are in the subdomain's root directory

### Step 3: Link from Squarespace
Simply link to: `https://app.yourdomain.com`

## What Works on Web?

Everything except:
- Native camera (uses file upload instead - still works!)
- Push notifications (mobile only)

All your features work identically:
- ✅ Login
- ✅ Projects
- ✅ Templates
- ✅ Photo upload (via file picker)
- ✅ Photo annotation
- ✅ PDF generation
- ✅ All forms

## Updating Your App

When you make changes:
1. Rebuild: `npm run build:mobile`
2. Re-upload `www` folder to Netlify (or your hosting)
3. Done!

## Troubleshooting

**App won't load:**
- Check browser console (F12)
- Make sure all files were uploaded
- Verify your Netlify/hosting URL is correct

**CORS errors:**
- Check Caspio CORS settings
- Add your domain to Caspio's whitelist

**Styling issues:**
- Squarespace CSS might conflict
- Use iframe method instead

## Cost

- **Netlify**: Free tier (100GB bandwidth/month)
- **Vercel**: Free tier (similar limits)
- **Your hosting**: Whatever you already pay

## Security

Your Caspio credentials are in the JavaScript files (same as mobile). To secure:
1. Enable domain whitelisting in Caspio
2. Your app already has login authentication
3. Monitor API usage in Caspio dashboard

## Summary

**Absolute simplest path:**
1. `npm run build:mobile` (if not already built)
2. Drag `www` folder to netlify.com
3. Add iframe or link to Squarespace
4. Done!

Total time: **Under 5 minutes**

No configuration changes needed. No separate web build. Just deploy what you already have!

---

Need help? The `www` folder is created automatically by your normal mobile builds. It contains everything needed for web deployment.

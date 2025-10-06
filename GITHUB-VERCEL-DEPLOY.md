# Deploy to Vercel via GitHub (Recommended Method)

## Why This Method?

- ✅ **No local build needed** - Vercel builds on their servers
- ✅ **Automatic deployments** - Push to GitHub, auto-deploys
- ✅ **Free hosting** - Generous free tier
- ✅ **Global CDN** - Fast worldwide
- ✅ **Automatic HTTPS** - SSL included
- ✅ **Preview deployments** - Every PR gets a preview URL

## Step-by-Step Guide

### Step 1: Push to GitHub

```bash
# Add all your files (vercel.json is already configured)
git add .
git commit -m "Add Vercel configuration for web deployment"
git push origin master
```

**That's it for the code!** Your `vercel.json` file tells Vercel how to build your app.

### Step 2: Connect to Vercel

1. **Go to [vercel.com](https://vercel.com)** and sign in with GitHub

2. **Click "Add New Project"**

3. **Import your repository**:
   - Find your `Caspio` repository
   - Click "Import"

4. **Configure the project**:
   - **Framework Preset**: Select "Other"
   - **Root Directory**: `./` (leave as is)
   - **Build Command**: `npm run build:mobile` (auto-filled from vercel.json)
   - **Output Directory**: `www` (auto-filled from vercel.json)
   - **Install Command**: `npm install` (auto-filled)

5. **Environment Variables** (if needed):
   - Click "Add" if you want to override any environment settings
   - For now, skip this - your app uses `environment.prod.ts` automatically

6. **Click "Deploy"**

### Step 3: Wait for Build

Vercel will:
- Install your dependencies
- Run `npm run build:mobile`
- Deploy the `www` folder
- Give you a live URL like: `https://caspio-xyz123.vercel.app`

**Build time**: Usually 2-5 minutes

### Step 4: Get Your URLs

After deployment, you'll have:
- **Production URL**: `https://your-project.vercel.app`
- **Custom domain** (optional): Can add your own domain

### Step 5: Add to Squarespace

Now that your app is live on Vercel, add it to Squarespace:

#### Option A: Iframe Embed (Easiest)

Add a Code Block to your Squarespace page:

```html
<div style="width: 100%; min-height: 800px;">
  <iframe
    src="https://your-project.vercel.app"
    width="100%"
    height="800px"
    style="border: none; min-height: 600px; border-radius: 8px;"
    allow="camera; geolocation">
  </iframe>
</div>
```

#### Option B: Direct Link

Add a button/link:

```html
<a href="https://your-project.vercel.app"
   target="_blank"
   class="sqs-block-button-element">
  Launch Inspector App
</a>
```

#### Option C: Full Page Redirect

In Squarespace:
- Create a new page
- Set it to redirect to your Vercel URL
- Add to your navigation

## Automatic Updates

Once set up, your workflow is:

```bash
# Make your changes locally
# Commit and push
git add .
git commit -m "Your changes"
git push

# Vercel automatically:
# 1. Detects the push
# 2. Builds your app
# 3. Deploys it
# 4. Updates your live site
```

**No manual deployment needed!**

## Custom Domain (Optional)

To use your own domain (e.g., `app.nobleinspections.com`):

1. **In Vercel Dashboard**:
   - Go to your project
   - Click "Settings" > "Domains"
   - Add your domain

2. **In your DNS settings** (GoDaddy, Cloudflare, etc.):
   - Add the DNS records Vercel provides
   - Usually a CNAME record

3. **Wait for DNS** (a few minutes to 24 hours)

4. **Update Squarespace** with your custom domain

## Environment Variables

If you need different settings for production:

1. **In Vercel Dashboard**:
   - Go to Settings > Environment Variables
   - Add variables like:
     - `NODE_ENV=production`
     - Or any Caspio API settings you want to override

2. **Redeploy** to apply changes

## Monitoring & Logs

**View logs**:
- Go to your project in Vercel
- Click "Deployments"
- Click any deployment to see logs

**Useful for debugging** if something doesn't work

## Preview Deployments

Every Git branch gets its own URL:
- `master` branch → Production URL
- Other branches → Preview URLs

**Great for testing** before going live!

## Troubleshooting

### Build Fails on Vercel

**Check the build logs** in Vercel dashboard

Common fixes:
1. Make sure all dependencies are in `package.json`
2. Check that `build:mobile` script works locally
3. Verify Node version (Vercel uses Node 18 by default)

### App Loads But Doesn't Work

1. **Check browser console** (F12)
2. **CORS issues?**
   - Verify Caspio CORS settings
   - Add your Vercel domain to Caspio whitelist
3. **API errors?**
   - Check Caspio credentials in `environment.prod.ts`

### Iframe Not Showing

1. **CSP (Content Security Policy)**
   - Some sites block iframes
   - Try "Direct Link" method instead

2. **Height issues**
   - Adjust iframe height
   - Use `min-height` instead of fixed height

## Cost

**Vercel Free Tier includes**:
- Unlimited deployments
- 100GB bandwidth per month
- Automatic HTTPS
- Global CDN
- Preview deployments

**Enough for most small-medium apps**

If you exceed limits, paid plans start at $20/month

## Security

Your code is public on GitHub but:
- Caspio credentials are in built files (not source)
- Use Caspio's domain whitelisting
- Your app already has login authentication
- Monitor API usage

**Best practice**: Use environment variables in Vercel for sensitive data (optional)

## What Gets Built?

Vercel runs: `npm run build:mobile`

This creates:
- `/www/index.html` - Your app entry point
- `/www/*.js` - Your compiled app code
- `/www/*.css` - Your styles
- `/www/assets/` - Images, icons, etc.

Vercel serves these files as a static website

## Testing Before Deployment

Want to test locally first?

```bash
# Build locally
npm run build:mobile

# Serve locally
npx http-server www -p 8080

# Visit http://localhost:8080
```

## Comparison: Vercel vs Netlify

Both work great! Vercel is configured (see `vercel.json`).

| Feature | Vercel | Netlify |
|---------|--------|---------|
| Setup | Use vercel.json | Drag & drop |
| Git integration | Built-in | Built-in |
| Free tier | 100GB | 100GB |
| Speed | Excellent | Excellent |
| Ease | Very easy | Slightly easier |

**Use Vercel** since we've already configured it!

## Summary

1. Push code to GitHub ✓
2. Connect Vercel to your GitHub repo
3. Click Deploy
4. Get URL like `https://your-app.vercel.app`
5. Embed in Squarespace with iframe

**Total time: 5-10 minutes**

Then every future update is just: `git push` 🚀

---

Your `vercel.json` is already configured and ready to go!

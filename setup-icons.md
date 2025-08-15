# Icon Setup Instructions for Mobile Deployment

## Download Icons
1. Download all PNG icons from: https://drive.google.com/drive/u/0/folders/1-sPvEaJtRvjnteevRYkdUf5-ApOyjMF7
2. Place them in BOTH directories:
   - `/mnt/c/Users/Owner/Caspio/icons/` (for development server)
   - `/mnt/c/Users/Owner/Caspio/src/assets/icons/` (for mobile app)

## Icon Usage

### In Development Server (caspio-dev-server.js)
```html
<img src="/icons/your-icon.png" alt="" style="width: 24px; height: 24px;">
```

### In Ionic/Angular Components (for mobile)
```html
<img src="assets/icons/your-icon.png" alt="" style="width: 24px; height: 24px;">
```

## Mobile Deployment
When you build the app for mobile:
```bash
# Icons in src/assets/ are automatically included in the build
npm run build
npx cap sync
npx cap open ios  # or android
```

## Icon Naming Suggestions
Based on your app sections, name your icons:
- `information.png` - For Information section
- `structure.png` - For Structural Systems section  
- `elevation.png` - For Elevation Plot section
- `home.png` - For home/dashboard
- `projects.png` - For projects list
- `user.png` - For user profile
- `search.png` - For search
- `menu.png` - For menu

## Converting Icons for Production

### Option 1: Base64 Encoding (Embeds icons in code)
If you want icons embedded in the code for faster loading:
```bash
# Convert PNG to base64
base64 -w 0 your-icon.png > your-icon.base64.txt
```

Then use in CSS:
```css
.icon-custom {
    background-image: url('data:image/png;base64,PASTE_BASE64_HERE');
}
```

### Option 2: Icon Font (Most efficient for multiple icons)
Convert your PNGs to an icon font using:
- https://icomoon.io/app/
- https://fontello.com/

## Testing Icons

### Development Server
1. Place icons in `/mnt/c/Users/Owner/Caspio/icons/`
2. Access at: http://localhost:8100/icons/your-icon.png

### Mobile App
1. Place icons in `/mnt/c/Users/Owner/Caspio/src/assets/icons/`
2. Build and run:
```bash
npm run build
npx cap sync
npx cap run ios --livereload --external
```

## Important Notes
- Icons in `src/assets/` are bundled with the app during build
- No internet connection needed for bundled icons
- Keep icon files small (< 50KB each) for best performance
- Use PNG for transparency support
- Consider using SVG for scalability if your icons are simple
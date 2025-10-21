# Mobile Photo Sizing Debug Feature

## Added: Debug Buttons for Mobile App Photo Sizing

### 🔍 How to Use

On **mobile devices only**, you'll now see small blue/green debug buttons on photos:

#### Elevation Plot Photos
- **Blue 🔍 button** (bottom-left corner)
- Shows sizing for Measurement and Location photos
- Appears on both sections (web and mobile layouts)

#### Structural Systems Photos
- **Green 🔍 button** (bottom-right corner)  
- Shows sizing for all structural photos
- Helps compare against Elevation Plot sizing

### 📊 Debug Information Shown

When you click a debug button, you'll see:

```
📐 Photo Sizing Debug

Photo Info:
• AttachID: 566
• PhotoType: Measurement

Image Element:
• Natural: 1280 x 960px (original image size)
• Rendered: 90 x 90px (displayed size)
• Offset: 90 x 90px
• Client: 90 x 90px

CSS Styles (Image):
• width: 90px (or calc(...) or 100%)
• height: 90px (or auto)
• max-width: 100px
• border-radius: 16px
• object-fit: cover
• display: block

Container:
• Width: 95px
• Height: 125px
• Display: flex
• Flex: 0 0 auto

Platform:
• Is Web: false
• Is Mobile: true
• Screen Width: 375px
• Screen Height: 667px

Viewport:
• Device Pixel Ratio: 2
```

### 🎯 What to Look For

**If Elevation Plot photos are too small:**

1. Check `width` value
   - Should be similar to Structural Systems
   - If using `calc((100% - 8px) / 3)`, might be too small
   
2. Check Container `Width`
   - Should be ~85-100px on mobile
   - If much smaller, container is being squeezed

3. Check `max-width`
   - Should allow photos to scale properly
   - If too restrictive, photos shrink

4. Compare values between:
   - Elevation Plot (blue button)
   - Structural Systems (green button)

### 🐛 Common Issues

**Issue**: Photos showing as tiny (30-40px)
**Check**: Container width, CSS width property, flex settings

**Issue**: Photos not fitting 3 per row
**Check**: Screen width, container flex properties, gap settings

**Issue**: Different sizing on different screen sizes
**Check**: Media queries in SCSS, viewport width

### 📱 Test Instructions

1. Open mobile app (iOS or Android)
2. Navigate to Engineers Foundation template
3. Expand Structural Systems section
   - Click green 🔍 on any photo
   - Note the width/height values
4. Expand Elevation Plot section  
   - Click blue 🔍 on Measurement or Location photo
   - Compare width/height to Structural Systems
5. Share the debug info to diagnose sizing issues

### 🔧 Files Modified

1. **engineers-foundation.page.ts** (lines 5007-5057)
   - Added `showPhotoSizingDebug()` method
   - Shows comprehensive sizing information

2. **engineers-foundation.page.html**
   - Added blue 🔍 buttons to elevation plot photos (4 instances)
   - Added green 🔍 buttons to structural systems photos (6 instances)
   - Buttons only visible on mobile (`*ngIf="!platform.isWeb()"`)

### 💡 Next Steps

After clicking the debug buttons, share the popup info and we can:
1. Identify which CSS property is causing the small sizing
2. Update the SCSS to match Structural Systems sizing
3. Test the fix on mobile



const fs = require('fs');
const path = require('path');

// Build number to set - increment this for each TestFlight build
const BUILD_NUMBER = '3';
const VERSION = '1.0.0';

const infoPlistPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');

// Check if Info.plist exists
if (fs.existsSync(infoPlistPath)) {
  let content = fs.readFileSync(infoPlistPath, 'utf8');
  
  // Update CFBundleVersion (build number)
  content = content.replace(
    /<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleVersion</key>\n\t<string>${BUILD_NUMBER}</string>`
  );
  
  // Update CFBundleShortVersionString (version)
  content = content.replace(
    /<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleShortVersionString</key>\n\t<string>${VERSION}</string>`
  );
  
  fs.writeFileSync(infoPlistPath, content);
  console.log(`✅ iOS build number set to ${BUILD_NUMBER}`);
  console.log(`✅ iOS version set to ${VERSION}`);
} else {
  console.log('⚠️ Info.plist not found - this is expected if iOS platform hasn\'t been added yet');
}
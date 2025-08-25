const fs = require('fs');
const path = require('path');

// Read configuration from ios-build-config.json
const configPath = path.join(__dirname, '..', 'ios-build-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const BUILD_NUMBER = config.ios.buildNumber;
const VERSION = config.ios.version;

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
  
  // Verify the change was applied
  const updatedContent = fs.readFileSync(infoPlistPath, 'utf8');
  const buildMatch = updatedContent.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/);
  const versionMatch = updatedContent.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/);
  
  console.log(`✅ VERIFIED: Build number in Info.plist: ${buildMatch ? buildMatch[1] : 'NOT FOUND'}`);
  console.log(`✅ VERIFIED: Version in Info.plist: ${versionMatch ? versionMatch[1] : 'NOT FOUND'}`);
} else {
  console.log('⚠️ Info.plist not found - this is expected if iOS platform hasn\'t been added yet');
}
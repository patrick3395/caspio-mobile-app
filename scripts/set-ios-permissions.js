const fs = require('fs');
const path = require('path');

console.log('📱 Setting iOS permission strings...');

const infoPlistPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');

// Check if Info.plist exists
if (!fs.existsSync(infoPlistPath)) {
  console.log('⚠️ Info.plist not found - iOS platform not added yet');
  process.exit(0);
}

let content = fs.readFileSync(infoPlistPath, 'utf8');

// Permission strings to add
const permissions = [
  {
    key: 'NSPhotoLibraryUsageDescription',
    value: 'This app needs access to your photo library to upload inspection photos and documents.'
  },
  {
    key: 'NSCameraUsageDescription',
    value: 'This app needs camera access to take photos during property inspections.'
  },
  {
    key: 'NSPhotoLibraryAddUsageDescription',
    value: 'This app needs permission to save inspection photos to your photo library.'
  }
];

// Add each permission if it doesn't exist
permissions.forEach(permission => {
  if (!content.includes(`<key>${permission.key}</key>`)) {
    console.log(`✅ Adding ${permission.key}`);
    
    // Find the last </dict> before </plist>
    const dictEndIndex = content.lastIndexOf('</dict>');
    
    // Insert the permission string before the closing </dict>
    const permissionString = `\t<key>${permission.key}</key>\n\t<string>${permission.value}</string>\n`;
    content = content.slice(0, dictEndIndex) + permissionString + content.slice(dictEndIndex);
  } else {
    console.log(`ℹ️ ${permission.key} already exists`);
  }
});

// Write the updated content back
fs.writeFileSync(infoPlistPath, content);
console.log('✅ iOS permissions set successfully');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Creating iOS platform for Appflow...');

// Remove existing iOS folder if it exists
if (fs.existsSync('ios')) {
  console.log('Removing existing iOS folder...');
  execSync('rm -rf ios', { stdio: 'inherit' });
}

// Ensure cordova-plugin-ionic is installed
console.log('Installing cordova-plugin-ionic...');
try {
  execSync('npm install cordova-plugin-ionic@5.5.3 --save', { stdio: 'inherit' });
  console.log('cordova-plugin-ionic installed');
} catch (error) {
  console.error('Failed to install cordova-plugin-ionic:', error.message);
}

// Add iOS platform
console.log('Adding iOS platform...');
try {
  execSync('npx cap add ios', { stdio: 'inherit' });
  console.log('iOS platform added successfully');
} catch (error) {
  console.error('Failed to add iOS platform:', error.message);
  process.exit(1);
}

// Sync to ensure plugin is included
console.log('Syncing iOS platform...');
try {
  execSync('npx cap sync ios', { stdio: 'inherit' });
  console.log('iOS platform synced');
} catch (error) {
  console.error('Warning: sync failed, continuing anyway');
}

// Verify the xcodeproj file exists
const xcodeprojPath = path.join('ios', 'App', 'App.xcodeproj');
if (fs.existsSync(xcodeprojPath)) {
  console.log('✓ App.xcodeproj found at:', xcodeprojPath);
} else {
  console.error('✗ App.xcodeproj not found!');
  process.exit(1);
}

// Set the iOS build number
console.log('Setting iOS build number...');
try {
  execSync('node scripts/set-ios-build-number.js', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to set build number:', error.message);
}

console.log('iOS platform ready for build');
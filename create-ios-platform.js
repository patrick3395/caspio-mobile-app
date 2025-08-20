const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Creating iOS platform for Appflow...');

// Run the new configuration script
console.log('Running Live Updates configuration...');
try {
  execSync('node scripts/configure-live-updates.js', { stdio: 'inherit' });
  console.log('Live Updates configured successfully');
} catch (error) {
  console.error('Failed to configure Live Updates:', error.message);
  process.exit(1);
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
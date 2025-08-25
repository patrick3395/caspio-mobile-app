const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Appflow iOS Build Script ===');

// Only add iOS platform if it doesn't exist
const iosPath = path.join(process.cwd(), 'ios');
if (!fs.existsSync(iosPath)) {
  console.log('iOS platform not found, adding it...');
  
  try {
    // Add iOS platform
    execSync('npx cap add ios', { stdio: 'inherit' });
    console.log('✓ iOS platform added');
    
    // Sync to ensure all plugins are properly configured
    execSync('npx cap sync ios', { stdio: 'inherit' });
    console.log('✓ iOS platform synced');
  } catch (error) {
    console.error('Failed to add iOS platform:', error.message);
    process.exit(1);
  }
} else {
  console.log('iOS platform already exists');
  
  // Just sync to ensure everything is up to date
  try {
    execSync('npx cap sync ios', { stdio: 'inherit' });
    console.log('✓ iOS platform synced');
  } catch (error) {
    console.error('Warning: sync failed:', error.message);
  }
}

// Verify xcodeproj exists
const xcodeprojPath = path.join(iosPath, 'App', 'App.xcodeproj');
if (fs.existsSync(xcodeprojPath)) {
  console.log('✓ App.xcodeproj found at:', xcodeprojPath);
} else {
  console.error('✗ App.xcodeproj not found!');
  process.exit(1);
}

console.log('\n=== iOS platform ready for build ===');
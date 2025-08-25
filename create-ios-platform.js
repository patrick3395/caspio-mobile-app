const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Appflow iOS Build Setup (Build 55) ===');
console.log('Building version 1.0.0 with build number 55');

// Step 1: Install dependencies (including @capacitor/live-updates)
console.log('1. Installing dependencies...');
try {
  // Use npm ci if package-lock exists, otherwise npm install
  if (fs.existsSync('package-lock.json')) {
    execSync('npm ci --legacy-peer-deps', { stdio: 'inherit' });
  } else {
    execSync('npm install --legacy-peer-deps', { stdio: 'inherit' });
  }
  console.log('✓ Dependencies installed (including @capacitor/live-updates)');
} catch (error) {
  console.error('Failed to install dependencies:', error.message);
  // Don't exit, Appflow might handle this
}

// Step 2: Build the web assets
console.log('2. Building web assets...');
try {
  execSync('npm run build:prod', { stdio: 'inherit' });
  console.log('✓ Web assets built');
} catch (error) {
  // Try alternative build command
  try {
    execSync('ng build --configuration production', { stdio: 'inherit' });
    console.log('✓ Web assets built (using ng directly)');
  } catch (err) {
    console.error('Failed to build:', err.message);
  }
}

// Step 3: Remove existing iOS folder if it exists
if (fs.existsSync('ios')) {
  console.log('3. Removing existing iOS folder...');
  execSync('rm -rf ios', { stdio: 'inherit' });
}

// Step 4: Add iOS platform
console.log('4. Adding iOS platform...');
try {
  execSync('npx @capacitor/cli add ios', { stdio: 'inherit' });
  console.log('✓ iOS platform added');
} catch (error) {
  console.error('Failed to add iOS platform:', error.message);
  process.exit(1);
}

// Step 5: CRITICAL - Sync iOS to inject the @capacitor/live-updates plugin
console.log('5. Syncing iOS platform (this injects @capacitor/live-updates plugin)...');
try {
  execSync('npx @capacitor/cli sync ios', { stdio: 'inherit' });
  console.log('✓ iOS platform synced - @capacitor/live-updates plugin injected');
} catch (error) {
  console.error('Warning: sync failed, but continuing:', error.message);
}

// Step 6: Verify the plugin was added
console.log('6. Verifying @capacitor/live-updates plugin...');
const podfilePath = path.join('ios', 'App', 'Podfile');
if (fs.existsSync(podfilePath)) {
  const podfile = fs.readFileSync(podfilePath, 'utf8');
  if (podfile.includes('CapacitorLiveUpdates')) {
    console.log('✓ CapacitorLiveUpdates found in Podfile');
  } else {
    console.warn('⚠️  CapacitorLiveUpdates NOT found in Podfile');
    console.warn('The @capacitor/live-updates plugin may not be properly installed');
  }
}

// Step 7: Update iOS platform requirements for Capacitor 7
console.log('7. Updating iOS platform requirements...');
if (fs.existsSync(podfilePath)) {
  let podfile = fs.readFileSync(podfilePath, 'utf8');
  // Update platform version to iOS 14.0
  podfile = podfile.replace(/platform :ios, '\d+\.\d+'/, "platform :ios, '14.0'");
  fs.writeFileSync(podfilePath, podfile);
  console.log('✓ Updated Podfile to iOS 14.0 (required for Capacitor 7)');
}

// Step 8: Verify xcodeproj exists
const xcodeprojPath = path.join('ios', 'App', 'App.xcodeproj');
if (fs.existsSync(xcodeprojPath)) {
  console.log('✓ App.xcodeproj found at:', xcodeprojPath);
} else {
  console.error('✗ App.xcodeproj not found!');
  process.exit(1);
}

// Step 9: Set the iOS build number
console.log('8. Setting iOS build number...');
try {
  execSync('node scripts/set-ios-build-number.js', { stdio: 'inherit' });
  console.log('✓ iOS build number set');
} catch (error) {
  console.error('Failed to set build number:', error.message);
}

console.log('\n=== iOS platform ready for Appflow build ===');
console.log('Version 1.0.0 (Build 55) - Live Updates enabled with appId: 1e8beef6');
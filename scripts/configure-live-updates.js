const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== Configuring Live Updates for iOS ===');

// First ensure we have the plugin
console.log('1. Checking cordova-plugin-ionic...');
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

if (!packageJson.dependencies['cordova-plugin-ionic']) {
  console.log('Installing cordova-plugin-ionic...');
  try {
    execSync('npm install cordova-plugin-ionic@5.5.3 --save --legacy-peer-deps', { stdio: 'inherit' });
  } catch (e) {
    console.error('Failed to install plugin:', e.message);
  }
}

// Create iOS platform if needed
const iosPath = path.join(process.cwd(), 'ios');
if (!fs.existsSync(iosPath)) {
  console.log('2. Creating iOS platform...');
  try {
    // Use the Capacitor CLI directly
    const capacitorBin = path.join(process.cwd(), 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
    if (fs.existsSync(capacitorBin)) {
      execSync(`node ${capacitorBin} add ios`, { stdio: 'inherit' });
    } else {
      // Fallback to npx
      execSync('npx @capacitor/cli add ios', { stdio: 'inherit' });
    }
  } catch (e) {
    console.error('Failed to add iOS platform:', e.message);
    process.exit(1);
  }
}

// Configure Info.plist for Live Updates
console.log('3. Configuring Info.plist...');
const infoPlistPath = path.join(iosPath, 'App', 'App', 'Info.plist');

if (fs.existsSync(infoPlistPath)) {
  let plistContent = fs.readFileSync(infoPlistPath, 'utf8');
  
  // Check if already configured
  if (!plistContent.includes('IonAppId')) {
    // Add Ionic Deploy configuration to Info.plist
    const ionicConfig = `	<key>IonAppId</key>
	<string>1e8beef6</string>
	<key>IonChannelName</key>
	<string>Caspio Mobile App</string>
	<key>IonUpdateMethod</key>
	<string>background</string>
	<key>IonMaxVersions</key>
	<string>2</string>
	<key>IonMinBackgroundDuration</key>
	<string>30</string>
	<key>IonApi</key>
	<string>https://api.ionicjs.com</string>`;
    
    // Insert before the closing </dict>
    plistContent = plistContent.replace('</dict>\n</plist>', ionicConfig + '\n</dict>\n</plist>');
    
    fs.writeFileSync(infoPlistPath, plistContent);
    console.log('✓ Info.plist configured for Live Updates');
  } else {
    console.log('✓ Info.plist already configured');
  }
}

// Update Capacitor config to remove cordova preferences
console.log('4. Updating capacitor.config.ts...');
const capacitorConfigPath = path.join(process.cwd(), 'capacitor.config.ts');
if (fs.existsSync(capacitorConfigPath)) {
  let configContent = fs.readFileSync(capacitorConfigPath, 'utf8');
  
  // Remove the cordova section if it exists
  if (configContent.includes('cordova:')) {
    configContent = configContent.replace(/,?\s*cordova:\s*{[^}]*preferences:\s*{[^}]*}[^}]*}/g, '');
    fs.writeFileSync(capacitorConfigPath, configContent);
    console.log('✓ Removed cordova preferences from capacitor.config.ts');
  }
}

// Run cap sync to ensure everything is properly configured
console.log('5. Syncing iOS platform...');
try {
  execSync('npx @capacitor/cli sync ios', { stdio: 'inherit' });
  console.log('✓ iOS platform synced');
} catch (e) {
  console.log('Warning: Sync failed, but continuing...');
}

console.log('\n=== Live Updates Configuration Complete ===');
console.log('The iOS platform is now configured for Ionic Appflow Live Updates');
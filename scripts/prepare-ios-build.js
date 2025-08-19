const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== Preparing iOS Build for Appflow ===');

// Step 1: Check if iOS platform exists and is properly initialized
const iosPath = path.join(process.cwd(), 'ios');
const podfilePath = path.join(iosPath, 'App', 'Podfile');
const iosExists = fs.existsSync(iosPath);
const podfileExists = fs.existsSync(podfilePath);

if (iosExists && podfileExists) {
  console.log('✓ iOS platform properly initialized');
} else if (iosExists && !podfileExists) {
  console.log('iOS platform exists but is incomplete. Removing and re-adding...');
  try {
    // Remove incomplete iOS platform
    execSync('rm -rf ios', { stdio: 'inherit' });
    // Re-add iOS platform
    execSync('npx cap add ios', { stdio: 'inherit' });
    console.log('✓ iOS platform re-added successfully');
  } catch (error) {
    console.error('Failed to re-add iOS platform:', error.message);
    process.exit(1);
  }
} else {
  console.log('Adding iOS platform...');
  try {
    execSync('npx cap add ios', { stdio: 'inherit' });
    console.log('✓ iOS platform added');
  } catch (error) {
    console.error('Failed to add iOS platform:', error.message);
    process.exit(1);
  }
}

// Step 2: Sync the iOS project (only if Podfile exists)
if (fs.existsSync(podfilePath)) {
  console.log('Syncing iOS project...');
  try {
    execSync('npx cap sync ios', { stdio: 'inherit' });
    console.log('✓ iOS project synced');
  } catch (error) {
    console.error('Failed to sync iOS project:', error.message);
    // Try to copy without pod install
    console.log('Attempting to copy without pod install...');
    try {
      execSync('npx cap copy ios', { stdio: 'inherit' });
      console.log('✓ iOS project copied (without pod install)');
    } catch (copyError) {
      console.error('Failed to copy:', copyError.message);
      process.exit(1);
    }
  }
} else {
  console.log('⚠️ Podfile not found, skipping sync');
}

// Step 3: Configure Info.plist for Appflow Live Updates
const infoPlistPath = path.join(iosPath, 'App', 'App', 'Info.plist');
if (fs.existsSync(infoPlistPath)) {
  let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
  
  // Check if Appflow config already exists
  if (!infoPlist.includes('IonAppId')) {
    console.log('Adding Appflow configuration to Info.plist...');
    
    // Find the main dict closing tag and add our config before it
    const mainDictEnd = infoPlist.lastIndexOf('</dict>');
    if (mainDictEnd !== -1) {
      const appflowConfig = `	<key>IonAppId</key>
	<string>1e8beef6</string>
	<key>IonChannel</key>
	<string>Caspio Mobile App</string>
	<key>IonUpdateMethod</key>
	<string>background</string>
	<key>IonMaxVersions</key>
	<integer>2</integer>
	<key>IonApi</key>
	<string>https://api.ionicjs.com</string>
`;
      
      infoPlist = infoPlist.slice(0, mainDictEnd) + appflowConfig + infoPlist.slice(mainDictEnd);
      fs.writeFileSync(infoPlistPath, infoPlist);
      console.log('✓ Appflow configuration added to Info.plist');
    } else {
      console.error('Could not find </dict> tag in Info.plist');
    }
  } else {
    console.log('✓ Appflow configuration already exists in Info.plist');
  }
} else {
  console.error('Info.plist not found at:', infoPlistPath);
}

// Step 4: Verify cordova-plugin-ionic is installed
const pluginPath = path.join(process.cwd(), 'node_modules', 'cordova-plugin-ionic');
if (fs.existsSync(pluginPath)) {
  console.log('✓ cordova-plugin-ionic is installed');
  
  // Check if plugin.xml exists
  const pluginXmlPath = path.join(pluginPath, 'plugin.xml');
  if (fs.existsSync(pluginXmlPath)) {
    console.log('✓ plugin.xml found');
  }
} else {
  console.log('⚠️ cordova-plugin-ionic not found in node_modules');
}

console.log('=== iOS Build Preparation Complete ===');
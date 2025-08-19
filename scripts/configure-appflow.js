const fs = require('fs');
const path = require('path');

console.log('Configuring Appflow Live Updates for iOS...');

// First verify the plugin is installed
const pluginPath = path.join(process.cwd(), 'node_modules', 'cordova-plugin-ionic');
if (!fs.existsSync(pluginPath)) {
  console.error('cordova-plugin-ionic not found! Installing...');
  const { execSync } = require('child_process');
  execSync('npm install cordova-plugin-ionic@5.5.3', { stdio: 'inherit' });
}

// Add preferences to Capacitor config for the plugin
const configPath = path.join(process.cwd(), 'capacitor.config.json');
if (fs.existsSync(configPath)) {
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Ensure cordova plugin preferences are set
  if (!config.cordova) {
    config.cordova = {};
  }
  if (!config.cordova.preferences) {
    config.cordova.preferences = {};
  }
  
  // Set the plugin preferences
  config.cordova.preferences = {
    ...config.cordova.preferences,
    DisableDeploy: 'false',
    IosUpdateApi: 'https://api.ionicjs.com',
    AndroidUpdateApi: 'https://api.ionicjs.com',
    AppId: '1e8beef6',
    UpdateChannel: 'Caspio Mobile App',
    UpdateMethod: 'background',
    MaxVersions: '2'
  };
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✓ Updated capacitor.config.json with plugin preferences');
}

// Add Appflow configuration to Info.plist during build
const iosPath = path.join(process.cwd(), 'ios', 'App', 'App');

if (fs.existsSync(iosPath)) {
  const infoPlistPath = path.join(iosPath, 'Info.plist');
  
  if (fs.existsSync(infoPlistPath)) {
    let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
    
    // Check if Appflow config already exists
    if (!infoPlist.includes('IonAppId')) {
      console.log('Adding Appflow configuration to Info.plist...');
      
      // Add Appflow configuration before the closing </dict>
      const appflowConfig = `
    <key>IonAppId</key>
    <string>1e8beef6</string>
    <key>IonChannel</key>
    <string>Caspio Mobile App</string>
    <key>IonUpdateMethod</key>
    <string>background</string>
    <key>IonMaxVersions</key>
    <integer>2</integer>
    <key>IonApi</key>
    <string>https://api.ionicjs.com</string>`;
      
      infoPlist = infoPlist.replace('</dict>\n</plist>', appflowConfig + '\n</dict>\n</plist>');
      
      fs.writeFileSync(infoPlistPath, infoPlist);
      console.log('✓ Appflow configuration added to Info.plist');
    } else {
      console.log('✓ Appflow configuration already exists in Info.plist');
    }
  }
} else {
  console.log('iOS platform not found, will be added during build');
}

console.log('Appflow configuration complete');
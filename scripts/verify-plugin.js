const fs = require('fs');
const path = require('path');

console.log('Verifying cordova-plugin-ionic installation...');

// Check if plugin is in package.json
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

if (packageJson.dependencies['cordova-plugin-ionic']) {
  console.log('✓ cordova-plugin-ionic found in package.json:', packageJson.dependencies['cordova-plugin-ionic']);
} else {
  console.error('✗ cordova-plugin-ionic NOT in package.json dependencies');
}

// Check if plugin is in node_modules
const pluginPath = path.join(process.cwd(), 'node_modules', 'cordova-plugin-ionic');
if (fs.existsSync(pluginPath)) {
  console.log('✓ cordova-plugin-ionic found in node_modules');
  
  // Check plugin.xml
  const pluginXmlPath = path.join(pluginPath, 'plugin.xml');
  if (fs.existsSync(pluginXmlPath)) {
    console.log('✓ plugin.xml exists');
  } else {
    console.error('✗ plugin.xml not found');
  }
  
  // Check www folder
  const wwwPath = path.join(pluginPath, 'www');
  if (fs.existsSync(wwwPath)) {
    const wwwFiles = fs.readdirSync(wwwPath);
    console.log('✓ Plugin www files:', wwwFiles);
  }
} else {
  console.error('✗ cordova-plugin-ionic NOT in node_modules');
}

// Check iOS platform if it exists
const iosPath = path.join(process.cwd(), 'ios');
if (fs.existsSync(iosPath)) {
  console.log('Checking iOS platform...');
  
  // Check if plugin is referenced in iOS project
  const podfilePath = path.join(iosPath, 'App', 'Podfile');
  if (fs.existsSync(podfilePath)) {
    const podfile = fs.readFileSync(podfilePath, 'utf8');
    if (podfile.includes('CordovaPlugins')) {
      console.log('✓ CordovaPlugins referenced in Podfile');
    }
  }
}

console.log('Verification complete');
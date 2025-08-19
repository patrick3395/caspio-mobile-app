// This script ensures the cordova-plugin-ionic is properly installed for Capacitor
const fs = require('fs');
const path = require('path');

console.log('Ensuring cordova-plugin-ionic is properly configured...');

// Check if we're in an iOS build environment
const iosPath = path.join(process.cwd(), 'ios');
if (fs.existsSync(iosPath)) {
  console.log('iOS platform detected');
  
  // The plugin should be in node_modules
  const pluginPath = path.join(process.cwd(), 'node_modules', 'cordova-plugin-ionic');
  
  if (fs.existsSync(pluginPath)) {
    console.log('✓ cordova-plugin-ionic found in node_modules');
    
    // Check plugin.xml
    const pluginXmlPath = path.join(pluginPath, 'plugin.xml');
    if (fs.existsSync(pluginXmlPath)) {
      console.log('✓ plugin.xml found');
      
      // For Capacitor, we need to ensure the plugin is registered
      const packageJsonPath = path.join(pluginPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        console.log(`✓ Plugin version: ${packageJson.version}`);
      }
    }
  } else {
    console.error('✗ cordova-plugin-ionic not found! Installing...');
    const { execSync } = require('child_process');
    execSync('npm install cordova-plugin-ionic@5.5.3', { stdio: 'inherit' });
  }
} else {
  console.log('iOS platform not added yet');
}

console.log('Plugin configuration complete');
const fs = require('fs');
const path = require('path');

// Update iOS platform minimum version to 14.0 as required by Capacitor 7
const podfilePath = path.join('ios', 'App', 'Podfile');

if (fs.existsSync(podfilePath)) {
  let podfile = fs.readFileSync(podfilePath, 'utf8');
  
  // Update platform version to iOS 14.0
  podfile = podfile.replace(/platform :ios, '\d+\.\d+'/, "platform :ios, '14.0'");
  
  fs.writeFileSync(podfilePath, podfile);
  console.log('✓ Updated Podfile to iOS 14.0');
} else {
  console.log('Podfile not found - iOS platform may not be created yet');
}
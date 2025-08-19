#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🚀 Ionic iOS Live Reload Setup\n');

// Get local IP
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const LOCAL_IP = getLocalIP();

console.log(`📱 Your Local IP: ${LOCAL_IP}\n`);

// Update Capacitor config for live reload
const capacitorConfig = {
    appId: "io.ionic.caspioapp",
    appName: "Caspio Mobile",
    webDir: "www",
    server: {
        url: `http://${LOCAL_IP}:8100`,
        cleartext: true
    }
};

// Write temporary config
fs.writeFileSync('capacitor.config.temp.json', JSON.stringify(capacitorConfig, null, 2));

console.log('Step 1: Copy web assets to iOS\n');
exec('npx cap copy ios', (err, stdout, stderr) => {
    if (err) {
        console.log('Warning: Copy failed, but continuing...\n');
    }
    
    console.log('Step 2: Start development server\n');
    console.log('========================================');
    console.log('CHOOSE YOUR METHOD:');
    console.log('========================================\n');
    
    console.log('METHOD A - Ionic Serve (if working):');
    console.log('-------------------------------------');
    console.log('Terminal 1:');
    console.log(`  ionic serve --external --port 8100\n`);
    console.log('Terminal 2:');
    console.log(`  ionic capacitor run ios --livereload --external\n`);
    
    console.log('\nMETHOD B - Direct Xcode (always works):');
    console.log('----------------------------------------');
    console.log('Terminal 1 - Start any web server:');
    console.log(`  npx http-server www -p 8100`);
    console.log('  OR');
    console.log(`  python3 -m http.server 8100 --directory www\n`);
    console.log('Terminal 2 - Open in Xcode:');
    console.log(`  npx cap open ios\n`);
    console.log('Then in Xcode:');
    console.log('  1. Select your device/simulator');
    console.log('  2. Press Run button (▶️)\n');
    
    console.log('\nMETHOD C - Command Line (fastest):');
    console.log('-----------------------------------');
    console.log(`  npx cap run ios --target YOUR_DEVICE_ID\n`);
    
    console.log('========================================');
    console.log(`📱 Your app will connect to: http://${LOCAL_IP}:8100`);
    console.log('🔄 Changes will reload automatically!');
    console.log('========================================\n');
    
    // Try to open Xcode
    console.log('Opening Xcode...\n');
    exec('npx cap open ios', (err) => {
        if (!err) {
            console.log('✅ Xcode opened successfully!');
            console.log('   Select your device and press Run (▶️)');
        }
    });
});
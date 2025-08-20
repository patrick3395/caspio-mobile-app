import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';

@Injectable({
  providedIn: 'root'
})
export class IonicDeployService {
  constructor(private platform: Platform) {}

  async checkForUpdates(): Promise<void> {
    const BUILD_NUMBER = 51;
    const PLUGIN_NAME = '@capacitor/live-updates';
    
    console.log(`=== BUILD ${BUILD_NUMBER} LIVE UPDATES CHECK ===`);
    console.log(`Plugin: ${PLUGIN_NAME}`);
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is Native:', Capacitor.isNativePlatform());
    
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds.\n\nYou are currently running in a browser.');
      return;
    }

    // Ensure platform is ready
    await this.platform.ready();
    console.log('Platform ready, checking for updates...');

    try {
      // First try to reset config if there's a corrupted update
      try {
        console.log('Attempting to reset any corrupted updates...');
        await LiveUpdates.resetConfig();
        console.log('Reset config successful');
      } catch (resetError) {
        console.log('No corrupted updates to reset or reset not needed');
      }
      // Log the configuration being used
      console.log('=== LIVE UPDATE CONFIGURATION ===');
      console.log('Expected App ID: 1e8beef6');
      console.log('Expected Channel: Caspio Mobile App');
      console.log('Update Method: background');
      
      // Use the @capacitor/live-updates sync method
      console.log('Calling LiveUpdates.sync()...');
      const result = await LiveUpdates.sync();
      
      // DETAILED LOGGING OF RESULT
      console.log('=== SYNC RESULT DETAILS ===');
      console.log('Full result object:', JSON.stringify(result, null, 2));
      console.log('activeApplicationPathChanged:', result.activeApplicationPathChanged);
      console.log('Result keys:', Object.keys(result));
      
      if (result.activeApplicationPathChanged) {
        // The app has been updated
        console.log('✅ Update downloaded and applied!');
        
        alert(
          `🎉 LIVE UPDATE DETECTED!\n\n` +
          `Build 51 → Version 51.1\n\n` +
          `The update has been downloaded!\n\n` +
          `Tap OK to reload and see the changes.`
        );
        
        // Auto reload to show the update
        await LiveUpdates.reload();
      } else {
        console.log('❌ No update detected');
        console.log('Possible reasons:');
        console.log('1. No web build deployed to channel');
        console.log('2. Channel name mismatch (case sensitive)');
        console.log('3. App ID mismatch');
        console.log('4. Already on latest version');
        
        // Show detailed status
        let statusMsg = `📊 Build ${BUILD_NUMBER} Status\n\n`;
        statusMsg += `Result: ${JSON.stringify(result)}\n\n`;
        statusMsg += `Config:\n`;
        statusMsg += `- App ID: 1e8beef6\n`;
        statusMsg += `- Channel: Caspio Mobile App\n`;
        statusMsg += `- Method: background\n\n`;
        statusMsg += `If you deployed a web build, check:\n`;
        statusMsg += `1. Channel name matches exactly\n`;
        statusMsg += `2. Web build completed successfully\n`;
        statusMsg += `3. Deploy to channel completed`;
        
        alert(statusMsg);
      }
    } catch (error: any) {
      console.error(`Build ${BUILD_NUMBER} Error:`, error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      // Handle unpack error specifically
      if (error?.message?.includes('unpack') || error?.message?.includes('File Manager')) {
        console.error('Unpack error detected, attempting to reset config...');
        try {
          await LiveUpdates.resetConfig();
          alert('Live Updates configuration has been reset due to a corrupted update.\n\nThe app will now use the built-in version.\n\nPlease try updating again later.');
          return;
        } catch (resetError) {
          console.error('Failed to reset config:', resetError);
        }
      }
      
      let errorMsg = `❌ BUILD ${BUILD_NUMBER} ERROR\n\n`;
      errorMsg += `Plugin: ${PLUGIN_NAME}\n\n`;
      
      if (error?.message) {
        errorMsg += `Error: ${error.message}\n\n`;
      }
      
      // Check specific error types
      if (error?.message?.includes('is not implemented') || 
          error?.message?.includes('not available') ||
          error?.message?.includes('not found')) {
        errorMsg += 'The @capacitor/live-updates plugin is not available.\n\n';
        errorMsg += 'The plugin may not be installed in this iOS build.\n';
        errorMsg += 'You need to rebuild the iOS app with the plugin.';
      } else if (error?.code) {
        errorMsg += `Error Code: ${error.code}\n`;
        errorMsg += `Full Error: ${JSON.stringify(error)}`;
      } else {
        errorMsg += 'Details: ' + JSON.stringify(error);
      }
      
      alert(errorMsg);
    }
  }
}
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
    const BUILD_NUMBER = 52;
    const PLUGIN_NAME = '@capacitor/live-updates';
    
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds.\n\nYou are currently running in a browser.');
      return;
    }

    // Ensure platform is ready
    await this.platform.ready();

    try {
      const result = await LiveUpdates.sync();
      
      if (result.activeApplicationPathChanged) {
        
        alert(
          `🎉 LIVE UPDATE DETECTED!\n\n` +
          `Build 51 → Version 51.1\n\n` +
          `The update has been downloaded!\n\n` +
          `Tap OK to reload and see the changes.`
        );
        
        // Auto reload to show the update
        await LiveUpdates.reload();
      } else {
        
        // Simple message - no update available
        alert('✓ App is up to date\n\nNo updates available at this time.');
      }
    } catch (error: any) {
      console.error(`Build ${BUILD_NUMBER} Error:`, error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      // Handle unpack error specifically
      if (error?.message?.includes('unpack') || error?.message?.includes('File Manager')) {
        console.error('Unpack error detected - corrupted update');
        // Don't reset config, just inform user to try again
        alert('A corrupted update was detected.\n\nThe app will continue using the current version.\n\nPlease try updating again later.');
        return;
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
        errorMsg += 'The plugin may not be installed in this native build.\n';
        errorMsg += 'You need to rebuild the native app with the plugin.';
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
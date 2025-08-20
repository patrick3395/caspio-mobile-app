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
    console.log('=== Live Updates Check (Build 47) ===');
    console.log('Using: @capacitor/live-updates');
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
      // Use the @capacitor/live-updates sync method
      console.log('Calling LiveUpdates.sync()...');
      const result = await LiveUpdates.sync();
      console.log('Sync result:', result);
      
      if (result.activeApplicationPathChanged) {
        // The app has been updated
        console.log('✅ Update downloaded and applied!');
        
        const shouldReload = confirm(
          '🎉 Update Available!\n\n' +
          'A new version has been downloaded.\n' +
          'Would you like to restart the app now to apply it?'
        );
        
        if (shouldReload) {
          await LiveUpdates.reload();
        } else {
          alert('The update will be applied the next time you restart the app.');
        }
      } else {
        console.log('✅ App is up to date');
        alert('✅ App is up to date!\n\nNo new updates available.');
      }
    } catch (error: any) {
      console.error('Live Updates Error (Build 47):', error);
      
      // Detailed error message
      let errorMsg = '❌ Update Check Failed\n\n';
      
      if (error?.message) {
        errorMsg += `Error: ${error.message}\n\n`;
      }
      
      // Check if it's a plugin not found error
      if (error?.message?.includes('is not implemented') || 
          error?.message?.includes('not available') ||
          error?.message?.includes('not found')) {
        errorMsg += 'The @capacitor/live-updates plugin is not available in this build.\n\n';
        errorMsg += 'This usually means:\n';
        errorMsg += '1. The plugin wasn\'t included in the native build\n';
        errorMsg += '2. You need to rebuild the app with the plugin\n\n';
        errorMsg += 'Build Info: v47 with @capacitor/live-updates';
      } else {
        errorMsg += 'Details: ' + JSON.stringify(error);
      }
      
      alert(errorMsg);
    }
  }
}
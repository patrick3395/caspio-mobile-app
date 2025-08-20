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
    // VERY CLEAR BUILD INDICATOR
    const BUILD_NUMBER = 50;
    const PLUGIN_NAME = '@capacitor/live-updates';
    
    console.log(`=== BUILD ${BUILD_NUMBER} LIVE UPDATES CHECK ===`);
    console.log(`Plugin: ${PLUGIN_NAME}`);
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is Native:', Capacitor.isNativePlatform());
    
    // First alert to show which build is running
    alert(`🎉 LIVE UPDATE SUCCESS!\n\nVersion: Build 50.1 (Live Update)\n\nIf you see this, the live update worked!\n\nPlugin: ${PLUGIN_NAME}`);
    
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
          `🎉 BUILD ${BUILD_NUMBER}: Update Available!\n\n` +
          'A new version has been downloaded.\n' +
          'Would you like to restart the app now to apply it?'
        );
        
        if (shouldReload) {
          await LiveUpdates.reload();
        } else {
          alert(`Build ${BUILD_NUMBER}: The update will be applied on next restart.`);
        }
      } else {
        console.log('✅ App is up to date');
        alert(`✅ Build ${BUILD_NUMBER}: App is up to date!\n\nNo new updates available.`);
      }
    } catch (error: any) {
      console.error(`Build ${BUILD_NUMBER} Error:`, error);
      
      // VERY CLEAR ERROR MESSAGE WITH BUILD NUMBER
      let errorMsg = `❌ BUILD ${BUILD_NUMBER} ERROR\n\n`;
      errorMsg += `Plugin: ${PLUGIN_NAME}\n\n`;
      
      if (error?.message) {
        errorMsg += `Error: ${error.message}\n\n`;
      }
      
      // Check if it's a plugin not found error
      if (error?.message?.includes('is not implemented') || 
          error?.message?.includes('not available') ||
          error?.message?.includes('not found')) {
        errorMsg += 'The @capacitor/live-updates plugin is not available.\n\n';
        errorMsg += 'This is BUILD 50 using @capacitor/live-updates.\n';
        errorMsg += 'NOT using cordova-plugin-ionic!';
      } else {
        errorMsg += 'Details: ' + JSON.stringify(error);
      }
      
      alert(errorMsg);
    }
  }
}
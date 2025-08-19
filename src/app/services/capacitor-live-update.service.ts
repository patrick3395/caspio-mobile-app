import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

// Import the LiveUpdates plugin
import { LiveUpdates } from '@capacitor/live-updates';

@Injectable({
  providedIn: 'root'
})
export class CapacitorLiveUpdateService {

  constructor() {
    this.initializeUpdates();
  }

  async initializeUpdates() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Live updates only work on native platforms');
      return;
    }

    try {
      // The plugin automatically checks for updates on app start
      // based on the autoUpdateMethod in capacitor.config.ts
      console.log('Live Updates initialized with background updates');
      
      // Get current snapshot info
      const info = await LiveUpdates.getInfo();
      console.log('Current deployment info:', info);
    } catch (error) {
      console.error('Live Updates initialization error:', error);
    }
  }

  async checkForUpdates(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    try {
      console.log('Manually checking for updates...');
      
      // Sync with the configured channel
      const result = await LiveUpdates.sync();
      console.log('Sync result:', result);
      
      if (result.activeApplicationPathChanged) {
        alert('Update installed! The app has been updated to the latest version.');
        // The app will automatically reload with the new version
      } else {
        // Get current info to show version
        const info = await LiveUpdates.getInfo();
        const version = info.snapshot || 'base';
        alert(`App is up to date!\nCurrent version: ${version}`);
      }
    } catch (error: any) {
      console.error('Update check error:', error);
      alert(`Update check failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async getDeploymentInfo() {
    try {
      const info = await LiveUpdates.getInfo();
      return info;
    } catch (error) {
      console.error('Error getting deployment info:', error);
      return null;
    }
  }
}
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LiveUpdate, LiveUpdateConfig, SyncResult } from '@capacitor/live-updates';

@Injectable({
  providedIn: 'root'
})
export class LiveUpdatesService {

  constructor() {
    this.initializeUpdates();
  }

  async initializeUpdates() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Live updates only work on native platforms');
      return;
    }

    try {
      // The plugin automatically uses the config from capacitor.config.ts
      console.log('Live Updates initialized with background auto-update');
      
      // Get current version info
      const info = await LiveUpdate.getInfo();
      console.log('Current live update info:', info);
    } catch (error) {
      console.error('Failed to initialize Live Updates:', error);
    }
  }

  async checkForUpdates(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    try {
      console.log('Manually checking for updates...');
      
      // Sync with Appflow to check for updates
      const result: SyncResult = await LiveUpdate.sync();
      console.log('Sync result:', result);
      
      if (result.activeApplicationPathChanged) {
        alert('🎉 Update installed! The app has been updated to the latest version.');
        // The app will automatically reload with the new version
      } else {
        // Get current info
        const info = await LiveUpdate.getInfo();
        const version = info.versionId || 'base';
        alert(`✅ App is up to date!\nVersion: ${version}`);
      }
    } catch (error: any) {
      console.error('Update check error:', error);
      alert(`Update check failed: ${error?.message || 'Unknown error'}`);
    }
  }
}
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
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    // Ensure platform is ready
    await this.platform.ready();

    try {
      console.log('Checking for updates using @capacitor/live-updates...');
      
      // Use the sync method which handles everything automatically
      const result = await LiveUpdates.sync();
      console.log('Sync result:', result);
      
      if (result.activeApplicationPathChanged) {
        // The app has been updated
        console.log('Update applied, app path changed');
        
        // You can choose to reload immediately or prompt the user
        const shouldReload = confirm('An update has been downloaded and is ready to apply. Would you like to restart the app now?');
        
        if (shouldReload) {
          await LiveUpdates.reload();
        } else {
          alert('The update will be applied the next time you restart the app.');
        }
      } else {
        console.log('No update available or already on latest version');
        alert('App is up to date!');
      }
    } catch (error: any) {
      console.error('Update check error:', error);
      
      let errorMsg = 'Update check failed:\\n\\n';
      if (error?.message) {
        errorMsg += error.message;
      } else {
        errorMsg += JSON.stringify(error);
      }
      
      alert(errorMsg);
    }
  }

  // Optional: Get current version info
  async getCurrentVersion(): Promise<any> {
    try {
      const versionInfo = await LiveUpdates.getChannel();
      console.log('Current channel info:', versionInfo);
      return versionInfo;
    } catch (error) {
      console.error('Failed to get version info:', error);
      return null;
    }
  }

  // Optional: Manual update methods if you want more control
  async manualCheckForUpdate(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    await this.platform.ready();

    try {
      // Check for updates without applying
      const checkResult = await LiveUpdates.sync();
      
      if (checkResult.activeApplicationPathChanged) {
        // An update was downloaded
        console.log('Update available and downloaded');
        
        // Get info about the update
        const channelInfo = await LiveUpdates.getChannel();
        console.log('Update info:', channelInfo);
        
        // Now you can choose when to reload
        const userChoice = confirm(`Update available!\\n\\nWould you like to apply it now?`);
        
        if (userChoice) {
          await LiveUpdates.reload();
        }
      } else {
        alert('Your app is already up to date!');
      }
    } catch (error: any) {
      console.error('Manual update check failed:', error);
      alert(`Update check failed: ${error.message || 'Unknown error'}`);
    }
  }
}
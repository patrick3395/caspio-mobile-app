import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root'
})
export class IonicDeployService {
  private deploy: any = null;

  constructor() {
    this.initializeDeploy();
  }

  private initializeDeploy() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Ionic Deploy only works on native platforms');
      return;
    }

    // Wait for the platform to be ready
    document.addEventListener('deviceready', () => {
      this.findDeployPlugin();
    }, false);

    // Also try immediately in case deviceready already fired
    this.findDeployPlugin();
  }

  private findDeployPlugin() {
    const win = window as any;
    
    // Try various locations where the plugin might be
    const possibleLocations = [
      win.IonicCordova?.deploy,
      win.cordova?.plugin?.IonicDeploy,
      win.Deploy,
      win.IonicDeploy
    ];

    for (const location of possibleLocations) {
      if (location) {
        this.deploy = location;
        console.log('Found Ionic Deploy plugin:', location);
        break;
      }
    }

    if (!this.deploy) {
      console.log('Ionic Deploy plugin not found. Available window properties:', 
        Object.keys(win).filter(k => k.toLowerCase().includes('ionic') || k.toLowerCase().includes('deploy') || k.toLowerCase().includes('cordova'))
      );
    }
  }

  async checkForUpdates(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    // Try to find the plugin again if not found initially
    if (!this.deploy) {
      this.findDeployPlugin();
    }

    if (!this.deploy) {
      alert('Ionic Deploy plugin not found.\n\nThe cordova-plugin-ionic is not properly installed in this build.');
      return;
    }

    try {
      // Check current version
      let currentVersion = 'unknown';
      try {
        const versionInfo = await this.deploy.getCurrentVersion();
        currentVersion = versionInfo?.versionId || versionInfo?.version || 'base';
        console.log('Current version:', currentVersion);
      } catch (e) {
        console.log('Could not get current version:', e);
      }

      // Check for updates using the correct API
      console.log('Checking for updates...');
      const update = await this.deploy.checkForUpdate();
      console.log('Update check result:', update);
      
      if (update && update.available) {
        alert(`Update found!\nVersion: ${update.snapshot || 'unknown'}\nDownloading...`);
        
        // Download the update with progress callback
        await this.deploy.downloadUpdate((progress: number) => {
          console.log(`Download progress: ${progress}%`);
        });
        
        // Extract the update with progress callback
        await this.deploy.extractUpdate((progress: number) => {
          console.log(`Extract progress: ${progress}%`);
        });
        
        // Reload the app to apply the update
        alert('Update installed! Restarting...');
        await this.deploy.reloadApp();
      } else {
        alert(`App is up to date!\nCurrent version: ${currentVersion}`);
      }
    } catch (error: any) {
      console.error('Update check error:', error);
      
      // Log available methods to debug
      if (this.deploy) {
        console.log('Available deploy methods:', Object.keys(this.deploy).filter(k => typeof this.deploy[k] === 'function'));
      }
      
      alert(`Update check failed: ${error?.message || JSON.stringify(error)}`);
    }
  }
}
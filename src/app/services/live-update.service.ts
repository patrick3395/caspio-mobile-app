import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root'
})
export class LiveUpdateService {
  private updateAvailable = false;

  constructor() {
    this.initializeUpdates();
  }

  async initializeUpdates() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Live updates only work on native platforms');
      return;
    }

    // For Capacitor, we need to access the plugin differently
    // The cordova-plugin-ionic in Capacitor is accessed through the window object
    const win = window as any;
    
    // Wait for the platform to be ready
    if (win.Ionic && win.Ionic.WebView) {
      console.log('Ionic WebView detected, checking for deploy plugin...');
    }

    // The plugin should be available at window.IonicCordova or window.Deploy
    if (win.IonicCordova && win.IonicCordova.deploy) {
      console.log('Found IonicCordova.deploy');
      return win.IonicCordova.deploy;
    }

    // Check if the plugin registered itself differently
    const possibleLocations = [
      win.Deploy,
      win.IonicDeploy,
      win.Ionic?.Deploy,
      win.plugins?.deploy,
      win.cordova?.plugins?.deploy
    ];

    for (const location of possibleLocations) {
      if (location) {
        console.log('Found deploy plugin at:', location);
        return location;
      }
    }

    console.log('Deploy plugin not found. Window properties:', Object.keys(win));
    return null;
  }

  async checkForUpdates(): Promise<void> {
    const win = window as any;
    
    // In Capacitor with cordova-plugin-ionic, the API is simpler
    // The plugin auto-checks based on the config in capacitor.config.ts
    
    try {
      // Method 1: Direct check if plugin exposed methods
      if (win.Deploy) {
        console.log('Using window.Deploy');
        const result = await win.Deploy.sync({ updateMethod: 'auto' });
        this.handleSyncResult(result);
        return;
      }

      // Method 2: Use Capacitor's plugin bridge
      if (win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.Deploy) {
        console.log('Using Capacitor.Plugins.Deploy');
        const result = await win.Capacitor.Plugins.Deploy.sync({ updateMethod: 'auto' });
        this.handleSyncResult(result);
        return;
      }

      // Method 3: Check if plugin registered to Capacitor registerPlugin
      if ((Capacitor as any).Plugins?.Deploy) {
        console.log('Using Capacitor.Plugins.Deploy');
        const result = await (Capacitor as any).Plugins.Deploy.sync({ updateMethod: 'auto' });
        this.handleSyncResult(result);
        return;
      }

      // If none work, the plugin isn't properly installed
      console.error('Deploy plugin not accessible. Checking window object...');
      console.log('Window keys:', Object.keys(win).filter(k => 
        k.toLowerCase().includes('ionic') || 
        k.toLowerCase().includes('deploy') || 
        k.toLowerCase().includes('cordova')
      ));
      
      alert('Live Updates plugin not found. The plugin may not be included in this build.');
      
    } catch (error: any) {
      console.error('Update check error:', error);
      alert(`Update check failed: ${error?.message || 'Unknown error'}`);
    }
  }

  private handleSyncResult(result: any) {
    console.log('Sync result:', result);
    
    if (result === 'UPDATE_AVAILABLE' || result === true) {
      this.updateAvailable = true;
      alert('Update downloaded! The app will refresh with the new version.');
      window.location.reload();
    } else if (result === 'NO_UPDATE_AVAILABLE' || result === false) {
      alert('App is up to date!');
    } else {
      alert(`Sync completed with result: ${result}`);
    }
  }
}
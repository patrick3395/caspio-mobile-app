import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

declare const window: any;

@Injectable({
  providedIn: 'root'
})
export class IonicDeployService {
  private deploy: any = null;
  private initialized = false;

  constructor() {
    this.initializeDeploy();
  }

  private initializeDeploy() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Ionic Deploy only works on native platforms');
      return;
    }

    // For iOS, the plugin loads differently
    if (Capacitor.getPlatform() === 'ios') {
      // On iOS, the plugin is available immediately
      this.checkForPlugin();
    } else {
      // On Android, wait for deviceready
      document.addEventListener('deviceready', () => {
        this.checkForPlugin();
      }, false);
    }
  }

  private checkForPlugin() {
    // The plugin should be at window.IonicCordova
    if (window.IonicCordova) {
      console.log('Found IonicCordova at window level');
      this.deploy = window.IonicCordova;
      this.initialized = true;
      return;
    }

    // Sometimes it's at cordova.plugins
    if (window.cordova && window.cordova.plugins) {
      if (window.cordova.plugins.IonicCordova) {
        console.log('Found IonicCordova in cordova.plugins');
        this.deploy = window.cordova.plugins.IonicCordova;
        this.initialized = true;
        return;
      }
      if (window.cordova.plugins.Deploy) {
        console.log('Found Deploy in cordova.plugins');
        this.deploy = window.cordova.plugins.Deploy;
        this.initialized = true;
        return;
      }
    }

    // Log what we have available
    console.log('Plugin not found. Window properties:', Object.keys(window));
    if (window.cordova) {
      console.log('Cordova exists. Plugins:', window.cordova.plugins ? Object.keys(window.cordova.plugins) : 'none');
    }
  }

  async checkForUpdates(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    // Retry finding the plugin
    if (!this.initialized) {
      this.checkForPlugin();
    }

    if (!this.deploy) {
      alert('Live Updates plugin not loaded.\\n\\nThis is a known issue with cordova-plugin-ionic on iOS.\\n\\nThe plugin is not being injected into the WebView.');
      return;
    }

    try {
      console.log('Deploy plugin found:', this.deploy);
      
      // First configure the plugin with our settings
      if (this.deploy.configure) {
        await this.deploy.configure({
          appId: '1e8beef6',
          channel: 'Caspio Mobile App',
          updateMethod: 'background',
          maxVersions: 2
        });
        console.log('Plugin configured');
      }

      // Now check for updates
      if (this.deploy.sync) {
        // Use the simpler sync method
        console.log('Using sync method...');
        const result = await this.deploy.sync();
        
        if (result === 'true' || result === true) {
          alert('Update downloaded! The app will update on next restart.');
        } else {
          alert('App is up to date!');
        }
      } else if (this.deploy.checkForUpdate) {
        // Fallback to manual check
        console.log('Checking for updates...');
        const update = await this.deploy.checkForUpdate();
        
        if (update && update.available) {
          alert(`Update available!\\nVersion: ${update.snapshot}\\nDownloading...`);
          
          await this.deploy.downloadUpdate((progress: number) => {
            console.log(`Download: ${progress}%`);
          });
          
          await this.deploy.extractUpdate((progress: number) => {
            console.log(`Extract: ${progress}%`);
          });
          
          alert('Update installed! Restarting...');
          await this.deploy.reloadApp();
        } else {
          alert('App is up to date!');
        }
      } else {
        alert('Plugin methods not available');
      }
    } catch (error: any) {
      console.error('Update error:', error);
      
      let errorMsg = 'Update check failed:\\n';
      if (error?.message) errorMsg += error.message;
      if (error?.code === 12) {
        errorMsg += '\\n\\nError code 12: JSON parsing error.\\nThis is a known iOS issue with the Ionic Deploy service.';
      }
      
      alert(errorMsg);
    }
  }
}
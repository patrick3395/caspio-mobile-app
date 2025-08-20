import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';

declare const window: any;
declare const cordova: any;

@Injectable({
  providedIn: 'root'
})
export class IonicDeployService {
  private deploy: any = null;
  private initialized = false;

  constructor(private platform: Platform) {
    this.initializeDeploy();
  }

  private async initializeDeploy() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Ionic Deploy only works on native platforms');
      return;
    }

    // Wait for platform to be ready - CRITICAL for plugin availability
    await this.platform.ready();
    console.log('Platform is ready, checking for plugin...');

    // Add a small delay to ensure all plugins are loaded
    setTimeout(() => {
      this.checkForPlugin();
    }, 500);
  }

  private checkForPlugin() {
    console.log('=== Plugin Detection Debug ===');
    console.log('window.cordova exists?', typeof window.cordova !== 'undefined');
    console.log('window.IonicCordova exists?', typeof window.IonicCordova !== 'undefined');
    
    // Check all possible locations
    const locations = [
      { name: 'window.IonicCordova', obj: window.IonicCordova },
      { name: 'window.cordova.plugin.ionic', obj: window.cordova?.plugin?.ionic },
      { name: 'window.cordova.plugins.IonicCordova', obj: window.cordova?.plugins?.IonicCordova },
      { name: 'window.plugins.IonicCordova', obj: window.plugins?.IonicCordova },
      { name: 'cordova.plugin.ionic', obj: typeof cordova !== 'undefined' ? cordova?.plugin?.ionic : undefined },
      { name: 'window.IonicDeploy', obj: window.IonicDeploy },
      { name: 'window.Deploy', obj: window.Deploy }
    ];

    for (const loc of locations) {
      if (loc.obj) {
        console.log(`Found plugin at ${loc.name}:`, loc.obj);
        this.deploy = loc.obj;
        this.initialized = true;
        
        // Log available methods
        const methods = Object.keys(this.deploy).filter(k => typeof this.deploy[k] === 'function');
        console.log('Available methods:', methods);
        return;
      }
    }

    // If still not found, check cordova plugins
    if (window.cordova && window.cordova.plugins) {
      console.log('Cordova plugins available:', Object.keys(window.cordova.plugins));
    }

    // Log all window properties containing 'ionic' or 'deploy'
    const windowKeys = Object.keys(window).filter(k => 
      k.toLowerCase().includes('ionic') || 
      k.toLowerCase().includes('deploy') ||
      k.toLowerCase().includes('cordova')
    );
    console.log('Relevant window properties:', windowKeys);

    console.log('Plugin not found after checking all locations');
  }

  async checkForUpdates(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    // Ensure platform is ready
    await this.platform.ready();

    // Try to find plugin again if not initialized
    if (!this.initialized) {
      this.checkForPlugin();
      
      // Wait a bit for plugin to be found
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try one more time
      if (!this.initialized) {
        this.checkForPlugin();
      }
    }

    if (!this.deploy) {
      // Detailed error message
      let errorMsg = 'Live Updates plugin not available.\\n\\n';
      errorMsg += 'Debug info:\\n';
      errorMsg += `Platform: ${Capacitor.getPlatform()}\\n`;
      errorMsg += `Cordova exists: ${typeof window.cordova !== 'undefined'}\\n`;
      
      if (window.cordova && window.cordova.plugins) {
        errorMsg += `Cordova plugins: ${Object.keys(window.cordova.plugins).join(', ')}`;
      }
      
      alert(errorMsg);
      return;
    }

    try {
      console.log('Using deploy plugin:', this.deploy);
      
      // Configure the plugin
      if (this.deploy.configure) {
        console.log('Configuring plugin...');
        await this.deploy.configure({
          appId: '1e8beef6',
          channel: 'Caspio Mobile App',
          updateMethod: 'background',
          maxVersions: 2
        });
      }

      // Check for updates using sync
      if (this.deploy.sync) {
        console.log('Using sync method...');
        const syncResult = await this.deploy.sync({
          updateMethod: 'background'
        });
        
        console.log('Sync result:', syncResult);
        
        if (syncResult === 'true' || syncResult === true || syncResult === 'UPDATE_AVAILABLE') {
          alert('Update downloaded! Restart the app to apply.');
        } else {
          alert('App is up to date!');
        }
      } else if (this.deploy.checkForUpdate) {
        // Manual update check
        console.log('Checking for updates...');
        const update = await this.deploy.checkForUpdate();
        console.log('Update check result:', update);
        
        if (update && update.available) {
          alert(`Update available!\\nVersion: ${update.snapshot || 'unknown'}\\n\\nDownloading...`);
          
          // Download
          await this.deploy.downloadUpdate((progress: number) => {
            console.log(`Download progress: ${progress}%`);
          });
          
          // Extract
          await this.deploy.extractUpdate((progress: number) => {
            console.log(`Extract progress: ${progress}%`);
          });
          
          alert('Update installed! Restarting...');
          await this.deploy.reloadApp();
        } else {
          alert('App is up to date!');
        }
      } else {
        alert('No update methods available on plugin');
      }
    } catch (error: any) {
      console.error('Update error:', error);
      
      let errorMsg = 'Update check failed:\\n\\n';
      if (error?.message) errorMsg += `Message: ${error.message}\\n`;
      if (error?.code) errorMsg += `Code: ${error.code}\\n`;
      
      // Error code 12 is JSON parsing
      if (error?.code === 12) {
        errorMsg += '\\nThis is a JSON parsing error. The plugin may not be properly configured.';
      }
      
      alert(errorMsg);
    }
  }
}
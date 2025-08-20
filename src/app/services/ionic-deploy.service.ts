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
    
    console.log('Searching for deploy plugin...');
    console.log('Window has cordova?', typeof win.cordova !== 'undefined');
    console.log('Window has IonicCordova?', typeof win.IonicCordova !== 'undefined');
    
    // Log all window properties that might be relevant
    const relevantKeys = Object.keys(win).filter(k => 
      k.toLowerCase().includes('ionic') || 
      k.toLowerCase().includes('deploy') || 
      k.toLowerCase().includes('cordova')
    );
    console.log('Relevant window properties:', relevantKeys);
    
    // Check cordova plugins if cordova exists
    if (win.cordova && win.cordova.plugins) {
      console.log('Cordova plugins:', Object.keys(win.cordova.plugins));
    }
    
    // Try various locations where the plugin might be
    const possibleLocations = [
      win.IonicCordova?.deploy,
      win.cordova?.plugins?.IonicDeploy,
      win.cordova?.plugins?.deploy,
      win.Deploy,
      win.IonicDeploy,
      win.IonicCordova
    ];

    for (let i = 0; i < possibleLocations.length; i++) {
      const location = possibleLocations[i];
      if (location) {
        console.log(`Found something at location ${i}:`, location);
        // Check if it has deploy methods
        if (typeof location.checkForUpdate === 'function' || 
            typeof location.sync === 'function' ||
            (location.deploy && typeof location.deploy.checkForUpdate === 'function')) {
          this.deploy = location.deploy || location;
          console.log('Using deploy plugin:', this.deploy);
          break;
        }
      }
    }

    if (!this.deploy) {
      console.log('Deploy plugin not found after checking all locations');
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
      // First, let's check what methods are available
      console.log('Deploy plugin methods:', Object.keys(this.deploy).filter(k => typeof this.deploy[k] === 'function'));
      
      // Try to get configuration
      let config: any = {};
      try {
        if (this.deploy.getConfiguration) {
          config = await this.deploy.getConfiguration();
          console.log('Current configuration:', config);
        }
      } catch (e) {
        console.log('Could not get configuration:', e);
      }

      // Initialize if needed
      if (this.deploy.init) {
        console.log('Initializing deploy plugin...');
        try {
          await this.deploy.init({
            appId: '1e8beef6',
            channel: 'Caspio Mobile App'
          });
          console.log('Deploy plugin initialized');
        } catch (e) {
          console.log('Init not required or failed:', e);
        }
      }

      // Try using sync method which is simpler
      if (this.deploy.sync) {
        console.log('Using sync method...');
        try {
          const result = await this.deploy.sync({
            updateMethod: 'auto'
          });
          console.log('Sync result:', result);
          
          if (result === 'true' || result === true || result === 'UPDATE_APPLIED') {
            alert('Update downloaded and will be applied on next restart!');
          } else {
            alert(`App is up to date!\nSync result: ${result}`);
          }
          return;
        } catch (syncError: any) {
          console.log('Sync failed, trying checkForUpdate:', syncError);
        }
      }

      // Fallback to checkForUpdate
      console.log('Checking for updates...');
      const update = await this.deploy.checkForUpdate();
      console.log('Update check result:', update);
      
      if (update && update.available) {
        alert(`Update found!\nVersion: ${update.snapshot || 'unknown'}\nDownloading...`);
        
        await this.deploy.downloadUpdate((progress: number) => {
          console.log(`Download progress: ${progress}%`);
        });
        
        await this.deploy.extractUpdate((progress: number) => {
          console.log(`Extract progress: ${progress}%`);
        });
        
        alert('Update installed! Restarting...');
        await this.deploy.reloadApp();
      } else {
        alert('App is up to date!');
      }
    } catch (error: any) {
      console.error('Update check error:', error);
      
      // More detailed error info
      let errorMsg = 'Update check failed:\n\n';
      if (error?.message) errorMsg += `Message: ${error.message}\n`;
      if (error?.code) errorMsg += `Code: ${error.code}\n`;
      if (error?.url) errorMsg += `URL: ${error.url}\n`;
      
      // Log available methods
      if (this.deploy) {
        const methods = Object.keys(this.deploy).filter(k => typeof this.deploy[k] === 'function');
        errorMsg += `\nAvailable methods: ${methods.join(', ')}`;
      }
      
      alert(errorMsg);
    }
  }
}
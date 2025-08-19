import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

declare const cordova: any;

@Injectable({
  providedIn: 'root'
})
export class DeployService {
  private deploy: any = null;

  constructor() {
    this.initializeDeploy();
  }

  private initializeDeploy() {
    if (Capacitor.isNativePlatform()) {
      // Wait for cordova to be ready
      document.addEventListener('deviceready', () => {
        console.log('Device ready, looking for deploy plugin...');
        
        // cordova-plugin-ionic registers as cordova.plugin.http.Deploy
        if (typeof cordova !== 'undefined' && cordova.plugin) {
          if (cordova.plugin.Deploy) {
            this.deploy = cordova.plugin.Deploy;
            console.log('Found Deploy plugin at cordova.plugin.Deploy');
          } else if (cordova.plugin.IonicDeploy) {
            this.deploy = cordova.plugin.IonicDeploy;
            console.log('Found Deploy plugin at cordova.plugin.IonicDeploy');
          } else {
            console.log('Available cordova plugins:', Object.keys(cordova.plugin));
          }
        }
        
        // Also check window object
        const win = window as any;
        if (!this.deploy && win.Deploy) {
          this.deploy = win.Deploy;
          console.log('Found Deploy plugin at window.Deploy');
        }
        
        if (this.deploy) {
          console.log('Deploy plugin methods:', Object.keys(this.deploy).filter(k => typeof this.deploy[k] === 'function'));
        } else {
          console.warn('Deploy plugin not found');
        }
      });
    }
  }

  async checkForUpdates(): Promise<boolean> {
    if (!this.deploy) {
      console.log('Deploy plugin not available');
      return false;
    }

    try {
      // The cordova-plugin-ionic uses sync() method
      console.log('Calling deploy.sync()...');
      const result = await this.deploy.sync({
        updateMethod: 'auto'
      });
      
      console.log('Sync result:', result);
      
      // Result can be UPDATE_AVAILABLE, NO_UPDATE_AVAILABLE, ERROR, etc.
      return result === 'UPDATE_AVAILABLE';
    } catch (error) {
      console.error('Deploy sync error:', error);
      return false;
    }
  }

  getDeployPlugin() {
    return this.deploy;
  }
}
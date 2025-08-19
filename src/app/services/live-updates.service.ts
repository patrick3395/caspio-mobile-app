import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

// Try to import the plugin - it might not exist if not installed
let LiveUpdate: any;
let hasLiveUpdatePlugin = false;

try {
  const liveUpdateModule = require('@capacitor/live-updates');
  LiveUpdate = liveUpdateModule.LiveUpdate;
  hasLiveUpdatePlugin = true;
  console.log('✅ @capacitor/live-updates module loaded successfully');
} catch (error) {
  console.warn('⚠️ @capacitor/live-updates not available:', error);
}

@Injectable({
  providedIn: 'root'
})
export class LiveUpdatesService {
  private debugInfo: string[] = [];

  constructor() {
    this.initializeUpdates();
  }

  private addDebug(message: string) {
    const timestamp = new Date().toISOString();
    const debugMsg = `[${timestamp}] ${message}`;
    this.debugInfo.push(debugMsg);
    console.log(debugMsg);
  }

  async initializeUpdates() {
    this.addDebug('=== Live Updates Initialization ===');
    this.addDebug(`Platform: ${Capacitor.getPlatform()}`);
    this.addDebug(`Is Native: ${Capacitor.isNativePlatform()}`);
    this.addDebug(`Plugin Available: ${hasLiveUpdatePlugin}`);

    if (!Capacitor.isNativePlatform()) {
      this.addDebug('Not a native platform - live updates disabled');
      return;
    }

    if (!hasLiveUpdatePlugin) {
      this.addDebug('ERROR: @capacitor/live-updates plugin not found');
      return;
    }

    try {
      this.addDebug('Attempting to get current version info...');
      const info = await LiveUpdate.getInfo();
      this.addDebug(`Current info: ${JSON.stringify(info)}`);
      
      if (info) {
        this.addDebug(`Build ID: ${info.buildId || 'none'}`);
        this.addDebug(`Version ID: ${info.versionId || 'none'}`);
        this.addDebug(`Channel: ${info.channel || 'none'}`);
      }
    } catch (error: any) {
      this.addDebug(`ERROR getting info: ${error?.message || JSON.stringify(error)}`);
    }
  }

  async checkForUpdates(): Promise<void> {
    this.debugInfo = []; // Clear previous debug info
    this.addDebug('=== Manual Update Check ===');
    
    if (!Capacitor.isNativePlatform()) {
      const msg = 'Not a native platform - cannot check for updates';
      this.addDebug(msg);
      alert(msg);
      return;
    }

    if (!hasLiveUpdatePlugin) {
      const msg = '@capacitor/live-updates plugin not loaded\n\nThis means the plugin is not installed in the iOS build.';
      this.addDebug(msg);
      alert(msg);
      return;
    }

    try {
      // First get current info
      this.addDebug('Getting current version info...');
      let currentInfo: any = {};
      try {
        currentInfo = await LiveUpdate.getInfo();
        this.addDebug(`Current: ${JSON.stringify(currentInfo)}`);
      } catch (infoError: any) {
        this.addDebug(`Could not get info: ${infoError?.message}`);
      }

      // Try to sync
      this.addDebug('Calling LiveUpdate.sync()...');
      const result = await LiveUpdate.sync();
      this.addDebug(`Sync result: ${JSON.stringify(result)}`);
      
      // Build detailed message
      let message = '📊 Live Update Debug Info:\n\n';
      
      if (currentInfo) {
        message += `Current Version: ${currentInfo.versionId || 'base'}\n`;
        message += `Build ID: ${currentInfo.buildId || 'none'}\n`;
        message += `Channel: ${currentInfo.channel || 'not set'}\n\n`;
      }
      
      if (result) {
        message += `Sync Result:\n`;
        message += `• Path Changed: ${result.activeApplicationPathChanged}\n`;
        message += `• Snapshot: ${result.snapshot || 'none'}\n`;
        
        if (result.activeApplicationPathChanged) {
          message += '\n🎉 UPDATE INSTALLED!';
        } else {
          message += '\n✅ App is up to date';
        }
      } else {
        message += 'Sync returned no result';
      }
      
      // Add debug log
      message += '\n\n=== Debug Log ===\n';
      message += this.debugInfo.slice(-5).join('\n');
      
      alert(message);
      
    } catch (error: any) {
      const errorDetails = `
❌ Update Check Failed

Error: ${error?.message || 'Unknown error'}
Code: ${error?.code || 'none'}
Full: ${JSON.stringify(error)}

=== Debug Log ===
${this.debugInfo.slice(-10).join('\n')}
      `;
      
      this.addDebug(`ERROR: ${JSON.stringify(error)}`);
      alert(errorDetails);
    }
  }

  getDebugInfo(): string[] {
    return this.debugInfo;
  }
}
}
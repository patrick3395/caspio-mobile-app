import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root'
})
export class AppflowLiveUpdateService {

  constructor() {
    this.initializeUpdates();
  }

  async initializeUpdates() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Live updates only work on native platforms');
      return;
    }

    console.log('Appflow Live Updates are configured to run automatically');
    console.log('Updates check on app launch based on capacitor.config.ts settings');
  }

  async checkForUpdates(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      alert('Live updates only work on native builds');
      return;
    }

    // With Appflow, the live updates happen automatically
    // The configuration in capacitor.config.ts controls the behavior
    alert(`Live Updates are automatic!\n\nThe app checks for updates on launch.\nIf an update is available, it downloads in the background.\nThe update will be applied on the next app launch.\n\nClose and reopen the app to see updates.`);
  }
}
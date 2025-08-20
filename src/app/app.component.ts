import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(private platform: Platform) {
    this.initializeApp();
  }

  initializeApp() {
    this.platform.ready().then(() => {
      console.log('=== APP STARTING - LIVE UPDATE 51.1 ===');
      console.log('✅ LIVE UPDATE SUCCESSFUL - Version 51.1 is running!');
      console.log('Timestamp: Aug 20, 2024 @ 11:20 AM PST');
      
      // Check for live updates using @capacitor/live-updates
      this.checkForUpdate();
      
      // Enable mobile test mode if query param is present
      if (!Capacitor.isNativePlatform() && window.location.search.includes('mobile-test=true')) {
        console.log('🔧 Enabling Mobile Test Mode...');
        import('./mobile-test-mode').then(module => {
          (window as any).MobileTestMode = module.MobileTestMode;
          module.MobileTestMode.enable();
        });
      }
      
      // Log platform info
      console.log('📱 Platform Info:', {
        isNative: Capacitor.isNativePlatform(),
        platform: Capacitor.getPlatform(),
        isMobileWeb: this.platform.is('mobile'),
        isAndroid: this.platform.is('android'),
        isIOS: this.platform.is('ios')
      });
    });
  }

  async checkForUpdate() {
    console.log('🔍 Checking for updates with @capacitor/live-updates...');
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is Native:', Capacitor.isNativePlatform());
    
    if (Capacitor.isNativePlatform()) {
      try {
        console.log('🔄 Syncing with Appflow...');
        
        // Use the @capacitor/live-updates sync method
        const result = await LiveUpdates.sync();
        console.log('Sync result:', result);
        
        if (result.activeApplicationPathChanged) {
          console.log('📦 Update downloaded and applied!');
          // The update has been applied, optionally reload
          // Note: with background update method, the app will use the new version on next launch
          console.log('✅ Update will be active on next app launch');
        } else {
          console.log('✅ App is up to date');
        }
      } catch (err) {
        console.log('Live update check failed:', err);
        // Don't show error to user on app startup - handle silently
      }
    } else {
      console.log('ℹ️ Live updates only work on native platforms');
    }
  }
}
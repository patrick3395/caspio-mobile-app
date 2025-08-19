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
      // Check for live updates
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
    if (Capacitor.isNativePlatform()) {
      try {
        console.log('🔄 Checking for live updates...');
        
        // Sync with Appflow
        const result = await LiveUpdates.sync();
        
        if (result.activeApplicationPathChanged) {
          console.log('✅ New update installed!');
          // Reload to apply the update
          await LiveUpdates.reload();
        } else {
          console.log('✅ App is up to date');
        }
      } catch (err) {
        console.log('Live update check failed:', err);
      }
    }
  }
}

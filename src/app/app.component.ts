import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';

// Declare Deploy plugin (will be available after install)
declare var Deploy: any;

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
    if (Capacitor.isNativePlatform() && typeof Deploy !== 'undefined') {
      try {
        console.log('🔄 Checking for live updates...');
        
        const currentVersion = await Deploy.getCurrentVersion();
        console.log('Current version:', currentVersion);
        
        const update = await Deploy.sync({
          updateMethod: 'background'
        }, (progress: number) => {
          console.log(`Download progress: ${progress}%`);
        });
        
        if (update) {
          console.log('✅ Update installed!', update);
          // The app will reload automatically with new version
        } else {
          console.log('✅ App is up to date');
        }
      } catch (err) {
        console.log('Live update check failed:', err);
      }
    }
  }
}

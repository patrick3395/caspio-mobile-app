import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';

declare const IonicDeploy: any;

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
    if (Capacitor.isNativePlatform() && typeof IonicDeploy !== 'undefined') {
      try {
        console.log('🔄 Checking for live updates...');
        
        // Initialize the deploy plugin
        await IonicDeploy.init({
          appId: '1e8beef6',
          channel: 'Caspio Mobile App'
        });
        
        // Check for updates
        const update = await IonicDeploy.checkForUpdate();
        
        if (update.available) {
          console.log('📦 Update available, downloading...');
          
          // Download the update
          await IonicDeploy.downloadUpdate((progress: number) => {
            console.log(`Download progress: ${progress}%`);
          });
          
          // Extract and reload
          await IonicDeploy.extractUpdate();
          console.log('✅ Update installed! Reloading...');
          await IonicDeploy.reloadApp();
        } else {
          console.log('✅ App is up to date');
        }
      } catch (err) {
        console.log('Live update check failed:', err);
      }
    }
  }
}

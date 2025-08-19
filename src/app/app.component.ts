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
    console.log('🔍 Checking for IonicDeploy plugin...');
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is Native:', Capacitor.isNativePlatform());
    console.log('IonicDeploy available:', typeof IonicDeploy !== 'undefined');
    
    // Try alternative ways to access the plugin
    const win = window as any;
    console.log('Window.IonicDeploy:', typeof win.IonicDeploy);
    console.log('Window.IonicCordova:', typeof win.IonicCordova);
    console.log('Window.Deploy:', typeof win.Deploy);
    
    if (Capacitor.isNativePlatform()) {
      // Try multiple ways to access the plugin
      const deployPlugin = typeof IonicDeploy !== 'undefined' ? IonicDeploy : 
                          win.IonicDeploy || win.IonicCordova || win.Deploy;
      
      if (deployPlugin) {
        try {
          console.log('🔄 Initializing live updates...');
          
          // Initialize the deploy plugin
          await deployPlugin.init({
            appId: '1e8beef6',
            channel: 'Caspio Mobile App'
          });
          
          // Check for updates
          const update = await deployPlugin.checkForUpdate();
          
          if (update.available) {
            console.log('📦 Update available, downloading...');
            
            // Download the update
            await deployPlugin.downloadUpdate((progress: number) => {
              console.log(`Download progress: ${progress}%`);
            });
            
            // Extract and reload
            await deployPlugin.extractUpdate();
            console.log('✅ Update installed! Reloading...');
            await deployPlugin.reloadApp();
          } else {
            console.log('✅ App is up to date');
          }
        } catch (err) {
          console.log('Live update check failed:', err);
        }
      } else {
        console.log('⚠️ IonicDeploy plugin not found in Build 25');
        console.log('Available plugins:', Object.keys(win).filter(k => k.toLowerCase().includes('ionic') || k.toLowerCase().includes('deploy')));
      }
    }
  }
}

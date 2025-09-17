import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(private platform: Platform, private readonly themeService: ThemeService) {
    this.initializeApp();
  }

  initializeApp() {
    this.platform.ready().then(() => {
      console.log('=== APP STARTING - VERSION 1.1.39 ===');
      console.log('Live Updates ENABLED');
      console.log('Timestamp:', new Date().toISOString());
      
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
    console.log('🔍 Checking for updates with @capacitor/live-updates...');
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is Native:', Capacitor.isNativePlatform());
    
    if (Capacitor.isNativePlatform()) {
      try {
        console.log('🔄 Syncing with Appflow...');
        
        // Use the @capacitor/live-updates sync method with callback
        const result = await LiveUpdates.sync((percentage: number) => {
          console.log(`Update progress: ${percentage}%`);
        });
        console.log('Sync result:', result);
        
        if (result.activeApplicationPathChanged) {
          console.log('📦 Update downloaded and applied!');
          console.log('✅ Update will be active on next app launch');
        } else {
          console.log('✅ App is up to date');
        }
      } catch (err: any) {
        console.log('Live update check failed:', err);
        console.log('Error type:', err?.constructor?.name);
        console.log('Error message:', err?.message);
        
        // Check for corruption errors
        const isCorrupted = err.message && (
          err.message.includes('corrupt') || 
          err.message.includes('unpack') ||
          err.message.includes('FilerOperationsError') ||
          err.message.includes('File Manager Error')
        );
        
        if (isCorrupted) {
          console.log('⚠️ CORRUPTION DETECTED - Live Update is corrupted');
          console.log('🔄 Attempting recovery...');
          
          try {
            // Try to delete corrupted updates and reload
            console.log('Clearing corrupted update files...');
            
            // Force reload to use bundled version
            await LiveUpdates.reload();
            console.log('✅ Reloaded to bundled version');
          } catch (reloadErr) {
            console.log('Reload failed:', reloadErr);
            
            // If reload fails, show user message
            this.showCorruptionAlert();
          }
        }
      }
    } else {
      console.log('ℹ️ Live updates only work on native platforms');
    }
  }
  
  private async showCorruptionAlert() {
    // Only show alert on mobile platforms
    if (this.platform.is('mobile')) {
      console.log('🚨 SHOWING CORRUPTION ALERT TO USER');
      // In a real app, you'd use AlertController here
      // For now, just log the message
      console.log('MESSAGE: Live Update corrupted. Please reinstall the app or clear app data.');
    }
  }
}

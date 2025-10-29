import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';
import { ThemeService } from './services/theme.service';
import { PerformanceMonitorService } from './services/performance-monitor.service';
import { CaspioService } from './services/caspio.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(
    private platform: Platform,
    private readonly themeService: ThemeService,
    private readonly performanceMonitor: PerformanceMonitorService,
    private readonly caspioService: CaspioService
  ) {
    // Ensure theme service initialises global styles
    void this.themeService;
    this.initializeApp();
  }

  initializeApp() {
    this.platform.ready().then(() => {
      this.checkForUpdate();

      if (!Capacitor.isNativePlatform() && window.location.search.includes('mobile-test=true')) {
        import('./mobile-test-mode').then(module => {
          (window as any).MobileTestMode = module.MobileTestMode;
          module.MobileTestMode.enable();
        });
      }

      this.performanceMonitor.start();

      // Set up app lifecycle listeners for mobile platforms
      this.setupAppLifecycleListeners();
    });
  }

  private async setupAppLifecycleListeners() {
    if (!Capacitor.isNativePlatform()) {
      return; // Only needed for native mobile platforms
    }

    // Dynamically import @capacitor/app only on native platforms
    try {
      const { App } = await import('@capacitor/app');

      // Listen for app state changes (resume/foreground)
      App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
        if (isActive) {
          // App has come to foreground/resumed
          console.log('App resumed - validating authentication token');

          // Trigger token validation by calling getValidToken
          // This will automatically refresh if the token is expired or expiring soon
          this.caspioService.getValidToken().subscribe({
            next: (token) => {
              console.log('Token validated on app resume');
            },
            error: (error) => {
              console.warn('Token validation failed on app resume:', error);
            }
          });
        }
      });

      // Also listen for resume event (alternative approach for some platforms)
      App.addListener('resume', () => {
        console.log('App resume event - validating authentication token');

        this.caspioService.getValidToken().subscribe({
          next: (token) => {
            console.log('Token validated on resume event');
          },
          error: (error) => {
            console.warn('Token validation failed on resume event:', error);
          }
        });
      });
    } catch (error) {
      console.warn('Failed to load @capacitor/app plugin:', error);
    }
  }

  async checkForUpdate() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      await LiveUpdates.sync();
    } catch (err: any) {
      const message = err?.message ?? '';
      const isCorrupted = message.includes('corrupt') ||
        message.includes('unpack') ||
        message.includes('FilerOperationsError') ||
        message.includes('File Manager Error');

      if (!isCorrupted) {
        return;
      }

      try {
        await LiveUpdates.reload();
      } catch {
        this.showCorruptionAlert();
      }
    }
  }
  
  private async showCorruptionAlert() {
    if (!this.platform.is('mobile')) {
      return;
    }

    // TODO: Replace with an AlertController prompt to notify the user.
  }
}

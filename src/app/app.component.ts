import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';
import { ThemeService } from './services/theme.service';
import { PerformanceMonitorService } from './services/performance-monitor.service';

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
    private readonly performanceMonitor: PerformanceMonitorService
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
    });
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

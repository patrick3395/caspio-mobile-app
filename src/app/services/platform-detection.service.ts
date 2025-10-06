import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PlatformDetectionService {

  // Check if running on web (non-native)
  isWeb(): boolean {
    return !Capacitor.isNativePlatform() || environment.isWeb;
  }

  // Check if running on native mobile (iOS/Android)
  isMobile(): boolean {
    return Capacitor.isNativePlatform();
  }

  // Check specific platform
  isIOS(): boolean {
    return Capacitor.getPlatform() === 'ios';
  }

  isAndroid(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  // Get platform name
  getPlatform(): string {
    return Capacitor.getPlatform();
  }

  // Check if web build (uses environment flag)
  isWebBuild(): boolean {
    return environment.isWeb === true;
  }
}

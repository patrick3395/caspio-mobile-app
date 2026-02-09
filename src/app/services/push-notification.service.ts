import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject, filter, first, timeout } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, PushNotificationSchema, ActionPerformed, Token } from '@capacitor/push-notifications';
import { PlatformDetectionService } from './platform-detection.service';
import { ApiGatewayService } from './api-gateway.service';

export interface PushNotificationData {
  type?: string;
  route?: string;
  projectId?: string;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  private deviceTokenSubject = new BehaviorSubject<string | null>(null);
  public deviceToken$ = this.deviceTokenSubject.asObservable();

  private notificationReceivedSubject = new Subject<PushNotificationSchema>();
  public notificationReceived$ = this.notificationReceivedSubject.asObservable();

  private initialized = false;

  constructor(
    private platformDetection: PlatformDetectionService,
    private apiGateway: ApiGatewayService,
    private router: Router
  ) {}

  /**
   * Initialize push notifications (native only).
   * Called from AppComponent after platform.ready().
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.platformDetection.isMobile()) return;

    this.initialized = true;

    // Set up listeners BEFORE registering to avoid missing events
    // On iOS, AppDelegate sends FCM token as UTF-8 Data through Capacitor's notification center.
    // Capacitor's plugin converts Data to hex, so we decode it back to the FCM token string.
    PushNotifications.addListener('registration', (token: Token) => {
      const decoded = Capacitor.getPlatform() === 'ios' ? this.hexToString(token.value) : token.value;
      console.log('[PushNotification] Token received:', decoded.substring(0, 20) + '...');
      this.deviceTokenSubject.next(decoded);
    });

    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('[PushNotification] Registration error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('[PushNotification] Foreground notification:', notification.title);
      this.notificationReceivedSubject.next(notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('[PushNotification] Notification tapped:', action.notification.title);
      this.handleNotificationTap(action.notification.data as PushNotificationData);
    });

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.warn('[PushNotification] Permission not granted');
      return;
    }

    // Register for push notifications (listeners already set up above)
    await PushNotifications.register();
  }

  /**
   * Register the current device token with the backend.
   * Called after successful login.
   */
  registerTokenWithBackend(userId: string, email: string, companyId?: string): void {
    const token = this.deviceTokenSubject.getValue();
    if (token) {
      this.sendTokenToBackend(token, userId, email, companyId);
      return;
    }

    // Token not yet available — wait up to 10s for the registration callback
    console.log('[PushNotification] Waiting for device token...');
    this.deviceToken$.pipe(
      filter((t): t is string => t !== null),
      first(),
      timeout(10000)
    ).subscribe({
      next: (t) => this.sendTokenToBackend(t, userId, email, companyId),
      error: () => console.warn('[PushNotification] Timed out waiting for device token')
    });
  }

  private sendTokenToBackend(token: string, userId: string, email: string, companyId?: string): void {
    const platform = Capacitor.getPlatform();

    this.apiGateway.post('/api/device-tokens', {
      deviceToken: token,
      platform,
      userId,
      email,
      companyId: companyId || null
    }).subscribe({
      next: () => console.log('[PushNotification] Token registered with backend'),
      error: (err) => console.error('[PushNotification] Failed to register token:', err)
    });
  }

  /**
   * Unregister the current device token from the backend.
   * Called on logout.
   */
  unregisterToken(): void {
    const token = this.deviceTokenSubject.getValue();
    if (!token) return;

    this.apiGateway.post('/api/device-tokens/unregister', {
      deviceToken: token
    }).subscribe({
      next: () => console.log('[PushNotification] Token unregistered from backend'),
      error: (err) => console.error('[PushNotification] Failed to unregister token:', err)
    });
  }

  /**
   * Handle navigation when a notification is tapped.
   */
  private hexToString(hex: string): string {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
    }
    return str;
  }

  private handleNotificationTap(data: PushNotificationData): void {
    if (!data) return;

    const route = data.route;
    if (route) {
      // Small delay to ensure app is ready for navigation
      setTimeout(() => {
        this.router.navigateByUrl(route);
      }, 500);
    }
  }
}

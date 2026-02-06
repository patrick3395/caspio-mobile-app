import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
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

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.warn('[PushNotification] Permission not granted');
      return;
    }

    // Register for push notifications
    await PushNotifications.register();

    // Listen for successful registration (device token)
    PushNotifications.addListener('registration', (token: Token) => {
      console.log('[PushNotification] Registered with token:', token.value);
      this.deviceTokenSubject.next(token.value);
    });

    // Listen for registration errors
    PushNotifications.addListener('registrationError', (error) => {
      console.error('[PushNotification] Registration error:', error);
    });

    // Listen for notifications received while app is in foreground
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('[PushNotification] Foreground notification:', notification.title);
      this.notificationReceivedSubject.next(notification);
    });

    // Listen for notification tap (app was in background or terminated)
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('[PushNotification] Notification tapped:', action.notification.title);
      this.handleNotificationTap(action.notification.data as PushNotificationData);
    });
  }

  /**
   * Register the current device token with the backend.
   * Called after successful login.
   */
  registerTokenWithBackend(userId: string, email: string, companyId?: string): void {
    const token = this.deviceTokenSubject.getValue();
    if (!token) {
      console.warn('[PushNotification] No device token available to register');
      return;
    }

    const platform = Capacitor.getPlatform(); // 'ios' or 'android'

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

import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject, filter, first, timeout } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, PushNotificationSchema, ActionPerformed, Token, Channel } from '@capacitor/push-notifications';
import { ToastController } from '@ionic/angular';
import { PlatformDetectionService } from './platform-detection.service';
import { ApiGatewayService } from './api-gateway.service';
import { NotificationStoreService } from './notification-store.service';

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

  private readonly PREF_KEYS: Record<string, string> = {
    'service_completed': 'notif-service-complete',
    'payment_received': 'notif-payment-received',
    'admin_message': 'notif-admin-messages'
  };

  constructor(
    private platformDetection: PlatformDetectionService,
    private apiGateway: ApiGatewayService,
    private toastController: ToastController,
    private router: Router,
    private notificationStore: NotificationStoreService
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
      this.persistNotification(notification);
      this.showForegroundToast(notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('[PushNotification] Notification tapped:', action.notification.title);
      this.persistNotification(action.notification);
      this.handleNotificationTap(action.notification.data as PushNotificationData);
    });

    // Create the Android notification channel (must exist before notifications arrive).
    // On iOS this is a no-op.
    if (Capacitor.getPlatform() === 'android') {
      try {
        const channel: Channel = {
          id: 'partnership_notifications',
          name: 'Partnership Notifications',
          description: 'Service completions, payments, and admin messages',
          importance: 5, // IMPORTANCE_HIGH
          sound: 'default',
          vibration: true,
        };
        await PushNotifications.createChannel(channel);
        console.log('[PushNotification] Android notification channel created');
      } catch (err) {
        console.warn('[PushNotification] Failed to create Android channel:', err);
      }
    }

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

  private isNotificationSuppressed(data: PushNotificationData): boolean {
    const type = data?.type;
    if (!type) return false;
    const prefKey = this.PREF_KEYS[type];
    if (!prefKey) return false;
    return localStorage.getItem(prefKey) === 'false';
  }

  private async showForegroundToast(notification: PushNotificationSchema): Promise<void> {
    const data = (notification.data || {}) as PushNotificationData;
    if (this.isNotificationSuppressed(data)) {
      console.log('[PushNotification] Suppressed by user preference:', data.type);
      return;
    }

    const hasRoute = !!data.route;
    const toast = await this.toastController.create({
      header: notification.title || 'Notification',
      message: notification.body || '',
      duration: hasRoute ? 5000 : 3000,
      position: 'top',
      buttons: hasRoute ? [
        { text: 'View', handler: () => this.handleNotificationTap(data) },
        { text: 'Dismiss', role: 'cancel' }
      ] : [
        { text: 'OK', role: 'cancel' }
      ]
    });
    await toast.present();
  }

  private persistNotification(notification: PushNotificationSchema): void {
    const data = (notification.data || {}) as PushNotificationData;
    this.notificationStore.addNotification(
      notification.title || 'Notification',
      notification.body || '',
      data.type,
      data
    ).catch(err => console.error('[PushNotification] Failed to persist notification:', err));
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

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, skip } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { OfflineService } from './offline.service';

export interface OfflineIndicatorState {
  isOffline: boolean;
  queuedActionsCount: number;
  showBanner: boolean;
  lastOnlineTime: number | null;
}

/**
 * Service to manage offline indicator state for web platform (G2-ERRORS-003)
 *
 * DOM rendering (banner, toasts) has been removed — only state tracking remains.
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineIndicatorService {
  private state$ = new BehaviorSubject<OfflineIndicatorState>({
    isOffline: false,
    queuedActionsCount: 0,
    showBanner: false,
    lastOnlineTime: null
  });

  private subscriptions: Subscription[] = [];
  private initialized = false;

  constructor(
    private offlineService: OfflineService
  ) {
    if (environment.isWeb) {
      this.initialize();
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const isOffline = !this.offlineService.isOnline();
    this.state$.next({
      ...this.state$.value,
      isOffline,
      showBanner: isOffline,
      lastOnlineTime: isOffline ? null : Date.now()
    });

    const onlineSub = this.offlineService.getOnlineStatus()
      .pipe(
        distinctUntilChanged(),
        skip(1)
      )
      .subscribe(isOnline => {
        this.handleConnectionChange(isOnline);
      });

    this.subscriptions.push(onlineSub);

    const queueSub = this.offlineService.getQueueCount()
      .pipe(distinctUntilChanged())
      .subscribe(count => {
        this.updateQueuedActionsCount(count);
      });

    this.subscriptions.push(queueSub);
  }

  getState(): Observable<OfflineIndicatorState> {
    return this.state$.asObservable();
  }

  getCurrentState(): OfflineIndicatorState {
    return this.state$.value;
  }

  isOffline(): boolean {
    return this.state$.value.isOffline;
  }

  updateQueuedActionsCount(count: number): void {
    if (!environment.isWeb) return;
    this.state$.next({
      ...this.state$.value,
      queuedActionsCount: count
    });
  }

  private handleConnectionChange(isOnline: boolean): void {
    if (!environment.isWeb) return;

    if (isOnline) {
      this.state$.next({
        ...this.state$.value,
        isOffline: false,
        showBanner: false,
        lastOnlineTime: Date.now()
      });
    } else {
      this.state$.next({
        ...this.state$.value,
        isOffline: true,
        showBanner: true
      });
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}

import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { OfflineService } from './offline.service';

export interface OfflineCapabilities {
  canViewCachedData: boolean;
  canEditLocally: boolean;
  canQueueActions: boolean;
  canUploadPhotos: boolean;
  canCreateNewRecords: boolean;
  canDeleteRecords: boolean;
  syncPending: boolean;
}

export type FeatureAvailability = 'available' | 'limited' | 'unavailable';

export interface FeatureStatus {
  feature: string;
  availability: FeatureAvailability;
  offlineMessage?: string;
}

/**
 * G2-ERRORS-003: Service to manage graceful degradation of features when offline
 * Provides information about what features are available in offline mode (web only)
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineCapabilitiesService {
  constructor(private offlineService: OfflineService) {}

  /**
   * Get current offline capabilities
   */
  getCapabilities(): OfflineCapabilities {
    const isOffline = !this.offlineService.isOnline();
    const queueStatus = this.offlineService.getQueueStatus();

    return {
      canViewCachedData: true, // Always available - cached data is stored locally
      canEditLocally: true, // Always available - edits saved to local storage
      canQueueActions: environment.isWeb, // Web only
      canUploadPhotos: !isOffline, // Requires connection
      canCreateNewRecords: true, // Can create locally, synced when online
      canDeleteRecords: true, // Can queue delete, synced when online
      syncPending: queueStatus.count > 0
    };
  }

  /**
   * Get capabilities as observable (updates when online status changes)
   */
  getCapabilities$(): Observable<OfflineCapabilities> {
    return this.offlineService.getOnlineStatus().pipe(
      map(() => this.getCapabilities())
    );
  }

  /**
   * Check if a specific feature is available
   */
  isFeatureAvailable(feature: keyof OfflineCapabilities): boolean {
    return this.getCapabilities()[feature];
  }

  /**
   * Get detailed feature status for UI display
   */
  getFeatureStatus(feature: string): FeatureStatus {
    const isOffline = !this.offlineService.isOnline();

    if (!environment.isWeb) {
      return { feature, availability: 'available' };
    }

    const featureStatuses: Record<string, FeatureStatus> = {
      'view-data': {
        feature: 'View Data',
        availability: 'available',
        offlineMessage: isOffline ? 'Viewing cached data' : undefined
      },
      'edit-records': {
        feature: 'Edit Records',
        availability: 'available',
        offlineMessage: isOffline ? 'Changes saved locally, will sync when online' : undefined
      },
      'create-records': {
        feature: 'Create Records',
        availability: isOffline ? 'limited' : 'available',
        offlineMessage: isOffline ? 'New records saved locally, will sync when online' : undefined
      },
      'delete-records': {
        feature: 'Delete Records',
        availability: isOffline ? 'limited' : 'available',
        offlineMessage: isOffline ? 'Delete queued, will process when online' : undefined
      },
      'upload-photos': {
        feature: 'Upload Photos',
        availability: isOffline ? 'limited' : 'available',
        offlineMessage: isOffline ? 'Photos saved locally, will upload when online' : undefined
      },
      'search': {
        feature: 'Search',
        availability: isOffline ? 'limited' : 'available',
        offlineMessage: isOffline ? 'Searching cached data only' : undefined
      },
      'sync': {
        feature: 'Sync Data',
        availability: isOffline ? 'unavailable' : 'available',
        offlineMessage: isOffline ? 'Waiting for connection to sync' : undefined
      },
      'real-time-updates': {
        feature: 'Real-time Updates',
        availability: isOffline ? 'unavailable' : 'available',
        offlineMessage: isOffline ? 'Updates paused until online' : undefined
      }
    };

    return featureStatuses[feature] || {
      feature,
      availability: 'available'
    };
  }

  /**
   * Get all feature statuses for UI display
   */
  getAllFeatureStatuses(): FeatureStatus[] {
    return [
      this.getFeatureStatus('view-data'),
      this.getFeatureStatus('edit-records'),
      this.getFeatureStatus('create-records'),
      this.getFeatureStatus('delete-records'),
      this.getFeatureStatus('upload-photos'),
      this.getFeatureStatus('search'),
      this.getFeatureStatus('sync'),
      this.getFeatureStatus('real-time-updates')
    ];
  }

  /**
   * Get user-friendly message for current offline state
   */
  getOfflineMessage(): string | null {
    if (!environment.isWeb) return null;

    const isOffline = !this.offlineService.isOnline();
    if (!isOffline) return null;

    const queueStatus = this.offlineService.getQueueStatus();
    const queuedCount = queueStatus.count;

    if (queuedCount > 0) {
      return `You're offline. ${queuedCount} action${queuedCount !== 1 ? 's' : ''} will sync when you're back online.`;
    }

    return 'You\'re offline. Some features may be limited, but your changes will be saved locally.';
  }

  /**
   * Check if the app should show offline mode UI adaptations
   */
  shouldShowOfflineAdaptations(): boolean {
    if (!environment.isWeb) return false;
    return !this.offlineService.isOnline();
  }
}

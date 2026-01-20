import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';
import { ThemeService } from './services/theme.service';
import { PerformanceMonitorService } from './services/performance-monitor.service';
import { FabricService } from './services/fabric.service';
import { BackgroundSyncService } from './services/background-sync.service';
import { NavigationHistoryService } from './services/navigation-history.service';
import { environment } from '../environments/environment';
import { addIcons } from 'ionicons';
import {
  // Photo annotator toolbar icons
  arrowBack,
  handLeftOutline,
  colorPaletteOutline,
  arrowForwardOutline,
  squareOutline,
  textOutline,
  trashOutline,
  arrowUndoOutline,
  brushOutline,
  checkmark,
  backspaceOutline,
  // Category detail page icons
  searchOutline,
  closeCircle,
  informationCircleOutline,
  addCircleOutline,
  camera,
  images,
  close,
  alertCircleOutline,
  warningOutline,
  // G2-ERRORS-001: Error boundary icons
  closeOutline,
  arrowBackOutline,
  refreshOutline,
  // Structural Systems Hub category icons
  reorderFourOutline,
  waterOutline,
  documentTextOutline,
  homeOutline,
  gridOutline,
  appsOutline,
  triangleOutline,
  arrowDownOutline,
  albumsOutline,
  layersOutline,
  enterOutline,
  scanOutline,
  ellipsisHorizontalCircleOutline,
  cubeOutline,
  constructOutline,
  folderOpenOutline,
  // Project Details page icons
  peopleOutline,
  personOutline,
  briefcaseOutline,
  clipboardOutline,
  peopleCircleOutline,
  calendarOutline,
  resizeOutline,
  businessOutline,
  bedOutline,
  partlySunnyOutline,
  cloudOutline,
  thermometerOutline,
  chevronForwardOutline,
  // Common icons used across the app
  chevronDown,
  chevronUp,
  chevronForward,
  chevronBack,
  ellipsisVertical,
  trash,
  create,
  save,
  refresh,
  sync,
  cloudUpload,
  cloudOffline,
  checkmarkCircle,
  checkmarkCircleOutline,
  closeCircleOutline,
  image,
  document,
  download,
  share,
  menu,
  home,
  settings,
  person,
  logOut,
  helpCircleOutline,
  arrowForward,
  cameraOutline,
  imagesOutline
} from 'ionicons/icons';

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
    private readonly fabricService: FabricService,
    // TASK 2 FIX: Inject BackgroundSyncService at app startup to ensure it persists
    // across all navigation (main page, project switching, app backgrounding)
    private readonly backgroundSync: BackgroundSyncService,
    // G2-NAV-001: Inject NavigationHistoryService at app startup for web browser history support
    private readonly navigationHistory: NavigationHistoryService
  ) {
    // Register icons for offline use
    addIcons({
      // Photo annotator toolbar
      'arrow-back': arrowBack,
      'hand-left-outline': handLeftOutline,
      'color-palette-outline': colorPaletteOutline,
      'arrow-forward-outline': arrowForwardOutline,
      'square-outline': squareOutline,
      'text-outline': textOutline,
      'trash-outline': trashOutline,
      'arrow-undo-outline': arrowUndoOutline,
      'brush-outline': brushOutline,
      'checkmark': checkmark,
      'backspace-outline': backspaceOutline,
      // Category detail page
      'search-outline': searchOutline,
      'close-circle': closeCircle,
      'information-circle-outline': informationCircleOutline,
      'add-circle-outline': addCircleOutline,
      'camera': camera,
      'images': images,
      'close': close,
      'alert-circle-outline': alertCircleOutline,
      'warning-outline': warningOutline,
      // G2-ERRORS-001: Error boundary icons
      'close-outline': closeOutline,
      'arrow-back-outline': arrowBackOutline,
      'refresh-outline': refreshOutline,
      // Structural Systems Hub category icons
      'reorder-four-outline': reorderFourOutline,
      'water-outline': waterOutline,
      'document-text-outline': documentTextOutline,
      'home-outline': homeOutline,
      'grid-outline': gridOutline,
      'apps-outline': appsOutline,
      'triangle-outline': triangleOutline,
      'arrow-down-outline': arrowDownOutline,
      'albums-outline': albumsOutline,
      'layers-outline': layersOutline,
      'enter-outline': enterOutline,
      'scan-outline': scanOutline,
      'ellipsis-horizontal-circle-outline': ellipsisHorizontalCircleOutline,
      'cube-outline': cubeOutline,
      'construct-outline': constructOutline,
      'folder-open-outline': folderOpenOutline,
      // Project Details page icons
      'people-outline': peopleOutline,
      'person-outline': personOutline,
      'briefcase-outline': briefcaseOutline,
      'clipboard-outline': clipboardOutline,
      'people-circle-outline': peopleCircleOutline,
      'calendar-outline': calendarOutline,
      'resize-outline': resizeOutline,
      'business-outline': businessOutline,
      'bed-outline': bedOutline,
      'partly-sunny-outline': partlySunnyOutline,
      'cloud-outline': cloudOutline,
      'thermometer-outline': thermometerOutline,
      'chevron-forward-outline': chevronForwardOutline,
      // Common icons
      'chevron-down': chevronDown,
      'chevron-up': chevronUp,
      'chevron-forward': chevronForward,
      'chevron-back': chevronBack,
      'ellipsis-vertical': ellipsisVertical,
      'trash': trash,
      'create': create,
      'save': save,
      'refresh': refresh,
      'sync': sync,
      'cloud-upload': cloudUpload,
      'cloud-offline': cloudOffline,
      'checkmark-circle': checkmarkCircle,
      'checkmark-circle-outline': checkmarkCircleOutline,
      'close-circle-outline': closeCircleOutline,
      'image': image,
      'document': document,
      'download': download,
      'share': share,
      'menu': menu,
      'home': home,
      'settings': settings,
      'person': person,
      'log-out': logOut,
      'help-circle-outline': helpCircleOutline,
      'arrow-forward': arrowForward,
      'camera-outline': cameraOutline,
      'images-outline': imagesOutline
    });

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

      // TASK 2 FIX: Log that background sync is initialized at app startup
      // The service is now injected here so it persists across all navigation
      console.log('[App] BackgroundSyncService initialized at app startup - sync will persist across navigation');

      // G2-NAV-001: Log navigation history service initialization (web only)
      if (environment.isWeb) {
        console.log('[App] NavigationHistoryService initialized - browser back/forward buttons enabled');
      }

      // Trigger a sync status refresh to show correct state on app load
      this.backgroundSync.refreshSyncStatus();

      // Preload Fabric.js for offline photo annotation support
      // This ensures the Fabric chunk is cached by the service worker
      this.fabricService.ensureFabricLoaded().then(() => {
        console.log('[App] Fabric.js preloaded for offline use');
      }).catch(err => {
        console.warn('[App] Failed to preload Fabric.js:', err);
      });
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

      // TASK 4 FIX: Show loading state before reload to prevent jarring black screen
      console.log('[App] Update corruption detected, preparing to reload...');
      document.body.classList.add('app-reloading');
      // Small delay to allow any visual feedback before reload
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        await LiveUpdates.reload();
      } catch {
        document.body.classList.remove('app-reloading');
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

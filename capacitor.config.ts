import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nes.dcp',
  appName: 'Partnership',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
    // Performance optimizations
    allowNavigation: ['*']
  },
  ios: {
    preferredContentMode: 'mobile',
    contentInset: 'automatic',
    scrollEnabled: true,
    // Performance optimizations
    allowsLinkPreview: false,
    // Memory management
    limitsNavigationsToAppBoundDomains: false,
    // Security
    allowsArbitraryLoads: false,
    allowsLocalNetworking: true
  },
  android: {
    // Performance optimizations
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Memory management
    initialFocus: false,
    // Network security
    cleartextTrafficPermitted: false
  },
  plugins: {
    LiveUpdates: {
      appId: '1e8beef6',
      channel: 'Caspio Mobile App',
      autoUpdateMethod: 'background',
      maxVersions: 1,  // Reduced from 2 for better performance
      strategy: 'differential',
      // Performance optimizations
      updateUrl: 'https://api.ionicjs.com/apps/1e8beef6/deploy/updates',
      timeout: 30000,  // 30 second timeout
      retryDelay: 1000,  // 1 second retry delay
      maxRetries: 3
    },
    // Camera optimizations
    Camera: {
      iosImagePickerMaxWidth: 1920,
      iosImagePickerMaxHeight: 1920,
      iosImagePickerQuality: 0.8,
      androidImagePickerMaxWidth: 1920,
      androidImagePickerMaxHeight: 1920,
      androidImagePickerQuality: 0.8
    },
    // Filesystem optimizations
    Filesystem: {
      iosIsDocumentPickerEnabled: true,
      androidIsDocumentPickerEnabled: true
    },
    // Network optimizations
    Network: {
      timeout: 30000
    }
  }
};

export default config;
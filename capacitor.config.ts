import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nes.dcp',
  appName: 'Caspio Mobile',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false
  },
  ios: {
    preferredContentMode: 'mobile'
  },
  plugins: {
    LiveUpdates: {
      appId: '1e8beef6',
      channel: 'Caspio Mobile App',
      autoUpdateMethod: 'background',  // Enable background updates
      maxVersions: 2,  // Keep 2 versions for rollback capability
      disableDeploy: false,  // ENABLED - Live Updates active
      strategy: 'differential'  // Use differential updates to minimize download size
    }
  }
};

export default config;
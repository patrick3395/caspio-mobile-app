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
      autoUpdateMethod: 'none',  // Disabled to prevent corruption
      maxVersions: 1,  // Keep only 1 version to minimize storage issues
      disableDeploy: true,  // DISABLED - Live Updates causing corruption
      strategy: 'differential'  // Use differential updates when enabled
    }
  }
};

export default config;
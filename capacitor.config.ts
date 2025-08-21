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
      autoUpdateMethod: 'none',  // Changed to 'none' to prevent auto-corruption
      maxVersions: 1,  // Keep only 1 version to minimize storage issues
      disableDeploy: false,
      strategy: 'differential'  // Use differential updates to reduce size
    }
  }
};

export default config;
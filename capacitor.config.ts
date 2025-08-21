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
      autoUpdateMethod: 'background',
      maxVersions: 1,
      disableDeploy: false
    }
  }
};

export default config;
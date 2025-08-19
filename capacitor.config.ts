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
      channel: 'Caspio Mobile App',  // Use your actual channel name
      autoUpdateMethod: 'background',
      maxVersions: 2
    }
  }
};

export default config;
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
    Deploy: {
      appId: '1e8beef6',
      channel: 'Production',
      updateMethod: 'background',
      maxVersions: 2,
      minBackgroundDuration: 30
    }
  }
};

export default config;
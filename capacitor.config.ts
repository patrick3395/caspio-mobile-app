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
    preferredContentMode: 'mobile',
    buildNumber: '2'
  }
};

export default config;
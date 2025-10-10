import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.noble.partnership',
  appName: 'Partnership',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false
  },
  ios: {
    preferredContentMode: 'mobile'
  }
};

export default config;
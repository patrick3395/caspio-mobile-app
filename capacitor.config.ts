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
    cordova: {
      preferences: {
        DisableDeploy: 'false',
        IosUpdateApi: 'https://api.ionicjs.com',
        AndroidUpdateApi: 'https://api.ionicjs.com',
        UpdateChannel: 'Caspio Mobile App',
        UpdateMethod: 'background',
        MaxVersions: '2'
      }
    }
  }
};

export default config;
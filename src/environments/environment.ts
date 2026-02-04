// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  isWeb: true, // Set to true when running in browser - reads from synced server data instead of local Dexie
  
  // NEW: API Gateway backend configuration
  apiGatewayUrl: 'https://45qxu5joc6.execute-api.us-east-1.amazonaws.com',
  cognito: {
    userPoolId: 'us-east-1_jefJY80nY',
    clientId: 'j044eki6ektqi155srd1a6ke9',
    region: 'us-east-1',
  },
  useApiGateway: true, // Set to false to use direct Caspio calls
  
  // Caspio config - credentials needed for local development
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2',
    clientId: '01ddeb9d873748255f3edeccb5fbfa806695e43ffa5fff4f67',
    clientSecret: '1d4e3ea85a2247f0929a0a995df66e6be183c463391375ae80'
  },
  
  // S3 configuration for file storage
  s3: {
    bucketName: 'lps-field-app',
    region: 'us-east-1',
  },
  googleMapsApiKey: 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A',
  paypal: {
    clientId: 'Ab5YsZla-pIyZZmxfKgb3k0GwWe3NoCqxIcfwefzzbutjjRgD15vdDcIIIABkNpbuFxlwS6Huu9uZgMq',
    currency: 'USD'
  },
  stripe: {
    publishableKey: 'pk_live_REPLACE_WITH_YOUR_STRIPE_PUBLISHABLE_KEY' // Replace with actual Stripe publishable key
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.

// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  isWeb: false, // Set to true when running in browser
  
  // NEW: API Gateway backend configuration
  apiGatewayUrl: 'https://45qxu5joc6.execute-api.us-east-1.amazonaws.com',
  cognito: {
    userPoolId: 'us-east-1_jefJY80nY',
    clientId: 'j044eki6ektqi155srd1a6ke9',
    region: 'us-east-1',
  },
  useApiGateway: true, // Set to false to use direct Caspio calls
  
  // Caspio config (only needed if useApiGateway = false)
  // Credentials are now securely stored in AWS Secrets Manager
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2',
    clientId: '', // Removed for security - stored in AWS
    clientSecret: '' // Removed for security - stored in AWS
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

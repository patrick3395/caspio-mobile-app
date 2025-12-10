export const environment = {
  production: true,
  isWeb: false, // Mobile build flag
  
  // AWS API Gateway backend
  apiGatewayUrl: 'https://45qxu5joc6.execute-api.us-east-1.amazonaws.com',
  cognito: {
    userPoolId: 'us-east-1_jefJY80nY',
    clientId: 'j044eki6ektqi155srd1a6ke9',
    region: 'us-east-1',
  },
  useApiGateway: true, // Set to false to use direct Caspio calls
  
  // Caspio fallback configuration  
  // Credentials are securely stored in AWS Secrets Manager
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2',
    clientId: '', // Removed for security - stored in AWS
    clientSecret: '' // Removed for security - stored in AWS
  },
  googleMapsApiKey: 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A',
  paypal: {
    clientId: 'Ab5YsZla-pIyZZmxfKgb3k0GwWe3NoCqxIcfwefzzbutjjRgD15vdDcIIIABkNpbuFxlwS6Huu9uZgMq',
    currency: 'USD'
  }
};

export const environment = {
  production: true,
  isWeb: true, // Flag to identify web build
  
  // AWS API Gateway backend
  apiGatewayUrl: 'https://iaopezyqb4aak4zpakgunea2hi0qoiqh.lambda-url.us-east-1.on.aws',
  cognito: {
    userPoolId: 'us-east-1_jefJY80nY',
    clientId: 'j044eki6ektqi155srd1a6ke9',
    region: 'us-east-1',
  },
  useApiGateway: true,
  
  // Caspio config (credentials removed for security)
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2',
    clientId: '',
    clientSecret: ''
  },
  googleMapsApiKey: 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A',
  paypal: {
    clientId: 'Ab5YsZla-pIyZZmxfKgb3k0GwWe3NoCqxIcfwefzzbutjjRgD15vdDcIIIABkNpbuFxlwS6Huu9uZgMq',
    currency: 'USD'
  }
};

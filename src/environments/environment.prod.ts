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
  
  // Caspio config (auth handled server-side via API Gateway)
  caspio: {
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2'
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
    publishableKey: 'pk_live_51PLTqgFeRJdYiXMWA0EFdZGARdKBsNmnZnhBRQMVQk3CrCxz8L6nDvGRrkjntzYecZs7unJCZVoFDFutx4QqoazX00q6sH3pes'
  }
};

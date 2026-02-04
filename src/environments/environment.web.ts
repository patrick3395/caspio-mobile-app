export const environment = {
  production: true,
  isWeb: true, // Flag to identify web build
  
  // AWS API Gateway backend
  apiGatewayUrl: 'https://45qxu5joc6.execute-api.us-east-1.amazonaws.com',
  cognito: {
    userPoolId: 'us-east-1_jefJY80nY',
    clientId: 'j044eki6ektqi155srd1a6ke9',
    region: 'us-east-1',
  },
  useApiGateway: true,
  
  // Caspio config (only used internally by backend now)
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v2',
    clientId: '01ddeb9d873748255f3edeccb5fbfa806695e43ffa5fff4f67',
    clientSecret: '1d4e3ea85a2247f0929a0a995df66e6be183c463391375ae80'
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

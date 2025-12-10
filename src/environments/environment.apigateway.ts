// Environment configuration for API Gateway integration
// Copy these values to your environment.ts and environment.prod.ts files

export const apiGatewayConfig = {
  // Replace with your actual API Gateway URL after deployment
  // Get this from: sam list stack-outputs --stack-name caspio-middleware-dev
  apiGatewayUrl: 'https://YOUR-API-ID.execute-api.us-east-1.amazonaws.com/dev/api',
  
  // Cognito configuration
  // Get these from CloudFormation outputs after deployment
  cognito: {
    userPoolId: 'us-east-1_XXXXXXXXX',  // Replace with your User Pool ID
    clientId: 'YOUR-CLIENT-ID',          // Replace with your Client ID
    region: 'us-east-1',                 // Your AWS region
  },
  
  // Feature flags
  useApiGateway: true,  // Set to true to use API Gateway, false for direct Caspio calls
  offlineMode: true,    // Keep offline capabilities
};

// Example environment.ts after integration:
/*
import { apiGatewayConfig } from './environment.apigateway';

export const environment = {
  production: false,
  
  // API Gateway configuration
  apiGatewayUrl: apiGatewayConfig.apiGatewayUrl,
  cognito: apiGatewayConfig.cognito,
  useApiGateway: apiGatewayConfig.useApiGateway,
  
  // Existing Caspio configuration (keep as fallback)
  caspio: {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    tokenEndpoint: 'https://c0ady234.caspio.com/oauth/token',
    apiBaseUrl: 'https://c0ady234.caspio.com/rest/v2',
  },
};
*/


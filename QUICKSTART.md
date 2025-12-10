# Quick Start Guide

Get your Caspio Express Middleware up and running in 15 minutes.

## Prerequisites Checklist

- [ ] AWS Account created
- [ ] AWS CLI installed and configured (`aws configure`)
- [ ] AWS SAM CLI installed
- [ ] Node.js 18+ installed
- [ ] Caspio API credentials (Client ID, Secret, Account ID)

## Step 1: Deploy Backend (5 minutes)

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Setup Caspio credentials in AWS Secrets Manager
chmod +x scripts/setup-secrets.sh
./scripts/setup-secrets.sh
# Enter your Caspio credentials when prompted

# Deploy to AWS
chmod +x scripts/deploy.sh
./scripts/deploy.sh dev
```

**Wait for deployment to complete** (~3-5 minutes)

## Step 2: Get Deployment Info (1 minute)

```bash
# Get API Gateway URL
aws cloudformation describe-stacks \
  --stack-name caspio-middleware-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text

# Save this URL - you'll need it for frontend configuration
```

Example output: `https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev`

```bash
# Get Cognito User Pool ID
aws cloudformation describe-stacks \
  --stack-name caspio-middleware-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text

# Get Cognito Client ID
aws cloudformation describe-stacks \
  --stack-name caspio-middleware-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text
```

## Step 3: Create Test User (2 minutes)

```bash
# Set variables from Step 2
export USER_POOL_ID="us-east-1_XXXXXXXXX"  # Replace with your value
export EMAIL="your-email@example.com"      # Replace with your email

# Create user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --user-attributes Name=email,Value=$EMAIL \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --password "SecurePass123!" \
  --permanent

echo "✅ Test user created: $EMAIL / SecurePass123!"
```

## Step 4: Test Backend (2 minutes)

```bash
# Set API URL from Step 2
export API_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev"

# Test health check (no auth required)
curl $API_URL/

# Should return:
# {
#   "service": "Caspio Express Middleware",
#   "status": "running",
#   ...
# }
```

Get JWT token for authenticated requests:

```bash
export CLIENT_ID="your-client-id"  # From Step 2

# Get token
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters USERNAME=$EMAIL,PASSWORD=SecurePass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text > token.txt

export TOKEN=$(cat token.txt)

# Test authenticated endpoint
curl -H "Authorization: Bearer $TOKEN" \
  ${API_URL}/api/health

# Should return: {"status":"healthy", ...}
```

## Step 5: Update Frontend (5 minutes)

### A. Install Cognito SDK

```bash
# Navigate to project root
cd ..

# Install package
npm install amazon-cognito-identity-js
```

### B. Update Environment File

Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  
  // ADD THESE NEW LINES:
  apiGatewayUrl: 'https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev/api',
  cognito: {
    userPoolId: 'us-east-1_XXXXXXXXX',
    clientId: 'your-client-id',
    region: 'us-east-1',
  },
  useApiGateway: true,
  
  // KEEP existing Caspio config as fallback
  caspio: {
    // ... existing config
  },
};
```

### C. Register HTTP Interceptor

Edit `src/app/app.module.ts`:

```typescript
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './interceptors/auth.interceptor';

@NgModule({
  // ... existing config
  providers: [
    // ... existing providers
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
  ],
})
export class AppModule { }
```

## Step 6: Test Frontend Integration (Optional)

### Quick Test in Angular

1. Run the app:
   ```bash
   ionic serve
   ```

2. In your browser console:
   ```javascript
   // Test API Gateway service
   import { ApiGatewayService } from './app/services/api-gateway.service';
   
   // In your component or service
   this.apiGateway.healthCheck().subscribe(
     response => console.log('Health check:', response),
     error => console.error('Error:', error)
   );
   ```

## Next Steps

### Immediate

1. ✅ **Test a real Caspio endpoint**
   ```bash
   # Replace PROJECT_ID with actual ID
   curl -H "Authorization: Bearer $TOKEN" \
     ${API_URL}/api/projects/PROJECT_ID
   ```

2. ✅ **Create a login page** (see [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md))

3. ✅ **Update CaspioService** to use API Gateway

### Within a Week

1. 📊 **Set up CloudWatch Dashboard**
   - Monitor Lambda invocations
   - Track error rates
   - Watch queue depth

2. 🔔 **Configure CloudWatch Alarms** (already created, but review them)
   ```bash
   aws cloudwatch describe-alarms --stack-name caspio-middleware-dev
   ```

3. 🧪 **Load Testing**
   - Test with expected traffic
   - Optimize Lambda memory if needed

### Before Production

1. 🔒 **Security Review**
   - [ ] Update CORS origins (no wildcards)
   - [ ] Review IAM permissions
   - [ ] Enable AWS WAF (optional)

2. 📈 **Performance Optimization**
   - [ ] Review Lambda memory allocation
   - [ ] Configure DynamoDB auto-scaling
   - [ ] Enable API Gateway caching

3. 💰 **Cost Optimization**
   - [ ] Set up AWS Budgets
   - [ ] Review CloudWatch log retention
   - [ ] Optimize Lambda cold starts

4. 🚀 **Deploy to Production**
   ```bash
   cd backend
   ./scripts/deploy.sh prod
   ```

## Troubleshooting Quick Fixes

### "Secret not found" error
```bash
cd backend
./scripts/setup-secrets.sh
```

### "Unauthorized" error
```bash
# Refresh your token
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters USERNAME=$EMAIL,PASSWORD=SecurePass123!
```

### CORS errors
Edit `backend/samconfig.toml`:
```toml
parameter_overrides = "Stage=dev AllowedOrigins=http://localhost:8100"
```
Redeploy:
```bash
cd backend
./scripts/deploy.sh dev
```

### Can't find AWS resources
```bash
# List all stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE

# Describe specific stack
aws cloudformation describe-stacks --stack-name caspio-middleware-dev
```

## Useful Commands

```bash
# View API logs in real-time
aws logs tail /aws/lambda/caspio-api-handler-dev --follow

# Check queue status
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# List DynamoDB records
aws dynamodb scan --table-name caspio-request-logs-dev --limit 10

# Delete stack (cleanup)
aws cloudformation delete-stack --stack-name caspio-middleware-dev
```

## Success Checklist

- [ ] Backend deployed successfully
- [ ] Can access health endpoint
- [ ] Test user created in Cognito
- [ ] JWT token obtained successfully
- [ ] Authenticated API call works
- [ ] Frontend environment updated
- [ ] HTTP interceptor registered
- [ ] CloudWatch logs visible

## Get Help

- 📖 **Detailed Guides:**
  - [DEPLOYMENT.md](backend/DEPLOYMENT.md) - Full deployment guide
  - [TESTING.md](backend/TESTING.md) - Testing guide
  - [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md) - Frontend guide

- 🐛 **Common Issues:**
  - Check CloudWatch logs first
  - Review [DEPLOYMENT.md Troubleshooting](backend/DEPLOYMENT.md#troubleshooting)
  - Verify all environment variables are set

- 💬 **Support:**
  - Review the main [README.md](README.md)
  - Check AWS CloudWatch for errors
  - Review Lambda execution logs

---

**Congratulations!** 🎉 

You now have a production-ready Express.js middleware running on AWS Lambda that will make your Caspio application more reliable and performant!


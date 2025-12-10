# Caspio Express Middleware Project

A comprehensive Express.js middleware solution hosted on AWS Lambda that provides a reliable, scalable proxy between your Angular frontend and Caspio API v3.

## 🎯 Project Overview

This project implements a serverless Express.js backend on AWS that:

- **Proxies all Caspio API calls** through a centralized backend
- **Improves reliability** in areas of poor network connectivity
- **Implements automatic retry logic** with exponential backoff
- **Queues long-running requests** using AWS SQS
- **Logs all requests** to DynamoDB and CloudWatch
- **Secures credentials** in AWS Secrets Manager
- **Authenticates users** with AWS Cognito
- **Uses Caspio API v3** for all operations

## 📁 Project Structure

```
.
├── backend/                      # Express.js Lambda backend
│   ├── src/
│   │   ├── services/            # Core services
│   │   │   ├── caspioService.ts    # Caspio API v3 client
│   │   │   ├── loggingService.ts   # Request logging
│   │   │   ├── retryService.ts     # Retry logic
│   │   │   └── queueService.ts     # SQS queue management
│   │   ├── middleware/          # Express middleware
│   │   │   ├── authMiddleware.ts   # Cognito JWT verification
│   │   │   ├── errorHandler.ts     # Error handling
│   │   │   └── requestLogger.ts    # Request logging
│   │   ├── routes/              # API routes
│   │   │   └── caspioRoutes.ts     # All Caspio endpoints
│   │   ├── app.ts               # Express app configuration
│   │   ├── index.ts             # Lambda handler
│   │   └── queueProcessor.ts    # SQS queue processor
│   ├── scripts/                 # Deployment scripts
│   │   ├── deploy.sh               # Main deployment script
│   │   └── setup-secrets.sh        # Setup Caspio credentials
│   ├── template.yaml            # AWS SAM template
│   ├── package.json             # Dependencies
│   ├── DEPLOYMENT.md            # Deployment guide
│   └── TESTING.md               # Testing guide
├── src/                         # Angular frontend
│   ├── app/
│   │   ├── services/
│   │   │   ├── api-gateway.service.ts  # API Gateway client
│   │   │   ├── cognito-auth.service.ts # Cognito authentication
│   │   │   └── caspio.service.ts       # Existing Caspio service
│   │   └── interceptors/
│   │       └── auth.interceptor.ts     # JWT token interceptor
│   └── environments/
│       └── environment.apigateway.ts   # API Gateway config
├── express-cas.plan.md          # Implementation plan
├── FRONTEND_INTEGRATION.md      # Frontend integration guide
└── README.md                    # This file
```

## 🏗️ Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Angular   │────────▶│ API Gateway  │────────▶│   Lambda    │
│  Frontend   │         │              │         │  (Express)  │
└─────────────┘         └──────────────┘         └─────────────┘
                                                         │
                        ┌────────────────────────────────┼────────────┐
                        │                                │            │
                        ▼                                ▼            ▼
                  ┌──────────┐                    ┌──────────┐  ┌─────────┐
                  │ Cognito  │                    │   SQS    │  │ Secrets │
                  │  (Auth)  │                    │  Queue   │  │ Manager │
                  └──────────┘                    └──────────┘  └─────────┘
                                                         │
                                                         ▼
                                                  ┌──────────┐
                                                  │  Lambda  │
                                                  │(QueueProc)│
                                                  └──────────┘
                                                         │
                  ┌──────────────────────────────────────┼────────────┐
                  │                                      │            │
                  ▼                                      ▼            ▼
            ┌──────────┐                          ┌──────────┐  ┌─────────┐
            │DynamoDB  │                          │CloudWatch│  │ Caspio  │
            │  (Logs)  │                          │  Logs    │  │   API   │
            └──────────┘                          └──────────┘  └─────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18.x or later
- AWS Account with CLI configured
- AWS SAM CLI installed
- Caspio account with API credentials
- Ionic/Angular development environment

### 1. Deploy Backend

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Setup Caspio credentials in AWS Secrets Manager
./scripts/setup-secrets.sh

# Deploy to AWS
./scripts/deploy.sh dev
```

### 2. Configure Frontend

```bash
# Install Cognito SDK
npm install amazon-cognito-identity-js

# Update environment with API Gateway URL
# Edit src/environments/environment.ts with values from deployment
```

### 3. Test

```bash
# Test backend health
curl https://your-api-id.execute-api.us-east-1.amazonaws.com/dev/

# Run Angular app
ionic serve
```

## 📖 Documentation

- **[Implementation Plan](express-cas.plan.md)** - Detailed implementation plan
- **[Backend Deployment Guide](backend/DEPLOYMENT.md)** - Step-by-step deployment instructions
- **[Testing Guide](backend/TESTING.md)** - Comprehensive testing documentation
- **[Frontend Integration Guide](FRONTEND_INTEGRATION.md)** - Angular integration instructions

## ✨ Features

### Backend Features

- ✅ **Express.js on AWS Lambda** - Serverless, auto-scaling backend
- ✅ **Caspio API v3 Integration** - Full support for Caspio REST API
- ✅ **OAuth2 Authentication** - Secure token management for Caspio
- ✅ **Request Logging** - All requests logged to DynamoDB & CloudWatch
- ✅ **Automatic Retries** - Exponential backoff for failed requests
- ✅ **Queue Management** - Long-running requests handled via SQS
- ✅ **Error Handling** - Comprehensive error handling and reporting
- ✅ **AWS Cognito Auth** - JWT token verification for all requests

### Frontend Features

- ✅ **API Gateway Integration** - Seamless integration with Express backend
- ✅ **Cognito Authentication** - User sign-in/sign-out with JWT tokens
- ✅ **HTTP Interceptor** - Automatic token attachment to requests
- ✅ **Token Refresh** - Automatic JWT token refresh on expiry
- ✅ **Offline Support** - Maintains existing offline capabilities
- ✅ **Gradual Migration** - Can gradually migrate from direct Caspio calls

## 🔑 Key Components

### Backend Services

| Service | Purpose |
|---------|---------|
| `caspioService.ts` | Caspio API v3 client with OAuth2 |
| `loggingService.ts` | Request/response logging to DynamoDB |
| `retryService.ts` | Exponential backoff retry logic |
| `queueService.ts` | SQS queue management |
| `authMiddleware.ts` | Cognito JWT verification |

### AWS Resources

| Resource | Purpose |
|----------|---------|
| Lambda (API) | Main Express.js API handler |
| Lambda (Queue) | SQS message processor |
| API Gateway | HTTP routing and CORS |
| DynamoDB | Request logs and metadata |
| SQS | Message queue for long requests |
| Cognito | User authentication |
| Secrets Manager | Secure credential storage |
| CloudWatch | Centralized logging and monitoring |

## 🛠️ Development

### Local Development

```bash
cd backend
npm run local
```

Server runs on `http://localhost:3000`

### Build

```bash
npm run build
```

### Deploy

```bash
# Development
./scripts/deploy.sh dev

# Staging
./scripts/deploy.sh staging

# Production
./scripts/deploy.sh prod
```

## 📊 Monitoring

### CloudWatch Dashboards

Monitor these metrics:
- Lambda invocations and errors
- API Gateway requests and latency
- SQS queue depth
- DynamoDB read/write capacity

### CloudWatch Alarms

Pre-configured alarms for:
- High error rate (>10 errors in 5 minutes)
- High queue depth (>100 messages)
- Dead letter queue messages

### Viewing Logs

```bash
# API logs
aws logs tail /aws/lambda/caspio-api-handler-dev --follow

# Queue processor logs
aws logs tail /aws/lambda/caspio-queue-processor-dev --follow
```

## 💰 Cost Estimate

Approximate monthly costs for moderate usage:

| Service | Estimated Cost |
|---------|----------------|
| Lambda | $5-20 |
| API Gateway | $3.50/million requests |
| DynamoDB | $1-10 |
| SQS | $0.40/million requests |
| Cognito | Free (up to 50K MAUs) |
| CloudWatch | $5-15 |
| **Total** | **~$15-50/month** |

## 🔒 Security

- ✅ Credentials stored in AWS Secrets Manager
- ✅ All API calls authenticated with Cognito JWT
- ✅ CORS properly configured
- ✅ IAM roles with least privilege
- ✅ Encryption at rest and in transit
- ✅ CloudWatch monitoring and alarms

## 🧪 Testing

See [TESTING.md](backend/TESTING.md) for comprehensive testing guide.

Quick test:
```bash
# Health check
curl https://your-api-id.execute-api.us-east-1.amazonaws.com/dev/

# Authenticated endpoint
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-api-id.execute-api.us-east-1.amazonaws.com/dev/api/health
```

## 🚨 Troubleshooting

### Common Issues

1. **"Secret not found"** - Run `./scripts/setup-secrets.sh`
2. **CORS errors** - Update `AllowedOrigins` in `samconfig.toml`
3. **401 Unauthorized** - Check Cognito token is valid
4. **Timeout errors** - Increase Lambda timeout in `template.yaml`

See [DEPLOYMENT.md](backend/DEPLOYMENT.md#troubleshooting) for more details.

## 📝 API Endpoints

All endpoints require `Authorization: Bearer <JWT_TOKEN>` header.

### Projects
- `GET /api/projects/:id` - Get project by ID
- `GET /api/projects/:projectId/services` - Get services by project

### Services
- `GET /api/services/:id` - Get service
- `POST /api/services` - Create service
- `DELETE /api/services/:id` - Delete service

### EFE (Engineers Foundation)
- `GET /api/efe/templates` - Get EFE templates
- `GET /api/services/:serviceId/efe` - Get EFE data
- `POST /api/efe` - Create EFE
- `PUT /api/efe/:id` - Update EFE
- `DELETE /api/efe/:id` - Delete EFE

### Visuals
- `GET /api/services/:serviceId/visuals` - Get visuals
- `POST /api/visuals` - Create visual
- `PUT /api/visuals/:id` - Update visual
- `DELETE /api/visuals/:id` - Delete visual

### Files
- `GET /api/files/*` - Get file
- `POST /api/files/upload` - Upload file

See full API documentation in [backend/src/routes/caspioRoutes.ts](backend/src/routes/caspioRoutes.ts)

## 🤝 Contributing

1. Create a feature branch
2. Make changes
3. Test locally and on AWS
4. Update documentation
5. Submit pull request

## 📄 License

[Your License Here]

## 👥 Authors

[Your Name/Team]

## 🙏 Acknowledgments

- AWS Serverless Application Model (SAM)
- Express.js framework
- Caspio API v3
- AWS Cognito

## 📞 Support

For issues and questions:
1. Check [DEPLOYMENT.md](backend/DEPLOYMENT.md#troubleshooting)
2. Check [TESTING.md](backend/TESTING.md)
3. Review CloudWatch logs
4. Contact your AWS administrator

---

**Last Updated:** January 2024
**Version:** 1.0.0


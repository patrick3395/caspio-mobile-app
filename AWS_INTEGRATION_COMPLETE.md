# AWS Integration - Complete System Overview

## 🎯 System Architecture

```
Angular/Ionic App (Frontend)
    ↓
API Gateway HTTP API
https://45qxu5joc6.execute-api.us-east-1.amazonaws.com
    ↓
AWS Lambda (Express.js Backend)
    ├─ Retry Service (3 attempts, exponential backoff)
    ├─ Logging Service (DynamoDB + CloudWatch)
    ├─ Queue Service (SQS for long requests)
    └─ Caspio Service (OAuth2 + API calls)
        ↓
    Caspio API
    https://c2hcf092.caspio.com/rest/v2
```

## 📁 Backend File Structure

### Core Express.js Files

| File | Purpose | What It Does |
|------|---------|--------------|
| `backend/src/app.ts` | Express app | CORS, middleware, routes |
| `backend/src/index.ts` | Lambda handler | Receives HTTP, runs Express |
| `backend/src/routes/caspioRoutes.ts` | API routes | All endpoints + proxy route |
| `backend/src/queueProcessor.ts` | Queue processor | Handles SQS messages |

### Services (Business Logic)

| File | Purpose | Key Methods |
|------|---------|-------------|
| `backend/src/services/caspioService.ts` | Caspio API client | OAuth2, GET/POST/PUT/DELETE |
| `backend/src/services/retryService.ts` | Retry logic | `executeWithRetry()` |
| `backend/src/services/loggingService.ts` | Request logging | DynamoDB + CloudWatch |
| `backend/src/services/queueService.ts` | SQS management | `enqueue()`, `dequeue()` |

### Middleware

| File | Purpose | When It Runs |
|------|---------|--------------|
| `backend/src/middleware/requestLogger.ts` | Log all requests | Every request |
| `backend/src/middleware/errorHandler.ts` | Handle errors | On errors |
| `backend/src/middleware/authMiddleware.ts` | Verify JWT tokens | (Currently disabled) |

### Configuration

| File | Purpose |
|------|---------|
| `backend/src/config/index.ts` | All settings (retry, queue, etc.) |
| `backend/src/types/index.ts` | TypeScript types |
| `backend/template.yaml` | AWS infrastructure (SAM) |

## ⚙️ Current Configuration

### Retry Settings (`backend/src/config/index.ts`)

```typescript
retry: {
  maxAttempts: 3,        // Number of retry attempts
  initialDelayMs: 1000,  // 1st retry after 1 second
  maxDelayMs: 10000,     // Max 10 seconds between retries
  backoffMultiplier: 2,  // Exponential: 1s, 2s, 4s, 8s, 10s
}
```

**Total retry duration:** ~7-15 seconds

### Queue Settings

```typescript
sqs: {
  queueUrl: process.env.SQS_QUEUE_URL,
  longRequestThreshold: 3000, // Queue if request takes >3 seconds
}
```

### Lambda Settings (`template.yaml`)

```yaml
Timeout: 30      # Lambda max execution time
MemorySize: 512  # MB of RAM
```

## 🔄 Request Flow

### Normal Request (Good Connection):

```
1. User action (click Save)
2. Angular calls ApiGatewayService
3. HTTP POST → API Gateway
4. API Gateway → Lambda
5. Express receives request
6. RequestLogger logs it
7. CaspioRoutes processes
8. CaspioService calls Caspio API
9. Caspio responds
10. Express returns response
11. Lambda returns to API Gateway
12. API Gateway returns to app
13. User sees success

Duration: 200-700ms
```

### Failed Request (Poor Connection - YOUR CASE):

```
1. User action
2. HTTP POST → API Gateway
3. API Gateway → Lambda  
4. Express → CaspioService
5. Caspio API call attempt 1 → TIMEOUT (5s)
6. RetryService waits 1s
7. Caspio API call attempt 2 → TIMEOUT (5s)
8. RetryService waits 2s
9. Caspio API call attempt 3 → SUCCESS ✅
10. Response returns through stack
11. User sees success (never knew it retried)

Duration: ~13 seconds (but successful!)
```

### All Retries Failed (1 Minute Bad Service):

```
1. User action
2. HTTP POST → API Gateway
3. Lambda tries 3x over 15 seconds
4. All fail
5. Lambda returns error 500
6. ⚠️ WITHOUT offline queue: REQUEST LOST
7. User sees error message
8. User must manually retry later

Duration: ~15 seconds, then fails
```

**⚠️ CRITICAL:** You removed offline queue, so if all retries fail, the request is lost!

## ⚠️ Important: You Removed Offline Queue

### What You Lost:

Before (with offline queue):
```
All retries fail → Save to localStorage → Sync later ✅
```

Now (without offline queue):
```
All retries fail → Show error → Data lost ❌
```

### Recommendation:

**Keep AWS retry** (handles brief outages)  
**Add back minimal offline queue** (handles extended outages)

The two work together:
- AWS retry: Fast recovery (seconds)
- Offline queue: Extended outages (minutes/hours)

## 🔍 How to Review What's Happening

### 1. Check Live Logs

```powershell
# See all requests in real-time
aws logs tail /aws/lambda/caspio-api-handler-dev --follow

# Filter for errors only
aws logs tail /aws/lambda/caspio-api-handler-dev --follow --filter-pattern "ERROR"

# Filter for retries
aws logs tail /aws/lambda/caspio-api-handler-dev --follow --filter-pattern "Retry"
```

### 2. Check Request History

```powershell
# Last 10 requests
aws dynamodb scan --table-name caspio-request-logs-dev --limit 10

# Requests with retries (poor connection indicators)
aws dynamodb scan --table-name caspio-request-logs-dev \
  --filter-expression "retryCount > :zero" \
  --expression-attribute-values '{":zero":{"N":"0"}}'
```

### 3. Check Queue Depth

```powershell
# See how many requests are queued
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/551098792376/caspio-standard-queue-dev \
  --attribute-names ApproximateNumberOfMessages
```

### 4. Monitor in AWS Console

**CloudWatch Dashboard:**
1. Go to: https://console.aws.amazon.com/cloudwatch/
2. Create dashboard
3. Add widgets:
   - Lambda invocations
   - Lambda errors
   - Lambda duration
   - SQS queue depth

## 🎛️ Tuning for Your Needs

### For Better Reliability in Bad Areas:

#### Option A: More Retries (Current: 3, Suggest: 5)

Edit `backend/src/config/index.ts`:

```typescript
retry: {
  maxAttempts: 5,  // ← Change from 3 to 5
  initialDelayMs: 1000,
  maxDelayMs: 30000,  // ← Change from 10000 to 30000
  backoffMultiplier: 2,
}
```

**Effect:** 1s, 2s, 4s, 8s, 16s delays = ~35 second window
**Benefit:** More chances to catch returning signal
**Trade-off:** Longer wait before giving up

#### Option B: Faster Retries (More attempts, shorter waits)

```typescript
retry: {
  maxAttempts: 5,
  initialDelayMs: 500,  // ← Faster first retry
  maxDelayMs: 5000,     // ← Shorter max delay
  backoffMultiplier: 1.5,  // ← Slower growth
}
```

**Effect:** 0.5s, 0.75s, 1.1s, 1.7s, 2.5s = ~6 second total
**Benefit:** Fast failure detection, user gets feedback sooner
**Trade-off:** Less patient, might fail when signal about to return

**I recommend Option A** for field workers with truly bad reception.

### To Apply Changes:

```powershell
cd C:\Users\Owner\Caspio\backend
npm run build
sam build
sam deploy --no-confirm-changeset
```

## 📊 Success Metrics to Track

### In CloudWatch (AWS Console):

**1. Retry Rate**
- Metric: Custom metric from logs
- Goal: <20% of requests need retry
- High rate = Poor reception in that area

**2. Success Rate**
- Metric: Lambda errors / Lambda invocations
- Goal: >99%
- Track daily

**3. Response Time (P95)**
- Metric: Lambda duration
- Goal: <1000ms for 95% of requests
- Optimization target

**4. Queue Depth**
- Metric: SQS ApproximateNumberOfMessages
- Goal: <10 messages
- High = System overloaded or poor connectivity

## 🚨 Critical: Add Offline Fallback

Since you removed offline queue, add THIS to your frontend:

```typescript
// In caspio.service.ts or api-gateway.service.ts

get<T>(endpoint: string): Observable<T> {
  return this.apiGateway.get<T>(endpoint).pipe(
    retryWhen(errors =>
      errors.pipe(
        mergeMap((error, index) => {
          if (index >= 2) {  // After 2 frontend retries
            // Save to localStorage as fallback
            this.saveForLater(endpoint, 'GET', null);
            return throwError(() => new Error('Saved locally, will retry later'));
          }
          return timer(1000 * (index + 1));  // 1s, 2s delay
        })
      )
    ),
    catchError(error => {
      // Final fallback
      this.saveForLater(endpoint, 'GET', null);
      return throwError(() => error);
    })
  );
}

private saveForLater(endpoint: string, method: string, data: any): void {
  const pending = JSON.parse(localStorage.getItem('pendingRequests') || '[]');
  pending.push({
    endpoint,
    method,
    data,
    timestamp: Date.now(),
  });
  localStorage.setItem('pendingRequests', JSON.stringify(pending));
  console.log('Request saved for later retry');
}
```

**This gives you offline resilience!**

## 📝 Summary

**What You Have:**
- ✅ Express.js backend on AWS Lambda
- ✅ 3 automatic retries with smart delays
- ✅ Request logging (every call tracked)
- ✅ Error tracking
- ✅ Queue for slow requests (>3s)
- ✅ API Gateway with native CORS
- ⚠️ NO offline fallback (you removed it)

**What You Need:**
- Add minimal offline fallback (localStorage)
- Or increase retries to 5-7 attempts
- Monitor CloudWatch for failure patterns
- Test in real poor-reception scenarios

**Files to Review:**
- `backend/src/app.ts` - Express app setup
- `backend/src/routes/caspioRoutes.ts` - All your API endpoints
- `backend/src/services/retryService.ts` - Retry logic
- `backend/src/config/index.ts` - Settings to tune

Need help with anything specific?


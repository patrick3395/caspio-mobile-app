# Frontend Integration Guide

This guide explains how to integrate your Angular frontend with the new Express.js backend on AWS.

## Overview

The Express.js backend on AWS Lambda now handles all Caspio API calls, providing:
- ✅ Better reliability in poor network conditions
- ✅ Automatic retry logic
- ✅ Request queueing for long-running operations
- ✅ Centralized logging
- ✅ Secure credential storage

## Step 1: Install Required Packages

Install the AWS Cognito SDK:

```bash
npm install amazon-cognito-identity-js
npm install --save-dev @types/amazon-cognito-identity-js
```

## Step 2: Update Environment Configuration

1. Deploy the backend and get your API Gateway URL:
   ```bash
   cd backend
   ./scripts/deploy.sh dev
   ```

2. Get the CloudFormation outputs:
   ```bash
   aws cloudformation describe-stacks --stack-name caspio-middleware-dev
   ```

3. Update `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  
  // NEW: API Gateway configuration
  apiGatewayUrl: 'https://YOUR-API-ID.execute-api.us-east-1.amazonaws.com/dev/api',
  cognito: {
    userPoolId: 'us-east-1_XXXXXXXXX',
    clientId: 'YOUR-CLIENT-ID',
    region: 'us-east-1',
  },
  useApiGateway: true,
  
  // KEEP: Existing Caspio config as fallback
  caspio: {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    tokenEndpoint: 'https://c0ady234.caspio.com/oauth/token',
    apiBaseUrl: 'https://c0ady234.caspio.com/rest/v2',
  },
};
```

4. Update `src/environments/environment.prod.ts` similarly with production values.

## Step 3: Register HTTP Interceptor

Update `src/app/app.module.ts` to register the authentication interceptor:

```typescript
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './interceptors/auth.interceptor';

@NgModule({
  // ... existing configuration
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

## Step 4: Update CaspioService

The existing `CaspioService` needs to be updated to route requests through the API Gateway.

### Option A: Gradual Migration (Recommended)

Keep existing direct Caspio calls and gradually migrate to API Gateway:

```typescript
// In caspio.service.ts

import { ApiGatewayService } from './api-gateway.service';
import { environment } from '../../environments/environment';

export class CaspioService {
  constructor(
    private http: HttpClient,
    private apiGateway: ApiGatewayService,
    // ... other dependencies
  ) {}

  getProject(projectId: string): Observable<any> {
    if (environment.useApiGateway) {
      // Use API Gateway
      return this.apiGateway.get(`/projects/${projectId}`);
    } else {
      // Use direct Caspio API (existing code)
      return this.get(`/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`);
    }
  }

  // Update other methods similarly...
}
```

### Option B: Full Migration

Replace all Caspio API calls with API Gateway calls:

```typescript
// Example: Update getProject method
getProject(projectId: string): Observable<any> {
  return this.apiGateway.get(`/projects/${projectId}`).pipe(
    catchError(error => {
      console.error('Failed to get project:', error);
      return throwError(() => error);
    })
  );
}
```

## Step 5: Add Authentication UI

Create a login component for Cognito authentication:

```bash
ionic generate component components/login
```

Update `login.component.ts`:

```typescript
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CognitoAuthService } from '../../services/cognito-auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';

  constructor(
    private authService: CognitoAuthService,
    private router: Router
  ) {}

  async login() {
    try {
      await this.authService.signIn(this.email, this.password).toPromise();
      this.router.navigate(['/home']);
    } catch (error: any) {
      this.error = error.message || 'Login failed';
      console.error('Login error:', error);
    }
  }

  logout() {
    this.authService.signOut();
  }
}
```

Update `login.component.html`:

```html
<ion-header>
  <ion-toolbar>
    <ion-title>Login</ion-title>
  </ion-toolbar>
</ion-header>

<ion-content class="ion-padding">
  <ion-item>
    <ion-label position="floating">Email</ion-label>
    <ion-input type="email" [(ngModel)]="email"></ion-input>
  </ion-item>

  <ion-item>
    <ion-label position="floating">Password</ion-label>
    <ion-input type="password" [(ngModel)]="password"></ion-input>
  </ion-item>

  <ion-button expand="block" (click)="login()" class="ion-margin-top">
    Login
  </ion-button>

  <ion-text color="danger" *ngIf="error">
    <p>{{ error }}</p>
  </ion-text>
</ion-content>
```

## Step 6: Add Route Guards

Create an auth guard to protect routes:

```bash
ionic generate guard guards/auth
```

Update `auth.guard.ts`:

```typescript
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { CognitoAuthService } from '../services/cognito-auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: CognitoAuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (this.authService.isAuthenticated()) {
      return true;
    }

    this.router.navigate(['/login']);
    return false;
  }
}
```

Apply the guard to protected routes in `app-routing.module.ts`:

```typescript
import { AuthGuard } from './guards/auth.guard';

const routes: Routes = [
  {
    path: 'home',
    loadChildren: () => import('./pages/home/home.module').then(m => m.HomePageModule),
    canActivate: [AuthGuard],  // Add guard
  },
  {
    path: 'login',
    loadChildren: () => import('./components/login/login.module').then(m => m.LoginPageModule),
  },
  // ... other routes
];
```

## Step 7: Test the Integration

1. **Start the Angular app:**
   ```bash
   ionic serve
   ```

2. **Test authentication:**
   - Navigate to the login page
   - Sign in with a Cognito user
   - Verify JWT token is stored

3. **Test API calls:**
   - Make a request to any Caspio endpoint
   - Check browser dev tools → Network tab
   - Verify requests go to API Gateway (not directly to Caspio)
   - Check Authorization header contains JWT token

4. **Test offline functionality:**
   - Disable network in dev tools
   - Make requests (should queue)
   - Re-enable network
   - Verify queued requests process

## Step 8: Monitor Backend

Monitor your backend in AWS CloudWatch:

```bash
# View API logs
aws logs tail /aws/lambda/caspio-api-handler-dev --follow

# View queue processor logs
aws logs tail /aws/lambda/caspio-queue-processor-dev --follow
```

## Troubleshooting

### Issue: "No authorization token provided"

**Solution:** Ensure the AuthInterceptor is registered and the user is signed in.

```typescript
// Check if user is authenticated
this.authService.currentUser$.subscribe(user => {
  console.log('Current user:', user);
});
```

### Issue: CORS errors

**Solution:** Update `AllowedOrigins` in backend SAM template:

```yaml
# backend/template.yaml
Parameters:
  AllowedOrigins:
    Type: String
    Default: 'http://localhost:8100,https://yourdomain.com'
```

Redeploy:
```bash
cd backend
./scripts/deploy.sh dev
```

### Issue: 401 Unauthorized errors

**Solution:** Token might be expired. The AuthInterceptor should automatically refresh it, but you can manually refresh:

```typescript
this.authService.refreshSession().subscribe(
  session => console.log('Session refreshed'),
  error => console.error('Refresh failed:', error)
);
```

### Issue: Requests timing out

**Solution:** Check Lambda timeout settings in `backend/template.yaml` and increase if needed:

```yaml
CaspioApiFunction:
  Type: AWS::Serverless::Function
  Properties:
    Timeout: 60  # Increase from 30 to 60 seconds
```

## Migration Checklist

- [ ] Install Cognito SDK packages
- [ ] Update environment configuration with API Gateway URL
- [ ] Register AuthInterceptor in app.module.ts
- [ ] Create login component
- [ ] Create auth guard
- [ ] Update CaspioService methods to use API Gateway
- [ ] Test authentication flow
- [ ] Test API calls
- [ ] Test offline functionality
- [ ] Monitor backend logs
- [ ] Update production environment
- [ ] Deploy to production

## Rollback Plan

If you need to rollback to direct Caspio calls:

1. Set `useApiGateway: false` in environment files
2. Redeploy Angular app
3. Direct Caspio calls will be used as before

## Next Steps

1. ✅ Complete frontend integration
2. 📊 Set up CloudWatch dashboards
3. 🔔 Configure CloudWatch alarms
4. 🧪 Perform load testing
5. 📈 Monitor performance metrics
6. 🚀 Deploy to production


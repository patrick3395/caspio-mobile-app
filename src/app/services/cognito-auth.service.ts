import { Injectable, Injector } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { environment } from '../../environments/environment';
import type { PushNotificationService } from './push-notification.service';

// Cognito types (install with: npm install amazon-cognito-identity-js)
// For now, we'll use type: any until the package is installed
declare const AmazonCognitoIdentity: any;

export interface CognitoUser {
  username: string;
  email: string;
  attributes?: any;
}

/**
 * Service for AWS Cognito authentication
 * Manages user sign-in, sign-up, and JWT tokens
 */
@Injectable({
  providedIn: 'root'
})
export class CognitoAuthService {
  private currentUserSubject = new BehaviorSubject<CognitoUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private tokenSubject = new BehaviorSubject<string | null>(null);
  public token$ = this.tokenSubject.asObservable();

  // Cognito configuration (will be initialized when amazon-cognito-identity-js is installed)
  private userPool: any;
  private cognitoUser: any;

  // Lazy-loaded to avoid circular dependency
  private _pushService: PushNotificationService | null = null;

  constructor(private injector: Injector) {
    this.loadStoredSession();
  }

  private get pushService(): PushNotificationService {
    if (!this._pushService) {
      const { PushNotificationService } = require('./push-notification.service');
      this._pushService = this.injector.get(PushNotificationService);
    }
    return this._pushService!;
  }

  /**
   * Initialize Cognito User Pool
   * NOTE: This requires amazon-cognito-identity-js package
   * Install with: npm install amazon-cognito-identity-js @types/amazon-cognito-identity-js
   */
  private initializeUserPool(): void {
    if (typeof AmazonCognitoIdentity === 'undefined') {
      console.warn('Amazon Cognito Identity SDK not loaded. Install amazon-cognito-identity-js package.');
      return;
    }

    const poolData = {
      UserPoolId: environment.cognito.userPoolId,
      ClientId: environment.cognito.clientId,
    };

    this.userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
  }

  /**
   * Sign in with email and password
   */
  signIn(email: string, password: string): Observable<any> {
    return from(new Promise((resolve, reject) => {
      this.initializeUserPool();

      const authenticationData = {
        Username: email,
        Password: password,
      };

      const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);

      const userData = {
        Username: email,
        Pool: this.userPool,
      };

      this.cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

      this.cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (result: any) => {
          const accessToken = result.getAccessToken().getJwtToken();
          const idToken = result.getIdToken().getJwtToken();
          
          // Store tokens
          localStorage.setItem('cognito_access_token', accessToken);
          localStorage.setItem('cognito_id_token', idToken);
          
          this.tokenSubject.next(idToken);

          // Get user attributes
          this.cognitoUser.getUserAttributes((err: any, attributes: any) => {
            // TODO: Remove debug alert after confirming push works
            alert('[Auth Debug] getUserAttributes callback. Error: ' + (err ? JSON.stringify(err) : 'none'));
            if (!err) {
              const user: CognitoUser = {
                username: email,
                email: attributes.find((attr: any) => attr.getName() === 'email')?.getValue() || email,
                attributes,
              };
              this.currentUserSubject.next(user);

              // Register push notification token with backend
              try {
                const companyId = attributes.find((attr: any) => attr.getName() === 'custom:companyId')?.getValue();
                // TODO: Remove debug alert after confirming push works
                alert('[Auth Debug] Calling registerTokenWithBackend for: ' + user.email);
                this.pushService.registerTokenWithBackend(user.username, user.email, companyId);
              } catch (e: any) {
                // TODO: Remove debug alert after confirming push works
                alert('[Auth Debug] Push registration error: ' + (e?.message || JSON.stringify(e)));
              }
            }
          });

          resolve(result);
        },
        onFailure: (err: any) => {
          // G2-SEC-002: Only log errors in non-production to prevent sensitive data exposure
          if (!environment.production) {
            console.error('Authentication failed:', err);
          }
          reject(err);
        },
        newPasswordRequired: (userAttributes: any) => {
          // Handle new password requirement
          reject({ requiresNewPassword: true, userAttributes });
        },
      });
    }));
  }

  /**
   * Sign out current user
   */
  signOut(): void {
    // Unregister push notification token before clearing session
    try {
      this.pushService.unregisterToken();
    } catch { /* push unregistration is non-critical */ }

    if (this.cognitoUser) {
      this.cognitoUser.signOut();
    }

    localStorage.removeItem('cognito_access_token');
    localStorage.removeItem('cognito_id_token');

    this.currentUserSubject.next(null);
    this.tokenSubject.next(null);
  }

  /**
   * Get current JWT token
   */
  getToken(): string | null {
    return localStorage.getItem('cognito_id_token');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.getToken() !== null;
  }

  /**
   * Load stored session from localStorage
   */
  private loadStoredSession(): void {
    const token = localStorage.getItem('cognito_id_token');
    
    if (token) {
      this.tokenSubject.next(token);
      
      // Try to restore user info
      // In production, you'd validate the token and fetch user attributes
      this.initializeUserPool();
      
      const currentUser = this.userPool?.getCurrentUser();
      if (currentUser) {
        this.cognitoUser = currentUser;
        
        currentUser.getSession((err: any, session: any) => {
          if (!err && session.isValid()) {
            currentUser.getUserAttributes((err: any, attributes: any) => {
              if (!err) {
                const user: CognitoUser = {
                  username: currentUser.getUsername(),
                  email: attributes.find((attr: any) => attr.getName() === 'email')?.getValue(),
                  attributes,
                };
                this.currentUserSubject.next(user);
              }
            });
          } else {
            this.signOut();
          }
        });
      }
    }
  }

  /**
   * Refresh session and get new tokens
   */
  refreshSession(): Observable<any> {
    return from(new Promise((resolve, reject) => {
      if (!this.cognitoUser) {
        reject('No user session');
        return;
      }

      this.cognitoUser.getSession((err: any, session: any) => {
        if (err) {
          reject(err);
          return;
        }

        if (!session.isValid()) {
          reject('Session expired');
          return;
        }

        const refreshToken = session.getRefreshToken();
        this.cognitoUser.refreshSession(refreshToken, (err: any, newSession: any) => {
          if (err) {
            reject(err);
            return;
          }

          const newIdToken = newSession.getIdToken().getJwtToken();
          const newAccessToken = newSession.getAccessToken().getJwtToken();

          localStorage.setItem('cognito_id_token', newIdToken);
          localStorage.setItem('cognito_access_token', newAccessToken);

          this.tokenSubject.next(newIdToken);
          resolve(newSession);
        });
      });
    }));
  }
}


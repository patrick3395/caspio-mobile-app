import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';
import { CaspioService } from '../services/caspio.service';
import { environment } from '../../environments/environment';

@Injectable()
export class CaspioInterceptor implements HttpInterceptor {
  constructor(private caspioService: CaspioService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        // Handle 401 errors for Caspio API calls
        if (error.status === 401 && req.url.includes('caspio.com')) {
          return this.handle401Error(req, next);
        }
        return throwError(() => error);
      })
    );
  }

  private handle401Error(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Use getValidToken() which already handles:
    // - Deduplication of concurrent refresh requests
    // - Proper queue management for waiting requests
    // - Token validation and refresh logic
    return this.caspioService.getValidToken().pipe(
      take(1),
      switchMap(token => {
        if (!token) {
          return throwError(() => new Error('Failed to obtain valid authentication token'));
        }

        // Clone the request with the new token
        const authReq = req.clone({
          headers: req.headers.set('Authorization', `Bearer ${token}`)
        });

        // Retry the request with the new token
        return next.handle(authReq);
      }),
      catchError(authError => {
        // If we can't get a valid token, propagate the error
        if (!environment.production) {
          console.error('Interceptor: Failed to refresh token for 401 error', authError);
        }
        return throwError(() => new Error('Authentication failed: Unable to refresh token'));
      })
    );
  }
}
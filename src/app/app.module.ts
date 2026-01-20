import { ErrorHandler, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { CaspioInterceptor } from './interceptors/caspio.interceptor';
import { AuthInterceptor } from './interceptors/auth.interceptor';
import { ThemeToggleComponent } from './components/theme-toggle/theme-toggle.component';
import { SyncToggleComponent } from './components/sync-toggle/sync-toggle.component';
import { UploadProgressComponent } from './components/upload-progress/upload-progress.component';
import { ErrorBoundaryComponent } from './components/error-boundary/error-boundary.component';
import { OfflineIndicatorComponent } from './components/offline-indicator/offline-indicator.component';
import { SkipLinkComponent } from './components/skip-link/skip-link.component';
import { GlobalErrorHandlerService } from './services/global-error-handler.service';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, HttpClientModule, IonicModule.forRoot(), AppRoutingModule, ThemeToggleComponent, SyncToggleComponent, UploadProgressComponent, ErrorBoundaryComponent, OfflineIndicatorComponent, SkipLinkComponent],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: HTTP_INTERCEPTORS, useClass: CaspioInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    // G2-ERRORS-001: Global error handler for web platform
    { provide: ErrorHandler, useClass: GlobalErrorHandlerService }
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}

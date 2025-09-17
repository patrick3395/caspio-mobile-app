import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { CaspioInterceptor } from './interceptors/caspio.interceptor';
import { ThemeToggleComponent } from './components/theme-toggle/theme-toggle.component';
import { SyncToggleComponent } from './components/sync-toggle/sync-toggle.component';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, HttpClientModule, IonicModule.forRoot(), AppRoutingModule, ThemeToggleComponent, SyncToggleComponent],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: HTTP_INTERCEPTORS, useClass: CaspioInterceptor, multi: true }
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}

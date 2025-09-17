import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private scriptLoadingPromise: Promise<any> | null = null;
  private readonly scriptId = 'google-maps-sdk';

  constructor(@Inject(DOCUMENT) private document: Document) {}

  load(): Promise<any> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('Google Maps cannot load outside the browser environment.'));
    }

    const win = window as any;
    if (win.google && win.google.maps && win.google.maps.places) {
      return Promise.resolve(win.google);
    }

    if (this.scriptLoadingPromise) {
      return this.scriptLoadingPromise;
    }

    this.scriptLoadingPromise = new Promise((resolve, reject) => {
      const existingScript = this.document.getElementById(this.scriptId) as HTMLScriptElement | null;

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(win.google));
        existingScript.addEventListener('error', (error) => reject(error));
        return;
      }

      const script = this.document.createElement('script');
      script.id = this.scriptId;
      const params = new URLSearchParams({
        key: environment.googleMapsApiKey,
        libraries: 'places'
      });
      script.src = 'https://maps.googleapis.com/maps/api/js?' + params.toString();
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (win.google && win.google.maps) {
          resolve(win.google);
        } else {
          reject(new Error('Google Maps SDK loaded but window.google is undefined.'));
        }
      };

      script.onerror = (error) => {
        this.scriptLoadingPromise = null;
        reject(error);
      };

      this.document.body.appendChild(script);
    });

    return this.scriptLoadingPromise;
  }
}

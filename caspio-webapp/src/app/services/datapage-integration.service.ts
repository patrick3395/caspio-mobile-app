import { Injectable } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable, BehaviorSubject } from 'rxjs';

export interface DataPageConfig {
  name: string;
  url: string;
  type: 'form' | 'report' | 'details' | 'chart' | 'calendar';
  mobileOptimized: boolean;
  parameters?: { [key: string]: string };
  customCSS?: string;
}

export interface DataPageMessage {
  type: 'data' | 'navigation' | 'error' | 'resize';
  payload: any;
  source: string;
}

@Injectable({
  providedIn: 'root'
})
export class DatapageIntegrationService {
  private messageSubject = new BehaviorSubject<DataPageMessage | null>(null);
  private authenticatedBaseUrl = '';

  constructor(private sanitizer: DomSanitizer) {
    this.setupMessageListener();
  }

  /**
   * Configure DataPages for mobile integration
   */
  configureDataPages(): DataPageConfig[] {
    return [
      // Example configurations - replace with your actual DataPages
      {
        name: 'User Management',
        url: 'https://c2hcf092.caspio.com/dp/YOUR_DATAPAGE_ID',
        type: 'form',
        mobileOptimized: true,
        parameters: { 'mobile': '1', 'responsive': 'true' }
      },
      {
        name: 'Dashboard Reports',
        url: 'https://c2hcf092.caspio.com/dp/YOUR_REPORT_ID',
        type: 'report',
        mobileOptimized: true,
        customCSS: this.getMobileOptimizedCSS()
      },
      // Add more DataPage configurations here
    ];
  }

  /**
   * Get sanitized URL for iframe embedding
   */
  getSafeUrl(dataPage: DataPageConfig): SafeResourceUrl {
    let url = dataPage.url;
    
    // Add authentication token if available
    if (this.authenticatedBaseUrl) {
      url = this.addAuthenticationToUrl(url);
    }
    
    // Add mobile parameters
    if (dataPage.parameters) {
      const params = new URLSearchParams(dataPage.parameters);
      url += (url.includes('?') ? '&' : '?') + params.toString();
    }
    
    // Add mobile-specific parameters
    url += (url.includes('?') ? '&' : '?') + 'cbMobile=1&cbResponsive=1';
    
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  /**
   * Mobile-optimized CSS for DataPages
   */
  private getMobileOptimizedCSS(): string {
    return `
      <style>
        /* Mobile optimizations */
        .cbResultSetTable {
          font-size: 14px !important;
          width: 100% !important;
        }
        
        .cbFormTable {
          width: 100% !important;
        }
        
        .cbFormTable td {
          display: block !important;
          width: 100% !important;
          padding: 8px !important;
        }
        
        .cbFormLabel {
          font-weight: bold !important;
          margin-bottom: 4px !important;
        }
        
        .cbFormElement input,
        .cbFormElement select,
        .cbFormElement textarea {
          width: 100% !important;
          padding: 10px !important;
          font-size: 16px !important;
          border-radius: 4px !important;
        }
        
        .cbFormButton {
          width: 100% !important;
          padding: 12px !important;
          font-size: 16px !important;
          margin: 8px 0 !important;
        }
        
        /* Hide desktop-only elements */
        .desktop-only {
          display: none !important;
        }
        
        /* Touch-friendly buttons */
        button, .cbFormButton {
          min-height: 44px !important;
          min-width: 44px !important;
        }
        
        /* Responsive tables */
        @media (max-width: 768px) {
          .cbResultSetTable {
            display: block !important;
            overflow-x: auto !important;
            white-space: nowrap !important;
          }
        }
      </style>
    `;
  }

  /**
   * Setup message listener for iframe communication
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      // Verify origin for security
      if (event.origin !== 'https://c2hcf092.caspio.com') {
        return;
      }

      try {
        const message: DataPageMessage = {
          type: event.data.type || 'data',
          payload: event.data.payload || event.data,
          source: event.data.source || 'datapage'
        };

        this.messageSubject.next(message);
      } catch (error) {
        console.error('Error parsing DataPage message:', error);
      }
    });
  }

  /**
   * Get message stream for communication with DataPages
   */
  getMessages(): Observable<DataPageMessage | null> {
    return this.messageSubject.asObservable();
  }

  /**
   * Send message to DataPage iframe
   */
  sendMessageToDataPage(iframe: HTMLIFrameElement, message: any): void {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(message, 'https://c2hcf092.caspio.com');
    }
  }

  /**
   * Add authentication token to DataPage URL
   */
  private addAuthenticationToUrl(url: string): string {
    // This would integrate with your Caspio authentication
    // For now, return the original URL
    return url;
  }

  /**
   * Pre-fill DataPage with data from mobile app
   */
  getPrefilledUrl(dataPage: DataPageConfig, data: { [key: string]: any }): SafeResourceUrl {
    let url = dataPage.url;
    
    // Add prefill parameters
    Object.keys(data).forEach(key => {
      const paramName = `cbParamVirtual1=${key}`;
      const paramValue = encodeURIComponent(data[key]);
      url += (url.includes('?') ? '&' : '?') + `${paramName}&cbParamVirtual2=${paramValue}`;
    });
    
    return this.getSafeUrl({ ...dataPage, url });
  }

  /**
   * Get DataPage configuration by name
   */
  getDataPageConfig(name: string): DataPageConfig | undefined {
    return this.configureDataPages().find(dp => dp.name === name);
  }

  /**
   * Check if DataPage is mobile optimized
   */
  isMobileOptimized(dataPageName: string): boolean {
    const config = this.getDataPageConfig(dataPageName);
    return config?.mobileOptimized || false;
  }

  /**
   * Get JavaScript code for DataPage mobile enhancements
   */
  getMobileEnhancementScript(): string {
    return `
      <script>
        // Mobile touch optimizations
        document.addEventListener('DOMContentLoaded', function() {
          // Add touch-friendly classes
          var inputs = document.querySelectorAll('input, select, textarea, button');
          inputs.forEach(function(input) {
            input.classList.add('touch-friendly');
          });
          
          // Prevent zoom on input focus (iOS)
          var meta = document.createElement('meta');
          meta.name = 'viewport';
          meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
          document.getElementsByTagName('head')[0].appendChild(meta);
          
          // Send resize messages to parent
          window.addEventListener('resize', function() {
            parent.postMessage({
              type: 'resize',
              height: document.body.scrollHeight
            }, '*');
          });
          
          // Send data messages to parent on form submission
          var forms = document.querySelectorAll('form');
          forms.forEach(function(form) {
            form.addEventListener('submit', function(e) {
              parent.postMessage({
                type: 'data',
                payload: { action: 'form_submit', formId: form.id }
              }, '*');
            });
          });
        });
      </script>
    `;
  }
}
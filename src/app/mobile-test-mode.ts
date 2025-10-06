// Mobile Test Mode - Simulates mobile environment in browser
import { Capacitor } from '@capacitor/core';

export class MobileTestMode {
  static enable() {
    
    // Override Capacitor platform detection
    (window as any).Capacitor = {
      ...Capacitor,
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      isPluginAvailable: (name: string) => true,
      platform: 'android'
    };
    
    // Add mobile viewport
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }
    
    // Add mobile user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
      writable: false
    });
    
    // Mock mobile features
    this.mockMobileFeatures();
    
    // Add mobile CSS class
    document.body.classList.add('mobile-test-mode');
    
    // Log API errors for debugging without polluting console
    this.interceptApiCalls();
  }
  
  private static mockMobileFeatures() {
    // Mock file input for mobile
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName: string) {
      const element = originalCreateElement.call(document, tagName);
      
      if (tagName.toLowerCase() === 'input') {
        const input = element as HTMLInputElement;
        if (input.type === 'file') {
          // Mobile file inputs behave differently
          input.setAttribute('capture', 'environment');
          input.setAttribute('accept', 'image/*');
        }
      }
      
      return element;
    };
    
    // Mock mobile storage
    (window as any).MobileStorage = {
      set: (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
      get: (key: string) => {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      },
      remove: (key: string) => localStorage.removeItem(key),
      clear: () => localStorage.clear()
    };
  }
  
  private static interceptApiCalls() {
    const originalFetch = window.fetch;
    
    window.fetch = async function(...args) {
      try {
        const response = await originalFetch.apply(window, args);
        const clonedResponse = response.clone();
        if (!response.ok) {
          const errorBody = await clonedResponse.text();
          console.error('Error Response:', errorBody);
        }
        
        return response;
      } catch (error) {
        console.error('📡 API Error:', error);
        throw error;
      }
    };
  }
  
  static disable() {
    location.reload();
  }
}

// Auto-enable if in development and query param is set
if (window.location.search.includes('mobile-test=true')) {
  MobileTestMode.enable();
}

// Export for manual use
(window as any).MobileTestMode = MobileTestMode;

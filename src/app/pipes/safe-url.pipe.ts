import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

@Pipe({
  name: 'safeUrl',
  standalone: false
})
export class SafeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(url: string): SafeUrl {
    // Log what we're sanitizing
    console.log('🔐 SafeUrlPipe - sanitizing URL:', url?.substring(0, 100));
    
    if (!url) {
      console.warn('⚠️ SafeUrlPipe received empty URL');
      return '';
    }
    
    // Check if it's already a blob URL or data URL
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      console.log('✅ URL is blob/data URL, bypassing sanitization');
      return this.sanitizer.bypassSecurityTrustUrl(url);
    }
    
    // For regular URLs, also bypass sanitization
    console.log('ℹ️ Regular URL, bypassing sanitization');
    return this.sanitizer.bypassSecurityTrustUrl(url);
  }
}
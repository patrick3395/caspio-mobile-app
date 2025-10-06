import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

@Pipe({
  name: 'safeUrl',
  standalone: false
})
export class SafeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(url: string): SafeUrl {
    
    if (!url) {
      console.warn('⚠️ SafeUrlPipe received empty URL');
      return '';
    }
    
    // Check if it's already a blob URL or data URL
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      return this.sanitizer.bypassSecurityTrustUrl(url);
    }
    return this.sanitizer.bypassSecurityTrustUrl(url);
  }
}
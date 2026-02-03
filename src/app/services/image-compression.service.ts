import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root'
})
export class ImageCompressionService {
  
  // [PERFORMANCE] WebP format for smaller files and faster encoding
  // WebP is 25-35% smaller than JPEG with BETTER quality, faster encoding
  // [QUALITY] Medium quality targets: 500KB-1MB, 1280px for better visual quality
  private defaultOptions = {
    maxSizeMB: 0.75,          // WebP: 750KB target for better quality
    maxWidthOrHeight: 1280,   // Higher resolution for reports
    useWebWorker: true,       // Use web worker for better performance
    fileType: 'image/webp',   // WebP: smaller, faster, better than JPEG
    quality: 0.82,            // Higher quality for better visual results
    initialQuality: 0.90
  };

  constructor() {
  }

  /**
   * Compress a single image file
   * @param file - The image file to compress
   * @param customOptions - Optional custom compression options
   * @returns Compressed image as Blob
   */
  async compressImage(file: File | Blob, customOptions?: any): Promise<Blob> {
    const originalSizeKB = (file.size / 1024).toFixed(1);
    const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);

    try {
      // Skip compression for very small files (< 100KB)
      if (file.size < 100000) {
        console.log(`[Compression] Skipping - file already small: ${originalSizeKB} KB`);
        return file;
      }

      const options = { ...this.defaultOptions, ...customOptions };

      // Ensure file is a File object for the library
      let fileToCompress: File;
      if (file instanceof File) {
        fileToCompress = file;
      } else {
        // Convert Blob to File
        fileToCompress = new File([file], 'image.jpg', { type: file.type || 'image/jpeg' });
      }

      const compressedFile = await imageCompression(fileToCompress, options);

      const compressedSizeKB = (compressedFile.size / 1024).toFixed(1);
      const compressionRatio = ((1 - compressedFile.size / file.size) * 100).toFixed(1);

      console.log(`[Compression] ✅ ${originalSizeKB} KB → ${compressedSizeKB} KB (${compressionRatio}% reduction)`);

      // STORAGE FIX: Warn if compression had minimal effect (possible failure or already compressed)
      if (compressedFile.size > file.size * 0.9) {
        console.warn(`[Compression] ⚠️ Minimal reduction - file may already be compressed or format unsupported`);
      }

      return compressedFile;
    } catch (error) {
      console.error('[Compression] ❌ FAILED:', error);
      console.error(`[Compression] ❌ Storing UNCOMPRESSED: ${originalSizeMB} MB`);
      // Still return original to not break the flow
      return file;
    }
  }

  /**
   * Compress multiple images
   * @param files - Array of image files to compress
   * @param customOptions - Optional custom compression options
   * @returns Array of compressed images
   */
  async compressMultipleImages(files: (File | Blob)[], customOptions?: any): Promise<Blob[]> {
    const compressionPromises = files.map(file => this.compressImage(file, customOptions));
    return Promise.all(compressionPromises);
  }

  /**
   * Convert base64 to blob and compress
   * @param base64Data - Base64 string of image
   * @param customOptions - Optional custom compression options
   * @returns Compressed image as Blob
   */
  async compressBase64Image(base64Data: string, customOptions?: any): Promise<Blob> {
    try {
      // Convert base64 to blob
      const response = await fetch(base64Data);
      const blob = await response.blob();
      
      // Compress the blob
      return this.compressImage(blob, customOptions);
    } catch (error) {
      console.error('Error compressing base64 image:', error);
      throw error;
    }
  }

  /**
   * Get compression options for specific use cases
   * [PERFORMANCE] WebP format for all cases - smaller & faster than JPEG
   */
  getOptionsForUseCase(useCase: 'thumbnail' | 'documentation' | 'inspection' | 'profile'): any {
    switch (useCase) {
      case 'thumbnail':
        return {
          maxSizeMB: 0.08,         // 80KB for thumbnails (improved from 50KB)
          maxWidthOrHeight: 512,   // Good for preview
          quality: 0.70,           // Improved quality for thumbnails
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      case 'documentation':
        return {
          maxSizeMB: 0.8,          // 800KB for documentation (improved from 400KB)
          maxWidthOrHeight: 1280,  // High quality
          quality: 0.85,           // Improved quality
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      case 'inspection':
        return {
          maxSizeMB: 0.75,         // 750KB for inspection (improved from 250KB)
          maxWidthOrHeight: 1280,  // Increased from 1024 for better detail
          quality: 0.82,           // Improved quality
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      case 'profile':
        return {
          maxSizeMB: 0.15,         // 150KB for profile (improved from 100KB)
          maxWidthOrHeight: 512,   // Profile size
          quality: 0.80,           // Improved quality
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      default:
        return this.defaultOptions;
    }
  }
}
import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root'
})
export class ImageCompressionService {
  
  // [PERFORMANCE] WebP format for 35% smaller files and faster encoding
  // WebP is 25-35% smaller than JPEG with BETTER quality, faster encoding
  private defaultOptions = {
    maxSizeMB: 0.25,          // WebP: 250KB instead of 400KB JPEG (same visual quality)
    maxWidthOrHeight: 1024,   // Sufficient quality for reports
    useWebWorker: true,       // Use web worker for better performance
    fileType: 'image/webp',   // WebP: smaller, faster, better than JPEG
    quality: 0.75,            // WebP quality 0.75 = JPEG quality 0.85 (better compression)
    initialQuality: 0.85
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
    try {
      // Skip compression for very small files (< 100KB)
      if (file.size < 100000) {
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
      
      const compressionRatio = ((1 - compressedFile.size / file.size) * 100).toFixed(1);
      
      return compressedFile;
    } catch (error) {
      console.error('Error compressing image:', error);
      // Return original file if compression fails
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
          maxSizeMB: 0.05,         // WebP: 50KB (was 80KB JPEG) - 37% smaller
          maxWidthOrHeight: 512,   // Good for preview
          quality: 0.65,           // WebP 0.65 = JPEG 0.75
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      case 'documentation':
        return {
          maxSizeMB: 0.4,          // WebP: 400KB (was 600KB JPEG) - 33% smaller
          maxWidthOrHeight: 1280,  // High quality
          quality: 0.80,           // WebP 0.80 = JPEG 0.90
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      case 'inspection':
        return {
          maxSizeMB: 0.25,         // WebP: 250KB (was 400KB JPEG) - 37% smaller
          maxWidthOrHeight: 1024,  // Sufficient detail
          quality: 0.75,           // WebP 0.75 = JPEG 0.85
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      case 'profile':
        return {
          maxSizeMB: 0.1,          // WebP: 100KB (was 150KB JPEG) - 33% smaller
          maxWidthOrHeight: 512,   // Profile size
          quality: 0.75,           // WebP 0.75 = JPEG 0.85
          fileType: 'image/webp'   // WebP instead of JPEG
        };
      default:
        return this.defaultOptions;
    }
  }
}
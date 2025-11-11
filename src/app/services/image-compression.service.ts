import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root'
})
export class ImageCompressionService {
  
  // [PERFORMANCE] Optimized compression for slow connections (1-2 Mbps)
  // Reduced from 1.5MB/1920px/0.8 to 0.4MB/1024px/0.65 for 3x faster uploads
  private defaultOptions = {
    maxSizeMB: 0.4,           // Reduced from 1.5MB - faster uploads on slow connections
    maxWidthOrHeight: 1024,   // Reduced from 1920px - sufficient quality for reports
    useWebWorker: true,       // Use web worker for better performance
    fileType: 'image/jpeg',   // Convert to JPEG for better compression
    quality: 0.65,            // Reduced from 0.8 - still good quality, much smaller
    initialQuality: 0.85      // Reduced from 0.9
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
   * [PERFORMANCE] All presets optimized for slow connections
   */
  getOptionsForUseCase(useCase: 'thumbnail' | 'documentation' | 'inspection' | 'profile'): any {
    switch (useCase) {
      case 'thumbnail':
        return {
          maxSizeMB: 0.08,         // Reduced from 0.2MB - ~80KB per thumbnail
          maxWidthOrHeight: 512,   // Reduced from 400px - good for preview
          quality: 0.55,           // Reduced from 0.7 - acceptable for thumbnails
          fileType: 'image/jpeg'
        };
      case 'documentation':
        return {
          maxSizeMB: 0.6,          // Reduced from 2MB - faster uploads
          maxWidthOrHeight: 1280,  // Reduced from 2400px - still high quality
          quality: 0.70,           // Reduced from 0.85
          fileType: 'image/jpeg'
        };
      case 'inspection':
        return {
          maxSizeMB: 0.4,          // Reduced from 1.5MB - much faster
          maxWidthOrHeight: 1024,  // Reduced from 1920px - sufficient detail
          quality: 0.65,           // Reduced from 0.8 - good balance
          fileType: 'image/jpeg'
        };
      case 'profile':
        return {
          maxSizeMB: 0.15,         // Reduced from 0.5MB
          maxWidthOrHeight: 512,   // Reduced from 800px
          quality: 0.70,           // Reduced from 0.85
          fileType: 'image/jpeg'
        };
      default:
        return this.defaultOptions;
    }
  }
}
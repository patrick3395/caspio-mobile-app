import { Injectable } from '@angular/core';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root'
})
export class ImageCompressionService {
  
  // Default compression options for mobile upload
  private defaultOptions = {
    maxSizeMB: 1.5,           // Maximum file size in MB (1.5MB is good for cellular)
    maxWidthOrHeight: 1920,   // Maximum width or height (Full HD is enough for inspections)
    useWebWorker: true,       // Use web worker for better performance
    fileType: 'image/jpeg',   // Convert to JPEG for better compression
    quality: 0.8,             // JPEG quality (0.8 is good balance)
    initialQuality: 0.9       // Initial quality before compression
  };

  constructor() {
    console.log('ImageCompressionService initialized');
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
        console.log('File already small, skipping compression:', file.size);
        return file;
      }

      const options = { ...this.defaultOptions, ...customOptions };
      
      console.log(`Compressing image: ${(file as File).name || 'blob'}, Original size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      
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
      console.log(`Compression complete: New size: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB, Reduced by ${compressionRatio}%`);
      
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
   */
  getOptionsForUseCase(useCase: 'thumbnail' | 'documentation' | 'inspection' | 'profile'): any {
    switch (useCase) {
      case 'thumbnail':
        return {
          maxSizeMB: 0.2,
          maxWidthOrHeight: 400,
          quality: 0.7
        };
      case 'documentation':
        return {
          maxSizeMB: 2,
          maxWidthOrHeight: 2400,
          quality: 0.85
        };
      case 'inspection':
        return {
          maxSizeMB: 1.5,
          maxWidthOrHeight: 1920,
          quality: 0.8
        };
      case 'profile':
        return {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 800,
          quality: 0.85
        };
      default:
        return this.defaultOptions;
    }
  }
}
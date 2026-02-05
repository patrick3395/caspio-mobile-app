/**
 * Image Thumbnail Generation Service
 * Creates and caches thumbnail versions of images for faster loading
 */

import { Injectable } from '@angular/core';

export interface ThumbnailConfig {
  width: number;
  height: number;
  quality: number;
  format: 'jpeg' | 'png' | 'webp';
}

export interface ThumbnailResult {
  thumbnail: string;
  originalSize: number;
  thumbnailSize: number;
  compressionRatio: number;
}

@Injectable({
  providedIn: 'root'
})
export class ThumbnailService {
  private thumbnailCache = new Map<string, ThumbnailResult>();
  private readonly DEFAULT_CONFIG: ThumbnailConfig = {
    width: 200,
    height: 200,
    quality: 0.8,
    format: 'jpeg'
  };

  // Cache management settings
  private readonly MAX_CACHE_SIZE = 100;
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private cacheTimestamps = new Map<string, number>();

  /**
   * Generate thumbnail for an image
   */
  async generateThumbnail(
    imageUrl: string, 
    config: Partial<ThumbnailConfig> = {}
  ): Promise<ThumbnailResult> {
    const cacheKey = this.getCacheKey(imageUrl, config);
    
    // Check cache first
    if (this.thumbnailCache.has(cacheKey)) {
      return this.thumbnailCache.get(cacheKey)!;
    }

    
    try {
      const thumbnailConfig = { ...this.DEFAULT_CONFIG, ...config };
      const result = await this.createThumbnail(imageUrl, thumbnailConfig);

      // Cache the result with timestamp
      this.thumbnailCache.set(cacheKey, result);
      this.cacheTimestamps.set(cacheKey, Date.now());

      // Auto-cleanup every 20 entries to prevent unbounded growth
      if (this.thumbnailCache.size % 20 === 0) {
        this.performCacheMaintenance();
      }

      return result;
    } catch (error) {
      console.error('❌ Failed to generate thumbnail:', error);
      throw error;
    }
  }

  /**
   * Generate multiple thumbnails in parallel
   */
  async generateThumbnails(
    imageUrls: string[],
    config: Partial<ThumbnailConfig> = {}
  ): Promise<ThumbnailResult[]> {
    const promises = imageUrls.map(url => this.generateThumbnail(url, config));
    return Promise.all(promises);
  }

  /**
   * Create thumbnail from image URL
   */
  private async createThumbnail(
    imageUrl: string, 
    config: ThumbnailConfig
  ): Promise<ThumbnailResult> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Calculate dimensions maintaining aspect ratio
          const { width, height } = this.calculateDimensions(
            img.width, 
            img.height, 
            config.width, 
            config.height
          );

          canvas.width = width;
          canvas.height = height;

          // Draw image to canvas
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to create thumbnail blob'));
                return;
              }

              const reader = new FileReader();
              reader.onload = () => {
                const thumbnail = reader.result as string;
                const originalSize = this.getImageSize(imageUrl);
                const thumbnailSize = blob.size;
                const compressionRatio = ((originalSize - thumbnailSize) / originalSize) * 100;

                resolve({
                  thumbnail,
                  originalSize,
                  thumbnailSize,
                  compressionRatio
                });
              };
              reader.onerror = () => reject(new Error('Failed to read thumbnail'));
              reader.readAsDataURL(blob);
            },
            `image/${config.format}`,
            config.quality
          );
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });
  }

  /**
   * Calculate thumbnail dimensions maintaining aspect ratio
   */
  private calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    const aspectRatio = originalWidth / originalHeight;
    
    let width = maxWidth;
    let height = maxWidth / aspectRatio;
    
    if (height > maxHeight) {
      height = maxHeight;
      width = maxHeight * aspectRatio;
    }
    
    return { width: Math.round(width), height: Math.round(height) };
  }

  /**
   * Get image size (approximate)
   */
  private getImageSize(imageUrl: string): number {
    // This is a rough estimate - in a real implementation you might
    // want to fetch the image to get the actual size
    return 50000; // Default estimate
  }

  /**
   * Generate cache key for thumbnail
   */
  private getCacheKey(imageUrl: string, config: Partial<ThumbnailConfig>): string {
    const configStr = JSON.stringify(config);
    return `${imageUrl}_${btoa(configStr)}`;
  }

  /**
   * Preload thumbnails for a list of images
   */
  async preloadThumbnails(
    imageUrls: string[],
    config: Partial<ThumbnailConfig> = {}
  ): Promise<void> {
    
    const batchSize = 5; // Process in batches to avoid overwhelming the browser
    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      await this.generateThumbnails(batch, config);
      
      // Small delay between batches
      if (i + batchSize < imageUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
  }

  /**
   * Get thumbnail for image (returns cached or generates new)
   */
  async getThumbnail(
    imageUrl: string,
    config: Partial<ThumbnailConfig> = {}
  ): Promise<string> {
    const result = await this.generateThumbnail(imageUrl, config);
    return result.thumbnail;
  }

  /**
   * Clear thumbnail cache
   */
  clearCache(): void {
    this.thumbnailCache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Prune expired cache entries based on TTL
   * @returns Number of entries pruned
   */
  pruneExpiredCache(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.CACHE_TTL_MS) {
        this.thumbnailCache.delete(key);
        this.cacheTimestamps.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Enforce maximum cache size by removing oldest entries
   * @returns Number of entries removed
   */
  enforceMaxCacheSize(): number {
    if (this.thumbnailCache.size <= this.MAX_CACHE_SIZE) return 0;

    // Sort by timestamp (oldest first)
    const sortedEntries = [...this.cacheTimestamps.entries()]
      .sort((a, b) => a[1] - b[1]);
    const toRemove = sortedEntries.slice(0, this.thumbnailCache.size - this.MAX_CACHE_SIZE);

    for (const [key] of toRemove) {
      this.thumbnailCache.delete(key);
      this.cacheTimestamps.delete(key);
    }
    return toRemove.length;
  }

  /**
   * Perform cache maintenance: prune expired and enforce size limits
   * @returns Object with counts of expired and oversized entries removed
   */
  performCacheMaintenance(): { expired: number; oversized: number } {
    const expired = this.pruneExpiredCache();
    const oversized = this.enforceMaxCacheSize();
    if (expired > 0 || oversized > 0) {
    }
    return { expired, oversized };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.thumbnailCache.size,
      entries: Array.from(this.thumbnailCache.keys())
    };
  }

  /**
   * Generate different thumbnail sizes for responsive images
   */
  async generateResponsiveThumbnails(
    imageUrl: string,
    sizes: number[] = [100, 200, 400, 800]
  ): Promise<{ [size: string]: string }> {
    const thumbnails: { [size: string]: string } = {};

    const promises = sizes.map(async (size) => {
      const result = await this.generateThumbnail(imageUrl, {
        width: size,
        height: size,
        quality: 0.8
      });
      thumbnails[size.toString()] = result.thumbnail;
    });

    await Promise.all(promises);
    return thumbnails;
  }

  /**
   * Generate thumbnail from ArrayBuffer and return as ArrayBuffer for Dexie storage
   * Used by local-first image capture to create persistent thumbnails
   *
   * @param imageData - Original image as ArrayBuffer
   * @param contentType - MIME type of the image (e.g., 'image/jpeg')
   * @returns Thumbnail as ArrayBuffer ready for localBlobs storage
   */
  async generateThumbnailFromArrayBuffer(
    imageData: ArrayBuffer,
    contentType: string = 'image/jpeg'
  ): Promise<{ data: ArrayBuffer; sizeBytes: number; contentType: string }> {
    return new Promise((resolve, reject) => {
      // Create blob from ArrayBuffer
      const blob = new Blob([imageData], { type: contentType });
      const imageUrl = URL.createObjectURL(blob);

      const img = new Image();

      img.onload = () => {
        try {
          // Revoke the object URL to free memory
          URL.revokeObjectURL(imageUrl);

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Calculate dimensions maintaining aspect ratio (200px max)
          const { width, height } = this.calculateDimensions(
            img.width,
            img.height,
            this.DEFAULT_CONFIG.width,  // 200
            this.DEFAULT_CONFIG.height  // 200
          );

          canvas.width = width;
          canvas.height = height;

          // Draw image to canvas
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob (JPEG for smaller size)
          canvas.toBlob(
            async (thumbnailBlob) => {
              if (!thumbnailBlob) {
                reject(new Error('Failed to create thumbnail blob'));
                return;
              }

              try {
                // Convert blob to ArrayBuffer for Dexie storage
                const arrayBuffer = await thumbnailBlob.arrayBuffer();


                resolve({
                  data: arrayBuffer,
                  sizeBytes: thumbnailBlob.size,
                  contentType: 'image/jpeg'
                });
              } catch (error) {
                reject(error);
              }
            },
            'image/jpeg',
            this.DEFAULT_CONFIG.quality  // 0.8
          );
        } catch (error) {
          URL.revokeObjectURL(imageUrl);
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('Failed to load image for thumbnail generation'));
      };

      img.src = imageUrl;
    });
  }
}

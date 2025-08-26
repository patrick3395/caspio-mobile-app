import { Injectable } from '@angular/core';
import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
import { Platform } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class CameraService {

  constructor(private platform: Platform) { }

  async takePicture(): Promise<Photo | null> {
    try {
      // Request camera permissions
      const permissions = await Camera.requestPermissions();
      
      if (permissions.camera === 'denied' || permissions.photos === 'denied') {
        console.error('Camera permissions denied');
        return null;
      }

      // Take a photo
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl, // Returns base64 data URL
        source: CameraSource.Camera,
        saveToGallery: false, // Don't save to gallery for privacy
        promptLabelHeader: '',
        promptLabelPhoto: 'Use Photo',
        promptLabelPicture: 'Take Photo'
      });

      return image;
    } catch (error) {
      console.error('Error taking picture:', error);
      return null;
    }
  }

  async selectFromGallery(): Promise<Photo | null> {
    try {
      // Request permissions
      const permissions = await Camera.requestPermissions();
      
      if (permissions.photos === 'denied') {
        console.error('Photo library permissions denied');
        return null;
      }

      // Select from gallery
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos
      });

      return image;
    } catch (error) {
      console.error('Error selecting from gallery:', error);
      return null;
    }
  }

  // Convert base64 to File object for upload
  base64ToFile(base64Data: string, fileName: string): File {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    
    // Convert base64 to blob
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    
    // Convert blob to File
    return new File([blob], fileName, { type: 'image/jpeg' });
  }

  // Check if running on mobile device
  isMobile(): boolean {
    return this.platform.is('ios') || this.platform.is('android');
  }
}
import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { environment } from '../../environments/environment';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';

/**
 * Form Autosave Service (Web Only)
 * Automatically saves form progress to localStorage to prevent data loss
 * G2-FORMS-002
 */

export interface AutosaveConfig {
  formId: string;           // Unique identifier for this form (e.g., 'new-project', 'hud-template-123')
  debounceMs?: number;      // Debounce time in ms (default: 2000)
  excludeFields?: string[]; // Fields to exclude from autosave (e.g., passwords)
}

export interface SavedFormData {
  formId: string;
  data: Record<string, any>;
  savedAt: number;          // Timestamp
  version: number;          // For potential migration
}

const STORAGE_PREFIX = 'formAutosave_';
const CURRENT_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable({
  providedIn: 'root'
})
export class FormAutosaveService {

  private saveSubjects: Map<string, Subject<Record<string, any>>> = new Map();
  private destroySubjects: Map<string, Subject<void>> = new Map();

  // Only enable on web platform
  private get isWeb(): boolean {
    return environment.isWeb;
  }

  constructor(private alertController: AlertController) {}

  /**
   * Initialize autosave for a form
   * Returns restored data if available, or null
   */
  async initAutosave(
    config: AutosaveConfig,
    onSave?: (data: Record<string, any>) => void
  ): Promise<Record<string, any> | null> {
    if (!this.isWeb) {
      return null;
    }

    const { formId, debounceMs = 2000 } = config;

    // Clean up any existing subscription for this form
    this.destroyAutosave(formId);

    // Create new subjects for this form
    const saveSubject = new Subject<Record<string, any>>();
    const destroySubject = new Subject<void>();

    this.saveSubjects.set(formId, saveSubject);
    this.destroySubjects.set(formId, destroySubject);

    // Set up debounced save
    saveSubject.pipe(
      debounceTime(debounceMs),
      takeUntil(destroySubject)
    ).subscribe(data => {
      this.saveToStorage(formId, data, config.excludeFields);
      if (onSave) {
        onSave(data);
      }
    });

    // Check for saved data
    const savedData = this.getSavedData(formId);
    if (savedData) {
      // Prompt user to restore
      const shouldRestore = await this.promptRestore(savedData);
      if (shouldRestore) {
        return savedData.data;
      } else {
        // User declined, clear saved data
        this.clearSavedData(formId);
      }
    }

    return null;
  }

  /**
   * Trigger an autosave (will be debounced)
   */
  triggerSave(formId: string, data: Record<string, any>): void {
    if (!this.isWeb) return;

    const saveSubject = this.saveSubjects.get(formId);
    if (saveSubject) {
      saveSubject.next(data);
    }
  }

  /**
   * Force an immediate save (bypasses debounce)
   */
  saveNow(formId: string, data: Record<string, any>, excludeFields?: string[]): void {
    if (!this.isWeb) return;
    this.saveToStorage(formId, data, excludeFields);
  }

  /**
   * Clear saved data for a form (call on successful submit)
   */
  clearSavedData(formId: string): void {
    if (!this.isWeb) return;

    const key = STORAGE_PREFIX + formId;
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Failed to clear autosave data:', e);
    }
  }

  /**
   * Clean up autosave for a form (call in ngOnDestroy)
   */
  destroyAutosave(formId: string): void {
    const destroySubject = this.destroySubjects.get(formId);
    if (destroySubject) {
      destroySubject.next();
      destroySubject.complete();
      this.destroySubjects.delete(formId);
    }

    const saveSubject = this.saveSubjects.get(formId);
    if (saveSubject) {
      saveSubject.complete();
      this.saveSubjects.delete(formId);
    }
  }

  /**
   * Check if there's saved data for a form
   */
  hasSavedData(formId: string): boolean {
    if (!this.isWeb) return false;
    return this.getSavedData(formId) !== null;
  }

  /**
   * Get saved data without prompting
   */
  getSavedDataDirect(formId: string): Record<string, any> | null {
    if (!this.isWeb) return null;
    const saved = this.getSavedData(formId);
    return saved?.data || null;
  }

  /**
   * Clean up old autosave data (older than MAX_AGE_MS)
   */
  cleanupOldData(): void {
    if (!this.isWeb) return;

    try {
      const now = Date.now();
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const saved: SavedFormData = JSON.parse(raw);
              if (now - saved.savedAt > MAX_AGE_MS) {
                keysToRemove.push(key);
              }
            }
          } catch {
            // Invalid data, remove it
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      console.error('Failed to cleanup old autosave data:', e);
    }
  }

  // Private methods

  private saveToStorage(
    formId: string,
    data: Record<string, any>,
    excludeFields?: string[]
  ): void {
    try {
      // Filter out excluded fields
      let dataToSave = { ...data };
      if (excludeFields?.length) {
        for (const field of excludeFields) {
          delete dataToSave[field];
        }
      }

      const saved: SavedFormData = {
        formId,
        data: dataToSave,
        savedAt: Date.now(),
        version: CURRENT_VERSION
      };

      const key = STORAGE_PREFIX + formId;
      localStorage.setItem(key, JSON.stringify(saved));
    } catch (e) {
      console.error('Failed to save form data:', e);
    }
  }

  private getSavedData(formId: string): SavedFormData | null {
    try {
      const key = STORAGE_PREFIX + formId;
      const raw = localStorage.getItem(key);
      if (!raw) return null;

      const saved: SavedFormData = JSON.parse(raw);

      // Check if data is too old
      if (Date.now() - saved.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key);
        return null;
      }

      return saved;
    } catch (e) {
      console.error('Failed to read saved form data:', e);
      return null;
    }
  }

  private async promptRestore(saved: SavedFormData): Promise<boolean> {
    const savedDate = new Date(saved.savedAt);
    const timeAgo = this.formatTimeAgo(savedDate);

    const alert = await this.alertController.create({
      header: 'Restore Form Data?',
      message: `You have unsaved form data from ${timeAgo}. Would you like to restore it?`,
      buttons: [
        {
          text: 'Discard',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Restore',
          role: 'confirm',
          cssClass: 'primary'
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString();
  }
}

import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { ScreenReaderAnnouncementService } from './screen-reader-announcement.service';

/**
 * Form Validation Service (Web Only)
 * Provides real-time form validation with inline error messages
 * G2-FORMS-001
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface FieldValidationState {
  touched: boolean;
  dirty: boolean;
  valid: boolean;
  error: string | null;
}

export interface ValidationRules {
  required?: boolean;
  email?: boolean;
  phone?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  zipCode?: boolean;
  custom?: (value: any) => string | null;
}

@Injectable({
  providedIn: 'root'
})
export class FormValidationService {

  // Only enable on web platform
  private get isWeb(): boolean {
    return environment.isWeb;
  }

  constructor(private screenReaderAnnouncement: ScreenReaderAnnouncementService) {}

  /**
   * Validates a single field value against rules
   * Returns error message or null if valid
   */
  validateField(value: any, rules: ValidationRules): string | null {
    if (!this.isWeb) {
      return null; // Skip validation on mobile
    }

    const strValue = value != null ? String(value).trim() : '';

    // Required validation
    if (rules.required && !strValue) {
      return 'This field is required';
    }

    // Skip other validations if empty and not required
    if (!strValue) {
      return null;
    }

    // Email validation
    if (rules.email && strValue) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(strValue)) {
        return 'Please enter a valid email address';
      }
    }

    // Phone validation
    if (rules.phone && strValue) {
      // Allow various phone formats: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxxxxxxxxx, etc.
      const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
      const cleanPhone = strValue.replace(/[\s\-\(\)\.]/g, '');
      if (cleanPhone.length < 10 || !phoneRegex.test(strValue.replace(/[\s]/g, ''))) {
        return 'Please enter a valid phone number';
      }
    }

    // Zip code validation (US 5-digit)
    if (rules.zipCode && strValue) {
      const zipRegex = /^[0-9]{5}(-[0-9]{4})?$/;
      if (!zipRegex.test(strValue)) {
        return 'Please enter a valid 5-digit zip code';
      }
    }

    // Min length validation
    if (rules.minLength && strValue.length < rules.minLength) {
      return `Must be at least ${rules.minLength} characters`;
    }

    // Max length validation
    if (rules.maxLength && strValue.length > rules.maxLength) {
      return `Must be no more than ${rules.maxLength} characters`;
    }

    // Pattern validation
    if (rules.pattern && !rules.pattern.test(strValue)) {
      return 'Please enter a valid value';
    }

    // Custom validation
    if (rules.custom) {
      const customError = rules.custom(value);
      if (customError) {
        return customError;
      }
    }

    return null;
  }

  /**
   * Validates email format
   */
  isValidEmail(email: string): boolean {
    if (!email) return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Validates phone format
   */
  isValidPhone(phone: string): boolean {
    if (!phone) return false;
    const cleanPhone = phone.replace(/[\s\-\(\)\.]/g, '');
    return cleanPhone.length >= 10 && /^[\d\+]+$/.test(cleanPhone);
  }

  /**
   * Validates zip code format (US)
   */
  isValidZipCode(zip: string): boolean {
    if (!zip) return false;
    const zipRegex = /^[0-9]{5}(-[0-9]{4})?$/;
    return zipRegex.test(zip.trim());
  }

  /**
   * Checks if a value is empty/null/undefined
   */
  isEmpty(value: any): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '' || value === '-- Select --';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  /**
   * Creates a validation state tracker for a form
   */
  createFormState(fields: string[]): Record<string, FieldValidationState> {
    const state: Record<string, FieldValidationState> = {};
    for (const field of fields) {
      state[field] = {
        touched: false,
        dirty: false,
        valid: true,
        error: null
      };
    }
    return state;
  }

  /**
   * Marks a field as touched (on blur)
   */
  markTouched(state: Record<string, FieldValidationState>, field: string): void {
    if (state[field]) {
      state[field].touched = true;
    }
  }

  /**
   * Marks a field as dirty (on input/change)
   */
  markDirty(state: Record<string, FieldValidationState>, field: string): void {
    if (state[field]) {
      state[field].dirty = true;
    }
  }

  /**
   * Updates field validation state
   */
  updateFieldState(
    state: Record<string, FieldValidationState>,
    field: string,
    value: any,
    rules: ValidationRules
  ): void {
    if (!state[field]) return;

    const error = this.validateField(value, rules);
    state[field].valid = error === null;
    state[field].error = error;
  }

  /**
   * Checks if form has any validation errors
   */
  hasErrors(state: Record<string, FieldValidationState>): boolean {
    return Object.values(state).some(s => !s.valid);
  }

  /**
   * Checks if a field should show its error
   * Shows error if field is touched and has error
   */
  shouldShowError(state: Record<string, FieldValidationState>, field: string): boolean {
    if (!this.isWeb) return false;
    const fieldState = state[field];
    return fieldState ? fieldState.touched && !fieldState.valid : false;
  }

  /**
   * Gets the error message for a field
   */
  getError(state: Record<string, FieldValidationState>, field: string): string | null {
    if (!this.isWeb) return null;
    const fieldState = state[field];
    return fieldState?.error || null;
  }

  /**
   * Validates all fields and marks them as touched
   * Returns true if all valid
   */
  validateAll(
    state: Record<string, FieldValidationState>,
    values: Record<string, any>,
    rules: Record<string, ValidationRules>
  ): boolean {
    if (!this.isWeb) return true;

    let allValid = true;
    const errors: string[] = [];

    for (const field of Object.keys(rules)) {
      this.markTouched(state, field);
      this.updateFieldState(state, field, values[field], rules[field]);
      if (!state[field]?.valid) {
        allValid = false;
        if (state[field]?.error) {
          errors.push(state[field].error!);
        }
      }
    }

    // G2-A11Y-003: Announce form errors to screen readers (web only)
    if (!allValid && errors.length > 0) {
      this.screenReaderAnnouncement.announceFormErrors(errors);
    }

    return allValid;
  }

  /**
   * Validates all fields and announces errors to screen readers (web only)
   * Use this when submitting a form to provide immediate feedback
   */
  validateAllWithAnnouncement(
    state: Record<string, FieldValidationState>,
    values: Record<string, any>,
    rules: Record<string, ValidationRules>
  ): { valid: boolean; errors: string[] } {
    if (!this.isWeb) return { valid: true, errors: [] };

    const errors: string[] = [];
    let allValid = true;

    for (const field of Object.keys(rules)) {
      this.markTouched(state, field);
      this.updateFieldState(state, field, values[field], rules[field]);
      if (!state[field]?.valid) {
        allValid = false;
        if (state[field]?.error) {
          errors.push(state[field].error!);
        }
      }
    }

    // G2-A11Y-003: Announce form errors to screen readers
    if (!allValid && errors.length > 0) {
      this.screenReaderAnnouncement.announceFormErrors(errors);
    }

    return { valid: allValid, errors };
  }
}

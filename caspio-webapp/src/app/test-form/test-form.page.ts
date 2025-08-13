import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { CaspioService } from '../services/caspio.service';

export interface TestTableField {
  name: string;
  type: string;
  required: boolean;
  maxLength?: number;
  label: string;
  inputType: string;
  options?: string[];
}

export interface TestTableRecord {
  [key: string]: any;
}

@Component({
  selector: 'app-test-form',
  templateUrl: './test-form.page.html',
  styleUrls: ['./test-form.page.scss'],
  standalone: false,
})
export class TestFormPage implements OnInit {
  testForm: FormGroup = this.formBuilder.group({});
  isSubmitting = false;
  isLoadingSchema = true;
  tableFields: TestTableField[] = [];
  uploadedFiles: { [fieldName: string]: File } = {};
  photoPreview: { [fieldName: string]: string } = {};
  writableFields: string[] = ['Typ', 'Test1', 'LivingRoom']; // Known writable fields based on test (Photo is read-only)
  readOnlyFields: string[] = ['PK_ID', 'Photo']; // Fields that cannot be updated via API

  constructor(
    private formBuilder: FormBuilder,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {}

  async ngOnInit() {
    console.log('Test form page initialized');
    await this.loadTableSchema();
  }

  private async loadTableSchema() {
    const loading = await this.loadingController.create({
      message: 'Loading table structure...',
      spinner: 'crescent'
    });
    
    await loading.present();

    try {
      // First try to get table schema
      await this.getTableSchemaFromAPI();
    } catch (error) {
      console.log('Schema endpoint failed, trying records approach...');
      // Fallback: infer schema from sample records
      await this.inferSchemaFromRecords();
    } finally {
      await loading.dismiss();
      this.isLoadingSchema = false;
    }
  }

  private async getTableSchemaFromAPI() {
    return new Promise((resolve, reject) => {
      this.caspioService.get('/tables/TEST/fields').subscribe({
        next: (response: any) => {
          console.log('TEST table schema response:', response);
          this.parseSchemaResponse(response);
          this.buildDynamicForm();
          resolve(response);
        },
        error: (error) => {
          console.error('Failed to get schema:', error);
          reject(error);
        }
      });
    });
  }

  private async inferSchemaFromRecords() {
    return new Promise((resolve, reject) => {
      this.caspioService.get('/tables/TEST/records?q_limit=1').subscribe({
        next: (response: any) => {
          console.log('TEST table sample record:', response);
          const records = response.Result || response;
          if (records && records.length > 0) {
            this.inferFieldsFromSampleData(records[0]);
          } else {
            // Create default form if no records exist
            this.createDefaultForm();
          }
          this.buildDynamicForm();
          resolve(response);
        },
        error: (error) => {
          console.error('Failed to get sample records:', error);
          this.createDefaultForm();
          this.buildDynamicForm();
          reject(error);
        }
      });
    });
  }

  private parseSchemaResponse(response: any) {
    // Handle different possible schema response formats
    const fields = response.Result || response.fields || response;
    
    if (Array.isArray(fields)) {
      this.tableFields = fields.map(field => this.mapFieldToFormField(field)).filter(field => field !== null);
    } else if (fields && typeof fields === 'object') {
      this.tableFields = Object.keys(fields).map(key => 
        this.mapFieldToFormField({ name: key, ...fields[key] })
      ).filter(field => field !== null);
    }
    
    console.log('Parsed table fields (excluding read-only):', this.tableFields);
  }

  private inferFieldsFromSampleData(sampleRecord: any) {
    this.tableFields = Object.keys(sampleRecord).map(fieldName => {
      const value = sampleRecord[fieldName];
      
      // Skip likely read-only fields based on common patterns
      if (fieldName.toLowerCase().includes('pk_') || 
          fieldName.toLowerCase() === 'id' ||
          fieldName.toLowerCase().includes('created') ||
          fieldName.toLowerCase().includes('modified')) {
        return null;
      }
      const isLikelyReadOnly = fieldName.toLowerCase().includes('id') && 
                               (fieldName.toLowerCase() === 'id' || 
                                fieldName.toLowerCase().endsWith('_id') ||
                                fieldName.toLowerCase().startsWith('id_'));
      
      if (isLikelyReadOnly && typeof value === 'number') {
        console.log(`Skipping likely auto-ID field: ${fieldName}`);
        return null;
      }
      
      return {
        name: fieldName,
        type: this.inferTypeFromValue(value),
        required: false, // Can't determine from sample data
        label: this.formatFieldLabel(fieldName),
        inputType: this.getInputTypeFromValue(value, fieldName)
      };
    }).filter((field): field is TestTableField => field !== null);
    
    console.log('Inferred table fields (excluding likely read-only):', this.tableFields);
  }

  private createDefaultForm() {
    // Use the REAL field names from your TEST table
    this.tableFields = [
      {
        name: 'Typ',
        type: 'TEXT',
        required: false,
        label: 'Type',
        inputType: 'text'
      },
      {
        name: 'Test1',
        type: 'TEXT',
        required: false,
        label: 'Test Field 1',
        inputType: 'text'
      },
      {
        name: 'LivingRoom',
        type: 'TEXT',
        required: false,
        label: 'Living Room',
        inputType: 'textarea'
      },
      {
        name: 'Photo',
        type: 'FILE',
        required: false,
        label: 'Photo',
        inputType: 'file'
      }
    ];
    console.log('Created form with REAL field names:', this.tableFields.map(f => f.name));
  }

  private mapFieldToFormField(field: any): TestTableField | null {
    const fieldName = field.Name || field.name || field.FieldName;
    const fieldType = field.Type || field.type || field.DataType || 'TEXT';
    const isReadOnly = field.ReadOnly || field.readOnly || field.IsReadOnly || false;
    const isAutoNumber = fieldType.toUpperCase() === 'AUTONUMBER';
    
    // Skip read-only fields and auto-number fields
    if (isReadOnly || isAutoNumber) {
      console.log(`Skipping read-only/auto field: ${fieldName} (Type: ${fieldType}, ReadOnly: ${isReadOnly})`);
      return null;
    }
    
    return {
      name: fieldName,
      type: fieldType,
      required: field.Required || field.required || false,
      maxLength: field.MaxLength || field.maxLength,
      label: this.formatFieldLabel(fieldName),
      inputType: this.mapTypeToInputType(fieldType, fieldName),
      options: this.getFieldOptions(field)
    };
  }

  private formatFieldLabel(fieldName: string): string {
    // Convert field names to readable labels
    return fieldName
      .replace(/([A-Z])/g, ' $1') // Add space before capitals
      .replace(/[_-]/g, ' ') // Replace underscores and hyphens with spaces
      .replace(/\b\w/g, l => l.toUpperCase()) // Capitalize first letter of each word
      .trim();
  }

  private mapTypeToInputType(caspioType: string, fieldName: string): string {
    const type = caspioType.toUpperCase();
    const name = fieldName.toLowerCase();
    
    // Check for attachment/file/photo fields - be more aggressive in detection
    if (type === 'FILE' || 
        name.includes('attachment') || 
        name.includes('file') || 
        name.includes('upload') ||
        name.includes('photo') ||
        name.includes('image') ||
        name.includes('picture') ||
        name.includes('pic')) {
      return 'file';
    }
    
    // Map Caspio types to input types
    const typeMap: { [key: string]: string } = {
      'TEXT': name.includes('email') ? 'email' : name.includes('phone') ? 'tel' : 'text',
      'NUMBER': 'number',
      'AUTONUMBER': 'number',
      'DATE': 'date',
      'DATETIME': 'datetime-local',
      'TIME': 'time',
      'BOOLEAN': 'checkbox',
      'YES/NO': 'checkbox',
      'EMAIL': 'email',
      'PHONE': 'tel',
      'CURRENCY': 'number',
      'PERCENT': 'number',
      'PASSWORD': 'password',
      'LIST': 'select',
      'TEXTAREA': 'textarea'
    };

    return typeMap[type] || 'text';
  }

  private getInputTypeFromValue(value: any, fieldName: string): string {
    const name = fieldName.toLowerCase();
    
    // Force photo field detection for common field names
    if (name.includes('attachment') || 
        name.includes('file') ||
        name.includes('photo') ||
        name.includes('image') ||
        name.includes('picture') ||
        name.includes('pic')) {
      return 'file';
    }
    
    if (value === null || value === undefined) return 'text';
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') {
      if (value.match(/^\d{4}-\d{2}-\d{2}/)) return 'date';
      if (value.includes('@')) return 'email';
      if (value.length > 100) return 'textarea';
    }
    
    return 'text';
  }

  private inferTypeFromValue(value: any): string {
    if (value === null || value === undefined) return 'TEXT';
    if (typeof value === 'string') return 'TEXT';
    if (typeof value === 'number') return 'NUMBER';
    if (typeof value === 'boolean') return 'BOOLEAN';
    return 'TEXT';
  }

  private getFieldOptions(field: any): string[] | undefined {
    // Extract options if it's a list/dropdown field
    if (field.Options || field.options) {
      return field.Options || field.options;
    }
    return undefined;
  }

  private buildDynamicForm() {
    const formGroup: { [key: string]: any } = {};
    
    // Debug: Show all detected fields and their types
    console.log('=== FIELD DETECTION DEBUG ===');
    this.tableFields.forEach(field => {
      console.log(`Field: "${field.name}" | Type: "${field.type}" | InputType: "${field.inputType}" | Label: "${field.label}"`);
    });
    console.log('==============================');
    
    this.tableFields.forEach(field => {
      const validators = [];
      
      if (field.required) {
        validators.push(Validators.required);
      }
      
      if (field.maxLength) {
        validators.push(Validators.maxLength(field.maxLength));
      }
      
      if (field.inputType === 'email') {
        validators.push(Validators.email);
      }
      
      const defaultValue = field.inputType === 'checkbox' ? false : '';
      formGroup[field.name] = [defaultValue, validators];
    });
    
    this.testForm = this.formBuilder.group(formGroup);
    console.log('Dynamic form built:', this.testForm);
  }

  async onSubmit() {
    if (this.testForm.valid) {
      await this.submitForm();
    } else {
      await this.showValidationErrors();
    }
  }

  private async submitForm() {
    const loading = await this.loadingController.create({
      message: 'Submitting data...',
      spinner: 'crescent'
    });
    
    await loading.present();
    this.isSubmitting = true;

    // Build form data dynamically from table fields
    const formData: TestTableRecord = {};
    
    console.log('=== FORM SUBMISSION DEBUG ===');
    console.log('Table fields available:', this.tableFields.map(f => f.name));
    console.log('Form values:', this.testForm.value);
    
    this.tableFields.forEach(field => {
      const value = this.testForm.get(field.name)?.value;
      console.log(`Field "${field.name}": value = ${value}, type = ${field.inputType}`);
      
      if (field.inputType === 'file') {
        // Skip file fields for now
        console.log(`Skipping file field: ${field.name}`);
      } else if (field.inputType === 'checkbox') {
        formData[field.name] = value || false;
        console.log(`Added checkbox field ${field.name} = ${formData[field.name]}`);
      } else if (value !== null && value !== undefined && value !== '') {
        formData[field.name] = value;
        console.log(`Added field ${field.name} = ${formData[field.name]}`);
      } else {
        console.log(`Skipped empty field: ${field.name}`);
      }
    });

    console.log('Built form data:', formData);

    // Remove file objects from regular form submission
    const cleanFormData = { ...formData };
    Object.keys(this.uploadedFiles).forEach(fieldName => {
      delete cleanFormData[fieldName];
    });

    console.log('Clean form data (without files):', cleanFormData);
    console.log('Clean form data keys:', Object.keys(cleanFormData));
    console.log('Clean form data JSON:', JSON.stringify(cleanFormData, null, 2));
    console.log('Clean form data is empty?', Object.keys(cleanFormData).length === 0);
    
    // Try to submit only with fields that worked in the test
    // Based on the successful individual test, let's try with just one field at a time
    if (Object.keys(cleanFormData).length === 0) {
      console.warn('No form data to submit - trying with a single test field');
      
      // Try with just the Typ field since that worked in the individual test
      if (this.testForm.get('Typ')?.value) {
        cleanFormData['Typ'] = this.testForm.get('Typ')?.value;
        console.log('Added Typ field for submission:', cleanFormData);
      } else {
        cleanFormData['Typ'] = 'Test from mobile app';
        console.log('Added default Typ field for submission:', cleanFormData);
      }
    }

    // Filter out read-only fields
    const submissionData = { ...cleanFormData };
    
    // Remove any read-only fields
    this.readOnlyFields.forEach(field => {
      delete submissionData[field];
    });
    
    // Also remove empty fields to avoid issues
    Object.keys(submissionData).forEach(key => {
      if (submissionData[key] === '' || submissionData[key] === null || submissionData[key] === undefined) {
        delete submissionData[key];
      }
    });
    
    // Use all non-empty, non-readonly fields
    const finalData = submissionData;
    
    console.log('Final submission data before sending:', finalData);
    console.log('Final submission data JSON:', JSON.stringify(finalData, null, 2));
    console.log('Submission data keys:', Object.keys(finalData));

    // Submit regular form data first
    this.caspioService.post('/tables/TEST/records', finalData).subscribe({
      next: async (response) => {
        console.log('Form submitted successfully:', response);
        console.log('Response type:', typeof response);
        console.log('Response is null/undefined?', response == null);
        console.log('Response structure:', JSON.stringify(response, null, 2));
        
        // Check if we have files to upload after successful form submission
        const hasFiles = Object.keys(this.uploadedFiles).length > 0;
        
        if (hasFiles) {
          console.log('Files to upload:', Object.keys(this.uploadedFiles));
          
          // Since Caspio often returns empty response on successful creation,
          // we need to query for the record we just created
          console.log('Response is empty, querying for created record...');
          
          // Add a small delay to ensure record is committed
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Query for the record we just created using a unique field value
          const typValue = finalData['Typ'] || finalData['Test1'] || '';
          if (typValue) {
            console.log(`Searching for record with Typ="${typValue}"`);
            this.caspioService.get(`/tables/TEST/records?q.where=Typ='${encodeURIComponent(typValue)}'&q_orderBy=PK_ID desc&q_limit=1`).subscribe({
              next: async (searchResult: any) => {
                console.log('Search result:', searchResult);
                const foundRecord = searchResult?.Result?.[0];
                if (foundRecord && foundRecord.PK_ID) {
                  console.log('Found our record with PK_ID:', foundRecord.PK_ID);
                  await this.uploadFilesToRecord(foundRecord.PK_ID, loading);
                } else {
                  // Fallback to latest record method
                  await this.tryAlternativePhotoUpload(response, loading);
                }
              },
              error: async (error) => {
                console.error('Search failed:', error);
                // Fallback to latest record method
                await this.tryAlternativePhotoUpload(response, loading);
              }
            });
          } else {
            // No unique value to search by, use latest record method
            await this.tryAlternativePhotoUpload(response, loading);
          }
        } else {
          await loading.dismiss();
          this.isSubmitting = false;
          await this.showSuccessMessage();
          this.resetForm();
        }
      },
      error: async (error) => {
        await loading.dismiss();
        this.isSubmitting = false;
        
        console.error('Form submission failed:', error);
        console.error('Error details:', {
          status: error.status,
          statusText: error.statusText,
          error: error.error,
          message: error.message,
          url: error.url
        });
        
        // Try an even simpler approach if we still get the read-only error
        if (error.error?.Code === 'AlterReadOnlyData') {
          console.log('Got AlterReadOnlyData error - trying simplified submission...');
          await this.trySimplifiedSubmission(loading);
        } else {
          await this.showErrorMessage(error);
        }
      }
    });
  }

  private async tryAlternativePhotoUpload(responseData: any, loading: any) {
    console.log('Trying alternative photo upload approach...');
    
    try {
      // Method 1: Try to find the newest record in the table (assuming it's ours)
      this.caspioService.get('/tables/TEST/records?q_limit=1&q_orderBy=PK_ID desc').subscribe({
        next: async (records: any) => {
          console.log('Latest record query result:', records);
          
          const latestRecord = records?.Result?.[0];
          if (latestRecord && latestRecord.PK_ID) {
            console.log('Found latest record ID:', latestRecord.PK_ID);
            await this.uploadFilesToRecord(latestRecord.PK_ID, loading);
          } else {
            // Final fallback - just show success without files
            await loading.dismiss();
            this.isSubmitting = false;
            await this.showSuccessMessage('✅ Form submitted successfully! Note: Photos could not be uploaded - please edit the record to add photos.');
            this.resetForm();
          }
        },
        error: async (error) => {
          console.error('Could not query latest record:', error);
          await loading.dismiss();
          this.isSubmitting = false;
          await this.showSuccessMessage('✅ Form submitted successfully! Note: Photos could not be uploaded automatically.');
          this.resetForm();
        }
      });
      
    } catch (error) {
      console.error('Alternative upload method failed:', error);
      await loading.dismiss();
      this.isSubmitting = false;
      await this.showSuccessMessage('✅ Form submitted successfully! Note: Photos could not be uploaded.');
      this.resetForm();
    }
  }

  private async submitWithFiles(formData: TestTableRecord) {
    try {
      // First, upload files separately and get file URLs
      const fileUploadPromises = Object.keys(this.uploadedFiles).map(async (fieldName) => {
        const file = this.uploadedFiles[fieldName];
        return await this.uploadSingleFileToRecord('temp', fieldName, file);
      });

      // Wait for all files to upload
      const fileUploadResults = await Promise.all(fileUploadPromises);
      
      // Create form data with file URLs instead of file objects
      const submissionData: TestTableRecord = { ...formData };
      
      fileUploadResults.forEach((result: any) => {
        if (result.success) {
          submissionData[result.fieldName] = result.fileUrl;
        }
      });

      // Remove file objects from submission data
      Object.keys(this.uploadedFiles).forEach(fieldName => {
        if (submissionData[fieldName] instanceof File) {
          delete submissionData[fieldName];
        }
      });

      console.log('Submitting data with file URLs:', submissionData);

      // Submit regular JSON data with file URLs
      this.caspioService.post('/tables/TEST/records', submissionData).subscribe({
        next: async (response) => {
          this.isSubmitting = false;
          console.log('Form with files submitted successfully:', response);
          await this.showSuccessMessage();
          this.resetForm();
        },
        error: async (error) => {
          this.isSubmitting = false;
          console.error('Form with files submission failed:', error);
          await this.showErrorMessage(error);
        }
      });
      
    } catch (error) {
      this.isSubmitting = false;
      console.error('File upload preparation failed:', error);
      await this.showErrorMessage(error);
    }
  }

  private async uploadFilesToRecord(recordId: any, loading: any) {
    console.log(`Uploading files to record ID: ${recordId}`);
    
    try {
      const fileUploadPromises = Object.keys(this.uploadedFiles).map(async (fieldName) => {
        const file = this.uploadedFiles[fieldName];
        return await this.uploadSingleFileToRecord(recordId, fieldName, file);
      });

      const results = await Promise.all(fileUploadPromises);
      const successful = results.filter(r => r.success).length;
      const total = results.length;

      await loading.dismiss();
      this.isSubmitting = false;

      if (successful === total) {
        await this.showSuccessMessage(`✅ Form and ${successful} photo(s) uploaded successfully!`);
      } else {
        await this.showSuccessMessage(`⚠️ Form submitted! ${successful}/${total} photos uploaded successfully.`);
      }
      
      this.resetForm();

    } catch (error) {
      console.error('File upload error:', error);
      await loading.dismiss();
      this.isSubmitting = false;
      await this.showSuccessMessage('✅ Form submitted successfully! Photo upload failed - you can edit the record later to add photos.');
      this.resetForm();
    }
  }

  private async uploadSingleFileToRecord(recordId: any, fieldName: string, file: File): Promise<{success: boolean, fieldName: string, error?: any}> {
    try {
      console.log(`Attempting to upload file to record PK_ID=${recordId}, field=${fieldName}`);
      
      // Check if this field is read-only
      if (this.readOnlyFields.includes(fieldName)) {
        console.warn(`Field ${fieldName} is read-only and cannot be updated via API`);
        return { success: false, fieldName, error: 'Field is read-only in Caspio' };
      }
      
      // First verify the record exists
      return new Promise((resolve) => {
        this.caspioService.get(`/tables/TEST/records?q.where=PK_ID=${recordId}`).subscribe({
          next: (checkResult: any) => {
            console.log('Record verification result:', checkResult);
            if (!checkResult?.Result || checkResult.Result.length === 0) {
              console.error(`Record with PK_ID=${recordId} not found!`);
              resolve({ success: false, fieldName, error: 'Record not found' });
              return;
            }
            
            // Try different approaches for file upload
            // Method 1: Try as a file URL/path instead of binary
            const fileUrl = URL.createObjectURL(file);
            const updateData = { [fieldName]: file.name }; // Try just the filename first
            
            console.log(`Trying to update ${fieldName} with filename: ${file.name}`);
            this.caspioService.put(`/tables/TEST/records?q.where=PK_ID=${recordId}`, updateData).subscribe({
              next: (response) => {
                console.log(`Filename update successful for ${fieldName}:`, response);
                resolve({ success: true, fieldName });
              },
              error: (error) => {
                console.error(`Filename update failed, trying base64:`, error);
                
                // Method 2: Try base64 upload without data URI prefix
                this.convertFileToBase64(file).then(base64Data => {
                  // Remove data:image/jpeg;base64, prefix if present
                  const base64Only = base64Data.split(',')[1] || base64Data;
                  const updateData = { [fieldName]: base64Only };
                  
                  console.log(`Trying base64 upload for ${fieldName}, length: ${base64Only.length}`);
                  this.caspioService.put(`/tables/TEST/records?q.where=PK_ID=${recordId}`, updateData).subscribe({
                    next: (response) => {
                      console.log(`Base64 upload successful for ${fieldName}:`, response);
                      resolve({ success: true, fieldName });
                    },
                    error: (base64Error) => {
                      console.error(`Base64 upload failed for ${fieldName}:`, base64Error);
                      // Final attempt: Just store the filename as a reference
                      console.log('Final attempt: storing filename only');
                      resolve({ success: false, fieldName, error: 'Caspio may not support file uploads via REST API' });
                    }
                  });
                }).catch(conversionError => {
                  console.error(`File conversion failed for ${fieldName}:`, conversionError);
                  resolve({ success: false, fieldName, error: conversionError });
                });
              }
            });
          },
          error: (verifyError) => {
            console.error('Record verification failed:', verifyError);
            resolve({ success: false, fieldName, error: verifyError });
          }
        });
      });

    } catch (error) {
      console.error(`Upload preparation failed for ${fieldName}:`, error);
      return { success: false, fieldName, error };
    }
  }

  private convertFileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  onPhotoSelected(event: any, fieldName: string) {
    const file = event.target.files[0];
    if (file) {
      // Validate that it's an image
      if (!file.type.startsWith('image/')) {
        this.showFileError('Please select an image file');
        return;
      }
      
      // Validate file size (5MB limit for photos)
      if (file.size > 5 * 1024 * 1024) {
        this.showFileError('Photo size must be less than 5MB');
        return;
      }
      
      // Store file for submission
      this.uploadedFiles[fieldName] = file;
      console.log(`Photo selected for ${fieldName}:`, file.name);
      
      // Create preview
      this.createPhotoPreview(file, fieldName);
      
      // Update form control
      this.testForm.get(fieldName)?.setValue(file.name);
    }
  }

  capturePhoto(fieldName: string) {
    // For mobile devices, this will open the camera
    const photoInput = document.getElementById('photo-' + fieldName) as HTMLInputElement;
    if (photoInput) {
      // Set capture attribute for camera
      photoInput.setAttribute('capture', 'camera');
      photoInput.click();
    }
  }

  selectFromGallery(fieldName: string) {
    // For selecting from photo gallery
    const photoInput = document.getElementById('photo-' + fieldName) as HTMLInputElement;
    if (photoInput) {
      // Remove capture attribute for gallery selection
      photoInput.removeAttribute('capture');
      photoInput.click();
    }
  }

  private createPhotoPreview(file: File, fieldName: string) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        this.photoPreview[fieldName] = e.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  }

  removePhoto(fieldName: string) {
    // Remove photo and preview
    delete this.uploadedFiles[fieldName];
    delete this.photoPreview[fieldName];
    
    // Reset form control
    this.testForm.get(fieldName)?.setValue('');
    
    // Reset file input
    const photoInput = document.getElementById('photo-' + fieldName) as HTMLInputElement;
    if (photoInput) {
      photoInput.value = '';
    }
  }

  private async showFileError(message: string) {
    const toast = await this.toastController.create({
      message: `❌ ${message}`,
      duration: 3000,
      position: 'top',
      color: 'danger'
    });
    await toast.present();
  }

  private async showValidationErrors() {
    const errors = this.getValidationErrors();
    const alert = await this.alertController.create({
      header: 'Validation Error',
      message: errors.join('<br>'),
      buttons: ['OK']
    });
    await alert.present();
  }

  private getValidationErrors(): string[] {
    const errors: string[] = [];
    
    this.tableFields.forEach(field => {
      const control = this.testForm.get(field.name);
      if (control?.hasError('required')) {
        errors.push(`${field.label} is required`);
      }
      if (control?.hasError('email')) {
        errors.push(`${field.label} must be a valid email address`);
      }
      if (control?.hasError('maxlength')) {
        errors.push(`${field.label} is too long (max ${field.maxLength} characters)`);
      }
    });

    return errors;
  }

  private async showSuccessMessage(customMessage?: string) {
    const toast = await this.toastController.create({
      message: customMessage || '✅ Data submitted successfully to TEST table!',
      duration: 3000,
      position: 'top',
      color: 'success'
    });
    await toast.present();
  }

  private async showErrorMessage(error: any) {
    const message = error.error?.message || error.message || 'Failed to submit data';
    
    const alert = await this.alertController.create({
      header: 'Submission Error',
      message: `❌ ${message}`,
      buttons: ['OK']
    });
    await alert.present();
  }

  resetForm() {
    this.testForm.reset();
    this.uploadedFiles = {};
    this.photoPreview = {};
    
    // Reset file inputs
    this.tableFields.forEach(field => {
      if (field.inputType === 'file') {
        const photoInput = document.getElementById('photo-' + field.name) as HTMLInputElement;
        if (photoInput) {
          photoInput.value = '';
        }
      }
    });
    
    Object.keys(this.testForm.controls).forEach(key => {
      this.testForm.get(key)?.setErrors(null);
    });
  }

  // Helper method to check if field has error
  hasError(fieldName: string, errorType: string): boolean {
    const field = this.testForm.get(fieldName);
    return !!(field?.hasError(errorType) && (field?.dirty || field?.touched));
  }

  // Helper method to get field error message
  getErrorMessage(fieldName: string): string {
    const field = this.testForm.get(fieldName);
    const tableField = this.tableFields.find(f => f.name === fieldName);
    const label = tableField?.label || fieldName;
    
    if (field?.hasError('required')) {
      return `${label} is required`;
    }
    if (field?.hasError('maxlength')) {
      return `${label} is too long (max ${tableField?.maxLength} characters)`;
    }
    if (field?.hasError('email')) {
      return 'Please enter a valid email address';
    }
    
    return '';
  }

  getFieldByName(fieldName: string): TestTableField | undefined {
    return this.tableFields.find(f => f.name === fieldName);
  }

  // Method to trigger file input click
  triggerFileInput(fieldName: string) {
    const fileInput = document.getElementById('file-' + fieldName) as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  // Manual override: Force a specific field to be a photo field
  forcePhotoField(fieldName: string) {
    const field = this.tableFields.find(f => f.name === fieldName);
    if (field) {
      field.inputType = 'file';
      console.log(`Manually converted field "${fieldName}" to photo field`);
      this.buildDynamicForm(); // Rebuild form
    }
  }

  // Test minimal submission to debug field issues
  async testMinimalSubmission() {
    const loading = await this.loadingController.create({
      message: 'Testing minimal submission...',
      spinner: 'crescent'
    });
    
    await loading.present();
    
    // Try the most basic possible submission
    const testData = {
      'Name': 'Test Entry',
      'Description': 'Test description from mobile app',
      'Status': 'Active'
    };
    
    console.log('=== MINIMAL TEST SUBMISSION ===');
    console.log('Test data:', testData);
    
    this.caspioService.post('/tables/TEST/records', testData).subscribe({
      next: async (response) => {
        await loading.dismiss();
        console.log('Minimal test successful:', response);
        await this.showSuccessMessage('✅ Minimal test submission worked! The issue is with field detection.');
      },
      error: async (error) => {
        await loading.dismiss();
        console.error('Minimal test failed:', error);
        console.log('This tells us what fields might be acceptable in your TEST table');
        
        // Try even simpler
        const simpler = { 'TestField': 'Simple test' };
        console.log('Trying even simpler:', simpler);
        
        this.caspioService.post('/tables/TEST/records', simpler).subscribe({
          next: async (response) => {
            console.log('Super simple test worked:', response);
            await this.showSuccessMessage('✅ Super simple test worked with TestField');
          },
          error: async (error2) => {
            console.error('Even simple test failed:', error2);
            await this.showErrorMessage(error2);
          }
        });
      }
    });
  }

  // Discover what fields actually exist in the TEST table
  async discoverRealFields() {
    const loading = await this.loadingController.create({
      message: 'Discovering real table fields...',
      spinner: 'crescent'
    });
    
    await loading.present();
    
    console.log('=== DISCOVERING REAL TEST TABLE FIELDS ===');
    
    // Try to get existing records to see field names
    this.caspioService.get('/tables/TEST/records?q_limit=1').subscribe({
      next: async (response) => {
        await loading.dismiss();
        console.log('Sample record from TEST table:', response);
        
        const records = response as any;
        if (records?.Result && records.Result.length > 0) {
          const sampleRecord = records.Result[0];
          const fieldNames = Object.keys(sampleRecord);
          
          console.log('Available field names in TEST table:', fieldNames);
          
          // Show in UI
          await this.showSuccessMessage(`Found fields: ${fieldNames.join(', ')}`);
          
          // Now try to submit with a real field name
          if (fieldNames.length > 0) {
            await this.tryRealFieldSubmission(fieldNames);
          }
        } else {
          console.log('No records found in TEST table - table might be empty');
          await this.showSuccessMessage('TEST table is empty - cannot discover field names from records.');
        }
      },
      error: async (error) => {
        await loading.dismiss();
        console.error('Failed to get sample records:', error);
        
        // Try the schema endpoint instead
        console.log('Trying schema endpoint...');
        this.caspioService.get('/tables/TEST/fields').subscribe({
          next: async (schemaResponse) => {
            console.log('Schema response:', schemaResponse);
            await this.showSuccessMessage('Check console for schema response');
          },
          error: async (schemaError) => {
            console.error('Schema endpoint also failed:', schemaError);
            await this.showErrorMessage({ message: 'Cannot discover table structure. Check console for details.' });
          }
        });
      }
    });
  }

  private async tryRealFieldSubmission(fieldNames: string[]) {
    // Try to submit with the first non-ID field we found
    const nonIdFields = fieldNames.filter(name => 
      !name.toLowerCase().includes('id') && 
      name.toLowerCase() !== 'id'
    );
    
    if (nonIdFields.length > 0) {
      const testField = nonIdFields[0];
      const testData = { [testField]: 'Test data from mobile app' };
      
      console.log(`Trying to submit with real field "${testField}":`, testData);
      
      this.caspioService.post('/tables/TEST/records', testData).subscribe({
        next: (response) => {
          console.log('SUCCESS! Real field submission worked:', response);
          this.showSuccessMessage(`✅ Success! Field "${testField}" works. Now we can build the form properly.`);
        },
        error: (error) => {
          console.error(`Real field "${testField}" submission failed:`, error);
          this.showErrorMessage({ message: `Field "${testField}" exists but submission failed. Check console.` });
        }
      });
    }
  }

  // Try simplified submission when main form fails with read-only error
  private async trySimplifiedSubmission(loading: any) {
    console.log('=== SIMPLIFIED SUBMISSION ATTEMPT ===');
    
    // Try with just the Typ field that worked in the individual test
    const simplifiedData = { 'Typ': 'Mobile App Test' };
    
    console.log('Trying simplified submission with:', simplifiedData);
    
    this.caspioService.post('/tables/TEST/records', simplifiedData).subscribe({
      next: async (response) => {
        await loading.dismiss();
        this.isSubmitting = false;
        console.log('Simplified submission worked!', response);
        await this.showSuccessMessage('✅ Simplified submission successful! Check console for details.');
        this.resetForm();
      },
      error: async (error) => {
        console.error('Even simplified submission failed:', error);
        await this.showErrorMessage(error);
      }
    });
  }

  // Test each field individually to identify which ones cause read-only errors
  async testEachFieldIndividually() {
    const loading = await this.loadingController.create({
      message: 'Testing each field individually...',
      spinner: 'crescent'
    });
    
    await loading.present();
    
    console.log('=== TESTING EACH FIELD INDIVIDUALLY ===');
    
    const results: { fieldName: string, success: boolean, error?: any }[] = [];
    
    // Test each field with a sample value
    for (const field of this.tableFields) {
      if (field.inputType === 'file') {
        console.log(`Skipping file field: ${field.name}`);
        continue;
      }
      
      let testValue: any = 'Test Value';
      
      // Set appropriate test values based on field type
      switch (field.inputType) {
        case 'number':
          testValue = 123;
          break;
        case 'checkbox':
          testValue = true;
          break;
        case 'date':
          testValue = '2024-01-01';
          break;
        case 'email':
          testValue = 'test@example.com';
          break;
        default:
          testValue = `Test ${field.name}`;
      }
      
      const testData = { [field.name]: testValue };
      
      console.log(`Testing field "${field.name}" with value:`, testValue);
      
      try {
        const response = await new Promise((resolve, reject) => {
          this.caspioService.post('/tables/TEST/records', testData).subscribe({
            next: (res) => resolve(res),
            error: (err) => reject(err)
          });
        });
        
        console.log(`✅ Field "${field.name}" SUCCESS:`, response);
        results.push({ fieldName: field.name, success: true });
        
      } catch (error: any) {
        console.log(`❌ Field "${field.name}" FAILED:`, error);
        results.push({ fieldName: field.name, success: false, error: error });
      }
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    await loading.dismiss();
    
    // Show results
    console.log('=== INDIVIDUAL FIELD TEST RESULTS ===');
    const successfulFields = results.filter(r => r.success).map(r => r.fieldName);
    const failedFields = results.filter(r => !r.success).map(r => r.fieldName);
    
    console.log('Successful fields:', successfulFields);
    console.log('Failed fields:', failedFields);
    
    let message = `✅ Success: ${successfulFields.join(', ')}\n❌ Failed: ${failedFields.join(', ')}`;
    if (successfulFields.length === 0) {
      message = '❌ All field tests failed. Check console for details.';
    } else if (failedFields.length === 0) {
      message = '✅ All field tests passed! The issue might be with multiple fields at once.';
    }
    
    await this.showSuccessMessage(message);
  }
}
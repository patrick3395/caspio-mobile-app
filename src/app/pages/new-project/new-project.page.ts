import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { ProjectsService, ProjectCreationData } from '../../services/projects.service';
import { ServiceEfeService } from '../../services/service-efe.service';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { FormValidationService, FieldValidationState, ValidationRules } from '../../services/form-validation.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-new-project',
  templateUrl: './new-project.page.html',
  styleUrls: ['./new-project.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class NewProjectPage implements OnInit {

  formData: ProjectCreationData = {
    company: '1',  // Always Noble Property Inspections (CompanyID = 1)
    inspectionDate: new Date().toISOString().split('T')[0], // Default to today
    address: '',
    // Keep these for potential future use but not required for creation
    city: '',
    state: null,  // No default state - user must select
    zip: '',
    user: '1',
    dateOfRequest: new Date().toISOString().split('T')[0],
    services: [],
    fee: '265.00',
    notes: ''
  };

  availableServices: any[] = [];
  states: any[] = []; // Will be loaded from Caspio
  stateAbbreviationMapping: { [key: string]: string } = {}; // Will be populated in loadStates
  stateAbbreviations: { [key: string]: string } = {
    'TX': 'Texas',
    'GA': 'Georgia',
    'FL': 'Florida',
    'CO': 'Colorado',
    'CA': 'California',
    'AZ': 'Arizona',
    'SC': 'South Carolina',
    'TN': 'Tennessee'
  };

  private autocompleteInstance: any = null;

  // Form validation state (web only)
  isWeb = environment.isWeb;
  validationState: Record<string, FieldValidationState> = {};
  validationRules: Record<string, ValidationRules> = {
    address: { required: true },
    city: { required: true },
    state: { required: true, custom: (v) => (!v || v === 'null') ? 'Please select a state' : null },
    zip: { required: true, zipCode: true }
  };

  constructor(
    private router: Router,
    private projectsService: ProjectsService,
    private serviceEfeService: ServiceEfeService,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private changeDetectorRef: ChangeDetectorRef,
    private googleMapsLoader: GoogleMapsLoaderService,
    private formValidation: FormValidationService
  ) {}

  async ngOnInit() {
    // Initialize validation state (web only)
    if (this.isWeb) {
      this.validationState = this.formValidation.createFormState(['address', 'city', 'state', 'zip']);
    }

    // Load states from Caspio
    await this.loadStates();

    // Initialize Google Places for address autocomplete
    this.ensureGooglePlacesAutocomplete();
  }

  // Real-time validation methods (web only)
  onFieldBlur(field: string): void {
    if (!this.isWeb) return;
    this.formValidation.markTouched(this.validationState, field);
    this.validateField(field);
  }

  onFieldInput(field: string): void {
    if (!this.isWeb) return;
    this.formValidation.markDirty(this.validationState, field);
    // Validate on input if field has been touched
    if (this.validationState[field]?.touched) {
      this.validateField(field);
    }
  }

  validateField(field: string): void {
    if (!this.isWeb) return;
    const value = (this.formData as any)[field];
    this.formValidation.updateFieldState(
      this.validationState,
      field,
      value,
      this.validationRules[field]
    );
  }

  shouldShowError(field: string): boolean {
    return this.formValidation.shouldShowError(this.validationState, field);
  }

  getFieldError(field: string): string | null {
    return this.formValidation.getError(this.validationState, field);
  }

  isFormValid(): boolean {
    if (!this.isWeb) {
      // Basic validation for mobile
      return !!this.formData.address && !!this.formData.city &&
             !!this.formData.state && !!this.formData.zip;
    }
    // Web validation includes format checks
    return !!this.formData.address && !!this.formData.city &&
           !!this.formData.state && !!this.formData.zip &&
           !this.formValidation.hasErrors(this.validationState);
  }

  async loadStates() {
    try {
      const statesData = await this.projectsService.getStates().toPromise();
      this.states = statesData || [];

      // Sort states alphabetically by State name
      this.states.sort((a, b) => {
        const stateA = a.State?.toUpperCase() || '';
        const stateB = b.State?.toUpperCase() || '';
        return stateA.localeCompare(stateB);
      });
      
      // Create a mapping of state abbreviations to full names
      this.stateAbbreviationMapping = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
        'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
        'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
        'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
        'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
        'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
      };
      
      // Don't set a default state - user must select
    } catch (error) {
      console.error('Error loading states:', error);
      // Fallback to hardcoded states if loading fails
      this.states = [
        { StateID: 7, State: 'Arizona' },
        { StateID: 6, State: 'California' },
        { StateID: 4, State: 'Colorado' },
        { StateID: 3, State: 'Florida' },
        { StateID: 2, State: 'Georgia' },
        { StateID: 8, State: 'South Carolina' },
        { StateID: 9, State: 'Tennessee' },
        { StateID: 1, State: 'Texas' }
      ];
    }
  }

  async loadServices() {
    try {
      // Load offers for Noble Property Inspections (CompanyID = 1)
      const offers = await this.projectsService.getOffers(1).toPromise();
      const serviceTypes = await this.projectsService.getServiceTypes().toPromise();
      
      // Match offers with service types to get names
      this.availableServices = offers?.map(offer => {
        const serviceType = serviceTypes?.find(t => t.TypeID === offer.TypeID);
        return {
          id: offer.OffersID || offer.PK_ID,
          name: serviceType?.TypeName || offer.Description || offer.OfferName || 'Service'
        };
      }) || [];
    } catch (error) {
      console.error('Error loading services:', error);
    }
  }

  private async ensureGooglePlacesAutocomplete(retry = 0): Promise<void> {
    try {
      const googleMaps = await this.googleMapsLoader.load();
      this.initializeGooglePlaces(googleMaps, retry);
    } catch (error) {
      console.error('Failed to load Google Maps Places API:', error);
    }
  }

  private initializeGooglePlaces(googleMaps: any, retry = 0) {

    if (!googleMaps || !googleMaps.maps || !googleMaps.maps.places) {
      console.warn('⚠️ Google Maps Places library unavailable, aborting initialization.');
      return;
    }

    const addressInput = document.getElementById('address-input') as HTMLInputElement | null;

    if (!addressInput) {
      if (retry < 10) {
        setTimeout(() => this.initializeGooglePlaces(googleMaps, retry + 1), 200);
      } else {
        console.warn('⚠️ Address input not found after multiple attempts.');
      }
      return;
    }

    if (this.autocompleteInstance) {
      return;
    }

    // Create autocomplete instance
    const autocomplete = new googleMaps.maps.places.Autocomplete(addressInput, {
      types: ['address'],
      componentRestrictions: { country: 'us' }
    });
    this.autocompleteInstance = autocomplete;
    
    // Listen for manual changes to the input
    addressInput.addEventListener('input', (event: any) => {
      this.formData.address = event.target.value;

      // If address is cleared, clear other fields to allow fresh autocomplete
      if (!event.target.value || event.target.value.trim() === '') {
        this.formData.city = '';
        this.formData.state = null;
        this.formData.zip = '';
        this.changeDetectorRef.detectChanges();

        // Re-enable the autocomplete dropdown by showing pac-container
        setTimeout(() => {
          const pacContainers = document.querySelectorAll('.pac-container');
          pacContainers.forEach((container: any) => {
            container.style.display = '';
            container.style.visibility = '';
          });
        }, 50);
      }
    });
    
    // Close dropdown on Enter key
    addressInput.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        // Google Places will handle the selection, we just prevent form submission
        const pacContainers = document.querySelectorAll('.pac-container');
        pacContainers.forEach((container: any) => {
          if (container.style.display !== 'none') {
            // Let Google handle the selection first
            return;
          }
        });
      }
    });
    
    // Close dropdown when clicking elsewhere
    addressInput.addEventListener('focusout', () => {
      setTimeout(() => {
        const pacContainers = document.querySelectorAll('.pac-container');
        pacContainers.forEach((container: any) => {
          container.style.display = 'none';
        });
      }, 200);
    });
    
    // Add listener for place selection
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      
      if (!place.geometry) {
        return;
      }
      
      // Parse the address components
      let streetNumber = '';
      let streetName = '';
      let city = '';
      let state = '';
      let zip = '';
      
      for (const component of place.address_components || []) {
        const types = component.types;
        
        if (types.includes('street_number')) {
          streetNumber = component.long_name;
        }
        if (types.includes('route')) {
          streetName = component.long_name;
        }
        if (types.includes('locality')) {
          city = component.long_name;
        }
        if (types.includes('administrative_area_level_1')) {
          state = component.short_name;
        }
        if (types.includes('postal_code')) {
          zip = component.long_name;
        }
      }
      
      // Update the form fields
      this.formData.address = streetNumber ? `${streetNumber} ${streetName}` : streetName;
      this.formData.city = city;
      
      // Find the StateID for the state abbreviation from Google Places
      if (state) {
        
        // Convert abbreviation to full state name
        const fullStateName = this.stateAbbreviationMapping[state.toUpperCase()];
        
        // Google Places returns abbreviation (e.g., "CA", "TX")
        // We need to match it with the full state name in the States table
        const stateRecord = this.states.find(s => {
          // Try multiple matching strategies
          return s.State === fullStateName || // Match full name (e.g., "Texas")
                 s.State === state || // Match abbreviation if State column has abbreviations
                 s.StateAbbreviation === state || // Match if there's a StateAbbreviation column
                 s.State?.toUpperCase() === state.toUpperCase() || // Case-insensitive abbreviation match
                 s.State?.toUpperCase() === fullStateName?.toUpperCase(); // Case-insensitive full name match
        });
        
        if (stateRecord) {
          // Set state as number to match ion-select value binding
          this.formData.state = stateRecord.StateID;
          
          // Force Angular change detection for ion-select
          // Use ChangeDetectorRef to ensure the ion-select updates
          this.changeDetectorRef.detectChanges();
          
          // Also try to manually update the ion-select element
          setTimeout(() => {
            const stateSelect = document.querySelector('ion-select[name="state"]') as any;
            if (stateSelect) {
              stateSelect.value = this.formData.state;
              // Trigger Angular's change detection again
              this.changeDetectorRef.detectChanges();
            }
          }, 100);
        } else {
        }
      }
      
      this.formData.zip = zip;
      
      // Force Angular change detection
      addressInput.value = this.formData.address;
      addressInput.dispatchEvent(new Event('input'));

      // Close the autocomplete dropdown immediately (but keep in DOM)
      setTimeout(() => {
        const pacContainers = document.querySelectorAll('.pac-container');
        pacContainers.forEach((container: any) => {
          container.style.display = 'none';
          container.style.visibility = 'hidden';
        });
      }, 100);

      // Blur the input to close dropdown
      addressInput.blur();
      
      // Move focus to the next field (City) if it's empty
      setTimeout(() => {
        const cityInput = document.querySelector('ion-input[name="city"]') as any;
        if (cityInput && !this.formData.city) {
          cityInput.setFocus();
        }
      }, 200);
    });
  }

  onServiceChange(serviceId: string, event: any) {
    if (event.detail.checked) {
      if (!this.formData.services.includes(serviceId)) {
        this.formData.services.push(serviceId);
      }
    } else {
      const index = this.formData.services.indexOf(serviceId);
      if (index > -1) {
        this.formData.services.splice(index, 1);
      }
    }
  }

  async createProject() {
    // Validate required fields - address, city, state, zip, and inspection date
    if (!this.formData.address || !this.formData.city || !this.formData.state || 
        !this.formData.zip || !this.formData.inspectionDate) {
      const alert = await this.alertController.create({
        header: 'Missing Information',
        message: 'Please fill in all required fields including address, city, state, zip, and inspection date.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating project...'
    });
    await loading.present();

    try {
      // Create the project (exact same logic as local server)
      const result = await this.projectsService.createProject(this.formData).toPromise();
      
      if (result?.success && result.projectId) {
        
        // Create Service_EFE record for the new project
        // Use ProjectID if available, otherwise use PK_ID (exact same as local server)
        const projectData = result.projectData;
        const projectIdForService = projectData?.ProjectID || projectData?.PK_ID || result.projectId;
        
        if (projectIdForService && projectIdForService !== 'new') {
          try {
            await this.serviceEfeService.createServiceEFE(projectIdForService).toPromise();
          } catch (error) {
            console.error('❌ Failed to create Service_EFE record:', error);
            // Don't fail the whole process if Service_EFE creation fails
          }
        } else {
        }
        
        await loading.dismiss();
        
        // Navigate to the new project's detail page
        if (result.projectId) {
          // Navigate immediately - Caspio API is instantaneous
          // Use replaceUrl to ensure proper navigation history
          await this.router.navigate(['/project', result.projectId], { replaceUrl: true });
        } else {
          await this.router.navigate(['/tabs/active-projects']);  
        }
      } else {
        throw new Error('Failed to create project');
      }
    } catch (error: any) {
      await loading.dismiss();
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: error.message || 'Failed to create project. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  goBack() {
    this.router.navigate(['/tabs/active-projects']);
  }

  getStateAbbreviation(stateId: string): string {
    const state = this.states.find(s => s.StateID.toString() === stateId);
    return state ? state.State : '';
  }

  getStateName(abbreviation: string): string {
    return this.stateAbbreviations[abbreviation] || abbreviation;
  }
}

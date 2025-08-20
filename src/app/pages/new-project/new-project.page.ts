import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { ProjectsService, ProjectCreationData } from '../../services/projects.service';
import { ServiceEfeService } from '../../services/service-efe.service';

declare var google: any;

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
    state: 1,  // Default to Texas (StateID = 1) - as number
    zip: '',
    user: '1',
    dateOfRequest: new Date().toISOString().split('T')[0],
    services: [],
    fee: '265.00',
    notes: ''
  };

  availableServices: any[] = [];
  states: any[] = []; // Will be loaded from Caspio
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
  
  constructor(
    private router: Router,
    private projectsService: ProjectsService,
    private serviceEfeService: ServiceEfeService,
    private loadingController: LoadingController,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    console.log('🔍 NewProjectPage: ngOnInit called');
    
    // Load states from Caspio
    await this.loadStates();
    
    // Initialize Google Places for address autocomplete
    // Wait a bit for the view to be fully rendered
    setTimeout(() => {
      this.initializeGooglePlaces();
    }, 500);
  }

  async loadStates() {
    try {
      const statesData = await this.projectsService.getStates().toPromise();
      this.states = statesData || [];
      console.log('✅ States loaded from Caspio:', this.states);
      
      // Set default state to Texas if not already set
      if (!this.formData.state && this.states.length > 0) {
        const texas = this.states.find(s => s.State === 'TX' || s.StateAbbreviation === 'TX');
        if (texas) {
          this.formData.state = texas.StateID; // Store StateID as number
        }
      }
    } catch (error) {
      console.error('Error loading states:', error);
      // Fallback to hardcoded states if loading fails
      this.states = [
        { StateID: 1, State: 'TX', StateAbbreviation: 'TX' },
        { StateID: 2, State: 'GA', StateAbbreviation: 'GA' },
        { StateID: 3, State: 'FL', StateAbbreviation: 'FL' },
        { StateID: 4, State: 'CO', StateAbbreviation: 'CO' },
        { StateID: 6, State: 'CA', StateAbbreviation: 'CA' },
        { StateID: 7, State: 'AZ', StateAbbreviation: 'AZ' },
        { StateID: 8, State: 'SC', StateAbbreviation: 'SC' },
        { StateID: 9, State: 'TN', StateAbbreviation: 'TN' }
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
      
      console.log('Available services:', this.availableServices);
    } catch (error) {
      console.error('Error loading services:', error);
    }
  }

  initializeGooglePlaces() {
    console.log('🔍 Initializing Google Places Autocomplete...');
    
    // Check if Google Maps is loaded
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
      console.log('⚠️ Google Maps not loaded yet, retrying in 1 second...');
      setTimeout(() => this.initializeGooglePlaces(), 1000);
      return;
    }
    
    const addressInput = document.getElementById('address-input') as HTMLInputElement;
    
    if (!addressInput) {
      console.log('⚠️ Address input not found, retrying in 500ms...');
      setTimeout(() => this.initializeGooglePlaces(), 500);
      return;
    }
    
    console.log('✅ Setting up Google Places Autocomplete on input:', addressInput);
    
    // Create autocomplete instance
    const autocomplete = new google.maps.places.Autocomplete(addressInput, {
      types: ['address'],
      componentRestrictions: { country: 'us' }
    });
    
    // Listen for manual changes to the input
    addressInput.addEventListener('input', (event: any) => {
      this.formData.address = event.target.value;
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
      console.log('📍 Place changed event fired');
      const place = autocomplete.getPlace();
      
      if (!place.geometry) {
        console.log('⚠️ No geometry found for selected place');
        return;
      }
      
      console.log('📍 Selected place:', place);
      
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
      
      // Find the StateID for the state abbreviation
      if (state) {
        console.log('🔍 Looking for state:', state);
        console.log('🔍 Available states in dropdown:', this.states);
        
        const stateRecord = this.states.find(s => 
          s.State === state || 
          s.StateAbbreviation === state ||
          s.State === state.toUpperCase()
        );
        
        if (stateRecord) {
          this.formData.state = stateRecord.StateID; // Store as number
          console.log('✅ State matched:', state, '-> StateID:', stateRecord.StateID);
          console.log('✅ Form state field updated to:', this.formData.state, 'Type:', typeof this.formData.state);
        } else {
          console.log('⚠️ State not found in database:', state);
          console.log('📋 Available states:', this.states.map(s => `${s.State} (ID: ${s.StateID})`));
        }
      }
      
      this.formData.zip = zip;
      
      console.log('✅ Form data updated:', {
        address: this.formData.address,
        city: this.formData.city,
        state: this.formData.state,
        zip: this.formData.zip
      });
      
      // Force Angular change detection
      addressInput.value = this.formData.address;
      addressInput.dispatchEvent(new Event('input'));
      
      // Close the autocomplete dropdown immediately
      addressInput.blur();
      
      // Force hide all pac-container elements
      const pacContainers = document.querySelectorAll('.pac-container');
      pacContainers.forEach((container: any) => {
        container.style.display = 'none';
        container.style.visibility = 'hidden';
      });
      
      // Also remove the pac-container from DOM after a short delay
      setTimeout(() => {
        const containers = document.querySelectorAll('.pac-container');
        containers.forEach((container: any) => {
          if (container && container.parentNode) {
            container.parentNode.removeChild(container);
          }
        });
      }, 100);
      
      // Move focus to the next field (City) if it's empty
      setTimeout(() => {
        const cityInput = document.querySelector('ion-input[name="city"]') as any;
        if (cityInput && !this.formData.city) {
          cityInput.setFocus();
        }
      }, 200);
    });
    
    console.log('✅ Google Places Autocomplete initialized successfully');
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
        console.log('Project created with ID:', result.projectId);
        console.log('Project data:', result.projectData);
        
        // Create Service_EFE record for the new project
        // Use ProjectID if available, otherwise use PK_ID (exact same as local server)
        const projectData = result.projectData;
        const projectIdForService = projectData?.ProjectID || projectData?.PK_ID || result.projectId;
        
        if (projectIdForService && projectIdForService !== 'new') {
          console.log('📝 Creating Service_EFE record for project:', projectIdForService);
          try {
            await this.serviceEfeService.createServiceEFE(projectIdForService).toPromise();
            console.log('✅ Service_EFE record created for project');
          } catch (error) {
            console.error('❌ Failed to create Service_EFE record:', error);
            // Don't fail the whole process if Service_EFE creation fails
          }
        } else {
          console.log('⚠️ No valid project ID for Service_EFE creation');
        }
        
        await loading.dismiss();
        
        // Navigate to the new project's detail page
        const navigationId = result.projectId !== 'new' ? result.projectId : null;
        if (navigationId) {
          console.log('🚀 Navigating to project details:', navigationId);
          // Navigate to project details page
          await this.router.navigate(['/project', navigationId]);
        } else {
          // Fallback to projects list if no ID
          console.log('⚠️ No project ID returned, navigating to projects list');
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
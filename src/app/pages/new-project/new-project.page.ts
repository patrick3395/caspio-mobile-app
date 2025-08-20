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
    state: 'TX',
    zip: '',
    user: '1',
    dateOfRequest: new Date().toISOString().split('T')[0],
    services: [],
    fee: '265.00',
    notes: ''
  };

  availableServices: any[] = [];
  states = ['TX', 'GA', 'FL', 'CO', 'CA', 'AZ', 'SC', 'TN'];
  
  constructor(
    private router: Router,
    private projectsService: ProjectsService,
    private serviceEfeService: ServiceEfeService,
    private loadingController: LoadingController,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    console.log('🔍 NewProjectPage: ngOnInit called');
    // Initialize Google Places for address autocomplete
    // Wait a bit for the view to be fully rendered
    setTimeout(() => {
      this.initializeGooglePlaces();
    }, 500);
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
      this.formData.state = state;
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
        // Use PK_ID for navigation (exact same as local server)
        const navigationId = result.projectId !== 'new' ? result.projectId : null;
        if (navigationId) {
          console.log('🚀 Navigating to project:', navigationId);
          this.router.navigate(['/project', navigationId]);
        } else {
          // Fallback to projects list if no ID
          console.log('🚀 Navigating to projects list (no ID)');
          this.router.navigate(['/tabs/active-projects']);  
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
}
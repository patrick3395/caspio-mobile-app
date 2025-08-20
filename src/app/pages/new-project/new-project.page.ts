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
    // Initialize Google Places for address autocomplete
    this.loadGoogleMapsScript();
  }

  loadGoogleMapsScript() {
    // Check if Google Maps is already loaded
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
      this.initializeGooglePlaces();
      return;
    }

    // Load Google Maps script
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A&libraries=places';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      this.initializeGooglePlaces();
    };
    document.head.appendChild(script);
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
    // Initialize Google Places Autocomplete - exact same as local server
    setTimeout(() => {
      const addressInput = document.getElementById('address-input') as HTMLInputElement;
      if (addressInput && typeof google !== 'undefined') {
        const autocomplete = new google.maps.places.Autocomplete(addressInput, {
          types: ['address'],
          componentRestrictions: { country: 'us' }
        });
        
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          
          if (!place.geometry) {
            return;
          }
          
          // Parse the address components - exact same as local server
          let streetNumber = '';
          let streetName = '';
          let city = '';
          let state = '';
          let zip = '';
          
          for (const component of place.address_components) {
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
          
          // Update the form fields - exact same as local server
          this.formData.address = streetNumber + ' ' + streetName;
          this.formData.city = city;
          this.formData.state = state;
          this.formData.zip = zip;
          
          // Trigger Angular change detection
          addressInput.value = this.formData.address;
        });
      }
    }, 1000);
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
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';

@Component({
  selector: 'app-template-form',
  templateUrl: './template-form.page.html',
  styleUrls: ['./template-form.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TemplateFormPage implements OnInit {
  offersId: string = '';
  serviceName: string = '';
  projectId: string = '';
  formData: any = {
    company: '',
    user: '',
    date: '',
    inspectionDate: '',
    requestedAddress: '',
    city: '',
    state: '',
    zip: '',
    serviceType: '',
    notes: '',
    supportDocument: '',
    homeInspectionReport: '',
    engineersEvaluationReport: ''
  };

  constructor(
    private route: ActivatedRoute,
    private caspioService: CaspioService
  ) { }

  async ngOnInit() {
    this.offersId = this.route.snapshot.paramMap.get('offersId') || '';
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    
    if (this.offersId) {
      await this.loadServiceName();
    }
  }

  async loadServiceName() {
    try {
      const offer = await this.caspioService.getOfferById(this.offersId);
      if (offer) {
        this.serviceName = offer.Service_Name || '';
      }
    } catch (error) {
      console.error('Error loading service name:', error);
    }
  }

  async submitForm() {
    console.log('Form submitted:', this.formData);
    // TODO: Implement form submission to Caspio
    // This would typically create a new record in a templates or inspections table
    alert('Template form submitted successfully!');
  }
}
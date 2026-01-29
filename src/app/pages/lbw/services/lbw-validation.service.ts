import { Injectable } from '@angular/core';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { LbwStateService } from './lbw-state.service';
import { map } from 'rxjs/operators';

export interface IncompleteField {
  section: string;
  label: string;
  field: string;
}

export interface ValidationResult {
  isComplete: boolean;
  incompleteFields: IncompleteField[];
}

@Injectable({
  providedIn: 'root'
})
export class LbwValidationService {

  constructor(
    private caspioService: CaspioService,
    private offlineTemplate: OfflineTemplateService,
    private stateService: LbwStateService
  ) {}

  /**
   * Validate all required fields across all pages
   */
  async validateAllRequiredFields(projectId: string, serviceId: string): Promise<ValidationResult> {
    console.log('[LBW Validation] Starting validation for:', { projectId, serviceId });
    
    const incompleteFields: IncompleteField[] = [];

    // Validate project details fields
    const projectIncomplete = await this.validateProjectFields(projectId, serviceId);
    incompleteFields.push(...projectIncomplete);

    // Validate category fields
    const categoryIncomplete = await this.validateCategoryFields(projectId, serviceId);
    incompleteFields.push(...categoryIncomplete);

    console.log('[LBW Validation] Validation complete. Incomplete fields:', incompleteFields.length);

    return {
      isComplete: incompleteFields.length === 0,
      incompleteFields
    };
  }

  /**
   * Validate project details required fields
   */
  private async validateProjectFields(projectId: string, serviceId: string): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    // Helper to check if value is empty
    const isEmpty = (value: any): boolean => {
      return value === null || value === undefined || value === '' || 
             (typeof value === 'string' && value.trim() === '') ||
             value === '-- Select --';
    };

    try {
      // Fetch project data
      const projectData = await this.caspioService.getProject(projectId).toPromise();
      
      // Fetch service data
      const serviceData = await this.caspioService.getServiceById(serviceId).toPromise();

      // Required project fields
      const requiredProjectFields = {
        'ClientName': 'Client Name',
        'InspectorName': 'Inspector Name',
        'YearBuilt': 'Year Built',
        'SquareFeet': 'Square Feet',
        'TypeOfBuilding': 'Building Type',
        'Style': 'Style'
      };

      Object.entries(requiredProjectFields).forEach(([field, label]) => {
        if (isEmpty(projectData[field])) {
          incompleteFields.push({
            section: 'Project Details',
            label,
            field
          });
        }
      });

      // Required service fields
      const requiredServiceFields = {
        'InAttendance': 'In Attendance',
        'OccupancyFurnishings': 'Occupancy/Furnishings',
        'WeatherConditions': 'Weather Conditions',
        'OutdoorTemperature': 'Outdoor Temperature'
      };

      Object.entries(requiredServiceFields).forEach(([field, label]) => {
        if (isEmpty(serviceData[field])) {
          incompleteFields.push({
            section: 'Project Details',
            label,
            field
          });
        }
      });

      console.log('[LBW Validation] Project fields incomplete:', incompleteFields.length);
    } catch (error) {
      console.error('[LBW Validation] Error validating project fields:', error);
    }

    return incompleteFields;
  }

  /**
   * Validate category required fields
   */
  private async validateCategoryFields(projectId: string, serviceId: string): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    try {
      // DEXIE-FIRST: Fetch template items with Required='Yes' from cache
      const allTemplates = await this.offlineTemplate.getLbwTemplates();
      const requiredItems = (allTemplates || []).filter((item: any) => item.Required === 'Yes');

      console.log('[LBW Validation] Found required template items:', requiredItems?.length || 0);

      // DEXIE-FIRST: Fetch user's answers for this service from cache
      const userAnswers = await this.offlineTemplate.getLbwByService(serviceId);

      // Check each required item
      for (const templateItem of requiredItems || []) {
        const userAnswer = userAnswers?.find((answer: any) => 
          answer.TemplateID === templateItem.PK_ID || answer.FK_Template === templateItem.PK_ID
        );

        let isComplete = false;

        if (userAnswer) {
          // Check based on AnswerType
          if (templateItem.AnswerType === 1) {
            // Yes/No question
            isComplete = userAnswer.Answer === 'Yes' || userAnswer.Answer === 'No';
          } else if (templateItem.AnswerType === 2) {
            // Multi-select question
            isComplete = userAnswer.SelectedOptions && userAnswer.SelectedOptions.length > 0;
          } else {
            // Text question (AnswerType 0 or undefined)
            isComplete = userAnswer.Selected === true || userAnswer.Selected === 'Yes';
          }
        }

        if (!isComplete) {
          const sectionType = templateItem.SectionType || 'Items';
          incompleteFields.push({
            section: 'Load Bearing Wall',
            label: `${templateItem.Category} - ${sectionType}: ${templateItem.Name || templateItem.Text}`,
            field: templateItem.PK_ID
          });
        }
      }

      console.log('[LBW Validation] Category fields incomplete:', incompleteFields.length);
    } catch (error) {
      console.error('[LBW Validation] Error validating category fields:', error);
    }

    return incompleteFields;
  }
}


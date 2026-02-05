import { Injectable } from '@angular/core';
import { CaspioService } from '../../../services/caspio.service';
import { HudStateService } from './hud-state.service';
import { EfeFieldRepoService } from '../../../services/efe-field-repo.service';
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
export class HudValidationService {

  constructor(
    private caspioService: CaspioService,
    private stateService: HudStateService,
    private efeFieldRepo: EfeFieldRepoService
  ) {}

  /**
   * Validate all required fields across all pages
   */
  async validateAllRequiredFields(projectId: string, serviceId: string): Promise<ValidationResult> {
    
    const incompleteFields: IncompleteField[] = [];

    // Validate project details fields
    const projectIncomplete = await this.validateProjectFields(projectId, serviceId);
    incompleteFields.push(...projectIncomplete);

    // Validate structural systems fields
    const structuralIncomplete = await this.validateStructuralFields(projectId, serviceId);
    incompleteFields.push(...structuralIncomplete);

    // Validate elevation plot fields
    const elevationIncomplete = await this.validateElevationFields(projectId, serviceId);
    incompleteFields.push(...elevationIncomplete);


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
        const value = projectData?.[field];
        if (isEmpty(value)) {
          incompleteFields.push({
            section: 'Project Details',
            label,
            field
          });
        }
      });

      // Required service fields (use actual database column names)
      const requiredServiceFields = {
        'InAttendance': 'In Attendance',
        'OccupancyFurnishings': 'Occupancy/Furnishings',
        'WeatherConditions': 'Weather Conditions',
        'OutdoorTemperature': 'Outdoor Temperature',
        'StructStat': 'Structural Systems Status'  // Database column is StructStat, not StructuralSystemsStatus
      };

      Object.entries(requiredServiceFields).forEach(([field, label]) => {
        const value = serviceData?.[field];
        if (isEmpty(value)) {
          incompleteFields.push({
            section: 'Project Details',
            label,
            field
          });
        }
      });

    } catch (error) {
      console.error('[HUD Validation] Error validating project fields:', error);
    }

    return incompleteFields;
  }

  /**
   * Validate structural systems required fields
   */
  private async validateStructuralFields(projectId: string, serviceId: string): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    try {
      // First check if structural systems should be validated
      const serviceData = await this.caspioService.getServiceById(serviceId).toPromise();
      // Database field is StructStat, not StructuralSystemsStatus
      const skipStructuralSystems = serviceData?.StructStat === 'Provided in Property Inspection Report';

      if (skipStructuralSystems) {
        return incompleteFields;
      }

      // Fetch template items with Required='Yes'
      const requiredItems = await this.caspioService.getServicesEFETemplates()
        .pipe(map((items: any[]) => items.filter((item: any) => item.Required === 'Yes')))
        .toPromise();


      // Fetch user's answers for this service
      const userAnswers = await this.caspioService.getServicesEFE(serviceId).toPromise();

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
            section: 'Structural Systems',
            label: `${templateItem.Category} - ${sectionType}: ${templateItem.Name || templateItem.Text}`,
            field: templateItem.PK_ID
          });
        }
      }

    } catch (error) {
      console.error('[HUD Validation] Error validating structural fields:', error);
    }

    return incompleteFields;
  }

  /**
   * Validate elevation plot required fields
   * Uses LOCAL Dexie data (EfeFieldRepoService) instead of remote API
   * This ensures we validate against user's actual entered data
   */
  private async validateElevationFields(projectId: string, serviceId: string): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    // Helper to check if value is empty
    const isEmpty = (value: any): boolean => {
      return value === null || value === undefined || value === '' ||
             (typeof value === 'string' && value.trim() === '') ||
             value === '-- Select --';
    };

    try {
      // Fetch elevation data from LOCAL Dexie database (not remote API)
      const efeFields = await this.efeFieldRepo.getFieldsForService(serviceId);

      // Filter to only selected (active) rooms
      const selectedRooms = efeFields.filter(field => field.isSelected);


      // Check if Base Station exists and is selected
      const baseStation = selectedRooms.find(field => field.roomName === 'Base Station');
      if (!baseStation) {
        incompleteFields.push({
          section: 'Elevation Plot',
          label: 'Base Station (required)',
          field: 'BaseStation'
        });
      }

      // Check all other selected rooms have FDF
      const otherRooms = selectedRooms.filter(field => field.roomName !== 'Base Station');
      for (const room of otherRooms) {

        if (isEmpty(room.fdf)) {
          incompleteFields.push({
            section: 'Elevation Plot',
            label: `${room.roomName}: FDF (Flooring Difference Factor)`,
            field: `FDF_${room.roomName}`
          });
        }
      }

    } catch (error) {
      console.error('[HUD Validation] Error validating elevation fields:', error);
    }

    return incompleteFields;
  }
}


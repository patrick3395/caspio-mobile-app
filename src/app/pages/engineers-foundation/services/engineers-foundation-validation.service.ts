import { Injectable } from '@angular/core';
import { CaspioService } from '../../../services/caspio.service';
import { EngineersFoundationStateService } from './engineers-foundation-state.service';
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
export class EngineersFoundationValidationService {

  constructor(
    private caspioService: CaspioService,
    private stateService: EngineersFoundationStateService
  ) {}

  /**
   * Validate all required fields across all pages
   */
  async validateAllRequiredFields(projectId: string, serviceId: string): Promise<ValidationResult> {
    console.log('[EngFoundation Validation] Starting validation for:', { projectId, serviceId });
    
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

    console.log('[EngFoundation Validation] Validation complete. Incomplete fields:', incompleteFields.length);

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
        console.log(`[EngFoundation Validation] Project ${field}:`, value);
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
        console.log(`[EngFoundation Validation] Service ${field}:`, value);
        if (isEmpty(value)) {
          incompleteFields.push({
            section: 'Project Details',
            label,
            field
          });
        }
      });

      console.log('[EngFoundation Validation] Project fields incomplete:', incompleteFields.length);
    } catch (error) {
      console.error('[EngFoundation Validation] Error validating project fields:', error);
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
        console.log('[EngFoundation Validation] Skipping structural systems validation');
        return incompleteFields;
      }

      // Fetch template items with Required='Yes'
      const requiredItems = await this.caspioService.getServicesEFETemplates()
        .pipe(map((items: any[]) => items.filter((item: any) => item.Required === 'Yes')))
        .toPromise();

      console.log('[EngFoundation Validation] Found required template items:', requiredItems?.length || 0);

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

      console.log('[EngFoundation Validation] Structural fields incomplete:', incompleteFields.length);
    } catch (error) {
      console.error('[EngFoundation Validation] Error validating structural fields:', error);
    }

    return incompleteFields;
  }

  /**
   * Validate elevation plot required fields
   */
  private async validateElevationFields(projectId: string, serviceId: string): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    try {
      // Fetch elevation data for this service
      const elevationData = await this.caspioService.getServicesEFE(serviceId).toPromise();

      // Check if Base Station exists
      const baseStation = elevationData?.find((item: any) => item.RoomName === 'Base Station');
      if (!baseStation) {
        incompleteFields.push({
          section: 'Elevation Plot',
          label: 'Base Station (required)',
          field: 'BaseStation'
        });
      }

      // Check all other rooms have FDF
      const otherRooms = elevationData?.filter((item: any) => item.RoomName !== 'Base Station') || [];
      for (const room of otherRooms) {
        const isEmpty = (value: any): boolean => {
          return value === null || value === undefined || value === '' || 
                 (typeof value === 'string' && value.trim() === '') ||
                 value === '-- Select --';
        };

        if (isEmpty(room.FDF)) {
          incompleteFields.push({
            section: 'Elevation Plot',
            label: `${room.RoomName}: FDF (Flooring Difference Factor)`,
            field: `FDF_${room.RoomName}`
          });
        }
      }

      console.log('[EngFoundation Validation] Elevation fields incomplete:', incompleteFields.length);
    } catch (error) {
      console.error('[EngFoundation Validation] Error validating elevation fields:', error);
    }

    return incompleteFields;
  }
}


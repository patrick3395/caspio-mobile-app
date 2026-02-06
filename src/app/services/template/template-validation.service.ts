import { Injectable, Inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../caspio.service';
import { EfeFieldRepoService } from '../efe-field-repo.service';
import { TemplateConfig } from './template-config.interface';
import { TEMPLATE_DATA_PROVIDER } from './template-data-provider.factory';
import { ITemplateDataProvider } from './template-data-provider.interface';
import { environment } from '../../../environments/environment';

export interface IncompleteField {
  section: string;
  label: string;
  field: string;
}

export interface ValidationResult {
  isComplete: boolean;
  incompleteFields: IncompleteField[];
}

/**
 * TemplateValidationService - Config-driven validation for all generic template types
 *
 * Validates two categories of required fields:
 * 1. Project Details — common project/service fields (+ optional extras per template)
 * 2. Category/Template Fields — template items marked Required='Yes', checked against user answers
 * 3. Elevation Plot Fields — (EFE only) Base Station + FDF for selected rooms
 */
@Injectable({
  providedIn: 'root'
})
export class TemplateValidationService {

  constructor(
    private caspioService: CaspioService,
    private efeFieldRepo: EfeFieldRepoService,
    @Inject(TEMPLATE_DATA_PROVIDER) private dataProvider: ITemplateDataProvider
  ) {}

  /**
   * Validate all required fields for a given template config
   */
  async validateAllRequiredFields(
    config: TemplateConfig,
    projectId: string,
    serviceId: string
  ): Promise<ValidationResult> {
    const incompleteFields: IncompleteField[] = [];

    // 1. Validate project details fields
    const projectIncomplete = await this.validateProjectFields(config, projectId, serviceId);
    incompleteFields.push(...projectIncomplete);

    // 2. Validate category/template fields
    const categoryIncomplete = await this.validateCategoryFields(config, serviceId);
    incompleteFields.push(...categoryIncomplete);

    // 3. Validate elevation plot fields (EFE only)
    if (config.validation.hasElevationPlotValidation) {
      const elevationIncomplete = await this.validateElevationFields(serviceId);
      incompleteFields.push(...elevationIncomplete);
    }

    return {
      isComplete: incompleteFields.length === 0,
      incompleteFields
    };
  }

  /**
   * Validate project details required fields
   */
  private async validateProjectFields(
    config: TemplateConfig,
    projectId: string,
    serviceId: string
  ): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    const isEmpty = (value: any): boolean => {
      return value === null || value === undefined || value === '' ||
             (typeof value === 'string' && value.trim() === '') ||
             value === '-- Select --';
    };

    try {
      // Fetch project and service data
      const projectData = await firstValueFrom(this.caspioService.getProject(projectId));
      const serviceData = await this.dataProvider.getService(serviceId);

      // Common required project fields (same across all templates)
      const requiredProjectFields: Record<string, string> = {
        'ClientName': 'Client Name',
        'InspectorName': 'Inspector Name',
        'YearBuilt': 'Year Built',
        'SquareFeet': 'Square Feet',
        'TypeOfBuilding': 'Building Type',
        'Style': 'Style'
      };

      Object.entries(requiredProjectFields).forEach(([field, label]) => {
        if (isEmpty(projectData?.[field])) {
          incompleteFields.push({ section: 'Project Details', label, field });
        }
      });

      // Common required service fields (same across all templates)
      const requiredServiceFields: Record<string, string> = {
        'InAttendance': 'In Attendance',
        'OccupancyFurnishings': 'Occupancy/Furnishings',
        'WeatherConditions': 'Weather Conditions',
        'OutdoorTemperature': 'Outdoor Temperature'
      };

      // Add template-specific extra service fields
      if (config.validation.additionalServiceFields) {
        Object.assign(requiredServiceFields, config.validation.additionalServiceFields);
      }

      Object.entries(requiredServiceFields).forEach(([field, label]) => {
        if (isEmpty(serviceData?.[field])) {
          incompleteFields.push({ section: 'Project Details', label, field });
        }
      });

    } catch (error) {
      console.error('[TemplateValidation] Error validating project fields:', error);
    }

    return incompleteFields;
  }

  /**
   * Validate category/template required fields
   */
  private async validateCategoryFields(
    config: TemplateConfig,
    serviceId: string
  ): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    try {
      // Check if category validation should be skipped
      if (config.validation.skipCategoryValidation) {
        const serviceData = await this.dataProvider.getService(serviceId);
        const { serviceField, skipValue } = config.validation.skipCategoryValidation;
        if (serviceData?.[serviceField] === skipValue) {
          return incompleteFields;
        }
      }

      // Get required template items
      // Required field varies by template table: 'Yes' (LBW/DTE/CSA/EFE), 1/true/'1' (HUD)
      const allTemplates = await this.dataProvider.getTemplates(config);
      const requiredItems = (allTemplates || []).filter((item: any) =>
        item.Required === 'Yes' || item.Required === 1 || item.Required === true || item.Required === '1'
      );

      // Get raw user answers for this service
      const userAnswers = await this.dataProvider.getRawVisuals(config, serviceId);

      // Check each required item
      for (const templateItem of requiredItems) {
        const templatePkId = String(templateItem.PK_ID);
        const userAnswer = userAnswers?.find((answer: any) =>
          String(answer.TemplateID) === templatePkId ||
          String(answer.FK_Template) === templatePkId ||
          String(answer[config.templateIdFieldName]) === templatePkId
        );

        let isComplete = false;

        if (userAnswer) {
          // Use Number() to handle both string and number AnswerType from API
          const answerType = Number(templateItem.AnswerType) || 0;
          if (answerType === 1) {
            // Yes/No question — check Answer or Answers field
            const answerVal = userAnswer.Answer || userAnswer.Answers || '';
            isComplete = answerVal === 'Yes' || answerVal === 'No';
          } else if (answerType === 2) {
            // Multi-select — stored as comma-separated string in Answers field (web)
            // or as array in SelectedOptions (Dexie/mobile)
            const answersStr = userAnswer.Answers || userAnswer.Answer || '';
            const hasAnswers = typeof answersStr === 'string'
              ? answersStr.trim().length > 0
              : false;
            const hasSelectedOptions = userAnswer.SelectedOptions && userAnswer.SelectedOptions.length > 0;
            isComplete = hasAnswers || hasSelectedOptions;
          } else {
            // Selection-based (AnswerType 0 or undefined)
            isComplete = userAnswer.Selected === true || userAnswer.Selected === 'Yes';
          }
        }

        if (!isComplete) {
          const sectionType = templateItem.SectionType || 'Items';
          incompleteFields.push({
            section: config.validation.categorySectionName,
            label: `${templateItem.Category} - ${sectionType}: ${templateItem.Name || templateItem.Text}`,
            field: templateItem.PK_ID
          });
        }
      }

    } catch (error) {
      console.error('[TemplateValidation] Error validating category fields:', error);
    }

    return incompleteFields;
  }

  /**
   * Validate elevation plot required fields (EFE only)
   * Web: queries LPS_Services_EFE table via API
   * Mobile: uses local Dexie data via EfeFieldRepoService
   */
  private async validateElevationFields(serviceId: string): Promise<IncompleteField[]> {
    const incompleteFields: IncompleteField[] = [];

    const isEmpty = (value: any): boolean => {
      return value === null || value === undefined || value === '' ||
             (typeof value === 'string' && value.trim() === '') ||
             value === '-- Select --';
    };

    try {
      if (environment.isWeb) {
        // WEBAPP: Query LPS_Services_EFE table directly via API
        const efeRooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));

        if (!efeRooms || efeRooms.length === 0) {
          // No rooms created yet - Base Station is required
          incompleteFields.push({
            section: 'Elevation Plot',
            label: 'Base Station (required)',
            field: 'BaseStation'
          });
          return incompleteFields;
        }

        // Check if Base Station exists
        const baseStation = efeRooms.find((r: any) => r.RoomName === 'Base Station');
        if (!baseStation) {
          incompleteFields.push({
            section: 'Elevation Plot',
            label: 'Base Station (required)',
            field: 'BaseStation'
          });
        }

        // Check all non-Base Station rooms have FDF answered
        const otherRooms = efeRooms.filter((r: any) => r.RoomName !== 'Base Station');
        for (const room of otherRooms) {
          if (isEmpty(room.FDF)) {
            incompleteFields.push({
              section: 'Elevation Plot',
              label: `${room.RoomName}: FDF (Flooring Difference Factor)`,
              field: `FDF_${room.RoomName}`
            });
          }
        }
      } else {
        // MOBILE: Use local Dexie data via EfeFieldRepoService
        const efeFields = await this.efeFieldRepo.getFieldsForService(serviceId);
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
      }

    } catch (error) {
      console.error('[TemplateValidation] Error validating elevation fields:', error);
    }

    return incompleteFields;
  }
}

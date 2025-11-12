import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../../services/caspio.service';
import { OfflineService } from '../../../../services/offline.service';

interface VisualItem {
  id: string | number;
  templateId: number;
  name: string;
  text: string;
  originalText: string;
  type: string;
  category: string;
  answerType: number;
  required: boolean;
  answer?: string;
  isSelected?: boolean;
  isSaving?: boolean;
  photos?: any[];
  otherValue?: string;
  key?: string;
}

@Component({
  selector: 'app-category-detail',
  templateUrl: './category-detail.page.html',
  styleUrls: ['./category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class CategoryDetailPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  loading: boolean = true;
  organizedData: {
    comments: VisualItem[];
    limitations: VisualItem[];
    deficiencies: VisualItem[];
  } = {
    comments: [],
    limitations: [],
    deficiencies: []
  };

  visualDropdownOptions: { [templateId: number]: string[] } = {};
  selectedItems: { [key: string]: boolean } = {};
  savingItems: { [key: string]: boolean } = {};

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    // Get category name from route
    this.route.params.subscribe(params => {
      this.categoryName = params['category'];

      // Get IDs from parent route
      this.route.parent?.parent?.params.subscribe(parentParams => {
        this.projectId = parentParams['projectId'];
        this.serviceId = parentParams['serviceId'];

        this.loadData();
      });
    });
  }

  private async loadData() {
    this.loading = true;

    try {
      // Load templates for this category
      await this.loadCategoryTemplates();

      // Load existing visuals for this service
      await this.loadExistingVisuals();

      this.loading = false;
    } catch (error) {
      console.error('Error loading category data:', error);
      this.loading = false;
    }
  }

  private async loadCategoryTemplates() {
    try {
      // Get all templates for TypeID = 1 (Foundation Evaluation)
      const allTemplates = await this.caspioService.getServicesVisualsTemplates().toPromise();
      const visualTemplates = (allTemplates || []).filter((template: any) =>
        template.TypeID === 1 && template.Category === this.categoryName
      );

      // Organize templates by Type
      visualTemplates.forEach((template: any) => {
        const templateData: VisualItem = {
          id: template.PK_ID,
          templateId: template.PK_ID,
          name: template.Name || 'Unnamed Item',
          text: template.Text || '',
          originalText: template.Text || '',
          type: template.Type || 'Comment',
          category: template.Category,
          answerType: template.AnswerType || 0,
          required: template.Required === 'Yes',
          answer: '',
          isSelected: false,
          photos: []
        };

        // Parse dropdown options if AnswerType is 2 (multi-select)
        if (template.AnswerType === 2 && template.DropdownOptions) {
          try {
            const optionsArray = JSON.parse(template.DropdownOptions);
            this.visualDropdownOptions[template.PK_ID] = optionsArray;
          } catch (e) {
            console.error('Error parsing dropdown options for template', template.PK_ID, e);
            this.visualDropdownOptions[template.PK_ID] = [];
          }
        }

        // Add to appropriate section
        if (template.Type === 'Comment') {
          this.organizedData.comments.push(templateData);
        } else if (template.Type === 'Limitation') {
          this.organizedData.limitations.push(templateData);
        } else if (template.Type === 'Deficiency') {
          this.organizedData.deficiencies.push(templateData);
        } else {
          // Default to comments if type is unknown
          this.organizedData.comments.push(templateData);
        }

        // Initialize selected state
        this.selectedItems[`${this.categoryName}_${template.PK_ID}`] = false;
      });

    } catch (error) {
      console.error('Error loading category templates:', error);
    }
  }

  private async loadExistingVisuals() {
    // TODO: Load existing saved visuals from database
    // This will populate answer values, selected states, and photos
    console.log('TODO: Load existing visuals for serviceId:', this.serviceId);
  }

  goBack() {
    this.router.navigate(['../..'], { relativeTo: this.route });
  }

  // Item selection for checkbox-based items (answerType 0)
  isItemSelected(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.selectedItems[key] || false;
  }

  async toggleItemSelection(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    this.selectedItems[key] = !this.selectedItems[key];

    // TODO: Save visual to database
    console.log('Toggle item:', key, this.selectedItems[key]);
  }

  // Answer change for Yes/No dropdowns (answerType 1)
  async onAnswerChange(category: string, item: VisualItem) {
    console.log('Answer changed:', item.answer);
    // TODO: Save to database
  }

  // Multi-select option toggle (answerType 2)
  async onOptionToggle(category: string, item: VisualItem, option: string, event: any) {
    console.log('Option toggled:', option, event.detail.checked);
    // TODO: Save to database
  }

  isOptionSelectedV1(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  async onMultiSelectOtherChange(category: string, item: VisualItem) {
    console.log('Other value changed:', item.otherValue);
    // TODO: Save to database
  }

  isItemSaving(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.savingItems[key] || false;
  }

  getPhotosForVisual(category: string, itemId: string | number): any[] {
    // TODO: Return photos for this visual
    return [];
  }

  addCustomVisual(category: string, type: string) {
    console.log('Add custom visual:', category, type);
    // TODO: Implement custom visual creation
  }

  showFullText(item: VisualItem) {
    // TODO: Show modal with full text
    console.log('Show full text:', item.name);
  }

  trackByItemId(index: number, item: VisualItem): any {
    return item.id || index;
  }

  trackByOption(index: number, option: string): string {
    return option;
  }

  getDropdownDebugInfo(item: VisualItem): string {
    return `Template ${item.templateId}, Type ${item.answerType}`;
  }
}

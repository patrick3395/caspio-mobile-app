import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface DteProjectData {
  projectId?: string;
  serviceId?: string;
  projectName?: string;
  // Add other shared project fields as needed
}

export interface DteCategoryData {
  categories?: { [category: string]: any };
}

@Injectable({
  providedIn: 'root'
})
export class DteStateService {
  private projectDataSubject = new BehaviorSubject<DteProjectData>({});
  private categoryDataSubject = new BehaviorSubject<DteCategoryData>({});

  public projectData$: Observable<DteProjectData> = this.projectDataSubject.asObservable();
  public categoryData$: Observable<DteCategoryData> = this.categoryDataSubject.asObservable();

  constructor() {}

  initialize(projectId: string, serviceId: string) {
    // Initialize with IDs
    this.updateProjectData({ projectId, serviceId });

    // Load existing data from API/database if needed
    this.loadProjectData(projectId, serviceId);
  }

  private async loadProjectData(projectId: string, serviceId: string) {
    // Data loading will be handled by individual pages using DteDataService
    this.updateProjectData({
      projectName: 'Damaged Truss Evaluation',
      projectId,
      serviceId
    });
  }

  // Project Data Methods
  updateProjectData(data: Partial<DteProjectData>) {
    const current = this.projectDataSubject.value;
    this.projectDataSubject.next({ ...current, ...data });
  }

  getProjectData(): DteProjectData {
    return this.projectDataSubject.value;
  }

  // Category Data Methods
  updateCategoryData(data: Partial<DteCategoryData>) {
    const current = this.categoryDataSubject.value;
    this.categoryDataSubject.next({ ...current, ...data });
  }

  getCategoryData(): DteCategoryData {
    return this.categoryDataSubject.value;
  }
}


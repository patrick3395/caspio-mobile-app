import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface LbwProjectData {
  projectId?: string;
  serviceId?: string;
  projectName?: string;
  // Add other shared project fields as needed
}

export interface LbwCategoryData {
  categories?: { [category: string]: any };
}

@Injectable({
  providedIn: 'root'
})
export class LbwStateService {
  private projectDataSubject = new BehaviorSubject<LbwProjectData>({});
  private categoryDataSubject = new BehaviorSubject<LbwCategoryData>({});

  public projectData$: Observable<LbwProjectData> = this.projectDataSubject.asObservable();
  public categoryData$: Observable<LbwCategoryData> = this.categoryDataSubject.asObservable();

  constructor() {}

  initialize(projectId: string, serviceId: string) {
    // Initialize with IDs
    this.updateProjectData({ projectId, serviceId });

    // Load existing data from API/database if needed
    this.loadProjectData(projectId, serviceId);
  }

  private async loadProjectData(projectId: string, serviceId: string) {
    // Data loading will be handled by individual pages using LbwDataService
    this.updateProjectData({
      projectName: 'LBW/Load Bearing Wall',
      projectId,
      serviceId
    });
  }

  // Project Data Methods
  updateProjectData(data: Partial<LbwProjectData>) {
    const current = this.projectDataSubject.value;
    this.projectDataSubject.next({ ...current, ...data });
  }

  getProjectData(): LbwProjectData {
    return this.projectDataSubject.value;
  }

  // Category Data Methods
  updateCategoryData(data: Partial<LbwCategoryData>) {
    const current = this.categoryDataSubject.value;
    this.categoryDataSubject.next({ ...current, ...data });
  }

  getCategoryData(): LbwCategoryData {
    return this.categoryDataSubject.value;
  }
}


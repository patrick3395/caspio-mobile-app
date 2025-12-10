import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface HudProjectData {
  projectId?: string;
  serviceId?: string;
  projectName?: string;
  // Add other shared project fields as needed
}

export interface HudCategoryData {
  categories?: { [category: string]: any };
}

@Injectable({
  providedIn: 'root'
})
export class HudStateService {
  private projectDataSubject = new BehaviorSubject<HudProjectData>({});
  private categoryDataSubject = new BehaviorSubject<HudCategoryData>({});

  public projectData$: Observable<HudProjectData> = this.projectDataSubject.asObservable();
  public categoryData$: Observable<HudCategoryData> = this.categoryDataSubject.asObservable();

  constructor() {}

  initialize(projectId: string, serviceId: string) {
    // Initialize with IDs
    this.updateProjectData({ projectId, serviceId });

    // Load existing data from API/database if needed
    this.loadProjectData(projectId, serviceId);
  }

  private async loadProjectData(projectId: string, serviceId: string) {
    // Data loading will be handled by individual pages using HudDataService
    this.updateProjectData({
      projectName: 'HUD/Manufactured Home',
      projectId,
      serviceId
    });
  }

  // Project Data Methods
  updateProjectData(data: Partial<HudProjectData>) {
    const current = this.projectDataSubject.value;
    this.projectDataSubject.next({ ...current, ...data });
  }

  getProjectData(): HudProjectData {
    return this.projectDataSubject.value;
  }

  // Category Data Methods
  updateCategoryData(data: Partial<HudCategoryData>) {
    const current = this.categoryDataSubject.value;
    this.categoryDataSubject.next({ ...current, ...data });
  }

  getCategoryData(): HudCategoryData {
    return this.categoryDataSubject.value;
  }
}


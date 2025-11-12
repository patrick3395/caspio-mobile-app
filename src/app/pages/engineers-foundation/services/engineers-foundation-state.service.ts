import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ProjectData {
  projectId?: string;
  serviceId?: string;
  projectName?: string;
  clientName?: string;
  agentName?: string;
  inspectorName?: string;
  inAttendance?: string[];
  yearBuilt?: string;
  squareFeet?: string;
  buildingType?: string;
  style?: string;
  occupancyStatus?: string;
  weatherConditions?: string;
  outdoorTemp?: string;
  firstFoundationType?: string;
  secondFoundationType?: string;
  secondFoundationRooms?: string[];
  thirdFoundationType?: string;
  thirdFoundationRooms?: string[];
  ownerInterview?: string;
}

export interface StructuralData {
  visualAssessmentStatus?: string;
  categories?: { [category: string]: any };
}

export interface ElevationData {
  rooms?: { [roomName: string]: any };
  baseStation?: any;
}

@Injectable({
  providedIn: 'root'
})
export class EngineersFoundationStateService {
  private projectDataSubject = new BehaviorSubject<ProjectData>({});
  private structuralDataSubject = new BehaviorSubject<StructuralData>({});
  private elevationDataSubject = new BehaviorSubject<ElevationData>({});

  public projectData$: Observable<ProjectData> = this.projectDataSubject.asObservable();
  public structuralData$: Observable<StructuralData> = this.structuralDataSubject.asObservable();
  public elevationData$: Observable<ElevationData> = this.elevationDataSubject.asObservable();

  constructor() {}

  initialize(projectId: string, serviceId: string) {
    // Initialize with IDs
    this.updateProjectData({ projectId, serviceId });

    // TODO: Load existing data from API/database
    this.loadProjectData(projectId, serviceId);
  }

  private async loadProjectData(projectId: string, serviceId: string) {
    // TODO: Implement actual data loading from API
    // For now, just set placeholder
    this.updateProjectData({
      projectName: 'Foundation Evaluation',
      projectId,
      serviceId
    });
  }

  // Project Data Methods
  updateProjectData(data: Partial<ProjectData>) {
    const current = this.projectDataSubject.value;
    this.projectDataSubject.next({ ...current, ...data });
  }

  getProjectData(): ProjectData {
    return this.projectDataSubject.value;
  }

  // Structural Data Methods
  updateStructuralData(data: Partial<StructuralData>) {
    const current = this.structuralDataSubject.value;
    this.structuralDataSubject.next({ ...current, ...data });
  }

  getStructuralData(): StructuralData {
    return this.structuralDataSubject.value;
  }

  // Elevation Data Methods
  updateElevationData(data: Partial<ElevationData>) {
    const current = this.elevationDataSubject.value;
    this.elevationDataSubject.next({ ...current, ...data });
  }

  getElevationData(): ElevationData {
    return this.elevationDataSubject.value;
  }

  // Save Methods (TODO: Implement actual API calls)
  async saveProjectField(field: string, value: any): Promise<void> {
    console.log(`Saving project field: ${field} =`, value);
    this.updateProjectData({ [field]: value });
    // TODO: Call API to save
  }

  async saveStructuralItem(category: string, itemId: string, value: any): Promise<void> {
    console.log(`Saving structural item: ${category}/${itemId} =`, value);
    // TODO: Update local state and call API
  }

  async saveElevationPoint(roomName: string, pointName: string, value: any): Promise<void> {
    console.log(`Saving elevation point: ${roomName}/${pointName} =`, value);
    // TODO: Update local state and call API
  }
}

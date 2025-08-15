import { Injectable } from '@angular/core';
import { CaspioService } from './caspio.service';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Project {
  PK_ID?: string;
  Project_ID?: string;
  Address?: string;
  City?: string;
  State?: string;
  Status?: string;
  StatusID?: number | string;
  Project_Name?: string;
  Company_ID?: string;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class ProjectsService {
  constructor(private caspioService: CaspioService) {}

  getProjectTableDefinition(): Observable<any> {
    return this.caspioService.get('/v2/tables/Projects/definition');
  }

  getActiveProjects(): Observable<Project[]> {
    // Fetch projects with StatusID = 1 (Active)
    return this.caspioService.get<any>('/v2/tables/Projects/records?q.where=StatusID%3D1').pipe(
      map(response => response.Result || [])
    );
  }

  getAllProjects(): Observable<Project[]> {
    return this.caspioService.get<any>('/v2/tables/Projects/records').pipe(
      map(response => response.Result || [])
    );
  }

  getProjectById(projectId: string): Observable<Project> {
    return this.caspioService.get<any>(`/v2/tables/Projects/records?q.where=PK_ID%3D%27${projectId}%27`).pipe(
      map(response => response.Result && response.Result[0] || {})
    );
  }
}
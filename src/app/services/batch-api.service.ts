import { Injectable } from '@angular/core';
import { Observable, forkJoin, from, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { CaspioService } from './caspio.service';

interface BatchRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  body?: any;
  params?: any;
}

interface BatchResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: any;
}

@Injectable({
  providedIn: 'root'
})
export class BatchApiService {
  private batchQueue: BatchRequest[] = [];
  private batchTimer: any;
  private readonly BATCH_DELAY = 50; // Milliseconds to wait before executing batch
  private readonly MAX_BATCH_SIZE = 10; // Maximum requests per batch

  constructor(private caspioService: CaspioService) {}

  /**
   * Add a request to the batch queue
   */
  addToBatch(request: BatchRequest): Observable<any> {
    return new Observable(observer => {
      // Add to queue
      this.batchQueue.push(request);
      
      // Clear existing timer
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
      }
      
      // Set new timer or execute immediately if batch is full
      if (this.batchQueue.length >= this.MAX_BATCH_SIZE) {
        this.executeBatch().then(responses => {
          const response = responses.find(r => r.id === request.id);
          if (response?.success) {
            observer.next(response.data);
            observer.complete();
          } else {
            observer.error(response?.error || 'Request failed');
          }
        });
      } else {
        this.batchTimer = setTimeout(() => {
          this.executeBatch().then(responses => {
            const response = responses.find(r => r.id === request.id);
            if (response?.success) {
              observer.next(response.data);
              observer.complete();
            } else {
              observer.error(response?.error || 'Request failed');
            }
          });
        }, this.BATCH_DELAY);
      }
    });
  }

  /**
   * Execute all queued requests in parallel
   */
  private async executeBatch(): Promise<BatchResponse[]> {
    if (this.batchQueue.length === 0) {
      return [];
    }
    
    const batch = [...this.batchQueue];
    this.batchQueue = [];
    
    const requests = batch.map(req => this.executeRequest(req));
    
    try {
      const results = await forkJoin(requests).toPromise();
      return results || [];
    } catch (error) {
      console.error('Batch execution error:', error);
      return batch.map(req => ({
        id: req.id,
        success: false,
        error
      }));
    }
  }

  /**
   * Execute a single request
   */
  private executeRequest(request: BatchRequest): Observable<BatchResponse> {
    let obs: Observable<any>;
    
    switch (request.method) {
      case 'GET':
        obs = this.caspioService.get(request.endpoint, request.params);
        break;
      case 'POST':
        obs = this.caspioService.post(request.endpoint, request.body, request.params);
        break;
      case 'PUT':
        obs = this.caspioService.put(request.endpoint, request.body, request.params);
        break;
      case 'DELETE':
        obs = this.caspioService.delete(request.endpoint, request.params);
        break;
      default:
        obs = of({ error: 'Invalid method' });
    }
    
    return obs.pipe(
      map(data => ({
        id: request.id,
        success: true,
        data
      })),
      catchError(error => of({
        id: request.id,
        success: false,
        error
      }))
    );
  }

  /**
   * Load multiple related entities in parallel
   * Example: Load project, services, and attachments together
   */
  loadProjectDetails(projectId: string): Observable<{
    project: any;
    services: any[];
    attachments: any[];
  }> {
    const requests = {
      project: this.caspioService.get(`/tables/LPS_Projects/records?q.where=PK_ID='${projectId}'`),
      services: this.caspioService.get(`/tables/LPS_Services/records?q.where=ProjectID='${projectId}'`),
      attachments: this.caspioService.get(`/tables/LPS_Attach/records?q.where=ProjectID='${projectId}'`)
    };
    
    return forkJoin(requests).pipe(
      map(results => ({
        project: results.project?.Result?.[0] || null,
        services: results.services?.Result || [],
        attachments: results.attachments?.Result || []
      }))
    );
  }

  /**
   * Batch create multiple records
   */
  batchCreate(table: string, records: any[]): Observable<any[]> {
    
    const requests = records.map((record, index) => 
      this.caspioService.post(`/tables/${table}/records?response=rows`, record).pipe(
        map(response => ({
          index,
          success: true,
          data: response?.Result?.[0] || response
        })),
        catchError(error => of({
          index,
          success: false,
          error
        }))
      )
    );
    
    return forkJoin(requests);
  }

  /**
   * Batch update multiple records
   */
  batchUpdate(table: string, updates: { id: string; data: any }[]): Observable<any[]> {
    
    const requests = updates.map((update, index) => 
      this.caspioService.put(`/tables/${table}/records?q.where=PK_ID='${update.id}'`, update.data).pipe(
        map(response => ({
          index,
          success: true,
          data: response
        })),
        catchError(error => of({
          index,
          success: false,
          error
        }))
      )
    );
    
    return forkJoin(requests);
  }
}
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { CacheService } from './cache.service';

export enum MutationType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE'
}

export enum EntityType {
  PROJECT = 'PROJECT',
  SERVICE = 'SERVICE',
  DOCUMENT = 'DOCUMENT',
  ATTACHMENT = 'ATTACHMENT',
  ANNOTATION = 'ANNOTATION',
  TEMPLATE = 'TEMPLATE'
}

export interface Mutation {
  type: MutationType;
  entityType: EntityType;
  entityId: string;
  projectId?: string;
  serviceId?: string;
  timestamp: number;
  data?: any;
}

/**
 * MutationTrackingService
 *
 * Tracks all mutations (create, update, delete) and automatically invalidates
 * related caches to ensure users always see their latest changes immediately.
 *
 * Key Features:
 * - Automatic cache invalidation on mutations
 * - Mutation event broadcasting for reactive components
 * - Entity relationship tracking (project -> services -> documents)
 * - Prevents stale data after edits
 */
@Injectable({
  providedIn: 'root'
})
export class MutationTrackingService {
  private mutations$ = new Subject<Mutation>();
  private mutationHistory: Mutation[] = [];
  private readonly MAX_HISTORY = 100;

  constructor(private cache: CacheService) {
    // Subscribe to mutations to automatically invalidate caches
    this.mutations$.subscribe(mutation => {
      this.invalidateCachesForMutation(mutation);
      this.addToHistory(mutation);
    });
  }

  /**
   * Track a mutation and trigger cache invalidation
   */
  trackMutation(mutation: Omit<Mutation, 'timestamp'>): void {
    const fullMutation: Mutation = {
      ...mutation,
      timestamp: Date.now()
    };

    console.log('[MutationTracker] 🔄 Mutation tracked:', {
      type: fullMutation.type,
      entity: fullMutation.entityType,
      id: fullMutation.entityId,
      projectId: fullMutation.projectId,
      serviceId: fullMutation.serviceId
    });

    this.mutations$.next(fullMutation);
  }

  /**
   * Track project mutation
   */
  trackProjectMutation(type: MutationType, projectId: string, data?: any): void {
    this.trackMutation({
      type,
      entityType: EntityType.PROJECT,
      entityId: projectId,
      projectId,
      data
    });
  }

  /**
   * Track service mutation
   */
  trackServiceMutation(type: MutationType, serviceId: string, projectId: string, data?: any): void {
    this.trackMutation({
      type,
      entityType: EntityType.SERVICE,
      entityId: serviceId,
      projectId,
      serviceId,
      data
    });
  }

  /**
   * Track document mutation
   */
  trackDocumentMutation(type: MutationType, documentId: string, projectId: string, serviceId?: string, data?: any): void {
    this.trackMutation({
      type,
      entityType: EntityType.DOCUMENT,
      entityId: documentId,
      projectId,
      serviceId,
      data
    });
  }

  /**
   * Track attachment mutation
   */
  trackAttachmentMutation(type: MutationType, attachmentId: string, projectId: string, data?: any): void {
    this.trackMutation({
      type,
      entityType: EntityType.ATTACHMENT,
      entityId: attachmentId,
      projectId,
      data
    });
  }

  /**
   * Track annotation mutation
   */
  trackAnnotationMutation(type: MutationType, annotationId: string, projectId: string, serviceId?: string, data?: any): void {
    this.trackMutation({
      type,
      entityType: EntityType.ANNOTATION,
      entityId: annotationId,
      projectId,
      serviceId,
      data
    });
  }

  /**
   * Observable stream of mutations
   */
  get mutations() {
    return this.mutations$.asObservable();
  }

  /**
   * Get recent mutations for an entity
   */
  getEntityMutations(entityType: EntityType, entityId: string): Mutation[] {
    return this.mutationHistory.filter(m =>
      m.entityType === entityType && m.entityId === entityId
    );
  }

  /**
   * Get recent mutations for a project
   */
  getProjectMutations(projectId: string): Mutation[] {
    return this.mutationHistory.filter(m => m.projectId === projectId);
  }

  /**
   * Check if entity was recently modified (within last 5 seconds)
   */
  wasRecentlyModified(entityType: EntityType, entityId: string, withinMs: number = 5000): boolean {
    const now = Date.now();
    return this.mutationHistory.some(m =>
      m.entityType === entityType &&
      m.entityId === entityId &&
      (now - m.timestamp) < withinMs
    );
  }

  /**
   * Check if project was recently modified
   */
  wasProjectRecentlyModified(projectId: string, withinMs: number = 5000): boolean {
    const now = Date.now();
    return this.mutationHistory.some(m =>
      m.projectId === projectId &&
      (now - m.timestamp) < withinMs
    );
  }

  /**
   * Clear mutation history
   */
  clearHistory(): void {
    this.mutationHistory = [];
  }

  /**
   * Automatically invalidate caches based on mutation type
   */
  private invalidateCachesForMutation(mutation: Mutation): void {
    console.log('[MutationTracker] 🗑️ Invalidating caches for:', mutation.entityType);

    switch (mutation.entityType) {
      case EntityType.PROJECT:
        this.invalidateProjectCaches(mutation);
        break;

      case EntityType.SERVICE:
        this.invalidateServiceCaches(mutation);
        break;

      case EntityType.DOCUMENT:
      case EntityType.ATTACHMENT:
        this.invalidateDocumentCaches(mutation);
        break;

      case EntityType.ANNOTATION:
        this.invalidateAnnotationCaches(mutation);
        break;

      case EntityType.TEMPLATE:
        this.invalidateTemplateCaches(mutation);
        break;
    }

    // Always clear project list caches on any mutation
    this.cache.clearByPattern('projects_active');
    this.cache.clearByPattern('projects_all');
  }

  /**
   * Invalidate project-related caches
   */
  private invalidateProjectCaches(mutation: Mutation): void {
    if (!mutation.projectId) return;

    console.log('[MutationTracker] Clearing project caches for:', mutation.projectId);

    // Clear specific project cache
    this.cache.clearByPattern(`project_detail`);
    this.cache.clearByPattern(`ProjectID=${mutation.projectId}`);
    this.cache.clearByPattern(`PK_ID=${mutation.projectId}`);

    // Clear all related data
    this.cache.clearProjectRelatedCaches(mutation.projectId);

    // Clear project lists
    this.cache.clearByPattern('projects_active');
    this.cache.clearByPattern('projects_all');
  }

  /**
   * Invalidate service-related caches
   */
  private invalidateServiceCaches(mutation: Mutation): void {
    if (mutation.serviceId) {
      console.log('[MutationTracker] Clearing service caches for:', mutation.serviceId);
      this.cache.clearServiceRelatedCaches(mutation.serviceId);
      this.cache.clearByPattern(`ServiceID=${mutation.serviceId}`);
    }

    if (mutation.projectId) {
      console.log('[MutationTracker] Clearing project caches for service mutation:', mutation.projectId);
      this.cache.clearProjectRelatedCaches(mutation.projectId);
      this.cache.clearByPattern(`ProjectID=${mutation.projectId}`);
    }

    // Services changed, refresh project lists
    this.cache.clearByPattern('projects_active');
    this.cache.clearByPattern('projects_all');
  }

  /**
   * Invalidate document/attachment caches
   */
  private invalidateDocumentCaches(mutation: Mutation): void {
    console.log('[MutationTracker] Clearing document caches');

    // Clear attachment tables
    this.cache.clearTableCache('Attach');
    this.cache.clearTableCache('Services_Visuals_Attach');
    this.cache.clearTableCache('Services_EFE_Points_Attach');

    if (mutation.projectId) {
      this.cache.clearByPattern(`ProjectID=${mutation.projectId}`);
    }

    if (mutation.serviceId) {
      this.cache.clearByPattern(`ServiceID=${mutation.serviceId}`);
    }
  }

  /**
   * Invalidate annotation caches
   */
  private invalidateAnnotationCaches(mutation: Mutation): void {
    console.log('[MutationTracker] Clearing annotation caches');

    if (mutation.serviceId) {
      this.cache.clearByPattern(`ServiceID=${mutation.serviceId}`);
    }

    if (mutation.projectId) {
      this.cache.clearByPattern(`ProjectID=${mutation.projectId}`);
    }
  }

  /**
   * Invalidate template caches
   */
  private invalidateTemplateCaches(mutation: Mutation): void {
    console.log('[MutationTracker] Clearing template caches');
    this.cache.clearByPattern('templates');
    this.cache.clearByPattern('attach_templates');
  }

  /**
   * Add mutation to history (limited size)
   */
  private addToHistory(mutation: Mutation): void {
    this.mutationHistory.unshift(mutation);

    // Keep only recent mutations
    if (this.mutationHistory.length > this.MAX_HISTORY) {
      this.mutationHistory = this.mutationHistory.slice(0, this.MAX_HISTORY);
    }
  }
}

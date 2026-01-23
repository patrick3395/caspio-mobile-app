/**
 * ServiceMetadataService - Service-level tracking for storage bloat prevention
 *
 * Tracks activity, sync state, and purge eligibility per inspection service.
 * Used by two-stage purge system to safely clean up inactive service data.
 *
 * Key responsibilities:
 * - Track when user last interacted with a service (lastTouchedAt)
 * - Track local changes vs server-acknowledged changes (revision tracking)
 * - Track whether service is currently open (isOpen)
 * - Determine if service data is safe to purge (isPurgeSafe)
 */

import { Injectable } from '@angular/core';
import { db, ServiceMetadata, PurgeState } from './caspio-db';

@Injectable({
  providedIn: 'root'
})
export class ServiceMetadataService {

  constructor() {
    console.log('[ServiceMetadata] Service initialized');
  }

  /**
   * Initialize or get metadata for a service
   * Called when service is first accessed (e.g., entering engineers-foundation page)
   */
  async initService(serviceId: string, templateVersion: number = 1): Promise<ServiceMetadata> {
    const existing = await db.serviceMetadata.get(serviceId);

    if (existing) {
      // Update lastTouchedAt on access
      const updated: ServiceMetadata = {
        ...existing,
        lastTouchedAt: Date.now(),
        updatedAt: Date.now()
      };
      await db.serviceMetadata.put(updated);
      console.log('[ServiceMetadata] Service accessed:', serviceId);
      return updated;
    }

    // Create new metadata record
    const now = Date.now();
    const metadata: ServiceMetadata = {
      serviceId,
      templateVersion,
      isOpen: false,
      lastTouchedAt: now,
      lastLocalRevision: 0,
      lastServerAckRevision: 0,
      purgeState: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    };

    await db.serviceMetadata.add(metadata);
    console.log('[ServiceMetadata] Service initialized:', serviceId);
    return metadata;
  }

  /**
   * Update lastTouchedAt when user interacts with service
   * Should be called on any meaningful user action (field edits, photo capture, etc.)
   */
  async touchService(serviceId: string): Promise<void> {
    const now = Date.now();
    const existing = await db.serviceMetadata.get(serviceId);

    if (existing) {
      await db.serviceMetadata.update(serviceId, {
        lastTouchedAt: now,
        updatedAt: now
      });
    } else {
      // Auto-initialize if not exists
      await this.initService(serviceId);
    }
  }

  /**
   * Increment local revision counter when local changes are made
   * Called after field repo writes (setField, setRoomNotes, etc.)
   */
  async incrementLocalRevision(serviceId: string): Promise<number> {
    const existing = await db.serviceMetadata.get(serviceId);
    const now = Date.now();

    if (existing) {
      const newRevision = existing.lastLocalRevision + 1;
      await db.serviceMetadata.update(serviceId, {
        lastLocalRevision: newRevision,
        lastTouchedAt: now,
        updatedAt: now
      });
      return newRevision;
    } else {
      // Auto-initialize with revision 1
      await this.initService(serviceId);
      await db.serviceMetadata.update(serviceId, {
        lastLocalRevision: 1,
        lastTouchedAt: now,
        updatedAt: now
      });
      return 1;
    }
  }

  /**
   * Update server-acknowledged revision after successful sync
   * Called by BackgroundSyncService after sync cycle completes
   */
  async setServerAckRevision(serviceId: string, revision: number): Promise<void> {
    const existing = await db.serviceMetadata.get(serviceId);

    if (existing) {
      await db.serviceMetadata.update(serviceId, {
        lastServerAckRevision: revision,
        updatedAt: Date.now()
      });
      console.log('[ServiceMetadata] Server ACK revision updated:', serviceId, 'rev:', revision);
    }
  }

  /**
   * Sync server revision to match local revision
   * Convenience method called after successful sync when all changes are confirmed
   */
  async syncRevisions(serviceId: string): Promise<void> {
    const existing = await db.serviceMetadata.get(serviceId);

    if (existing && existing.lastLocalRevision > existing.lastServerAckRevision) {
      await db.serviceMetadata.update(serviceId, {
        lastServerAckRevision: existing.lastLocalRevision,
        updatedAt: Date.now()
      });
      console.log('[ServiceMetadata] Revisions synced:', serviceId, 'rev:', existing.lastLocalRevision);
    }
  }

  /**
   * Track whether service is currently being viewed
   * Called on ionViewWillEnter (true) and ionViewWillLeave/ngOnDestroy (false)
   */
  async setOpen(serviceId: string, isOpen: boolean): Promise<void> {
    const existing = await db.serviceMetadata.get(serviceId);
    const now = Date.now();

    if (existing) {
      await db.serviceMetadata.update(serviceId, {
        isOpen,
        lastTouchedAt: isOpen ? now : existing.lastTouchedAt,  // Touch on open, not on close
        updatedAt: now
      });
    } else if (isOpen) {
      // Auto-initialize if opening a service for the first time
      const metadata = await this.initService(serviceId);
      await db.serviceMetadata.update(serviceId, { isOpen: true });
    }
  }

  /**
   * Get metadata for a service
   */
  async getServiceMetadata(serviceId: string): Promise<ServiceMetadata | undefined> {
    return db.serviceMetadata.get(serviceId);
  }

  /**
   * Get count of pending uploads/mutations for a service
   * Used by isPurgeSafe to ensure no unsynced data
   */
  async getOutboxCount(serviceId: string): Promise<number> {
    // Count pending uploads in uploadOutbox
    const uploadCount = await db.uploadOutbox
      .filter(item => {
        // Need to check the associated localImage's serviceId
        return true; // Will refine below
      })
      .count();

    // Count pending images for this service
    const pendingImages = await db.localImages
      .where('serviceId')
      .equals(serviceId)
      .filter(img => img.status !== 'verified' && img.status !== 'failed')
      .count();

    // Count pending captions for this service
    const pendingCaptions = await db.pendingCaptions
      .where('serviceId')
      .equals(serviceId)
      .filter(c => c.status === 'pending' || c.status === 'syncing')
      .count();

    // Count dirty visual fields
    const dirtyVisuals = await db.visualFields
      .where('serviceId')
      .equals(serviceId)
      .filter(f => f.dirty)
      .count();

    // Count dirty EFE fields
    const dirtyEfe = await db.efeFields
      .where('serviceId')
      .equals(serviceId)
      .filter(f => f.dirty)
      .count();

    // Count dirty HUD fields (HUD-019)
    const dirtyHud = await db.hudFields
      .where('serviceId')
      .equals(serviceId)
      .filter(f => f.dirty)
      .count();

    const total = pendingImages + pendingCaptions + dirtyVisuals + dirtyEfe + dirtyHud;
    return total;
  }

  /**
   * Check if service data is safe to auto-purge
   * Returns true only if ALL conditions are met:
   * 1. No pending uploads or mutations (outboxCount === 0)
   * 2. Server has acknowledged all local changes (lastServerAckRevision >= lastLocalRevision)
   * 3. Service is not currently open (isOpen === false)
   */
  async isPurgeSafe(serviceId: string): Promise<{ safe: boolean; reasons: string[] }> {
    const metadata = await db.serviceMetadata.get(serviceId);
    const reasons: string[] = [];

    if (!metadata) {
      return { safe: false, reasons: ['Service metadata not found'] };
    }

    // Rule 1: No pending uploads
    const outboxCount = await this.getOutboxCount(serviceId);
    if (outboxCount > 0) {
      reasons.push(`${outboxCount} pending items in outbox`);
    }

    // Rule 2: Server has latest revision
    if (metadata.lastServerAckRevision < metadata.lastLocalRevision) {
      reasons.push(`Unsynced changes: local rev ${metadata.lastLocalRevision}, server ack ${metadata.lastServerAckRevision}`);
    }

    // Rule 3: Not currently open
    if (metadata.isOpen) {
      reasons.push('Service is currently open');
    }

    const safe = reasons.length === 0;

    if (!safe) {
      console.log('[ServiceMetadata] Purge blocked for:', serviceId, 'reasons:', reasons);
    }

    return { safe, reasons };
  }

  /**
   * Get services that are inactive (not touched in specified time)
   * Used by hard purge to find candidates for cleanup
   */
  async getInactiveServices(cutoffTimestamp: number): Promise<ServiceMetadata[]> {
    return db.serviceMetadata
      .where('[purgeState+lastTouchedAt]')
      .between(['ACTIVE', 0], ['ACTIVE', cutoffTimestamp])
      .toArray();
  }

  /**
   * Update purge state for a service
   */
  async setPurgeState(serviceId: string, state: PurgeState): Promise<void> {
    const existing = await db.serviceMetadata.get(serviceId);
    const now = Date.now();

    if (existing) {
      // Update existing record
      await db.serviceMetadata.update(serviceId, {
        purgeState: state,
        updatedAt: now
      });
    } else {
      // Create record if it doesn't exist (service accessed before v10 migration)
      const metadata: ServiceMetadata = {
        serviceId,
        templateVersion: 1,
        isOpen: false,
        lastTouchedAt: now,
        lastLocalRevision: 0,
        lastServerAckRevision: 0,
        purgeState: state,
        createdAt: now,
        updatedAt: now
      };
      await db.serviceMetadata.add(metadata);
    }
    console.log('[ServiceMetadata] Purge state set:', serviceId, state);
  }

  /**
   * Get all services (for debugging/admin)
   */
  async getAllServices(): Promise<ServiceMetadata[]> {
    return db.serviceMetadata.toArray();
  }

  /**
   * Delete metadata for a service (used after hard purge)
   */
  async deleteServiceMetadata(serviceId: string): Promise<void> {
    await db.serviceMetadata.delete(serviceId);
    console.log('[ServiceMetadata] Metadata deleted:', serviceId);
  }
}

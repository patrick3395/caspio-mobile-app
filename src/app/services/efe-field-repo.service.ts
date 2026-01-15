import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { db, EfeField, EfePoint, EfeFdfPhoto } from './caspio-db';

/**
 * EfeFieldRepoService - Repository API for EFE (Elevation Field Equipment) field data
 *
 * This service implements the Dexie-first architecture pattern for elevation plot:
 * - Seed from templates (one-time initialization)
 * - Reactive reads via liveQuery (auto-updates on change)
 * - Write-through on every input change
 * - Dirty flag for sync tracking
 *
 * Benefits:
 * - No loading screens - pages render immediately from Dexie
 * - No data loss - Dexie is always source of truth
 * - Instant navigation - no loadData() on page entry
 * - Automatic updates - liveQuery handles reactivity
 * - Photos persist after sync (local reference maintained)
 */
@Injectable({
  providedIn: 'root'
})
export class EfeFieldRepoService {

  constructor() {}

  // ============================================================================
  // SEEDING - Initialize fields from templates
  // ============================================================================

  /**
   * Seed EFE fields from templates for a service
   * Called once when entering the elevation-plot-hub for the first time
   * Idempotent - won't overwrite existing user data
   *
   * @param serviceId - The service ID
   * @param templates - Array of EFE template objects from cachedTemplates('efe')
   */
  async seedFromTemplates(serviceId: string, templates: any[]): Promise<void> {
    console.log(`[EfeFieldRepo] Seeding ${templates.length} templates for service ${serviceId}`);

    // Filter templates where Auto = 'Yes' (rooms that auto-appear)
    const autoTemplates = templates.filter((t: any) =>
      t.Auto === 'Yes' || t.Auto === true || t.Auto === 1
    );

    if (autoTemplates.length === 0) {
      console.log('[EfeFieldRepo] No auto templates to seed');
      return;
    }

    // Check which fields already exist (don't overwrite user data)
    const existingKeys = new Set<string>();
    const existingFields = await db.efeFields
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    existingFields.forEach(f => existingKeys.add(f.key));

    // Build new fields to insert
    const newFields: EfeField[] = [];
    const now = Date.now();

    for (const template of autoTemplates) {
      const roomName = template.RoomName;
      if (!roomName) continue;

      const key = `${serviceId}:${roomName}`;

      // Skip if already exists (preserve user data)
      if (existingKeys.has(key)) {
        continue;
      }

      // Extract elevation points from template
      const elevationPoints: EfePoint[] = [];
      for (let i = 1; i <= 20; i++) {
        const pointColumnName = `Point${i}Name`;
        const pointName = template[pointColumnName];

        if (pointName && pointName.trim() !== '') {
          elevationPoints.push({
            pointNumber: i,
            pointId: null,
            tempPointId: null,
            name: pointName,
            value: '',
            photoCount: 0
          });
        }
      }

      const field: EfeField = {
        key,
        serviceId,
        roomName,
        templateId: template.TemplateID || template.PK_ID,
        efeId: null,
        tempEfeId: null,
        isSelected: false,
        organization: template.Organization || 999999,
        pointCount: template.PointCount || elevationPoints.length,
        notes: '',
        fdf: '',
        location: '',
        elevationPoints,
        fdfPhotos: {},
        rev: 0,
        updatedAt: now,
        dirty: false  // Not dirty - no user changes yet
      };

      newFields.push(field);
    }

    if (newFields.length > 0) {
      // Bulk insert in a single transaction for performance
      await db.transaction('rw', db.efeFields, async () => {
        await db.efeFields.bulkAdd(newFields);
      });
      console.log(`[EfeFieldRepo] Seeded ${newFields.length} new room templates`);
    } else {
      console.log('[EfeFieldRepo] All room templates already exist, no seeding needed');
    }
  }

  /**
   * Merge existing EFE rooms into EFE fields
   * Called after seeding to apply user's existing room selections
   *
   * @param serviceId - The service ID
   * @param rooms - Array of existing EFE room records from cachedServiceData
   */
  async mergeExistingRooms(serviceId: string, rooms: any[]): Promise<void> {
    if (rooms.length === 0) {
      return;
    }

    console.log(`[EfeFieldRepo] Merging ${rooms.length} existing rooms`);

    const now = Date.now();

    await db.transaction('rw', db.efeFields, async () => {
      for (const room of rooms) {
        const roomName = room.RoomName;
        if (!roomName) continue;

        const key = `${serviceId}:${roomName}`;
        const existing = await db.efeFields.where('key').equals(key).first();

        const efeId = room.EFEID || room.PK_ID || null;
        const tempEfeId = room._tempId || null;

        if (existing) {
          // Update existing field with room data
          await db.efeFields.update(existing.id!, {
            isSelected: true,
            efeId: efeId ? String(efeId) : null,
            tempEfeId: tempEfeId ? String(tempEfeId) : null,
            organization: room.Organization ?? existing.organization,
            notes: room.Notes || existing.notes,
            fdf: room.FDF || existing.fdf,
            location: room.Location || existing.location,
            updatedAt: now,
            dirty: false  // Existing data from server is not dirty
          });
        } else {
          // Room exists in server but not in templates - add it
          // This handles renamed rooms and custom rooms
          const newField: EfeField = {
            key,
            serviceId,
            roomName,
            templateId: room.TemplateID || 0,
            efeId: efeId ? String(efeId) : null,
            tempEfeId: tempEfeId ? String(tempEfeId) : null,
            isSelected: true,
            organization: room.Organization ?? 999999,
            pointCount: room.PointCount || 0,
            notes: room.Notes || '',
            fdf: room.FDF || '',
            location: room.Location || '',
            elevationPoints: [],  // Will be loaded when entering room
            fdfPhotos: {},
            rev: 0,
            updatedAt: now,
            dirty: false
          };
          await db.efeFields.add(newField);
        }
      }
    });

    console.log(`[EfeFieldRepo] Merged ${rooms.length} rooms`);
  }

  /**
   * Create point records for a room when it's first added
   * This generates tempPointIds and queues points for sync
   * Called from elevation-plot-hub when user adds a room
   *
   * DEXIE-FIRST: Points are created upfront with temp IDs so:
   * - room-elevation page loads instantly from Dexie
   * - All buttons are enabled (points have IDs)
   * - No API calls needed when entering room
   *
   * @param serviceId - The service ID
   * @param roomName - The room name
   * @param tempEfeId - The temp EFE ID for the room (links points to room)
   * @param foundationDataService - Service for creating pending records
   * @returns Array of created EfePoints with tempPointIds
   */
  async createPointRecordsForRoom(
    serviceId: string,
    roomName: string,
    tempEfeId: string,
    foundationDataService: any  // For creating pending records
  ): Promise<EfePoint[]> {
    const key = `${serviceId}:${roomName}`;
    const existing = await db.efeFields.where('key').equals(key).first();

    if (!existing) {
      throw new Error(`[EfeFieldRepo] EfeField not found for room: ${roomName}`);
    }

    if (existing.elevationPoints.length === 0) {
      console.log(`[EfeFieldRepo] No elevation points to create for room: ${roomName}`);
      return [];
    }

    console.log(`[EfeFieldRepo] Creating ${existing.elevationPoints.length} point records for room: ${roomName}`);

    const updatedPoints: EfePoint[] = [];
    const now = Date.now();

    for (const point of existing.elevationPoints) {
      // Skip if point already has an ID (shouldn't happen for new rooms)
      if (point.pointId || point.tempPointId) {
        console.log(`[EfeFieldRepo] Point ${point.pointNumber} already has ID, skipping`);
        updatedPoints.push(point);
        continue;
      }

      // Generate unique tempPointId
      const tempPointId = `temp_point_${now}_${point.pointNumber}`;

      // Create pending record for sync via foundationDataService
      // This queues the point for background sync to the backend
      const pointData = {
        EFEID: tempEfeId,  // Link to room via tempEfeId
        PointName: point.name
      };

      try {
        // Queue for sync - this creates a pending record
        await foundationDataService.createEFEPoint(pointData, tempEfeId);
        console.log(`[EfeFieldRepo] Queued point ${point.pointNumber} (${point.name}) for sync with tempId: ${tempPointId}`);
      } catch (err) {
        console.error(`[EfeFieldRepo] Failed to queue point ${point.pointNumber}:`, err);
        // Continue anyway - point will still be in Dexie
      }

      updatedPoints.push({
        ...point,
        tempPointId,
        pointId: null  // Will be set after sync
      });
    }

    // Update Dexie with tempPointIds
    await db.transaction('rw', db.efeFields, async () => {
      await db.efeFields.update(existing.id!, {
        elevationPoints: updatedPoints,
        updatedAt: Date.now()
      });
    });

    console.log(`[EfeFieldRepo] Created ${updatedPoints.length} point records with temp IDs`);
    return updatedPoints;
  }

  /**
   * Add a room that was created by the user (not from template)
   * This handles duplicate rooms like "Bedroom #2"
   */
  async addRoom(
    serviceId: string,
    roomName: string,
    templateId: number | string,
    organization: number,
    efeId: string | null,
    tempEfeId: string | null,
    elevationPoints: EfePoint[]
  ): Promise<void> {
    const key = `${serviceId}:${roomName}`;
    const now = Date.now();

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        // Update existing
        await db.efeFields.update(existing.id!, {
          isSelected: true,
          efeId,
          tempEfeId,
          organization,
          elevationPoints,
          rev: existing.rev + 1,
          updatedAt: now,
          dirty: true
        });
      } else {
        // Add new
        const newField: EfeField = {
          key,
          serviceId,
          roomName,
          templateId,
          efeId,
          tempEfeId,
          isSelected: true,
          organization,
          pointCount: elevationPoints.length,
          notes: '',
          fdf: '',
          location: '',
          elevationPoints,
          fdfPhotos: {},
          rev: 0,
          updatedAt: now,
          dirty: true
        };
        await db.efeFields.add(newField);
      }
    });

    console.log(`[EfeFieldRepo] Added/updated room: ${roomName}`);
  }

  // ============================================================================
  // REACTIVE READS - Live queries that auto-update on change
  // ============================================================================

  /**
   * Get all EFE fields (rooms) for a service as reactive Observable
   * This is the primary method for rendering elevation-plot-hub page
   *
   * @returns Observable that emits on ANY change to rooms in this service
   */
  getFieldsForService$(serviceId: string): Observable<EfeField[]> {
    return db.liveEfeFields$(serviceId);
  }

  /**
   * Get a single EFE field (room) by key as reactive Observable
   */
  getField$(key: string): Observable<EfeField | undefined> {
    return db.liveEfeField$(key);
  }

  /**
   * Get a single EFE field by service and room name as reactive Observable
   */
  getFieldByRoom$(serviceId: string, roomName: string): Observable<EfeField | undefined> {
    return db.liveEfeFieldByRoom$(serviceId, roomName);
  }

  /**
   * Get all dirty EFE fields (pending sync) as reactive Observable
   */
  getDirtyFields$(): Observable<EfeField[]> {
    return db.liveDirtyEfeFields$();
  }

  // ============================================================================
  // NON-REACTIVE READS - For one-time queries
  // ============================================================================

  /**
   * Get all EFE fields (rooms) for a service (non-reactive, one-time read)
   */
  async getFieldsForService(serviceId: string): Promise<EfeField[]> {
    return db.efeFields.where('serviceId').equals(serviceId).toArray();
  }

  /**
   * Get a single EFE field by key (non-reactive)
   */
  async getField(key: string): Promise<EfeField | undefined> {
    return db.efeFields.where('key').equals(key).first();
  }

  /**
   * Get a single EFE field by service and room name (non-reactive)
   */
  async getFieldByRoom(serviceId: string, roomName: string): Promise<EfeField | undefined> {
    return db.efeFields
      .where('[serviceId+roomName]')
      .equals([serviceId, roomName])
      .first();
  }

  /**
   * Get all dirty EFE fields (non-reactive, for sync service)
   */
  async getDirtyFields(): Promise<EfeField[]> {
    return db.efeFields.where('dirty').equals(1).toArray();
  }

  /**
   * Check if EFE fields exist for a service (for seeding check)
   */
  async hasFieldsForService(serviceId: string): Promise<boolean> {
    const count = await db.efeFields.where('serviceId').equals(serviceId).count();
    return count > 0;
  }

  // ============================================================================
  // WRITE-THROUGH - Update fields and mark as dirty
  // ============================================================================

  /**
   * Update room selection state
   */
  async setRoomSelected(
    serviceId: string,
    roomName: string,
    isSelected: boolean,
    efeId?: string | null,
    tempEfeId?: string | null
  ): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        const patch: Partial<EfeField> = {
          isSelected,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        };
        if (efeId !== undefined) patch.efeId = efeId;
        if (tempEfeId !== undefined) patch.tempEfeId = tempEfeId;

        await db.efeFields.update(existing.id!, patch);
      }
    });
  }

  /**
   * Update room notes
   */
  async setRoomNotes(serviceId: string, roomName: string, notes: string): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          notes,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });
  }

  /**
   * Update room FDF value
   */
  async setRoomFdf(serviceId: string, roomName: string, fdf: string): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          fdf,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });
  }

  /**
   * Update room location
   */
  async setRoomLocation(serviceId: string, roomName: string, location: string): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          location,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });
  }

  /**
   * Update elevation point value
   */
  async setPointValue(
    serviceId: string,
    roomName: string,
    pointNumber: number,
    value: string
  ): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        const elevationPoints = [...existing.elevationPoints];
        const pointIndex = elevationPoints.findIndex(p => p.pointNumber === pointNumber);

        if (pointIndex >= 0) {
          elevationPoints[pointIndex] = {
            ...elevationPoints[pointIndex],
            value
          };

          await db.efeFields.update(existing.id!, {
            elevationPoints,
            rev: existing.rev + 1,
            updatedAt: Date.now(),
            dirty: true
          });
        }
      }
    });
  }

  /**
   * Update elevation point's real ID (after sync)
   */
  async setPointId(
    serviceId: string,
    roomName: string,
    pointNumber: number,
    pointId: string
  ): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        const elevationPoints = [...existing.elevationPoints];
        const pointIndex = elevationPoints.findIndex(p => p.pointNumber === pointNumber);

        if (pointIndex >= 0) {
          elevationPoints[pointIndex] = {
            ...elevationPoints[pointIndex],
            pointId,
            tempPointId: null
          };

          await db.efeFields.update(existing.id!, {
            elevationPoints,
            updatedAt: Date.now()
          });
        }
      }
    });
  }

  /**
   * Update point photo count
   */
  async updatePointPhotoCount(
    serviceId: string,
    roomName: string,
    pointNumber: number,
    photoCount: number
  ): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        const elevationPoints = [...existing.elevationPoints];
        const pointIndex = elevationPoints.findIndex(p => p.pointNumber === pointNumber);

        if (pointIndex >= 0) {
          elevationPoints[pointIndex] = {
            ...elevationPoints[pointIndex],
            photoCount
          };

          await db.efeFields.update(existing.id!, {
            elevationPoints,
            updatedAt: Date.now()
          });
        }
      }
    });
  }

  /**
   * Update FDF photo metadata
   */
  async setFdfPhoto(
    serviceId: string,
    roomName: string,
    photoKey: string,  // 'top', 'bottom', 'topDetails', 'bottomDetails'
    photo: EfeFdfPhoto
  ): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        const fdfPhotos = { ...existing.fdfPhotos, [photoKey]: photo };

        await db.efeFields.update(existing.id!, {
          fdfPhotos,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });
  }

  /**
   * Rename a room
   */
  async renameRoom(serviceId: string, oldRoomName: string, newRoomName: string): Promise<void> {
    const oldKey = `${serviceId}:${oldRoomName}`;
    const newKey = `${serviceId}:${newRoomName}`;
    const now = Date.now();

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(oldKey).first();

      if (existing) {
        // Create new entry with new room name
        const newField: EfeField = {
          ...existing,
          id: undefined,  // Let Dexie auto-generate
          key: newKey,
          roomName: newRoomName,
          rev: existing.rev + 1,
          updatedAt: now,
          dirty: true
        };

        // Delete old entry and add new one
        await db.efeFields.delete(existing.id!);
        await db.efeFields.add(newField);
      }
    });

    console.log(`[EfeFieldRepo] Renamed room: ${oldRoomName} -> ${newRoomName}`);
  }

  /**
   * Delete/unselect a room (mark as unselected, clear IDs)
   */
  async deleteRoom(serviceId: string, roomName: string): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        // Reset to template state (unselected)
        await db.efeFields.update(existing.id!, {
          isSelected: false,
          efeId: null,
          tempEfeId: null,
          notes: '',
          fdf: '',
          location: '',
          fdfPhotos: {},
          // Reset elevation point values but keep structure
          elevationPoints: existing.elevationPoints.map(p => ({
            ...p,
            pointId: null,
            tempPointId: null,
            value: '',
            photoCount: 0
          })),
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });

    console.log(`[EfeFieldRepo] Deleted/unselected room: ${roomName}`);
  }

  /**
   * Update room organization (sort order)
   */
  async setRoomOrganization(serviceId: string, roomName: string, organization: number): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          organization,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });
  }

  // ============================================================================
  // SYNC HELPERS - For background sync service
  // ============================================================================

  /**
   * Mark a room as synced (clear dirty flag, set efeId)
   * Called by sync service after successful backend write
   */
  async markSynced(key: string, efeId: string): Promise<void> {
    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          efeId,
          tempEfeId: null,
          dirty: false
        });
      }
    });
  }

  /**
   * Update room with real EFE ID after sync
   */
  async updateEfeId(serviceId: string, roomName: string, efeId: string): Promise<void> {
    const key = `${serviceId}:${roomName}`;

    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          efeId,
          tempEfeId: null,
          dirty: false
        });
      }
    });

    console.log(`[EfeFieldRepo] Updated efeId for room ${roomName}: ${efeId}`);
  }

  /**
   * Set temp EFE ID (called when creating pending room record)
   */
  async setTempEfeId(key: string, tempEfeId: string): Promise<void> {
    await db.transaction('rw', db.efeFields, async () => {
      const existing = await db.efeFields.where('key').equals(key).first();

      if (existing) {
        await db.efeFields.update(existing.id!, {
          tempEfeId
        });
      }
    });
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clear all EFE fields for a service (used when clearing cache)
   */
  async clearFieldsForService(serviceId: string): Promise<void> {
    await db.efeFields.where('serviceId').equals(serviceId).delete();
    console.log(`[EfeFieldRepo] Cleared all fields for service: ${serviceId}`);
  }

  /**
   * Clear all EFE fields (full reset)
   */
  async clearAll(): Promise<void> {
    await db.efeFields.clear();
    console.log('[EfeFieldRepo] Cleared all EFE fields');
  }
}

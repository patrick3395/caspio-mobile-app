# S3 Upload Process - Offline Integration Review

## Current S3 Upload Flow (Working Perfectly Online)

### The 3-Step Process:

```typescript
// From caspio.service.ts: uploadVisualsAttachWithS3()

Step 1: Create Caspio Attachment Record
├─ Endpoint: /tables/LPS_Services_Visuals_Attach/records
├─ Method: POST
├─ Data: { VisualID, Annotation, Drawings }
└─ Returns: { AttachID: 123 } ✅

Step 2: Upload File to S3
├─ Endpoint: /api/s3/upload (YOUR AWS BACKEND)
├─ Method: POST (FormData)
├─ Data: { file, tableName, attachId: 123 }
└─ Returns: { s3Key: "visual_472_1702345678_abc123.jpg" } ✅

Step 3: Update Caspio Record with S3 Key
├─ Endpoint: /tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=123
├─ Method: PUT
├─ Data: { Attachment: "visual_472_1702345678_abc123.jpg" }
└─ Returns: Success ✅
```

**Total:** 3 API calls, tightly linked (each depends on previous result)

## Challenge: Offline Queuing for Linked Steps

### The Problem:

Can't queue as 3 separate requests because each needs result from previous:
- Step 2 needs `AttachID` from Step 1
- Step 3 needs `s3Key` from Step 2

### Solutions:

#### Option A: Queue as Single Atomic Operation (Simpler)

Queue the entire 3-step process as ONE request:

```typescript
await indexedDb.addPendingRequest({
  type: 'UPLOAD_VISUAL_PHOTO_S3',  // Custom type
  method: 'POST',
  data: {
    visualId: 472,
    file: <stored as Blob>,
    drawingsData: "...",
    caption: "Water damage"
  },
  status: 'pending',
  // When syncing: Run all 3 steps in sequence
});
```

**Pros:**
- Simpler to implement
- Atomic (all or nothing)
- Easier error handling

**Cons:**
- If step 2 fails, must redo step 1
- Harder to show progress

#### Option B: Queue with Result Chaining (Complex but Flexible)

Queue 3 linked requests with placeholders:

```typescript
// Request 1
const req1 = {
  requestId: "req_001",
  data: { VisualID: 472, Annotation: "" },
  dependencies: []
};

// Request 2 (uses result from req1)
const req2 = {
  requestId: "req_002",
  data: {
    attachId: "{{req_001.result.AttachID}}",  // Placeholder
    file: <blob>
  },
  dependencies: ["req_001"]
};

// Request 3 (uses results from req1 and req2)
const req3 = {
  requestId: "req_003",
  data: {
    attachId: "{{req_001.result.AttachID}}",
    s3Key: "{{req_002.result.s3Key}}"
  },
  dependencies: ["req_001", "req_002"]
};
```

**Pros:**
- Resume from any step
- Better error recovery
- Can show detailed progress

**Cons:**
- Complex placeholder resolution
- More code to maintain

## Recommended Approach: Option A

**Why:** Your S3 upload is already atomic (all 3 steps or none). Keep it that way.

### Implementation:

```typescript
// In engineers-foundation-data.service.ts

async uploadVisualPhoto(
  visualId: number,
  file: File,
  caption: string,
  drawings?: string,
  originalFile?: File
): Promise<any> {
  
  // Check if online
  if (navigator.onLine) {
    // Use existing working S3 upload directly
    return this.caspioService.uploadVisualsAttachWithS3(visualId, drawings || '', file);
  }

  // OFFLINE: Queue for later
  const tempAttachId = this.tempId.generateTempId('image' as any);
  const thumbnailUrl = URL.createObjectURL(file);

  // Store file in IndexedDB
  await this.storeFileForOfflineUpload(tempAttachId, file, originalFile);

  // Queue the entire 3-step S3 upload as one atomic operation
  await this.indexedDb.addPendingRequest({
    type: 'UPLOAD_VISUAL_PHOTO_S3',  // Custom type
    tempId: tempAttachId,
    endpoint: 'S3_UPLOAD',  // Special marker
    method: 'POST',
    data: {
      visualId: visualId,
      fileId: tempAttachId,  // Reference to stored file
      drawingsData: drawings || '',
      caption: caption || '',
      fileName: file.name,
      hasOriginalFile: !!originalFile,
    },
    dependencies: [],
    status: 'pending',
    priority: 'high',
  });

  // Trigger sync attempt
  this.backgroundSync.triggerSync();

  // Return placeholder for immediate UI display
  return {
    AttachID: tempAttachId,
    VisualID: visualId,
    Annotation: caption,
    _tempId: tempAttachId,
    _syncing: true,
    _thumbnailUrl: thumbnailUrl,  // UI can display this
  };
}
```

### Background Sync Enhancement:

```typescript
// In background-sync.service.ts

private async performSync(request: PendingRequest): Promise<any> {
  // Handle S3 photo uploads specially
  if (request.type === 'UPLOAD_VISUAL_PHOTO_S3') {
    return this.syncS3PhotoUpload(request);
  }
  
  // ... existing code
}

private async syncS3PhotoUpload(request: PendingRequest): Promise<any> {
  const data = request.data;

  // 1. Get file from IndexedDB
  const file = await this.getStoredFile(data.fileId);
  if (!file) {
    throw new Error('File not found in storage');
  }

  // 2. Resolve Visual ID if temp
  let visualId = data.visualId;
  if (this.tempId.isTempId(String(visualId))) {
    const realId = await this.indexedDb.getRealId(String(visualId));
    if (realId) {
      visualId = parseInt(realId);
    } else {
      throw new Error('Visual not synced yet');
    }
  }

  // 3. Call the EXISTING working S3 upload method
  // (This needs access to CaspioService)
  // For now, call the same 3-step process manually:
  
  return await this.execute3StepS3Upload(visualId, file, data.drawingsData);
}

private async execute3StepS3Upload(visualId: number, file: File, drawingsData: string): Promise<any> {
  // Execute the exact same 3 steps as the working version
  // Step 1: Create record
  // Step 2: Upload to S3  
  // Step 3: Update with S3 key
  // (Implement the same fetch calls as uploadVisualsAttachWithS3)
}
```

## Missing Backend Endpoint

**Your code calls:** `${environment.apiGatewayUrl}/api/s3/upload`

**But this doesn't exist in your backend yet!**

**Need to create:** `backend/src/routes/s3Routes.ts`

```typescript
router.post('/s3/upload', upload.single('file'), async (req, res) => {
  const { tableName, attachId } = req.body;
  const file = req.file;

  // Upload to S3 bucket
  const s3Key = await uploadToS3(file);

  res.json({ s3Key });
});
```

## What Needs to Be Done:

### Backend (AWS):
1. ✅ Create `/api/s3/upload` endpoint
2. ✅ Integrate with your S3 bucket
3. ✅ Handle file uploads
4. ✅ Return s3Key

### Frontend:
1. ✅ Detect online/offline
2. ✅ Queue 3-step process when offline
3. ✅ Store file in IndexedDB
4. ✅ Show thumbnail from stored file
5. ✅ Background sync replays 3 steps when online
6. ✅ Handle temp Visual IDs

## Current State Analysis:

**What Works:**
- ✅ S3 upload when online (perfect!)
- ✅ AWS retry logic
- ✅ Request logging

**What's Missing:**
- ❌ `/api/s3/upload` backend endpoint
- ❌ Offline file storage
- ❌ Queuing for offline S3 uploads
- ❌ Thumbnail display from IndexedDB

## Recommended Implementation Order:

### Part 1: Create Backend S3 Endpoint (30 minutes)
```typescript
// backend/src/routes/s3Routes.ts
// Upload file to your S3 bucket
// Return s3Key
```

### Part 2: Offline File Storage (1 hour)
```typescript
// Store file in IndexedDB when offline
// Retrieve and display thumbnail
```

### Part 3: Queue 3-Step Process (2 hours)
```typescript
// Queue as atomic operation
// Background sync replays when online
```

### Part 4: Handle Temp Visual IDs (1 hour)
```typescript
// Wait for Visual to be created
// Then upload photos
```

**Total:** ~5 hours for complete S3 offline support

## Key Insights:

1. **Your S3 process is well-designed** - 3 clear steps
2. **It's already atomic** - all or nothing
3. **Perfect for offline queuing** - just replay the same steps
4. **Backend needs S3 upload route** - missing piece

**Want me to:**
1. Create the backend S3 upload endpoint?
2. Implement offline queuing for your S3 process?
3. Test with actual offline scenarios?

This will make S3 uploads work in dead zones!


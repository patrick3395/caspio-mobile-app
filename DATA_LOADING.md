  Data Loading Flow - Engineers Foundation Template

  1. CONTAINER PAGE (engineers-foundation-container.page.ts)

  Entry Point - First thing that runs when entering the template

  What happens:

  1. Route params subscription (line 79): Gets projectId and serviceId from URL
  2. Service check (line 94): Compares lastLoadedServiceId !== newServiceId
    - If SAME service: Skips download, no loading overlay
    - If NEW service: Shows "Preparing Template" overlay and downloads
  3. Template download (line 130): Calls downloadTemplateData()

  What gets downloaded to IndexedDB:

  - Visual templates (Comments, Limitations, Deficiencies definitions)
  - EFE templates (Room definitions)
  - Service record
  - Project record
  - Existing visuals for this service
  - Visual attachments (photo metadata)

  Key insight: This is the ONLY place that shows the "Preparing Template" loading overlay. After this completes,  
  isTemplateReady() = true and all subsequent navigation uses cached data.

  ---
  2. STRUCTURAL SYSTEMS HUB (structural-systems-hub.page.ts)

  The category list page (Foundations, Grading and Drainage, etc.)

  ngOnInit() (line 51):

  1. Gets projectId and serviceId from parent route snapshot
  2. Calls loadData()

  loadData() (line 154):

  Step 1: Read from IndexedDB (PARALLEL)
  ├── indexedDb.getCachedTemplates('visual')     → ~99 templates
  └── offlineTemplate.getService(serviceId)      → service record

  Step 2: Check if cache exists
  ├── Has templates AND service? → NO loading spinner
  └── Missing cache?             → Show loading spinner

  Step 3: Load categories from templates
  ├── Filter for TypeID === 1 (visual templates)
  ├── Extract unique Category names
  └── For each category, count deficiencies from cached visuals

  ionViewWillEnter() (line 133):

  - Called when navigating BACK to this page
  - Reloads categories from cache to update deficiency counts
  - Does NOT show loading spinner (just reads from IndexedDB)

  Data sources:
  ┌───────────────────┬──────────────────────────────────────────────────────┬──────────┐
  │       Data        │                        Source                        │  Speed   │
  ├───────────────────┼──────────────────────────────────────────────────────┼──────────┤
  │ Templates         │ indexedDb.getCachedTemplates('visual')               │ ~10-50ms │
  ├───────────────────┼──────────────────────────────────────────────────────┼──────────┤
  │ Service           │ offlineTemplate.getService(serviceId)                │ ~10-50ms │
  ├───────────────────┼──────────────────────────────────────────────────────┼──────────┤
  │ Deficiency counts │ indexedDb.getCachedServiceData(serviceId, 'visuals') │ ~10-50ms │
  └───────────────────┴──────────────────────────────────────────────────────┴──────────┘
  ---
  3. CATEGORY DETAIL PAGE (category-detail.page.ts)

  The actual form page with Comments, Limitations, Deficiencies, and Photos

  ngOnInit() (line 245):

  1. Gets categoryName from route params
  2. Gets projectId and serviceId from parent route
  3. Calls loadData()

  loadData() - THE BIG ONE (line 1418):

  STEP 0: BULK DATA LOAD (ONE PARALLEL BATCH)
  ├── indexedDb.getCachedTemplates('visual')              → allTemplates (99)
  ├── indexedDb.getCachedServiceData(serviceId, 'visuals')→ visuals (existing selections)
  ├── indexedDb.getAllPendingPhotosGroupedByVisual()      → pendingPhotos (old system)
  ├── indexedDb.getPendingRequests()                      → pendingRequests
  ├── localImageService.getImagesForService(serviceId)   → allLocalImages (new system)
  ├── indexedDb.getAllCachedPhotosForService(serviceId)  → cachedPhotos (base64)
  └── indexedDb.getAllCachedAnnotatedImagesForService()  → annotatedImages (drawings)

  STEP 1: Load templates into UI (CPU only, instant)
  ├── Filter: template.TypeID === 1 && template.Category === categoryName
  └── Organize into organizedData.comments/limitations/deficiencies

  STEP 2: Load existing visuals (CPU only, instant)
  ├── Filter: visual.Category === categoryName
  ├── Match visual to template item by VisualTemplateID or Name
  ├── Mark item as selected (checkbox checked)
  └── Store visualRecordIds[key] = visualId

  STEP 3: Restore pending photos (for offline uploads)
  └── Adds photos from old pending system to visualPhotos[key]

  STEP 3.5: Show initial photo counts from LocalImages
  └── Sets photoCountsByKey[key] for skeleton display

  STEP 3.6: Hide loading spinner, show page
  └── loading = false, detectChanges()

  STEP 3.7: BACKGROUND PHOTO LOADING (non-blocking)
  ├── requestIdleCallback or setTimeout(50ms)
  ├── Load attachments for all visuals in category
  └── Pre-load photo URLs for display

  Photo Loading - loadPhotosForVisual() (line 2510):

  LAZY LOADING: Photos only load when user clicks to expand a visual

  When user expands photos for a visual:

  1. Get attachments from bulk cache (already loaded)
     └── bulkAttachmentsMap.get(visualId)

  2. Get pending photos from bulk cache (old system)
     └── bulkPendingPhotosMap.get(visualId)

  3. Get LocalImages from bulk cache (new system)
     └── bulkLocalImagesMap.get(visualId)

  4. For each attachment:
     ├── Check cachedPhotosMap for base64 data
     ├── Check annotatedImagesMap for drawings
     ├── If S3 key → fetch signed URL
     └── Add to visualPhotos[key]

  5. For each LocalImage:
     ├── Read blob from IndexedDB
     ├── Create object URL for display
     └── Add to visualPhotos[key]

  ---
  Photo/Thumbnail Display

  Where photos come from:
  ┌──────────────────────┬─────────────────────────────────────────────┬───────────────────────────────────┐      
  │      Photo Type      │                   Source                    │            Display URL            │      
  ├──────────────────────┼─────────────────────────────────────────────┼───────────────────────────────────┤      
  │ Server synced        │ S3 bucket                                   │ caspioService.getS3FileUrl(s3Key) │      
  ├──────────────────────┼─────────────────────────────────────────────┼───────────────────────────────────┤      
  │ Cached               │ indexedDb.getCachedPhoto(attachId)          │ Base64 data URL                   │      
  ├──────────────────────┼─────────────────────────────────────────────┼───────────────────────────────────┤      
  │ LocalImage (pending) │ indexedDb.localImages table                 │ Blob URL from IndexedDB           │      
  ├──────────────────────┼─────────────────────────────────────────────┼───────────────────────────────────┤      
  │ Annotated            │ indexedDb.getCachedAnnotatedImage(attachId) │ Base64 with drawings              │      
  └──────────────────────┴─────────────────────────────────────────────┴───────────────────────────────────┘      
  Photo display priority:

  1. LocalImage blob (if exists and pending upload)
  2. Cached annotated image (if has drawings)
  3. Cached base64 (if downloaded)
  4. S3 URL (fetch on-demand if not cached)

  ---
  Summary Flow Diagram

  ┌─────────────────────────────────────────────────────────────────┐
  │                    USER OPENS TEMPLATE                          │
  └─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │            CONTAINER (engineers-foundation-container)            │
  │                                                                 │
  │  if (NEW SERVICE) {                                             │
  │    Show "Preparing Template" overlay                            │
  │    downloadTemplateForOffline() → IndexedDB                     │
  │    Hide overlay when done                                       │
  │  }                                                              │
  └─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │              HUB (structural-systems-hub)                        │
  │                                                                 │
  │  loadData():                                                    │
  │    1. Read templates from IndexedDB (instant)                   │
  │    2. Read service from IndexedDB (instant)                     │
  │    3. Filter categories from templates                          │
  │    4. Count deficiencies from cached visuals                    │
  │    5. loading = false (no spinner if cache exists)              │
  └─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │            CATEGORY DETAIL (category-detail)                     │
  │                                                                 │
  │  loadData():                                                    │
  │    1. BULK read ALL data from IndexedDB (one parallel call)     │
  │    2. Filter templates for this category                        │
  │    3. Match existing visuals to templates                       │
  │    4. Show page immediately                                     │
  │    5. Load photos in BACKGROUND (non-blocking)                  │
  │                                                                 │
  │  Photos:                                                        │
  │    - Loaded LAZILY when user clicks expand                      │
  │    - Uses bulkAttachmentsMap, bulkLocalImagesMap (pre-loaded)   │
  │    - Fetches S3 URLs on-demand if not cached                    │
  └─────────────────────────────────────────────────────────────────┘

  ---
  Key Points

  1. Everything reads from IndexedDB - API calls only happen during initial download or when cache is empty       
  2. loading: boolean = true - Pages start with loading=true and set it false after data loads
  3. Photos are LAZY - They don't load until user clicks to expand
  4. Bulk caching - The category detail page loads ALL data in ONE parallel Promise.all() to minimize IndexedDB   
  reads
  5. No re-download within same service - The container tracks lastLoadedServiceId to prevent re-downloading      

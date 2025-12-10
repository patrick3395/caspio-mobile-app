# Quick Integration Guide - 5 Minutes Per Page

## Add Offline Persistence to Any Page in 3 Steps

### Step 1: Import the Service (1 line)

```typescript
import { OfflineRestoreService } from '../../services/offline-restore.service';
```

### Step 2: Inject the Service (1 line)

**If using inject():**
```typescript
private offlineRestore = inject(OfflineRestoreService);
```

**If using constructor:**
```typescript
constructor(
  // ... existing services
  private offlineRestore: OfflineRestoreService
) {}
```

### Step 3: Restore in ngOnInit (3 lines)

**Add at the START of ngOnInit:**

```typescript
async ngOnInit() {
  // RESTORE pending items from IndexedDB
  const pendingVisuals = await this.offlineRestore.restorePendingVisuals(this.serviceId);
  this.visuals = [...pendingVisuals, ...this.visuals];  // Prepend pending items

  // ... rest of existing ngOnInit code ...
}
```

**That's it!** Visuals now persist across page reloads.

---

## For Photo Uploads (Add to Upload Method)

### In your uploadPhotoForVisual method:

**ADD one line after creating object URL:**

```typescript
const objectUrl = URL.createObjectURL(photo);
const tempId = `temp_${Date.now()}_${Math.random()}`;

// PERSIST: Store file in IndexedDB
await this.indexedDb.storePhotoFile(tempId, photo, visualId, caption);

// ... rest of existing code ...
```

**ADD after successful upload:**

```typescript
// After upload succeeds
await this.indexedDb.deleteStoredFile(tempId);  // Cleanup
```

---

## Which Pages Need This?

### EFE (Engineers Foundation):
- `engineers-foundation.page.ts` - Main EFE page (15k lines)
- Just add 3 lines to ngOnInit

### HUD:
- `hud.page.ts` - Main HUD page (9k lines)
- Just add 3 lines to ngOnInit

### LBW:
- `lbw.page.ts` - Main LBW page  
- Just add 3 lines to ngOnInit

### DTE:
- `dte.page.ts` - Main DTE page
- Just add 3 lines to ngOnInit

**Total:** ~15 minutes to add to all pages!

---

## Testing

### Test Scenario 1: Visual Persistence

```
1. Go to Structural Systems
2. Turn on airplane mode
3. Create a Visual
4. See it appear ✅
5. Refresh page (F5)
6. Visual still there! ✅
7. Turn off airplane mode
8. Wait 30 seconds
9. Visual syncs to server ✅
```

### Test Scenario 2: Photo Persistence

```
1. Create Visual (online or offline)
2. Turn on airplane mode
3. Upload photo
4. See thumbnail ✅
5. Close app
6. Reopen app
7. Photo still there with "uploading" indicator ✅
8. Turn off airplane mode
9. Photo uploads to S3 ✅
10. Indicator disappears ✅
```

---

## The Beautiful Part

**You change almost NOTHING in your existing code!**

**Your sophisticated upload system:**
- Background upload queue ✅ Keeps working
- Parallel uploads ✅ Keeps working
- Retry logic ✅ Keeps working
- Optimistic UI ✅ Keeps working
- S3 integration ✅ Keeps working

**Just add:**
- 1 line: Store file
- 1 line: Store task
- 3 lines: Restore on start

**Result:** Everything works offline!

Ready to add these small changes to your pages?


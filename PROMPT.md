# Tasks

## Task 1: Elevation Plot Images Disappear During Navigation
Images in room-elevation disappear when navigating away and back during sync.
**Fix**: Copy pattern from `category-detail.page.ts` (Structural Systems) which works.
**File**: `src/app/pages/engineers-foundation/room-elevation/room-elevation.page.ts`

## Task 2: FDF Photos Not Syncing
FDF photos appear in sync queue but never sync. Clicking "Sync Now" does nothing.
**Fix**: Find and fix FDF photo sync handler.
**File**: Search for FDF photo sync code in services.

## Task 3: FDF Captions Not Syncing
FDF captions stuck in queue. Depends on Task 2 being fixed first.

## Commands
```bash
npm start
npm run build
```

## Rules
1. Use grep to find code in large files
2. Read files with offset/limit (max 500 lines)
3. Structural Systems = working reference

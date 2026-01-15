Implementation Plan: Eliminate Stale UI + Make Page Switching Instant Using Dexie as Source of Truth
Goal

Instant sheet/page switching (Foundations ↔ Walls ↔ back) with no 3-second loads.

No stale cache: any edit on any page must always be reflected when returning.

Single source of truth for UI state = IndexedDB (Dexie), with reactive subscriptions so UI re-renders automatically.

Core Design Rules (Non-Negotiable)

UI must never render from a “page cached snapshot” that can go stale.

All edits must be write-through to Dexie immediately (on change, or debounced on change).

Each page reads only its own sheet data via indexed query: [reportId + sheetKey].

Stable local IDs (do not depend on server IDs). For simple form fields:
id = "${reportId}:${sheetKey}:${fieldKey}"

Step 1 — Install / Dependencies

Add packages:

dexie

dexie-react-hooks

Ensure Dexie singleton is used (no re-instantiation per page).

Acceptance

Build compiles and Dexie DB can be opened from app entry.

Step 2 — Create Dexie Schema (Normalized Per Field)

Create a new Dexie table for field-level storage.

Table: fields

Row shape

id: string (PRIMARY KEY) → deterministic: ${reportId}:${sheetKey}:${fieldKey}

reportId: string

sheetKey: string (FOUNDATIONS, WALLS, etc.)

fieldKey: string (pierSpacingExterior, etc.)

value: any (string/number/boolean/object)

rev: number (increment on every local write)

updatedAt: number (Date.now())

dirty: boolean (true until backend sync ack)

Required indexes

id as primary

compound: [reportId+sheetKey]

compound: [reportId+sheetKey+fieldKey]

dirty

updatedAt

Acceptance

Running app creates DB and table.

Query by [reportId+sheetKey] works and is fast.

Step 3 — Implement Repository API (DB Read/Write Layer)

Create a file like dbRepo.ts with the following functions:

seedTemplate(reportId, templateData)

Input: templateData structured by sheet/field.

Must bulkPut all rows into fields.

Must be done in a single transaction.

getSheet(reportId, sheetKey)

Returns all rows for that sheet via:

where("[reportId+sheetKey]").equals([reportId, sheetKey]).toArray()

Converts rows into { [fieldKey]: value } object.

setField(reportId, sheetKey, fieldKey, value)

Must write-through with:

Transaction

Fetch existing row

Increment rev

Set dirty=true

Update updatedAt

put(...)

setFieldsBulk(reportId, sheetKey, patchObject)

For cases where page saves many fields at once.

Must bulkPut with proper rev increments (agent can choose strategy: set rev = existing+1 per key or use timestamp-based rev; simplest is per-row increment).

Acceptance

Calling setField updates DB row.

Calling getSheet returns updated value.

Step 4 — Implement Reactive Read Hook (Eliminate Stale Cache)

Create useSheet(reportId, sheetKey) using dexie-react-hooks.

useSheet(reportId, sheetKey)

Uses useLiveQuery to call getSheet(reportId, sheetKey).

Default return value while loading must be {} (not null) to avoid UI crashes.

Acceptance

Any DB write to a field in that sheet triggers an immediate re-render on that page.

Navigating away/back always shows latest values.

Step 5 — Refactor All Pages to Read from useSheet

For each sheet page (Foundations/Walls/etc.):

Remove any “cached state snapshot” logic (examples to delete: pageCache, useRef(initialData), global template object, etc.)

Replace with:

const data = useSheet(reportId, "FOUNDATIONS")

Inputs should bind directly to data[fieldKey]

Acceptance

No page uses a “load once, reuse forever” data object.

No data loss when navigating away/back.

Step 6 — Refactor Inputs to Write-Through to Dexie

Every input component must call setField(...) on change.

Performance requirement (debounce)

If writing on every keystroke is too heavy:

Implement a 150–300ms debounce per field.

But still must ensure writes happen quickly and reliably.

Implementation detail

Use a small helper hook like useDebouncedCallback.

Must flush debounce on blur/unmount so no edits are lost.

Acceptance

Edit Foundations, immediately go to Walls, back to Foundations → value persists and shows.

No reliance on backend sync for UI correctness.

Step 7 — Remove “Whole Template Object” as Rendering Source

If the app currently loads the entire template JSON into memory and uses it for rendering:

Keep it only for:

initial seedTemplate

generating export payload if needed

Do not render from it on page entry.

Do not “restore page state” from it.

Acceptance

Rendering is driven by Dexie reads, not the initial template blob.

Step 8 — Fix ID Swapping / Sync Mapping (Critical)

If backend sync creates server IDs or replaces keys:

DO NOT replace local id.

Store server IDs separately if needed:

e.g., serverFieldId (optional)

Sync must use local deterministic keys to update dirty=false.

Acceptance

After sync completes, UI remains correct.

No “record disappears” because IDs changed.

Step 9 — Implement Sync Queue Using dirty=true Rows

Create syncDirtyRows(reportId):

Query db.fields.where("dirty").equals(1) (or true) filtered by reportId if needed.

Send to backend.

On success:

mark those rows dirty=false (bulk update)

do NOT modify values unless server returns newer revision.

Conflict rule

If server returns data, only overwrite local if server version is newer than local rev/updatedAt.

Acceptance

Offline edits remain visible instantly.

Sync does not cause UI rollback.

Step 10 — Navigation Performance Target

After refactor:

Switching pages should not do “3-second loads”.

Each page reads only its sheet via index query.

UI should feel instant (<100ms typical on modern devices).

Acceptance

Repeated switching (100 times) does not create noticeable load time.

No stale values ever displayed after a save.

Final Acceptance Tests (Must Pass)

Stale cache test

Edit Foundations field → navigate to Walls → navigate back → edit is still visible.

Speed test

Switch between 5 sheets repeatedly → no multi-second blocking loads.

Offline-first test

Disable network → edit fields → navigate around → values persist.

Re-enable network → sync occurs → UI remains correct.

No ID mutation

After backend sync, previously entered fields still appear under same report/sheet.

Deliverables for Agent

db.ts (Dexie singleton schema)

dbRepo.ts (seed/get/set/sync functions)

useSheet.ts hook (reactive reads)

Refactored pages to use useSheet + setField

Sync worker (manual trigger or background interval)
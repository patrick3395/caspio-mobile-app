# Dexie-First Storage Control Plan (Spectora-Like) — Purging + Data Shrinking

Goal: Keep **instant page navigation** and offline reliability while preventing **storage bloat** (e.g., 350MB per report).
Approach mirrors Spectora V10 behavior: **local-first for active work** + **automatic cleanup after inactivity (~3 days)**.

---

## 1) Core Principles

### 1.1 Working Set vs Cloud Source of Truth
- **On-device (Dexie/IndexedDB)** is the *working set* used for instant UI + offline edits.
- **Server** is the long-term *source of truth* after successful sync.

### 1.2 Never Delete Unsynced Work
Local purge is only allowed if:
- `outboxCount == 0` (no pending uploads/mutations)
- AND `lastServerAckRevision >= lastLocalRevision` (server has confirmed latest edits)
- AND inspection is not currently open (`isOpen == false`)

If any of the above fails:
- **Do not purge**
- show a persistent banner/toast: **"Unsynced changes — connect to sync"**

---

## 2) Storage Tiers (What We Keep and For How Long)

### Tier A — Templates (Long-Lived, Small)
- Templates, field definitions, UI config
- Keep locally (versioned) for fast/offline rendering

### Tier B — Active Inspection Working Set (Large, Short-Lived)
This is where bloat happens:
- inspection JSON state / field values
- photos (full-res blobs), annotated renders, derived versions
- sync outbox queue and upload staging

### Tier C — Archived Inspection (Tiny, Long-Lived)
Keep only what is required for **instant** open of old inspections:
- inspection index row (title/date/status)
- minimal render state for pages (text fields needed immediately)
- photo *thumbnails* (optional but recommended for instant UI)
- remote pointers (S3 key/URL) + metadata (w/h, checksum, createdAt)
- `templateVersion` + `lastServerAckRevision` (rehydration token)

Everything else must be rehydrated from the server on demand.

---

## 3) Two-Stage Cleanup (Recommended)

### Stage 1 — Soft Purge (Immediately After Upload ACK)
Trigger: a media item (photo) has successfully uploaded and server returns stable pointer (URL/S3 key).

Action: delete heavy local payloads while keeping instant UI.

**Delete**
- full-res blob (`originalBlob`)
- derived blobs (e.g., `annotatedBlob`, rotated/cropped variants)
- temporary upload staging blobs

**Keep**
- thumbnail blob (`thumbBlob`, ~200–400px wide)
- remote pointer: `remoteKey` or `remoteUrl`
- metadata: `{ width, height, mime, size, checksum, createdAt }`
- vector annotation overlay if used (preferred over storing annotated image)

Result: massive space reduction while keeping old pages visually snappy.

### Stage 2 — Hard Purge (After Inactivity Window)
Trigger: inspection has not been touched for `PURGE_AFTER_DAYS = 3` (Spectora-like behavior).

Eligibility: must satisfy **Never Delete Unsynced Work** rules.

**Delete**
- the entire working set for that inspection:
  - detailed field values not required for instant open
  - all remaining blobs beyond thumbnails (if any)
  - local sync artifacts and caches

**Keep**
- Tier C archived records only (index + minimal render state + thumbs + remote pointers)
- rehydration token: `inspectionId + templateVersion + lastServerAckRevision`

Next time user opens that inspection:
- rehydrate full data from server
- recache into Dexie (progressively if needed)

---

## 4) ID / Pointer Strategy (Avoid Broken References)

### Option 1 (Preferred): Stable Client UUID Forever
For each locally-created entity (photo, comment, field mutation):
- assign `clientId = uuid()` at creation
- upload with `clientId`
- server stores/returns `clientId` permanently
- UI and Dexie always key off `clientId`
- serverId is optional metadata, not the lookup key

This eliminates temp→server pointer migration issues.

### Option 2: Alias Map (tempId → serverId)
If you must switch IDs:
- maintain a table `id_aliases`:
  - `{ localTempId, serverId, createdAt }`

Lookup chain for media/records:
1. try `localTempId`
2. else resolve `serverId` via alias and try
3. else fall back to remote fetch by `serverId`

Garbage-collect aliases after 14–30 days (only when safe).

---

## 5) Storage-Pressure Eviction (Quota-Based Purge)
Time-based purge alone is not enough. Add a watchdog.

Use:
- `navigator.storage.estimate()` (webview compatible in most modern stacks)

Policy:
- If `usage / quota >= PRESSURE_THRESHOLD` (e.g., 0.80):
  1) run Stage 1 Soft Purge on all uploaded media first
  2) then hard-purge **oldest eligible** inspections until under threshold

Always preserve unsynced work (never purge rule).

---

## 6) Data Model Requirements (Minimum Fields)

### Inspection Table (example)
- `inspectionId`
- `templateVersion`
- `isOpen`
- `lastTouchedAt` (update whenever user edits/navigates)
- `lastLocalRevision` (monotonic increment for any local change)
- `lastServerAckRevision` (updated when server confirms sync)
- `outboxCount` (or compute from outbox table)
- `purgeState` enum: `ACTIVE | ARCHIVED | PURGED`
- optional: `estimatedLocalBytes` (for debugging)

### Media Table (example)
- `clientId` (preferred stable key)
- `inspectionId`
- `remoteKey` / `remoteUrl` (nullable until uploaded)
- `thumbBlob` (small, keep longer)
- `originalBlob` (delete after upload ACK)
- `derivedBlobs` (delete after upload ACK)
- `annotationOverlay` (preferred) OR `annotatedBlob` (avoid if possible)
- `createdAt`, `updatedAt`
- `uploadedAt` (set on ACK)

### Outbox Table (example)
- `inspectionId`
- `mutationId`
- `type` (fieldUpdate, mediaUpload, etc.)
- `payload`
- `createdAt`
- `status` (pending, retrying, failed)

---

## 7) Inactivity Window Definition
Set:
- `PURGE_AFTER_DAYS = 3`

Compute:
- `inactiveMs = now - lastTouchedAt`
- eligible if `inactiveMs >= 3 * 24 * 60 * 60 * 1000`

Note: "Touched" includes:
- field edit
- photo add/annotate
- page navigation (optional, but recommended to reflect active use)

---

## 8) Purge Eligibility (Single Function)
Define a single gate:


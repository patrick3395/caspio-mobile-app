## Caspio Mobile App Fixes - PRD

### Task Priority Order:
1. **TASK-001** - FDF Sync (root cause)
2. **TASK-003** - Error Handling (prevent cascade failures)
3. **TASK-002** - PDF Images (user-facing fix)

### Summary:

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| TASK-001 | FDF Question (Same/Different Elevation) Not Syncing | P1 | Not Started |
| TASK-003 | Sync Error Handling - Prevent Cascade Failures | P2 | Not Started |
| TASK-002 | PDF Preview Missing All Images | P3 | Not Started |

### Key Details:

**TASK-001**: The Same/Different Elevation dropdown doesn't save/sync at all - this is the root cause blocking other syncs.

**TASK-003**: Implement comprehensive error handling with:
- Skip & retry failed items
- Clear error messages per item
- Circuit breaker pattern after repeated failures
- User alerts and manual retry options

**TASK-002**: All images missing from all PDF previews in the app (not just generated PDFs).
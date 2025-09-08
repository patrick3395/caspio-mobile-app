# Photo Annotation Test Plan - v1.4.221

## Test Objectives
Verify that multiple annotations can be drawn and ALL persist when drawing new shapes.

## Version Indicator
Look for red box in bottom-right corner showing "[v1.4.221 FIXED]"
Look for green box in top-left showing total annotation count

## Test Steps

### Test 1: Multiple Shapes
1. Open Engineers Foundation template
2. Select a photo to annotate
3. Draw an arrow
4. Draw a rectangle
5. Draw a circle
6. Draw with pen tool
7. **VERIFY**: All 4 shapes remain visible
8. **VERIFY**: Green counter shows "Total: 4 annotations"

### Test 2: Persistence After Save
1. Complete Test 1
2. Click Save/Done
3. Re-open the same photo for annotation
4. **VERIFY**: All previous annotations are visible
5. Add a new arrow
6. **VERIFY**: Now shows 5 total annotations

### Test 3: Undo Function
1. Draw 3 shapes
2. Click Undo
3. **VERIFY**: Only last shape removed, first 2 remain
4. **VERIFY**: Counter shows "Total: 2 annotations"

### Test 4: Clear All
1. Draw multiple shapes
2. Click Clear
3. **VERIFY**: All shapes removed
4. **VERIFY**: Counter shows "Total: 0 annotations"

### Test 5: Delete Mode
1. Draw 3 shapes
2. Enable delete mode
3. Click on middle shape
4. **VERIFY**: Only clicked shape removed
5. **VERIFY**: Other 2 shapes remain

## Debug Console Checks
Open browser console and verify:
- "[v1.4.221] BEFORE save - existing annotations: X"
- "[v1.4.221] AFTER save - total annotations: X+1"
- "[v1.4.221] Drawing annotation X/Y"
- "Permanent canvas has content: true"

## Common Failure Patterns
❌ Drawing second shape makes first disappear
❌ Counter shows wrong number
❌ Annotations don't persist after save
❌ Permanent canvas has content: false

## Success Criteria
✅ All shapes remain visible when drawing new ones
✅ Annotation array grows with each shape
✅ Permanent canvas maintains all content
✅ Version shows v1.4.221
✅ Debug overlays persist after all operations
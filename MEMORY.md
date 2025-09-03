---
description: Ensure what you implement Always Works™ with comprehensive testing
---

# How to ensure Always Works™ implementation

Please ensure your implementation Always Works™ for: $ARGUMENTS.

Follow this systematic approach:

## Core Philosophy

- "Should work" ≠ "does work" - Pattern matching isn't enough
- I'm not paid to write code, I'm paid to solve problems
- Untested code is just a guess, not a solution

# The 30-Second Reality Check - Must answer YES to ALL:

- Did I run/build the code?
- Did I trigger the exact feature I changed?
- Did I see the expected result with my own observation (including GUI)?
- Did I check for error messages?
- Would I bet $100 this works?

# Phrases to Avoid:

- "This should work now"
- "I've fixed the issue" (especially 2nd+ time)
- "Try it now" (without trying it myself)
- "The logic is correct so..."

# Specific Test Requirements:

- UI Changes: Actually click the button/link/form
- API Changes: Make the actual API call
- Data Changes: Query the database
- Logic Changes: Run the specific scenario
- Config Changes: Restart and verify it loads

# The Embarrassment Test:

"If the user records trying this and it fails, will I feel embarrassed to see his face?"

# Time Reality:

- Time saved skipping tests: 30 seconds
- Time wasted when it doesn't work: 30 minutes
- User trust lost: Immeasurable

A user describing a bug for the third time isn't thinking "this AI is trying hard" - they're thinking "why am I wasting time with this incompetent tool?"

# Photo Annotation System Architecture (v1.4.214 FIXED)

## Problem History
The photo annotation system had a critical bug where drawing a second shape would remove the first one. This was caused by clearing the entire canvas on each mouse move during drawing.

## Solution Architecture (PhotoAnnotatorComponent)

### Multi-Canvas Approach
The system uses THREE separate canvases to properly handle annotations:

1. **Permanent Canvas** (`permanentCanvas`)
   - Stores all completed/saved annotations
   - Only cleared when redrawing ALL annotations
   - Never cleared during active drawing

2. **Temp Canvas** (`tempCanvas`) 
   - Shows the preview of current drawing
   - Cleared and redrawn during mouse move
   - Content is temporary until saved

3. **Display Canvas** (`annotationCanvas`)
   - The visible canvas users interact with
   - Composites permanent + temp canvases
   - Shows all annotations + current drawing

### State Management
```typescript
private annotationObjects: any[] = [];  // Array stores ALL annotations
```
- Each annotation has unique ID
- Array is NEVER replaced, only appended to
- All annotations persist across drawing sessions

### Critical Methods

#### saveAnnotation()
- Pushes new annotation to array
- Calls `redrawAllAnnotationsFixed()` to commit to permanent canvas
- Preserves all existing annotations

#### redrawAllAnnotationsFixed()
- Clears permanent canvas
- Iterates through ALL annotations in array
- Draws each to permanent canvas
- Updates display canvas

#### displayCurrentDrawing()
- Composites permanent + temp canvases
- Preserves all saved content
- Shows current drawing preview

### Components to Use/Avoid

✅ **USE**: PhotoAnnotatorComponent (v1.4.214)
- Located: `/src/app/components/photo-annotator/`
- Fixed multi-canvas architecture
- Properly preserves all annotations

⚠️ **REVIEW**: ImageAnnotatorComponent
- Located: `/src/app/components/image-annotator/`
- SVG-based, may have different issues

❌ **AVOID**: AnnotationModalComponent  
- Located: `/src/app/modals/annotation-modal/`
- Has the canvas clearing bug
- Single canvas approach loses annotations

### Testing Checklist for Annotations
- [ ] Draw 3+ shapes sequentially
- [ ] All shapes remain visible
- [ ] Save and reload preserves all
- [ ] Undo removes only last shape
- [ ] Clear removes all shapes
- [ ] Delete mode removes specific shape
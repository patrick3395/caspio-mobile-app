export const FABRIC_JSON_VERSION = '6.7.1';
export const COMPRESSED_PREFIX_V1 = 'COMPRESSED_V1:';
export const COMPRESSED_PREFIX_V2 = 'COMPRESSED_V2:';
export const COMPRESSED_PREFIX_V3 = 'COMPRESSED_V3:';
export const EMPTY_COMPRESSED_ANNOTATIONS =
  COMPRESSED_PREFIX_V3 + '{"version":"' + FABRIC_JSON_VERSION + '","objects":[]}';

const COMPRESSION_PREFIXES = [COMPRESSED_PREFIX_V3, COMPRESSED_PREFIX_V2, COMPRESSED_PREFIX_V1];
const PASSTHROUGH_KEYS = new Set(['originalFilePath', 'width', 'height']);

export interface FabricAnnotationObject {
  [key: string]: any;
}

export interface FabricAnnotationPayload {
  version: string;
  objects: FabricAnnotationObject[];
  [key: string]: any;
}

export interface CompressOptions {
  emptyResult?: string;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const round = (value: unknown): number => Math.round(isFiniteNumber(value) ? value : 0);

const sanitizeStroke = (target: Record<string, any>, source: Record<string, any>): void => {
  const stroke = source['stroke'];
  const strokeWidth = source['strokeWidth'];
  const fill = source['fill'];

  if (stroke) target['stroke'] = stroke;
  if (isFiniteNumber(strokeWidth)) target['strokeWidth'] = strokeWidth;
  if (fill && fill !== 'rgba(0,0,0,0)') target['fill'] = fill;
};

const sanitizeObject = (obj: FabricAnnotationObject): FabricAnnotationObject | null => {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const source = obj as Record<string, any>;
  const type = String(source['type'] || '').toLowerCase();
  const base: Record<string, any> = {
    type: source['type'] || type,
    version: source['version'] || FABRIC_JSON_VERSION,
    originX: source['originX'] || 'left',
    originY: source['originY'] || 'top',
    left: round(source['left']),
    top: round(source['top']),
    scaleX: isFiniteNumber(source['scaleX']) ? source['scaleX'] : 1,
    scaleY: isFiniteNumber(source['scaleY']) ? source['scaleY'] : 1,
    angle: isFiniteNumber(source['angle']) ? source['angle'] : 0
  };

  switch (type) {
    case 'path': {
      if (!source['path']) {
        return null;
      }
      sanitizeStroke(base, source);
      base['path'] = source['path'];
      base['strokeLineCap'] = source['strokeLineCap'] || 'round';
      base['strokeLineJoin'] = source['strokeLineJoin'] || 'round';
      base['fill'] = source['fill'] || 'transparent';
      break;
    }
    case 'line': {
      sanitizeStroke(base, source);
      base['x1'] = round(source['x1']);
      base['y1'] = round(source['y1']);
      base['x2'] = round(source['x2']);
      base['y2'] = round(source['y2']);
      break;
    }
    case 'i-text':
    case 'text': {
      base['text'] = source['text'] || '';
      base['fontSize'] = isFiniteNumber(source['fontSize']) ? source['fontSize'] : 20;
      base['fill'] = source['fill'] || '#000000';
      break;
    }
    case 'circle': {
      sanitizeStroke(base, source);
      base['radius'] = round(source['radius']);
      base['fill'] = source['fill'] || 'transparent';
      break;
    }
    case 'rect': {
      sanitizeStroke(base, source);
      base['width'] = round(source['width']);
      base['height'] = round(source['height']);
      base['fill'] = source['fill'] || 'transparent';
      break;
    }
    case 'group': {
      base['width'] = round(source['width']);
      base['height'] = round(source['height']);
      const nested = Array.isArray(source['objects'])
        ? source['objects']
            .map(sanitizeObject)
            .filter((entry): entry is FabricAnnotationObject => Boolean(entry))
        : [];

      if (nested.length === 0) {
        return null;
      }

      base['objects'] = nested;
      break;
    }
    default: {
      sanitizeStroke(base, source);
      break;
    }
  }

  Object.keys(base).forEach((key) => {
    if (base[key] === undefined || base[key] === null) {
      delete base[key];
    }
  });

  return base;
};

const normalizeFromString = (value: string): FabricAnnotationPayload | null => {
  const trimmed = value.trim();

  if (!trimmed || trimmed === '{}' || trimmed === '[]' || trimmed === '""' || trimmed === 'null') {
    return null;
  }

  const prefix = COMPRESSION_PREFIXES.find((candidate) => trimmed.startsWith(candidate));
  const payloadString = prefix ? trimmed.slice(prefix.length) : trimmed;

  if (!payloadString) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadString);

    if (Array.isArray(parsed)) {
      return { version: FABRIC_JSON_VERSION, objects: parsed };
    }

    if (parsed && typeof parsed === 'object') {
      const payload: FabricAnnotationPayload = {
        version: (parsed as any).version || FABRIC_JSON_VERSION,
        objects: Array.isArray((parsed as any).objects) ? (parsed as any).objects : []
      };

      Object.keys(parsed as any).forEach((key) => {
        if (key !== 'version' && key !== 'objects' && PASSTHROUGH_KEYS.has(key)) {
          payload[key] = (parsed as any)[key];
        }
      });

      return payload;
    }
  } catch (error) {
    console.error('[annotation-utils] Failed to parse annotation string', error);
  }

  return null;
};

const normalizePayload = (raw: unknown): FabricAnnotationPayload | null => {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'string') {
    return normalizeFromString(raw);
  }

  if (Array.isArray(raw)) {
    return { version: FABRIC_JSON_VERSION, objects: raw as FabricAnnotationObject[] };
  }

  if (typeof raw === 'object') {
    const payload = raw as FabricAnnotationPayload;
    const clone: FabricAnnotationPayload = {
      ...payload,
      version: payload.version || FABRIC_JSON_VERSION,
      objects: Array.isArray(payload.objects) ? payload.objects.slice() : []
    };

    return clone;
  }

  return null;
};

export const isCompressedAnnotationData = (data?: string | null): boolean => {
  if (!data) {
    return false;
  }
  return COMPRESSION_PREFIXES.some((prefix) => data.startsWith(prefix));
};

export const decompressAnnotationData = (
  raw: string | FabricAnnotationPayload | null | undefined
): FabricAnnotationPayload | null => {
  const normalized = normalizePayload(raw);
  if (!normalized) {
    return null;
  }

  const cloneSource: FabricAnnotationPayload = {
    ...normalized,
    version: normalized.version || FABRIC_JSON_VERSION,
    objects: Array.isArray(normalized.objects) ? normalized.objects : []
  };

  const cloned = JSON.parse(JSON.stringify(cloneSource)) as FabricAnnotationPayload;

  PASSTHROUGH_KEYS.forEach((key) => {
    if (normalized[key] !== undefined) {
      cloned[key] = normalized[key];
    }
  });

  return cloned;
};

export const compressAnnotationData = (
  raw: string | FabricAnnotationPayload | FabricAnnotationObject[] | null | undefined,
  options: CompressOptions = {}
): string => {
  const normalized = normalizePayload(raw);

  if (!normalized || !normalized.objects || normalized.objects.length === 0) {
    return options.emptyResult ?? '';
  }

  const sanitized = normalized.objects
    .map(sanitizeObject)
    .filter((entry): entry is FabricAnnotationObject => Boolean(entry));

  if (sanitized.length === 0) {
    return options.emptyResult ?? '';
  }

  const payload: FabricAnnotationPayload = {
    version: FABRIC_JSON_VERSION,
    objects: sanitized
  };

  PASSTHROUGH_KEYS.forEach((key) => {
    if (normalized[key] !== undefined) {
      payload[key] = normalized[key];
    }
  });

  const payloadString = JSON.stringify(payload);

  if (payloadString.length < 50000) {
    return payloadString;
  }

  if (payloadString.length <= 64000) {
    return COMPRESSED_PREFIX_V3 + payloadString;
  }

  const reductionRatio = 60000 / payloadString.length;
  const retainCount = Math.max(1, Math.floor(sanitized.length * reductionRatio));
  payload.objects = sanitized.slice(-retainCount);

  const reducedString = JSON.stringify(payload);
  return COMPRESSED_PREFIX_V3 + reducedString;
}

/**
 * Renders annotations onto a photo and returns the result as a data URL
 * @param imageUrl - URL of the original photo
 * @param annotationData - Compressed or decompressed annotation data
 * @param options - Optional rendering options
 * @param fabricInstance - Optional pre-loaded Fabric.js instance to avoid multiple imports
 * @returns Promise resolving to data URL of the annotated image
 */
export async function renderAnnotationsOnPhoto(
  imageUrl: string,
  annotationData: string | FabricAnnotationPayload | null | undefined,
  options: { quality?: number; format?: 'jpeg' | 'png'; fabric?: any } = {}
): Promise<string | null> {
  console.log('[renderAnnotationsOnPhoto] Starting...', { imageUrl: imageUrl.substring(0, 50), hasAnnotations: !!annotationData });

  // Return original if no annotations
  if (!annotationData) {
    console.log('[renderAnnotationsOnPhoto] No annotation data, returning original');
    return imageUrl;
  }

  // Log raw annotation data
  console.log('[renderAnnotationsOnPhoto] Raw annotation data:', typeof annotationData, annotationData.substring ? annotationData.substring(0, 200) : annotationData);

  // Decompress annotation data
  const annotations = decompressAnnotationData(annotationData);
  console.log('[renderAnnotationsOnPhoto] Decompressed annotations:', annotations);
  console.log('[renderAnnotationsOnPhoto] Objects array:', annotations?.objects);

  if (!annotations || !annotations.objects || annotations.objects.length === 0) {
    console.log('[renderAnnotationsOnPhoto] No annotation objects (empty array), returning original');
    return imageUrl;
  }

  try {
    // Use provided Fabric instance or dynamically import it
    let fabric = options.fabric;

    if (!fabric) {
      console.log('[renderAnnotationsOnPhoto] Loading Fabric.js...');
      try {
        fabric = await import('fabric');
        console.log('[renderAnnotationsOnPhoto] Fabric.js loaded successfully');
      } catch (fabricError) {
        console.error('[renderAnnotationsOnPhoto] Failed to load Fabric.js:', fabricError);
        throw fabricError;
      }
    } else {
      console.log('[renderAnnotationsOnPhoto] Using provided Fabric instance');
    }

    // Load the image using Fabric.js
    console.log('[renderAnnotationsOnPhoto] Loading image...');
    const img = await fabric.Image.fromURL(imageUrl, { crossOrigin: 'anonymous' });
    if (!img) {
      throw new Error('Failed to load image');
    }
    console.log('[renderAnnotationsOnPhoto] Image loaded:', { width: img.width, height: img.height });

    // Create canvas with image dimensions and ensure it has a 2D context
    const canvas = document.createElement('canvas');
    const width = img.width || 800;
    const height = img.height || 600;
    canvas.width = width;
    canvas.height = height;

    // CRITICAL: Get the 2D context before passing to Fabric.js
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    console.log('[renderAnnotationsOnPhoto] Canvas 2D context created');

    // Initialize Fabric canvas with the canvas element
    const fabricCanvas = new fabric.Canvas(canvas, {
      width: width,
      height: height,
      enableRetinaScaling: false
    });
    console.log('[renderAnnotationsOnPhoto] Fabric canvas created');

    // Set image as background
    img.selectable = false;
    img.evented = false;
    fabricCanvas.backgroundImage = img;
    fabricCanvas.renderAll();
    console.log('[renderAnnotationsOnPhoto] Background image set');

    // Calculate scale factor if annotations were created on a different sized canvas
    // Annotations might have been created on a scaled canvas, but we're rendering on full-size image
    let scaleFactor = 1;

    // Check if the annotation data includes the original canvas dimensions
    // This would indicate what size canvas the annotations were created on
    if (annotations['width'] && annotations['height']) {
      const annotationCanvasWidth = annotations['width'];
      const annotationCanvasHeight = annotations['height'];

      console.log('[renderAnnotationsOnPhoto] Annotation canvas size:', annotationCanvasWidth, 'x', annotationCanvasHeight);
      console.log('[renderAnnotationsOnPhoto] Current image size:', width, 'x', height);

      // Calculate scale factor - how much to scale up the annotations
      // If annotations were created on a 800x600 canvas but image is 2000x1500,
      // we need to scale annotations by 2000/800 = 2.5x
      const scaleX = width / annotationCanvasWidth;
      const scaleY = height / annotationCanvasHeight;

      // Use the average scale factor, or the minimum to ensure annotations fit
      scaleFactor = Math.min(scaleX, scaleY);

      console.log('[renderAnnotationsOnPhoto] Calculated scale factor:', scaleFactor, '(scaleX:', scaleX, ', scaleY:', scaleY, ')');
    } else {
      // Fallback for existing annotations without canvas dimensions metadata
      // Analyze annotation coordinates to estimate the scale factor
      console.log('[renderAnnotationsOnPhoto] No canvas dimensions in annotation data, attempting to estimate scale factor');

      let maxX = 0;
      let maxY = 0;

      // Find the maximum coordinates in the annotation objects
      const findMaxCoords = (obj: any) => {
        if (obj['left']) maxX = Math.max(maxX, obj['left']);
        if (obj['top']) maxY = Math.max(maxY, obj['top']);
        if (obj['x1']) maxX = Math.max(maxX, obj['x1']);
        if (obj['y1']) maxY = Math.max(maxY, obj['y1']);
        if (obj['x2']) maxX = Math.max(maxX, obj['x2']);
        if (obj['y2']) maxY = Math.max(maxY, obj['y2']);
        if (obj['width']) maxX = Math.max(maxX, (obj['left'] || 0) + obj['width']);
        if (obj['height']) maxY = Math.max(maxY, (obj['top'] || 0) + obj['height']);

        // Check nested objects in groups
        if (obj['objects'] && Array.isArray(obj['objects'])) {
          obj['objects'].forEach(findMaxCoords);
        }
      };

      annotations.objects.forEach(findMaxCoords);

      console.log('[renderAnnotationsOnPhoto] Max annotation coordinates:', maxX, 'x', maxY);
      console.log('[renderAnnotationsOnPhoto] Image dimensions:', width, 'x', height);

      // If the max coordinates are significantly smaller than the image dimensions,
      // calculate a scale factor. Add some padding (1.2x) to account for annotations
      // that might not extend to the full canvas edges
      if (maxX > 0 && maxY > 0 && (maxX < width * 0.8 || maxY < height * 0.8)) {
        const estimatedCanvasWidth = maxX * 1.2;
        const estimatedCanvasHeight = maxY * 1.2;

        const scaleX = width / estimatedCanvasWidth;
        const scaleY = height / estimatedCanvasHeight;

        scaleFactor = Math.min(scaleX, scaleY);

        console.log('[renderAnnotationsOnPhoto] Estimated scale factor:', scaleFactor);
      } else {
        console.log('[renderAnnotationsOnPhoto] Using scale factor 1 (coordinates appear to match image size)');
      }
    }

    // Add annotation objects to canvas manually (don't use loadFromJSON as it clears the background)
    console.log('[renderAnnotationsOnPhoto] Adding annotation objects to canvas...');
    console.log('[renderAnnotationsOnPhoto] Number of annotation objects:', annotations.objects?.length || 0);

    if (annotations.objects && annotations.objects.length > 0) {
      // Add objects directly to the canvas
      console.log('[renderAnnotationsOnPhoto] Processing', annotations.objects.length, 'annotation objects...');

      try {
        // Process each annotation object
        for (const objData of annotations.objects) {
          console.log('[renderAnnotationsOnPhoto] Processing object type:', objData['type']);

          // Skip image objects
          if (objData['type'] === 'image' || objData['type'] === 'Image') {
            console.log('[renderAnnotationsOnPhoto] Skipping image object');
            continue;
          }

          // Create Fabric object based on type
          let fabricObj: any = null;

          if (objData['type'] === 'Group' || objData['type'] === 'group') {
            // For groups, collect nested objects first
            const groupObjects: any[] = [];

            if (objData['objects'] && Array.isArray(objData['objects'])) {
              for (const nestedObj of objData['objects']) {
                const nested = createFabricObject(fabric, nestedObj, scaleFactor);
                if (nested) {
                  groupObjects.push(nested);
                }
              }
            }

            // Create group with all nested objects, applying scale factor to position
            if (groupObjects.length > 0) {
              fabricObj = new fabric.Group(groupObjects, {
                left: (objData['left'] || 0) * scaleFactor,
                top: (objData['top'] || 0) * scaleFactor,
                angle: objData['angle'] || 0,
                scaleX: (objData['scaleX'] || 1) * scaleFactor,
                scaleY: (objData['scaleY'] || 1) * scaleFactor
              });
            }
          } else {
            fabricObj = createFabricObject(fabric, objData, scaleFactor);
          }

          if (fabricObj) {
            fabricCanvas.add(fabricObj);
            console.log('[renderAnnotationsOnPhoto] Added', objData['type'], 'object');
          }
        }

        const finalCount = fabricCanvas.getObjects().length;
        console.log('[renderAnnotationsOnPhoto] Total objects on canvas:', finalCount);

        fabricCanvas.renderAll();
        console.log('[renderAnnotationsOnPhoto] Canvas rendered with annotations');
      } catch (error) {
        console.error('[renderAnnotationsOnPhoto] Error adding objects:', error);
        // Continue anyway - we'll just have the photo without annotations
      }
    } else {
      console.log('[renderAnnotationsOnPhoto] No annotation objects to add');
    }

    // Export as data URL
    const quality = options.quality || 0.9;
    const format = options.format || 'jpeg';
    console.log('[renderAnnotationsOnPhoto] Exporting as data URL...');
    const dataUrl = fabricCanvas.toDataURL({
      format: format,
      quality: quality,
      multiplier: 1
    });
    console.log('[renderAnnotationsOnPhoto] Export complete, data URL length:', dataUrl.length);

    // Cleanup - wrap in try-catch to prevent disposal errors
    try {
      fabricCanvas.dispose();
      console.log('[renderAnnotationsOnPhoto] Canvas disposed');
    } catch (disposeError) {
      console.warn('[renderAnnotationsOnPhoto] Error during canvas disposal (safe to ignore):', disposeError);
    }

    return dataUrl;
  } catch (error) {
    console.error('[annotation-utils] Error rendering annotations:', error);
    console.error('[annotation-utils] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return imageUrl; // Return original on error
  }
}

/**
 * Helper function to create a Fabric.js object from JSON data
 * @param fabric - Fabric.js library instance
 * @param objData - Object data from JSON
 * @param scaleFactor - Scale factor to apply to positions and dimensions (default 1)
 */
function createFabricObject(fabric: any, objData: any, scaleFactor: number = 1): any {
  if (!objData || !objData['type']) {
    return null;
  }

  try {
    const type = objData['type'];

    switch (type) {
      case 'Line':
      case 'line':
        return new fabric.Line(
          [
            (objData['x1'] || 0) * scaleFactor,
            (objData['y1'] || 0) * scaleFactor,
            (objData['x2'] || 0) * scaleFactor,
            (objData['y2'] || 0) * scaleFactor
          ],
          {
            left: (objData['left'] || 0) * scaleFactor,
            top: (objData['top'] || 0) * scaleFactor,
            stroke: objData['stroke'],
            strokeWidth: (objData['strokeWidth'] || 1) * scaleFactor,
            angle: objData['angle'] || 0,
            scaleX: (objData['scaleX'] || 1) * scaleFactor,
            scaleY: (objData['scaleY'] || 1) * scaleFactor
          }
        );

      case 'Rect':
      case 'rect':
        return new fabric.Rect({
          left: (objData['left'] || 0) * scaleFactor,
          top: (objData['top'] || 0) * scaleFactor,
          width: (objData['width'] || 0) * scaleFactor,
          height: (objData['height'] || 0) * scaleFactor,
          fill: objData['fill'] || 'transparent',
          stroke: objData['stroke'],
          strokeWidth: (objData['strokeWidth'] || 1) * scaleFactor,
          angle: objData['angle'] || 0,
          scaleX: (objData['scaleX'] || 1) * scaleFactor,
          scaleY: (objData['scaleY'] || 1) * scaleFactor
        });

      case 'Circle':
      case 'circle':
        return new fabric.Circle({
          left: (objData['left'] || 0) * scaleFactor,
          top: (objData['top'] || 0) * scaleFactor,
          radius: (objData['radius'] || 0) * scaleFactor,
          fill: objData['fill'] || 'transparent',
          stroke: objData['stroke'],
          strokeWidth: (objData['strokeWidth'] || 1) * scaleFactor,
          angle: objData['angle'] || 0,
          scaleX: (objData['scaleX'] || 1) * scaleFactor,
          scaleY: (objData['scaleY'] || 1) * scaleFactor
        });

      case 'Text':
      case 'text':
      case 'IText':
      case 'i-text':
        return new fabric.IText(objData['text'] || '', {
          left: (objData['left'] || 0) * scaleFactor,
          top: (objData['top'] || 0) * scaleFactor,
          fontSize: (objData['fontSize'] || 20) * scaleFactor,
          fill: objData['fill'] || '#000000',
          angle: objData['angle'] || 0,
          scaleX: (objData['scaleX'] || 1) * scaleFactor,
          scaleY: (objData['scaleY'] || 1) * scaleFactor
        });

      case 'Path':
      case 'path':
        if (objData['path']) {
          return new fabric.Path(objData['path'], {
            left: (objData['left'] || 0) * scaleFactor,
            top: (objData['top'] || 0) * scaleFactor,
            fill: objData['fill'] || 'transparent',
            stroke: objData['stroke'],
            strokeWidth: (objData['strokeWidth'] || 1) * scaleFactor,
            strokeLineCap: objData['strokeLineCap'] || 'round',
            strokeLineJoin: objData['strokeLineJoin'] || 'round',
            angle: objData['angle'] || 0,
            scaleX: (objData['scaleX'] || 1) * scaleFactor,
            scaleY: (objData['scaleY'] || 1) * scaleFactor
          });
        }
        return null;

      default:
        console.warn('[createFabricObject] Unknown object type:', type);
        return null;
    }
  } catch (error) {
    console.error('[createFabricObject] Error creating object:', error);
    return null;
  }
}

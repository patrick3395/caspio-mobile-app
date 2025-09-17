export const FABRIC_JSON_VERSION = '6.7.1';
export const COMPRESSED_PREFIX_V1 = 'COMPRESSED_V1:';
export const COMPRESSED_PREFIX_V2 = 'COMPRESSED_V2:';
export const COMPRESSED_PREFIX_V3 = 'COMPRESSED_V3:';
export const EMPTY_COMPRESSED_ANNOTATIONS =
  COMPRESSED_PREFIX_V3 + '{"version":"' + FABRIC_JSON_VERSION + '","objects":[]}';

const COMPRESSION_PREFIXES = [COMPRESSED_PREFIX_V3, COMPRESSED_PREFIX_V2, COMPRESSED_PREFIX_V1];
const PASSTHROUGH_KEYS = new Set(['originalFilePath']);

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
};

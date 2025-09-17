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
  if (source.stroke) target.stroke = source.stroke;
  if (isFiniteNumber(source.strokeWidth)) target.strokeWidth = source.strokeWidth;
  if (source.fill && source.fill !== 'rgba(0,0,0,0)') target.fill = source.fill;
};

const sanitizeObject = (obj: FabricAnnotationObject): FabricAnnotationObject | null => {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const type = String(obj.type || '').toLowerCase();
  const base: Record<string, any> = {
    type: obj.type || type,
    version: obj.version || FABRIC_JSON_VERSION,
    originX: obj.originX || 'left',
    originY: obj.originY || 'top',
    left: round(obj.left),
    top: round(obj.top),
    scaleX: isFiniteNumber(obj.scaleX) ? obj.scaleX : 1,
    scaleY: isFiniteNumber(obj.scaleY) ? obj.scaleY : 1,
    angle: isFiniteNumber(obj.angle) ? obj.angle : 0
  };

  switch (type) {
    case 'path': {
      if (!obj.path) {
        return null;
      }
      sanitizeStroke(base, obj);
      base.path = obj.path;
      base.strokeLineCap = obj.strokeLineCap || 'round';
      base.strokeLineJoin = obj.strokeLineJoin || 'round';
      base.fill = obj.fill || 'transparent';
      break;
    }
    case 'line': {
      sanitizeStroke(base, obj);
      base.x1 = round(obj.x1);
      base.y1 = round(obj.y1);
      base.x2 = round(obj.x2);
      base.y2 = round(obj.y2);
      break;
    }
    case 'i-text':
    case 'text': {
      base.text = obj.text || '';
      base.fontSize = isFiniteNumber(obj.fontSize) ? obj.fontSize : 20;
      base.fill = obj.fill || '#000000';
      break;
    }
    case 'circle': {
      sanitizeStroke(base, obj);
      base.radius = round(obj.radius);
      base.fill = obj.fill || 'transparent';
      break;
    }
    case 'rect': {
      sanitizeStroke(base, obj);
      base.width = round(obj.width);
      base.height = round(obj.height);
      base.fill = obj.fill || 'transparent';
      break;
    }
    case 'group': {
      base.width = round(obj.width);
      base.height = round(obj.height);
      const nested = Array.isArray(obj.objects)
        ? obj.objects
            .map(sanitizeObject)
            .filter((entry): entry is FabricAnnotationObject => Boolean(entry))
        : [];

      if (nested.length === 0) {
        return null;
      }

      base.objects = nested;
      break;
    }
    default: {
      sanitizeStroke(base, obj);
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


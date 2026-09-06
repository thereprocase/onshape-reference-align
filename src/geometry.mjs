const TAU = Math.PI * 2;
const EPS = 1e-12;

export class CalibrationError extends Error {
  constructor(message, code = 'CALIBRATION_ERROR', details = undefined) {
    super(message);
    this.name = 'CalibrationError';
    this.code = code;
    this.details = details;
  }
}

export function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new CalibrationError(`${name} must be a finite number.`, 'INVALID_NUMBER', { name, value });
  }
  return value;
}

export function validateImageSize(imageSize) {
  if (!imageSize || typeof imageSize !== 'object') {
    throw new CalibrationError('Image dimensions are required.', 'MISSING_IMAGE_SIZE');
  }
  const width = assertFiniteNumber(Number(imageSize.width), 'image width');
  const height = assertFiniteNumber(Number(imageSize.height), 'image height');
  if (width <= 0 || height <= 0) {
    throw new CalibrationError('Image dimensions must be greater than zero.', 'INVALID_IMAGE_SIZE', { width, height });
  }
  return { width, height, aspectRatio: width / height };
}

export function validatePixel(point, imageSize, name = 'point') {
  if (!point || typeof point !== 'object') {
    throw new CalibrationError(`${name} is required.`, 'MISSING_POINT', { name });
  }
  const size = validateImageSize(imageSize);
  const x = assertFiniteNumber(Number(point.x), `${name}.x`);
  const y = assertFiniteNumber(Number(point.y), `${name}.y`);
  // A tiny overrun is tolerated because subpixel picks near an edge can round outward.
  const tolerance = 1e-6;
  if (x < -tolerance || y < -tolerance || x > size.width + tolerance || y > size.height + tolerance) {
    throw new CalibrationError(`${name} lies outside the image.`, 'POINT_OUTSIDE_IMAGE', {
      name,
      point: { x, y },
      imageSize: size
    });
  }
  return {
    x: Math.min(size.width, Math.max(0, x)),
    y: Math.min(size.height, Math.max(0, y))
  };
}

export function validatePlacement(placement) {
  if (!placement || typeof placement !== 'object') {
    throw new CalibrationError('Current image placement is required.', 'MISSING_PLACEMENT');
  }
  const originX = assertFiniteNumber(Number(placement.originX), 'originX');
  const originY = assertFiniteNumber(Number(placement.originY), 'originY');
  const width = assertFiniteNumber(Number(placement.width), 'width');
  const angle = assertFiniteNumber(Number(placement.angle), 'angle');
  if (width <= 0) {
    throw new CalibrationError('Current image width must be greater than zero.', 'INVALID_PLACEMENT_WIDTH', { width });
  }
  return { originX, originY, width, angle };
}

/**
 * Convert a browser-image point (origin at upper-left, y downward) into
 * normalized image coordinates (origin at lower-left, y upward).
 */
export function pixelToUv(point, imageSize) {
  const size = validateImageSize(imageSize);
  const p = validatePixel(point, size);
  return {
    u: p.x / size.width,
    v: 1 - p.y / size.height
  };
}

export function rotateVector(vector, angle) {
  const x = assertFiniteNumber(Number(vector.x), 'vector.x');
  const y = assertFiniteNumber(Number(vector.y), 'vector.y');
  const a = assertFiniteNumber(Number(angle), 'angle');
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * x - s * y, y: s * x + c * y };
}

export function pixelToLocal(point, imageSize, width) {
  const size = validateImageSize(imageSize);
  const w = assertFiniteNumber(Number(width), 'width');
  if (w <= 0) {
    throw new CalibrationError('Image width must be greater than zero.', 'INVALID_WIDTH', { width: w });
  }
  const uv = pixelToUv(point, size);
  return {
    x: w * uv.u,
    y: (w / size.aspectRatio) * uv.v
  };
}

export function pixelToSketch(point, imageSize, placement) {
  const current = validatePlacement(placement);
  const local = pixelToLocal(point, imageSize, current.width);
  const rotated = rotateVector(local, current.angle);
  return {
    x: current.originX + rotated.x,
    y: current.originY + rotated.y
  };
}

export function pairLocalVector(pair, imageSize, width = 1) {
  if (!pair?.a || !pair?.b) {
    throw new CalibrationError('A complete point pair is required.', 'MISSING_PAIR');
  }
  const a = pixelToLocal(pair.a, imageSize, width);
  const b = pixelToLocal(pair.b, imageSize, width);
  const vector = { x: b.x - a.x, y: b.y - a.y };
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPS) {
    throw new CalibrationError('The two reference points must be different.', 'COINCIDENT_PAIR', { pair });
  }
  return { ...vector, length, angle: Math.atan2(vector.y, vector.x) };
}

export function pairSketchVector(pair, imageSize, placement) {
  const a = pixelToSketch(pair.a, imageSize, placement);
  const b = pixelToSketch(pair.b, imageSize, placement);
  const vector = { x: b.x - a.x, y: b.y - a.y };
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPS) {
    throw new CalibrationError('The two reference points must be different.', 'COINCIDENT_PAIR', { pair });
  }
  return { ...vector, length, angle: Math.atan2(vector.y, vector.x), a, b };
}

export function normalizeAnglePositive(angle) {
  const a = assertFiniteNumber(Number(angle), 'angle');
  return ((a % TAU) + TAU) % TAU;
}

export function normalizeAngleSigned(angle) {
  const positive = normalizeAnglePositive(angle);
  return positive > Math.PI ? positive - TAU : positive;
}

export function angleDifference(from, to) {
  return normalizeAngleSigned(to - from);
}

export function nearestOrthogonalAngle(angle) {
  const a = assertFiniteNumber(Number(angle), 'angle');
  return Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
}

export function resolveTargetAngle({ mode, customAngle, currentPairAngle }) {
  switch (mode) {
    case 'keep':
      return assertFiniteNumber(Number(currentPairAngle), 'currentPairAngle');
    case 'horizontal':
      return 0;
    case 'vertical':
      return Math.PI / 2;
    case 'nearest-axis':
      return nearestOrthogonalAngle(currentPairAngle);
    case 'custom':
      return assertFiniteNumber(Number(customAngle), 'customAngle');
    default:
      throw new CalibrationError(`Unknown rotation target mode: ${mode}`, 'INVALID_ROTATION_MODE', { mode });
  }
}

export function getAnchorPoint(anchor, scalePair, rotationPair, imageSize) {
  const fallback = scalePair?.a;
  let point;
  switch (anchor) {
    case 'scale-b':
      point = scalePair?.b;
      break;
    case 'rotation-a':
      point = rotationPair?.a;
      break;
    case 'rotation-b':
      point = rotationPair?.b;
      break;
    case 'center': {
      const size = validateImageSize(imageSize);
      point = { x: size.width / 2, y: size.height / 2 };
      break;
    }
    case 'scale-a':
    default:
      point = fallback;
      break;
  }
  if (!point) {
    throw new CalibrationError('The selected anchor point is unavailable.', 'MISSING_ANCHOR', { anchor });
  }
  return validatePixel(point, imageSize, 'anchor');
}

/**
 * Calibrate an image placement using a true-distance pair and an orientation pair.
 *
 * Units are deliberately agnostic. Onshape integration uses metres and radians.
 * Pixel points are measured from the image's upper-left corner.
 */
export function calibratePlacement({
  imageSize,
  placement,
  scalePair,
  trueDistance,
  rotationPair = undefined,
  rotationTarget = { mode: 'keep' },
  anchor = 'scale-a'
}) {
  const size = validateImageSize(imageSize);
  const current = validatePlacement(placement);
  const distance = assertFiniteNumber(Number(trueDistance), 'trueDistance');
  if (distance <= 0) {
    throw new CalibrationError('Known distance must be greater than zero.', 'INVALID_TRUE_DISTANCE', { trueDistance: distance });
  }

  const normalizedScaleVector = pairLocalVector(scalePair, size, 1);
  const newWidth = distance / normalizedScaleVector.length;
  if (!Number.isFinite(newWidth) || newWidth <= 0) {
    throw new CalibrationError('The calculated image width is invalid.', 'INVALID_CALCULATED_WIDTH', { newWidth });
  }

  const effectiveRotationPair = rotationPair?.a && rotationPair?.b ? rotationPair : scalePair;
  const currentRotationMetrics = pairSketchVector(effectiveRotationPair, size, current);
  const targetPairAngle = resolveTargetAngle({
    mode: rotationTarget?.mode ?? 'keep',
    customAngle: rotationTarget?.customAngle,
    currentPairAngle: currentRotationMetrics.angle
  });
  const rotationLocalAngle = pairLocalVector(effectiveRotationPair, size, 1).angle;
  const newAngle = normalizeAnglePositive(targetPairAngle - rotationLocalAngle);

  const anchorPixel = getAnchorPoint(anchor, scalePair, effectiveRotationPair, size);
  const anchorBefore = pixelToSketch(anchorPixel, size, current);
  const anchorLocalAfter = pixelToLocal(anchorPixel, size, newWidth);
  const anchorOffsetAfter = rotateVector(anchorLocalAfter, newAngle);
  const newOrigin = {
    x: anchorBefore.x - anchorOffsetAfter.x,
    y: anchorBefore.y - anchorOffsetAfter.y
  };

  const result = {
    originX: newOrigin.x,
    originY: newOrigin.y,
    width: newWidth,
    angle: newAngle
  };

  const scaledPairAfter = pairSketchVector(scalePair, size, result);
  const rotationPairAfter = pairSketchVector(effectiveRotationPair, size, result);
  const anchorAfter = pixelToSketch(anchorPixel, size, result);

  return {
    placement: result,
    diagnostics: {
      aspectRatio: size.aspectRatio,
      oldWidth: current.width,
      newWidth,
      scaleFactor: newWidth / current.width,
      oldAngle: current.angle,
      newAngle,
      rotationDelta: angleDifference(current.angle, newAngle),
      scalePairBeforeLength: pairSketchVector(scalePair, size, current).length,
      scalePairAfterLength: scaledPairAfter.length,
      requestedDistance: distance,
      rotationPairBeforeAngle: currentRotationMetrics.angle,
      rotationPairAfterAngle: rotationPairAfter.angle,
      requestedPairAngle: normalizeAnglePositive(targetPairAngle),
      anchorPixel,
      anchorBefore,
      anchorAfter,
      anchorResidual: Math.hypot(anchorAfter.x - anchorBefore.x, anchorAfter.y - anchorBefore.y)
    }
  };
}

/**
 * Derive a placement from a native BTMSketchImageEntity-763's xaxisX/xaxisY.
 *
 * These field names are an assumption, not a confirmed contract: every real
 * capture this project holds (test/fixtures/native-sketch-image.mjs, and
 * docs/experiments/2026-09-05-suppress-verify/) shows the entity without
 * either field, so this throws for every native image observed so far and
 * scanFeatureList() reports the item's placement as unavailable. See
 * "Experimental native-image write" in docs/ARCHITECTURE.md before trusting
 * this formula against a real document.
 */
export function placementFromNativeImageEntity(entity) {
  if (!entity || typeof entity !== 'object') {
    throw new CalibrationError('Native image entity is required.', 'MISSING_NATIVE_ENTITY');
  }
  const originX = assertFiniteNumber(Number(entity.originX), 'originX');
  const originY = assertFiniteNumber(Number(entity.originY), 'originY');
  const xaxisX = assertFiniteNumber(Number(entity.xaxisX), 'xaxisX');
  const xaxisY = assertFiniteNumber(Number(entity.xaxisY), 'xaxisY');
  const width = Math.hypot(xaxisX, xaxisY);
  if (width <= EPS) {
    throw new CalibrationError('Native image has a zero-length x-axis.', 'INVALID_NATIVE_XAXIS');
  }
  return {
    originX,
    originY,
    width,
    angle: normalizeAnglePositive(Math.atan2(xaxisY, xaxisX))
  };
}

export function applyPlacementToNativeImageEntity(entity, placement) {
  const target = validatePlacement(placement);
  const result = structuredClone(entity);
  result.originX = target.originX;
  result.originY = target.originY;
  result.xaxisX = target.width * Math.cos(target.angle);
  result.xaxisY = target.width * Math.sin(target.angle);
  return result;
}

export function radiansToDegrees(radians) {
  return assertFiniteNumber(Number(radians), 'radians') * 180 / Math.PI;
}

export function degreesToRadians(degrees) {
  return assertFiniteNumber(Number(degrees), 'degrees') * Math.PI / 180;
}

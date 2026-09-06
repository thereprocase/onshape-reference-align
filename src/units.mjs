import { CalibrationError, assertFiniteNumber } from './geometry.mjs';

const LENGTH_TO_METERS = Object.freeze({
  m: 1,
  meter: 1,
  meters: 1,
  metre: 1,
  metres: 1,
  mm: 1e-3,
  millimeter: 1e-3,
  millimeters: 1e-3,
  millimetre: 1e-3,
  millimetres: 1e-3,
  cm: 1e-2,
  centimeter: 1e-2,
  centimeters: 1e-2,
  centimetre: 1e-2,
  centimetres: 1e-2,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
  '"': 0.0254,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  "'": 0.3048,
  yd: 0.9144,
  yard: 0.9144,
  yards: 0.9144
});

const ANGLE_TO_RADIANS = Object.freeze({
  rad: 1,
  radian: 1,
  radians: 1,
  deg: Math.PI / 180,
  degree: Math.PI / 180,
  degrees: Math.PI / 180,
  '°': Math.PI / 180
});

function cleanExpression(expression) {
  if (typeof expression !== 'string') return '';
  return expression.trim().replace(/−/g, '-');
}

function parseSimpleQuantity(expression, table, kind) {
  const text = cleanExpression(expression);
  if (!text) return undefined;

  // Deliberately accepts only a simple literal. Variables and arithmetic should
  // be evaluated by Onshape; the UI can ask for a manual current placement when
  // the serialized feature does not expose a usable numeric value.
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z°"']+)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = table[unit];
  if (!Number.isFinite(value) || factor === undefined) return undefined;
  return value * factor;
}

export function parseLengthExpression(expression) {
  return parseSimpleQuantity(expression, LENGTH_TO_METERS, 'length');
}

export function parseAngleExpression(expression) {
  return parseSimpleQuantity(expression, ANGLE_TO_RADIANS, 'angle');
}

export function lengthToMeters(value, unit) {
  const number = assertFiniteNumber(Number(value), 'length');
  const key = String(unit ?? '').trim().toLowerCase();
  const factor = LENGTH_TO_METERS[key];
  if (factor === undefined) {
    throw new CalibrationError(`Unsupported length unit: ${unit}`, 'UNSUPPORTED_LENGTH_UNIT', { unit });
  }
  return number * factor;
}

export function metersToLength(value, unit) {
  const meters = assertFiniteNumber(Number(value), 'meters');
  const key = String(unit ?? '').trim().toLowerCase();
  const factor = LENGTH_TO_METERS[key];
  if (factor === undefined) {
    throw new CalibrationError(`Unsupported length unit: ${unit}`, 'UNSUPPORTED_LENGTH_UNIT', { unit });
  }
  return meters / factor;
}

export function angleToRadians(value, unit) {
  const number = assertFiniteNumber(Number(value), 'angle');
  const key = String(unit ?? '').trim().toLowerCase();
  const factor = ANGLE_TO_RADIANS[key];
  if (factor === undefined) {
    throw new CalibrationError(`Unsupported angle unit: ${unit}`, 'UNSUPPORTED_ANGLE_UNIT', { unit });
  }
  return number * factor;
}

export function quantityParameterToSi(parameter, kind) {
  if (!parameter || typeof parameter !== 'object') return undefined;

  // There is no `value` fallback here on purpose. Every BTMParameterQuantity-147
  // captured in docs/experiments/2026-09-04-bind-experiment/ has value: 0
  // regardless of its expression (including literals like "0.25 m") — `value`
  // is an echoed input field, not an evaluated SI-unit output, so trusting it
  // for a variable- or arithmetic-driven expression silently produces a
  // fictional placement. When the expression is not a parseable literal, the
  // caller must treat the parameter as unreadable.
  return kind === 'angle'
    ? parseAngleExpression(parameter.expression)
    : parseLengthExpression(parameter.expression);
}

export function formatMetersForOnshape(value) {
  const meters = assertFiniteNumber(Number(value), 'meters');
  return `${formatSignificant(meters)} m`;
}

export function formatRadiansForOnshape(value) {
  const radians = assertFiniteNumber(Number(value), 'radians');
  const degrees = radians * 180 / Math.PI;
  return `${formatSignificant(degrees)} deg`;
}

export function formatSignificant(value, digits = 15) {
  const number = assertFiniteNumber(Number(value), 'value');
  if (Object.is(number, -0) || Math.abs(number) < 1e-15) return '0';
  return Number(number.toPrecision(digits)).toString();
}

export function knownLengthUnits() {
  return ['mm', 'cm', 'in', 'ft', 'm'];
}

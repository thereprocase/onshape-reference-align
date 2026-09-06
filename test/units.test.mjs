import test from 'node:test';
import assert from 'node:assert/strict';

import {
  angleToRadians,
  formatMetersForOnshape,
  formatRadiansForOnshape,
  lengthToMeters,
  metersToLength,
  parseAngleExpression,
  parseLengthExpression,
  quantityParameterToSi
} from '../src/units.mjs';

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

test('converts common engineering length units', () => {
  near(lengthToMeters(6, 'in'), 0.1524);
  near(lengthToMeters(2, 'ft'), 0.6096);
  near(metersToLength(0.0254, 'in'), 1);
});

test('parses simple Onshape quantity expressions', () => {
  near(parseLengthExpression('6 in'), 0.1524);
  near(parseLengthExpression('-12.5 mm'), -0.0125);
  near(parseAngleExpression('90 deg'), Math.PI / 2);
  assert.equal(parseLengthExpression('#width'), undefined);
  assert.equal(parseLengthExpression('2 * 3 in'), undefined);
});

test('treats variable- and arithmetic-driven parameters as unreadable rather than trusting value', () => {
  // `value` is not a trustworthy evaluated SI output — see the comment on
  // quantityParameterToSi() in src/units.mjs. A non-zero value here would
  // previously have been used as-is, which is exactly the bug this guards
  // against: never treat `value` as ground truth, even when it looks plausible.
  assert.equal(quantityParameterToSi({ expression: '#imageWidth', value: 0.42 }, 'length'), undefined);
  assert.equal(quantityParameterToSi({ expression: '#imageAngle', value: 0.3 }, 'angle'), undefined);
  assert.equal(quantityParameterToSi({ expression: '25 mm + 3 mm', value: 0.028 }, 'length'), undefined);
});

test('does not fall back to value when it echoes a literal expression as zero', () => {
  // Shaped after captures in docs/experiments/2026-09-04-bind-experiment/:
  // every observed BTMParameterQuantity-147 has value: 0 regardless of its
  // expression, including literal expressions like "0.25 m". If a future
  // regression reintroduces the value fallback, this asserts undefined rather
  // than the wrong non-zero literal value slipping through as 0.
  const capturedImageWidth = {
    btType: 'BTMParameterQuantity-147',
    libraryRelationType: 'DEFAULT',
    isInteger: false,
    value: 0,
    units: '',
    expression: '#plateOffset',
    parameterId: 'imageWidth'
  };
  assert.equal(quantityParameterToSi(capturedImageWidth, 'length'), undefined);
});

test('formats SI values as literal Onshape expressions', () => {
  assert.equal(formatMetersForOnshape(0.1524), '0.1524 m');
  assert.equal(formatRadiansForOnshape(Math.PI / 2), '90 deg');
  near(angleToRadians(180, 'deg'), Math.PI);
});

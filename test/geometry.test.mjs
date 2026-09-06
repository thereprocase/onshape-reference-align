import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CalibrationError,
  applyPlacementToNativeImageEntity,
  calibratePlacement,
  nearestOrthogonalAngle,
  pairSketchVector,
  pixelToSketch,
  placementFromNativeImageEntity
} from '../src/geometry.mjs';

const EPS = 1e-10;

function near(actual, expected, tolerance = EPS, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message || 'values differ'}: expected ${expected}, got ${actual}`);
}

function pointNear(actual, expected, tolerance = EPS) {
  near(actual.x, expected.x, tolerance, 'x differs');
  near(actual.y, expected.y, tolerance, 'y differs');
}

test('scales a horizontal pixel pair to a known distance and preserves S1', () => {
  const imageSize = { width: 1000, height: 500 };
  const scalePair = { a: { x: 100, y: 250 }, b: { x: 700, y: 250 } };
  const current = { originX: 2, originY: -1, width: 0.5, angle: 0 };
  const anchorBefore = pixelToSketch(scalePair.a, imageSize, current);

  const result = calibratePlacement({
    imageSize,
    placement: current,
    scalePair,
    trueDistance: 0.1524,
    rotationTarget: { mode: 'horizontal' },
    anchor: 'scale-a'
  });

  // The pair spans 60% of the raster width, so full image width is 6 in / 0.6.
  near(result.placement.width, 0.254);
  near(pairSketchVector(scalePair, imageSize, result.placement).length, 0.1524);
  near(pairSketchVector(scalePair, imageSize, result.placement).angle, 0);
  pointNear(pixelToSketch(scalePair.a, imageSize, result.placement), anchorBefore);
  near(result.diagnostics.anchorResidual, 0);
});

test('uses a separate rotation pair and aligns it to an arbitrary angle', () => {
  const imageSize = { width: 1200, height: 800 };
  const scalePair = { a: { x: 100, y: 700 }, b: { x: 900, y: 700 } };
  // Browser y points down, so this pair points +Y in sketch/image coordinates.
  const rotationPair = { a: { x: 600, y: 700 }, b: { x: 600, y: 100 } };
  const target = 30 * Math.PI / 180;
  const current = { originX: 0.4, originY: -0.2, width: 1.8, angle: 0.17 };
  const anchorBefore = pixelToSketch(rotationPair.b, imageSize, current);

  const result = calibratePlacement({
    imageSize,
    placement: current,
    scalePair,
    trueDistance: 2,
    rotationPair,
    rotationTarget: { mode: 'custom', customAngle: target },
    anchor: 'rotation-b'
  });

  const rotationAfter = pairSketchVector(rotationPair, imageSize, result.placement);
  near(rotationAfter.angle, target, 1e-9);
  near(pairSketchVector(scalePair, imageSize, result.placement).length, 2, 1e-9);
  pointNear(pixelToSketch(rotationPair.b, imageSize, result.placement), anchorBefore, 1e-9);
});

test('nearest-axis snaps the selected pair to the nearest multiple of 90 degrees', () => {
  const imageSize = { width: 1000, height: 1000 };
  const pair = { a: { x: 100, y: 500 }, b: { x: 900, y: 500 } };
  const current = { originX: 0, originY: 0, width: 1, angle: 82 * Math.PI / 180 };
  const result = calibratePlacement({
    imageSize,
    placement: current,
    scalePair: pair,
    trueDistance: 0.8,
    rotationTarget: { mode: 'nearest-axis' }
  });

  near(pairSketchVector(pair, imageSize, result.placement).angle, Math.PI / 2, 1e-9);
  near(nearestOrthogonalAngle(82 * Math.PI / 180), Math.PI / 2);
});

test('can preserve the image center while rescaling and rotating', () => {
  const imageSize = { width: 640, height: 480 };
  const scalePair = { a: { x: 20, y: 400 }, b: { x: 620, y: 400 } };
  const current = { originX: -3, originY: 8, width: 4.2, angle: -0.42 };
  const center = { x: 320, y: 240 };
  const centerBefore = pixelToSketch(center, imageSize, current);

  const result = calibratePlacement({
    imageSize,
    placement: current,
    scalePair,
    trueDistance: 10,
    rotationTarget: { mode: 'vertical' },
    anchor: 'center'
  });

  pointNear(pixelToSketch(center, imageSize, result.placement), centerBefore, 1e-9);
});

test('rejects coincident calibration points', () => {
  assert.throws(() => calibratePlacement({
    imageSize: { width: 100, height: 100 },
    placement: { originX: 0, originY: 0, width: 1, angle: 0 },
    scalePair: { a: { x: 25, y: 25 }, b: { x: 25, y: 25 } },
    trueDistance: 1
  }), (error) => error instanceof CalibrationError && error.code === 'COINCIDENT_PAIR');
});

test('native sketch image placement conversion round-trips', () => {
  const entity = {
    btType: 'BTMSketchImageEntity-1',
    entityId: 'image-1',
    originX: 1.25,
    originY: -0.75,
    xaxisX: 0,
    xaxisY: 2,
    aspectRatio: 1.5,
    untouched: { keep: true }
  };

  const placement = placementFromNativeImageEntity(entity);
  near(placement.originX, 1.25);
  near(placement.originY, -0.75);
  near(placement.width, 2);
  near(placement.angle, Math.PI / 2);

  const target = { originX: -4, originY: 3, width: 5, angle: -Math.PI / 6 };
  const updated = applyPlacementToNativeImageEntity(entity, target);
  near(updated.xaxisX, 5 * Math.cos(-Math.PI / 6));
  near(updated.xaxisY, 5 * Math.sin(-Math.PI / 6));
  assert.deepEqual(updated.untouched, { keep: true });
  assert.notStrictEqual(updated, entity);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function layoutHarness() {
  const nodes = new Map();
  let focused;
  const listeners = {};
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      id, hidden: false, checked: true, disabled: false, children: [], attrs: {}, listeners: {},
      setAttribute(key, value) { this.attrs[key] = value; },
      append(...children) { this.children.push(...children); },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      contains(node) { return this === node || this.children.includes(node); },
      querySelectorAll() { return this.children; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      focus() { focused = id; }
    });
    return nodes.get(id);
  };
  const elements = Object.fromEntries(['setupCard', 'onshapeCard', 'settingsCard', 'settingsDetails', 'duplicateOffer', 'samePairToggle', 'authBadge'].map((id) => [id, $(id)]));
  const state = { result: undefined };
  const context = vm.createContext({ $, elements, state, document: { addEventListener(type, fn) { listeners[type] = fn; } }, requestAnimationFrame(fn) { fn(); }, drawSource() {}, drawPreview() {} });
  vm.runInContext(script.slice(script.indexOf('let activeFlyout = null;'), script.indexOf('function renderSetupCard(')) + '\ninitializeLayout();', context);
  return { $, state, elements, listeners, context, focused: () => focused };
}

test('rail opens one panel, changes panels, and restores focus when toggled closed', () => {
  const h = layoutHarness();
  h.$('connectionRailBtn').listeners.click();
  assert.equal(h.$('connectionPanel').hidden, false);
  assert.equal(h.$('documentPanel').hidden, true);
  assert.equal(h.$('connectionRailBtn').attrs['aria-expanded'], 'true');
  assert.equal(h.focused(), 'setupCard');
  h.$('settingsRailBtn').listeners.click();
  assert.equal(h.$('connectionPanel').hidden, true);
  assert.equal(h.$('settingsPanel').hidden, false);
  assert.equal(h.elements.settingsDetails.open, true);
  h.$('settingsRailBtn').listeners.click();
  assert.equal(h.$('layoutFlyout').hidden, true);
  assert.equal(h.focused(), 'settingsRailBtn');
});

test('Escape and outside presses close the panel; internal presses do not', () => {
  const h = layoutHarness();
  h.$('documentRailBtn').listeners.click();
  h.listeners.pointerdown({ target: h.$('layoutFlyout') });
  assert.equal(h.$('layoutFlyout').hidden, false);
  h.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(h.$('layoutFlyout').hidden, true);
  assert.equal(h.focused(), 'documentRailBtn');
  h.$('documentRailBtn').listeners.click();
  h.listeners.pointerdown({ target: {} });
  assert.equal(h.$('layoutFlyout').hidden, true);
});

test('preview requires a result and tabs support arrow-key navigation', () => {
  const h = layoutHarness();
  h.$('previewPanel').hidden = true;
  h.$('previewTab').listeners.click();
  assert.equal(h.$('previewPanel').hidden, true);
  h.state.result = {};
  h.$('sourceTab').listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(h.$('sourcePanel').hidden, true);
  assert.equal(h.$('previewPanel').hidden, false);
  assert.equal(h.$('previewTab').attrs['aria-selected'], 'true');
  assert.equal(h.focused(), 'previewTab');
});

test('layout moves existing cards and suppression offer without cloning ids', () => {
  const h = layoutHarness();
  assert.equal(h.$('connectionPanel').children[0], h.elements.setupCard);
  assert.equal(h.$('documentPanel').children[0], h.elements.onshapeCard);
  assert.equal(h.$('settingsPanel').children[0], h.elements.settingsCard);
  assert.equal(h.$('applyCard').children[0], h.elements.duplicateOffer);
  assert.equal(h.$('rotationCard').open, false);
  for (const id of ['rotationCard', 'resultsCard']) assert.match(html, new RegExp(`<details id="${id}"`));
  assert.match(script, /auth\.connection\?\.state === 'unconfigured'.*setFlyout\('connection'\)/);
  assert.match(script, /setFlyout\('document'\);\s*elements\.onshapeUrlInput\.focus/);
});

test('local 403 refusals keep their cause while upstream credential errors are translated', () => {
  const source = script.slice(script.indexOf('function describeApiError('), script.indexOf('\nfunction toast('));
  const describe = vm.runInNewContext(source + '\ndescribeApiError');
  for (const code of ['POLICY_DENIED', 'CAPABILITY_DENIED', 'CSRF']) {
    assert.equal(describe({ status: 403, payload: { code, error: 'Local refusal.' } }, { upstream: true }), 'Local refusal.');
  }
  for (const status of [401, 403]) assert.match(describe({ status, payload: { code: 'ERROR' } }, { upstream: true }), /Onshape rejected/);
});

test('pointerup before the animation frame commits drag movement and never places a pixel', () => {
  const handlers = {};
  const frames = [];
  let picks = 0;
  const state = { pickTarget: 'scale-a', view: { pointerId: 1, dragStart: { clientX: 0, clientY: 0, panX: 0, panY: 0, shouldPan: false }, dragMoved: false } };
  const context = vm.createContext({
    state,
    elements: { sourceCanvas: { getBoundingClientRect() { return {}; } }, cursorReadout: {}, canvasStage: { addEventListener(type, fn) { handlers[type] = fn; }, classList: { remove() {} } } },
    screenToImage() { return { x: 1, y: 1 }; }, drawLoupe() {}, drawSource() {}, recordPick() { picks++; }, toast() {}, requestAnimationFrame(fn) { frames.push(fn); }
  });
  vm.runInContext(script.slice(script.indexOf('  let pointerMoveScheduled = false;'), script.indexOf("  elements.canvasStage.addEventListener('pointerleave'")), context);
  handlers.pointermove({ pointerId: 1, clientX: 20, clientY: 10 });
  handlers.pointerup({ pointerId: 1, clientX: 20, clientY: 10 });
  assert.equal(picks, 0);
  assert.equal(state.view.panX, 20);
  assert.equal(state.view.panY, 10);
  frames.forEach((fn) => fn());
  assert.equal(picks, 0);
  assert.equal(state.view.panX, 20);
});

test('submitting setup tests the key without navigating or saving it', async () => {
  let submit;
  let tested = 0;
  let prevented = false;
  const start = script.indexOf("  elements.setupForm.addEventListener('submit'");
  const end = script.indexOf('\n  });', start) + '\n  });'.length;
  vm.runInNewContext(script.slice(start, end), {
    elements: { setupForm: { addEventListener(type, callback) { assert.equal(type, 'submit'); submit = callback; } } },
    handleSetupTest: async () => { tested++; }, setSetupError() {}
  });
  submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(tested, 1);
  assert.match(html, /id="setupTestBtn" type="submit"/);
  assert.match(html, /id="setupSaveBtn" type="button"/);
});

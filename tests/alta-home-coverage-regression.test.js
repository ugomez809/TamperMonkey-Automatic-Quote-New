const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.style = {};
    this.className = attrs.class || '';
    this.id = attrs.id || '';
    this.textContent = attrs.textContent || '';
    this.innerText = this.textContent;
    this.disabled = false;
    this.checked = !!attrs.checked;
    this.ownerDocument = null;
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  addEventListener() {}
  remove() {}
  scrollIntoView() {}
  focus() {}
  click() {}

  getClientRects() {
    return [{}];
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 10, height: 10 };
  }

  getAttribute(name) {
    return this.attributes[name] || '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  matches(selector) {
    if (selector === '[data-test-id]' || selector.includes('[data-test-id]')) {
      return !!this.attributes['data-test-id'];
    }
    if (selector.includes('input[type="checkbox"]')) {
      return this.tagName === 'INPUT' && this.attributes.type === 'checkbox';
    }
    if (selector.includes('[aria-checked="true"]')) {
      return this.attributes['aria-checked'] === 'true';
    }
    return false;
  }

  querySelector(selector) {
    if (selector === 'header') {
      return new FakeElement('header');
    }
    if (selector === '.hb-status' || selector === '.hb-log' || selector.startsWith('#alta-home-coverage-')) {
      return new FakeElement('div');
    }
    if (selector.includes('input[type="checkbox"]')) {
      return this.children.find((child) => child.tagName === 'INPUT' && child.attributes.type === 'checkbox') || null;
    }
    if (selector.includes('[aria-checked]')) {
      return this.children.find((child) => child.attributes['aria-checked'] != null) || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = this.querySelector(selector);
    return found ? [found] : [];
  }
}

function makeDiscountControl({ checked = false, label = 'Home/Auto' } = {}) {
  const control = new FakeElement('div', { 'data-test-id': 'BUNDLE_DISCOUNT_Home/Auto', textContent: label });
  const input = new FakeElement('input', { type: 'checkbox', checked });
  input.checked = checked;
  control.children.push(input);
  return control;
}

function loadHomeCoverageHooks({ discountControl = null } = {}) {
  const scriptPath = path.join(__dirname, '..', 'Alta', 'alta-home-coverage', 'alta-home-coverage.user.js');
  const source = fs.readFileSync(scriptPath, 'utf8').replace(
    /\n\}\)\(\);\s*$/,
    '\n  window.__altaHomeCoverageTestHooks = { cycleHomeAutoDiscount };\n})();\n'
  );

  const storage = new Map();
  const context = {
    console,
    navigator: { clipboard: { writeText: async () => {} } },
    location: { pathname: '/quote/home/home-coverage', search: '', href: 'https://alta.farmers.com/quote/home/home-coverage' },
    document: null,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    MouseEvent: function MouseEvent() {},
    PointerEvent: function PointerEvent() {}
  };
  context.window = context;
  context.document = {
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    createElement: (tag) => {
      const el = new FakeElement(tag);
      el.ownerDocument = context.document;
      return el;
    },
    querySelector: (selector) => {
      if (discountControl && selector.includes('BUNDLE_DISCOUNT_Home/Auto')) return discountControl;
      return null;
    },
    querySelectorAll: (selector) => {
      if (discountControl && selector === '[data-test-id]') return [discountControl];
      return [];
    },
    addEventListener: () => {},
    defaultView: context
  };
  context.document.body.ownerDocument = context.document;
  context.document.documentElement.ownerDocument = context.document;

  vm.runInNewContext(source, context, { filename: scriptPath });
  return context.window.__altaHomeCoverageTestHooks;
}

async function testCycleKeepsWaitingWhenDiscountControlTemporarilyMissing() {
  const hooks = loadHomeCoverageHooks();
  let thrown = null;
  let result;

  try {
    result = await hooks.cycleHomeAutoDiscount(false);
  } catch (err) {
    thrown = err;
  }

  assert.strictEqual(thrown, null, `cycle should not throw while control is missing: ${thrown && thrown.message}`);
  assert.strictEqual(result, false, 'cycle should report that no toggle nudge happened');
}

async function testCycleKeepsWaitingWhenDiscountControlDoesNotSwitch() {
  const hooks = loadHomeCoverageHooks({ discountControl: makeDiscountControl({ checked: false }) });
  let thrown = null;
  let result;

  try {
    result = await hooks.cycleHomeAutoDiscount(false);
  } catch (err) {
    thrown = err;
  }

  assert.strictEqual(thrown, null, `cycle should not throw when best-effort toggle fails: ${thrown && thrown.message}`);
  assert.strictEqual(result, false, 'cycle should report that no toggle nudge happened');
}

(async () => {
  await testCycleKeepsWaitingWhenDiscountControlTemporarilyMissing();
  await testCycleKeepsWaitingWhenDiscountControlDoesNotSwitch();
  console.log('alta-home-coverage regression tests passed');
})();

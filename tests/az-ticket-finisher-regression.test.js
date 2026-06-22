const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function loadFinisherHooks() {
  const scriptPath = path.join(__dirname, '..', 'AgencyZoom', 'az-ticket-finisher-tagger', 'az-ticket-finisher-tagger.user.js');
  const source = fs.readFileSync(scriptPath, 'utf8').replace(
    /\r?\n  init\(\);\r?\n/,
    `
  window.__azTicketFinisherTestHooks = {
    FIELD_ORDER,
    buildWorkflowDataFromProductChoices,
    buildSingleFieldPickerPrompt: typeof buildSingleFieldPickerPrompt === 'function' ? buildSingleFieldPickerPrompt : undefined,
    resolveSingleFieldPickerSelection: typeof resolveSingleFieldPickerSelection === 'function' ? resolveSingleFieldPickerSelection : undefined
  };
`
  );

  const storage = makeStorage();
  const context = {
    console,
    location: { href: 'https://app.agencyzoom.com/referral/pipeline', origin: 'https://app.agencyzoom.com' },
    localStorage: storage,
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    window: null,
    GM_getValue: () => undefined,
    GM_setValue: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.window = context;
  context.top = context;
  context.self = context;

  vm.runInNewContext(source, context, { filename: scriptPath });
  return context.window.__azTicketFinisherTestHooks;
}

function testAltaSubmissionNumberIsSeparateWorkflowField() {
  const hooks = loadFinisherHooks();
  const data = hooks.buildWorkflowDataFromProductChoices({
    azId: '98765',
    payload: {
      currentJob: {
        'AZ ID': '98765',
        SubmissionNumber: 'ALTA-SUB-123',
        'Account Number': 'ACCT-456'
      },
      bundle: {
        home: {
          ready: true,
          submissionNumber: 'HOME-SUB-789',
          data: {
            row: {
              'Submission Number': 'HOME-SUB-789',
              'Reconstruction Cost': '350000',
              'Done?': 'Yes'
            }
          }
        }
      }
    },
    homeChoice: {
      raw: {
        ready: true,
        row: {
          'Submission Number': 'HOME-SUB-789',
          'Reconstruction Cost': '350000',
          'Done?': 'Yes'
        }
      },
      source: 'test',
      score: 20
    }
  });

  assert.ok(hooks.FIELD_ORDER.includes('Alta Submission Number'), 'field setup should include Alta Submission Number');
  assert.strictEqual(data.fields['Alta Submission Number'], 'ALTA-SUB-123');
  assert.strictEqual(data.fields['Home Submission Number'], 'HOME-SUB-789');
  assert.strictEqual(data.fields['Account Number'], 'ACCT-456');
}

function testSingleFieldPickerResolvesOneConfiguredField() {
  const hooks = loadFinisherHooks();
  assert.strictEqual(typeof hooks.buildSingleFieldPickerPrompt, 'function', 'single-field prompt builder should be exported');
  assert.strictEqual(typeof hooks.resolveSingleFieldPickerSelection, 'function', 'single-field choice resolver should be exported');

  const altaIndex = hooks.FIELD_ORDER.indexOf('Alta Submission Number') + 1;
  const promptText = hooks.buildSingleFieldPickerPrompt();
  assert.ok(promptText.includes(`${altaIndex}. Alta Submission Number`), 'prompt should list Alta Submission Number');

  assert.strictEqual(
    hooks.resolveSingleFieldPickerSelection(String(altaIndex)),
    'Alta Submission Number',
    'numeric selection should resolve only the selected field'
  );
  assert.strictEqual(
    hooks.resolveSingleFieldPickerSelection('Account Number'),
    'Account Number',
    'field-name selection should resolve the selected field'
  );
  assert.strictEqual(
    hooks.resolveSingleFieldPickerSelection('not a field'),
    '',
    'invalid selections should not start a picker'
  );
}

testAltaSubmissionNumberIsSeparateWorkflowField();
testSingleFieldPickerResolvesOneConfiguredField();
console.log('az-ticket-finisher regression tests passed');

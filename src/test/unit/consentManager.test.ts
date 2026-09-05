import * as assert from 'assert';
import * as sinon from 'sinon';
import * as proxyquire from 'proxyquire';
import type * as vscode from 'vscode';

function buildContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (key: string, def: unknown) => (store.has(key) ? store.get(key) : def),
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;
}

suite('consentManager', () => {
  let showInformationMessage: sinon.SinonStub;
  let mod: typeof import('../../cache/consentManager');

  setup(() => {
    showInformationMessage = sinon.stub();
    mod = proxyquire.noCallThru()('../../cache/consentManager', {
      vscode: { window: { showInformationMessage } },
    });
  });

  test('defaults to "ask" for a new install', () => {
    const context = buildContext();
    assert.strictEqual(mod.getConsent(context), 'ask');
    assert.strictEqual(mod.isConsentGranted(context), false);
  });

  test('requestConsent("Enable schema caching") persists "enabled"', async () => {
    const context = buildContext();
    showInformationMessage.resolves('Enable schema caching');
    const granted = await mod.requestConsent(context);
    assert.strictEqual(granted, true);
    assert.strictEqual(mod.getConsent(context), 'enabled');
  });

  test('requestConsent("Never") persists "never" and short-circuits future prompts', async () => {
    const context = buildContext();
    showInformationMessage.resolves('Never');
    const granted = await mod.requestConsent(context);
    assert.strictEqual(granted, false);
    assert.strictEqual(mod.getConsent(context), 'never');

    showInformationMessage.resetHistory();
    const secondCall = await mod.requestConsent(context);
    assert.strictEqual(secondCall, false);
    assert.strictEqual(showInformationMessage.called, false, 'should not prompt again once "never" is set');
  });

  test('requestConsent("Not now") stays "ask" and prompts again next time', async () => {
    const context = buildContext();
    showInformationMessage.resolves('Not now');
    const granted = await mod.requestConsent(context);
    assert.strictEqual(granted, false);
    assert.strictEqual(mod.getConsent(context), 'ask');
  });

  test('resetConsent resets back to "ask"', async () => {
    const context = buildContext();
    await context.globalState.update('mssql-pilot.schemaCacheConsent', 'never');
    await mod.resetConsent(context);
    assert.strictEqual(mod.getConsent(context), 'ask');
  });
});

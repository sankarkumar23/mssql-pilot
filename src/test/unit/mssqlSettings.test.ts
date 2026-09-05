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

function buildHarness() {
  const showInformationMessage = sinon.stub();
  const configUpdate = sinon.stub().resolves();
  const configGet = sinon.stub().returns(true);
  const getConfiguration = sinon.stub().returns({ get: configGet, update: configUpdate });
  const mod: typeof import('../../utils/mssqlSettings') = proxyquire.noCallThru()('../../utils/mssqlSettings', {
    vscode: {
      workspace: { getConfiguration },
      window: { showInformationMessage },
      ConfigurationTarget: { Global: 1 },
    },
  });
  return { showInformationMessage, configUpdate, configGet, getConfiguration, mod };
}

suite('mssqlSettings.ensureMssqlErrorCheckingDisabled', () => {
  test('error checking currently enabled: turns it off globally and shows a one-time notice', async () => {
    const { showInformationMessage, configUpdate, getConfiguration, mod } = buildHarness();
    const context = buildContext();
    await mod.ensureMssqlErrorCheckingDisabled(context);

    assert.strictEqual(getConfiguration.calledWith('mssql'), true);
    assert.strictEqual(configUpdate.calledWith('intelliSense.enableErrorChecking', false, 1), true);
    assert.strictEqual(showInformationMessage.callCount, 1);
  });

  test('error checking already disabled: does not write config or show a notice', async () => {
    const { showInformationMessage, configUpdate, configGet, mod } = buildHarness();
    configGet.returns(false);
    const context = buildContext();
    await mod.ensureMssqlErrorCheckingDisabled(context);

    assert.strictEqual(configUpdate.called, false);
    assert.strictEqual(showInformationMessage.called, false);
  });

  test('notice is shown only once across repeated activations', async () => {
    const { showInformationMessage, configUpdate, configGet, mod } = buildHarness();
    const context = buildContext();
    await mod.ensureMssqlErrorCheckingDisabled(context);
    configGet.returns(true); // simulate the setting drifting back to enabled before next activation
    await mod.ensureMssqlErrorCheckingDisabled(context);

    assert.strictEqual(showInformationMessage.callCount, 1);
    assert.strictEqual(configUpdate.callCount, 2, 'still re-applies the setting each time it is found enabled');
  });
});

suite('mssqlSettings.ensureMssqlSuggestionsDisabled', () => {
  test('suggestions currently enabled: turns them off globally and shows a one-time notice', async () => {
    const { showInformationMessage, configUpdate, getConfiguration, mod } = buildHarness();
    const context = buildContext();
    await mod.ensureMssqlSuggestionsDisabled(context);

    assert.strictEqual(getConfiguration.calledWith('mssql'), true);
    assert.strictEqual(configUpdate.calledWith('intelliSense.enableSuggestions', false, 1), true);
    assert.strictEqual(showInformationMessage.callCount, 1);
  });

  test('suggestions already disabled: does not write config or show a notice', async () => {
    const { showInformationMessage, configUpdate, configGet, mod } = buildHarness();
    configGet.returns(false);
    const context = buildContext();
    await mod.ensureMssqlSuggestionsDisabled(context);

    assert.strictEqual(configUpdate.called, false);
    assert.strictEqual(showInformationMessage.called, false);
  });

  test('is independent of the error-checking notice flag', async () => {
    const { showInformationMessage, mod } = buildHarness();
    const context = buildContext();
    await mod.ensureMssqlErrorCheckingDisabled(context);
    await mod.ensureMssqlSuggestionsDisabled(context);

    assert.strictEqual(showInformationMessage.callCount, 2, 'each setting gets its own one-time notice');
  });
});

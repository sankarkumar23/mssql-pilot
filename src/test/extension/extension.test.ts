import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'erexer.mssql-pilot';

suite('Extension activation', () => {
  test('activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `expected extension ${EXT_ID} to be found`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  test('registers all mssql-pilot commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'mssql-pilot.resyncCurrentDatabase',
      'mssql-pilot.resyncAll',
      'mssql-pilot.clearCacheCurrentDatabase',
      'mssql-pilot.clearCacheAll',
      'mssql-pilot.showCacheStatus',
    ];
    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `expected command ${cmd} to be registered`);
    }
  });
});

import * as assert from 'assert';
import * as vscode from 'vscode';
import { disposeStatusBar, startBuildingStatus, stopBuildingStatus } from '../../utils/statusBar';

interface FakeStatusBarItem {
  text: string;
  shown: boolean;
}

function lastItem(): FakeStatusBarItem {
  return (vscode.window as unknown as { _lastStatusBarItem: FakeStatusBarItem })._lastStatusBarItem;
}

suite('statusBar.startBuildingStatus/stopBuildingStatus', () => {
  teardown(() => disposeStatusBar());

  test('shows a single-database message while its first sync is in progress, hides once it stops', () => {
    startBuildingStatus('key1', 'MYSERVER/MyDb');
    const item = lastItem();
    assert.strictEqual(item.shown, true);
    assert.match(item.text, /Building IntelliSense \(MYSERVER\/MyDb\)/);

    stopBuildingStatus('key1');
    assert.strictEqual(item.shown, false);
  });

  test('two concurrent first syncs show a count, not two labels; stays shown until the last one finishes', () => {
    startBuildingStatus('key1', 'A/db1');
    startBuildingStatus('key2', 'B/db2');
    assert.match(lastItem().text, /2 databases/);

    stopBuildingStatus('key1');
    assert.strictEqual(lastItem().shown, true);
    assert.match(lastItem().text, /B\/db2/);

    stopBuildingStatus('key2');
    assert.strictEqual(lastItem().shown, false);
  });
});

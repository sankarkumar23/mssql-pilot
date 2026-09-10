import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  clearAllRememberedKeys,
  forgetDocument,
  getRememberedConnectionIdForDocument,
  getRememberedKeyForDocument,
  rememberConnectionIdForDocument,
  rememberKeyForDocument,
} from '../../cache/documentKeyTracker';

suite('documentKeyTracker', () => {
  teardown(() => clearAllRememberedKeys());

  test('remembers and forgets both the key and the connection id for a document', () => {
    const uri = vscode.Uri.file('C:\\temp\\query.sql');
    rememberKeyForDocument(uri, { server: 'MyServer', database: 'MyDb' });
    rememberConnectionIdForDocument(uri, 'conn-123');

    assert.deepStrictEqual(getRememberedKeyForDocument(uri), { server: 'MyServer', database: 'MyDb' });
    assert.strictEqual(getRememberedConnectionIdForDocument(uri), 'conn-123');

    forgetDocument(uri);

    assert.strictEqual(getRememberedKeyForDocument(uri), undefined);
    assert.strictEqual(getRememberedConnectionIdForDocument(uri), undefined);
  });
});

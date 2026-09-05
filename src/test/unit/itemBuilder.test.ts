import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildCompletionItems } from '../../completion/itemBuilder';
import { DatabaseSchemaCache, TableInfo } from '../../cache/schemaTypes';

function fakeDocument(text: string, cursorLineText: string): vscode.TextDocument {
  return {
    getText: () => text,
    lineAt: (_line: number) => ({ text: cursorLineText }),
  } as unknown as vscode.TextDocument;
}

function buildCache(objects: DatabaseSchemaCache['objects']): DatabaseSchemaCache {
  return { formatVersion: 1, server: 's', database: 'd', objects, lastFullSyncAt: '', lastDeltaSyncAt: '' };
}

const ordersTable: TableInfo = {
  kind: 'table',
  objectId: 1,
  schema: 'dbo',
  name: 'Orders',
  modifyDate: 'x',
  columns: [
    {
      name: 'Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
      isNullable: false, isIdentity: true, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
    },
    {
      name: 'Total', ordinal: 2, dataType: 'money', maxLength: 8, precision: 19, scale: 4,
      isNullable: true, isIdentity: false, isComputed: false, defaultDefinition: null, isPrimaryKey: false,
    },
  ],
};

function positionAtEndOf(lineText: string): vscode.Position {
  return { line: 0, character: lineText.length } as vscode.Position;
}

suite('itemBuilder.buildCompletionItems', () => {
  test('no qualifier: returns schema-qualified object names (VS Code filters client-side by what is typed)', () => {
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT * FROM Ord';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, 'dbo.Orders');
  });

  test('schema qualifier suggests that schema\'s objects', () => {
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT * FROM dbo.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, 'dbo.Orders');
  });

  test('alias qualifier suggests that table\'s columns', () => {
    const cache = buildCache({ 1: ordersTable });
    const text = 'SELECT o. FROM dbo.Orders AS o';
    const lineText = 'SELECT o.';
    const doc = fakeDocument(text, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    const labels = items.map((i) => i.label).sort();
    assert.deepStrictEqual(labels, ['Id', 'Total']);
  });

  test('unresolvable qualifier returns no items', () => {
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT unknown.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items.length, 0);
  });
});

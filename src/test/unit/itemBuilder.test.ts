import * as assert from 'assert';
import * as vscode from 'vscode';
import * as proxyquire from 'proxyquire';
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

const pilotTestTable: TableInfo = {
  kind: 'table',
  objectId: 2,
  schema: 'dbo',
  name: 'PilotTestTable',
  modifyDate: 'x',
  columns: [],
};

const ownersTable: TableInfo = {
  kind: 'table',
  objectId: 3,
  schema: 'dbo',
  name: 'Owners',
  modifyDate: 'x',
  columns: [],
};

const customersTable: TableInfo = {
  kind: 'table',
  objectId: 4,
  schema: 'dbo',
  name: 'Customers',
  modifyDate: 'x',
  columns: [
    {
      name: 'Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
      isNullable: false, isIdentity: true, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
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

  test('schema qualifier already typed, not in a table-reference position: insertText is bare name, no alias', () => {
    const cache = buildCache({ 1: ordersTable });
    // "SELECT dbo." has no preceding FROM/JOIN, so no alias is offered.
    const lineText = 'SELECT dbo.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items[0].insertText, 'Orders');
  });

  test('table-reference position: PascalCase table name gets a first-letter-of-each-word alias suggestion', () => {
    const cache = buildCache({ 2: pilotTestTable });
    const lineText = 'SELECT * FROM dbo.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    const snippet = items[0].insertText as unknown as { value: string };
    assert.strictEqual(snippet.value, 'PilotTestTable ${1:ptt}');
  });

  test('table-reference position: no word boundaries in the name falls back to its first letter', () => {
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT * FROM dbo.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    const snippet = items[0].insertText as unknown as { value: string };
    assert.strictEqual(snippet.value, 'Orders ${1:o}');
  });

  test('newLineAfterTableAlias enabled: appends a trailing newline and an explicit final tab stop', () => {
    const mod: typeof import('../../completion/itemBuilder') = proxyquire.noCallThru()(
      '../../completion/itemBuilder',
      { '../utils/config': { shouldAddNewLineAfterTableAlias: () => true } }
    );
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT * FROM dbo.';
    const doc = fakeDocument(lineText, lineText);
    const items = mod.buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    const snippet = items[0].insertText as unknown as { value: string };
    assert.strictEqual(snippet.value, 'Orders ${1:o}\n$0');
  });

  test('newLineAfterTableAlias disabled (default): no trailing newline', () => {
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT * FROM dbo.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    const snippet = items[0].insertText as unknown as { value: string };
    assert.strictEqual(snippet.value, 'Orders ${1:o}');
  });

  test('table-reference position: suggested alias avoids one already used in the document', () => {
    const cache = buildCache({ 1: ordersTable, 3: ownersTable });
    const text = 'SELECT * FROM dbo.Orders o JOIN dbo.';
    const doc = fakeDocument(text, text);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(text));
    const owners = items.find((i) => i.label === 'dbo.Owners')!;
    const snippet = owners.insertText as unknown as { value: string };
    assert.strictEqual(snippet.value, 'Owners ${1:o2}');
  });

  test('no qualifier, not in a table-reference position: no alias suggestion', () => {
    const cache = buildCache({ 1: ordersTable });
    // "SELECT Ord" has no preceding FROM/JOIN, so no alias is offered.
    const lineText = 'SELECT Ord';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items[0].insertText, 'dbo.Orders');
  });

  test('no qualifier in WHERE with joins in scope: suggests alias.column for every joined table, not the whole database', () => {
    const cache = buildCache({ 1: ordersTable, 4: customersTable, 2: pilotTestTable });
    const text = 'SELECT * FROM dbo.Orders o JOIN dbo.Customers c ON o.CustomerId = c.Id WHERE ';
    const doc = fakeDocument(text, text);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(text));
    const labels = items.map((i) => i.label).sort();
    // Both joined tables' columns, alias-qualified — and nothing from the
    // unrelated pilotTestTable, which isn't part of this query at all.
    assert.deepStrictEqual(labels, ['c.Id', 'o.Id', 'o.Total']);
  });

  test('no qualifier with no aliases anywhere in the query: falls back to the full object list', () => {
    const cache = buildCache({ 1: ordersTable });
    const text = 'SELECT * FROM dbo.Orders WHERE ';
    const doc = fakeDocument(text, text);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(text));
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

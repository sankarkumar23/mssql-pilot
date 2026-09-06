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
  test('no qualifier: resolves the schema first, not every table in the database', () => {
    const cache = buildCache({ 1: ordersTable, 4: customersTable });
    const lineText = 'SELECT * FROM Ord';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    // Both tables share schema "dbo" -> exactly one schema suggestion, not two table suggestions.
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, 'dbo');
  });

  test('no qualifier, multiple schemas: suggests every distinct schema once, sorted', () => {
    const cache = buildCache({
      1: ordersTable,
      5: { ...pilotTestTable, objectId: 5, schema: 'TRDCPAPP', name: 'Trade' },
      6: { ...pilotTestTable, objectId: 6, schema: 'S4RAW', name: 'RawFeed' },
    });
    const lineText = 'SELECT * FROM ';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.deepStrictEqual(items.map((i) => i.label), ['dbo', 'S4RAW', 'TRDCPAPP']);
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

  test('no qualifier, not in a table-reference position: still resolves schema first, no alias involved', () => {
    const cache = buildCache({ 1: ordersTable });
    // "SELECT Ord" has no preceding FROM/JOIN, so no alias is offered — and
    // since there's nothing to resolve via alias.column either, it's still
    // schema-first, same as the table-reference-position case.
    const lineText = 'SELECT Ord';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items[0].insertText, 'dbo');
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

  test('no qualifier with no aliases anywhere in the query: falls back to schema-first, not a flat table list', () => {
    const cache = buildCache({ 1: ordersTable });
    const text = 'SELECT * FROM dbo.Orders WHERE ';
    const doc = fakeDocument(text, text);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(text));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, 'dbo');
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

  test('table/column names needing quoting are bracket-quoted in insertText, but not in the label', () => {
    const spacedTable: TableInfo = {
      kind: 'table',
      objectId: 7,
      schema: 'My Schema',
      name: 'My Table',
      modifyDate: 'x',
      columns: [
        {
          name: 'Order Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
          isNullable: false, isIdentity: true, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
        },
      ],
    };
    const cache = buildCache({ 7: spacedTable });

    // Schema-list stage: label plain, insertText quoted.
    const schemaItems = buildCompletionItems(cache, fakeDocument('SELECT * FROM ', 'SELECT * FROM '), positionAtEndOf('SELECT * FROM '));
    assert.strictEqual(schemaItems[0].label, 'My Schema');
    assert.strictEqual(schemaItems[0].insertText, '[My Schema]');

    // Table stage, schema already typed (bracketed, as the previous step would insert it).
    const lineText = 'SELECT * FROM [My Schema].';
    const tableItems = buildCompletionItems(cache, fakeDocument(lineText, lineText), positionAtEndOf(lineText));
    assert.strictEqual(tableItems[0].label, 'My Schema.My Table');
    const snippet = tableItems[0].insertText as unknown as { value: string };
    assert.ok(snippet.value.startsWith('[My Table] '), snippet.value);

    // Column stage via alias.
    const text2 = 'SELECT t. FROM [My Schema].[My Table] t';
    const lineText2 = 'SELECT t.';
    const colItems = buildCompletionItems(cache, fakeDocument(text2, lineText2), positionAtEndOf(lineText2));
    assert.strictEqual(colItems[0].label, 'Order Id');
    assert.strictEqual(colItems[0].insertText, '[Order Id]');
  });

  test('unresolvable qualifier returns no items', () => {
    const cache = buildCache({ 1: ordersTable });
    const lineText = 'SELECT unknown.';
    const doc = fakeDocument(lineText, lineText);
    const items = buildCompletionItems(cache, doc, positionAtEndOf(lineText));
    assert.strictEqual(items.length, 0);
  });
});

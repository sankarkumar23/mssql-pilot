import * as assert from 'assert';
import { getSchemaIndex } from '../../cache/schemaIndex';
import { resolveReferenceAtWord } from '../../definition/referenceResolver';
import { DatabaseSchemaCache, RoutineInfo, TableInfo } from '../../cache/schemaTypes';

function buildCache(objects: DatabaseSchemaCache['objects']): DatabaseSchemaCache {
  return {
    formatVersion: 2,
    server: 's',
    database: 'd',
    objects,
    schemas: [...new Set(Object.values(objects).map((o) => o.schema))],
    lastFullSyncAt: '',
    lastDeltaSyncAt: '',
  };
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

const salesOrdersTable: TableInfo = {
  kind: 'table',
  objectId: 8,
  schema: 'sales',
  name: 'Orders',
  modifyDate: 'x',
  columns: [
    {
      name: 'SalesOrderId', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
      isNullable: false, isIdentity: true, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
    },
  ],
};

const myProc: RoutineInfo = {
  kind: 'procedure',
  objectId: 9,
  schema: 'dbo',
  name: 'MyProc',
  modifyDate: 'x',
  parameters: [
    { name: '@Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0, isOutput: false, hasDefault: false },
  ],
};

const specialCharTable: TableInfo = {
  kind: 'table',
  objectId: 10,
  schema: 'S4RAW',
  name: '/DMBE/TM_DEALHDR',
  modifyDate: 'x',
  columns: [
    {
      name: '/DMBE/ID', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
      isNullable: false, isIdentity: false, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
    },
  ],
};

const dottedNameTable: TableInfo = {
  kind: 'table',
  objectId: 11,
  schema: 'S4RAW',
  name: 'TM.DEALHDR',
  modifyDate: 'x',
  columns: [],
};

/** Resolves for the LAST occurrence of `word` in `text` (single-line fixtures only). */
function resolveAt(text: string, word: string, cache: DatabaseSchemaCache) {
  const index = getSchemaIndex(cache);
  const start = text.lastIndexOf(word);
  let end = start + word.length;
  if (start > 0 && text[start - 1] === '[' && text[end] === ']') {
    end += 1;
  }
  assert.ok(end >= word.length, `"${word}" not found in "${text}"`);
  return resolveReferenceAtWord(() => text, text.slice(0, end), word, index);
}

suite('referenceResolver.resolveReferenceAtWord', () => {
  test('table references in FROM/JOIN resolve without scanning the whole document for aliases', () => {
    const cache = buildCache({ 1: ordersTable, 8: salesOrdersTable });
    const index = getSchemaIndex(cache);
    const result = resolveReferenceAtWord(
      () => { throw new Error('should not need document text for FROM/JOIN object references'); },
      'SELECT * FROM sales.Orders',
      'Orders',
      index
    );
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.schema, 'sales');
  });

  test('schema-qualified table name in FROM resolves to that exact schema\'s table, even when the same name exists elsewhere', () => {
    const cache = buildCache({ 1: ordersTable, 8: salesOrdersTable });
    const result = resolveAt('SELECT * FROM sales.Orders', 'Orders', cache);
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.schema, 'sales');
    assert.strictEqual(result?.target.name, 'Orders');
  });

  test('a schema-less table reference falls back to the shared dbo-preference resolution', () => {
    const cache = buildCache({ 1: ordersTable });
    const result = resolveAt('SELECT * FROM Orders', 'Orders', cache);
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.schema, 'dbo');
  });

  test('an alias on its own (no dot) resolves to the whole table it refers to', () => {
    const cache = buildCache({ 1: ordersTable });
    const result = resolveAt('SELECT * FROM dbo.Orders ord', 'ord', cache);
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.name, 'Orders');
  });

  test('alias.column resolves to that column on the exact schema the alias refers to', () => {
    const cache = buildCache({ 1: ordersTable, 8: salesOrdersTable });
    const result = resolveAt('SELECT ord.SalesOrderId FROM sales.Orders ord', 'SalesOrderId', cache);
    assert.strictEqual(result?.kind, 'column');
    assert.strictEqual(result?.target.schema, 'sales');
    assert.strictEqual((result as { columnName: string }).columnName, 'SalesOrderId');
  });

  test('a schema-qualified routine call resolves to the routine object', () => {
    const cache = buildCache({ 9: myProc });
    const result = resolveAt('EXEC dbo.MyProc', 'MyProc', cache);
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.kind, 'procedure');
    assert.strictEqual(result?.target.name, 'MyProc');
  });

  test('a schema-qualified bracket-quoted special-character table name resolves to the table object', () => {
    const cache = buildCache({ 10: specialCharTable });
    const result = resolveAt('SELECT * FROM S4RAW.[/DMBE/TM_DEALHDR]', '/DMBE/TM_DEALHDR', cache);
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.schema, 'S4RAW');
    assert.strictEqual(result?.target.name, '/DMBE/TM_DEALHDR');
  });

  test('a bracket-quoted identifier containing dots stays a single object name', () => {
    const cache = buildCache({ 11: dottedNameTable });
    const result = resolveAt('SELECT * FROM S4RAW.[TM.DEALHDR]', 'TM.DEALHDR', cache);
    assert.strictEqual(result?.kind, 'object');
    assert.strictEqual(result?.target.schema, 'S4RAW');
    assert.strictEqual(result?.target.name, 'TM.DEALHDR');
  });

  test('an unresolvable identifier returns undefined', () => {
    const cache = buildCache({ 1: ordersTable });
    const result = resolveAt('SELECT * FROM dbo.Unknown', 'Unknown', cache);
    assert.strictEqual(result, undefined);
  });
});

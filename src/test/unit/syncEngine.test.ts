import * as assert from 'assert';
import { diffObjectListing, assembleSchemaObjects } from '../../cache/syncEngine';
import { ObjectListingRow, ColumnRow, ParameterRow } from '../../cache/schemaQueries';
import { SchemaObject, TableInfo, RoutineInfo } from '../../cache/schemaTypes';

function row(overrides: Partial<ObjectListingRow>): ObjectListingRow {
  return {
    objectId: 1,
    schemaName: 'dbo',
    objectName: 'Foo',
    objectType: 'U',
    modifyDate: '2026-01-01T00:00:00.000',
    ...overrides,
  };
}

suite('syncEngine.diffObjectListing', () => {
  test('empty cache -> everything is added', () => {
    const fresh = [row({ objectId: 1 }), row({ objectId: 2 })];
    const diff = diffObjectListing({}, fresh);
    assert.strictEqual(diff.added.length, 2);
    assert.strictEqual(diff.changed.length, 0);
    assert.strictEqual(diff.removed.length, 0);
  });

  test('empty fresh listing -> everything is removed', () => {
    const cached: Record<number, SchemaObject> = {
      1: { kind: 'table', objectId: 1, schema: 'dbo', name: 'Foo', modifyDate: 'x', columns: [] },
    };
    const diff = diffObjectListing(cached, []);
    assert.deepStrictEqual(diff.removed, [1]);
  });

  test('unchanged modifyDate/name/schema -> counted as unchanged, not added or changed', () => {
    const cached: Record<number, SchemaObject> = {
      1: { kind: 'table', objectId: 1, schema: 'dbo', name: 'Foo', modifyDate: '2026-01-01T00:00:00.000', columns: [] },
    };
    const diff = diffObjectListing(cached, [row({ objectId: 1 })]);
    assert.strictEqual(diff.unchangedCount, 1);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.changed.length, 0);
  });

  test('changed modifyDate -> changed', () => {
    const cached: Record<number, SchemaObject> = {
      1: { kind: 'table', objectId: 1, schema: 'dbo', name: 'Foo', modifyDate: '2020-01-01T00:00:00.000', columns: [] },
    };
    const diff = diffObjectListing(cached, [row({ objectId: 1, modifyDate: '2026-01-01T00:00:00.000' })]);
    assert.strictEqual(diff.changed.length, 1);
  });

  test('sp_rename case: same modifyDate but a different name is still detected as changed', () => {
    // sys.objects.modify_date does NOT update on sp_rename, so name/schema
    // must be compared too, or a rename would be silently missed.
    const cached: Record<number, SchemaObject> = {
      1: { kind: 'table', objectId: 1, schema: 'dbo', name: 'OldName', modifyDate: '2026-01-01T00:00:00.000', columns: [] },
    };
    const diff = diffObjectListing(
      cached,
      [row({ objectId: 1, objectName: 'NewName', modifyDate: '2026-01-01T00:00:00.000' })]
    );
    assert.strictEqual(diff.changed.length, 1);
    assert.strictEqual(diff.changed[0].objectName, 'NewName');
  });
});

suite('syncEngine.assembleSchemaObjects', () => {
  test('builds a TableInfo with its columns', () => {
    const rows = [row({ objectId: 1, objectType: 'U' })];
    const col: ColumnRow = {
      objectId: 1, columnId: 1, name: 'Id', dataType: 'int', maxLength: 4, precision: 10, scale: 0,
      isNullable: false, isIdentity: true, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
    };
    const columnsByObjectId = new Map([[1, [col]]]);
    const result = assembleSchemaObjects(rows, columnsByObjectId, new Map());
    const table = result[1] as TableInfo;
    assert.strictEqual(table.kind, 'table');
    assert.strictEqual(table.columns.length, 1);
    assert.strictEqual(table.columns[0].name, 'Id');
    assert.strictEqual(table.columns[0].isPrimaryKey, true);
  });

  test('builds a RoutineInfo with parameters and a return type, skipping the parameter_id=0 row', () => {
    const rows = [row({ objectId: 2, objectType: 'FN' })];
    const returnRow: ParameterRow = {
      objectId: 2, parameterId: 0, name: '', dataType: 'int',
      maxLength: null, precision: null, scale: null, isOutput: false, hasDefault: false,
    };
    const paramRow: ParameterRow = {
      objectId: 2, parameterId: 1, name: '@x', dataType: 'int',
      maxLength: null, precision: null, scale: null, isOutput: false, hasDefault: false,
    };
    const parametersByObjectId = new Map([[2, [returnRow, paramRow]]]);
    const result = assembleSchemaObjects(rows, new Map(), parametersByObjectId);
    const routine = result[2] as RoutineInfo;
    assert.strictEqual(routine.kind, 'scalarFunction');
    assert.strictEqual(routine.returnType, 'int');
    assert.strictEqual(routine.parameters.length, 1);
    assert.strictEqual(routine.parameters[0].name, '@x');
  });

  test('skips a listing row whose object type has no known kind mapping, without throwing', () => {
    const rows = [row({ objectId: 3, objectType: 'UNKNOWN_TYPE' })];
    const result = assembleSchemaObjects(rows, new Map(), new Map());
    assert.strictEqual(result[3], undefined);
  });
});

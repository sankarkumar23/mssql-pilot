import * as assert from 'assert';
import { MockConnectionSharingService } from './mocks/mockMssqlApi';
import { objectListingResult, columnsResult } from './mocks/sampleSchemaRows';
import { runSync } from '../../cache/syncEngine';
import { emptyDatabaseSchemaCache } from '../../cache/schemaTypes';
import { TableInfo } from '../../cache/schemaTypes';

suite('syncEngine.runSync (integration)', () => {
  let cs: MockConnectionSharingService;

  setup(() => {
    cs = new MockConnectionSharingService();
  });

  test('full sync populates objects from a fresh listing + column detail queries', async () => {
    cs.executeSimpleQuery.callsFake(async (_uri: string, sql: string) => {
      if (sql.includes('FROM sys.objects')) {
        return objectListingResult([[1, 'dbo', 'Orders', 'U', '2026-01-01T00:00:00.000']]);
      }
      if (sql.includes('FROM sys.columns')) {
        return columnsResult([[1, 1, 'Id', 'int']]);
      }
      return { rowCount: 0, columnInfo: [], rows: [] };
    });

    const current = emptyDatabaseSchemaCache('HOST', 'DB');
    const next = await runSync(cs, 'mssql-pilot', 'conn-1', current);

    assert.ok(next);
    assert.strictEqual(Object.keys(next!.objects).length, 1);
    const table = next!.objects[1] as TableInfo;
    assert.strictEqual(table.name, 'Orders');
    assert.strictEqual(table.columns[0].name, 'Id');
    assert.ok(next!.lastFullSyncAt.length > 0);
    assert.ok(cs.disconnect.called, 'connection should always be released');
  });

  test('delta sync with an unchanged listing fetches zero detail queries', async () => {
    const listing = objectListingResult([[1, 'dbo', 'Orders', 'U', '2026-01-01T00:00:00.000']]);
    let columnQueryCount = 0;
    cs.executeSimpleQuery.callsFake(async (_uri: string, sql: string) => {
      if (sql.includes('FROM sys.objects')) return listing;
      if (sql.includes('FROM sys.columns')) {
        columnQueryCount++;
        return columnsResult([]);
      }
      return { rowCount: 0, columnInfo: [], rows: [] };
    });

    const current = emptyDatabaseSchemaCache('HOST', 'DB');
    current.objects[1] = {
      kind: 'table', objectId: 1, schema: 'dbo', name: 'Orders', modifyDate: '2026-01-01T00:00:00.000', columns: [],
    };

    const next = await runSync(cs, 'mssql-pilot', 'conn-1', current);
    assert.ok(next);
    assert.strictEqual(columnQueryCount, 0, 'unchanged objects should not trigger a detail query');
  });

  test('a dropped object is removed from the cache', async () => {
    cs.executeSimpleQuery.callsFake(async (_uri: string, sql: string) => {
      if (sql.includes('FROM sys.objects')) return objectListingResult([]);
      return { rowCount: 0, columnInfo: [], rows: [] };
    });

    const current = emptyDatabaseSchemaCache('HOST', 'DB');
    current.objects[1] = { kind: 'table', objectId: 1, schema: 'dbo', name: 'Orders', modifyDate: 'x', columns: [] };

    const next = await runSync(cs, 'mssql-pilot', 'conn-1', current);
    assert.ok(next);
    assert.strictEqual(Object.keys(next!.objects).length, 0);
  });

  test('a query failure is non-fatal: returns undefined and still releases the connection', async () => {
    cs.executeSimpleQuery.rejects(new Error('Msg 229, Level 14: SELECT permission denied'));
    const current = emptyDatabaseSchemaCache('HOST', 'DB');
    const next = await runSync(cs, 'mssql-pilot', 'conn-1', current);
    assert.strictEqual(next, undefined);
    assert.ok(cs.disconnect.called, 'connection should still be released on failure');
  });
});

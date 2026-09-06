import * as assert from 'assert';
import { getSchemaIndex } from '../../cache/schemaIndex';
import { DatabaseSchemaCache, TableInfo } from '../../cache/schemaTypes';

function table(objectId: number, schema: string, name: string): TableInfo {
  return { kind: 'table', objectId, schema, name, modifyDate: 'x', columns: [] };
}

function buildCache(objects: DatabaseSchemaCache['objects'], schemas: string[] = []): DatabaseSchemaCache {
  return { formatVersion: 2, server: 's', database: 'd', objects, schemas, lastFullSyncAt: '', lastDeltaSyncAt: '' };
}

suite('schemaIndex.getSchemaIndex', () => {
  test('groups objects by lowercased schema name', () => {
    const cache = buildCache({
      1: table(1, 'dbo', 'Orders'),
      2: table(2, 'DBO', 'Customers'),
      3: table(3, 'TRDCPAPP', 'Trade'),
    });
    const index = getSchemaIndex(cache);
    assert.deepStrictEqual(
      index.bySchema.get('dbo')?.map((o) => o.name),
      ['Orders', 'Customers']
    );
    assert.deepStrictEqual(
      index.bySchema.get('trdcpapp')?.map((o) => o.name),
      ['Trade']
    );
  });

  test('groups objects by lowercased bare name, across schemas, in objectId order', () => {
    const cache = buildCache({
      5: table(5, 'TRDCPAPP', 'Position'),
      2: table(2, 'dbo', 'Position'),
    });
    const index = getSchemaIndex(cache);
    // Object.values on a Record keyed by number enumerates ascending by key
    // regardless of insertion order — objectId 2 before 5.
    assert.deepStrictEqual(
      index.byName.get('position')?.map((o) => o.schema),
      ['dbo', 'TRDCPAPP']
    );
  });

  test('the schema list is sourced from cache.schemas, sorted — not derived from the objects present', () => {
    const cache = buildCache({ 1: table(1, 'dbo', 'Orders') }, ['TRDCPAPP', 'dbo', 'S4RAW']);
    const index = getSchemaIndex(cache);
    assert.deepStrictEqual(index.schemas, ['dbo', 'S4RAW', 'TRDCPAPP']);
  });

  test('a schema listed in cache.schemas with no cached objects still shows up (the capped-sync case)', () => {
    // Simulates maxObjectsPerFirstSync having capped the object listing before
    // TRDCPAPP's objects were reached — the schema itself must still be known.
    const cache = buildCache({ 1: table(1, 'dbo', 'Orders') }, ['dbo', 'TRDCPAPP']);
    const index = getSchemaIndex(cache);
    assert.deepStrictEqual(index.schemas, ['dbo', 'TRDCPAPP']);
    assert.strictEqual(index.bySchema.get('trdcpapp'), undefined);
  });

  test('an empty cache yields empty structures, not a throw', () => {
    const index = getSchemaIndex(buildCache({}));
    assert.deepStrictEqual(index.all, []);
    assert.deepStrictEqual(index.schemas, []);
    assert.strictEqual(index.bySchema.size, 0);
    assert.strictEqual(index.byName.size, 0);
  });

  test('is memoized by cache identity: the same cache object returns the same index instance', () => {
    const cache = buildCache({ 1: table(1, 'dbo', 'Orders') }, ['dbo']);
    assert.strictEqual(getSchemaIndex(cache), getSchemaIndex(cache));
  });

  test('a different cache object (even with identical content) gets its own index', () => {
    const cacheA = buildCache({ 1: table(1, 'dbo', 'Orders') }, ['dbo']);
    const cacheB = buildCache({ 1: table(1, 'dbo', 'Orders') }, ['dbo']);
    assert.notStrictEqual(getSchemaIndex(cacheA), getSchemaIndex(cacheB));
  });
});

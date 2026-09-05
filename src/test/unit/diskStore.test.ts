import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  readDatabaseSchemaCache,
  writeDatabaseSchemaCache,
  deleteDatabaseSchemaCache,
  readManifest,
  upsertManifestEntry,
  removeManifestEntry,
  clearAllOnDisk,
} from '../../cache/diskStore';
import { emptyDatabaseSchemaCache } from '../../cache/schemaTypes';

suite('diskStore', () => {
  let tmpDir: string;
  let globalStorageUri: vscode.Uri;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mssql-pilot-test-'));
    globalStorageUri = vscode.Uri.file(tmpDir);
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('round-trips a DatabaseSchemaCache through an atomic write', async () => {
    const cache = emptyDatabaseSchemaCache('MYHOST', 'MyDb');
    cache.objects[1] = { kind: 'table', objectId: 1, schema: 'dbo', name: 'Foo', modifyDate: 'x', columns: [] };
    await writeDatabaseSchemaCache(globalStorageUri, 'key1', cache);

    const loaded = await readDatabaseSchemaCache(globalStorageUri, 'key1');
    assert.ok(loaded);
    assert.strictEqual(loaded!.server, 'MYHOST');
    assert.strictEqual(Object.keys(loaded!.objects).length, 1);
  });

  test('reading a missing cache returns undefined', async () => {
    const loaded = await readDatabaseSchemaCache(globalStorageUri, 'does-not-exist');
    assert.strictEqual(loaded, undefined);
  });

  test('a corrupt file is treated as absent, not thrown', async () => {
    fs.mkdirSync(path.join(tmpDir, 'schema-cache'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'schema-cache', 'bad.json'), '{ not valid json');
    const loaded = await readDatabaseSchemaCache(globalStorageUri, 'bad');
    assert.strictEqual(loaded, undefined);
  });

  test('a format-version mismatch is treated as absent', async () => {
    fs.mkdirSync(path.join(tmpDir, 'schema-cache'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'schema-cache', 'old.json'), JSON.stringify({ formatVersion: 999 }));
    const loaded = await readDatabaseSchemaCache(globalStorageUri, 'old');
    assert.strictEqual(loaded, undefined);
  });

  test('manifest upsert/remove round trip', async () => {
    await upsertManifestEntry(globalStorageUri, {
      cacheKey: 'key1', server: 'MYHOST', database: 'MyDb', objectCount: 5,
      lastFullSyncAt: 'a', lastDeltaSyncAt: 'b',
    });
    let manifest = await readManifest(globalStorageUri);
    assert.strictEqual(manifest.entries.length, 1);

    await removeManifestEntry(globalStorageUri, 'key1');
    manifest = await readManifest(globalStorageUri);
    assert.strictEqual(manifest.entries.length, 0);
  });

  test('clearAllOnDisk removes every cache file', async () => {
    const cache = emptyDatabaseSchemaCache('MYHOST', 'MyDb');
    await writeDatabaseSchemaCache(globalStorageUri, 'key1', cache);
    await writeDatabaseSchemaCache(globalStorageUri, 'key2', cache);
    await clearAllOnDisk(globalStorageUri);
    assert.strictEqual(await readDatabaseSchemaCache(globalStorageUri, 'key1'), undefined);
    assert.strictEqual(await readDatabaseSchemaCache(globalStorageUri, 'key2'), undefined);
  });

  test('deleteDatabaseSchemaCache on an already-absent key does not throw', async () => {
    await assert.doesNotReject(() => deleteDatabaseSchemaCache(globalStorageUri, 'nope'));
  });
});

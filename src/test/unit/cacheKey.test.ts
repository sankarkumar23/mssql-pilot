import * as assert from 'assert';
import { buildCacheKey } from '../../cache/cacheKey';

suite('cacheKey.buildCacheKey', () => {
  test('is deterministic for the same server+database', () => {
    const a = buildCacheKey({ server: 'MYHOST\\SQLEXPRESS', database: 'AdventureWorks' });
    const b = buildCacheKey({ server: 'MYHOST\\SQLEXPRESS', database: 'AdventureWorks' });
    assert.strictEqual(a, b);
  });

  test('is case-insensitive', () => {
    const a = buildCacheKey({ server: 'MyHost', database: 'MyDb' });
    const b = buildCacheKey({ server: 'myhost', database: 'mydb' });
    assert.strictEqual(a, b);
  });

  test('produces filesystem-safe output', () => {
    const key = buildCacheKey({ server: 'tcp:foo.database.windows.net,1433', database: 'My Db!' });
    assert.ok(/^[a-z0-9_-]+$/.test(key), `expected filesystem-safe key, got "${key}"`);
  });

  test('two inputs that sanitize to the same readable prefix still produce different keys', () => {
    // "host-a" and "host+a" both collapse non-alphanumerics to '_', so their
    // *sanitized* prefixes collide ("host_a"). The hash suffix (computed from
    // the pre-sanitization string) must disambiguate them.
    const a = buildCacheKey({ server: 'host-a', database: 'db' });
    const b = buildCacheKey({ server: 'host+a', database: 'db' });
    assert.notStrictEqual(a, b);
  });
});

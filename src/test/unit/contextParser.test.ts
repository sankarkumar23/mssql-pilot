import * as assert from 'assert';
import {
  buildAliasMap,
  collectAliasedTableReferences,
  collectUsedAliases,
  getCompletionContext,
} from '../../completion/contextParser';

suite('contextParser.buildAliasMap', () => {
  test('maps an explicit AS alias to its table', () => {
    const map = buildAliasMap('SELECT * FROM dbo.Orders AS o WHERE o.Id = 1');
    assert.strictEqual(map.get('o'), 'dbo.Orders');
  });

  test('maps an implicit (no AS) alias to its table', () => {
    const map = buildAliasMap('SELECT * FROM dbo.Orders o JOIN dbo.Customers c ON o.CustomerId = c.Id');
    assert.strictEqual(map.get('o'), 'dbo.Orders');
    assert.strictEqual(map.get('c'), 'dbo.Customers');
  });

  test('does not mistake a following keyword for an alias', () => {
    const map = buildAliasMap('SELECT * FROM dbo.Orders WHERE Id = 1');
    assert.strictEqual(map.get('where'), undefined);
  });

  test('also maps the bare table name for schema-less lookups', () => {
    const map = buildAliasMap('SELECT * FROM dbo.Orders');
    assert.strictEqual(map.get('orders'), 'dbo.Orders');
  });
});

suite('contextParser.getCompletionContext', () => {
  test('qualifier + partial word', () => {
    const ctx = getCompletionContext('SELECT * FROM dbo.Ord');
    assert.strictEqual(ctx.qualifier, 'dbo');
    assert.strictEqual(ctx.wordPrefix, 'Ord');
  });

  test('qualifier with nothing typed yet after the dot', () => {
    const ctx = getCompletionContext('SELECT o.');
    assert.strictEqual(ctx.qualifier, 'o');
    assert.strictEqual(ctx.wordPrefix, '');
  });

  test('no qualifier at all', () => {
    const ctx = getCompletionContext('SELECT * FROM ');
    assert.strictEqual(ctx.qualifier, undefined);
    assert.strictEqual(ctx.wordPrefix, '');
  });

  test('isTableReferencePosition is true directly after FROM', () => {
    assert.strictEqual(getCompletionContext('SELECT * FROM ').isTableReferencePosition, true);
    assert.strictEqual(getCompletionContext('SELECT * FROM dbo.').isTableReferencePosition, true);
    assert.strictEqual(getCompletionContext('SELECT * FROM Ord').isTableReferencePosition, true);
  });

  test('isTableReferencePosition is true directly after JOIN', () => {
    assert.strictEqual(getCompletionContext('SELECT * FROM dbo.Orders o JOIN dbo.').isTableReferencePosition, true);
  });

  test('isTableReferencePosition is false when completing a column via an alias', () => {
    assert.strictEqual(getCompletionContext('SELECT o.').isTableReferencePosition, false);
  });

  test('isTableReferencePosition is false with no preceding FROM/JOIN', () => {
    assert.strictEqual(getCompletionContext('SELECT dbo.').isTableReferencePosition, false);
    assert.strictEqual(getCompletionContext('SELECT Ord').isTableReferencePosition, false);
  });
});

suite('contextParser.collectUsedAliases', () => {
  test('collects both explicit AS and implicit aliases', () => {
    const used = collectUsedAliases('SELECT * FROM dbo.Orders AS o JOIN dbo.Customers c ON o.CustomerId = c.Id');
    assert.deepStrictEqual([...used].sort(), ['c', 'o']);
  });

  test('does not count a following keyword as an alias', () => {
    const used = collectUsedAliases('SELECT * FROM dbo.Orders WHERE Id = 1');
    assert.strictEqual(used.size, 0);
  });

  test('a table with no alias contributes nothing', () => {
    const used = collectUsedAliases('SELECT * FROM dbo.Orders');
    assert.strictEqual(used.size, 0);
  });
});

suite('contextParser.collectAliasedTableReferences', () => {
  test('returns every FROM/JOIN reference that has an alias', () => {
    const refs = collectAliasedTableReferences(
      'SELECT * FROM dbo.Orders o JOIN dbo.Customers AS c ON o.CustomerId = c.Id'
    );
    assert.deepStrictEqual(refs, [
      { tableName: 'dbo.Orders', alias: 'o' },
      { tableName: 'dbo.Customers', alias: 'c' },
    ]);
  });

  test('excludes references with no alias', () => {
    const refs = collectAliasedTableReferences('SELECT * FROM dbo.Orders');
    assert.deepStrictEqual(refs, []);
  });
});

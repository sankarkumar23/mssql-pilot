import * as assert from 'assert';
import { buildAliasMap, getCompletionContext } from '../../completion/contextParser';

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
});

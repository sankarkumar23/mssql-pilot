import * as assert from 'assert';
import { suggestAlias } from '../../completion/aliasSuggester';

suite('aliasSuggester.suggestAlias', () => {
  test('PascalCase: first letter of each word', () => {
    assert.strictEqual(suggestAlias('PilotTestTable'), 'ptt');
  });

  test('camelCase: first letter of each word', () => {
    assert.strictEqual(suggestAlias('orderDetails'), 'od');
  });

  test('snake_case: first letter of each underscore-separated segment', () => {
    assert.strictEqual(suggestAlias('order_items'), 'oi');
  });

  test('acronym run stays together as one word ("HTTPServer" -> "hs")', () => {
    assert.strictEqual(suggestAlias('HTTPServer'), 'hs');
  });

  test('no word boundaries (single lowercase word): falls back to first letter', () => {
    assert.strictEqual(suggestAlias('orders'), 'o');
  });

  test('no word boundaries (all-uppercase word): falls back to first letter', () => {
    assert.strictEqual(suggestAlias('ORDERS'), 'o');
  });

  test('schema-qualified input: only the bare name is used', () => {
    assert.strictEqual(suggestAlias('dbo.PilotTestTable'), 'ptt');
  });

  test('collision with an existing alias: appends "2"', () => {
    assert.strictEqual(suggestAlias('Owners', new Set(['o'])), 'o2');
  });

  test('collision cascades to "3" when "2" is also taken', () => {
    assert.strictEqual(suggestAlias('Owners', new Set(['o', 'o2'])), 'o3');
  });

  test('existing-alias matching is case-insensitive', () => {
    assert.strictEqual(suggestAlias('Owners', new Set(['O'])), 'o2');
  });
});

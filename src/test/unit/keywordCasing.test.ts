import * as assert from 'assert';
import { computeKeywordUppercaseEdit } from '../../completion/keywordCasing';

/** Locates `word` in `text` and returns the offset right after it — the shape provideOnTypeFormattingEdits hands in. */
function endOffsetOf(text: string, word: string): number {
  const idx = text.indexOf(word);
  if (idx === -1) throw new Error(`"${word}" not found in fixture text`);
  return idx + word.length;
}

suite('keywordCasing.computeKeywordUppercaseEdit', () => {
  test('uppercases a lowercase keyword', () => {
    const text = 'select ';
    const edit = computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select'));
    assert.deepStrictEqual(edit, { start: 0, end: 6, newText: 'SELECT' });
  });

  test('normalizes a mixed-case keyword to full uppercase', () => {
    const text = 'Select ';
    const edit = computeKeywordUppercaseEdit(text, endOffsetOf(text, 'Select'));
    assert.deepStrictEqual(edit, { start: 0, end: 6, newText: 'SELECT' });
  });

  test('an already-uppercase keyword produces no edit', () => {
    const text = 'SELECT ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'SELECT')), undefined);
  });

  test('a word that is not a reserved keyword produces no edit', () => {
    const text = 'orders ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'orders')), undefined);
  });

  test('a schema/alias-qualified segment is never treated as a keyword usage', () => {
    // "key" here is a real column named Key, not the KEY keyword — preceded by ".".
    const text = 'dbo.key ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'key')), undefined);
  });

  test('skips a keyword-looking word inside an unterminated single-quoted string', () => {
    const text = "WHERE Name = 'select ";
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test("an escaped '' inside a string literal does not end it early", () => {
    const text = "WHERE Name = 'it''s select ";
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test('skips a keyword-looking word inside a bracket-quoted identifier', () => {
    const text = '[select ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test('an escaped ]] inside a bracketed identifier does not end it early', () => {
    const text = '[My]]select ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test('skips a keyword-looking word inside a line comment', () => {
    const text = '-- select ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test('skips a keyword-looking word inside a block comment', () => {
    const text = '/* select ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test('a keyword after a closed block comment is still uppercased', () => {
    const text = '/* note */ select ';
    const end = endOffsetOf(text, 'select');
    assert.deepStrictEqual(computeKeywordUppercaseEdit(text, end), {
      start: end - 'select'.length,
      end,
      newText: 'SELECT',
    });
  });

  test('nested block comments are tracked so an inner */ does not exit early', () => {
    const text = '/* outer /* inner */ still comment select ';
    assert.strictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'select')), undefined);
  });

  test('a line comment ends at the newline, so a later keyword is still uppercased', () => {
    const text = '-- note\nselect ';
    const end = endOffsetOf(text, 'select');
    assert.deepStrictEqual(computeKeywordUppercaseEdit(text, end), {
      start: end - 'select'.length,
      end,
      newText: 'SELECT',
    });
  });

  test('a keyword at the very start of the document (no preceding char) is uppercased', () => {
    const text = 'from ';
    assert.deepStrictEqual(computeKeywordUppercaseEdit(text, endOffsetOf(text, 'from')), {
      start: 0,
      end: 4,
      newText: 'FROM',
    });
  });

  test('offset 0 (empty word) produces no edit', () => {
    assert.strictEqual(computeKeywordUppercaseEdit('select ', 0), undefined);
  });

  test('an offset past the end of the text produces no edit', () => {
    assert.strictEqual(computeKeywordUppercaseEdit('select', 100), undefined);
  });
});

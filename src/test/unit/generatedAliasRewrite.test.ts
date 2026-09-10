import * as assert from 'assert';
import { computeGeneratedAliasRewrite } from '../../completion/generatedAliasRewrite';

suite('generatedAliasRewrite.computeGeneratedAliasRewrite', () => {
  test('rewrites a generated implicit alias when the user types a replacement alias after it', () => {
    const line = 'SELECT * FROM dbo.Orders o ord ';
    const rewrite = computeGeneratedAliasRewrite(line, 'o', line.lastIndexOf('o ord '));
    assert.deepStrictEqual(rewrite, {
      startCharacter: line.lastIndexOf('o ord '),
      endCharacter: line.length,
      replacement: 'ord',
    });
  });

  test('rewrites a generated implicit alias to explicit AS style when the user types AS', () => {
    const line = 'SELECT * FROM dbo.Orders o AS ord';
    const rewrite = computeGeneratedAliasRewrite(line, 'o', line.lastIndexOf('o AS ord'));
    assert.deepStrictEqual(rewrite, {
      startCharacter: line.lastIndexOf('o AS ord'),
      endCharacter: line.length,
      replacement: 'AS ord',
    });
  });

  test('does not treat a follow-on WHERE keyword as an alias replacement', () => {
    const line = 'SELECT * FROM dbo.Orders o WHERE';
    const rewrite = computeGeneratedAliasRewrite(line, 'o', line.lastIndexOf('o WHERE'));
    assert.strictEqual(rewrite, undefined);
  });

  test('does not treat a partial WHERE keyword as an alias replacement', () => {
    const line = 'SELECT * FROM dbo.Orders o wh';
    const rewrite = computeGeneratedAliasRewrite(line, 'o', line.lastIndexOf('o wh'));
    assert.strictEqual(rewrite, undefined);
  });
});

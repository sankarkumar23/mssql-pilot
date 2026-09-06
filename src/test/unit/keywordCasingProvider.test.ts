import * as assert from 'assert';
import * as vscode from 'vscode';
import * as proxyquire from 'proxyquire';
import { KeywordCasingProvider } from '../../completion/keywordCasingProvider';

/** A real multi-line fake document — unlike itemBuilder's, this needs correct line/offset math for the '\n' trigger case. */
function fakeDocument(fullText: string): vscode.TextDocument {
  const lines = fullText.split('\n');
  const lineStartOffsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    lineStartOffsets.push(acc);
    acc += line.length + 1; // +1 for the newline that was split on (harmless overcount on the last line)
  }
  return {
    getText: () => fullText,
    lineAt: (line: number) => ({ text: lines[line] }),
    offsetAt: (pos: vscode.Position) => lineStartOffsets[pos.line] + pos.character,
    positionAt: (offset: number) => {
      for (let l = lineStartOffsets.length - 1; l >= 0; l--) {
        if (offset >= lineStartOffsets[l]) {
          return new vscode.Position(l, offset - lineStartOffsets[l]);
        }
      }
      return new vscode.Position(0, offset);
    },
  } as unknown as vscode.TextDocument;
}

function enabledProvider(): KeywordCasingProvider {
  const mod: typeof import('../../completion/keywordCasingProvider') = proxyquire.noCallThru()(
    '../../completion/keywordCasingProvider',
    { '../utils/config': { isFeatureEnabled: () => true, shouldUppercaseKeywordsOnType: () => true } }
  );
  return new mod.KeywordCasingProvider();
}

suite('KeywordCasingProvider', () => {
  test('disabled by default: returns no edits even for a keyword', () => {
    const provider = new KeywordCasingProvider();
    const text = 'select ';
    const doc = fakeDocument(text);
    const edits = provider.provideOnTypeFormattingEdits(doc, new vscode.Position(0, text.length), ' ', {} as vscode.FormattingOptions, {} as vscode.CancellationToken);
    assert.deepStrictEqual(edits, []);
  });

  test('enabled: uppercases the keyword just finished before a space', () => {
    const provider = enabledProvider();
    const text = 'select ';
    const doc = fakeDocument(text);
    const edits = provider.provideOnTypeFormattingEdits(doc, new vscode.Position(0, text.length), ' ', {} as vscode.FormattingOptions, {} as vscode.CancellationToken);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newText, 'SELECT');
    assert.strictEqual(edits[0].range.start.character, 0);
    assert.strictEqual(edits[0].range.end.character, 6);
  });

  test('enabled: a newline trigger looks back at the word on the previous line', () => {
    const provider = enabledProvider();
    const text = 'select\n';
    const doc = fakeDocument(text);
    const edits = provider.provideOnTypeFormattingEdits(doc, new vscode.Position(1, 0), '\n', {} as vscode.FormattingOptions, {} as vscode.CancellationToken);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newText, 'SELECT');
    assert.strictEqual(edits[0].range.start.line, 0);
    assert.strictEqual(edits[0].range.start.character, 0);
    assert.strictEqual(edits[0].range.end.character, 6);
  });

  test('enabled: a non-keyword word before the trigger produces no edits', () => {
    const provider = enabledProvider();
    const text = 'orders ';
    const doc = fakeDocument(text);
    const edits = provider.provideOnTypeFormattingEdits(doc, new vscode.Position(0, text.length), ' ', {} as vscode.FormattingOptions, {} as vscode.CancellationToken);
    assert.deepStrictEqual(edits, []);
  });

  test('enabled: a comma trigger after a keyword also uppercases it', () => {
    const provider = enabledProvider();
    const text = 'group,';
    const doc = fakeDocument(text);
    const edits = provider.provideOnTypeFormattingEdits(doc, new vscode.Position(0, text.length), ',', {} as vscode.FormattingOptions, {} as vscode.CancellationToken);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].newText, 'GROUP');
  });
});

import * as vscode from 'vscode';
import { isFeatureEnabled, shouldUppercaseKeywordsOnType } from '../utils/config';
import { computeKeywordUppercaseEdit } from './keywordCasing';

/**
 * Characters that mark the end of a word while writing a query — typing any
 * of these right after a reserved keyword is what triggers uppercasing it.
 */
const TRIGGER_CHARACTERS = [' ', '\n', ',', '(', ')', ';', '\t'] as const;

export class KeywordCasingProvider implements vscode.OnTypeFormattingEditProvider {
  provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    ch: string,
    _options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.TextEdit[] {
    if (!isFeatureEnabled() || !shouldUppercaseKeywordsOnType()) return [];

    // For '\n', the just-finished word is at the end of the PREVIOUS line —
    // `position` is already on the new line the editor created.
    const wordEndOffset =
      ch === '\n'
        ? document.offsetAt(new vscode.Position(position.line - 1, document.lineAt(position.line - 1).text.length))
        : document.offsetAt(position) - 1;

    const edit = computeKeywordUppercaseEdit(document.getText(), wordEndOffset);
    if (!edit) return [];

    return [
      vscode.TextEdit.replace(
        new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
        edit.newText
      ),
    ];
  }
}

export function registerKeywordCasingProvider(): vscode.Disposable {
  const [first, ...more] = TRIGGER_CHARACTERS;
  return vscode.languages.registerOnTypeFormattingEditProvider(
    { language: 'sql' },
    new KeywordCasingProvider(),
    first,
    ...more
  );
}

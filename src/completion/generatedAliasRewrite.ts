import * as vscode from 'vscode';
import { unquoteIdentifierIfNeeded } from '../utils/sqlIdentifier';

const TRACK_GENERATED_ALIAS_COMMAND = 'mssql-pilot.trackGeneratedAlias';

const BRACKET_OR_BARE_IDENTIFIER = '(?:\\[(?:[^\\]]|\\]\\])+\\]|\\w+)';
const FOLLOW_ON_TABLE_KEYWORDS = [
  'where', 'on', 'inner', 'left', 'right', 'outer', 'full', 'cross', 'join',
  'group', 'order', 'having', 'union', 'go', 'set', 'with',
];

interface TrackedGeneratedAlias {
  alias: string;
  aliasStartCharacter: number;
  line: number;
}

interface AliasRewrite {
  endCharacter: number;
  replacement: string;
  startCharacter: number;
}

const trackedAliasesByDocument = new Map<string, TrackedGeneratedAlias>();
let applyingRewrite = false;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFollowOnTableKeywordPrefix(token: string): boolean {
  const lower = unquoteIdentifierIfNeeded(token).toLowerCase();
  return FOLLOW_ON_TABLE_KEYWORDS.some((keyword) => lower === keyword || (lower.length < 3 && keyword.startsWith(lower)));
}

export function computeGeneratedAliasRewrite(
  lineTextBeforeCursor: string,
  trackedAlias: string,
  aliasStartCharacter: number
): AliasRewrite | undefined {
  const tail = lineTextBeforeCursor.slice(aliasStartCharacter);
  const escapedAlias = escapeRegExp(trackedAlias);

  const explicitAsMatch = new RegExp(
    `^${escapedAlias}\\s+(AS\\s+)(${BRACKET_OR_BARE_IDENTIFIER})$`,
    'i'
  ).exec(tail);
  if (explicitAsMatch) {
    return {
      startCharacter: aliasStartCharacter,
      endCharacter: lineTextBeforeCursor.length,
      replacement: `${explicitAsMatch[1]}${explicitAsMatch[2]}`,
    };
  }

  const implicitReplacementMatch = new RegExp(
    `^${escapedAlias}\\s+(${BRACKET_OR_BARE_IDENTIFIER})\\s+$`,
    'i'
  ).exec(tail);
  if (!implicitReplacementMatch) return undefined;

  const replacementAlias = implicitReplacementMatch[1];
  if (isFollowOnTableKeywordPrefix(replacementAlias)) return undefined;

  return {
    startCharacter: aliasStartCharacter,
    endCharacter: lineTextBeforeCursor.length,
    replacement: replacementAlias,
  };
}

function clearTrackedAlias(documentUri: vscode.Uri): void {
  trackedAliasesByDocument.delete(documentUri.toString());
}

function trackGeneratedAliasForActiveEditor(alias: string): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'sql') return;
  const active = editor.selection.active;
  trackedAliasesByDocument.set(editor.document.uri.toString(), {
    alias,
    aliasStartCharacter: active.character - alias.length,
    line: active.line,
  });
}

async function maybeRewriteGeneratedAlias(event: vscode.TextDocumentChangeEvent): Promise<void> {
  if (applyingRewrite || event.document.languageId !== 'sql' || event.contentChanges.length !== 1) return;

  const tracked = trackedAliasesByDocument.get(event.document.uri.toString());
  if (!tracked) return;

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
    clearTrackedAlias(event.document.uri);
    return;
  }

  const active = editor.selection.active;
  if (!editor.selection.isEmpty || active.line !== tracked.line) {
    clearTrackedAlias(event.document.uri);
    return;
  }

  const lineTextBeforeCursor = event.document.lineAt(tracked.line).text.slice(0, active.character);
  if (active.character <= tracked.aliasStartCharacter) {
    clearTrackedAlias(event.document.uri);
    return;
  }

  const currentTail = lineTextBeforeCursor.slice(tracked.aliasStartCharacter);
  if (!currentTail.toLowerCase().startsWith(tracked.alias.toLowerCase())) {
    clearTrackedAlias(event.document.uri);
    return;
  }

  const rewrite = computeGeneratedAliasRewrite(
    lineTextBeforeCursor,
    tracked.alias,
    tracked.aliasStartCharacter
  );
  if (!rewrite) return;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    event.document.uri,
    new vscode.Range(
      new vscode.Position(tracked.line, rewrite.startCharacter),
      new vscode.Position(tracked.line, rewrite.endCharacter)
    ),
    rewrite.replacement
  );

  applyingRewrite = true;
  try {
    await vscode.workspace.applyEdit(edit);
    clearTrackedAlias(event.document.uri);
  } finally {
    applyingRewrite = false;
  }
}

export function registerGeneratedAliasRewrite(): vscode.Disposable {
  const trackCommand = vscode.commands.registerCommand(TRACK_GENERATED_ALIAS_COMMAND, trackGeneratedAliasForActiveEditor);
  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    void maybeRewriteGeneratedAlias(event);
  });
  return vscode.Disposable.from(trackCommand, changeListener);
}

export function buildGeneratedAliasTrackingCommand(alias: string): vscode.Command {
  return { command: TRACK_GENERATED_ALIAS_COMMAND, title: 'Track generated alias', arguments: [alias] };
}

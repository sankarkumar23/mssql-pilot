import * as vscode from 'vscode';
import { getRememberedKeyForDocument, resolveActiveKey, EXTENSION_ID } from '../cache/syncScheduler';
import { buildCacheKey } from '../cache/cacheKey';
import { getMemoryCache } from '../cache/memoryCache';
import { getSchemaIndex } from '../cache/schemaIndex';
import { RoutineInfo, TableInfo, ViewInfo } from '../cache/schemaTypes';
import { formatRoutineBody, formatRoutineStub, formatTableDefinition, formatViewDefinition, TableExtras } from './definitionContent';
import { resolveReferenceAtWord } from './referenceResolver';
import { getMssqlApi } from '../utils/mssqlApi';
import { withSharedConnection } from '../utils/sharedConnection';
import {
  buildCheckConstraintsQuery,
  buildDependentViewsQuery,
  buildForeignKeysQuery,
  buildIndexesQuery,
  buildObjectDefinitionQuery,
  DependentViewInfo,
  extractCheckConstraints,
  extractDependentViews,
  extractForeignKeys,
  extractIndexes,
  extractObjectDefinition,
} from '../cache/schemaQueries';
import { log, describeError } from '../utils/outputChannel';
import { TIMED_OUT, withTimeout } from '../utils/withTimeout';

/**
 * sys.dm_sql_referencing_entities resolves a full dependency graph rather
 * than doing a simple indexed lookup, and is well known to get slow — into
 * multiple seconds, sometimes longer — on databases with many thousands of
 * objects. It's fetched separately from everything else (see
 * scheduleDependentViewsUpdate) so it never blocks the rest of the
 * definition from showing up; this just bounds how long that background
 * fetch is allowed to keep a connection lease open before giving up.
 */
const DEPENDENT_VIEWS_TIMEOUT_MS = 60_000;

export const DEFINITION_SCHEME = 'mssql-pilot-def';

/** Content is pushed here right before opening (or updating) the matching URI —
 *  simpler and more reliable than having the content provider re-resolve the
 *  schema cache from the URI. */
const contentByUri = new Map<string, string>();

/**
 * Owns the URI scheme's content AND its onDidChange event — the latter is
 * what lets scheduleDependentViewsUpdate patch an already-open definition
 * tab in place once the slow dependency lookup finally resolves, rather
 * than making every F12 press wait for it. A single module-level instance
 * (not one created per registerDefinitionFeature call) so the background
 * fetch below can always reach it to fire that event.
 */
class DefinitionContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return contentByUri.get(uri.toString()) ?? '-- MSSQL Pilot: definition unavailable\n';
  }

  announceChange(uri: vscode.Uri): void {
    this.changeEmitter.fire(uri);
  }
}

const contentProvider = new DefinitionContentProvider();

function isRoutineKind(kind: string): kind is RoutineInfo['kind'] {
  return kind === 'procedure' || kind === 'scalarFunction' || kind === 'tableFunction';
}

/** Used for both routine bodies and view definitions — OBJECT_DEFINITION() works identically for either. */
async function fetchObjectBody(connectionId: string, schema: string, name: string): Promise<string | null> {
  try {
    const api = await getMssqlApi();
    return await withSharedConnection(api.connectionSharing, EXTENSION_ID, connectionId, async (uri) => {
      const result = await api.connectionSharing.executeSimpleQuery(uri, buildObjectDefinitionQuery(schema, name));
      return extractObjectDefinition(result);
    });
  } catch (err) {
    log(`[definition] failed to fetch live body for ${schema}.${name} (non-fatal, falling back to signature/cached columns): ${describeError(err)}`);
    return null;
  }
}

/** Indexes/PK, foreign keys, and check constraints — all fast, indexed-by-object_id lookups regardless of schema size. */
async function fetchFastExtras(connectionId: string, objectId: number): Promise<Omit<TableExtras, 'dependentViews'> | undefined> {
  try {
    const api = await getMssqlApi();
    return await withSharedConnection(api.connectionSharing, EXTENSION_ID, connectionId, async (uri) => {
      // Sequential, not Promise.all: a single shared connection may not
      // support genuinely concurrent commands, and this only runs once per
      // F12 press, not on every keystroke — a few sequential round trips are
      // cheap here.
      const indexResult = await api.connectionSharing.executeSimpleQuery(uri, buildIndexesQuery(objectId));
      const fkResult = await api.connectionSharing.executeSimpleQuery(uri, buildForeignKeysQuery(objectId));
      const checkResult = await api.connectionSharing.executeSimpleQuery(uri, buildCheckConstraintsQuery(objectId));
      return {
        indexes: extractIndexes(indexResult),
        foreignKeys: extractForeignKeys(fkResult),
        checkConstraints: extractCheckConstraints(checkResult),
      };
    });
  } catch (err) {
    log(`[definition] failed to fetch indexes/keys/constraints for object ${objectId} (non-fatal, falling back to cached columns only): ${describeError(err)}`);
    return undefined;
  }
}

/**
 * Fires off the slow dependent-views lookup in the background and, once it
 * settles (resolved, timed out, or failed), rewrites the already-open
 * definition tab's content via `rerender` and tells the content provider to
 * refresh it. `connectionId` must have been resolved BEFORE this point —
 * calling resolveActiveKey() from inside this background task would fail,
 * since by the time it runs, VS Code has already switched the active editor
 * to the virtual definition document itself, which isn't a live mssql
 * connection.
 */
function scheduleDependentViewsUpdate(
  connectionId: string,
  schema: string,
  name: string,
  uri: vscode.Uri,
  rerender: (dependentViews: DependentViewInfo[]) => string
): void {
  (async () => {
    let dependentViews: DependentViewInfo[] = [];
    try {
      const api = await getMssqlApi();
      const result = await withTimeout(
        withSharedConnection(api.connectionSharing, EXTENSION_ID, connectionId, (connUri) =>
          api.connectionSharing.executeSimpleQuery(connUri, buildDependentViewsQuery(schema, name))
        ),
        DEPENDENT_VIEWS_TIMEOUT_MS
      );
      if (result === TIMED_OUT) {
        log(`[definition] dependent-views lookup for ${schema}.${name} timed out after ${DEPENDENT_VIEWS_TIMEOUT_MS}ms (large schema?) — omitted`);
      } else {
        dependentViews = extractDependentViews(result);
      }
    } catch (err) {
      log(`[definition] dependent-views lookup for ${schema}.${name} failed (non-fatal): ${describeError(err)}`);
    }
    contentByUri.set(uri.toString(), rerender(dependentViews));
    contentProvider.announceChange(uri);
  })();
}

function statusMessage(text: string): void {
  vscode.window.setStatusBarMessage(`MSSQL Pilot: ${text}`, 4000);
}

/**
 * Everything through "figure out what's under the cursor and build the
 * virtual document for it" — shared by both the F12/Peek DefinitionProvider
 * (which must return a Location, not navigate itself) and the standalone
 * command (kept for Command Palette access). Returns undefined, silently,
 * whenever there's nothing to resolve — a DefinitionProvider returning
 * nothing is the normal "this provider has no opinion" case, not an error.
 */
async function resolveDefinitionLocation(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Location | undefined> {
  if (document.languageId !== 'sql') return undefined;

  const remembered = getRememberedKeyForDocument(document.uri);
  const cache = remembered ? getMemoryCache(buildCacheKey(remembered)) : undefined;
  if (!cache) return undefined;

  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!wordRange) return undefined;

  const word = document.getText(wordRange);
  const lineText = document.lineAt(wordRange.end.line).text;
  const textUpToWordEnd = lineText.slice(0, wordRange.end.character);
  const index = getSchemaIndex(cache);
  const resolved = resolveReferenceAtWord(document.getText(), textUpToWordEnd, word, index);
  if (!resolved) return undefined;

  const { target } = resolved;

  // Resolved once, up front — see scheduleDependentViewsUpdate's doc comment
  // for why the background continuation can't re-resolve this itself later.
  const activeKey = await resolveActiveKey();
  const connectionId = activeKey?.connectionId;

  // A fresh URI per invocation (timestamp query string) so content is never
  // stale/conflated between repeated jumps to the same or different objects.
  const uri = vscode.Uri.parse(
    `${DEFINITION_SCHEME}:/${encodeURIComponent(target.schema)}/${encodeURIComponent(target.name)}.sql?t=${Date.now()}`
  );

  let content: string;
  let selectionLine: number | undefined;

  if (isRoutineKind(target.kind)) {
    const routine = target as RoutineInfo;
    const body = connectionId ? await fetchObjectBody(connectionId, routine.schema, routine.name) : null;
    content = body ? formatRoutineBody(routine, body) : formatRoutineStub(routine);
  } else if (target.kind === 'view') {
    const view = target as ViewInfo;
    const body = connectionId ? await fetchObjectBody(connectionId, view.schema, view.name) : null;
    const fastExtras = connectionId ? await fetchFastExtras(connectionId, view.objectId) : undefined;
    const formatted = formatViewDefinition(view, body, fastExtras && { ...fastExtras, dependentViews: 'loading' });
    content = formatted.text;
    if (resolved.kind === 'column') {
      selectionLine = formatted.columnLines.get(resolved.columnName.toLowerCase());
    }
    if (connectionId && fastExtras) {
      scheduleDependentViewsUpdate(connectionId, view.schema, view.name, uri, (dependentViews) =>
        formatViewDefinition(view, body, { ...fastExtras, dependentViews }).text
      );
    }
  } else {
    const table = target as TableInfo;
    const fastExtras = connectionId ? await fetchFastExtras(connectionId, table.objectId) : undefined;
    const formatted = formatTableDefinition(table, fastExtras && { ...fastExtras, dependentViews: 'loading' });
    content = formatted.text;
    if (resolved.kind === 'column') {
      selectionLine = formatted.columnLines.get(resolved.columnName.toLowerCase());
    }
    if (connectionId && fastExtras) {
      scheduleDependentViewsUpdate(connectionId, table.schema, table.name, uri, (dependentViews) =>
        formatTableDefinition(table, { ...fastExtras, dependentViews }).text
      );
    }
  }

  contentByUri.set(uri.toString(), content);
  return new vscode.Location(uri, new vscode.Position(selectionLine ?? 0, 0));
}

/** F12 / Alt+F12 (Peek Definition) / right-click "Go to Definition" — VS Code handles navigation itself. */
export class SchemaDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> {
    return resolveDefinitionLocation(document, position);
  }
}

/** Command Palette entry — same resolution, but navigates itself since a command has no Location to return to VS Code. */
export async function goToDefinition(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const location = await resolveDefinitionLocation(editor.document, editor.selection.active);
  if (!location) {
    statusMessage('nothing recognized under the cursor');
    return;
  }

  const virtualDoc = await vscode.workspace.openTextDocument(location.uri);
  const targetEditor = await vscode.window.showTextDocument(virtualDoc, { preview: true });
  targetEditor.selection = new vscode.Selection(location.range.start, location.range.start);
  targetEditor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
}

export function registerDefinitionFeature(): vscode.Disposable {
  const disposables: vscode.Disposable[] = [
    vscode.workspace.registerTextDocumentContentProvider(DEFINITION_SCHEME, contentProvider),
    vscode.commands.registerCommand('mssql-pilot.goToDefinition', () => goToDefinition()),
    vscode.languages.registerDefinitionProvider({ language: 'sql' }, new SchemaDefinitionProvider()),
  ];
  return vscode.Disposable.from(...disposables);
}

import * as vscode from 'vscode';
import { IMssqlExtensionApi } from '../utils/mssqlTypes';
import { getMssqlApi } from '../utils/mssqlApi';
import { withSharedConnection } from '../utils/sharedConnection';
import { log, describeError } from '../utils/outputChannel';
import { isFeatureEnabled, getSyncThrottleMs, getPollIntervalMs } from '../utils/config';
import { ServerDatabaseKey, buildCacheKey } from './cacheKey';
import { rememberKeyForDocument, getRememberedKeyForDocument, forgetDocument } from './documentKeyTracker';
import { getMemoryCache, setMemoryCache, hasMemoryCache } from './memoryCache';
import { readDatabaseSchemaCache, writeDatabaseSchemaCache, upsertManifestEntry } from './diskStore';
import { emptyDatabaseSchemaCache } from './schemaTypes';
import { runSync } from './syncEngine';
import { isConsentGranted, requestConsent } from './consentManager';
import { SERVER_NAME_QUERY, extractServerName } from './schemaQueries';

export const EXTENSION_ID = 'mssql-pilot';

const relevanceCheckInFlight = new Set<string>();
const lastSyncAttemptAt = new Map<string, number>();
const syncInFlight = new Map<string, Promise<void>>();
const serverNameByConnectionId = new Map<string, string>();

/** SELECT @@SERVERNAME once per connectionId, then reuse — same pattern mssql-extras uses. */
async function fetchServerName(api: IMssqlExtensionApi, connectionId: string, connectionUri: string): Promise<string> {
  const cached = serverNameByConnectionId.get(connectionId);
  if (cached) return cached;
  const result = await api.connectionSharing.executeSimpleQuery(connectionUri, SERVER_NAME_QUERY);
  const serverName = extractServerName(result);
  if (serverName) {
    serverNameByConnectionId.set(connectionId, serverName);
  }
  return serverName;
}

async function resolveKeyForDocument(
  document: vscode.TextDocument,
  api: IMssqlExtensionApi
): Promise<{ key: ServerDatabaseKey; connectionId: string } | undefined> {
  // mssql's API only reports the CURRENTLY ACTIVE editor's connection, not an
  // arbitrary document's — only resolve when this document is actually active.
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor || activeEditor.document.uri.toString() !== document.uri.toString()) {
    return undefined;
  }

  const connectionId = await api.connectionSharing.getActiveEditorConnectionId(EXTENSION_ID);
  if (!connectionId) return undefined;

  const database = (await api.connectionSharing.getActiveDatabase(EXTENSION_ID)) ?? '';

  const server = await withSharedConnection(api.connectionSharing, EXTENSION_ID, connectionId, (uri) =>
    fetchServerName(api, connectionId, uri)
  );
  if (!server) return undefined;

  return { key: { server, database }, connectionId };
}

function kickSync(
  cacheKeyStr: string,
  key: ServerDatabaseKey,
  connectionId: string,
  api: IMssqlExtensionApi,
  context: vscode.ExtensionContext
): void {
  if (syncInFlight.has(cacheKeyStr)) return; // per-key in-flight guard
  lastSyncAttemptAt.set(cacheKeyStr, Date.now());

  const promise = (async () => {
    if (!isConsentGranted(context)) {
      const granted = await requestConsent(context);
      if (!granted) return;
    }

    const current = getMemoryCache(cacheKeyStr) ?? emptyDatabaseSchemaCache(key.server, key.database);
    const next = await runSync(api.connectionSharing, EXTENSION_ID, connectionId, current);
    if (!next) return; // failed — already logged inside runSync, cache left as-is

    setMemoryCache(cacheKeyStr, next);
    try {
      await writeDatabaseSchemaCache(context.globalStorageUri, cacheKeyStr, next);
      await upsertManifestEntry(context.globalStorageUri, {
        cacheKey: cacheKeyStr,
        server: key.server,
        database: key.database,
        objectCount: Object.keys(next.objects).length,
        lastFullSyncAt: next.lastFullSyncAt,
        lastDeltaSyncAt: next.lastDeltaSyncAt,
      });
    } catch (err) {
      log(`[sync] failed to persist cache for ${key.server}/${key.database} (non-fatal): ${describeError(err)}`);
    }
  })();

  syncInFlight.set(
    cacheKeyStr,
    promise.finally(() => syncInFlight.delete(cacheKeyStr))
  );
}

/**
 * Warms the in-memory cache for `key` (instantly from disk if present) and
 * kicks a background sync (full or delta). Never awaited by callers that
 * need to stay fast — this is the only place network I/O happens.
 */
export async function ensureSyncStarted(
  key: ServerDatabaseKey,
  connectionId: string,
  api: IMssqlExtensionApi,
  context: vscode.ExtensionContext
): Promise<void> {
  const cacheKeyStr = buildCacheKey(key);

  if (hasMemoryCache(cacheKeyStr)) {
    const last = lastSyncAttemptAt.get(cacheKeyStr) ?? 0;
    if (Date.now() - last < getSyncThrottleMs()) {
      return; // already warm and recently synced
    }
    kickSync(cacheKeyStr, key, connectionId, api, context);
    return;
  }

  // Not warm yet — this is the "instant from disk" path: a single fs read,
  // no network round trip, before any sync has even started.
  const disk = await readDatabaseSchemaCache(context.globalStorageUri, cacheKeyStr);
  setMemoryCache(cacheKeyStr, disk ?? emptyDatabaseSchemaCache(key.server, key.database));
  kickSync(cacheKeyStr, key, connectionId, api, context);
}

/**
 * Single entry point for every trigger (active-editor change, document open,
 * initial visible-editors scan, poller tick, completion-provider self-heal).
 */
export async function onSqlDocumentBecameRelevant(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext
): Promise<void> {
  if (document.languageId !== 'sql') return;
  const uriStr = document.uri.toString();
  if (relevanceCheckInFlight.has(uriStr)) return;
  relevanceCheckInFlight.add(uriStr);
  try {
    if (!isFeatureEnabled()) return;

    let api: IMssqlExtensionApi;
    try {
      api = await getMssqlApi();
    } catch {
      return; // mssql not installed/active — nothing to do, no error surfaced
    }

    const resolved = await resolveKeyForDocument(document, api);
    if (!resolved) return;

    rememberKeyForDocument(document.uri, resolved.key);
    await ensureSyncStarted(resolved.key, resolved.connectionId, api, context);
  } catch (err) {
    log(`[sync] onSqlDocumentBecameRelevant failed (non-fatal): ${describeError(err)}`);
  } finally {
    relevanceCheckInFlight.delete(uriStr);
  }
}

/** Wires all trigger points. Call once from activate(); dispose on deactivate(). */
export function registerSyncTriggers(context: vscode.ExtensionContext): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        onSqlDocumentBecameRelevant(editor.document, context).catch(() => {});
      }
    })
  );
  disposables.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      onSqlDocumentBecameRelevant(document, context).catch(() => {});
    })
  );
  disposables.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      forgetDocument(document.uri);
    })
  );

  // Primary path, not a fallback: activation is onLanguage:sql, so a SQL
  // editor is very likely already open/active before these listeners exist,
  // and the document-open event that caused activation may have already fired.
  for (const editor of vscode.window.visibleTextEditors) {
    onSqlDocumentBecameRelevant(editor.document, context).catch(() => {});
  }

  // The only way to catch "user switched database via mssql's own status
  // bar" — there is no VS Code or mssql event for that.
  const interval = setInterval(() => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'sql') {
      onSqlDocumentBecameRelevant(editor.document, context).catch(() => {});
    }
  }, getPollIntervalMs());
  disposables.push({ dispose: () => clearInterval(interval) });

  return vscode.Disposable.from(...disposables);
}

export { getRememberedKeyForDocument };

/** Resolves the currently active SQL editor's server+database key, if any. Used by commands. */
export async function resolveActiveKey(): Promise<{ key: ServerDatabaseKey; connectionId: string } | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  let api: IMssqlExtensionApi;
  try {
    api = await getMssqlApi();
  } catch {
    return undefined;
  }
  return resolveKeyForDocument(editor.document, api);
}

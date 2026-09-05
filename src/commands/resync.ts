import * as vscode from 'vscode';
import { getMssqlApi } from '../utils/mssqlApi';
import { IMssqlExtensionApi } from '../utils/mssqlTypes';
import { resolveActiveKey, EXTENSION_ID } from '../cache/syncScheduler';
import { ServerDatabaseKey, buildCacheKey } from '../cache/cacheKey';
import { getMemoryCache, setMemoryCache } from '../cache/memoryCache';
import { readManifest, writeDatabaseSchemaCache, upsertManifestEntry } from '../cache/diskStore';
import { emptyDatabaseSchemaCache } from '../cache/schemaTypes';
import { runSync } from '../cache/syncEngine';

async function performResync(
  context: vscode.ExtensionContext,
  api: IMssqlExtensionApi,
  key: ServerDatabaseKey,
  connectionId: string
): Promise<number | undefined> {
  const cacheKeyStr = buildCacheKey(key);
  const current = getMemoryCache(cacheKeyStr) ?? emptyDatabaseSchemaCache(key.server, key.database);
  const next = await runSync(api.connectionSharing, EXTENSION_ID, connectionId, current);
  if (!next) return undefined;

  setMemoryCache(cacheKeyStr, next);
  await writeDatabaseSchemaCache(context.globalStorageUri, cacheKeyStr, next);
  await upsertManifestEntry(context.globalStorageUri, {
    cacheKey: cacheKeyStr,
    server: key.server,
    database: key.database,
    objectCount: Object.keys(next.objects).length,
    lastFullSyncAt: next.lastFullSyncAt,
    lastDeltaSyncAt: next.lastDeltaSyncAt,
  });
  return Object.keys(next.objects).length;
}

export async function resyncCurrentDatabase(context: vscode.ExtensionContext): Promise<void> {
  const resolved = await resolveActiveKey();
  if (!resolved) {
    vscode.window.showWarningMessage('MSSQL Pilot: No active SQL editor with a resolvable connection.');
    return;
  }

  const api = await getMssqlApi();
  vscode.window.showInformationMessage(`MSSQL Pilot: Resyncing ${resolved.key.server}/${resolved.key.database}…`);
  const objectCount = await performResync(context, api, resolved.key, resolved.connectionId);
  if (objectCount === undefined) {
    vscode.window.showErrorMessage(
      `MSSQL Pilot: Resync failed for ${resolved.key.server}/${resolved.key.database}. ` +
      'See the "MSSQL Pilot" output channel for details.'
    );
    return;
  }
  vscode.window.showInformationMessage(`MSSQL Pilot: Resync complete — ${objectCount} objects cached.`);
}

/**
 * Resyncs every currently OPEN SQL editor's connection. mssql's public API
 * only exposes a connectionId for the currently active editor
 * (getActiveEditorConnectionId) — there's no way to enumerate mssql's saved
 * connection profiles or fetch a connectionId for a database that isn't the
 * active editor's connection. So "all" here means "all open SQL editors,"
 * not "every database ever cached" — briefly bringing each one to the
 * foreground is the only way to resolve its connection through this API.
 */
export async function resyncAll(context: vscode.ExtensionContext): Promise<void> {
  const originalEditor = vscode.window.activeTextEditor;
  const sqlDocuments = vscode.workspace.textDocuments.filter((d) => d.languageId === 'sql');
  if (sqlDocuments.length === 0) {
    const manifest = await readManifest(context.globalStorageUri);
    if (manifest.entries.length > 0) {
      vscode.window.showWarningMessage(
        'MSSQL Pilot: No open SQL editors. Open a SQL editor connected to each database ' +
        'you want to refresh, then run this command again.'
      );
    } else {
      vscode.window.showInformationMessage('MSSQL Pilot: No open SQL editors to resync.');
    }
    return;
  }

  const api = await getMssqlApi();
  const seenCacheKeys = new Set<string>();
  let resyncedCount = 0;

  for (const doc of sqlDocuments) {
    try {
      await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
    } catch {
      continue;
    }
    const resolved = await resolveActiveKey();
    if (!resolved) continue;
    const cacheKeyStr = buildCacheKey(resolved.key);
    if (seenCacheKeys.has(cacheKeyStr)) continue;
    seenCacheKeys.add(cacheKeyStr);

    const objectCount = await performResync(context, api, resolved.key, resolved.connectionId);
    if (objectCount !== undefined) resyncedCount++;
  }

  if (originalEditor) {
    try {
      await vscode.window.showTextDocument(originalEditor.document, {
        viewColumn: originalEditor.viewColumn,
        preserveFocus: false,
        preview: false,
      });
    } catch {
      // ignore — best-effort restore of the original active editor
    }
  }

  vscode.window.showInformationMessage(
    resyncedCount > 0
      ? `MSSQL Pilot: Resynced ${resyncedCount} database(s) from currently open SQL editors.`
      : 'MSSQL Pilot: Could not resolve any open SQL editor to a connected database.'
  );
}

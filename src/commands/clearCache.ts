import * as vscode from 'vscode';
import { resolveActiveKey } from '../cache/syncScheduler';
import { buildCacheKey } from '../cache/cacheKey';
import { deleteMemoryCache, clearAllMemoryCache } from '../cache/memoryCache';
import { deleteDatabaseSchemaCache, removeManifestEntry, readManifest, clearAllOnDisk } from '../cache/diskStore';

export async function clearCacheCurrentDatabase(context: vscode.ExtensionContext): Promise<void> {
  const resolved = await resolveActiveKey();
  if (!resolved) {
    vscode.window.showWarningMessage('MSSQL Pilot: No active SQL editor with a resolvable connection.');
    return;
  }

  const cacheKeyStr = buildCacheKey(resolved.key);
  deleteMemoryCache(cacheKeyStr);
  await deleteDatabaseSchemaCache(context.globalStorageUri, cacheKeyStr);
  await removeManifestEntry(context.globalStorageUri, cacheKeyStr);
  vscode.window.showInformationMessage(
    `MSSQL Pilot: Cleared schema cache for ${resolved.key.server}/${resolved.key.database}.`
  );
}

export async function clearCacheAll(context: vscode.ExtensionContext): Promise<void> {
  const manifest = await readManifest(context.globalStorageUri);
  const count = manifest.entries.length;
  clearAllMemoryCache();
  await clearAllOnDisk(context.globalStorageUri);
  vscode.window.showInformationMessage(`MSSQL Pilot: Cleared schema cache for ${count} database(s).`);
}

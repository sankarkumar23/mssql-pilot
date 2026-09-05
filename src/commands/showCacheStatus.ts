import * as vscode from 'vscode';
import { readManifest } from '../cache/diskStore';
import { getChannel } from '../utils/outputChannel';

export async function showCacheStatus(context: vscode.ExtensionContext): Promise<void> {
  const manifest = await readManifest(context.globalStorageUri);
  const channel = getChannel();
  channel.appendLine('--- MSSQL Pilot: Schema Cache Status ---');
  if (manifest.entries.length === 0) {
    channel.appendLine('No cached databases.');
  } else {
    for (const entry of manifest.entries) {
      channel.appendLine(
        `${entry.server}/${entry.database} — ${entry.objectCount} objects — ` +
        `last full sync: ${entry.lastFullSyncAt || 'never'} — last delta sync: ${entry.lastDeltaSyncAt || 'never'}`
      );
    }
  }
  channel.show();
}

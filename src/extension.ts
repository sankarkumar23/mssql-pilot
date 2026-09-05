import * as vscode from 'vscode';
import { log } from './utils/outputChannel';
import { clearMssqlApiCache } from './utils/mssqlApi';
import { registerSyncTriggers } from './cache/syncScheduler';
import { registerCompletionProvider } from './completion/completionProvider';
import { resyncCurrentDatabase, resyncAll } from './commands/resync';
import { clearCacheCurrentDatabase, clearCacheAll } from './commands/clearCache';
import { showCacheStatus } from './commands/showCacheStatus';

export function activate(context: vscode.ExtensionContext): void {
  log('MSSQL Pilot activated');

  context.subscriptions.push(registerSyncTriggers(context));
  context.subscriptions.push(registerCompletionProvider(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('mssql-pilot.resyncCurrentDatabase', () => resyncCurrentDatabase(context)),
    vscode.commands.registerCommand('mssql-pilot.resyncAll', () => resyncAll(context)),
    vscode.commands.registerCommand('mssql-pilot.clearCacheCurrentDatabase', () => clearCacheCurrentDatabase(context)),
    vscode.commands.registerCommand('mssql-pilot.clearCacheAll', () => clearCacheAll(context)),
    vscode.commands.registerCommand('mssql-pilot.showCacheStatus', () => showCacheStatus(context))
  );
}

export function deactivate(): void {
  clearMssqlApiCache();
  log('MSSQL Pilot deactivated');
}

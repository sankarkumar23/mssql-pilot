import * as vscode from 'vscode';
import { log, describeError } from './utils/outputChannel';
import { clearMssqlApiCache } from './utils/mssqlApi';
import { isFeatureEnabled } from './utils/config';
import { ensureMssqlErrorCheckingDisabled, ensureMssqlSuggestionsDisabled } from './utils/mssqlSettings';
import { registerSyncTriggers } from './cache/syncScheduler';
import { registerCompletionProvider } from './completion/completionProvider';
import { registerGeneratedAliasRewrite } from './completion/generatedAliasRewrite';
import { registerKeywordCasingProvider } from './completion/keywordCasingProvider';
import { resyncCurrentDatabase, resyncAll } from './commands/resync';
import { clearCacheCurrentDatabase, clearCacheAll } from './commands/clearCache';
import { showCacheStatus } from './commands/showCacheStatus';
import { registerDefinitionFeature } from './definition/definitionProvider';
import { disposeStatusBar } from './utils/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  log('MSSQL Pilot activated');

  if (isFeatureEnabled()) {
    ensureMssqlErrorCheckingDisabled(context).catch((err) =>
      log(`[settings] failed to disable mssql error checking (non-fatal): ${describeError(err)}`)
    );
    ensureMssqlSuggestionsDisabled(context).catch((err) =>
      log(`[settings] failed to disable mssql suggestions (non-fatal): ${describeError(err)}`)
    );
  }

  context.subscriptions.push(registerSyncTriggers(context));
  context.subscriptions.push(registerCompletionProvider(context));
  context.subscriptions.push(registerGeneratedAliasRewrite());
  context.subscriptions.push(registerKeywordCasingProvider());
  context.subscriptions.push(registerDefinitionFeature());
  context.subscriptions.push({ dispose: disposeStatusBar });

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

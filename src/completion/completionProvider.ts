import * as vscode from 'vscode';
import { isFeatureEnabled, isCompletionProviderEnabled } from '../utils/config';
import { isConsentGranted } from '../cache/consentManager';
import { getRememberedKeyForDocument, onSqlDocumentBecameRelevant } from '../cache/syncScheduler';
import { buildCacheKey } from '../cache/cacheKey';
import { getMemoryCache } from '../cache/memoryCache';
import { buildCompletionItems } from './itemBuilder';

/**
 * The one invariant everything else in this extension follows from:
 * provideCompletionItems never awaits network I/O, not even on a cache
 * miss. All server/database resolution and all SQL queries happen
 * exclusively in the event-triggered syncScheduler path; this provider
 * only ever reads the in-memory results synchronously. On a miss it
 * returns [] for that call and fires-and-forgets a resolution attempt
 * for next time — mssql's own native completions still work meanwhile.
 */
export class SchemaCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (!isFeatureEnabled() || !isCompletionProviderEnabled() || !isConsentGranted(this.context)) {
      return [];
    }

    const remembered = getRememberedKeyForDocument(document.uri);
    if (!remembered) {
      onSqlDocumentBecameRelevant(document, this.context).catch(() => {});
      return [];
    }

    const cache = getMemoryCache(buildCacheKey(remembered));
    if (!cache) return [];

    return buildCompletionItems(cache, document, position);
  }
}

export function registerCompletionProvider(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    { language: 'sql' },
    new SchemaCompletionProvider(context),
    '.'
  );
}

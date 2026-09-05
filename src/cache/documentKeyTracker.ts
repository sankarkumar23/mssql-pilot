import * as vscode from 'vscode';
import { ServerDatabaseKey } from './cacheKey';

/**
 * Maps an open document's URI to the server+database it was last resolved to
 * be connected to. This is the completion provider's ONLY source of "which
 * database is this document on" — a plain in-memory Map read, no I/O.
 *
 * mssql's public API can only report the CURRENTLY ACTIVE editor's
 * connection, not an arbitrary document's — so a document's key is
 * remembered here whenever it becomes active, and simply reused if the
 * provider is later asked about it while some other document is active.
 */
const keyByDocumentUri = new Map<string, ServerDatabaseKey>();

export function rememberKeyForDocument(uri: vscode.Uri, key: ServerDatabaseKey): void {
  keyByDocumentUri.set(uri.toString(), key);
}

export function getRememberedKeyForDocument(uri: vscode.Uri): ServerDatabaseKey | undefined {
  return keyByDocumentUri.get(uri.toString());
}

export function forgetDocument(uri: vscode.Uri): void {
  keyByDocumentUri.delete(uri.toString());
}

export function clearAllRememberedKeys(): void {
  keyByDocumentUri.clear();
}

import * as vscode from 'vscode';
import { IMssqlExtensionApi } from './mssqlTypes';

const MSSQL_EXTENSION_ID = 'ms-mssql.mssql';

let cachedApi: IMssqlExtensionApi | undefined;

/**
 * Acquires the mssql public API, activating the extension if needed.
 * Throws if mssql is not installed or fails to activate.
 */
export async function getMssqlApi(): Promise<IMssqlExtensionApi> {
  if (cachedApi) {
    return cachedApi;
  }

  const ext = vscode.extensions.getExtension<IMssqlExtensionApi>(MSSQL_EXTENSION_ID);
  if (!ext) {
    throw new Error(
      `The "${MSSQL_EXTENSION_ID}" extension is not installed. ` +
      'Please install the SQL Server (mssql) extension and reload VS Code.'
    );
  }

  const api = ext.isActive ? ext.exports : await ext.activate();
  if (!api?.connectionSharing) {
    throw new Error(
      'Could not obtain the mssql Connection Sharing API. ' +
      'Your mssql version may be too old — please update it.'
    );
  }

  cachedApi = api;
  return api;
}

/** Invalidate the cached reference (e.g. on extension deactivation). */
export function clearMssqlApiCache(): void {
  cachedApi = undefined;
}

/**
 * Types mirroring the mssql (ms-mssql.mssql) public API surface.
 *
 * There is no usable npm types package for this: the package named
 * `vscode-mssql` on the public npm registry is a security-holding
 * placeholder (version 0.0.1-security, repo npm/security-holder), not a
 * real Microsoft-published types package. This is the entire public
 * surface mssql exposes (the Connection Sharing API) — hand-rolled here,
 * reproduced to avoid a runtime dependency on anything unverified.
 */

/** Returned by connectionSharing.executeSimpleQuery. Only the first result set is returned. */
export interface SimpleExecuteResult {
  rowCount: number;
  columnInfo: Array<{ columnName: string }>;
  rows: Array<Array<{ displayValue: string; isNull: boolean }>>;
}

export interface IConnectionSharingService {
  getActiveEditorConnectionId(extensionId: string): Promise<string | undefined>;
  getActiveDatabase(extensionId: string): Promise<string | undefined>;
  connect(extensionId: string, connectionId: string): Promise<string>;
  disconnect(connectionUri: string): void;
  isConnected(connectionUri: string): boolean;
  executeSimpleQuery(connectionUri: string, queryString: string): Promise<SimpleExecuteResult>;
  listDatabases(connectionUri: string): Promise<string[]>;
}

export interface IMssqlExtensionApi {
  connectionSharing: IConnectionSharingService;
}

import { IConnectionSharingService } from './mssqlTypes';

/**
 * Acquires a shared connection, runs fn with the resulting connectionUri, and
 * always releases the connection afterward — even if fn throws.
 */
export async function withSharedConnection<T>(
  cs: IConnectionSharingService,
  extensionId: string,
  connectionId: string,
  fn: (connectionUri: string) => Promise<T>
): Promise<T> {
  const connectionUri = await cs.connect(extensionId, connectionId);
  try {
    return await fn(connectionUri);
  } finally {
    try {
      cs.disconnect(connectionUri);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

import * as sinon from 'sinon';
import { IConnectionSharingService, SimpleExecuteResult } from '../../../utils/mssqlTypes';

const EMPTY_RESULT: SimpleExecuteResult = { rowCount: 0, columnInfo: [], rows: [] };

/**
 * A sinon-backed mock of IConnectionSharingService, mirroring the one in
 * mssql-extras (src/test/integration/mocks/mockMssqlApi.ts). All methods
 * default to happy-path behaviour; override per test as needed.
 */
export class MockConnectionSharingService implements IConnectionSharingService {
  getActiveEditorConnectionId = sinon.stub<[string], Promise<string | undefined>>().resolves('test-connection-id');

  getActiveDatabase = sinon.stub<[string], Promise<string | undefined>>().resolves('TestDatabase');

  connect = sinon.stub<[string, string], Promise<string>>().resolves('test-connection-uri');

  disconnect = sinon.stub<[string], void>().returns(undefined);

  isConnected = sinon.stub<[string], boolean>().returns(true);

  executeSimpleQuery = sinon.stub<[string, string], Promise<SimpleExecuteResult>>().resolves(EMPTY_RESULT);

  listDatabases = sinon.stub<[string], Promise<string[]>>().resolves([]);

  /** Reset all stubs to defaults between tests. */
  reset(): void {
    this.getActiveEditorConnectionId.resetBehavior();
    this.getActiveEditorConnectionId.resolves('test-connection-id');
    this.getActiveDatabase.resetBehavior();
    this.getActiveDatabase.resolves('TestDatabase');
    this.connect.resetBehavior();
    this.connect.resolves('test-connection-uri');
    this.disconnect.resetBehavior();
    this.isConnected.resetBehavior();
    this.isConnected.returns(true);
    this.executeSimpleQuery.resetBehavior();
    this.executeSimpleQuery.resolves(EMPTY_RESULT);
    this.listDatabases.resetBehavior();
    this.listDatabases.resolves([]);
  }
}

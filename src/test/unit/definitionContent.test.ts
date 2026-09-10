import * as assert from 'assert';
import { formatRoutineBody, formatRoutineStub, formatTableDefinition, formatViewDefinition } from '../../definition/definitionContent';
import { RoutineInfo, TableInfo, ViewInfo } from '../../cache/schemaTypes';
import { CheckConstraintInfo, DependentViewInfo, ForeignKeyInfo, IndexInfo } from '../../cache/schemaQueries';

const ordersTable: TableInfo = {
  kind: 'table',
  objectId: 1,
  schema: 'dbo',
  name: 'Orders',
  modifyDate: 'x',
  columns: [
    {
      name: 'Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
      isNullable: false, isIdentity: true, isComputed: false, defaultDefinition: null, isPrimaryKey: true,
    },
    {
      name: 'Name', ordinal: 2, dataType: 'nvarchar', maxLength: 100, precision: 0, scale: 0,
      isNullable: true, isIdentity: false, isComputed: false, defaultDefinition: "('unknown')", isPrimaryKey: false,
    },
  ],
};

const myProc: RoutineInfo = {
  kind: 'procedure',
  objectId: 2,
  schema: 'dbo',
  name: 'MyProc',
  modifyDate: 'x',
  parameters: [
    { name: '@Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0, isOutput: false, hasDefault: false },
    { name: '@Out', ordinal: 2, dataType: 'bit', maxLength: 1, precision: 1, scale: 0, isOutput: true, hasDefault: false },
  ],
};

suite('definitionContent.formatTableDefinition', () => {
  test('renders each column with type, nullability, identity, primary key, and default; nvarchar length halved from the cached byte-length; discloses it\'s a cached snapshot', () => {
    const { text } = formatTableDefinition(ordersTable);
    assert.match(text, /Id int IDENTITY NOT NULL PRIMARY KEY,/);
    // Cached maxLength is 100 (bytes); nvarchar is 2 bytes/char, so the declared length is 50.
    assert.match(text, /Name nvarchar\(50\) NULL DEFAULT \('unknown'\)/);
    assert.match(text, /not live DDL/);
  });

  test('tracks each column\'s 0-indexed line number for jump-to-column', () => {
    const { text, columnLines } = formatTableDefinition(ordersTable);
    const lines = text.split('\n');
    assert.strictEqual(lines[columnLines.get('id')!].trim().startsWith('Id '), true);
    assert.strictEqual(lines[columnLines.get('name')!].trim().startsWith('Name '), true);
  });

  test('with live extras: renders PK/index/FK/check constraints as ALTER TABLE statements, dependent views as a trailing comment, and drops the cache-only inline PK marker', () => {
    const indexes: IndexInfo[] = [
      { name: 'PK_Orders', isPrimaryKey: true, isUniqueConstraint: false, isUnique: true, isDisabled: false, columns: [{ name: 'Id', isDescending: false }] },
      { name: 'IX_Orders_Name', isPrimaryKey: false, isUniqueConstraint: false, isUnique: false, isDisabled: false, columns: [{ name: 'Name', isDescending: true }] },
    ];
    const foreignKeys: ForeignKeyInfo[] = [
      { name: 'FK_Orders_Customers', columns: [{ column: 'Name', referencedSchema: 'dbo', referencedTable: 'Customers', referencedColumn: 'Name' }] },
    ];
    const checkConstraints: CheckConstraintInfo[] = [
      { name: 'CK_Orders_Name', definition: '([Name] IS NOT NULL)', isDisabled: false },
    ];
    const dependentViews: DependentViewInfo[] = [{ schema: 'dbo', name: 'vw_OrderSummary' }];
    const { text } = formatTableDefinition(ordersTable, { indexes, foreignKeys, checkConstraints, dependentViews });

    assert.doesNotMatch(text, /PRIMARY KEY,/); // no inline column-level marker once a real PK constraint is shown
    assert.match(text, /ADD CONSTRAINT PK_Orders PRIMARY KEY \(Id\);/);
    assert.match(text, /CREATE INDEX IX_Orders_Name ON dbo\.Orders \(Name DESC\);/);
    assert.match(text, /ADD CONSTRAINT FK_Orders_Customers FOREIGN KEY \(Name\) REFERENCES dbo\.Customers \(Name\);/);
    assert.match(text, /ADD CONSTRAINT CK_Orders_Name CHECK \(\(\[Name\] IS NOT NULL\)\);/);
    assert.match(text, /-- Views depending on dbo\.Orders:\n-- {3}dbo\.vw_OrderSummary/);
    assert.match(text, /fetched live from the connected database/);
  });

  test('with live extras but no dependent views, it says so explicitly', () => {
    const { text } = formatTableDefinition(ordersTable, { indexes: [], foreignKeys: [], checkConstraints: [], dependentViews: [] });
    assert.match(text, /No dependent views found for dbo\.Orders\./);
  });

  test('with dependentViews still "loading", shows a placeholder instead of waiting or omitting it silently', () => {
    const { text } = formatTableDefinition(ordersTable, { indexes: [], foreignKeys: [], checkConstraints: [], dependentViews: 'loading' });
    assert.match(text, /Checking for dependent views…/);
    assert.doesNotMatch(text, /Views depending on/);
  });

  test('with dependentViews unavailable, says the lookup failed or timed out', () => {
    const { text } = formatTableDefinition(ordersTable, { indexes: [], foreignKeys: [], checkConstraints: [], dependentViews: 'unavailable' });
    assert.match(text, /Dependent views unavailable \(lookup failed or timed out\)\./);
  });

  test('a schema/table/column name needing quoting is bracket-quoted in the rendered SQL', () => {
    const spacedTable: TableInfo = {
      kind: 'table', objectId: 3, schema: 'My Schema', name: 'My Table', modifyDate: 'x',
      columns: [{
        name: 'Order Id', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
        isNullable: false, isIdentity: false, isComputed: false, defaultDefinition: null, isPrimaryKey: false,
      }],
    };
    const { text } = formatTableDefinition(spacedTable);
    assert.match(text, /CREATE TABLE \[My Schema\]\.\[My Table\] \(/);
    assert.match(text, /\[Order Id\] int/);
  });
});

suite('definitionContent.formatViewDefinition', () => {
  const summaryView: ViewInfo = {
    kind: 'view',
    objectId: 5,
    schema: 'dbo',
    name: 'vw_OrderSummary',
    modifyDate: 'x',
    columns: [
      {
        name: 'OrderId', ordinal: 1, dataType: 'int', maxLength: 4, precision: 10, scale: 0,
        isNullable: false, isIdentity: false, isComputed: false, defaultDefinition: null, isPrimaryKey: false,
      },
    ],
  };

  test('with a live body: shows it as CREATE VIEW, never a fabricated CREATE TABLE, plus a cached column reference', () => {
    const { text, columnLines } = formatViewDefinition(summaryView, 'CREATE VIEW dbo.vw_OrderSummary AS SELECT OrderId FROM dbo.Orders;');
    assert.match(text, /live definition, fetched/);
    assert.match(text, /CREATE VIEW dbo\.vw_OrderSummary AS SELECT OrderId FROM dbo\.Orders;/);
    assert.doesNotMatch(text, /CREATE TABLE/);
    const lines = text.split('\n');
    assert.strictEqual(lines[columnLines.get('orderid')!], '--   OrderId int NOT NULL');
  });

  test('with no live body (no connection, or the fetch failed): falls back to a cached column listing, still not a fabricated CREATE TABLE', () => {
    const { text } = formatViewDefinition(summaryView, null);
    assert.match(text, /body not fetched/);
    assert.doesNotMatch(text, /CREATE TABLE/);
    assert.match(text, /OrderId int NOT NULL/);
  });
});

suite('definitionContent.formatRoutineStub', () => {
  test('lists parameters with OUTPUT marked, and discloses the body is unavailable', () => {
    const text = formatRoutineStub(myProc);
    assert.match(text, /@Id int,/);
    assert.match(text, /@Out bit OUTPUT/);
    assert.match(text, /body unavailable/);
  });
});

suite('definitionContent.formatRoutineBody', () => {
  test('includes the fetched body text and discloses it was fetched live', () => {
    const text = formatRoutineBody(myProc, 'CREATE PROCEDURE dbo.MyProc AS SELECT 1;');
    assert.match(text, /live definition, fetched/);
    assert.match(text, /CREATE PROCEDURE dbo\.MyProc AS SELECT 1;/);
  });
});

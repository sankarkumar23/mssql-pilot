import * as assert from 'assert';
import { extractForeignKeys, extractIndexes } from '../../cache/schemaQueries';
import { SimpleExecuteResult } from '../../utils/mssqlTypes';

/** Builds a fake SimpleExecuteResult from column names + row value arrays (null = SQL NULL). */
function fakeResult(columns: string[], rows: Array<Array<string | null>>): SimpleExecuteResult {
  return {
    rowCount: rows.length,
    columnInfo: columns.map((columnName) => ({ columnName })),
    rows: rows.map((row) => row.map((v) => ({ displayValue: v ?? '', isNull: v === null }))),
  };
}

suite('schemaQueries.extractIndexes', () => {
  const columns = [
    'index_id', 'index_name', 'is_primary_key', 'is_unique_constraint', 'is_unique', 'is_disabled',
    'column_name', 'key_ordinal', 'is_descending_key', 'is_included_column',
  ];

  test('groups multiple column rows of the same index into one entry, in row order, excluding INCLUDE columns', () => {
    const result = fakeResult(columns, [
      ['1', 'PK_Orders', '1', '0', '1', '0', 'CustomerId', '1', '0', '0'],
      ['1', 'PK_Orders', '1', '0', '1', '0', 'OrderDate', '2', '1', '0'],
      ['2', 'IX_Orders_Total', '0', '0', '0', '0', 'Total', '1', '0', '0'],
      ['2', 'IX_Orders_Total', '0', '0', '0', '0', 'CustomerId', '0', '0', '1'],
    ]);
    const indexes = extractIndexes(result);
    assert.strictEqual(indexes.length, 2);
    assert.deepStrictEqual(indexes[0], {
      name: 'PK_Orders', isPrimaryKey: true, isUniqueConstraint: false, isUnique: true, isDisabled: false,
      columns: [{ name: 'CustomerId', isDescending: false }, { name: 'OrderDate', isDescending: true }],
    });
    // Total is a key column; CustomerId is an INCLUDE column, so it's excluded.
    assert.deepStrictEqual(indexes[1].columns, [{ name: 'Total', isDescending: false }]);
  });
});

suite('schemaQueries.extractForeignKeys', () => {
  test('groups a composite foreign key\'s columns under one entry', () => {
    const result = fakeResult(
      ['fk_name', 'parent_column', 'referenced_schema', 'referenced_table', 'referenced_column'],
      [
        ['FK_OrderLines_Orders', 'OrderId', 'dbo', 'Orders', 'Id'],
        ['FK_OrderLines_Orders', 'LineNo', 'dbo', 'Orders', 'LineNo'],
      ]
    );
    const fks = extractForeignKeys(result);
    assert.strictEqual(fks.length, 1);
    assert.deepStrictEqual(fks[0], {
      name: 'FK_OrderLines_Orders',
      columns: [
        { column: 'OrderId', referencedSchema: 'dbo', referencedTable: 'Orders', referencedColumn: 'Id' },
        { column: 'LineNo', referencedSchema: 'dbo', referencedTable: 'Orders', referencedColumn: 'LineNo' },
      ],
    });
  });
});

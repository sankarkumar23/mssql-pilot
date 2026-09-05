import { SimpleExecuteResult } from '../../../utils/mssqlTypes';

export function makeResult(columnNames: string[], rows: Array<Array<string | null>>): SimpleExecuteResult {
  return {
    rowCount: rows.length,
    columnInfo: columnNames.map((columnName) => ({ columnName })),
    rows: rows.map((row) => row.map((value) => ({ displayValue: value ?? '', isNull: value === null }))),
  };
}

const OBJECT_LISTING_COLUMNS = ['object_id', 'schema_name', 'object_name', 'object_type', 'modify_date'];
const COLUMN_COLUMNS = [
  'object_id', 'column_id', 'column_name', 'data_type', 'max_length', 'precision', 'scale',
  'is_nullable', 'is_identity', 'is_computed', 'default_definition', 'is_primary_key',
];
const PARAMETER_COLUMNS = [
  'object_id', 'parameter_id', 'parameter_name', 'data_type', 'max_length', 'precision', 'scale',
  'is_output', 'has_default_value',
];

/** rows: [objectId, schemaName, objectName, objectType, modifyDate] */
export function objectListingResult(rows: Array<[number, string, string, string, string]>): SimpleExecuteResult {
  return makeResult(
    OBJECT_LISTING_COLUMNS,
    rows.map((r) => r.map(String))
  );
}

/** rows: [objectId, columnId, columnName, dataType] — other fields default to plain non-key values. */
export function columnsResult(rows: Array<[number, number, string, string]>): SimpleExecuteResult {
  return makeResult(
    COLUMN_COLUMNS,
    rows.map(([objectId, columnId, name, dataType]) => [
      String(objectId), String(columnId), name, dataType, '4', '10', '0', '0', '0', '0', null, '0',
    ])
  );
}

/** rows: [objectId, parameterId, name, dataType] — other fields default to plain non-output values. */
export function parametersResult(rows: Array<[number, number, string, string]>): SimpleExecuteResult {
  return makeResult(
    PARAMETER_COLUMNS,
    rows.map(([objectId, parameterId, name, dataType]) => [
      String(objectId), String(parameterId), name, dataType, '4', '10', '0', '0', '0',
    ])
  );
}

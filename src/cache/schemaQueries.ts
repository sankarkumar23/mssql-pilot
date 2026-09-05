import { SimpleExecuteResult } from '../utils/mssqlTypes';
import { SqlObjectKind } from './schemaTypes';

export const SERVER_NAME_QUERY = 'SELECT @@SERVERNAME AS s';

/**
 * Phase 1: cheap id + watermark listing. A pure sys.objects catalog scan —
 * never SMO's heavier scripting/binding machinery — cheap even at
 * thousands-of-objects scale. modify_date is formatted with CONVERT style
 * 126 (ODBC canonical, no timezone) so it's a stable, locale-independent
 * string for diffing across syncs.
 */
export function buildObjectListingQuery(excludedSchemas: string[]): string {
  const exclusion = excludedSchemas.length > 0
    ? `AND s.name NOT IN (${excludedSchemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')})`
    : '';
  return `
SELECT o.object_id, s.name AS schema_name, o.name AS object_name, o.type AS object_type,
       CONVERT(varchar(33), o.modify_date, 126) AS modify_date
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.type IN ('U','V','P','FN','IF','TF') AND o.is_ms_shipped = 0
${exclusion}
ORDER BY o.object_id;`;
}

/** Phase 2, tables/views: column details. Ids are our own Phase 1 output (never user input), safe to inline. */
export function buildColumnsQuery(objectIds: number[]): string {
  return `
SELECT c.object_id, c.column_id, c.name AS column_name, ty.name AS data_type,
       c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
       dc.definition AS default_definition,
       CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
FROM sys.columns AS c
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints AS dc
       ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
LEFT JOIN (
  SELECT ic.object_id, ic.column_id
  FROM sys.index_columns AS ic
  JOIN sys.indexes AS i ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND i.is_primary_key = 1
  WHERE ic.is_included_column = 0
) AS pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
WHERE c.object_id IN (${objectIds.join(',')})
ORDER BY c.object_id, c.column_id;`;
}

/** Phase 2, procedures/functions: parameters. parameter_id = 0 is the return-type row (FN/IF/TF only). */
export function buildParametersQuery(objectIds: number[]): string {
  return `
SELECT p.object_id, p.parameter_id, p.name AS parameter_name, ty.name AS data_type,
       p.max_length, p.precision, p.scale, p.is_output, p.has_default_value
FROM sys.parameters AS p
JOIN sys.types AS ty ON ty.user_type_id = p.user_type_id
WHERE p.object_id IN (${objectIds.join(',')})
ORDER BY p.object_id, p.parameter_id;`;
}

export const OBJECT_TYPE_TO_KIND: Record<string, SqlObjectKind> = {
  U: 'table',
  V: 'view',
  P: 'procedure',
  FN: 'scalarFunction',
  IF: 'tableFunction',
  TF: 'tableFunction',
};

export interface ObjectListingRow {
  objectId: number;
  schemaName: string;
  objectName: string;
  objectType: string;
  modifyDate: string;
}

export interface ColumnRow {
  objectId: number;
  columnId: number;
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isNullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  defaultDefinition: string | null;
  isPrimaryKey: boolean;
}

export interface ParameterRow {
  objectId: number;
  parameterId: number;
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isOutput: boolean;
  hasDefault: boolean;
}

/** Converts a SimpleExecuteResult (positional cells) into name-keyed row objects. */
function rowsToObjects(result: SimpleExecuteResult): Array<Record<string, string | null>> {
  const colNames = result.columnInfo.map((c) => c.columnName);
  return result.rows.map((row) => {
    const obj: Record<string, string | null> = {};
    row.forEach((cell, i) => {
      obj[colNames[i]] = cell.isNull ? null : cell.displayValue;
    });
    return obj;
  });
}

function toNumberOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toBool(v: string | null): boolean {
  return v === '1' || v === 'true' || v === 'True';
}

export function mapObjectListingRows(result: SimpleExecuteResult): ObjectListingRow[] {
  return rowsToObjects(result).map((r) => ({
    objectId: Number(r.object_id),
    schemaName: r.schema_name ?? '',
    objectName: r.object_name ?? '',
    objectType: (r.object_type ?? '').trim(),
    modifyDate: r.modify_date ?? '',
  }));
}

export function mapColumnRows(result: SimpleExecuteResult): ColumnRow[] {
  return rowsToObjects(result).map((r) => ({
    objectId: Number(r.object_id),
    columnId: Number(r.column_id),
    name: r.column_name ?? '',
    dataType: r.data_type ?? '',
    maxLength: toNumberOrNull(r.max_length),
    precision: toNumberOrNull(r.precision),
    scale: toNumberOrNull(r.scale),
    isNullable: toBool(r.is_nullable),
    isIdentity: toBool(r.is_identity),
    isComputed: toBool(r.is_computed),
    defaultDefinition: r.default_definition,
    isPrimaryKey: toBool(r.is_primary_key),
  }));
}

export function mapParameterRows(result: SimpleExecuteResult): ParameterRow[] {
  return rowsToObjects(result).map((r) => ({
    objectId: Number(r.object_id),
    parameterId: Number(r.parameter_id),
    name: r.parameter_name ?? '',
    dataType: r.data_type ?? '',
    maxLength: toNumberOrNull(r.max_length),
    precision: toNumberOrNull(r.precision),
    scale: toNumberOrNull(r.scale),
    isOutput: toBool(r.is_output),
    hasDefault: toBool(r.has_default_value),
  }));
}

export function extractServerName(result: SimpleExecuteResult): string {
  return result.rows?.[0]?.[0]?.displayValue ?? '';
}

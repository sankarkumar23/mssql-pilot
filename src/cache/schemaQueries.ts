import { SimpleExecuteResult } from '../utils/mssqlTypes';
import { SqlObjectKind } from './schemaTypes';

export const SERVER_NAME_QUERY = 'SELECT @@SERVERNAME AS s';

function buildSchemaExclusionClause(excludedSchemas: string[]): string {
  return excludedSchemas.length > 0
    ? `AND s.name NOT IN (${excludedSchemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')})`
    : '';
}

/**
 * Phase 1: cheap id + watermark listing. A pure sys.objects catalog scan —
 * never SMO's heavier scripting/binding machinery — cheap even at
 * thousands-of-objects scale. modify_date is formatted with CONVERT style
 * 126 (ODBC canonical, no timezone) so it's a stable, locale-independent
 * string for diffing across syncs.
 */
export function buildObjectListingQuery(excludedSchemas: string[]): string {
  const exclusion = buildSchemaExclusionClause(excludedSchemas);
  return `
SELECT o.object_id, s.name AS schema_name, o.name AS object_name, o.type AS object_type,
       CONVERT(varchar(33), o.modify_date, 126) AS modify_date
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.type IN ('U','V','P','FN','IF','TF') AND o.is_ms_shipped = 0
${exclusion}
ORDER BY o.object_id;`;
}

/**
 * Distinct schema names only — a tiny, indexed catalog query, run
 * independently of the (potentially capped) object listing above. This is
 * what keeps schema-first browsing complete even on a database with more
 * objects than mssqlPilot.maxObjectsPerFirstSync: the schema list never
 * depends on how many of those objects actually made it into the cache.
 */
export function buildSchemaListingQuery(excludedSchemas: string[]): string {
  const exclusion = buildSchemaExclusionClause(excludedSchemas);
  return `
SELECT DISTINCT s.name AS schema_name
FROM sys.schemas AS s
JOIN sys.objects AS o ON o.schema_id = s.schema_id
WHERE o.type IN ('U','V','P','FN','IF','TF') AND o.is_ms_shipped = 0
${exclusion}
ORDER BY s.name;`;
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

/** Escapes a value for embedding in a T-SQL N'...' string literal. */
function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Fetches a routine's body text live (not part of bulk sync — routine bodies
 * are never cached, deliberately, to keep the cache lean). Only used
 * on-demand, one object at a time, when the user asks to see a specific
 * routine's definition.
 */
export function buildObjectDefinitionQuery(schema: string, name: string): string {
  return `SELECT OBJECT_DEFINITION(OBJECT_ID(N'${escapeSqlLiteral(schema)}.${escapeSqlLiteral(name)}')) AS object_definition;`;
}

export interface DependentViewInfo {
  schema: string;
  name: string;
}

/**
 * Views that reference this table/view, via SQL Server's own dependency
 * tracking (sys.dm_sql_referencing_entities) — not a text search, so it
 * catches references regardless of formatting/casing. Like the other
 * on-demand fetches here, only ever run one object at a time at F12 time.
 */
export function buildDependentViewsQuery(schema: string, name: string): string {
  return `
SELECT DISTINCT s.name AS view_schema, o.name AS view_name
FROM sys.dm_sql_referencing_entities(N'${escapeSqlLiteral(schema)}.${escapeSqlLiteral(name)}', 'OBJECT') AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.type = 'V'
ORDER BY s.name, o.name;`;
}

export function extractDependentViews(result: SimpleExecuteResult): DependentViewInfo[] {
  return rowsToObjects(result).map((r) => ({
    schema: r.view_schema ?? '',
    name: r.view_name ?? '',
  }));
}

/** Null when the object doesn't exist, is encrypted (WITH ENCRYPTION), or is a CLR object. */
export function extractObjectDefinition(result: SimpleExecuteResult): string | null {
  const cell = result.rows?.[0]?.[0];
  if (!cell || cell.isNull) return null;
  return cell.displayValue;
}

export interface IndexInfo {
  name: string;
  isPrimaryKey: boolean;
  isUniqueConstraint: boolean;
  isUnique: boolean;
  isDisabled: boolean;
  columns: Array<{ name: string; isDescending: boolean }>;
}

export interface ForeignKeyInfo {
  name: string;
  columns: Array<{ column: string; referencedSchema: string; referencedTable: string; referencedColumn: string }>;
}

export interface CheckConstraintInfo {
  name: string;
  definition: string | null;
  isDisabled: boolean;
}

/**
 * Indexes, PK, and unique constraints all live in sys.indexes — one query
 * covers all three. Like the routine-body fetch above, this is on-demand
 * only (go-to-definition on a specific table), never part of bulk sync:
 * a huge database can have far more index/key metadata than object
 * metadata, and none of it is needed for autocomplete.
 */
export function buildIndexesQuery(objectId: number): string {
  return `
SELECT i.index_id, i.name AS index_name, i.is_primary_key, i.is_unique_constraint, i.is_unique, i.is_disabled,
       c.name AS column_name, ic.key_ordinal, ic.is_descending_key, ic.is_included_column
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = ${objectId} AND i.index_id > 0
ORDER BY i.index_id, ic.key_ordinal, ic.index_column_id;`;
}

export function extractIndexes(result: SimpleExecuteResult): IndexInfo[] {
  const byId = new Map<string, IndexInfo>();
  const order: string[] = [];
  for (const r of rowsToObjects(result)) {
    const id = r.index_id ?? '';
    let info = byId.get(id);
    if (!info) {
      info = {
        name: r.index_name ?? '',
        isPrimaryKey: toBool(r.is_primary_key),
        isUniqueConstraint: toBool(r.is_unique_constraint),
        isUnique: toBool(r.is_unique),
        isDisabled: toBool(r.is_disabled),
        columns: [],
      };
      byId.set(id, info);
      order.push(id);
    }
    if (!toBool(r.is_included_column)) {
      info.columns.push({ name: r.column_name ?? '', isDescending: toBool(r.is_descending_key) });
    }
  }
  return order.map((id) => byId.get(id)!);
}

export function buildForeignKeysQuery(objectId: number): string {
  return `
SELECT fk.name AS fk_name, pc.name AS parent_column,
       rs.name AS referenced_schema, rt.name AS referenced_table, rc.name AS referenced_column
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE fk.parent_object_id = ${objectId}
ORDER BY fk.name, fkc.constraint_column_id;`;
}

export function extractForeignKeys(result: SimpleExecuteResult): ForeignKeyInfo[] {
  const byName = new Map<string, ForeignKeyInfo>();
  const order: string[] = [];
  for (const r of rowsToObjects(result)) {
    const name = r.fk_name ?? '';
    let info = byName.get(name);
    if (!info) {
      info = { name, columns: [] };
      byName.set(name, info);
      order.push(name);
    }
    info.columns.push({
      column: r.parent_column ?? '',
      referencedSchema: r.referenced_schema ?? '',
      referencedTable: r.referenced_table ?? '',
      referencedColumn: r.referenced_column ?? '',
    });
  }
  return order.map((name) => byName.get(name)!);
}

export function buildCheckConstraintsQuery(objectId: number): string {
  return `
SELECT cc.name, cc.definition, cc.is_disabled
FROM sys.check_constraints cc
WHERE cc.parent_object_id = ${objectId}
ORDER BY cc.name;`;
}

export function extractCheckConstraints(result: SimpleExecuteResult): CheckConstraintInfo[] {
  return rowsToObjects(result).map((r) => ({
    name: r.name ?? '',
    definition: r.definition,
    isDisabled: toBool(r.is_disabled),
  }));
}

export function mapSchemaListingRows(result: SimpleExecuteResult): string[] {
  return rowsToObjects(result).map((r) => r.schema_name ?? '').filter((name) => name.length > 0);
}

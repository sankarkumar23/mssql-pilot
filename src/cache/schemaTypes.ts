export type SqlObjectKind = 'table' | 'view' | 'procedure' | 'scalarFunction' | 'tableFunction';

export interface ColumnInfo {
  name: string;
  ordinal: number;
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

export interface ParameterInfo {
  name: string;
  ordinal: number;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isOutput: boolean;
  hasDefault: boolean;
}

export interface TableInfo {
  kind: 'table';
  objectId: number;
  schema: string;
  name: string;
  modifyDate: string;
  columns: ColumnInfo[];
}

export interface ViewInfo {
  kind: 'view';
  objectId: number;
  schema: string;
  name: string;
  modifyDate: string;
  columns: ColumnInfo[];
}

export interface RoutineInfo {
  kind: 'procedure' | 'scalarFunction' | 'tableFunction';
  objectId: number;
  schema: string;
  name: string;
  modifyDate: string;
  parameters: ParameterInfo[];
  returnType?: string;
  /** Table-valued functions only. Best-effort — may be empty. */
  tableColumns?: ColumnInfo[];
}

export type SchemaObject = TableInfo | ViewInfo | RoutineInfo;

/** Full on-disk payload for one server+database. */
export interface DatabaseSchemaCache {
  /** Bump on breaking shape changes. A mismatch is treated as "absent" and rebuilt from scratch. */
  formatVersion: 2;
  server: string;
  database: string;
  /** Keyed by sys.objects.object_id — stable across renames, enables O(1) diff/lookup. */
  objects: Record<number, SchemaObject>;
  /**
   * Every schema that owns at least one cacheable object, sourced from its
   * own cheap sys.schemas query — independent of maxObjectsPerFirstSync
   * capping the object listing, so schema-first browsing stays complete
   * even on a huge database where the object cap has been hit.
   */
  schemas: string[];
  lastFullSyncAt: string;
  lastDeltaSyncAt: string;
}

export interface CacheManifestEntry {
  cacheKey: string;
  server: string;
  database: string;
  objectCount: number;
  lastFullSyncAt: string;
  lastDeltaSyncAt: string;
}

export interface CacheManifest {
  formatVersion: 1;
  entries: CacheManifestEntry[];
}

export function emptyDatabaseSchemaCache(server: string, database: string): DatabaseSchemaCache {
  return {
    formatVersion: 2,
    server,
    database,
    objects: {},
    schemas: [],
    lastFullSyncAt: '',
    lastDeltaSyncAt: '',
  };
}

import * as vscode from 'vscode';
import { IConnectionSharingService } from '../utils/mssqlTypes';
import { withSharedConnection } from '../utils/sharedConnection';
import { log, describeError } from '../utils/outputChannel';
import { getExcludedSchemas, getMaxObjectsPerFirstSync } from '../utils/config';
import {
  buildObjectListingQuery,
  buildColumnsQuery,
  buildParametersQuery,
  mapObjectListingRows,
  mapColumnRows,
  mapParameterRows,
  ObjectListingRow,
  ColumnRow,
  ParameterRow,
  OBJECT_TYPE_TO_KIND,
} from './schemaQueries';
import {
  DatabaseSchemaCache,
  SchemaObject,
  TableInfo,
  ViewInfo,
  RoutineInfo,
  ColumnInfo,
  ParameterInfo,
} from './schemaTypes';

const CHUNK_SIZE = 500;

export interface DiffResult {
  added: ObjectListingRow[];
  changed: ObjectListingRow[];
  removed: number[];
  unchangedCount: number;
}

/**
 * Pure diff: no vscode/network dependency, fully unit-testable.
 *
 * Comparing name/schema in addition to modifyDate matters: sp_rename does
 * NOT bump sys.objects.modify_date, so a modify_date-only diff would
 * silently miss renames. Keying by object_id (not name) is what makes a
 * rename land as "same entry, new name" here for free, rather than a
 * spurious remove+add.
 */
export function diffObjectListing(
  cached: Record<number, SchemaObject>,
  fresh: ObjectListingRow[]
): DiffResult {
  const freshIds = new Set(fresh.map((r) => r.objectId));
  const added: ObjectListingRow[] = [];
  const changed: ObjectListingRow[] = [];
  let unchangedCount = 0;

  for (const row of fresh) {
    const existing = cached[row.objectId];
    if (!existing) {
      added.push(row);
    } else if (
      existing.modifyDate !== row.modifyDate ||
      existing.name !== row.objectName ||
      existing.schema !== row.schemaName
    ) {
      changed.push(row);
    } else {
      unchangedCount++;
    }
  }

  const removed = Object.keys(cached)
    .map(Number)
    .filter((id) => !freshIds.has(id));

  return { added, changed, removed, unchangedCount };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function groupBy<T>(items: T[], keyFn: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    if (list) {
      list.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function columnInfoFromRow(row: ColumnRow): ColumnInfo {
  return {
    name: row.name,
    ordinal: row.columnId,
    dataType: row.dataType,
    maxLength: row.maxLength,
    precision: row.precision,
    scale: row.scale,
    isNullable: row.isNullable,
    isIdentity: row.isIdentity,
    isComputed: row.isComputed,
    defaultDefinition: row.defaultDefinition,
    isPrimaryKey: row.isPrimaryKey,
  };
}

function parameterInfoFromRow(row: ParameterRow): ParameterInfo {
  return {
    name: row.name,
    ordinal: row.parameterId,
    dataType: row.dataType,
    maxLength: row.maxLength,
    precision: row.precision,
    scale: row.scale,
    isOutput: row.isOutput,
    hasDefault: row.hasDefault,
  };
}

/** Pure: builds full SchemaObject entries given already-fetched detail rows. Exported for unit tests. */
export function assembleSchemaObjects(
  rows: ObjectListingRow[],
  columnsByObjectId: Map<number, ColumnRow[]>,
  parametersByObjectId: Map<number, ParameterRow[]>
): Record<number, SchemaObject> {
  const out: Record<number, SchemaObject> = {};
  for (const row of rows) {
    const kind = OBJECT_TYPE_TO_KIND[row.objectType];
    if (!kind) {
      continue; // shouldn't happen given the Phase 1 WHERE clause, but skip safely
    }
    if (kind === 'table' || kind === 'view') {
      const columns = (columnsByObjectId.get(row.objectId) ?? []).map(columnInfoFromRow);
      const info: TableInfo | ViewInfo = {
        kind,
        objectId: row.objectId,
        schema: row.schemaName,
        name: row.objectName,
        modifyDate: row.modifyDate,
        columns,
      };
      out[row.objectId] = info;
    } else {
      const paramRows = parametersByObjectId.get(row.objectId) ?? [];
      const returnRow = paramRows.find((p) => p.parameterId === 0);
      const parameters = paramRows.filter((p) => p.parameterId !== 0).map(parameterInfoFromRow);
      const tableColumns =
        kind === 'tableFunction' ? (columnsByObjectId.get(row.objectId) ?? []).map(columnInfoFromRow) : undefined;
      const info: RoutineInfo = {
        kind,
        objectId: row.objectId,
        schema: row.schemaName,
        name: row.objectName,
        modifyDate: row.modifyDate,
        parameters,
        returnType: returnRow?.dataType,
        tableColumns: tableColumns && tableColumns.length > 0 ? tableColumns : undefined,
      };
      out[row.objectId] = info;
    }
  }
  return out;
}

/**
 * Runs one sync pass (full or delta — same code path; a full sync just
 * starts from an empty `current.objects`).
 *
 * Never throws — every failure is logged only and returns undefined,
 * since this is a pure enhancement layer that must never disrupt the
 * user's actual query workflow (same non-fatal shape as mssql-extras's
 * `try { rebuildIntelliSenseCache } catch { log(...) }`).
 */
export async function runSync(
  cs: IConnectionSharingService,
  extensionId: string,
  connectionId: string,
  current: DatabaseSchemaCache
): Promise<DatabaseSchemaCache | undefined> {
  try {
    return await withSharedConnection(cs, extensionId, connectionId, async (uri) => {
      const excludedSchemas = getExcludedSchemas();
      const listingResult = await cs.executeSimpleQuery(uri, buildObjectListingQuery(excludedSchemas));
      let fresh = mapObjectListingRows(listingResult);

      const isFullSync = Object.keys(current.objects).length === 0;
      if (isFullSync) {
        const cap = getMaxObjectsPerFirstSync();
        if (cap > 0 && fresh.length > cap) {
          log(
            `[sync] ${current.server}/${current.database}: first sync found ${fresh.length} objects, ` +
            `capping to ${cap} (mssqlPilot.maxObjectsPerFirstSync)`
          );
          fresh = fresh.slice(0, cap);
          vscode.window.showInformationMessage(
            `MSSQL Pilot: this database has more than ${cap} objects; only the first ${cap} are cached. ` +
            'Increase mssqlPilot.maxObjectsPerFirstSync to cache more.'
          );
        }
      }

      const diff = diffObjectListing(current.objects, fresh);
      const toFetch = [...diff.added, ...diff.changed];

      const columnsByObjectId = new Map<number, ColumnRow[]>();
      const parametersByObjectId = new Map<number, ParameterRow[]>();

      const tableLikeIds = toFetch
        .filter((r) => {
          const kind = OBJECT_TYPE_TO_KIND[r.objectType];
          return kind === 'table' || kind === 'view' || kind === 'tableFunction';
        })
        .map((r) => r.objectId);
      const routineIds = toFetch
        .filter((r) => {
          const kind = OBJECT_TYPE_TO_KIND[r.objectType];
          return kind === 'procedure' || kind === 'scalarFunction' || kind === 'tableFunction';
        })
        .map((r) => r.objectId);

      for (const idChunk of chunk(tableLikeIds, CHUNK_SIZE)) {
        if (!cs.isConnected(uri)) break; // cooperative cancellation if the user disconnected mid-sync
        const result = await cs.executeSimpleQuery(uri, buildColumnsQuery(idChunk));
        for (const [objectId, rows] of groupBy(mapColumnRows(result), (r) => r.objectId)) {
          columnsByObjectId.set(objectId, rows);
        }
      }
      for (const idChunk of chunk(routineIds, CHUNK_SIZE)) {
        if (!cs.isConnected(uri)) break;
        const result = await cs.executeSimpleQuery(uri, buildParametersQuery(idChunk));
        for (const [objectId, rows] of groupBy(mapParameterRows(result), (r) => r.objectId)) {
          parametersByObjectId.set(objectId, rows);
        }
      }

      const newObjects = assembleSchemaObjects(toFetch, columnsByObjectId, parametersByObjectId);

      const next: DatabaseSchemaCache = {
        ...current,
        objects: { ...current.objects },
      };
      for (const id of diff.removed) {
        delete next.objects[id];
      }
      Object.assign(next.objects, newObjects);
      const now = new Date().toISOString();
      next.lastDeltaSyncAt = now;
      if (isFullSync) {
        next.lastFullSyncAt = now;
      }

      log(
        `[sync] ${current.server}/${current.database}: ${isFullSync ? 'full' : 'delta'} sync — ` +
        `+${diff.added.length} ~${diff.changed.length} -${diff.removed.length} =${diff.unchangedCount}`
      );
      return next;
    });
  } catch (err) {
    log(
      `[sync] sync failed for ${current.server}/${current.database} (non-fatal, cache left as-is): ` +
      describeError(err)
    );
    return undefined;
  }
}

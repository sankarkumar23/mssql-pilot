import { DatabaseSchemaCache, SchemaObject } from './schemaTypes';

/**
 * Derived, read-optimized view over a DatabaseSchemaCache's objects — built
 * once per sync (see getSchemaIndex's memoization below), not once per
 * completion request. On a database with many schemas/thousands of objects,
 * recomputing "every distinct schema" or "every object in schema X" via a
 * linear scan on every keystroke is real, repeated work; grouping it once
 * up front turns every one of those lookups into an O(1) Map.get.
 */
export interface SchemaIndex {
  /** Every object, flattened once (avoids repeated Object.values() calls). */
  all: SchemaObject[];
  /** Distinct schema names, sorted — what schema-first browsing lists. */
  schemas: string[];
  /** Objects grouped by lowercased schema name. */
  bySchema: Map<string, SchemaObject[]>;
  /** Objects grouped by lowercased bare object name (schema-less lookup, e.g. resolving an alias). */
  byName: Map<string, SchemaObject[]>;
}

function pushInto<K>(map: Map<K, SchemaObject[]>, key: K, obj: SchemaObject): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(obj);
  } else {
    map.set(key, [obj]);
  }
}

function buildSchemaIndex(cache: DatabaseSchemaCache): SchemaIndex {
  const all = Object.values(cache.objects);
  const bySchema = new Map<string, SchemaObject[]>();
  const byName = new Map<string, SchemaObject[]>();

  for (const obj of all) {
    pushInto(bySchema, obj.schema.toLowerCase(), obj);
    pushInto(byName, obj.name.toLowerCase(), obj);
  }

  // Sourced from its own dedicated sync query (see schemaQueries.buildSchemaListingQuery),
  // not derived from `all` — stays complete even when the object listing
  // itself was capped by maxObjectsPerFirstSync.
  const schemas = [...cache.schemas].sort((a, b) => a.localeCompare(b));
  return { all, schemas, bySchema, byName };
}

const indexByCache = new WeakMap<DatabaseSchemaCache, SchemaIndex>();

/**
 * Memoized by the DatabaseSchemaCache object's own identity. runSync always
 * produces a brand-new cache object (even for a delta sync), so this
 * recomputes exactly once per sync and is reused for every completion
 * request in between — no explicit invalidation needed.
 */
export function getSchemaIndex(cache: DatabaseSchemaCache): SchemaIndex {
  let index = indexByCache.get(cache);
  if (!index) {
    index = buildSchemaIndex(cache);
    indexByCache.set(cache, index);
  }
  return index;
}

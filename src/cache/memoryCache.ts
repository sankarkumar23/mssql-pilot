import { DatabaseSchemaCache } from './schemaTypes';

/** Hot in-memory store the completion provider reads synchronously. */
const cacheByKey = new Map<string, DatabaseSchemaCache>();

export function getMemoryCache(cacheKey: string): DatabaseSchemaCache | undefined {
  return cacheByKey.get(cacheKey);
}

export function setMemoryCache(cacheKey: string, value: DatabaseSchemaCache): void {
  cacheByKey.set(cacheKey, value);
}

export function deleteMemoryCache(cacheKey: string): void {
  cacheByKey.delete(cacheKey);
}

export function clearAllMemoryCache(): void {
  cacheByKey.clear();
}

export function hasMemoryCache(cacheKey: string): boolean {
  return cacheByKey.has(cacheKey);
}

import * as vscode from 'vscode';
import { CacheManifest, CacheManifestEntry, DatabaseSchemaCache } from './schemaTypes';

const CACHE_DIR = 'schema-cache';
const MANIFEST_FILE = 'manifest.json';

function cacheDirUri(globalStorageUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(globalStorageUri, CACHE_DIR);
}

function cacheFileUri(globalStorageUri: vscode.Uri, cacheKey: string): vscode.Uri {
  return vscode.Uri.joinPath(cacheDirUri(globalStorageUri), `${cacheKey}.json`);
}

function manifestFileUri(globalStorageUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(cacheDirUri(globalStorageUri), MANIFEST_FILE);
}

async function ensureCacheDir(globalStorageUri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(cacheDirUri(globalStorageUri));
}

async function readJson<T>(uri: vscode.Uri): Promise<T | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Write to a .tmp sibling then rename over the real file — a crash mid-write never corrupts the cache. */
async function writeJsonAtomic(uri: vscode.Uri, value: unknown): Promise<void> {
  const tmpUri = uri.with({ path: `${uri.path}.tmp` });
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  await vscode.workspace.fs.writeFile(tmpUri, bytes);
  try {
    await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
  } catch (err) {
    try {
      await vscode.workspace.fs.delete(tmpUri);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

export async function readDatabaseSchemaCache(
  globalStorageUri: vscode.Uri,
  cacheKey: string
): Promise<DatabaseSchemaCache | undefined> {
  const value = await readJson<DatabaseSchemaCache>(cacheFileUri(globalStorageUri, cacheKey));
  if (!value || value.formatVersion !== 1) {
    return undefined;
  }
  return value;
}

export async function writeDatabaseSchemaCache(
  globalStorageUri: vscode.Uri,
  cacheKey: string,
  value: DatabaseSchemaCache
): Promise<void> {
  await ensureCacheDir(globalStorageUri);
  await writeJsonAtomic(cacheFileUri(globalStorageUri, cacheKey), value);
}

export async function deleteDatabaseSchemaCache(globalStorageUri: vscode.Uri, cacheKey: string): Promise<void> {
  try {
    await vscode.workspace.fs.delete(cacheFileUri(globalStorageUri, cacheKey));
  } catch {
    // already absent — fine
  }
}

export async function readManifest(globalStorageUri: vscode.Uri): Promise<CacheManifest> {
  const value = await readJson<CacheManifest>(manifestFileUri(globalStorageUri));
  if (!value || value.formatVersion !== 1) {
    return { formatVersion: 1, entries: [] };
  }
  return value;
}

async function writeManifest(globalStorageUri: vscode.Uri, manifest: CacheManifest): Promise<void> {
  await ensureCacheDir(globalStorageUri);
  await writeJsonAtomic(manifestFileUri(globalStorageUri), manifest);
}

export async function upsertManifestEntry(globalStorageUri: vscode.Uri, entry: CacheManifestEntry): Promise<void> {
  const manifest = await readManifest(globalStorageUri);
  const idx = manifest.entries.findIndex((e) => e.cacheKey === entry.cacheKey);
  if (idx >= 0) {
    manifest.entries[idx] = entry;
  } else {
    manifest.entries.push(entry);
  }
  await writeManifest(globalStorageUri, manifest);
}

export async function removeManifestEntry(globalStorageUri: vscode.Uri, cacheKey: string): Promise<void> {
  const manifest = await readManifest(globalStorageUri);
  manifest.entries = manifest.entries.filter((e) => e.cacheKey !== cacheKey);
  await writeManifest(globalStorageUri, manifest);
}

export async function clearAllOnDisk(globalStorageUri: vscode.Uri): Promise<void> {
  const dir = cacheDirUri(globalStorageUri);
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return; // directory doesn't exist yet — nothing to clear
  }
  for (const [name] of entries) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, name));
    } catch {
      // best-effort
    }
  }
}

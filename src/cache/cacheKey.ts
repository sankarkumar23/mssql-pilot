import * as crypto from 'crypto';

export interface ServerDatabaseKey {
  server: string;
  database: string;
}

/**
 * Deterministic, filesystem-safe key derived from server+database identity.
 *
 * Not based on mssql's connectionId/connectionUri — those are ephemeral and
 * don't survive reconnects or VS Code restarts, which would defeat the whole
 * point of a persistent cache.
 *
 * The hash suffix is not cosmetic: aggressive sanitization of names like
 * "MYHOST\SQLEXPRESS" or "tcp:host,1433" could plausibly collapse two
 * distinct server+database pairs to the same sanitized string. Appending a
 * hash of the pre-sanitization string makes collision structurally
 * impossible without reasoning case-by-case about which characters are safe.
 */
export function buildCacheKey(k: ServerDatabaseKey): string {
  const normalized = `${k.server}`.trim().toLowerCase() + '|' + `${k.database}`.trim().toLowerCase();
  const readable = normalized.replace(/[^a-z0-9]+/g, '_').slice(0, 80);
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10);
  return `${readable}-${hash}`;
}

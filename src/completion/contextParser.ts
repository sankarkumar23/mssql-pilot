/**
 * Pure string-in/data-out parsing helpers. No vscode dependency, no I/O —
 * fully unit-testable standalone.
 */

const SQL_KEYWORDS_AFTER_TABLE = new Set([
  'where', 'on', 'inner', 'left', 'right', 'outer', 'full', 'cross', 'join',
  'group', 'order', 'having', 'union', 'go', 'set', 'and', 'or', 'as',
]);

/**
 * Scans document text for `FROM <table> [AS] <alias>` / `JOIN <table> [AS] <alias>`
 * and builds a lookup from both the alias AND the bare table name (last dotted
 * segment) to the full table name as written. Recomputed per completion
 * request — cheap, SQL files are typically small, no caching needed.
 */
export function buildAliasMap(documentText: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /\b(?:FROM|JOIN)\s+(\[[^\]]+\]|[\w.]+)\s*(?:(AS)\s+(\w+)|(\w+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(documentText)) !== null) {
    const tableName = match[1].replace(/[[\]]/g, '');
    const alias = match[3] || match[4];

    const lastSegment = tableName.split('.').pop();
    if (lastSegment) {
      map.set(lastSegment.toLowerCase(), tableName);
    }
    if (alias && !SQL_KEYWORDS_AFTER_TABLE.has(alias.toLowerCase())) {
      map.set(alias.toLowerCase(), tableName);
    }
  }
  return map;
}

export interface CompletionContext {
  /** The partial identifier being typed, right before the cursor. */
  wordPrefix: string;
  /** The identifier before a preceding '.', if any (an alias, table name, or schema name). */
  qualifier: string | undefined;
}

/** Parses the text of the current line up to the cursor. */
export function getCompletionContext(lineTextBeforeCursor: string): CompletionContext {
  const match = /(?:([A-Za-z_][\w]*)\.)?(\w*)$/.exec(lineTextBeforeCursor);
  return {
    wordPrefix: match?.[2] ?? '',
    qualifier: match?.[1],
  };
}

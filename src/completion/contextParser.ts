/**
 * Pure string-in/data-out parsing helpers. No vscode dependency, no I/O —
 * fully unit-testable standalone.
 */

const SQL_KEYWORDS_AFTER_TABLE = new Set([
  'where', 'on', 'inner', 'left', 'right', 'outer', 'full', 'cross', 'join',
  'group', 'order', 'having', 'union', 'go', 'set', 'and', 'or', 'as',
]);

export interface TableReference {
  tableName: string;
  /** The alias actually typed (explicit AS or implicit) — excludes a following keyword mistaken for one. */
  alias?: string;
}

/** Scans for every `FROM <table> [AS] <alias>` / `JOIN <table> [AS] <alias>` in the text. */
function parseTableReferences(documentText: string): TableReference[] {
  const regex = /\b(?:FROM|JOIN)\s+(\[[^\]]+\]|[\w.]+)\s*(?:(AS)\s+(\w+)|(\w+))?/gi;
  const refs: TableReference[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(documentText)) !== null) {
    const tableName = match[1].replace(/[[\]]/g, '');
    const rawAlias = match[3] || match[4];
    const alias = rawAlias && !SQL_KEYWORDS_AFTER_TABLE.has(rawAlias.toLowerCase()) ? rawAlias : undefined;
    refs.push({ tableName, alias });
  }
  return refs;
}

/**
 * Builds a lookup from both the alias AND the bare table name (last dotted
 * segment) to the full table name as written. Recomputed per completion
 * request — cheap, SQL files are typically small, no caching needed.
 */
export function buildAliasMap(documentText: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { tableName, alias } of parseTableReferences(documentText)) {
    const lastSegment = tableName.split('.').pop();
    if (lastSegment) {
      map.set(lastSegment.toLowerCase(), tableName);
    }
    if (alias) {
      map.set(alias.toLowerCase(), tableName);
    }
  }
  return map;
}

/**
 * Every alias already assigned to a table/view elsewhere in the document —
 * used to avoid suggesting a new alias that collides with one already in use
 * in the same query.
 */
export function collectUsedAliases(documentText: string): Set<string> {
  const aliases = new Set<string>();
  for (const { alias } of parseTableReferences(documentText)) {
    if (alias) {
      aliases.add(alias.toLowerCase());
    }
  }
  return aliases;
}

/** Every `FROM`/`JOIN` reference in the document that actually got an alias — the tables in scope for alias.column completion. */
export function collectAliasedTableReferences(documentText: string): Array<Required<TableReference>> {
  return parseTableReferences(documentText).filter(
    (ref): ref is Required<TableReference> => ref.alias !== undefined
  );
}

export interface CompletionContext {
  /** The partial identifier being typed, right before the cursor. */
  wordPrefix: string;
  /** The identifier before a preceding '.', if any (an alias, table name, or schema name). */
  qualifier: string | undefined;
  /** True when the identifier being typed directly follows FROM/JOIN — naming a table, not referencing an alias. */
  isTableReferencePosition: boolean;
}

/** Parses the text of the current line up to the cursor. */
export function getCompletionContext(lineTextBeforeCursor: string): CompletionContext {
  const match = /(?:([A-Za-z_][\w]*)\.)?(\w*)$/.exec(lineTextBeforeCursor);
  const matchStart = match?.index ?? lineTextBeforeCursor.length;
  const textBeforeMatch = lineTextBeforeCursor.slice(0, matchStart);
  return {
    wordPrefix: match?.[2] ?? '',
    qualifier: match?.[1],
    isTableReferencePosition: /\b(?:FROM|JOIN)\s*$/i.test(textBeforeMatch),
  };
}

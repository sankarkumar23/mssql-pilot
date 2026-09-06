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
  /** Offset range of the alias token itself in the original text, if it has one. */
  aliasRange?: readonly [start: number, end: number];
}

/** Scans for every `FROM <table> [AS] <alias>` / `JOIN <table> [AS] <alias>` in the text. */
function parseTableReferences(documentText: string): TableReference[] {
  // Each dotted segment may be bare or bracket-quoted, and independently so
  // (e.g. "[dbo].Orders", "dbo.[Orders]", "[My Schema].[My Table]"). The
  // alias itself may also be bracket-quoted (e.g. "AS [My Alias]").
  const regex =
    /\b(?:FROM|JOIN)\s+((?:\[[^\]]+\]|\w+)(?:\.(?:\[[^\]]+\]|\w+))*)\s*(?:(AS)\s+(\[[^\]]+\]|\w+)|(\[[^\]]+\]|\w+))?/gi;
  const refs: TableReference[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(documentText)) !== null) {
    const tableName = match[1].replace(/[[\]]/g, '');
    const rawAliasAsMatched = match[3] || match[4]; // brackets not yet stripped — needed for offset math below
    const alias = rawAliasAsMatched?.replace(/[[\]]/g, '');
    if (alias && !SQL_KEYWORDS_AFTER_TABLE.has(alias.toLowerCase())) {
      // Nothing in the pattern follows the alias group, so when it matched,
      // it's always the exact tail of the whole match — no need for the
      // regex "d" flag to get its offset.
      const end = match.index + match[0].length;
      const start = end - rawAliasAsMatched!.length;
      refs.push({ tableName, alias, aliasRange: [start, end] });
    } else {
      refs.push({ tableName });
    }
  }
  return refs;
}

/**
 * True when the cursor sits inside (or right at the end of) this
 * reference's alias token — i.e. the alias is what's currently being
 * typed, not an already-finished, ready-to-use alias. A regex scan over
 * the whole document has no notion of "in progress"; this is what tells
 * "FROM Trade t" (finished, elsewhere) apart from "FROM Trade t|" (the
 * user is mid-way through naming this very alias, cursor right after it).
 */
function isAliasStillBeingTyped(ref: TableReference, cursorOffset: number | undefined): boolean {
  if (cursorOffset === undefined || !ref.aliasRange) return false;
  const [start, end] = ref.aliasRange;
  return cursorOffset >= start && cursorOffset <= end;
}

/**
 * Builds a lookup from both the alias AND the bare table name (last dotted
 * segment) to the full table name as written. Recomputed per completion
 * request — cheap, SQL files are typically small, no caching needed.
 *
 * `cursorOffset`, when given, excludes an alias the cursor is still sitting
 * inside of — see isAliasStillBeingTyped.
 */
export function buildAliasMap(documentText: string, cursorOffset?: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const ref of parseTableReferences(documentText)) {
    const lastSegment = ref.tableName.split('.').pop();
    if (lastSegment) {
      map.set(lastSegment.toLowerCase(), ref.tableName);
    }
    if (ref.alias && !isAliasStillBeingTyped(ref, cursorOffset)) {
      map.set(ref.alias.toLowerCase(), ref.tableName);
    }
  }
  return map;
}

/**
 * Every alias already assigned to a table/view elsewhere in the document —
 * used to avoid suggesting a new alias that collides with one already in use
 * in the same query. Excludes an alias still being typed at the cursor.
 */
export function collectUsedAliases(documentText: string, cursorOffset?: number): Set<string> {
  const aliases = new Set<string>();
  for (const ref of parseTableReferences(documentText)) {
    if (ref.alias && !isAliasStillBeingTyped(ref, cursorOffset)) {
      aliases.add(ref.alias.toLowerCase());
    }
  }
  return aliases;
}

/**
 * Every `FROM`/`JOIN` reference in the document that has a finished alias —
 * the tables in scope for alias.column completion. Excludes a reference
 * whose alias the cursor is still sitting inside of (see
 * isAliasStillBeingTyped) — otherwise typing an alias manually right after a
 * table/view (e.g. "FROM dbo.Trade t|") would immediately offer "t.column"
 * completions for the very alias being composed, which makes no sense.
 */
export function collectAliasedTableReferences(
  documentText: string,
  cursorOffset?: number
): Array<{ tableName: string; alias: string }> {
  const refs: Array<{ tableName: string; alias: string }> = [];
  for (const ref of parseTableReferences(documentText)) {
    if (ref.alias && !isAliasStillBeingTyped(ref, cursorOffset)) {
      refs.push({ tableName: ref.tableName, alias: ref.alias });
    }
  }
  return refs;
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
  // The qualifier may be a bracket-quoted identifier (e.g. "[dbo]." or
  // "[My Schema].") — brackets are stripped so callers compare against the
  // same bare names used everywhere else (schema/table names in the cache
  // are never bracketed).
  const match = /(?:(\[[^\]]+\]|[A-Za-z_][\w]*)\.)?(\w*)$/.exec(lineTextBeforeCursor);
  const matchStart = match?.index ?? lineTextBeforeCursor.length;
  const textBeforeMatch = lineTextBeforeCursor.slice(0, matchStart);
  const rawQualifier = match?.[1];
  return {
    wordPrefix: match?.[2] ?? '',
    qualifier: rawQualifier?.replace(/^\[|\]$/g, ''),
    isTableReferencePosition: /\b(?:FROM|JOIN)\s*$/i.test(textBeforeMatch),
  };
}

/**
 * Pure string-in/data-out. No vscode dependency — fully unit-testable
 * standalone, same style as contextParser.ts.
 */

/**
 * Splits a table name into "words" for alias derivation:
 *  - snake_case splits on underscores.
 *  - Otherwise splits on camelCase/PascalCase boundaries, keeping runs of
 *    capitals together (e.g. "HTTPServer" -> ["HTTP", "Server"]).
 *  - A name with no such boundaries (all-lowercase, all-uppercase, or a
 *    single already-lowercase word) comes back as a single "word" — the
 *    caller falls back to just its first letter in that case, which is the
 *    conventional single-letter alias SQL authors already reach for.
 */
function splitIntoWords(name: string): string[] {
  if (name.includes('_')) {
    return name.split('_').filter(Boolean);
  }
  const words = name.match(/[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z0-9]+|[A-Z]+/g);
  return words && words.length > 0 ? words : [name];
}

/**
 * Derives a short lowercase alias from a table/view name — first letter of
 * each detected word, e.g. "PilotTestTable" -> "ptt", "orderDetails" -> "od",
 * "order_items" -> "oi", "Orders" -> "o" (no word boundaries to split on).
 *
 * `existingAliases` (already used elsewhere in the same document,
 * case-insensitive) are avoided by appending "2", "3", ... until unique.
 */
export function suggestAlias(tableName: string, existingAliases: ReadonlySet<string> = new Set()): string {
  const bareName = tableName.split('.').pop() ?? tableName;
  const words = splitIntoWords(bareName).filter((w) => /[A-Za-z]/.test(w));
  const base = (words.length > 0 ? words.map((w) => w[0]) : [bareName[0] ?? 'a']).join('').toLowerCase();
  const candidate = base || 'a';

  const used = new Set(Array.from(existingAliases, (a) => a.toLowerCase()));
  if (!used.has(candidate)) return candidate;

  let suffix = 2;
  while (used.has(`${candidate}${suffix}`)) suffix++;
  return `${candidate}${suffix}`;
}

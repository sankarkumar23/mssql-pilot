const VALID_UNQUOTED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRACKET_QUOTED_IDENTIFIER = /^\[(?:[^\]]|\]\])+\]$/;

/**
 * Bracket-quotes a T-SQL identifier only when it actually needs it (spaces,
 * leading digit, special characters, ...) — labels stay plain/readable, but
 * inserted/rendered text must always be syntactically valid SQL on its own.
 */
export function quoteIdentifierIfNeeded(name: string): string {
  return VALID_UNQUOTED_IDENTIFIER.test(name) ? name : `[${name.replace(/\]/g, ']]')}]`;
}

export function unquoteIdentifierIfNeeded(name: string): string {
  return BRACKET_QUOTED_IDENTIFIER.test(name) ? name.slice(1, -1).replace(/\]\]/g, ']') : name;
}

/**
 * Splits a multipart identifier on dots that are OUTSIDE bracket-quoted
 * segments, so "[foo.bar].Baz" becomes ["[foo.bar]", "Baz"].
 */
export function splitMultipartIdentifier(identifier: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inBrackets = false;

  for (let i = 0; i < identifier.length; i++) {
    const ch = identifier[i];
    if (ch === '[' && !inBrackets) {
      inBrackets = true;
      current += ch;
      continue;
    }
    if (ch === ']' && inBrackets) {
      if (identifier[i + 1] === ']') {
        current += ']]';
        i++;
        continue;
      }
      inBrackets = false;
      current += ch;
      continue;
    }
    if (ch === '.' && !inBrackets) {
      const trimmed = current.trim();
      if (trimmed.length > 0) segments.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) segments.push(trimmed);
  return segments;
}

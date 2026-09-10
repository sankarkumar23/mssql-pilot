const VALID_UNQUOTED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Bracket-quotes a T-SQL identifier only when it actually needs it (spaces,
 * leading digit, special characters, ...) — labels stay plain/readable, but
 * inserted/rendered text must always be syntactically valid SQL on its own.
 */
export function quoteIdentifierIfNeeded(name: string): string {
  return VALID_UNQUOTED_IDENTIFIER.test(name) ? name : `[${name.replace(/\]/g, ']]')}]`;
}

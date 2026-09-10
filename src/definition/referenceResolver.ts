import { SchemaIndex } from '../cache/schemaIndex';
import { resolveByBareName } from '../cache/tableResolver';
import { SchemaObject } from '../cache/schemaTypes';
import { buildAliasMap, getCompletionContext } from '../completion/contextParser';

export type ResolvedReference =
  | { kind: 'object'; target: SchemaObject }
  | { kind: 'column'; target: SchemaObject; columnName: string };

/**
 * Resolves whatever identifier is under the cursor for go-to-definition —
 * reuses the exact same completion-context parsing and schema-resolution
 * logic completions already use (getCompletionContext, buildAliasMap,
 * resolveByBareName), just evaluated with the "cursor" placed at the END of
 * the hovered word instead of wherever it's actually blinking. That single
 * trick means a fully-typed reference (which is all F12 ever sees — nothing
 * mid-typed) parses identically to a completion request typed up to that
 * same point, with zero new parsing code.
 *
 * `textUpToWordEnd` is the current line's text truncated right after the
 * hovered word. `word` is that word itself. Deliberately no cursorOffset is
 * passed to buildAliasMap — its "exclude an alias still being typed" logic
 * is a completion-time concern (don't self-suggest a mid-typed alias); go-to-
 * definition only ever sees an already-fully-typed reference, including one
 * the cursor happens to sit at the tail end of, which must still resolve.
 */
export function resolveReferenceAtWord(
  documentText: string,
  textUpToWordEnd: string,
  word: string,
  index: SchemaIndex
): ResolvedReference | undefined {
  if (!word) return undefined;

  const ctx = getCompletionContext(textUpToWordEnd);
  const aliasMap = buildAliasMap(documentText);

  if (ctx.qualifier) {
    // "alias.word" — a table alias already in scope, so "word" names a column.
    const aliasedTableName = aliasMap.get(ctx.qualifier.toLowerCase());
    if (aliasedTableName) {
      const target = resolveByBareName(index, aliasedTableName);
      if (target) return { kind: 'column', target, columnName: word };
    }
    // Not a known alias — treat the qualifier as a schema name instead
    // (e.g. "dbo.Orders", "EXEC dbo.MyProc", "SELECT dbo.MyFunc()").
    const target = resolveByBareName(index, `${ctx.qualifier}.${word}`);
    return target ? { kind: 'object', target } : undefined;
  }

  // Bare word: either a table alias on its own (jump to the whole table),
  // or a schema-less table/view/routine reference.
  const aliasedTableName = aliasMap.get(word.toLowerCase());
  if (aliasedTableName) {
    const target = resolveByBareName(index, aliasedTableName);
    if (target) return { kind: 'object', target };
  }

  const target = resolveByBareName(index, word);
  return target ? { kind: 'object', target } : undefined;
}

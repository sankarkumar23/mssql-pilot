import { SchemaObject } from './schemaTypes';
import { SchemaIndex } from './schemaIndex';
import { splitMultipartIdentifier, unquoteIdentifierIfNeeded } from '../utils/sqlIdentifier';

const DEFAULT_SCHEMA = 'dbo';

/**
 * Resolves a FROM/JOIN/EXEC-style reference (as written — possibly
 * schema-qualified) to its cached SchemaObject. When the reference names an
 * explicit schema, that schema is honored exactly — it never falls back to a
 * same-named object in a different schema, which would silently resolve to
 * the wrong columns/signature.
 *
 * A schema-less reference is genuinely ambiguous when the same name exists in
 * more than one schema — SQL Server itself resolves it via the connection's
 * default schema, which is "dbo" for the overwhelming majority of logins, so
 * a "dbo" candidate is preferred when there is one. This is a heuristic, not
 * a guarantee: a login with a non-dbo default schema can still see the wrong
 * object suggested here.
 *
 * Shared by completion (itemBuilder) and go-to-definition (definitionProvider)
 * so both features resolve schema/name ambiguity identically.
 */
export function resolveByBareName(index: SchemaIndex, referenceName: string): SchemaObject | undefined {
  const segments = splitMultipartIdentifier(referenceName).map(unquoteIdentifierIfNeeded);
  const bareName = segments.pop()?.toLowerCase();
  if (!bareName) return undefined;
  const candidates = index.byName.get(bareName);
  if (!candidates) return undefined;

  const schema = segments.pop()?.toLowerCase();
  if (schema) {
    return candidates.find((c) => c.schema.toLowerCase() === schema);
  }

  return candidates.find((c) => c.schema.toLowerCase() === DEFAULT_SCHEMA) ?? candidates[0];
}

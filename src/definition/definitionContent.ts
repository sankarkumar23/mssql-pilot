import { ColumnInfo, RoutineInfo, TableInfo, ViewInfo } from '../cache/schemaTypes';
import { CheckConstraintInfo, DependentViewInfo, ForeignKeyInfo, IndexInfo } from '../cache/schemaQueries';
import { quoteIdentifierIfNeeded } from '../utils/sqlIdentifier';

export interface FormattedDefinition {
  text: string;
  /** Lowercased column name -> its 0-indexed line number in `text`, for jump-to-column. */
  columnLines: Map<string, number>;
}

export type DependentViewsState = DependentViewInfo[] | 'loading' | 'unavailable';

/**
 * Live-fetched, on-demand only — never part of the bulk cache (see
 * schemaQueries.ts). `dependentViews` is fetched separately from the rest
 * (see definitionProvider.ts) since it's the one query slow enough on huge
 * schemas to be worth not blocking on — 'loading' renders a placeholder that
 * a later content update replaces once the real fetch resolves.
 */
export interface TableExtras {
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  checkConstraints: CheckConstraintInfo[];
  dependentViews: DependentViewsState;
}

function qualifiedName(schema: string, name: string): string {
  return `${quoteIdentifierIfNeeded(schema)}.${quoteIdentifierIfNeeded(name)}`;
}

function formatIndexColumns(columns: IndexInfo['columns']): string {
  return columns.map((c) => `${quoteIdentifierIfNeeded(c.name)}${c.isDescending ? ' DESC' : ''}`).join(', ');
}

const DOUBLED_LENGTH_TYPES = new Set(['nvarchar', 'nchar']);
const LENGTH_TYPES = new Set(['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary']);
const PRECISION_TYPES = new Set(['decimal', 'numeric']);

function formatColumnType(col: ColumnInfo): string {
  const type = col.dataType.toLowerCase();
  if (LENGTH_TYPES.has(type) && col.maxLength !== null) {
    if (col.maxLength === -1) return `${col.dataType}(MAX)`;
    const len = DOUBLED_LENGTH_TYPES.has(type) ? col.maxLength / 2 : col.maxLength;
    return `${col.dataType}(${len})`;
  }
  if (PRECISION_TYPES.has(type)) {
    return `${col.dataType}(${col.precision},${col.scale})`;
  }
  return col.dataType;
}

/**
 * Indexes/PK, foreign keys, check constraints, and dependent views, rendered
 * as trailing `ALTER TABLE`/`CREATE INDEX` statements plus a comment block —
 * shared by tables and views (an indexed view can have its own indexes, and
 * either kind can have views built on top of it; only foreign keys and check
 * constraints are table-only in practice, and simply come back empty for a
 * view, so nothing extra is needed to special-case that here).
 */
function formatExtrasSection(schema: string, name: string, extras: TableExtras): string[] {
  const lines: string[] = [];
  const qName = qualifiedName(schema, name);

  const pk = extras.indexes.find((idx) => idx.isPrimaryKey);
  if (pk) {
    lines.push('');
    lines.push(`ALTER TABLE ${qName} ADD CONSTRAINT ${quoteIdentifierIfNeeded(pk.name)} PRIMARY KEY (${formatIndexColumns(pk.columns)});`);
  }
  for (const idx of extras.indexes) {
    if (idx.isPrimaryKey) continue;
    lines.push('');
    if (idx.isUniqueConstraint) {
      lines.push(`ALTER TABLE ${qName} ADD CONSTRAINT ${quoteIdentifierIfNeeded(idx.name)} UNIQUE (${formatIndexColumns(idx.columns)});`);
    } else {
      const keyword = idx.isUnique ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX';
      const disabled = idx.isDisabled ? ' -- disabled' : '';
      lines.push(`${keyword} ${quoteIdentifierIfNeeded(idx.name)} ON ${qName} (${formatIndexColumns(idx.columns)});${disabled}`);
    }
  }
  for (const fk of extras.foreignKeys) {
    lines.push('');
    const cols = fk.columns.map((c) => quoteIdentifierIfNeeded(c.column)).join(', ');
    const refTable = qualifiedName(fk.columns[0]?.referencedSchema ?? '', fk.columns[0]?.referencedTable ?? '');
    const refCols = fk.columns.map((c) => quoteIdentifierIfNeeded(c.referencedColumn)).join(', ');
    lines.push(`ALTER TABLE ${qName} ADD CONSTRAINT ${quoteIdentifierIfNeeded(fk.name)} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols});`);
  }
  for (const chk of extras.checkConstraints) {
    lines.push('');
    const disabled = chk.isDisabled ? ' -- disabled' : '';
    lines.push(`ALTER TABLE ${qName} ADD CONSTRAINT ${quoteIdentifierIfNeeded(chk.name)} CHECK (${chk.definition ?? ''});${disabled}`);
  }
  if (extras.dependentViews === 'loading') {
    lines.push('');
    lines.push('-- Checking for dependent views…');
  } else if (extras.dependentViews === 'unavailable') {
    lines.push('');
    lines.push('-- Dependent views unavailable (lookup failed or timed out).');
  } else if (extras.dependentViews.length > 0) {
    lines.push('');
    lines.push(`-- Views depending on ${qName}:`);
    for (const view of extras.dependentViews) {
      lines.push(`--   ${qualifiedName(view.schema, view.name)}`);
    }
  } else {
    lines.push('');
    lines.push(`-- No dependent views found for ${qName}.`);
  }
  return lines;
}

/**
 * Renders a table's cached columns as a readable, CREATE-TABLE-shaped
 * listing — NOT authoritative DDL on its own. `extras` (indexes/PK, foreign
 * keys, check constraints, dependent views), when given, is a live fetch
 * done just for this call (see schemaQueries.ts) — never part of the bulk
 * cache. Without it, this falls back to the cache-only per-column PRIMARY
 * KEY marker and says so explicitly, rather than silently pretending
 * nothing else exists.
 */
export function formatTableDefinition(obj: TableInfo, extras?: TableExtras): FormattedDefinition {
  const lines: string[] = [];
  const qName = qualifiedName(obj.schema, obj.name);
  if (extras) {
    lines.push('-- MSSQL Pilot · columns from cache; indexes/keys/constraints fetched live from the connected database just now');
  } else {
    lines.push('-- MSSQL Pilot · cached schema snapshot, not live DDL');
    lines.push('-- indexes, foreign keys, and check constraints are not shown here (no live connection, or the fetch failed)');
  }
  lines.push(`-- ${qName} (table)`);
  lines.push(`CREATE TABLE ${qName} (`);

  const columnLines = new Map<string, number>();
  obj.columns.forEach((col, i) => {
    const parts = [quoteIdentifierIfNeeded(col.name), formatColumnType(col)];
    if (col.isIdentity) parts.push('IDENTITY');
    parts.push(col.isNullable ? 'NULL' : 'NOT NULL');
    // A real (possibly composite) PK constraint from `extras` is rendered
    // separately below; the plain cache-only PK flag is only a stand-in
    // for when that live data isn't available.
    if (!extras && col.isPrimaryKey) parts.push('PRIMARY KEY');
    if (col.defaultDefinition) parts.push(`DEFAULT ${col.defaultDefinition}`);
    const suffix = i < obj.columns.length - 1 ? ',' : '';
    lines.push(`    ${parts.join(' ')}${suffix}`);
    columnLines.set(col.name.toLowerCase(), lines.length - 1);
  });

  lines.push(');');
  if (extras) lines.push(...formatExtrasSection(obj.schema, obj.name, extras));

  return { text: lines.join('\n') + '\n', columnLines };
}

/**
 * A view has no meaningful "CREATE TABLE"-shaped rendering — its real
 * definition is the SELECT that backs it, which (unlike a table) SQL Server
 * actually stores and OBJECT_DEFINITION() can fetch live, the same way
 * routine bodies are fetched. `bodyText` is that live fetch's result; null
 * when there's no connection or the fetch failed, in which case this falls
 * back to a plain cached column listing rather than fabricating a fake
 * CREATE TABLE for something that was never one.
 */
export function formatViewDefinition(view: ViewInfo, bodyText: string | null, extras?: TableExtras): FormattedDefinition {
  const lines: string[] = [];
  const qName = qualifiedName(view.schema, view.name);
  const live = bodyText !== null;

  lines.push(
    live
      ? '-- MSSQL Pilot · live definition, fetched from the connected database just now'
      : '-- MSSQL Pilot · view body not fetched (no live connection, or the fetch failed) — cached columns only'
  );
  lines.push(`-- ${qName}`);
  lines.push('');

  if (live) {
    lines.push(bodyText.trim());
    lines.push('');
    lines.push('-- Columns (cached):');
  }

  const columnLines = new Map<string, number>();
  const prefix = live ? '--   ' : '-- ';
  view.columns.forEach((col) => {
    const nullability = col.isNullable ? '' : ' NOT NULL';
    lines.push(`${prefix}${quoteIdentifierIfNeeded(col.name)} ${formatColumnType(col)}${nullability}`);
    columnLines.set(col.name.toLowerCase(), lines.length - 1);
  });

  if (extras) lines.push(...formatExtrasSection(view.schema, view.name, extras));

  return { text: lines.join('\n') + '\n', columnLines };
}

/** Parameter names (@Foo) are never bracket-quoted in T-SQL — quoting applies to identifiers, not parameter references. */
function formatParameters(routine: RoutineInfo): string {
  return routine.parameters
    .map((p) => `    ${p.name} ${p.dataType}${p.isOutput ? ' OUTPUT' : ''}${p.hasDefault ? ' = <default>' : ''}`)
    .join(',\n');
}

/** Signature only — used when the live body fetch fails or there's no active connection. */
export function formatRoutineStub(routine: RoutineInfo): string {
  const lines: string[] = [];
  const qName = qualifiedName(routine.schema, routine.name);
  lines.push('-- MSSQL Pilot · signature only, from cache — body not fetched (no live connection, or the fetch failed)');
  lines.push(`-- ${qName}`);
  const keyword = routine.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION';
  lines.push(`CREATE ${keyword} ${qName}`);
  if (routine.parameters.length > 0) {
    lines.push('(');
    lines.push(formatParameters(routine));
    lines.push(')');
  }
  if (routine.returnType) lines.push(`RETURNS ${routine.returnType}`);
  lines.push('AS');
  lines.push('-- body unavailable');
  return lines.join('\n') + '\n';
}

/** The real body text, fetched live from the connected database at F12 time. */
export function formatRoutineBody(routine: RoutineInfo, bodyText: string): string {
  const lines: string[] = [];
  lines.push('-- MSSQL Pilot · live definition, fetched from the connected database just now');
  lines.push(`-- ${qualifiedName(routine.schema, routine.name)}`);
  lines.push('');
  lines.push(bodyText.trim());
  return lines.join('\n') + '\n';
}

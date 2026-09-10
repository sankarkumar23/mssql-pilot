import * as vscode from 'vscode';
import { DatabaseSchemaCache, SchemaObject, ColumnInfo, RoutineInfo } from '../cache/schemaTypes';
import { getSchemaIndex, SchemaIndex } from '../cache/schemaIndex';
import { resolveByBareName } from '../cache/tableResolver';
import { buildAliasMap, collectAliasedTableReferences, collectUsedAliases, getCompletionContext } from './contextParser';
import { suggestAlias } from './aliasSuggester';
import { shouldAddNewLineAfterTableAlias } from '../utils/config';
import { quoteIdentifierIfNeeded } from '../utils/sqlIdentifier';

/** Kinds that make sense as a `FROM`/`JOIN` source, and so can sensibly carry a suggested alias. */
const ALIASABLE_KINDS = new Set<SchemaObject['kind']>(['table', 'view', 'tableFunction']);

function kindLabel(kind: SchemaObject['kind']): string {
  switch (kind) {
    case 'table': return 'table';
    case 'view': return 'view';
    case 'procedure': return 'procedure';
    case 'scalarFunction': return 'scalar function';
    case 'tableFunction': return 'table-valued function';
    default: return kind;
  }
}

function kindToVscodeKind(kind: SchemaObject['kind']): vscode.CompletionItemKind {
  switch (kind) {
    case 'table': return vscode.CompletionItemKind.Struct;
    case 'view': return vscode.CompletionItemKind.Interface;
    case 'procedure': return vscode.CompletionItemKind.Method;
    case 'scalarFunction':
    case 'tableFunction':
      return vscode.CompletionItemKind.Function;
    default:
      return vscode.CompletionItemKind.Text;
  }
}


function docForColumn(col: ColumnInfo): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${col.name}**\n\n`);
  md.appendMarkdown(`- Type: \`${col.dataType}\`${col.maxLength !== null ? ` (${col.maxLength})` : ''}\n`);
  md.appendMarkdown(`- Nullable: ${col.isNullable ? 'yes' : 'no'}\n`);
  if (col.isIdentity) md.appendMarkdown('- Identity column\n');
  if (col.isPrimaryKey) md.appendMarkdown('- Primary key\n');
  if (col.defaultDefinition) md.appendMarkdown(`- Default: \`${col.defaultDefinition}\`\n`);
  return md;
}

function docForRoutine(routine: RoutineInfo): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${routine.schema}.${routine.name}**\n\n`);
  if (routine.returnType) {
    md.appendMarkdown(`Returns: \`${routine.returnType}\`\n\n`);
  }
  if (routine.parameters.length > 0) {
    md.appendMarkdown('Parameters:\n');
    for (const p of routine.parameters) {
      md.appendMarkdown(`- \`${p.name}\` ${p.dataType}${p.isOutput ? ' OUTPUT' : ''}${p.hasDefault ? ' = default' : ''}\n`);
    }
  }
  return md;
}

/** Bare label only — type/nullability/identity/PK/default all live in docForColumn's expanded panel instead. */
function detailForColumn(): string {
  return 'MSSQL Pilot · column';
}

/**
 * Called only once the schema is already resolved (browsing is schema-first —
 * see buildCompletionItems), so both the label and the inserted text are just
 * the bare object name, not "schema.name" — the schema is already typed.
 *
 * `aliasSuggestion`, when given, is appended as a snippet placeholder — the
 * alias is pre-filled but stays selected, so accepting the completion as-is
 * takes the alias, and just continuing to type overwrites it.
 */
function buildObjectItem(obj: SchemaObject, aliasSuggestion?: string): vscode.CompletionItem {
  const baseText = quoteIdentifierIfNeeded(obj.name);
  const item = new vscode.CompletionItem(obj.name, kindToVscodeKind(obj.kind));
  item.detail = `MSSQL Pilot · ${kindLabel(obj.kind)}`;
  if (aliasSuggestion) {
    const snippet = new vscode.SnippetString();
    snippet.appendText(`${baseText} `);
    snippet.appendPlaceholder(aliasSuggestion);
    if (shouldAddNewLineAfterTableAlias()) {
      snippet.appendText('\n');
      snippet.appendTabstop(0); // explicit final cursor position — don't rely on the implicit end-of-snippet default
    }
    item.insertText = snippet;
  } else {
    item.insertText = baseText;
  }
  if (obj.kind !== 'table' && obj.kind !== 'view') {
    item.documentation = docForRoutine(obj);
  }
  return item;
}

function buildColumnItem(col: ColumnInfo): vscode.CompletionItem {
  const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
  item.insertText = quoteIdentifierIfNeeded(col.name);
  item.detail = detailForColumn();
  item.documentation = docForColumn(col);
  return item;
}

/** Column completion pre-qualified with a table alias already in scope, e.g. "o.OrderId". */
function buildAliasColumnItem(alias: string, col: ColumnInfo): vscode.CompletionItem {
  const item = new vscode.CompletionItem(`${alias}.${col.name}`, vscode.CompletionItemKind.Field);
  item.insertText = `${quoteIdentifierIfNeeded(alias)}.${quoteIdentifierIfNeeded(col.name)}`;
  item.detail = detailForColumn();
  item.documentation = docForColumn(col);
  return item;
}

/** Distinct schema names only — selecting one, then typing ".", narrows to that schema's objects (see below). */
function buildSchemaItem(schema: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(schema, vscode.CompletionItemKind.Module);
  item.detail = 'MSSQL Pilot · schema';
  item.insertText = quoteIdentifierIfNeeded(schema);
  return item;
}

function columnsOf(obj: SchemaObject): ColumnInfo[] {
  if (obj.kind === 'table' || obj.kind === 'view') return obj.columns;
  return obj.tableColumns ?? [];
}

/**
 * When the query already joins aliased tables, a bare word typed outside a
 * FROM/JOIN clause (WHERE, ON, GROUP BY, ...) is almost always meant to
 * reference one of those tables' columns, not name a brand-new object —
 * suggesting alias.column beats listing every table in the database.
 */
function buildAliasedColumnCompletions(
  documentText: string,
  index: SchemaIndex,
  cursorOffset: number
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  for (const { tableName, alias } of collectAliasedTableReferences(documentText, cursorOffset)) {
    const target = resolveByBareName(index, tableName);
    if (!target) continue;
    for (const col of columnsOf(target)) {
      items.push(buildAliasColumnItem(alias, col));
    }
  }
  return items;
}

/**
 * Pure, synchronous: DatabaseSchemaCache + document/position -> completion items.
 * No I/O, no awaiting — this is what keeps the completion provider instant.
 */
export function buildCompletionItems(
  cache: DatabaseSchemaCache,
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {
  const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
  const ctx = getCompletionContext(lineTextBeforeCursor);
  const index = getSchemaIndex(cache);
  const documentText = document.getText();
  const cursorOffset = document.offsetAt(position);

  // Suggest an alias only when directly naming a table/view/TVF right after
  // FROM/JOIN (cheap regex check, same spirit as buildAliasMap — not a full
  // tokenizer, that's still deferred to v1.1).
  const usedAliases = ctx.isTableReferencePosition ? collectUsedAliases(documentText, cursorOffset) : undefined;
  const aliasFor = (o: SchemaObject): string | undefined =>
    usedAliases && ALIASABLE_KINDS.has(o.kind) ? suggestAlias(o.name, usedAliases) : undefined;

  if (!ctx.qualifier) {
    // Outside a FROM/JOIN clause, a joined query's own aliases make far more
    // useful suggestions than every table in the database (e.g. typing a
    // bare word in WHERE/ON/GROUP BY after "FROM dbo.Orders o JOIN ... c").
    // This must exclude an alias the cursor is still typing right now (e.g.
    // "FROM dbo.Trade t|" naming the alias manually) — otherwise it offers
    // nonsensical "t.column" completions for the very alias being composed.
    if (!ctx.isTableReferencePosition) {
      const aliasColumnItems = buildAliasedColumnCompletions(documentText, index, cursorOffset);
      if (aliasColumnItems.length > 0) return aliasColumnItems;
    }
    // Resolve the schema first, then its objects — with many schemas in the
    // database, a flat list of every table across every schema at once is
    // unusable. Typing "." after a schema name (handled below) narrows to
    // that schema's objects.
    return index.schemas.map(buildSchemaItem);
  }

  const qualifierLower = ctx.qualifier.toLowerCase();

  // Schema-name match takes precedence over alias/table match when ambiguous —
  // "dbo." is a far more common typing pattern than a one-letter alias that
  // happens to collide with a schema name.
  const schemaMatches = index.bySchema.get(qualifierLower);
  if (schemaMatches && schemaMatches.length > 0) {
    return schemaMatches.map((o) => buildObjectItem(o, aliasFor(o)));
  }

  // "FROM dbo.Trade p." right after finishing "p" — "p" is a real, finished
  // alias, but "alias.column" is never valid syntax inside the very FROM/JOIN
  // clause that declared it (only after, in WHERE/ON/SELECT/...). Nothing
  // sensible to suggest here.
  if (ctx.qualifierJustDeclared) return [];

  const aliasMap = buildAliasMap(documentText, cursorOffset);
  const resolvedTableName = aliasMap.get(qualifierLower);
  const target = resolvedTableName
    ? resolveByBareName(index, resolvedTableName)
    : index.byName.get(qualifierLower)?.[0];

  if (!target) return [];
  return columnsOf(target).map(buildColumnItem);
}

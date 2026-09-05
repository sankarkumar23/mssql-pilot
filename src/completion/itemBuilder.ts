import * as vscode from 'vscode';
import { DatabaseSchemaCache, SchemaObject, ColumnInfo, RoutineInfo } from '../cache/schemaTypes';
import { buildAliasMap, getCompletionContext } from './contextParser';

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

function objectLabel(obj: SchemaObject): string {
  return `${obj.schema}.${obj.name}`;
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

function detailForColumn(col: ColumnInfo): string {
  const extras = [col.isIdentity ? 'IDENTITY' : null, col.isPrimaryKey ? 'PK' : null].filter(Boolean).join(', ');
  const nullability = col.isNullable ? 'NULL' : 'NOT NULL';
  return `MSSQL Pilot · column (${col.dataType}, ${nullability}${extras ? ', ' + extras : ''})`;
}

function buildObjectItem(obj: SchemaObject): vscode.CompletionItem {
  const item = new vscode.CompletionItem(objectLabel(obj), kindToVscodeKind(obj.kind));
  item.detail = `MSSQL Pilot · ${kindLabel(obj.kind)}`;
  item.insertText = objectLabel(obj);
  if (obj.kind !== 'table' && obj.kind !== 'view') {
    item.documentation = docForRoutine(obj);
  }
  return item;
}

function buildColumnItem(col: ColumnInfo): vscode.CompletionItem {
  const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
  item.detail = detailForColumn(col);
  item.documentation = docForColumn(col);
  return item;
}

function columnsOf(obj: SchemaObject): ColumnInfo[] {
  if (obj.kind === 'table' || obj.kind === 'view') return obj.columns;
  return obj.tableColumns ?? [];
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
  const objects = Object.values(cache.objects);

  if (!ctx.qualifier) {
    // Always-on schema-qualified object name completion — no FROM/JOIN clause
    // awareness in v1 (deferred to v1.1; needs a real tokenizer to do properly).
    return objects.map(buildObjectItem);
  }

  const qualifierLower = ctx.qualifier.toLowerCase();

  // Schema-name match takes precedence over alias/table match when ambiguous —
  // "dbo." is a far more common typing pattern than a one-letter alias that
  // happens to collide with a schema name.
  const schemaMatches = objects.filter((o) => o.schema.toLowerCase() === qualifierLower);
  if (schemaMatches.length > 0) {
    return schemaMatches.map(buildObjectItem);
  }

  const aliasMap = buildAliasMap(document.getText());
  const resolvedTableName = aliasMap.get(qualifierLower);
  const target = resolvedTableName
    ? objects.find((o) => o.name.toLowerCase() === (resolvedTableName.split('.').pop() ?? '').toLowerCase())
    : objects.find((o) => o.name.toLowerCase() === qualifierLower);

  if (!target) return [];
  return columnsOf(target).map(buildColumnItem);
}

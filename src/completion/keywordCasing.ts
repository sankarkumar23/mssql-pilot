/**
 * Pure string-in/data-out logic for uppercasing SQL keywords as they're
 * typed. No vscode dependency — fully unit-testable standalone.
 */

/**
 * T-SQL reserved keywords (per Microsoft's reserved-keywords list). Being
 * reserved means these can never legitimately be an unquoted identifier, so
 * uppercasing one is always safe on its own — the remaining risk is a
 * schema/alias-qualified reference (e.g. "dbo.key") or one sitting inside a
 * string/bracket/comment, both guarded against below.
 */
const RESERVED_KEYWORDS = new Set([
  'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'AUTHORIZATION', 'BACKUP', 'BEGIN',
  'BETWEEN', 'BREAK', 'BROWSE', 'BULK', 'BY', 'CASCADE', 'CASE', 'CHECK', 'CHECKPOINT',
  'CLOSE', 'CLUSTERED', 'COALESCE', 'COLLATE', 'COLUMN', 'COMMIT', 'COMPUTE', 'CONSTRAINT',
  'CONTAINS', 'CONTAINSTABLE', 'CONTINUE', 'CONVERT', 'CREATE', 'CROSS', 'CURRENT',
  'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR', 'DATABASE',
  'DBCC', 'DEALLOCATE', 'DECLARE', 'DEFAULT', 'DELETE', 'DENY', 'DESC', 'DISK', 'DISTINCT',
  'DISTRIBUTED', 'DOUBLE', 'DROP', 'DUMP', 'ELSE', 'END', 'ERRLVL', 'ESCAPE', 'EXCEPT',
  'EXEC', 'EXECUTE', 'EXISTS', 'EXIT', 'EXTERNAL', 'FETCH', 'FILE', 'FILLFACTOR', 'FOR',
  'FOREIGN', 'FREETEXT', 'FREETEXTTABLE', 'FROM', 'FULL', 'FUNCTION', 'GOTO', 'GRANT',
  'GROUP', 'HAVING', 'HOLDLOCK', 'IDENTITY', 'IDENTITY_INSERT', 'IDENTITYCOL', 'IF', 'IN',
  'INDEX', 'INNER', 'INSERT', 'INTERSECT', 'INTO', 'IS', 'JOIN', 'KEY', 'KILL', 'LEFT',
  'LIKE', 'LINENO', 'LOAD', 'MERGE', 'NATIONAL', 'NOCHECK', 'NONCLUSTERED', 'NOT', 'NULL',
  'NULLIF', 'OF', 'OFF', 'OFFSETS', 'ON', 'OPEN', 'OPENDATASOURCE', 'OPENQUERY',
  'OPENROWSET', 'OPENXML', 'OPTION', 'OR', 'ORDER', 'OUTER', 'OVER', 'PERCENT', 'PIVOT',
  'PLAN', 'PRECISION', 'PRIMARY', 'PRINT', 'PROC', 'PROCEDURE', 'PUBLIC', 'RAISERROR',
  'READ', 'READTEXT', 'RECONFIGURE', 'REFERENCES', 'REPLICATION', 'RESTORE', 'RESTRICT',
  'RETURN', 'REVERT', 'REVOKE', 'RIGHT', 'ROLLBACK', 'ROWCOUNT', 'ROWGUIDCOL', 'RULE',
  'SAVE', 'SCHEMA', 'SECURITYAUDIT', 'SELECT', 'SEMANTICKEYPHRASETABLE',
  'SEMANTICSIMILARITYDETAILSTABLE', 'SEMANTICSIMILARITYTABLE', 'SESSION_USER', 'SET',
  'SETUSER', 'SHUTDOWN', 'SOME', 'STATISTICS', 'SYSTEM_USER', 'TABLE', 'TABLESAMPLE',
  'TEXTSIZE', 'THEN', 'TO', 'TOP', 'TRAN', 'TRANSACTION', 'TRIGGER', 'TRUNCATE',
  'TSEQUAL', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE', 'UPDATETEXT', 'USE', 'USER',
  'VALUES', 'VARYING', 'VIEW', 'WAITFOR', 'WHEN', 'WHERE', 'WHILE', 'WITH', 'WRITETEXT',
]);

type LexicalState = 'normal' | 'string' | 'bracket' | 'lineComment' | 'blockComment';

/**
 * True when `offset` falls inside a string literal, a bracket-quoted
 * identifier, or a comment — contexts where a keyword-looking word is never
 * an actual keyword. Scans from the start of the document every call; SQL
 * files are typically small and this only runs on a trigger keystroke, so
 * no caching is needed (same tradeoff as contextParser's per-request scans).
 */
function isInsideStringOrCommentOrBracket(text: string, offset: number): boolean {
  let i = 0;
  let state: LexicalState = 'normal';
  let blockDepth = 0;

  while (i < offset) {
    const c = text[i];
    const next = text[i + 1];

    switch (state) {
      case 'normal':
        if (c === "'") { state = 'string'; i += 1; }
        else if (c === '[') { state = 'bracket'; i += 1; }
        else if (c === '-' && next === '-') { state = 'lineComment'; i += 2; }
        else if (c === '/' && next === '*') { state = 'blockComment'; blockDepth = 1; i += 2; }
        else { i += 1; }
        break;

      case 'string':
        if (c === "'") {
          if (next === "'") { i += 2; } // '' — escaped quote, string continues
          else { state = 'normal'; i += 1; }
        } else {
          i += 1;
        }
        break;

      case 'bracket':
        if (c === ']') {
          if (next === ']') { i += 2; } // ]] — escaped bracket, identifier continues
          else { state = 'normal'; i += 1; }
        } else {
          i += 1;
        }
        break;

      case 'lineComment':
        if (c === '\n') state = 'normal';
        i += 1;
        break;

      case 'blockComment':
        // T-SQL block comments nest.
        if (c === '/' && next === '*') { blockDepth += 1; i += 2; }
        else if (c === '*' && next === '/') {
          blockDepth -= 1;
          i += 2;
          if (blockDepth === 0) state = 'normal';
        } else {
          i += 1;
        }
        break;
    }
  }

  return state !== 'normal';
}

export interface KeywordUppercaseEdit {
  start: number;
  end: number;
  newText: string;
}

/**
 * Given the full document text and the offset right after the word that was
 * just finished (i.e. right before the trigger character that was typed),
 * returns the edit that uppercases it if it's a reserved keyword needing
 * one, or undefined if there's nothing to do.
 */
export function computeKeywordUppercaseEdit(
  documentText: string,
  wordEndOffset: number
): KeywordUppercaseEdit | undefined {
  if (wordEndOffset <= 0 || wordEndOffset > documentText.length) return undefined;

  let start = wordEndOffset;
  while (start > 0 && /\w/.test(documentText[start - 1])) start--;

  const word = documentText.slice(start, wordEndOffset);
  if (!word) return undefined;

  const upper = word.toUpperCase();
  if (!RESERVED_KEYWORDS.has(upper) || word === upper) return undefined;

  // "dbo.key" / "o.key" — a qualified column or table reference, never a
  // real keyword usage, regardless of what the bare word happens to spell.
  if (documentText[start - 1] === '.') return undefined;

  if (isInsideStringOrCommentOrBracket(documentText, start)) return undefined;

  return { start, end: wordEndOffset, newText: upper };
}

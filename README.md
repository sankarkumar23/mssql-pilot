# MSSQL Pilot

Fast, persistent schema autocomplete for the [mssql](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) VS Code extension — built for databases with thousands of tables, views, and stored procedures.

## The problem

mssql's own IntelliSense is powered by a separate language-service process that keeps schema metadata purely in memory and rebuilds it from scratch on every new connection. On a large schema, that means every disconnect/reconnect pays a slow, full re-scan before autocomplete works again.

## What this extension does

MSSQL Pilot queries your schema itself (cheap `sys.*` catalog views — tables, views, columns, stored procedures, functions), persists it to disk per server+database, and serves it through its own autocomplete provider alongside mssql's own suggestions. The result:

- **Instant autocomplete after reconnecting** — loaded straight from disk, no waiting on a schema rebuild.
- **Background delta sync** — after the initial load, a lightweight sync catches up on anything that changed (including renames and deletions) without blocking your work.
- **Never blocks a query** — the completion provider never waits on a network call, not even on a cache miss.

## Go to Definition

Press **F12** (or **Alt+F1**, or right-click → **Go to Definition**, or **Alt+F12** to peek) on a table/view name, an `alias.Column` reference, or a procedure/function call, and Pilot opens a read-only definition for it — instantly, from the same schema cache that powers autocomplete:

- **Tables** — the cached column layout opens immediately from Pilot's in-memory schema cache; indexes, the primary key, foreign keys, check constraints, and dependent views are filled in afterward from the live database once available. Jumping via `alias.Column` lands directly on that column's line. Without a live connection, it stays on the cached column list alone.
- **Views** — jumping on the view name opens cached columns immediately, then patches in the live view body, indexes, the primary key, foreign keys, check constraints, and dependent views afterward from the connected database. Jumping on a specific view column still waits for the live body so the cursor can land on the right line.
- **Procedures/functions** — the real body text, fetched live over your existing connection. Falls back to a parameter-list-only signature if there's no connection or the fetch fails (e.g. an encrypted or CLR object).

F12 and Alt+F1 both trigger the same resolution — use whichever you prefer. Since mssql's own IntelliSense also registers a (often unreliable) definition provider for SQL files, and VS Code merges results from every provider on F12, you may occasionally see a two-item picker instead of jumping straight there if mssql's provider also returns something for the same reference; **Alt+F1 always goes straight to Pilot's own result.**

## Commands

- `MSSQL Pilot: Go to Definition`
- `MSSQL Pilot: Resync Schema Cache (Current Database)`
- `MSSQL Pilot: Resync Schema Cache (All Cached Databases)`
- `MSSQL Pilot: Clear Schema Cache (Current Database)`
- `MSSQL Pilot: Clear Schema Cache (All Databases)`
- `MSSQL Pilot: Show Schema Cache Status`

## Settings

| Setting | Default | Description |
|---|---|---|
| `mssqlPilot.enable` | `true` | Master switch for background schema caching and the autocomplete provider |
| `mssqlPilot.syncThrottleSeconds` | `30` | Minimum seconds between background sync attempts for the same server+database |
| `mssqlPilot.pollIntervalSeconds` | `5` | How often to check whether the active editor's connection/database changed |
| `mssqlPilot.maxObjectsPerFirstSync` | `20000` | Safety cap on objects fetched during a database's very first full sync (0 = no cap) |
| `mssqlPilot.enableCompletionProvider` | `true` | Show MSSQL Pilot suggestions alongside mssql's own IntelliSense |
| `mssqlPilot.excludedSchemas` | `["sys","INFORMATION_SCHEMA"]` | Extra schemas to exclude from caching |
| `mssqlPilot.newLineAfterTableAlias` | `false` | After accepting a suggested table alias, drop to a new line for the next clause |
| `mssqlPilot.uppercaseKeywordsOnType` | `false` | Automatically uppercase T-SQL reserved keywords as you finish typing them. Also requires VS Code's own `editor.formatOnType` to be enabled (off by default) — otherwise this setting has no effect |

## Known limitations

- **Old-style comma-separated joins** (`FROM dbo.A a, dbo.B b`) aren't recognized — only `FROM`/`JOIN` keyword-prefixed table references are parsed for alias/column suggestions. Use ANSI `JOIN` syntax for alias-aware completions.
- **No batch/statement boundary awareness** — aliases are resolved by scanning the whole open document, not just the current `GO`-separated batch or statement. In a file with multiple unrelated queries, an alias from an earlier query could theoretically be suggested in a later one if it happens to reuse the same alias letter.
- **Schema-less table references are a best-effort guess when a name is ambiguous** — if the same table name exists in more than one schema (e.g. `dbo.Orders` and `sales.Orders`) and the query references it without a schema (`FROM Orders o`), Pilot prefers the `dbo` copy if one exists, otherwise falls back to whichever match was cached first. This can differ from what SQL Server itself resolves to for logins whose default schema isn't `dbo`. Qualify the table with its schema (`FROM sales.Orders o`) to get exact, unambiguous column suggestions.

## Privacy

MSSQL Pilot reads structure only — table/view/column/procedure/parameter metadata — never your data or query results. It asks for consent once, the first time it would run a background query, before doing anything.

## Building

```bash
npm install
npm run compile
npm test
npm run package
npm install -g @vscode/vsce
vsce package --no-dependencies
code --install-extension mssql-pilot-1.1.2.vsix --force
```

## Requirements

Requires the [mssql](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension (`ms-mssql.mssql`) to be installed.

## License

MIT

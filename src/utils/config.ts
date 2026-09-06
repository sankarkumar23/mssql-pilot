import * as vscode from 'vscode';

const SECTION = 'mssqlPilot';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function isFeatureEnabled(): boolean {
  return cfg().get<boolean>('enable', true);
}

export function isCompletionProviderEnabled(): boolean {
  return cfg().get<boolean>('enableCompletionProvider', true);
}

export function getSyncThrottleMs(): number {
  return cfg().get<number>('syncThrottleSeconds', 30) * 1000;
}

export function getPollIntervalMs(): number {
  return cfg().get<number>('pollIntervalSeconds', 5) * 1000;
}

export function getMaxObjectsPerFirstSync(): number {
  return cfg().get<number>('maxObjectsPerFirstSync', 20000);
}

export function getExcludedSchemas(): string[] {
  return cfg().get<string[]>('excludedSchemas', ['sys', 'INFORMATION_SCHEMA']);
}

export function shouldAddNewLineAfterTableAlias(): boolean {
  return cfg().get<boolean>('newLineAfterTableAlias', false);
}

export function shouldUppercaseKeywordsOnType(): boolean {
  return cfg().get<boolean>('uppercaseKeywordsOnType', false);
}

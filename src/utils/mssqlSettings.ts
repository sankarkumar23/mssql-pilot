import * as vscode from 'vscode';
import { log } from './outputChannel';

const MSSQL_SECTION = 'mssql';

interface MssqlBooleanSetting {
  key: string;
  noticeShownKey: string;
  disabledNotice: string;
}

const ERROR_CHECKING: MssqlBooleanSetting = {
  key: 'intelliSense.enableErrorChecking',
  noticeShownKey: 'mssql-pilot.errorCheckingDisabledNoticeShown',
  disabledNotice:
    'MSSQL Pilot turned off mssql\'s IntelliSense error checking ' +
    '(mssql.intelliSense.enableErrorChecking, applies to all SQL editors) — its stale-cache ' +
    '"Invalid object name" warnings after a DDL change are avoided this way. ' +
    'Re-enable it anytime in Settings if you want mssql\'s own error checking back.',
};

const SUGGESTIONS: MssqlBooleanSetting = {
  key: 'intelliSense.enableSuggestions',
  noticeShownKey: 'mssql-pilot.suggestionsDisabledNoticeShown',
  disabledNotice:
    'MSSQL Pilot turned off mssql\'s own autocomplete suggestions ' +
    '(mssql.intelliSense.enableSuggestions, applies to all SQL editors) to stop duplicate/stale ' +
    'entries showing up alongside MSSQL Pilot\'s own suggestions. ' +
    'Re-enable it anytime in Settings if you want mssql\'s own suggestions back.',
};

/**
 * mssql's own IntelliSense (suggestions + error checking) is driven by its
 * own private, in-memory binding cache, which only mssql's own cache rebuild
 * can update — MSSQL Pilot's schema cache has no way to reach it. Alongside
 * MSSQL Pilot's own (accurate, disk-backed) completions, that mostly just
 * produces stale/duplicate suggestions and false-positive error squigglies,
 * so we turn each off globally on activation. This is a one-time nudge, not
 * an enforced setting — if it's found already off, nothing is written.
 */
async function ensureMssqlSettingDisabled(
  context: vscode.ExtensionContext,
  setting: MssqlBooleanSetting
): Promise<void> {
  const mssqlConfig = vscode.workspace.getConfiguration(MSSQL_SECTION);
  const current = mssqlConfig.get<boolean>(setting.key, true);
  if (current === false) return;

  await mssqlConfig.update(setting.key, false, vscode.ConfigurationTarget.Global);
  log(`[settings] disabled ${MSSQL_SECTION}.${setting.key} globally`);

  if (!context.globalState.get<boolean>(setting.noticeShownKey, false)) {
    await context.globalState.update(setting.noticeShownKey, true);
    void vscode.window.showInformationMessage(setting.disabledNotice);
  }
}

export function ensureMssqlErrorCheckingDisabled(context: vscode.ExtensionContext): Promise<void> {
  return ensureMssqlSettingDisabled(context, ERROR_CHECKING);
}

export function ensureMssqlSuggestionsDisabled(context: vscode.ExtensionContext): Promise<void> {
  return ensureMssqlSettingDisabled(context, SUGGESTIONS);
}

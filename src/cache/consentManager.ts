import * as vscode from 'vscode';

type ConsentChoice = 'enabled' | 'never' | 'ask';

const CONSENT_KEY = 'mssql-pilot.schemaCacheConsent';

/** Returns the stored consent choice, defaulting to 'ask' for new installs. */
export function getConsent(context: vscode.ExtensionContext): ConsentChoice {
  return context.globalState.get<ConsentChoice>(CONSENT_KEY, 'ask');
}

/** Returns true only when the user has explicitly enabled schema caching. */
export function isConsentGranted(context: vscode.ExtensionContext): boolean {
  return getConsent(context) === 'enabled';
}

/**
 * Show a one-time consent notice before this extension ever runs its own
 * background queries against the user's database. Requested lazily, the
 * first time a sync would actually run — never unconditionally at
 * activate() — so installing the extension without opening a SQL file
 * never shows a prompt.
 *
 * Returns true if the user grants consent.
 */
export async function requestConsent(context: vscode.ExtensionContext): Promise<boolean> {
  const current = getConsent(context);
  if (current === 'enabled') return true;
  if (current === 'never') return false;

  const choice = await vscode.window.showInformationMessage(
    'MSSQL Pilot: Enable background schema caching for faster autocomplete? ' +
    'MSSQL Pilot will read table, view, column, and stored procedure metadata ' +
    '(structure only — never your data or query results) from databases you connect to, ' +
    'and store it on disk so autocomplete works instantly even after reconnecting. ' +
    'mssql will ask for connection-sharing permission once as well.',
    'Enable schema caching',
    'Not now',
    'Never'
  );

  if (choice === 'Enable schema caching') {
    await context.globalState.update(CONSENT_KEY, 'enabled');
    return true;
  }
  if (choice === 'Never') {
    await context.globalState.update(CONSENT_KEY, 'never');
    return false;
  }
  return false; // "Not now" or dismissed — stays 'ask', prompts again next session
}

/** Allow the user to re-enable after choosing "Never" (via settings or command). */
export async function resetConsent(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(CONSENT_KEY, 'ask');
}

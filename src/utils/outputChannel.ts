import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('MSSQL Pilot');
  }
  return channel;
}

export function log(message: string): void {
  const stamp = new Date().toISOString();
  getChannel().appendLine(`[${stamp}] ${message}`);
}

/** Format an unknown caught value as a readable string, for log lines. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

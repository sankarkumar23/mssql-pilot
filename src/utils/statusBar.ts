import * as vscode from 'vscode';

let item: vscode.StatusBarItem | undefined;
/** cacheKey -> "server/database" label, for every first-sync currently in progress. */
const building = new Map<string, string>();

function ensureItem(): vscode.StatusBarItem {
  if (!item) {
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.tooltip = 'MSSQL Pilot is doing its first full schema sync for this database — can take a moment on a large schema.';
  }
  return item;
}

function render(): void {
  if (building.size === 0) {
    item?.hide();
    return;
  }
  const bar = ensureItem();
  const labels = [...building.values()];
  bar.text = labels.length === 1
    ? `$(sync~spin) MSSQL Pilot: Building IntelliSense (${labels[0]})`
    : `$(sync~spin) MSSQL Pilot: Building IntelliSense (${labels.length} databases)`;
  bar.show();
}

/** Only meant for a database's very first full sync — a delta sync is fast enough not to need this. */
export function startBuildingStatus(cacheKey: string, label: string): void {
  building.set(cacheKey, label);
  render();
}

export function stopBuildingStatus(cacheKey: string): void {
  building.delete(cacheKey);
  render();
}

export function disposeStatusBar(): void {
  item?.dispose();
  item = undefined;
  building.clear();
}

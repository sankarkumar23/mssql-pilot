/* eslint-disable @typescript-eslint/no-explicit-any */
import Module = require('module');
import * as fsp from 'fs/promises';
import * as path from 'path';

class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
}

class Uri {
  readonly scheme = 'file';
  private constructor(public readonly fsPath: string) {}
  get path(): string {
    return this.fsPath;
  }
  with(change: { path?: string }): Uri {
    return new Uri(change.path !== undefined ? change.path : this.fsPath);
  }
  toString(): string {
    return `file://${this.fsPath}`;
  }
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Field = 3,
  Interface = 7,
  Struct = 21,
}

class CompletionItem {
  detail?: string;
  documentation?: unknown;
  insertText?: string | InstanceType<typeof SnippetString>;
  command?: unknown;
  constructor(
    public label: string,
    public kind?: CompletionItemKind
  ) {}
}

class MarkdownString {
  value = '';
  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }
}

/** Minimal stand-in for VS Code's real SnippetString: escaping + auto-numbered tab stops. */
class SnippetString {
  value = '';
  private nextTabstop = 1;
  private escape(text: string): string {
    return String(text).replace(/[$}\\]/g, '\\$&');
  }
  appendText(text: string): this {
    this.value += this.escape(text);
    return this;
  }
  appendPlaceholder(value: string): this {
    this.value += `\${${this.nextTabstop++}:${this.escape(value)}}`;
    return this;
  }
  appendTabstop(index?: number): this {
    this.value += `$${index ?? this.nextTabstop++}`;
    return this;
  }
}

class TextEdit {
  constructor(
    public readonly range: Range,
    public readonly newText: string
  ) {}
  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }
}

class Disposable {
  constructor(private readonly onDispose: () => void) {}
  dispose(): void {
    this.onDispose();
  }
  static from(...disposables: Array<{ dispose(): void }>): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }
}

class WorkspaceEdit {
  replace(..._args: unknown[]): void {}
}

const configStore = new Map<string, Record<string, unknown>>();

function getConfiguration(section: string) {
  const store = configStore.get(section) ?? {};
  return {
    get<T>(key: string, defaultValue: T): T {
      return (store[key] as T) ?? defaultValue;
    },
  };
}

const vscodeStub: any = {
  Uri,
  FileType,
  Position,
  Range,
  CompletionItem,
  CompletionItemKind,
  MarkdownString,
  SnippetString,
  WorkspaceEdit,
  TextEdit,
  Disposable,
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [] as unknown[],
    _lastStatusBarItem: undefined as unknown,
    createOutputChannel: (_name: string) => ({
      appendLine: () => {},
      append: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {},
    }),
    createStatusBarItem: (..._args: unknown[]) => {
      const item = {
        text: '',
        tooltip: '',
        shown: false,
        show(this: { shown: boolean }) { this.shown = true; },
        hide(this: { shown: boolean }) { this.shown = false; },
        dispose() {},
      };
      vscodeStub.window._lastStatusBarItem = item;
      return item;
    },
    showInformationMessage: async (..._args: unknown[]) => undefined,
    showWarningMessage: async (..._args: unknown[]) => undefined,
    showErrorMessage: async (..._args: unknown[]) => undefined,
    showTextDocument: async () => undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  },
  workspace: {
    textDocuments: [] as unknown[],
    getConfiguration,
    onDidOpenTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    applyEdit: async () => true,
    fs: {
      readFile: (uri: Uri) => fsp.readFile(uri.fsPath),
      writeFile: (uri: Uri, content: Uint8Array) => fsp.writeFile(uri.fsPath, Buffer.from(content)),
      rename: (source: Uri, target: Uri) => fsp.rename(source.fsPath, target.fsPath),
      createDirectory: (uri: Uri) => fsp.mkdir(uri.fsPath, { recursive: true }).then(() => undefined),
      delete: (uri: Uri) => fsp.rm(uri.fsPath, { force: true }),
      readDirectory: async (uri: Uri): Promise<Array<[string, FileType]>> => {
        const names = await fsp.readdir(uri.fsPath);
        return names.map((name) => [name, FileType.File] as [string, FileType]);
      },
    },
  },
  commands: {
    registerCommand: (_id: string, _fn: (...args: unknown[]) => unknown) => ({ dispose() {} }),
    executeCommand: async (..._args: unknown[]) => undefined,
    getCommands: async () => [] as string[],
  },
  languages: {
    registerCompletionItemProvider: (..._args: unknown[]) => ({ dispose() {} }),
    registerOnTypeFormattingEditProvider: (..._args: unknown[]) => ({ dispose() {} }),
  },
  extensions: {
    getExtension: (_id: string) => undefined,
  },
};

/**
 * Hijacks require('vscode') the same way mssql-extras's vscodeStub does, so
 * any compiled test file that imports vscode — even without proxyquire —
 * gets a working fake. Loaded globally via mocha's `--require`.
 */
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: unknown[]) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.apply(Module, [request, ...rest]);
};

export = vscodeStub;

// Mock for VS Code API
export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  withProgress: vi.fn(async (_options, task) => task({ report: vi.fn() })),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  createQuickPick: vi.fn(() => ({
    placeholder: '',
    canSelectMany: false,
    items: [],
    activeItems: [],
    selectedItems: [],
    busy: false,
    enabled: true,
    ignoreFocusOut: false,
    matchOnDescription: false,
    matchOnDetail: false,
    value: '',
    buttons: [],
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    onDidChangeValue: vi.fn(() => ({ dispose: vi.fn() })),
    onDidAccept: vi.fn(() => ({ dispose: vi.fn() })),
    onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeActive: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTriggerItemButton: vi.fn(() => ({ dispose: vi.fn() })),
  })),
  createTreeView: vi.fn(() => ({
    reveal: vi.fn(),
    dispose: vi.fn()
  })),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    show: vi.fn()
  })),
  createTerminal: vi.fn(() => ({
    sendText: vi.fn(),
    dispose: vi.fn(),
    show: vi.fn()
  })),
  createStatusBarItem: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: '',
    tooltip: ''
  })),
  createWebviewPanel: vi.fn(() => ({
    webview: {
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      asWebviewUri: vi.fn((value) => value),
      cspSource: 'mock-csp-source'
    },
    title: '',
    active: true,
    viewColumn: 2,
    iconPath: undefined,
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() }))
  })),
  showTextDocument: vi.fn(async (document: any) => ({ document, viewColumn: 1 })),
  activeTextEditor: undefined,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeVisibleTextEditors: vi.fn(),
  onDidChangeTextEditorSelection: vi.fn(),
  onDidChangeTextEditorVisibleRanges: vi.fn(),
  onDidChangeTextEditorOptions: vi.fn(),
  onDidChangeTextEditorViewColumn: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
    has: vi.fn(),
    inspect: vi.fn(),
    update: vi.fn()
  })),
  workspaceFolders: [],
  onDidChangeConfiguration: vi.fn(),
  onDidChangeWorkspaceFolders: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  textDocuments: [],
  openTextDocument: vi.fn(async (value?: any) => {
    if (typeof value === 'string') {
      return {
        uri: { scheme: 'file', fsPath: value, path: value, toString: () => value },
        languageId: 'plaintext',
        isDirty: false,
        save: vi.fn(async () => true),
        getText: () => ''
      };
    }

    return {
      uri: value?.uri || { scheme: 'untitled', fsPath: '', path: '', toString: () => 'untitled:' },
      languageId: value?.language || 'plaintext',
      isDirty: false,
      save: vi.fn(async () => true),
      getText: () => value?.content || ''
    };
  }),
  applyEdit: vi.fn(async () => true),
  createFileSystemWatcher: vi.fn(() => ({
    onDidCreate: vi.fn(),
    onDidChange: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn()
  })),
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readDirectory: vi.fn(),
    createDirectory: vi.fn(),
    delete: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn()
  }
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
  getCommands: vi.fn(),
  registerTextEditorCommand: vi.fn()
};

export const env = {
  openExternal: vi.fn(async () => true),
  clipboard: {
    writeText: vi.fn(async () => undefined)
  }
};

export const languages = {
  setTextDocumentLanguage: vi.fn(async () => undefined)
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  parse: (value: string) => {
    const schemeMatch = /^([a-z0-9+.-]+):/i.exec(value);
    const scheme = schemeMatch ? schemeMatch[1] : 'file';
    return { fsPath: value, scheme, path: value, toString: () => value };
  },
  joinPath: (base: { fsPath?: string; path?: string }, ...paths: string[]) => {
    const segments = [base.fsPath || base.path || '', ...paths].filter(Boolean);
    const joined = segments.join('/').replace(/\/{2,}/g, '/');
    return { fsPath: joined, path: joined, scheme: 'file', toString: () => joined };
  }
};

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2
}

export class TreeItem {
  constructor(
    public label: string | { label: string },
    public collapsibleState?: TreeItemCollapsibleState
  ) {}
  contextValue?: string;
  iconPath?: any;
  description?: string;
  tooltip?: string;
  command?: any;
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class EventEmitter {
  private listeners: Array<(...args: any[]) => void> = [];

  event = (listener: (...args: any[]) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    }};
  };

  fire(...args: any[]) {
    this.listeners.forEach(listener => listener(...args));
  }

  dispose() {
    this.listeners = [];
  }
}

export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}
  dispose() {
    this.callOnDispose();
  }
  static from(...disposables: Disposable[]) {
    return new Disposable(() => disposables.forEach(d => d.dispose()));
  }
}

export class ExtensionContext {
  subscriptions: Disposable[] = [];
  private readonly storage = new Map<string, any>();

  globalState = {
    get: (key: string, defaultValue?: any) => {
      return this.storage.get(key) ?? defaultValue;
    },
    update: (key: string, value: any) => {
      this.storage.set(key, value);
      return Promise.resolve();
    },
    keys: () => Array.from(this.storage.keys()),
    setKeysForSync: vi.fn()
  };

  workspaceState = {
    get: vi.fn(),
    update: vi.fn(),
    keys: vi.fn(() => [])
  };
  secrets = {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn()
  };
  extensionPath = '';
  extensionUri = Uri.file('');
  storagePath = '';
  globalStoragePath = '';
  logPath = '';
  extensionMode = 3; // Production
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3
}

export enum ProgressLocation {
  Notification = 15
}

export enum QuickPickItemKind {
  Separator = -1,
  Default = 0
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class WorkspaceEdit {
  insert = vi.fn();
  replace = vi.fn();
}

export class FileSystemError extends Error {
  static FileNotFound(uri?: any) {
    return new FileSystemError(`File not found: ${uri?.path ?? ''}`);
  }
  static FileExists(uri?: any) {
    return new FileSystemError(`File exists: ${uri?.path ?? ''}`);
  }
  static Unavailable(uri?: any) {
    return new FileSystemError(`Unavailable: ${uri?.path ?? ''}`);
  }
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3
}

export const tests = {
  createTestController: vi.fn(() => ({
    items: {
      add: vi.fn(),
      delete: vi.fn(),
      forEach: vi.fn(),
      size: 0
    },
    createTestItem: vi.fn((id, label, uri) => ({
      id,
      label,
      uri,
      canResolveChildren: false
    })),
    createRunProfile: vi.fn(),
    dispose: vi.fn()
  }))
};

export enum TestRunProfileKind {
  Run = 1,
  Debug = 2,
  Coverage = 3
}

export class TestMessage {
  constructor(public message: string) {}
}

export enum ExtensionMode {
  Production = 1,
  Development = 2,
  Test = 3
}

// Add DataTransfer and related types for drag and drop
export class DataTransferItem {
  constructor(public value: any) {}
  asString(): Promise<string> {
    return Promise.resolve(String(this.value));
  }
  asFile(): any {
    return undefined;
  }
}

export class DataTransfer {
  private readonly items = new Map<string, DataTransferItem>();

  get(mimeType: string): DataTransferItem | undefined {
    return this.items.get(mimeType);
  }

  set(mimeType: string, value: DataTransferItem): void {
    this.items.set(mimeType, value);
  }

  forEach(callback: (value: DataTransferItem, key: string) => void): void {
    this.items.forEach((value, key) => callback(value, key));
  }
}

export const debug = {
  startDebugging: vi.fn(),
  onDidStartDebugSession: vi.fn(),
  onDidTerminateDebugSession: vi.fn()
};

// Add vitest's vi to global scope for the mock
declare global {
  const vi: typeof import('vitest')['vi'];
}

export default {
  window,
  workspace,
  commands,
  Uri,
  TreeItemCollapsibleState,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  EventEmitter,
  Disposable,
  ExtensionContext,
  StatusBarAlignment,
  FileType,
  ConfigurationTarget,
  tests,
  TestRunProfileKind,
  TestMessage,
  ExtensionMode,
  ViewColumn,
  ProgressLocation,
  QuickPickItemKind,
  Position,
  WorkspaceEdit,
  FileSystemError,
  DataTransferItem,
  DataTransfer,
  debug,
  env,
  languages
};

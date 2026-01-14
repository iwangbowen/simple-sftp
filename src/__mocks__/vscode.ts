// Mock for VS Code API
export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
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
    dispose: vi.fn()
  })),
  createStatusBarItem: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: '',
    tooltip: ''
  })),
  showTextDocument: vi.fn(),
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
  onDidSaveTextDocument: vi.fn(),
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

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  parse: (value: string) => ({ fsPath: value, scheme: 'file', path: value })
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
  constructor(private callOnDispose: () => void) {}
  dispose() {
    this.callOnDispose();
  }
  static from(...disposables: Disposable[]) {
    return new Disposable(() => disposables.forEach(d => d.dispose()));
  }
}

export class ExtensionContext {
  subscriptions: Disposable[] = [];
  private storage = new Map<string, any>();

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

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64
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
  private items = new Map<string, DataTransferItem>();

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
  EventEmitter,
  Disposable,
  ExtensionContext,
  StatusBarAlignment,
  FileType,
  tests,
  TestRunProfileKind,
  TestMessage,
  ExtensionMode,
  DataTransferItem,
  DataTransfer,
  debug
};

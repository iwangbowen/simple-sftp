# AGENTS.md - simple-sftp VS Code Extension

A VS Code extension providing SFTP client functionality with connection pooling, port forwarding, and cross-device configuration sync.

## Build, Lint, Test Commands

```bash
# Build & Watch
npm run build          # Production build with esbuild
npm run compile        # Development build
npm run watch          # Auto-rebuild on changes

# Testing (Vitest)
npm run test           # Run all tests once
npm run test:watch     # Watch mode
npm run test:unit      # Unit tests only (exclude integration-tests/)
npm run test:integration  # Integration tests in src/integration-tests/
npm run test -- src/path/to/file.test.ts  # Single test file
npm run test:coverage  # Generate coverage report

# Linting & Publishing
npm run lint           # ESLint check
npm run publish        # Package and publish to marketplace
```

## Architecture & Codebase Structure

**VS Code Extension** providing SFTP client with port forwarding and SSH configuration sync.

### Core Components

**Connection Management** (root-level):

- `sshConnectionManager.ts` - High-level SSH/SFTP operations (upload, download, read)
- `sshConnectionPool.ts` - Connection reuse pool (max 7 per host, 5min idle timeout)
- `hostManager.ts` - Host configs (synced via `globalState.setKeysForSync`)
- `authManager.ts` - Credentials (local `SecretStorage`, never synced)

**Service Layer** (`src/services/`):

- `transferQueueService.ts` - Singleton managing async file transfers with retry logic
- `portForwardService.ts` - SSH tunnel management
- `bookmarkService.ts` - Remote path bookmarks with color coding
- `fileIntegrityChecker.ts` - MD5/SHA256 verification for transfers
- `deltaSyncManager.ts` - Smart sync (skip unchanged files by mtime/checksum)
- `resourceDashboardService.ts` - Remote system resource monitoring

**UI Layer** (`src/ui/`):

- Tree providers: `HostTreeProvider`, `TransferQueueTreeProvider`, `PortForwardingTreeProvider`
- WebView providers: `DualPanelViewProvider`, `ConnectionPoolProvider`, `ResourceDashboardProvider`
- Dual-panel file browser lives in `resources/webview/*.{html,css,js}`

**Transfer Strategies** (root-level):

- `attributePreservingTransfer.ts` - Preserve permissions/timestamps (chmod/utime)
- `parallelChunkTransfer.ts` - Multi-connection chunk transfers (100MB+ files, disabled by default)
- `compressionTransfer.ts` - SSH-level + file-level gzip for text files

**Entry Point**: `extension.ts` - Activates on `onView:simpleSftp.hosts` and `onFileSystem:sftp`

## Code Style & Conventions

- **Language**: TypeScript (ES2021), compiled to CommonJS
- **Bundler**: esbuild (see `esbuild.js`) - bundles to `out/extension.js`
- **Linter**: ESLint with @typescript-eslint
- **Naming**: camelCase (default), PascalCase for types/classes, UPPER_CASE for constants
- **Imports**: Standard TS imports, mock aliases in tests via vitest config
- **Testing**: Vitest with node environment; mocks in `__mocks__/` (vscode is mocked)
  - Test files co-located with source (e.g., `hostManager.test.ts` next to `hostManager.ts`)
  - Integration tests in separate folder `src/integration-tests/`
  - Default timeout: 10000ms (for slow SSH operations)
- **Strict mode**: Enabled in tsconfig
- **Formatting**: Semi-colons encouraged, curly braces required
- **Error handling**: Use typed exceptions, avoid throwing literals
- **Async operations**: Always use `async/await`, never Promise chains
- **Singletons**: `static getInstance()` pattern (e.g., `SshConnectionPool`, `TransferQueueService`)
- **Constants**: All defined in `constants.ts` (DEFAULTS, LIMITS, PROMPTS, MESSAGES, UI.ICONS)
- **No trailing spaces**, consistent formatting with ESLint rules

## VS Code Extension Patterns

### State Management

- **Synced state**: Use `context.globalState` with `setKeysForSync([key])` for hosts, groups, bookmarks
- **Local state**: Use `context.secrets` for auth credentials (passwords, private keys)
- Check `HostManager.initialize()` logs sync keys on activation

### TreeView Pattern

```typescript
class MyTreeProvider implements vscode.TreeDataProvider<MyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(item?: MyItem): void {
    this._onDidChangeTreeData.fire(item);
  }
}
```

### WebView Communication

- Extension → WebView: `panel.webview.postMessage({ type: 'command', ... })`
- WebView → Extension: `vscode.postMessage({ command: 'action', ... })`
- Pattern in `dualPanelBase.ts`: Handle messages in `_handleMessage()` method

## Critical Integration Points

### SSH Connection Flow

1. **Jump Hosts**: Multi-hop supported via `establishMultiHopConnection()` in `utils/jumpHostHelper.ts`
2. **Connection Pool**: Always use `SshConnectionManager.withConnection()` to auto-release
3. **Auth Loading**: Pool calls `authManager.getAuth(hostId)` internally
4. **Cleanup**: Idle connections auto-close after 5min

### Transfer Queue Architecture

- Central queue in `TransferQueueService` (singleton)
- Supports pause/resume/retry with configurable max concurrent (default: 2)
- Progress tracking via `TransferTask` model (`src/models/transferTask.ts`)
- History persisted to `context.globalState` (see `TransferHistoryService`)

### Parallel Transfer Caveats

⚠️ **IMPORTANT**: `simpleSftp.parallelTransfer.enabled` defaults to FALSE

- **Why**: Incompatible with proxies, jump hosts, some SFTP servers
- **Requirements**: Direct connection, concurrent connection support
- Always check compatibility before enabling

## Security Notes

- **Never sync secrets**: Auth credentials stay in `context.secrets` (local only)
- **SSH Agent**: Windows named pipe support (`\\\\.\\pipe\\openssh-ssh-agent`)
- **Private keys**: Stored as file paths, not contents
- **Jump hosts**: Auth loaded from `AuthManager` per-hop

## Debugging Tips

- **Output logs**: `logger.ts` writes to "Simple SFTP" output channel
- **Enable**: Use "Show Output Logs" command
- **Connection pool**: View live stats via "Show Connection Pool Status"
- **Transfer queue**: All tasks visible in TreeView with real-time updates

---

**See also**: `.github/copilot-instructions.md` (detailed AI agent guide), `docs/SFTP_OPTIMIZATION_ROADMAP.md` (features), `README.md` (user docs)

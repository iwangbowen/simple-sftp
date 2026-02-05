# Simple SFTP - AI Coding Agent Instructions

A VS Code extension providing SFTP client functionality with connection pooling, port forwarding, and cross-device configuration sync.

## Architecture Overview

### Core Components

**Connection Management** (root-level files):
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

**UI Layer** (`src/ui/`):
- Tree providers: `HostTreeProvider`, `TransferQueueTreeProvider`, `PortForwardingTreeProvider`
- WebView providers: `DualPanelViewProvider`, `ConnectionPoolProvider`, `ResourceDashboardProvider`
- Dual-panel file browser lives in `resources/webview/*.{html,css,js}`

**Transfer Strategies** (root-level files):
- `attributePreservingTransfer.ts` - Preserve permissions/timestamps (chmod/utime)
- `parallelChunkTransfer.ts` - Multi-connection chunk transfers (100MB+ files, disabled by default)
- `compressionTransfer.ts` - SSH-level + file-level gzip for text files

**Entry Point**: `extension.ts` - Activates on `onView:simpleSftp.hosts` and `onFileSystem:sftp`

## Development Workflow

### Commands (from AGENTS.md)

```bash
# Build & Watch
npm run build          # Production build with esbuild
npm run watch          # Auto-rebuild on changes

# Testing (Vitest)
npm run test           # Run all tests once
npm run test:unit      # Unit tests only (exclude integration-tests/)
npm run test:integration  # Integration tests in src/integration-tests/
npm run test -- src/path/to/file.test.ts  # Single test file
npm run test:coverage  # Generate coverage report

# Linting & Publishing
npm run lint           # ESLint check
npm run publish        # Package and publish to marketplace
```

### ⚠️ CRITICAL: Type Safety & Test Validation

After modifying any TypeScript file, ALWAYS execute the following commands to ensure code quality:

```bash
# 1. Verify TypeScript compilation (no type errors)
npx tsc --noEmit

# 2. Run all tests (ensure no regressions)
npm run test
```

### Build System

- **Bundler**: esbuild (see `esbuild.js`) - bundles to `out/extension.js`
- **Target**: CommonJS, ES2021, Node platform
- **Externals**: `vscode` module, `.node` native modules
- **Production**: Minified, no sourcemaps
- **Development**: Sourcemaps enabled, no minification

### Testing Conventions

- **Framework**: Vitest with `node` environment
- **Mocks**: `src/__mocks__/vscode.ts` mocks VS Code API (aliased in `vitest.config.ts`)
- **Setup**: `src/__mocks__/setup.ts` makes `vi` globally available
- **Test files**: Co-located with source (e.g., `hostManager.test.ts` next to `hostManager.ts`)
- **Integration tests**: Separate folder `src/integration-tests/`
- **Timeout**: 10000ms default (for slow SSH operations)

## Code Conventions

### TypeScript Patterns

- **Naming**: camelCase (default), PascalCase (types/classes), UPPER_CASE (constants)
- **Strict Mode**: Enabled (`tsconfig.json`)
- **Error Handling**: Throw typed exceptions (never string literals)
- **Singletons**: `static getInstance()` pattern (e.g., `SshConnectionPool`, `TransferQueueService`)
- **Async Operations**: Always use `async/await`, never Promise chains

### VS Code Extension Specifics

**State Management**:
- **Synced state**: Use `context.globalState` with `setKeysForSync([key])` (hosts, groups, bookmarks)
- **Local state**: Use `context.secrets` for auth credentials (passwords, keys)
- **Check**: `HostManager.initialize()` logs sync keys on activation

**TreeView Pattern**:
```typescript
// Standard pattern for tree providers
class MyTreeProvider implements vscode.TreeDataProvider<MyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(item?: MyItem): void {
    this._onDidChangeTreeData.fire(item);
  }
}
```

**WebView Communication**:
- Extension → WebView: `panel.webview.postMessage({ type: 'command', ... })`
- WebView → Extension: `vscode.postMessage({ command: 'action', ... })`
- Pattern in `dualPanelBase.ts`: Handle messages in `_handleMessage()` method

### Constants & Configuration

**All constants** defined in `constants.ts`:
- `DEFAULTS`, `LIMITS`, `TIMING` - Magic numbers
- `PROMPTS`, `MESSAGES`, `LABELS` - User-facing strings (supports i18n refactor)
- `PARALLEL_TRANSFER`, `DELTA_SYNC`, `COMPRESSION` - Feature flags with defaults
- `UI.ICONS` - Codicon names for consistency

**Get config values**: Use `getParallelTransferConfig()` helper (converts MB to bytes)

## Critical Integration Points

### SSH Connection Flow

1. **Jump Hosts**: Multi-hop supported via `establishMultiHopConnection()` in `utils/jumpHostHelper.ts`
2. **Connection Pool**: Always use `SshConnectionManager.withConnection()` to auto-release
3. **Auth Loading**: Pool calls `authManager.getAuth(hostId)` internally
4. **Cleanup**: Idle connections auto-close after 5min (see `sshConnectionPool.ts` cleanup timer)

### Transfer Queue System

**Architecture**:
- Central queue in `TransferQueueService` (singleton)
- Supports pause/resume/retry with configurable max concurrent (default: 2)
- Progress tracking via `TransferTask` model (`src/models/transferTask.ts`)
- History persisted to `context.globalState` (see `TransferHistoryService`)

**Adding transfers**:
```typescript
const task = await TransferQueueService.getInstance().addTask({
  type: 'upload' | 'download',
  localPath: string,
  remotePath: string,
  hostId: string,
  totalSize: number,
  // Optional: preserveAttributes, verifyIntegrity, onProgress
});
```

### File Integrity Verification

**Toggle**: `simpleSftp.verification.enabled` (default: false, requires `md5sum`/`sha256sum` on server)
- Threshold: Only verify files > 10MB by default
- Algorithm: SHA256 (more secure) or MD5 (faster)
- See `FileIntegrityChecker.verifyFile()` for implementation

### Parallel Transfer Caveats

**⚠️ IMPORTANT**: `simpleSftp.parallelTransfer.enabled` defaults to FALSE
- **Why**: Incompatible with proxies, jump hosts, some SFTP servers
- **Requirements**: Direct connection, concurrent connection support
- **Implementation**: `ParallelChunkTransferManager` spawns multiple SSH connections
- **Always check compatibility** before enabling for users

## Common Patterns

### Adding a New Command

1. Add command to `package.json` contributions
2. Register in `extension.ts`: `vscode.commands.registerCommand('simpleSftp.myCommand', handler)`
3. Implement in `CommandHandler` or dedicated service
4. Add tests: `myService.test.ts`
5. Update constants for strings/icons

### Adding Configuration

1. Add to `package.json` under `configuration.properties`
2. Create getter in `constants.ts` (e.g., `getMyFeatureConfig()`)
3. Apply in service initialization (see `extension.ts` transfer queue config)
4. Document in README.md and CHANGELOG.md

### WebView Development

1. HTML/CSS/JS in `resources/webview/`
2. Provider in `src/ui/` (extends `dualPanelBase.ts` or standalone)
3. Message passing: `_handleMessage()` for incoming, `postMessage()` for outgoing
4. Icons: Use Codicons (`$(icon-name)`) for consistency

## Testing Strategy

**Unit Tests**: Mock SSH connections, test business logic in isolation
```typescript
// Example: Mock SFTP client
vi.mock('ssh2-sftp-client');
const mockSftp = {
  list: vi.fn().mockResolvedValue([...]),
  get: vi.fn().mockResolvedValue(undefined)
};
```

**Integration Tests** (`src/integration-tests/`): Test full workflows
- Use real file system (`fs` operations)
- Mock VS Code API only (via `__mocks__/vscode.ts`)
- Example: `host-management-integration.test.ts` tests host CRUD + auth flow

**Coverage**: Run `npm run test:coverage` - HTML report in `coverage/index.html`

## Performance Considerations

### Connection Pooling

- **Reuse factor**: 5-10x faster than creating new connections
- **Pool size**: Max 7 per host (matches 5 concurrent chunks + 2 buffer)
- **Monitoring**: Use "Show Connection Pool Status" command (webview dashboard)

### Large File Transfers

- **> 100MB**: Auto-switch to parallel chunks (if enabled + supported)
- **Text files > 50MB**: Consider file-level gzip (see `COMPRESSION` constants)
- **Resume support**: Use `startOffset` in download/upload options

### Memory Management

- **Stream API**: All transfers use `createReadStream/createWriteStream` (64KB highWaterMark)
- **Chunk size**: 10MB default for parallel (configurable)
- **Avoid**: Never load entire files into memory

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

**See also**: `AGENTS.md` (commands), `docs/SFTP_OPTIMIZATION_ROADMAP.md` (features), `README.md` (user docs)
